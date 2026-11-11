#!/usr/bin/env node
// PRIOR ART: scripts/eval/seam-prompt-6742/ab.mjs (the production CLI request reproduced call for call, arms P/P2/C,
// the #6742 join judge and PAGE_JUDGE, pool/claudeCall/agyOpen) — this reuses its builders, judges and pause logic.
// scripts/batch/claude-translate.mjs (the Opus block lane: buildBlockTranslationPrompt + CALL_SUFFIX + splitBlockReply,
// planBlocks, the drift/leaf-seam redo) and scripts/batch/cli-translate.mjs (the agy lane: one page per call, the
// write-guard re-read) are mirrored WITHOUT their side effects (no kept-read copy to R2, no lane registry row, no page
// write). Neither script can carry a per-book brief except as an --instructions-file line, which is where B puts it.
/**
 * book-brief-7499: does one per-book brief make page translations better? Preregistered in
 * scripts/eval/PREREGISTRATION-book-brief-7499.md. $0: Claude CLI + agy. Resumable: every stage appends to DIR.
 *
 *   N="node --env-file=/root/sourcelibrary/.env.production.local"; S=scripts/eval/book-brief-7499/run.mjs
 *   $N $S ctx       --out=DIR                  window, neighbours and brief-input pages from Mongo (read-only)
 *   $N $S brief     --out=DIR                  one Opus brief per book (+ the machine key the translator never sees)
 *   $N $S translate --out=DIR --arms=A,B,A2 [--engine=opus|agy] [--conc=3]
 *   $N $S extract   --out=DIR                  blind Opus: the English used for each glossary term, per page and arm
 *   $N $S pagejudge --out=DIR                  blind Opus whole-page judge: B vs A, A2 vs A, identical pairs; both orders
 *   $N $S seamjudge --out=DIR                  the #6742 join judge on the 11 joins per window
 *   $N $S leakjudge --out=DIR                  brief invention: A and B pages, with the brief, blind to arm
 *   $N $S refrecords --out=DIR                 records.jsonl for scripts/eval/translation-vs-reference/
 *   $N $S score     --out=DIR --results=R      report.json (the registered rule's output)
 */
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, buildBlockTranslationPrompt, loadTranslationPrompts, translationPromptHeader, isTranslatablePage, sameLanguageReason, sanitizeTranslationTags, dropLeafSeamBreaches, contentHash } from '../../lib/translate-core.mjs';
import { planBlocks } from '../../lib/translate-batch-seam.mjs';
import { dropDriftedPages, sourceProse, translationProse } from '../../lib/block-drift.mjs';
import { gatedTextCall, TRANSLATE_SUFFIX } from '../../lib/agy-cli.mjs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';
import { checkWrittenText } from '../../lib/write-text-guard.mjs';
import { CALL_SUFFIX, splitBlockReply } from '../../batch/claude-translate.mjs';
import { JUDGE } from '../seams-6742/judge-repairs.mjs';
import { claudeCall, extractJson, pool, shuffle } from '../seams-6742/lib.mjs';
import { pairText, packs, usageOf } from '../../maintenance/seam-repair-6742/seam-repair.mjs';
import { agyOpen } from '../../maintenance/seam-repair-6742/gemini-repair.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const append = (f, x) => fs.appendFileSync(f, JSON.stringify(x) + '\n');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const RESULTS = path.join(HERE, '../results/book-brief-7499');
const AGY_MODEL = 'gemini-3.8-flash-low';
const OPUS_STRATA = new Set(['latin', 'vernacular']);
export const A2_BOOKS = ['69c814536c6f3cc53c848191', '6952e4b477f38f6761bc7d4c', '69e72c75a409200ea79f4976'];
const V13 = { version: 13, hash: '516510147237b6a79d9d3f6e797bba7f' };
const engineOf = (b) => OPUS_STRATA.has(b.stratum) ? 'opus' : 'agy';
const loadCtx = (out) => JSON.parse(fs.readFileSync(path.join(out, 'ctx.json'), 'utf8'));
const callLog = (out, x) => append(path.join(out, 'calls.jsonl'), { ...x, at: new Date().toISOString() });

// ── ctx ──────────────────────────────────────────────────────────────────────
async function ctx(out) {
  fs.mkdirSync(out, { recursive: true });
  const draw = JSON.parse(fs.readFileSync(path.join(RESULTS, 'draw.json'), 'utf8'));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1 };
  const books = [];
  for (const d of draw.books) {
    const book = await db.collection('books').findOne({ id: d.book.id }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, original_language: 1 } });
    const [w0, w1] = d.window;
    const near = await db.collection('pages').find({ book_id: book.id, page_number: { $gte: w0 - 1, $lte: w1 + 1 } }, { projection: PROJ }).sort({ page_number: 1 }).toArray();
    const at = (n) => near.find(p => p.page_number === n);
    const win = d.page_ids.map(id => near.find(p => p.id === id));
    if (win.some(p => !p)) throw new Error(`window page missing for ${book.id}`);
    // brief input: the first 20 translatable pages outside the window, ≤ 2,500 chars each
    const cur = db.collection('pages').find({ book_id: book.id, page_number: { $not: { $gte: w0, $lte: w1 } } }, { projection: PROJ }).sort({ page_number: 1 }).batchSize(50);
    const briefPages = [];
    for await (const p of cur) {
      if (briefPages.length >= 20) break;
      if (!p.ocr?.data || !isTranslatablePage(p).ok || sameLanguageReason({ book, page: p })) continue;
      if (sourceProse(p.ocr.data).length < 150) continue;
      briefPages.push({ page_number: p.page_number, ocr: p.ocr.data.length > 2500 ? p.ocr.data.slice(0, 2500) + '\n[…]' : p.ocr.data });
    }
    const prev = at(w0 - 1), next = at(w1 + 1);
    books.push({ ...d, engine: engineOf(d), bookDoc: book,
      pages: win.map(p => ({ id: p.id, page_number: p.page_number, page_type: p.page_type, ocr: p.ocr.data, stored: p.translation?.data || null })),
      prev: prev ? { page_number: prev.page_number, ocr: prev.ocr?.data || null, stored: prev.translation?.data || null } : null,
      next: next ? { page_number: next.page_number, ocr: next.ocr?.data || null } : null,
      briefPages });
  }
  await c.close();
  fs.writeFileSync(path.join(out, 'ctx.json'), JSON.stringify({ at: new Date().toISOString(), books }, null, 1));
  for (const b of books) console.log(`${b.book.id} ${b.engine} window ${b.window.join('-')} brief-input ${b.briefPages.length} pages (${b.briefPages[0]?.page_number}…${b.briefPages.at(-1)?.page_number})`);
}

