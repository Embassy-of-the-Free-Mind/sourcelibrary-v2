// PRIOR ART: run-arms.mjs (this dir) builds the same prompt and sends it to Gemini; this writes it to files so an
// Opus subagent (X3 ceiling, subscription) gets byte-for-byte the input the lite/flash arms got.
/** Write the production v13 single-page prompt for chosen pages to <dir>/<id>.txt (no model call). */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { buildTranslationPrompt, loadTranslationPrompts, PAGE_BREAK_SCOPED } from '../../lib/translate-core.mjs';
const [RECORDS, IDS, DIR] = process.argv.slice(2);
const ids = IDS.split(',');
const recs = fs.readFileSync(RECORDS, 'utf8').trim().split('\n').map(JSON.parse).filter((r) => ids.includes(`${r.book_id}_${String(r.page_number).padStart(5, '0')}`));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const prompts = await loadTranslationPrompts(db);
fs.mkdirSync(DIR, { recursive: true });
for (const r of recs) {
  const book = await db.collection('books').findOne({ id: r.book_id });
  const near = await db.collection('pages').find({ book_id: r.book_id, page_number: { $in: [r.page_number - 1, r.page_number + 1] } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
  const by = Object.fromEntries(near.map((p) => [p.page_number, p.ocr?.data]));
  const { prompt } = buildTranslationPrompt({ prompts, book, ocrText: r.source_text, previousTranslation: null, prevOcrText: by[r.page_number - 1] || undefined, nextOcrText: by[r.page_number + 1] || undefined, pageBreak: PAGE_BREAK_SCOPED });
  fs.writeFileSync(path.join(DIR, `${r.book_id}_${String(r.page_number).padStart(5, '0')}.txt`), prompt);
}
console.log(`${recs.length} prompts → ${DIR}`);
await c.close();
