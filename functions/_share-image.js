// A share image the editor chose instead of the card composed from the cover.
// The admin page hands one over already drawn to the card's 1200x630 JPEG, so
// the server only confirms that is what arrived: og:image promises those
// dimensions, and the file is stored where a composed card would be.

export const SHARE_IMAGE_WIDTH = 1200;
export const SHARE_IMAGE_HEIGHT = 630;

// The frame size from a baseline or progressive JPEG's SOF marker, or null.
export function jpegDimensions(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xFF) return null;
    const marker = bytes[offset + 1];
    // Fill bytes and markers that carry no length.
    if (marker === 0xFF) { offset += 1; continue; }
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { offset += 2; continue; }
    if (marker === 0xD9 || marker === 0xDA) return null;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;
    const isFrame = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (isFrame) {
      if (offset + 9 > bytes.length) return null;
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8]
      };
    }
    offset += 2 + length;
  }
  return null;
}

/** Why `file` cannot be stored as a chosen share image, or '' when it can. */
export async function customShareCardProblem(file, maxBytes) {
  if (!file || typeof file.arrayBuffer !== 'function' || Number(file.size || 0) <= 0) {
    return '공유 이미지 파일이 전달되지 않았습니다.';
  }
  if (Number(file.size || 0) > maxBytes) return '공유 이미지는 4MB 이하여야 합니다.';
  const size = jpegDimensions(new Uint8Array(await file.arrayBuffer()));
  if (!size) return '공유 이미지는 JPEG로 전달되어야 합니다.';
  if (size.width !== SHARE_IMAGE_WIDTH || size.height !== SHARE_IMAGE_HEIGHT) {
    return `공유 이미지는 ${SHARE_IMAGE_WIDTH}×${SHARE_IMAGE_HEIGHT}이어야 합니다 (받은 크기 ${size.width}×${size.height}).`;
  }
  return '';
}
