/**
 * Steganographia — Trithemian Provenance Marks
 *
 * In the tradition of Johannes Trithemius's Steganographia (1499) and
 * the Aldine Press anchor-and-dolphin device, this module embeds an
 * invisible imprimatur — a provenance mark — into translated editions.
 *
 * Just as early printers placed colophons and devices in their books
 * to assert the origin and integrity of an edition, this system weaves
 * a short edition identifier into the text itself using zero-width
 * Unicode characters. The mark is a statement of provenance: "this
 * edition was produced by Source Library."
 *
 * The mark is *authenticated*: the payload carries a truncated keyed MAC
 * (HMAC-SHA256 over the version + edition id, truncated) so that a mark
 * can be cryptographically attributed to Source Library — not merely
 * detected. Without PROVENANCE_SECRET_KEY a third party can read or strip
 * the zero-width characters, but cannot *forge* a mark that verifies as
 * genuine for an arbitrary edition id. Placement is additionally derived
 * from HMAC(key, page_content), so the same text + key always produce
 * the same positions.
 *
 * Method: Zero-width Unicode characters encode the bytes of a framed,
 * MAC-tagged payload at positions derived from HMAC(key, page_content).
 * Each mark is placed after sentence-ending punctuation, where whitespace
 * variation is invisible to the reader.
 *
 * Threat model & limits: the MAC binds the *edition id*, not the
 * surrounding prose, so a genuine mark survives excerpting (a small quote
 * still verifies) — by design, since the goal is robust provenance, not
 * tamper-evidence of the text. This means a genuine mark can in principle
 * be lifted from one of our texts and replanted onto another; what it
 * prevents is fabricating a "made by Source Library" mark for an edition
 * we never exported, without access to the secret key. Zero-width marks
 * are inherently removable; this is attribution, not DRM.
 */

import crypto from 'crypto';

// Zero-width characters used to encode bits
// These are invisible in all renderers but preserved by copy-paste
const ZWC = {
  ZERO: '​',   // Zero-width space  → bit 0
  ONE: '‌',    // Zero-width non-joiner → bit 1
  MARKER: '‍', // Zero-width joiner → marks start of a payload byte
  FILLER: '﻿', // Zero-width no-break space → separates redundant copies
};

// All zero-width chars we use (for cleaning/reading)
const ALL_ZWC = new Set(Object.values(ZWC));

// Authenticated-payload framing.
// Layout (bytes): [VERSION][idLen][id bytes …][MAC bytes …]
//   MAC = HMAC-SHA256(key, [VERSION, idLen, …id bytes])[:MAC_BYTES]
const MARK_VERSION = 0x01;
const MAC_BYTES = 6;           // 48-bit tag — blind-forgery odds ~1 in 2.8e14
const MAX_ID_BYTES = 12;       // edition id ceiling (matches imprimatur contract)

/**
 * Encode a byte buffer into a sequence of zero-width characters,
 * MSB-first, with a MARKER delimiting the start of each byte.
 */
function encodeBytes(buf: Buffer): string {
  let encoded = '';
  for (const byte of buf) {
    encoded += ZWC.MARKER; // start delimiter
    for (let bit = 7; bit >= 0; bit--) {
      encoded += (byte >> bit) & 1 ? ZWC.ONE : ZWC.ZERO;
    }
  }
  return encoded;
}

/**
 * Decode a run of zero-width characters back into the byte sequence
 * that produced it. Inverse of {@link encodeBytes}.
 */
function decodeBytes(zwcString: string): number[] {
  const chars = [...zwcString].filter(c => ALL_ZWC.has(c));

  const bytes: number[] = [];
  let i = 0;
  while (i < chars.length) {
    // Find next MARKER
    if (chars[i] !== ZWC.MARKER) { i++; continue; }
    i++; // skip marker

    // Read 8 bits
    if (i + 8 > chars.length) break;
    let byte = 0;
    for (let bit = 7; bit >= 0; bit--) {
      if (chars[i] === ZWC.ONE) byte |= (1 << bit);
      i++;
    }
    bytes.push(byte);
  }

  return bytes;
}

/**
 * Compute the truncated keyed MAC that authenticates an edition id.
 * Bound to the version + id bytes (not the surrounding text) so the
 * mark survives excerpting while remaining unforgeable without the key.
 */
function computeMac(versionByte: number, idBytes: Buffer, secretKey: string): Buffer {
  const header = Buffer.concat([Buffer.from([versionByte]), idBytes]);
  return crypto.createHmac('sha256', secretKey).update(header).digest().subarray(0, MAC_BYTES);
}

/**
 * Build the framed, MAC-tagged payload buffer for an edition id.
 */
function buildPayload(editionId: string, secretKey: string): Buffer {
  const idBytes = Buffer.from(editionId, 'utf-8');
  const mac = computeMac(MARK_VERSION, idBytes, secretKey);
  return Buffer.concat([Buffer.from([MARK_VERSION, idBytes.length]), idBytes, mac]);
}

