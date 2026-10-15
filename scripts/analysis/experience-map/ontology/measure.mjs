#!/usr/bin/env node
// PRIOR ART: scripts/analysis/experience-map/retrieve/retrieve-aliveness-lexical.mjs — FTS5 over a laptop corpus
// (~/sl-corpus) that does not exist on the Hetzner box, and counts translator phrases per DIMENSION, not per concept;
// src/lib/search/page-rollup.ts — the same $searchMeta book facet, built for one reader query on the request path.
/**
 * Corpus measurements for the aliveness ontology (#6720). READ-ONLY: Atlas Search over `pages`, `books` by id.
 *
 *   node measure.mjs counts    → OUT/counts.json        per node: pages + books (all), per-phrase pages, and the
 *                                                        book facet (top 1,000 books) with each book's work date
 *   node measure.mjs passages  → OUT/cand-passages.jsonl per node: up to 14 candidate quotes, verbatim, from live books
 *   node measure.mjs edges     → OUT/cand-edges.jsonl    per edge: up to 6 pages that name both ends, with the window
 *   node measure.mjs verify    → OUT/verify.json         re-reads every quoted page; exit 1 if any quote is no longer verbatim on it
 *   node measure.mjs baseline  → OUT/baseline.json       pages of live books by century of the work (the denominator)
 *
 * Phrases are matched as Atlas `phrase` queries (lucene.standard: case-folded, NOT accent-folded) on translation.data
 * and ocr.data for counts, and on translation.data only for quotes (the reader quotes the English).
 * Work date per book, first that exists: /root/aliveness/dated-works.jsonl (work.year; basis title_page |
 * model_knowledge) → books.source_work_dates composition → books.original_work_year → edition year. Each count
 * carries its basis.
 *   OUT defaults to $JOB_SCRATCH/ontology. Run with node --env-file=<.env.production.local>.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { stripEditorialWrappers } from '../../../lib/strip-editorial-wrappers.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.env.ONTO_OUT || path.join(process.env.JOB_SCRATCH || '/tmp', 'ontology');
const DATED = process.env.DATED_WORKS || '/root/aliveness/dated-works.jsonl';
fs.mkdirSync(OUT, { recursive: true });
const { nodes } = JSON.parse(fs.readFileSync(path.join(HERE, 'seed-nodes.json'), 'utf8'));
const { edges } = JSON.parse(fs.readFileSync(path.join(HERE, 'seed-edges.json'), 'utf8'));
const byId = new Map(nodes.map((n) => [n.id, n]));
const NON_CONTENT = ['blank', 'illustration', 'title-page', 'colophon', 'frontispiece', 'digitizer-insert', 'index', 'toc', 'bibliography'];
const mode = process.argv[2];
const only = process.argv.includes('--only') ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(',')) : null;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const pages = db.collection('pages');

const phraseOr = (phrases, paths) => ({
  compound: { should: phrases.flatMap((q) => paths.map((p) => ({ phrase: { query: q, path: p } }))), minimumShouldMatch: 1 },
});
async function retry(fn, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= tries) throw e; await new Promise((r) => setTimeout(r, 2000 * (i + 1))); }
  }
}
async function facet(phrases, paths = ['translation.data', 'ocr.data']) {
  const [m] = await retry(() => pages.aggregate([{ $searchMeta: { index: 'pages_search', count: { type: 'total' },
    facet: { operator: { compound: { must: [phraseOr(phrases, paths)], filter: [{ range: { path: 'page_number', gt: 0 } }] } },
      facets: { book: { type: 'string', path: 'book_id', numBuckets: 1000 } } } } }]).toArray());
  return { pages: m?.count?.total ?? 0, buckets: (m?.facet?.book?.buckets ?? []).map((b) => [b._id, b.count]) };
}

// ---- book metadata + work dates
const dated = new Map();
if (fs.existsSync(DATED)) for (const l of fs.readFileSync(DATED, 'utf8').split('\n')) {
  if (!l.trim()) continue; try { const r = JSON.parse(l); if (Number.isFinite(r?.work?.year)) dated.set(r.book_id, r.work); } catch { /* partial line */ }
}
const yearOf = (s) => { const m = String(s ?? '').match(/-?\d{3,4}/); return m ? +m[0] : null; };
function workDate(b) {
  const d = dated.get(b.id) || dated.get(String(b._id));
  if (d) return { year: d.year, basis: `dated-works:${d.basis}`, display: d.display };
  // One composition entry only: an anthology's first treatise is not the date of the page a passage sits on.
  const swd = Array.isArray(b.source_work_dates) ? b.source_work_dates : [];
  const comps = swd.filter((x) => x?.type === 'composition');
  const comp = comps.length === 1 && !swd.some((x) => x?.type === 'compilation') ? comps[0] : null;
  if (comp && yearOf(comp.date) != null) return { year: yearOf(comp.date), basis: 'source_work_dates', display: comp.date_display || comp.date };
  if (Number.isFinite(b.original_work_year)) return { year: b.original_work_year, basis: 'original_work_year' };
  const y = Number.isFinite(b.year) ? b.year : yearOf(b.published);
  return y != null ? { year: y, basis: 'edition' } : { year: null, basis: 'none' };
}
const META = new Map();
async function loadBooks(ids) {
  const need = [...new Set(ids)].filter((i) => !META.has(i));
  for (let i = 0; i < need.length; i += 800) {
    const chunk = need.slice(i, i + 800);
    const rows = await retry(() => db.collection('books').find({ $or: [{ id: { $in: chunk } }, { _id: { $in: chunk } }] }, {
      projection: { id: 1, title: 1, display_title: 1, english_title: 1, author: 1, language: 1, year: 1, published: 1, tradition: 1,
        source_work_dates: 1, original_work_year: 1, visible: 1, hidden: 1, pages_count: 1 } }).toArray());
    for (const b of rows) {
      const m = { id: b.id || String(b._id), title: b.english_title || b.display_title || b.title || '', author: b.author || '', language: b.language || '',
        tradition: Array.isArray(b.tradition) ? b.tradition[0] : b.tradition || null, live: b.visible === true && b.hidden !== true && (b.pages_count || 0) > 0,
        edition_year: Number.isFinite(b.year) ? b.year : yearOf(b.published), work: workDate(b) };
      META.set(m.id, m); META.set(String(b._id), m);
    }
    for (const id of chunk) if (!META.has(id)) META.set(id, null);
  }
}

