#!/usr/bin/env node
/**
 * Assign books to thematic collections based on categories, language, and import patterns.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/assign-collections.mjs [--dry-run] [--limit N]
 *
 * Flags:
 *   --dry-run   Show assignments without writing to DB
 *   --limit N   Process only first N books
 */

import { MongoClient } from 'mongodb';

// ── Collection Definitions ──────────────────────────────────────────────────

const COLLECTIONS = [
  {
    slug: 'western-esotericism',
    name: 'Western Esotericism',
    subtitle: 'Hermetica, Alchemy & Rosicrucianism',
    description: 'The Western esoteric tradition from late antiquity through the early modern period — Hermetic philosophy, alchemical transformation, Rosicrucian manifestos, and the underground currents that shaped European intellectual history.',
    color: 'rust',
    order: 1,
    exactCategories: [
      'hermeticism', 'alchemy', 'rosicrucianism', 'theosophy', 'freemasonry',
      'esotericism', 'hermetic-tradition', 'hermetic-philosophy', 'hermetism',
      'paracelsian', 'spagyric', 'chrysopoeia', 'iatrochemistry',
    ],
    patterns: ['hermetic', 'alchem', 'rosicrucian', 'theosoph', 'freemason', 'esoteric', 'spagyr'],
  },
  {
    slug: 'classical-philosophy',
    name: 'Classical Philosophy',
    subtitle: 'Ancient & Renaissance Thought',
    description: 'Greek, Roman, and Renaissance philosophical texts — Plato, Aristotle, the Neoplatonists, Stoics, and their reception through the Latin West.',
    color: 'violet',
    order: 2,
    exactCategories: [
      'philosophy', 'neoplatonism', 'florentine-platonism', 'stoicism', 'platonism',
      'aristotelian', 'metaphysics', 'ethics', 'logic', 'rhetoric', 'dialectic',
      'pre-socratic', 'peripatetic', 'epicurean', 'skepticism', 'cynicism',
      'scholasticism', 'renaissance-philosophy',
    ],
    patterns: ['neoplatoni', 'florentine-platon', 'aristotel', 'platoni', 'peripatetic', 'scholastic'],
    excludeLanguages: ['Chinese', 'Sanskrit', 'Japanese', 'Korean', 'Tibetan', 'Pali', 'Thai', 'Burmese', 'Hindi', 'Bengali'],
  },
  {
    slug: 'theology-sacred-texts',
    name: 'Theology & Sacred Texts',
    subtitle: 'Scripture, Church Fathers & Religious Thought',
    description: 'Biblical texts, patristic writings, reformation theology, and the great religious commentaries — from the earliest manuscripts to printed editions that transformed religious life.',
    color: 'gold',
    order: 3,
    exactCategories: [
      'theology', 'biblical-studies', 'patristics', 'church-fathers', 'reformation',
      'christology', 'soteriology', 'eschatology', 'catechism', 'liturgy',
      'homiletics', 'sermon', 'ecclesiology', 'apologetics', 'dogmatics',
      'canon-law', 'religious-orders', 'hagiography', 'devotional',
    ],
    patterns: ['theolog', 'biblical', 'patristic', 'church-father', 'ecclesiast', 'catechis', 'liturgi', 'homiletic'],
    excludeLanguages: ['Chinese', 'Sanskrit', 'Japanese', 'Korean', 'Tibetan', 'Pali', 'Hindi', 'Bengali'],
  },
  {
    slug: 'natural-philosophy',
    name: 'Natural Philosophy & Science',
    subtitle: 'From Aristotle to Newton',
    description: 'The investigation of the natural world — from ancient cosmology through Renaissance mathematics to the birth of modern science. Copernicus, Kepler, Galileo, Newton, and the natural philosophers who reshaped our understanding of the universe.',
    color: 'sage',
    order: 4,
    exactCategories: [
      'natural-philosophy', 'astronomy', 'mathematics', 'physics', 'chemistry',
      'optics', 'mechanics', 'geography', 'cartography', 'mineralogy',
      'geology', 'meteorology', 'cosmology', 'cosmography', 'navigation',
      'engineering', 'acoustics', 'magnetism', 'electricity',
    ],
    patterns: ['natural-philosoph', 'natural philosoph', 'astronom', 'mathemat', 'cosmograph', 'cartograph', 'mineralog'],
  },
  {
    slug: 'indic-traditions',
    name: 'Indic Traditions',
    subtitle: 'Vedas, Yoga, Tantra & Buddhist Texts',
    description: 'Sacred and philosophical texts from the Indian subcontinent — the Vedas, Upanishads, Yoga sutras, Tantric traditions, Buddhist scriptures, and Ayurvedic medicine spanning three millennia.',
    color: 'gold',
    order: 5,
    exactCategories: [
      'hinduism', 'yoga', 'tantra', 'vedic', 'vedanta', 'ayurveda', 'buddhism',
      'upanishad', 'dharma', 'mantra', 'sutra', 'purana', 'shaivism', 'vaishnavism',
      'jainism', 'sikhism', 'samkhya', 'nyaya', 'vaisheshika', 'mimamsa',
    ],
    patterns: ['hindu', 'yoga', 'tantr', 'vedic', 'veda', 'ayurved', 'buddhis', 'upanishad', 'dharma', 'purana', 'shaiv', 'jain'],
    includeLanguages: ['Sanskrit', 'Pali', 'Hindi', 'Bengali', 'Tibetan'],
  },
  {
    slug: 'chinese-classics',
    name: 'Chinese Classics',
    subtitle: 'Philosophy, Medicine & Military Arts',
    description: 'The literary and philosophical heritage of China — Confucian classics, Daoist scriptures, Buddhist texts, medical treatises, military strategy, and illustrated encyclopedias from imperial China.',
    color: 'gold',
    order: 6,
    exactCategories: [
      'confucianism', 'daoism', 'taoism', 'neo-confucianism', 'legalism',
      'chinese-medicine', 'chinese-philosophy', 'chinese-classics',
    ],
    patterns: ['confucian', 'daoist', 'taoist', 'chinese'],
    includeLanguages: ['Chinese'],
  },
  {
    slug: 'astrology-divination',
    name: 'Astrology & Divination',
    subtitle: 'Celestial Science & Prophetic Arts',
    description: 'The ancient science of the stars and the mantic arts — horoscopes, geomancy, prophecy, and the elaborate systems devised to read the will of heaven in the movements of celestial bodies.',
    color: 'violet',
    order: 7,
    exactCategories: [
      'astrology', 'divination', 'geomancy', 'prophecy', 'prognostication',
      'horoscopy', 'chiromancy', 'physiognomy', 'omen', 'augury', 'lot-book',
      'palmistry', 'scrying', 'oneiromancy',
    ],
    patterns: ['astrolog', 'divinat', 'geomanc', 'prophec', 'prognostic', 'horoscop', 'chiromancy', 'physiognom'],
  },
  {
    slug: 'magic-demonology',
    name: 'Magic & Demonology',
    subtitle: 'Grimoires, Witchcraft & Ritual Practice',
    description: 'Texts of ceremonial magic, demonology, and witchcraft — from the Solomonic grimoires and medieval necromancy to early modern witch-trial literature and the philosophical defense of natural magic.',
    color: 'rust',
    order: 8,
    exactCategories: [
      'ritual-magic', 'demonology', 'witchcraft', 'goetia', 'grimoire',
      'necromancy', 'sorcery', 'conjuration', 'natural-magic', 'theurgy',
      'evocation', 'invocation', 'ceremonial-magic', 'magic',
    ],
    patterns: ['demonolog', 'witchcraft', 'goetia', 'grimoir', 'necromancy', 'sorcery', 'conjurat', 'theurgy'],
    // 'magic' as exact match only — pattern would over-match
  },
  {
    slug: 'medicine-natural-history',
    name: 'Medicine & Natural History',
    subtitle: 'Herbalism, Anatomy & the Living World',
    description: 'Medical treatises, herbals, anatomical atlases, and natural history — the practical knowledge of healing and the systematic study of plants, animals, and the human body.',
    color: 'sage',
    order: 9,
    exactCategories: [
      'medicine', 'botany', 'herbalism', 'pharmacology', 'anatomy',
      'zoology', 'surgery', 'materia-medica', 'medical', 'natural-history',
      'entomology', 'ornithology', 'biology', 'physiology', 'pathology',
      'veterinary', 'obstetrics',
    ],
    patterns: ['medicin', 'botan', 'herbal', 'pharmacol', 'anatom', 'zoolog', 'surgery', 'materia-medica', 'natural-histor'],
  },
  {
    slug: 'mysticism',
    name: 'Mysticism',
    subtitle: 'Christian, Sufi & Contemplative Traditions',
    description: 'The literature of direct divine experience — Christian mystics from Meister Eckhart to Jakob Bohme, Sufi poetry and philosophy, quietism, hesychasm, and the contemplative traditions across cultures.',
    color: 'violet',
    order: 10,
    exactCategories: [
      'mysticism', 'christian-mysticism', 'sufism', 'quietism', 'hesychasm',
      'devotional', 'contemplative', 'spiritual-exercises', 'interior-life',
      'visionary', 'ecstatic', 'bridal-mysticism',
    ],
    patterns: ['mystic', 'contemplat', 'sufis', 'quietis', 'hesychas'],
  },
  {
    slug: 'kabbalah',
    name: 'Kabbalah & Jewish Tradition',
    subtitle: 'Sefirot, Gematria & Sacred Language',
    description: 'Jewish mystical and philosophical traditions — the Zohar, Sefer Yetzirah, Christian Kabbalah, gematria, and the elaborate systems of divine emanation and sacred language.',
    color: 'violet',
    order: 11,
    exactCategories: [
      'kabbalah', 'qabbalah', 'jewish-mysticism', 'jewish-kabbalah',
      'sefirot', 'zohar', 'gematria', 'hebrew-bible', 'talmud',
      'midrash', 'jewish-philosophy',
    ],
    patterns: ['kabbal', 'qabbal', 'jewish-mystic', 'sefir', 'zohar', 'gematri', 'talmud', 'midrash'],
    includeLanguages: ['Hebrew'],
  },
  {
    slug: 'art-illustrated',
    name: 'Art & Illustrated Books',
    subtitle: 'Emblems, Engravings & Visual Knowledge',
    description: 'Books prized for their visual content — emblem books, illustrated encyclopedias, architectural treatises, anatomical atlases, and the masterworks of early modern printmaking.',
    color: 'gold',
    order: 12,
    exactCategories: [
      'art', 'architecture', 'emblem-books', 'iconography', 'illustrated',
      'engraving', 'woodcut', 'calligraphy', 'ornament', 'typography',
      'numismatics', 'heraldry',
    ],
    patterns: ['emblem', 'iconograph', 'engrav', 'woodcut', 'calligraph', 'ornament', 'heraldry', 'numismatic'],
  },
  {
    slug: 'literature',
    name: 'Literature',
    subtitle: 'Poetry, Epic & Early Fiction',
    description: 'Literary works from classical epic to early modern fiction — Homer, Virgil, Dante, alchemical allegories, utopian fiction, and the earliest works of what would become science fiction.',
    color: 'sage',
    order: 13,
    exactCategories: [
      'literature', 'poetry', 'fiction', 'drama', 'epic', 'novel',
      'prose', 'verse', 'satire', 'utopia', 'fable', 'allegory',
      'science-fiction', 'literary-criticism', 'romance',
    ],
    patterns: ['literatur', 'poetry', 'fiction', 'drama', 'satir', 'allegory', 'utopi', 'science-fiction'],
  },
];

