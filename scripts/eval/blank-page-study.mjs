#!/usr/bin/env node
/**
 * Does the model transcribe a page that has nothing on it? (#3444 Tier 2)
 *
 * THE CLEANEST REFERENCE-FREE TEST WE HAVE. A leaf whose only visible marks are
 * show-through from the reverse is BLANK — nothing is printed on that side. The
 * correct output is therefore fully determined without any ground truth:
 *
 *     <page-type>blank</page-type> + a <warning>, and ZERO transcribed body text.
 *
 * Any body text is an error, and the error is measurable exactly. No etext, no
 * second model, no agreement heuristic. Contrast the attribution metric in
 * tier1-attribution.mjs, which cannot see this failure at all: text invented for
 * a blank page carries no marker and scores a perfect zero there.
 *
 * WHY THE BASELINE IS `P-production-v15.txt` AND NOT `B-current.txt`.
 * B-current.txt is a stale reconstruction — roughly v10-era. Diffed against the
 * live prompt (Mongo `prompts`, type:'ocr', is_default:true, version 15) it is
 * missing ~2,800 characters including the entire **Output contract** block, the
 * instruction added in #3108 that forbids untagged commentary. An ablation that
 * calls it "current production" is not measuring production. It produced 47,813
 * characters on a blank page where real stored production OCR produced 11.
 * P-production-v15.txt is the live prompt, pulled verbatim from the DB.
 *
 * WHAT THE PAGES ARE. The 39 `blank_page` rows of the v0.4-difficulty corpus,
 * whose OCR declares <page-type>blank</page-type>. Two were verified by eye: a
 * title-page verso carrying mirrored bleed-through ("DISQUISITIO MEDICA" legible
 * in reverse) and an Arabic MS leaf whose faint marks sit in the same layout
 * positions as the densely-written adjacent leaf. The label is correct on both.
 *
 * Usage:
 *   node scripts/eval/blank-page-study.mjs --dry-run
 *   node scripts/eval/blank-page-study.mjs --model=lite --arms=P,T2
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
  P:  { prompt: 'P-production-v15.txt', label: 'live production prompt v15' },
  T2: { prompt: 'T2-bleedthrough.txt',  label: 'v15 + Tier 2 bleed-through instruction' },
};

/** Tags whose contents are legitimately not body text. */
const TAGGED = /<(language|page-type|columns|page-num|header|sig|meta|warning|vocab|margin|gloss|insert|unclear|note|term|image-desc|detected-images|scan-quality|script|column-break)[^>]*>[\s\S]*?<\/\1>/gi;

/** Body text = what would render to a reader as the page's own words. */
export function bodyText(out) {
  return (out || '')
    .replace(TAGGED, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Did it correctly declare the page blank? */
export function declaredBlank(out) {
  return /<page-type>\s*blank\s*<\/page-type>/i.test(out || '');
}

/** Repetition loop, so a degenerate `[...]` run is not scored as "transcription". */
export function loopCoverage(s) {
  if (!s || s.length < 400) return 0;
  const seen = new Set(); let n = 0;
  for (let i = 0; i + 24 <= s.length; i++) { seen.add(s.slice(i, i + 24)); n++; }
  return n ? 1 - seen.size / n : 0;
}

async function main() {
  const rows = fs.readFileSync(CORPUS, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const pages = rows.filter(r => (r.difficulty || []).includes('blank_page'));
  const armKeys = (args.arms || 'P,T2').split(',').map(s => s.trim());
  const model = resolveModel(args.model || 'lite');
  const prompts = {};
  for (const k of armKeys) prompts[k] = fs.readFileSync(path.join(PROMPT_DIR, ARMS[k].prompt), 'utf8');

  const calls = pages.length * armKeys.length;
  const P = priceFor(model);
  console.log(`\n  Blank-page study — ${pages.length} pages × ${armKeys.length} arms on ${model}`);
  console.log(`  ${calls} calls, ~$${(calls * (3272 / 1e6 * P.input + 444 / 1e6 * P.output)).toFixed(3)}\n`);
  for (const k of armKeys) console.log(`    ${k.padEnd(3)} ${ARMS[k].label}`);
  if (args['dry-run']) { console.log('\n  (dry run — no API calls)\n'); return; }

  const stamp = new Date().toISOString().slice(0, 10);
  const out = path.join(__dirname, `results/blank-page-study-${stamp}.jsonl`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const done = new Set();
  if (fs.existsSync(out)) {
    for (const l of fs.readFileSync(out, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { done.add(JSON.parse(l).page_id); } catch { /* truncated tail */ }
    }
    if (done.size) console.log(`\n  resuming: ${done.size} already scored`);
  }

  let n = done.size;
  for (const p of pages) {
    if (done.has(p.page_id)) continue;
    const row = { page_id: p.page_id, reader_url: p.reader_url, language: p.book.language, arms: {} };
    try {
      const buf = await fetchImage(p.image.url);
      for (const k of armKeys) {
        try {
          const res = await runModel(model, buf, prompts[k], { maxTokens: 16000 });
          const t = res.text || '';
          const body = bodyText(t);
          // Keep the raw text. Storing only scores is what forced a re-buy of
          // the Tier-1 run when the question changed.
          row.arms[k] = {
            body_chars: body.length, declared_blank: declaredBlank(t),
            loop: +loopCoverage(body).toFixed(4), total_chars: t.length,
            body_head: body.slice(0, 120), text: t,
          };
        } catch (e) { row.arms[k] = { error: e.message }; }
      }
    } catch (e) { row.error = `image fetch failed: ${e.message}`; }
    fs.appendFileSync(out, JSON.stringify(row) + '\n');
    n++;
    if (n % 5 === 0) console.log(`    ${n}/${pages.length}`);
  }
  console.log(`\n  raw → ${path.relative(process.cwd(), out)}\n`);
  report(out, armKeys);
}

export function report(file, armKeys) {
  const rows = [];
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { rows.push(JSON.parse(l)); } catch { /* truncated */ }
  }
  const ok = rows.filter(r => r.arms && armKeys.every(k => r.arms[k] && !r.arms[k].error));
  const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  console.log(`  ${ok.length} pages scored on all arms.  Correct behaviour = 0 body chars + page-type blank\n`);
  console.log('  arm  declared blank   transcribed >50   transcribed >500   median chars   looped');
  for (const k of armKeys) {
    const db = ok.filter(r => r.arms[k].declared_blank).length;
    const t50 = ok.filter(r => r.arms[k].body_chars > 50).length;
    const t500 = ok.filter(r => r.arms[k].body_chars > 500).length;
    const lp = ok.filter(r => r.arms[k].loop >= 0.5).length;
    console.log(`   ${k.padEnd(3)}   ${String(db).padStart(3)}/${ok.length}         ${String(t50).padStart(3)}/${ok.length}            ${String(t500).padStart(3)}/${ok.length}         ${String(med(ok.map(r => r.arms[k].body_chars))).padStart(6)}       ${String(lp).padStart(3)}/${ok.length}`);
  }
  console.log();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (args.report) { report(args.report, (args.arms || 'P,T2').split(',')); }
  else main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
}
