#!/usr/bin/env node
// PRIOR ART: scripts/eval/per-language-suitability.mjs --phase=score — lite scored against flash as the incumbent
// (agreement threshold, invention judge, coverage), on its own raw-output layout; it has no by-eye label join and
// treats flash as the reference. #5795's rule compares the two engines' catastrophic counts and picks the ten
// most-disagreeing pages per family for the eye, so the kernel (agreementChars, loopVerdict, wilson) is reused here.
/** #5795 score: catastrophic per engine (Wilson), agreementChars between engines, label rule (a), adjudication picks. No model call. */
/**
 *   node scripts/eval/hidden-flash-5795/score.mjs [--work <dir>]
 * Reads <work>/out/{lite,flash}/<slug>.json, labels-pass1.jsonl, and (when present) adjudication.json.
 * Writes results/hidden-flash-5795/{outputs-lite,outputs-flash}.jsonl, results.json, and <work>/adjudication-picks.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { agreementChars, toAgreementChars } from '../lib/metrics.mjs';
import { wilson } from '../lib/agreement-stats.mjs';
import { REFUSAL_REASONS } from '../lib/refusals.mjs';
import { loopVerdict } from '../../lib/ocr-loop-guard.mjs';

const argv = process.argv.slice(2); const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const WORK = opt('work', '/data/scratch/sl/hidden-flash-5795-work'); const RES = 'scripts/eval/results/hidden-flash-5795';
const FAMILIES = ['fas', 'san', 'pli', 'ara', 'gez']; const ARMS = ['lite', 'flash']; const MIN_N = 10; const PICKS = 10;
const rl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sealed = JSON.parse(fs.readFileSync(`${RES}/sealed.json`, 'utf8')).sealed;
const labels = new Map(rl(`${RES}/labels-pass1.jsonl`).map((x) => [x.slug, x]));
const adjFile = `${RES}/adjudication.json`; const adj = fs.existsSync(adjFile) ? new Map(JSON.parse(fs.readFileSync(adjFile, 'utf8')).pages.map((x) => [x.slug, x])) : null;
const ci = (k, n) => { if (!n) return null; const w = wilson(k, n); return [+(w.lo ?? w.low ?? w[0]).toFixed(3), +(w.hi ?? w.high ?? w[1]).toFixed(3)]; };
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i); return +(s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo)).toFixed(3); };

const outs = Object.fromEntries(ARMS.map((a) => [a, []])); const pages = []; let usd = 0; let calls = 0;
for (const p of sealed) {
  const lab = labels.get(p.slug); const hasText = lab.page_class === 'text'; const row = { slug: p.slug, family: p.family, book_id: p.book_id, page_number: p.page_number, page_class: lab.page_class, label_ok: lab.label_ok, arms: {} };
  for (const arm of ARMS) {
    const o = JSON.parse(fs.readFileSync(path.join(WORK, 'out', arm, `${p.slug}.json`), 'utf8'));
    outs[arm].push({ slug: o.slug, arm, model: o.model, finishReason: o.finishReason, retried: o.retried, attempts: o.attempts, prompt: o.prompt, generation: o.generation, image_sha256: o.image_sha256, text: o.text });
    for (const a of o.attempts) { usd += a.cost_usd_realtime; calls++; }
    const letters = toAgreementChars(o.text).length; const lv = loopVerdict(o.text || '');
    const kind = REFUSAL_REASONS.test(o.finishReason || '') && !letters ? 'refusal' : (lv.refuse || o.finishReason === 'MAX_TOKENS') ? 'loop' : (!letters && hasText) ? 'empty' : null;
    row.arms[arm] = { finishReason: o.finishReason, retried: o.retried, chars: (o.text || '').length, letters, outputTokens: o.attempts.at(-1).outputTokens, loop_share: lv.share ?? 0, catastrophic: kind };
  }
  const tl = outs.lite.at(-1).text, tf = outs.flash.at(-1).text; const a = agreementChars(tl, tf);
  row.agreement_chars = a == null ? null : +a.toFixed(4);
  row.adjudication_key = hasText ? ((row.arms.lite.catastrophic || row.arms.flash.catastrophic) ? 0 : (a ?? 0)) : null;
  if (adj?.has(p.slug)) row.adjudication = adj.get(p.slug);
  pages.push(row);
}
for (const arm of ARMS) fs.writeFileSync(`${RES}/outputs-${arm}.jsonl`, outs[arm].map((x) => JSON.stringify(x)).join('\n') + '\n');

const families = {}; const picks = {};
for (const fam of FAMILIES) {
  const P = pages.filter((x) => x.family === fam); const T = P.filter((x) => x.page_class === 'text'); const yes = T.filter((x) => x.label_ok === 'yes').length;
  const cat = Object.fromEntries(ARMS.map((arm) => { const k = P.filter((x) => x.arms[arm].catastrophic); const by = {}; for (const x of k) by[x.arms[arm].catastrophic] = (by[x.arms[arm].catastrophic] || 0) + 1; return [arm, { count: k.length, n: P.length, wilson95: ci(k.length, P.length), by_kind: by, slugs: k.map((x) => x.slug) }]; }));
  const ag = T.map((x) => x.agreement_chars).filter((x) => x != null);
  const pick = [...T].sort((a, b) => a.adjudication_key - b.adjudication_key || a.slug.localeCompare(b.slug)).slice(0, PICKS).map((x) => x.slug); picks[fam] = pick;
  const A = adj ? pick.map((s) => adj.get(s)).filter(Boolean) : []; const tally = { flash: 0, lite: 0, both: 0, neither: 0 }; for (const x of A) tally[x.verdict]++;
  const flashInvented = adj ? [...adj.values()].filter((x) => x.family === fam && x.flash_invented).map((x) => x.slug) : [];
  const liteInvented = adj ? [...adj.values()].filter((x) => x.family === fam && x.lite_invented).map((x) => x.slug) : [];
  const a = T.length ? yes / T.length >= 0.9 : false; const b = cat.flash.count <= cat.lite.count; const c = adj && A.length === pick.length ? tally.flash > tally.lite && flashInvented.length === 0 : null;
  const verdict = T.length < MIN_N ? 'undecided: n too small' : !a ? 'relabel (#4884)' : c == null ? 'pending adjudication' : (b && c) ? 'route to flash' : 'stay on lite';
  families[fam] = { sealed: P.length, with_text: T.length, label: { yes, no: T.filter((x) => x.label_ok === 'no').length, unsure: T.filter((x) => x.label_ok === 'unsure').length, na: P.length - T.length, share_yes: T.length ? +(yes / T.length).toFixed(3) : null, wilson95: ci(yes, T.length), not_yes: T.filter((x) => x.label_ok !== 'yes').map((x) => ({ slug: x.slug, book_id: x.book_id, label_ok: x.label_ok })) },
    catastrophic: cat, agreement_chars: { n: ag.length, median: q(ag, 0.5), q1: q(ag, 0.25), q3: q(ag, 0.75), min: q(ag, 0) },
    adjudication: adj ? { pages: pick.length, judged: A.length, ...tally, flash_invented: flashInvented, lite_invented: liteInvented } : null,
    rule: { a, b, c }, verdict };
}
fs.writeFileSync(path.join(WORK, 'adjudication-picks.json'), JSON.stringify(picks, null, 1));
const prompt = outs.lite[0].prompt; if (new Set(ARMS.flatMap((a) => outs[a].map((x) => x.prompt.text_sha256))).size !== 1) throw new Error('prompt hash differs across calls');
fs.writeFileSync(`${RES}/results.json`, JSON.stringify({ issue: 5795, run_id: 'hidden-flash-5795', scored_at: new Date().toISOString(), prompt, generation: outs.lite[0].generation, models: { lite: outs.lite[0].model, flash: outs.flash[0].model }, spend: { calls, usd_realtime_from_tokens: +usd.toFixed(4), cap_usd: 3 }, families, pages }, null, 1) + '\n');
for (const [f, v] of Object.entries(families)) console.log(f, `n ${v.sealed} text ${v.with_text} label ${v.label.yes}/${v.with_text} (${v.label.share_yes})`, `cat lite ${v.catastrophic.lite.count} ${JSON.stringify(v.catastrophic.lite.by_kind)} flash ${v.catastrophic.flash.count} ${JSON.stringify(v.catastrophic.flash.by_kind)}`, `agr med ${v.agreement_chars.median} [${v.agreement_chars.q1}, ${v.agreement_chars.q3}]`, v.adjudication ? JSON.stringify(v.adjudication) : '', '→', v.verdict);
console.log('calls', calls, 'usd', usd.toFixed(4), 'retried', ARMS.map((a) => `${a} ${outs[a].filter((x) => x.retried).length}`).join(', '));