/**
 * Parse a decoded byte run as a framed v1 payload, returning the
 * edition id and whether its MAC verifies under the given key.
 * Returns null if the bytes are not a well-formed v1 payload.
 */
function parsePayload(
  bytes: number[],
  secretKey: string | null
): { editionId: string; authentic: boolean } | null {
  // [VERSION][idLen][id…][mac(MAC_BYTES)]
  if (bytes.length < 2 + MAC_BYTES) return null;
  if (bytes[0] !== MARK_VERSION) return null;

  const idLen = bytes[1];
  if (idLen < 1 || idLen > MAX_ID_BYTES) return null;
  if (bytes.length < 2 + idLen + MAC_BYTES) return null;

  const idBytes = Buffer.from(bytes.slice(2, 2 + idLen));
  const macBytes = Buffer.from(bytes.slice(2 + idLen, 2 + idLen + MAC_BYTES));

  const editionId = idBytes.toString('utf-8');
  // Reject ids that did not round-trip cleanly (e.g. invalid UTF-8 → U+FFFD)
  if (editionId.includes('�') || Buffer.from(editionId, 'utf-8').length !== idLen) {
    return null;
  }

  let authentic = false;
  if (secretKey) {
    const expected = computeMac(MARK_VERSION, idBytes, secretKey);
    authentic = expected.length === macBytes.length &&
      crypto.timingSafeEqual(expected, macBytes);
  }

  return { editionId, authentic };
}

/**
 * Legacy reader: the pre-authentication format encoded the raw edition-id
 * bytes with no version byte, length, or MAC. Recover the id on a
 * best-effort basis so old exports remain attributable (presence only —
 * never authenticated). Restricted to printable ASCII so it does not
 * misread a v1 payload's binary header as text.
 */
function parseLegacyId(bytes: number[]): string | null {
  if (bytes.length === 0 || bytes.length > MAX_ID_BYTES) return null;
  if (!bytes.every(b => b >= 0x20 && b <= 0x7e)) return null;
  return Buffer.from(bytes).toString('utf-8');
}

/**
 * Find insertion points in text — after sentence-ending punctuation
 * followed by whitespace. These are natural "joints" where invisible
 * characters won't disrupt rendering.
 */
function findInsertionPoints(text: string): number[] {
  const points: number[] = [];
  // Match: period/question/exclamation followed by space(s) or newline
  const pattern = /[.!?]["'»)]*\s/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    // Insert position: right after the punctuation, before the space
    points.push(match.index + match[0].length - 1);
  }
  return points;
}

/**
 * Deterministically select which insertion points to use, based on
 * HMAC of the text content with the secret key. This means the same
 * text + key always produces the same positions.
 */
function selectPositions(
  points: number[],
  count: number,
  text: string,
  secretKey: string
): number[] {
  if (points.length === 0) return [];

  const hmac = crypto.createHmac('sha256', secretKey).update(text).digest();
  const selected: number[] = [];
  const used = new Set<number>();

  for (let i = 0; i < Math.min(count, points.length); i++) {
    // Use successive pairs of HMAC bytes to pick positions
    // Rehash if we need more than 16 positions
    const hashSource = i < 16 ? hmac :
      crypto.createHmac('sha256', secretKey).update(hmac).update(Buffer.from([i])).digest();
    const byteIdx = (i % 16) * 2;
    const idx = ((hashSource[byteIdx] << 8) | hashSource[byteIdx + 1]) % points.length;

    // Avoid collisions
    let finalIdx = idx;
    while (used.has(finalIdx)) {
      finalIdx = (finalIdx + 1) % points.length;
    }
    used.add(finalIdx);
    selected.push(points[finalIdx]);
  }

  return selected.sort((a, b) => a - b);
}

/**
 * Apply an imprimatur — a provenance mark — to the given text.
 *
 * The edition identifier is wrapped in a framed, MAC-authenticated
 * payload and distributed across multiple insertion points for
 * redundancy, so even a partial excerpt may carry a recoverable —
 * and verifiable — provenance mark.
 *
 * @param text - The translation text to mark
 * @param editionId - Edition identifier (max 12 bytes), akin to a printer's colophon
 * @param secretKey - Secret key for the MAC and deterministic placement
 * @returns Marked text (visually identical to input)
 */
