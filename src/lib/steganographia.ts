/**
 * Steganographia — Digital Printer's Marks
 *
 * Inspired by Trithemius's Steganographia (1499) and the early modern
 * practice of printers embedding deliberate marks in their editions
 * to identify unauthorized copies.
 *
 * Embeds a short edition identifier as invisible Unicode marks scattered
 * throughout a text. The marks are deterministically placed using a
 * secret key, so detection requires only the key and the suspect text.
 *
 * Method: Zero-width Unicode characters encode bits of the edition ID
 * at positions derived from HMAC(key, page_content). Each mark is placed
 * after a sentence-ending period, where whitespace variation is invisible.
 */

import crypto from 'crypto';

// Zero-width characters used to encode bits
// These are invisible in all renderers but preserved by copy-paste
const ZWC = {
  ZERO: '\u200B',   // Zero-width space  → bit 0
  ONE: '\u200C',    // Zero-width non-joiner → bit 1
  MARKER: '\u200D', // Zero-width joiner → marks start of a watermark char
  FILLER: '\uFEFF', // Zero-width no-break space → padding/noise
};

// All zero-width chars we use (for stripping/detection)
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
 * Embed an edition ID into text using invisible zero-width characters.
 *
 * The ID is split into fragments and distributed across multiple
 * insertion points, so even partial text excerpts may contain
 * recoverable fragments.
 *
 * @param text - The translation text to watermark
 * @param editionId - Short alphanumeric identifier (max 12 chars)
 * @param secretKey - Secret key for deterministic placement
 * @returns Watermarked text (visually identical to input)
 */
export function watermark(
  text: string,
  editionId: string,
  secretKey: string
): string {
  if (editionId.length > 12) {
    throw new Error('Edition ID must be 12 characters or fewer');
  }

  // Strip any existing watermarks first
  const cleanText = strip(text);

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
 * Detect and recover an edition ID from potentially watermarked text.
 *
 * @param text - Text that may contain watermark marks
 * @param secretKey - The same secret key used for embedding
 * @returns The edition ID if found, null otherwise
 */
export function detect(text: string): string | null {
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
 * Strip all watermark characters from text, returning clean content.
 */
export function strip(text: string): string {
  return [...text].filter(c => !ALL_ZWC.has(c)).join('');
}

/**
 * Check if text contains any watermark characters.
 */
export function hasWatermark(text: string): boolean {
  return [...text].some(c => ALL_ZWC.has(c));
}

/**
 * Generate a short, unique edition ID.
 */
export function generateEditionId(): string {
  return crypto.randomBytes(4).toString('hex'); // 8 hex chars
}