// ── brief ────────────────────────────────────────────────────────────────────
export const BRIEF_WRITER = `You are preparing a translator's brief for one historical book on Source Library. A translator will
receive this brief with EVERY page of the book, translating one page (or a few) at a time into English. The brief
exists to keep term renderings, name spellings and the handling of the page layout consistent across pages.

Below are the book's catalogue metadata, the source-work line the translator already sees, and the OCR
transcription of up to 20 pages of the book (OCR may contain errors; these are not the pages being translated).

Write the brief, AT MOST 400 words, in four parts, with these headings:
1. **The work** (at most 60 words): what the book is: genre, author, edition, language and register, base text vs
   translation or commentary. Do NOT summarise its content, plot or argument, and state no fact (dates, places,
   events, identifications) that a translator might be tempted to repeat on a page.
2. **Glossary** (15 to 30 lines): the recurring key terms of this book, as printed in the source (source script and
   spelling, lemma or headword form), each with ONE fixed English rendering, one per line: \`source term — English\`.
   Keep the author's distinctions: two source terms the author distinguishes get two different English words. Prefer
   renderings a scholar would accept; transliterate only where English has no equivalent. No explanations.
3. **Layout** (at most 60 words): how a page is built and how to carry it: base text vs commentary or gloss,
   marginalia, running heads, verse, parallel columns, footnotes, passages in another language.
4. **Names** (at most 15 lines): recurring people and places as printed — the English spelling to use.

Then, after the brief, give a machine key that the translator will NOT see: for every glossary term, the exact
strings in which it is printed in these pages (inflected forms, spelling variants, abbreviations; for Chinese, the
term itself and any variant characters).

Reply in exactly this form and nothing else:
<brief>
...the brief, in markdown...
</brief>
<key>
[{"source":"<the glossary's source term>","forms":["<exact printed form>", "..."],"english":"<its rendering>"}]
</key>`;

