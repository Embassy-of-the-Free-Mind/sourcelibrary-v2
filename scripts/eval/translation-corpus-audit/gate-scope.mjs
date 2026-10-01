#!/usr/bin/env node
// PRIOR ART: ./draw-chained.mjs writes draw-log.json `eligibility` — frame books the lane wrote in the window that it
// "should not have" (held before the last write, English, processing_priority >= 90). That list is a CANDIDATE list:
// it cannot tell a run enrolled after its book was held (a violation) from one already in flight when the hold landed
// (expected), and the speed-test-A gate amendments (ops handoff 2026-09-30-chained-quality-sample.md, Result) carve out
// named runs. The judge routine has no Mongo, so this classifies the candidates on Hetzner at draw time and writes
// <dir>/scope.json, which gate-row.mjs reads as --eligibility-abort.
//
//   node scripts/eval/translation-corpus-audit/gate-scope.mjs --dir <window dir>      (needs MONGODB_URI)
//
// ABORT  English book; a run ENROLLED after its book's hold; a chained write AFTER its run was parked.
// WARN   a run in flight when the hold landed (wrote before parking); processing_priority >= 90 — Phase 4 sends
//        reader requests realtime, but the hourly gap-fill enroller (--enrol-auto) does not filter on priority and
//        many books carry a standing priority score (e.g. 95, scored 2026-03-14) that is not a reader request.
//        Classed WARN by the replacement gate session 2026-10-01; sourcelibrary-c0 may tighten it.
// EXEMPT runs named in the handoff: the Tibetan pilot runs (hold tibetan-retranslation-awaits-derek) and the #5309
//        repair's re-enrolment; holds for stranded-text-5309 (released, #5427).
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const DIR = args.dir;
if (!DIR) { console.error('--dir required'); process.exit(1); }
const EXEMPT_RUNS = new Set(['tbc_muooguum_8hp9t7', 'tbc_muoogvk2_gjmah4', 'tbc_muoornju_je64tc']);
const EXEMPT_HOLD = /stranded-text-5309/;

const log = JSON.parse(fs.readFileSync(path.join(DIR, 'draw-log.json'), 'utf8'));
const since = new Date(log.frame.since), until = new Date(log.frame.until);
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const out = { at: new Date().toISOString(), window: `${since.toISOString()}/${until.toISOString()}`, abort: [], warn: [], exempt: [] };

for (const e of log.eligibility || []) {
  const book = await db.collection('books').findOne({ id: e.book_id }, { projection: { language: 1, processing_priority: 1, 'pipeline_auto.hold': 1 } });
  const hold = book?.pipeline_auto?.hold;
  const runs = await db.collection('translate_batch_runs').find({ book_id: e.book_id, mode: 'chained' }, { projection: { id: 1, created_at: 1, parked_at: 1, rounds: 1 } }).toArray();
  const wrote = (r, from, to) => (r.rounds || []).some((x) => x.written > 0 && x.collected_at && new Date(x.collected_at) >= from && new Date(x.collected_at) < to);
  const active = runs.filter((r) => wrote(r, since, until));
  const base = { book_id: e.book_id, title: e.title, pages: e.pages };
  for (const why of e.why) {
    if (/^English/.test(why)) { out.abort.push({ ...base, why }); continue; }
    if (/^processing_priority/.test(why)) { out.warn.push({ ...base, why: `${why} (standing score or gap-fill enrolment; Phase 4 floor does not cover --enrol-auto)`, runs: active.map((r) => r.id) }); continue; }
    if (/^held/.test(why)) {
      if (hold?.reason && EXEMPT_HOLD.test(hold.reason)) { out.exempt.push({ ...base, why, hold: hold.reason }); continue; }
      const heldAt = hold?.held_at ? new Date(hold.held_at) : null;
      for (const r of active) {
        if (EXEMPT_RUNS.has(r.id)) { out.exempt.push({ ...base, why, run: r.id }); continue; }
        if (heldAt && new Date(r.created_at) > heldAt) out.abort.push({ ...base, why: `run ${r.id} enrolled ${new Date(r.created_at).toISOString()} after hold ${heldAt.toISOString()}` });
        else if (r.parked_at && wrote(r, new Date(r.parked_at), until)) out.abort.push({ ...base, why: `run ${r.id} wrote after it was parked at ${new Date(r.parked_at).toISOString()}` });
        else out.warn.push({ ...base, why: `run ${r.id} in flight when the hold landed (${heldAt?.toISOString()}); ${r.parked_at ? `parked ${new Date(r.parked_at).toISOString()}, ` : ''}no write after parking`, run: r.id });
      }
      if (!active.length) out.warn.push({ ...base, why: `${why}; no chained round collected in the window (write from another lane?)` });
    }
  }
}
await client.close();
out.abort_count = out.abort.length;
fs.writeFileSync(path.join(DIR, 'scope.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`scope: ${out.abort.length} abort, ${out.warn.length} warn, ${out.exempt.length} exempt → ${path.join(DIR, 'scope.json')}`);
