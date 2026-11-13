#!/usr/bin/env node
/**
 * READ-ONLY on the database. Builds a Gemini Batch API input file (JSONL, one line per book,
 * key = book id) for books with no summary anywhere. Writes ONLY a local file; calls no model.
 *
 *   node --env-file=.env.production.local scripts/summaries-batch/2-build-jsonl.mjs --limit=500 --out=summaries-trial.jsonl
 *     --partial            widen past the production gate: >=--min-pages OCR pages OR >=--min-share of the book
 *     --min-pages=20 --min-share=0.5 --max-chars=60000
 *
 * Default selection is the production gate (READABLE_ENOUGH_TO_ENRICH): readable English or an
 * English original. Books held, quarantined or in the realtime lane are skipped like enrich-batch-lane does.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { eligibleFilter, hasIndexSummary, bookText, batchLine, RECORD_FIELDS, MODEL, tokensOf, OUT_TOKENS_PER_BOOK, DEFAULT_MAX_CHARS, arg, flag } from './lib.mjs';
import { REALTIME_LANE_STATUSES } from '../workers/lib/enrich-batch-lane.mjs';
import { NOT_HELD } from '../lib/pipeline-hold.mjs';
import { calculateUsageCost } from '../workers/lib/supabase-usage-logger.mjs';

const limit = Number(arg('limit', 500));
const out = arg('out', `summaries-${new Date().toISOString().slice(0, 10)}.jsonl`);
const maxChars = Number(arg('max-chars', DEFAULT_MAX_CHARS));
const filter = {
  ...eligibleFilter({ partial: flag('partial'), minPages: Number(arg('min-pages', 20)), minShare: Number(arg('min-share', 0.5)) }),
  ...NOT_HELD,
  'pipeline_auto.status': { $nin: REALTIME_LANE_STATUSES },
  needs_resplit: { $in: [null, false] }, source_unrecoverable: { $in: [null, false] },
};

if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set (see README: credentials)'); process.exit(2); }
const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await client.connect();
const db = client.db('bookstore');

const cands = await db.collection('books').find(filter, { projection: RECORD_FIELDS }).sort({ pages_translated: -1 }).limit(limit * 2).toArray();
const fd = fs.openSync(out, 'w');
let n = 0, inTok = 0, skippedIndex = 0, skippedEmpty = 0, english = 0;
for (const b of cands) {
  if (n >= limit) break;
  if (await hasIndexSummary(db, b.id)) { skippedIndex++; continue; }
  const t = await bookText(db, b, maxChars);
  if (!t.text) { skippedEmpty++; continue; }
  const line = batchLine(b, t.text);
  fs.writeSync(fd, JSON.stringify(line) + '\n');
  inTok += tokensOf(JSON.stringify(line.request)); n++; if (t.english) english++;
}
fs.closeSync(fd);
const cost = calculateUsageCost(MODEL, inTok, OUT_TOKENS_PER_BOOK * n, true);
console.log(`wrote ${n} requests to ${out} (${english} from English text, ${n - english} from untranslated transcription)`);
console.log(`skipped: ${skippedIndex} already summarised in book_indexes, ${skippedEmpty} with no usable text`);
console.log(`~${inTok.toLocaleString('en-GB')} input tokens · batch estimate $${cost.toFixed(2)} on ${MODEL}. Nothing has been sent.`);
await client.close();
