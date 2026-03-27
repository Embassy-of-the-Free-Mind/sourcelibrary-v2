#!/usr/bin/env node
/**
 * Backfill knowledge_domain with the new 48-domain vocabulary.
 *
 * Strategy:
 *   1. Map existing categories → new domains (free, ~67% coverage)
 *   2. Map old v1 domain values → new domains where 1:1
 *   3. Leave unmapped books for Phase 2 (Gemini tagger)
 *
 * Writes to faceted_tags.knowledge_domain and records provenance.
 * Does NOT touch books that already have v2 domains.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-domains-v2.mjs
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-domains-v2.mjs --dry-run
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-domains-v2.mjs --dry-run --show-unmapped
 *
 * Ref: GitHub issue #368
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);
const DRY_RUN = args['dry-run'] === 'true';
const SHOW_UNMAPPED = args['show-unmapped'] === 'true';

// ─── The 48 valid domain IDs ────────────────────────────────────────

const VALID_DOMAINS = new Set([
  // Philosophy & Thought
  'philosophy', 'theology', 'mysticism', 'cosmology', 'history',
  // Science & Nature
  'astronomy', 'mathematics', 'medicine', 'pharmacology', 'natural-history',
  'natural-philosophy', 'chemistry', 'geography',
  // The Hidden Arts
  'alchemy', 'astrology', 'magic', 'divination', 'kabbalah',
  // Esoteric Currents
  'hermeticism', 'neoplatonism', 'esotericism', 'freemasonry', 'rosicrucianism', 'theosophy',
  // Sacred & Devotional
  'scripture', 'devotion', 'prophecy',
  // World Knowledge Systems
  'daoism', 'buddhism', 'sufism', 'gnosticism', 'demonology',
  // Human Affairs
  'politics', 'military', 'law', 'economics', 'architecture',
  // Language, Art & Culture
  'literature', 'language', 'music', 'art', 'technology', 'education',
  // Reference
  'encyclopedia', 'bibliography',
  // Material & Manuscript
  'cryptography', 'printing', 'emblematics',
]);

// ─── Category → Domain mapping ──────────────────────────────────────
// Keys are lowercase category names from the books.categories array.
// Values are arrays of domain IDs (a category can map to multiple domains).

const CATEGORY_TO_DOMAINS = {
  // Direct 1:1 matches
  'philosophy': ['philosophy'],
  'theology': ['theology'],
  'medicine': ['medicine'],
  'mathematics': ['mathematics'],
  'history': ['history'],
  'astronomy': ['astronomy'],
  'alchemy': ['alchemy'],
  'astrology': ['astrology'],
  'divination': ['divination'],
  'kabbalah': ['kabbalah'],
  'military': ['military'],
  'literature': ['literature'],
  'music': ['music'],
  'geography': ['geography'],
  'chemistry': ['chemistry'],
  'architecture': ['architecture'],
  'law': ['law'],
  'art': ['art'],
  'demonology': ['demonology'],

  // Science categories → specific new domains
  'natural-philosophy': ['natural-philosophy'],
  'botany': ['pharmacology', 'natural-history'],
  'zoology': ['natural-history'],
  'mineralogy': ['natural-history'],
  'optics': ['natural-philosophy'],
  'physics': ['natural-philosophy'],
  'pharmacology': ['pharmacology'],
  'herbalism': ['pharmacology'],
  'anatomy': ['medicine'],
  'surgery': ['medicine'],

  // Esoteric categories
  'hermeticism': ['hermeticism'],
  'neoplatonism': ['neoplatonism'],
  'ritual-magic': ['magic'],
  'natural-magic': ['magic'],
  'theurgy': ['magic'],
  'freemasonry': ['freemasonry'],
  'rosicrucianism': ['rosicrucianism'],
  'theosophy': ['theosophy'],
  'gnosticism': ['gnosticism'],
  'esotericism': ['esotericism'],
  'occultism': ['esotericism'],
  'occult': ['esotericism'],

  // Sacred & devotional
  'biblical-studies': ['scripture', 'theology'],
  'bible': ['scripture'],
  'devotion': ['devotion'],
  'prayer': ['devotion'],
  'hymns': ['devotion'],
  'hagiography': ['devotion'],
  'liturgy': ['devotion'],
  'prophecy': ['prophecy'],
  'apocalyptic': ['prophecy'],

  // World knowledge systems
  'buddhism': ['buddhism'],
  'hinduism': ['mysticism'], // generic; Gemini will refine
  'sufism': ['sufism'],
  'taoism': ['daoism'],
  'daoism': ['daoism'],
  'confucianism': ['philosophy'], // Confucianism maps to philosophy
  'christian-mysticism': ['mysticism'],
  'mysticism': ['mysticism'],

  // Philosophy sub-categories
  'ethics': ['philosophy'],
  'logic': ['philosophy'],
  'metaphysics': ['philosophy'],
  'epistemology': ['philosophy'],
  'psychology': ['philosophy'],
  'cosmology': ['cosmology'],

  // Human affairs
  'politics': ['politics'],
  'economics': ['economics'],
  'agriculture': ['economics'],
  'diplomacy': ['politics'],

  // Language, art & culture
  'rhetoric': ['language'],
  'grammar': ['language'],
  'philology': ['language'],
  'translation': ['language'],
  'poetry': ['literature'],
  'drama': ['literature'],
  'letters': ['literature'],
  'education': ['education'],
  'pedagogy': ['education'],
  'memory-arts': ['education'],
  'emblem': ['emblematics'],
  'emblematics': ['emblematics'],
  'printing': ['printing'],
  'typography': ['printing'],
  'cryptography': ['cryptography'],
  'ciphers': ['cryptography'],
  'technology': ['technology'],
  'engineering': ['technology'],
  'machines': ['technology'],
  'hydraulics': ['technology'],

  // Reference
  'encyclopedia': ['encyclopedia'],
  'bibliography': ['bibliography'],
  'catalog': ['bibliography'],
  'library-science': ['bibliography'],
  'encyclopedism': ['encyclopedia'],

  // Broad categories that map to multiple
  'cosmography': ['cosmology', 'geography'],
  'iatromathematics': ['astrology', 'medicine'],
  'iatrochemistry': ['chemistry', 'medicine'],
  'spagyrics': ['alchemy', 'pharmacology'],

  // Additional mapped categories from dry run analysis
  'paracelsian': ['chemistry', 'medicine'],
  'linguistics': ['language'],
  'christian-cabala': ['kabbalah'],
  'jewish-kabbalah': ['kabbalah'],
  'occult-philosophy': ['esotericism'],
  'lullism': ['philosophy'],
  'prisca-theologia': ['esotericism'],
  'hermetica': ['hermeticism'],
  'syriac-christianity': ['theology'],
  'florentine-platonism': ['neoplatonism'],
  'spiritual-alchemy': ['alchemy', 'mysticism'],
  'pythagoreanism': ['philosophy', 'mathematics'],
  'christian-theosophy': ['theosophy'],
  'witchcraft': ['demonology'],
  'early-science': ['natural-philosophy'],
  'royal-and-court-poetry': ['literature'],
  'hymns-and-songs': ['devotion'],
  'literary-letters': ['literature'],
  'myths-and-epics': ['literature'],
  'proverb-collections': ['literature'],
  'magic': ['magic'],
  'templar': ['freemasonry'],
  'renaissance': [], // era label, not a domain — skip
  'babylon': ['history'],
  'isin/larsa': ['history'],

  // Cuneiform/ANE categories
  'enlil-(ellil)-hymns': ['devotion'],
  'nanna/suen-hymns': ['devotion'],
  'inana/ishtar-hymns': ['devotion'],
  'utu/shamash-hymns': ['devotion'],
  'temple-hymns': ['devotion'],
  'royal-hymns': ['devotion'],
  'lamentations': ['devotion'],
  'incantations': ['magic'],
  'wisdom-literature': ['philosophy'],
  'divination-texts': ['divination'],
  'mathematical-texts': ['mathematics'],
  'astronomical-texts': ['astronomy'],
  'medical-texts': ['medicine'],
  'legal-texts': ['law'],
  'administrative-texts': ['economics'],
  'lexical-texts': ['language'],
  'school-texts': ['education'],

  // Additional from dry run pass 2
  'manuscripts': [], // physical form, not a domain
  'science': ['natural-philosophy'],
  'spirituality': ['mysticism'],
  'religion': ['theology'],
  'esoterica': ['esotericism'],
  'wisdom-and-debate': ['philosophy'],
  'vedanta': ['philosophy', 'mysticism'],
  'christianity': ['theology'],
  'music-theory': ['music'],
  'mechanics': ['technology'],
  'biography': ['history'],
  'mythology': ['literature'],
  'geometry': ['mathematics'],
  'natural_magic': ['magic'],
  'biblical-interpretation': ['scripture', 'theology'],
  'illuminati': ['freemasonry'],
  'ars-notoria': ['magic'],
  'supernatural': ['demonology'],
  'patristics': ['theology'],
  'political-philosophy': ['politics', 'philosophy'],
  'superstition': ['demonology'],
  'natural-history': ['natural-history'],
  'other-cities': [], // provenance, not domain
  'florence': [], // location, not domain
};

// ─── Old v1 domain → new v2 domain mapping ──────────────────────────
// The DB currently has these from the migration: sacred, cosmos, practice,
// divination, governance, philosophy, medicine, mathematics, history, literature, military

const V1_TO_V2 = {
  'sacred': ['theology'],        // too broad; Gemini will refine some
  'cosmos': ['astronomy'],       // was natural-science→cosmos
  'practice': ['magic'],         // was esoteric-arts→practice (ritual/meditation)
  'divination': ['divination'],  // already fine
  'governance': ['politics'],    // was law-politics→governance
  'philosophy': ['philosophy'],
  'medicine': ['medicine'],
  'mathematics': ['mathematics'],
  'history': ['history'],
  'literature': ['literature'],
  'military': ['military'],
  // Old names that might still exist
  'theology': ['theology'],
  'natural-science': ['natural-philosophy'],
  'law-politics': ['politics', 'law'],
  'esoteric-arts': ['esotericism'], // shouldn't exist after migration, but just in case
};

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  console.log('=== Knowledge Domain Backfill v2 (48 domains) ===\n');
  if (DRY_RUN) console.log('[DRY RUN]\n');

  // Fetch all books with pages (skip catalog stubs)
  const books = await db.collection('books').find(
    { pages_count: { $gt: 0 }, hidden: { $ne: true } },
    { projection: {
      _id: 1, id: 1, title: 1, categories: 1,
      'faceted_tags.knowledge_domain': 1,
      'tag_sources.knowledge_domain': 1,
    }}
  ).toArray();

  console.log(`Total visible books with pages: ${books.length}\n`);

  const stats = {
    alreadyV2: 0,
    mappedFromCategories: 0,
    mappedFromV1: 0,
    unmapped: 0,
    updated: 0,
  };

  const unmappedCategories = new Map();
  const domainCounts = new Map();

  for (const book of books) {
    const currentDomains = book.faceted_tags?.knowledge_domain || [];

    // Check if already has v2 domains (skip if all current domains are valid v2)
    const allV2 = currentDomains.length > 0 && currentDomains.every(d => VALID_DOMAINS.has(d));
    if (allV2) {
      stats.alreadyV2++;
      for (const d of currentDomains) domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
      continue;
    }

    // Try category mapping first
    const cats = book.categories || [];
    const newDomains = new Set();

    for (const cat of cats) {
      const lower = cat.toLowerCase().replace(/\s+/g, '-');
      const mapped = CATEGORY_TO_DOMAINS[lower];
      if (mapped && mapped.length > 0) {
        for (const d of mapped) newDomains.add(d);
      } else if (mapped && mapped.length === 0) {
        // Explicitly skipped (e.g. 'renaissance' is an era, not a domain)
      } else {
        unmappedCategories.set(cat, (unmappedCategories.get(cat) || 0) + 1);
      }
    }

    // Special handling: Kloss Collection books default to freemasonry
    if (newDomains.size === 0 && cats.includes('Kloss Collection')) {
      newDomains.add('freemasonry');
    }

    // If no category match, try mapping old v1 domain values
    if (newDomains.size === 0 && currentDomains.length > 0) {
      for (const oldDomain of currentDomains) {
        const mapped = V1_TO_V2[oldDomain];
        if (mapped) {
          for (const d of mapped) newDomains.add(d);
        }
      }
      if (newDomains.size > 0) stats.mappedFromV1++;
    }

    if (newDomains.size > 0 && !allV2) {
      if (newDomains.size > 0 && currentDomains.length === 0) stats.mappedFromCategories++;

      const domains = [...newDomains].slice(0, 3); // respect cardinality max
      for (const d of domains) domainCounts.set(d, (domainCounts.get(d) || 0) + 1);

      if (!DRY_RUN) {
        await db.collection('books').updateOne(
          { _id: book._id },
          {
            $set: {
              'faceted_tags.knowledge_domain': domains,
              'field_provenance.knowledge_domain': {
                source: 'category_mapping_v2',
                method: 'deterministic',
                confidence: 0.85,
                date: new Date(),
              },
            },
          }
        );
        stats.updated++;
      }
    } else if (newDomains.size === 0) {
      stats.unmapped++;
    }
  }

  // ─── Report ─────────────────────────────────────────────────────

  console.log('=== Results ===\n');
  console.log(`  Already v2:          ${stats.alreadyV2}`);
  console.log(`  Mapped (categories): ${stats.mappedFromCategories}`);
  console.log(`  Mapped (v1 domain):  ${stats.mappedFromV1}`);
  console.log(`  Unmapped:            ${stats.unmapped}`);
  if (!DRY_RUN) console.log(`  DB updates:          ${stats.updated}`);

  const coverage = ((books.length - stats.unmapped) / books.length * 100).toFixed(1);
  console.log(`\n  Coverage: ${coverage}% (${books.length - stats.unmapped}/${books.length})`);

  console.log('\n=== Domain Distribution ===\n');
  const sorted = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [domain, count] of sorted) {
    console.log(`  ${String(count).padStart(6)} ${domain}`);
  }

  if (SHOW_UNMAPPED) {
    console.log('\n=== Unmapped Categories (top 30) ===\n');
    const topUnmapped = [...unmappedCategories.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);
    for (const [cat, count] of topUnmapped) {
      console.log(`  ${String(count).padStart(6)} ${cat}`);
    }
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
