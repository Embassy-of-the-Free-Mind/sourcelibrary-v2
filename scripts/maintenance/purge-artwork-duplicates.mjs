/**
 * Sign-off-gated purge of duplicate artwork records (#2209).
 *
 * SOFT-DELETES (recoverable) the non-keeper of each confirmed duplicate pair,
 * mirroring the canonical delete path in src/app/api/books/[id]/route.ts:
 * archive the full doc + any pages to `deleted_books`, then remove from the live
 * collections. Every removed record is restorable via POST /api/books/restore/{id}.
 *
 * Input: the two READ-ONLY reports from the dedup detectors —
 *   scripts/output/artwork-exact-duplicates.json        (HIGH: commons_sha1)
 *   scripts/output/artwork-dedup-clip-confirmed.json     (CLIP verdict=confirmed)
 *
 * SAFETY (Data Protection CRITICAL — artworks are never batch-deleted casually):
 *   • DRY-RUN by default. Nothing is deleted without --apply.
 *   • HIDDEN-ONLY by default. Visible dups (the 2 public pairs) are skipped
 *     unless --include-visible is passed, and are always listed individually.
 *   • Keeper is NEVER deleted, and re-verified to still exist at apply-time.
 *   • Each removable id is RE-VERIFIED live before deletion:
 *       - still exists, is content_type:'artwork', and (unless --include-visible)
 *         still visible:false;
 *       - for the sha1 tier, still shares commons_sha1 with its keeper (guards a
 *         stale report — the identity is re-confirmed against current data);
 *       - keeper still present. Any failure → skip that record, don't delete.
 *   • Prints BOTH the candidate count and the post-verify actual count.
 *   • Writes a manifest of everything deleted (id, keeper, reason) before acting.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/purge-artwork-duplicates.mjs            # dry-run, both tiers, hidden-only
 *   node scripts/maintenance/purge-artwork-duplicates.mjs --sha1-only
 *   node scripts/maintenance/purge-artwork-duplicates.mjs --clip-only
 *   node scripts/maintenance/purge-artwork-duplicates.mjs --apply    # DELETE (soft, recoverable)
 *   node scripts/maintenance/purge-artwork-duplicates.mjs --apply --include-visible --limit=2
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const SHA1_ONLY = process.argv.includes('--sha1-only');
const CLIP_ONLY = process.argv.includes('--clip-only');
const INCLUDE_VISIBLE = process.argv.includes('--include-visible');
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || 0;

const SHA1_REPORT = 'scripts/output/artwork-exact-duplicates.json';
const CLIP_REPORT = 'scripts/output/artwork-dedup-clip-confirmed.json';
const MANIFEST = 'scripts/output/artwork-purge-manifest.json';

function loadCandidates() {
  const cands = new Map(); // removableId -> { id, keeper, reason, tier }
  if (!CLIP_ONLY) {
    const rep = JSON.parse(readFileSync(SHA1_REPORT, 'utf8'));
    for (const g of rep.groups.filter(g => g.tier === 'high')) {
      for (const r of g.remove) {
        cands.set(r.id, { id: r.id, keeper: g.keeper.id, reason: 'commons_sha1 byte-identical', tier: 'sha1' });
      }
    }
  }
  if (!SHA1_ONLY) {
    const rep = JSON.parse(readFileSync(CLIP_REPORT, 'utf8'));
    for (const g of rep.groups) {
      for (const p of g.pairs) {
        if (p.verdict !== 'confirmed') continue;
        // sha1 wins if a record is somehow in both — don't downgrade the reason.
        if (!cands.has(p.id)) {
          cands.set(p.id, { id: p.id, keeper: g.keeper, reason: `CLIP confirmed (${p.similarity})`, tier: 'clip' });
        }
      }
    }
  }
  return [...cands.values()];
}

async function main() {
  const candidates = loadCandidates();
  console.log(`Candidates loaded: ${candidates.length} (sha1${CLIP_ONLY ? ' skipped' : ''}, clip${SHA1_ONLY ? ' skipped' : ''})`);

  const mc = new MongoClient(process.env.MONGODB_URI);
  await mc.connect();
  const db = mc.db('bookstore');
  const books = db.collection('books');

  // Re-verify each candidate live.
  const toDelete = [];
  const skipped = { missing: 0, keeper_missing: 0, visible: 0, not_artwork: 0, sha1_mismatch: 0, self: 0 };
  for (const c of candidates) {
    if (c.id === c.keeper) { skipped.self++; continue; }
    const dup = await books.findOne({ id: c.id }, { projection: { _id: 1, id: 1, title: 1, visible: 1, content_type: 1, commons_sha1: 1 } });
    if (!dup) { skipped.missing++; continue; }
    if (dup.content_type !== 'artwork') { skipped.not_artwork++; continue; }
    if (!INCLUDE_VISIBLE && dup.visible === true) { skipped.visible++; continue; }
    const keeper = await books.findOne({ id: c.keeper }, { projection: { _id: 1, id: 1, commons_sha1: 1, visible: 1 } });
    if (!keeper) { skipped.keeper_missing++; continue; } // never orphan a pair by deleting the only copy
    if (c.tier === 'sha1') {
      if (!dup.commons_sha1 || dup.commons_sha1 !== keeper.commons_sha1) { skipped.sha1_mismatch++; continue; }
    }
    toDelete.push({ ...c, _id: dup._id, title: dup.title, visible: dup.visible === true });
  }

  const finalList = LIMIT ? toDelete.slice(0, LIMIT) : toDelete;
  const visibleCount = finalList.filter(d => d.visible).length;

  console.log(`\n── Purge plan (${APPLY ? 'APPLY' : 'DRY-RUN'}) ─────────────────────`);
  console.log(`Candidates:           ${candidates.length}`);
  console.log(`Skipped on re-verify: ${JSON.stringify(skipped)}`);
  console.log(`Will soft-delete:     ${finalList.length}  (${visibleCount} currently visible)`);
  if (visibleCount) console.log(`  visible dups: ${finalList.filter(d => d.visible).map(d => d.id).join(', ')}`);

  // Always write the manifest (what would/did happen) before touching data.
  writeFileSync(MANIFEST, JSON.stringify({
    apply: APPLY, generated: 'purge-artwork-duplicates', include_visible: INCLUDE_VISIBLE,
    count: finalList.length, visible_count: visibleCount,
    records: finalList.map(d => ({ id: d.id, title: d.title, keeper: d.keeper, reason: d.reason, tier: d.tier, was_visible: d.visible })),
  }, null, 2));
  console.log(`Manifest → ${MANIFEST}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN — no deletions. Re-run with --apply to soft-delete (recoverable via /api/books/restore/{id}).`);
    await mc.close();
    return;
  }

  // Soft-delete: archive to deleted_books (with any pages), then remove.
  let done = 0;
  for (const d of finalList) {
    const book = await books.findOne({ _id: d._id });
    if (!book) continue;
    const pages = await db.collection('pages').find({ book_id: book.id }).maxTimeMS(30000).toArray();
    await db.collection('deleted_books').insertOne({
      ...book, pages, deleted_at: new Date(), original_id: book._id,
      deleted_reason: `artwork dedup (#2209): ${d.reason}; keeper ${d.keeper}`,
    });
    if (pages.length) await db.collection('pages').deleteMany({ book_id: book.id });
    await books.deleteOne({ _id: book._id });
    done++;
    if (done % 100 === 0) console.log(`  soft-deleted ${done}/${finalList.length}`);
  }
  console.log(`\nDone. Soft-deleted ${done} duplicate artworks (recoverable). Manifest at ${MANIFEST}.`);
  await mc.close();
}

main().catch(e => { console.error(e); process.exit(1); });
