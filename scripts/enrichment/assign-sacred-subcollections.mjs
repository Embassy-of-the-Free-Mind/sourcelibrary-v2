#!/usr/bin/env node
/**
 * Assign sacred-texts books to tradition sub-collections using Gemini Flash.
 *
 * Takes books already tagged `sacred-texts` but missing a tradition sub-collection
 * and classifies them into one or more of the 28 traditions.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/assign-sacred-subcollections.mjs [--dry-run] [--limit N] [--concurrency N]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

// ── Sub-collection definitions (slug -> short description for the prompt) ──

const TRADITIONS = [
  { slug: 'christianity', hint: 'Bible, Church Fathers, patristics, liturgy, psalters, New Testament, Old Testament, Vulgate, Septuagint, catechism, homiletics, Reformation theology' },
  { slug: 'judaism', hint: 'Hebrew Bible, Torah, Talmud, Midrash, Jewish liturgy, Siddur, Haggadah. NOT Christian Kabbalah (that goes to kabbalah collection)' },
  { slug: 'islam', hint: 'Quran, Hadith, Sufi sacred poetry (Rumi, Hafiz, Attar, Ibn Arabi), Islamic theology, tafsir, fiqh, sharia' },
  { slug: 'buddhism', hint: 'Pali Canon, Mahayana sutras, Zen/Chan texts, Tibetan Buddhist texts, Dhammapada, Jataka tales' },
  { slug: 'hinduism', hint: 'Vedas, Upanishads, Bhagavad Gita, Puranas, Ramayana, Mahabharata, Yoga Sutras, Tantric texts, Agamas, bhakti poetry' },
  { slug: 'daoism', hint: 'Dao De Jing, Zhuangzi, Daoist canon, Daoist liturgy, Daoist alchemy' },
  { slug: 'confucianism', hint: 'Analects, Mencius, Four Books, Five Classics, Xunzi, neo-Confucian texts' },
  { slug: 'zoroastrianism', hint: 'Avesta, Gathas, Zend-Avesta, Bundahishn, Pahlavi texts, Zoroastrian liturgy' },
  { slug: 'manichaeism', hint: 'Mani, Manichaean texts, anti-Manichaean writings, Kephalaia, Manichaean psalms' },
  { slug: 'hermetica-sacred', hint: 'Corpus Hermeticum, Asclepius, Nag Hammadi, Gnostic gospels, Valentinian texts. Only truly sacred/scriptural Hermetic texts' },
  { slug: 'orphism-mysteries', hint: 'Orphic hymns, Eleusinian mysteries, Dionysian rites, mystery religion initiation texts' },
  { slug: 'ancient-greek-religion', hint: 'Hesiod Theogony, Homeric Hymns, Greek temple practices, Greek religious ritual (NOT philosophy)' },
  { slug: 'ancient-egyptian', hint: 'Book of the Dead, Pyramid Texts, Coffin Texts, Egyptian funerary literature, Egyptian religious ritual' },
  { slug: 'sumerian-mesopotamian', hint: 'Gilgamesh, Enuma Elish, Sumerian hymns, Akkadian prayers, Babylonian religious texts' },
  { slug: 'norse-germanic', hint: 'Poetic Edda, Prose Edda, Norse mythology, Germanic creation myths' },
  { slug: 'celtic', hint: 'Mabinogion, Táin Bó Cúailnge, Lebor Gabála, Welsh/Irish mythology cycles' },
  { slug: 'shinto', hint: 'Kojiki, Nihon Shoki, Shinto liturgy, Japanese indigenous religion' },
  { slug: 'jainism', hint: 'Jain Agamas, Tattvartha Sutra, Jain philosophy and ethics' },
  { slug: 'sikhism', hint: 'Guru Granth Sahib, Dasam Granth, Sikh scripture' },
  { slug: 'bahai', hint: 'Kitáb-i-Íqán, Kitáb-i-Aqdas, Hidden Words, Seven Valleys, Bahá\'í writings' },
  { slug: 'indigenous-traditions', hint: 'Popol Vuh, Mesoamerican, Native American sacred narratives' },
  { slug: 'polynesian', hint: 'Polynesian cosmogony, Maori creation narratives' },
  { slug: 'samaritan', hint: 'Samaritan Pentateuch, Samaritan liturgy' },
  { slug: 'druze', hint: 'Rasa\'il al-Hikma, Druze epistles, Druze theology' },
  { slug: 'mandaeanism', hint: 'Ginza Rabba, Mandaean Book of John, Mandaean texts' },
  { slug: 'yazidi', hint: 'Mashaf Reš, Kitab al-Jilwa, Yazidi sacred texts' },
  { slug: 'tengrism', hint: 'Secret History of the Mongols, Turkic-Mongol spiritual traditions' },
  { slug: 'cao-dai', hint: 'Caodaist scriptures, Vietnamese syncretic religion' },
];

const TRADITION_SUMMARY = TRADITIONS.map(t => `- ${t.slug}: ${t.hint}`).join('\n');

const SYSTEM_PROMPT = `You are a specialist in comparative religion, classifying books into religious tradition sub-collections.

Each book is already tagged as a "sacred text" — your job is to assign it to 1-2 specific traditions.

TRADITIONS:
${TRADITION_SUMMARY}

RULES:
1. Assign 1-2 traditions per book. Most books belong to exactly 1 tradition.
2. Only assign a second tradition if the book genuinely bridges two (e.g., a comparative study of Zoroastrian and Manichaean texts).
3. If the book is clearly Christian theology/biblical but not from another tradition, assign ONLY "christianity".
4. Sufi poetry (Rumi, Hafiz, Attar, Ibn Arabi) → "islam". Persian language alone doesn't mean Islam.
5. Latin Bibles, Vulgate editions, Church Fathers → "christianity". Hebrew Bible editions → "judaism" AND "christianity".
6. Books that are ABOUT a religion (scholarly studies) still get classified by their subject religion.
7. If you truly cannot determine the tradition, return an empty array.
8. Polyglot Bibles → "christianity" (primary) + "judaism" if they include Hebrew text.

Respond with a JSON array, one entry per book, in the same order as input:
{"i": <index>, "t": ["<slug>", ...]}

NO explanation, just the JSON array.`;

async function classifyBatch(ai, books, batchIndex) {
  const booksText = books.map((b, i) => {
    const cats = (b.categories || []).slice(0, 8).join(', ');
    const cols = (b.collections || []).filter(c => c !== 'sacred-texts').slice(0, 5).join(', ');
    return `[${i}] "${(b.display_title || b.title || 'Untitled').substring(0, 140)}" by ${(b.author || 'Unknown').substring(0, 60)} (${b.year || '?'}, ${b.language || '?'}) [cats: ${cats}] [cols: ${cols}]`;
  }).join('\n');

  const prompt = `Classify these ${books.length} books by religious tradition:\n\n${booksText}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });

      const text = response.text.trim();
      const results = JSON.parse(text);
      if (!Array.isArray(results)) throw new Error('Not an array');
      return results;
    } catch (err) {
      console.error(`  Batch ${batchIndex} attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return books.map((_, i) => ({ i, t: [] }));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? parseInt(args[limitArg + 1]) : 0;
  const concurrencyArg = args.indexOf('--concurrency');
  const concurrency = concurrencyArg >= 0 ? parseInt(args[concurrencyArg + 1]) : 5;

  if (!process.env.MONGODB_URI || !process.env.GEMINI_API_KEY) {
    console.error('MONGODB_URI and GEMINI_API_KEY required');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Get all sub-collection slugs
  const subSlugs = TRADITIONS.map(t => t.slug);
  const validSlugs = new Set(subSlugs);

  // Find sacred-texts books WITHOUT any sub-collection
  const books = await db.collection('books').aggregate([
    { $match: { collections: 'sacred-texts', status: { $ne: 'deleted' }, pages_count: { $gt: 0 } } },
    { $addFields: { hasSubCol: { $gt: [{ $size: { $setIntersection: ['$collections', subSlugs] } }, 0] } } },
    { $match: { hasSubCol: false } },
    { $project: { id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, categories: 1, collections: 1 } },
    { $sort: { pages_translated: -1 } },
    ...(limit ? [{ $limit: limit }] : []),
  ]).toArray();

  console.log(`Found ${books.length} sacred-texts books without tradition sub-collection\n`);
  if (books.length === 0) {
    console.log('Nothing to do.');
    await client.close();
    return;
  }

  // Batch classify
  const BATCH_SIZE = 30;
  const batches = [];
  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    batches.push(books.slice(i, i + BATCH_SIZE));
  }
  console.log(`${batches.length} batches of ${BATCH_SIZE}, concurrency=${concurrency}\n`);

  const assignments = new Map(); // bookId -> [slug, ...]
  let processed = 0;

  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency);
    const promises = chunk.map((batch, j) =>
      classifyBatch(ai, batch, i + j).then(results => {
        for (const result of results) {
          const bookIdx = (i + j) * BATCH_SIZE + result.i;
          const book = books[bookIdx];
          if (!book) continue;
          const traditions = (result.t || [])
            .filter(slug => validSlugs.has(slug))
            .slice(0, 2);
          if (traditions.length > 0) {
            assignments.set(book.id, traditions);
          }
        }
      })
    );
    await Promise.all(promises);
    processed += chunk.reduce((s, b) => s + b.length, 0);
    process.stdout.write(`  Classified: ${processed}/${books.length}\r`);
  }
  console.log(`\nClassification complete. ${assignments.size}/${books.length} assigned.\n`);

  // Summary
  const counts = {};
  for (const traditions of assignments.values()) {
    for (const t of traditions) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  console.log('Assignments by tradition:');
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([slug, count]) => {
    console.log(`  ${slug}: ${count}`);
  });

  if (dryRun) {
    console.log('\n--dry-run: no changes written.');
    await client.close();
    return;
  }

  // Write to DB
  const bulkOps = [];
  for (const [bookId, traditions] of assignments) {
    bulkOps.push({
      updateOne: {
        filter: { id: bookId },
        update: { $addToSet: { collections: { $each: traditions } } },
      },
    });
  }

  if (bulkOps.length > 0) {
    const result = await db.collection('books').bulkWrite(bulkOps);
    console.log(`\nUpdated ${result.modifiedCount} books.`);
  }

  // Refresh sub-collection counts
  console.log('\nRefreshing sub-collection counts...');
  for (const slug of subSlugs) {
    const count = await db.collection('books').countDocuments({
      collections: slug,
      status: { $ne: 'deleted' },
      hidden: { $ne: true },
      pages_count: { $gt: 0 },
      pages_translated: { $gt: 0 },
    });
    await db.collection('collections').updateOne({ slug }, { $set: { book_count: count } });
  }
  console.log('Done.');

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
