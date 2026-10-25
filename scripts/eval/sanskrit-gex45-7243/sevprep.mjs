#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-bakeoff-5924/byeye-pages.json (by-eye reads of the bake-off's widest gaps; no severity
// scale, no blind labels). #6740 (Derek, 2026-10-24) defines the scale; nothing builds a per-page grading packet for it.
/**
 * sevprep.mjs — blind severity-grading packets for #7243 (PREREG Amendment 1). One packet per page: every arm's text
 * under a shuffled letter, word-level diff spans against the frozen reference, and structure flags. The arm↔letter key is
 * written apart (key.json) and never shown to the grader.
 *   node sevprep.mjs <arms dir> <refs dir> <tiles dir> <out dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { clean, nview, views, invention } from './score.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const [armsDir, refsDir, tilesDir, outDir] = process.argv.slice(2);
const pages = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'pages.json'), 'utf8')).pages;
const arms = {};
for (const f of fs.readdirSync(armsDir).filter((x) => /^[A-Za-z0-9]+\.jsonl$/.test(x))) {
  const rows = {}; for (const l of fs.readFileSync(path.join(armsDir, f), 'utf8').split('\n')) { if (!l.trim()) continue; const r = JSON.parse(l); rows[r.page_id || r.uid] = r; }
  arms[f.split('.')[0]] = rows;
}
// The #7243 grading ran on an LCG shuffle (replaced after the run for tests/unit/paired-stats-prng.test.ts); the letters actually
// shown to the graders are in severity-blind-key.json, which is what sevagg.mjs reads.
const rnd = makeRng(7243);
const words = (t) => clean(t).replace(/[।॥|]/g, ' ').split(/\s+/).filter(Boolean);
function spans(ref, hyp, cap = 40) {   // word-level LCS diff, non-equal runs with one word of context
  const a = words(ref), b = words(hyp); const n = a.length, m = b.length;
  if (n * m > 4e6) return [{ note: 'too long to diff' }];
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0, cur = null;
  const flush = () => { if (cur) { out.push({ ref: cur.r.join(' '), engine: cur.h.join(' '), at_ref_word: cur.at }); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++; continue; }
    cur ??= { r: [], h: [], at: i };
    if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) cur.h.push(b[j++]); else cur.r.push(a[i++]);
  }
  flush(); return out.slice(0, cap).concat(out.length > cap ? [{ note: `${out.length - cap} more spans not shown` }] : []);
}
fs.mkdirSync(outDir, { recursive: true });
const keys = {};
for (const p of pages) {
  const ref = fs.readFileSync(path.join(refsDir, `${p.slug}.txt`), 'utf8');
  const names = Object.keys(arms).filter((a) => arms[a][p.slug]); const order = names.map((a) => [rnd(), a]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  const dir = path.join(outDir, p.slug); fs.mkdirSync(dir, { recursive: true }); keys[p.slug] = {};
  const summary = [];
  order.forEach((a, k) => {
    const L = String.fromCharCode(65 + k); keys[p.slug][L] = a;
    const r = arms[a][p.slug]; const text = String(r.text || '');
    const readable = nview(text).length > 0 && !r.blocked && !r.error;
    fs.writeFileSync(path.join(dir, `${L}.txt`), text);
    const v = readable ? views(ref, text) : null; const inv = v ? invention(v.R.N, v.H.Nr) : null;
    summary.push({ label: L, file: path.join(dir, `${L}.txt`), did_not_read: !readable, engine_lines: clean(text).split('\n').filter((x) => x.trim()).length,
      ref_lines: ref.split('\n').filter((x) => x.trim()).length, devanagari_chars_engine: v ? v.H.N.length : 0, devanagari_chars_ref: nview(ref).length,
      inserted_passages: inv ? inv.passages.map((x) => x.text) : [], diff_spans: readable ? spans(ref, text) : [] });
  });
  fs.writeFileSync(path.join(dir, 'packet.json'), JSON.stringify({ slug: p.slug, reference: path.join(refsDir, `${p.slug}.txt`), tiles: fs.readdirSync(tilesDir).filter((t) => t.startsWith(p.slug + '-')).sort().map((t) => path.join(tilesDir, t)), outputs: summary }, null, 1));
}
fs.writeFileSync(path.join(outDir, 'key.json'), JSON.stringify(keys, null, 1));
console.log(Object.keys(keys).length, 'packets;', Object.keys(arms).length, 'arms');