function briefInput(b) {
  const { prompt } = translationPromptHeader({ prompts: { translation: { text: '', ref: {} }, english: { text: '', ref: {} } }, book: b.bookDoc });
  const meta = { title: b.bookDoc.title, display_title: b.bookDoc.display_title, author: b.bookDoc.author, year: b.bookDoc.year ?? b.bookDoc.published, language: b.bookDoc.language, original_language: b.bookDoc.original_language };
  return `${BRIEF_WRITER}\n\n=== CATALOGUE METADATA ===\n${JSON.stringify(meta, null, 1)}\n\n=== SOURCE-WORK LINE ===\n${prompt.trim()}\n\n=== OCR OF ${b.briefPages.length} PAGES ===\n${b.briefPages.map(p => `--- page ${p.page_number} ---\n${p.ocr}`).join('\n\n')}\n`;
}
export function parseBrief(text) {
  const brief = text.match(/<brief>([\s\S]*?)<\/brief>/)?.[1]?.trim();
  const keyRaw = text.match(/<key>([\s\S]*?)<\/key>/)?.[1];
  let key = null; try { key = keyRaw ? JSON.parse(keyRaw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) : null; } catch { key = extractJson(keyRaw || '', '['); }
  return { brief, key };
}
const words = (t) => String(t).split(/\s+/).filter(Boolean).length;
async function brief(out) {
  const { books } = loadCtx(out);
  const dir = path.join(out, 'briefs'); fs.mkdirSync(dir, { recursive: true });
  const todo = books.filter(b => !fs.existsSync(path.join(dir, `${b.book.id}.json`)));
  const res = await pool(todo, 3, async (b) => {
    const r = await claudeCall(briefInput(b), 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    callLog(out, { stage: 'brief', book: b.book.id, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: usageOf(r) });
    const { brief: text, key } = r.cls ? {} : parseBrief(r.text);
    const ok = text && Array.isArray(key) && key.length >= 10 && words(text) <= 450;
    if (!ok) { console.log(`${b.book.id}: brief refused (${r.cls || `words ${text ? words(text) : 0}, key ${Array.isArray(key) ? key.length : 'none'}`})`); fs.writeFileSync(path.join(dir, `${b.book.id}.raw.txt`), r.text || ''); return { ok: false }; }
    fs.writeFileSync(path.join(dir, `${b.book.id}.json`), JSON.stringify({ book_id: b.book.id, model: r.model, words: words(text), brief: text, key, input_pages: b.briefPages.map(p => p.page_number) }, null, 1));
    fs.writeFileSync(path.join(dir, `${b.book.id}.md`), text + '\n');
    console.log(`${b.book.id}: brief ${words(text)} words, ${key.length} key terms`);
    return { ok: true };
  });
  console.log(JSON.stringify(res));
}
const loadBrief = (out, id) => JSON.parse(fs.readFileSync(path.join(out, 'briefs', `${id}.json`), 'utf8'));

// ── translate ────────────────────────────────────────────────────────────────
export const BRIEF_HEADER = `**Book brief** (written once for this whole book and given with every page; it describes the book and is NOT text of this page). Use its glossary renderings and name spellings whenever those terms or names occur on the page, and follow its layout notes. Translate only what the page's source says: never add to the translation, or to a note, anything from the brief that the page itself does not carry.`;
export const briefBlock = (text) => `${BRIEF_HEADER}\n\n--- BOOK BRIEF ---\n${text}\n--- END OF BOOK BRIEF ---`;
const readsFile = (out) => path.join(out, 'reads.jsonl');

async function translate(out, arms, engineFilter, conc) {
  const { books } = loadCtx(out);
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const prompts = await loadTranslationPrompts(c.db('bookstore')); await c.close();
  if (prompts.translation.ref.version !== V13.version || prompts.translation.ref.content_hash !== V13.hash) throw new Error(`default translation prompt is not the registered v13: ${JSON.stringify(prompts.translation.ref)}`);
  fs.mkdirSync(path.join(out, 'prompts'), { recursive: true });
  const all = readJsonl(readsFile(out));
  const okRead = new Map(all.filter(r => r.ok).map(r => [`${r.book}:${r.arm}:${r.page}`, r.text]));
  const chains = books.flatMap(b => arms.filter(a => a !== 'A2' || A2_BOOKS.includes(b.book.id)).map(arm => ({ b, arm })))
    .filter(({ b }) => !engineFilter || b.engine === engineFilter)
    .filter(({ b, arm }) => b.pages.some(p => !okRead.has(`${b.book.id}:${arm}:${p.page_number}`)));
  console.log(`${chains.length} chains to run (${chains.map(x => `${x.b.book.id.slice(-4)}:${x.arm}`).join(' ')})`);
  const extra = (b, arm) => arm === 'B' ? `\n\n${briefBlock(loadBrief(out, b.book.id).brief)}` : '';
  const saveSent = (sent) => { const h = contentHash(sent); const f = path.join(out, 'prompts', `${h}.txt`); if (!fs.existsSync(f)) fs.writeFileSync(f, sent); return h; };
  const rec = (b, arm, p, text, why, meta) => {
    const ok = !why;
    append(readsFile(out), { book: b.book.id, arm, page: p.page_number, page_id: p.id, ok, why: why || undefined, text, chars: text.length, ...meta });
    if (ok) okRead.set(`${b.book.id}:${arm}:${p.page_number}`, text);
  };
  const seedFor = (b, arm, n) => { const prev = okRead.get(`${b.book.id}:${arm}:${n - 1}`); return prev && !cliChatterReason(prev) ? sanitizeTranslationTags(prev) : n - 1 === b.prev?.page_number ? b.prev.stored : null; };
  const ocrAt = (b, n) => b.pages.find(p => p.page_number === n)?.ocr ?? (n === b.prev?.page_number ? b.prev.ocr : n === b.next?.page_number ? b.next.ocr : null);

  // agy: one page per call, as cli-translate.mjs read
  async function agyChain(b, arm) {
    for (const p of b.pages) {
      if (okRead.has(`${b.book.id}:${arm}:${p.page_number}`)) continue;
      const tries = all.filter(r => r.book === b.book.id && r.arm === arm && r.page === p.page_number).length;
      if (tries >= 2) { console.log(`  ${b.book.id} ${arm} p.${p.page_number}: gave up after ${tries}`); return { ok: false }; }
      if (!agyOpen(AGY_MODEL)) return { cls: 'usage_limit' };
      const built = buildTranslationPrompt({ prompts, book: b.bookDoc, ocrText: p.ocr, previousTranslation: seedFor(b, arm, p.page_number), prevOcrText: ocrAt(b, p.page_number - 1) || undefined, nextOcrText: ocrAt(b, p.page_number + 1) || undefined, pageBreak: PAGE_BREAK_SCOPED });
      const sent = built.prompt + extra(b, arm) + TRANSLATE_SUFFIX;
      const call = () => gatedTextCall(sent, { model: AGY_MODEL, task: 'translate', tmp: process.env.TMPDIR });
      let r = await call();
      if (!r.cls && !r.problem && checkWrittenText(r.answer, { kind: 'translation', source: p.ocr, lang: b.bookDoc.language, type: p.page_type }).verdict === 'truncated') r = { ...(await call()), reread: true };
      callLog(out, { stage: 'translate', engine: 'agy', book: b.book.id, arm, pages: [p.page_number], cls: r.cls, secs: Math.round(r.secs || 0), calls: r.calls });
      if (r.cls === 'quota') return { cls: 'usage_limit' };
      const text = r.cls ? '' : (r.answer || '');
      const why = r.cls || r.problem || (!text.trim() ? 'empty' : cliChatterReason(text));
      rec(b, arm, p, why ? text : sanitizeTranslationTags(text), why, { engine: 'agy', model: AGY_MODEL, sent_hash: saveSent(sent), prompt: built.promptRef, reread: !!r.reread });
      if (why) { all.push({ book: b.book.id, arm, page: p.page_number }); return agyChain(b, arm); }
    }
    return { ok: true };
  }

  // Opus: blocks of up to 10, as claude-translate.mjs read
  async function opusGroup(b, arm, group, attempt) {
    const first = group[0], last = group.at(-1);
    const built = buildBlockTranslationPrompt({ prompts, book: b.bookDoc, pages: group.map(p => ({ ...p, ocr: { data: p.ocr } })), previousTranslation: seedFor(b, arm, first.page_number), prevOcrText: ocrAt(b, first.page_number - 1) || undefined, nextOcrText: ocrAt(b, last.page_number + 1) || undefined, pageBreak: PAGE_BREAK_SCOPED });
    const sent = built.prompt + extra(b, arm) + CALL_SUFFIX;
    const r = await claudeCall(sent, 'opus');
    callLog(out, { stage: 'translate', engine: 'opus', book: b.book.id, arm, pages: group.map(p => p.page_number), attempt, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: usageOf(r) });
    if (r.cls === 'usage_limit') return { cls: 'usage_limit' };
    const texts = r.cls ? null : splitBlockReply(r.text, group.map(p => p.page_number));
    if (!texts) return { refused: true };
    const again = new Set();
    for (const p of group) { const raw = texts.get(p.page_number); if (raw != null && group.length > 1 && checkWrittenText(raw, { kind: 'translation', source: p.ocr, lang: b.bookDoc.language, type: p.page_type }).verdict === 'truncated') again.add(p.page_number); }
    for (const [n, t] of texts) texts.set(n, sanitizeTranslationTags(t));
    if (group.length > 1) {
      const pg = group.map(p => ({ ...p, ocr: { data: p.ocr } }));
      for (const d of dropDriftedPages(pg, texts).drifted) { again.add(d.prev); again.add(d.next); }
      for (const x of dropLeafSeamBreaches(pg, texts).breached) again.add(x.page);
    }
    const h = saveSent(sent), redo = [];
    for (const p of group) {
      if (again.has(p.page_number)) { redo.push(p); continue; }
      rec(b, arm, p, texts.get(p.page_number), null, { engine: 'opus', model: r.model, sent_hash: h, prompt: built.promptRef, block: group.map(x => x.page_number), attempt });
    }
    return { redo };
  }
  async function opusChain(b, arm) {
    const todo = b.pages.filter(p => !okRead.has(`${b.book.id}:${arm}:${p.page_number}`));
    // a chain resumes from its first unread page; blocks are planned over what is left, as a re-run of the script would
    const blocks = planBlocks(todo.map(p => ({ ...p, ocr: { data: p.ocr } })), { blockSize: 10 }).map(g => g.map(x => todo.find(p => p.id === x.id)));
    for (const group of blocks) {
      let r = await opusGroup(b, arm, group, 0);
      if (r.cls) return r;
      if (r.refused) { r = await opusGroup(b, arm, group, 1); if (r.cls) return r; }
      const alone = r.refused ? group : r.redo;
      for (const p of alone) {
        if (okRead.has(`${b.book.id}:${arm}:${p.page_number}`)) continue;
        let s = await opusGroup(b, arm, [p], 2); if (s.cls) return s;
        if (s.refused) { s = await opusGroup(b, arm, [p], 3); if (s.cls) return s; }
        if (s.refused) { rec(b, arm, p, '', 'refused', { engine: 'opus' }); return { ok: false }; }
      }
    }
    return { ok: true };
  }
  const res = await pool(chains, conc, ({ b, arm }) => (b.engine === 'agy' ? agyChain(b, arm) : opusChain(b, arm)),
    { probe: engineFilter === 'agy' ? async () => ({ cls: agyOpen(AGY_MODEL) ? null : 'usage_limit' }) : undefined, maxWaitH: 12 });
  console.log(JSON.stringify(res));
}

/** The final read per (book, arm, page): the last ok read. */
export function finalReads(out) {
  const m = new Map();
  for (const r of readJsonl(readsFile(out))) if (r.ok) m.set(`${r.book}:${r.arm}:${r.page}`, r.text);
  return m;
}

// ── term occurrences (mechanical) ────────────────────────────────────────────
export const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').replace(/[ſ]/g, 's').replace(/[-¬]\s*\n\s*/g, '').replace(/\s+/g, ' ').toLowerCase();
const CJK = /[㐀-鿿豈-﫿]/;
export function occurs(ocr, forms) {
  const t = fold(sourceProse(ocr));
  return forms.some(f => {
    const g = fold(f).trim(); if (!g) return false;
    if (CJK.test(g)) return t.includes(g);
    if (g.length < 3) return false;
    const esc = g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'u').test(t);
  });
}
function occurrenceMap(b, key) {
  return key.map((k, i) => ({ i, source: k.source, english: k.english, forms: [...new Set([k.source, ...(k.forms || [])])].filter(Boolean),
    pages: b.pages.filter(p => occurs(p.ocr, [k.source, ...(k.forms || [])])).map(p => p.page_number) }));
}

