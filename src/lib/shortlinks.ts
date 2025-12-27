/**
 * Shortlink encoding/decoding for Source Library
 *
 * Encodes a book ID (24 hex chars) + page number into a ~19 char base62 string.
 * Fully reversible, no database lookup needed.
 */

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Encode bytes to base62 string
 */
function bytesToBase62(bytes: Uint8Array): string {
  // Convert bytes to a BigInt
  let num = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    num = (num << BigInt(8)) | BigInt(bytes[i]);
  }

  if (num === BigInt(0)) return '0';

  let result = '';
  const base = BigInt(62);
  while (num > BigInt(0)) {
    result = BASE62_CHARS[Number(num % base)] + result;
    num = num / base;
  }

  return result;
}

/**
 * Decode base62 string to bytes
 */
function base62ToBytes(str: string, length: number): Uint8Array {
  let num = BigInt(0);
  const base = BigInt(62);

  for (let i = 0; i < str.length; i++) {
    const index = BASE62_CHARS.indexOf(str[i]);
    if (index === -1) throw new Error(`Invalid base62 character: ${str[i]}`);
    num = num * base + BigInt(index);
  }

  // Convert BigInt to bytes
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(num & BigInt(0xFF));
    num = num >> BigInt(8);
  }

  return bytes;
}

/**
 * Encode a book ID and page number into a shortlink code
 *
 * @param bookId - 24 character hex string (MongoDB ObjectId)
 * @param pageNumber - Page number (1-65535)
 * @returns Base62 encoded string (~19 chars)
 */
export function encodeShortlink(bookId: string, pageNumber: number): string {
  if (!/^[a-f0-9]{24}$/i.test(bookId)) {
    throw new Error('Invalid book ID: must be 24 hex characters');
  }
  if (pageNumber < 1 || pageNumber > 65535) {
    throw new Error('Invalid page number: must be 1-65535');
  }

  // Convert hex book ID to bytes (12 bytes)
  const bookBytes = new Uint8Array(12);
  for (let i = 0; i < 12; i++) {
    bookBytes[i] = parseInt(bookId.slice(i * 2, i * 2 + 2), 16);
  }

  // Convert page number to 2 bytes (big endian)
  const pageBytes = new Uint8Array(2);
  pageBytes[0] = (pageNumber >> 8) & 0xFF;
  pageBytes[1] = pageNumber & 0xFF;

  // Combine: 12 bytes book + 2 bytes page = 14 bytes
  const combined = new Uint8Array(14);
  combined.set(bookBytes);
  combined.set(pageBytes, 12);

  return bytesToBase62(combined);
}

/**
 * Decode a shortlink code into book ID and page number
 *
 * @param code - Base62 encoded shortlink
 * @returns Object with bookId and pageNumber
 */
export function decodeShortlink(code: string): { bookId: string; pageNumber: number } {
  const bytes = base62ToBytes(code, 14);

  // Extract book ID (first 12 bytes as hex)
  let bookId = '';
  for (let i = 0; i < 12; i++) {
    bookId += bytes[i].toString(16).padStart(2, '0');
  }

  // Extract page number (last 2 bytes, big endian)
  const pageNumber = (bytes[12] << 8) | bytes[13];

  if (pageNumber < 1) {
    throw new Error('Invalid shortlink: page number must be >= 1');
  }

  return { bookId, pageNumber };
}

/**
 * Generate the full short URL for a book page
 */
export function getShortUrl(bookId: string, pageNumber: number): string {
  const code = encodeShortlink(bookId, pageNumber);
  return `https://sourcelibrary.org/q/${code}`;
}
