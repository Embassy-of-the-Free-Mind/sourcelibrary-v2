#!/usr/bin/env node
// PRIOR ART: scripts/eval/opus-tib-sa-6948/audit.mjs `score` (per-arm verdict rates with Wilson intervals, OCR spans per
// page, controls caught) — its rows are the input here, unchanged. It scores ONE audit; this pairs the #6948 audit
// (arm 1, SEAM) with this job's (arms 2 CUT and 3 REREAD) frame by frame, applies the pre-registered bar, splits bad
// pages into OCR-caused and translator-caused with both attribution passes, and writes the triage labels.
/**
 * compare.mjs — $0, no model. Job split-leaves-5771 (#5771).
 *   node scripts/eval/split-leaf-5771/compare.mjs --frames=frames.jsonl --before=<6948>/audit/score-rows.jsonl \
 *        --before-attr=<6948>/audit/attr.json --after=audit/score-rows.jsonl --after-attr=audit/attr.json \
 *        --out=compare.json --labels=labels.json
 * Strata (pre-registered): SEAM = the stored read is a whole-page read; RECUT = a leaf read whose crop this job
 * changed (a wrong ledger cut, or a frame the detector could not cut); SAME = the rest. "40+" spans count as 40.
 * A frame's spans per leaf = its spans ÷ its leaf crops. Bad pages are attributed with the #6948 text-only pass:
 * OCR-caused when every flagged item renders the transcription faithfully, translator-caused when any item departs
 * from it ("translation" or "both"), unattributed when the pass gave no usable answer.
 */
