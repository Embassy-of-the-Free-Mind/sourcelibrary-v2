#!/usr/bin/env node
// PRIOR ART: scripts/eval/jev/seam-continuity-screen.mjs — its Jev call (Vercel AI Gateway, typesafe-ai/jev, one `noul`
// question) is copied; its English-only state and question scored AUC 0.49 on #6742's Opus labels. New here: a
// SOURCE-GROUNDED state (both sources and both English sides at the join) and a typed fidelity question, scored against
// the 240 Opus-labelled real joins and the 30 plants of scripts/eval/results/seams-6742/ (Derek's note on #6742).
/**
 * jev-grounded — calibrate Jev as a seam detector against the #6742 Opus reference. Paid: ~$0.00003/call, cap $1.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/seam-repair-6742/jev-grounded.mjs --out=DIR
 *
 * Writes DIR/jev-scores.jsonl (resumable) and DIR/jev-report.json: AUC vs Opus (any defect; major only), precision /
 * recall at the best-F1 threshold and at the threshold that holds 90% precision, plants caught at those thresholds.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = arg('out');
const R = new URL('../../eval/results/seams-6742/', import.meta.url).pathname;
const gz = (f) => zlib.gunzipSync(fs.readFileSync(path.join(R, f))).toString('utf8').trim().split('\n').map(l => JSON.parse(l));
const CAP_USD = 1.0;

const QUESTION = 'The state shows the SOURCE text at the end of page N and the start of page N+1, then the English translation of the end of page N and the start of page N+1. Question: the English at the page turn renders the source exactly across the break — every source word near the turn is translated once, on its own page, nothing is lost, nothing is duplicated, nothing is moved to the other page, no words are invented to close or bridge a sentence, and read straight across the turn the English sentence is correct.';
const cut = (t, n, end) => (t.length > n ? (end ? '…' + t.slice(-n) : t.slice(0, n) + '…') : t);
const state = (it) => `SOURCE, end of page N:\n${cut(it.srcTailA, 1400, true)}\n\nSOURCE, start of page N+1:\n${cut(it.srcHeadB, 1400, false)}\n\n=== page break ===\n\nENGLISH, end of page N:\n${cut(it.enTailA, 1600, true)}\n\nENGLISH, start of page N+1:\n${cut(it.enHeadB, 1600, false)}`;

async function jev(tok, st) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch('https://ai-gateway.vercel.sh/typesafe/v1/systemone', {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'typesafe-ai/jev', state: st.slice(0, 12000), questions: { c: { type: 'noul', instructions: QUESTION } } }),
    });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 800 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`jev ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return { p: j.answers.c.noul, usd: Number(j.provider_metadata?.gateway?.marketCost ?? 0) };
  }
  throw new Error('jev: gave up after 4 attempts');
}

/** AUC of a score where HIGHER means more likely defective, by the rank-sum. */
function auc(pos, neg) {
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return pos.length && neg.length ? +(s / (pos.length * neg.length)).toFixed(3) : null;
}

const items = gz('items.jsonl.gz'), key = new Map(gz('key.jsonl.gz').map(k => [k.id, k])), labels = new Map(gz('labels.jsonl.gz').filter(l => l.parsed).map(l => [l.id, l]));
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'jev-scores.jsonl');
const done = new Map((fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []).map(s => [s.id, s]));
const tok = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
if (!tok) { console.error('need AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN'); process.exit(1); }
let usd = [...done.values()].reduce((a, s) => a + (s.usd || 0), 0);
const todo = items.filter(it => !done.has(it.id));
for (let i = 0; i < todo.length; i += 6) {
  if (usd >= CAP_USD) { console.error(`cap $${CAP_USD} reached`); break; }
  const got = await Promise.all(todo.slice(i, i + 6).map(async it => { const r = await jev(tok, state(it)); return { id: it.id, p: +r.p.toFixed(4), usd: r.usd }; }));
  for (const g of got) { done.set(g.id, g); usd += g.usd; fs.appendFileSync(file, JSON.stringify(g) + '\n'); }
  process.stderr.write(`\r${done.size}/${items.length} $${usd.toFixed(4)}  `);
}

// ── score (only now unblind) ─────────────────────────────────────────────────
// Jev's noul = P(the statement is true) = P(the turn is faithful). Defect score = 1 − p.
const rows = items.map(it => ({ id: it.id, k: key.get(it.id), l: labels.get(it.id), d: done.has(it.id) ? 1 - done.get(it.id).p : null })).filter(r => r.d != null);
const real = rows.filter(r => ['random', 'flagged'].includes(r.k.stratum) && r.l);
const isDef = (r) => r.l.label !== 'ok';
const pos = real.filter(isDef).map(r => r.d), neg = real.filter(r => !isDef(r)).map(r => r.d);
const major = real.filter(r => r.l.severity === 'major').map(r => r.d);
const plants = rows.filter(r => r.k.stratum === 'plant'), goods = rows.filter(r => r.k.stratum === 'good');
const at = (th) => { const tp = real.filter(r => r.d >= th && isDef(r)).length, fp = real.filter(r => r.d >= th && !isDef(r)).length, fn = pos.length - tp;
  return { th: +th.toFixed(4), precision: tp + fp ? +(tp / (tp + fp)).toFixed(3) : null, recall: +(tp / pos.length).toFixed(3), flagged: tp + fp, plantsCaught: plants.filter(r => r.d >= th).length, goodFlagged: goods.filter(r => r.d >= th).length }; };
const ths = [...new Set(real.map(r => r.d))].sort((a, b) => a - b);
const sweep = ths.map(at);
const bestF1 = sweep.reduce((b, s) => { const f = s.precision ? 2 * s.precision * s.recall / (s.precision + s.recall) : 0; return f > b.f ? { f, s } : b; }, { f: -1 }).s;
const p90 = sweep.filter(s => s.precision >= 0.9 && s.flagged >= 5).sort((a, b) => b.recall - a.recall)[0] || null;
const report = { n: { real: real.length, defective: pos.length, ok: neg.length, major: major.length, plants: plants.length, good: goods.length }, usd: +usd.toFixed(4), calls: done.size,
  auc: auc(pos, neg), aucMajorVsOk: auc(major, neg), aucPlantsVsGood: auc(plants.map(r => r.d), goods.map(r => r.d)), bestF1, at90precision: p90, question: QUESTION };
fs.writeFileSync(path.join(OUT, 'jev-report.json'), JSON.stringify(report, null, 1) + '\n');
console.log('\n' + JSON.stringify(report));
