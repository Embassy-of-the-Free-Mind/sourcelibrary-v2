// PRIOR ART: scripts/eval/translation-model-ab.mjs (the 2026-09-14 zh A/B: same prompt builder, seeded one-page-per-book draw) — it draws from the 樂舞 set and calls paid APIs; this draw is the #6101 woodblock frame (stored Flash + Paddle P1s text) plus Japanese pages with a stored gemini-3-flash translation, and makes no model call.
//
// Draw the #6101 Qwen translation eval set (PREREGISTRATION-qwen-translate-6101.md). Read-only.
//   zh: 40 pages, one per book, from the 1,883-page woodblock frame (frame-woodblock.json), where the
//       stored translation is gemini-3-flash-preview (source 'ai') made from the stored CBETA text, the OCR
//       is not newer than the translation, and the Paddle P1s split-leaf read exists.
//   ja: 20 pages, one per book, Japanese books, stored translation gemini-3-flash-preview (source 'ai'),
//       OCR not newer than the translation, ≥ 100 CJK characters with Han ≥ 25 %. Only 38 Japanese books carry a stored Flash translation and 17 qualify, so ja is n = 17 (brief asked 20).
// Every arm then gets the SAME prompt A got: the stored translation's prompt (by prompt_id), the
// production builder (PAGE_BREAK_SCOPED), and the stored previous-page translation as continuity.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/qwen-translate-6101/draw.mjs --p1=$JOB_SCRATCH/p1s --out=$JOB_SCRATCH/set
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { buildTranslationPrompt, translationPromptHeader, PAGE_BREAK_SCOPED } from '../../lib/translate-core.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const P1 = arg('p1'); const OUT = arg('out');
const SEED = 6101, N_ZH = 40, N_JA = 20;   // ja fills 17: the pool runs out
const HERE = path.dirname(new URL(import.meta.url).pathname);
const LABEL_LINE = /国立国会図書館|國立國會圖書館|請求記号|ガラス使用/;   // paddle-split-6101.mjs, unchanged
fs.mkdirSync(OUT, { recursive: true });

