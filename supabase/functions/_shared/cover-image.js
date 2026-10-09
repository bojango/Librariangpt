export const MAX_COVER_BYTES = 5 * 1024 * 1024;

export function validateCoverBytes(bytes, mime) {
  if (!bytes.length || bytes.length > MAX_COVER_BYTES) throw new Error('Cover must be no larger than 5 MB.');
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const webp = new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  if (!({ 'image/jpeg': jpeg, 'image/png': png, 'image/webp': webp })[mime]) throw new Error('The cover is not a supported JPEG, PNG or WebP image.');
}
