#!/usr/bin/env node
/**
 * Facet Redesign Phase 1: Free mappings from existing metadata.
 *
 * Derives faceted_tags from data already in the database:
 *   - material_type: from categories + language field
 *   - era: from published/year field
 *   - region: from language + contributing_library
 *   - knowledge_domain: from existing categories (texts only)
 *   - tradition: from existing categories (texts only, optional)
 *   - technique: from linked_art.object_type (art only)
 *
 * All provenance tracked in tag_sources.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-facets-phase1.mjs
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-facets-phase1.mjs --dry-run
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-facets-phase1.mjs --limit=100
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
const LIMIT = args.limit ? parseInt(args.limit) : 0;

// ─── Material Type Mapping ─────────────────────────────────────────

function deriveMaterialType(book) {
  const cats = book.categories || [];

  // Artwork: visual art items
  if (cats.some(c => c.startsWith('Visual Art'))) return 'artwork';
  if (book.language === 'Visual') return 'artwork';

  // Manuscripts: handwritten, scrolls, tablets
  const title = (book.title || '').toLowerCase();
  if (title.includes('tablet') || cats.some(c => c.toLowerCase().includes('cuneiform'))) return 'manuscript';
  if (title.includes('manuscript') || title.match(/\bms\b\.?\s/i) || cats.some(c => c === 'Dunhuang')) return 'manuscript';

  return 'book'; // default: printed books
}

// ─── Era Mapping ───────────────────────────────────────────────────

function deriveEra(book) {
  const yearStr = book.published || book.year;
  if (!yearStr) return null;

  // Extract year from various formats
  let year = null;
  const match = String(yearStr).match(/-?\d{3,4}/);
  if (match) year = parseInt(match[0]);

  // Handle century strings
  if (!year) {
    const centuryMatch = String(yearStr).match(/(\d{1,2})(?:th|st|nd|rd)\s*century/i);
    if (centuryMatch) year = (parseInt(centuryMatch[1]) - 1) * 100 + 50; // mid-century
  }

  if (!year) return null;

  if (year < 500) return 'ancient';
  if (year < 1400) return 'medieval';
  if (year < 1600) return 'renaissance';
  if (year < 1800) return 'early-modern';
  return 'modern';
}

// ─── Cultural Region Mapping ───────────────────────────────────────

const LANGUAGE_TO_REGION = {
  'Latin': 'western-european',
  'German': 'western-european',
  'French': 'western-european',
  'Dutch': 'western-european',
  'Italian': 'western-european',
  'Spanish': 'western-european',
  'Portuguese': 'western-european',
  'English': 'british',
  'Greek': 'greco-roman',
  'Ancient Greek': 'greco-roman',
  'Hebrew': 'jewish',
  'Aramaic': 'jewish',
  'Arabic': 'islamic',
  'Persian': 'persian',
  'Middle Persian': 'persian',
  'Parthian': 'central-asian',
  'Sogdian': 'central-asian',
  'Sogdian (script); Sogdian': 'central-asian',
  'Sogdian; Sogdian (script)': 'central-asian',
  'Sanskrit': 'indian',
  'Pali': 'indian',
  'Hindi': 'indian',
  'Tamil': 'indian',
  'Chinese': 'chinese',
  'Chinese; Chinese (script)': 'chinese',
  'Chinese (script); Chinese': 'chinese',
  'Japanese': 'japanese',
  'Korean': 'korean',
  'Syriac': 'islamic',
  'Coptic': 'greco-roman',
  'Demotic': 'greco-roman',
  'Egyptian': 'greco-roman',
  'Tibetan': 'central-asian',
  'Mongolian': 'central-asian',
  'Sumerian': 'ancient-near-east',
  'Akkadian': 'ancient-near-east',
  'Russian': 'western-european',
  'Swedish': 'western-european',
  'Danish': 'western-european',
  'Czech': 'western-european',
  'Polish': 'western-european',
  'Hungarian': 'western-european',
};

function deriveRegion(book) {
  const lang = book.language;
  if (!lang || lang === 'Unknown' || lang === 'Visual' || lang === 'not applicable') return null;

  // Handle compound languages like "Latin-German"
  const primary = lang.split(/[-;,]/)[0].trim();
  return LANGUAGE_TO_REGION[primary] || LANGUAGE_TO_REGION[lang] || null;
}

// ─── Knowledge Domain Mapping (texts only) ─────────────────────────

const CATEGORY_TO_DOMAIN = {
  'theology': 'theology',
  'philosophy': 'philosophy',
  'natural-philosophy': 'natural-science',
  'medicine': 'medicine',
  'botany': 'natural-science',
  'astronomy': 'natural-science',
  'mathematics': 'mathematics',
  'history': 'history',
  'literature': 'literature',
  'politics': 'law-politics',
  'geography': 'natural-science',
  'alchemy': 'esoteric-arts',
  'astrology': 'esoteric-arts',
  'ritual-magic': 'esoteric-arts',
  'divination': 'esoteric-arts',
  'biblical-studies': 'theology',
  'kabbalah': 'esoteric-arts',
  'psychology': 'philosophy',
  'ethics': 'philosophy',
  'logic': 'philosophy',
  'rhetoric': 'literature',
  'law': 'law-politics',
  'music': 'mathematics',
  'optics': 'natural-science',
  'zoology': 'natural-science',
  'mineralogy': 'natural-science',
  'chemistry': 'natural-science',
  'physics': 'natural-science',
  'military': 'military',
};

function deriveDomains(book) {
  const cats = book.categories || [];
  const domains = new Set();

  for (const cat of cats) {
    const lower = cat.toLowerCase();
    if (CATEGORY_TO_DOMAIN[lower]) {
      domains.add(CATEGORY_TO_DOMAIN[lower]);
    }
  }

  return [...domains];
}

// ─── Tradition Mapping (texts only, optional) ──────────────────────

const CATEGORY_TO_TRADITION = {
  'hermeticism': 'hermetic',
  'alchemy': 'alchemical',
  'Freemasonry': 'masonic',
  'Manichaeism': 'manichaean',
  'rosicrucianism': 'rosicrucian',
  'Rosicrucianism': 'rosicrucian',
  'neoplatonism': 'neoplatonic',
  'christian-mysticism': 'christian-mystical',
  'mysticism': null, // too generic — skip
  'kabbalah': 'kabbalistic',
  'Buddhism': 'buddhist',
  'Hinduism': 'vedic',
  'Sufism': 'sufi',
  'Taoism': 'daoist',
  'Daoism': 'daoist',
  'Confucianism': 'confucian',
  'Templar': 'masonic', // close enough for faceting
  'theosophy': 'theosophical',
  'new-thought': 'enlightenment',
};

function deriveTraditions(book) {
  const cats = book.categories || [];
  const traditions = new Set();

  for (const cat of cats) {
    const mapped = CATEGORY_TO_TRADITION[cat];
    if (mapped) traditions.add(mapped);
  }

  // Dunhuang manuscripts are primarily Buddhist/Manichaean
  if (cats.includes('Dunhuang')) {
    if (cats.includes('Manichaeism') || cats.some(c => c.toLowerCase().includes('manich'))) {
      traditions.add('manichaean');
    }
    if (!traditions.has('manichaean')) {
      traditions.add('buddhist'); // default for Dunhuang
    }
  }

  return [...traditions];
}

// ─── Art Technique Mapping (art only) ──────────────────────────────

function deriveTechnique(book) {
  const objType = book.linked_art?.object_type;
  if (!objType) return null;

  const lower = objType.toLowerCase();
  if (lower.includes('print') || lower.includes('prent')) return ['engraving']; // most Rijksmuseum prints are engravings
  if (lower.includes('map')) return ['engraving'];
  if (lower.includes('photograph')) return ['photograph'];

  // Could refine with material_aats (Getty codes) in future
  return null;
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  console.log('=== Facet Redesign Phase 1: Free Mappings ===\n');
  if (DRY_RUN) console.log('[DRY RUN]\n');

  const query = { hidden: { $ne: true } };
  const total = await db.collection('books').countDocuments(query);
  console.log(`Total visible books: ${total}`);

  const pipeline = [
    { $match: query },
    { $project: {
      id: 1,
      title: 1,
      language: 1,
      categories: 1,
      published: 1,
      year: 1,
      'linked_art.object_type': 1,
      'linked_art.material_aats': 1,
      contributing_library: 1,
    }},
    { $sort: { _id: 1 } },
  ];
  if (LIMIT) pipeline.push({ $limit: LIMIT });

  const books = await db.collection('books').aggregate(pipeline).toArray();
  console.log(`Processing: ${books.length}\n`);

  const stats = {
    material_type: {},
    era: { tagged: 0, null: 0 },
    region: { tagged: 0, null: 0 },
    domain: { tagged: 0, null: 0 },
    tradition: { tagged: 0, null: 0 },
    technique: { tagged: 0, null: 0 },
  };

  let updated = 0;

  for (const book of books) {
    const materialType = deriveMaterialType(book);
    const era = deriveEra(book);
    const region = deriveRegion(book);
    const isText = materialType === 'book' || materialType === 'manuscript';
    const isArt = materialType === 'artwork';

    const domains = isText ? deriveDomains(book) : [];
    const traditions = isText ? deriveTraditions(book) : [];
    const technique = isArt ? deriveTechnique(book) : null;

    // Track stats
    stats.material_type[materialType] = (stats.material_type[materialType] || 0) + 1;
    era ? stats.era.tagged++ : stats.era.null++;
    region ? stats.region.tagged++ : stats.region.null++;
    if (isText) { domains.length ? stats.domain.tagged++ : stats.domain.null++; }
    if (isText) { traditions.length ? stats.tradition.tagged++ : stats.tradition.null++; }
    if (isArt) { technique ? stats.technique.tagged++ : stats.technique.null++; }

    // Build the faceted_tags object
    const facetedTags = {
      material_type: materialType,
      tagged_at: new Date(),
      tag_sources: { material_type: 'category_mapping' },
    };

    if (era) {
      facetedTags.era = [era];
      facetedTags.tag_sources.era = 'metadata_derivation';
    }
    if (region) {
      facetedTags.region = [region];
      facetedTags.tag_sources.region = 'metadata_derivation';
    }
    if (domains.length) {
      facetedTags.knowledge_domain = domains;
      facetedTags.tag_sources.knowledge_domain = 'category_mapping';
    }
    if (traditions.length) {
      facetedTags.tradition = traditions;
      facetedTags.tag_sources.tradition = 'category_mapping';
    }
    if (technique) {
      facetedTags.technique = technique;
      facetedTags.tag_sources.technique = 'metadata_derivation';
    }

    if (!DRY_RUN) {
      await db.collection('books').updateOne(
        { _id: book._id },
        { $set: { faceted_tags: facetedTags } }
      );
    }
    updated++;
  }

  console.log('=== Results ===\n');
  console.log('Material Type:');
  for (const [k, v] of Object.entries(stats.material_type).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(6)} ${k}`);
  }

  console.log(`\nEra:        ${stats.era.tagged} tagged, ${stats.era.null} unknown`);
  console.log(`Region:     ${stats.region.tagged} tagged, ${stats.region.null} unknown`);
  console.log(`Domain:     ${stats.domain.tagged} tagged, ${stats.domain.null} untagged (texts only)`);
  console.log(`Tradition:  ${stats.tradition.tagged} tagged, ${stats.tradition.null} untagged (texts only, expected — tradition is optional)`);
  console.log(`Technique:  ${stats.technique.tagged} tagged, ${stats.technique.null} untagged (art only)`);

  console.log(`\nTotal updated: ${updated}`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
