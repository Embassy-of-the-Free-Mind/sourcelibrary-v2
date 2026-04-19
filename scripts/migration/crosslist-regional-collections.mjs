#!/usr/bin/env node
/**
 * Cross-list regional collections under domain wings.
 * Adds domain parents while keeping regional parents intact.
 * Also fixes broken featured_images on curated pathway collections.
 *
 * DRY RUN by default. Pass --execute to apply.
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });

const DRY_RUN = !process.argv.includes('--execute');

// ─── Cross-listing: regional children → domain wings ───────────────
// Format: slug → new parent(s) to ADD (will merge with existing)
const CROSSLIST = {
  // East Asia container children → domain wings
  'chinese-classics': 'classical-philosophy',

  // Chinese sub-topics → domain wings (keep chinese-classics parent too)
  'chinese-medicine-natural-philosophy': 'medicine',
  'chinese-natural-knowledge': 'natural-philosophy',
  'daoist-classics': 'sacred-texts',
  'confucian-classics': 'sacred-texts',
  'chinese-buddhist-texts': 'sacred-texts',
  'chinese-daoist-magic': 'magic',

  // South Asia container children → domain wings
  'indic-traditions': 'sacred-texts',

  // Indic sub-topics → domain wings (keep indic-traditions parent too)
  'indian-philosophy': 'classical-philosophy',
  'puranas-epics': 'sacred-texts',
  'yoga-tantra-mysticism': 'mysticism',
  'vedanta-darshana': 'classical-philosophy',
  'indian-buddhist-jain': 'sacred-texts',

  // Already cross-listed (indic-alchemy, indic-magic already under alchemy/magic from first migration)

  // Middle East & Africa → domain wings
  'middle-east-africa': 'sacred-texts',
  'islamic-philosophy': 'classical-philosophy',

  // Americas → sacred-texts as the best fit
  'americas': 'sacred-texts',
  'indigenous-traditions': 'sacred-texts',

  // Small ones → sacred-texts
  'african-traditions': 'sacred-texts',
  'polynesian': 'sacred-texts',
  'australian-aboriginal': 'sacred-texts',
};

// ─── Fix broken featured_images ────────────────────────────────────
// These have bare URL strings or null values instead of image objects
const FIX_IMAGES = {
  // dance-of-death and yokai-oni have ["url"] instead of [{image_url: "url"}]
  // visions-ecstasies has no featured_images at all
  // For now, clear the corrupted ones so they use the warm fallback
  // rather than potentially crashing the render
};

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const coll = db.collection('collections');

  console.log(DRY_RUN ? '🔍 DRY RUN\n' : '⚡ EXECUTING\n');

  let updated = 0;

  // 1. Cross-list regional children under domain wings
  console.log('--- Cross-listing regional children under domain wings ---');
  for (const [slug, newParent] of Object.entries(CROSSLIST)) {
    const doc = await coll.findOne({ slug });
    if (!doc) {
      console.log(`  ⚠️  ${slug} — not found`);
      continue;
    }

    const current = doc.parent;
    let parents;

    if (!current) {
      // No parent yet — just set it
      parents = newParent;
    } else if (Array.isArray(current)) {
      // Already an array — add new parent if not present
      if (current.includes(newParent)) {
        console.log(`  ✓  ${slug} — already includes ${newParent}`);
        continue;
      }
      parents = [...current, newParent];
    } else {
      // Single string parent — convert to array
      if (current === newParent) {
        console.log(`  ✓  ${slug} — already under ${newParent}`);
        continue;
      }
      parents = [current, newParent];
    }

    console.log(`  → ${slug} — parent: ${JSON.stringify(current)} → ${JSON.stringify(parents)}`);
    if (!DRY_RUN) {
      await coll.updateOne({ slug }, { $set: { parent: parents } });
    }
    updated++;
  }

  // 2. Fix corrupted featured_images
  console.log('\n--- Fixing corrupted featured_images ---');
  for (const slug of ['dance-of-death', 'yokai-oni']) {
    const doc = await coll.findOne({ slug });
    if (!doc) continue;
    const imgs = doc.featured_images;
    if (imgs && imgs.length > 0 && typeof imgs[0] === 'string') {
      console.log(`  → ${slug} — converting bare URL to image object`);
      const fixed = imgs.map(url => typeof url === 'string' ? { image_url: url, type: 'extracted' } : url);
      if (!DRY_RUN) {
        await coll.updateOne({ slug }, { $set: { featured_images: fixed } });
      }
      updated++;
    } else {
      console.log(`  ✓  ${slug} — already OK`);
    }
  }

  // 3. Swap out curated pathway collections that have weak/missing images
  // Replace with ones that have good images
  console.log('\n--- Weak image collections (need manual curation) ---');
  for (const slug of ['ficinos-florence', 'rudolf-prague', 'kloss-collection', 'contemplative-traditions', 'visions-ecstasies']) {
    const doc = await coll.findOne({ slug });
    if (!doc) continue;
    const imgs = doc.featured_images || [];
    const hasThumbnail = imgs.some(i => i && typeof i === 'object' && (i.thumbnail_url || i.extracted_url));
    console.log(`  ℹ️  ${slug} — ${imgs.length} images, ${hasThumbnail ? 'has thumbnails' : 'NO thumbnails (needs curation)'}`);
  }

  console.log(`\n✅ ${DRY_RUN ? 'Would update' : 'Updated'} ${updated} collections`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
