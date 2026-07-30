#!/usr/bin/env node
/**
 * Repair `field_provenance.contributing_library` where it makes a false claim.
 *
 * TWO populations, both surfaced by scripts/audit/field-provenance.mjs:
 *
 * (A) STALE — the 2026-07-29 holding-library harvest replaced the value but
 *     wrote its own bespoke `holding_library_harvest` key instead of the
 *     canonical stamp, so 833 books still carry a stamp reading
 *     `provider_mapping / ia_metadata / 2026-03-24` describing a value that was
 *     replaced in July. The correct provenance is recoverable exactly, because
 *     that bespoke key recorded the date and the previous value.
 *
 * (B) CONTRADICTED — ~1,124 books whose stamp asserts `method:'ia_metadata'`
 *     while the stored value is a host or placeholder ("Internet Archive",
 *     "unknown library") that IA's contributor field would not have produced.
 *     Here the true provenance is NOT recoverable: we know the claim is false,
 *     not what actually happened. So this pass does not invent one — it marks
 *     the claim disputed and leaves the value alone. Correcting the VALUE is
 *     harvest-holding-libraries.mjs's job; this only stops the record from
 *     asserting a source it cannot support.
 *
 * That asymmetry is the point. A stamp that is wrong is worse than one that is
 * missing: it reads as authority and stops anyone looking. Downgrading a false
 * claim to an explicit "unverified" is a repair; guessing a plausible source
 * would be the same mistake with a fresher date.
 *
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/repair-holding-library-provenance.mjs --dry-run
 *   node scripts/maintenance/repair-holding-library-provenance.mjs --apply
 */

import { MongoClient } from 'mongodb';
import { holdingLibraryName } from '../lib/holding-library.mjs';
import { provenanceUpdate } from '../lib/field-provenance.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is required:\n  set -a; source .env.production.local; set +a; node scripts/maintenance/repair-holding-library-provenance.mjs --dry-run');
  process.exit(1);
}

const SCRIPT = 'scripts/maintenance/repair-holding-library-provenance.mjs';

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const books = client.db('bookstore').collection('books');
  console.log(`Mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}\n`);

  const stats = { staleFound: 0, staleFixed: 0, disputedFound: 0, disputedMarked: 0 };

  // ---- (A) stale stamps left by the harvest's first run -------------------
  const staleCursor = books.find(
    { holding_library_harvest: { $exists: true } },
    { projection: { slug: 1, ia_identifier: 1, image_source: 1, holding_library_harvest: 1, field_provenance: 1 } },
  );
  for await (const b of staleCursor) {
    const h = b.holding_library_harvest;
    stats.staleFound++;
    if (!APPLY) continue;
    // Reconstruct the stamp the harvest should have written, from what it did
    // record. `previous_value` comes from the bespoke key's own `previous`.
    const prov = provenanceUpdate('contributing_library', {
      source: 'ia_metadata_harvest',
      script: 'scripts/maintenance/harvest-holding-libraries.mjs',
      method: 'archive.org/metadata contributor',
      mode: 'fill',
      ia_identifier: b.ia_identifier || b.image_source?.identifier || null,
      confidence: 'high',
      date: h?.at || new Date(),
      previous_value: h?.previous ?? null,
      note: `provenance reconstructed by ${SCRIPT}; the original run wrote a bespoke holding_library_harvest key instead of the canonical stamp`,
    });
    const r = await books.updateOne(
      { _id: b._id },
      { $set: prov.$set, $push: prov.$push, $unset: { holding_library_harvest: '' } },
    );
    if (r.modifiedCount === 1) stats.staleFixed++;
  }

  // ---- (B) contradicted stamps -------------------------------------------
  const contradictedCursor = books.find(
    {
      visible: true,
      pages_count: { $gt: 0 },
      'field_provenance.contributing_library': { $exists: true },
      'image_source.contributing_library': { $exists: true, $nin: [null, ''] },
    },
    { projection: { slug: 1, image_source: 1, field_provenance: 1 } },
  );
  const examples = [];
  for await (const b of contradictedCursor) {
    const entry = b.field_provenance?.contributing_library;
    const value = b.image_source?.contributing_library;
    const claimsUpstream = typeof entry?.method === 'string' && /metadata|catalog|manifest/i.test(entry.method);
    if (!claimsUpstream) continue;
    if (holdingLibraryName({ contributing_library: value })) continue; // value is a real custodian — stamp stands
    if (entry?.disputed) continue; // already marked
    stats.disputedFound++;
    if (examples.length < 5) examples.push(`${b.slug}: value=${JSON.stringify(value)} claimed=${JSON.stringify(entry.method)}`);
    if (!APPLY) continue;
    // Keep the original stamp intact and annotate it. Overwriting it would
    // destroy the evidence that the false claim was ever made.
    const r = await books.updateOne(
      { _id: b._id },
      {
        $set: {
          'field_provenance.contributing_library.disputed': {
            by: SCRIPT,
            date: new Date(),
            reason: `stamp claims ${JSON.stringify(entry.method)} but the stored value is a host/placeholder that IA's contributor field would not return; true provenance unknown`,
          },
        },
      },
    );
    if (r.modifiedCount === 1) stats.disputedMarked++;
  }

  console.log('=== Result ===');
  console.log(`  (A) stale stamps found          ${stats.staleFound}`);
  console.log(`      reconstructed               ${stats.staleFixed}${APPLY ? '' : '  (dry run)'}`);
  console.log(`  (B) contradicted stamps found   ${stats.disputedFound}`);
  console.log(`      marked disputed             ${stats.disputedMarked}${APPLY ? '' : '  (dry run)'}`);
  if (examples.length) {
    console.log('\n  contradicted examples:');
    examples.forEach((e) => console.log(`    ${e}`));
  }
  console.log('');
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
