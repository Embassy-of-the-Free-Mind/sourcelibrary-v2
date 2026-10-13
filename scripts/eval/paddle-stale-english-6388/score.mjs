#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-zh-qa-6388/score.mjs and requests2.mjs `adjudicate` (reviewer A/B lists in seeded order,
// Wilson over one page per book). Those score a TRANSCRIPTION's errors; this scores the ENGLISH's errors by cause, and
// applies the #6388 pre-registered retranslation rule (README). No model call, no Mongo. $0.
//   node scripts/eval/paddle-stale-english-6388/score.mjs adj      → $JOB_SCRATCH/adj-batches.json + adjudication-map.json
//   node scripts/eval/paddle-stale-english-6388/score.mjs          → results.json + results.md
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeRng } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = process.env.JOB_SCRATCH;
const J = f => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
function parseJson(s) {
  const t = String(s || '').replace(/^```(?:json)?\s*|```\s*$/gm, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const j = JSON.parse(t.slice(a, b + 1)); return j && typeof j.verdict === 'string' ? j : null; } catch { return null; }
}
const packet = J('packet-map.json').items;
const draw = new Map(J('draw.json').items.map(d => [d.page_id, d]));
const controls = new Map(J('controls.json').map(c => [c.page_id, c]));
const census = J('census-summary.json');

const O = new Map(); for (const r of readJsonl(path.join(HERE, 'reads/O.jsonl'))) if (r.json) for (const p of r.json.pages) O.set(p.id, p);
const G = new Map(); for (const r of readJsonl(path.join(HERE, 'reads/G.jsonl'))) { const j = parseJson(r.text); if (j) G.set(r.uid, j); }
const ADJ = new Map(); for (const r of readJsonl(path.join(HERE, 'reads/ADJ.jsonl'))) if (r.json) ADJ.set(r.qids[0], r.json);

const mat = (x, causes) => (x?.errors || []).some(e => e.severity === 'material' && causes.includes(String(e.cause).toUpperCase()));
const ocrMat = x => mat(x, ['OCR', 'BOTH']);
const trMat = x => mat(x, ['TRANSLATION']);
const disagree = (a, b) => !a || !b || a.verdict !== b.verdict || ocrMat(a) !== ocrMat(b);

const stage = process.argv[2];
if (stage === 'adj') {
  const BODY = fs.readFileSync(path.join(HERE, 'prompt-page.txt'), 'utf8');
  const TAIL = fs.readFileSync(path.join(HERE, 'prompt-single-tail.txt'), 'utf8');
  const texts = new Map(JSON.parse(fs.readFileSync(path.join(SCRATCH, 'draw-texts.json'))).map(t => [t.page_id, t]));
  const todo = packet.filter(it => it.role === 'sample' && disagree(O.get(it.qid), G.get(it.qid)))
    .sort((a, b) => (a.arm === 'random' ? 0 : 1) - (b.arm === 'random' ? 0 : 1) || a.qid.localeCompare(b.qid));
  const map = [], batches = [];
  for (const it of todo) {
    const o = O.get(it.qid), g = G.get(it.qid);
    const h = parseInt(createHash('sha256').update(it.qid).digest('hex').slice(0, 8), 16);
    const flip = makeRng(6394 ^ h)() < 0.5;
    const [A, B] = flip ? [g, o] : [o, g];
    const show = x => x ? `verdict ${x.verdict}: ${JSON.stringify(x.errors || [])}` : 'no answer';
    const t = texts.get(it.page_id);
    const prompt = `${BODY}\n\nTWO EARLIER REVIEWS of this page disagree. They are shown in random order; either may be wrong, and both may have missed errors. Check every listed error against the image yourself, keep only the real ones, add any both missed, and give your own final list and verdict by the definitions above.\n\nREVIEWER A (${show(A)})\n\nREVIEWER B (${show(B)})\n\n===== THE PAGE ===== (image: ./${it.qid}.jpg; open it with the Read tool, the only tool you may use)\n\nREADING A:\n${t.old}\n\nREADING B:\n${t.paddle}\n\nENGLISH:\n${t.english}\n${TAIL}`;
    batches.push({ bid: `a${it.qid.slice(1)}`, qids: [it.qid], images: [path.join(SCRATCH, 'img', `${it.qid}.jpg`)], prompt });
    map.push({ qid: it.qid, arm: it.arm, A: flip ? 'G' : 'O', B: flip ? 'O' : 'G', o: o?.verdict ?? null, g: g?.verdict ?? null, o_ocr_material: o ? ocrMat(o) : null, g_ocr_material: g ? ocrMat(g) : null });
  }
  fs.writeFileSync(path.join(SCRATCH, 'adj-batches.json'), JSON.stringify(batches, null, 1));
  fs.writeFileSync(path.join(HERE, 'adjudication-map.json'), JSON.stringify({ seed: 6394, items: map }, null, 1) + '\n');
  console.log('disagreements', map.length, 'random', map.filter(m => m.arm === 'random').length);
  process.exit(0);
}

