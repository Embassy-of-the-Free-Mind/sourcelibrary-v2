#!/usr/bin/env node
/**
 * Draw the per-language translation-share sample and the work-grouping checks (#7751).
 *
 * PRIOR ART: scripts/analysis/gap-validation-sample.mjs — the June Latin draw (n=1000, seed 2684), stratified on the
 * pipeline label over phase-2 clusters from Supabase. That frame is the cluster, Latin only, and needs the label to
 * stratify. This one draws UNIFORMLY over the phase-11 WORKS of any language (work-graph[-<lang>].jsonl), blind to the
 * ext/sl fields, and writes the same blind/answer-key pair so gap-validation-cli-adjudicate.mjs reads it unchanged.
 *
 * Part A: n works with >=1 USTC edition, uniform, seed 7751. Each gets a query card built from its editions only:
 *   modal author, the 2-3 most common edition titles (shortest first), first print year, number of editions.
 * Part B: 30 works with >=2 editions, two random member editions each ("same work?" -> wrong-merge rate), and
 *   30 pairs of single-edition works by the same author whose leading title tokens overlap (containment >= 0.5,
 *   >= 2 shared tokens) but which the graph did NOT merge ("same work?" -> missed-merge rate).
 *
 * Reads:  scripts/output/work-graph[-<lang>].jsonl, scripts/output/ustc-<lang>-editions.jsonl
 * Writes: scripts/output/translation-share/<lang>-frame.json  (ANSWER KEY: ext, sl, work id)
 *         scripts/output/translation-share/<lang>-blind.json  (adjudicator input: key, author, title, print_year, n_editions)
 *         scripts/output/translation-share/<lang>-grouping.json (Part B pairs; no answer needed)
 *
 * Usage: node scripts/analysis/translation-share-sample.mjs --lang german [--n 300] [--seed 7751]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { distinctiveTokens } from '../translation-layer/lib.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '../../scripts/output');
const DIR = path.join(OUT, 'translation-share');
fs.mkdirSync(DIR, { recursive: true });
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const LANG = String(arg('lang', 'latin')).toLowerCase();
const N = Number(arg('n', 300));
const N_GROUP = Number(arg('n-group', 30));
const SEED = Number(arg('seed', 7751));

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const readJsonl = (f) => fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const works = readJsonl(LANG === 'latin' ? 'work-graph.jsonl' : `work-graph-${LANG}.jsonl`).filter((w) => w.ustc_sns.length >= 1);
const eds = new Map(readJsonl(`ustc-${LANG}-editions.jsonl`).map((e) => [e.sn, e]));
console.log(`${LANG}: ${works.length} works with a USTC edition; ${eds.size} editions`);

const clip = (s, n = 220) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).replace(/\s\S*$/, '') + ' …' : s; };
const modal = (xs) => { const m = new Map(); for (const x of xs) if (x) m.set(x, (m.get(x) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || ''; };

// Editions with no sn (121K of 340K German ones in phase 11's cache) cannot be looked up: a work holding them speaks for
// them with its own representative title/author/year. Never eds.get(null): it returns the last sn-less edition read.
const known = (w) => w.ustc_sns.filter((sn) => sn != null && eds.has(sn));
const self = (w) => ({ sn: null, author_1: w.author || '', title: w.title, year: w.year_min });
function card(w) {
  const members = known(w).map((sn) => eds.get(sn));
  if (w.ustc_sns.some((sn) => sn == null)) members.push(self(w));
  const byTitle = new Map();
  for (const e of members) { const t = clip(e.title); if (t) byTitle.set(t, (byTitle.get(t) || 0) + 1); }
  const titles = [...byTitle].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t).sort((a, b) => a.length - b.length);
  const years = members.map((e) => e.year).filter(Boolean);
  return { author: modal(members.map((e) => e.author_1)) || w.author || '', titles,
    print_year: years.length ? Math.min(...years) : w.year_min, n_editions: w.ustc_sns.length };
}

// ---- Part A: uniform draw, blind
const rng = mulberry32(SEED);
const drawn = shuffle(works, rng).slice(0, N);
const frame = drawn.map((w, i) => {
  const c = card(w);
  return { key: `${LANG.slice(0, 2).toUpperCase()}${String(i + 1).padStart(3, '0')}`, work: w.work, ...c,
    title: c.titles.join(' || '), ext: !!w.ext, sl: w.sl, sl_books: w.sl_books.length,
    // every edition sn-less: in phase 11's cache these are USTC newspaper issues, one "work" per issue
    periodical_issue: w.ustc_sns.every((sn) => sn == null) };
});
fs.writeFileSync(path.join(DIR, `${LANG}-frame.json`), JSON.stringify({ lang: LANG, seed: SEED, n: N, pool: works.length,
  generated_for: '#7751 per-language translation share', works: frame }, null, 2));
fs.writeFileSync(path.join(DIR, `${LANG}-blind.json`), JSON.stringify({ lang: LANG, works: frame.map((w) => ({
  key: w.key, author: w.author, title: w.title, titles: w.titles, print_year: w.print_year, n_editions: w.n_editions })) }, null, 2));

// ---- Part B1: wrong merges — two random member editions of a random multi-edition work
const rngB = mulberry32(SEED ^ 0x5bd1e995);
// only works with two editions whose titles are known (an sn-less member has no title of its own here)
const multiPool = works.filter((w) => known(w).length >= 2);
const multi = shuffle(multiPool, rngB).slice(0, N_GROUP);
const merged = multi.map((w, i) => {
  const [a, b] = shuffle(known(w), rngB).slice(0, 2).map((sn) => eds.get(sn));
  return { key: `M${String(i + 1).padStart(2, '0')}`, work: w.work, n_editions: w.ustc_sns.length,
    a: { sn: a?.sn, author: a?.author_1 || '', title: clip(a?.title, 300), year: a?.year },
    b: { sn: b?.sn, author: b?.author_1 || '', title: clip(b?.title, 300), year: b?.year } };
});

// ---- Part B2: missed merges — same-author single-edition works with overlapping leading tokens, not merged
const orth = (s) => (s || '').replace(/[vV]/g, 'u').replace(/[jJ]/g, 'i');
const K = 6; // the leading-token window 11-work-graph.mjs compares
const lead = (t) => [...new Set(distinctiveTokens(orth(t)))].slice(0, K);
const byAuthor = new Map();
for (const w of works) {
  if (w.ustc_sns.length !== 1 || !w.author) continue;
  if (!byAuthor.has(w.author)) byAuthor.set(w.author, []);
  byAuthor.get(w.author).push(w);
}
const pool = [];
const PER_AUTHOR = 400; // authors with thousands of singles (ordinances) would swamp the pool: cap their members
for (const [, ws] of byAuthor) {
  if (ws.length < 2) continue;
  const sub = ws.length > PER_AUTHOR ? shuffle(ws, rngB).slice(0, PER_AUTHOR) : ws;
  const toks = sub.map((w) => lead(w.title));
  for (let i = 0; i < sub.length; i++) for (let j = i + 1; j < sub.length; j++) {
    const A = toks[i], B = toks[j];
    if (A.length < 2 || B.length < 2) continue;
    const shared = A.filter((t) => B.includes(t)).length;
    if (shared >= 2 && shared / Math.min(A.length, B.length) >= 0.5) pool.push([sub[i], sub[j], shared]);
  }
}
const missed = shuffle(pool, rngB).slice(0, N_GROUP).map(([x, y, shared], i) => {
  const a = (x.ustc_sns[0] != null && eds.get(x.ustc_sns[0])) || self(x), b = (y.ustc_sns[0] != null && eds.get(y.ustc_sns[0])) || self(y);
  return { key: `X${String(i + 1).padStart(2, '0')}`, works: [x.work, y.work], shared_lead_tokens: shared,
    a: { sn: a?.sn, author: a?.author_1 || x.author, title: clip(a?.title || x.title, 300), year: a?.year },
    b: { sn: b?.sn, author: b?.author_1 || y.author, title: clip(b?.title || y.title, 300), year: b?.year } };
});
fs.writeFileSync(path.join(DIR, `${LANG}-grouping.json`), JSON.stringify({ lang: LANG, seed: SEED,
  multi_pool: works.filter((w) => w.ustc_sns.length >= 2).length, multi_pool_known_titles: multiPool.length, missed_pool: pool.length, merged, missed }, null, 2));

console.log(`Part A: ${frame.length} drawn (seed ${SEED}); anonymous ${frame.filter((w) => !w.author).length}`);
console.log(`Part B: ${merged.length} merged pairs; ${missed.length} missed-merge pairs from a pool of ${pool.length}`);
