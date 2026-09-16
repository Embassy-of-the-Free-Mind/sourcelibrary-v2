#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/repair-ia-ocr-leaf-offset.mjs (repairs CLASS A of the same
 * finding and REFUSES CLASS C — it names the books this script holds but writes nothing for them);
 * scripts/workers/lib/selective-unpause.mjs and `processing_control.paused_phases` (allow-list and
 * phase pause — neither can keep a named book out of an open lane); scripts/maintenance/
 * withhold-stale-translations.mjs (moves a PAGE's text out of the served field — the right shape
 * for a fabricated translation, the wrong one here: CLASS C text reads correctly on screen today
 * and must stay). The hold itself lives in scripts/lib/pipeline-hold.mjs.
 *
 * hold-pipeline-books — hold named books out of every pipeline lane, or release them (#4790).
 *
 * WHY. 197 Internet-Archive-filled books carry their OCR at a non-zero leaf offset AND have their
 * page images shifted the same way (#3368), so text and image agree on screen while both point at
 * the neighbouring leaf. The joint repair (images first, then the text re-pointed in the same pass)
 * will move that mapping. Anything DERIVED from the pages before then — translations, chapters,
 * index, quality score, embeddings — is built on a mapping the repair invalidates, and only the
 * translation lane self-heals (stale-translation.mjs); chapters, indexes and embeddings do not
 * (`derived-metadata-lane.md`). Holding the book keeps the derived lane off it until the repair.
 *
 * HOW IT IS CONSULTED. `pipeline_auto.status` becomes `held`, which no phase selects, and
 * `pipeline_auto.hold` records the reason, the prior status and the release condition. Status
 * writers refuse held books (orchestrator `setPipelineStatus`, and the `NOT_HELD` filter on the
 * direct writers). `scripts/audit/pipeline-hold-drift.mjs` reconciles marker and status daily.
 *
 * HOW A FUTURE RUN KNOWS THEY ARE STILL HELD. The book says so: status `held`, `pipeline_auto.hold`
 * on the document, a `pipeline_hold` row in `book_events`, and a row in `sweep_log`. The audit
 * lists them by reason and flags release candidates (an `ia_ocr_leaf_repair` event newer than
 * the hold). Nothing here depends on the joined jsonl surviving.
 *
 * Usage (dry run by default; nothing is written without --apply):
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/hold-pipeline-books.mjs --from <leaf-drift joined.jsonl>          # CLASS C, counts
 *   node scripts/maintenance/hold-pipeline-books.mjs --from <joined.jsonl> --apply
 *   node scripts/maintenance/hold-pipeline-books.mjs --ids <file> --reason <kebab> --issue N --release "<sentence>" --apply
 *   node scripts/maintenance/hold-pipeline-books.mjs --release-held --reason ia-wrong-leaf-4790 [--book <id>] [--to ocr_complete] --apply
 *   node scripts/maintenance/hold-pipeline-books.mjs --reassert [--reason <kebab>] --apply     # CLOBBERED → held again
 * `--from` implies reason `ia-wrong-leaf-4790`; `--release-held` lifts every hold with that reason
 * (or one book with --book) and restores the status each book was holding at, unless --to says
 * otherwise. Idempotent: a second run holds (or releases) 0 books.
 */
import fs from 'node:fs';
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { bucketByLeafDriftClass } from '../lib/ia-leaf-drift-class.mjs';
import { holdBook, releaseBook, HOLD_STATUS, HOLD_SWEEP } from '../lib/pipeline-hold.mjs';

const arg = (k, d) => { const eq = process.argv.find((a) => a.startsWith(`${k}=`)); if (eq) return eq.slice(k.length + 1); const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply'), RELEASE = process.argv.includes('--release-held'), REASSERT = process.argv.includes('--reassert');
const FROM = arg('--from', null), IDS = arg('--ids', null), BOOK = arg('--book', null), TO = arg('--to', null);
const ISSUE = arg('--issue', null);

const IA_WRONG_LEAF = {
  reason: 'ia-wrong-leaf-4790',
  issue: 4790,
  release: 'the #3368 image repair has landed for this book AND repair-ia-ocr-leaf-offset.mjs has re-pointed its ia_djvu text to offset 0 in the same pass (an ia_ocr_leaf_repair book_event newer than the hold)',
};

let targets = [];
let hold = null;
if (REASSERT) {
  // A writer the guards do not cover (or one deployed before them) set a status over a held book:
  // the marker is still there, the status is not. Put the status back; the marker is the truth.
  hold = { reason: arg('--reason', null) };
} else if (RELEASE) {
  hold = { reason: arg('--reason', FROM ? IA_WRONG_LEAF.reason : null) };
  if (!hold.reason) { console.error('--release-held needs --reason <kebab> (or --from, which implies ia-wrong-leaf-4790)'); process.exit(2); }
} else if (FROM) {
  const rows = fs.readFileSync(FROM, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const by = bucketByLeafDriftClass(rows);
  console.log(`classes from ${FROM}: A ${by.A.length} | B ${by.B.length} | C (hold) ${by.C.length} books / ${by.C.reduce((s, r) => s + r.written, 0)} written pages | OK ${by.OK.length}`);
  targets = by.C.map((r) => ({ book_id: r.book_id, detail: { class: 'C', offset: r.offset, cls: r.cls, written: r.written, ia_id: r.ia_id } }));
  hold = { ...IA_WRONG_LEAF, source: 'hold-pipeline-books' };
} else if (IDS) {
  const reason = arg('--reason', null), release = arg('--release', null);
  if (!reason || !release) { console.error('--ids needs --reason <kebab> and --release "<sentence>"'); process.exit(2); }
  targets = fs.readFileSync(IDS, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean).map((book_id) => ({ book_id, detail: null }));
  hold = { reason, issue: ISSUE ? +ISSUE : null, release, source: 'hold-pipeline-books' };
} else {
  console.error('one of --from <joined.jsonl> | --ids <file> | --release-held is required');
  process.exit(2);
}
if (BOOK && !RELEASE) targets = targets.filter((t) => t.book_id === BOOK);

await withMongo(async (db) => {
  const B = db.collection('books');
  if (REASSERT) {
    const q = { 'pipeline_auto.hold': { $exists: true }, 'pipeline_auto.status': { $ne: HOLD_STATUS }, ...(hold.reason ? { 'pipeline_auto.hold.reason': hold.reason } : {}), ...(BOOK ? { id: BOOK } : {}) };
    const clobbered = await B.find(q, { projection: { id: 1, title: 1, pipeline_auto: 1 } }).toArray();
    console.log(`${clobbered.length} held book(s) whose status was overwritten (${APPLY ? 'APPLY' : 'dry run'})`);
    for (const b of clobbered) {
      console.log(`  ${b.id} ${(b.title || '').slice(0, 44).padEnd(44)} status '${b.pipeline_auto.status}' with hold ${b.pipeline_auto.hold.reason}`);
      if (!APPLY) continue;
      const now = new Date();
      await B.updateOne({ id: b.id, 'pipeline_auto.hold': { $exists: true } }, { $set: { 'pipeline_auto.status': HOLD_STATUS, 'pipeline_auto.last_updated': now, updated_at: now } });
      await db.collection('book_events').insertOne({ book_id: b.id, type: 'pipeline_hold_reasserted', at: now, source: 'hold-pipeline-books', details: { reason: b.pipeline_auto.hold.reason, overwritten_status: b.pipeline_auto.status } });
      await recordSweepAction(db, { sweep: HOLD_SWEEP, book_id: b.id, action: 'reasserted', detail: { reason: b.pipeline_auto.hold.reason, overwritten_status: b.pipeline_auto.status } });
    }
    return;
  }
  if (RELEASE) {
    const q = { 'pipeline_auto.hold.reason': hold.reason, ...(BOOK ? { id: BOOK } : {}) };
    const held = await B.find(q, { projection: { id: 1, title: 1, pipeline_auto: 1 } }).toArray();
    console.log(`${held.length} book(s) held for ${hold.reason}${BOOK ? ` (book ${BOOK})` : ''} (${APPLY ? 'APPLY' : 'dry run'})`);
    const totals = { released: 0, to: {} };
    for (const b of held) {
      const r = await releaseBook(db, b.id, { to: TO, note: `released by hold-pipeline-books --release-held`, source: 'hold-pipeline-books' }, { dryRun: !APPLY });
      const to = r.to || TO || b.pipeline_auto?.hold?.held_from_status;
      totals.to[to] = (totals.to[to] || 0) + 1;
      if (r.outcome === 'released') { totals.released++; await recordSweepAction(db, { sweep: HOLD_SWEEP, book_id: b.id, action: 'released', detail: { reason: hold.reason, to } }); }
      console.log(`  ${r.outcome.padEnd(9)} ${b.id} ${(b.title || '').slice(0, 44).padEnd(44)} → ${to}`);
    }
    console.log(JSON.stringify({ ...totals, apply: APPLY }));
    return;
  }

  console.log(`${targets.length} book(s) to hold for ${hold.reason} (${APPLY ? 'APPLY' : 'dry run'})`);
  const totals = { held: 0, already_held: 0, held_other_reason: 0, not_found: 0, from: {} };
  for (const t of targets) {
    const r = await holdBook(db, t.book_id, { ...hold, detail: t.detail }, { dryRun: !APPLY });
    const key = r.outcome === 'dry_run' ? 'held' : r.outcome;
    totals[key] = (totals[key] || 0) + 1;
    if (key === 'held') totals.from[r.from || 'none'] = (totals.from[r.from || 'none'] || 0) + 1;
    if (r.outcome === 'held') await recordSweepAction(db, { sweep: HOLD_SWEEP, book_id: t.book_id, action: 'held', detail: { reason: hold.reason, from_status: r.from, ...(t.detail || {}) } });
    if (r.outcome !== 'held' && r.outcome !== 'dry_run') console.log(`  ${r.outcome} ${t.book_id}`);
  }
  const nowHeld = await B.countDocuments({ 'pipeline_auto.status': HOLD_STATUS, 'pipeline_auto.hold.reason': hold.reason });
  console.log(JSON.stringify({ ...totals, apply: APPLY, held_now_for_reason: nowHeld }));
});
