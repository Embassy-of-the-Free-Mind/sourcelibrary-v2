#!/usr/bin/env node
/**
 * Non-generative OCR baseline → difference-in-differences subsidy (#3235).
 *
 * THE POINT: every accuracy number in this project is VLM-against-reference, so
 * page difficulty and memorization stay entangled and the paper caveats the
 * confound rather than removing it. Tesseract is a pattern-matching engine with
 * no language model over the passage — **it cannot recite**. So it absorbs page
 * difficulty and nothing else, and the subsidy is identified by a difference of
 * differences instead of asserted:
 *
 *     subsidy = (VLM − tesseract)|canonical − (VLM − tesseract)|non-canonical
 *
 * A VLM that merely READS well beats Tesseract by roughly the same margin on
 * canonical and non-canonical pages. A VLM that RECITES beats it by more on
 * canonical pages specifically — and that excess is the memorization subsidy,
 * measured without needing the reference text to be uncontaminated.
 *
 * Tesseract will score badly on 16th-c type. That is fine and expected: badly
 * *in a way that cannot recite* is the required property, not accuracy.
 *
 * Cost: $0. Local binary, local compute, no API calls.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/tesseract-baseline.mjs [--psm=3] [--only=slug]
 */
import { MongoClient } from 'mongodb';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPageSource } from '../lib/page-image-url.mjs';
import { scoreAgainstReference } from './lib/metrics.mjs';

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const PSM = args.psm || '3';
const DATE = new Date().toISOString().slice(0, 10);
const OUT = path.join(__dirname, 'results', `tesseract-baseline-${DATE}.json`);
const REPORT = path.join(__dirname, 'results', `tesseract-baseline-${DATE}.md`);

// script/language → tessdata language. Deliberately generous: if the baseline is
// handicapped by a bad language pack the difference-in-differences is still valid
// (the handicap applies equally to canonical and non-canonical pages of the same
// script), but per-cell accuracy would be uninterpretable.
const TESS_LANG = {
  latin: 'lat', greek: 'grc', hebrew: 'heb', armenian: 'hye',
  cjk: 'chi_tra', chinese: 'chi_tra', tibetan: 'bod', sanskrit: 'san',
  arabic: 'ara', persian: 'fas', english: 'eng',
};
const langFor = gt => TESS_LANG[(gt.script || '').toLowerCase()]
  || TESS_LANG[(gt.language || '').toLowerCase().replace(/^(ancient|classical|middle)\s+/, '')]
  || 'eng';

const gtDir = path.join(__dirname, 'ground-truth');
const gts = fs.readdirSync(gtDir).filter(f => f.endsWith('.json'))
  .map(f => ({ slug: f.replace('.json', ''), ...JSON.parse(fs.readFileSync(path.join(gtDir, f), 'utf8')) }))
  .filter(g => g.ocr_ground_truth && (!args.only || g.slug === args.only));

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const PAGES = client.db(process.env.MONGODB_DB || 'bookstore').collection('pages');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessbase-'));
const rows = [];

for (const gt of gts) {
  const page = await PAGES.findOne({ book_id: gt.book_id, page_number: gt.page_number });
  const url = page ? getPageSource(page) : null;
  if (!url) { console.log(`  SKIP ${gt.slug} — no usable page image`); continue; }

  const imgPath = path.join(tmp, `${gt.slug}.img`);
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    fs.writeFileSync(imgPath, Buffer.from(await resp.arrayBuffer()));
  } catch (e) { console.log(`  SKIP ${gt.slug} — image fetch failed: ${e.message}`); continue; }

  const lang = langFor(gt);
  let text = '';
  const t0 = Date.now();
  try {
    const { stdout } = await exec('tesseract', [imgPath, 'stdout', '-l', lang, '--psm', String(PSM)],
      { maxBuffer: 32 * 1024 * 1024 });
    text = stdout;
  } catch (e) {
    console.log(`  FAIL ${gt.slug} (lang=${lang}): ${String(e.message).slice(0, 90)}`);
    continue;
  }
  const secs = (Date.now() - t0) / 1000;

  const s = scoreAgainstReference(gt.ocr_ground_truth, text, gt.script || 'cjk');
  const pc = gt.page_class || {};
  rows.push({
    slug: gt.slug, engine: 'tesseract-5.5.2', lang, psm: String(PSM),
    script: gt.script, language: gt.language,
    canonical: pc.canonical_text !== false,
    memorization_risk: pc.memorization_risk ?? gt.memorization_risk ?? null,
    source_class: pc.source_class ?? null,
    aligned: s.aligned, char_accuracy: +(s.charAccuracy ?? 0).toFixed(4),
    guard_value: +(s.guard?.value ?? NaN).toFixed(4),
    ref_chars: gt.ocr_ground_truth.length, out_chars: text.length, seconds: +secs.toFixed(1),
  });
  console.log(`  ${gt.slug.padEnd(38)} lang=${lang.padEnd(8)} acc=${(s.charAccuracy * 100).toFixed(1).padStart(5)}%  aligned=${s.aligned}  ${secs.toFixed(1)}s`);
}
await client.close();
fs.rmSync(tmp, { recursive: true, force: true });