// ── extract ──────────────────────────────────────────────────────────────────
export const EXTRACTOR = `You are reading English translations of pages of a historical book against their source, to record HOW
particular source terms were rendered. You are not judging quality.

For each PAGE below you get the source text (OCR), its English translation, and a list of source TERMS that occur on
that source page (each with the printed forms to look for). For every term on every page, find where the translation
renders that occurrence and quote the English word or phrase used for it, exactly as written (at most 6 words). If the
term occurs several times on the page, quote the rendering used most often there. If it was left in the source
language or transliterated, quote that. If the translation does not render it at all, say null.

Reply with ONE JSON array, one object per page and term, and nothing else:
[{"page":<page number>,"term":<term number>,"rendering":"<quoted English>"|null}]`;
const EX_CAP = 7000;
const capT = (t, n = EX_CAP) => t.length > n ? t.slice(0, n) + '\n[… cut for length]' : t;
async function extract(out) {
  const { books } = loadCtx(out);
  const reads = finalReads(out);
  const file = path.join(out, 'extract.jsonl');
  const done = new Set(readJsonl(file).map(x => `${x.book}:${x.arm}`));
  const tasks = [];
  for (const b of books) {
    const occ = occurrenceMap(b, loadBrief(out, b.book.id).key).filter(o => o.pages.length >= 1);
    for (const arm of ['A', 'B', 'A2']) {
      if (done.has(`${b.book.id}:${arm}`)) continue;
      if (!b.pages.every(p => reads.has(`${b.book.id}:${arm}:${p.page_number}`))) continue;
      tasks.push({ b, arm, occ });
    }
  }
  console.log(`${tasks.length} extraction calls`);
  const res = await pool(tasks, 4, async ({ b, arm, occ }) => {
    const body = b.pages.map(p => {
      const terms = occ.filter(o => o.pages.includes(p.page_number));
      if (!terms.length) return null;
      return `##### PAGE ${p.page_number}\n--- SOURCE ---\n${capT(sourceProse(p.ocr))}\n--- ENGLISH ---\n${capT(translationProse(reads.get(`${b.book.id}:${arm}:${p.page_number}`)))}\n--- TERMS ON THIS PAGE ---\n${terms.map(o => `${o.i}. ${o.source} (printed as: ${o.forms.join(', ')})`).join('\n')}`;
    }).filter(Boolean).join('\n\n');
    if (!body) { append(file, { book: b.book.id, arm, rows: [] }); return { ok: true }; }
    const r = await claudeCall(`${EXTRACTOR}\n\n${body}\n`, 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    callLog(out, { stage: 'extract', book: b.book.id, arm, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: usageOf(r) });
    const arr = r.cls ? null : extractJson(r.text, '[');
    if (!Array.isArray(arr)) return { ok: false };
    append(file, { book: b.book.id, arm, model: r.model, rows: arr });
    return { ok: true };
  });
  console.log(JSON.stringify(res));
}

// ── page judge ───────────────────────────────────────────────────────────────
export const PAGE_JUDGE2 = `You are judging two English translations of the SAME page of a historical book against its source
(OCR transcription; it may contain OCR errors). For each PAIR below you get the SOURCE page and two VERSIONS, P and Q.
They were made by different processes; you are not told which is which and must not guess. They may be identical.

Judge FIDELITY over the whole page: which version renders the source more faithfully and completely? Count against a
version: source content left out, content added that the source does not carry, mistranslations that change meaning,
text left untranslated. Do not count style, word choice that keeps the meaning, formatting, or tags such as <note>,
<term>, <gloss>, <meta>. If neither is more faithful (including when they are the same), say "tie".

Also flag, for EACH version on its own: omission (a sentence, line, note or clause of the source is not rendered),
added (the version states something the source page does not carry, outside a clearly marked translator's note),
mistranslation (a rendering that changes the meaning).

For each pair, reply with:
{"pair":"<pair id>","better":"P"|"Q"|"tie","P_omission":true|false,"Q_omission":true|false,"P_added":true|false,"Q_added":true|false,"P_mistranslation":true|false,"Q_mistranslation":true|false,"note":"<= 25 words"}

Reply with ONE JSON array containing one object per pair, in order, and nothing else.`;
const PAGE_CAP = 8000;
const capP = (t) => t.length > PAGE_CAP ? t.slice(0, PAGE_CAP) + '\n[… cut for length]' : t;
export const pageBody = (t) => String(t).replace(/<(summary|keywords)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '').trim();
const pagePairText = (p) => `##### PAIR ${p.pair}\n--- SOURCE ---\n${capP(sourceProse(p.src))}\n--- VERSION P ---\n${capP(p.P)}\n--- VERSION Q ---\n${capP(p.Q)}`;
async function pagejudge(out) {
  const { books } = loadCtx(out);
  const reads = finalReads(out);
  const file = path.join(out, 'pagejudge.jsonl');
  const done = new Set(readJsonl(file).filter(j => j.better).map(j => j.pair));
  const rand = makeRng(74993);
  const items = [];
  const mk = (b, p, x, y, order, cmp, pairId) => { const [a, c] = order === 1 ? [x, y] : [y, x];
    return { pair: pairId || `${cmp}-${p.id}-${order}`, book: b.book.id, page: p.page_number, cmp, order, Pis: a, src: p.ocr, P: pageBody(reads.get(`${b.book.id}:${a}:${p.page_number}`)), Q: pageBody(reads.get(`${b.book.id}:${c}:${p.page_number}`)) }; };
  const all = [];
  for (const b of books) for (const p of b.pages) {
    const has = (a) => reads.has(`${b.book.id}:${a}:${p.page_number}`);
    if (has('A') && has('B')) { all.push({ b, p }); for (const o of [1, 2]) items.push(mk(b, p, 'B', 'A', o, 'B-A')); }
    if (has('A') && has('A2')) for (const o of [1, 2]) items.push(mk(b, p, 'A2', 'A', o, 'A2-A'));
  }
  for (const { b, p } of shuffle(all, rand).slice(0, 10)) for (const o of [1, 2]) items.push(mk(b, p, 'A', 'A', o, 'A-A', `AA-${p.id}-${o}`));
  const first = shuffle(items.filter(x => x.order === 1), rand), second = shuffle(items.filter(x => x.order === 2), rand);
  const todo = [...packs(first.filter(p => !done.has(p.pair)), 5), ...packs(second.filter(p => !done.has(p.pair)), 5)];
  console.log(`${items.length} pair-orders; ${todo.length} judge calls`);
  const res = await pool(todo, 4, async (pk) => {
    const r = await claudeCall(`${PAGE_JUDGE2}\n\n${pk.map(pagePairText).join('\n\n')}\n`, 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    callLog(out, { stage: 'pagejudge', n: pk.length, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: usageOf(r) });
    const arr = r.cls ? null : extractJson(r.text, '[');
    const by = new Map((Array.isArray(arr) ? arr : []).map(x => [x?.pair, x]));
    let n = 0;
    for (const p of pk) { const j = by.get(p.pair); if (!j || !['P', 'Q', 'tie'].includes(j.better)) continue; n++;
      append(file, { pair: p.pair, book: p.book, page: p.page, cmp: p.cmp, order: p.order, Pis: p.Pis, ...j, model: r.model }); }
    return { ok: n > 0 };
  });
  console.log(JSON.stringify(res));
}

// ── seam judge ───────────────────────────────────────────────────────────────
const EDGE = 1500;
const tail = (t) => t.length > EDGE ? '…' + t.slice(-EDGE) : t;
const head = (t) => t.length > EDGE ? t.slice(0, EDGE) + '…' : t;
async function seamjudge(out) {
  const { books } = loadCtx(out);
  const reads = finalReads(out);
  const file = path.join(out, 'seamjudge.jsonl');
  const done = new Set(readJsonl(file).filter(j => j.better).map(j => j.pair));
  const rand = makeRng(74994);
  const ex = (b, arm, n) => ({ enTailA: tail(translationProse(reads.get(`${b.book.id}:${arm}:${n}`))), enHeadB: head(translationProse(reads.get(`${b.book.id}:${arm}:${n + 1}`))) });
  const items = [], joins = [];
  for (const b of books) for (let i = 0; i + 1 < b.pages.length; i++) {
    const n = b.pages[i].page_number, has = (a) => reads.has(`${b.book.id}:${a}:${n}`) && reads.has(`${b.book.id}:${a}:${n + 1}`);
    const base = { book: b.book.id, n, srcTailA: tail(sourceProse(b.pages[i].ocr)), srcHeadB: head(sourceProse(b.pages[i + 1].ocr)) };
    const mk = (x, y, order, cmp, pid) => { const [P, Q] = order === 1 ? [x, y] : [y, x]; return { ...base, pair: pid || `${cmp}-${b.book.id}-${n}-${order}`, cmp, order, Pis: P, P: ex(b, P, n), Q: ex(b, Q, n) }; };
    if (has('A') && has('B')) { joins.push({ b, n, mk }); for (const o of [1, 2]) items.push(mk('B', 'A', o, 'B-A')); }
    if (has('A') && has('A2')) for (const o of [1, 2]) items.push(mk('A2', 'A', o, 'A2-A'));
  }
  for (const j of shuffle(joins, rand).slice(0, 20)) for (const o of [1, 2]) items.push(j.mk('A', 'A', o, 'A-A', `AA-${j.b.book.id}-${j.n}-${o}`));
  const first = shuffle(items.filter(x => x.order === 1), rand), second = shuffle(items.filter(x => x.order === 2), rand);
  const todo = [...packs(first.filter(p => !done.has(p.pair)), 10), ...packs(second.filter(p => !done.has(p.pair)), 10)];
  console.log(`${items.length} join pair-orders; ${todo.length} judge calls`);
  const res = await pool(todo, 4, async (pk) => {
    const r = await claudeCall(`${JUDGE}\n\n${pk.map(pairText).join('\n\n')}\n`, 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    callLog(out, { stage: 'seamjudge', n: pk.length, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: usageOf(r) });
    const arr = r.cls ? null : extractJson(r.text, '[');
    const by = new Map((Array.isArray(arr) ? arr : []).map(x => [x?.pair, x]));
    let n = 0;
    for (const p of pk) { const j = by.get(p.pair); if (!j || !['P', 'Q', 'tie'].includes(j.better)) continue; n++;
      append(file, { pair: p.pair, book: p.book, n: p.n, cmp: p.cmp, order: p.order, Pis: p.Pis, better: j.better, P_defect: j.P_defect, Q_defect: j.Q_defect, note: j.note, model: r.model }); }
    return { ok: n > 0 };
  });
  console.log(JSON.stringify(res));
}

// ── leak judge ───────────────────────────────────────────────────────────────
export const LEAK_JUDGE = `You are checking English translations of pages of a historical book for one specific fault: content
copied in from a BOOK BRIEF that the page itself does not carry.

The translator of each page may have been given the book brief below (a description of the whole book, a glossary
and a list of names). For each PAGE you get its source text (OCR, may contain errors) and an English translation.
List every statement, name, date, number, identification or explanation in the English (in the body OR in a note)
that (a) the source page does not carry, and (b) the brief does. Using the glossary's English for a source term that
IS on the page is NOT a fault; spelling a name that IS on the page as the brief spells it is NOT a fault. Content
the source page does not carry that is not in the brief either is not what you are asked about: leave it out.

For each page, reply with:
{"page":"<page id>","faults":[{"quote":"<the English, <= 20 words>","brief":"<the brief's words it comes from, <= 15 words>","where":"body"|"note"}]}
(faults is [] when there is none.) Reply with ONE JSON array, one object per page, in order, and nothing else.`;
async function leakjudge(out) {
  const { books } = loadCtx(out);
  const reads = finalReads(out);
  const file = path.join(out, 'leakjudge.jsonl');
  const done = new Set(readJsonl(file).map(j => j.item));
  const rand = makeRng(74995);
  const tasks = [];
  for (const b of books) {
    const brf = loadBrief(out, b.book.id).brief;
    const items = [];
    for (const p of b.pages) for (const arm of ['A', 'B']) {
      const t = reads.get(`${b.book.id}:${arm}:${p.page_number}`);
      if (t) items.push({ item: `${b.book.id}:${arm}:${p.page_number}`, book: b.book.id, arm, page: p.page_number, src: p.ocr, en: pageBody(t) });
    }
    // opaque ids, arms mixed in each pack
    const sh = shuffle(items, rand).map((x, k) => ({ ...x, pid: `${b.book.id.slice(-4)}-${String(k + 1).padStart(2, '0')}` }));
    for (const pk of packs(sh.filter(x => !done.has(x.item)), 4)) tasks.push({ brf, pk });
  }
  console.log(`${tasks.length} leak-judge calls`);
  const res = await pool(tasks, 4, async ({ brf, pk }) => {
    const body = pk.map(x => `##### PAGE ${x.pid}\n--- SOURCE ---\n${capP(sourceProse(x.src))}\n--- ENGLISH ---\n${capP(x.en)}`).join('\n\n');
    const r = await claudeCall(`${LEAK_JUDGE}\n\n=== BOOK BRIEF ===\n${brf}\n=== END OF BOOK BRIEF ===\n\n${body}\n`, 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    callLog(out, { stage: 'leakjudge', n: pk.length, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: usageOf(r) });
    const arr = r.cls ? null : extractJson(r.text, '[');
    const by = new Map((Array.isArray(arr) ? arr : []).map(x => [x?.page, x]));
    let n = 0;
    for (const x of pk) { const j = by.get(x.pid); if (!j || !Array.isArray(j.faults)) continue; n++;
      append(file, { item: x.item, book: x.book, arm: x.arm, page: x.page, pid: x.pid, faults: j.faults, model: r.model }); }
    return { ok: n > 0 };
  });
  console.log(JSON.stringify(res));
}

// ── reference records ────────────────────────────────────────────────────────
function refrecords(out) {
  const { books } = loadCtx(out);
  const reads = finalReads(out);
  const refs = readJsonl(path.join(RESULTS, 'refs.jsonl'));
  const rows = [];
  for (const b of books) {
    const ref = refs.find(r => r.book_id === b.book.id); const p = b.pages.find(x => x.page_number === b.ref_page);
    if (!ref || !p) continue;
    const cands = ['A', 'B', 'A2'].map(arm => ({ arm, text: reads.get(`${b.book.id}:${arm}:${p.page_number}`) })).filter(x => x.text).map(x => ({ arm: x.arm, text: pageBody(x.text) }));
    rows.push({ track: b.track, lang: b.lang, book_id: b.book.id, page_number: p.page_number, source_text: p.ocr, reference_text: ref.text,
      reference_meta: { ...ref.meta, private: !!ref.meta?.private, style: ref.meta?.style || 'free' }, candidates: cands });
  }
  fs.writeFileSync(path.join(out, 'ref-records.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`${rows.length} reference records`);
}

// ── score ────────────────────────────────────────────────────────────────────
export const normRendering = (s) => s == null ? null : fold(String(s).replace(/<[^>]+>/g, '').replace(/[*_"“”‘’'«»()[\].,;:!?]/g, ' ')).replace(/^(the|a|an) /, '').trim().split(' ').map(w => w.length > 3 ? w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '') : w).join(' ');
function clusterBoot(units, stat, iters = 10000, seed = 7499) {
  const rand = makeRng(seed), vals = [];
  for (let i = 0; i < iters; i++) { const s = Array.from({ length: units.length }, () => units[Math.floor(rand() * units.length)]); const v = stat(s); if (v != null && !Number.isNaN(v)) vals.push(v); }
  vals.sort((a, b) => a - b);
  return vals.length ? [vals[Math.floor(vals.length * 0.025)], vals[Math.floor(vals.length * 0.975)]] : null;
}
const r1 = (x) => x == null ? null : Math.round(x * 10) / 10;
const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

function score(out, resultsDir) {
  const { books } = loadCtx(out);
  const reads = finalReads(out);
  const report = { at: new Date().toISOString(), books: books.length, arms: {} };
  // reads
  for (const arm of ['A', 'B', 'A2']) report.arms[arm] = { pages: books.flatMap(b => b.pages.filter(p => reads.has(`${b.book.id}:${arm}:${p.page_number}`))).length };

  // 1. term consistency
  const ext = readJsonl(path.join(out, 'extract.jsonl'));
  const perBook = [];
  for (const b of books) {
    const brf = loadBrief(out, b.book.id);
    const occ = occurrenceMap(b, brf.key);
    const row = { book: b.book.id, stratum: b.stratum, glossary: brf.key.length, terms_in_window: occ.filter(o => o.pages.length).length, terms_2plus: occ.filter(o => o.pages.length >= 2).length, arms: {} };
    for (const arm of ['A', 'B', 'A2']) {
      const e = ext.filter(x => x.book === b.book.id && x.arm === arm).at(-1); if (!e) continue;
      const terms = [];
      let briefMatch = 0, briefN = 0;
      for (const o of occ.filter(o => o.pages.length >= 2)) {
        const rs = o.pages.map(n => e.rows.find(x => Number(x.page) === n && Number(x.term) === o.i)).filter(Boolean).map(x => normRendering(x.rendering)).filter(Boolean);
        if (rs.length < 2) continue;
        const cnt = {}; for (const r of rs) cnt[r] = (cnt[r] || 0) + 1;
        const modal = Math.max(...Object.values(cnt));
        terms.push({ term: o.source, n: rs.length, modal_share: modal / rs.length, distinct: Object.keys(cnt).length, renderings: cnt });
        const be = normRendering(o.english); for (const r of rs) { briefN++; if (r === be || r.includes(be) || be.includes(r)) briefMatch++; }
      }
      row.arms[arm] = { terms: terms.length, consistency: avg(terms.map(t => t.modal_share)), all_same: terms.filter(t => t.distinct === 1).length, brief_match: briefN ? briefMatch / briefN : null, detail: terms };
    }
    perBook.push(row);
  }
  const consUnits = perBook.filter(r => r.arms.A?.consistency != null && r.arms.B?.consistency != null);
  const dCons = (s) => avg(s.map(r => r.arms.B.consistency - r.arms.A.consistency)) * 100;
  const aaUnits = perBook.filter(r => r.arms.A?.consistency != null && r.arms.A2?.consistency != null);
  const dAA = (s) => avg(s.map(r => r.arms.A2.consistency - r.arms.A.consistency)) * 100;
  report.consistency = {
    books: consUnits.length, A: r1(avg(consUnits.map(r => r.arms.A.consistency)) * 100), B: r1(avg(consUnits.map(r => r.arms.B.consistency)) * 100),
    delta_B_A: r1(dCons(consUnits)), ci: clusterBoot(consUnits, dCons)?.map(r1),
    A2_A: aaUnits.length ? { books: aaUnits.length, delta: r1(dAA(aaUnits)), ci: clusterBoot(aaUnits, dAA)?.map(r1), B_A_same_books: r1(avg(aaUnits.filter(r => r.arms.B).map(r => r.arms.B.consistency - r.arms.A.consistency)) * 100) } : null,
    brief_match: { A: r1(avg(consUnits.map(r => r.arms.A.brief_match).filter(x => x != null)) * 100), B: r1(avg(consUnits.map(r => r.arms.B.brief_match).filter(x => x != null)) * 100) },
    terms_scored: { A: consUnits.reduce((s, r) => s + r.arms.A.terms, 0), B: consUnits.reduce((s, r) => s + r.arms.B.terms, 0) },
    per_book: perBook.map(r => ({ book: r.book, stratum: r.stratum, glossary: r.glossary, terms_in_window: r.terms_in_window, terms_2plus: r.terms_2plus, A: r1((r.arms.A?.consistency ?? NaN) * 100), B: r1((r.arms.B?.consistency ?? NaN) * 100), A2: r.arms.A2 ? r1(r.arms.A2.consistency * 100) : undefined, A_brief_match: r1((r.arms.A?.brief_match ?? NaN) * 100), B_brief_match: r1((r.arms.B?.brief_match ?? NaN) * 100) })),
  };
  report.consistency_detail = perBook;
  // NOT registered (added after reading the A2 detail, where "your father" / "our father" / "father" counted as three
  // renderings): the same score with possessives and demonstratives also stripped, and the registered score by engine.
  const DET = /^(?:(?:his|her|its|their|our|your|my|this|that|these|those) )+/;
  const consOf = (rows, arm) => avg(rows.map(t => { const c = {}; for (const r of t.raw) { const k = r.replace(DET, ''); c[k] = (c[k] || 0) + 1; } return Math.max(...Object.values(c)) / t.raw.length; }));
  for (const r of perBook) for (const a of Object.values(r.arms)) for (const t of a.detail) t.raw = Object.entries(t.renderings).flatMap(([k, n]) => Array(n).fill(k));
  const sens = perBook.filter(r => r.arms.A?.terms && r.arms.B?.terms).map(r => ({ book: r.book, A: consOf(r.arms.A.detail), B: consOf(r.arms.B.detail), A2: r.arms.A2?.terms ? consOf(r.arms.A2.detail) : null }));
  const dS = (s) => avg(s.map(r => r.B - r.A)) * 100, dSA = (s) => avg(s.map(r => r.A2 - r.A)) * 100;
  const sensAA = sens.filter(r => r.A2 != null);
  report.consistency_sensitivity_unregistered = { normalisation: 'registered + possessives/demonstratives stripped', A: r1(avg(sens.map(r => r.A)) * 100), B: r1(avg(sens.map(r => r.B)) * 100), delta_B_A: r1(dS(sens)), ci: clusterBoot(sens, dS)?.map(r1), A2_A: { delta: r1(dSA(sensAA)), ci: clusterBoot(sensAA, dSA)?.map(r1) },
    by_engine_registered: Object.fromEntries(['opus', 'agy'].map(e => { const u = consUnits.filter(r => books.find(b => b.book.id === r.book).engine === e); return [e, { books: u.length, delta_B_A: r1(dCons(u)), ci: clusterBoot(u, dCons)?.map(r1) }]; })) };
  for (const r of perBook) for (const a of Object.values(r.arms)) for (const t of a.detail) delete t.raw;

  // 2 + 5. page judge
  const pj = readJsonl(path.join(out, 'pagejudge.jsonl'));
  const pageVerdicts = (cmp, x, y) => {
    const by = new Map();
    for (const j of pj.filter(j => j.cmp === cmp)) { const k = `${j.book}:${j.page}`; (by.get(k) || by.set(k, {}).get(k))[j.order] = j; }
    const rows = [];
    for (const [k, o] of by) {
      if (!o[1] || !o[2]) continue;
      const pref = (j) => j.better === 'tie' ? 'tie' : j.better === 'P' ? j.Pis : (j.Pis === x ? y : x);
      const flag = (j, arm, f) => (j.Pis === arm ? j[`P_${f}`] : j[`Q_${f}`]) === true;
      const p1 = pref(o[1]), p2 = pref(o[2]);
      const both = (arm, f) => flag(o[1], arm, f) && flag(o[2], arm, f);
      rows.push({ key: k, book: k.split(':')[0], win: p1 === x && p2 === x, loss: p1 === y && p2 === y, tie: p1 === 'tie' && p2 === 'tie',
        [`${x}_omission`]: both(x, 'omission'), [`${y}_omission`]: both(y, 'omission'), [`${x}_added`]: both(x, 'added'), [`${y}_added`]: both(y, 'added'),
        [`${x}_mistr`]: both(x, 'mistranslation'), [`${y}_mistr`]: both(y, 'mistranslation') });
    }
    return rows;
  };
  const byBook = (rows) => Object.values(rows.reduce((m, r) => ((m[r.book] ||= []).push(r), m), {}));
  const lw = (s) => { const rs = s.flat(); return rs.length ? (rs.filter(r => r.loss).length - rs.filter(r => r.win).length) / rs.length * 100 : null; };
  const rate = (f) => (s) => { const rs = s.flat(); return rs.length ? rs.filter(r => r[f]).length / rs.length * 100 : null; };
  const diff = (fx, fy) => (s) => { const rs = s.flat(); return rs.length ? (rs.filter(r => r[fx]).length - rs.filter(r => r[fy]).length) / rs.length * 100 : null; };
  const BA = pageVerdicts('B-A', 'B', 'A'), AA2 = pageVerdicts('A2-A', 'A2', 'A');
  const ident = pageVerdicts('A-A', 'A', 'A');
  const summ = (rows, x, y) => { const u = byBook(rows); return { pages: rows.length, [`${x}_wins`]: rows.filter(r => r.win).length, [`${y}_wins`]: rows.filter(r => r.loss).length, ties: rows.filter(r => r.tie).length, split: rows.filter(r => !r.win && !r.loss && !r.tie).length,
    [`L_minus_W_pts (${x} loses)`]: r1(lw(u)), ci: clusterBoot(u, lw)?.map(r1),
    omission: { [x]: r1(rate(`${x}_omission`)(u)), [y]: r1(rate(`${y}_omission`)(u)), delta: r1(diff(`${x}_omission`, `${y}_omission`)(u)), ci: clusterBoot(u, diff(`${x}_omission`, `${y}_omission`))?.map(r1) },
    added: { [x]: r1(rate(`${x}_added`)(u)), [y]: r1(rate(`${y}_added`)(u)), delta: r1(diff(`${x}_added`, `${y}_added`)(u)), ci: clusterBoot(u, diff(`${x}_added`, `${y}_added`))?.map(r1) },
    mistranslation: { [x]: r1(rate(`${x}_mistr`)(u)), [y]: r1(rate(`${y}_mistr`)(u)), delta: r1(diff(`${x}_mistr`, `${y}_mistr`)(u)), ci: clusterBoot(u, diff(`${x}_mistr`, `${y}_mistr`))?.map(r1) } }; };
  report.page_judge = { B_vs_A: summ(BA, 'B', 'A'), A2_vs_A: summ(AA2, 'A2', 'A'), identical: { pairs: ident.length, tie_both_orders: ident.filter(r => r.tie).length },
    B_vs_A_on_A2_books: summ(BA.filter(r => A2_BOOKS.includes(r.book)), 'B', 'A'),
    by_engine: Object.fromEntries(['opus', 'agy'].map(e => [e, summ(BA.filter(r => books.find(b => b.book.id === r.book).engine === e), 'B', 'A')])) };

  // 4. seams
  const sj = readJsonl(path.join(out, 'seamjudge.jsonl'));
  const seamRows = (cmp, x, y) => {
    const by = new Map();
    for (const j of sj.filter(j => j.cmp === cmp)) { const k = `${j.book}:${j.n}`; (by.get(k) || by.set(k, {}).get(k))[j.order] = j; }
    const rows = [];
    for (const [k, o] of by) { if (!o[1] || !o[2]) continue;
      const d = (j, arm) => (j.Pis === arm ? j.P_defect : j.Q_defect) === true;
      rows.push({ key: k, book: k.split(':')[0], [x]: d(o[1], x) && d(o[2], x), [y]: d(o[1], y) && d(o[2], y) }); }
    return rows;
  };
  const seamSumm = (rows, x, y) => { const u = byBook(rows); return { joins: rows.length, [x]: r1(rate(x)(u)), [y]: r1(rate(y)(u)), delta: r1(diff(x, y)(u)), ci: clusterBoot(u, diff(x, y))?.map(r1) }; };
  const sIdent = sj.filter(j => j.cmp === 'A-A');
  report.seams = { B_vs_A: seamSumm(seamRows('B-A', 'B', 'A'), 'B', 'A'), A2_vs_A: seamSumm(seamRows('A2-A', 'A2', 'A'), 'A2', 'A'),
    identical: { pair_orders: sIdent.length, tie: sIdent.filter(j => j.better === 'tie').length } };

  // 6. brief invention
  const lj = readJsonl(path.join(out, 'leakjudge.jsonl'));
  const last = new Map(); for (const j of lj) last.set(j.item, j);
  const L = [...last.values()];
  const flagged = (arm) => L.filter(j => j.arm === arm && j.faults.length);
  const nA = L.filter(j => j.arm === 'A').length, nB = L.filter(j => j.arm === 'B').length;
  const leakUnits = byBook(L.map(j => ({ book: j.book, A: j.arm === 'A' && j.faults.length > 0, B: j.arm === 'B' && j.faults.length > 0, isA: j.arm === 'A', isB: j.arm === 'B' })));
  const leakDiff = (s) => { const rs = s.flat(); const a = rs.filter(r => r.isA), b = rs.filter(r => r.isB); return a.length && b.length ? (b.filter(r => r.B).length / b.length - a.filter(r => r.A).length / a.length) * 100 : null; };
  report.brief_invention = { pages: { A: nA, B: nB }, flagged_pages: { A: flagged('A').length, B: flagged('B').length },
    per_100: { A: r1(flagged('A').length / nA * 100), B: r1(flagged('B').length / nB * 100), excess_B: r1(leakDiff(leakUnits)), ci: clusterBoot(leakUnits, leakDiff)?.map(r1) },
    faults: L.filter(j => j.faults.length).map(j => ({ arm: j.arm, book: j.book, page: j.page, url: `https://sourcelibrary.org/book/${j.book}?page=${j.page}`, faults: j.faults })) };

  // 3. reference judge (when run)
  const refRes = path.join(resultsDir || out, 'ref-results.json');
  if (fs.existsSync(refRes)) { const rr = JSON.parse(fs.readFileSync(refRes, 'utf8')); report.reference = { gate: rr.gate?.pass ?? rr.gate, arms: Object.fromEntries(Object.entries(rr.arms || {}).map(([a, v]) => [a, { fidelity: v.fidelity?.mean, ci: v.fidelity?.ci, omission: v.omission?.rate ?? v.omission, n: v.n ?? v.pages }])), pairs: rr.pairs }; }

  // the registered rule
  const c = report.consistency, pg = report.page_judge.B_vs_A, bi = report.brief_invention.per_100;
  const aaHi = c.A2_A?.ci?.[1] ?? null;
  const build = c.delta_B_A >= 10 && c.ci?.[0] > 0 && aaHi != null && c.delta_B_A > aaHi && pg.ci?.[1] <= 5 && pg.omission.delta <= 5 && bi.excess_B <= 1;
  const dont = (c.A2_A?.ci && c.delta_B_A >= c.A2_A.ci[0] && c.delta_B_A <= c.A2_A.ci[1]) || c.delta_B_A < 5 || bi.excess_B > 3;
  report.rule = { build, dont, verdict: build ? 'BUILD' : dont ? "DON'T" : 'TEST-NEXT',
    checks: { 'consistency Δ ≥ +10': c.delta_B_A >= 10, 'consistency CI excludes 0': c.ci?.[0] > 0, 'Δ above A2−A upper end': aaHi != null && c.delta_B_A > aaHi, 'page L−W upper ≤ +5': pg.ci?.[1] <= 5, 'omission Δ ≤ +5': pg.omission.delta <= 5, 'brief invention excess ≤ 1/100': bi.excess_B <= 1 } };
  const dest = resultsDir || out; fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ consistency: report.consistency, page_judge: report.page_judge.B_vs_A, A2: report.page_judge.A2_vs_A, ident: report.page_judge.identical, seams: report.seams, brief_invention: { ...report.brief_invention, faults: report.brief_invention.faults.length }, rule: report.rule }, null, 1));
}

const STAGE = process.argv[2];
const OUT = arg('out');
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  if (!OUT) { console.error('--out=DIR'); process.exit(2); }
  if (STAGE === 'ctx') await ctx(OUT);
  else if (STAGE === 'brief') await brief(OUT);
  else if (STAGE === 'translate') await translate(OUT, arg('arms', 'A,B').split(','), arg('engine', null), Number(arg('conc', 3)));
  else if (STAGE === 'extract') await extract(OUT);
  else if (STAGE === 'pagejudge') await pagejudge(OUT);
  else if (STAGE === 'seamjudge') await seamjudge(OUT);
  else if (STAGE === 'leakjudge') await leakjudge(OUT);
  else if (STAGE === 'refrecords') refrecords(OUT);
  else if (STAGE === 'score') score(OUT, arg('results', null));
  else { console.error('stage: ctx|brief|translate|extract|pagejudge|seamjudge|leakjudge|refrecords|score'); process.exit(2); }
}
