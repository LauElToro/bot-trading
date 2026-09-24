import { describe, expect, it } from 'vitest';
import { imageContentType } from '../src/server/blob-store.js';

describe('imageContentType', () => {
  it('normalizes a declared image type', () => {
    expect(imageContentType('image/jpg; charset=binary', Buffer.from('x'))).toBe('image/jpeg');
    expect(imageContentType('image/png', Buffer.from('x'))).toBe('image/png');
  });

  it('sniffs JPEG bytes when the store omits an image type', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    expect(imageContentType('application/octet-stream', jpeg)).toBe('image/jpeg');
  });

  it('rejects a payload that is not an image', () => {
    expect(imageContentType('text/html', Buffer.from('<html>'))).toBe('application/octet-stream');
  });
});
