#!/usr/bin/env node
/**
 * rescore-extract.mjs — re-score the #6293 Latin-script reads with the CLI's wrapper removed, every engine alike (#6523).
 *
 * PRIOR ART: rescore-plan-note.mjs (#6386) — the same re-score from committed reads with a positive control, but it
 * strips only a leading plan note and only from the CLI arms. Read by eye, the 93 Latin / Early English CLI pages over
 * half wrong were mostly a transcription wrapped in something the scorer counts as text: trailing chat ("Would you like
 * a summary…"), a refusal sentence after a partial read, a doubled or restarted reply, a plan note, a ``` fence. This
 * applies ONE extractor, scripts/lib/cli-chatter.mjs extractTranscription(), to EVERY engine's stored read in those
 * strata — the API and self-hosted arms too, so the scoring change cannot favour the CLI — and re-scores what it changed.
 *
 *   node scripts/eval/ocr-pareto-6293/rescore-extract.mjs [--bench <dir>] [--check]
 *
 *   - CLI reads come from the committed results/ocr-pareto-6293/outputs-*.jsonl; every other engine's read from the
 *     #6293 bench on the scoring box (--bench, default /mnt/HC_Volume_105839809/jobs/ocr-pareto-6293/bench). Without the
 *     bench (CI), --check re-derives the CLI rows and keeps the committed non-CLI rows and counts as they are.
 *   - re-score with benchmark-score.mjs's rule for the stratum (rescore-plan-note.mjs's copy of it);
 *   - CONTROL: every read the extractor leaves unchanged is re-scored too and must reproduce the committed CER exactly,
 *     or nothing is written.
 * Writes results/ocr-pareto-6293/extract-rescored.json (no timestamps): per engine, reads checked and changed, and
 * one row per changed read (as returned → extracted, and what the extractor removed). Supersedes plan-note-rescored.json
 * in build-ocr-pareto.mjs: the extractor removes the plan note too.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { levenshtein, scoreAgainstReference } from '../lib/metrics.mjs';
import { loadRefText } from '../lib/private-refs.mjs';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';
import { extractTranscription } from '../../lib/cli-chatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dirname, '..');
const RES = path.join(EVAL, 'results', 'ocr-pareto-6293');
const OUT = path.join(RES, 'extract-rescored.json');
const STRATA = ['ref-ws', 'ref-pinned', 'latin-period-5126', 'eebo-tcp-5488'];
const args = process.argv.slice(2);
const BENCH = args.includes('--bench') ? args[args.indexOf('--bench') + 1] : '/mnt/HC_Volume_105839809/jobs/ocr-pareto-6293/bench';
const HAVE_BENCH = fs.existsSync(BENCH);
const isCli = (e) => e.endsWith('+antigravity-cli');
const r3 = x => (x == null ? null : Math.round(x * 1000) / 1000);

// benchmark-score.mjs's sealed-stratum normalisation (rescore-plan-note.mjs's copy; the control proves it still matches).
function normAlpha(s) {
  return stripMarkupTags(String(s || '')
    .replace(/<(warning|meta|image-desc|figure|note|scan-quality|language|page-type|columns|detected-images|vocab)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '))
    .replace(/```[a-z]*/g, ' ')
    .normalize('NFC').toLowerCase().replace(/ſ/g, 's').replace(/[’‘ʼ`´]/g, "'").replace(/[“”„]/g, '"')
    .replace(/[‐‑‒–—―¬]/g, '-').replace(/(\p{L})-\s*\n\s*/gu, '$1')
    .replace(/\s+/g, ' ').trim();
}
const lettersOnly = s => s.replace(/[^\p{L}\p{N}]+/gu, '');
const CAP = 6000;
const sealedCer = (hyp, ref) => {
  const h = lettersOnly(normAlpha(hyp).slice(0, CAP)), r = lettersOnly(normAlpha(ref).slice(0, CAP));
  return r.length ? r3(levenshtein([...h], [...r]) / r.length) : null;
};
const gtOf = (stratum, slug) => {
  const f = path.join(EVAL, stratum === 'ref-pinned' ? 'ground-truth' : 'ground-truth-ws', `${slug}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
// The committed scored/ files were made under normalizeForScript v3 (digits dropped). Until the benchmark's ref tiers
// are re-scored from every engine's output on the main box, this re-score matches them (#6203; what v4 moves is in
// scripts/eval/experiments/2026-10-12-cer-digits-kept-6203.md). Drop this with that re-score.
const V3_DIGITS = { digits: false };
export function score(stratum, slug, text) {
  if (stratum.startsWith('ref-')) {
    const g = gtOf(stratum, slug);
    const script = g.script === 'cjk' || g.script === 'chinese' ? 'cjk' : (g.script || 'latin');
    const r = scoreAgainstReference(g.ocr_ground_truth, text, script, undefined, V3_DIGITS);
    return { aligned: r.aligned, cer: r3(r.charAccuracyWindowed == null ? null : 1 - r.charAccuracyWindowed) };
  }
  const ref = loadRefText(path.join(EVAL, 'benchmark', 'refs'), slug).text;
  return { aligned: true, cer: ref == null ? null : sealedCer(text, ref) };
}

const scored = new Map();
for (const f of fs.readdirSync(path.join(RES, 'scored')).filter(f => /-\d{4}-\d{2}-\d{2}\.json$/.test(f) && !f.startsWith('summary'))) {
  const stratum = f.replace(/-\d{4}-\d{2}-\d{2}\.json$/, '');
  if (!STRATA.includes(stratum)) continue;
  for (const p of JSON.parse(fs.readFileSync(path.join(RES, 'scored', f), 'utf8')).pages) {
    for (const [e, c] of Object.entries(p.engines)) scored.set(`${stratum}|${p.slug}|${e}`, { ...c, has_ref: p.has_ref });
  }
}
const cliText = new Map();
for (const f of fs.readdirSync(RES).filter(f => /^outputs-.*\.jsonl$/.test(f) && !f.includes('-rep'))) {
  for (const line of fs.readFileSync(path.join(RES, f), 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(line); cliText.set(`${o.stratum}|${o.slug}|${o.engine}`, o.text);
  }
}
const committed = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;

const rows = [], engines = {}, control = { checked: 0, reproduced: 0, mismatches: [] };
for (const [key, c] of [...scored].sort((a, b) => a[0].localeCompare(b[0]))) {
  const [stratum, slug, engine] = key.split('|');
  if (c.missing || c.refused || (!stratum.startsWith('ref-') && !c.has_ref)) continue;
  let text;
  if (isCli(engine)) text = cliText.get(key);
  else if (HAVE_BENCH) { const f = path.join(BENCH, stratum, 'out', engine, `${slug}.txt`); text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined; }
  else continue;
  if (text == null) continue;
  const ex = extractTranscription(text);
  const tally = (engines[engine] ||= { checked: 0, changed: 0 });
  tally.checked++;
  if (!ex.changed) {
    // control: an unchanged read must score exactly as committed. A whitespace-only trim cannot move the score.
    const s = score(stratum, slug, text);
    control.checked++;
    const same = stratum.startsWith('ref-') ? s.aligned === !!c.aligned && (!s.aligned || s.cer === c.cer) : s.cer === c.cer;
    if (same) control.reproduced++; else control.mismatches.push(`${key}: ${c.cer} vs ${s.cer}`);
    continue;
  }
  tally.changed++;
  const s = score(stratum, slug, ex.text);
  rows.push({ page: `${stratum}|${slug}`, engine, removed: ex.steps, chars: [text.trim().length, ex.text.length],
    as_returned: { aligned: stratum.startsWith('ref-') ? !!c.aligned : true, cer: c.cer ?? null }, extracted: s });
}
if (!HAVE_BENCH && committed) {
  // CI: keep the committed non-CLI rows and counts (their reads live on the scoring box only).
  for (const r of committed.rows) if (!isCli(r.engine)) rows.push(r);
  for (const [e, t] of Object.entries(committed.engines)) if (!isCli(e)) engines[e] = t;
}
rows.sort((a, b) => a.page.localeCompare(b.page) || a.engine.localeCompare(b.engine));
console.log(`control: ${control.reproduced}/${control.checked} unchanged reads reproduce the committed score${HAVE_BENCH ? '' : ' (CLI only: no bench here)'}`);
for (const m of control.mismatches.slice(0, 10)) console.log(`  mismatch ${m}`);
if (control.reproduced !== control.checked) { console.error('control failed: the copied normalisation does not match the scorer; nothing written'); process.exit(1); }
const sortedEngines = Object.fromEntries(Object.entries(engines).sort());
const json = JSON.stringify({ issue: 6523, generated_by: 'scripts/eval/ocr-pareto-6293/rescore-extract.mjs', extractor: 'scripts/lib/cli-chatter.mjs extractTranscription',
  strata: STRATA, engines: sortedEngines, rows }, null, 1) + '\n';
if (args.includes('--check')) {
  if (!committed || fs.readFileSync(OUT, 'utf8') !== json) { console.error('extract-rescored.json is stale'); process.exit(1); }
  console.log('extract-rescored.json is current'); process.exit(0);
}
fs.writeFileSync(OUT, json);
for (const [e, t] of Object.entries(sortedEngines)) if (t.changed) console.log(`  ${e}: ${t.changed}/${t.checked} reads changed`);
console.log(`${rows.length} reads changed; wrote ${path.relative(process.cwd(), OUT)}`);
