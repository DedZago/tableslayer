import { validateStoredMedia } from '$lib/server/file/validateImage';
import { mediaUploadLimit, validateMediaUpload } from '$lib/utils/mediaUpload';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export const isPublicAddress = (address: string): boolean => {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (isIP(address) !== 6) return false;
  const normalized = address.toLowerCase();
  // Public IPv6 unicast only; reject mapped IPv4 and special/private ranges.
  return (
    /^[23][0-9a-f]{3}:/.test(normalized) &&
    !normalized.startsWith('2001:db8:') &&
    !/^2001:(?:0{1,4}|0*2|0*10|0*20):/.test(normalized) &&
    !normalized.startsWith('2002:')
  );
};

export const validateDownloadUrl = (input: string, trustedBase?: string) => {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Unsupported artwork URL');
  url.hash = '';
  const base = trustedBase ? new URL(trustedBase.endsWith('/') ? trustedBase : `${trustedBase}/`) : null;
  const trusted = !!base && url.origin === base.origin && url.pathname.startsWith(base.pathname);
  if (!trusted && ((url.port && !['80', '443'].includes(url.port)) || url.protocol !== 'https:')) {
    throw new Error('Artwork must use a public HTTPS destination');
  }
  return { url, trusted };
};

export const downloadFiveToolsResource = async (input: string, trustedBase?: string, json = false) => {
  const deadline = Date.now() + 20000;
  let next = input;
  for (let redirect = 0; redirect <= 5; redirect++) {
    const { url, trusted } = validateDownloadUrl(next, trustedBase);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_resolve, reject) => {
        dnsTimer = setTimeout(
          () => reject(new Error('Artwork DNS lookup timed out')),
          Math.max(1, deadline - Date.now())
        );
      })
    ]).finally(() => clearTimeout(dnsTimer));
    if (!addresses.length || (!trusted && addresses.some(({ address }) => !isPublicAddress(address)))) {
      throw new Error('Artwork destination is not a public network address');
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Artwork download timed out');
    const outcome = await new Promise<{ redirect?: string; data?: Buffer; contentType?: string }>((resolve, reject) => {
      const address = addresses[0];
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          // Pin the validated address so a second DNS lookup cannot bypass validation.
          lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
          family: address.family,
          headers: {
            Accept: json ? 'application/json,text/plain' : 'image/*',
            'User-Agent': 'TableSlayer/5etools-import'
          }
        },
        (response) => {
          if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
            const location = response.headers.location;
            response.destroy();
            if (!location) reject(new Error('Artwork redirect is missing its destination'));
            else resolve({ redirect: new URL(location, url).href });
            return;
          }
          if (response.statusCode !== 200) {
            response.destroy();
            reject(new Error(`Artwork download failed (${response.statusCode})`));
            return;
          }
          const contentType = (response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
          try {
            if (json) {
              if (!['application/json', 'text/plain'].includes(contentType))
                throw new Error('Catalog response is not JSON');
            } else validateMediaUpload({ type: contentType, size: 1 }, true);
          } catch (error) {
            response.destroy();
            reject(error);
            return;
          }
          const limit = json ? 10 * 1024 * 1024 : mediaUploadLimit(contentType);
          if (Number(response.headers['content-length'] ?? 0) > limit) {
            response.destroy();
            reject(new Error('Artwork exceeds the size limit'));
            return;
          }
          let length = 0;
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > limit) {
              response.destroy(new Error('Artwork exceeds the size limit'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => resolve({ data: Buffer.concat(chunks), contentType }));
          response.on('error', reject);
          response.on('aborted', () => reject(new Error('Artwork download interrupted')));
        }
      );
      const timer = setTimeout(() => request.destroy(new Error('Artwork download timed out')), remaining);
      request.on('close', () => clearTimeout(timer));
      request.on('error', reject);
      request.end();
    });
    if (outcome.redirect) {
      next = outcome.redirect;
      continue;
    }
    const data = outcome.data!;
    const contentType = outcome.contentType!;
    if (json) JSON.parse(data.toString('utf8'));
    else await validateStoredMedia(data, contentType);
    return { data, contentType, sourceUrl: url.href };
  }
  throw new Error('Artwork has too many redirects');
};

export const downloadFiveToolsArtwork = (input: string, trustedBase?: string) =>
  downloadFiveToolsResource(input, trustedBase);
