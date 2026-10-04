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
 *   node --env-file=… scripts/maintenance/drebbel-oven-5811.mjs --fix-meta [--apply]
 */
import { withMongo } from '../lib/mongo.mjs';
import { sourceFingerprints } from '../lib/source-fingerprints.mjs';
import { computeIdentityFields } from '../lib/identity-fields.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
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
    for (const f of FIXES) {
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
});
