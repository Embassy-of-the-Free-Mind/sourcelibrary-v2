#!/usr/bin/env node
/**
 * Does the Tier-1 prompt change reduce UNATTRIBUTED AI prose? (#3444)
 *
 * Tier 1 is two edits to the OCR prompt, no new tags and no data migration:
 * regroup the annotation list by PROVENANCE ("from the page" vs "written by
 * you"), and sharpen `<insert>` so a map's cartouche labels read as
 * transcription rather than commentary. The second edit already has a
 * demonstrated win — it fixed the #3437 reader bug, where the Notes toggle
 * deleted map labels and blanked atlas pages.
 *
 * WHY THIS RUN EXISTS. That win was measured on TWO pages of ONE failure class
 * (cartouche labels on a Chinese map): 6/6 against 0/6. An existence proof
 * cannot support a general claim, and #3450 recorded it as such. This runs the
 * same comparison across the 19 failure classes of the v0.4-difficulty corpus,
 * which is what that corpus was built for.
 *
 * THE METRIC IS REFERENCE-FREE, because it has to be. Hard pages have no
 * scholarly etext (that is what makes them hard), so accuracy scoring is
 * unavailable — see ../dataset/v0.4-difficulty/README.md. What IS observable
 * without ground truth is whether model-authored prose carries a tag:
 *
 *   unattributed span = AI-authored text sitting OUTSIDE every annotation tag
 *
 * A reader's Notes toggle can only hide what is tagged. Untagged commentary is
 * indistinguishable from the book's own words — it renders as transcription and
 * is quotable as transcription, which is the #2232 misquote failure in a new
 * costume.
 *
 * WHAT THIS CANNOT SEE, restated because it is load-bearing: fabrication. A
 * model that silently reconstructs a passage it cannot read emits no marker at
 * all, so it scores PERFECTLY here. Four prompt interventions aimed at that
 * failure were tested and all four failed (#3444 Tier 3) — the model has no
 * signal distinguishing "I read this" from "I completed this". Measuring it
 * needs the synthetic cloze probe, not this script.
 *
 * Usage:
 *   node scripts/eval/tier1-attribution.mjs --dry-run
 *   node scripts/eval/tier1-attribution.mjs --model=lite --arms=B,E [--limit=N]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runModel, resolveModel, fetchImage } from './lib/runners.mjs';
import { priceFor } from '../lib/model-pricing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));

const CORPUS = args.corpus || path.join(__dirname, 'dataset/v0.4-difficulty/pages.jsonl');
const PROMPT_DIR = path.join(__dirname, 'prompts/ablation');
const ARMS = {
  // NOT production — a v10-era file. The 2026-08-01 run used it as the
  // baseline and its results are therefore about a prompt we do not run.
  // Use scripts/eval/blank-page-study.mjs's P arm, or arm P of
  // prompt-ablation.mjs, for a live baseline.
  B: { prompt: 'B-v10-legacy.txt', label: 'v10-legacy (NOT production)' },
  E: { prompt: 'E-tier1-provenance.txt', label: 'Tier 1 (provenance grouping + sharpened <insert>)' },
};

/** Every tag the prompt may legitimately emit. Content inside these is attributed. */
const TAGGED = /<(language|page-type|columns|page-num|header|sig|meta|warning|vocab|margin|gloss|insert|unclear|note|term|image-desc|detected-images|column-break)[^>]*>[\s\S]*?<\/\1>/gi;
const SELF_CLOSING = /<[^>]+\/>/g;

/**
 * Markers of model-authored prose. Deliberately conservative — each is
 * something a 15th-century printer could not have set in type.
 */
