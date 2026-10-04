#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/hold-pipeline-books.mjs (status moves — used as-is for the hold and
 * the re-entry, not reimplemented here); scripts/maintenance/set-scope.mjs (the spend envelope);
 * scripts/lib/acquire-book.mjs acquisitionGate (gates a NEW candidate — it would match a held book
 * against itself, so the duplicate pair is compared here read-only with the same fingerprint and
 * edition-key helpers). None of them fixes two title-page imprints or prints the pair comparison.
 *
 * drebbel-oven-5811 — one-off job helper for #5811 (Drebbel's self-regulating oven).
 *
 *   --compare   read-only: fingerprints + edition keys of the two Becher "Närrische Weißheit" records
 *   --fix-meta  imprint fixes read from the title page / holding library's catalogue (dry run unless --apply):
 *                 6a9058b07f6818cc17cd5a93 Drebbel, Kurtzer Tractat — title page p.3:
 *                   "Gedruckt zu Leyden in Hollandt / Bey Henrichen von Haestens / im Jahr Christ 1608"
 *                   (BSB manifest bsb10133647: Leyden, 1608)
 *                 6a42727728e9db2e39c14050 Becher, Närrische Weißheit — e-rara 19571363 catalogue:
 *                   "[S.l.], 1707" (Reimmann's edition), NOT the 1682 first edition
 *               Identity fields are recomputed in the same write (edition-identity.md: a year change
 *               without recompute is drift).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/drebbel-oven-5811.mjs --compare
 *   node --env-file=… scripts/maintenance/drebbel-oven-5811.mjs --fix-meta [--only <id>] [--apply]
 */
import { withMongo } from '../lib/mongo.mjs';
import { sourceFingerprints } from '../lib/source-fingerprints.mjs';
import { computeIdentityFields } from '../lib/identity-fields.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1] : null; })(); // re-running a fix would overwrite its previous_value
const SWEEP = 'drebbel-oven-5811';
const BECHER = ['6a42727728e9db2e39c14050', '6a94036e351189dcd3082557'];

const FIXES = [
  {
    id: '6a9058b07f6818cc17cd5a93',
    set: { published: '1608', year: 1608, publication_place: 'Leyden', printer: 'Henrich von Haestens' },
    basis: 'title page (page 3): "Gedruckt zu Leyden in Hollandt / Bey Henrichen von Haestens / im Jahr Christ 1608"; BSB bsb10133647 catalogue Leyden 1608',
  },
  {
    id: '6a42727728e9db2e39c14050',
    set: { published: '1707', year: 1707 },
    basis: 'e-rara 19571363 (doi:10.3931/e-rara-71948) catalogue Impressum "[S.l.], 1707", ed. J. F. Reimmann; [40] Bl., 208 S.',
  },
  {
    id: '6a44359d0235c9147000dd12',
    set: { title: "Journal des voyages de Monsieur de Monconys … Seconde partie (Voyage d'Angleterre, Païs-Bas, Allemagne & Italie)" },
    basis: 'title page (page 5) and first text page (page 9): "SECONDE PARTIE. VOYAGE D\'ANGLETERRE", May 1663. The record said "Première partie"; Part I (Lyon 1665) is a different volume (imported as 6ac27d29058764b16bdc390b)',
  },
];

await withMongo(async (db) => {
  const B = db.collection('books');
  if (process.argv.includes('--compare')) {
    for (const id of BECHER) {
      const b = await B.findOne({ id });
      console.log(JSON.stringify({
        id, status: b.pipeline_auto?.status, pages_count: b.pages_count, pages_archived: b.pages_archived, pages_ocr: b.pages_ocr,
        manifest: b.image_source?.iiif_manifest, provider: b.image_source?.provider, created_at: b.created_at,
        fingerprints: sourceFingerprints(b), edition_key: b.edition_key, computed: computeIdentityFields(b),
      }, null, 1));
    }
  }
  if (process.argv.includes('--fix-meta')) {
    for (const f of FIXES.filter((x) => !ONLY || x.id === ONLY)) {
      const b = await B.findOne({ id: f.id });
      const next = { ...b, ...f.set };
      const identity = computeIdentityFields(next);
      const prov = {};
      for (const k of Object.keys(f.set)) prov[`field_provenance.${k}`] = { source: 'title_page', basis: f.basis, previous_value: b[k] ?? null, script: 'drebbel-oven-5811.mjs', issue: 5811, date: new Date() };
      const $set = { ...f.set, ...identity, ...prov, updated_at: new Date() };
      console.log(`${f.id} ${APPLY ? 'SET' : 'would set'}`, JSON.stringify({ ...f.set, ...identity }));
      if (!APPLY) continue;
      await B.updateOne({ id: f.id }, { $set });
      await recordSweepAction(db, { sweep: SWEEP, book_id: f.id, action: 'imprint_fixed', detail: { before: Object.fromEntries(Object.keys(f.set).map((k) => [k, b[k] ?? null])), after: f.set, basis: f.basis } });
    }
  }
  // Evelyn vol. II (diaryjohnevelyn01wheagoog): archive.org answers HTTP 500 for the item's JP2 zip
  // (and its _djvu.xml) on every attempt, while single /page/nN images serve 200. archive-bulk would
  // strike it 5 times and then mark it BLOCKED, which archive-ocr also skips. Its own route for
  // "zip unusable, pages fetchable" is bulk_unsuitable → archive-ocr per-page IIIF; set exactly that.
  // Phase 4 (and 2, 8) take the top N books corpus-wide BEFORE confining to the envelope, so an
  // envelope book outside the global top 60 ocr_complete is never selected: English books never
  // leave ocr_complete, the rest are never translated. processing_priority is the documented queue
  // lever (image-storage-architecture.md; fresh imports get 80). 85 tops the live queue (max 80)
  // and stays under REALTIME_PRIORITY_FLOOR (90), so translation stays on the chained Batch lane.
  if (process.argv.includes('--priority')) {
    const ids = ['6ac27d29058764b16bdc390b', '6a44359d0235c9147000dd12', '6a906d3f32545072610bae03', '6a42727728e9db2e39c14050', '6a9058b07f6818cc17cd5a93', '6a42761d28e9db2e39c1b5d4', '6ac2798602c7f994f850646a', '6ac2798802c7f994f8506684', '6ac2798b02c7f994f85066f6', '6ac2798d02c7f994f8506911', '6ac2798f02c7f994f8506b1e', '6ac2799102c7f994f8506bef'];
    const before = await B.find({ id: { $in: ids } }).project({ id: 1, processing_priority: 1 }).toArray();
    console.log(`${APPLY ? 'SET' : 'would set'} processing_priority 85 on ${ids.length} books; before:`, JSON.stringify(before.map((b) => [b.id, b.processing_priority ?? null])));
    if (APPLY) {
      await B.updateMany({ id: { $in: ids } }, { $set: { processing_priority: 85, updated_at: new Date() } });
      for (const b of before) await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'processing_priority', detail: { before: b.processing_priority ?? null, after: 85 } });
    }
  }
  if (process.argv.includes('--evelyn-per-page')) {
    const id = '6ac2798602c7f994f850646a';
    const reason = 'archive.org HTTP 500 on the JP2 zip (and _djvu.xml) on every attempt 2026-10-04, single page images 200 (#5811)';
    console.log(`${id} ${APPLY ? 'SET' : 'would set'} archive_metadata.bulk_unsuitable — ${reason}`);
    if (APPLY) {
      await B.updateOne({ id }, {
        $set: { 'archive_metadata.bulk_unsuitable': true, 'archive_metadata.bulk_unsuitable_at': new Date(), 'archive_metadata.bulk_unsuitable_reason': reason, updated_at: new Date() },
        $unset: { 'archive_metadata.bulk_failures': '', 'archive_metadata.bulk_last_error': '', 'archive_metadata.bulk_last_failed_at': '' },
      });
      await recordSweepAction(db, { sweep: SWEEP, book_id: id, action: 'bulk_unsuitable', detail: { reason } });
    }
  }
});
