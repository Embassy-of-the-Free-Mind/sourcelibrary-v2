#!/usr/bin/env node
// PRIOR ART: ./score.mjs — the corpus-audit scorer (controls gate, post-stratified estimates, CIs). It answers "what is
// the rate"; the speed-test-A gate also needs "does this window trip the pre-set ABORT rule", plus the candidates a
// human must hand-read before an invention/echo ABORT. This reads the same manifest + verdicts, applies the rule
// fixed below, and prints one JSON row for ~/sourcelibrary-ops/costs/speed-test-a-quality.jsonl.
//
//   node scripts/eval/translation-corpus-audit/gate-row.mjs --dir <window dir> --window <since>/<until> [--eligibility-abort 0]
//
// ABORT rule, fixed 2026-10-01 before the first window was drawn (ops handoff 2026-09-30-chained-quality-sample.md
// "Amended", made numeric here):
//   RATE    main pages with >= 1 MAJOR defect > 30% on n >= 20. 30% = production's served rate on the same
//           instrument (14.4% any major, 2026-09-30 corpus audit, arm-corrected) + 2 SE at n = 20 (7.9 pp each),
//           and below the 38% device-break rate the handoff names (a different, pairwise instrument).
//   CONTENT >= 2 pages whose invented content is whole sentences or whose output echoes the source. The judge's
//           major-invention / wrong_language flags are CANDIDATES, not verdicts: production's own major-invention
//           rate is ~4.8% of pages, so an unread "≥ 2" would fire on the baseline. The gate session hand-reads each
//           candidate and records the confirmed count (--confirmed-content N).
//   SCOPE   a run ENROLLED after its book was held, or any page on an English / priority >= 90 book
//           (draw-log.json eligibility; in-flight runs on books held mid-run are reported as WARN).
//   The controls gate (score.mjs) must pass, or the window is reported as NOT JUDGED, never OK.
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const DIR = args.dir;
if (!DIR) { console.error('--dir required'); process.exit(1); }
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const manifest = readJsonl(path.join(DIR, 'manifest.jsonl'));
const vdir = path.join(DIR, 'verdicts', 'opus');
const verdicts = {};
for (const f of fs.readdirSync(vdir).filter((f) => f.endsWith('.jsonl'))) for (const v of readJsonl(path.join(vdir, f))) verdicts[v.id] = v;
const log = JSON.parse(fs.readFileSync(path.join(DIR, 'draw-log.json'), 'utf8'));
const report = fs.existsSync(path.join(DIR, 'report.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'report.json'), 'utf8')) : null;

const main = manifest.filter((m) => m.kind === 'main' && verdicts[m.id]);
const isMajor = (v) => (v.defects || []).some((d) => d.severity === 'major');
const defective = main.filter((m) => isMajor(verdicts[m.id]));
const byClass = {};
for (const m of defective) for (const d of verdicts[m.id].defects.filter((d) => d.severity === 'major')) byClass[d.type] = (byClass[d.type] || 0) + 1;
const contentCandidates = main.filter((m) => {
  const v = verdicts[m.id];
  return (v.defects || []).some((d) => d.severity === 'major' && d.type === 'invention') || v.flags?.wrong_language;
}).map((m) => ({ id: m.id, url: m.url, language: m.language, stratum: m.stratum, fidelity: verdicts[m.id].fidelity, detail: verdicts[m.id].defects.filter((d) => d.severity === 'major').map((d) => `${d.type}: ${d.detail}`).join(' | ') }));
const strat = (s) => { const xs = main.filter((m) => m.stratum === s); return { n: xs.length, major: xs.filter((m) => isMajor(verdicts[m.id])).length }; };

const n = main.length, rate = n ? defective.length / n : null;
const scopeAbort = Number(args['eligibility-abort'] || 0);
const confirmedContent = args['confirmed-content'] != null ? Number(args['confirmed-content']) : null;
const controlsPass = report ? !!report.controls_gate?.pass : null;
const reasons = [];
if (n >= 20 && rate > 0.30) reasons.push(`major-defect rate ${(rate * 100).toFixed(1)}% > 30% (n=${n})`);
if (confirmedContent != null && confirmedContent >= 2) reasons.push(`${confirmedContent} hand-confirmed whole-sentence invention / echo pages`);
if (scopeAbort > 0) reasons.push(`${scopeAbort} scope violations (enrolled after hold / English / priority >= 90)`);
const verdict = controlsPass === false ? 'NOT_JUDGED' : reasons.length ? 'ABORT' : confirmedContent == null && contentCandidates.length >= 2 ? 'HAND_READ_PENDING' : 'OK';

const row = {
  at: new Date().toISOString(), window: args.window || null, dir: DIR, verdict, reasons,
  n, defective: defective.length, rate: rate == null ? null : Number(rate.toFixed(3)), by_class: byClass,
  seeded: strat('seeded'), seam: strat('seam'),
  controls: report?.controls_gate ? Object.fromEntries(Object.entries(report.controls_gate.checks).map(([k, c]) => [k, `${Math.round(c.rate * c.n)}/${c.n}`])) : null,
  content_candidates: contentCandidates.length, confirmed_content: confirmedContent,
  eligibility: (log.eligibility || []).map((e) => ({ book_id: e.book_id, why: e.why, pages: e.pages })),
  by_eye: [...main].sort((a, b) => verdicts[a.id].fidelity - verdicts[b.id].fidelity).slice(0, 5).map((m) => m.url),
};
console.log(JSON.stringify(row));
if (contentCandidates.length) console.error('content candidates to hand-read:\n' + contentCandidates.map((c) => `  ${c.url} [${c.language}, ${c.stratum}, fid ${c.fidelity}] ${c.detail.slice(0, 240)}`).join('\n'));
