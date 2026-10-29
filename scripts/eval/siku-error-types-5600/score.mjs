#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/score.mjs — scores usable/fault counts per arm from a lettered key; this
// one tallies the span judge's kinds and risks per arm, one page per book. Stats: paired-stats.mjs bootstrapCI and
// diffCI, agreement-stats.mjs wilson.
/**
 * #5600 scoring. Reads DIR/key.json and DIR/out-pass{1,2}; writes results.json next to this file (no page text).
 *   node scripts/eval/siku-error-types-5600/score.mjs --scratch=DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapCI, diffCI } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = path.resolve(arg('scratch'));
const KINDS = ['INVENTED', 'WRONG-SENSE', 'OCR-CARRIED', 'OMITTED', 'SEAM', 'JUNK', 'STYLE'];
const RISKS = ['HIGH', 'MEDIUM', 'LOW'];
// Where an error was made: the OCR handed the translator a misread; the translator made it; or it is at the page break.
const ORIGIN = { 'OCR-CARRIED': 'ocr', INVENTED: 'translation', 'WRONG-SENSE': 'translation', OMITTED: 'translation', STYLE: 'translation', SEAM: 'seam', JUNK: 'ocr-furniture' };
const key = JSON.parse(fs.readFileSync(path.join(S, 'key.json'), 'utf8'));
const load = (pass, n) => { const f = path.join(S, `out-pass${pass}`, `${n}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).verdict : null; };
const r2 = (x) => Math.round(x * 100) / 100;
const ci = (xs) => (bootstrapCI(xs) || [null, null]).map((v) => (v == null ? null : r2(v)));

const pages = Object.entries(key).map(([name, k]) => ({ name, ...k, v: load(1, name) })).filter((p) => p.v);
const arms = {};
for (const arm of ['A', 'B', 'S']) {
  const ps = pages.filter((p) => p.arm === arm);
  if (!ps.length) continue;
  const per = (f) => ps.map((p) => p.v.errors.filter(f).length);
  const byKind = Object.fromEntries(KINDS.map((k) => { const xs = per((e) => e.kind === k); return [k, { per_page: r2(xs.reduce((a, b) => a + b, 0) / ps.length), ci: ci(xs), pages_with: xs.filter((x) => x > 0).length }]; }));
  const byRisk = Object.fromEntries(RISKS.map((r) => { const xs = per((e) => e.risk === r); return [r, { per_page: r2(xs.reduce((a, b) => a + b, 0) / ps.length), ci: ci(xs), total: xs.reduce((a, b) => a + b, 0) }]; }));
  const highPages = ps.filter((p) => p.v.errors.some((e) => e.risk === 'HIGH')).length;
  const high = ps.flatMap((p) => p.v.errors.filter((e) => e.risk === 'HIGH').map((e) => ({ ...e, name: p.name, url: p.url, title: p.title, page_number: p.page_number })));
  const origin = {};
  for (const e of high) origin[ORIGIN[e.kind]] = (origin[ORIGIN[e.kind]] || 0) + 1;
  const highKind = {};
  for (const e of high) highKind[e.kind] = (highKind[e.kind] || 0) + 1;
  const verdicts = { show: 0, caveat: 0, dont: 0 };
  for (const p of ps) verdicts[p.v.verdict]++;
  const ocrImg = { yes: 0, mostly: 0, no: 0 };
  for (const p of ps) ocrImg[p.v.ocr_matches_image] = (ocrImg[p.v.ocr_matches_image] || 0) + 1;
  const all = per(() => true);
  arms[arm] = {
    n_pages: ps.length, n_books: new Set(ps.map((p) => p.book_id)).size,
    errors_per_page: { mean: r2(all.reduce((a, b) => a + b, 0) / ps.length), ci: ci(all) },
    by_kind: byKind, by_risk: byRisk,
    pages_with_high: { k: highPages, n: ps.length, share: r2(highPages / ps.length), wilson: wilson(highPages, ps.length).map(r2) },
    high_by_kind: highKind, high_by_origin: origin, verdicts, ocr_matches_image: ocrImg,
    high_findings: high.map((e) => ({ name: e.name, url: e.url, title: e.title, page: e.page_number, kind: e.kind, source_span: e.source_span, english_span: String(e.english_span).slice(0, 160), why: e.why, evidence: e.evidence })),
  };
}
const highA = pages.filter((p) => p.arm === 'A').map((p) => p.v.errors.filter((e) => e.risk === 'HIGH').length);
const highB = pages.filter((p) => p.arm === 'B').map((p) => p.v.errors.filter((e) => e.risk === 'HIGH').length);
const diff = diffCI(highA, highB);

// Agreement, pass 1 vs pass 2, page level (spans are not matched one to one).
function kappa(pairs) {
  const n = pairs.length, cats = [...new Set(pairs.flat())];
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return { agree: r2(po), kappa: pe === 1 ? null : r2((po - pe) / (1 - pe)), n };
}
const dup = Object.keys(key).map((n) => ({ n, a: load(1, n), b: load(2, n) })).filter((x) => x.a && x.b);
const agreement = dup.length ? {
  pages: dup.map((x) => x.n),
  verdict: kappa(dup.map((x) => [x.a.verdict, x.b.verdict])),
  any_high: kappa(dup.map((x) => [x.a.errors.some((e) => e.risk === 'HIGH'), x.b.errors.some((e) => e.risk === 'HIGH')])),
  high_count: dup.map((x) => [x.a.errors.filter((e) => e.risk === 'HIGH').length, x.b.errors.filter((e) => e.risk === 'HIGH').length]),
  error_count: dup.map((x) => [x.a.errors.length, x.b.errors.length]),
  kind_presence: Object.fromEntries(KINDS.map((k) => [k, kappa(dup.map((x) => [x.a.errors.some((e) => e.kind === k), x.b.errors.some((e) => e.kind === k)]))])),
  kind_presence_all: (() => { const ps = dup.flatMap((x) => KINDS.map((k) => [x.a.errors.some((e) => e.kind === k), x.b.errors.some((e) => e.kind === k)])); return kappa(ps); })(),
  risk_presence_all: (() => { const ps = dup.flatMap((x) => RISKS.map((r) => [x.a.errors.some((e) => e.risk === r), x.b.errors.some((e) => e.risk === r)])); return kappa(ps); })(),
} : null;

const out = { issue: 5600, scored_at: new Date().toISOString(), judge: 'claude-opus-5-5 via claude -p (l7a subscription), image + OCR + English + previous page tail, blind to arm', arms, high_per_page_A_minus_B: diff && { delta: r2(diff.delta), ci: diff.ci.map(r2) }, agreement };
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(out, null, 1) + '\n');
for (const [a, r] of Object.entries(arms)) {
  console.log(`\n=== arm ${a}: n=${r.n_pages} pages / ${r.n_books} books; errors/page ${r.errors_per_page.mean} [${r.errors_per_page.ci}]`);
  console.log('  kind:', Object.entries(r.by_kind).map(([k, v]) => `${k} ${v.per_page} [${v.ci}] (${v.pages_with}p)`).join(' | '));
  console.log('  risk:', Object.entries(r.by_risk).map(([k, v]) => `${k} ${v.per_page} [${v.ci}] (${v.total})`).join(' | '));
  console.log('  pages with HIGH:', JSON.stringify(r.pages_with_high), 'HIGH by kind', JSON.stringify(r.high_by_kind), 'origin', JSON.stringify(r.high_by_origin));
  console.log('  verdicts', JSON.stringify(r.verdicts), 'ocr~image', JSON.stringify(r.ocr_matches_image));
}
console.log('\nHIGH/page A-B', JSON.stringify(out.high_per_page_A_minus_B));
console.log('agreement', JSON.stringify(agreement, null, 0));
