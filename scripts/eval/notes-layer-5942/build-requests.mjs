#!/usr/bin/env node
// PRIOR ART: scripts/eval/plain-6728/build-requests.mjs (#6728) — CURRENT and PLAIN are built exactly as it builds
// them (live v13 via loadTranslationPrompts, buildTranslationPrompt with PAGE_BREAK_SCOPED, the stored previous page as
// seed, TRANSLATE_SUFFIX; PLAIN through prompts.mjs plainPrompt/plainSeed). It reads #6545's fixed panel; this draws
// its own 40 pages (PREREG.md) and adds the S arm (the same prompt with a JSON output block).
/**
 * #5942 Part B — $0, read-only. Draws the 40 pages and writes one request file per arm:
 *   $JOB_SCRATCH/b/req/{T,S,P}.jsonl   {uid, lang, book_id, page_number, page_id, prompt, prompt_hash}
 *   $JOB_SCRATCH/b/pages.json          the drawn pages with their OCR (the judge's source)
 *   scripts/eval/results/notes-layer-5942/part-b-pages.json   ids only (committed)
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/notes-layer-5942/build-requests.mjs
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, loadTranslationPrompts } from '../../lib/translate-core.mjs';
import { TRANSLATE_SUFFIX } from '../../lib/agy-cli.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { plainPrompt, plainSeed, md5 } from '../plain-6728/prompts.mjs';
import { S_FORMAT } from './s-format.mjs';

const SEED = 5942;
const PER_LANG = 10;
const LANGS = { Latin: ['Latin'], German: ['German'], Greek: ['Greek'], Chinese: ['Chinese', 'Classical Chinese'] };
const DESCRIPTION_ONLY = new Set(['blank', 'frontispiece', 'illustration', 'cover', 'map', 'diagram', 'musical-score', 'table']);
const W = `${process.env.JOB_SCRATCH}/b`;
const R = new URL('../results/notes-layer-5942/', import.meta.url).pathname;
fs.mkdirSync(`${W}/req`, { recursive: true });

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const live = await loadTranslationPrompts(db);
if (live.translation.ref.name !== 'Standard Translation' || live.translation.ref.version !== 13) throw new Error(`live default is ${live.translation.ref.name} v${live.translation.ref.version}, not v13`);
const plainText = plainPrompt(live.translation.text);
const P_PROMPTS = { translation: { text: plainText, ref: { id: null, name: 'Standard Translation v13, interpretive instructions removed [in memory, #6728]', version: 13, content_hash: md5(plainText) } }, english: live.english };

const drawn = [];
for (const [lang, values] of Object.entries(LANGS)) {
  const books = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 1 }, language: { $in: values }, reocr_candidate: { $ne: true } })
    .project({ _id: 0, id: 1, title: 1, language: 1, pipeline_auto: 1 }).toArray())
    .filter((b) => b.id && !b.pipeline_auto?.hold && b.pipeline_auto?.status !== 'held')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const rng = makeRng(SEED);
  for (let i = books.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [books[i], books[j]] = [books[j], books[i]]; }
  let got = 0, tried = 0;
  for (const b of books) {
    if (got >= PER_LANG) break;
    tried++;
    if (await db.collection('pages').countDocuments({ book_id: b.id, translation_withheld: { $exists: true } }, { limit: 1 })) continue;
    const cands = await db.collection('pages').find({ book_id: b.id, 'ocr.data': { $type: 'string' } })
      .project({ _id: 0, id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.source': 1 }).toArray();
    const byNum = new Map(cands.map((p) => [p.page_number, p]));
    const ok = [];
    for (const p of cands) {
      const t = p.ocr.data;
      if (p.ocr.source === 'ia_djvu' || DESCRIPTION_ONLY.has(p.page_type ?? '') || /<warning>/i.test(t)) continue;
      if (t.length < 600 || t.length > 3500) continue;
      if (!byNum.has(p.page_number - 1)) continue;
      ok.push(p.page_number);
    }
    if (!ok.length) continue;
    ok.sort((x, y) => x - y);
    // The previous page must carry a stored translation (the production seed).
    let pick = null;
    for (let k = 0; k < 5 && pick == null; k++) {
      const n = ok[Math.floor(rng() * ok.length)];
      const prev = await db.collection('pages').findOne({ book_id: b.id, page_number: n - 1 }, { projection: { 'translation.data': 1 } });
      if (prev?.translation?.data?.trim()) pick = n;
    }
    if (pick == null) continue;
    got++;
    drawn.push({ uid: `${lang.slice(0, 2).toLowerCase()}-${got}`, lang, book_id: b.id, title: b.title, page_number: pick });
  }
  console.log(`${lang}: ${got} pages from ${tried} books tried (${books.length} in frame)`);
}

const out = { T: [], S: [], P: [] };
const pages = [];
for (const r of drawn) {
  const book = await db.collection('books').findOne({ id: r.book_id });
  const near = await db.collection('pages').find({ book_id: r.book_id, page_number: { $in: [r.page_number - 1, r.page_number, r.page_number + 1] } }, { projection: { _id: 0, id: 1, page_number: 1, ocr: 1, translation: 1 } }).toArray();
  const cur = near.find((n) => n.page_number === r.page_number);
  const prev = near.find((n) => n.page_number === r.page_number - 1), next = near.find((n) => n.page_number === r.page_number + 1);
  const seed = prev?.translation?.data || null;
  const base = { book, ocrText: cur.ocr.data, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined, pageBreak: PAGE_BREAK_SCOPED };
  const built = {
    T: buildTranslationPrompt({ ...base, prompts: live, previousTranslation: seed }),
    S: buildTranslationPrompt({ ...base, prompts: live, previousTranslation: plainSeed(seed) }),
    P: buildTranslationPrompt({ ...base, prompts: P_PROMPTS, previousTranslation: plainSeed(seed) }),
  };
  for (const arm of ['T', 'S', 'P']) {
    const prompt = built[arm].prompt + (arm === 'S' ? S_FORMAT : '') + TRANSLATE_SUFFIX;
    out[arm].push({ uid: r.uid, lang: r.lang, book_id: r.book_id, page_number: r.page_number, page_id: cur.id, prompt, prompt_hash: md5(prompt) });
  }
  pages.push({ ...r, page_id: cur.id, ocr: cur.ocr.data, ocr_model: cur.ocr.model ?? null, prev_tail: (prev?.ocr?.data || '').slice(-300), next_head: (next?.ocr?.data || '').slice(0, 300), stored_translation_prompt: cur.translation?.prompt_version ?? null });
}
await c.close();
for (const [arm, rows] of Object.entries(out)) fs.writeFileSync(`${W}/req/${arm}.jsonl`, rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
fs.writeFileSync(`${W}/pages.json`, JSON.stringify(pages, null, 1));
fs.mkdirSync(R, { recursive: true });
fs.writeFileSync(`${R}part-b-pages.json`, JSON.stringify(pages.map(({ uid, lang, book_id, page_id, page_number }) => ({ uid, lang, book_id, page_id, page_number })), null, 1) + '\n');
console.log(`T ${md5(live.translation.text)} P ${md5(plainText)}; ${pages.length} pages`);
