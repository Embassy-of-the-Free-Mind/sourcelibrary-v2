/**
 * Populate curated collections using Gemini to match books.
 *
 * Strategy:
 * 1. For each published curated collection, extract search terms from its description
 * 2. Use MongoDB text search + regex to find ~200 candidate books
 * 3. Send candidates to Gemini for final selection with relevance scoring
 * 4. Update books (collections array + collection_scores) and collection (book_count)
 *
 * Run: set -a; source .env.production.local; set +a; node scripts/maintenance/populate-curated-collections.mjs
 */

import { MongoClient, ObjectId } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const client = new MongoClient(process.env.MONGODB_URI);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const COLLECTION_SEARCH_CONFIG = {
  'music-of-the-spheres': {
    textSearches: [
      'music harmony spheres pythagorean',
      'harmonic cosmology musical',
      'sound vibration acoustics',
    ],
    regexPatterns: [
      /pythag/i, /boethius/i, /giorgi/i, /kepler/i, /kircher/i, /fludd/i,
      /mersenne/i, /chladni/i, /helmholtz/i, /musurgia/i, /harmoni/i,
      /monochord/i, /musica/i, /de harmonia/i, /music/i,
      /sound/i, /acoust/i, /vibrat/i, /cymatics/i,
      /cosmic.*music/i, /spheres/i,
    ],
    authorPatterns: [
      /pythag/i, /boethius/i, /giorgi/i, /kepler/i, /kircher/i, /fludd/i,
      /mersenne/i, /chladni/i, /helmholtz/i, /zarlino/i, /rameau/i,
    ],
  },
  'forbidden-books': {
    textSearches: [
      'forbidden banned censored heresy',
      'index librorum prohibitorum inquisition',
      'condemned heretical suppressed',
    ],
    regexPatterns: [
      /porete/i, /bruno/i, /picatrix/i, /ars notoria/i,
      /forbidden/i, /banned/i, /censored/i, /heresy/i, /heretical/i,
      /inquisition/i, /prohibit/i, /condemned/i, /suppressed/i,
      /index.*prohib/i, /burned.*stake/i, /secret/i,
      /occult/i, /necromancy/i, /black magic/i, /grimoire/i,
      /sorcery/i, /witchcraft/i, /demonolog/i,
    ],
    authorPatterns: [
      /porete/i, /bruno/i, /galileo/i, /copernicus/i, /vanini/i,
      /servetus/i, /agrippa/i, /dee/i,
    ],
  },
  'newtons-other-science': {
    textSearches: [
      'newton alchemy alchemical',
      'newton theology chronology prophecy',
      'emerald tablet hermes',
    ],
    regexPatterns: [
      /newton/i, /emerald tablet/i, /tabula smaragdina/i,
      /alchemi/i, /alchemy/i, /alchemical/i,
      /transmut/i, /philosopher.*stone/i, /chrysopoeia/i,
      /isaac newton/i, /trinity college/i,
      /hermes.*trismegist/i, /hermetic/i,
    ],
    authorPatterns: [
      /newton/i, /boyle/i, /starkey/i, /philalethes/i,
      /sendivogius/i, /maier/i, /flamel/i,
    ],
  },
  'women-of-the-secret-tradition': {
    textSearches: [
      'women mystic mystical feminine',
      'beguine nun visionary',
      'theosophy spiritualism medium',
    ],
    regexPatterns: [
      /meurdrac/i, /porete/i, /julian.*norwich/i, /mechthild/i,
      /hadewijch/i, /teresa.*[aá]vila/i, /jane lead/i, /guyon/i,
      /blavatsky/i, /besant/i, /hildegard/i, /bingen/i,
      /beguine/i, /mystic.*wom[ae]n/i, /visionar/i,
      /theosoph/i, /spiritualis/i,
      /margery.*kempe/i, /catherine.*siena/i, /bridget.*sweden/i,
    ],
    authorPatterns: [
      /meurdrac/i, /porete/i, /julian/i, /mechthild/i,
      /hadewijch/i, /teresa/i, /lead/i, /guyon/i,
      /blavatsky/i, /besant/i, /hildegard/i,
      /kempe/i, /catherine.*siena/i, /birgitta/i,
    ],
  },
  'theatres-of-machines': {
    textSearches: [
      'machines mechanical engineering devices',
      'theatre machines automata hydraulic',
      'inventions instruments mills',
    ],
    regexPatterns: [
      /ramelli/i, /besson/i, /zonca/i, /caus/i, /agostino/i,
      /machine/i, /mechan/i, /automat/i, /hydraul/i,
      /engineer/i, /device/i, /instrument/i, /invention/i,
      /mill/i, /pump/i, /water.*lift/i, /gear/i,
      /theatr.*machin/i, /fortificat/i, /archimed/i,
      /mining/i, /metallurg/i, /agricola/i,
    ],
    authorPatterns: [
      /ramelli/i, /besson/i, /zonca/i, /caus/i, /veranzio/i,
      /agricola/i, /biringuccio/i, /strada/i, /branca/i,
      /leupold/i, /böckler/i, /boeckler/i,
    ],
  },
};

