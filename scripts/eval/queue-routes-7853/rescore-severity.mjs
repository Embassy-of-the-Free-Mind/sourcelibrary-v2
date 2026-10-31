#!/usr/bin/env node
// PRIOR ART: scripts/eval/correction-pass-7818/analyze.mjs (its Amendment 1 `severityScore`: severity from the judge's
// own tags, reported apart) and scripts/eval/fraktur-paired-7835/analyze.mjs (pagesOf: a page's arms by text hash);
// this re-reads their STORED verdicts with #7853 Amendment 1's weights (cosmetic 1, misleads 5, wrong_text 25) and
// pairs them per page. No judge call.
/**
 * #7853 Amendment 1, part 2 (Derek 2026-10-31): the #7818 and #7835 T1/T2 verdicts re-scored as severity-weighted
 * defects, paired per page, with the same statistics as analyze.mjs's co-primary. Writes results/rescore-severity-<study>.json.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/queue-routes-7853/rescore-severity.mjs --study=7818
 *   node scripts/eval/queue-routes-7853/rescore-severity.mjs --study=7835 --dir=<#7835 OUT, e.g. /root/jobs/fraktur-7835/fraktur-7835>
 *
 * #7818's arm-P texts are not committed (only verdicts), so its per-1,000-word rate scales each page's severity points
 * by one length for both arms of the page: the page's current stored text (Arm P) or the Wikisource draft's characters
 * / 6.5 (Arm W). The paired difference in points is exact; the rate is that difference on a common page length.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT, RESULTS, arg, jsonl, sha, words7824, makeRng, SEV, wilcoxon } from './lib.mjs';
import { binomTwoSided } from '../lib/paired-stats.mjs';

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(3));
const cnt = (v, s) => (v?.defects || []).filter((d) => d.severity === s).length;
const points = (v) => Object.entries(SEV).reduce((a, [k, w]) => a + w * cnt(v, k), 0);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function boot(d, seed) { if (!d.length) return null; const rnd = makeRng(seed), o = []; for (let b = 0; b < 4000; b++) { let s = 0; for (let i = 0; i < d.length; i++) s += d[Math.floor(rnd() * d.length)]; o.push(s / d.length); } o.sort((a, b) => a - b); return [r3(o[100]), r3(o[3899])]; }
/** b against a over pages [{a: {v, words}, b: {v, words}}]: severity per 1,000 words and accept, paired. */
function contrast(pages, seed) {
  const g = pages.filter((p) => p.a?.v && p.b?.v);
  const d = g.map((p) => 1000 * points(p.b.v) / p.b.words - 1000 * points(p.a.v) / p.a.words);
  const gained = g.filter((p) => !p.a.v.accept && p.b.v.accept).length, lost = g.filter((p) => p.a.v.accept && !p.b.v.accept).length;
  return { n: g.length, severity_per_1000: { a: r3(mean(g.map((p) => 1000 * points(p.a.v) / p.a.words))), b: r3(mean(g.map((p) => 1000 * points(p.b.v) / p.b.words))), mean_diff: r3(mean(d)), ci95: boot(d, seed), wilcoxon: wilcoxon(d), better: d.filter((x) => x < 0).length, worse: d.filter((x) => x > 0).length },
    accept: { a: `${g.filter((p) => p.a.v.accept).length}/${g.length}`, b: `${g.filter((p) => p.b.v.accept).length}/${g.length}`, gained, lost, mcnemar_exact_p: +binomTwoSided(gained, gained + lost).toPrecision(3) },
    binary_missed: null };
}
const note = (c) => ({ ...c, binary_missed: c.accept.mcnemar_exact_p >= 0.05 && c.severity_per_1000.wilcoxon.p < 0.05 ? 'yes: severity differs at p < 0.05 where accept does not' : c.accept.mcnemar_exact_p < 0.05 && c.severity_per_1000.wilcoxon.p >= 0.05 ? 'the reverse: accept differs, severity does not' : 'no: both agree on significance' });

