import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMediaInventory, createMediaInventory } from './media-cleanup.mjs';

config({ path: '.env', quiet: true });
const args = process.argv.slice(2);
const mode = args[0];
const filename = args[1];
if (!['--inventory', '--apply'].includes(mode) || !filename || !args.includes('--offline'))
  throw new Error(
    'Usage: cleanup-media.mjs {--inventory|--apply} /path/plan.json --offline. Stop all writers and close clients first.'
  );
const databaseUrl = process.env.TURSO_APP_DB_URL;
if (!databaseUrl?.startsWith('file:') || databaseUrl === 'file::memory:')
  throw new Error('Manual cleanup requires the stopped deployment’s local SQLite database');
const databasePath = databaseUrl.startsWith('file://')
  ? fileURLToPath(databaseUrl)
  : path.resolve(databaseUrl.slice(5));
const databaseMetadata = await lstat(databasePath);
if (!databaseMetadata.isFile()) throw new Error('Cleanup requires a regular database file');
const database = createClient({ url: databaseUrl });
await database.execute('PRAGMA foreign_keys = ON');
const local = process.env.ASSET_STORAGE === 'local';
const root = path.resolve(process.env.LOCAL_ASSET_DIR || '/app/data/assets');
const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const endpoint = `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const r2 = local
  ? null
  : new S3Client({
      endpoint,
      region: 'auto',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY,
        secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_KEY
      }
    });
const localPath = (key) => {
  if (!key || key.includes('\\') || key.split('/').some((part) => !part || part === '.' || part === '..'))
    throw new Error('Invalid storage key');
  return path.join(root, key);
};
const localObject = async (key) => {
  const target = localPath(key);
  const metadata = await lstat(target);
  if (!metadata.isFile()) throw new Error('Cleanup refuses non-regular files');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(target)) digest.update(chunk);
  return { key, bytes: metadata.size, modifiedAt: metadata.mtimeMs, version: digest.digest('hex') };
};
const storage = {
  async list() {
    const objects = [];
    if (local) {
      const walk = async (relative = '') => {
        for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
          const key = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isSymbolicLink()) throw new Error('Cleanup refuses symbolic links');
          if (entry.isDirectory()) await walk(key);
          else objects.push(await localObject(key));
        }
      };
      await walk();
    } else {
      let continuation;
      do {
        const result = await r2.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuation }));
        for (const object of result.Contents ?? []) {
          if (!object.Key || !object.ETag || !object.LastModified) throw new Error('Incomplete object inventory');
          objects.push({
            key: object.Key,
            bytes: object.Size,
            modifiedAt: object.LastModified.getTime(),
            version: object.ETag
          });
        }
        continuation = result.IsTruncated ? result.NextContinuationToken : undefined;
        if (result.IsTruncated && !continuation) throw new Error('Incomplete storage pagination');
      } while (continuation);
    }
    return objects;
  },
  async remove(key, version) {
    if (local) {
      if ((await localObject(key)).version !== version) throw new Error(`Object changed: ${key}`);
      await unlink(localPath(key));
    } else await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, IfMatch: version }));
  }
};
const rootMetadata = local ? await lstat(root) : null;
const binding = JSON.stringify([
  process.env.ENV_NAME || 'local',
  databasePath,
  databaseMetadata.dev,
  databaseMetadata.ino,
  local ? [root, rootMetadata.dev, rootMetadata.ino] : [endpoint, bucket]
]);
try {
  if (mode === '--inventory') {
    const inventory = await createMediaInventory({ database, storage, binding });
    await writeFile(filename, JSON.stringify(inventory, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(
      `Wrote ${inventory.items.length} objects. Review candidates and set delete=true only for chosen objects.`
    );
  } else {
    const plan = JSON.parse(await readFile(filename, 'utf8'));
    const count = await applyMediaInventory({ database, storage, binding, plan });
    console.log(`Removed ${count} selected objects.`);
  }
} finally {
  database.close();
  r2?.destroy();
}
