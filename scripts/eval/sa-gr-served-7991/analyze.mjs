#!/usr/bin/env node
// PRIOR ART: scripts/eval/confidence-7866/regrade.mjs (gradeOf, bucketOf, GRADES, BUCKETS, unitOf — imported; its
// `by_language` row is the shape /quality reads, and the rows below are written in it) and
// scripts/eval/latin-strata-7947/analyze.mjs (judged vs CONFIRMED modes from the second reader's verdicts; kindOf()
// for plain-words error kinds — imported). Neither stratifies by the image's form within Sanskrit or Greek, nor
// weights one page a book by a stratum's translated pages, nor uses Wilson intervals for the small cells.
/**
 * #7991 stage 4: rates. Pure: reads OUT files, writes scripts/eval/sa-gr-served-7991/results/served-7991.json.
 *
 *   node scripts/eval/sa-gr-served-7991/analyze.mjs
 *
 * Per page, two verdicts from #7866's judge (judgePrompt): the transcription (task ocr; the #7866 bar) and the
 * English (task tr). The headline is the transcription, as on /quality. The English names the translation-side
 * defects so the fix lane is clear.
 *   grade / bucket   gradeOf(verdict) → bucketOf(grade), unchanged.
 *   severe_per_1k    (misleads + wrong_text defects) / OCR words × 1000 (regrade.mjs's definition, words()).
 * Modes: `judged` (the first judge as it stands) and `confirmed` (each misleads/wrong_text claim and each fidelity ≤ 2
 * call put to SECOND-READER.md: confirmed or misclassified stay serious; real_not_serious becomes cosmetic, and a
 * fidelity call it downgrades becomes fidelity 3; not_an_error drops the claim (fidelity 3 for a page call);
 * cannot_tell drops it from CONFIRMED only).
 * Weights: a page stands for its stratum's translated pages / the pages drawn in it (strata are the catalogue's; the
 * image's form is a cut, unweighted). Intervals: weighted language figures and every per-1k rate by a bootstrap that
 * resamples books within strata (one page a book, so the book is the cluster); page shares in a cut with k < 20 by
 * Wilson on the unweighted count (k of n), as #7991 asks.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { gradeOf, bucketOf, GRADES, BUCKETS, unitOf } from '../confidence-7866/regrade.mjs';
import { kindOf } from '../latin-strata-7947/lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { OUT, RESULTS, BOOT_SEED, claimId } from './lib.mjs';

// Reads the job's OUT, or the committed bundle (--out=scripts/eval/sa-gr-served-7991/results/run: the same files gzipped).
const read = (f) => { const p = path.join(OUT, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : fs.existsSync(`${p}.gz`) ? zlib.gunzipSync(fs.readFileSync(`${p}.gz`)).toString('utf8') : null; };
const J = (f) => JSON.parse(read(f));
const jsonl = (f) => (read(f) ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const first = (f) => { const m = new Map(); for (const r of jsonl(f)) if (r.verdict && !m.has(r.page_id)) m.set(r.page_id, r); return m; };
const sample = J('sample.json'), frame = J('frame.json');
const O = first('verdicts-ocr.jsonl'), T = first('verdicts-tr.jsonl'), F = first('form.jsonl');
const secondDir = path.join(OUT, 'second/reviews');
const second = new Map((fs.existsSync(secondDir) ? fs.readdirSync(secondDir).filter((f) => f.endsWith('.json'))
  .flatMap((f) => { try { return JSON.parse(fs.readFileSync(path.join(secondDir, f), 'utf8')); } catch { return []; } }) : JSON.parse(read('second-verdicts.json') ?? '[]')).map((v) => [v.claim_id, v]));
const r4 = (x) => (x == null ? null : +x.toFixed(4));
const r2 = (x) => (x == null ? null : +x.toFixed(2));

/** A verdict after the second reader (mode 'confirmed'), or as judged. */
function after(v, pageId, lane, mode) {
  if (!v || mode === 'judged') return { ...v, defects: (v?.defects || []).map((d, i) => ({ ...d, claim_id: claimId(pageId, lane, i) })) };
  const defects = [];
  (v.defects || []).forEach((d, i) => {
    const id = claimId(pageId, lane, i), s = second.get(id);
    if (!['misleads', 'wrong_text'].includes(d.severity) || !s || s.verdict === 'confirmed') return defects.push({ ...d, claim_id: id });
    if (s.verdict === 'misclassified') return defects.push({ ...d, class: s.class || d.class, claim_id: id, reclassified: true });
    if (s.verdict === 'real_not_serious') return defects.push({ ...d, severity: 'cosmetic', claim_id: id });
    // not_an_error, cannot_tell: dropped from CONFIRMED
  });
  let fidelity = Number(v.fidelity);
  const fs2 = second.get(claimId(pageId, lane, 'fidelity'));
  if (fidelity <= 2 && fs2 && !['confirmed', 'misclassified'].includes(fs2.verdict)) fidelity = 3;
  return { ...v, fidelity, defects };
}

