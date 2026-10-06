#!/usr/bin/env node
// #6012 step 5: counts per source from the local run files, and the packed files the PR carries
// (manifest, pairs, aligned pages: ids, hashes, offsets and scores; no corpus text).
// PRIOR ART: ground-truth-5935/model.mjs writes its own per-stratum estimates; nothing counts typed
// references by source × kind × language × century.
//   node scripts/eval/typed-refs-6012/summarise.mjs [--work=DIR] [--pack]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { argOf } from './lib.mjs';
const WORK = argOf('work', '/data/scratch/sl/typed-refs-6012');
const OUT = 'scripts/eval/output';
const DATE = '2026-10-06';
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const rank = { 'same-edition': 2, 'same-work-other-edition': 1 };
const summary = {};
for (const [src, dir] of [['dta', 'dta'], ['camena', 'camena'], ['eebo-tcp', 'eebo']]) {
  const D = path.join(WORK, dir);
  const manifest = readJsonl(`${D}/manifest.jsonl`);
  if (!manifest.length) continue;
  const pairs = readJsonl(`${D}/pairs.jsonl`), pages = readJsonl(`${D}/aligned-pages.jsonl`);
  // A book we hold undated takes the century of the typed text's edition, but only where the page breaks
  // say it is that edition. Counted, so the table can say how many cells rest on it.
  const yearOf = new Map(manifest.map((m) => [m.source_id, m.year]));
  const bucket = (y) => (y < 1500 ? 'pre-1500' : y < 1600 ? '1500s' : y < 1700 ? '1600s' : y < 1800 ? '1700s' : y < 1900 ? '1800s' : '1900+');
  let datedByTyped = 0;
  const fix = (r) => { if (r.period === 'unknown' && r.kind === 'same-edition' && yearOf.get(r.source_id)) { r.period = bucket(yearOf.get(r.source_id)); r.period_from = 'typed-text'; return true; } return false; };
  for (const p of pairs) if (fix(p)) datedByTyped++;
  for (const r of pages) fix(r);
  const found = pairs.filter((p) => p.kind);
  // one kind per book (same-edition wins), one row per page (same-edition, then overlap)
  const bookKind = new Map();
  for (const p of found) if (!bookKind.has(p.book_id) || rank[p.kind] > rank[bookKind.get(p.book_id).kind]) bookKind.set(p.book_id, p);
  const best = new Map();
  for (const r of pages) { const k = `${r.book_id}|${r.page_number}`; const b = best.get(k); if (!b || rank[r.kind] > rank[b.kind] || (rank[r.kind] === rank[b.kind] && r.overlap > b.overlap)) best.set(k, r); }
  const cell = {}, byKind = {}, bookCell = {};
  for (const r of best.values()) { const k = `${r.language}|${r.period}`; cell[k] ??= { 'same-edition': 0, 'same-work-other-edition': 0 }; cell[k][r.kind]++; }
  for (const p of bookKind.values()) { byKind[p.kind] = (byKind[p.kind] || 0) + 1; const k = `${p.language}|${p.period}`; bookCell[k] ??= { 'same-edition': 0, 'same-work-other-edition': 0 }; bookCell[k][p.kind]++; }
  const lic = {}; for (const m of manifest) lic[m.licence_key] = (lic[m.licence_key] || 0) + 1;
  summary[src] = { texts: manifest.length, typed_pages: manifest.reduce((a, m) => a + (m.n_pages || 0), 0), chars: manifest.reduce((a, m) => a + (m.chars || 0), 0), raw_bytes: manifest.reduce((a, m) => a + (m.bytes_raw || 0), 0),
    licences: lic, candidate_pairs: pairs.length, pairs_by_verdict: pairs.reduce((a, p) => { const k = p.kind || p.verdict; a[k] = (a[k] || 0) + 1; return a; }, {}),
    pairs_by_tier_kind: found.reduce((a, p) => { const k = `${p.tier}|${p.kind}`; a[k] = (a[k] || 0) + 1; return a; }, {}),
    texts_matched: new Set(found.map((p) => p.source_id)).size, pairs_dated_by_typed_text: datedByTyped, books_matched: bookKind.size, books_by_kind: byKind, books_by_language_period: bookCell,
    aligned_pages: best.size, aligned_pages_by_language_period: cell, congruent_pages: [...best.values()].filter((r) => r.congruent).length };
  if (process.argv.includes('--pack')) {
    const gz = (name, rows) => fs.writeFileSync(`${OUT}/typed-refs-6012-${DATE}.${src}.${name}.jsonl.gz`, zlib.gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { level: 9 }));
    gz('manifest', manifest.map(({ citation, date_raw, classes, subjects, availability, ...m }) => ({ ...m, title: String(m.title || '').slice(0, 300) })));
    gz('pairs', pairs);
    gz('aligned-pages', pages.map(({ reason, tier, source, parse_version, ...r }) => r));
  }
}
fs.writeFileSync(`${WORK}/summary.json`, JSON.stringify(summary, null, 1));
if (process.argv.includes('--pack')) fs.writeFileSync(`${OUT}/typed-refs-6012-${DATE}.summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
