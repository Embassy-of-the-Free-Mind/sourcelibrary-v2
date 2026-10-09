// PRIOR ART: t2/gemini-arms.mjs builds the same production prompt but sends it to Gemini; this only writes it to
// disk so an Opus subagent (subscription, X3 ceiling arm of #5695) gets byte-identical instructions and input.
/** Dump the production translation prompt per page (for the Opus ceiling arm). Read-only. */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { buildTranslationPrompt, loadTranslationPrompts } from '../../../lib/translate-core.mjs';
import { readJsonl, itemId } from '../common.mjs';
const [,, input, idsFile, outDir] = process.argv;
const ids = JSON.parse(fs.readFileSync(idsFile, 'utf8'));
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore'); const prompts = await loadTranslationPrompts(db);
fs.mkdirSync(outDir, { recursive: true });
for (const r of readJsonl(input).filter((x) => ids.includes(itemId(x)))) {
  const book = await db.collection('books').findOne({ id: r.book_id }, { projection: { title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1 } });
  const { prompt } = buildTranslationPrompt({ prompts, book, ocrText: r.source_text.trim(), previousTranslation: null });
  fs.writeFileSync(`${outDir}/${itemId(r)}.prompt.txt`, prompt);
}
await client.close(); console.log(ids.length, 'prompts');
