#!/usr/bin/env node
// PRIOR ART: scripts/eval/jev/seam-continuity-pilot.mjs (branch eval/jev-seam-pilot) — the Jev call
// shape and the SIDE question are copied from it byte for byte. It does not fit as-is: it reads the
// untagged 2026-09-24 packet, also asks the PAIRED form (which leaned RIGHT 7–1 on A/A — not used
// here), and fixes the tie band by flag. This scores a --tag'd packet of
// scripts/eval/translation-batch-shadow-judge.mjs, sets the tie band from the packet's own A/A pairs,
// and reports Jev by arm next to the Sonnet verdicts when they exist.
/**
 * seam-continuity-screen — Jev (TypeSafe System One) as a second instrument on the page-break
 * continuity question, #4681 decisive seam draw.
 *
 * Per junction: one noul call per side (side_L, side_R); margin = side_L − side_R. The tie band is
 * the 95th percentile of |margin| over the same-lane A/A pairs (S1/S2) — the instrument's own noise.
 * Outside the band, the higher side wins. Unblinding uses the key only AFTER all calls are made.
 *
 *   node --env-file=<vercel env pull file> scripts/eval/jev/seam-continuity-screen.mjs --tag=<packet tag> [--score-only]
 *
 * --score-only re-reads the saved scores (no calls) and joins the Sonnet verdicts if present.
 * Writes scripts/eval/results/<tag>-jev.json. Spend: 2 calls per junction, well under a cent per 100.
 */
import fs from 'node:fs';
import path from 'node:path';
import { binomTwoSided } from '../lib/paired-stats.mjs';

const R = new URL('../results/', import.meta.url).pathname;
const args = process.argv.slice(2);
const arg = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const TAG = arg('tag', null);
if (!TAG) { console.error('--tag=<packet tag> required'); process.exit(1); }
const OUT = path.join(R, `${TAG}-jev.json`);

const QUESTION = 'The passage shows the end of one page and the start of the next page of a translation, separated by a page-break marker. It reads as ONE translator continuing across the page break: a sentence carried across the break is picked up correctly, the same names and the same terms are used on both sides, and the register does not change.';

async function jev(tok, state) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch('https://ai-gateway.vercel.sh/typesafe/v1/systemone', {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'typesafe-ai/jev', state: state.slice(0, 12000), questions: { c: { type: 'noul', instructions: QUESTION } } }),
    });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 800 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`jev ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return { p: j.answers.c.noul, usd: Number(j.provider_metadata?.gateway?.marketCost ?? 0) };
  }
  throw new Error('jev: gave up after 4 attempts');
}

const packet = fs.readFileSync(path.join(R, `${TAG}-judge-packet.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

let scores;
if (args.includes('--score-only')) {
  scores = JSON.parse(fs.readFileSync(OUT, 'utf8')).scores;
} else {
  const tok = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!tok) { console.error('need VERCEL_OIDC_TOKEN (vercel env pull) or AI_GATEWAY_API_KEY'); process.exit(1); }
  scores = []; let usd = 0;
  for (const e of packet) {
    const [l, r] = await Promise.all([jev(tok, e.left), jev(tok, e.right)]);
    usd += l.usd + r.usd;
    scores.push({ id: e.id, side_L: +l.p.toFixed(4), side_R: +r.p.toFixed(4), margin: +(l.p - r.p).toFixed(4) });
    process.stdout.write(`\r${scores.length}/${packet.length} junctions, $${usd.toFixed(4)}   `);
  }
  console.log();
  fs.writeFileSync(OUT, JSON.stringify({ tag: TAG, usd: +usd.toFixed(4), scores }, null, 1));
}

// ── unblind (only now) ─────────────────────────────────────────────────────
const key = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(R, `${TAG}-judge-key.json`), 'utf8')).key.map((k) => [k.id, k]));
const vFile = path.join(R, `${TAG}-judge-verdicts.json`);
const sonnet = fs.existsSync(vFile) ? Object.fromEntries(JSON.parse(fs.readFileSync(vFile, 'utf8')).map((v) => [v.id, String(v.verdict).trim().toUpperCase()])) : {};

const aaAbs = scores.filter((s) => key[s.id].pair === 'S1/S2').map((s) => Math.abs(s.margin)).sort((a, b) => a - b);
const band = aaAbs.length ? aaAbs[Math.min(aaAbs.length - 1, Math.ceil(0.95 * aaAbs.length) - 1)] : 0.1;
const call = (m) => (Math.abs(m) <= band ? 'TIE' : m > 0 ? 'LEFT' : 'RIGHT');
const rows = scores.map((s) => ({ ...s, pair: key[s.id].pair, s1_repaired: key[s.id].s1_repaired, jev: call(s.margin), sonnet: sonnet[s.id] ?? null }));

const ROWS = { 'S1/S2': (k) => k.pair === 'S1/S2', 'S1/P': (k) => k.pair === 'S1/P' && k.s1_repaired !== false, 'S1/P (unrepaired, plain batch)': (k) => k.pair === 'S1/P' && k.s1_repaired === false };
const report = {};
for (const [label, sel] of Object.entries(ROWS)) {
  const rs = rows.filter(sel); if (!rs.length) continue;
  const [x, y] = label.split(' ')[0].split('/');
  const wins = { [x]: 0, [y]: 0 }; let ties = 0;
  for (const r of rs) { if (r.jev === 'TIE') { ties++; continue; } wins[key[r.id][r.jev.toLowerCase()]]++; }
  const decided = wins[x] + wins[y];
  report[label] = { n: rs.length, ties, wins, decided, [`${y}_share_of_decided`]: decided ? +(wins[y] / decided).toFixed(3) : null, split_p_two_sided: decided ? +binomTwoSided(Math.min(wins[x], wins[y]), decided).toFixed(3) : null };
}
const judged = rows.filter((r) => r.sonnet);
const both = judged.filter((r) => r.sonnet !== 'TIE' && r.jev !== 'TIE');
const agree = both.filter((r) => r.sonnet === r.jev).length;
const pos = judged.filter((r) => r.sonnet === 'LEFT'), neg = judged.filter((r) => r.sonnet === 'RIGHT');
let aucS = 0; for (const p of pos) for (const q of neg) aucS += p.margin > q.margin ? 1 : p.margin === q.margin ? 0.5 : 0;
const vsSonnet = judged.length ? { judged: judged.length, both_decided: both.length, same_side: agree, auc_margin_vs_sonnet: pos.length && neg.length ? +(aucS / (pos.length * neg.length)).toFixed(3) : null,
  jev_decided_sonnet_tie: judged.filter((r) => r.jev !== 'TIE' && r.sonnet === 'TIE').length, sonnet_decided_jev_tie: judged.filter((r) => r.jev === 'TIE' && r.sonnet !== 'TIE').length } : null;
const out = { ...(fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {}), tie_band_aa_p95: +band.toFixed(4), by_arm: report, vs_sonnet: vsSonnet, rows };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ tie_band_aa_p95: out.tie_band_aa_p95, by_arm: report, vs_sonnet: vsSonnet }, null, 1));