const formOf = (s) => { const f = F.get(s.page_id)?.verdict?.form; return f === 'manuscript' ? 'manuscript' : f ? 'print' : s.form_tag; };
const scriptOf = (s) => { const x = String(F.get(s.page_id)?.verdict?.script ?? 'unknown'); return /sarada|śāradā|sharada/i.test(x) ? 'Sarada' : x.replace(/^other:\s*/i, ''); };
const sev = (v) => (v?.defects || []).filter((d) => d.severity === 'misleads' || d.severity === 'wrong_text');

function rows(mode) {
  return sample.filter((s) => O.has(s.page_id)).map((s) => {
    const fr = frame.languages[s.language].strata[s.stratum];
    const vo = after(O.get(s.page_id).verdict, s.page_id, 'ocr', mode);
    const vt = T.has(s.page_id) ? after(T.get(s.page_id).verdict, s.page_id, 'tr', mode) : null;
    const grade = gradeOf(vo), trGrade = vt ? gradeOf(vt) : null;
    const kinds = [
      ...sev(vo).map((d) => ({ lane: 'ocr', class: d.class, severity: d.severity, kind: kindOf({ class: d.class, problem: d.what, ocr: d.quote }, 'ocr'), quote: d.quote, what: d.what })),
      ...sev(vt).map((d) => ({ lane: 'tr', class: d.class, severity: d.severity, kind: kindOf({ class: d.class, problem: d.what, ocr: d.quote }, 'tr'), quote: d.quote, what: d.what })),
    ];
    return {
      book_id: s.book_id, title: s.title, page_number: s.page_number, page_id: s.page_id, url: `https://sourcelibrary.org/book/${s.book_id}/page/${s.page_number}`,
      language: s.language, stratum: s.stratum, weight: fr.pages_translated / fr.drawn, form_tag: s.form_tag, form: formOf(s), form_image: F.get(s.page_id)?.verdict?.form ?? null,
      script: scriptOf(s), era: s.year == null ? 'undated' : s.year < 1600 ? 'before 1600' : '1600 and later', year: s.year,
      ocr_model: s.prov.ocr_model, tr_model: s.prov.tr_model, redo_5813: s.prov.redo_5813_ocr, words: s.words,
      fidelity: Number(vo.fidelity), grade, bucket: bucketOf(grade),
      misleads: vo.defects.filter((d) => d.severity === 'misleads').length, wrong_text: vo.defects.filter((d) => d.severity === 'wrong_text').length,
      cosmetic: vo.defects.filter((d) => d.severity === 'cosmetic').length,
      tr_fidelity: vt ? Number(vt.fidelity) : null, tr_grade: trGrade, tr_bucket: trGrade && bucketOf(trGrade), tr_serious: vt ? sev(vt).length : null,
      tr_wrong_text: vt ? vt.defects.filter((d) => d.severity === 'wrong_text').length : null,
      reader_ok: bucketOf(grade) === 'says_what_the_page_says' && (!trGrade || bucketOf(trGrade) === 'says_what_the_page_says'),
      kinds,
    };
  });
}

