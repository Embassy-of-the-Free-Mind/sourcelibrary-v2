#!/usr/bin/env node
/**
 * Collection taxonomy cleanup — Issue #1186
 *
 * Phase 1: Hide empty shells and dead collections
 * Phase 2: Reparent orphaned children (remove dead parents from parent arrays)
 * Phase 3: Merge indian-philosophy under indic-traditions
 * Phase 4: Consolidate tiny top-levels (<5 books) into natural parents
 * Phase 5: Hide 0-book subcollections
 * Phase 6: Recalculate book_count for affected collections
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });

const DRY_RUN = process.argv.includes('--dry-run');
const client = new MongoClient(process.env.MONGODB_URI);

async function run() {
  await client.connect();
  const db = client.db('bookstore');
  const colls = db.collection('collections');
  const books = db.collection('books');

  const log = (msg) => console.log(`${DRY_RUN ? '[DRY] ' : ''}${msg}`);
  const results = { hidden: 0, reparented: 0, merged: 0, consolidated: 0 };

  // ──────────────────────────────────────────────
  // Phase 1: Hide empty geographic shells + dead art shells + contemplative-traditions
  // ──────────────────────────────────────────────
  const hideList = [
    // Geographic shells (0 books each)
    'world-traditions', 'south-asia', 'east-asia', 'middle-east-africa', 'americas', 'oceania',
    // Thematic shell
    'contemplative-traditions',
    // 0-book art exhibition shells (top-level)
    'alchemists-studio', 'art-of-altdorfer-baldung', 'before-ficino',
    'esoteric-engravers', 'ficinos-florence', 'haarlem-mannerists',
    'leonardo-drawings', 'portraits-tradition', 'rudolf-prague',
    'school-of-athens', 'venetian-mystery',
  ];

  log(`\n=== PHASE 1: Hide ${hideList.length} empty shells ===`);
  for (const slug of hideList) {
    log(`  hiding: ${slug}`);
    if (!DRY_RUN) {
      await colls.updateOne({ slug }, { $set: { visible: false, updated_at: new Date() } });
    }
    results.hidden++;
  }

  // ──────────────────────────────────────────────
  // Phase 2: Reparent children of hidden shells
  // ──────────────────────────────────────────────
  log(`\n=== PHASE 2: Reparent orphaned children ===`);

  // Children that need parent removed or replaced
  const reparentOps = [
    // Former children of world-traditions/south-asia/east-asia/middle-east-africa
    // Make them top-level by removing parent
    { slug: 'indic-traditions', action: 'remove-parent' },        // was under south-asia
    { slug: 'chinese-classics', action: 'remove-parent' },        // was under east-asia
    { slug: 'islamic-philosophy', action: 'remove-parent' },      // was under middle-east-africa

    // Reparent to thematic collections
    { slug: 'ethiopian-manuscripts', action: 'set-parent', parent: 'sacred-texts' },
    { slug: 'persian-literary-tradition', action: 'set-parent', parent: 'literature' },

    // Remove dead parents from multi-parent arrays
    { slug: 'indigenous-traditions', action: 'remove-from-parent', remove: 'americas' },
    { slug: 'mesoamerican', action: 'remove-from-parent', remove: 'americas' },
    { slug: 'polynesian', action: 'remove-from-parent', remove: 'oceania' },
    { slug: 'japanese', action: 'remove-from-parent', remove: 'east-asia' },
    { slug: 'chinese-theater', action: 'remove-from-parent', remove: 'east-asia' },

    // Remove contemplative-traditions from multi-parent arrays
    { slug: 'daoism', action: 'remove-from-parent', remove: 'contemplative-traditions' },
    { slug: 'depth-psychology', action: 'remove-from-parent', remove: 'contemplative-traditions' },
    { slug: 'sufism-islamic-mysticism', action: 'remove-from-parent', remove: 'contemplative-traditions' },
    { slug: 'vedanta-darshana', action: 'remove-from-parent', remove: 'contemplative-traditions' },
    { slug: 'zen-chan', action: 'remove-from-parent', remove: 'contemplative-traditions' },
  ];

  for (const op of reparentOps) {
    const doc = await colls.findOne({ slug: op.slug });
    if (!doc) { log(`  SKIP (not found): ${op.slug}`); continue; }

    const currentParent = doc.parent;

    if (op.action === 'remove-parent') {
      log(`  ${op.slug}: removing parent (was: ${currentParent})`);
      if (!DRY_RUN) {
        await colls.updateOne({ slug: op.slug }, { $unset: { parent: '' }, $set: { updated_at: new Date() } });
      }
    } else if (op.action === 'set-parent') {
      log(`  ${op.slug}: parent ${currentParent} → ${op.parent}`);
      if (!DRY_RUN) {
        await colls.updateOne({ slug: op.slug }, { $set: { parent: op.parent, updated_at: new Date() } });
      }
    } else if (op.action === 'remove-from-parent') {
      const parents = Array.isArray(currentParent) ? currentParent : [currentParent];
      const newParents = parents.filter(p => p !== op.remove);
      const newVal = newParents.length === 1 ? newParents[0] : newParents;
      log(`  ${op.slug}: [${parents.join(', ')}] → [${newParents.join(', ')}]`);
      if (!DRY_RUN) {
        if (newParents.length === 0) {
          await colls.updateOne({ slug: op.slug }, { $unset: { parent: '' }, $set: { updated_at: new Date() } });
        } else {
          await colls.updateOne({ slug: op.slug }, { $set: { parent: newVal, updated_at: new Date() } });
        }
      }
    }
    results.reparented++;
  }

  // ──────────────────────────────────────────────
  // Phase 3: Merge indian-philosophy under indic-traditions
  // ──────────────────────────────────────────────
  log(`\n=== PHASE 3: Merge indian-philosophy → subcollection of indic-traditions ===`);

  // 3a. Set indian-philosophy as child of indic-traditions
  log(`  Setting indian-philosophy.parent = 'indic-traditions'`);
  if (!DRY_RUN) {
    await colls.updateOne(
      { slug: 'indian-philosophy' },
      { $set: { parent: 'indic-traditions', updated_at: new Date() } }
    );
  }

  // 3b. Add 'indic-traditions' to books that have 'indian-philosophy' but not 'indic-traditions'
  const booksToTag = await books.countDocuments({
    collections: 'indian-philosophy',
    collections: { $nin: ['indic-traditions'] }, // books missing indic-traditions
    visible: true
  });
  // That query is wrong due to duplicate key. Let me use $and:
  const booksNeedingTag = await books.find({
    $and: [
      { collections: 'indian-philosophy' },
      { collections: { $ne: 'indic-traditions' } }
    ],
    visible: true
  }, { projection: { id: 1, title: 1 } }).toArray();

  log(`  ${booksNeedingTag.length} books need 'indic-traditions' tag added`);
  if (!DRY_RUN && booksNeedingTag.length > 0) {
    const ids = booksNeedingTag.map(b => b._id);
    const result = await books.updateMany(
      { _id: { $in: ids } },
      { $addToSet: { collections: 'indic-traditions' } }
    );
    log(`  Tagged ${result.modifiedCount} books`);
  }
  results.merged = booksNeedingTag.length;

  // ──────────────────────────────────────────────
  // Phase 4: Consolidate tiny top-levels (<5 books) into natural parents
  // ──────────────────────────────────────────────
  log(`\n=== PHASE 4: Consolidate tiny top-level collections ===`);

  const consolidateMap = [
    { slug: 'emblems-great-work', parent: 'alchemy' },
    { slug: 'hermetic-image', parent: 'hermetica' },
    { slug: 'kabbalah-sacred-geometry', parent: 'kabbalah' },
    { slug: 'memento-mori', parent: 'art-illustrated' },
    { slug: 'the-visionary', parent: 'mysticism' },
    { slug: 'medieval-illuminations', parent: 'great-manuscripts' },
  ];

  for (const { slug, parent } of consolidateMap) {
    const doc = await colls.findOne({ slug });
    if (!doc) { log(`  SKIP (not found): ${slug}`); continue; }
    log(`  ${slug} (${doc.book_count || 0} books) → subcollection of ${parent}`);
    if (!DRY_RUN) {
      await colls.updateOne({ slug }, { $set: { parent, updated_at: new Date() } });
      // Tag books with parent collection
      await books.updateMany(
        { $and: [{ collections: slug }, { collections: { $ne: parent } }] },
        { $addToSet: { collections: parent } }
      );
    }
    results.consolidated++;
  }

  // ──────────────────────────────────────────────
  // Phase 5: Hide 0-book subcollections
  // ──────────────────────────────────────────────
  log(`\n=== PHASE 5: Hide 0-book subcollections ===`);

  const emptySubcols = await colls.find({
    parent: { $exists: true },
    visible: true,
    $or: [{ book_count: 0 }, { book_count: { $exists: false } }]
  }).toArray();

  for (const c of emptySubcols) {
    // Skip if it was just reparented or consolidated (might get books later)
    if (hideList.includes(c.slug)) continue;
    log(`  hiding empty sub: ${c.slug} (parent: ${c.parent})`);
    if (!DRY_RUN) {
      await colls.updateOne({ slug: c.slug }, { $set: { visible: false, updated_at: new Date() } });
    }
    results.hidden++;
  }

  // ──────────────────────────────────────────────
  // Phase 6: Recalculate book_count for affected collections
  // ──────────────────────────────────────────────
  log(`\n=== PHASE 6: Recalculate book counts ===`);

  const affectedSlugs = [
    'indic-traditions', 'indian-philosophy',
    ...consolidateMap.map(c => c.parent),
    'sacred-texts', 'literature', // reparented children
  ];

  for (const slug of [...new Set(affectedSlugs)]) {
    const count = await books.countDocuments({ collections: slug, visible: true, pages_count: { $gt: 0 } });
    const current = await colls.findOne({ slug });
    if (current && current.book_count !== count) {
      log(`  ${slug}: ${current.book_count || 0} → ${count}`);
      if (!DRY_RUN) {
        await colls.updateOne({ slug }, { $set: { book_count: count, updated_at: new Date() } });
      }
    }
  }

  // ──────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────
  log(`\n=== SUMMARY ===`);
  log(`  Hidden: ${results.hidden}`);
  log(`  Reparented: ${results.reparented}`);
  log(`  Books tagged with indic-traditions: ${results.merged}`);
  log(`  Consolidated into parents: ${results.consolidated}`);

  // Final stats
  const topLevelCount = await colls.countDocuments({ parent: { $exists: false }, visible: true, collection_type: { $ne: 'visual_art' } });
  const totalVisible = await colls.countDocuments({ visible: true });
  log(`\n  Top-level collections (non-art): ${topLevelCount}`);
  log(`  Total visible: ${totalVisible}`);

  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
