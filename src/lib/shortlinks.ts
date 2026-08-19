/**
 * Shortlink encoding/decoding for Source Library
 *
 * Two stateless schemes, both fully reversible with no database lookup:
 *
 *  - ObjectId books: 12 bytes of id + 2 bytes of page -> up to 19 base62 chars.
 *    This is the original scheme and every already-published shortlink uses it,
 *    so its output must never change.
 *  - UUID books: 16 bytes of id + 2 bytes of page -> exactly 25 base62 chars
 *    (zero-padded), prefixed with `u` (issue #3940). Before this, UUID-keyed
 *    books got no /q/ link at all and could only be cited by the long
 *    /book/<uuid>/page/<pageid> form — including some of the most complete
 *    translations in the corpus.
 *
 * The two are told apart by shape, not by guessing: a UUID code is always
 * exactly 26 chars, and a 14-byte ObjectId code can never reach 26 (2^112 <
 * 62^19). The zero padding is what makes that width fixed — don't drop it, or a
 * UUID whose leading bytes are small would encode short and land in the
 * ObjectId branch on decode.
 */

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Marker + fixed body width for the 18-byte (UUID) scheme. */
const UUID_PREFIX = 'u';
const UUID_CODE_LENGTH = 25;

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Pack a hex id (no separators) plus a 2-byte page number into bytes. */
function packIdAndPage(hex: string, pageNumber: number): Uint8Array {
  const idLength = hex.length / 2;
  const combined = new Uint8Array(idLength + 2);
  for (let i = 0; i < idLength; i++) {
    combined[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  combined[idLength] = (pageNumber >> 8) & 0xFF;
  combined[idLength + 1] = pageNumber & 0xFF;
  return combined;
}

/** Read the first `length` bytes back out as lowercase hex. */
function bytesToHex(bytes: Uint8Array, length: number): string {
  let hex = '';
  for (let i = 0; i < length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Encode a book ID and page number into a shortlink code
 *
 * @param bookId - 24-char hex ObjectId, or a dashed UUID
 * @param pageNumber - Page number (1-65535)
 * @returns Base62 encoded string (~19 chars for ObjectIds, `u` + 25 for UUIDs)
 */
export function encodeShortlink(bookId: string, pageNumber: number): string {
  const isObjectId = OBJECT_ID_RE.test(bookId);
  const isUuid = UUID_RE.test(bookId);
  if (!isObjectId && !isUuid) {
    throw new Error('Invalid book ID: must be 24 hex characters or a UUID');
  }
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 65535) {
    throw new Error('Invalid page number: must be 1-65535');
  }

  if (isUuid) {
    // 16 bytes of UUID + 2 bytes of page = 18 bytes, padded to a fixed width so
    // the decoder can recognise the scheme by length alone.
    const combined = packIdAndPage(bookId.replace(/-/g, '').toLowerCase(), pageNumber);
    const body = bytesToBase62(combined).padStart(UUID_CODE_LENGTH, '0');
    return `${UUID_PREFIX}${body}`;
  }

  // 12 bytes of ObjectId + 2 bytes of page = 14 bytes.
  return bytesToBase62(packIdAndPage(bookId.toLowerCase(), pageNumber));
}

/** True for codes produced by the 18-byte UUID scheme. */
function isUuidCode(code: string): boolean {
  return code.length === UUID_PREFIX.length + UUID_CODE_LENGTH && code.startsWith(UUID_PREFIX);
}

/**
 * Decode a shortlink code into book ID and page number
 *
 * @param code - Base62 encoded shortlink
 * @returns Object with bookId (ObjectId hex or dashed UUID) and pageNumber
 */
export function decodeShortlink(code: string): { bookId: string; pageNumber: number } {
  if (isUuidCode(code)) {
    const bytes = base62ToBytes(code.slice(UUID_PREFIX.length), 18);
    const hex = bytesToHex(bytes, 16);
    const bookId = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-');
    const pageNumber = (bytes[16] << 8) | bytes[17];
    if (pageNumber < 1) {
      throw new Error('Invalid shortlink: page number must be >= 1');
    }
    return { bookId, pageNumber };
  }

  const bytes = base62ToBytes(code, 14);

  // Extract book ID (first 12 bytes as hex)
  const bookId = bytesToHex(bytes, 12);

  // Extract page number (last 2 bytes, big endian)
  const pageNumber = (bytes[12] << 8) | bytes[13];

  if (pageNumber < 1) {
    throw new Error('Invalid shortlink: page number must be >= 1');
  }

  return { bookId, pageNumber };
}

/**
 * Generate the full short URL for a book page
 * Falls back to the long URL only for ID formats neither scheme can encode
 *
 * @param bookId - Book ID (24-char ObjectId or UUID)
 * @param pageNumber - Page number for shortlink encoding
 * @param pageId - Optional page ID for fallback URL
 * @param baseUrl - Optional base URL (e.g. "https://bph.sourcelibrary.org") used for tenant subdomains.
 *                  Defaults to https://sourcelibrary.org so existing API consumers are unchanged.
 */
export function getShortUrl(bookId: string, pageNumber: number, pageId?: string, baseUrl?: string): string {
  const base = (baseUrl || 'https://sourcelibrary.org').replace(/\/+$/, '');
  // Both ObjectIds and UUIDs encode statelessly (#3940); the page number still
  // has to fit the 2 bytes both schemes reserve for it.
  if (
    (OBJECT_ID_RE.test(bookId) || UUID_RE.test(bookId)) &&
    Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 65535
  ) {
    const code = encodeShortlink(bookId, pageNumber);
    return `${base}/q/${code}`;
  }
  // Fallback to the regular URL for anything else (other ID formats, or a page
  // number outside the encodable range).
  if (pageId) {
    return `${base}/book/${bookId}/page/${pageId}`;
  }
  // Last resort: link to book page (user can navigate to specific page)
  return `${base}/book/${bookId}#page-${pageNumber}`;
}

/**
 * Build a tenant-safe base URL from a NextRequest's host header.
 * Used by the quote API so citations rendered on bph.sourcelibrary.org link
 * back to bph.sourcelibrary.org rather than the main site.
 */
export function getRequestBaseUrl(headers: Headers): string {
  const host = headers.get('x-forwarded-host') || headers.get('host') || '';
  if (!host || /[^a-z0-9.\-:]/i.test(host)) {
    return 'https://sourcelibrary.org';
  }
  const proto = headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}