// ── Matching Logic ──────────────────────────────────────────────────────────

function normalizeCategory(cat) {
  return (cat || '').toLowerCase().trim().replace(/\s+/g, '-');
}

function matchBook(book, collection) {
  const cats = (book.categories || []).map(normalizeCategory);
  const lang = (book.language || '').trim();

  // Check language exclusions first
  if (collection.excludeLanguages) {
    const excluded = collection.excludeLanguages.some(el =>
      lang.toLowerCase().includes(el.toLowerCase())
    );
    if (excluded && !cats.length) return false; // excluded language with no categories = skip
    // If has matching categories despite excluded language, still consider it
    // (e.g., a Latin translation of a Chinese text categorized as philosophy)
  }

  // Language inclusion (any book in these languages belongs)
  if (collection.includeLanguages) {
    const included = collection.includeLanguages.some(il =>
      lang.toLowerCase().includes(il.toLowerCase())
    );
    if (included) return true;
  }

  // Exact category match
  if (collection.exactCategories) {
    const hasExact = cats.some(c => collection.exactCategories.includes(c));
    if (hasExact) {
      // Check language exclusions for exact matches too
      if (collection.excludeLanguages) {
        const excluded = collection.excludeLanguages.some(el =>
          lang.toLowerCase().includes(el.toLowerCase())
        );
        if (excluded) return false;
      }
      return true;
    }
  }

  // Pattern/substring match
  if (collection.patterns) {
    const hasPattern = cats.some(c =>
      collection.patterns.some(p => c.includes(p))
    );
    if (hasPattern) {
      if (collection.excludeLanguages) {
        const excluded = collection.excludeLanguages.some(el =>
          lang.toLowerCase().includes(el.toLowerCase())
        );
        if (excluded) return false;
      }
      return true;
    }
  }

  return false;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set. Source .env.production.local first.');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Fetch all non-deleted books
  const query = { status: { $ne: 'deleted' } };
  const projection = {
    id: 1, title: 1, author: 1, year: 1, language: 1,
    categories: 1, pages_count: 1, photo: 1, display_title: 1,
  };
  let cursor = db.collection('books').find(query, { projection }).sort({ created_at: 1 });
  if (limit) cursor = cursor.limit(limit);
  const books = await cursor.toArray();
  console.log(`Loaded ${books.length} books\n`);

  // Classify each book
  const collectionBooks = {}; // slug -> [book]
  const bookCollections = {}; // book.id -> [slug]
  let unassigned = 0;

  for (const col of COLLECTIONS) {
    collectionBooks[col.slug] = [];
  }

  for (const book of books) {
    const matched = [];
    for (const col of COLLECTIONS) {
      if (matchBook(book, col)) {
        matched.push(col.slug);
        collectionBooks[col.slug].push(book);
      }
    }
    bookCollections[book.id] = matched;
    if (matched.length === 0) unassigned++;
  }

  // Print summary
  console.log('=== COLLECTION ASSIGNMENTS ===\n');
  for (const col of COLLECTIONS) {
    const count = collectionBooks[col.slug].length;
    const langDist = {};
    for (const b of collectionBooks[col.slug]) {
      const l = b.language || 'Unknown';
      langDist[l] = (langDist[l] || 0) + 1;
    }
    const topLangs = Object.entries(langDist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([l, c]) => `${l}:${c}`)
      .join(', ');
    console.log(`${col.name}: ${count} books (${topLangs})`);
  }

  const totalAssignments = Object.values(bookCollections).reduce((s, a) => s + a.length, 0);
  console.log(`\nTotal assignments: ${totalAssignments} (avg ${(totalAssignments / books.length).toFixed(1)} per book)`);
  console.log(`Unassigned: ${unassigned} books`);

  // Show some unassigned books
  if (unassigned > 0) {
    console.log('\nSample unassigned:');
    let shown = 0;
    for (const book of books) {
      if (bookCollections[book.id].length === 0 && shown < 20) {
        const cats = (book.categories || []).join(', ') || 'none';
        console.log(`  ${book.title?.substring(0, 80)} | lang=${book.language || '?'} | cats=${cats}`);
        shown++;
      }
    }
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No changes written.');
    await client.close();
    return;
  }

  // Write to DB
  console.log('\nWriting to database...');

  // 1. Update books with collections array
  const bulkOps = [];
  for (const book of books) {
    const slugs = bookCollections[book.id] || [];
    bulkOps.push({
      updateOne: {
        filter: { id: book.id },
        update: { $set: { collections: slugs } },
      },
    });
  }

  // Execute in batches
  const BATCH_SIZE = 500;
  let updated = 0;
  for (let i = 0; i < bulkOps.length; i += BATCH_SIZE) {
    const batch = bulkOps.slice(i, i + BATCH_SIZE);
    const result = await db.collection('books').bulkWrite(batch);
    updated += result.modifiedCount;
    process.stdout.write(`  Books: ${Math.min(i + BATCH_SIZE, bulkOps.length)}/${bulkOps.length}\r`);
  }
  console.log(`  Books updated: ${updated}                `);

  // 2. Upsert collection metadata
  const collectionsColl = db.collection('collections');
  for (const col of COLLECTIONS) {
    const bookList = collectionBooks[col.slug];
    // Pick sample books (most notable — prefer those with year, high page count)
    const sampleBooks = bookList
      .filter(b => b.year && b.title)
      .sort((a, b) => (a.year || 9999) - (b.year || 9999))
      .slice(0, 6)
      .map(b => ({
        id: b.id,
        title: (b.display_title || b.title || '').substring(0, 100),
        author: (b.author || '').substring(0, 80),
        year: b.year,
        photo: b.photo,
      }));

    // Top languages for this collection
    const langCounts = {};
    for (const b of bookList) {
      const l = b.language || 'Unknown';
      langCounts[l] = (langCounts[l] || 0) + 1;
    }
    const languages = Object.entries(langCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([lang, count]) => ({ lang, count }));

    await collectionsColl.updateOne(
      { slug: col.slug },
      {
        $set: {
          slug: col.slug,
          name: col.name,
          subtitle: col.subtitle,
          description: col.description,
          color: col.color,
          order: col.order,
          book_count: bookList.length,
          sample_books: sampleBooks,
          languages,
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    );
  }
  console.log(`  Collections metadata: ${COLLECTIONS.length} upserted`);

  await client.close();
  console.log('\nDone.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
