import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });

async function run() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const pages = db.collection('pages');

  const allBooks = new Map(); // id -> book doc + metadata

  function addBook(b, source) {
    const id = b.id || String(b._id);
    if (!allBooks.has(id)) {
      allBooks.set(id, {
        id, title: b.display_title || b.title, author: b.author,
        year: b.year || b.published, lang: b.original_language || b.language,
        pages: b.pages_count, ocr: b.pages_ocr, translated: b.pages_translated,
        overview: b.reading_summary?.overview?.substring(0, 300),
        categories: b.categories,
        provider: b.image_source?.provider,
        pipeline: b.pipeline_auto?.status,
        sources: new Set(), contentHits: 0, imageCount: 0,
      });
    }
    allBooks.get(id).sources.add(source);
  }

  // =====================================================
  // APPROACH 1: Use $text search on books (uses the text index)
  // =====================================================
  console.log('=== APPROACH 1a: $text search on books ===\n');

  const bookTextQueries = [
    'machine mechanic engineer automata automaton',
    'architecture hydraulic optic fortification artillery',
    'bridge crane pump mill clock horologium',
    'pneumatic catapult siege mining metallurgy',
    'pirotechnia instrument perspectiva',
    'ramelli agricola biringuccio besson vitruvius',
    'archimedes heron zonca strada branca',
    'navigation compass sundial astrolabe',
    'fountain aqueduct canal gunnery pyrotechnic firework',
    'geometry measuring survey war military weapon armor',
  ];

  for (const q of bookTextQueries) {
    try {
      const results = await books.find(
        { $text: { $search: q } },
        {
          projection: {
            id: 1, title: 1, display_title: 1, author: 1,
            year: 1, published: 1, language: 1, original_language: 1,
            pages_count: 1, pages_ocr: 1, pages_translated: 1,
            'reading_summary.overview': 1, categories: 1,
            'image_source.provider': 1, 'pipeline_auto.status': 1,
            score: { $meta: 'textScore' },
          }
        }
      ).sort({ score: { $meta: 'textScore' } }).limit(20).maxTimeMS(15000).toArray();

      for (const b of results) {
        addBook(b, `text:${q.split(' ')[0]}`);
      }
    } catch (e) {
      console.log(`  Warning: text search failed for "${q.substring(0,30)}": ${e.message.substring(0,80)}`);
    }
  }

  console.log(`After text search: ${allBooks.size} unique books\n`);

  // =====================================================
  // APPROACH 1b: Targeted regex on specific key authors/titles
  // (only small focused queries on indexed fields)
  // =====================================================
  console.log('=== APPROACH 1b: Targeted author/title regex ===\n');

  const targetedSearches = [
    { author: /ramelli/i },
    { author: /agricola/i },
    { author: /biringuccio/i },
    { author: /besson/i },
    { author: /vitruvius/i },
    { author: /archimedes/i },
    { author: /heron/i },
    { author: /zonca/i },
    { author: /strada/i },
    { author: /branca/i },
    { author: /errard/i },
    { author: /caus/i },
    { author: /fontana/i },
    { author: /lorini/i },
    { author: /leupold/i },
    { author: /kircher/i },
    { author: /fludd/i },
    { author: /schott/i },
    { title: /machin/i },
    { title: /mechan/i },
    { title: /automat/i },
    { title: /hydraul/i },
    { title: /fortific/i },
    { title: /artiller/i },
    { title: /pirotechn/i },
    { title: /horologium/i },
    { title: /pneumatic/i },
    { title: /architectur/i },
    { title: /perspectiva/i },
    { title: /diverse et artificiose/i },
    { title: /ingenio/i },
    { title: /theatrum instrumentorum/i },
    { title: /de re metallica/i },
    { title: /mining/i },
    { title: /navigation/i },
    { title: /optic/i },
  ];

  for (const filter of targetedSearches) {
    try {
      const results = await books.find(filter, {
        projection: {
          id: 1, title: 1, display_title: 1, author: 1,
          year: 1, published: 1, language: 1, original_language: 1,
          pages_count: 1, pages_ocr: 1, pages_translated: 1,
          'reading_summary.overview': 1, categories: 1,
          'image_source.provider': 1, 'pipeline_auto.status': 1,
        }
      }).limit(10).maxTimeMS(8000).toArray();

      for (const b of results) {
        const key = Object.keys(filter)[0];
        addBook(b, `regex:${key}=${String(filter[key]).substring(1,15)}`);
      }
    } catch (e) {
      // skip
    }
  }

  console.log(`After targeted regex: ${allBooks.size} unique books\n`);

  // =====================================================
  // APPROACH 2: Translation text search
  // =====================================================
  console.log('=== APPROACH 2: Page translation text search ===\n');

  const contentTermGroups = [
    'pulley lever gear wheel crane',
    'automaton machine mechanical device',
    'siphon pump bellows windlass',
    'catapult watermill furnace forge',
    'distillation alembic crucible',
    'hydraulic fountain aqueduct',
    'fortification bastion cannon artillery',
    'clock horologium sundial',
    'mine mining ore smelting',
  ];

  const bookContentHits = new Map();

  for (const terms of contentTermGroups) {
    try {
      const results = await pages.aggregate([
        { $match: { $text: { $search: terms } } },
        { $group: {
          _id: '$book_id',
          count: { $sum: 1 },
          sample: { $first: {
            $substrBytes: [{ $ifNull: ['$translation.data', ''] }, 0, 250]
          }},
        }},
        { $sort: { count: -1 } },
        { $limit: 20 }
      ], { maxTimeMS: 25000 }).toArray();

      for (const r of results) {
        if (!bookContentHits.has(r._id)) {
          bookContentHits.set(r._id, { count: 0, terms: [], sample: '' });
        }
        const entry = bookContentHits.get(r._id);
        entry.count += r.count;
        entry.terms.push(terms.split(' ')[0]);
        if (!entry.sample && r.sample) entry.sample = r.sample;
      }
      console.log(`  "${terms.substring(0,30)}..." → ${results.length} books`);
    } catch (e) {
      console.log(`  Warning: "${terms.substring(0,20)}" failed: ${e.message.substring(0,60)}`);
    }
  }

  // Fetch book details for content hits
  const contentBookIds = [...bookContentHits.keys()].slice(0, 50);
  if (contentBookIds.length > 0) {
    const contentBookDocs = await books.find(
      { id: { $in: contentBookIds } },
      { projection: {
        id: 1, title: 1, display_title: 1, author: 1,
        year: 1, published: 1, language: 1, original_language: 1,
        pages_count: 1, pages_ocr: 1, pages_translated: 1,
        'reading_summary.overview': 1, categories: 1,
        'image_source.provider': 1, 'pipeline_auto.status': 1,
      }}
    ).maxTimeMS(10000).toArray();

    for (const b of contentBookDocs) {
      addBook(b, 'content');
      allBooks.get(b.id).contentHits = bookContentHits.get(b.id)?.count || 0;
      allBooks.get(b.id).contentTerms = bookContentHits.get(b.id)?.terms || [];
      allBooks.get(b.id).contentSample = bookContentHits.get(b.id)?.sample || '';
    }
  }

  console.log(`\nAfter content search: ${allBooks.size} unique books\n`);

  // =====================================================
  // APPROACH 3: Engineering-related detected images
  // =====================================================
  console.log('=== APPROACH 3: Engineering images in gallery ===\n');

  const imageTerms = [
    'machine', 'mechanical', 'diagram', 'instrument', 'device',
    'apparatus', 'furnace', 'alembic', 'distillation', 'pump',
    'crane', 'wheel', 'gear', 'lever', 'pulley', 'mill',
    'clock', 'compass', 'automaton', 'engine', 'press',
    'bellows', 'forge', 'cannon', 'fortification',
    'bridge', 'aqueduct', 'fountain', 'hydraulic',
    'mechanism', 'technical', 'engineering',
  ];
  const imageRegex = new RegExp(imageTerms.join('|'), 'i');

  try {
    const imageResults = await pages.aggregate([
      { $match: {
        'detected_images.0': { $exists: true },
        $or: [
          { 'detected_images.subject': { $elemMatch: { $regex: imageRegex } } },
          { 'detected_images.description': { $regex: imageRegex } },
        ]
      }},
      { $group: {
        _id: '$book_id',
        imageCount: { $sum: { $size: '$detected_images' } },
        pageCount: { $sum: 1 },
        sampleDesc: { $first: { $arrayElemAt: ['$detected_images.description', 0] } },
        sampleSubjects: { $first: { $arrayElemAt: ['$detected_images.subject', 0] } },
      }},
      { $sort: { imageCount: -1 } },
      { $limit: 25 }
    ], { maxTimeMS: 30000 }).toArray();

    console.log(`Found ${imageResults.length} books with engineering images\n`);

    const imageBookIds = imageResults.map(r => r._id);
    const imageBookDocs = await books.find(
      { id: { $in: imageBookIds } },
      { projection: {
        id: 1, title: 1, display_title: 1, author: 1,
        year: 1, published: 1, language: 1, original_language: 1,
        pages_count: 1, pages_ocr: 1, pages_translated: 1,
        'reading_summary.overview': 1, categories: 1,
        'image_source.provider': 1, 'pipeline_auto.status': 1,
      }}
    ).maxTimeMS(10000).toArray();

    for (const b of imageBookDocs) {
      addBook(b, 'images');
      const img = imageResults.find(r => r._id === b.id);
      if (img) {
        allBooks.get(b.id).imageCount = img.imageCount;
        allBooks.get(b.id).imagePages = img.pageCount;
        allBooks.get(b.id).sampleImage = img.sampleDesc;
        allBooks.get(b.id).sampleSubjects = img.sampleSubjects;
      }
    }
  } catch (e) {
    console.log(`Image search failed: ${e.message.substring(0,100)}`);
  }

  console.log(`\nAfter image search: ${allBooks.size} unique books\n`);

  // =====================================================
  // FINAL OUTPUT
  // =====================================================
  console.log('========================================================');
  console.log('  COMPREHENSIVE RESULTS: ALL ENGINEERING-RELATED BOOKS');
  console.log('========================================================\n');

  // Score each book
  const scored = [...allBooks.values()].map(b => {
    let score = 0;
    score += b.sources.size * 5;  // found via multiple approaches
    score += Math.min((b.contentHits || 0) * 0.3, 25);
    score += Math.min((b.imageCount || 0) * 1.5, 20);
    const transPct = b.pages ? Math.round((b.translated || 0) / b.pages * 100) : 0;
    score += transPct * 0.2; // up to 20 for fully translated
    b.transPct = transPct;
    b.ocrPct = b.pages ? Math.round((b.ocr || 0) / b.pages * 100) : 0;
    b.score = Math.round(score);
    return b;
  });

  scored.sort((a, b) => b.score - a.score);

  for (const b of scored) {
    console.log(`--- [Score: ${b.score}] ---`);
    console.log(`Title: ${b.title}`);
    console.log(`Author: ${b.author || '?'}`);
    console.log(`Year: ${b.year || '?'} | Language: ${b.lang || '?'} | Provider: ${b.provider || '?'}`);
    console.log(`Pages: ${b.pages || 0} | OCR: ${b.ocr || 0} (${b.ocrPct}%) | Translated: ${b.translated || 0} (${b.transPct}%)`);
    if (b.categories?.length) console.log(`Categories: ${b.categories.join(', ')}`);
    if (b.pipeline) console.log(`Pipeline: ${b.pipeline}`);
    console.log(`Found via: ${[...b.sources].join(', ')}`);
    if (b.contentHits) console.log(`Content hits: ${b.contentHits} pages (terms: ${b.contentTerms?.join(', ')})`);
    if (b.imageCount) console.log(`Engineering images: ${b.imageCount} across ${b.imagePages} pages`);
    if (b.sampleImage) console.log(`Sample image: ${b.sampleImage}`);
    if (b.sampleSubjects) console.log(`Image subjects: ${JSON.stringify(b.sampleSubjects)}`);
    if (b.overview) console.log(`Summary: ${b.overview.replace(/\n/g, ' ').trim()}`);
    if (b.contentSample) console.log(`Content sample: ${b.contentSample.replace(/\n/g, ' ').trim().substring(0, 200)}`);
    console.log(`URL: https://sourcelibrary.org/book/${b.id}`);
    if (b.imageCount) console.log(`Gallery: https://sourcelibrary.org/gallery?book=${b.id}`);
    console.log('');
  }

  console.log(`\nTotal unique books found: ${scored.length}`);
  console.log(`Books with translations: ${scored.filter(b => b.transPct > 0).length}`);
  console.log(`Books with >50% translated: ${scored.filter(b => b.transPct > 50).length}`);
  console.log(`Books with engineering images: ${scored.filter(b => b.imageCount > 0).length}`);

  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
