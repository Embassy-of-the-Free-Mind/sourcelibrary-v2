#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate.mjs read (the live CLI translation lane: this copies its one-page prompt build,
// lines "Context exactly as the worker seeds it" onward, with no kept read so the page before's English is the stored
// one) and scripts/eval/pro-translate-6545/build-requests.py (#72's request rows for claude-arm.py). build-requests.py
// does not fit: it sends the v2#6545 eval prompt, not the production prompt the live lane builds for that book.
/**
 * #93: the request rows every fresh arm gets, the production translation prompt for each drawn page exactly as
 * cli-translate.mjs builds it (buildTranslationPrompt with the page before's stored English, the neighbours' OCR and
 * PAGE_BREAK_SCOPED, then TRANSLATE_SUFFIX: no tools, answer between <<<BEGIN>>>/<<<END>>>). Text only, no image.
 * Also snapshots each page's OCR and stored (LIVE) translation, and the prompt's hash.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/fable-frontier-93/requests.mjs --out=DIR
 * Read-only. Reads DIR/sample.json; writes DIR/pages.jsonl (OCR, LIVE, prompt ref) and DIR/req/prod.jsonl.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, loadTranslationPrompts } from '../../lib/translate-core.mjs';
import { TRANSLATE_SUFFIX } from '../../lib/agy-cli.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = arg('out'); if (!OUT) { console.error('--out=DIR'); process.exit(2); }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const S = JSON.parse(fs.readFileSync(path.join(OUT, 'sample.json'), 'utf8'));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const prompts = await loadTranslationPrompts(db);
const PROJ = { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1 };
fs.mkdirSync(path.join(OUT, 'req'), { recursive: true });
const pagesOut = [], req = [];
for (const sp of S.pages) {
  const p = await db.collection('pages').findOne({ id: sp.page_id }, { projection: PROJ });
  const book = await db.collection('books').findOne({ id: sp.book_id });
  if (sha(p.ocr.data) !== sp.ocr_sha || sha(p.translation.data) !== sp.live_sha) console.log(`  ${sp.uid}: changed since the draw (ocr ${sha(p.ocr.data) === sp.ocr_sha}, live ${sha(p.translation.data) === sp.live_sha})`);
  const near = await db.collection('pages').find({ book_id: p.book_id, page_number: { $in: [p.page_number - 1, p.page_number + 1] } }, { projection: PROJ }).toArray();
  const prev = near.find((n) => n.page_number === p.page_number - 1), next = near.find((n) => n.page_number === p.page_number + 1);
  const built = buildTranslationPrompt({ prompts, book, ocrText: p.ocr.data, previousTranslation: prev?.translation?.data || null, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined, pageBreak: PAGE_BREAK_SCOPED });
  const sent = built.prompt + TRANSLATE_SUFFIX;
  pagesOut.push({ uid: sp.uid, lang: sp.lang, ocr: p.ocr.data, live: p.translation.data, live_model: p.translation.model ?? null, prompt_ref: built.promptRef, is_english_book: built.isEnglish, prompt_sha: sha(sent), prompt_chars: sent.length, previous_translation: !!prev?.translation?.data });
  req.push({ uid: sp.uid, prompt: sent });
}
await c.close();
fs.writeFileSync(path.join(OUT, 'pages.jsonl'), pagesOut.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'req', 'prod.jsonl'), req.map((r) => JSON.stringify(r)).join('\n') + '\n');
const refs = {}; for (const r of pagesOut) { const k = `${r.prompt_ref?.name ?? '?'} v${r.prompt_ref?.version ?? '?'}`; refs[k] = (refs[k] ?? 0) + 1; }
console.log(`${req.length} requests; prompts ${JSON.stringify(refs)}; english books ${pagesOut.filter((r) => r.is_english_book).length}`);
