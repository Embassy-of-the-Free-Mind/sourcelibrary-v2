#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-mt-ab/score.mjs (#4742/#5606) — decodes a blinded key, controls first, per-engine
// fidelity/omission/invention/inversion per judge, --pairs wins/ties/losses, judge agreement. It shares one shuffle
// across judges, has no CI, a boolean invention and no gate. scripts/eval/translation-corpus-audit/score.mjs (#5274)
// has the bootstrap but no reference and no arms. This decodes build-packet.mjs's per-judge keys, GATES on the three
// controls, reports invention by #5622 kind, quoted reversals, span alignment, and CIs from lib/paired-stats.mjs
// (mulberry32 since #5373). Private references (#5488) are clipped to ≤ 15 words in everything it writes.
/** Score translation-vs-reference verdicts: control gate first, then per-arm fidelity / omission / invention by kind / reversal / span with bootstrap CIs, pairwise preference with ties, judge agreement. */
/**
 *   node scripts/eval/translation-vs-reference/score.mjs --packet <dir> --gate-only        # after the gate chunks; exit 2 = FAIL
 *   node scripts/eval/translation-vs-reference/score.mjs --packet <dir> --out <results.json> [--seed 5695]
 * Reads <dir>/key.json, manifest.json, verdicts/<judge>/*.jsonl and the input JSONL named in key.json (for clipping
 * private references). The full run refuses to score unless the gate passes (--force records an override).
 */
import fs from 'node:fs';
import path from 'node:path';
import { resetSeed, bootstrapCI, binomTwoSided, mean } from '../lib/paired-stats.mjs';
import { weightedKappa } from '../lib/agreement-stats.mjs';
import { readJsonl, itemId, clipDeep, INVENTION_KINDS, SPAN } from './common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const PACKET = opt('packet'); const OUT = opt('out'); const GATE_ONLY = args.includes('--gate-only'); const FORCE = args.includes('--force');
const SEED = Number(opt('seed', 5695));
const DUP_TIE_MIN = Number(opt('dup-tie-min', 0.8));
if (!PACKET || (!GATE_ONLY && !OUT)) { console.error('--packet and (--out or --gate-only) required'); process.exit(1); }