/* ── statistics ── */
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.min(s.length - 1, Math.floor(p * s.length)))]; };
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [r4(Math.max(0, c - h)), r4(Math.min(1, c + h))];
}
/** Stratified bootstrap over pages (= books) of a weighted statistic. */
function boot(ps, stat, seed, B = 4000) {
  const rng = makeRng(seed), groups = Object.values(ps.reduce((m, p) => ((m[p.stratum] ??= []).push(p), m), {}));
  const sims = [];
  for (let i = 0; i < B; i++) { const s = []; for (const g of groups) for (let j = 0; j < g.length; j++) s.push(g[Math.floor(rng() * g.length)]); const v = stat(s); if (v != null && Number.isFinite(v)) sims.push(v); }
  return sims.length ? [r4(pctl(sims, 0.025)), r4(pctl(sims, 0.975))] : null;
}
const wshare = (ps, f, weighted) => { const W = ps.reduce((a, p) => a + (weighted ? p.weight : 1), 0); return W ? ps.reduce((a, p) => a + (f(p) ? (weighted ? p.weight : 1) : 0), 0) / W : null; };
const wrate = (ps, num, weighted) => { const w = ps.reduce((a, p) => a + p.words * (weighted ? p.weight : 1), 0); return w ? (1000 * ps.reduce((a, p) => a + num(p) * (weighted ? p.weight : 1), 0)) / w : null; };
/** A share with its interval: Wilson on k of n when k < 20 (unweighted), else the stratified bootstrap. */
function share(ps, f, weighted, seed) {
  const k = ps.filter(f).length, n = ps.length;
  const point = wshare(ps, f, weighted);
  return { k, n, share: r4(point), ci95: k < 20 || n - k < 20 ? wilson(k, n) : boot(ps, (s) => wshare(s, f, weighted), seed), ci_method: k < 20 || n - k < 20 ? 'wilson (unweighted k/n)' : 'stratified bootstrap' };
}
const rate = (ps, num, weighted, seed) => ({ per_1k: r2(wrate(ps, num, weighted)), ci95: (boot(ps, (s) => wrate(s, num, weighted), seed) || []).map(r2), errors: ps.reduce((a, p) => a + num(p), 0) });

function cut(ps, keyOf, seed, weighted = false) {
  return Object.fromEntries([...new Set(ps.map(keyOf))].sort().map((k, i) => {
    const g = ps.filter((p) => keyOf(p) === k);
    return [k, {
      books: g.length, pages: g.length, words: g.reduce((a, p) => a + p.words, 0),
      says_what_the_page_says: share(g, (p) => p.bucket === 'says_what_the_page_says', weighted, seed + i * 10),
      text_not_on_the_page: share(g, (p) => p.bucket === 'text_not_on_the_page', weighted, seed + i * 10 + 1),
      fit_to_quote: share(g, (p) => p.grade === 'fit_to_quote', weighted, seed + i * 10 + 2),
      severe_per_1k: rate(g, (p) => p.misleads + p.wrong_text, weighted, seed + i * 10 + 3),
      wrong_text_per_1k: rate(g, (p) => p.wrong_text, weighted, seed + i * 10 + 4),
      english_clean: share(g.filter((p) => p.tr_bucket), (p) => p.tr_bucket === 'says_what_the_page_says', weighted, seed + i * 10 + 5),
      english_serious_per_1k_source_words: rate(g.filter((p) => p.tr_bucket), (p) => p.tr_serious, weighted, seed + i * 10 + 6),
      reader_ok: share(g, (p) => p.reader_ok, weighted, seed + i * 10 + 7),
      fidelity_le2: g.filter((p) => p.fidelity <= 2).length,
    }];
  }));
}

