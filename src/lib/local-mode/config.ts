/**
 * Local mode — the desk reader that runs on a laptop with no signal.
 *
 * PRIOR ART: src/lib/mongodb.ts (getReadDb) — why it does not fit: every
 * production read path goes to Atlas over the network, which is precisely what
 * local mode cannot do. Nothing here touches Mongo, Supabase or R2; the whole
 * module reads three directories on disk that the mirror scripts in
 * `~/sourcelibrary-atlas/scripts/local-corpus/` write.
 *
 * Local mode is OFF unless `SL_LOCAL=1`. When it is off, every export here is
 * inert and the `/local` route 404s, so this module can never change what
 * sourcelibrary.org serves.
 *
 * The three stores, all optional:
 *
 *   ~/sl-corpus/catalog.jsonl      one JSON book record per line (113,512 today)
 *   ~/sl-corpus/books/<id>.jsonl   one JSON page per line: {p, ocr, tr, lang, type}
 *   ~/sl-scans/<id>/manifest.json  the reader's page list + <nnnn>.jpg beside it
 *
 * A book with no page-text file does not open. A book with no mirrored scan opens
 * text-only — that is the normal case today, not a degraded one (see the
 * "an empty pane doesn't exist" rule in the three-rooms vision doc).
 */
import path from 'node:path';
import os from 'node:os';

/**
 * True only when the process was started with SL_LOCAL=1.
 *
 * Bracket notation, deliberately: Next inlines `process.env.FOO` at build time,
 * which would bake this session's answer into the bundle. `SKIP_DB_AT_BUILD` in
 * src/lib/mongodb.ts uses the same trick for the same reason.
 */
export function isLocalMode(): boolean {
  return process.env['SL_LOCAL'] === '1';
}

/** Where the text mirror lives. Override with SL_CORPUS for a second copy. */
export function corpusDir(): string {
  return process.env['SL_CORPUS'] || path.join(os.homedir(), 'sl-corpus');
}

/**
 * Where the page-image mirror lives. Same env var `mirror-scans.mjs` writes to,
 * so pointing one at a different disk moves both.
 */
export function scansDir(): string {
  return process.env['SL_SCANS'] || path.join(os.homedir(), 'sl-scans');
}

/**
 * Book ids and slugs both appear in the URL, and both are attacker-shaped in the
 * sense that they are interpolated into a filesystem path. Anything that is not a
 * plain id/slug is rejected before it reaches `path.join` — `..` included.
 */
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9_-]{0,200}$/;

export function isSafeRef(ref: string): boolean {
  return SAFE_REF.test(ref);
}
