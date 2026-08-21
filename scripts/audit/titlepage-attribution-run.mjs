#!/usr/bin/env node
/**
 * FULL RUN: propose an author for every book that currently reaches no author
 * page, by reading the book's own front matter.
 *
 * This is the pilot (`titlepage-model-pilot-v2.mjs`) pointed at the whole target
 * population. Same prompt, same guards, same evidence shape. Measured on a
 * 100-book control the method names an author on ~50-60% of books at ~90%
 * precision, and every residual error is a ROLE error — an editor, translator,
 * compiler or dissertation respondent promoted to author — never an invented
 * name.
 *
 * WRITES NOTHING TO MONGO. Output is an append-only JSONL of evidence. A byline
 * written into a store the nightly jobs read is actuation, not recording
 * (#3776); these rows are for a human to review.
 *
 * DURABILITY, because two earlier runs died mid-flight: rows are appended as
 * they are produced and completed book ids are re-read on start, so a crash
 * costs the in-flight call and nothing else. Never buffer paid work in memory.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/titlepage-attribution-run.mjs --limit=200
 *   node --env-file=.env.production.local scripts/audit/titlepage-attribution-run.mjs        # all
 */
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { attributionWindowOf } from '../lib/title-page-ocr.mjs';
import { foldOrtho } from '../lib/name-equivalence.mjs';

const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const CONC = Number((process.argv.find((a) => a.startsWith('--concurrency=')) || '').split('=')[1] || 8);
const MODEL = 'gemini-3.1-flash-lite';
const PROMPT_VERSION = (process.argv.find((a) => a.startsWith('--prompt=')) || '').split('=')[1] || 'titlepage-role-v3-namedquote';
const OUT = (process.argv.find((a) => a.startsWith('--out=')) || '').split('=')[1] || 'scripts/output/titlepage-attribution-proposals.jsonl';
const LANGS = (process.argv.find((a) => a.startsWith('--languages=')) || '').split('=')[1];
const PROMPT_FILE = (process.argv.find((a) => a.startsWith('--prompt-file=')) || '').split('=')[1] || './titlepage-prompt-v3.txt';
const API_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('No GEMINI_API_KEY'); process.exit(1); }

const PROMPT = readFileSync(new URL(PROMPT_FILE, import.meta.url), 'utf8');
const ai = new GoogleGenAI({ apiKey: API_KEY });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tpRender(win) {
  return win.map((w) => `--- PAGE ${w.page_number} [${w.page_type}${w.untyped_fallback ? ', UNTYPED GUESS' : ''}] ---\n${w.prose.slice(0, 2600)}`).join('\n\n');
}
/**
 * SCRIPT-AWARE, and it has to be.
 *
 * This normaliser used to strip to [a-z0-9], which reduces EVERY Chinese,
 * Arabic, Hebrew and Tibetan quote to the empty string. `quoteIsOnPage` then
 * failed its length test and discarded the proposal — so on the non-Latin run
 * it threw away 541 of 624 proposals (87%) for being written in a script it
 * could not read, and reported them as unverifiable. The prompt was fine; the
 * verifier was blind.
 *
 * \p{L}\p{N} keeps letters and numbers from every script. The floor drops to 4
 * because a CJK character is a word, not a letter, and six of them is a clause.
 */
const normQ = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
function quoteIsOnPage(q, prose) { const n = normQ(q); return n.length >= 4 && normQ(prose).includes(n); }
const latinShare = (x) => {
  const L = String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').match(/\p{L}/gu) || [];
  return L.length ? L.filter((c) => /[a-zA-Z]/.test(c)).length / L.length : 0;
};
function quoteSupportsName(quote, name) {
  if (latinShare(quote) < 0.6 || latinShare(name) < 0.6) return null;
  const q = foldOrtho(quote);
  const parts = foldOrtho(name).split(' ').filter((w) => w.length >= 4);
  if (!q || !parts.length) return null;
  return parts.some((p) => q.includes(p.slice(0, 4)));
}

async function callModel(prose, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL, contents: `${PROMPT}\n\n${prose}`,
        config: { temperature: 0, maxOutputTokens: 1200 },
      });
      let t = (res.text ?? '').trim();
      if (t.startsWith('```')) t = t.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      try { return { names: JSON.parse(t)?.names ?? [], usage: res.usageMetadata }; }
      catch { return { names: [], parse_failed: true, usage: res.usageMetadata }; }
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const pagesCol = db.collection('pages');

mkdirSync('scripts/output', { recursive: true });
const done = new Set();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).book_id); } catch { /* partial last line */ }
  }
  console.log(`resuming: ${done.size} books already recorded`);
}

