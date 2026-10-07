#!/usr/bin/env node
// PRIOR ART: tengyur-characterize/detect.mjs (per-page detectors: negation, terms, verse share) compares nothing
// ACROSS pages; scripts/audit/ has no cross-page consistency check. Suggested on #6121 (vol 174 p312 read).
/**
 * verse-detect.mjs — step 2 of #6141, read-only, $0 (reads the dump from dump-pages.mjs, no Mongo).
 *
 * 1. Verse pādas: Tibetan segments in runs of >= 2 equal-length 7/9/11-syllable segments (verse-lib.mjs).
 * 2. Verses: pāda pairs adjacent on >= 3 pages are linked; weak links (w < 0.25 × the rarer pāda's page count)
 *    are cut so that a root text's consecutive verses do not chain into one; components > 8 pādas are chunked
 *    into 4s along their order. A verse OCCURS on a page where >= 2 of its pādas stand consecutively in a run.
 * 3. English: each run is aligned to the page's English verse blocks (monotone, line count ±1, position). An
 *    occurrence has a rendering when its run is aligned and either the occurrence is the whole run or the block
 *    has exactly one line per pāda (then the lines are sliced).
 *    Prose enumerations (half or more of the pādas end in དང "and") are dropped.
 * 4. Divergence: for the verse's most-rendered pāda span, the mean pairwise (1 − character-trigram Dice) of the
 *    normalised renderings (notes and tags out). Score = pages × divergence.
 * 5. Root: the Derge text ({D####}) each occurrence page is in; a verse that occurs inside PV (D4210), MMK (D3824)
 *    or its Prasannapadā (D3860), AK/AKBh (D4089/D4090) or BCA (D3871) is one whose Sanskrit we hold.
 *
 *   node --max-old-space-size=8000 scripts/eval/tengyur-improve/verse-detect.mjs --pages /root/timp/tengyur-pages.jsonl \
 *     --out scripts/eval/results/tengyur-improve-6141 --work /root/timp
 * Writes <out>/verses-top200.json + summary.json (committed), <work>/verses-all.json + occurrences.jsonl (box only).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { verseRuns, verseBlocks, alignRunsToBlocks, normEn, dice } from './verse-lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const PAGES = arg('pages', '/root/timp/tengyur-pages.jsonl');
const OUT = arg('out', 'scripts/eval/results/tengyur-improve-6141');
const WORK = arg('work', '/root/timp');
fs.mkdirSync(OUT, { recursive: true });

const SANSKRIT = {
  D4210: ['PV', '6a30909cbec66f86487f2e8d'], D3824: ['MMK', '6a3067d0c4fd77fb5b9f8378'], D3860: ['MMK', '6a3067d0c4fd77fb5b9f8378'],
  D4089: ['AK', '6955831757e3b773024f76ae'], D4090: ['AK', '6955831757e3b773024f76ae'], D3871: ['BCA', '6a308272675ed2bdbe36f649'],
};
const lines = async function* () { for await (const l of readline.createInterface({ input: fs.createReadStream(PAGES) })) yield JSON.parse(l); };

// ── pass 1: runs, pāda and bigram page counts, text marks ──
const pageRuns = new Map(), meta = new Map(), freq = new Map(), big = new Map();
const add = (m, k, id) => { let s = m.get(k); if (!s) m.set(k, s = new Set()); s.add(id); };
let nPages = 0;
for await (const p of lines()) {
  const marks = (p.bo.match(/\{D\d+[a-zA-Z]?\}/g) || []).map((x) => x.slice(1, -1));
  meta.set(p.id, { vol: p.vol, pn: p.pn, book_id: p.book_id, section: p.section, marks, has_en: !!p.en });
  if (!p.en) continue; nPages++;
  const runs = verseRuns(p.bo);
  if (!runs.length) continue;
  pageRuns.set(p.id, runs);
  for (const r of runs) { r.padas.forEach((k) => add(freq, k, p.id)); for (let i = 0; i + 1 < r.padas.length; i++) add(big, `${r.padas[i]}|${r.padas[i + 1]}`, p.id); }
}
// text in effect on every page
const ordered = [...meta.entries()].sort((a, b) => a[1].vol - b[1].vol || a[1].pn - b[1].pn);
let cur = null; for (const [, m] of ordered) { m.text = [...new Set([cur, ...m.marks])].filter(Boolean); if (m.marks.length) cur = m.marks[m.marks.length - 1]; }

// ── verses ──
const edges = [];
for (const [k, s] of big) {
  if (s.size < 3) continue;
  const [a, b] = k.split('|'); if (a === b) continue;
  if (s.size < 0.25 * Math.min(freq.get(a).size, freq.get(b).size)) continue;
  edges.push([a, b, s.size]);
}
const par = new Map(); const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
for (const [a, b] of edges) { for (const x of [a, b]) if (!par.has(x)) par.set(x, x); par.set(find(a), find(b)); }
const comps = new Map(); for (const x of par.keys()) { const r = find(x); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(x); }
const out = new Map(); for (const [a, b, w] of edges) { const o = out.get(a) || []; o.push([b, w]); out.set(a, o); }
const hasIn = new Set(edges.map((e) => e[1]));
const verseOf = new Map(); const verses = [];
for (const members of comps.values()) {
  // order: walk from sources along the strongest out-edge
  const set = new Set(members), seen = new Set(), order = [];
  const starts = members.filter((x) => !hasIn.has(x)).concat(members);
  for (const s of starts) {
    for (let x = s; x && !seen.has(x);) {
      seen.add(x); order.push(x);
      const nx = (out.get(x) || []).filter(([y]) => set.has(y) && !seen.has(y)).sort((a, b) => b[1] - a[1])[0];
      x = nx?.[0];
    }
  }
  const chunks = order.length > 8 ? Array.from({ length: Math.ceil(order.length / 4) }, (_, i) => order.slice(i * 4, i * 4 + 4)) : [order];
  for (const ch of chunks) { if (ch.length < 2 && order.length > 8) { const last = verses[verses.length - 1]; last.padas.push(...ch); ch.forEach((x) => verseOf.set(x, last.vid)); continue; }
    const v = { vid: `v${verses.length}`, padas: ch }; verses.push(v); ch.forEach((x) => verseOf.set(x, v.vid)); }
}
const V = new Map(verses.map((v) => [v.vid, { ...v, occ: [] }]));

// occurrences: >= 2 consecutive pādas of one verse inside a run
for (const [id, runs] of pageRuns) runs.forEach((r, ri) => {
  for (let i = 0; i < r.padas.length;) {
    const vid = verseOf.get(r.padas[i]); let j = i + 1;
    if (vid) while (j < r.padas.length && verseOf.get(r.padas[j]) === vid) j++;
    if (vid && j - i >= 2) V.get(vid).occ.push({ id, ri, i0: i, i1: j });
    i = j;
  }
});

// ── pass 2: English renderings ──
const need = new Map(); for (const v of V.values()) for (const o of v.occ) { const l = need.get(o.id) || []; l.push([v.vid, o]); need.set(o.id, l); }
const occFile = fs.createWriteStream(path.join(WORK, 'occurrences.jsonl'));
let aligned = 0, rendered = 0, occTotal = 0;
for await (const p of lines()) {
  const list = need.get(p.id); if (!list) continue;
  const runs = pageRuns.get(p.id); const blocks = verseBlocks(p.en); const al = alignRunsToBlocks(runs, blocks);
  for (const [vid, o] of list) {
    occTotal++;
    const run = runs[o.ri]; const bi = al.get(o.ri); let span = null;
    if (bi !== undefined) {
      aligned++;
      const bl = blocks[bi];
      if (o.i0 === 0 && o.i1 === run.padas.length) span = [bl.a, bl.b];
      else if (bl.lines.length === run.padas.length) span = [bl.lines[o.i0].a, bl.lines[o.i1 - 1].b];
    }
    o.span = span; o.key = run.padas.slice(o.i0, o.i1).join(' / '); o.edge = run.edge;
    if (span) { rendered++; o.en = p.en.slice(span[0], span[1]); }
    o.guard = { src: p.src || null, human: !!(p.src === 'manual' || p.ed) };
    const m = meta.get(p.id);
    occFile.write(JSON.stringify({ vid, page_id: p.id, book_id: p.book_id, vol: p.vol, pn: p.pn, section: p.section, text: m.text, key: o.key, i0: o.i0, i1: o.i1, run_len: run.padas.length, edge: run.edge, span, en: o.en || null, guard: o.guard }) + '\n');
  }
}
occFile.end();

// ── score ──
const all = [];
for (const v of V.values()) {
  const pages = new Set(v.occ.map((o) => o.id));
  if (pages.size < 3) continue;
  // A prose enumeration ("…dang / …dang") splits into equal segments too; it is not verse.
  if (v.padas.filter((x) => /དང$/.test(x)).length * 2 >= v.padas.length) continue;
  const byKey = new Map(); for (const o of v.occ) if (o.en) { const l = byKey.get(o.key) || []; l.push(o); byKey.set(o.key, l); }
  const [key, rs] = [...byKey.entries()].sort((a, b) => b[1].length - a[1].length)[0] || [null, []];
  let div = null;
  if (rs.length >= 2) {
    const t = rs.slice(0, 40).map((o) => normEn(o.en)); let s = 0, n = 0;
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) { s += 1 - dice(t[i], t[j]); n++; }
    div = Math.round((s / n) * 1000) / 1000;
  }
  const texts = new Set(v.occ.flatMap((o) => meta.get(o.id).text.filter(Boolean)));
  const roots = [...texts].filter((t) => SANSKRIT[t]);
  const secs = {}; for (const id of pages) { const s = meta.get(id).section; secs[s] = (secs[s] || 0) + 1; }
  all.push({ vid: v.vid, padas: v.padas, pages: pages.size, occurrences: v.occ.length, rendered: v.occ.filter((o) => o.en).length,
    primary_span: key, primary_renderings: rs.length, divergence: div, score: div == null ? 0 : Math.round(pages.size * div * 100) / 100,
    sanskrit: roots.length ? { work: SANSKRIT[roots[0]][0], book_id: SANSKRIT[roots[0]][1], root_text: roots } : null,
    texts: [...texts].sort().slice(0, 12), n_texts: texts.size, sections: secs,
    examples: v.occ.filter((o) => o.en).slice(0, 3).map((o) => ({ page_id: o.id, url: `https://sourcelibrary.org/book/${meta.get(o.id).book_id}?page=${meta.get(o.id).pn}` })) });
}
all.sort((a, b) => b.pages - a.pages);
fs.writeFileSync(path.join(WORK, 'verses-all.json'), JSON.stringify(all, null, 1));
const top = all.slice(0, 200);
fs.writeFileSync(path.join(OUT, 'verses-top200.json'), JSON.stringify(top, null, 1));
const summary = {
  measured_at: new Date().toISOString(), pages_with_english: nPages, pages_with_verse_runs: pageRuns.size, padas_distinct: freq.size,
  linked_pairs: edges.length, verses: verses.length, verses_on_3plus_pages: all.length, occurrences: occTotal, occ_aligned: aligned, occ_rendered: rendered,
  top200: { pages_median: top[Math.floor(top.length / 2)]?.pages, with_divergence: top.filter((x) => x.divergence != null).length,
    sanskrit_held: top.filter((x) => x.sanskrit).length, by_work: top.reduce((m, x) => (x.sanskrit && (m[x.sanskrit.work] = (m[x.sanskrit.work] || 0) + 1), m), {}) },
  all_sanskrit_held: all.filter((x) => x.sanskrit).length,
};
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary));
