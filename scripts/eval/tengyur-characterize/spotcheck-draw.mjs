#!/usr/bin/env node
// PRIOR ART: none for this shape — the #5797 by-eye reads (by-eye-tantra.md) picked pages by ratio, not
// reviewer findings. Searched scripts/eval/tengyur-*/.
/**
 * spotcheck-draw.mjs — $0. Step 5 of #5829: draw (seed 5829) 30 reviewer findings on SAMPLE pages and
 * 10 sample pages both reviewers passed with no error, for a by-eye check against the Tibetan.
 *
 *   node scripts/eval/tengyur-characterize/spotcheck-draw.mjs [--show N-M]
 *
 * Writes <out>/spotcheck-draw.json. --show prints findings N..M with the Tibetan sentence and English context.
 */
import fs from 'node:fs';
import path from 'node:path';
import { rng as mkRng, shuffle } from './common.mjs';

const out = 'scripts/eval/results/tengyur-characterize-5829';
const key = JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8'));
const items = Object.fromEntries(fs.readFileSync('/root/tchar/items.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => { const x = JSON.parse(l); return [x.id, x]; }));
const rev = { A: {}, B: {} };
for (const f of fs.readdirSync(path.join(out, 'reviews'))) for (const x of JSON.parse(fs.readFileSync(path.join(out, 'reviews', f), 'utf8'))) rev[f[0]][x.id] = x;

const findings = [];
for (const r of ['A', 'B']) for (const [id, x] of Object.entries(rev[r])) if (key[id].type === 'SAMPLE') x.errors.forEach((e, i) => findings.push({ fid: `${r}:${id}:${i}`, reviewer: r, id, ...e }));
findings.sort((a, b) => a.fid.localeCompare(b.fid));
const R = mkRng(5829 * 17);
const drawn = shuffle(findings, R).slice(0, 30);
const clean = Object.keys(key).filter((id) => key[id].type === 'SAMPLE' && !rev.A[id].errors.length && !rev.B[id].errors.length).sort();
const cleanDrawn = shuffle(clean, R).slice(0, 10);
const file = path.join(out, 'spotcheck-draw.json');
if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ seed: 5829 * 17, population_findings: findings.length, population_clean_pages: clean.length, findings: drawn, clean: cleanDrawn.map((id) => ({ id, ...key[id] })) }, null, 1));
console.log(`findings on sample pages: ${findings.length}; drawn 30. Pages both passed clean: ${clean.length}; drawn 10.`);

const show = process.argv.includes('--show') ? process.argv[process.argv.indexOf('--show') + 1].split('-').map(Number) : null;
if (show) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ctx = (s, q, n) => { const i = s.indexOf(q.slice(0, 25)); return i < 0 ? `[quote not found] ${s.slice(0, n)}` : s.slice(Math.max(0, i - n), i + q.length + n); };
  if (show[0] > 100) {
    for (const c of d.clean.slice(show[0] - 101, show[1] - 100)) { const it = items[c.id]; console.log(`\n=== CLEAN ${c.id} ${it.where}\n--- BO:\n${it.tibetan}\n--- EN:\n${it.english}`); }
  } else {
    d.findings.slice(show[0] - 1, show[1]).forEach((f, k) => {
      const it = items[f.id];
      console.log(`\n=== #${show[0] + k} ${f.fid} ${f.type}/${f.confidence} ${it.where}\nWHY: ${f.why}\nFIX: ${f.fix ? JSON.stringify(f.fix) : '-'}\nBO-quote: ${f.tibetan}\nBO-ctx: ${ctx(it.tibetan.replace(/\n/g, ''), f.tibetan, 250)}\nEN-quote: ${f.english}\nEN-ctx: ${ctx(it.english, f.english, 500)}`);
    });
  }
}