const AI_MARKERS = [
  ['markdown_label', /\*\*[^*\n]{2,60}\*\*/g],                 // **Top Section**, **Section 1**
  ['stage_direction', /[(\[](?:top|bottom|left|right|upper|lower|middle|centre|center|first|second|continued|cont\.)[^)\]\n]{0,40}[)\]]/gi],
  ['meta_commentary', /\b(?:I (?:have|will|cannot|can't|am)\b|the image (?:shows|depicts|contains)|this page (?:shows|contains|appears)|appears to be|it is (?:unclear|likely)|note that|transcription (?:of|follows|below)|the text is in|no (?:visible )?text)/gi],
  ['translator_note', /\b(?:Note|Translator's note|Editor's note|N\.B\.)\s*:/g],
];

function unattributedText(out) {
  return (out || '')
    .replace(TAGGED, ' ')
    .replace(SELF_CLOSING, ' ')
    .replace(/<[^>]+>/g, ' ')   // orphan/unclosed tags: drop the tag, KEEP its text
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns { total, byKind:{}, samples:[] } for AI-authored spans left untagged. */
export function scoreUnattributed(out) {
  const bare = unattributedText(out);
  const byKind = {};
  const samples = [];
  let total = 0;
  for (const [kind, re] of AI_MARKERS) {
    const hits = bare.match(new RegExp(re.source, re.flags)) || [];
    if (hits.length) {
      byKind[kind] = hits.length;
      total += hits.length;
      for (const h of hits.slice(0, 2)) samples.push(`${kind}: ${h.slice(0, 60)}`);
    }
  }
  return { total, byKind, samples, bare_chars: bare.length };
}

/** Did the arm still transcribe the page? A prompt that suppresses prose to
 *  score well on attribution would be a regression, not a win. */
function bodyChars(out) {
  return (out || '').replace(TAGGED, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
}

async function main() {
  const rows = fs.readFileSync(CORPUS, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const limit = args.limit ? parseInt(args.limit, 10) : rows.length;
  const pages = rows.slice(0, limit);
  const armKeys = (args.arms || 'B,E').split(',').map(s => s.trim().toUpperCase());
  const model = resolveModel(args.model || 'lite');

  const prompts = {};
  for (const k of armKeys) prompts[k] = fs.readFileSync(path.join(PROMPT_DIR, ARMS[k].prompt), 'utf8');

  const calls = pages.length * armKeys.length;
  // Measured medians from gemini_usage single-page OCR (n=1500), not the
  // library's generic guess: 3,272 input / 444 output.
  const P = priceFor(model);
  const usd = calls * (3272 / 1e6 * P.input + 444 / 1e6 * P.output);
  console.log(`\n  Tier-1 attribution study — ${pages.length} hard pages × ${armKeys.length} arms on ${model}`);
  console.log(`  ${calls} model calls, ~$${usd.toFixed(2)}\n`);
  if (args['dry-run']) { console.log('  (dry run — no API calls made)\n'); return; }

  // CHECKPOINT EVERY PAGE. This run costs real money, and the first attempt
  // buffered everything in memory and wrote once at the end — it was killed at
  // ~80/334 and every paid call was lost. Same shape as the 2026-07-19 incident
  // that destroyed ~96 rows of paid eval output. Append as we go, and skip
  // pages already present so a re-run resumes instead of re-buying them.
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = path.join(__dirname, `results/tier1-attribution-${stamp}.jsonl`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const results = [];
  const alreadyDone = new Set();
  if (fs.existsSync(outPath)) {
    for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        results.push(r);
        alreadyDone.add(r.page.page_id);
      } catch { /* truncated final line from a kill — ignore it */ }
    }
    if (alreadyDone.size) console.log(`  resuming: ${alreadyDone.size} page(s) already scored\n`);
  }

  let done = alreadyDone.size;
  for (const page of pages) {
    if (alreadyDone.has(page.page_id)) continue;
    let row;
    try {
      const buf = await fetchImage(page.image.url);
      row = { page, arms: {} };
      for (const k of armKeys) {
        try {
          const res = await runModel(model, buf, prompts[k], { maxTokens: 16000 });
          const text = res.text || '';
          // KEEP THE RAW TEXT. The first version of this stored only derived
          // scores, and the run then answered the wrong question: the metric
          // counts AI prose emitted BARE, while the #3437 bug Tier 1 actually
          // fixes is the opposite direction — page text wrongly placed INSIDE
          // <note>, so the reader's Notes toggle deletes it. Re-scoring for
          // that needed the artifact, which no longer existed, so the whole
          // $0.25 had to be re-bought. prompt-ablation.mjs already says it:
          // "scoring can be redone offline, model calls cannot."
          row.arms[k] = {
            ...scoreUnattributed(text), body_chars: bodyChars(text), chars: text.length,
            text,
          };
        } catch (e) {
          row.arms[k] = { error: e.message };
        }
      }
    } catch (e) {
      row = { page, error: `image fetch failed: ${e.message}` };
    }
    fs.appendFileSync(outPath, JSON.stringify(row) + '\n');
    results.push(row);
    done++;
    if (done % 10 === 0) console.log(`    ${done}/${pages.length} pages`);
  }

  report(results, armKeys);
  console.log(`  raw output → ${path.relative(process.cwd(), outPath)}\n`);
}

function report(results, armKeys) {
  const ok = results.filter(r => r.arms && armKeys.every(k => r.arms[k] && !r.arms[k].error));
  console.log(`\n  Scored ${ok.length} of ${results.length} pages\n`);
  console.log('  arm  pages with ≥1 untagged AI span   total spans   median body chars');
  for (const k of armKeys) {
    const withSpan = ok.filter(r => r.arms[k].total > 0).length;
    const total = ok.reduce((n, r) => n + r.arms[k].total, 0);
    const bodies = ok.map(r => r.arms[k].body_chars).sort((a, b) => a - b);
    const med = bodies[Math.floor(bodies.length / 2)] ?? 0;
    const pct = ok.length ? (100 * withSpan / ok.length).toFixed(1) : '0.0';
    console.log(`   ${k}   ${String(withSpan).padStart(4)} / ${ok.length}  (${pct}%)          ${String(total).padStart(6)}        ${String(med).padStart(6)}`);
  }

  // Per class — the whole reason for using the difficulty corpus rather than
  // the two pages the original claim rested on.
  const byClass = new Map();
  for (const r of ok) {
    for (const d of r.page.difficulty) {
      if (!byClass.has(d)) byClass.set(d, []);
      byClass.get(d).push(r);
    }
  }
  console.log('\n  by difficulty class (pages with ≥1 untagged AI span)');
  const head = armKeys.map(k => k.padStart(7)).join('');
  console.log(`    ${'class'.padEnd(20)}${head}    n`);
  for (const [cls, rs] of [...byClass.entries()].sort()) {
    const cells = armKeys.map(k => {
      const w = rs.filter(r => r.arms[k].total > 0).length;
      return `${w}/${rs.length}`.padStart(7);
    }).join('');
    console.log(`    ${cls.padEnd(20)}${cells}  ${String(rs.length).padStart(4)}`);
  }

  const errs = results.filter(r => r.error || (r.arms && armKeys.some(k => r.arms[k]?.error)));
  if (errs.length) console.log(`\n  ${errs.length} page(s) errored (image fetch or model call)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
}
