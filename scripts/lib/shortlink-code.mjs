// PRIOR ART: src/lib/shortlinks.ts decodeShortlink — the canonical decoder, TypeScript, for the app. Scripts cannot
// import it; this is its ObjectId half for scripts/maintenance/split-swap.mjs (#7605), pinned to it by
// tests/unit/split-stage-7605.test.ts. UUID codes (`u…`) are not decoded here: no split book has a UUID id.
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A /q/ code → { bookId, pageNumber }, or null when it is not a valid ObjectId shortlink. */
export function decodeShortlinkCode(code) {
  if (typeof code !== 'string' || !code || code.startsWith('u')) return null;
  let num = 0n;
  for (const ch of code) {
    const i = BASE62.indexOf(ch);
    if (i < 0) return null;
    num = num * 62n + BigInt(i);
  }
  if (num >> 112n) return null; // more than 14 bytes: not a book + page code
  const bytes = [];
  for (let i = 0; i < 14; i++) { bytes.unshift(Number(num & 0xffn)); num >>= 8n; }
  const bookId = bytes.slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  const pageNumber = (bytes[12] << 8) | bytes[13];
  return pageNumber >= 1 ? { bookId, pageNumber } : null;
}

/**
 * A `u…` /q/ code (the UUID scheme of #3940: `u` + 25 base62 chars for 16 bytes of id + 2 bytes of page)
 * → { bookId (dashed UUID), pageNumber }, or null. Kept apart from decodeShortlinkCode, whose callers rely on it
 * refusing UUID codes.
 */
export function decodeUuidShortlinkCode(code) {
  if (typeof code !== 'string' || code.length !== 26 || !code.startsWith('u')) return null;
  let num = 0n;
  for (const ch of code.slice(1)) {
    const i = BASE62.indexOf(ch);
    if (i < 0) return null;
    num = num * 62n + BigInt(i);
  }
  if (num >> 144n) return null;
  const bytes = [];
  for (let i = 0; i < 18; i++) { bytes.unshift(Number(num & 0xffn)); num >>= 8n; }
  const hex = bytes.slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  const bookId = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  const pageNumber = (bytes[16] << 8) | bytes[17];
  return pageNumber >= 1 ? { bookId, pageNumber } : null;
}
