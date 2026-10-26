#!/usr/bin/env node
// PRIOR ART: scripts/eval/estimator/ocr/failure-observations.jsonl (hand-curated k-of-n rows, file + quote provenance,
// #6740) — this writes this job's rows in that exact shape instead of by hand, from the scored audits, so the counts
// and the write-up cannot drift apart. failures_v0.py fits only the rates not_of_leaf / failed_read / made_worse
// (plus judge_catch / judge_false_positive for the judge); the bad_translation rows are evidence it does not fit yet.
/**
 * evidence.mjs — $0. Job split-leaves-5771 (#5771): failure-observation rows for the three Tibetan arms.
 *   node scripts/eval/split-leaf-5771/evidence.mjs --compare=compare.json --rows=compare-rows.jsonl \
 *        --before-replies=<6948>/audit/out.jsonl --before-key=<6948>/audit/key.json \
 *        --after-replies=audit/out.jsonl --after-key=audit/key.json --byeye=byeye.jsonl --out=rows.jsonl
 * Per arm (one page per book, 80 books): bad_translation (the auditor's verdict), and not_of_leaf = frames where the
 * auditor lists a transcription span of kind line_repeated (a line on the transcription that the leaf has once).
 * By eye: not_of_leaf on the 20 leaves opened (arm 3). Judge: the 15 planted controls of this audit.
 */
import fs from 'node:fs';
import { parseReply } from '../opus-tib-sa-6948/audit.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const jl = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const FILE = 'scripts/eval/experiments/2026-10-25-split-leaf-reread-gate-5771.md';
const ROUTE = { seam: 'yigdzin seam-read', cut: 'yigdzin split-cut', reread: 'yigdzin split-reread' };
const RAW = { seam: 'stored Yigdzin read of the whole photo (whole-page read, or leaf reads joined at <leaf-break/>)', cut: 'the stored read cut onto leaves at <leaf-break/> or ledger line counts, no re-OCR', reread: 'each leaf crop re-read alone, Yigdzin 1 on vLLM 0.29 (gex45)' };
const cmp = JSON.parse(fs.readFileSync(arg('compare'), 'utf8'));
const rows = jl(arg('rows'));

// frames with a line_repeated span, per arm
function repeated(replies, key, armOf) {
  const out = {};
  for (const r of jl(replies)) {
    const k = key[r.uid]; if (!k || k.control) continue;
    const v = parseReply(r.text); if (!v) continue;
    const arm = armOf(k); (out[arm] ??= { k: 0, n: 0 }).n++;
    if ((v.ocr?.spans || []).some((s) => s.kind === 'line_repeated')) out[arm].k++;
  }
  return out;
}
const bk = JSON.parse(fs.readFileSync(arg('before-key'), 'utf8')), ak = JSON.parse(fs.readFileSync(arg('after-key'), 'utf8'));
const rep = { ...repeated(arg('before-replies'), Object.fromEntries(Object.entries(bk).filter(([, k]) => k.lang === 'bo')), () => 'seam'), ...repeated(arg('after-replies'), ak, (k) => k.arm) };

const base = { script: 'tibetan', note: '', unit: 'books (1 page each)', one_page_per_book: true, file: FILE };
const out = [];
for (const arm of ['seam', 'cut', 'reread']) {
  const a = cmp.arms[arm].all;
  out.push({ rate: 'bad_translation', route: `${ROUTE[arm]} + Opus translation (${arm === "seam" ? "per frame, 1 or 10 per call" : "per leaf, 1 per call"})`, ...base, judge: 'opus', source: '5771 split-leaf gate, blind image-grounded audit', k: a.bad.k, n: a.bad.n, books: a.bad.n, quote: `${arm}: bad ${a.bad.k}/${a.bad.n}, OCR-caused ${a.bad_ocr_caused.k}, translator-caused ${a.bad_translator_caused.k}`, raw_route: RAW[arm], note: 'not fitted by failures_v0.py (its RATES are not_of_leaf, failed_read, made_worse)' });
  if (rep[arm]) out.push({ rate: 'not_of_leaf', route: ROUTE[arm], ...base, judge: 'opus', source: '5771 split-leaf gate, auditor OCR spans of kind line_repeated', k: rep[arm].k, n: rep[arm].n, books: rep[arm].n, quote: `${arm}: ${rep[arm].k} of ${rep[arm].n} audited frames have a transcription line the leaf has once (line_repeated)`, raw_route: RAW[arm], note: 'invented_seam_line proxy: a repeated line, wherever it falls on the frame' });
}
if (arg('byeye')) {
  const b = jl(arg('byeye'));
  out.push({ rate: 'not_of_leaf', route: ROUTE.reread, ...base, judge: 'by-eye', unit: 'pages', books: new Set(b.map((x) => x.leaf.split('-')[0])).size, one_page_per_book: false, source: '5771 split-leaf gate, 20 leaves by eye', k: b.filter((x) => x.invented_or_duplicated > 0).length, n: b.length, quote: b.filter((x) => x.invented_or_duplicated > 0).map((x) => `${x.leaf}: ${x.note.slice(0, 90)}`).join(' | '), raw_route: RAW.reread, note: `0 of these at a leaf seam; ${b.filter((x) => x.truncated > 0).length} more leaf truncated` });
}
const c = cmp.controls;
out.push({ rate: 'judge_catch', route: 'planted reversal/invention control (English)', script: 'tibetan', judge: 'opus', note: 'the #6948 controls re-sent unchanged (10 Tibetan, 5 Sanskrit)', source: '5771 split-leaf gate controls', k: c.caught, n: c.n, unit: 'control items', books: null, one_page_per_book: null, file: FILE, quote: `controls caught ${c.caught}/${c.n} (${Object.entries(c.by_kind).map(([k, v]) => `${k} ${v}`).join(', ')})`, raw_route: 'planted control' });
fs.writeFileSync(arg('out'), out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(out.map((r) => `${r.rate} ${r.route} ${r.judge} ${r.k}/${r.n}`).join('\n'));
