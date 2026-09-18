#!/usr/bin/env node
/**
 * PRIOR ART: `scripts/maintenance/mark-stale-translations.mjs` is the standing
 * sweep (daily, incremental) — it decides stale/fresh but never INVENTS a
 * source hash. This is the one-time pass that gives the 5.4M existing
 * translations a hash where one can honestly be derived, and flags the rest.
 * Rule in `scripts/lib/translation-source.mjs`; measured numbers in #4927.
 *
 * Backfill `translation.source_hash` (#4927) — honestly.
 *
 * Every translation written before this shipped was made from SOME text, but
 * only two facts survive: the page's current `ocr.data` and two timestamps.
 * So each translated page takes exactly one of three paths:
 *
 *   A  `ocr.updated_at <= translation.updated_at + 60s` (or the OCR is
 *      undated, i.e. predates date-stamping and the translation): the current
 *      transcription IS what the translation was made from → write its hash.
 *   B  the transcription is newer than that: the text the translation was
 *      made from is GONE. Do NOT invent a hash; write `translation_stale`
 *      ({ reason: 'ocr_newer' }) so the consumer re-translates it.
 *   C  the translation carries no date at all: cannot say → `translation_stale`
 *      ({ reason: 'undated' }) — missing counts as old, never as fresh.
 *
 * Pages that already carry a hash are left alone; placeholders (blank /
 * recitation / safety markers) are skipped — they are not translations.
 * `pages.updated_at` is never bumped (embed-gemini --incremental keys on it).
 *
 * Resumable: progress is checkpointed to `--checkpoint=<file>` (last `_id`)
 * every batch; re-run to continue. Writes are throttled for Atlas M30.
 * Default is DRY RUN and reports the three paths' counts. Run on Hetzner
 * under nohup — a full pass reads ~5.4M documents' ocr.data.
 *
 *   node --env-file=.env.production.local scripts/migration/backfill-translation-source-hash.mjs --limit=20000
 *   nohup node --env-file=.env.production.local scripts/migration/backfill-translation-source-hash.mjs --apply \
 *     --checkpoint=/root/backfill-source-hash.ckpt > /var/log/sourcelibrary/backfill-source-hash.log 2>&1 &
 */
import fs from 'node:fs';
import { MongoClient, ObjectId } from 'mongodb';
import {
  translationStaleness, translationSourceFields, staleMarker, STALE_FIELD, STALE_REASONS,
  REAL_TRANSLATION_FILTER, STALE_MARGIN_MS,
} from '../lib/translation-source.mjs';

const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=') ?? d;
const APPLY = process.argv.includes('--apply');
const LIMIT = Number(ARG('--limit', '0'));
const ONLY_BOOK = ARG('--book', null);
const CKPT = ARG('--checkpoint', null);
const BATCH = 1000;
const WRITE_CHUNK = 250;
const WRITE_DELAY_MS = 60;

const PROJECTION = {
  id: 1, book_id: 1,
  'ocr.data': 1, 'ocr.updated_at': 1,
  'translation.data': 1, 'translation.source': 1, 'translation.source_hash': 1,
  'translation.updated_at': 1, 'translation.edited_at': 1,
  [STALE_FIELD]: 1,
};

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const client = new MongoClient(uri, { socketTimeoutMS: 600_000 });
await client.connect();
const pages = client.db('bookstore').collection('pages');

let lastId = null;
if (CKPT && fs.existsSync(CKPT)) {
  const v = fs.readFileSync(CKPT, 'utf8').trim();
  if (v) { lastId = new ObjectId(v); console.log(`resuming after ${v}`); }
}

const base = { ...(ONLY_BOOK ? { book_id: ONLY_BOOK } : {}), ...REAL_TRANSLATION_FILTER };
const now = new Date();
const counts = { scanned: 0, alreadyHashed: 0, pathA_hash: 0, pathB_stale: 0, pathC_undated: 0, alreadyMarked: 0, modifiedA: 0, modifiedBC: 0 };
let opsA = [], opsBC = [];

async function flush() {
  for (const [ops, key] of [[opsA, 'modifiedA'], [opsBC, 'modifiedBC']]) {
    for (let i = 0; i < ops.length; i += WRITE_CHUNK) {
      const chunk = ops.slice(i, i + WRITE_CHUNK);
      const r = await pages.bulkWrite(chunk, { ordered: false });
      counts[key] += r.modifiedCount ?? 0;
      await new Promise((res) => setTimeout(res, WRITE_DELAY_MS));
    }
  }
  opsA = []; opsBC = [];
}

console.log(`backfill-translation-source-hash ${APPLY ? 'APPLY' : 'DRY RUN'}${ONLY_BOOK ? ` book=${ONLY_BOOK}` : ''}${LIMIT ? ` limit=${LIMIT}` : ''}`);
const t0 = Date.now();
for (;;) {
  const filter = lastId ? { ...base, _id: { $gt: lastId } } : base;
  const docs = await pages.find(filter, { projection: PROJECTION }).sort({ _id: 1 }).limit(BATCH).toArray();
  if (docs.length === 0) break;
  lastId = docs[docs.length - 1]._id;
  for (const p of docs) {
    counts.scanned++;
    const tr = p.translation;
    if (typeof tr?.source_hash === 'string' && tr.source_hash) { counts.alreadyHashed++; continue; }
    const v = translationStaleness(p, { marginMs: STALE_MARGIN_MS });
    if (!v.stale) {
      // Path A: the current transcription is the one the translation was made from.
      counts.pathA_hash++;
      if (APPLY) opsA.push({ updateOne: {
        // Guard on the same ocr.updated_at we judged, so a re-OCR racing this
        // pass cannot receive a hash that claims the OLD translation is fresh.
        filter: { _id: p._id, 'ocr.updated_at': p.ocr?.updated_at ?? { $exists: false } },
        update: { $set: translationSourceFields(p.ocr?.data, p.ocr?.updated_at, { dotted: true }), $unset: { [STALE_FIELD]: '' } },
      } });
      continue;
    }
    // Paths B / C: no honest hash exists. Flag, never invent.
    if (v.reason === STALE_REASONS.UNDATED) counts.pathC_undated++; else counts.pathB_stale++;
    if (p[STALE_FIELD]?.reason) { counts.alreadyMarked++; continue; }
    if (APPLY) opsBC.push({ updateOne: { filter: { _id: p._id }, update: { $set: { [STALE_FIELD]: staleMarker(v.reason, { now }) } } } });
  }
  if (opsA.length + opsBC.length >= WRITE_CHUNK * 4) await flush();
  if (CKPT && APPLY) fs.writeFileSync(CKPT, String(lastId));
  if (counts.scanned % 50_000 < BATCH) {
    const s = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`  ${counts.scanned} scanned in ${s}s — A ${counts.pathA_hash} / B ${counts.pathB_stale} / C ${counts.pathC_undated} / hashed ${counts.alreadyHashed}`);
  }
  if (LIMIT && counts.scanned >= LIMIT) break;
}
await flush();
if (CKPT && APPLY) fs.writeFileSync(CKPT, String(lastId));
console.log(JSON.stringify({ ...counts, apply: APPLY, elapsed_s: Math.round((Date.now() - t0) / 1000) }, null, 2));
if (APPLY) {
  const [hashed, stale] = await Promise.all([
    pages.countDocuments({ 'translation.source_hash': { $exists: true } }),
    pages.countDocuments({ [`${STALE_FIELD}.reason`]: { $exists: true } }),
  ]);
  console.log(`after: translation.source_hash on ${hashed} pages; translation_stale on ${stale} pages`);
}
await client.close();
