import { describe, expect, it } from 'vitest';
import { extractLocationFromUrl } from './extractLocationFromUrl';

describe('asset location extraction', () => {
  it.each([
    ['https://files.tableslayer.com/map/image.png?v=2', 'map/image.png?v=2'],
    ['https://files.tableslayer.com/cdn-cgi/image/w=512,h=512/map/image.png', 'map/image.png'],
    ['/assets/map/image.png', 'map/image.png'],
    ['/assets/cdn-cgi/image/w=512,h=512/map/image.png?v=3', 'map/image.png?v=3'],
    ['http://192.168.1.50:8080/assets/map/image.png', 'map/image.png'],
    ['data:image/png;base64,abc', null]
  ])('extracts object keys from %s', (url, expected) => {
    expect(extractLocationFromUrl(url)).toBe(expected);
  });
});
