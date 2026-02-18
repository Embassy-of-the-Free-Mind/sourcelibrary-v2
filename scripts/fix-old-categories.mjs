#!/usr/bin/env node
/**
 * Fix books from early enrichment runs (1-3) that got old generic categories
 * like "Religion & Theology" instead of proper LIBRARY_CATEGORIES slugs.
 *
 * Also maps variant/capitalized forms (e.g. "Hermeticism", "Alchemy",
 * "Natural Philosophy") to their proper slug equivalents.
 *
 * Usage:
 *   secret-lover run -- node scripts/fix-old-categories.mjs --dry-run
 *   secret-lover run -- node scripts/fix-old-categories.mjs --apply
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

// ── Valid LIBRARY_CATEGORIES slugs ──────────────────────────────────
const VALID_SLUGS = new Set([
  'alchemy', 'hermeticism', 'jewish-kabbalah', 'christian-cabala',
  'neoplatonism', 'rosicrucianism', 'freemasonry', 'natural-philosophy',
  'astrology', 'natural-magic', 'ritual-magic', 'theurgy', 'mysticism',
  'theology', 'medicine', 'gnosticism', 'theosophy', 'pythagoreanism',
  'divination', 'ars-notoria', 'paracelsian', 'spiritual-alchemy',
  'christian-mysticism', 'prisca-theologia', 'florentine-platonism',
  'astronomy', 'mathematics', 'botany', 'chemistry', 'geography',
  'history', 'law', 'literature', 'linguistics', 'music', 'architecture',
  'art', 'military', 'politics', 'philosophy', 'sufism', 'vedanta',
  'buddhism', 'daoism', 'biblical-studies',
  // Period tags
  'renaissance', 'reformation', 'enlightenment', '19th-century-revival',
]);

// ── Map variant/old forms to valid slugs ────────────────────────────
// Keys are lowercased for matching. Values are arrays of slug(s) to replace with.
const VARIANT_MAP = {
  // Old generic categories from runs 1-3
  'religion & theology': ['theology'],
  'science': ['natural-philosophy'],
  'literature & poetry': ['literature'],
  'medicine & health': ['medicine'],
  'mathematics & astronomy': ['mathematics', 'astronomy'],
  'occult & esoteric': [],  // too vague — drop, trust specific tags
  'music & art': ['music', 'art'],

  // Capitalized forms of valid slugs
  'hermeticism': ['hermeticism'],
  'alchemy': ['alchemy'],
  'natural philosophy': ['natural-philosophy'],
  'neoplatonism': ['neoplatonism'],
  'astrology': ['astrology'],
  'kabbalah': ['jewish-kabbalah'],
  'rosicrucianism': ['rosicrucianism'],
  'mysticism': ['mysticism'],
  'astronomy': ['astronomy'],
  'chemistry': ['chemistry'],
  'magic & occult': ['ritual-magic'],
  'medicine & pharmacology': ['medicine'],
  'botany & natural history': ['botany'],
  'linguistics & grammar': ['linguistics'],
  'mathematics & geometry': ['mathematics'],
  'geography & travel': ['geography'],
  'politics & governance': ['politics'],
  'art & illustration': ['art'],
  'military & warfare': ['military'],
  'magic': ['ritual-magic'],
  'occultism': ['ritual-magic'],
  'loeb classical library': [],  // not a category, drop
  'scientific revolution': ['natural-philosophy'],
  'technology & engineering': [],  // no slug, drop
  'law': ['law'],
  'music': ['music'],
  'physics': ['natural-philosophy'],
  'mathematics': ['mathematics'],
  'manuscript facsimiles': [],  // format, not subject
  'cosmology': ['natural-philosophy'],
  'platonism': ['neoplatonism'],
  'bible': ['biblical-studies'],
  'biblical manuscripts': ['biblical-studies'],
  'ethics': ['philosophy'],
  'indian philosophy': ['philosophy', 'vedanta'],
  'critical philosophy': ['philosophy'],
  'greek literature': ['literature'],
  'original language texts': [],  // format, drop
  'blavatsky': ['theosophy'],
  'confucianism': [],  // no slug
  'stoicism': ['philosophy'],
  'natural history': ['botany'],
  'classical medicine': ['medicine'],
  'ancient medicine': ['medicine'],
  'medieval manuscripts': [],  // format, drop
  'physiology': ['medicine'],
  'egyptology': ['history'],
  'byzantine history': ['history'],
  'greek magical papyri': ['ritual-magic'],
  'septuagint': ['biblical-studies'],
  'manuscripts': [],  // format, drop
  'natural_magic': ['natural-magic'],
  'modern philosophy': ['philosophy'],
  'tantra': ['vedanta'],
  'hieroglyphics': ['linguistics'],
  'logic': ['philosophy'],
  'anatomy': ['medicine'],
  'chinese classics': ['history'],
  'epistemology': ['philosophy'],
  'islamic mysticism': ['sufism'],
  'hermetica': ['hermeticism'],
  'ficino': ['florentine-platonism'],
  'psychology': ['philosophy'],
  'classical-antiquity': ['history'],
  'monasticism': [],  // drop
  'persian poetry': ['literature', 'sufism'],
  'renaissance-science': ['natural-philosophy', 'renaissance'],
  'mechanics': ['natural-philosophy'],
  'classical philosophy': ['philosophy'],
  'reference': [],
  'böhme': ['christian-mysticism'],
  'natural-theology': ['theology'],
  'anthology': [],
  'new testament': ['biblical-studies'],
  'philosophy of science': ['philosophy', 'natural-philosophy'],
  'primary-source': ['history'],
  'encyclopedia': [],
  'arabic alchemy': ['alchemy'],
  'renaissance science': ['natural-philosophy', 'renaissance'],
  'women-authors': [],
  'medicine': ['medicine'],
  'patristics': ['theology'],
  'heliocentrism': ['astronomy'],
  'experiments': ['natural-philosophy'],
  'scientific-method': ['natural-philosophy'],
  'papyri': [],
  'galileo': ['natural-philosophy', 'astronomy'],
  'natural-history': ['botany'],
  'occult philosophy': ['natural-magic'],
  'sanskrit': ['linguistics'],
  'calculus': ['mathematics'],
  'cambridge platonism': ['neoplatonism'],
  'poetry': ['literature'],
  'desert fathers': ['christian-mysticism'],
  'plotinus': ['neoplatonism'],
  'hermetic philosophy': ['hermeticism'],
  'teleology': ['philosophy'],
  'political philosophy': ['politics', 'philosophy'],
  'political-philosophy': ['politics', 'philosophy'],
  'upanishads': ['vedanta'],
  'crowley': ['ritual-magic'],
  'hesychasm': ['christian-mysticism'],
  'incunabula': [],
  'corpus hermeticum': ['hermeticism'],
  'thelema': ['ritual-magic'],
  'humanism': ['philosophy', 'renaissance'],
  'cryptography': ['mathematics'],
  'magnetism': ['natural-philosophy'],
  'ancient religion': ['theology'],
  'rosicrucian': ['rosicrucianism'],
  'skepticism': ['philosophy'],
  'combinatorics': ['mathematics'],
  'satire': ['literature'],
  'apophatic theology': ['theology', 'mysticism'],
  'yoga': ['vedanta'],
  'scottish enlightenment': ['philosophy', 'enlightenment'],
  'contemplative prayer': ['christian-mysticism'],
  'polyglot': ['biblical-studies'],
  'philology': ['linguistics'],
  'iatrochemistry': ['paracelsian', 'medicine'],
  'zoroastrianism': ['prisca-theologia'],
  'mythology': ['history'],
  'renaissance philosophy': ['philosophy', 'renaissance'],
  'witchcraft': ['ritual-magic'],
  'pansophism': ['prisca-theologia'],
  'paracelsus': ['paracelsian'],
  'chinese philosophy': ['philosophy'],
  'medieval philosophy': ['philosophy'],
  'christianity': ['theology'],
  'kashmir shaivism': ['vedanta'],
  'microscopy': ['natural-philosophy'],
  'english mysticism': ['christian-mysticism'],
  'rhineland mysticism': ['christian-mysticism'],
  'demonology': ['ritual-magic'],
  'geology': ['natural-philosophy'],
  'flemish mysticism': ['christian-mysticism'],
  'solomonic': ['ritual-magic'],
  'florentine academy': ['florentine-platonism'],
  'materia medica': ['medicine'],
  'herculaneum': ['history'],
  'modern occultism': ['ritual-magic'],
  'chaldean oracles': ['theurgy'],
  'herbalism': ['medicine', 'botany'],
  'greek religion': ['theology', 'history'],
  'taoism': ['daoism'],
  'neidan': ['daoism'],
  'lullian art': ['ars-notoria'],
  'lullism': ['ars-notoria'],
  'paracelsian': ['paracelsian'],
  'pharmacology': ['medicine'],
  'medical history': ['medicine', 'history'],
  'kepler': ['astronomy'],
  'geomancy': ['divination'],
  'celestial magic': ['astrology'],
  'astral magic': ['astrology'],
  'angelic magic': ['ritual-magic'],
  'angel-magic': ['ritual-magic'],
  'ceremonial magic': ['ritual-magic'],
  'jewish mysticism': ['jewish-kabbalah'],
  'cabala': ['christian-cabala'],
  'biblical studies': ['biblical-studies'],
  'biblical criticism': ['biblical-studies'],
  'german idealism': ['philosophy'],
  'german rationalism': ['philosophy'],
  'rationalism': ['philosophy'],
  'metaphysics': ['philosophy'],
  'medici': ['florentine-platonism'],
  'florence': ['florentine-platonism'],
  'moral philosophy': ['philosophy'],
  'moral-philosophy': ['philosophy'],
  'scholasticism': ['theology', 'philosophy'],
  'printing': ['history'],
  'enochian': ['ritual-magic'],
  'scrying': ['divination'],
  'talismanic-magic': ['natural-magic'],
  'picatrix': ['natural-magic', 'astrology'],
  'esoteric-christianity': ['christian-mysticism'],
  'christian-philosophy': ['theology', 'philosophy'],
  'platonic-love': ['neoplatonism', 'florentine-platonism'],
  'platonic theology': ['neoplatonism'],
  'spiritism': ['theosophy'],
  'steiner': ['theosophy'],
  'anthroposophy': ['theosophy'],
  'inner alchemy': ['spiritual-alchemy'],
  'music-of-spheres': ['pythagoreanism', 'music'],
  'music theory': ['music'],
  'optics': ['natural-philosophy'],
  'negative-theology': ['theology', 'mysticism'],
  'ars magna': ['ars-notoria'],
  'arabic-sources': [],
  'ancient-philosophy': ['philosophy'],
  'natural-law': ['law', 'philosophy'],
  'commercial-law': ['law'],
  'jewish-philosophy': ['philosophy'],
  'literary-criticism': ['literature'],
  'cosmography': ['geography'],
  // Period tags (capitalized)
  'renaissance': ['renaissance'],
  'medieval': [],
  'enlightenment': ['enlightenment'],
  'reformation': ['reformation'],
  // Language/script labels used as categories — drop (not subjects)
  'byzantine greek': [],
  'greek': [],
  'armenian': [],
  'arabic': [],
  'persian': [],
  'hebrew': [],
  'syriac': [],
  'latin': [],
  'coptic literature': [],

  // Niche tags that map to existing slugs
  'aesthetics': ['art', 'philosophy'],
  'japanese buddhism': ['buddhism'],
  'shingon': ['buddhism'],
  'zen buddhism': ['buddhism'],
  'soto zen': ['buddhism'],
  'tendai': ['buddhism'],
  'algebra': ['mathematics'],
  'geometry': ['mathematics'],
  'analytic geometry': ['mathematics'],
  'variational methods': ['mathematics'],
  'mathematical magic': ['mathematics', 'natural-magic'],
  'calculus': ['mathematics'],
  'biology': ['natural-philosophy'],
  'egypt': ['history'],
  'ancient near east': ['history'],
  'byzantine theology': ['theology'],
  'roman religion': ['theology', 'history'],
  'greek religion': ['theology', 'history'],
  'church fathers': ['theology'],
  'canon law': ['law'],
  'legal texts': ['law'],
  'political economy': ['politics'],
  'christian philosophy': ['theology', 'philosophy'],
  'philosophy of religion': ['theology', 'philosophy'],
  'practical philosophy': ['philosophy'],
  'ontology': ['philosophy'],
  'phenomenology': ['philosophy'],
  'history of philosophy': ['philosophy', 'history'],
  'philosophy of history': ['philosophy', 'history'],
  'classical-philosophy': ['philosophy'],
  'science and religion': ['theology', 'natural-philosophy'],
  'comparative religion': ['theology'],
  'abhinavagupta': ['vedanta'],
  'ibn arabi': ['sufism'],
  'dead sea scrolls': ['biblical-studies'],
  'qumran': ['biblical-studies'],
  'jewish texts': ['jewish-kabbalah'],
  'old testament': ['biblical-studies'],
  'apocrypha': ['biblical-studies'],
  'pseudepigrapha': ['biblical-studies'],
  'tanakh': ['biblical-studies'],
  'genesis commentary': ['biblical-studies'],
  'gnostic': ['gnosticism'],
  'gnostic texts': ['gnosticism'],
  'early christianity': ['theology', 'gnosticism'],
  'magical gems': ['natural-magic'],
  'angelic magic': ['ritual-magic'],
  'astral magic': ['astrology', 'natural-magic'],
  'ficino sources': ['florentine-platonism'],
  'ficino translation': ['florentine-platonism'],
  'asclepius': ['hermeticism'],
  'hermetic': ['hermeticism'],
  'hermetic museum': ['alchemy'],
  'turba philosophorum': ['alchemy'],
  'geber': ['alchemy'],
  'morienus': ['alchemy'],
  'arnaldus de villanova': ['alchemy', 'medicine'],
  'hermetic medicine': ['medicine', 'hermeticism'],
  'bernard of treviso': ['alchemy'],
  'philosophers stone': ['alchemy'],
  'rosarium philosophorum': ['alchemy'],
  'eliphas levi': ['ritual-magic'],
  'art-theory': ['art'],
  'insular art': ['art'],
  'emblems': ['art'],
  'anglo-saxon': ['history'],
  'anglo-saxon literature': ['literature'],
  'gospel manuscripts': ['biblical-studies'],
  'british enlightenment': ['enlightenment', 'philosophy'],
  'medieval mysticism': ['christian-mysticism'],
  'medieval spirituality': ['christian-mysticism'],
  'dominican spirituality': ['christian-mysticism'],
  'mystical theology': ['theology', 'mysticism'],
  'natural theology': ['theology'],
  'subterranean world': ['natural-philosophy'],
  'baroque science': ['natural-philosophy'],
  'lapidaries': ['natural-magic'],
  'occult dictionary': [],
  'waite translation': [],
  'greek documentary papyri': [],
  'comparative': [],
  'microcosm': [],
  'macrocosm-microcosm': [],
  'esoteric studies': [],
  'magic debunking': [],
  'visions': ['mysticism'],
  'iconoclasm': ['theology'],
  'hymnography': ['music'],
  'manuscript analysis': [],
  'intelligence studies': [],
  'mysterious manuscripts': [],
  'ritual practice': ['ritual-magic'],
  'marginalia': [],
  'scientific-revolution': ['natural-philosophy'],
  'hebrew studies': ['biblical-studies'],
  'yantra': ['vedanta'],
  'mantra': ['vedanta'],
  'longevity': ['medicine'],
  'illuminated manuscripts': ['art'],

  // Various one-offs that don't map well — drop
  'biography': [],
  'education': [],
  'illustrated': [],
  'benchmark': [],
  'diary': [],
  'fiction': [],
  'introduction': [],
  'periodicals': [],
  'studies': [],
  'letters': [],
  'merchants': [],
  'analysis': [],
  'autobiography': [],
  'collected works': [],
  'correspondence': [],
  'polemics': [],
  'speculum': [],
  'vatican': [],
  'prayer': [],
  'economics': ['politics'],
  'taxation': [],
  'unknown': [],
  '19th-century-translation': [],
  'bibliography': [],
  'vulgate': ['biblical-studies'],
  'celtic christianity': ['christian-mysticism'],
  'greek manuscripts': ['biblical-studies'],
  'early christian texts': ['theology'],
  'vercelli book': ['literature'],
  'dante': ['literature'],
  'jesuit missions': ['theology'],
  'latin translations': [],
  'aristotle': ['philosophy'],
  'political theory': ['politics', 'philosophy'],
  'copernicus': ['astronomy'],
  'harmony': ['music', 'pythagoreanism'],
  'egyptian mysteries': ['prisca-theologia'],
  'apocalypse': ['biblical-studies'],
};

// ── Env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  try {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^=#]+)=(.*)$/);
      if (match) {
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        env[match[1].trim()] = value;
      }
    }
  } catch (e) { /* no .env.local */ }
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// ── Args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const apply = args.includes('--apply');