const frame = JSON.parse(fs.readFileSync('/root/cbeta-ref-6101/frame.json', 'utf8'));
const wb = JSON.parse(fs.readFileSync(path.join(HERE, '../results/paddle-split-6101/frame-woodblock.json'), 'utf8'));
const wbSlug = new Map(wb.pages.map(p => [p.slug, p]));
const p1Text = slug => {
  const rd = s => { const f = path.join(P1, slug, `${s}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
  const r = rd('R'), l = rd('L'); if (r == null || l == null) return null;
  return [r, l].join('\n').split('\n').filter(x => !LABEL_LINE.test(x)).join('\n').trim();
};
const cjk = s => [...s].filter(c => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(c));
const hanShare = s => { const c = cjk(s); return c.length ? c.filter(x => /\p{Script=Han}/u.test(x)).length / c.length : 0; };

const rng = makeRng(SEED);
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const PROJ = { book_id: 1, page_number: 1, ocr: 1, translation: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1 };
const okA = p => p?.translation?.model === 'gemini-3-flash-preview' && p.translation.source === 'ai' && (p.translation.data || '').length >= 200
  && (!p.ocr?.updated_at || !p.translation.updated_at || new Date(p.ocr.updated_at) <= new Date(p.translation.updated_at));
const promptCache = new Map();
const promptFor = async id => {
  if (!promptCache.has(id)) {
    const d = await db.collection('prompts').findOne({ _id: new ObjectId(id) });
    promptCache.set(id, d ? { translation: { text: d.content, ref: { id, name: d.name, version: d.version, content_hash: d.content_hash } } } : null);
  }
  return promptCache.get(id);
};
const bookCache = new Map();
const bookOf = async id => { if (!bookCache.has(id)) bookCache.set(id, await db.collection('books').findOne({ $or: [{ id }, ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : [])] })); return bookCache.get(id); };

async function item(stratum, page, slug, p1) {
  const book = await bookOf(page.book_id);
  const prompts = await promptFor(page.translation.prompt_id);
  if (!prompts) return null;
  const [prev, next] = await Promise.all([page.page_number - 1, page.page_number + 1].map(n => db.collection('pages').findOne({ book_id: page.book_id, page_number: n }, { projection: { 'ocr.data': 1, 'translation.data': 1 } })));
  const ctx = { prompts, book, previousTranslation: prev?.translation?.data || null, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined, pageBreak: PAGE_BREAK_SCOPED };
  const built = buildTranslationPrompt({ ...ctx, ocrText: page.ocr.data });
  const builtP1 = p1 ? buildTranslationPrompt({ ...ctx, ocrText: p1 }) : null;
  return {
    id: slug, stratum, book_id: page.book_id, page_number: page.page_number, title: book?.title, language: book?.language, published: book?.published,
    // getPageSource is split-aware. The set judged on 2026-10-23 was drawn with a hand-rolled pick; it differed on one
    // page only (ja-3b194c-p83, a split spread, not in the pilot) — see the experiment record.
    image_url: getPageSource(page),
    source_text: page.ocr.data, ocr_source: page.ocr.source, ocr_model: page.ocr.model,
    p1_text: p1 || null,
    prompt: built.prompt, prompt_p1: builtP1?.prompt || null, prompt_ref: prompts.translation.ref,
    A: { model: page.translation.model, updated_at: page.translation.updated_at, prompt_version: page.translation.prompt_version, text: page.translation.data },
  };
}

// ---- zh
const byBook = new Map();
for (const fp of frame.pages) { if (!wbSlug.has(fp.slug)) continue; (byBook.get(fp.book_id) || byBook.set(fp.book_id, []).get(fp.book_id)).push(fp); }
const zh = [];
let zhBooksSeen = 0;
for (const bid of shuffle([...byBook.keys()].sort())) {
  if (zh.length >= N_ZH) break;
  zhBooksSeen++;
  for (const fp of shuffle(byBook.get(bid).sort((a, b) => a.page_number - b.page_number))) {
    const p1 = p1Text(fp.slug); if (!p1 || p1.length < 30 || wbSlug.get(fp.slug).p1_loop) continue;
    const page = await db.collection('pages').findOne({ book_id: fp.book_id, page_number: fp.page_number }, { projection: PROJ });
    if (!okA(page) || page.ocr?.source !== 'cbeta-xml-p5') continue;
    const it = await item('zh', page, fp.slug, p1); if (!it) continue;
    it.image_url = fp.image_url || it.image_url; zh.push(it); break;
  }
}
console.log(`zh: ${zh.length} pages from ${zhBooksSeen} books tried (frame books ${byBook.size})`);

// ---- ja
const jaBooks = await db.collection('books').find({ language: 'Japanese', visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } }, { projection: { id: 1, _id: 1 } }).toArray();
const ja = [];
let jaTried = 0;
for (const b of shuffle(jaBooks.map(b => b.id || String(b._id)).sort())) {
  if (ja.length >= N_JA) break;
  const pages = await db.collection('pages').find({ book_id: b, page_number: { $gte: 3 }, 'translation.model': 'gemini-3-flash-preview', 'translation.source': 'ai' }, { projection: PROJ }).toArray();
  if (!pages.length) continue;
  jaTried++;
  for (const page of shuffle(pages.sort((x, y) => x.page_number - y.page_number))) {
    const t = page.ocr?.data || '';
    if (!okA(page) || cjk(t).length < 100 || hanShare(t) < 0.25) continue;
    const it = await item('ja', page, `ja-${b.slice(-6)}-p${page.page_number}`, null); if (!it) continue;
    ja.push(it); break;
  }
}
console.log(`ja: ${ja.length} pages from ${jaTried} books with a stored Flash translation (of ${jaBooks.length} translated Japanese books)`);
await c.close();

const set = [...zh, ...ja];
fs.writeFileSync(path.join(OUT, 'set.json'), JSON.stringify({ seed: SEED, drawn_at: new Date().toISOString(), n: set.length, items: set }, null, 1));
const vers = {}; for (const s of set) vers[s.prompt_ref.version] = (vers[s.prompt_ref.version] || 0) + 1;
console.log('prompt versions', vers, 'previous-page context', set.filter(s => /previous page/i.test(s.prompt)).length, 'missing image', set.filter(s => !s.image_url).length);
