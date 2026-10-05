#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/drebbel-later-5811.mjs and drebbel-oven-5811.mjs (branches
 * job/drebbel-later-5811, job/drebbel-oven-5811, never merged) — the same priority lever and
 * status readout, but their id lists are hard-coded and hold none of this job's books, and neither
 * records a rights hold. hold-pipeline-books.mjs and set-scope.mjs are used as-is for hold/release
 * and the envelope.
 *
 * drebbel-witnesses-5811 — one-off job helper for #5811 (Beeckman and the contemporaries).
 *
 *   --status    read-only: per-book status, archived/OCR/translated counts, visibility
 *   --rights    Beeckman, Journal (de Waard 1939–53), 4 vols: set hidden_reason 'rights' (dry run unless
 *               --apply). Vols 2–4 were hidden only as 'launch_curation' and vol 1 had no reason at
 *               all, so finalize's auto-unhide guard (hidden_reason absent) or a curation sweep could
 *               publish an edition in copyright in NL until 2035. Visibility is not touched.
 *   --tag       $addToSet collections 'drebbel' on held books with a verified Drebbel passage
 *   --priority  processing_priority 85 on the released books (Phase 4 takes the global top 60 before
 *               confining to the envelope; see drebbel-oven-5811)
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/drebbel-witnesses-5811.mjs --status
 */
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'drebbel-witnesses-5811';
const BEECKMAN = ['69b17be8938cbe91c8720783', '69b185f0c4be2cdd0edc4893', '69b185f7c4be2cdd0edc4a8a', '69b185fdc4be2cdd0edc4c71'];
// Held books whose Drebbel passage was found in this job (scan page → printed page):
const TAG = {
  '69b6ae73dc00a90e322b11c7': 'Grotius, Poemata (1670) p.279 (printed 256): "In organum motus perpetui, quod est penes maximum Britanniarum regem"',
  '6a0a24020eca358f15e84edc': 'Schwenter, Deliciae (1636) pp.291-292 (printed 263-264), Part V Aufgabe XIII: "Cornelii Drebels eines Niderländers" optical transformations',
  '69aebe60c0472fef6455a8f3': 'Wilkins, Mathematicall Magick (1648) p.176 (printed 148): "that musicall instrument invented by Cornelius Dreble"; p.207 (printed 179) the submarine',
};
export const RELEASED = [
  '6ac3ade2864e04424c043050', // Tymme, Dialogue Philosophicall 1612
  '6ac3ade5864e04424c0430a4', // Rubens, Correspondance III (1900)
  '6a0a24020eca358f15e84edc', // Schwenter, Deliciae 1636
  '69b6ae73dc00a90e322b11c7', // Grotius, Poemata 1670 — OCR done, then held before translation (cap); see HELD
  '69aebe60c0472fef6455a8f3', // Wilkins, Mathematicall Magick 1648
];
const HELD = [
  '6ac3adea864e04424c043491', // Kepler/Hansch, Epistolae 1718 — held at import, awaits Derek (spend)
  '6ac3ade7864e04424c0432a5', // Rubens, Correspondance V (1907) — held after OCR reached the Drebbel letter (pp.166-172), before translation, to stay under the $5 cap
];

await withMongo(async (db) => {
  const B = db.collection('books');
  if (process.argv.includes('--status')) {
    const ids = [...RELEASED, ...HELD, ...BEECKMAN];
    for (const b of await B.find({ id: { $in: ids } }).project({ id: 1, title: 1, slug: 1, pages_count: 1, visible: 1, hidden_reason: 1, processing_priority: 1, 'pipeline_auto.status': 1, language: 1 }).toArray()) {
      const [arch, ocr, tr] = await Promise.all([
        db.collection('pages').countDocuments({ book_id: b.id, archived_photo: { $exists: true, $ne: null } }),
        db.collection('pages').countDocuments({ book_id: b.id, 'ocr.data': { $exists: true, $ne: '' } }),
        db.collection('pages').countDocuments({ book_id: b.id, 'translation.data': { $exists: true, $ne: '' } }),
      ]);
      console.log(`${b.id} ${String(b.pipeline_auto?.status).padEnd(16)} p${b.processing_priority ?? '-'} ${b.visible ? 'VISIBLE' : 'hidden '} ${b.hidden_reason || ''} arch ${arch}/${b.pages_count} ocr ${ocr} tr ${tr} ${b.language} ${(b.title || '').slice(0, 45)} /book/${b.slug}`);
    }
  }
  if (process.argv.includes('--rights')) {
    const reason = 'de Waard edition (1939–53): de Waard d. 1964, in copyright in NL until 2035; keep hidden (#5811, job drebbel-witnesses-5811)';
    for (const b of await B.find({ id: { $in: BEECKMAN } }).project({ id: 1, hidden: 1, visible: 1, hidden_reason: 1 }).toArray()) {
      console.log(`${b.id} hidden=${b.hidden} visible=${b.visible} hidden_reason ${b.hidden_reason ?? '(none)'} → rights ${APPLY ? '' : '(dry run)'}`);
      if (!APPLY || b.hidden_reason === 'rights') continue;
      await B.updateOne({ id: b.id }, { $set: {
        hidden_reason: 'rights', updated_at: new Date(),
        'field_provenance.hidden_reason': { source: 'human-brief', basis: reason, previous_value: b.hidden_reason ?? null, script: 'drebbel-witnesses-5811.mjs', issue: 5811, date: new Date() },
      } });
      await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'hidden_reason_rights', detail: { before: b.hidden_reason ?? null, after: 'rights', reason } });
    }
  }
  if (process.argv.includes('--tag')) {
    for (const [id, passage] of Object.entries(TAG)) {
      const b = await B.findOne({ id }, { projection: { collections: 1 } });
      const has = (b.collections || []).includes('drebbel');
      console.log(`${id} ${has ? 'already in drebbel' : APPLY ? 'TAG drebbel' : 'would tag drebbel'} — ${passage}`);
      if (!APPLY || has) continue;
      await B.updateOne({ id }, { $addToSet: { collections: 'drebbel' }, $set: { updated_at: new Date() } });
      await recordSweepAction(db, { sweep: SWEEP, book_id: id, action: 'collection_add', detail: { collection: 'drebbel', passage } });
    }
  }
  if (process.argv.includes('--priority')) {
    const before = await B.find({ id: { $in: RELEASED } }).project({ id: 1, processing_priority: 1 }).toArray();
    console.log(`${APPLY ? 'SET' : 'would set'} processing_priority 85 on ${before.length} books; before:`, JSON.stringify(before.map((b) => [b.id, b.processing_priority ?? null])));
    if (APPLY) {
      await B.updateMany({ id: { $in: RELEASED } }, { $set: { processing_priority: 85, updated_at: new Date() } });
      for (const b of before) await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'processing_priority', detail: { before: b.processing_priority ?? null, after: 85 } });
    }
  }
});