// ---- text: the reader's English, wrappers stripped; notes removed for quoting
// <term>/<gloss> are kept as sentinels (\u0001term\u0002, \u0003gloss\u0004) so the page can show them the way the
// reader does (term in italics, gloss beside it); `plain()` removes the sentinels, and verification runs on plain text.
const unwrap = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
export const plain = (s) => s.replace(/\u0001|\u0002/g, '').replace(/\u0003/g, '[').replace(/\u0004/g, ']');
function texts(raw) {
  const base = stripEditorialWrappers(String(raw || ''))
    .replace(/<term(?:\s[^>]*)?>([\s\S]*?)<\/term>/gi, '\u0001$1\u0002').replace(/<gloss(?:\s[^>]*)?>([\s\S]*?)<\/gloss>/gi, '\u0003$1\u0004');
  return { withNotes: unwrap(base), clean: unwrap(base.replace(/<note(?:\s[^>]*)?>[\s\S]*?<\/note>/gi, ' ')) };
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRe = (phrases) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${phrases.map((p) => esc(p).replace(/\s+/g, '\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
function sentences(t) {
  const out = []; const re = /[^.!?;]*(?:[.!?;]+|$)/g; let m;
  while ((m = re.exec(t)) && m[0]) { out.push({ s: m[0], at: m.index }); if (re.lastIndex >= t.length) break; }
  return out;
}
/** A verbatim window of `clean` around index `at`, whole sentences, 140–480 chars. */
function windowAt(t, at, end = at) {
  const ss = sentences(t); let i = ss.findIndex((x) => x.at + x.s.length > at); if (i < 0) return null;
  let j = ss.findIndex((x) => x.at + x.s.length >= end); if (j < i) j = i;
  let a = i, b = j;
  const len = () => ss[b].at + ss[b].s.length - ss[a].at;
  while (len() < 140 && (a > 0 || b < ss.length - 1)) { if (b < ss.length - 1) b++; else a--; if (len() < 140 && a > 0) a--; }
  let q = t.slice(ss[a].at, ss[b].at + ss[b].s.length).trim(); let cutL = false, cutR = false;
  if (q.length > 480) {
    const rel = at - ss[a].at; let s0 = Math.max(0, rel - 200); let s1 = Math.min(q.length, Math.max(rel + 280, end - ss[a].at + 60));
    if (s0 > 0) { s0 = q.indexOf(' ', s0) + 1; cutL = true; } if (s1 < q.length) { s1 = q.lastIndexOf(' ', s1); cutR = true; }
    q = q.slice(s0, s1).trim();
  }
  // a window can cut a term/gloss in half: drop the orphan sentinel, keep its text
  for (const [o, c] of [['\u0001', '\u0002'], ['\u0003', '\u0004']]) {
    let depth = 0, outq = '';
    for (const ch of q) { if (ch === o) { depth++; outq += ch; } else if (ch === c) { if (depth) { depth--; outq += ch; } } else outq += ch; }
    if (depth) { let k = outq.length; while (depth && k--) if (outq[k] === o) { outq = outq.slice(0, k) + outq.slice(k + 1); depth--; } }
    q = outq;
  }
  return { quote: q.trim(), cutL, cutR };
}
async function pageTexts(hits) {
  const ids = hits.map((h) => ({ book_id: h.book_id, page_number: h.page_number }));
  if (!ids.length) return new Map();
  const rows = await retry(() => pages.find({ $or: ids }, { projection: { book_id: 1, page_number: 1, page_type: 1, 'translation.data': 1, translation_withheld: 1 } }).toArray());
  return new Map(rows.map((r) => [`${r.book_id}#${r.page_number}`, r]));
}
async function searchPages(must, limit) {
  return retry(() => pages.aggregate([
    { $search: { index: 'pages_search', compound: { must, filter: [{ range: { path: 'page_number', gt: 0 } }] } } },
    { $limit: limit }, { $project: { _id: 0, book_id: 1, page_number: 1, score: { $meta: 'searchScore' } } }]).toArray());
}
const cent = (y) => (y == null ? null : Math.floor(y / 100) * 100);
const link = (b, p) => `https://sourcelibrary.org/book/${b}?page=${p}`;

if (mode === 'counts') {
  const out = {};
  const prev = fs.existsSync(path.join(OUT, 'counts.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'counts.json'), 'utf8')) : {};
  for (const n of nodes) {
    if (only && !only.has(n.id)) { if (prev[n.id]) out[n.id] = prev[n.id]; continue; }
    const all = await facet(n.search);
    const en = await facet(n.search, ['translation.data']);
    const perPhrase = {};
    for (const p of n.search) perPhrase[p] = (await facet([p])).pages;
    await loadBooks(all.buckets.map(([b]) => b));
    const books = all.buckets.map(([b, c]) => { const m = META.get(b); return m ? { id: m.id, pages: c, live: m.live, year: m.work.year, basis: m.work.basis, tradition: m.tradition, language: m.language } : { id: b, pages: c, live: false, year: null, basis: 'missing' }; });
    out[n.id] = { pages: all.pages, pages_en: en.pages, books_faceted: books.length, books_capped: books.length >= 1000, per_phrase: perPhrase, books };
    console.log(`${n.id.padEnd(22)} ${String(all.pages).padStart(8)} pages ${String(books.length).padStart(5)} books${books.length >= 1000 ? '+' : ''}`);
    fs.writeFileSync(path.join(OUT, 'counts.json'), JSON.stringify({ ...prev, ...out }));
  }
  fs.writeFileSync(path.join(OUT, 'counts.json'), JSON.stringify({ ...prev, ...out }));
}

if (mode === 'passages') {
  const f = path.join(OUT, 'cand-passages.jsonl');
  const done = new Set(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).node) : []);
  const w = fs.createWriteStream(f, { flags: 'a' });
  for (const n of nodes) {
    if ((only && !only.has(n.id)) || done.has(n.id)) continue;
    const hits = await searchPages([phraseOr(n.search, ['translation.data'])], 400);
    await loadBooks(hits.map((h) => h.book_id));
    const perBook = new Map();
    for (const h of hits) { const m = META.get(h.book_id); if (!m?.live) continue; if (!perBook.has(m.id)) perBook.set(m.id, []); if (perBook.get(m.id).length < 2) perBook.get(m.id).push(h); }
    const pick = [...perBook.values()].flat().slice(0, 60);
    const txt = await pageTexts(pick);
    const re = termRe(n.search); const cands = [];
    for (const h of pick) {
      const p = txt.get(`${h.book_id}#${h.page_number}`); if (!p || p.translation_withheld || NON_CONTENT.includes(p.page_type)) continue;
      const { clean, withNotes } = texts(p.translation?.data); const m = re.exec(clean); if (!m) continue;
      const win = windowAt(clean, m.index, m.index + m[0].length); if (!win || win.quote.length < 60) continue;
      if (!plain(clean).includes(plain(win.quote)) || !plain(withNotes).includes(plain(win.quote))) continue; // verbatim, and no note elided inside it
      const b = META.get(h.book_id);
      cands.push({ book_id: b.id, page: h.page_number, url: link(b.id, h.page_number), title: b.title, author: b.author, language: b.language, tradition: b.tradition,
        year: b.work.year, basis: b.work.basis, edition_year: b.edition_year, matched: m[0], quote: win.quote, cut: [win.cutL, win.cutR], score: +h.score.toFixed(2) });
    }
    // spread over time: keep the earliest, the latest, and the best-scoring of each century, up to 14
    const byC = new Map(); for (const c of cands) { const k = cent(c.year) ?? 'nd'; if (!byC.has(k)) byC.set(k, []); byC.get(k).push(c); }
    const sel = []; const rounds = [...byC.values()];
    for (let r = 0; sel.length < 14 && rounds.some((x) => x[r]); r++) for (const x of rounds) if (x[r] && sel.length < 14) sel.push(x[r]);
    w.write(JSON.stringify({ node: n.id, label: n.label, hits: hits.length, live_books: perBook.size, candidates: sel }) + '\n');
    console.log(`${n.id.padEnd(22)} hits ${String(hits.length).padStart(3)} books ${String(perBook.size).padStart(3)} cands ${sel.length}`);
  }
  w.end();
}

if (mode === 'edges') {
  const f = path.join(OUT, 'cand-edges.jsonl');
  const done = new Set(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : []);
  const w = fs.createWriteStream(f, { flags: 'a' });
  for (const e of edges) {
    const key = `${e.from}|${e.type}|${e.to}`; if (done.has(key)) continue;
    const A = e.cue_from || byId.get(e.from).search, B = e.cue_to || byId.get(e.to).search;
    const hits = await searchPages([phraseOr(A, ['translation.data']), phraseOr(B, ['translation.data'])], 120);
    await loadBooks(hits.map((h) => h.book_id));
    const seen = new Set(); const pick = [];
    for (const h of hits) { const m = META.get(h.book_id); if (!m?.live || seen.has(m.id)) continue; seen.add(m.id); pick.push(h); if (pick.length >= 24) break; }
    const txt = await pageTexts(pick); const ra = termRe(A), rb = termRe(B); const cands = [];
    for (const h of pick) {
      const p = txt.get(`${h.book_id}#${h.page_number}`); if (!p || p.translation_withheld || NON_CONTENT.includes(p.page_type)) continue;
      const { clean, withNotes } = texts(p.translation?.data);
      // the closest pair of mentions
      const as = [...clean.matchAll(new RegExp(ra.source, 'giu'))], bs = [...clean.matchAll(new RegExp(rb.source, 'giu'))];
      let best = null; for (const a of as) for (const b of bs) { const d = Math.abs(a.index - b.index); if (!best || d < best.d) best = { d, a, b }; }
      if (!best || best.d > 700) continue;
      const lo = Math.min(best.a.index, best.b.index), hi = Math.max(best.a.index + best.a[0].length, best.b.index + best.b[0].length);
      const win = windowAt(clean, lo, hi); if (!win || !plain(clean).includes(plain(win.quote)) || !plain(withNotes).includes(plain(win.quote))) continue;
      const b = META.get(h.book_id);
      cands.push({ book_id: b.id, page: h.page_number, url: link(b.id, h.page_number), title: b.title, author: b.author, year: b.work.year, basis: b.work.basis, quote: win.quote, cut: [win.cutL, win.cutR] });
      if (cands.length >= 6) break;
    }
    w.write(JSON.stringify({ key, ...e, cooccur_pages: hits.length, candidates: cands }) + '\n');
    console.log(`${key.padEnd(48)} co ${String(hits.length).padStart(3)} cands ${cands.length}`);
  }
  w.end();
}
if (mode === 'verify') {
  // Re-read every page ontology.json quotes and confirm the quote is still verbatim on it (and the page not withheld).
  const o = JSON.parse(fs.readFileSync(path.join(HERE, 'ontology.json'), 'utf8'));
  const qs = [...o.nodes.flatMap((n) => n.passages.map((p) => ({ where: n.id, ...p }))),
    ...o.edges.filter((e) => e.provenance.kind === 'passage').map((e) => ({ where: `${e.from}|${e.type}|${e.to}`, ...e.provenance.passage }))];
  const bad = [];
  for (let i = 0; i < qs.length; i += 50) {
    const chunk = qs.slice(i, i + 50).map((q) => { const m = q.url.match(/book\/([^?]+)\?page=(\d+)/); return { ...q, book_id: m[1], page_number: +m[2] }; });
    const txt = await pageTexts(chunk);
    for (const q of chunk) {
      const p = txt.get(`${q.book_id}#${q.page_number}`);
      const ok = p && !p.translation_withheld && plain(texts(p.translation?.data).clean).includes(q.quote);
      if (!ok) bad.push({ where: q.where, url: q.url, why: !p ? 'page missing' : p.translation_withheld ? 'withheld' : 'quote not on page' });
    }
  }
  fs.writeFileSync(path.join(OUT, 'verify.json'), JSON.stringify({ checked: qs.length, bad }, null, 1));
  console.log(`verified ${qs.length - bad.length}/${qs.length} quotes`); for (const b of bad) console.log('  BAD', b.where, b.why, b.url);
  if (bad.length) process.exitCode = 1;
}

if (mode === 'baseline') {
  // The corpus's own shape: pages of live books by century of the work, same dating rule. Every strip leans where
  // the library leans; this is the denominator a reader compares against.
  const byC = {}; const basis = {}; let n = 0;
  const cur = db.collection('books').find({ visible: true, hidden: { $ne: true }, pages_count: { $gt: 0 } }, { projection: { id: 1, year: 1, published: 1, source_work_dates: 1, original_work_year: 1, pages_count: 1 } });
  for await (const b of cur) {
    const w = workDate(b); n++; if (w.year == null || w.year < -1500 || w.year > 2030) continue;
    const c = Math.floor(w.year / 100) * 100; byC[c] = (byC[c] || 0) + b.pages_count; basis[w.basis] = (basis[w.basis] || 0) + b.pages_count;
  }
  fs.writeFileSync(path.join(OUT, 'baseline.json'), JSON.stringify({ books: n, by_century: byC, basis }));
  console.log('baseline', n, 'books');
}
await client.close();
