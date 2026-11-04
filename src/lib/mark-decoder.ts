/**
 * Public decoder for the Trithemian provenance mark (#8150, slice 1).
 *
 * PRIOR ART: scripts/audit/decode-provenance.ts — the operator CLI. It wraps
 * the same verifyExport call but also resolves extraction refs against private
 * Mongo state (suspected_pool_fingerprints), which must never be exposed to the
 * public. src/lib/provenance.ts verifyExport — wrapped here, unchanged.
 *
 * What this adds: the shape the public decoder page shows. Two rules:
 * - An UNVERIFIED mark's message is never echoed. Anyone who knows the public
 *   scheme can build a mark with any text in it; showing that text on our own
 *   page, under our name, would let them put words in our mouth. We say a mark
 *   is present and that it does not verify, nothing more.
 * - The edition id is the first 8 characters of a book id, and 7,946 of those
 *   prefixes are shared by more than one live book (measured 2026-11-04: bulk
 *   imports minted in the same second). So the id alone names a book only when
 *   the prefix is unique; the readable colophon, when present, carries the full
 *   book address and wins.
 */
import { verifyExport } from './provenance';
import { ACCOUNT_REF_PATTERN } from './trace-ref';

/** Largest paste we decode. A whole long page is ~20K characters; this is generous. */
export const MAX_DECODE_CHARS = 200_000;

const ZERO_WIDTH = /[\u200B-\u200F\u2060-\u2064\uFEFF]/g;

export type DecodeStatus = 'none' | 'authentic' | 'unverified' | 'unconfigured';

export interface DecodeResult {
  status: DecodeStatus;
  /** Count of zero-width characters in the paste (any kind, ours or not). */
  zeroWidth: number;
  /** The 8-character edition code, only when the mark verifies. */
  editionId: string | null;
  /** The readable colophon, only when the mark verifies. */
  message: string | null;
  /** Full book id named by the colophon's book address, when there is one. */
  bookId: string | null;
  /**
   * The colophon carries a traced-copy account ref (#8150 slice 8). The ref is
   * opaque (a keyed HMAC): the public page says one exists, never whose it is.
   */
  signedReference: boolean;
}

type Verifier = (text: string) => { editionId: string | null; message: string | null; authentic: boolean } | null;

/** Pull the book id or slug out of a colophon's `sourcelibrary.org/book/<x>` address. */
export function bookIdFromColophon(message: string | null): string | null {
  if (!message) return null;
  const m = message.match(/sourcelibrary\.org\/book\/([0-9A-Za-z][0-9A-Za-z-]{0,200})/);
  return m ? m[1] : null;
}

export function decodePastedText(text: string, verify: Verifier = verifyExport): DecodeResult {
  const zeroWidth = (text.match(ZERO_WIDTH) || []).length;
  const empty = { zeroWidth, editionId: null, message: null, bookId: null, signedReference: false };
  if (zeroWidth === 0) return { status: 'none', ...empty };
  const res = verify(text);
  if (!res) return { status: 'unconfigured', ...empty };
  if (!res.editionId) return { status: 'none', ...empty };
  if (!res.authentic) return { status: 'unverified', ...empty };
  const message = res.message || null;
  return {
    status: 'authentic', zeroWidth, editionId: res.editionId, message, bookId: bookIdFromColophon(message),
    signedReference: message ? ACCOUNT_REF_PATTERN.test(message) : false,
  };
}
