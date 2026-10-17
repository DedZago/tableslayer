import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const manifest = JSON.parse(await readFile(new URL('../apps/web/static-assets.json', import.meta.url), 'utf8'));
const root = process.env.LOCAL_ASSET_DIR || '/data/assets';
for (const key of manifest.files) {
  if (key.split('/').some((part) => !part || part === '..' || part === '.') || key.includes('\\')) {
    throw new Error(`Invalid manifest path: ${key}`);
  }
  const target = path.join(root, key);
  if (
    await stat(target).then(
      () => true,
      () => false
    )
  )
    continue;
  const response = await fetch(`${manifest.source}/${key}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Asset download failed: ${key} (${response.status})`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(`${target}.tmp`, Buffer.from(await response.arrayBuffer()));
  await rename(`${target}.tmp`, target);
  console.log(`Imported ${key}`);
}
