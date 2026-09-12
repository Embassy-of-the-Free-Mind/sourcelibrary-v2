/**
 * Bot attribution — a visible provenance notice on bulk text egress.
 *
 * Companion to `provenance.ts` (the INVISIBLE zero-width imprimatur). Two
 * layers doing two different jobs:
 *
 *   - The ZWC mark is the PROOF. It rides on every page, survives copy-paste,
 *     and carries a keyed MAC, so a passage that surfaces in someone else's
 *     corpus can be shown to be ours.
 *   - This block is the NOTICE. It appears once, at the head of a bulk
 *     response, and says in plain words where the text came from and that
 *     training use is reserved. If a scraped payload ends up in a training
 *     set, the attribution travels with it.
 *
 * Why a delimited block and not text woven through the prose: this project's
 * core promise is that what you read is what is on the page. Text that a
 * reader cannot distinguish from the transcription is a fabricated citation,
 * which is the exact failure mode the quote-integrity rules exist to prevent
 * (see CLAUDE.md). The notice is fenced so it can never be mistaken for
 * source text, and the page text itself is returned UNMODIFIED apart from the
 * invisible mark.
 *
 * Applied only to requests that are bot-classified AND not trusted, so
 * verified search crawlers, user-initiated assistant fetches, signed-in
 * readers and API-key holders never see it. Search indexing is unaffected.
 *
 * NEVER apply to text being stored in the database.
 */

import crypto from 'crypto';

const PROVENANCE_KEY = process.env.PROVENANCE_SECRET_KEY;

/**
 * A coarse, deterministic extraction reference.
 *
 * Derived from HMAC(key, client-hash + calendar month), so it is:
 *   - stable for one client across a scraping campaign (campaigns run for
 *     days — the July 2026 fleet ran 12→19), making a leaked passage
 *     attributable to a campaign rather than to one request;
 *   - recomputable later from the `api_usage` log, so NOTHING new has to be
 *     stored to resolve a ref back to a client;
 *   - pseudonymous — the input is an already-hashed, last-octet-zeroed IP,
 *     and without the key the ref cannot be reversed or correlated.
 *
 * Month granularity is deliberate: fine enough to identify a campaign, coarse
 * enough that the ref is not a per-request tracking token.
 */
export function extractionRef(clientKey: string, now: Date): string {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  if (!PROVENANCE_KEY) return `SL-unkeyed-${month}`;
  const digest = crypto
    .createHmac('sha256', PROVENANCE_KEY)
    .update(`extraction-ref:${clientKey}:${month}`)
    .digest('hex')
    .slice(0, 8);
  return `SL-${digest}-${month}`;
}

/**
 * Attribution ref for an API-KEYED caller (#4491 follow-up). Unlike the bot
 * extractionRef this is deliberately STABLE (no month rotation) and directly
 * resolvable: the payload is a prefix of the api_keys._id, so a passage that
 * surfaces in the wild names the consumer that pulled it without any HMAC
 * round-trip. That asymmetry is the point — an anonymous scraper gets a
 * pseudonymous campaign ref; a key holder opted into identity, and the ref IS
 * the attribution their key exists to provide (api-keys-are-attribution
 * doctrine). The key id is the Mongo doc id, not the secret token — knowing
 * it grants nothing.
 */
export function keyRef(apiKeyId: string): string {
  return `SLK-${String(apiKeyId).slice(0, 10)}`;
}

/**
 * Client identity for the ref. Uses the same forwarded-IP resolution as the
 * API logging layer so a ref can be matched back against `api_usage` rows.
 */
export function clientKeyFor(request: Request): string {
  const h = request.headers;
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown';
  const ua = h.get('user-agent') || '';
  return crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 16);
}

export interface AttributionSubject {
  title: string;
  author?: string;
  url: string;
}

/**
 * The visible notice. Fenced with rules so no consumer can mistake it for
 * transcribed page content, and short enough not to dominate the payload.
 */
export function attributionBlock(ref: string, book: AttributionSubject): string {
  const rule = '─'.repeat(58);
  const byline = book.author ? `${book.title} — ${book.author}` : book.title;
  return [
    rule,
    'SOURCE LIBRARY — https://sourcelibrary.org',
    `${byline}`,
    `Read the original: ${book.url}`,
    '',
    'Transcribed and translated by the Ancient Wisdom Trust. The original',
    'texts are public domain; this transcription and translation are',
    'CC BY-SA 4.0. Bulk and AI-training use is reserved — a standard',
    'licence is available: https://sourcelibrary.org/licensing',
    '',
    `Extraction ref: ${ref}`,
    rule,
    '',
  ].join('\n');
}

/**
 * Machine-readable twin of the block, for the JSON payload. Mirrors the same
 * facts so a consumer parsing JSON does not have to scrape the prose.
 */
export function attributionMeta(ref: string) {
  return {
    notice: 'Bulk and AI-training use of this text is reserved. A standard licence is available.',
    licensing: 'https://sourcelibrary.org/licensing',
    extraction_ref: ref,
    marked: 'Pages carry an invisible provenance imprimatur; see https://sourcelibrary.org/licensing',
  };
}