// ── difference-in-differences against the VLM observations ───────
const obsPath = path.join(__dirname, 'observations', 'ocr-observations-2026-07-19.jsonl');
const obs = fs.existsSync(obsPath)
  ? fs.readFileSync(obsPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const baseBySlug = new Map(rows.map(r => [r.slug, r]));
const mean = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
const pp = x => (x * 100).toFixed(1);

// WITHIN SCRIPT ONLY. Pooling across scripts destroys the design: in this set every
// Chinese page is canonical and Tesseract scores 0-13% on woodblock CJK, while the
// non-canonical set is mostly Latin/Greek where it scores 88-97%. Pooled, "canonical"
// stands in for "CJK" and the difference-in-differences reports script composition as
// memorization (it read 34-73pp that way). The baseline's handicap only cancels
// between pages it handicaps equally — i.e. within one script.
const perModelScript = new Map();   // model -> script -> {canon, noncanon}
for (const o of obs) {
  const b = baseBySlug.get(o.slug);
  if (!b || typeof o.char_accuracy_raw !== 'number') continue;
  const canonical = (o.page_class?.canonical_text) !== false;
  const sc = b.script || 'unknown';
  if (!perModelScript.has(o.model)) perModelScript.set(o.model, new Map());
  const byScript = perModelScript.get(o.model);
  if (!byScript.has(sc)) byScript.set(sc, { canon: [], noncanon: [] });
  byScript.get(sc)[canonical ? 'canon' : 'noncanon'].push(o.char_accuracy_raw - b.char_accuracy);
}
// A script contributes only if it has BOTH kinds of page.
const scriptsWithContrast = new Set();
for (const byScript of perModelScript.values())
  for (const [sc, d] of byScript) if (d.canon.length && d.noncanon.length) scriptsWithContrast.add(sc);
const perModel = new Map();
for (const [model, byScript] of perModelScript) {
  const deltas = [];
  for (const [sc, d] of byScript) {
    if (!d.canon.length || !d.noncanon.length) continue;
    deltas.push({ script: sc, subsidy: mean(d.canon) - mean(d.noncanon), nc: d.canon.length, nn: d.noncanon.length });
  }
  if (deltas.length) perModel.set(model, deltas);
}

const lines = [];
const say = s => { lines.push(s); console.log(s); };
say(`\n# Non-generative baseline — difference-in-differences (${DATE})`);
say('');
say('Tesseract 5.5.2, local, $0. It cannot recite, so it absorbs page difficulty and');
say('nothing else. The subsidy is the DIFFERENCE of two differences:');
say('');
say('    subsidy = (VLM − tesseract)|canonical − (VLM − tesseract)|non-canonical');
say('');
say('A VLM that merely reads well beats the baseline equally on both. A VLM that recites');
say('beats it by MORE on canonical pages — that excess is the memorization subsidy, and it');
say('does not require the reference text to be uncontaminated.');
say('');
say(`## Baseline accuracy (n=${rows.length} pages)`);
say('');
say(`Mean char accuracy **${pp(mean(rows.map(r => r.char_accuracy)))}%**, aligned on ${rows.filter(r => r.aligned).length}/${rows.length}.`);
say('Low is expected and not a defect — the required property is inability to recite, not accuracy.');
say('');
say('| page | lang | canonical | source | acc | aligned |');
say('|---|---|---|---|---:|---|');
for (const r of [...rows].sort((a, b) => a.char_accuracy - b.char_accuracy)) {
  say(`| ${r.slug} | ${r.lang} | ${r.canonical ? 'canonical' : 'non-canon'} | ${r.source_class || '?'} | ${pp(r.char_accuracy)}% | ${r.aligned ? 'yes' : 'no'} |`);
}

if (perModel.size) {
  say('');
  say('## Difference-in-differences by model');
  say('');
  say(`Computed WITHIN script and averaged across scripts, giving each script equal weight.`);
  say(`Scripts carrying a canonical/non-canonical contrast: **${[...scriptsWithContrast].sort().join(', ')}**.`);
  say(`Chinese is EXCLUDED — all six CJK pages here are canonical, so it offers no contrast`);
  say(`and pooling it in reports the baseline's CJK collapse as memorization.`);
  say('');
  const scripts = [...scriptsWithContrast].sort();
  say('| model | ' + scripts.map(s => `${s} subsidy`).join(' | ') + ' | **mean (equal-weight)** |');
  say('|---|' + scripts.map(() => '---:').join('|') + '|---:|');
  for (const [model, deltas] of [...perModel.entries()].sort()) {
    const by = new Map(deltas.map(d => [d.script, d]));
    const cells = scripts.map(s => by.has(s) ? `${pp(by.get(s).subsidy)}pp` : '—');
    say(`| ${model} | ${cells.join(' | ')} | **${pp(mean(deltas.map(d => d.subsidy)))}pp** |`);
  }
  say('');
  say('Positive subsidy = the VLM outruns the non-reciting baseline by more on canonical');
  say('pages. Negative = the canonical pages are simply harder, and the pooled canonical-gap');
  say('numbers were measuring page difficulty rather than memorization.');
}
say('');
say('**The pooled version of this table is invalid** and is not shown: canonical/non-canonical');
say('is confounded with script in this page set, so an across-script difference-in-differences');
say('reports composition. Within-script is the only valid form, which costs most of the sample.');
say('');
say('**Caveats.** Tesseract language packs vary in quality by script; a weak pack handicaps');
say('the baseline, but the handicap applies equally to canonical and non-canonical pages of');
say('the SAME script, so the difference-in-differences survives while per-cell accuracy does');
say('not. Cells are TINY once restricted to within-script contrasts — often one canonical page');
say('against two or three non-canonical ones. Read the SIGN, treat magnitudes as provisional,');
say('and note that Greek\'s only canonical page is a manuscript while its non-canonical pages');
say('are print, so within-Greek still confounds source class with canonicity.');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ date: DATE, engine: 'tesseract-5.5.2', psm: String(PSM), rows }, null, 1));
fs.writeFileSync(REPORT, lines.join('\n') + '\n');
console.log(`\nSaved → ${OUT}\n        ${REPORT}`);
