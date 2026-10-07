// PRIOR ART: scripts/batch/realtime-ocr.mjs (the --page-ids-file parser lived inline there; moved
// here so the batch lane accepts the same file shapes) and pipeline-orchestrator.mjs
// `buildJsonlFile` (streams one book's JSONL to disk but caps by PAGE count, the #3974 defect;
// it is private to the orchestrator and returns a temp file, not chunks).
//
// ocr-targeting — how a hand-run OCR script is told WHICH pages to read, and how the batch lane
// splits a book's requests into jobs that fit (#5244). Shared by scripts/batch/realtime-ocr.mjs and
// scripts/batch/bulk-reocr-local.mjs so a list prepared for one runs unchanged on the other.

import fs from 'node:fs';

/**
 * Page ids from a JSON file. Accepts a bare array of ids, or an object carrying arrays under
 * `confirmed` / `suspected` / `pages`; array entries are either id strings or objects with
 * `page_id`. Duplicates are dropped, order is kept.
 */
export function parsePageIds(raw) {
  const collect = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x?.page_id)).filter(Boolean) : []);
  return [...new Set([...collect(raw), ...collect(raw?.confirmed), ...collect(raw?.suspected), ...collect(raw?.pages)])];
}

export function readPageIdsFile(file) {
  return parsePageIds(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** Book ids, one per line. Blank lines and `#` comments are ignored. */
export function parseBookIds(text) {
  return [...new Set(String(text).split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean))];
}

export function readBookIdsFile(file) {
  return parseBookIds(fs.readFileSync(file, 'utf8'));
}

/**
 * Split items into consecutive chunks bounded by BYTES first and item count second (#3974: a
 * page-count bound let one book of large scans exceed V8's max string length, and the chunk was
 * silently never submitted). An item larger than `maxBytes` on its own gets a chunk to itself —
 * it is the caller's job to decide whether that chunk can be sent; it is never dropped here.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => number} sizeOf  bytes the item adds to the request body
 * @param {{ maxBytes: number, maxItems: number }} caps
 * @returns {{ items: T[], bytes: number }[]}
 */
export function chunkByBytes(items, sizeOf, { maxBytes, maxItems }) {
  if (!(maxBytes > 0) || !(maxItems > 0)) throw new Error('chunkByBytes: maxBytes and maxItems must be positive');
  const chunks = [];
  let cur = { items: [], bytes: 0 };
  for (const item of items) {
    const size = sizeOf(item);
    if (cur.items.length && (cur.bytes + size > maxBytes || cur.items.length >= maxItems)) {
      chunks.push(cur);
      cur = { items: [], bytes: 0 };
    }
    cur.items.push(item);
    cur.bytes += size;
  }
  if (cur.items.length) chunks.push(cur);
  return chunks;
}
