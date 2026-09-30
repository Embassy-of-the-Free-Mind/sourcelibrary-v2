#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/withheld-translation-drift.mjs (reconciles a stored withhold against
 * the predicate that produced it — the shape this follows; it audits page translations, not the
 * book-level hold, and shares no query). scripts/audit/pipeline-status-truth-*.mjs — none;
 * `statusOutputViolation` in the orchestrator checks a status against its OUTPUT, not against a
 * hold marker.
 *
 * Reconciles the pipeline HOLD (scripts/lib/pipeline-hold.mjs, #4790) against reality.
 *
 * The hold is two things that must agree — `pipeline_auto.status === 'held'` (what every worker
 * selects on) and `pipeline_auto.hold` (why, since when, and what releases it). They can drift in
 * three ways, and each is a different bug:
 *
 *   CLOBBERED   the marker is present but the status is not `held`. A writer this repo does not
 *               guard set the status directly; the book is back in a lane while still held on
 *               paper. Must be 0 — this is the failure the hold exists to prevent.
 *   ORPHANED    status `held` with no marker. Nothing can release it (release reads the marker),
 *               and nothing says why it is there. Must be 0.
 *   LEAKED      a held book whose pages gained a TRANSLATION after `held_at`, or whose status
 *               changed after it (audit_log `pipeline_status_changed` newer than the hold). The
 *               derived lane ran on a held book. Must be 0.
 *   OPEN_CHAINED a held book with an OPEN chained translation run (translate_batch_runs, mode
 *               'chained', phase not terminal). The chained lane re-reads the hold each round and
 *               parks (#5424), so an open run on a held book means that check was bypassed or the
 *               lane's ticker is not running; either way rounds may still go out. Must be 0.
 *   RELEASABLE  informational: a held book whose release condition looks met — for reason
 *               `ia-wrong-leaf-4790`, an `ia_ocr_leaf_repair` book_event newer than the hold.
 *               Lift it with hold-pipeline-books.mjs --release-held.
 *
 * Exit 0 = clean, 1 = drift found, 2 = could not measure (UNKNOWN is not PASS).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/pipeline-hold-drift.mjs
 *   … --json    machine-readable summary on stdout
 */
import { MongoClient } from 'mongodb';
import { HOLD_STATUS } from '../lib/pipeline-hold.mjs';
import { MODE as CHAINED_MODE, TERMINAL_PHASES as CHAINED_TERMINAL } from '../lib/translate-batch-chained.mjs';
import { RUNS_COLLECTION } from '../lib/translate-batch-seam.mjs';
const JSON_OUT = process.argv.includes('--json');
const log = (...a) => { if (!JSON_OUT) console.log(...a); };
let mongo;
try {
  mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
} catch (e) {
  console.error(`UNKNOWN: cannot reach Mongo — ${e.message}`);
  process.exit(2);
}
const db = mongo.db('bookstore');
const B = db.collection('books'), P = db.collection('pages');
const proj = { id: 1, title: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, pages_translated: 1 };

try {
  const marked = await B.find({ 'pipeline_auto.hold': { $exists: true } }, { projection: proj }).toArray();
  const statusHeld = await B.find({ 'pipeline_auto.status': HOLD_STATUS }, { projection: proj }).toArray();
  const byReason = {};
  for (const b of marked) { const r = b.pipeline_auto.hold.reason; byReason[r] = (byReason[r] || 0) + 1; }
  const clobbered = marked.filter((b) => b.pipeline_auto.status !== HOLD_STATUS);
  const markedIds = new Set(marked.map((b) => b.id));
  const orphaned = statusHeld.filter((b) => !markedIds.has(b.id));

  // LEAKED: pages translated after the hold, or a status change recorded after it.
  const leaked = [];
  const releasable = [];
  for (const b of marked) {
    const h = b.pipeline_auto.hold; const since = h.held_at instanceof Date ? h.held_at : new Date(h.held_at);
    const translatedAfter = await P.countDocuments({ book_id: b.id, 'translation.updated_at': { $gt: since } });
    const statusAfter = await db.collection('audit_log').countDocuments({ book_id: b.id, action: 'pipeline_status_changed', timestamp: { $gt: since }, 'metadata.to': { $ne: HOLD_STATUS } });
    if (translatedAfter || statusAfter) leaked.push({ id: b.id, title: (b.title || '').slice(0, 44), translated_after: translatedAfter, status_changes_after: statusAfter });
    if (h.reason === 'ia-wrong-leaf-4790') {
      const repaired = await db.collection('book_events').countDocuments({ book_id: b.id, type: 'ia_ocr_leaf_repair', at: { $gt: since } });
      if (repaired) releasable.push({ id: b.id, title: (b.title || '').slice(0, 44) });
    }
  }

  // OPEN_CHAINED: a chained run still open on a held book (#5424).
  const openChained = await db.collection(RUNS_COLLECTION)
    .find({ mode: CHAINED_MODE, phase: { $nin: CHAINED_TERMINAL }, book_id: { $in: [...markedIds] } }, { projection: { id: 1, book_id: 1, phase: 1 } })
    .toArray();
  const titleOf = new Map(marked.map((b) => [b.id, (b.title || '').slice(0, 44)]));

  const summary = { held: marked.length, by_reason: byReason, clobbered: clobbered.length, orphaned: orphaned.length, leaked: leaked.length, open_chained: openChained.length, releasable: releasable.length };
  log(`pipeline holds: ${marked.length} book(s) — ${Object.entries(byReason).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}`);
  for (const b of clobbered) log(`  CLOBBERED ${b.id} ${(b.title || '').slice(0, 44)} — status '${b.pipeline_auto.status}' with hold ${b.pipeline_auto.hold.reason}`);
  for (const b of orphaned) log(`  ORPHANED  ${b.id} ${(b.title || '').slice(0, 44)} — status held, no marker`);
  for (const l of leaked) log(`  LEAKED    ${l.id} ${l.title} — ${l.translated_after} page(s) translated after hold, ${l.status_changes_after} status change(s) after hold`);
  for (const r of openChained) log(`  OPEN_CHAINED ${r.book_id} ${titleOf.get(r.book_id)} — chained run ${r.id} is ${r.phase}; park it (phase 'parked') and find why the per-round hold check did not`);
  for (const r of releasable) log(`  RELEASABLE ${r.id} ${r.title} — leaf repair recorded since the hold; lift with hold-pipeline-books.mjs --release-held --book ${r.id}`);
  const drift = clobbered.length + orphaned.length + leaked.length + openChained.length;
  log(drift ? `DRIFT: ${drift} fault(s)` : 'clean');
  if (JSON_OUT) console.log(JSON.stringify({ ...summary, clobbered_ids: clobbered.map((b) => b.id), orphaned_ids: orphaned.map((b) => b.id), leaked, open_chained: openChained.map((r) => ({ run: r.id, book_id: r.book_id, phase: r.phase })), releasable }));
  await mongo.close();
  process.exit(drift ? 1 : 0);
} catch (e) {
  console.error(`UNKNOWN: ${e.message}`);
  await mongo.close().catch(() => {});
  process.exit(2);
}
