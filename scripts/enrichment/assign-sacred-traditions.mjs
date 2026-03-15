#!/usr/bin/env node
/**
 * Assign books to sacred tradition sub-collections.
 *
 * Creates tradition-level collections (christianity, judaism, buddhism, etc.)
 * under the parent "sacred-texts" collection, and classifies books into them.
 *
 * Books can belong to MULTIPLE traditions (nothing is exclusive).
 * Uses $addToSet to add tradition slugs without removing existing collection tags.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/assign-sacred-traditions.mjs [--dry-run] [--limit N]
 */

import { MongoClient } from 'mongodb';

// ── Tradition Definitions ──────────────────────────────────────────────────

const TRADITIONS = [
  {
    slug: 'christianity',
    name: 'Christianity',
    subtitle: 'Scripture, Church Fathers & Liturgy',
    description: 'Biblical manuscripts from the earliest printed editions to Erasmus\'s Greek New Testament. The Church Fathers — Augustine, Origen, Chrysostom — wrestling with scripture across centuries. Liturgical texts, psalters, Books of Hours, and the devotional literature that shaped how the West prayed.',
    order: 1,
    exactCategories: [
      'biblical-studies', 'patristics', 'church-fathers', 'reformation',
      'christology', 'soteriology', 'eschatology', 'catechism', 'liturgy',
      'homiletics', 'sermon', 'ecclesiology', 'apologetics', 'dogmatics',
      'canon-law', 'religious-orders', 'hagiography', 'devotional',
      'psalter', 'hymnal',
      'bible', 'new-testament', 'old-testament', 'gospel', 'epistles',
    ],
    patterns: [
      'biblical', 'patristic', 'church-father',
      'catechis', 'liturgi', 'homiletic', 'psalm', 'hymnal',
      'gospel', 'testament', 'vulgate', 'septuagint',
      'hagiograph', 'prayer-book',
    ],
    titlePatterns: [
      /\bbible\b/i, /\bbiblia\b/i, /\bgospel/i, /\bpsalm/i, /\bpsalter/i,
      /\bvulgate?\b/i, /\bseptuagint/i, /\btestament[iu]/i,
      /\baugustin[eu]/i, /\baquinas\b/i, /\borigen\b/i, /\bchrysostom/i,
      /\bjerome\b/i, /\bhieronym/i,
      /\bmissal/i, /\bbreviar/i, /\bliturgi/i,
      /\bchurch father/i, /\bpatrolog/i,
      /\bbook of hours/i, /\bhorae\b/i,
    ],
    excludeLanguages: ['Chinese', 'Sanskrit', 'Japanese', 'Korean', 'Tibetan', 'Pali', 'Thai', 'Burmese', 'Hindi', 'Bengali', 'Arabic', 'Persian', 'Hebrew'],
  },
  {
    slug: 'judaism',
    name: 'Judaism',
    subtitle: 'Torah, Talmud & Kabbalah',
    description: 'The Hebrew Bible in its original language and its earliest printed editions. The Talmud, Midrash, and the great commentaries. Kabbalistic texts from the Sefer Yetzirah to the Zohar — the mystical tradition that profoundly influenced both Jewish and Christian thought.',
    order: 2,
    exactCategories: [
      'kabbalah', 'qabbalah', 'jewish-mysticism', 'jewish-kabbalah',
      'sefirot', 'zohar', 'gematria', 'hebrew-bible', 'talmud',
      'midrash', 'jewish-philosophy', 'torah', 'jewish',
      'rabbinical', 'hasidism', 'halakha', 'jewish-liturgy',
    ],
    patterns: [
      'kabbal', 'qabbal', 'jewish', 'sefir', 'zohar', 'gematri',
      'talmud', 'midrash', 'torah', 'hebrew-bible', 'rabbini',
      'hasidi', 'halakh',
    ],
    titlePatterns: [
      /\bkabbal/i, /\bqabbal/i, /\bcabbal/i, /\bzohar\b/i,
      /\btalmud/i, /\bmidrash/i, /\btorah\b/i,
      /\bsefer\b/i, /\bsifre\b/i, /\bmishnah?\b/i,
      /\bmaimonid/i, /\brashi\b/i, /\bnachmanid/i,
      /\bhasid/i, /\bchassid/i, /\bjudaism/i, /\bjewish/i,
    ],
    includeLanguages: ['Hebrew', 'Yiddish'],
  },
  {
    slug: 'islam',
    name: 'Islam',
    subtitle: 'Quran, Hadith & Sufi Wisdom',
    description: 'Editions of the Quran and Hadith collections. Sufi sacred poetry — Rumi, Hafiz, Attar — and the philosophical mysticism of al-Ghazali and Ibn Arabi. The devotional and intellectual traditions of Islam as preserved in manuscripts and early printed editions.',
    order: 3,
    exactCategories: [
      'islam', 'islamic', 'quran', 'koran', 'hadith', 'sufism', 'sufi',
      'islamic-philosophy', 'islamic-mysticism', 'islamic-theology',
      'sharia', 'fiqh', 'sunni', 'shia', 'islamic-law',
    ],
    patterns: [
      'islam', 'quran', 'koran', 'hadith', 'sufi', 'muslim',
      'sharia', 'fiqh', 'islamic',
    ],
    titlePatterns: [
      /\bquran\b/i, /\bqur.an\b/i, /\bkoran\b/i, /\bal.coran/i,
      /\bhadith/i, /\bsufi/i, /\btasawwuf/i,
      /\brumi\b/i, /\bmathna[wv]i/i, /\bmasnavi/i,
      /\bghaz[za]li/i, /\bibn.arab/i, /\bal.ghaz/i,
      /\bhafiz\b/i, /\bhafez\b/i, /\battar\b/i,
      /\bmuhammad/i, /\bprophet/i,
      /\bmosque/i, /\bislam/i, /\bmuslim/i,
    ],
    includeLanguages: ['Arabic', 'Persian', 'Ottoman Turkish'],
    // Don't auto-include ALL Arabic — many Arabic texts are non-religious
    includeLanguagesRequireCategory: true,
  },
  {
    slug: 'buddhism',
    name: 'Buddhism',
    subtitle: 'Sutras, Dharma & Meditation',
    description: 'From Song dynasty woodblock sutras to the Pali Canon. Mahayana scriptures, Zen koans, Tibetan Buddhist texts, and the earliest English translations that brought Buddhist thought to the West. Spanning the Theravada, Mahayana, and Vajrayana traditions.',
    order: 4,
    exactCategories: [
      'buddhism', 'buddhist', 'zen', 'mahayana', 'theravada',
      'tibetan-buddhism', 'pali-canon', 'dharma', 'sutra',
      'vajrayana', 'chan', 'pure-land', 'nichiren', 'tendai',
      'shingon', 'soto', 'rinzai', 'vipassana', 'mindfulness',
    ],
    patterns: [
      'buddhis', 'mahayana', 'theravada', 'tibetan-buddhis',
      'pali-canon', 'vajrayana', 'zen-buddhis',
    ],
    titlePatterns: [
      /\bbuddh/i, /\bdharma\b/i, /\bsutra\b/i, /\bsutta\b/i,
      /\bnirvana\b/i, /\bnibbana\b/i, /\bbodhisattva/i,
      /\bzen\b/i, /\bchan\b/i, /\bmahayana/i, /\btheravada/i,
      /\bpali\b/i, /\btripitaka/i, /\btipitaka/i,
      /\bdalai.lama/i, /\bmilarepa/i, /\bnagarjuna/i,
      /\blotus.sutra/i, /\bheart.sutra/i, /\bdiamond.sutra/i,
    ],
    includeLanguages: ['Pali', 'Tibetan', 'Burmese', 'Thai', 'Sinhalese'],
  },
  {
    slug: 'hinduism',
    name: 'Hinduism',
    subtitle: 'Vedas, Upanishads & Bhagavad Gita',
    description: 'The oldest sacred texts in continuous use — the Vedas and Upanishads in the original Sanskrit. The Bhagavad Gita, the Puranas, and the philosophical schools of Vedanta, Samkhya, and Yoga. Three millennia of devotional and intellectual tradition from the Indian subcontinent.',
    order: 5,
    exactCategories: [
      'hinduism', 'vedic', 'vedanta', 'yoga', 'tantra', 'upanishad',
      'purana', 'shaivism', 'vaishnavism', 'samkhya', 'nyaya',
      'vaisheshika', 'mimamsa', 'bhakti', 'hindu',
      'ayurveda', 'mantra', 'dharma-shastra',
    ],
    patterns: [
      'hindu', 'vedic', 'vedanta', 'upanishad', 'purana',
      'shaiv', 'vaishnav', 'samkhya', 'bhakti',
    ],
    titlePatterns: [
      /\bveda\b/i, /\bvedas\b/i, /\bvedic\b/i, /\brigveda/i, /\bryg.veda/i,
      /\bupanishad/i, /\boupnek/i,
      /\bbhagavad/i, /\bgita\b/i, /\bgeeta\b/i,
      /\bpurana\b/i, /\bramayana/i, /\bmahabharata/i,
      /\byoga\b/i, /\bpatanjali/i, /\btantra/i,
      /\bshankara\b/i, /\bsankara\b/i, /\bvivekach/i,
      /\bmanu\b.*\bsmriti/i, /\bdharma.shastra/i,
      /\bvishnu\b/i, /\bshiva\b/i, /\bkrishna\b/i, /\brama\b/i,
    ],
    includeLanguages: ['Sanskrit', 'Hindi', 'Bengali', 'Tamil', 'Telugu', 'Kannada', 'Malayalam'],
    // Don't include Sanskrit Buddhist texts
    excludeCategories: ['buddhism', 'buddhist', 'jainism', 'jain'],
  },
  {
    slug: 'daoism',
    name: 'Daoism',
    subtitle: 'The Way and Its Power',
    description: 'The Dao De Jing, the Zhuangzi, and the Daoist canon — Chinese woodblock prints from the Ming and Qing dynasties alongside the Western translations that introduced the Way to a global audience. The philosophical and religious traditions of the Dao.',
    order: 6,
    exactCategories: [
      'daoism', 'taoism', 'daoist', 'taoist',
      'dao', 'tao', 'daoist-philosophy', 'taoist-philosophy',
    ],
    patterns: [
      'daois', 'taois',
    ],
    titlePatterns: [
      /\bdao\s*de\s*jing/i, /\btao\s*te\s*ching/i, /\bdaodejing/i,
      /\bzhuang\s*zi/i, /\bchuang\s*tz[eu]/i,
      /\blie\s*zi/i, /\blieh\s*tz[eu]/i,
      /\bdaoist/i, /\btaoist/i, /\bdaoism/i, /\btaoism/i,
      /\blao\s*zi/i, /\blao\s*tz[eu]/i,
      /\bi\s*ching/i, /\byijing/i,
    ],
  },
  {
    slug: 'zoroastrianism',
    name: 'Zoroastrianism',
    subtitle: 'The Avesta & Gathas',
    description: 'The sacred texts of one of the world\'s oldest monotheistic traditions. The Avesta, the Gathas of Zarathustra, and the Zend commentaries — preserved through millennia and influential far beyond Persia, shaping Jewish, Christian, and Islamic thought about angels, demons, and the end of time.',
    order: 7,
    exactCategories: [
      'zoroastrianism', 'zoroastrian', 'avesta', 'zend',
      'mazdean', 'parsee', 'parsi', 'gathas',
    ],
    patterns: [
      'zoroastr', 'avesta', 'mazdean', 'parsee', 'parsi',
    ],
    titlePatterns: [
      /\bzoroastr/i, /\bzarathustr/i, /\bzerdascht/i,
      /\bavesta/i, /\bzend/i, /\bgatha/i,
      /\bahura.mazda/i, /\bormuzd/i,
      /\bparsee/i, /\bparsi\b/i, /\bmazdean/i,
      /\bbundahishn/i, /\bdenkard/i,
    ],
  },
  {
    slug: 'hermetica-sacred',
    name: 'Hermetica & Gnostic Texts',
    subtitle: 'Ancient Wisdom Revealed',
    description: 'The Corpus Hermeticum, the Asclepius, and the Gnostic scriptures recovered at Nag Hammadi. Texts attributed to Hermes Trismegistus that Renaissance thinkers like Ficino treated as sacred revelation — the prisca theologia, an ancient theology believed to predate Moses.',
    order: 8,
    exactCategories: [
      'gnostic', 'gnosticism', 'nag-hammadi', 'corpus-hermeticum',
    ],
    patterns: [
      'gnostic', 'nag-hammadi', 'corpus-hermetic',
    ],
    titlePatterns: [
      /\bcorpus hermeticum/i, /\basclepius\b/i, /\bpoimandres/i, /\bpimander/i,
      /\bnag hammadi/i, /\bgnostic/i,
      /\bpistis sophia/i, /\bhermes trismegist/i,
      /\btrismegist/i,
    ],
    // Only primary scripture, not the broader Hermetic commentary tradition
  },
  {
    slug: 'mandaeanism',
    name: 'Mandaeanism',
    subtitle: 'The Last Gnostic Religion',
    description: 'The sacred texts of the Mandaeans — one of the oldest surviving Gnostic religions, centered on John the Baptist rather than Jesus. The Ginza Rabba (Great Treasure) and the Book of John, preserved by a community that endures in Iraq and Iran to this day.',
    order: 9,
    exactCategories: [
      'mandaeanism', 'mandaean', 'mandean', 'sabian',
    ],
    patterns: [
      'mandae', 'mandea', 'sabian',
    ],
    titlePatterns: [
      /\bmandae/i, /\bmandai/i, /\bmanda[eë]/i,
      /\bginza/i, /\bginzā/i,
      /\bdraša/i, /\bdrasha/i,
      /\bsabian/i,
    ],
  },
  {
    slug: 'jainism',
    name: 'Jainism',
    subtitle: 'Non-Violence & Liberation',
    description: 'The Agamas and philosophical texts of the Jain tradition — one of India\'s oldest religions, centered on non-violence (ahimsa) and the liberation of the soul. Texts of Mahavira and the great Jain commentators.',
    order: 10,
    exactCategories: [
      'jainism', 'jain', 'jaina',
    ],
    patterns: [
      'jain',
    ],
    titlePatterns: [
      /\bjain/i, /\bmahavira/i, /\bjina\b/i,
      /\bahimsa/i, /\banekant/i,
      /\bagama\b/i,
    ],
    // Only match if not Hindu/Buddhist
    excludeCategories: ['hinduism', 'buddhism'],
  },
];