const q = {
  visible: true, resource_type: { $exists: false }, pages_ocr: { $gt: 0 },
  $or: [{ author_id: { $in: [null] } }, { author_id: { $exists: false } }],
};
// Re-runs are scoped by language: the v3 prompt taught European attribution
// grammar only and returned "no author named" for 93% of non-Latin-script books
// against 47% of Latin ones, so those books need a different prompt, not a
// second look with the same one.
if (LANGS) { q.language = { $in: LANGS.split(',').map((s) => s.trim()) }; console.log(`language filter: ${LANGS}`); }
const total = await db.collection('books').countDocuments(q);
console.log(`target population: ${total.toLocaleString()} books that reach no author page`);

const cursor = db.collection('books').find(q, { projection: { id: 1, title: 1, author: 1 } });
const queue = [];
for await (const b of cursor) {
  if (done.has(b.id)) continue;
  queue.push(b);
  if (LIMIT && queue.length >= LIMIT) break;
}
console.log(`to process: ${queue.length}\n`);

// Resolve windows first (fast, DB) then close Mongo before the slow model phase.
const prepared = [];
for (const b of queue) {
  const win = await attributionWindowOf(pagesCol, b);
  if (win.length) prepared.push({ b, win });
}
console.log(`windows resolved: ${prepared.length} (${queue.length - prepared.length} had no usable pages)`);
await mc.close();

let processed = 0, proposals = 0, noAuthor = 0, dropped = 0, failed = 0, tokIn = 0, tokOut = 0;
const t0 = Date.now();

async function worker(slice) {
  for (const { b, win } of slice) {
    let out;
    try { out = await callModel(tpRender(win)); }
    catch { failed++; processed++; continue; }
    tokIn += out.usage?.promptTokenCount ?? 0;
    tokOut += out.usage?.candidatesTokenCount ?? 0;
    const proseByPage = new Map(win.map((w) => [String(w.page_number), w.prose]));
    const rows = [];
    for (const x of out.names ?? []) {
      if (String(x.role).toLowerCase() !== 'author') continue;
      if (!proseByPage.has(String(x.page)) || !quoteIsOnPage(x.quoted_line, proseByPage.get(String(x.page)))) { dropped++; continue; }
      const supports = quoteSupportsName(x.quoted_line, x.name_nominative);
      if (supports === false) { dropped++; continue; }
      rows.push({
        run_at: new Date().toISOString(), model: MODEL, prompt_version: PROMPT_VERSION,
        book_id: b.id, title: String(b.title ?? '').slice(0, 160), catalogued_author: b.author ?? null,
        proposed: x.name_nominative, as_printed: x.name_as_printed,
        page_number: Number(x.page),
        page_type: (win.find((w) => String(w.page_number) === String(x.page)) || {}).page_type ?? null,
        window_pages: win.map((w) => `${w.page_number}:${w.page_type}`).join(','),
        quoted_line: x.quoted_line, quote_supports_name: supports,
        model_confidence: x.confidence,
      });
    }
    if (rows.length) { appendFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); proposals += rows.length; }
    else { noAuthor++; appendFileSync(OUT, JSON.stringify({ book_id: b.id, run_at: new Date().toISOString(), model: MODEL, prompt_version: PROMPT_VERSION, no_author_named: true }) + '\n'); }
    processed++;
    if (processed % 100 === 0) {
      const rate = processed / ((Date.now() - t0) / 1000);
      console.log(`  ${processed}/${prepared.length}  proposals ${proposals}  no-author ${noAuthor}  dropped ${dropped}  ${rate.toFixed(1)}/s  eta ${(((prepared.length - processed) / rate) / 60).toFixed(0)}m`);
    }
  }
}

const slices = Array.from({ length: CONC }, (_, i) => prepared.filter((_, j) => j % CONC === i));
await Promise.all(slices.map(worker));

console.log(`\n══ done ══`);
console.log(`  books processed        : ${processed}`);
console.log(`  author proposed        : ${proposals} rows`);
console.log(`  page names no author   : ${noAuthor}`);
console.log(`  proposals dropped      : ${dropped} (quote not on cited page, or does not name them)`);
console.log(`  model call failures    : ${failed}`);
// Verified against ai.google.dev/gemini-api/docs/pricing on 2026-08-17.
// I had been carrying $0.10/$0.40 from memory and under-reported a run by 2.7x.
// Batch pricing is half of this and this job has no latency requirement.
const RATE_IN = 0.25, RATE_OUT = 1.50; // gemini-3.1-flash-lite, paid standard, per 1M
const cost = (tokIn / 1e6) * RATE_IN + (tokOut / 1e6) * RATE_OUT;
console.log(`  tokens                 : in ${tokIn.toLocaleString()}  out ${tokOut.toLocaleString()}`);
console.log(`  cost (standard tier)   : $${cost.toFixed(2)}   (batch would be $${((tokIn / 1e6) * 0.125 + (tokOut / 1e6) * 0.75).toFixed(2)})`);
console.log(`\n  evidence: ${OUT}  — NOT written to Mongo`);
