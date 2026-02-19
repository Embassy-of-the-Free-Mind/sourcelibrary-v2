import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

const API = 'https://sourcelibrary.org/api/jobs/queue-books';
const PROMPT_DIR = '/Users/dereklomas/sourcelibrary/scripts/custom-prompts';

const BOOKS = [
  // Complutensian Polyglot — very large, will need chunking
  { id: '699209c4bed8f4b5ff5b2c6b', label: 'Polyglot', prompt: 'polyglot.txt' },
  // Codex Sinaiticus
  { id: '6953a8b277f38f6761bd365c', label: 'Sinaiticus-Tischendorf', prompt: 'sinaiticus.txt' },
  { id: '69920bbfe0a548a13d885514', label: 'Sinaiticus-NT', prompt: 'sinaiticus.txt' },
  { id: '69920bc6e0a548a13d885667', label: 'Sinaiticus-OT', prompt: 'sinaiticus.txt' },
  // Zohar
  { id: '6990630be7b7642c081de08b', label: 'Zohar-Cremona', prompt: 'zohar.txt' },
  { id: '6990633def12272ffdc907b0', label: 'Zohar-Mantua', prompt: 'zohar.txt' },
  { id: '699067ef249ce014347d4e4f', label: 'Zohar-Splendour', prompt: 'zohar.txt' },
  // Rig Veda
  { id: '69920bd5e0a548a13d886144', label: 'RigVeda-V1', prompt: 'rigveda.txt' },
  { id: '69920bdbe0a548a13d886f1d', label: 'RigVeda-V2', prompt: 'rigveda.txt' },
  { id: '699209a9bed8f4b5ff5b1fd0', label: 'RigVeda-V3', prompt: 'rigveda.txt' },
  { id: '69920be3e0a548a13d887575', label: 'RigVeda-V4', prompt: 'rigveda.txt' },
  { id: '69920beee0a548a13d887aeb', label: 'RigVeda-V5', prompt: 'rigveda.txt' },
  // Kircher Oedipus
  { id: '695273a1ab34727b1f049baf', label: 'Oedipus-II', prompt: 'kircher.txt' },
  { id: '695273a7ab34727b1f04a708', label: 'Oedipus-III', prompt: 'kircher.txt' },
];

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  const promptCache = {};
  let totalQueued = 0;

  for (const book of BOOKS) {
    try {
      // Find pages without OCR
      const pages = await db.collection('pages').find(
        { book_id: book.id, $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': '' }] },
        { projection: { id: 1 } }
      ).toArray();

      if (pages.length === 0) {
        console.log(`${book.label}: 0 pages need OCR — skipping`);
        continue;
      }

      const pageIds = pages.map(p => p.id);

      // Load prompt (cached)
      if (!promptCache[book.prompt]) {
        promptCache[book.prompt] = readFileSync(`${PROMPT_DIR}/${book.prompt}`, 'utf-8');
      }

      console.log(`${book.label}: ${pageIds.length} pages to queue...`);

      // Queue via API
      const resp = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: book.id,
          pageIds,
          action: 'ocr',
          customPrompt: promptCache[book.prompt],
        }),
      });

      const text = await resp.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        console.log(`${book.label}: Non-JSON response (${resp.status}): ${text.slice(0, 200)}`);
        continue;
      }

      if (result.success) {
        console.log(`${book.label}: QUEUED ${result.pageCount} pages — job ${result.jobId}`);
        totalQueued += result.pageCount;
      } else {
        console.log(`${book.label}: ERROR — ${result.error}`);
      }
    } catch (err) {
      console.log(`${book.label}: EXCEPTION — ${err.message}`);
    }
  }

  console.log(`\n--- Total pages queued: ${totalQueued} ---`);
  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
