#!/usr/bin/env node
// PRIOR ART: scripts/eval/bench-translation/score.py (paired page bootstrap, floors, the rule applied as registered) —
// its rule is fidelity on a 1–5 scale; this one is a ratio of notes, so the bootstrap is restated here over pages
// (scripts/eval/lib/paired-stats.mjs makeRng). The rule is PREREGISTRATION-notes-step-7965.md's, unchanged.
/**
 * #7965 step 3, score. Numbers only out (no source or note text): scripts/eval/results/notes-step-7965/scores.json.
 *
 *   node scripts/eval/notes-step-7965/score.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitAnnotations } from '../../lib/annotation-layer.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { parseNotes, inlineNotes } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const B = process.env.BENCH7499 || `${process.env.JOB_SCRATCH}/bench7499`;
const W = process.env.NOTES_W || `${process.env.JOB_SCRATCH}/w`;
const OUT = path.join(HERE, '../results/notes-step-7965');
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const BAD = new Set(['wrong', 'partly_wrong', 'unsupported']);
const DRAWS = 2000;
const r1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);

function bootDiff(pages, fx, fy) {
  // pages: [{x:{bad,n}, y:{bad,n}}]; returns point and 95% interval of 100*(Σbad_y/Σn_y − Σbad_x/Σn_x)
  const est = (ps) => { let bx = 0, nx = 0, by = 0, ny = 0; for (const p of ps) { const x = fx(p), y = fy(p); bx += x.bad; nx += x.n; by += y.bad; ny += y.n; } return nx && ny ? 100 * (by / ny - bx / nx) : NaN; };
  const rnd = makeRng(7965);
  const ds = [];
  for (let i = 0; i < DRAWS; i++) { const s = []; for (let j = 0; j < pages.length; j++) s.push(pages[Math.floor(rnd() * pages.length)]); const d = est(s); if (!Number.isNaN(d)) ds.push(d); }
  ds.sort((a, b) => a - b);
  return { point: r1(est(pages)), lo: r1(ds[Math.floor(0.025 * ds.length)]), hi: r1(ds[Math.ceil(0.975 * ds.length) - 1]), n_pages: pages.length };
}

const rate = (pages, arm, k = 'bad') => { let b = 0, n = 0; for (const p of pages) { if (!p[arm]) continue; b += p[arm][k]; n += p[arm].n; } return { per100: n ? r1((100 * b) / n) : null, count: b, notes: n }; };

function engine(E) {
  const dir = path.join(W, 'judge', E);
  const key = JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8'));
  const outs = new Map(jl(path.join(dir, 'out.jsonl')).filter((r) => r.verdicts).map((r) => [r.uid, r]));
  const res = { judged_pages: outs.size, planned_pages: Object.keys(key).length };
  // plants
  let plants = 0, caught = 0; const plantKinds = {};
  const pages = [];
  for (const [uid, k] of Object.entries(key)) {
    const o = outs.get(uid); if (!o) continue;
    const page = { uid };
    for (const [L, list] of Object.entries(k.lists)) {
      const agg = (withImage) => { const a = { bad: 0, n: 0, restates: 0, unverifiable: 0, misattached: 0, no_claim: 0 }; for (const n of list.notes) { if (n.plant) continue; const v = o.verdicts[n.id]; if (!v) continue; if (!withImage && v.kind === 'image') continue; a.n++; if (BAD.has(v.claim)) a.bad++; if (v.restates === true) a.restates++; if (v.claim === 'unverifiable') a.unverifiable++; if (v.claim === 'no_claim') a.no_claim++; if (v.attached === false) a.misattached++; } return a; };
      page[list.arm] = agg(false);
      page[`${list.arm}_img`] = agg(true);
      for (const n of list.notes) if (n.plant) { plants++; const v = o.verdicts[n.id]; const hit = v && BAD.has(v.claim); if (hit) caught++; plantKinds[n.plant] = plantKinds[n.plant] || { n: 0, caught: 0 }; plantKinds[n.plant].n++; if (hit) plantKinds[n.plant].caught++; }
      const kinds = {}; for (const n of list.notes) { if (n.plant) continue; const v = o.verdicts[n.id]; if (v) kinds[v.kind] = (kinds[v.kind] || 0) + 1; }
      page[`${list.arm}_kinds`] = kinds;
    }
    pages.push(page);
  }
  res.gate = { plants, caught, pass: plants >= 16 ? caught >= Math.ceil(0.8 * plants) : null, by_kind: plantKinds };
  const both = pages.filter((p) => p.a && p.b), floor = pages.filter((p) => p.a && p.a2);
  res.D = bootDiff(both, (p) => p.a, (p) => p.b);
  res.D0 = bootDiff(floor, (p) => p.a, (p) => p.a2);
  res.D_with_images = bootDiff(both, (p) => p.a_img, (p) => p.b_img);
  res.D0_with_images = bootDiff(floor, (p) => p.a_img, (p) => p.a2_img);
  res.margin = r1(Math.max(1.0, Math.abs(res.D0.lo ?? 0), Math.abs(res.D0.hi ?? 0)));
  res.rates = {};
  for (const arm of ['a', 'b', 'a2']) {
    const ps = arm === 'a2' ? floor : both;
    res.rates[arm] = { false_claims: rate(ps, arm), false_claims_with_images: rate(ps, `${arm}_img`), restates: rate(ps, arm, 'restates'), unverifiable: rate(ps, arm, 'unverifiable'), misattached: rate(ps, arm, 'misattached'), no_claim: rate(ps, arm, 'no_claim') };
    const kinds = {}; for (const p of ps) for (const [k, n] of Object.entries(p[`${arm}_kinds`] || {})) kinds[k] = (kinds[k] || 0) + n;
    res.rates[arm].kinds = kinds;
  }
  res.rates.a_on_floor = { false_claims: rate(floor, 'a') };
  res.D_restates = bootDiff(both, (p) => ({ bad: p.a.restates, n: p.a.n }), (p) => ({ bad: p.b.restates, n: p.b.n }));
  res.D0_restates = bootDiff(floor, (p) => ({ bad: p.a.restates, n: p.a.n }), (p) => ({ bad: p.a2.restates, n: p.a2.n }));

  // Mechanical, on every page each arm ran on.
  const read = (a) => new Map(jl(path.join(W, 'arms', `${E}-${a}.jsonl`)).filter((r) => r.text).map((r) => [r.uid, r]));
  const A = read('v21'), Bn = read('notes');
  const plainRows = new Map(jl(`${B}/arms/${E}-plain.jsonl`).filter((r) => r.text).map((r) => [r.uid, r]));
  const outTok = (r) => Number(r?.usage?.output_tokens ?? r?.out ?? 0) + Number(r?.thinking ?? 0);
  const mech = { a: { pages: 0, notes: 0, zero: 0, out_tokens: 0 }, b: { pages: 0, notes: 0, zero: 0, out_tokens: 0, unparsed: 0, step_out_tokens: 0, plain_out_tokens: 0, anchors: { exact: 0, fuzzy: 0, repeated: 0, missing: 0 }, types: {} } };
  for (const [uid, r] of A) { const n = inlineNotes(r.text).notes.length; mech.a.pages++; mech.a.notes += n; if (!n) mech.a.zero++; mech.a.out_tokens += outTok(r); }
  for (const [uid, r] of Bn) {
    const pl = plainRows.get(uid); if (!pl) continue;
    const p = parseNotes(r.text, splitAnnotations(pl.text).text);
    mech.b.pages++;
    if (!p.ok) mech.b.unparsed++;
    mech.b.notes += p.annotations.length; if (!p.annotations.length) mech.b.zero++;
    mech.b.step_out_tokens += outTok(r); mech.b.plain_out_tokens += outTok(pl);
    for (const a of p.annotations) { mech.b.anchors[a.how === 'exact' ? 'exact' : a.how === 'fuzzy' ? 'fuzzy' : a.how === 'repeated' ? 'repeated' : 'missing']++; mech.b.types[a.type] = (mech.b.types[a.type] || 0) + 1; }
  }
  mech.b.out_tokens = mech.b.step_out_tokens + mech.b.plain_out_tokens;
  const an = mech.b.anchors, tot = an.exact + an.fuzzy + an.repeated + an.missing;
  mech.b.anchor_resolution = tot ? r1((100 * (an.exact + an.fuzzy)) / tot) : null;
  mech.b.anchor_found_at_all = tot ? r1((100 * (an.exact + an.fuzzy + an.repeated)) / tot) : null;
  for (const m of [mech.a, mech.b]) { m.notes_per_page = r1(m.notes / Math.max(1, m.pages)); m.out_tokens_per_page = Math.round(m.out_tokens / Math.max(1, m.pages)); }
  mech.b.step_out_tokens_per_page = Math.round(mech.b.step_out_tokens / Math.max(1, mech.b.pages));
  mech.b.plain_out_tokens_per_page = Math.round(mech.b.plain_out_tokens / Math.max(1, mech.b.pages));
  res.mechanical = mech;

  const gateOk = res.gate.pass !== false;
  const upperOk = res.D.hi != null && res.D.hi <= res.margin;
  const anchorOk = mech.b.anchor_resolution != null && mech.b.anchor_resolution >= 98;
  res.verdict = !gateOk ? 'no verdict (judge control failed)' : res.D.lo != null && res.D.lo > res.margin ? 'fail (worse)' : upperOk && anchorOk ? 'pass' : `fail (${[!upperOk && 'false-claim bound above margin', !anchorOk && 'anchor resolution < 98%'].filter(Boolean).join('; ')})`;
  return res;
}

const out = { issue: 7965, rule: 'scripts/eval/PREREGISTRATION-notes-step-7965.md', scored_at: new Date().toISOString(), engines: {} };
for (const E of ['flash38', 'lite']) if (fs.existsSync(path.join(W, 'judge', E, 'key.json'))) out.engines[E] = engine(E);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'scores.json'), JSON.stringify(out, null, 1));
for (const [E, r] of Object.entries(out.engines)) {
  console.log(`\n== ${E}: judged ${r.judged_pages}/${r.planned_pages}; plants ${r.gate.caught}/${r.gate.plants}; verdict: ${r.verdict}`);
  console.log(`  false claims /100: a ${r.rates.a.false_claims.per100} (${r.rates.a.false_claims.count}/${r.rates.a.false_claims.notes})  b ${r.rates.b.false_claims.per100} (${r.rates.b.false_claims.count}/${r.rates.b.false_claims.notes})  a2 ${r.rates.a2.false_claims.per100} vs a-on-floor ${r.rates.a_on_floor.false_claims.per100}`);
  console.log(`  D = ${r.D.point} [${r.D.lo}, ${r.D.hi}]  D0 = ${r.D0.point} [${r.D0.lo}, ${r.D0.hi}]  margin ${r.margin}`);
  console.log(`  restates /100: a ${r.rates.a.restates.per100} b ${r.rates.b.restates.per100}; misattached: a ${r.rates.a.misattached.per100} b ${r.rates.b.misattached.per100}; unverifiable a ${r.rates.a.unverifiable.per100} b ${r.rates.b.unverifiable.per100}`);
  console.log(`  mech: ${JSON.stringify(r.mechanical)}`);
}
