#!/usr/bin/env node
/**
 * PRIOR ART: scripts/import/ia-ocr-ingest.mjs (the free lane itself; its default mode takes the first
 * --limit books by priority, so books it cannot calibrate come first every night and the lane stalls
 * on them; this picks which books it sees). scripts/audit/gpu-queue-5660.mjs counts work owed to a lane
 * and selects nothing. None of the scheduled workers in infrastructure/hetzner-crontab calls the ingester.
 *
 * ia-ocr-nightly — the nightly run of the free Internet Archive text lane (#4763, Derek 2026-10-24:
 * "do it", on running the lane nightly so new English imports get filled).
 *
 * Each night it picks English Internet Archive books that still have empty pages, carry no
 * hidden_reason, have at least 5 model-read reference pages (the ingester's own calibration
 * minimum), and were not tried in the last 30 days. It writes their ids to a file and runs
 * `ia-ocr-ingest.mjs --ids <file> --apply`, so every gate of the ingester applies unchanged:
 * agreement, script loss, offset, the #5124 page cohort and the digits gate. The book's
 * visibility never changes. The Archive is free, so no model is called and nothing is billed.
 *
 * State: --state <file> (JSON { book_id: ISO date of last try }). Without it, a book is retried nightly.
 *
 * Usage (dry run by default):
 *   node scripts/import/ia-ocr-nightly.mjs --state /root/eng-ocr/nightly-state.json [--max 300] [--apply]
 *   Options: --language English  --max 300  --retry-days 30  --cache <dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../lib/mongo.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const LANGUAGE = arg('--language', 'English');
const MAX = +arg('--max', 300);
const RETRY_DAYS = +arg('--retry-days', 30);
const STATE = arg('--state', null);
const CACHE = arg('--cache', null);
const MIN_REF_PAGES = 5; // ia-ocr-ingest.mjs MIN_REF_PAGES default; that run re-checks it exactly

const state = STATE && fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const cutoff = Date.now() - RETRY_DAYS * 86400e3;
const ids = [];
let considered = 0, recent = 0, fewRefs = 0;

await withMongo(async (db) => {
  const B = db.collection('books'), P = db.collection('pages');
  const cur = B.find({
    language: new RegExp(`^${LANGUAGE}$`, 'i'), pages_count: { $gt: 0 },
    $expr: { $lt: [{ $ifNull: ['$pages_ocr', 0] }, '$pages_count'] },
    hidden_reason: { $in: [null, ''] },
    $or: [{ ia_identifier: { $exists: true, $ne: null } }, { 'image_source.provider': 'internet_archive' }],
  }, { projection: { id: 1 } }).sort({ processing_priority: -1, visible: -1 });
  for await (const b of cur) {
    if (ids.length >= MAX) break;
    considered++;
    const bid = b.id || String(b._id);
    if (state[bid] && Date.parse(state[bid]) > cutoff) { recent++; continue; }
    // Reference = model OCR (not the Archive's own text), as the ingester counts it.
    const refs = await P.countDocuments({ book_id: bid, 'ocr.data': { $type: 'string', $ne: '' }, 'ocr.source': { $ne: 'ia_djvu' } }, { limit: MIN_REF_PAGES });
    if (refs < MIN_REF_PAGES) { fewRefs++; continue; }
    ids.push(bid);
  }
});

console.log(JSON.stringify({ at: new Date().toISOString(), language: LANGUAGE, considered, skipped_recent: recent, skipped_few_refs: fewRefs, selected: ids.length, apply: APPLY }));
if (!ids.length) process.exit(0);

const idsFile = path.join(STATE ? path.dirname(STATE) : '/tmp', `ia-ocr-nightly-${new Date().toISOString().slice(0, 10)}.ids`);
fs.writeFileSync(idsFile, ids.join('\n') + '\n');
const ingest = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ia-ocr-ingest.mjs');
const r = spawnSync(process.execPath, [ingest, '--ids', idsFile, ...(CACHE ? ['--cache', CACHE] : []), ...(APPLY ? ['--apply'] : [])], { stdio: 'inherit', env: process.env });
// Every selected book counts as tried, whatever its verdict: a REJECT or no_xml will not change by tomorrow.
if (APPLY && STATE && r.status === 0) {
  const now = new Date().toISOString();
  for (const id of ids) state[id] = now;
  fs.writeFileSync(STATE, JSON.stringify(state));
}
process.exit(r.status ?? 1);
