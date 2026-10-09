#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-arms/run-arms.mjs builds the same base prompt for Gemini; this only
// writes it to files so Opus subagents (subscription, X3 ceiling) translate from the identical text.
/**
 * x3-prompts.mjs — X3 ceiling arm (#5497): the base (B) prompt for 40 of the 113 judged sides, cut into
 * 8 files for 8 Opus subagents. Stratified, seed 5497: Toh 3808 18, Toh 1183 8, Toh 1189 8, small texts 6.
 *
 *   node scripts/eval/tengyur-arms/x3-prompts.mjs [--tref /root/tref] [--out /root/tarms/x3]
 */
import fs from 'node:fs';
import path from 'node:path';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt } from '../../lib/translate-core.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const opt = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const TREF = opt('tref', '/root/tref'), OUT = opt('out', '/root/tarms/x3');
fs.mkdirSync(OUT, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(TREF, 'arms', 'state.json'), 'utf8'));
const books = JSON.parse(fs.readFileSync(path.join(TREF, 'pages', 'books.json'), 'utf8'));
const ref = new Map(fs.readFileSync(path.join(TREF, 'ref', 'reference.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.page_id, r]));
const sample = JSON.parse(fs.readFileSync('scripts/eval/results/tengyur-ref-2026-10/judge/sample.json', 'utf8'));

// The 40 pages judged on 2026-10-03 are the committed list below; read it so the judged sample
// reproduces exactly. That draw was made with an inline LCG (lossy in double arithmetic, #5373), so
// the generator is not kept here: a NEW draw (no list on disk) uses the shared makeRng.
const DRAWN = 'scripts/eval/results/tengyur-arms-2026-10/arms/X3-pages.json';
const quota = { toh3808: 18, toh1183: 8, toh1189: 8 };
const by = {};
for (const x of sample) (by[quota[x.toh] ? x.toh : 'small'] ||= []).push(x);
let pick = [];
if (fs.existsSync(DRAWN)) {
  const byId = new Map(sample.map((x) => [x.page_id, x]));
  pick = JSON.parse(fs.readFileSync(DRAWN, 'utf8')).map((id) => byId.get(id)).filter(Boolean);
} else {
  const rnd = makeRng(5497);
  for (const [k, xs] of Object.entries(by)) {
    const q = quota[k] ?? 6;
    const sh = xs.map((x) => [rnd(), x]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
    pick.push(...sh.slice(0, q));
  }
}
const items = pick.map((x) => {
  const r = ref.get(x.page_id);
  return { page_id: x.page_id, toh: x.toh, folio: x.folio, prompt: buildTranslationPrompt({ prompts: state.prompts, book: books[r.vol], ocrText: r.src, pageBreak: PAGE_BREAK_SCOPED }).prompt };
});
const k = 8, n = Math.ceil(items.length / k);
for (let i = 0; i < k; i++) fs.writeFileSync(path.join(OUT, `in-${i + 1}.jsonl`), items.slice(i * n, (i + 1) * n).map((x) => JSON.stringify(x)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'pages.json'), JSON.stringify(pick.map((x) => x.page_id)));
console.log(`${items.length} pages → ${k} files; by text`, Object.fromEntries(Object.entries(by).map(([t]) => [t, pick.filter((x) => (quota[x.toh] ? x.toh : 'small') === t).length])));
