#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/ndl-koten-lane.mjs `compare` — the same paired agreement measure (bigram Dice, loop
 * verdicts, character counts) over the lane's plan files; this one reads a frozen page list and the stored reading
 * straight from Mongo, because the Meiji run writes nothing and has no plan. Read-only.
 *
 * Descriptive NDLOCR-vs-lite comparison on 20 Meiji typeset pages (#5100). See PREREGISTRATION.md.
 *
 *   node --env-file=<main>/.env.production.local scripts/eval/ndl-meiji-5100/score.mjs <ndl out dir> <report dir>
 * <ndl out dir> holds <bid>/<pn>.txt, one NDLOCR page text per page in pages.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../../lib/mongo.mjs';
import { loopVerdict } from '../../lib/ocr-loop-guard.mjs';
import { bodyText, charCount } from '../../lib/ndl-koten-lane.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [OUT, REPORT] = process.argv.slice(2);
if (!OUT || !REPORT) { console.error('usage: score.mjs <ndl out dir> <report dir>'); process.exit(1); }
const { pages } = JSON.parse(fs.readFileSync(path.join(HERE, 'pages.json'), 'utf8'));

const flat = (t) => [...bodyText(t).replace(/\s+/g, '')];
function bigrams(s) { const m = new Map(); for (let i = 0; i + 1 < s.length; i++) { const k = s[i] + s[i + 1]; m.set(k, (m.get(k) || 0) + 1); } return m; }
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b); let inter = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v; for (const v of B.values()) nb += v;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0);
  return na + nb ? (2 * inter) / (na + nb) : 1;
}
function editDist(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const rows = [];
await withMongo(async (db) => {
  const stored = new Map((await db.collection('pages').find({ id: { $in: pages.map((p) => p.pid) } }, { projection: { id: 1, 'ocr.data': 1, 'ocr.model': 1 } }).toArray()).map((p) => [p.id, p]));
  for (const p of pages) {
    const f = path.join(OUT, p.bid, `${p.pn}.txt`);
    const L = stored.get(p.pid)?.ocr?.data || '';
    if (!fs.existsSync(f)) { rows.push({ ...p, missing: true }); continue; }
    const N = fs.readFileSync(f, 'utf8');
    const a = flat(N), b = flat(L);
    rows.push({ bid: p.bid, pn: p.pn, title: p.title, url: p.url, lite_model: stored.get(p.pid)?.ocr?.model || null, lite_hash: contentHash(L),
      n_chars: charCount(N), l_chars: charCount(L), n_loop: loopVerdict(N).refuse, l_loop: L ? loopVerdict(L).refuse : false,
      dice: Number(dice(a, b).toFixed(3)), edit_agreement: Number((1 - editDist(a, b) / Math.max(a.length, b.length, 1)).toFixed(3)) });
  }
});
const got = rows.filter((r) => !r.missing);
const med = (xs) => { const s = [...xs].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
const trig = {
  dice_below_0_6: got.filter((r) => r.dice < 0.6).length,
  lite_loop_or_textless_where_ndl_reads: got.filter((r) => (r.l_loop || r.l_chars < 8) && r.n_chars >= 100).length,
};
const summary = { generated_at: new Date().toISOString(), measure: 'agreement between NDLOCR and stored flash-lite — NOT accuracy',
  pages: pages.length, read: got.length, missing: rows.length - got.length,
  median_dice: med(got.map((r) => r.dice)), median_edit_agreement: med(got.map((r) => r.edit_agreement)),
  median_ndl_chars: med(got.map((r) => r.n_chars)), median_lite_chars: med(got.map((r) => r.l_chars)),
  ndl_loops: got.filter((r) => r.n_loop).length, lite_loops: got.filter((r) => r.l_loop).length,
  triggers: { ...trig, rule1_met: trig.dice_below_0_6 >= 5, rule2_met: trig.lite_loop_or_textless_where_ndl_reads >= 2, rule3: 'by eye, see eye.md' } };
fs.mkdirSync(REPORT, { recursive: true });
fs.writeFileSync(path.join(REPORT, 'results.json'), JSON.stringify({ summary, rows }, null, 1));
// by-eye packet: one page per work, seeded 5100
const r = rng(5100), works = new Map();
for (const x of got) { const w = x.title.slice(0, 12); if (!works.has(w)) works.set(w, []); works.get(w).push(x); }
const md = ['# NDLOCR vs lite — by-eye packet (one page per work, seed 5100). Read each against the image.\n'];
for (const [, xs] of [...works.entries()].sort()) {
  const x = xs[Math.floor(r() * xs.length)];
  md.push(`## ${x.title} p.${x.pn} (${x.bid})\n\nimage: ${x.url}\n\nDice ${x.dice} · edit agreement ${x.edit_agreement} · NDL ${x.n_chars} chars · lite ${x.l_chars} chars\n`);
  md.push('### NDLOCR\n\n```\n' + fs.readFileSync(path.join(OUT, x.bid, `${x.pn}.txt`), 'utf8').slice(0, 1500) + '\n```\n');
}
fs.writeFileSync(path.join(REPORT, 'eye.md'), md.join('\n'));
console.log(JSON.stringify(summary, null, 1));
