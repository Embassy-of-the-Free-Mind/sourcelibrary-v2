#!/usr/bin/env node
// #5695 synthesis: one table across the five reference tracks, computed the same way
// for every language from each track's per-page rows. Reads only committed results;
// calls no model and writes nothing but this directory.
//
// PRIOR ART: scripts/eval/translation-vs-reference/score.mjs — scores ONE packet's
// verdicts; it does not read five tracks' finished rows, whose field names differ.
// The statistics are reused from scripts/eval/lib/{paired-stats,agreement-stats}.mjs.
//
// Definitions (the tracks' own tables differ slightly; these are uniform):
//   fidelity      mean of the two blind judges on the SERVED arm, 1–5
//   share >= 4    pages whose two-judge mean is >= 4, Wilson 95% interval
//   reversal      a page where EITHER judge quoted a reversed statement
//   omission      a page where EITHER judge flagged an omission
//   Flash − Lite  paired per-page difference on fresh single-page arms, bootstrap 95%
//
// Usage: node scripts/eval/results/xlref-synthesis-2026-10/build.mjs [--t4 <pages.jsonl>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapCI, mean, resetSeed } from '../../lib/paired-stats.mjs';
import { wilson } from '../../lib/agreement-stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(HERE, '..');
const argT4 = process.argv.indexOf('--t4');
const T4_PATH = argT4 > 0 ? process.argv[argT4 + 1] : path.join(RES, 'xlref-t4-2026-10/pages.jsonl');

const rows = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const either = (bj, key) => Object.values(bj || {}).some((j) => {
  const v = j?.[key];
  return Array.isArray(v) ? v.length > 0 : !!v;
});
const classesOf = (bj) => Object.values(bj || {}).flatMap((j) => (j?.defects || []).map((d) => `${d.class}:${d.severity}`));

// One adapter per track: → { id, lang, arm, fidelity, reversal, omission, classes, stratum }
const TRACKS = [
  {
    track: 'T1', file: path.join(RES, 'xlref-t1-2026-10/rows.jsonl'), lite: 'prod-A', flash: 'flash-0',
    row: (r) => ({
      id: `${r.book_id}_${r.page_number}`, lang: r.lang, arm: r.arm, fidelity: r.fidelity,
      reversal: !!r.reversal, omission: !!r.omission, classes: r.defect_classes || [], stratum: r.period,
      url: r.url, dims: r.dimensions,
    }),
  },
  {
    track: 'T2', file: path.join(RES, 'xlref-t2-2026-10/pages.jsonl'), lite: 'lite-a', flash: 'flash',
    row: (r) => {
      const core = r.arm === 'served' ? r.core_packet : null;
      return {
        id: r.id, lang: 'Greek', arm: r.arm,
        fidelity: core ? core.fidelity_mean : r.arms_packet?.fidelity,
        // The arms packet has one judge; paired arm deltas use it for every arm, served included.
        armFidelity: r.arms_packet?.fidelity,
        reversal: core ? either(core.by_judge, 'reversal') : !!r.arms_packet?.reversal,
        omission: core ? either(core.by_judge, 'omission') : !!r.arms_packet?.omission,
        classes: core ? classesOf(core.by_judge) : [], stratum: r.edition_stratum, url: r.page_url,
      };
    },
  },
  {
    track: 'T3', file: path.join(RES, 'xlref-t3-2026-10/pages.jsonl'), lite: 'L1', flash: 'F0',
    row: (r) => ({
      id: r.id, lang: r.lang, arm: r.arm, fidelity: r.fidelity, reversal: r.reversal > 0,
      omission: r.omission > 0, classes: r.defect_classes || [], stratum: r.period, url: r.url, dims: r.dimensions,
    }),
  },
  {
    track: 'T4', file: T4_PATH, lite: 'prod-A', flash: 'flash-0',
    keep: (r) => r.packet === 1 || r.arm === 'served',
    row: (r) => ({
      id: r.id, lang: r.lang, arm: r.arm, fidelity: r.fidelity, reversal: either(r.by_judge, 'reversal'),
      omission: either(r.by_judge, 'omission'), classes: classesOf(r.by_judge), stratum: r.period_bucket,
      url: r.url, cause: r.image_check?.primary_cause,
    }),
  },
  {
    track: 'T5', file: path.join(RES, 'xlref-t5-2026-10/pages.jsonl'), lite: 'lite', flash: 'flash',
    row: (r) => ({
      id: r.id, lang: r.lang, arm: r.arm, fidelity: r.fidelity, reversal: either(r.by_judge, 'reversal'),
      omission: either(r.by_judge, 'omission'), classes: classesOf(r.by_judge), stratum: r.edition?.period,
      url: r.page_url, dims: r.dimensions,
    }),
  },
];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const pct = (k, n) => (n ? Math.round((100 * k) / n) : null);
const wil = (k, n) => (n ? wilson(k, n).map((x) => Math.round(100 * x)) : null);

