import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const uri = process.env.MONGODB_URI;
const geminiKey = process.env.GEMINI_API_KEY;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!geminiKey) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');
console.log(DRY_RUN ? 'DRY RUN MODE' : 'LIVE MODE — will update database');

const client = new MongoClient(uri, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
await client.connect();
const db = client.db('bookstore');

const genAI = new GoogleGenerativeAI(geminiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// Get distinct titles (many are multi-volume with same base title)
const books = await db.collection('books').find({
  language: 'Chinese',
  published: 'Unknown'
}).project({ _id: 1, title: 1 }).toArray();

console.log(`Total Chinese books with unknown dates: ${books.length}`);

// Group by base title (strip volume/卷 info)
const titleGroups = {};
for (const book of books) {
  // Strip volume markers like · 卷一~卷四, Vol 1, Volume 1, etc.
  const baseTitle = (book.title || '')
    .replace(/\s*[·-]\s*卷.*$/, '')
    .replace(/\s*Vol\.?\s*\d+.*$/i, '')
    .replace(/\s*Volume\s*\d+.*$/i, '')
    .replace(/\s*\(\d+\).*$/, '')
    .trim();
  if (!titleGroups[baseTitle]) titleGroups[baseTitle] = [];
  titleGroups[baseTitle].push(book);
}

const uniqueTitles = Object.keys(titleGroups);
console.log(`Unique base titles: ${uniqueTitles.length}`);

// Process in batches of 10 titles per AI call
const batchSize = 10;
let updated = 0;
let skipped = 0;
const titlesToProcess = LIMIT ? uniqueTitles.slice(0, LIMIT) : uniqueTitles;

for (let i = 0; i < titlesToProcess.length; i += batchSize) {
  const batch = titlesToProcess.slice(i, i + batchSize);
  const numberedTitles = batch.map((t, idx) => `${idx + 1}. ${t}`).join('\n');

  const prompt = `For each Chinese text listed below, provide the EARLIEST known publication date or composition date of the edition most likely to be digitized on Internet Archive (usually a woodblock print or lithographic edition, not the original composition date of ancient texts).

Rules:
- Give the year of the physical edition, not original authorship. E.g., for 山海經, give the date of the specific illustrated edition (often 1667 Guo Pu edition), not "4th century BCE".
- For Daoist Canon (道藏) texts, give the date of the specific compilation or collection they appear in.
- If you can identify the specific edition from the title, give that year.
- If you truly cannot determine the date, respond with "unknown".
- Only respond with a JSON array of objects with "index" (1-based) and "year" (number or "unknown") and "edition_note" (brief note about which edition).

Texts:
${numberedTitles}

Respond ONLY with a JSON array, no other text.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    // Extract JSON from response (may be wrapped in ```json blocks)
    const jsonStr = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    const dates = JSON.parse(jsonStr);

    for (const entry of dates) {
      const idx = entry.index - 1;
      if (idx < 0 || idx >= batch.length) continue;
      const baseTitle = batch[idx];
      const booksInGroup = titleGroups[baseTitle];

      if (entry.year === 'unknown' || !entry.year) {
        skipped += booksInGroup.length;
        continue;
      }

      const year = parseInt(entry.year);
      if (isNaN(year) || year < 100 || year > 2030) {
        skipped += booksInGroup.length;
        continue;
      }

      const published = String(year);
      console.log(`  [${year}] ${baseTitle} (${booksInGroup.length} vol) — ${entry.edition_note || ''}`);

      if (!DRY_RUN) {
        const ids = booksInGroup.map(b => b._id);
        await db.collection('books').updateMany(
          { _id: { $in: ids } },
          { $set: { published, year } }
        );
      }
      updated += booksInGroup.length;
    }
  } catch (e) {
    console.error(`  Error on batch ${i}: ${e.message}`);
    skipped += batch.reduce((s, t) => s + titleGroups[t].length, 0);
  }

  if ((i + batchSize) % 50 === 0 || i + batchSize >= titlesToProcess.length) {
    console.log(`  Progress: ${Math.min(i + batchSize, titlesToProcess.length)}/${titlesToProcess.length} titles, ${updated} books dated`);
  }

  // Small delay to avoid rate limits
  await new Promise(r => setTimeout(r, 500));
}

console.log(`\nResults:`);
console.log(`  Titles processed: ${titlesToProcess.length}`);
console.log(`  Books updated: ${updated}`);
console.log(`  Books skipped: ${skipped}`);

await client.close();
