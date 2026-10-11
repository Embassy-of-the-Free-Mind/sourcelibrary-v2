#!/usr/bin/env node
// PRIOR ART: scripts/eval/second-reader/second-reader.mjs score (issue clustering, seeded recall, frame weights) and
// scripts/eval/spot-check/review-agreement.py (kappa between two runs of ONE version). This check has two versions per
// page and asks per-version rates and the preference between them, so it is a small scorer over draw.mjs's key; it
// reuses lib.mjs's wilson().
//
// #6361 convergent check: unblind (private/key.json), then per reader and per version (new = the English now stored or
// about to be, old = the English before the run): pages with ≥1 serious translation error, pages with a reversal
// (serious error flagged reversal), the preference (new / old / same), with Wilson 95% intervals; agreement between the
// readers (raw and Cohen's kappa); every page where both prefer OLD; the pages whose preference differs (to adjudicate).
// With reviews/adjudicate/<slot>.json present, the final preference on a split page is the adjudicator's.
// STOP rule (brief, 2026-10-10): both readers prefer the old English on more than 10% of sampled pages.
//
//   node scripts/maintenance/tengyur-cli-6361/convergent/score.mjs --dir=$JOB_SCRATCH/convergent [--set=stage1|reread|all]
import fs from 'node:fs';
import path from 'node:path';
import { wilson } from '../../../eval/second-reader/lib.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const DIR = arg('dir');
const SET = arg('set', 'all');
if (!DIR) throw new Error('--dir is required');
const key = JSON.parse(fs.readFileSync(path.join(DIR, 'private', 'key.json'), 'utf8'));
const READERS = ['opus', 'gemini'];
const load = (r, s) => { const f = path.join(DIR, 'reviews', r, `${s}.json`); if (!fs.existsSync(f)) return null; const a = JSON.parse(fs.readFileSync(f, 'utf8')); return (Array.isArray(a) ? a[0] : a)?.pages?.[0] ?? null; };
const serious = (errs) => (errs || []).filter((e) => e.severity === 'serious');
const unblind = (k, p) => {
  if (!p) return null;
  const v = (x) => ({ score: p[`tr_score_${x}`] ?? null, serious: serious(p[`tr_errors_${x}`]).length, reversal: serious(p[`tr_errors_${x}`]).filter((e) => e.reversal === true).length });
  const other = k.new_is === 'A' ? 'B' : 'A';
  const pref = p.prefer === k.new_is ? 'new' : p.prefer === other ? 'old' : p.prefer === 'same' ? 'same' : null;
  return { new: v(k.new_is), old: v(other), prefer: pref, prefer_reason: p.prefer_reason ?? null, ocr_score: p.ocr_score ?? null, right_page: p.right_page ?? null, confidence: p.confidence ?? null };
};
const slots = Object.keys(key).sort().filter((s) => SET === 'all' || key[s].set === SET);
const rows = slots.map((s) => {
  const k = key[s];
  const r = Object.fromEntries(READERS.map((x) => [x, unblind(k, load(x, s))]));
  const adjRaw = load('adjudicate', s);
  const adj = adjRaw ? unblind(k, adjRaw) : null;
  const both = r.opus && r.gemini;
  const split = both && r.opus.prefer !== r.gemini.prefer;
  return { slot: s, vol: k.vol, section: k.section, page_number: k.page_number, page_id: k.page_id, set: k.set, nudged: k.nudged, ...r, split, adjudicated: adj, final_prefer: !both ? null : split ? adj?.prefer ?? null : r.opus.prefer };
});
const rate = (k, n) => ({ k, n, rate: n ? Math.round((1000 * k) / n) / 1000 : null, ci95: wilson(k, n)?.map((x) => Math.round(x * 1000) / 1000) ?? null });
const per = {};
for (const x of READERS) {
  const rs = rows.filter((r) => r[x]);
  per[x] = { n: rs.length };
  for (const v of ['new', 'old']) {
    per[x][v] = { serious_pages: rate(rs.filter((r) => r[x][v].serious > 0).length, rs.length), reversal_pages: rate(rs.filter((r) => r[x][v].reversal > 0).length, rs.length), serious_errors: rs.reduce((a, r) => a + r[x][v].serious, 0), reversals: rs.reduce((a, r) => a + r[x][v].reversal, 0), mean_score: rs.length ? Math.round((100 * rs.reduce((a, r) => a + (r[x][v].score || 0), 0)) / rs.length) / 100 : null };
  }
  per[x].prefer = Object.fromEntries(['new', 'old', 'same'].map((p) => [p, rate(rs.filter((r) => r[x].prefer === p).length, rs.length)]));
}
function kappa(pairs, cats) {
  const n = pairs.length; if (!n) return null;
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return { n, observed: Math.round(po * 1000) / 1000, kappa: pe === 1 ? null : Math.round(((po - pe) / (1 - pe)) * 1000) / 1000 };
}
const both = rows.filter((r) => r.opus && r.gemini);
const agreement = {
  prefer: kappa(both.map((r) => [r.opus.prefer, r.gemini.prefer]), ['new', 'old', 'same']),
  serious_new: kappa(both.map((r) => [r.opus.new.serious > 0, r.gemini.new.serious > 0]), [true, false]),
  serious_old: kappa(both.map((r) => [r.opus.old.serious > 0, r.gemini.old.serious > 0]), [true, false]),
};
const bothOld = both.filter((r) => r.opus.prefer === 'old' && r.gemini.prefer === 'old');
const finalPref = Object.fromEntries(['new', 'old', 'same'].map((p) => [p, rate(both.filter((r) => r.final_prefer === p).length, both.length)]));
const report = {
  at: new Date().toISOString(), set: SET, pages: rows.length, read_by_both: both.length, readers: { opus: 'Claude Opus (subscription subagent)', gemini: 'gemini-3.7-flash-high via agy -p (plan mode)' },
  per_reader: per, agreement, final_prefer: finalPref, unresolved_splits: both.filter((r) => r.split && !r.adjudicated).map((r) => r.slot),
  both_prefer_old: { ...rate(bothOld.length, both.length), pages: bothOld.map((r) => ({ slot: r.slot, vol: r.vol, page_number: r.page_number, page_id: r.page_id, set: r.set, opus: r.opus.prefer_reason, gemini: r.gemini.prefer_reason })) },
  stop_rule: { threshold: 0.1, fired: both.length ? bothOld.length / both.length > 0.1 : null },
  rows,
};
fs.writeFileSync(path.join(DIR, `score-${SET}.json`), JSON.stringify(report, null, 1));
const pc = (o) => `${o.k}/${o.n} (${Math.round(100 * o.rate)}%, CI ${Math.round(100 * o.ci95[0])}–${Math.round(100 * o.ci95[1])}%)`;
for (const x of READERS) console.log(`${x}: n=${per[x].n} | serious pages new ${pc(per[x].new.serious_pages)} old ${pc(per[x].old.serious_pages)} | reversal pages new ${pc(per[x].new.reversal_pages)} old ${pc(per[x].old.reversal_pages)} | prefer new ${per[x].prefer.new.k} old ${per[x].prefer.old.k} same ${per[x].prefer.same.k} | mean score new ${per[x].new.mean_score} old ${per[x].old.mean_score}`);
console.log('agreement', JSON.stringify(agreement));
console.log('final prefer', JSON.stringify(Object.fromEntries(Object.entries(finalPref).map(([k, v]) => [k, v.k]))), 'unresolved splits', report.unresolved_splits.join(','));
console.log(`both prefer old: ${bothOld.length}/${both.length} ${bothOld.map((r) => `${r.slot}(vol ${r.vol} p${r.page_number})`).join(' ')}; STOP ${report.stop_rule.fired}`);