function summarise(served) {
  const f = served.map((r) => r.fidelity).filter((x) => typeof x === 'number');
  const n = f.length;
  const ge4 = f.filter((x) => x >= 4).length;
  const le3 = f.filter((x) => x <= 3).length;
  const rev = served.filter((r) => r.reversal).length;
  const om = served.filter((r) => r.omission).length;
  // Top defect: the class with a MAJOR defect on the most pages (either judge).
  const byClass = {};
  for (const r of served) {
    for (const c of new Set(r.classes.filter((c) => /:major$/.test(c)).map((c) => c.split(':')[0]))) {
      byClass[c] = (byClass[c] || 0) + 1;
    }
  }
  const top = Object.entries(byClass).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([c, k]) => ({ class: c, pages: k, pct: pct(k, n) }));
  return {
    n, mean: r2(mean(f)), mean_ci: n >= 2 ? bootstrapCI(f).map(r2) : null, median: median(f),
    ge4, ge4_pct: pct(ge4, n), ge4_ci: wil(ge4, n), le3_pct: pct(le3, n),
    reversal_pages: rev, reversals_per_100: pct(rev, n), reversals_ci: wil(rev, n),
    omission_pct: pct(om, n), top_major_defects: top,
  };
}

function flashMinusLite(all, t) {
  const fid = (r) => (t.track === 'T2' ? r.armFidelity : r.fidelity);
  const by = (arm) => new Map(all.filter((r) => r.arm === arm && typeof fid(r) === 'number').map((r) => [r.id, fid(r)]));
  const lite = by(t.lite);
  const flash = by(t.flash);
  const d = [...lite.keys()].filter((id) => flash.has(id)).map((id) => flash.get(id) - lite.get(id));
  if (d.length < 2) return { n: d.length };
  return { n: d.length, delta: r2(mean(d)), ci: bootstrapCI(d).map(r2), better: d.filter((x) => x > 0).length, worse: d.filter((x) => x < 0).length };
}

const DIMS = ['fidelity', 'readability', 'register', 'terminology', 'ambiguity', 'transparency'];
function profile(served) {
  const withDims = served.filter((r) => r.dims?.served && r.dims?.reference);
  if (!withDims.length) return null;
  const side = (k) => {
    const o = { n: withDims.length };
    for (const d of DIMS) {
      const xs = withDims.map((r) => r.dims[k][d]).filter((x) => typeof x === 'number');
      if (xs.length) o[d] = r2(mean(xs));
    }
    const st = {};
    for (const r of withDims) st[r.dims[k].stance] = (st[r.dims[k].stance] || 0) + 1;
    o.stance = st;
    return o;
  };
  return { ours: side('served'), reference: side('reference') };
}

resetSeed(5695);
const out = { generated: new Date().toISOString(), issue: 5695, measure: 'judged against a human reference (two blind Opus judges); not accuracy', definitions: 'see the header of build.mjs', languages: [], tracks: [] };
const servedRows = [];
const missing = [];

for (const t of TRACKS) {
  if (!fs.existsSync(t.file)) { missing.push(t.track); continue; }
  const all = rows(t.file).filter((r) => (t.keep ? t.keep(r) : true)).map(t.row);
  const served = all.filter((r) => r.arm === 'served' && typeof r.fidelity === 'number');
  out.tracks.push({ track: t.track, ...summarise(served), flash_minus_lite: flashMinusLite(all, t), profile: profile(served) });
  for (const lang of [...new Set(served.map((r) => r.lang))]) {
    const s = served.filter((r) => r.lang === lang);
    const a = all.filter((r) => r.lang === lang);
    out.languages.push({ track: t.track, lang, ...summarise(s), flash_minus_lite: flashMinusLite(a, t), profile: profile(s) });
  }
  for (const r of served) {
    servedRows.push({ track: t.track, lang: r.lang, id: r.id, url: r.url, stratum: r.stratum ?? null, fidelity: r.fidelity, reversal: r.reversal, omission: r.omission });
  }
}

// Pooled over every served page that has a reference (not a corpus mean: the tracks are
// not weighted by their share of translated pages).
out.pooled = summarise(servedRows.map((r) => ({ ...r, classes: [] })));
delete out.pooled.top_major_defects;
out.missing_tracks = missing;

fs.writeFileSync(path.join(HERE, 'summary.json'), JSON.stringify(out, null, 1) + '\n');
fs.writeFileSync(path.join(HERE, 'served-pages.jsonl'), servedRows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const fmt = (l) => [
  l.track, l.lang.padEnd(16), String(l.n).padStart(3), `mean ${l.mean} [${l.mean_ci?.join(', ')}]`, `med ${l.median}`,
  `>=4 ${l.ge4_pct}% [${l.ge4_ci?.join('–')}]`, `rev ${l.reversals_per_100} [${l.reversals_ci?.join('–')}]`, `om ${l.omission_pct}%`,
  `F−L ${l.flash_minus_lite.delta ?? '—'} [${l.flash_minus_lite.ci?.join(', ') ?? ''}] n=${l.flash_minus_lite.n}`,
  `top ${l.top_major_defects?.map((d) => `${d.class} ${d.pct}%`).join(', ')}`,
].join(' · ');
for (const l of out.tracks) console.log(fmt({ ...l, lang: 'ALL' }));
for (const l of out.languages) console.log(fmt(l));
console.log(`pooled n=${out.pooled.n} mean ${out.pooled.mean} [${out.pooled.mean_ci.join(', ')}] median ${out.pooled.median} >=4 ${out.pooled.ge4_pct}% rev ${out.pooled.reversals_per_100}/100 [${out.pooled.reversals_ci.join('–')}]`);
if (missing.length) console.log(`missing tracks: ${missing.join(', ')}`);
