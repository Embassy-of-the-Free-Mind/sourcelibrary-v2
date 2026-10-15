// PRIOR ART: scripts/batch/cli-translate.mjs (the Gemini CLI read) and scripts/workers/translate-worker.mjs (the production lite call this mirrors). Ran as scripts/.tmp-lite-6559.mjs (imports are relative to scripts/); kept here as the record of what the lite arm sent.
// #6559 third arm (Derek 2026-10-14): gemini-3.1-flash-lite on the PAID API, realtime, temperature 0, thinking off.
//   translate --ids=F.json --out=DIR   translate-core's single-page prompt (PAGE_BREAK_SCOPED), seeded with the page
//                                      before (this arm's read if any, else stored), worker's maxOutputTokens + SAFETY_SETTINGS.
//   ocr --pages=pages.json --out=DIR   live OCR prompt + document context, image <=1500px, the orchestrator's OCR config
//                                      except temperature 0 (Derek's note) — recorded.
// Writes NOTHING to the database except the gemini_usage meter row callGemini logs.
import fs from 'node:fs'; import path from 'node:path'; import sharp from 'sharp';
import { MongoClient } from 'mongodb';
import { MODEL_LITE, SAFETY_SETTINGS, buildTranslationPrompt, loadTranslationPrompts, sanitizeTranslationTags, PAGE_BREAK_SCOPED, contentHash } from './lib/translate-core.mjs';
import { callGemini } from './lib/gemini-script-client.mjs';
import { costOf } from './lib/model-pricing.mjs';
import { liveOcrPrompt } from './lib/live-ocr-prompt.mjs';
import { getPageSource } from './lib/page-image-url.mjs';
const mode = process.argv[2]; const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out')); fs.mkdirSync(OUT, { recursive: true });
const ENDPOINT = 'scripts/eval/lite-arm-6559';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const P = { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1 };
let tot = { pages: 0, usd: 0, secs: 0, in: 0, out: 0 };
const save = (id, text, meta) => { fs.writeFileSync(path.join(OUT, `${id}.txt`), text); fs.writeFileSync(path.join(OUT, `${id}.meta.json`), JSON.stringify(meta, null, 1)); };
if (mode === 'translate') {
  const ids = JSON.parse(fs.readFileSync(arg('ids'), 'utf8')); const prompts = await loadTranslationPrompts(db); const books = new Map();
  for (const id of ids) {
    if (fs.existsSync(path.join(OUT, `${id}.meta.json`))) { console.log('  already', id); continue; }
    const p = await db.collection('pages').findOne({ id }, { projection: P });
    if (!books.has(p.book_id)) books.set(p.book_id, await db.collection('books').findOne({ id: p.book_id }));
    const book = books.get(p.book_id);
    const near = await db.collection('pages').find({ book_id: p.book_id, page_number: { $in: [p.page_number - 1, p.page_number + 1] } }, { projection: P }).toArray();
    const prev = near.find((n) => n.page_number === p.page_number - 1), next = near.find((n) => n.page_number === p.page_number + 1);
    let prevRead = ''; try { prevRead = prev ? fs.readFileSync(path.join(OUT, `${prev.id}.txt`), 'utf8').trim() : ''; } catch {}
    const previousTranslation = prevRead || prev?.translation?.data || null;
    const built = buildTranslationPrompt({ prompts, book, ocrText: p.ocr.data, previousTranslation, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined, pageBreak: PAGE_BREAK_SCOPED });
    const maxOutputTokens = Math.min(32768, Math.max(4096, Math.ceil(p.ocr.data.length) + 1200));
    const t0 = Date.now();
    const r = await callGemini({ model: MODEL_LITE, prompt: built.prompt, endpoint: ENDPOINT, temperature: 0, maxOutputTokens, safetySettings: SAFETY_SETTINGS, type: 'translation', bookId: p.book_id, pageIds: [id], triggeredBy: 'nahuatl-translate-2-6559' });
    const secs = (Date.now() - t0) / 1000, usd = costOf(r.model || MODEL_LITE, r.inputTokens, r.outputTokens);
    const text = sanitizeTranslationTags(r.text || '');
    save(id, text, { page_id: id, book_id: p.book_id, page_number: p.page_number, api: 'gemini', model: r.model || MODEL_LITE, generationConfig: r.generationConfig, input_tokens: r.inputTokens, output_tokens: r.outputTokens, thinking_tokens: r.thinkingTokens, finish: r.finishReason, usd, secs, prompt_ref: built.promptRef, prompt_sent_hash: contentHash(built.prompt), context: { previous_from: prevRead ? 'lite-read' : prev?.translation?.data ? 'stored' : null } });
    tot.pages++; tot.usd += usd; tot.secs += secs; tot.in += r.inputTokens; tot.out += r.outputTokens;
    console.log(`  p.${p.page_number} ${text.length} chars ${secs.toFixed(1)}s $${usd.toFixed(5)} ${r.finishReason}`);
  }
} else if (mode === 'ocr') {
  const pages = JSON.parse(fs.readFileSync(arg('pages'), 'utf8')); const { base, ref } = await liveOcrPrompt(db);
  for (const s of pages) {
    if (fs.existsSync(path.join(OUT, `${s.page}.meta.json`))) { console.log('  already', s.page); continue; }
    const p = await db.collection('pages').findOne({ id: s.page });
    const book = await db.collection('books').findOne({ id: p.book_id }, { projection: { title: 1, author: 1, year: 1 } });
    const yearStr = book.year ? `Published ${book.year}.` : ''; const cn = book.year && book.year < 1930 ? 'This work is in the public domain.' : '';
    const prompt = `${base}\n\n**Document context:** "${book.title || 'Unknown'}" by ${book.author || 'Unknown'}. ${yearStr} ${cn}`.trim();
    const src = getPageSource(p); const res = await fetch(src); const raw = Buffer.from(await res.arrayBuffer());
    const img = await sharp(raw).resize({ width: 1500, height: 1500, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    const t0 = Date.now();
    const r = await callGemini({ model: MODEL_LITE, prompt, imageParts: [img], endpoint: ENDPOINT, temperature: 0, maxOutputTokens: 16384, safetySettings: SAFETY_SETTINGS, type: 'ocr', bookId: p.book_id, pageIds: [p.id], triggeredBy: 'nahuatl-translate-2-6559' });
    const secs = (Date.now() - t0) / 1000, usd = costOf(r.model || MODEL_LITE, r.inputTokens, r.outputTokens);
    save(p.id, (r.text || '').trim(), { page_id: p.id, book_id: p.book_id, page_number: p.page_number, api: 'gemini', model: r.model || MODEL_LITE, generationConfig: r.generationConfig, input_tokens: r.inputTokens, output_tokens: r.outputTokens, finish: r.finishReason, usd, secs, image_url: src, image_px_max: 1500, prompt_ref: ref, prompt_sent_hash: contentHash(prompt) });
    tot.pages++; tot.usd += usd; tot.secs += secs; tot.in += r.inputTokens; tot.out += r.outputTokens;
    console.log(`  ${s.lang} p.${p.page_number} ${(r.text || '').length} chars ${secs.toFixed(1)}s $${usd.toFixed(5)} ${r.finishReason}`);
  }
}
console.log('TOTAL', JSON.stringify({ ...tot, usd: +tot.usd.toFixed(5), secs_per_page: tot.pages ? +(tot.secs / tot.pages).toFixed(1) : 0 }));
await c.close();
