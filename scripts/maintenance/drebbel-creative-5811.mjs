#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/drebbel-later-5811.mjs (branch job/drebbel-later-5811, unmerged) —
 * the same priority lever and status readout for that job's books; its id list is hard-coded and
 * this job's books are not in it. hold-pipeline-books.mjs and set-scope.mjs are used as-is.
 *
 * drebbel-creative-5811 — one-off job helper for #5811 (hard-to-reach Drebbel sources).
 *   --status    read-only per-book progress
 *   --priority  processing_priority 85 (Phase 4 takes the global top 60 before the envelope filter)
 *   --spend     this job's books, both usage stores, per book and total
 *   --tag       add `drebbel` to books already held that carry a Drebbel text (dry run unless --apply)
 */
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { getScopeSpendUsd } from '../lib/spend-guard.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'drebbel-creative-5811';
export const IDS = [
  '6ac3a8f04de0ba35e46502b0', // Jaeger, Cornelis Drebbel en zijne tijdgenooten (1922), Delpher
  '6ac3aeff3b2f03f7e59cb913', // Monconys, Journal III (1666)
  '6ac3af023b2f03f7e59cba4e', // Boyle, General History of the Air (1692)
  '6ac3af043b2f03f7e59cbb6d', // Lettres de Peiresc I (1888)
  '6ac3af063b2f03f7e59cbf1c', // Lettres de Peiresc VI (1896)
  '6ac3b18341429f5df9e8ac3a', // Sorbière, Relation (Paris 1664), Gallica
];
const TAG = [
  ['69b51dbdefd8df28f2daa158', 'Basil Valentine, Offenbahrung (Erfurt 1624) with Drebbel, Tractatus von Natur der Elementen bound in (pp. 93ff)'],
];

await withMongo(async (db) => {
  const B = db.collection('books');
  if (process.argv.includes('--status')) {
    for (const b of await B.find({ id: { $in: IDS } }).project({ id: 1, title: 1, slug: 1, pages_count: 1, visible: 1, processing_priority: 1, 'pipeline_auto.status': 1, language: 1 }).toArray()) {
      const [arch, ocr, tr] = await Promise.all([
        db.collection('pages').countDocuments({ book_id: b.id, archived_photo: { $exists: true, $ne: null } }),
        db.collection('pages').countDocuments({ book_id: b.id, 'ocr.data': { $exists: true, $ne: '' } }),
        db.collection('pages').countDocuments({ book_id: b.id, 'translation.data': { $exists: true, $ne: '' } }),
      ]);
      console.log(`${b.id} ${String(b.pipeline_auto?.status).padEnd(16)} p${b.processing_priority ?? '-'} ${b.visible ? 'VISIBLE' : 'hidden '} arch ${arch}/${b.pages_count} ocr ${ocr} tr ${tr} ${b.language} ${(b.title || '').slice(0, 50)} /book/${b.slug}`);
    }
  }
  if (process.argv.includes('--spend')) {
    let total = 0;
    for (const id of IDS) { const s = await getScopeSpendUsd(db, { ids: [id] }); total += s.usd; console.log(`${id} $${s.usd.toFixed(3)} (${s.rows} rows)${s.meterError ? ' METER ERROR ' + s.meterError : ''}`); }
    console.log(`TOTAL $${total.toFixed(3)}`);
  }
  if (process.argv.includes('--priority')) {
    const before = await B.find({ id: { $in: IDS } }).project({ id: 1, processing_priority: 1 }).toArray();
    console.log(`${APPLY ? 'SET' : 'would set'} processing_priority 85; before:`, JSON.stringify(before.map((b) => [b.id, b.processing_priority ?? null])));
    if (APPLY) {
      await B.updateMany({ id: { $in: IDS } }, { $set: { processing_priority: 85, updated_at: new Date() } });
      for (const b of before) await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'processing_priority', detail: { before: b.processing_priority ?? null, after: 85 } });
    }
  }
  if (process.argv.includes('--tag')) {
    for (const [id, why] of TAG) {
      const b = await B.findOne({ id }, { projection: { collections: 1 } });
      const has = (b.collections || []).includes('drebbel');
      console.log(`${id} ${has ? 'already tagged' : APPLY ? 'TAG drebbel' : 'would tag drebbel'} — ${why}`);
      if (APPLY && !has) {
        await B.updateOne({ id }, { $addToSet: { collections: 'drebbel' }, $set: { updated_at: new Date() } });
        await recordSweepAction(db, { sweep: SWEEP, book_id: id, action: 'collection_tag', detail: { added: 'drebbel', before: b.collections || [], why } });
      }
    }
  }
});
