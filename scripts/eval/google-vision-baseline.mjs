#!/usr/bin/env node
/**
 * Google Cloud Vision as an OCR engine on the pinned reference set — is a
 * classical, non-generative engine a viable CHEAPER lane, and what is its
 * honest failure mode? (handoff 2026-09-11-google-vision-ocr-test, ops repo)
 *
 * PRIOR ART: scripts/eval/tesseract-baseline.mjs — same shape (fetch pinned
 * page images, run a non-generative engine, score with scoreAgainstReference),
 * but it shells out to a local binary and its report is the difference-in-
 * differences subsidy, not a paired lane comparison. scripts/eval/score-
 * transcripts.mjs scores a transcript DIRECTORY and has no fetch/run step.
 * This script reuses both conventions: it writes raw outputs to
 * results/scorecard-outputs-<date>.jsonl (so build-observations.mjs and
 * stats-cross-model.mjs pick the arm up with no glue) and scores in-process
 * with the same scorer and normalisation as the July "Nine Models, Forty
 * Pages" post (dataset v0.3).
 *
 * What it measures, per page:
 *   - CER / char accuracy vs the pinned reference (same two-stage guard+score)
 *   - Vision's own block CONFIDENCE and detected languages (VLMs give neither)
 *   - a novel-word proxy for INVENTION: share of output word-tokens (>=4 chars,
 *     alphabetic scripts only) absent from the reference passage. It is a
 *     proxy: running heads, catchwords and apparatus are on the page but not
 *     in the passage, so the ABSOLUTE rate is inflated; the DIFFERENCE between
 *     engines on the same page is the signal. The 5 worst pages per engine are
 *     printed for a human read (300 chars each).
 * And in aggregate: per-language median CER, coverage (aligned pages), and a
 * paired win/loss + exact sign test vs the stored Gemini arms in
 * scripts/eval/observations/ (page = mean char accuracy over aligned runs,
 * exactly as stats-cross-model.mjs pairs them).
 *
 * POSITIVE CONTROL: --control=<image>:<slug> scores a clean modern rendering
 * of a reference passage. Near-zero CER proves the pipeline (fetch, hints,
 * normalisation, scorer) before any number about the engine is believed.
 *
 * Read-only against Mongo (page image URLs). Spend: one Vision unit per page.
 *
 *   set -a; source .env.production.local; set +a
 *   GOOGLE_CLOUD_PROJECT=<gcp project> node scripts/eval/google-vision-baseline.mjs \
 *       [--only=regex] [--control=/path/clean.png:latin-la-copernicus-derev-p142] \
 *       [--ref=gemini-3-flash-preview,gemini-3.1-flash-lite] [--no-append]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getPageSource } from '../lib/page-image-url.mjs';
import { scoreAgainstReference, normalizeForScript, normalizeCJK } from './lib/metrics.mjs';
import { runGoogleVision, fetchImage } from './lib/runners.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const DATE = args.date || new Date().toISOString().slice(0, 10);
const ENGINE = 'google-vision';
const REFS = (args.ref || 'gemini-3-flash-preview,gemini-3.1-flash-lite').split(',');
const only = args.only ? new RegExp(args.only) : null;
const OUT = path.join(__dirname, 'results', `vision-vs-gemini-${DATE}.json`);
const REPORT = path.join(__dirname, 'results', `vision-vs-gemini-${DATE}.md`);
const TRANSCRIPTS = path.join(__dirname, 'results', `vision-transcripts-${DATE}`);
const APPEND = args['no-append'] ? null : path.join(__dirname, 'results', `scorecard-outputs-${DATE}.jsonl`);
// --reuse: re-score the transcripts already on disk for DATE (e.g. after a scorer
// or report change) instead of calling Vision again. Pages without a stored
// transcript are still fetched and run.
const REUSE = !!args.reuse;
// Vision rejects requests over ~20MB; base64 inflates 4/3, so downscale anything
// above this many bytes. Recorded per page so the confound is visible.
const MAX_BYTES = 9 * 1024 * 1024;

// BCP-47 hints from the ground-truth script/language. Vision's own detection is
// good on Latin-script pages; hints matter most for Greek/Hebrew/Armenian/CJK.
const HINT = {
  Latin: ['la'], German: ['de'], Greek: ['el'], Hebrew: ['he'], Armenian: ['hy'],
  Chinese: ['zh-Hant'], Tibetan: ['bo'],
};
const hintsFor = gt => HINT[gt.language] || [];

const gtDir = path.join(__dirname, 'ground-truth');
const gts = fs.readdirSync(gtDir).filter(f => f.endsWith('.json')).sort()
  .map(f => ({ slug: f.replace('.json', ''), ...JSON.parse(fs.readFileSync(path.join(gtDir, f), 'utf8')) }))
  .filter(g => g.ocr_ground_truth && (!only || only.test(g.slug)));

// Which pages were in the July post's v0.3 set (the "40 pages")?
const v03 = new Set(fs.readFileSync(path.join(__dirname, 'dataset', 'v0.3', 'pages.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l).slug));

const norm = (gt, t) => (gt.script === 'cjk' ? normalizeCJK(t || '') : normalizeForScript(t || '', gt.script));
const wordSet = (gt, t) => new Set(norm(gt, t).split(/[^\p{L}\p{M}]+/u).filter(w => w.length >= 4));
function novelWordRate(gt, text) {
  if (gt.script === 'cjk') return null;
  const ref = wordSet(gt, gt.ocr_ground_truth);
  const out = norm(gt, text).split(/[^\p{L}\p{M}]+/u).filter(w => w.length >= 4);
  if (!out.length) return null;
  return +(out.filter(w => !ref.has(w)).length / out.length).toFixed(4);
}

// ── 1. positive control ───────────────────────────────────────────
let control = null;
if (args.control) {
  const [img, slug] = String(args.control).split(':');
  const gt = gts.find(g => g.slug === slug) || JSON.parse(fs.readFileSync(path.join(gtDir, `${slug}.json`), 'utf8'));
  const buf = fs.readFileSync(img);
  const v = await runGoogleVision(buf, { languageHints: hintsFor(gt) });
  const s = scoreAgainstReference(gt.ocr_ground_truth, v.text, gt.script || 'cjk');
  control = {
    image: path.basename(img), slug, hints: hintsFor(gt), aligned: s.aligned,
    cer: +s.cer.toFixed(4), char_accuracy: +s.charAccuracy.toFixed(4),
    mean_confidence: v.meanConfidence, detected: v.detectedLanguages, error: v.error,
  };
  console.log(`CONTROL ${slug}: CER=${(s.cer * 100).toFixed(2)}%  aligned=${s.aligned}  conf=${v.meanConfidence}  ${v.error || ''}`);
  if (!s.aligned || s.cer > 0.02) {
    console.error('Positive control FAILED (CER > 2% or unaligned) — the pipeline is wrong, not the engine. Stopping.');
    if (!args.force) process.exit(2);
  }
}

// ── 2. run Vision over the pinned pages ───────────────────────────
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const PAGES = client.db(process.env.MONGODB_DB || 'bookstore').collection('pages');
fs.mkdirSync(TRANSCRIPTS, { recursive: true });
const rows = [];
let units = 0;

for (const gt of gts) {
  const page = await PAGES.findOne({ book_id: gt.book_id, page_number: gt.page_number });
  const url = page ? getPageSource(page) : null;
  if (!url) { console.log(`  SKIP ${gt.slug} — no usable page image`); rows.push({ slug: gt.slug, skipped: 'no-image' }); continue; }
  let buf;
  try { buf = await fetchImage(url, 60000); } catch (e) { console.log(`  SKIP ${gt.slug} — fetch: ${e.message.slice(0, 80)}`); rows.push({ slug: gt.slug, skipped: 'fetch' }); continue; }
  let downscaled = false;
  if (buf.length > MAX_BYTES) {
    const tmpIn = path.join(TRANSCRIPTS, `${gt.slug}.in.jpg`), tmpOut = path.join(TRANSCRIPTS, `${gt.slug}.small.jpg`);
    fs.writeFileSync(tmpIn, buf);
    execFileSync('magick', [tmpIn, '-resize', '3000x3000>', '-quality', '90', tmpOut]);
    buf = fs.readFileSync(tmpOut); fs.rmSync(tmpIn); fs.rmSync(tmpOut); downscaled = true;
  }
  let v;
  const tPath = path.join(TRANSCRIPTS, `${gt.slug}.txt`), mPath = path.join(TRANSCRIPTS, `${gt.slug}.meta.json`);
  if (REUSE && fs.existsSync(tPath) && fs.existsSync(mPath)) {
    // Re-score from the stored transcript + Vision metadata: no API call, no spend.
    v = { ...JSON.parse(fs.readFileSync(mPath, 'utf8')), text: fs.readFileSync(tPath, 'utf8') };
  } else {
    try { v = await runGoogleVision(buf, { languageHints: hintsFor(gt) }); units += 1; }
    catch (e) { console.log(`  FAIL ${gt.slug}: ${e.message.slice(0, 120)}`); rows.push({ slug: gt.slug, skipped: 'vision-error', error: e.message.slice(0, 200) }); continue; }
    fs.writeFileSync(tPath, v.text);
    const { text: _t, ...meta } = v; fs.writeFileSync(mPath, JSON.stringify(meta));
    if (APPEND) fs.appendFileSync(APPEND, JSON.stringify({ work: gt.work, model: ENGINE, run: 1, finishReason: v.error ? 'ERROR' : 'STOP', text: v.text }) + '\n');
  }

  const s = scoreAgainstReference(gt.ocr_ground_truth, v.text, gt.script || 'cjk');
  const pc = gt.page_class || {};
  rows.push({
    slug: gt.slug, in_v03: v03.has(gt.slug), script: gt.script, language: gt.language,
    source_class: pc.source_class ?? null, canonical: pc.canonical_text !== false,
    hints: hintsFor(gt), image_bytes: buf.length, downscaled,
    aligned: s.aligned, guard_value: +(s.guard?.value ?? NaN).toFixed(4),
    cer: s.aligned ? +s.cer.toFixed(4) : null,
    char_accuracy: s.aligned ? +s.charAccuracy.toFixed(4) : null,
    char_accuracy_raw: +s.charAccuracy.toFixed(4),
    char_accuracy_windowed: s.charAccuracyWindowed == null ? null : +s.charAccuracyWindowed.toFixed(4),
    ref_chars: gt.ocr_ground_truth.length, out_chars: v.text.length,
    novel_word_rate: novelWordRate(gt, v.text),
    mean_confidence: v.meanConfidence, min_confidence: v.minConfidence, blocks: v.blocks,
    detected_languages: v.detectedLanguages, vision_error: v.error, ms: v.elapsed,
  });
  console.log(`  ${s.aligned ? 'OK ' : 'XX '} ${gt.slug.padEnd(40)} ${(gt.language || '').padEnd(8)} acc=${(s.charAccuracy * 100).toFixed(1).padStart(5)}%  guard=${(s.guard.value * 100).toFixed(0).padStart(3)}%  conf=${v.meanConfidence ?? '—'}  det=${v.detectedLanguages.map(d => d.languageCode).join('/') || '—'}${downscaled ? '  [downscaled]' : ''}${v.error ? '  ERR ' + v.error : ''}`);
}
await client.close();

// ── 3. pair against the stored Gemini arms ────────────────────────
// Same dedupe + page-mean rule as stats-cross-model.mjs: latest observation
// file wins per (run_id, slug, model, run_index); pipeline rows excluded.
const obsDir = path.join(__dirname, 'observations');
const seen = new Set(); const obs = [];
for (const f of fs.readdirSync(obsDir).filter(f => f.endsWith('.jsonl')).sort().reverse()) {
  for (const line of fs.readFileSync(path.join(obsDir, f), 'utf8').trim().split('\n')) {
    const r = JSON.parse(line);
    if (r.source === 'pipeline') continue;
    const k = `${r.run_id}|${r.slug}|${r.model}|${r.run_index}`;
    if (seen.has(k)) continue; seen.add(k); obs.push(r);
  }
}
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function pageMeans(model) {
  const by = {}; const runs = {};
  for (const r of obs.filter(r => r.model === model)) { (runs[r.slug] ??= 0); runs[r.slug] += 1; if (r.aligned) (by[r.slug] ??= []).push(r.char_accuracy); }
  return { acc: Object.fromEntries(Object.entries(by).map(([s, a]) => [s, mean(a)])), runs };
}
function binomTwoSided(k, n) {
  const lo = Math.min(k, n - k); let p = 0;
  const C = (n, r) => { let x = 1; for (let i = 1; i <= r; i++) x = x * (n - r + i) / i; return x; };
  for (let i = 0; i <= lo; i++) p += C(n, i) / 2 ** n;
  return Math.min(1, 2 * p);
}
// Raw texts of the reference arms, for the novel-word proxy (observations carry
// scores only; raw text lives in the scorecard-outputs jsonl and dataset v0.3).
const refText = {}; // model -> slug -> text
const byWork = Object.fromEntries(gts.map(g => [g.work, g.slug]));
for (const f of fs.readdirSync(path.join(__dirname, 'results')).filter(f => /^scorecard-outputs-.*\.jsonl$/.test(f)).sort()) {
  for (const line of fs.readFileSync(path.join(__dirname, 'results', f), 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(line); const slug = byWork[o.work];
    if (slug && REFS.includes(o.model) && !(refText[o.model]?.[slug])) (refText[o.model] ??= {})[slug] = o.text;
  }
}
for (const line of fs.readFileSync(path.join(__dirname, 'dataset', 'v0.3', 'runs.jsonl'), 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(line);
  if (REFS.includes(r.model) && r.raw_text && !(refText[r.model]?.[r.slug])) (refText[r.model] ??= {})[r.slug] = r.raw_text;
}
const gtBySlug = Object.fromEntries(gts.map(g => [g.slug, g]));
const scored = rows.filter(r => !r.skipped);

const paired = {};
for (const ref of REFS) {
  const pm = pageMeans(ref);
  const deltas = []; let W = 0, T = 0, L = 0;
  let visOnly = 0, refOnly = 0;
  for (const r of scored) {
    const ra = pm.acc[r.slug];
    const refHasRuns = (pm.runs[r.slug] || 0) > 0;
    // Coverage is only a finding where the reference arm actually RAN on the
    // page; a page with no stored runs for that arm is missing data, not a miss.
    if (r.aligned && ra == null && refHasRuns) visOnly += 1;
    if (!r.aligned && ra != null) refOnly += 1;
    if (!r.aligned || ra == null) continue;
    const d = r.char_accuracy - ra;
    deltas.push({ slug: r.slug, language: r.language, vision: r.char_accuracy, ref: +ra.toFixed(4), delta: +d.toFixed(4),
      novel_vision: r.novel_word_rate, novel_ref: refText[ref]?.[r.slug] ? novelWordRate(gtBySlug[r.slug], refText[ref][r.slug]) : null });
    if (Math.abs(d) < 0.005) T += 1; else if (d > 0) W += 1; else L += 1;
  }
  const byLang = {};
  for (const d of deltas) (byLang[d.language] ??= []).push(d);
  paired[ref] = {
    n_pairs: deltas.length, vision_wins: W, ties: T, vision_losses: L,
    sign_p: W + L ? +binomTwoSided(W, W + L).toFixed(4) : null,
    mean_delta_pp: deltas.length ? +(mean(deltas.map(d => d.delta)) * 100).toFixed(2) : null,
    median_delta_pp: deltas.length ? +(median(deltas.map(d => d.delta)) * 100).toFixed(2) : null,
    vision_aligned_ref_not: visOnly, ref_aligned_vision_not: refOnly,
    ref_pages_with_runs: Object.keys(pm.runs).length,
    per_language: Object.fromEntries(Object.entries(byLang).map(([l, ds]) => [l, {
      n: ds.length, wins: ds.filter(d => d.delta > 0.005).length, losses: ds.filter(d => d.delta < -0.005).length,
      median_vision_cer_pp: +((1 - median(ds.map(d => d.vision))) * 100).toFixed(2),
      median_ref_cer_pp: +((1 - median(ds.map(d => d.ref))) * 100).toFixed(2),
      mean_novel_vision: +mean(ds.map(d => d.novel_vision).filter(x => x != null))?.toFixed(3) || null,
      mean_novel_ref: +mean(ds.map(d => d.novel_ref).filter(x => x != null))?.toFixed(3) || null,
    }])),
    deltas,
  };
}

// ── 4. per-language summary for Vision alone (coverage is a finding) ──
const perLang = {};
for (const r of scored) {
  const L = (perLang[r.language] ??= { n: 0, aligned: 0, cers: [], conf: [], detected_ok: 0 });
  L.n += 1; if (r.aligned) { L.aligned += 1; L.cers.push(r.cer); }
  if (r.mean_confidence != null) L.conf.push(r.mean_confidence);
  const want = (hintsFor({ language: r.language })[0] || '').slice(0, 2);
  if (want && r.detected_languages.some(d => d.languageCode?.startsWith(want))) L.detected_ok += 1;
}
const langSummary = Object.fromEntries(Object.entries(perLang).map(([l, L]) => [l, {
  pages: L.n, aligned: L.aligned, median_cer_pp: L.cers.length ? +(median(L.cers) * 100).toFixed(2) : null,
  mean_confidence: L.conf.length ? +mean(L.conf).toFixed(3) : null, detected_language_matches: L.detected_ok,
}]));

// ── 5. failure-mode excerpts: 5 worst Vision pages, 5 worst pages of each ref arm ──
const excerpt = (t, n = 300) => (t || '').replace(/\s+/g, ' ').trim().slice(0, n);
const worstVision = [...scored].sort((a, b) => a.char_accuracy_raw - b.char_accuracy_raw).slice(0, 5).map(r => ({
  slug: r.slug, aligned: r.aligned, char_accuracy_raw: r.char_accuracy_raw, mean_confidence: r.mean_confidence,
  novel_word_rate: r.novel_word_rate, detected: r.detected_languages.map(d => d.languageCode),
  reference: excerpt(gtBySlug[r.slug].ocr_ground_truth), output: excerpt(fs.readFileSync(path.join(TRANSCRIPTS, `${r.slug}.txt`), 'utf8')),
}));
const worstRef = {};
for (const ref of REFS) {
  const pm = pageMeans(ref);
  const raw = {}; for (const r of obs.filter(r => r.model === ref)) (raw[r.slug] ??= []).push(r.char_accuracy_raw);
  worstRef[ref] = Object.keys(raw).filter(s => gtBySlug[s]).map(s => ({ slug: s, char_accuracy_raw: +mean(raw[s]).toFixed(4), aligned: pm.acc[s] != null }))
    .sort((a, b) => a.char_accuracy_raw - b.char_accuracy_raw).slice(0, 5)
    .map(x => ({ ...x, novel_word_rate: refText[ref]?.[x.slug] ? novelWordRate(gtBySlug[x.slug], refText[ref][x.slug]) : null,
      reference: excerpt(gtBySlug[x.slug].ocr_ground_truth), output: excerpt(refText[ref]?.[x.slug] || '(raw text not on disk)') }));
}

// ── 6. write ──────────────────────────────────────────────────────
const result = {
  date: DATE, engine: ENGINE, feature: 'DOCUMENT_TEXT_DETECTION', refs: REFS,
  cost: { units, usd_list: +(units * 0.0015).toFixed(3), note: 'first 1,000 units/month are free; list price $1.50/1K thereafter' },
  control, pages: rows, per_language: langSummary, paired, worst_vision: worstVision, worst_ref: worstRef,
  transcripts_dir: path.relative(__dirname, TRANSCRIPTS),
  scorecard_outputs: APPEND ? path.relative(__dirname, APPEND) : null,
};
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));

const pp = x => (x == null ? '—' : (x * 100).toFixed(1));
const lines = [];
const say = s => { lines.push(s); console.log(s); };
say(`\n# Google Cloud Vision vs Gemini on the pinned reference set (${DATE})`);
say('');
say(`Engine: Cloud Vision DOCUMENT_TEXT_DETECTION with per-page language hints. ${units} units, list cost $${(units * 0.0015).toFixed(2)} (inside the free tier).`);
if (control) say(`Positive control (${control.image}, ${control.slug}): CER ${pp(control.cer)}%, aligned=${control.aligned}, confidence ${control.mean_confidence}.`);
say('');
say('## Vision alone — per language');
say('');
say('| language | pages | aligned | median CER | mean block conf | detected lang matches hint |');
say('|---|---:|---:|---:|---:|---:|');
for (const [l, L] of Object.entries(langSummary)) say(`| ${l} | ${L.pages} | ${L.aligned} | ${L.median_cer_pp ?? '—'}% | ${L.mean_confidence ?? '—'} | ${L.detected_language_matches}/${L.pages} |`);
for (const ref of REFS) {
  const P = paired[ref];
  say('');
  say(`## Paired vs \`${ref}\` (pages BOTH align; page = mean over that arm's aligned runs)`);
  say('');
  say(`n=${P.n_pairs} pairs · Vision wins ${P.vision_wins} / ties ${P.ties} / losses ${P.vision_losses} · sign p=${P.sign_p} · mean Δ ${P.mean_delta_pp}pp · median Δ ${P.median_delta_pp}pp`);
  say(`Coverage: Vision aligned where ${ref} did not: ${P.vision_aligned_ref_not}; ${ref} aligned where Vision did not: ${P.ref_aligned_vision_not}.`);
  say('');
  say('| language | n | Vision median CER | Gemini median CER | W | L | novel-word rate Vision / Gemini |');
  say('|---|---:|---:|---:|---:|---:|---:|');
  for (const [l, x] of Object.entries(P.per_language)) say(`| ${l} | ${x.n} | ${x.median_vision_cer_pp}% | ${x.median_ref_cer_pp}% | ${x.wins} | ${x.losses} | ${x.mean_novel_vision ?? '—'} / ${x.mean_novel_ref ?? '—'} |`);
}
say('');
say('## Five worst Vision pages (raw accuracy, 300-char excerpts)');
for (const w of worstVision) {
  say(''); say(`### ${w.slug} — acc ${pp(w.char_accuracy_raw)}% aligned=${w.aligned} conf=${w.mean_confidence} novel=${w.novel_word_rate} detected=${w.detected.join('/')}`);
  say(`- REF: ${w.reference}`); say(`- OUT: ${w.output}`);
}
for (const ref of REFS) {
  say(''); say(`## Five worst \`${ref}\` pages`);
  for (const w of worstRef[ref]) {
    say(''); say(`### ${w.slug} — acc ${pp(w.char_accuracy_raw)}% aligned=${w.aligned} novel=${w.novel_word_rate}`);
    say(`- REF: ${w.reference}`); say(`- OUT: ${w.output}`);
  }
}
fs.writeFileSync(REPORT, lines.join('\n') + '\n');
console.log(`\nWrote ${OUT}\n      ${REPORT}\n      transcripts → ${TRANSCRIPTS}${APPEND ? `\n      raw outputs appended to ${APPEND} as model="${ENGINE}"` : ''}`);