export function imprimatur(
  text: string,
  editionId: string,
  secretKey: string
): string {
  if (editionId.length === 0) {
    throw new Error('Edition ID must not be empty');
  }
  if (Buffer.from(editionId, 'utf-8').length > MAX_ID_BYTES) {
    throw new Error('Edition ID must be 12 bytes or fewer');
  }
  if (!secretKey) {
    throw new Error('A secret key is required to apply a provenance mark');
  }

  // Remove any existing provenance marks first
  const cleanText = clean(text);

  const encoded = encodeBytes(buildPayload(editionId, secretKey));
  const points = findInsertionPoints(cleanText);

  if (points.length === 0) return cleanText;

  // Place the FULL encoded payload at multiple insertion points for
  // redundancy. Even a small excerpt containing one complete mark
  // recovers (and verifies) the full edition id.
  const maxMarks = Math.min(points.length, 5); // up to 5 redundant copies
  const positions = selectPositions(points, maxMarks, cleanText, secretKey);
  const chunks = positions.map(() => encoded + ZWC.FILLER);

  // Insert chunks at selected positions (work backwards to preserve indices)
  let result = cleanText;
  for (let i = positions.length - 1; i >= 0; i--) {
    const pos = positions[i];
    const chunk = chunks[i] || '';
    result = result.slice(0, pos) + chunk + result.slice(pos);
  }

  return result;
}

/**
 * Verify a provenance mark and recover the edition identifier.
 *
 * This is the authenticated read path: with the secret key it confirms
 * the mark was produced by Source Library (the MAC checks out) rather
 * than merely present. Prefer this over {@link readProvenance} wherever
 * the answer is trusted (admin tooling, attribution claims).
 *
 * @param text - Text that may carry a provenance mark
 * @param secretKey - The PROVENANCE_SECRET_KEY used when marking
 * @returns The recovered edition id (if any) and whether its MAC verified.
 *          `authentic: false` with a non-null `editionId` means a mark was
 *          present but did not authenticate (forged, legacy, or wrong key).
 */
export function verifyProvenance(
  text: string,
  secretKey: string
): { editionId: string | null; authentic: boolean } {
  const zwcChars = [...text].filter(c => ALL_ZWC.has(c));
  if (zwcChars.length === 0) return { editionId: null, authentic: false };

  const copies = zwcChars.join('').split(ZWC.FILLER).filter(s => s.length > 0);

  const authenticVotes: Record<string, number> = {};
  const presentVotes: Record<string, number> = {};

  for (const copy of copies) {
    const bytes = decodeBytes(copy);
    const parsed = parsePayload(bytes, secretKey);
    if (parsed) {
      presentVotes[parsed.editionId] = (presentVotes[parsed.editionId] || 0) + 1;
      if (parsed.authentic) {
        authenticVotes[parsed.editionId] = (authenticVotes[parsed.editionId] || 0) + 1;
      }
      continue;
    }
    const legacy = parseLegacyId(bytes);
    if (legacy) presentVotes[legacy] = (presentVotes[legacy] || 0) + 1;
  }

  const top = (votes: Record<string, number>): string | null => {
    const entries = Object.entries(votes);
    if (entries.length === 0) return null;
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  };

  const authenticId = top(authenticVotes);
  if (authenticId) return { editionId: authenticId, authentic: true };
  return { editionId: top(presentVotes), authentic: false };
}

/**
 * Read the provenance mark from text, recovering the edition identifier
 * on a presence-only basis.
 *
 * SECURITY: this does NOT authenticate the mark — it returns whatever
 * edition id is encoded, even if forged or corrupt. Use
 * {@link verifyProvenance} when the result is trusted (attribution,
 * takedowns). This remains for display/diagnostics and for reading
 * legacy marks where no key is available.
 *
 * @param text - Text that may carry a provenance mark
 * @returns The edition identifier if found, null otherwise
 */
export function readProvenance(text: string): string | null {
  const zwcChars = [...text].filter(c => ALL_ZWC.has(c));
  if (zwcChars.length === 0) return null;

  const copies = zwcChars.join('').split(ZWC.FILLER).filter(s => s.length > 0);

  const candidates: Record<string, number> = {};
  for (const copy of copies) {
    const bytes = decodeBytes(copy);
    // Try the framed v1 format first (key-less parse → authenticity unknown),
    // then fall back to the legacy raw-bytes format.
    const id = parsePayload(bytes, null)?.editionId ?? parseLegacyId(bytes);
    if (id) candidates[id] = (candidates[id] || 0) + 1;
  }

  if (Object.keys(candidates).length === 0) return null;

  return Object.entries(candidates).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Remove all provenance mark characters from text, returning clean content.
 */
export function clean(text: string): string {
  return [...text].filter(c => !ALL_ZWC.has(c)).join('');
}

/**
 * Check if text carries a provenance mark.
 */
export function hasProvenance(text: string): boolean {
  return [...text].some(c => ALL_ZWC.has(c));
}

/**
 * Generate a short, unique edition identifier for use as an imprimatur.
 */
export function generateImprimaturId(): string {
  return crypto.randomBytes(4).toString('hex'); // 8 hex chars
}

/**
 * SHA-256 content hash for provenance verification.
 * Returns the full 64-character hex digest (not truncated).
 */
export function contentHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}
