#!/usr/bin/env node
/**
 * work-resolver-probe.mjs — measure how well the work_id resolver clusters books
 * into works, WITHOUT a gold set. Read-only, zero-token. (Issue: canonical work
 * identity #2909; method described in title-and-work-identity-principles.md.)
 *
 * The resolver maps each book → a work_id (a cluster). It fails two ways:
 *   - OVER-MERGE  (precision): one work_id groups books that aren't the same work.
 *   - OVER-SPLIT  (recall):    the same work scattered across several work_ids.
 * Both are self-revealing, so we can compute a LOWER BOUND on each error rate for
 * free. This proves the resolver is *bad where flagged*; it cannot prove it is
 * *good* (no flags ≠ correct). Only a stratified human gold + κ gives the true
 * rate — this harness is the cheap first rung that finds errors and a fix-list.
 *
 * Probes:
 *  1. HEALTH    — id-format fragmentation + coverage gaps (no/weak work_id).
 *  2. OVER-MERGE — multi-book work_ids whose members don't share a title core
 *                  AND span different author-surnames (precision-suspect).
 *  3. OVER-SPLIT — distinct work_ids that are near-certainly one work, tiered:
 *                  HIGH (identical full title+author) / MED (high token overlap),
 *                  with a generic-token guard (the "thor bu"/pecha trap) and
 *                  Tibetan reported separately (algorithmic clustering unsafe).
 *  4. ANCHOR-MISS — a work known by a Wikidata QID, with a sibling edition
 *                   (same author+title) filed under a *local* id instead → a
 *                   recall miss measured against real external truth.
 * All probes are rolled up PER TRADITION (difficulty varies wildly).
 *
 * Usage: node scripts/eval/work-resolver-probe.mjs [--limit-examples N]
 */
import { MongoClient } from 'mongodb';

const EX = (() => { const i = process.argv.indexOf('--limit-examples'); return i > -1 ? +process.argv[i + 1] : 10; })();
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'and', 'with', 'from', 'vol', 'volume', 'part', 'tome', 'band', 'book', 'der', 'die',
  'des', 'von', 'und', 'of', 'les', 'la', 'le', 'el', 'des', 'für', 'mit', 'thor', 'bu', 'sogs', 'rnam', 'pa', 'ba']);
const sig = (s) => [...new Set(norm(s).split(' ').filter((t) => t.length >= 4 && !STOP.has(t)))];
const surname = (a) => norm(a).split(' ').filter(Boolean).pop() || '';
const trad = (b) => b.language || '?';