if (!dryRun && !apply) {
  console.error('Usage: node scripts/fix-old-categories.mjs --dry-run | --apply');
  process.exit(1);
}

console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'APPLY (writing to DB)'}\n`);

// ── Normalize a single category ─────────────────────────────────────
function normalizeCategory(cat) {
  // Already a valid slug
  if (VALID_SLUGS.has(cat)) return [cat];

  // Look up in variant map (case-insensitive)
  const key = cat.toLowerCase().trim();
  if (key in VARIANT_MAP) return VARIANT_MAP[key];

  // Try simple slug conversion: lowercase, replace spaces with hyphens
  const slug = key.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (VALID_SLUGS.has(slug)) return [slug];

  // Unknown — will be reported
  return null;
}

// ── Main ────────────────────────────────────────────────────────────
const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Find all enriched books that have ANY category that is not a valid slug
// We query broadly and filter in code for accuracy
const books = await db.collection('books')
  .find({
    'ai_metadata.enriched_at': { $exists: true },
    categories: { $exists: true, $ne: [] },
  })
  .project({
    id: 1,
    title: 1,
    display_title: 1,
    author: 1,
    categories: 1,
    'ai_metadata.categories': 1,
    'ai_metadata.enriched_at': 1,
  })
  .sort({ title: 1 })
  .toArray();

console.log(`Scanning ${books.length} enriched books with categories...\n`);

let fixedCount = 0;
let noChangeCount = 0;
let emptyResultCount = 0;
const unmappedCategories = {};

for (const book of books) {
  const existing = book.categories || [];
  const aiSuggested = book.ai_metadata?.categories || [];

  // Check if any category needs normalization
  const hasInvalidSlugs = existing.some(c => !VALID_SLUGS.has(c));
  if (!hasInvalidSlugs) {
    noChangeCount++;
    continue;
  }

  // Normalize each category
  const normalized = new Set();
  const removed = [];
  const mapped = [];
  const unknown = [];

  for (const cat of existing) {
    if (VALID_SLUGS.has(cat)) {
      normalized.add(cat);
    } else {
      const replacement = normalizeCategory(cat);
      if (replacement === null) {
        unknown.push(cat);
        unmappedCategories[cat] = (unmappedCategories[cat] || 0) + 1;
      } else if (replacement.length === 0) {
        removed.push(cat);
      } else {
        mapped.push({ from: cat, to: replacement });
        for (const slug of replacement) normalized.add(slug);
      }
    }
  }

  // Also fold in valid AI-suggested categories
  const validAiSuggested = aiSuggested.filter(c => VALID_SLUGS.has(c));
  for (const slug of validAiSuggested) normalized.add(slug);

  const merged = [...normalized].sort();

  // Check if anything actually changed
  const existingSorted = [...existing].sort();
  const changed = existingSorted.length !== merged.length ||
    !existingSorted.every((c, i) => c === merged[i]);

  if (!changed) {
    noChangeCount++;
    continue;
  }

  fixedCount++;
  const shortTitle = (book.display_title || book.title || '').substring(0, 60);

  if (merged.length === 0) {
    emptyResultCount++;
  }

  console.log(`${fixedCount}. ${shortTitle}`);
  console.log(`   Author: ${book.author || 'Unknown'}`);
  if (removed.length > 0)  console.log(`   DROP:   ${removed.join(', ')}`);
  if (mapped.length > 0)   console.log(`   MAP:    ${mapped.map(m => `${m.from} -> ${m.to.join(', ')}`).join(' | ')}`);
  if (unknown.length > 0)  console.log(`   UNKNOWN: ${unknown.join(', ')} (dropped)`);
  if (validAiSuggested.length > 0) console.log(`   AI add: ${validAiSuggested.join(', ')}`);
  console.log(`   RESULT: [${existing.join(', ')}] -> [${merged.join(', ')}]`);
  console.log();

  if (apply) {
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { categories: merged, updated_at: new Date() } }
    );
  }
}

console.log('─'.repeat(60));
console.log(`Scanned:            ${books.length} enriched books`);
console.log(`Already valid:      ${noChangeCount}`);
console.log(`Would fix:          ${fixedCount}`);
console.log(`  -> empty result:  ${emptyResultCount}`);

if (Object.keys(unmappedCategories).length > 0) {
  console.log(`\nUnmapped categories (dropped, add to VARIANT_MAP if needed):`);
  const sorted = Object.entries(unmappedCategories).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sorted) {
    console.log(`  ${count.toString().padStart(4)}x  ${cat}`);
  }
}

if (apply) {
  console.log(`\nApplied ${fixedCount} updates.`);
} else {
  console.log(`\nRun with --apply to write changes.`);
}

await client.close();
