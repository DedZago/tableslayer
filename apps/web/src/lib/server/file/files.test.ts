import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUserFileFromLocation, storeImportedArtwork } from './files';
import { readLocalAsset, writeLocalAsset } from './localStorage';

const { send, transaction } = vi.hoisted(() => ({ send: vi.fn(), transaction: vi.fn() }));
vi.mock('$lib/db/app', () => ({ db: { transaction } }));
vi.mock('@aws-sdk/client-s3', async (original) => ({
  ...(await original<typeof import('@aws-sdk/client-s3')>()),
  S3Client: class {
    send = send;
  }
}));

let root: string;
let firstImage: Buffer;
let secondImage: Buffer;
const staged = 'uploads/owner/12345678-1234-1234-1234-123456789abc.png';

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'tableslayer-originals-'));
  vi.stubEnv('LOCAL_ASSET_DIR', root);
  vi.stubEnv('ASSET_STORAGE', 'local');
  transaction.mockImplementation(async (callback) =>
    callback({
      insert: () => ({
        values: (values: { location?: string }) => ({
          returning: () => ({ get: async () => ({ id: 42, location: values.location }) })
        })
      })
    })
  );
  firstImage = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  secondImage = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } })
    .png()
    .toBuffer();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('immutable originals', () => {
  it('keeps a registered original unchanged even if the signed staging path is reused', async () => {
    await writeLocalAsset(staged, firstImage);
    const first = await createUserFileFromLocation(staged, 'owner');
    await writeLocalAsset(staged, secondImage);
    const second = await createUserFileFromLocation(staged, 'owner');
    expect(first.location).not.toBe(second.location);
    expect(await readLocalAsset(first.location)).toEqual(firstImage);
    expect(await readLocalAsset(second.location)).toEqual(secondImage);
  });

  it('refuses another owner and refuses to register an existing original', async () => {
    await expect(createUserFileFromLocation(staged, 'other')).rejects.toThrow('Unauthorized');
    await expect(createUserFileFromLocation('originals/owner/image.png', 'owner')).rejects.toThrow('Unauthorized');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not register malformed artwork', async () => {
    await writeLocalAsset(staged, Buffer.from('invalid'));
    await expect(createUserFileFromLocation(staged, 'owner')).rejects.toThrow('cannot be decoded');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('removes only the new unregistered original if metadata creation fails', async () => {
    vi.stubEnv('ASSET_STORAGE', 'r2');
    const { Readable } = await import('node:stream');
    send.mockImplementation(async (command) =>
      command.constructor.name === 'GetObjectCommand'
        ? { Body: Readable.from([firstImage]), ContentLength: firstImage.length }
        : {}
    );
    transaction.mockRejectedValueOnce(new Error('metadata unavailable'));
    await expect(createUserFileFromLocation(staged, 'owner')).rejects.toThrow('metadata unavailable');
    const commands = send.mock.calls.map(([command]) => command);
    expect(commands[2].input.Key).toBe(commands[1].input.Key);
    expect(commands[2].input.Key).not.toBe(staged);
  });

  it('stores a fresh original through R2 before registering metadata and removes only staging', async () => {
    vi.stubEnv('ASSET_STORAGE', 'r2');
    const { Readable } = await import('node:stream');
    send.mockImplementation(async (command) =>
      command.constructor.name === 'GetObjectCommand'
        ? { Body: Readable.from([firstImage]), ContentLength: firstImage.length }
        : {}
    );
    const result = await createUserFileFromLocation(staged, 'owner');
    const commands = send.mock.calls.map(([command]) => command);
    expect(commands.map((command) => command.constructor.name)).toEqual([
      'GetObjectCommand',
      'PutObjectCommand',
      'DeleteObjectCommand'
    ]);
    expect(commands[1].input.Key).toBe(result.location);
    expect(commands[1].input.Body).toEqual(firstImage);
    expect(commands[2].input.Key).toBe(staged);
  });
});

describe('stored imported originals', () => {
  it('stores independent validated originals with owner registration', async () => {
    const first = await storeImportedArtwork(firstImage, 'image/png', 'owner');
    const second = await storeImportedArtwork(firstImage, 'image/png', 'owner');
    expect(first).toMatch(/^originals\/owner\/.+\.png$/);
    expect(first).not.toBe(second);
    expect(await readLocalAsset(first)).toEqual(firstImage);
    expect(transaction).toHaveBeenCalledTimes(2);
  });
  it('rolls back only its newly uploaded original when registration fails', async () => {
    vi.stubEnv('ASSET_STORAGE', 'r2');
    send.mockResolvedValue({});
    transaction.mockRejectedValueOnce(new Error('Registration failed'));
    await expect(storeImportedArtwork(firstImage, 'image/png', 'owner')).rejects.toThrow('Registration failed');
    const uploaded = send.mock.calls.find(([command]) => command.constructor.name === 'PutObjectCommand')![0];
    const removed = send.mock.calls.find(([command]) => command.constructor.name === 'DeleteObjectCommand')![0];
    expect(removed.input.Key).toBe(uploaded.input.Key);
    expect(removed.input.Key).toMatch(/^originals\/owner\//);
  });
});
