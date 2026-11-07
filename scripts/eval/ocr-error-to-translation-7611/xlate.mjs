#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate.mjs `read` — same prompt (translate-core buildTranslationPrompt, PAGE_BREAK_SCOPED,
// the page before's stored English as context) and the same agy call, but it reads the STORED OCR and keeps the read in
// R2/lane_job_books. This eval (#7611) needs the English of a GIVEN transcription (an edited control, or the judged text
// of a page with no English) and must write nothing to production, so it takes the text from a file and only saves locally.
//   node --env-file=.env.production.local xlate.mjs <in.json [{key,page_id,ocr_text}]> <outdir> [--model=gemini-3.8-flash-low]
import fs from 'node:fs'; import path from 'node:path';
import { MongoClient } from 'mongodb';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, loadTranslationPrompts } from '../../lib/translate-core.mjs';
import { gatedTextCall, TRANSLATE_SUFFIX } from '../../lib/agy-cli.mjs';
const [IN, OUT] = process.argv.slice(2);
const MODEL = (process.argv.find((a) => a.startsWith('--model=')) || '--model=gemini-3.8-flash-low').slice(8);
const rows = JSON.parse(fs.readFileSync(IN, 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const prompts = await loadTranslationPrompts(db);
const PROJ = { id: 1, book_id: 1, page_number: 1, ocr: 1, translation: 1 };
for (const r of rows) {
  const f = path.join(OUT, `${r.key}.json`);
  if (fs.existsSync(f)) { console.log(r.key, 'done already'); continue; }
  const p = await db.collection('pages').findOne({ id: r.page_id }, { projection: PROJ });
  const book = await db.collection('books').findOne({ id: p.book_id });
  const near = await db.collection('pages').find({ book_id: p.book_id, page_number: { $in: [p.page_number - 1, p.page_number + 1] } }, { projection: PROJ }).toArray();
  const prev = near.find((n) => n.page_number === p.page_number - 1), next = near.find((n) => n.page_number === p.page_number + 1);
  const built = buildTranslationPrompt({ prompts, book, ocrText: r.ocr_text, previousTranslation: prev?.translation?.data || null, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined, pageBreak: PAGE_BREAK_SCOPED });
  const t0 = Date.now();
  const res = await gatedTextCall(built.prompt + TRANSLATE_SUFFIX, { model: MODEL, task: 'translate' });
  if (res.cls === 'quota') { console.error('QUOTA: stopping', res.err); process.exit(3); }
  fs.writeFileSync(f, JSON.stringify({ ...r, model: MODEL, prompt_ref: built.promptRef, english: res.cls ? '' : res.answer, error: res.cls || res.problem || null, secs: Math.round((Date.now() - t0) / 1000) }));
  console.log(r.key, res.cls || res.problem || 'ok', (res.answer || '').length, 'chars');
}
await c.close();
