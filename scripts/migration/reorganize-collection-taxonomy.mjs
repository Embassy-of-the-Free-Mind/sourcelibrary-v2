#!/usr/bin/env node
/**
 * Reorganize collection taxonomy: nest orphan collections under parents,
 * merge duplicates, hide shells/catch-alls, fix orphaned children.
 *
 * DRY RUN by default. Pass --execute to apply changes.
 *
 * Usage:
 *   node scripts/migration/reorganize-collection-taxonomy.mjs          # dry run
 *   node scripts/migration/reorganize-collection-taxonomy.mjs --execute # apply
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });

const DRY_RUN = !process.argv.includes('--execute');

// ─── Parent assignments ────────────────────────────────────────────
// slug → parent (string or array for multi-parent)
const NEST_UNDER = {
  // Author/figure collections
  'fechner': 'psychology',
  'leonardo-da-vinci': 'art-illustrated',
  'rumi': 'mysticism',
  'jungs-library': 'psychology',

  // Non-curated thematic → parent
  'dreams-unconscious': 'psychology',
  'gnostic-texts': 'sacred-texts',
  'kloss-collection': 'secret-societies',
  'medieval-heresies': 'theology',
  'the-moon': 'astrology',
  'slavic-tradition': 'mysticism',
  'sumerian-mesopotamian': 'sacred-texts',

  // Hidden niche
  'chinese-technology': 'natural-philosophy',
  'indic-alchemy': 'alchemy',
  'indic-magic': 'magic',
  'islamic-sciences': 'natural-philosophy',
  'mycology': 'medicine',

  // Large hidden thematic
  'ficinos-florence': 'renaissance-philosophy',
  'dance-of-death': 'art-illustrated',
  'haarlem-mannerists': 'art-illustrated',
  'portraits-tradition': 'art-illustrated',
  'the-cosmos': 'natural-philosophy',
  'the-infernal': 'demonology',
  'classical-mysteries': 'classical-philosophy',
  'school-of-athens': 'classical-philosophy',
  'erotic-art': 'art-illustrated',
  'esoteric-engravers': 'art-illustrated',
  'visions-ecstasies': 'mysticism',
  'wrathful-deities': ['demonology', 'sacred-texts'],
  'yokai-oni': 'demonology',
  'thought-forms': 'mysticism',
  'before-ficino': 'classical-philosophy',
  'rudolf-prague': 'renaissance-philosophy',
  'angels-celestials': 'mysticism',

  // Curated exhibitions → parent
  'agrippas-world': 'magic',
  'ancient-egyptian': 'sacred-texts',
  'ancient-engineering': 'natural-philosophy',
  'ancient-papyri': 'sacred-texts',
  'ayurveda': 'medicine',
  'courts-of-wonder': 'renaissance-philosophy',
  'esoteric-capitalism': 'secret-societies',
  'famous-women': 'history-political-thought',
  'global-demonology': 'demonology',
  'great-manuscripts': 'art-illustrated',
  'herculaneum-papyri': 'classical-philosophy',
  'illuminated-manuscripts': 'art-illustrated',
  'islamic-philosophy-meets-christian-mysticism': 'mysticism',
  'letters-from-the-desert': 'theology',
  'making-things-visible': 'natural-philosophy',
  'maps-of-the-invisible': 'hermetica',
  'mining-metals-and-fire': 'alchemy',
  'nova-reperta': 'natural-philosophy',
  'renaissance-literary-imagination': 'literature',
  'robert-hooke-polymath': 'natural-philosophy',
  'sacred-books-of-the-east': 'sacred-texts',
  'sacred-objects': 'sacred-texts',
  'alchemical-emblem': 'alchemy',
  'apocrypha': 'sacred-texts',
  'art-of-memory': 'renaissance-philosophy',
  'beguine-mystics': 'mysticism',
  'behmenist-underground': 'mysticism',
  'bestiary-tradition': 'medicine',
  'byzantine-bridge': 'theology',
  'canon-of-avicenna': 'medicine',
  'contemplative-traditions': 'mysticism',
  'dutch-golden-age-of-science': 'natural-philosophy',
  'encyclopedists': 'natural-philosophy',
  'grimoire-tradition': 'magic',
  'hesychast-tradition': 'mysticism',
  'indian-mathematical-tradition': 'natural-philosophy',
  'invention-of-method': 'natural-philosophy',
  'kepler-fludd-debate': ['natural-philosophy', 'hermetica'],
  'printing-press-revolution': 'history-political-thought',
  'rhineland-mystics': 'mysticism',
  'rosicrucian-moment': 'secret-societies',
  'sympathy-of-all-things': 'hermetica',
  'weapon-salve-controversy': 'medicine',
  'witches-sabbath': 'demonology',
  'theatres-of-machines': 'natural-philosophy',
  'theosophical-society': 'secret-societies',
  'women-of-the-secret-tradition': ['mysticism', 'history-political-thought'],

  // Music merge: music-harmony → nested under music-sound, then music-sound under natural-philosophy
  'music-harmony': 'music-sound',
  'music-sound': 'natural-philosophy',

  // Syriac merge: syriac-church → nested under syriac-tradition, then syriac-tradition under theology
  'syriac-church': 'syriac-tradition',
  'syriac-tradition': 'theology',

  // SHWEP & Miscellany — keep top-level but will be hidden below
};

// ─── Collections to hide ───────────────────────────────────────────
const HIDE = [
  'miscellany',
  'shwep',
  'world-traditions',  // nameless regional shell
  'east-asia',         // nameless regional shell
  'south-asia',        // nameless regional shell
];

// ─── Regional container names (fix missing name field) ─────────────
const SET_NAMES = {
  'world-traditions': 'World Traditions',
  'east-asia': 'East Asia',
  'south-asia': 'South Asia',
  'middle-east-africa': 'Middle East & Africa',
  'americas': 'Americas',
  'mesoamerican': 'Mesoamerican',
  'oceania': 'Oceania',
};

// ─── Fix orphaned children (comma-separated parent → array) ────────
const FIX_ORPHAN_PARENTS = {
  'chinese-astrology': ['chinese-classics', 'astrology'],
  'chinese-divination-cosmology': ['chinese-classics', 'astrology'],
  'jyotisha-vedic-astrology': ['indic-traditions', 'astrology'],
};

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const coll = db.collection('collections');

  console.log(DRY_RUN ? '🔍 DRY RUN — no changes will be made\n' : '⚡ EXECUTING — changes will be applied\n');

  let updated = 0;
  let errors = 0;

  // 1. Set parent fields
  for (const [slug, parent] of Object.entries(NEST_UNDER)) {
    const doc = await coll.findOne({ slug });
    if (!doc) {
      console.log(`  ⚠️  ${slug} — not found, skipping`);
      errors++;
      continue;
    }
    // Skip if already has the correct parent
    const currentParent = doc.parent;
    const targetParent = parent;
    if (JSON.stringify(currentParent) === JSON.stringify(targetParent)) {
      console.log(`  ✓  ${slug} — already nested under ${JSON.stringify(parent)}`);
      continue;
    }
    console.log(`  → ${slug} — set parent: ${JSON.stringify(parent)}${currentParent ? ` (was: ${JSON.stringify(currentParent)})` : ''}`);
    if (!DRY_RUN) {
      await coll.updateOne({ slug }, { $set: { parent: targetParent } });
    }
    updated++;
  }

  // 2. Hide shells/catch-alls
  console.log('\n--- Hiding shells & catch-alls ---');
  for (const slug of HIDE) {
    const doc = await coll.findOne({ slug });
    if (!doc) {
      console.log(`  ⚠️  ${slug} — not found`);
      continue;
    }
    if (doc.visible === false) {
      console.log(`  ✓  ${slug} — already hidden`);
      continue;
    }
    console.log(`  → ${slug} — hiding`);
    if (!DRY_RUN) {
      await coll.updateOne({ slug }, { $set: { visible: false } });
    }
    updated++;
  }

  // 3. Fix missing names
  console.log('\n--- Fixing missing names ---');
  for (const [slug, name] of Object.entries(SET_NAMES)) {
    const doc = await coll.findOne({ slug });
    if (!doc) {
      console.log(`  ⚠️  ${slug} — not found`);
      continue;
    }
    if (doc.name) {
      console.log(`  ✓  ${slug} — already has name "${doc.name}"`);
      continue;
    }
    console.log(`  → ${slug} — setting name: "${name}"`);
    if (!DRY_RUN) {
      await coll.updateOne({ slug }, { $set: { name } });
    }
    updated++;
  }

  // 4. Fix orphaned children (comma-separated parents)
  console.log('\n--- Fixing orphaned children ---');
  for (const [slug, parents] of Object.entries(FIX_ORPHAN_PARENTS)) {
    const doc = await coll.findOne({ slug });
    if (!doc) {
      console.log(`  ⚠️  ${slug} — not found`);
      continue;
    }
    console.log(`  → ${slug} — fix parent: ${JSON.stringify(doc.parent)} → ${JSON.stringify(parents)}`);
    if (!DRY_RUN) {
      await coll.updateOne({ slug }, { $set: { parent: parents } });
    }
    updated++;
  }

  console.log(`\n✅ ${DRY_RUN ? 'Would update' : 'Updated'} ${updated} collections (${errors} not found)`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