async function s7818() {
  const D = path.join(ROOT, 'scripts/eval/correction-pass-7818/results/release');
  const items = JSON.parse(fs.readFileSync(path.join(D, 'items.json'), 'utf8'));
  const vo = zlib.gunzipSync(fs.readFileSync(path.join(D, 'verdicts-opus.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const v = new Map(); for (const r of vo.filter((x) => x.set === 'abs' && x.verdict && (x.rep ?? 1) === 1)) if (!v.has(r.id)) v.set(r.id, r.verdict);
  // page lengths: Arm P from the page's current stored text, Arm W from the Wikisource draft's characters
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pids = [...new Set(items.filter((i) => i.arm === 'P').map((i) => i.page))];
  const len = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: pids } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, Math.max(1, words7824(p.ocr?.data || ''))]));
  await c.close();
  for (const r of jsonl(path.join(D, 'ws-drafts.jsonl'))) len.set(r.slug, Math.max(1, Math.round(Number(r.text_chars) / 6.5)));
  const out = { study: '#7818', source: 'correction-pass-7818/results/release (verdicts-opus rep 1)', weights: SEV, contrasts: {} };
  let seed = 7853;
  for (const arm of ['P', 'W']) for (const lang of ['de', 'fr']) {
    const by = new Map();
    for (const it of items.filter((i) => i.arm === arm && i.lang === lang)) {
      const p = by.get(it.page) ?? {}; const x = { v: v.get(it.id) ?? null, words: len.get(it.page) ?? 300 };
      if (it.role === 'same') { p.a = x; p.b = x; } else if (it.role === 'draft') p.a = x; else if (it.role === 'served') p.b = x;
      by.set(it.page, p);
    }
    out.contrasts[`${arm}/${lang}: served (correction ON) vs draft (OFF)`] = note(contrast([...by.values()], seed++));
  }
  return out;
}

function s7835() {
  const dir = arg('dir'); if (!dir || !fs.existsSync(path.join(dir, 'items.json'))) { console.error('--dir=<#7835 OUT> with items.json, verdicts-opus.jsonl, texts/'); process.exit(2); }
  const items = JSON.parse(fs.readFileSync(path.join(dir, 'items.json'), 'utf8'));
  const v = new Map(jsonl(path.join(dir, 'verdicts-opus.jsonl')).filter((r) => r.set === 'abs' && r.verdict).map((r) => [r.id, r.verdict]));
  const textOf = (key, arm) => { const f = path.join(dir, 'texts', `${key}.${arm}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null; };
  const out = { study: '#7835 T1/T2', source: dir, weights: SEV, contrasts: {} };
  const C = { t1: [['a', 'b'], ['a', 'c'], ['c', 'b']], t2: [['c', 'b'], ['a', 'b'], ['a', 'c']] };
  let seed = 7860;
  for (const set of ['t1', 't2']) {
    const S = JSON.parse(fs.readFileSync(path.join(dir, set, 'selected.json'), 'utf8')).selected;
    const ps = S.map((s) => { const arms = {}; for (const arm of ['a', 'b', 'c']) { const t = textOf(s.key, arm); if (!t) continue; const it = items.find((i) => i.key === s.key && i.text_sha === sha(t).slice(0, 16)); arms[arm] = { v: it ? v.get(it.id) ?? null : null, words: Math.max(1, words7824(t)) }; } return { face: s.face, arms }; });
    for (const face of ['fraktur', 'antiqua']) { const g = ps.filter((p) => p.face === face); if (!g.length) continue;
      for (const [a, b] of C[set]) out.contrasts[`${set} ${face}: ${b} vs ${a}`] = note(contrast(g.map((p) => ({ a: p.arms[a], b: p.arms[b] })), seed++)); }
  }
  return out;
}

const study = arg('study');
const res = study === '7818' ? await s7818() : study === '7835' ? s7835() : (console.error('--study=7818|7835'), process.exit(2));
fs.mkdirSync(RESULTS, { recursive: true });
fs.writeFileSync(path.join(RESULTS, `rescore-severity-${study}.json`), JSON.stringify({ generated_at: new Date().toISOString(), ...res }, null, 1) + '\n');
for (const [k, c] of Object.entries(res.contrasts)) console.log(`${k}: n ${c.n}; severity ${c.severity_per_1000.a} -> ${c.severity_per_1000.b} (diff ${c.severity_per_1000.mean_diff} ${JSON.stringify(c.severity_per_1000.ci95)}, wilcoxon p ${c.severity_per_1000.wilcoxon.p}); accept ${c.accept.a} -> ${c.accept.b} (${c.accept.gained}/${c.accept.lost}, p ${c.accept.mcnemar_exact_p}); binary missed: ${c.binary_missed}`);