// ── controls ───────────────────────────────────────────────────────────────
const keyOf = c => c.plant.kind === 'negation' ? 'neither' : c.plant.to.match(/Yan|72,000|Thunder|eight/)[0].toLowerCase();
const ctl = packet.filter(i => i.role === 'control').map(i => {
  const c = controls.get(i.page_id), k = keyOf(c);
  const caught = x => x ? (x.errors || []).some(e => String(e.english || '').toLowerCase().includes(k)) : null;
  const sev = x => (x?.errors || []).find(e => String(e.english || '').toLowerCase().includes(k))?.severity ?? null;
  return { qid: i.qid, kind: c.plant.kind, key: k, O: caught(O.get(i.qid)), G: caught(G.get(i.qid)), O_severity: sev(O.get(i.qid)), G_severity: sev(G.get(i.qid)) };
});
const ctlO = ctl.filter(c => c.O).length, ctlG = ctl.filter(c => c.G).length;

// ── sample pages ───────────────────────────────────────────────────────────
const pages = packet.filter(i => i.role === 'sample').map(i => {
  const d = draw.get(i.page_id), o = O.get(i.qid), g = G.get(i.qid), a = ADJ.get(i.qid);
  const dis = disagree(o, g);
  const fin = dis ? a : o;
  return { qid: i.qid, arm: i.arm, book_id: d.book_id, title: d.title, page_number: d.page_number, cer: d.cer, bin: d.bin,
    o_verdict: o?.verdict ?? null, g_verdict: g?.verdict ?? null, adj_verdict: a?.verdict ?? null, disagree: dis, resolved: !!fin,
    o_ocr: o ? ocrMat(o) : null, g_ocr: g ? ocrMat(g) : null,
    verdict: fin?.verdict ?? null, ocr_material: fin ? ocrMat(fin) : null, translation_material: fin ? trMat(fin) : null,
    material_errors: fin ? fin.errors.filter(e => e.severity === 'material') : null };
});
const rate = (xs, f) => { const r = xs.filter(p => p.resolved); const k = r.filter(f).length; const [lo, hi] = wilson(k, r.length); return { k, n: r.length, p: r.length ? +(k / r.length).toFixed(3) : null, lo: +lo.toFixed(3), hi: +hi.toFixed(3), unresolved: xs.length - r.length }; };
const rnd = pages.filter(p => p.arm === 'random');
const headline = rate(rnd, p => p.ocr_material);
// bounds if any random page is unresolved: count unresolved as 0 / as 1
const unres = rnd.filter(p => !p.resolved).length;
const bounds = { lo_all_unresolved_clean: +(headline.k / rnd.length).toFixed(3), hi_all_unresolved_material: +((headline.k + unres) / rnd.length).toFixed(3) };
const BINS = census.bins.map(b => b.bin);
const byBin = BINS.map(bin => ({ bin, eligible_pages: census.bins.find(b => b.bin === bin).eligible_pages, sample: pages.filter(p => p.bin === bin).length, random: rnd.filter(p => p.bin === bin).length, ocr_material: rate(pages.filter(p => p.bin === bin), p => p.ocr_material), translation_material: rate(pages.filter(p => p.bin === bin), p => p.translation_material), would_fix: rate(pages.filter(p => p.bin === bin), p => p.verdict === 'retranslate-would-fix') }));

