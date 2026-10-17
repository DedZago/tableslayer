import { describe, expect, it } from 'vitest';
import { isPublicAddress, validateDownloadUrl } from './download';

describe('artwork download destinations', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '192.168.1.26',
    '172.16.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
    '2002:7f00:1::1',
    '2001:0000::1'
  ])('rejects nonpublic address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
    'permits public address %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    }
  );
  it('only trusts the operator mirror origin and path', () => {
    const mirror = 'http://localhost:9000/images/';
    expect(validateDownloadUrl(`${mirror}goblin.webp`, mirror).trusted).toBe(true);
    expect(() => validateDownloadUrl('http://localhost:9000/private', mirror)).toThrow('public HTTPS');
    expect(() => validateDownloadUrl('http://localhost:9001/images/a.webp', mirror)).toThrow('public HTTPS');
    expect(validateDownloadUrl('https://example.com/a.webp', mirror).trusted).toBe(false);
    expect(() => validateDownloadUrl('http://localhost:9000/images/../private', mirror)).toThrow('public HTTPS');
  });
  it.each([
    'file:///etc/passwd',
    'http://example.com/a.png',
    'https://user:pass@example.com/a.png',
    'https://example.com:9000/a.png'
  ])('rejects arbitrary unsafe URL %s', (url) => {
    expect(() => validateDownloadUrl(url)).toThrow();
  });
});

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { afterAll, beforeAll } from 'vitest';
import { downloadFiveToolsArtwork } from './download';

let fixtureBase = '';
const image = await readFile(new URL('../../../../../tests/e2e/fixtures/test-image.png', import.meta.url));
const server = createServer((request, response) => {
  if (request.url === '/images/redirect') {
    response.writeHead(302, { Location: '/images/valid' });
    response.end();
  } else if (request.url === '/images/private-redirect') {
    response.writeHead(302, { Location: '/private' });
    response.end();
  } else if (request.url === '/images/oversize') {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': 16 * 1024 * 1024 });
    response.end('too large');
  } else if (request.url === '/images/invalid') {
    response.writeHead(200, { 'Content-Type': 'image/png' });
    response.end('not an image');
  } else if (request.url === '/images/html') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<html>blocked</html>');
  } else {
    response.writeHead(200, { 'Content-Type': 'image/png' });
    response.end(image);
  }
});
beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  fixtureBase = `http://127.0.0.1:${address.port}/images/`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

it('downloads and decodes originals through a permitted mirror redirect', async () => {
  const result = await downloadFiveToolsArtwork(`${fixtureBase}redirect`, fixtureBase);
  expect(result.data).toEqual(image);
  expect(result.sourceUrl).toBe(`${fixtureBase}valid`);
});
it('revalidates redirect targets outside the trusted mirror path', async () => {
  await expect(downloadFiveToolsArtwork(`${fixtureBase}private-redirect`, fixtureBase)).rejects.toThrow('public HTTPS');
});
it.each(['oversize', 'invalid', 'html'])('rejects invalid artwork response %s', async (path) => {
  await expect(downloadFiveToolsArtwork(`${fixtureBase}${path}`, fixtureBase)).rejects.toThrow();
});