/** The /quality row (served-grades.json `by_language` shape), stratum-weighted, plus intervals. */
function languageRow(ps, L, seed) {
  const g = ps.filter((p) => p.language === L);
  const w = g.reduce((a, p) => a + p.words, 0);
  const s = (k) => r4(wshare(g, (p) => p.bucket === k, true));
  return {
    language: L, books: g.length, pages: g.length, words: w, unit: unitOf(L),
    scripts: [...new Set(g.map((p) => p.form))].sort(),
    routes: Object.entries(g.reduce((a, p) => ((a[p.ocr_model] = (a[p.ocr_model] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).map(([route, n]) => ({ route, pages: n })),
    ...Object.fromEntries(BUCKETS.map((k) => [k, s(k)])),
    fit_to_quote: r4(wshare(g, (p) => p.grade === 'fit_to_quote', true)),
    severe_per_1k: r2(wrate(g, (p) => p.misleads + p.wrong_text, true)),
    wrong_text_per_1k: r2(wrate(g, (p) => p.wrong_text, true)),
    bad_7866_books: null,
    ci95: {
      says_what_the_page_says: boot(g, (x) => wshare(x, (p) => p.bucket === 'says_what_the_page_says', true), seed),
      text_not_on_the_page: boot(g, (x) => wshare(x, (p) => p.bucket === 'text_not_on_the_page', true), seed + 1),
      severe_per_1k: (boot(g, (x) => wrate(x, (p) => p.misleads + p.wrong_text, true), seed + 2) || []).map(r2),
      wrong_text_per_1k: (boot(g, (x) => wrate(x, (p) => p.wrong_text, true), seed + 3) || []).map(r2),
    },
    english: {
      pages: g.filter((p) => p.tr_bucket).length,
      says_what_the_source_says: r4(wshare(g.filter((p) => p.tr_bucket), (p) => p.tr_bucket === 'says_what_the_page_says', true)),
      serious_per_1k_source_words: r2(wrate(g.filter((p) => p.tr_bucket), (p) => p.tr_serious, true)),
    },
    reader_ok: r4(wshare(g, (p) => p.reader_ok, true)),
    weighting: 'one page a book; each page weighted by its catalogue stratum\'s translated pages / pages drawn',
  };
}

function kinds(ps) {
  const out = {};
  for (const p of ps) for (const k of p.kinds) {
    const x = ((out[p.language] ??= {})[`${k.lane}: ${k.kind}`] ??= { n: 0, pages: new Set(), examples: [] });
    x.n++; x.pages.add(p.page_id);
    if (x.examples.length < 3 && !x.examples.some((e) => e.book_id === p.book_id)) x.examples.push({ book_id: p.book_id, url: p.url, class: k.class, severity: k.severity, quote: String(k.quote ?? '').slice(0, 160), what: String(k.what ?? '').slice(0, 200) });
  }
  return Object.fromEntries(Object.entries(out).map(([L, ks]) => [L, Object.fromEntries(Object.entries(ks).sort((a, b) => b[1].n - a[1].n).map(([k, x]) => [k, { errors: x.n, pages: x.pages.size, examples: x.examples }]))]));
}
const laneSplit = (ps) => Object.fromEntries(['Sanskrit', 'Greek'].map((L) => {
  const g = ps.filter((p) => p.language === L), ks = g.flatMap((p) => p.kinds);
  const fromOcr = ks.filter((k) => k.lane === 'tr' && k.kind === 'translation error carried from the OCR').length;
  return [L, { ocr_serious: ks.filter((k) => k.lane === 'ocr').length, english_serious: ks.filter((k) => k.lane === 'tr').length, english_carried_from_ocr: fromOcr,
    english_own: ks.filter((k) => k.lane === 'tr').length - fromOcr,
    pages_ocr_bad: g.filter((p) => p.bucket !== 'says_what_the_page_says').length, pages_english_bad: g.filter((p) => p.tr_bucket && p.tr_bucket !== 'says_what_the_page_says').length,
    pages_english_bad_on_clean_ocr: g.filter((p) => p.bucket === 'says_what_the_page_says' && p.tr_bucket && p.tr_bucket !== 'says_what_the_page_says').length, pages: g.length }];
}));

const result = {
  issue: 7991, generated: new Date().toISOString().slice(0, 10),
  judge: 'claude-opus-5-5 via claude -p (subscription), route-judge-6740 judgePrompt: task ocr (= #7866 judgeAbsolute) and task tr, each blind, against the page image; SECOND-READER.md on every misleads / wrong_text claim and fidelity ≤ 2 call',
  frame, second_reader: second.size ? Object.entries([...second.values()].reduce((m, v) => ((m[v.verdict] = (m[v.verdict] ?? 0) + 1), m), {})) : null,
  form_check: { pages: F.size, reclassified: sample.filter((s) => F.has(s.page_id) && formOf(s) !== s.form_tag).map((s) => ({ book_id: s.book_id, title: s.title, tag: s.form_tag, image: F.get(s.page_id).verdict.form, note: F.get(s.page_id).verdict.note })) },
  modes: {},
};
for (const [m, mode] of [[0, 'judged'], [1, 'confirmed']]) {
  const ps = rows(mode), sd = BOOT_SEED + m * 1000;
  const sa = ps.filter((p) => p.language === 'Sanskrit'), gr = ps.filter((p) => p.language === 'Greek');
  result.modes[mode] = {
    pages: ps.length,
    by_language: ['Sanskrit', 'Greek'].map((L, i) => languageRow(ps, L, sd + i * 10)),
    by_stratum: cut(ps, (p) => `${p.language} · ${p.stratum}`, sd + 100),
    by_form_image: cut(ps, (p) => `${p.language} · ${p.form}`, sd + 200),
    sanskrit_by_script: cut(sa, (p) => p.script === 'Sarada' ? 'Sarada' : p.script === 'Devanagari' ? 'Devanagari' : 'other scripts', sd + 300),
    greek_by_form_era: cut(gr, (p) => `${p.form} · ${p.era}`, sd + 400),
    greek_by_redo_5813: cut(gr, (p) => (p.redo_5813 ? 're-read on Flash by #5813' : 'not from #5813'), sd + 500),
    by_ocr_model: cut(ps, (p) => `${p.language} · ${p.ocr_model}`, sd + 600),
    lane_split: laneSplit(ps),
    kinds: kinds(ps),
    pages_rows: ps.map(({ kinds: ks, ...p }) => ({ ...p, kinds: ks.map((k) => `${k.lane}:${k.class}:${k.severity}:${k.kind}`) })),
  };
}
fs.mkdirSync(RESULTS, { recursive: true });
fs.writeFileSync(path.join(RESULTS, 'served-7991.json'), JSON.stringify(result, null, 1) + '\n');

// The experiments-lint defect_rates shape (#6740): per (language · form on the image · OCR engine), transcription lane,
// both modes. Unweighted drawn pages: router evidence it is not (engines were not assigned at random).
const dr = (ps) => Object.fromEntries([...new Set(ps.map((p) => `${p.language}|${p.form}|${p.ocr_model}`))].sort().map((k) => {
  const g = ps.filter((p) => `${p.language}|${p.form}|${p.ocr_model}` === k), w = g.reduce((a, p) => a + p.words, 0);
  return [k, { books: g.length, pages: g.length, words: w, misleads_per_1k: r2((1000 * g.reduce((a, p) => a + p.misleads, 0)) / w),
    wrong_text_per_1k: r2((1000 * g.reduce((a, p) => a + p.wrong_text, 0)) / w), cosmetic_per_1k: r2((1000 * g.reduce((a, p) => a + p.cosmetic, 0)) / w),
    fidelity_mean: r2(g.reduce((a, p) => a + p.fidelity, 0) / g.length) }];
}));
fs.writeFileSync(path.join(RESULTS, 'defect-rates.json'), JSON.stringify({
  issue: 7991, note: 'Transcription lane, #7866 judge (judgePrompt task ocr), per language | form on the image | OCR engine. Unweighted drawn pages, one a book. confirmed = after SECOND-READER.md.',
  judged: dr(rows('judged')), study_cells: dr(rows('confirmed')),
}, null, 1) + '\n');
const pc = (x) => (x == null ? '–' : `${(100 * x).toFixed(0)}%`);
for (const mode of ['judged', 'confirmed']) {
  console.log(`\n== ${mode} ==`);
  for (const r of result.modes[mode].by_language) console.log(`${r.language}: ${r.pages} pages, says ${pc(r.says_what_the_page_says)} [${(r.ci95.says_what_the_page_says || []).map(pc).join('–')}], not-on-page ${pc(r.text_not_on_the_page)}, severe ${r.severe_per_1k}/1k [${r.ci95.severe_per_1k.join('–')}], EN clean ${pc(r.english.says_what_the_source_says)}, reader ok ${pc(r.reader_ok)}`);
  for (const [k, c] of Object.entries(result.modes[mode].by_stratum)) console.log(`  ${k.padEnd(40)} n=${c.pages} says ${c.says_what_the_page_says.k}/${c.pages} severe ${c.severe_per_1k.per_1k} [${c.severe_per_1k.ci95.join('–')}] EN-clean ${c.english_clean.k}/${c.english_clean.n}`);
}