const key = JSON.parse(fs.readFileSync(path.join(PACKET, 'key.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(PACKET, 'manifest.json'), 'utf8'));
const records = Object.fromEntries(readJsonl(key.input).map((r) => [itemId(r), r]));
const meta = Object.fromEntries(manifest.records.map((r) => [r.id, r]));
const clip = (id, x) => (records[id]?.reference_meta?.private ? clipDeep(x, records[id].reference_text) : x);
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const ci3 = (c) => (c ? c.map(r3) : null);

// ── decode every verdict line through the judge's own key ──────────────────────────────────────────────────────
const dec = {}; const problems = [];
for (const j of key.judges) {
  dec[j] = {};
  const dir = path.join(PACKET, 'verdicts', j);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')) : [];
  for (const f of files) for (const v of readJsonl(path.join(dir, f))) {
    const map = key.items[j][v.id];
    if (!map) { problems.push(`${j}/${f}: unknown id ${v.id}`); continue; }
    if (dec[j][v.id]) problems.push(`${j}: ${v.id} judged twice (last line wins)`);
    const tierOf = {};
    if (Array.isArray(v.ranking)) v.ranking.forEach((tier, t) => (Array.isArray(tier) ? tier : [tier]).forEach((l) => { tierOf[l] = t; }));
    const item = { _fit: v.reference_fit ?? null, _reason: v.reason ?? '', _confidence: v.confidence ?? null, _ranked: Array.isArray(v.ranking), arms: {} };
    for (const [label, arm] of Object.entries(map)) {
      const s = v.scores?.[label];
      if (!s) { problems.push(`${j}: ${v.id} ${label} not scored`); continue; }
      if (item._ranked && tierOf[label] == null) problems.push(`${j}: ${v.id} ${label} missing from ranking`);
      const inv = Array.isArray(s.invention) ? s.invention : (s.invention ? [{ kind: 'unknown', quote: '' }] : []);
      item.arms[arm] = {
        label, fidelity: Number.isInteger(s.fidelity) ? s.fidelity : null, omission: !!s.omission, invention: inv,
        reversal: s.reversal && (s.reversal.candidate || s.reversal.source_or_reference) ? s.reversal : null,
        span: SPAN.includes(s.span) ? s.span : 'cant_tell', defects: Array.isArray(s.defects) ? s.defects : [], tier: tierOf[label] ?? null,
      };
    }
    dec[j][v.id] = item;
  }
}

// ── gate: the three controls, per judge ────────────────────────────────────────────────────────────────────────
const gate = { pass: true, by_judge: {}, problems: problems.slice(0, 50), n_problems: problems.length };
for (const j of key.judges) {
  const g = { wrong_page: [], planted: [], duplicate: [], missing: key.gate_items.filter((id) => !dec[j][id]) };
  for (const id of Object.keys(key.controls.wrong_page)) {
    const c = dec[j][id]?.arms['control:wrong_page'];
    g.wrong_page.push({ id, fidelity: c?.fidelity ?? null, span: c?.span ?? null, pass: c?.fidelity != null && c.fidelity <= 2 });
  }
  for (const [id, p] of Object.entries(key.controls.planted)) {
    const c = dec[j][id]?.arms['control:planted'], b = dec[j][id]?.arms[p.base_arm];
    const text = c ? [c.reversal?.candidate, ...c.defects.map((d) => d.detail)].filter(Boolean).join(' ').toLowerCase() : '';
    g.planted.push({ id, op: p.op, from: p.from, to: p.to, planted_fidelity: c?.fidelity ?? null, base_fidelity: b?.fidelity ?? null,
      reversal_flagged: !!c?.reversal, located: !!c && text.includes(String(p.to).toLowerCase()),
      pass: !!c && !!b && (!!c.reversal || (c.fidelity != null && b.fidelity != null && c.fidelity < b.fidelity)) });
  }
  for (const [id, d] of Object.entries(key.controls.duplicate)) {
    const a = dec[j][id]?.arms[d.arm], b = dec[j][id]?.arms[`${d.arm}#dup`];
    g.duplicate.push({ id, arm: d.arm, fidelity: [a?.fidelity ?? null, b?.fidelity ?? null], tier: [a?.tier ?? null, b?.tier ?? null], tie: !!a && !!b && a.fidelity === b.fidelity && a.tier === b.tier && a.omission === b.omission });
  }
  const dupTie = g.duplicate.length ? g.duplicate.filter((x) => x.tie).length / g.duplicate.length : null;
  g.summary = {
    wrong_page: `${g.wrong_page.filter((x) => x.pass).length}/${g.wrong_page.length} scored ≤ 2`,
    planted: `${g.planted.filter((x) => x.pass).length}/${g.planted.length} caught (${g.planted.filter((x) => x.located).length} located the planted word)`,
    duplicate: `${g.duplicate.filter((x) => x.tie).length}/${g.duplicate.length} tied`,
  };
  g.pass = !g.missing.length && g.wrong_page.every((x) => x.pass) && g.planted.every((x) => x.pass) && dupTie != null && dupTie >= DUP_TIE_MIN;
  gate.by_judge[j] = g;
  if (!g.pass) gate.pass = false;
}
if (GATE_ONLY) {
  console.log(JSON.stringify({ gate_pass: gate.pass, ...Object.fromEntries(key.judges.map((j) => [j, { ...gate.by_judge[j].summary, missing: gate.by_judge[j].missing.length, pass: gate.by_judge[j].pass }])), n_problems: gate.n_problems }, null, 1));
  process.exit(gate.pass ? 0 : 2);
}
if (!gate.pass && !FORCE) { console.error('gate FAILED — results not written (re-run with --gate-only for detail; --force records an override)'); process.exit(2); }

// ── per arm, page = unit (each page's value is the mean over judges that scored it) ───────────────────────────
resetSeed(SEED);
const allIds = [...key.gate_items, ...key.main_items];
const ARMS = [...new Set(manifest.records.flatMap((r) => r.arms))];
const judgeMean = (id, arm, f) => { const xs = key.judges.map((j) => dec[j][id]?.arms[arm]).filter(Boolean).map(f).filter((x) => x != null); return xs.length ? mean(xs) : null; };
const rate = (vals) => { const xs = vals.filter((x) => x != null); return { rate: r3(mean(xs)), ci: ci3(bootstrapCI(xs)), n: xs.length }; };
function armBlock(arm, ids) {
  const fid = ids.map((id) => judgeMean(id, arm, (a) => a.fidelity)).filter((x) => x != null);
  const sorted = [...fid].sort((a, b) => a - b);
  const cells = ids.flatMap((id) => key.judges.map((j) => dec[j][id]?.arms[arm]).filter(Boolean));
  const kinds = Object.fromEntries([...INVENTION_KINDS, 'unknown'].map((k) => [k, rate(ids.map((id) => judgeMean(id, arm, (a) => (a.invention.some((x) => x.kind === k) ? 1 : 0))))]));
  const defectClasses = {};
  for (const c of cells) for (const d of c.defects) defectClasses[d.class || 'unclassed'] = (defectClasses[d.class || 'unclassed'] || 0) + 1;
  return {
    pages: fid.length,
    fidelity: { mean: r3(mean(fid)), ci: ci3(bootstrapCI(fid)), median: sorted.length ? sorted[sorted.length >> 1] : null, cant_tell: cells.filter((c) => c.fidelity == null).length,
      by_judge: Object.fromEntries(key.judges.map((j) => [j, r3(mean(ids.map((id) => dec[j][id]?.arms[arm]?.fidelity).filter((x) => x != null)))])) },
    omission: rate(ids.map((id) => judgeMean(id, arm, (a) => (a.omission ? 1 : 0)))),
    reversal: rate(ids.map((id) => judgeMean(id, arm, (a) => (a.reversal ? 1 : 0)))),
    invention_any_but_added_fact: rate(ids.map((id) => judgeMean(id, arm, (a) => (a.invention.some((x) => x.kind !== 'added_fact') ? 1 : 0)))),
    invention_by_kind: kinds,
    span: Object.fromEntries(SPAN.map((s) => [s, cells.filter((c) => c.span === s).length])),
    defect_classes: defectClasses,
    reversals: ids.flatMap((id) => key.judges.map((j) => (dec[j][id]?.arms[arm]?.reversal ? clip(id, { id, judge: j, ...dec[j][id].arms[arm].reversal }) : null)).filter(Boolean)),
  };
}
const strata = { all: allIds };
for (const id of allIds) {
  const m = meta[id];
  // fit:usable drops pages where ANY judge says the reference cut is a different passage — the reference, not the
  // translation, failed there; read the headline beside it
  const fit = key.judges.some((j) => dec[j][id]?._fit === 'wrong') ? 'reference-wrong' : 'usable';
  for (const [k, v] of [['canonical', m.canonical ? 'canonical' : 'non-canonical'], ['style', m.reference_meta.style], ['lang', m.lang], ['track', m.track], ['fit', fit]]) (strata[`${k}:${v}`] ||= []).push(id);
}
const out = { generated: new Date().toISOString(), packet: path.resolve(PACKET), seed_bootstrap: SEED, seed_packet: key.seed, input_sha: key.input_sha, n_items: allIds.length, judges: key.judges,
  gate: { ...gate, forced: !gate.pass && FORCE }, measure: 'judged against a human reference (fidelity of meaning; the reference guides meaning, not wording)', arms: {}, strata: {}, pairs: {}, agreement: {}, reference_fit: {}, per_page: [] };
for (const arm of ARMS) out.arms[arm] = armBlock(arm, allIds);
for (const [s, ids] of Object.entries(strata)) if (s !== 'all') out.strata[s] = Object.fromEntries(ARMS.map((a) => [a, (({ pages, fidelity, omission, reversal, invention_any_but_added_fact }) => ({ pages, fidelity_mean: fidelity.mean, fidelity_ci: fidelity.ci, omission: omission.rate, reversal: reversal.rate, invention_any_but_added_fact: invention_any_but_added_fact.rate }))(armBlock(a, ids))]));

// ── pairwise preference with ties (from each judge's ranking tiers), page-level sign test + paired fidelity Δ ───
for (let x = 0; x < ARMS.length; x++) for (let y = x + 1; y < ARMS.length; y++) {
  const [a, b] = [ARMS[x], ARMS[y]];
  const rec = { by_judge: {}, pages: { a_wins: 0, ties: 0, b_wins: 0, cant_tell: 0 } }; const deltas = [];
  for (const j of key.judges) rec.by_judge[j] = { a_wins: 0, ties: 0, b_wins: 0, cant_tell: 0 };
  for (const id of allIds) {
    let sum = 0, seen = 0;
    for (const j of key.judges) {
      const it = dec[j][id]; const A = it?.arms[a], B = it?.arms[b];
      if (!A || !B) continue;
      if (!it._ranked || A.tier == null || B.tier == null) { rec.by_judge[j].cant_tell++; continue; }
      const s = Math.sign(B.tier - A.tier); seen++; sum += s;
      rec.by_judge[j][s > 0 ? 'a_wins' : s < 0 ? 'b_wins' : 'ties']++;
    }
    if (!seen) { if (key.judges.some((j) => dec[j][id]?.arms[a] && dec[j][id]?.arms[b])) rec.pages.cant_tell++; } else rec.pages[sum > 0 ? 'a_wins' : sum < 0 ? 'b_wins' : 'ties']++;
    const fa = judgeMean(id, a, (z) => z.fidelity), fb = judgeMean(id, b, (z) => z.fidelity);
    if (fa != null && fb != null) deltas.push(fa - fb);
  }
  const untied = rec.pages.a_wins + rec.pages.b_wins;
  rec.sign_test_p = r3(binomTwoSided(rec.pages.a_wins, untied));
  rec.fidelity_delta = { mean: r3(mean(deltas)), ci: ci3(bootstrapCI(deltas)), n: deltas.length, note: `${a} minus ${b}` };
  out.pairs[`${a}:${b}`] = rec;
}

// ── judge agreement, reference fit ────────────────────────────────────────────────────────────────────────────
if (key.judges.length >= 2) {
  const [J1, J2] = key.judges; const pairs = [];
  for (const id of allIds) for (const arm of ARMS) { const a = dec[J1][id]?.arms[arm]?.fidelity, b = dec[J2][id]?.arms[arm]?.fidelity; if (a != null && b != null) pairs.push([a, b]); }
  out.agreement = { judges: [J1, J2], n: pairs.length, fidelity_exact: r3(pairs.filter(([a, b]) => a === b).length / pairs.length), within_1: r3(pairs.filter(([a, b]) => Math.abs(a - b) <= 1).length / pairs.length), weighted_kappa: pairs.length > 1 ? r3(weightedKappa(pairs)) : null };
}
for (const j of key.judges) for (const id of allIds) { const f = dec[j][id]?._fit || 'missing'; out.reference_fit[f] = (out.reference_fit[f] || 0) + 1; }

// ── per page (input for gallery.mjs); reasons/quotes clipped for private references ─────────────────────────
out.per_page = allIds.map((id) => clip(id, {
  id, book_id: meta[id].book_id, page_number: meta[id].page_number, lang: meta[id].lang, track: meta[id].track, canonical: meta[id].canonical, style: meta[id].reference_meta.style, private: meta[id].reference_meta.private,
  control: Object.keys(key.controls).find((t) => key.controls[t][id]) || null,
  reference_fit: Object.fromEntries(key.judges.map((j) => [j, dec[j][id]?._fit ?? null])),
  arms: Object.fromEntries(ARMS.map((arm) => [arm, {
    fidelity: r3(judgeMean(id, arm, (z) => z.fidelity)),
    by_judge: Object.fromEntries(key.judges.map((j) => { const z = dec[j][id]?.arms[arm]; return [j, z ? { fidelity: z.fidelity, omission: z.omission, invention: z.invention, reversal: z.reversal, span: z.span, defects: z.defects, tier: z.tier } : null]; })),
  }])),
  // labels are per judge; decode "T3" to its arm so a reason reads the same whichever judge wrote it
  reasons: Object.fromEntries(key.judges.map((j) => [j, dec[j][id]?._reason ? dec[j][id]._reason.replace(/\bT(\d+)\b/g, (t) => `[${key.items[j][id]?.[t] ?? t}]`) : null])),
}));
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ gate_pass: gate.pass, arms: Object.fromEntries(ARMS.map((a) => [a, { pages: out.arms[a].pages, fidelity: out.arms[a].fidelity.mean, ci: out.arms[a].fidelity.ci, omission: out.arms[a].omission.rate, reversal: out.arms[a].reversal.rate }])), pairs: Object.fromEntries(Object.entries(out.pairs).map(([k, v]) => [k, { ...v.pages, p: v.sign_test_p }])), agreement: out.agreement }, null, 1));
