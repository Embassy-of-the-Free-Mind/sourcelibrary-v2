#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/agreement-stats.mjs (wilson, aucLowerIsPositive) and scripts/eval/lib/paired-stats.mjs
// (binomTwoSided, makeRng) do the statistics; this file only joins the #6742 artifacts (census, Opus labels,
// flash-lite arms, repair judge) and reports them. No model calls.
/**
 * score — every number in the #6742 write-up, from the job's files.
 *
 *   node scripts/eval/seams-6742/score.mjs --census=DIR/census.jsonl --frame=DIR/frame-summary.json --out=OPUSDIR
 *
 * Writes OPUSDIR/report.json and prints it.
 */
import fs from 'fs';
import path from 'path';
import { wilson, aucLowerIsPositive } from '../lib/agreement-stats.mjs';
import { binomTwoSided, makeRng } from '../lib/paired-stats.mjs';
import { costOf, BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';
import { MODEL } from './flashlite.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const r4 = (x) => x == null || Number.isNaN(x) ? null : +x.toFixed(4);
const rate = (k, n) => { const [lo, hi] = wilson(k, n); return { k, n, rate: n ? r4(k / n) : null, lo: r4(lo), hi: r4(hi) }; };
const last = (rows, key = 'id') => { const m = new Map(); for (const r of rows) if (r.parsed) m.set(r[key], r); return m; };
const scriptGroup = (s) => s === 'latin' ? 'latin' : s === 'greek' ? 'greek' : !s ? 'none' : 'non-latin-other';

function main() {
  const out = arg('out');
  const census = readJsonl(arg('census')).filter(r => !r.skipped);
  const frame = JSON.parse(fs.readFileSync(arg('frame'), 'utf8'));
  const key = new Map(readJsonl(path.join(out, 'key.jsonl')).map(x => [x.id, x]));
  const labels = last(readJsonl(path.join(out, 'labels.jsonl')));
  const rep = { labelled: labels.size, of: key.size };
  const isBad = (id) => labels.get(id) && labels.get(id).label !== 'ok';
  const isMajor = (id) => isBad(id) && labels.get(id).severity === 'major';

  // ── 1. Opus label distribution by stratum, planted catch rate, good-control false alarms.
  const strata = {};
  for (const [id, k] of key) {
    const l = labels.get(id); if (!l) continue;
    const s = (strata[k.stratum + (k.plant ? `:${k.plant}` : '')] ||= { n: 0, labels: {}, severity: {} });
    s.n++; s.labels[l.label] = (s.labels[l.label] || 0) + 1; s.severity[l.severity] = (s.severity[l.severity] || 0) + 1;
  }
  rep.opusByStratum = strata;
  const plants = [...key.values()].filter(k => k.stratum === 'plant' && labels.has(k.id));
  rep.plantCatch = {
    any: rate(plants.filter(k => isBad(k.id)).length, plants.length),
    drop_as_omission: rate(plants.filter(k => k.plant === 'drop' && ['omission'].includes(labels.get(k.id).label)).length, plants.filter(k => k.plant === 'drop').length),
    drop_any: rate(plants.filter(k => k.plant === 'drop' && isBad(k.id)).length, plants.filter(k => k.plant === 'drop').length),
    dup_as_duplication: rate(plants.filter(k => k.plant === 'dup' && (labels.get(k.id).labels || [labels.get(k.id).label]).includes('duplication')).length, plants.filter(k => k.plant === 'dup').length),
    dup_any: rate(plants.filter(k => k.plant === 'dup' && isBad(k.id)).length, plants.filter(k => k.plant === 'dup').length),
  };
  const goods = [...key.values()].filter(k => k.stratum === 'good' && labels.has(k.id));
  rep.goodControlFlagged = rate(goods.filter(k => isBad(k.id)).length, goods.length);

  // ── 2. Defect rate on what readers see. (a) the uniform random stratum alone; (b) stratified by the census `strong`
  // flag: P(bad) = P(strong)·P(bad|strong) + P(¬strong)·P(bad|¬strong), P(strong) from the 2,000-book census prose rows,
  // P(bad|strong) from random∪flagged strong items (both uniform over the strong set), P(bad|¬strong) from random only.
  const real = [...key.values()].filter(k => ['random', 'flagged'].includes(k.stratum) && labels.has(k.id));
  const random = real.filter(k => k.stratum === 'random');
  const prose = census.filter(r => !r.nonProse);
  const pStrong = prose.filter(r => r.strong).length / prose.length;
  const strongItems = real.filter(k => k.strong), weakItems = random.filter(k => !k.strong);
  const est = (badFn) => {
    const ppv = strongItems.filter(k => badFn(k.id)).length / strongItems.length;
    const npvBad = weakItems.filter(k => badFn(k.id)).length / weakItems.length;
    // bootstrap over items within each cell and over the census prose rows for pStrong
    const rnd = makeRng(9), B = 4000, bs = [];
    for (let b = 0; b < B; b++) {
      const rs = (arr) => { let c = 0; for (let j = 0; j < arr.length; j++) if (badFn(arr[Math.floor(rnd() * arr.length)].id)) c++; return c / arr.length; };
      let cs = 0; for (let j = 0; j < prose.length; j++) if (prose[Math.floor(rnd() * prose.length)].strong) cs++;
      const ps = cs / prose.length;
      bs.push(ps * rs(strongItems) + (1 - ps) * rs(weakItems));
    }
    bs.sort((a, b) => a - b);
    const p = pStrong * ppv + (1 - pStrong) * npvBad;
    const lo = bs[Math.floor(B * 0.025)], hi = bs[Math.floor(B * 0.975)];
    const proseBreaks = frame.breaks * (1 - census.filter(r => r.nonProse).length / census.length);
    return { rate: r4(p), lo: r4(lo), hi: r4(hi), ppvStrong: rate(strongItems.filter(k => badFn(k.id)).length, strongItems.length), badGivenNotStrong: rate(weakItems.filter(k => badFn(k.id)).length, weakItems.length),
      pStrong: r4(pStrong), corpusProseBreaks: Math.round(proseBreaks), corpusBad: { est: Math.round(p * proseBreaks), lo: Math.round(lo * proseBreaks), hi: Math.round(hi * proseBreaks) } };
  };
  rep.defectRate = {
    randomStratumAny: rate(random.filter(k => isBad(k.id)).length, random.length),
    randomStratumMajor: rate(random.filter(k => isMajor(k.id)).length, random.length),
    stratifiedAny: est(isBad), stratifiedMajor: est(isMajor),
    randomLabels: random.reduce((a, k) => { const l = labels.get(k.id).label; a[l] = (a[l] || 0) + 1; return a; }, {}),
  };
  const byGroup = (fn) => { const g = {}; for (const k of random) (g[fn(k)] ||= []).push(k); return Object.fromEntries(Object.entries(g).sort((a, b) => b[1].length - a[1].length).map(([n, ks]) => [n, { any: rate(ks.filter(k => isBad(k.id)).length, ks.length), major: rate(ks.filter(k => isMajor(k.id)).length, ks.length) }])); };
  rep.randomByLane = byGroup(k => k.lane);
  rep.randomByFamily = byGroup(k => k.family);
  rep.randomByScript = byGroup(k => scriptGroup(k.script));
  rep.randomBySrcContinues = byGroup(k => k.srcContinues ? 'source-continues' : 'source-closed');
  // Census signals as detectors of an Opus defect (random ∪ flagged; precision is over flagged-by-signal items).
  rep.censusSignals = {};
  for (const s of ['strong', 'any', 'closedOverOpen', 'enHangsThenFresh', 'omissionTell', 'dupJoin', 'dup8', 'catchwordEcho', 'bracketBridge', 'edgeLow', 'edgeHigh', 'carried', 'ocrNext']) {
    const flagged = real.filter(k => k[s]);
    rep.censusSignals[s] = { precision: rate(flagged.filter(k => isBad(k.id)).length, flagged.length), recallOnRandom: rate(random.filter(k => k[s] && isBad(k.id)).length, random.filter(k => isBad(k.id)).length) };
  }

  // ── 3. flash-lite detect vs Opus.
  const spend = readJsonl(path.join(out, 'spend.jsonl'));
  rep.detect = {};
  for (const arm of ['D1', 'D2', 'D3', 'D4', 'D5']) {
    const d = last(readJsonl(path.join(out, `detect-${arm}.jsonl`)));
    if (!d.size) continue;
    const score = (id) => { const x = d.get(id); return x ? Number(x.p_defect) : null; };
    const yes = (id) => { const x = d.get(id); if (!x) return null; if (['D1', 'D4', 'D5'].includes(arm)) return x.defect === 'yes'; if (arm === 'D2') return x.label !== 'ok'; return !!(x.omitted || x.duplicated || x.moved_to_wrong_page || x.reads_across === 'broken'); };
    const evalSet = (ks, target = isBad) => {
      const rows = ks.filter(k => d.has(k.id)).map(k => ({ score: -score(k.id), positive: target(k.id), yes: yes(k.id) }));
      const pos = rows.filter(r => r.positive).length;
      const thr = {};
      for (const t of [30, 50, 70, 90]) { const f = rows.filter(r => -r.score >= t); thr[t] = { flagged: f.length, precision: rate(f.filter(r => r.positive).length, f.length), recall: rate(f.filter(r => r.positive).length, pos) }; }
      const f = rows.filter(r => r.yes);
      return { n: rows.length, positives: pos, auc: rows.length && pos && pos < rows.length ? r4(aucLowerIsPositive(rows)) : null,
        ownCall: { flagged: f.length, precision: rate(f.filter(r => r.positive).length, f.length), recall: rate(f.filter(r => r.positive).length, pos) }, thresholds: thr };
    };
    const real2 = real;
    rep.detect[arm] = {
      parsed: d.size,
      real: evalSet(real2), realMajor: evalSet(real2, isMajor), random: evalSet(random),
      randomFlagRate: rate(random.filter(k => d.has(k.id) && yes(k.id)).length, random.filter(k => d.has(k.id)).length),
      plantsCaught: rate(plants.filter(k => yes(k.id)).length, plants.filter(k => d.has(k.id)).length),
      goodFlagged: rate(goods.filter(k => yes(k.id)).length, goods.filter(k => d.has(k.id)).length),
      byScript: Object.fromEntries(['latin', 'greek', 'non-latin-other'].map(g => [g, evalSet(real2.filter(k => scriptGroup(k.script) === g))])),
      byLang: Object.fromEntries(['Latin', 'German', 'English', 'Greek', 'French'].map(g => [g, evalSet(real2.filter(k => k.lang === g))])),
      tokens: (() => { const s = spend.filter(x => x.arm === arm); const i = s.reduce((a, x) => a + x.in, 0) / s.length, o = s.reduce((a, x) => a + x.out, 0) / s.length; return { calls: s.length, meanIn: Math.round(i), meanOut: Math.round(o), usd: r4(s.reduce((a, x) => a + x.usd, 0)), batchUsdPer100K: +(costOf(MODEL, i, o) * BATCH_MULTIPLIER * 1e5).toFixed(2) }; })(),
    };
  }

  // ── 4. repairs: applicability, and the blind Opus pairwise judge vs current, with the A/A floor.
  const setF = path.join(out, 'repair-set.json');
  if (fs.existsSync(setF)) {
    const set = JSON.parse(fs.readFileSync(setF, 'utf8'));
    const packets = new Map(readJsonl(path.join(out, 'judge-packets.jsonl')).flatMap(pk => pk.pairs.map(p => [p.pair, p])));
    const verdicts = [];
    for (const j of readJsonl(path.join(out, 'judge.jsonl')).filter(x => x.parsed)) for (const v of j.verdicts) { const p = packets.get(v.pair); if (p) verdicts.push({ ...p, ...v }); }
    const unchanged = readJsonl(path.join(out, 'judge-unchanged.jsonl'));
    rep.repair = { setBad: set.bad.length, setOk: set.ok.length, arms: {} };
    for (const arm of ['opus', 'R1', 'R2', 'R3', 'AA']) {
      const vs = verdicts.filter(v => v.arm === arm);
      // per (item): +1 a repair-preferred order, -1 a current-preferred order; for AA, P-preferred counts +1.
      const byItem = new Map();
      for (const v of vs) {
        const repIs = arm === 'AA' ? 'P' : v.order === 'cur-first' ? 'Q' : 'P';
        const sc = v.better === 'tie' ? 0 : v.better === repIs ? 1 : -1;
        const e = byItem.get(v.item) || { s: 0, n: 0, repDefect: 0, curDefect: 0 };
        e.s += sc; e.n++;
        e.repDefect += (repIs === 'P' ? v.P_defect : v.Q_defect) ? 1 : 0;
        e.curDefect += (repIs === 'P' ? v.Q_defect : v.P_defect) ? 1 : 0;
        byItem.set(v.item, e);
      }
      const summarise = (ids) => {
        const es = ids.map(id => byItem.get(id)).filter(Boolean);
        const w = es.filter(e => e.s > 0).length, l = es.filter(e => e.s < 0).length, t = es.length - w - l;
        const orderSplit = es.filter(e => e.n === 2 && e.s === 0).length;
        return { judged: es.length, win: w, loss: l, tie: t, p: w + l ? r4(binomTwoSided(w, w + l)) : null,
          repairedStillDefective: rate(es.filter(e => e.repDefect >= 1).length, es.length), currentDefective: rate(es.filter(e => e.curDefect >= 1).length, es.length), orderSplitOrTie: orderSplit };
      };
      if (arm === 'AA') {
        const pref = vs.filter(v => v.better !== 'tie');
        rep.repair.arms.AA = { verdicts: vs.length, nonTie: rate(pref.length, vs.length), P: pref.filter(v => v.better === 'P').length, Q: pref.filter(v => v.better === 'Q').length };
        continue;
      }
      const un = unchanged.filter(u => u.arm === arm);
      rep.repair.arms[arm] = {
        unchangedOnBad: { noRepair: un.filter(u => set.bad.includes(u.id) && u.why === 'no-repair').length, didNotApply: un.filter(u => set.bad.includes(u.id) && u.why === 'repair-did-not-apply').length },
        unchangedOnOk: un.filter(u => set.ok.includes(u.id)).length,
        onBad: summarise(set.bad), onOk: summarise(set.ok),
        onBadReal: summarise(set.bad.filter(id => ['random', 'flagged'].includes(key.get(id)?.stratum))),
        onPlants: summarise(set.bad.filter(id => key.get(id)?.stratum === 'plant')),
      };
      // The verify gate: D4 re-run on the repaired join; a corpus apply keeps a repair only when D4 now says "no".
      const ver = last(readJsonl(path.join(out, `verify-${arm}.jsonl`)));
      if (ver.size) {
        const pass = (id) => ver.get(id)?.defect === 'no';
        const gate = (ids) => { const k = ids.filter(id => byItem.has(id)); return { passed: summarise(k.filter(pass)), refused: summarise(k.filter(id => ver.has(id) && !pass(id))) }; };
        rep.repair.arms[arm].verifyGate = { onBadReal: gate(set.bad.filter(id => ['random', 'flagged'].includes(key.get(id)?.stratum))), onPlants: gate(set.bad.filter(id => key.get(id)?.stratum === 'plant')), onOk: gate(set.ok) };
      }
      if (arm !== 'opus') {
        const s = spend.filter(x => x.arm === arm);
        if (s.length) { const i = s.reduce((a, x) => a + x.in, 0) / s.length, o = s.reduce((a, x) => a + x.out, 0) / s.length; rep.repair.arms[arm].tokens = { calls: s.length, meanIn: Math.round(i), meanOut: Math.round(o), usd: r4(s.reduce((a, x) => a + x.usd, 0)), batchUsdPer100K: +(costOf(MODEL, i, o) * BATCH_MULTIPLIER * 1e5).toFixed(2) }; }
      }
    }
  }
  rep.spendUsd = r4(spend.reduce((a, x) => a + x.usd, 0));
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(rep, null, 1) + '\n');
  console.log(JSON.stringify(rep, null, 1));
}
main();
