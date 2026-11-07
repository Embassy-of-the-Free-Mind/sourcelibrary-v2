#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-paired-6740/analyze.mjs (pagesOf's HT weight, the MQM points, words7824): this is a
// POST HOC, exploratory figure (not preregistered), chosen after seeing that the PERO arms write ~57% of pages: serve
// arm A where it writes, else arm B, and report HT-weighted accept over every drawn page and severity per 1,000 words.
//   node scripts/eval/latin-paired-6740/cascade.mjs   (JOB_SCRATCH=/root/jobs/latin-paired-6740; repo root)
import fs from 'node:fs'; import path from 'node:path';
const OUT = process.env.JOB_SCRATCH + '/lp-6740';
const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const sel = JSON.parse(fs.readFileSync(OUT + '/selected.json')).selected, items = JSON.parse(fs.readFileSync(OUT + '/items.json'));
const V = new Map(jl(OUT + '/verdicts-opus.jsonl').filter((r) => r.set === 'abs' && r.verdict).map((r) => [r.id, r.verdict]));
const { words } = await import(process.cwd() + '/scripts/eval/route-judge-6740/defect-rate.mjs');
const SEV = { cosmetic: 1, misleads: 5, wrong_text: 25 };
const crypto = await import('node:crypto'); const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const get = (s, arm) => { const f = `${OUT}/texts/${s.key}.${arm}.txt`; if (!fs.existsSync(f)) return null; const t = fs.readFileSync(f, 'utf8').trim(); const it = items.find((i) => i.key === s.key && i.text_sha === sha(t).slice(0, 16)); return { v: V.get(it?.id), w: Math.max(1, words(t)) }; };
for (const [A, B] of [['pero4', 'read4'], ['live', 'read4'], ['pero4', null], ['read4', null]]) {
  let W = 0, acc = 0, pts = 0, wd = 0, wt = 0, ml = 0, served = 0;
  for (const s of sel) {
    const w = s.owed / Math.min(1, s.stratum_n * s.owed / s.stratum_pages); W += w;
    const x = get(s, A) ?? (B ? get(s, B) : null); if (!x?.v) continue; served++;
    if (x.v.accept) acc += w;
    const c = (k) => (x.v.defects || []).filter((d) => d.severity === k).length;
    pts += w * Object.entries(SEV).reduce((a, [k, m]) => a + m * c(k), 0); wd += w * x.w; wt += w * c('wrong_text'); ml += w * c('misleads');
  }
  console.log(`${A}${B ? '>' + B : ''}: served ${served}/40, accept_all_w ${(acc / W).toFixed(3)}, sev/1k ${(1000 * pts / wd).toFixed(1)}, wt/1k ${(1000 * wt / wd).toFixed(2)}, misleads/1k ${(1000 * ml / wd).toFixed(2)}`);
}
