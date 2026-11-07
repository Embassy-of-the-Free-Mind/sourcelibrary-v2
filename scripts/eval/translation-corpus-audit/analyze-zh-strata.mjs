#!/usr/bin/env node
// PRIOR ART: analyze-7866-join.mjs (major / e2e_wrong / ocr_bad definitions and per-1k-English-word rates on the #7866
// frame, weighted by #7866 book weights: reused definitions, different frame and weights) and score.mjs (control gate,
// language post-stratification: run first, its report.json is read for the gate). Neither weights WITHIN a language by
// a stratum. This reads a draw.mjs --zh-strata run (#5274) and weights every Chinese item back to the live frame.
/**
 * Chinese translation quality by stratum (translation model × transcription engine), weighted back (#5274).
 *
 *   node scripts/eval/translation-corpus-audit/analyze-zh-strata.mjs --dir <run dir> [--judge opus] [--weights pages|books]
 *
 * Reads <dir>/manifest.jsonl, items.jsonl(.gz), draw-log.json (zh_strata.weights), verdicts/<judge>/*.jsonl, report.json.
 * Writes <dir>/zh-summary.{json,md} (zh-summary-books.* with --weights books). No database access.
 *
 * Unit: every item that carries `zh.stratum` and is kind "zh" or "main" (the monthly run's Chinese main books count too).
 * Item weight = w[stratum] / n judged in the stratum, w = the stratum's share of live translated pages ("pages", the
 * default: a random page of the frame) or draw.mjs's book-random estimand ("books"). A cut by kind or hand is the
 * weighted mean over its items, i.e. post-stratified within stratum. CI = 95% bootstrap, books resampled within stratum.
 * Definitions (analyze-7866-join.mjs, the judge's own fields, no re-scoring):
 *   major      the verdict carries a defect of severity "major"
 *   ocr_bad    the judge, with the image, set ocr_misread or ocr_wrong_leaf
 *   e2e_wrong  major OR ocr_bad: wrong for a reader, from either cause
 *   inherited  major AND ocr_bad (share of major pages); the risk ratio and attributable fraction say how much of it
 *              the transcription causes rather than accompanies
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { resetSeed, seededRand } from '../lib/paired-stats.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const DIR = args.dir; if (!DIR) { console.error('--dir required'); process.exit(1); }
const JUDGE = args.judge || 'opus', WMODE = args.weights || 'pages', B = Number(args.iters || 4000);
const BASE = WMODE === 'pages' ? 'zh-summary' : `zh-summary-${WMODE}`;
const readJsonl = (f) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8') : fs.readFileSync(f, 'utf8')).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const manifest = readJsonl(path.join(DIR, 'manifest.jsonl'));
const itemsFile = fs.existsSync(path.join(DIR, 'items.jsonl')) ? path.join(DIR, 'items.jsonl') : path.join(DIR, 'items.jsonl.gz');
const texts = Object.fromEntries(readJsonl(itemsFile).map((x) => [x.id, x]));
const drawLog = JSON.parse(fs.readFileSync(path.join(DIR, 'draw-log.json'), 'utf8'));
const report = fs.existsSync(path.join(DIR, 'report.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'report.json'), 'utf8')) : null;
const FW = drawLog.zh_strata?.weights; if (!FW) { console.error('draw-log.json has no zh_strata (draw.mjs --zh-strata)'); process.exit(1); }
const V = {};
for (const f of fs.readdirSync(path.join(DIR, 'verdicts', JUDGE)).filter((x) => x.endsWith('.jsonl'))) for (const v of readJsonl(path.join(DIR, 'verdicts', JUDGE, f))) if (v.id && typeof v.fidelity === 'number') V[v.id] = v;

const enWords = (s) => (String(s).replace(/<[^>]+>/g, ' ').match(/[A-Za-z0-9'’-]+/g) || []).length;
const units = manifest.filter((m) => (m.kind === 'zh' || m.kind === 'main') && m.zh?.stratum && FW.strata[m.zh.stratum] && V[m.id]).map((m) => {
  const v = V[m.id];
  const majors = (v.defects || []).filter((d) => d.severity === 'major');
  const ocrBad = !!(v.ocr_misread || v.ocr_wrong_leaf);
  return { m, v, s: m.zh.stratum, model: m.zh.model, engine: m.zh.engine, kind: m.zh.kind, hand: m.zh.hand, fid: v.fidelity, nMajor: majors.length,
    major: majors.length > 0, ocrBad, e2e: majors.length > 0 || ocrBad, words: enWords(texts[m.id]?.translation || ''), pw: m.zh_stratum_pages || 1 };
});
const wOf = (s) => (WMODE === 'books' ? FW.strata[s].w_books : FW.strata[s].w_pages);
const byS = {}; for (const u of units) (byS[u.s] ||= []).push(u);
const covered = Object.keys(byS).reduce((t, s) => t + wOf(s), 0);

// weighted statistics over a (resampled) unit set; weights recomputed per stratum from the sample at hand
function weights(sample) {
  const n = {}; for (const u of sample) n[u.s] = (n[u.s] || 0) + 1;
  return sample.map((u) => wOf(u.s) / covered / n[u.s]);
}
const share = (sample, pred, cond = () => true) => { const w = weights(sample); let a = 0, b = 0; sample.forEach((u, i) => { if (!cond(u)) return; b += w[i]; if (pred(u)) a += w[i]; }); return b ? a / b : null; };
const ratio = (sample, num, den, cond = () => true) => { const w = weights(sample); let a = 0, b = 0; sample.forEach((u, i) => { if (!cond(u)) return; a += w[i] * num(u); b += w[i] * den(u); }); return b ? a / b : null; };
const STATS = {
  fid_ge4: (S, c) => share(S, (u) => u.fid >= 4, c),
  fid_le2: (S, c) => share(S, (u) => u.fid <= 2, c),
  major: (S, c) => share(S, (u) => u.major, c),
  major_per_1k_words: (S, c) => { const r = ratio(S, (u) => u.nMajor, (u) => u.words, c); return r == null ? null : 1000 * r; },
  ocr_bad: (S, c) => share(S, (u) => u.ocrBad, c),
  e2e_wrong: (S, c) => share(S, (u) => u.e2e, c),
  inherited_share: (S, c) => share(S, (u) => u.ocrBad, (u) => u.major && c(u)),
  p_major_given_ocr_bad: (S, c) => share(S, (u) => u.major, (u) => u.ocrBad && c(u)),
  p_major_given_ocr_ok: (S, c) => share(S, (u) => u.major, (u) => !u.ocrBad && c(u)),
  attributable_fraction: (S, c) => { const p1 = share(S, (u) => u.major, (u) => u.ocrBad && c(u)), p0 = share(S, (u) => u.major, (u) => !u.ocrBad && c(u)), pe = share(S, (u) => u.ocrBad, (u) => u.major && c(u)); return p1 == null || p0 == null || !p1 || pe == null ? null : pe * (1 - p0 / p1); },
};
const PCT = new Set(['fid_ge4', 'fid_le2', 'major', 'ocr_bad', 'e2e_wrong', 'inherited_share', 'p_major_given_ocr_bad', 'p_major_given_ocr_ok', 'attributable_fraction']);
const fmt = (k, x) => (x == null ? null : PCT.has(k) ? +(100 * x).toFixed(1) : +x.toFixed(2));

resetSeed(52740);
const boots = [];
for (let b = 0; b < B; b++) { const S = []; for (const arr of Object.values(byS)) for (let j = 0; j < arr.length; j++) S.push(arr[Math.floor(seededRand() * arr.length)]); boots.push(S); }
function est(cond = () => true) {
  const out = {};
  for (const [k, f] of Object.entries(STATS)) {
    const point = f(units, cond);
    const bs = boots.map((S) => f(S, cond)).filter((x) => x != null).sort((a, b) => a - b);
    out[k] = { est: fmt(k, point), ci: bs.length > B * 0.5 ? [fmt(k, bs[Math.floor(bs.length * 0.025)]), fmt(k, bs[Math.floor(bs.length * 0.975)])] : null };
  }
  const us = units.filter(cond);
  out.n_books = new Set(us.map((u) => u.m.book_id)).size;
  out.dist = [1, 2, 3, 4, 5].map((k) => us.filter((u) => u.fid === k).length);
  out.dist_weighted = [1, 2, 3, 4, 5].map((k) => fmt('fid_ge4', share(units, (u) => u.fid === k, cond)));
  out.major_pages = us.filter((u) => u.major).length;
  out.words = us.reduce((s, u) => s + u.words, 0);
  return out;
}
// unweighted per-stratum cell (a stratum's own rates need no weights)
function raw(us) {
  const n = us.length, words = us.reduce((s, u) => s + u.words, 0), maj = us.filter((u) => u.major).length;
  return { n, fid_ge4: +(100 * us.filter((u) => u.fid >= 4).length / n).toFixed(1), fid_le2: +(100 * us.filter((u) => u.fid <= 2).length / n).toFixed(1), major: +(100 * maj / n).toFixed(1),
    major_per_1k_words: words ? +(1000 * us.reduce((s, u) => s + u.nMajor, 0) / words).toFixed(2) : null, ocr_bad: +(100 * us.filter((u) => u.ocrBad).length / n).toFixed(1),
    e2e_wrong: +(100 * us.filter((u) => u.e2e).length / n).toFixed(1), inherited: `${us.filter((u) => u.major && u.ocrBad).length}/${maj}`, dist: [1, 2, 3, 4, 5].map((k) => us.filter((u) => u.fid === k).length) };
}

const cut = (f) => Object.fromEntries([...new Set(units.map(f))].sort().map((k) => [k, est((u) => f(u) === k)]));
const summary = {
  dir: DIR, judge: JUDGE, weights: WMODE, iters: B, at: new Date().toISOString(),
  gate: report?.controls_gate ?? null,
  frame: { books: FW.n_books, translated_pages: FW.total_pages, strata: FW.strata, dropped: FW.dropped, covered_weight: +covered.toFixed(4) },
  n_units: units.length, n_books: new Set(units.map((u) => u.m.book_id)).size, english_words: units.reduce((s, u) => s + u.words, 0),
  images_seen: units.filter((u) => u.v.image_seen).length,
  overall: est(),
  by_stratum: Object.fromEntries(Object.entries(byS).sort().map(([s, us]) => [s, { w_pages: +(100 * FW.strata[s].w_pages).toFixed(1), w_books: +(100 * FW.strata[s].w_books).toFixed(1), ...raw(us) }])),
  by_model: cut((u) => u.model), by_engine: cut((u) => u.engine), by_kind: cut((u) => u.kind), by_hand: cut((u) => u.hand),
  by_kind_x_engine: cut((u) => `${u.kind} · ${u.engine}`),
};
// Sensitivity: page-weighted within stratum (each book weighted by its pages in the stratum)
{
  const w2 = units.map((u) => u.pw); const tot = {}; units.forEach((u, i) => { tot[u.s] = (tot[u.s] || 0) + w2[i]; });
  const sh = (pred) => { let a = 0, b = 0; units.forEach((u, i) => { const w = wOf(u.s) / covered * w2[i] / tot[u.s]; b += w; if (pred(u)) a += w; }); return +(100 * a / b).toFixed(1); };
  summary.sensitivity_page_within_stratum = { fid_ge4: sh((u) => u.fid >= 4), major: sh((u) => u.major), e2e_wrong: sh((u) => u.e2e), ocr_bad: sh((u) => u.ocrBad) };
}
// Defect kinds (major), weighted share of pages carrying one, with an example each
{
  const kinds = {};
  const w = weights(units);
  units.forEach((u, i) => {
    const seen = new Set();
    for (const d of (u.v.defects || []).filter((x) => x.severity === 'major')) {
      const k = d.type || 'unknown';
      const r = (kinds[k] ||= { pages: 0, defects: 0, w: 0, reference_pages: 0, examples: [] });
      r.defects++;
      if (!seen.has(k)) { seen.add(k); r.pages++; r.w += w[i]; if (u.kind === 'reference') r.reference_pages++; }
      if (r.examples.length < 3) r.examples.push({ id: u.m.id, url: u.m.url, stratum: u.s, kind: u.kind, detail: d.detail });
    }
  });
  summary.major_defect_kinds = Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1].w - a[1].w).map(([k, r]) => [k, { pages: r.pages, defects: r.defects, weighted_page_pct: +(100 * r.w).toFixed(1), reference_pages: r.reference_pages, examples: r.examples }]));
}
summary.wrong_page_or_reply = units.filter((u) => u.v.flags?.wrong_page || u.v.ocr_wrong_leaf || u.fid === 1).map((u) => ({ id: u.m.id, url: u.m.url, book_id: u.m.book_id, page: u.m.page_number, stratum: u.s, fid: u.fid, wrong_page: !!u.v.flags?.wrong_page, ocr_wrong_leaf: !!u.v.ocr_wrong_leaf, reason: u.v.reason, image_note: u.v.image_note }));
fs.writeFileSync(path.join(DIR, `${BASE}.json`), JSON.stringify(summary, null, 2));

// ── markdown ──
const ci = (x) => (x?.ci ? `${x.est} [${x.ci[0]}–${x.ci[1]}]` : `${x?.est ?? '—'}`);
const estRow = (name, e) => `| ${name} | ${e.n_books} | ${ci(e.fid_ge4)} | ${ci(e.major)} | ${ci(e.major_per_1k_words)} | ${ci(e.ocr_bad)} | ${ci(e.e2e_wrong)} | ${ci(e.inherited_share)} |`;
const H = '| cut | books | fidelity ≥ 4 % | major % | major / 1k words | misread seen % | wrong end to end % | inherited % of major |\n|---|---:|---:|---:|---:|---:|---:|---:|';
let md = `# Chinese translation strata — ${DIR.split('/').pop()}\n\nJudge ${JUDGE} with the page image; weights = ${WMODE}; ${summary.n_units} books, ${summary.english_words} English words. Gate: ${summary.gate?.pass ? 'PASS' : 'FAIL or not scored'}.\n\n`;
md += `## Weighted\n${H}\n${estRow('all', summary.overall)}\n`;
for (const [title, o] of [['model', summary.by_model], ['engine', summary.by_engine], ['kind', summary.by_kind], ['hand tag', summary.by_hand], ['kind × engine', summary.by_kind_x_engine]]) md += Object.entries(o).map(([k, e]) => estRow(`${title}: ${k}`, e)).join('\n') + '\n';
md += `\nfidelity 1/2/3/4/5 (books): ${summary.overall.dist.join(' / ')}; weighted %: ${summary.overall.dist_weighted.join(' / ')}\n`;
md += `\n## By stratum (unweighted)\n| stratum | % of pages | books | 1/2/3/4/5 | ≥4 % | major % | major / 1k | misread % | wrong e2e % | inherited |\n|---|---:|---:|---|---:|---:|---:|---:|---:|---:|\n` + Object.entries(summary.by_stratum).map(([s, c]) => `| ${s} | ${c.w_pages} | ${c.n} | ${c.dist.join('/')} | ${c.fid_ge4} | ${c.major} | ${c.major_per_1k_words} | ${c.ocr_bad} | ${c.e2e_wrong} | ${c.inherited} |`).join('\n') + '\n';
md += `\n## Major defect kinds\n| type | pages | weighted % of pages | on reference pages | example |\n|---|---:|---:|---:|---|\n` + Object.entries(summary.major_defect_kinds).map(([k, r]) => `| ${k} | ${r.pages} | ${r.weighted_page_pct} | ${r.reference_pages} | ${String(r.examples[0]?.detail || '').replace(/\|/g, '/').slice(0, 220)} |`).join('\n') + '\n';
fs.writeFileSync(path.join(DIR, `${BASE}.md`), md);
console.error(`${BASE} → ${DIR}/${BASE}.{json,md}: ${summary.n_units} units`);
