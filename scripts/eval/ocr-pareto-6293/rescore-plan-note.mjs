#!/usr/bin/env node
/**
 * rescore-plan-note.mjs — re-score the #6293 CLI reads with the CLI's own preamble removed (#6386).
 *
 * PRIOR ART: the Amendment 2 sensitivity (results/ocr-pareto-6293/cli-tiers-plan-note-stripped.json) stripped the same
 * note, but in a job script (cli-queue-b-6293 strip.py) that was never committed, and kept only per-arm medians, so
 * the Pareto builder could not use it per page. benchmark-score.mjs is the scorer, but it needs the whole bench tree
 * (images and every engine's outputs) and runs only on the box. This re-scores just the CLI rows, from the committed
 * reads (outputs-*.jsonl) and references, with the scorer's own normalisation, and proves it with a positive control.
 *
 *   node scripts/eval/ocr-pareto-6293/rescore-plan-note.mjs [--check]
 *
 * Through the Antigravity CLI a reply sometimes opens with a note about a plan file ("I have created the transcription
 * plan artifact…") before the page text. That note is the route talking, not the page being read, and the scorer
 * counted it as text. Per CLI read in the Latin-script strata (the Greek and CJK scorers count only Greek or CJK
 * characters, so the note cannot move them):
 *   - strip: drop leading lines that are blank or read as the agent's prose (plan, artifact, review, approve,
 *     "I have…", a file:// link) up to the first line that does not;
 *   - re-score with benchmark-score.mjs's rule for the stratum: ref-ws / ref-pinned through scoreAgainstReference
 *     (windowed CER, aligned or not); the sealed strata as whole-page letter CER against the reference text;
 *   - CONTROL: every CLI read WITHOUT a note is re-scored too, and must reproduce the committed CER exactly. The
 *     script refuses to write if any does not, so the copied normalisation cannot drift from the scorer's.
 * Writes results/ocr-pareto-6293/plan-note-rescored.json (no timestamps). Syriac manuscript CLI reads are not
 * re-scored: their ground truth lives on the scoring box only (score-syriac-retest.py), so those stay as returned.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { levenshtein, scoreAgainstReference } from '../lib/metrics.mjs';
import { loadRefText } from '../lib/private-refs.mjs';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dirname, '..');
const RES = path.join(EVAL, 'results', 'ocr-pareto-6293');
const OUT = path.join(RES, 'plan-note-rescored.json');
const STRATA = ['ref-ws', 'ref-pinned', 'latin-period-5126', 'eebo-tcp-5488'];
const r3 = x => (x == null ? null : Math.round(x * 1000) / 1000);

// The note, as analyze-cli-effort.py detects it (its first line), and the prose lines that follow it.
const NOTE = /^\s*(I have|I've)\b.*\b(plan|artifact|transcri\w*|image|manuscript)\b/i;
const PROSE = /^\s*$|^\s*(I have|I've|I will|I'll|Please|Let me|You can|Once you|If you)\b|\b(plan|artifact|approve|proceed|review|file:\/\/)\b/i;
export function stripPlanNote(text) {
  const lines = String(text || '').split('\n');
  if (!NOTE.test(lines[0] || '')) return null;
  let i = 0;
  while (i < lines.length && PROSE.test(lines[i])) i++;
  return lines.slice(i).join('\n');
}

// benchmark-score.mjs's sealed-stratum normalisation for Latin-script pages, copied (the scorer runs top-level code on
// import). The control below fails the run if this copy ever stops matching the committed scores.
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
function score(stratum, slug, text) {
  if (stratum.startsWith('ref-')) {
    const g = gtOf(stratum, slug);
    const script = g.script === 'cjk' || g.script === 'chinese' ? 'cjk' : (g.script || 'latin');
    const r = scoreAgainstReference(g.ocr_ground_truth, text, script);
    return { aligned: r.aligned, cer: r3(r.charAccuracyWindowed == null ? null : 1 - r.charAccuracyWindowed) };
  }
  const ref = loadRefText(path.join(EVAL, 'benchmark', 'refs'), slug).text;
  return { aligned: true, cer: ref == null ? null : sealedCer(text, ref) };
}

// committed scores: stratum|slug|engine → engine cell
const scored = new Map();
for (const f of fs.readdirSync(path.join(RES, 'scored')).filter(f => /-\d{4}-\d{2}-\d{2}\.json$/.test(f) && !f.startsWith('summary'))) {
  const stratum = f.replace(/-\d{4}-\d{2}-\d{2}\.json$/, '');
  if (!STRATA.includes(stratum)) continue;
  for (const p of JSON.parse(fs.readFileSync(path.join(RES, 'scored', f), 'utf8')).pages) {
    for (const [e, c] of Object.entries(p.engines)) scored.set(`${stratum}|${p.slug}|${e}`, { ...c, has_ref: p.has_ref });
  }
}

const rows = [], control = { checked: 0, reproduced: 0, mismatches: [] };
for (const f of fs.readdirSync(RES).filter(f => /^outputs-.*\.jsonl$/.test(f)).sort()) {
  for (const line of fs.readFileSync(path.join(RES, f), 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(line);
    if (!STRATA.includes(o.stratum)) continue;
    const c = scored.get(`${o.stratum}|${o.slug}|${o.engine}`);
    if (!c || c.missing || c.refused || (!o.stratum.startsWith('ref-') && !c.has_ref)) continue;
    const stripped = stripPlanNote(o.text);
    if (stripped == null) {
      // control: an unchanged read must score exactly as committed
      const s = score(o.stratum, o.slug, o.text);
      control.checked++;
      const same = o.stratum.startsWith('ref-') ? s.aligned === !!c.aligned && (!s.aligned || s.cer === c.cer) : s.cer === c.cer;
      if (same) control.reproduced++; else control.mismatches.push(`${o.stratum}|${o.slug}|${o.engine}: ${c.cer} vs ${s.cer}`);
      continue;
    }
    const s = score(o.stratum, o.slug, stripped);
    rows.push({ page: `${o.stratum}|${o.slug}`, engine: o.engine, as_returned: { aligned: o.stratum.startsWith('ref-') ? !!c.aligned : true, cer: c.cer ?? null }, stripped: s });
  }
}
rows.sort((a, b) => a.page.localeCompare(b.page) || a.engine.localeCompare(b.engine));
console.log(`control: ${control.reproduced}/${control.checked} unchanged CLI reads reproduce the committed score`);
for (const m of control.mismatches.slice(0, 10)) console.log(`  mismatch ${m}`);
if (control.reproduced !== control.checked) { console.error('control failed: the copied normalisation does not match the scorer; nothing written'); process.exit(1); }
const json = JSON.stringify({ issue: 6386, generated_by: 'scripts/eval/ocr-pareto-6293/rescore-plan-note.mjs', strata: STRATA, control: { checked: control.checked, reproduced: control.reproduced }, rows }, null, 1) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== json) { console.error('plan-note-rescored.json is stale'); process.exit(1); }
  console.log('plan-note-rescored.json is current'); process.exit(0);
}
fs.writeFileSync(OUT, json);
const moved = rows.filter(r => r.stripped.cer !== r.as_returned.cer || r.stripped.aligned !== r.as_returned.aligned);
console.log(`${rows.length} reads carried the note; ${moved.length} scores moved; wrote ${path.relative(process.cwd(), OUT)}`);