// pre-registered rule
let rec, threshold = null, pagesToRetranslate = null;
if (headline.p >= 0.15) { rec = 'retranslate every stale page'; pagesToRetranslate = census.counts.english_present; }
else if (headline.p <= 0.05) { rec = 'keep the stale English; retranslate nothing in bulk'; pagesToRetranslate = 0; }
else {
  let idx = -1;
  for (let i = 0; i < byBin.length; i++) if (byBin.slice(i).every(b => b.ocr_material.n > 0 && b.ocr_material.p >= 0.15)) { idx = i; break; }
  if (idx < 0) { rec = 'no bin meets the rule: no bulk retranslation'; pagesToRetranslate = 0; }
  else { threshold = byBin[idx].bin; pagesToRetranslate = byBin.slice(idx).reduce((n, b) => n + b.eligible_pages, 0); rec = `retranslate only pages with old-vs-new CER in bin ${threshold} or above`; }
}
const verdicts = xs => xs.filter(p => p.resolved).reduce((m, p) => (m[p.verdict] = (m[p.verdict] || 0) + 1, m), {});
const agree = (xs, f) => { const both = xs.filter(p => p[`o_${f}`] != null && p[`g_${f}`] != null); return { n: both.length, same: both.filter(p => p[`o_${f}`] === p[`g_${f}`]).length }; };
const res = {
  computed_at: new Date().toISOString(),
  calls: { opus_review: readJsonl(path.join(HERE, 'reads/O.jsonl')).length, opus_adj: readJsonl(path.join(HERE, 'reads/ADJ.jsonl')).length, agy_rows: readJsonl(path.join(HERE, 'reads/G.jsonl')).length },
  controls: { O: `${ctlO}/5`, G: `${ctlG}/5`, gate_passed: ctlO >= 4 && ctlG >= 4, items: ctl },
  headline_random_ocr_material: headline, bounds_if_unresolved: unres ? bounds : null,
  random_translation_material: rate(rnd, p => p.translation_material),
  random_would_fix: rate(rnd, p => p.verdict === 'retranslate-would-fix'),
  random_any_material: rate(rnd, p => p.ocr_material || p.translation_material),
  per_reviewer_random_ocr_material: { O: rate(rnd.map(p => ({ ...p, resolved: p.o_ocr != null })), p => p.o_ocr), G: rate(rnd.map(p => ({ ...p, resolved: p.g_ocr != null })), p => p.g_ocr) },
  agreement: { verdict: agree(pages.map(p => ({ ...p, o_v: p.o_verdict, g_v: p.g_verdict })), 'v'), ocr_material: agree(pages, 'ocr'), disagreements: pages.filter(p => p.disagree).length, adjudicated: pages.filter(p => p.adj_verdict).length },
  verdicts_random: verdicts(rnd), verdicts_top: verdicts(pages.filter(p => p.arm === 'top_decile')),
  by_bin: byBin, recommendation: rec, threshold_bin: threshold, pages_to_retranslate: pagesToRetranslate,
  pages,
};
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(res, null, 1) + '\n');
const pct = r => r.p == null ? 'n/a' : `${(r.p * 100).toFixed(0)}% (${r.k}/${r.n}; ${(r.lo * 100).toFixed(0)}–${(r.hi * 100).toFixed(0)}%)`;
const md = [`# #6388 stale English on Paddle-read Siku pages: results`, '', `computed ${res.computed_at} by score.mjs`, '',
  `- Controls: Opus ${res.controls.O}, Gemini 3.1 Pro ${res.controls.G} — gate ${res.controls.gate_passed ? 'passed' : 'FAILED'}`,
  `- Headline (60 random books, page has a material OCR-caused English error): **${pct(headline)}**${unres ? ` — ${unres} unresolved, bounds ${bounds.lo_all_unresolved_clean}–${bounds.hi_all_unresolved_material}` : ''}`,
  `- Material TRANSLATION-caused error (random): ${pct(res.random_translation_material)}`,
  `- Verdict retranslate-would-fix (random): ${pct(res.random_would_fix)}`,
  `- Any material error (random): ${pct(res.random_any_material)}`,
  `- Per reviewer, OCR-material (random): Opus ${pct(res.per_reviewer_random_ocr_material.O)}, Gemini ${pct(res.per_reviewer_random_ocr_material.G)}`,
  `- Agreement: verdict ${res.agreement.verdict.same}/${res.agreement.verdict.n}, OCR-material flag ${res.agreement.ocr_material.same}/${res.agreement.ocr_material.n}; ${res.agreement.disagreements} disagreements, ${res.agreement.adjudicated} adjudicated`,
  `- Verdicts random: ${JSON.stringify(res.verdicts_random)}; top decile: ${JSON.stringify(res.verdicts_top)}`,
  '', '| old-vs-new CER | eligible pages | sampled (random) | OCR-material | TRANSLATION-material | would-fix verdict |', '|---|---|---|---|---|---|',
  ...byBin.map(b => `| ${b.bin} | ${b.eligible_pages.toLocaleString('en')} | ${b.sample} (${b.random}) | ${pct(b.ocr_material)} | ${pct(b.translation_material)} | ${pct(b.would_fix)} |`),
  '', `**Rule:** ${rec}${pagesToRetranslate != null ? ` → ${pagesToRetranslate.toLocaleString('en')} pages` : ''}`, '',
  '## Controls', '', '| qid | kind | Opus | Gemini |', '|---|---|---|---|', ...ctl.map(c => `| ${c.qid} | ${c.kind} | ${c.O} (${c.O_severity}) | ${c.G} (${c.G_severity}) |`),
  '', '## Pages', '', '| qid | arm | CER | title | p | O | G | ADJ | OCR-mat | TR-mat |', '|---|---|---|---|---|---|---|---|---|---|',
  ...pages.sort((a, b) => a.cer - b.cer).map(p => `| ${p.qid} | ${p.arm} | ${p.cer} | ${p.title.slice(0, 28)} | ${p.page_number} | ${p.o_verdict} | ${p.g_verdict} | ${p.adj_verdict ?? ''} | ${p.ocr_material} | ${p.translation_material} |`)].join('\n');
fs.writeFileSync(path.join(HERE, 'results.md'), md + '\n');
console.log(md.split('\n## Pages')[0]);
