#!/usr/bin/env node
/**
 * seed-contents-works.mjs — ingest the chapter-derived contents manifest into
 * `books.contents_works[]` as PROVISIONAL entries (#2916 Phase 2 / #2913 Phase 2a).
 *
 * Free (no AI): the constituent works come from the existing `books.chapters[]`
 * index (level-1, non-generic titles) — see scripts/lib/contents-works.mjs and the
 * #2914 estimator. Every entry is provisional: provenance:'chapter_index',
 * verified:false, is_first_translation:null. A container being FT-badged does NOT
 * make its constituents firsts — that needs the ft-verify pass before it counts.
 *
 * SAFE BY DEFAULT: dry-run unless --apply. Before any write, a backup of the prior
 * state of every touched book is dumped to scripts/output/. Fully reversible: --clear
 * removes chapter-derived manifests.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/maintenance/seed-contents-works.mjs            # dry-run report
 *     node scripts/maintenance/seed-contents-works.mjs --apply    # write (with backup)
 *     node scripts/maintenance/seed-contents-works.mjs --all-ft   # all FT books, not just container-signal
 *     node scripts/maintenance/seed-contents-works.mjs --clear --apply   # reverse: drop chapter-derived manifests
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import {
  isContainerSignal,
  deriveContentsWorks,
  validateManifest,
  entryConfidence,
} from '../lib/contents-works.mjs';

const APPLY = process.argv.includes('--apply');
const ALL_FT = process.argv.includes('--all-ft');
const CLEAR = process.argv.includes('--clear');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const FT = { is_first_translation: true, visible: true, pages_translated: { $gt: 0 } };

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  const c = new MongoClient(uri); await c.connect();
  const books = c.db(process.env.MONGODB_DB || 'bookstore').collection('books');
  fs.mkdirSync('scripts/output', { recursive: true });

  if (CLEAR) return clear(books, c);

  const all = await books.find(FT)
    .project({ _id: 0, id: 1, title: 1, author: 1, pages_count: 1, chapters: 1, contents_works: 1 })
    .toArray();
  const containers = ALL_FT ? all : all.filter(isContainerSignal);
  const withCh = containers.filter((b) => Array.isArray(b.chapters) && b.chapters.length);

  const ops = [];
  const backup = [];
  let sumWorks = 0, singleton = 0, thinTotal = 0, lowReach = 0, reachN = 0;

  for (const b of withCh) {
    const cons = deriveContentsWorks(b);
    const v = validateManifest(cons, b.chapters, b.pages_count);
    if (v.reach != null) { reachN++; if (v.reach < 0.7) lowReach++; }
    thinTotal += v.thin;
    if (cons.length <= 1) singleton++;          // false-positive container — manifest implicit
    if (cons.length < 2) continue;              // don't seed singletons (book floor already = 1)

    const contents_works = cons.map((e) => ({
      title: e.title,
      title_en: e.title_en || null,
      source_language: null,                    // language we translated FROM — set later, not derivable here
      page_from: e.page_from,
      page_to: e.page_to,
      work_id: null,                            // optional cluster link (#2453) — set later
      is_first_translation: null,               // tri-state; unproven until ft-verify'd
      verified: false,
      provenance: 'chapter_index',
      confidence: entryConfidence({ reach: v.reach, isThin: v.thinStarts.has(e.page_from) }),
    }));
    sumWorks += contents_works.length;

    backup.push({ book_id: b.id, prev_contents_works: b.contents_works ?? null });
    ops.push({
      updateOne: {
        filter: { id: b.id },
        update: { $set: {
          contents_works,
          contents_works_meta: {
            provenance: 'chapter_index',
            index_reach: v.reach,
            est_works: contents_works.length,
            derived_at: new Date(),
          },
        } },
      },
    });
  }

  console.log(`FT books: ${all.length} | containers (${ALL_FT ? 'ALL FT' : 'signal'}): ${containers.length} | with chapters: ${withCh.length}`);
  console.log(`seedable (≥2 constituents): ${ops.length} books → ${sumWorks} provisional constituent works (+${sumWorks - ops.length} over 1-each)`);
  console.log(`singletons skipped (book floor already 1): ${singleton} | thin entries (<2pp): ${thinTotal} | low-reach books (<70%): ${lowReach}/${reachN}`);

  if (!APPLY) {
    const preview = `scripts/output/contents-works-seed-preview-${stamp}.jsonl`;
    fs.writeFileSync(preview, backup.map((_, i) => JSON.stringify({
      book_id: ops[i].updateOne.filter.id,
      est_works: ops[i].updateOne.update.$set.contents_works.length,
      titles: ops[i].updateOne.update.$set.contents_works.map((w) => w.title).slice(0, 12),
    })).join('\n') + '\n');
    console.log(`\nDRY RUN — nothing written. Preview → ${preview}`);
    console.log('Re-run with --apply to write (a backup of prior state is saved first).');
    return c.close();
  }

  const backupPath = `scripts/output/contents-works-backup-${stamp}.jsonl`;
  fs.writeFileSync(backupPath, backup.map((x) => JSON.stringify(x)).join('\n') + '\n');
  console.log(`\nBackup of prior state (${backup.length} books) → ${backupPath}`);
  const res = ops.length ? await books.bulkWrite(ops, { ordered: false }) : { modifiedCount: 0, upsertedCount: 0 };
  console.log(`APPLIED: matched=${res.matchedCount ?? '—'} modified=${res.modifiedCount}`);
  await c.close();
}

async function clear(books, c) {
  const q = { 'contents_works_meta.provenance': 'chapter_index' };
  const n = await books.countDocuments(q);
  console.log(`chapter-derived manifests present on ${n} books`);
  if (!APPLY) { console.log('DRY RUN — re-run with --clear --apply to remove them.'); return c.close(); }
  const res = await books.updateMany(q, { $unset: { contents_works: '', contents_works_meta: '' } });
  console.log(`CLEARED: modified=${res.modifiedCount}`);
  await c.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
