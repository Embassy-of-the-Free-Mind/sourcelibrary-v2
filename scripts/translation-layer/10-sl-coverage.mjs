#!/usr/bin/env node
/**
 * Phase 10 — Source Library's own coverage of the early-modern Latin record
 * (issue #7751): which USTC work-clusters do WE hold, and which have WE
 * translated — crossed with the external-prior layer (phase 3) into the 2×2:
 *
 *                       external prior      no external prior
 *   translated by SL    re-translation      SL FIRST (our contribution to the gap)
 *   not translated      translated elsewhere  open gap
 *
 * PRIOR ART: scripts/translation-layer/08-holdings.mjs — joins REGISTRY works
 * (the translated ones) to books, so it cannot see the gap side; 09-scan-coverage.mjs
 * — same cluster matcher, over IIIF manifests not books;
 * scripts/catalog-coverage/backfill-ustc-matches.mjs — WRITES ustc_id to books via
 * Gemini, one book at a time. This phase is read-only and free.
 *
 * Invariant kept (#2626): SL output is never an external prior. The two channels
 * are computed independently and only crossed in the report.
 *
 * Linking a book to a cluster, in precedence order:
 *   1. direct — books.ustc_id (= ustc_editions.sn) or ustc_editions.source_library_id
 *   2. title  — author surname-stem anchor + rare-token (IDF) title containment,
 *               the 09-scan-coverage matcher (with u/v, i/j normalization). A book
 *               is assigned to its BEST-scoring cluster(s) only (ties kept, ≤5;
 *               more ties = ambiguous, unassigned) so one book cannot light up
 *               every cluster sharing one rare word.
 *
 * Book translation status (approximates the translation-state rungs, #3402):
 *   readable — pages_translated ≥ 0.9 · (pages_count − pages_blank)
 *   partial  — pages_translated > 0
 * Ownership uses the FULL catalog incl. hidden; `visible` is reported alongside.
 *
 * Reads:  scripts/output/ustc-latin-clusters.jsonl, cluster-external-priors.jsonl
 *         Mongo books (Latin), Supabase ustc_editions (sn / source_library_id links)
 * Writes: scripts/output/cluster-sl-coverage.jsonl  (cluster → SL books + status)
 *         scripts/output/sl-coverage-report.json
 *
 * Usage: node --env-file=.env.production.local scripts/translation-layer/10-sl-coverage.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { surnameStems, distinctiveTokens, supa } from './lib.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '../../scripts/output');
const readJsonl = (f) => fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const orth = (s) => (s || '').replace(/[vV]/g, 'u').replace(/[jJ]/g, 'i');
const MAX_TIES = 5;

function bookStatus(b) {
  const translatable = Math.max(1, (b.pages_count || 0) - (b.pages_blank || 0));
  const t = b.pages_translated || 0;
  if (t >= 0.9 * translatable) return 'readable';
  if (t > 0) return 'partial';
  return 'none';
}

async function pullBooks() {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const books = await c.db('bookstore').collection('books').find(
    { $or: [{ language: 'Latin' }, { languages: 'Latin' }], pages_count: { $gt: 0 } },
    { projection: { id: 1, slug: 1, title: 1, author: 1, year: 1, ustc_id: 1, visible: 1,
      pages_count: 1, pages_blank: 1, pages_translated: 1 } },
  ).toArray();
  await c.close();
  return books;
}

// sn → cluster and source_library_id → cluster, for Latin 1400-1700 editions only.
async function directLinks(snWanted) {
  const sb = supa();
  const bySn = new Map();
  const sns = [...snWanted];
  for (let i = 0; i < sns.length; i += 200) {
    const { data, error } = await sb.from('ustc_editions').select('sn,work_cluster_id')
      .in('sn', sns.slice(i, i + 200)).not('work_cluster_id', 'is', null);
    if (error) throw new Error(error.message);
    for (const r of data) bySn.set(String(r.sn), r.work_cluster_id);
  }
  const bySlId = new Map();
  let last = 0;
  while (true) {
    const { data, error } = await sb.from('ustc_editions').select('id,source_library_id,work_cluster_id')
      .not('source_library_id', 'is', null).not('work_cluster_id', 'is', null)
      .gt('id', last).order('id', { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    if (!data.length) break;
    for (const r of data) bySlId.set(String(r.source_library_id), r.work_cluster_id);
    last = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  return { bySn, bySlId };
}

async function main() {
  const clusters = readJsonl('ustc-latin-clusters.jsonl');
  const priorSet = new Set(readJsonl('cluster-external-priors.jsonl').map((r) => r.work_cluster_id));
  const byId = new Map(clusters.map((c) => [c.work_cluster_id, c]));
  console.log(`clusters: ${clusters.length} | external prior: ${priorSet.size}`);

  const N = clusters.length;
  const df = new Map();
  const byStem = new Map();
  for (const c of clusters) {
    c._tok = new Set(distinctiveTokens(orth(c.title_repr)));
    c._aStems = surnameStems(orth(c.surname));
    for (const t of c._tok) df.set(t, (df.get(t) || 0) + 1);
    for (const stem of c._aStems) {
      if (!byStem.has(stem)) byStem.set(stem, []);
      byStem.get(stem).push(c);
    }
  }
  const STRONG_IDF = 6.0, MID_IDF = 5.0;
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1));

  console.log('Pulling Source Library Latin books (full catalog incl. hidden)…');
  const books = await pullBooks();
  console.log(`  ${books.length} Latin books with pages`);
  const { bySn, bySlId } = await directLinks(new Set(books.filter((b) => b.ustc_id).map((b) => String(b.ustc_id))));
  console.log(`  direct links: ${bySn.size} by sn, ${bySlId.size} by source_library_id`);

  const held = new Map(); // cluster → { books: [] }
  const how = { direct: 0, title: 0, ambiguous: 0, no_author: 0, unmatched: 0 };
  const assign = (cid, b, method, score) => {
    if (!byId.has(cid)) return false; // linked edition outside Latin 1400-1700
    let h = held.get(cid);
    if (!h) { h = { books: [] }; held.set(cid, h); }
    h.books.push({ id: b.id, slug: b.slug, title: b.title, author: b.author, status: bookStatus(b), visible: b.visible === true, method, score });
    return true;
  };

  for (const b of books) {
    const direct = [bySn.get(String(b.ustc_id)), bySlId.get(String(b.id)), bySlId.get(String(b._id))].filter(Boolean);
    if (direct.length && [...new Set(direct)].some((cid) => assign(cid, b, 'direct', null))) { how.direct++; continue; }

    const stems = surnameStems(orth(b.author));
    if (!stems.length) { how.no_author++; continue; }
    const bTok = new Set(distinctiveTokens(orth(b.title)));
    if (!bTok.size) { how.unmatched++; continue; }
    const seen = new Set();
    let best = 0, bestIds = [];
    for (const stem of stems) {
      for (const c of byStem.get(stem) || []) {
        if (seen.has(c.work_cluster_id) || !c._tok.size) continue;
        seen.add(c.work_cluster_id);
        let nStrong = 0, nMid = 0, sum = 0;
        for (const t of bTok) {
          if (!c._tok.has(t)) continue;
          if (stems.some((s) => s.length >= 3 && t.startsWith(s))) continue;
          if (c._aStems.some((s) => s.length >= 3 && t.startsWith(s))) continue;
          const v = idf(t);
          sum += v;
          if (v >= STRONG_IDF) nStrong++;
          if (v >= MID_IDF) nMid++;
        }
        if (!(nStrong >= 1 || nMid >= 2)) continue;
        if (sum > best + 1e-9) { best = sum; bestIds = [c.work_cluster_id]; } else if (Math.abs(sum - best) < 1e-9) bestIds.push(c.work_cluster_id);
      }
    }
    if (!bestIds.length) { how.unmatched++; continue; }
    if (bestIds.length > MAX_TIES) { how.ambiguous++; continue; }
    for (const cid of bestIds) assign(cid, b, 'title', Number(best.toFixed(2)));
    how.title++;
  }
  console.log('book linking:', how);

  // per-cluster SL status = the best status across its books
  const rank = { readable: 2, partial: 1, none: 0 };
  const rows = [];
  for (const [cid, h] of held) {
    const st = h.books.reduce((a, x) => (rank[x.status] > rank[a] ? x.status : a), 'none');
    const vis = h.books.some((x) => x.visible && x.status === st);
    rows.push({ work_cluster_id: cid, year_min: byId.get(cid).year_min, external_prior: priorSet.has(cid), sl_status: st, sl_visible: vis, books: h.books });
  }
  const w = fs.createWriteStream(path.join(OUT, 'cluster-sl-coverage.jsonl'));
  for (const r of rows) w.write(JSON.stringify(r) + '\n');
  w.end();

  const grid = (subset, minStatus) => {
    const ok = (r) => rank[r.sl_status] >= rank[minStatus];
    const slSet = new Set(rows.filter(ok).map((r) => r.work_cluster_id));
    const n = subset.length;
    let both = 0, slOnly = 0, extOnly = 0, neither = 0;
    for (const c of subset) {
      const s = slSet.has(c.work_cluster_id), e = priorSet.has(c.work_cluster_id);
      if (s && e) both++; else if (s) slOnly++; else if (e) extOnly++; else neither++;
    }
    const pc = (x) => Number((100 * x / n).toFixed(3));
    return { clusters: n, sl: both + slOnly, sl_pct: pc(both + slOnly), external: both + extOnly, external_pct: pc(both + extOnly),
      grid: { sl_and_external: both, sl_first: slOnly, external_only: extOnly, open_gap: neither },
      grid_pct: { sl_and_external: pc(both), sl_first: pc(slOnly), external_only: pc(extOnly), open_gap: pc(neither) },
      sl_share_of_gap_closed_pct: Number((100 * slOnly / (slOnly + neither)).toFixed(3)) };
  };
  const byCentury = (minStatus) => Object.fromEntries([[1400, 1499], [1500, 1599], [1600, 1700]].map(([a, z]) =>
    [`${a}s`, grid(clusters.filter((c) => c.year_min >= a && c.year_min <= z), minStatus)]));

  const report = {
    generated: new Date().toISOString().slice(0, 10),
    issue: '#7751',
    method: 'SL Latin books (full catalog incl. hidden, pages_count>0) linked to USTC Latin 1400-1700 work-clusters: direct (books.ustc_id = sn, ustc_editions.source_library_id) first, else author-stem anchor + rare-token title containment, best-scoring cluster(s) only. Crossed with the phase-3 external-prior layer.',
    books: { latin_with_pages: books.length, linking: how, clusters_held: rows.length },
    held: grid(clusters, 'none'),
    translated_any: grid(clusters, 'partial'),
    translated_readable: grid(clusters, 'readable'),
    readable_by_century: byCentury('readable'),
    caveats: [
      'Unit is the USTC work-cluster: one work can span several clusters (variant titles), on BOTH sides, so cluster counts over-count works somewhat.',
      'Denominator is PRINT year 1400-1700 and includes reprints of ancient/medieval works; the n=1000 validation (#2684) puts the Renaissance-composed gap at 93% [91-95], not the raw 97%.',
      'External-prior precision is ~79% overall, 57% on Renaissance-era matches (n=1000): some "sl_and_external" clusters are really sl_first, and some "sl_first" may have a prior the catalogs miss.',
      'SL-side title matching is unvalidated here; precision is spot-checked in the issue. Anonymous works (no author) cannot be title-matched and are counted in books.linking.no_author.',
      'readable approximates the translation-state rung (pages_count − pages_blank as the translatable count).',
    ],
  };
  fs.writeFileSync(path.join(OUT, 'sl-coverage-report.json'), JSON.stringify(report, null, 2));

  const show = (label, g) => {
    console.log(`\n=== ${label} — of ${g.clusters.toLocaleString()} clusters ===`);
    console.log(`  SL: ${g.sl.toLocaleString()} (${g.sl_pct}%) | external prior: ${g.external.toLocaleString()} (${g.external_pct}%)`);
    console.log(`  SL+external ${g.grid.sl_and_external} | SL FIRST ${g.grid.sl_first} | external only ${g.grid.external_only} | open gap ${g.grid.open_gap}`);
    console.log(`  share of the gap SL has closed: ${g.sl_share_of_gap_closed_pct}%`);
  };
  show('HELD by SL', report.held);
  show('TRANSLATED by SL (any pages)', report.translated_any);
  show('READABLE in English on SL (≥90%)', report.translated_readable);
  for (const [k, g] of Object.entries(report.readable_by_century)) show(`READABLE, clusters first printed ${k}`, g);
  console.log('\nwrote cluster-sl-coverage.jsonl + sl-coverage-report.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