// ── Matching Logic ──────────────────────────────────────────────────────────

function normalizeCategory(cat) {
  return (cat || '').toLowerCase().trim().replace(/\s+/g, '-');
}

function matchBook(book, tradition) {
  const cats = (book.categories || []).map(normalizeCategory);
  const lang = (book.language || '').trim();
  const title = book.title || '';
  const displayTitle = book.display_title || '';
  const titleStr = `${title} ${displayTitle}`;
  const description = book.description || '';

  // Check excludeCategories
  if (tradition.excludeCategories) {
    const hasExcluded = cats.some(c =>
      tradition.excludeCategories.some(ec => c.includes(ec))
    );
    if (hasExcluded) return false;
  }

  // Check language exclusions
  if (tradition.excludeLanguages) {
    const excluded = tradition.excludeLanguages.some(el =>
      lang.toLowerCase().includes(el.toLowerCase())
    );
    if (excluded) {
      // Still allow if has explicit matching categories
      const hasCatMatch = cats.some(c =>
        (tradition.exactCategories || []).includes(c) ||
        (tradition.patterns || []).some(p => c.includes(p))
      );
      if (!hasCatMatch) return false;
    }
  }

  // Language inclusion
  if (tradition.includeLanguages && !tradition.includeLanguagesRequireCategory) {
    const included = tradition.includeLanguages.some(il =>
      lang.toLowerCase().includes(il.toLowerCase())
    );
    if (included) return true;
  }

  // Exact category match
  if (tradition.exactCategories) {
    const hasExact = cats.some(c => tradition.exactCategories.includes(c));
    if (hasExact) return true;
  }

  // Pattern/substring match on categories
  if (tradition.patterns) {
    const hasPattern = cats.some(c =>
      tradition.patterns.some(p => c.includes(p))
    );
    if (hasPattern) return true;
  }

  // Title pattern match
  if (tradition.titlePatterns) {
    const hasTitle = tradition.titlePatterns.some(re => re.test(titleStr));
    if (hasTitle) return true;
  }

  // Language inclusion with category requirement
  if (tradition.includeLanguages && tradition.includeLanguagesRequireCategory) {
    const included = tradition.includeLanguages.some(il =>
      lang.toLowerCase().includes(il.toLowerCase())
    );
    if (included) {
      // Need at least one category or title match from a broader set
      const hasAnyCatHint = cats.some(c =>
        (tradition.exactCategories || []).includes(c) ||
        (tradition.patterns || []).some(p => c.includes(p))
      );
      const hasTitleHint = (tradition.titlePatterns || []).some(re => re.test(titleStr));
      if (hasAnyCatHint || hasTitleHint) return true;
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

  // Fetch all non-deleted books with pages
  const query = { status: { $ne: 'deleted' }, pages_count: { $gt: 0 } };
  const projection = {
    id: 1, title: 1, display_title: 1, author: 1, year: 1,
    language: 1, categories: 1, description: 1,
    pages_count: 1, pages_translated: 1,
    thumbnail: 1, thumbnail_blob: 1, photo: 1,
  };
  let cursor = db.collection('books').find(query, { projection }).sort({ created_at: 1 });
  if (limit) cursor = cursor.limit(limit);
  const books = await cursor.toArray();
  console.log(`Loaded ${books.length} books\n`);

  // Classify each book
  const traditionBooks = {}; // slug -> [book]
  const bookTraditions = {}; // book.id -> [slug]

  for (const t of TRADITIONS) {
    traditionBooks[t.slug] = [];
  }

  for (const book of books) {
    const matched = [];
    for (const t of TRADITIONS) {
      if (matchBook(book, t)) {
        matched.push(t.slug);
        traditionBooks[t.slug].push(book);
      }
    }
    if (matched.length > 0) {
      bookTraditions[book.id] = matched;
    }
  }

  // Print summary
  console.log('=== SACRED TRADITION ASSIGNMENTS ===\n');
  let totalSacredBooks = 0;
  const allSacredBookIds = new Set();

  for (const t of TRADITIONS) {
    const count = traditionBooks[t.slug].length;
    totalSacredBooks += count;
    for (const b of traditionBooks[t.slug]) {
      allSacredBookIds.add(b.id);
    }

    // Show language distribution
    const langDist = {};
    for (const b of traditionBooks[t.slug]) {
      const l = b.language || 'Unknown';
      langDist[l] = (langDist[l] || 0) + 1;
    }
    const topLangs = Object.entries(langDist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([l, c]) => `${l}:${c}`)
      .join(', ');

    console.log(`${t.name}: ${count} books (${topLangs})`);

    // Show sample titles
    const samples = traditionBooks[t.slug].slice(0, 3);
    for (const s of samples) {
      console.log(`    ${(s.display_title || s.title || '').substring(0, 80)}`);
    }
  }

  console.log(`\nUnique sacred books: ${allSacredBookIds.size}`);
  console.log(`Total assignments: ${totalSacredBooks} (avg ${(totalSacredBooks / Math.max(allSacredBookIds.size, 1)).toFixed(1)} traditions per book)`);

  // Show books in multiple traditions
  const multiTradition = Object.entries(bookTraditions)
    .filter(([, slugs]) => slugs.length >= 2)
    .slice(0, 10);
  if (multiTradition.length > 0) {
    console.log('\nSample multi-tradition books:');
    for (const [bookId, slugs] of multiTradition) {
      const book = books.find(b => b.id === bookId);
      console.log(`  ${(book?.display_title || book?.title || bookId).substring(0, 60)} → ${slugs.join(', ')}`);
    }
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No changes written.');
    await client.close();
    return;
  }

  // ── Write to DB ──────────────────────────────────────────────────────────

  console.log('\nWriting to database...');

  // 1. Add tradition slugs to books using $addToSet (non-destructive)
  const bulkOps = [];
  for (const [bookId, slugs] of Object.entries(bookTraditions)) {
    bulkOps.push({
      updateOne: {
        filter: { id: bookId },
        update: { $addToSet: { collections: { $each: slugs } } },
      },
    });
  }

  const BATCH_SIZE = 500;
  let updated = 0;
  for (let i = 0; i < bulkOps.length; i += BATCH_SIZE) {
    const batch = bulkOps.slice(i, i + BATCH_SIZE);
    const result = await db.collection('books').bulkWrite(batch);
    updated += result.modifiedCount;
    process.stdout.write(`  Books: ${Math.min(i + BATCH_SIZE, bulkOps.length)}/${bulkOps.length}\r`);
  }
  console.log(`  Books updated: ${updated}                `);

  // 2. Mark sacred-texts collection as parent portal
  await db.collection('collections').updateOne(
    { slug: 'sacred-texts' },
    {
      $set: {
        is_portal: true,
        portal_description: 'The books humanity has called holy',
        book_count: allSacredBookIds.size,
        updated_at: new Date(),
      },
    },
  );
  console.log('  Updated sacred-texts as portal');

  // 3. Upsert tradition collection metadata
  const collectionsColl = db.collection('collections');
  for (const t of TRADITIONS) {
    const bookList = traditionBooks[t.slug];
    if (bookList.length === 0) continue;

    // Pick sample books — prefer those with thumbnails
    const withThumbs = bookList.filter(b => b.thumbnail_blob || b.thumbnail || b.photo);
    const pool = withThumbs.length >= 6 ? withThumbs : bookList;
    pool.sort((a, b) => (a.year || 9999) - (b.year || 9999));
    const step = Math.max(1, Math.floor(pool.length / 6));
    const picked = [];
    for (let i = 0; i < pool.length && picked.length < 6; i += step) {
      picked.push(pool[i]);
    }
    const sampleBooks = picked.map(b => ({
      id: b.id,
      title: (b.display_title || b.title || '').substring(0, 100),
      author: (b.author || '').substring(0, 80),
      year: b.year,
      thumbnail: b.thumbnail_blob || b.thumbnail || b.photo || null,
    }));

    // Language stats
    const langCounts = {};
    for (const b of bookList) {
      const l = b.language || 'Unknown';
      langCounts[l] = (langCounts[l] || 0) + 1;
    }
    const languages = Object.entries(langCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([lang, count]) => ({ lang, count }));

    await collectionsColl.updateOne(
      { slug: t.slug },
      {
        $set: {
          slug: t.slug,
          name: t.name,
          subtitle: t.subtitle,
          description: t.description,
          parent: 'sacred-texts',
          order: t.order,
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
  console.log(`  Tradition collections: ${TRADITIONS.length} upserted`);

  // 4. Populate featured images for each tradition
  console.log('\nPopulating featured images from gallery...');
  for (const t of TRADITIONS) {
    const bookIds = traditionBooks[t.slug].map(b => b.id);
    if (bookIds.length === 0) continue;

    const images = await db.collection('gallery_images').aggregate([
      { $match: {
        book_id: { $in: bookIds },
        gallery_quality: { $gte: 0.7 },
        thumbnail_url: { $exists: true, $ne: null },
      }},
      { $addFields: {
        _score: { $add: [
          { $multiply: ['$gallery_quality', 50] },
          { $cond: [{ $and: [
            { $ne: ['$museum_description', null] },
            { $gt: [{ $strLenCP: { $ifNull: ['$museum_description', ''] } }, 50] },
          ]}, 10, 0] },
        ]},
      }},
      { $sort: { _score: -1 } },
      { $group: { _id: '$book_id', top: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$top' } },
      { $sort: { _score: -1 } },
      { $limit: 6 },
      { $project: {
        id: 1, page_id: 1, detection_index: 1,
        thumbnail_url: 1, extracted_url: 1, image_url: 1,
        description: 1, type: 1, gallery_quality: 1,
        book_id: 1, book_title: 1,
      }},
    ]).toArray();

    if (images.length > 0) {
      await collectionsColl.updateOne(
        { slug: t.slug },
        { $set: { featured_images: images } }
      );
      console.log(`  ${t.name}: ${images.length} featured images`);
    }
  }

  await client.close();
  console.log('\nDone.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
