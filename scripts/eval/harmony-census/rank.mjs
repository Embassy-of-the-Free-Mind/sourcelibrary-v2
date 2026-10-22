// PRIOR ART: the #7064 Pythagoras harvest ranks nothing (it lists every passage); scripts/eval/INDEX.md has no
// "who discusses X most" ranker. none fits #7117 (Derek's note of 2026-10-22).
//
// From density.mjs output: (1) rank works by SUSTAINED discussion of harmony and of sympathy, not raw mentions;
// (2) the concept co-occurrence edge list by century (English lane).
//   dense page   >= DENSE mentions on the page (2 for the Chinese lane, whose terms are compounds)
//   run          longest stretch of dense pages with page numbers at most 2 apart
//   score        dense pages of the best edition; editions of one work_id are collapsed to that edition
//   density      dense pages / pages_count (book length from the nightly mirror)
// Usage: node rank.mjs <harvest-dir> <out-dir>   → <out-dir>/rank.md, <out-dir>/concept-edges.csv
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { openMirror } from '../../lib/mirror.mjs';

const [H, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const cat = JSON.parse(fs.readFileSync(path.join(H, 'catalog.json'), 'utf8'));
const pc = new Map(openMirror({ collections: ['books'] }).query(`SELECT coalesce(id->>'$', _id) AS id, pages_count::INT AS n FROM books WHERE visible::BOOLEAN AND pages_count::INT > 0`).map((r) => [r.id, r.n]));
const read = (f) => zlib.gunzipSync(fs.readFileSync(path.join(H, f))).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const year = (b) => { const y = parseInt(b?.y, 10); if (y > 0 && y < 2100) return y; const m = String(b?.pub || '').match(/\b(1[0-9]\d\d|[5-9]\d\d)\b/); return m ? +m[1] : null; };
const cent = (y) => (y == null ? 'undated' : y < 1300 ? 'before 1300' : `${Math.floor(y / 100) + 1}th c.`);
const link = (id, p) => `https://sourcelibrary.org/book/${id}${p ? `?page=${p}` : ''}`;

function bookStats(rows, key, dense) {
  const by = new Map();
  for (const r of rows) { if (r[key] < dense) continue; if (!by.has(r.id)) by.set(r.id, []); by.get(r.id).push(r); }
  const out = [];
  for (const [id, rs] of by) {
    rs.sort((a, b) => a.p - b.p);
    let run = 1, best = 1, start = rs[0].p, bestStart = rs[0].p;
    for (let i = 1; i < rs.length; i++) { if (rs[i].p - rs[i - 1].p <= 2) run++; else { run = 1; start = rs[i].p; } if (run > best) { best = run; bestStart = start; } }
    const b = cat[id] || {};
    const peak = rs.reduce((a, r) => (r[key] > a[key] ? r : a));
    out.push({ id, w: b.w || id, t: b.t, a: b.a, y: year(b), lang: b.lang, dense: rs.length, run: best, runStart: bestStart, hits: rs.reduce((a, r) => a + r[key], 0), density: rs.length / (pc.get(id) || rs.length), peak: peak.p });
  }
  // collapse editions by work_id: keep the edition with most dense pages, count the rest
  const works = new Map();
  for (const s of out) { const k = s.w; const cur = works.get(k); if (!cur) works.set(k, { ...s, eds: 1 }); else { cur.eds++; if (s.dense > cur.dense) works.set(k, { ...s, eds: cur.eds }); } }
  return [...works.values()].sort((a, b) => b.dense - a.dense || b.run - a.run);
}

const md = [];
const lanes = [
  ['density-ocr.jsonl.gz', 'original-language OCR (Latin, Greek, German, French, Italian, Spanish, English originals)', 3],
  ['density-tr.jsonl.gz', 'our English translations', 3],
  ['density-zh.jsonl.gz', 'Chinese OCR (和: 中和 太和 和聲 和氣 和諧 …; 感應: 感應 同聲相應 同類相動 相感 感通)', 2],
];
const data = {};
for (const [f, label, dense] of lanes) {
  const rows = read(f); data[f] = rows;
  for (const [key, topic] of [['h', 'harmony'], ['s', 'sympathy / resonance']]) {
    const ranked = bookStats(rows, key, dense);
    md.push(`### ${topic}: ${label}\n\nDense page = ${dense}+ mentions. ${ranked.length} works have one or more.\n`);
    md.push('| # | work (best edition) | year | lang | dense pages | longest run | dense / book pages | editions | peak page |\n|---:|---|---:|---|---:|---:|---:|---:|---|');
    ranked.slice(0, 25).forEach((s, i) => md.push(`| ${i + 1} | ${(s.a || '').slice(0, 30)}: ${(s.t || '').slice(0, 60).replace(/\|/g, '/')} | ${s.y ?? ''} | ${s.lang || ''} | ${s.dense} | ${s.run} (from p.${s.runStart}) | ${(100 * s.density).toFixed(1)}% | ${s.eds} | [p.${s.peak}](${link(s.id, s.peak)}) |`));
    md.push('');
  }
}

// Concept co-occurrence: share of harmony pages (and of sympathy pages) in a century that also name each concept.
const CONCEPTS = ['number', 'music', 'love', 'concord_social', 'soul', 'temperament_health', 'magnet', 'antipathy', 'cosmos', 'god', 'opposites', 'order', 'body'];
const edges = [['source', 'target', 'century', 'pages', 'hub_pages', 'weight']];
const tr = data['density-tr.jsonl.gz'];
const byC = new Map();
for (const r of tr) { const c = cent(year(cat[r.id])); if (!byC.has(c)) byC.set(c, []); byC.get(c).push(r); }
const ORDER = ['before 1300', '14th c.', '15th c.', '16th c.', '17th c.', '18th c.', '19th c.', '20th c.', 'undated'];
const shareTable = [];
for (const c of ORDER) {
  const rs = byC.get(c) || []; if (!rs.length) continue;
  for (const [hub, key] of [['harmony', 'h'], ['sympathy', 's']]) {
    const hp = rs.filter((r) => r[key] > 0);
    const row = { c, hub, n: hp.length };
    for (const k of CONCEPTS) { const n = hp.filter((r) => r.c.includes(k)).length; edges.push([hub, k, c, n, hp.length, hp.length ? (n / hp.length).toFixed(3) : '0']); row[k] = hp.length ? n / hp.length : 0; }
    shareTable.push(row);
  }
  // concept–concept edges on pages that name harmony or sympathy (top pairs only, weight = share of those pages)
  const hs = rs.filter((r) => r.h > 0 || r.s > 0); const pair = new Map();
  for (const r of hs) for (let i = 0; i < r.c.length; i++) for (let j = i + 1; j < r.c.length; j++) { const k = `${r.c[i]}|${r.c[j]}`; pair.set(k, (pair.get(k) || 0) + 1); }
  for (const [k, n] of [...pair].sort((a, b) => b[1] - a[1]).slice(0, 12)) { const [a, b] = k.split('|'); edges.push([a, b, c, n, hs.length, (n / hs.length).toFixed(3)]); }
}
fs.writeFileSync(path.join(OUT, 'concept-edges.csv'), edges.map((e) => e.join(',')).join('\n') + '\n');
md.push('### Concept co-occurrence (English lane): share of pages naming the hub that also name the concept\n');
md.push(`| century | hub | pages | ${CONCEPTS.join(' | ')} |\n|---|---|---:|${CONCEPTS.map(() => '---:').join('|')}|`);
for (const r of shareTable) md.push(`| ${r.c} | ${r.hub} | ${r.n} | ${CONCEPTS.map((k) => Math.round(100 * r[k])).join(' | ')} |`);
fs.writeFileSync(path.join(OUT, 'rank.md'), md.join('\n') + '\n');
console.log('wrote', path.join(OUT, 'rank.md'), edges.length - 1, 'edges');