import fs from 'node:fs';
import { wilson } from '../opus-tib-sa-6948/audit.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const jl = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const frames = new Map(jl(arg('frames')).map((f) => [f.uid, f]));
const stratum = (f) => (f.stored.read_mode === 'page' ? 'SEAM' : f.ledger_cut || /^by-eye \(leafsplit/.test(f.cut_source) ? 'RECUT' : 'SAME');
const leavesOf = (f) => (f.spans ? f.spans.length : 1);

const before = jl(arg('before')).filter((r) => r.lang === 'bo' && !r.control && frames.has(r.uid)).map((r) => ({ ...r, frame: r.uid, arm: 'seam' }));
const afterAll = jl(arg('after'));
const after = afterAll.filter((r) => !r.control && r.frame && r.parsed);   // an unanswered or unparsed reply is not a verdict
const controls = afterAll.filter((r) => r.control);
const attr = { seam: JSON.parse(fs.readFileSync(arg('before-attr'), 'utf8')), after: JSON.parse(fs.readFileSync(arg('after-attr'), 'utf8')) };
const rows = [...before, ...after].map((r) => {
  const f = frames.get(r.frame), a = (r.arm === 'seam' ? attr.seam : attr.after)[r.uid];
  const causes = (a?.items || []).map((x) => x.cause);
  const cause = r.verdict !== 'bad' ? null : !a ? 'unattributed' : !a.items?.length ? (a.flagged?.length ? 'unattributed' : 'no-item') : causes.some((c) => c === 'translation' || c === 'both') ? 'translator' : causes.every((c) => c === 'transcription') ? 'ocr' : 'unattributed';
  const spans = r.ocr_legible === false || r.ocr_spans == null ? null : Math.min(40, r.ocr_spans);
  return { frame: r.frame, arm: r.arm, stratum: stratum(f), canon: f.stratum, book: f.book_id, verdict: r.verdict, bad: r.verdict === 'bad', cause, spans, spans_per_leaf: spans == null ? null : spans / leavesOf(f), invention: r.invention, reversal: r.reversal, wrong_leaf: r.wrong_leaf, omission: r.omission };
});
fs.writeFileSync(arg('out').replace(/\.json$/, '-rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const rate = (xs, p) => { const k = xs.filter(p).length; const [lo, hi] = wilson(k, xs.length); return { k, n: xs.length, rate: xs.length ? +(k / xs.length).toFixed(3) : null, ci95: [lo == null ? null : +lo.toFixed(3), hi == null ? null : +hi.toFixed(3)] }; };
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const mean = (xs) => { const s = xs.filter((x) => x != null); return s.length ? +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2) : null; };
const summ = (xs) => ({
  n: xs.length, bad: rate(xs, (r) => r.bad), caveat: rate(xs, (r) => r.verdict === 'usable-with-caveat'), usable: rate(xs, (r) => r.verdict === 'usable'),
  bad_ocr_caused: rate(xs, (r) => r.cause === 'ocr'), bad_translator_caused: rate(xs, (r) => r.cause === 'translator'), bad_unattributed: xs.filter((r) => r.bad && !['ocr', 'translator'].includes(r.cause)).length,
  with_invention: rate(xs, (r) => r.invention > 0), with_reversal: rate(xs, (r) => r.reversal > 0), with_wrong_leaf: rate(xs, (r) => r.wrong_leaf > 0), with_omission: rate(xs, (r) => r.omission > 0),
  ocr: { legible: xs.filter((r) => r.spans != null).length, spans_per_frame_median: med(xs.map((r) => r.spans)), spans_per_frame_mean: mean(xs.map((r) => r.spans)), spans_per_leaf_median: med(xs.map((r) => r.spans_per_leaf)), spans_per_leaf_mean: mean(xs.map((r) => r.spans_per_leaf)), frames_with_0: xs.filter((r) => r.spans === 0).length, frames_at_40: xs.filter((r) => r.spans === 40).length },
});
const ARMS = ['seam', 'cut', 'reread'], STRATA = ['SEAM', 'RECUT', 'SAME'];
const by = Object.fromEntries(ARMS.map((a) => [a, { all: summ(rows.filter((r) => r.arm === a)), ...Object.fromEntries(STRATA.map((s) => [s, summ(rows.filter((r) => r.arm === a && r.stratum === s))])), CANON: summ(rows.filter((r) => r.arm === a && r.canon === 'CANON')), OTHER: summ(rows.filter((r) => r.arm === a && r.canon === 'OTHER')) }]));

// Paired OCR: arm X vs arm 1 on frames legible in both. Ratio after/before (0/0 = 1; x/0 with x > 0 counts as worse).
// Bootstrap over frames (2,000 resamples, seeded) for the median ratio's interval.
function paired(arm, strat) {
  const b = new Map(rows.filter((r) => r.arm === 'seam').map((r) => [r.frame, r]));
  const ps = rows.filter((r) => r.arm === arm && (!strat || r.stratum === strat)).map((r) => [b.get(r.frame), r]).filter(([x, y]) => x && x.spans != null && y.spans != null);
  const ratio = ps.map(([x, y]) => (x.spans === 0 ? (y.spans === 0 ? 1 : 2) : y.spans / x.spans));
  let s = 5771; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const boots = []; for (let i = 0; i < 2000; i++) { const xs = ratio.map(() => ratio[Math.floor(rnd() * ratio.length)]); boots.push(med(xs)); }
  boots.sort((a, b) => a - b);
  return { n: ps.length, median_ratio: med(ratio) == null ? null : +med(ratio).toFixed(3), ci95: ratio.length ? [+boots[50].toFixed(3), +boots[1949].toFixed(3)] : null, before_median: med(ps.map(([x]) => x.spans)), after_median: med(ps.map(([, y]) => y.spans)), fewer: ps.filter(([x, y]) => y.spans < x.spans).length, same: ps.filter(([x, y]) => y.spans === x.spans).length, more: ps.filter(([x, y]) => y.spans > x.spans).length };
}
const pairedOcr = Object.fromEntries(['cut', 'reread'].map((a) => [a, { all: paired(a), ...Object.fromEntries(STRATA.map((s) => [s, paired(a, s)])) }]));

// Pairs of verdicts, arm 1 → arm 3, per frame.
const trans = {}; for (const r of rows.filter((x) => x.arm === 'reread')) { const b = rows.find((x) => x.arm === 'seam' && x.frame === r.frame); if (b) { const k = `${b.verdict}→${r.verdict}`; trans[k] = (trans[k] || 0) + 1; } }

// Triage labels (pre-registered). L1: legible in arms 1 and 3 and arm1 − arm3 ≥ max(5, arm1/2). L2: arm 1 bad from the OCR.
const L1 = {}, L2 = {};
for (const r of rows.filter((x) => x.arm === 'seam')) {
  const y = rows.find((x) => x.arm === 'reread' && x.frame === r.frame);
  if (r.spans != null && y?.spans != null) L1[r.frame] = r.spans - y.spans >= Math.max(5, r.spans / 2) ? 1 : 0;
  const a = attr.seam[r.frame];
  L2[r.frame] = r.bad && (a?.items || []).some((x) => x.cause === 'transcription' || x.cause === 'both') ? 1 : 0;
}
fs.writeFileSync(arg('labels'), JSON.stringify({ L1_reread_helps: L1, L2_seam_bad_from_ocr: L2 }, null, 1));

const out = {
  arms: by, paired_ocr: pairedOcr, verdict_transitions_seam_to_reread: trans,
  bar: { ocr_primary_seam: pairedOcr.reread.SEAM, ocr_pass: pairedOcr.reread.SEAM.median_ratio != null && pairedOcr.reread.SEAM.median_ratio <= 0.5 },
  controls: { n: controls.length, caught: controls.filter((r) => r.caught).length, by_kind: Object.fromEntries(['reversal', 'invention'].map((k) => [k, `${controls.filter((r) => r.control === k && r.caught).length}/${controls.filter((r) => r.control === k).length}`])), missed: controls.filter((r) => !r.caught).map((r) => ({ uid: r.uid, kind: r.control, verdict: r.verdict })) },
  labels: { L1_positive: Object.values(L1).filter(Boolean).length, L1_n: Object.keys(L1).length, L2_positive: Object.values(L2).filter(Boolean).length, L2_n: Object.keys(L2).length },
};
fs.writeFileSync(arg('out'), JSON.stringify(out, null, 1));
const line = (a, s) => { const x = by[a][s]; return `${a.padEnd(7)} ${s.padEnd(6)} n=${x.n} bad ${x.bad.k} (${(x.bad.rate * 100).toFixed(0)}%, ${x.bad.ci95.map((v) => (v * 100).toFixed(0)).join('–')}%) ocr-caused ${x.bad_ocr_caused.k} translator ${x.bad_translator_caused.k} | spans/frame med ${x.ocr.spans_per_frame_median} mean ${x.ocr.spans_per_frame_mean} /leaf med ${x.ocr.spans_per_leaf_median} (legible ${x.ocr.legible})`; };
for (const s of ['all', ...STRATA, 'CANON', 'OTHER']) for (const a of ARMS) console.log(line(a, s));
console.log(JSON.stringify({ paired_ocr: pairedOcr, transitions: trans, controls: out.controls, labels: out.labels }, null, 1));