async function findCandidates(db, config) {
  const bookIds = new Set();
  const booksMap = new Map();

  const projection = {
    _id: 1, id: 1, title: 1, display_title: 1, author: 1,
    'reading_summary.overview': 1, year: 1, collections: 1,
  };

  for (const query of config.textSearches) {
    const results = await db.collection('books').find(
      { $text: { $search: query } },
      { projection: { ...projection, score: { $meta: 'textScore' } } }
    ).sort({ score: { $meta: 'textScore' } }).limit(100).toArray();
    for (const book of results) {
      const key = book._id.toString();
      if (!bookIds.has(key)) { bookIds.add(key); booksMap.set(key, book); }
    }
  }

  for (const pattern of config.regexPatterns) {
    const results = await db.collection('books').find(
      { title: pattern }, { projection }
    ).limit(50).toArray();
    for (const book of results) {
      const key = book._id.toString();
      if (!bookIds.has(key)) { bookIds.add(key); booksMap.set(key, book); }
    }
  }

  for (const pattern of config.authorPatterns) {
    const results = await db.collection('books').find(
      { author: pattern }, { projection }
    ).limit(30).toArray();
    for (const book of results) {
      const key = book._id.toString();
      if (!bookIds.has(key)) { bookIds.add(key); booksMap.set(key, book); }
    }
  }

  return Array.from(booksMap.values());
}

async function callGeminiWithRetry(model, prompt, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (e) {
      const msg = e.message?.substring(0, 120) || String(e);
      console.error(`    Attempt ${attempt}/${retries} failed: ${msg}`);
      if (attempt < retries) {
        const delay = 5000 * attempt;
        console.log(`    Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
}

async function selectBooksWithGemini(collection, candidates) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.1-flash-lite-preview',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  });

  const collectionDesc = `Collection: "${collection.name}"
Description: ${collection.description}
${collection.expanded_description ? `Expanded: ${collection.expanded_description}` : ''}`;

  // Compact: [id, title, author, year]
  const bookList = candidates.map(b => [
    b._id.toString(),
    (b.display_title || b.title || '').substring(0, 100),
    (b.author || '').substring(0, 50),
    b.year || 0,
  ]);

  const CHUNK_SIZE = 120;
  const chunks = [];
  for (let i = 0; i < bookList.length; i += CHUNK_SIZE) {
    chunks.push(bookList.slice(i, i + CHUNK_SIZE));
  }

  let allSelected = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    console.log(`    Chunk ${ci + 1}/${chunks.length} (${chunk.length} books)...`);

    const prompt = `You are a scholarly librarian curating a themed collection for Source Library, a digital library of rare historical texts (1400-1900).

${collectionDesc}

Select books that genuinely belong in this collection. Be selective but thorough: typically 10-50 books per collection. Each candidate is [id, title, author, year].

For each selected book return: {"id":"...","relevance":N,"role":"primary|secondary","reasoning":"one sentence"}
- primary: relevance 70-100, directly about the theme
- secondary: relevance 40-69, significantly related
- Do NOT include books below 40.

CANDIDATES:
${JSON.stringify(chunk)}

Return: {"selected":[...]}`;

    try {
      const text = await callGeminiWithRetry(model, prompt);
      const parsed = JSON.parse(text);
      if (parsed.selected) {
        allSelected.push(...parsed.selected);
      }
    } catch (e) {
      console.error(`    Chunk ${ci + 1} failed completely, skipping`);
    }

    if (ci < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return allSelected;
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  const collections = await db.collection('collections').find({
    type: 'curated',
    published: true,
  }).toArray();

  console.log(`Found ${collections.length} published curated collections\n`);

  for (const collection of collections) {
    console.log(`\n=== ${collection.name} (${collection.slug}) ===`);

    if (collection.book_count > 0) {
      console.log('  Already populated (' + collection.book_count + ' books), skipping');
      continue;
    }

    const config = COLLECTION_SEARCH_CONFIG[collection.slug];
    if (!config) {
      console.log('  No search config, skipping');
      continue;
    }

    const candidates = await findCandidates(db, config);
    console.log(`  Found ${candidates.length} candidates`);

    if (candidates.length === 0) {
      console.log('  No candidates, skipping');
      continue;
    }

    console.log('  Sending to Gemini...');
    const selected = await selectBooksWithGemini(collection, candidates);
    console.log(`  Gemini selected ${selected.length} books`);

    if (selected.length === 0) {
      console.log('  No books selected, skipping');
      continue;
    }

    let updatedCount = 0;
    for (const sel of selected) {
      try {
        const bookId = ObjectId.isValid(sel.id) ? new ObjectId(sel.id) : null;
        if (!bookId) continue;

        const updateResult = await db.collection('books').updateOne(
          { _id: bookId },
          {
            $addToSet: { collections: collection.slug },
            $set: {
              [`collection_scores.${collection.slug}`]: {
                relevance: sel.relevance,
                role: sel.role,
                reasoning: sel.reasoning,
              },
            },
          }
        );

        if (updateResult.modifiedCount > 0 || updateResult.matchedCount > 0) {
          updatedCount++;
        }
      } catch (e) {
        console.error(`  Error updating book ${sel.id}: ${e.message}`);
      }
    }

    const actualCount = await db.collection('books').countDocuments({
      collections: collection.slug,
    });

    await db.collection('collections').updateOne(
      { _id: collection._id },
      { $set: { book_count: actualCount } }
    );

    console.log(`  Updated ${updatedCount} books, collection book_count: ${actualCount}`);

    const topBooks = selected
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10);
    console.log('  Top books:');
    for (const b of topBooks) {
      const book = candidates.find(c => c._id.toString() === b.id);
      const title = book ? (book.display_title || book.title) : b.id;
      console.log(`    [${b.relevance}] ${title} — ${b.reasoning}`);
    }
  }

  await client.close();
  console.log('\nDone!');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
