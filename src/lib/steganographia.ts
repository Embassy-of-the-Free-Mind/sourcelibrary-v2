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
 * Marks are deterministically placed using a secret key, so verifying
 * provenance requires only the key and the text in question.
 *
 * Method: Zero-width Unicode characters encode bits of the edition
 * identifier at positions derived from HMAC(key, page_content). Each
 * mark is placed after sentence-ending punctuation, where whitespace
 * variation is invisible to the reader.
 */

import crypto from 'crypto';

// Zero-width characters used to encode bits
// These are invisible in all renderers but preserved by copy-paste
const ZWC = {
  ZERO: '\u200B',   // Zero-width space  → bit 0
  ONE: '\u200C',    // Zero-width non-joiner → bit 1
  MARKER: '\u200D', // Zero-width joiner → marks start of an imprimatur char
  FILLER: '\uFEFF', // Zero-width no-break space → padding/noise
};

// All zero-width chars we use (for cleaning/reading)
const ALL_ZWC = new Set(Object.values(ZWC));

/**
 * Encode an edition ID (up to 12 alphanumeric chars) into a sequence
 * of zero-width characters.
 */
function encodeId(editionId: string): string {
  const bytes = Buffer.from(editionId, 'utf-8');
  let encoded = '';
  for (const byte of bytes) {
    encoded += ZWC.MARKER; // start delimiter
    for (let bit = 7; bit >= 0; bit--) {
      encoded += (byte >> bit) & 1 ? ZWC.ONE : ZWC.ZERO;
    }
  }
  return encoded;
}

/**
 * Decode zero-width characters back to an edition ID.
 */
function decodeId(zwcString: string): string | null {
  // Extract only our ZWC characters
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

  if (bytes.length === 0) return null;
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
 * The edition identifier is encoded as invisible zero-width characters
 * and distributed across multiple insertion points for redundancy,
 * so even a partial excerpt may carry a recoverable provenance mark.
 *
 * @param text - The translation text to mark
 * @param editionId - Edition identifier (max 12 alphanumeric chars), akin to a printer's colophon
 * @param secretKey - Secret key for deterministic placement
 * @returns Marked text (visually identical to input)
 */
export function imprimatur(
  text: string,
  editionId: string,
  secretKey: string
): string {
  if (editionId.length > 12) {
    throw new Error('Edition ID must be 12 characters or fewer');
  }

  // Remove any existing provenance marks first
  const cleanText = clean(text);

  const encoded = encodeId(editionId);
  const points = findInsertionPoints(cleanText);

  if (points.length === 0) return cleanText;

  // Place the FULL encoded ID at multiple insertion points for redundancy.
  // Even a small excerpt containing one complete mark recovers the full ID.
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
 * Read the provenance mark from text, recovering the edition identifier.
 *
 * @param text - Text that may carry a provenance mark
 * @returns The edition identifier if found, null otherwise
 */
export function readProvenance(text: string): string | null {
  // Extract all ZWC characters in order
  const zwcChars = [...text].filter(c => ALL_ZWC.has(c));
  if (zwcChars.length === 0) return null;

  const zwcString = zwcChars.join('');

  // Split on FILLER to get redundant copies
  const copies = zwcString.split(ZWC.FILLER).filter(s => s.length > 0);

  // Try to decode each copy, take the most common result
  const candidates: Record<string, number> = {};
  for (const copy of copies) {
    const decoded = decodeId(copy);
    if (decoded && decoded.length > 0 && decoded.length <= 12) {
      candidates[decoded] = (candidates[decoded] || 0) + 1;
    }
  }

  if (Object.keys(candidates).length === 0) return null;

  // Return the most frequently decoded ID
  return Object.entries(candidates)
    .sort((a, b) => b[1] - a[1])[0][0];
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