function fmt(w) {
  if (/^Q\d+$/.test(w)) return 'wikidata_QID';
  if (/^local:a:/.test(w)) return 'local:a:';
  if (/^local:n:/.test(w)) return 'local:n:';
  if (/^local:/.test(w)) return 'local:other';
  if (/[一-鿿]/.test(w)) return 'cjk-chars';
  return 'bare-slug';
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const books = client.db(process.env.MONGODB_DB || 'bookstore').collection('books');
  const LIVE = { visible: true, pages_translated: { $gt: 0 } };

  const all = await books.find(LIVE).project({ _id: 0, id: 1, work_id: 1, author: 1, title: 1, language: 1 }).toArray();
  const withWid = all.filter((b) => b.work_id);
  console.log(`Live books: ${all.length} | with work_id: ${withWid.length} (${(100 * withWid.length / all.length).toFixed(1)}%)\n`);

  // ── Probe 1: HEALTH ──────────────────────────────────────────────────────────
  const fmtCount = {};
  for (const b of withWid) fmtCount[fmt(b.work_id)] = (fmtCount[fmt(b.work_id)] || 0) + 1;
  const distinct = new Set(withWid.map((b) => b.work_id)).size;
  console.log('── HEALTH ──');
  console.log(`  distinct work_ids: ${distinct}  (avg ${(withWid.length / distinct).toFixed(2)} books/work)`);
  console.log(`  id formats: ${Object.entries(fmtCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  console.log(`  coverage gap: ${all.length - withWid.length} live books with NO work_id`);
  const weak = withWid.filter((b) => /^(bare-slug|cjk-chars|local:other)$/.test(fmt(b.work_id))).length;
  console.log(`  pre-scheme ids (bare-slug/cjk/other): ${weak}`);

  // cluster books by work_id
  const byWid = new Map();
  for (const b of withWid) { if (!byWid.has(b.work_id)) byWid.set(b.work_id, []); byWid.get(b.work_id).push(b); }

  // ── Probe 2: OVER-MERGE (precision lower bound) ──────────────────────────────
  // A multi-book work_id is suspect if its members don't form one title-core AND
  // carry ≥2 distinct author-surnames.
  const overMerge = [];
  for (const [w, arr] of byWid) {
    if (arr.length < 2) continue;
    const surs = new Set(arr.map((b) => surname(b.author)).filter((s) => s.length >= 3));
    if (surs.size < 2) continue; // single author across the cluster — fine
    // title cohesion: is there a token shared by a majority of members?
    const counts = {};
    for (const b of arr) for (const t of sig(b.title)) counts[t] = (counts[t] || 0) + 1;
    const maj = Object.values(counts).some((c) => c > arr.length / 2);
    if (!maj) overMerge.push({ w, n: arr.length, surnames: [...surs].slice(0, 4), titles: arr.slice(0, 3).map((b) => b.title) });
  }
  overMerge.sort((a, b) => b.n - a.n);
  console.log(`\n── OVER-MERGE candidates (≥2 authors, no shared title core): ${overMerge.length} ──`);
  for (const m of overMerge.slice(0, EX)) console.log(`  ${m.n}× ${m.w}\n     surnames: ${m.surnames.join(', ')}\n     titles: ${m.titles.map((t) => `"${(t || '').slice(0, 32)}"`).join(' | ')}`);

  // ── Probe 3: OVER-SPLIT (recall lower bound) ─────────────────────────────────
  // Representative book per work_id; cluster work_ids that are near-certainly one
  // work. HIGH = identical full sig-title set + same surname. MED = Jaccard ≥ 0.7
  // on ≥3 non-generic tokens. Tibetan reported separately (pecha unsafe).
  const repByWid = new Map();
  for (const [w, arr] of byWid) repByWid.set(w, arr[0]);
  const bySurname = new Map();
  for (const [w, b] of repByWid) {
    const sn = surname(b.author);
    if (sn.length < 4) continue;
    if (!bySurname.has(sn)) bySurname.set(sn, []);
    bySurname.get(sn).push({ w, b, toks: new Set(sig(b.title)) });
  }
  const splitHigh = [], splitMed = [], splitTib = [];
  const seen = new Set();
  for (const [sn, items] of bySurname) {
    for (let i = 0; i < items.length; i++) {
      if (seen.has(items[i].w)) continue;
      const a = items[i]; if (a.toks.size < 2) continue;
      const akey = [...a.toks].sort().join(' ');
      const cluster = [a];
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j]; if (seen.has(b.w) || b.toks.size < 2) continue;
        const bkey = [...b.toks].sort().join(' ');
        const inter = [...a.toks].filter((t) => b.toks.has(t)).length;
        const jac = inter / new Set([...a.toks, ...b.toks]).size;
        if (akey === bkey) { b.tier = 'high'; cluster.push(b); }
        else if (jac >= 0.7 && inter >= 3) { b.tier = 'med'; cluster.push(b); }
      }
      if (cluster.length < 2) continue;
      cluster.forEach((x) => seen.add(x.w));
      const isTib = trad(a.b) === 'Tibetan';
      const rec = { sn, n: cluster.length, tier: cluster.some((x) => x.tier === 'med') ? 'med' : 'high', lang: trad(a.b), title: a.b.title, author: a.b.author, ids: cluster.map((x) => x.w) };
      if (isTib) splitTib.push(rec);
      else if (rec.tier === 'high') splitHigh.push(rec);
      else splitMed.push(rec);
    }
  }
  const sumDup = (arr) => arr.reduce((s, r) => s + r.n - 1, 0);
  console.log(`\n── OVER-SPLIT candidates (same work, multiple work_ids) ──`);
  console.log(`  HIGH conf (identical title+author, non-Tibetan): ${splitHigh.length} clusters, ~${sumDup(splitHigh)} redundant ids`);
  console.log(`  MED conf  (token Jaccard ≥0.7, non-Tibetan):     ${splitMed.length} clusters, ~${sumDup(splitMed)} redundant ids`);
  console.log(`  TIBETAN   (pecha — NOT safe to auto-merge):      ${splitTib.length} clusters, ~${sumDup(splitTib)} ids — human review`);
  console.log('  HIGH examples:');
  for (const r of splitHigh.slice(0, EX)) console.log(`    ${r.n}× [${r.lang}] "${(r.author || '').slice(0, 18)}" / "${(r.title || '').slice(0, 30)}"`);

  // ── Probe 4: ANCHOR-MISS (recall vs external QID truth) ──────────────────────
  // A work known by a QID, with a sibling edition (same surname + high title
  // overlap) filed under a non-QID local id → a recall miss against real truth.
  let anchorMiss = 0; const anchorEx = [];
  for (const [sn, items] of bySurname) {
    const qids = items.filter((x) => /^Q\d+$/.test(x.w));
    const locals = items.filter((x) => !/^Q\d+$/.test(x.w));
    for (const q of qids) {
      for (const l of locals) {
        const inter = [...q.toks].filter((t) => l.toks.has(t)).length;
        const jac = inter / new Set([...q.toks, ...l.toks]).size;
        if (jac >= 0.6 && inter >= 2) { anchorMiss++; if (anchorEx.length < EX) anchorEx.push(`    QID ${q.w} ↔ ${l.w}  "${(l.b.title || '').slice(0, 30)}" [${trad(l.b)}]`); break; }
      }
    }
  }
  console.log(`\n── ANCHOR-MISS (QID work with a sibling edition under a local id): ${anchorMiss} ──`);
  console.log(anchorEx.join('\n'));

  // ── Per-tradition rollup ─────────────────────────────────────────────────────
  const tr = {};
  for (const b of withWid) { const t = trad(b); (tr[t] = tr[t] || { books: 0, works: new Set() }).books++; tr[t].works.add(b.work_id); }
  const splitByLang = {};
  for (const r of [...splitHigh, ...splitMed]) splitByLang[r.lang] = (splitByLang[r.lang] || 0) + (r.n - 1);
  console.log(`\n── PER-TRADITION (top 12 by books) ──`);
  console.log('  tradition'.padEnd(16) + 'books'.padStart(7) + 'works'.padStart(7) + 'split-dups'.padStart(12));
  for (const [t, v] of Object.entries(tr).sort((a, b) => b[1].books - a[1].books).slice(0, 12)) {
    console.log(`  ${t.padEnd(14)}${String(v.books).padStart(7)}${String(v.works.size).padStart(7)}${String(splitByLang[t] || 0).padStart(12)}`);
  }

  console.log(`\n── INTERPRETATION ──`);
  console.log(`  These are LOWER BOUNDS on error (found cases), not the true rate.`);
  console.log(`  Over-split (recall) dominates: ~${sumDup(splitHigh) + sumDup(splitMed)} non-Tibetan redundant ids + ${anchorMiss} anchor-misses.`);
  console.log(`  Over-merge (precision) candidates: ${overMerge.length} (verify — multi-author works produce false positives).`);
  console.log(`  Grain & Tibetan (~${sumDup(splitTib)} ids) are policy/expertise-gated, not resolver bugs.`);
  console.log(`  True precision/recall needs a stratified human gold + κ; calibrate over-split HIGH tier first (it's near-certain).`);
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
