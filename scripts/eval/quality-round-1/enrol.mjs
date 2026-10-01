#!/usr/bin/env node
// PRIOR ART: pipeline-orchestrator.mjs Phase 0 (writes this exact `pipeline_auto` record, but only
// for books with NO pipeline_auto created in the last 14 days, or 25 oldest strays a cycle — it
// cannot take a named list of books that already carry a status); reenroll-quarantined.mjs (resets
// to ocr_complete, i.e. skips archive/OCR); hold-pipeline-books.mjs --release-held --to queued
// (only for books that are held). None enrols a named list at the start of the line.
//
// Quality round 1 (#5438) — enrol the drawn books into the production pipeline at Phase 0.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/quality-round-1/enrol.mjs [--apply]
//
// For each book in draw-2026-10-01.json: read its status, then compare-and-set it to the Phase 0
// record (`queued`), keeping the prior status in `pipeline_auto.prior_status`. The filter carries
// the status just read and NOT_HELD, so a concurrent writer or a hold wins and the book is reported
// instead of forced (a check-then-write is not a gate; the filter is). One audit_log row per write
// (`pipeline_status_changed`, the row the orchestrator writes) so per-phase wall-clock starts here.

import fs from 'fs';
import { withMongo } from '../../lib/mongo.mjs';
import { NOT_HELD } from '../../lib/pipeline-hold.mjs';

const APPLY = process.argv.includes('--apply');
const SOURCE = 'quality-round-1-2026-10';
const DRAW = JSON.parse(fs.readFileSync('scripts/eval/quality-round-1/draw-2026-10-01.json', 'utf8'));
const ENGLISH = ['english', 'eng', 'en'];

await withMongo(async (db) => {
  const B = db.collection('books');
  const out = { enrolled: [], already: [], refused: [] };
  for (const d of DRAW.books) {
    const b = await B.findOne({ id: d.id }, { projection: { id: 1, title: 1, language: 1, pipeline_auto: 1 } });
    if (!b) { out.refused.push({ id: d.id, why: 'not_found' }); continue; }
    if (b.pipeline_auto?.hold) { out.refused.push({ id: d.id, why: `held:${b.pipeline_auto.hold.reason}` }); continue; }
    const from = b.pipeline_auto?.status ?? null;
    if (b.pipeline_auto?.source === SOURCE) { out.already.push({ id: d.id, status: from }); continue; }
    if (!APPLY) { out.enrolled.push({ id: d.id, from, dry_run: true }); continue; }
    const now = new Date();
    const lang = (b.language || '').toLowerCase();
    const r = await B.updateOne(
      { id: d.id, ...NOT_HELD, 'pipeline_auto.status': from === null ? { $exists: false } : from },
      { $set: {
        'pipeline_auto.status': 'queued',
        'pipeline_auto.source': SOURCE,
        'pipeline_auto.queued_at': now,
        'pipeline_auto.last_updated': now,
        'pipeline_auto.retry_count': 0,
        'pipeline_auto.likely_first_translation': !!lang && !ENGLISH.includes(lang),
        'pipeline_auto.prior_status': from,
        'pipeline_auto.enrolled_by': `${SOURCE} (#5438)`,
        updated_at: now,
      } },
    );
    if (r.modifiedCount !== 1) { out.refused.push({ id: d.id, why: `status_moved_from_${from}` }); continue; }
    await db.collection('audit_log').insertOne({ action: 'pipeline_status_changed', book_id: d.id, book_title: b.title, metadata: { from: from || 'none', to: 'queued', source: SOURCE, issue: 5438 }, timestamp: now });
    out.enrolled.push({ id: d.id, from });
  }
  const tally = {};
  for (const e of out.enrolled) tally[e.from] = (tally[e.from] || 0) + 1;
  console.log(JSON.stringify({ apply: APPLY, enrolled: out.enrolled.length, from: tally, already: out.already.length, refused: out.refused }, null, 1));
});
