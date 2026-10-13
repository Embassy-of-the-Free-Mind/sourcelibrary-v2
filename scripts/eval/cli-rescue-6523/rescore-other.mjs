#!/usr/bin/env node
// PRIOR ART: scripts/eval/syriac-pareto-6295/score-ocr.mjs and scripts/eval/ocr-prereg-6388/score.mjs are the
// instruments; this only runs each one, unchanged, over a shadow copy with the rescued reads added (Syriac) or
// swapped in (6388 arm G), after a control run that must reproduce the committed numbers.
/**
 * Step 4 (OCR, the non-Pareto arms) of the #6523 rescue.
 *
 *   node scripts/eval/cli-rescue-6523/rescore-other.mjs
 *
 * Syriac (#6295): shadow work dir = the job folder's files symlinked, arms/ = the stored arms plus `<arm>-r6523`
 *   (rescued text where rescue.mjs/cut-pass.mjs produced one), scored with score-ocr.mjs --fixed-refs into a copy of
 *   the committed ocr-score.json. Control: every stored arm's CER equals the committed one.
 * 6388 arm G: the module folder copied to scratch (its ../lib imports symlinked), reads/G.jsonl.gz replaced by the
 *   rescued reads, score.mjs run there. Control: the unchanged copy reproduces the committed results.json (minus its
 *   timestamp). G's own score uses a leave-one-out key (S, O), so G's rescue cannot move its own key.
 * Writes scripts/eval/results/cli-rescue-6523/other-rescored.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { readJsonl } from './rescue.mjs';

const SCR = path.join(process.env.JOB_SCRATCH || '/tmp', 'cli-rescue-6523');
const OUT = 'scripts/eval/results/cli-rescue-6523/other-rescored.json';
const REPO = process.cwd();

function rescuedFor(prefix) {
  const m = new Map();
  for (const f of fs.readdirSync(SCR).filter((f) => f.startsWith(prefix.replace(/[:/]/g, '__')) && f.endsWith('.jsonl') && !f.includes('.cli.') && !f.includes('.requests.'))) {
    const arm = f.slice(prefix.length + 2, -6);
    for (const r of readJsonl(path.join(SCR, f))) if (r.method === 'deterministic') m.set(`${arm}|${r.key}`, { text: r.text, method: 'deterministic' });
  }
  for (const r of readJsonl(path.join(SCR, 'cut-residual.jsonl'))) {
    if (!r.arm.startsWith(`${prefix}:`) || !r.accepted) continue;
    m.set(`${r.arm.slice(prefix.length + 1)}|${r.key}`, { text: r.text, method: 'cli-restructure' });
  }
  return m;
}
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);
const result = { issue: 6523, generated_by: 'scripts/eval/cli-rescue-6523/rescore-other.mjs' };

// ── Syriac (#6295) ────────────────────────────────────────────────────────────────────────────────────────────
{
  const W = '/mnt/HC_Volume_105839809/jobs/syriac-pareto-6295', SH = path.join(SCR, 'syriac-shadow');
  fs.rmSync(SH, { recursive: true, force: true });
  fs.mkdirSync(path.join(SH, 'arms'), { recursive: true });
  for (const f of fs.readdirSync(W)) if (f !== 'arms') fs.symlinkSync(path.join(W, f), path.join(SH, f));
  const resc = rescuedFor('syriac-6295');
  const added = [];
  for (const f of fs.readdirSync(path.join(W, 'arms'))) {
    fs.symlinkSync(path.join(W, 'arms', f), path.join(SH, 'arms', f));
    const arm = f.replace(/\.jsonl$/, '');
    if (!/^C3\d-ocr/.test(arm)) continue;
    const rows = readJsonl(path.join(W, 'arms', f)).map((r) => { const x = resc.get(`${arm}|${r.uid}`); return x ? { ...r, text: x.text, rescue: x.method } : r; });
    fs.writeFileSync(path.join(SH, 'arms', `${arm}-r6523.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    added.push(arm);
  }
  const committed = 'scripts/eval/results/syriac-pareto-6295/ocr-score.json';
  const out = path.join(SCR, 'syriac-ocr-score.json');
  fs.copyFileSync(committed, out);
  execFileSync('node', ['scripts/eval/syriac-pareto-6295/score-ocr.mjs', '--work', SH, '--fixed-refs', '--out', out], { stdio: ['ignore', 'ignore', 'inherit'] });
  const before = new Map(JSON.parse(fs.readFileSync(committed, 'utf8')).pages.map((p) => [p.slug, p]));
  const after = JSON.parse(fs.readFileSync(out, 'utf8')).pages;
  const control = { checked: 0, reproduced: 0, mismatches: [] }, arms = {}, rows = [];
  for (const p of after) {
    if (!p.scores) continue;
    for (const arm of added) {
      const a = p.scores[arm], b = p.scores[`${arm}-r6523`], c = before.get(p.slug)?.scores?.[arm];
      if (!a || !b) continue;
      control.checked++;
      if (c && c.cer === a.cer) control.reproduced++; else control.mismatches.push(`${p.slug}|${arm}: ${c?.cer} vs ${a.cer}`);
      const t = (arms[arm] ||= { pages: 0, cer_capped_stored: 0, cer_capped_rescued: 0, over_half_stored: 0, over_half_rescued: 0, changed: 0 });
      t.pages++; t.cer_capped_stored += a.cer_capped; t.cer_capped_rescued += b.cer_capped;
      t.over_half_stored += a.cer_capped > 0.5; t.over_half_rescued += b.cer_capped > 0.5;
      const x = resc.get(`${arm}|${p.slug}`);
      if (x) { t.changed++; rows.push({ arm, page: p.slug, method: x.method, cer_capped_stored: a.cer_capped, cer_capped_rescued: b.cer_capped }); }
    }
  }
  for (const t of Object.values(arms)) { t.cer_capped_stored = r4(t.cer_capped_stored / t.pages); t.cer_capped_rescued = r4(t.cer_capped_rescued / t.pages); }
  result.syriac_6295 = { scorer: 'scripts/eval/syriac-pareto-6295/score-ocr.mjs --fixed-refs (unchanged)', control, arms, rows };
  console.log(`syriac control: ${control.reproduced}/${control.checked}`);
  for (const [a, t] of Object.entries(arms)) console.log(`  ${a}: ${t.pages} pages, ${t.changed} changed, mean capped CER ${t.cer_capped_stored} → ${t.cer_capped_rescued}, >50% ${t.over_half_stored} → ${t.over_half_rescued}`);
}

// ── 6388 arm G ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const SRC = 'scripts/eval/ocr-prereg-6388';
  const run = (name, swapG) => {
    const root = path.join(SCR, name), mod = path.join(root, 'scripts', 'eval', 'ocr-prereg-6388');
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(mod), { recursive: true });
    fs.cpSync(SRC, mod, { recursive: true });
    fs.symlinkSync(path.join(REPO, 'scripts', 'eval', 'lib'), path.join(root, 'scripts', 'eval', 'lib'));
    fs.symlinkSync(path.join(REPO, 'scripts', 'lib'), path.join(root, 'scripts', 'lib'));
    if (swapG) {
      const rows = readJsonl(path.join(SRC, 'reads', 'G.jsonl.gz')).map((r) => { const x = swapG.get(`G|${r.uid}`); return x ? { ...r, text: x.text, rescue: x.method } : r; });
      fs.writeFileSync(path.join(mod, 'reads', 'G.jsonl.gz'), zlib.gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'));
    }
    execFileSync('node', [path.join(mod, 'score.mjs')], { stdio: ['ignore', 'ignore', 'inherit'], cwd: root });
    return JSON.parse(fs.readFileSync(path.join(mod, 'results.json'), 'utf8'));
  };
  const strip = (r) => JSON.stringify({ ...r, generated_at: null });
  const committed = JSON.parse(fs.readFileSync(path.join(SRC, 'results.json'), 'utf8'));
  const ctl = run('prereg-shadow-control', null);
  const control = strip(ctl) === strip(committed);
  const resc = rescuedFor('ocr-prereg-6388');
  const res = run('prereg-shadow-rescued', resc);
  const strata = {};
  for (const [st, s] of Object.entries(res.strata)) {
    const old = committed.strata[st];
    const cmp = (x) => x.comparisons.filter((c) => c.engine === 'G').map((c) => ({ baseline: c.baseline, mean_cer_G: r4(c.mean_cer_engine), mean_d: r4(c.mean_d), verdict: c.verdict }));
    const changed = [...resc.keys()].filter((k) => k.startsWith(`G|${st}|`)).length;
    strata[st] = { changed, stored: cmp(old), rescued: cmp(s) };
  }
  result.ocr_prereg_6388_G = { scorer: 'scripts/eval/ocr-prereg-6388/score.mjs (unchanged)', control_reproduces_committed: control, strata };
  console.log(`6388 control reproduces committed results.json: ${control}`);
  for (const [st, s] of Object.entries(strata)) console.log(`  ${st}: ${s.changed} G reads changed; G vs baselines stored ${JSON.stringify(s.stored)} → rescued ${JSON.stringify(s.rescued)}`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
console.log(`wrote ${OUT}`);
