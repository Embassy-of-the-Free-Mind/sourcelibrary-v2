#!/usr/bin/env node
/**
 * Is the OCR reading the page, or generating plausible text?
 *
 * Two cheap agreement measures on the SAME image, needing no ground truth and
 * no human:
 *
 *   SELF  — one model, run twice. Measures determinism only.
 *   CROSS — two different models. Measures whether the image constrains the
 *           output. This is the one that matters.
 *
 * WHY BOTH, AND WHY CROSS IS THE REAL TEST. At temperature 0 a model is
 * near-deterministic, so SELF approaches 100% whether or not it read anything —
 * a *deterministic fabrication* still scores perfectly. Two different models,
 * however, do not share a fabrication mode: if both emit the same tokens, the
 * image is what they have in common. Never quote SELF alone as evidence of
 * correctness.
 *
 * Neither measure detects the case where both models recite the same memorised
 * canonical text (see /blog/reciting-not-reading). Agreement is a floor on
 * trustworthiness, never a ceiling.
 *
 * Calibration measured 2026-08-04: Latin CROSS ~77% (median of 3), Tibetan SELF
 * 6–26% at default temperature. Production OCR runs at temperature 0.1
 * (`pipeline-orchestrator.mjs`), so the sweep exists to separate sampling noise
 * from genuine instability.
 *
 *   set -a; source .env.production.local; set +a
 *   export GEMINI_API_KEY="$GEMINI_API_KEY_3"      # the default key is dead locally
 *   node scripts/eval/ocr-self-agreement.mjs --mode=temps      # temp sweep, 2 languages
 *   node scripts/eval/ocr-self-agreement.mjs --mode=languages  # ranking at production temp
 *
 * Cost: 2 calls per page per condition, on cheap models. A full run is cents.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const MODE = args.mode || 'languages';
const PAGES = parseInt(args.pages || '5');
const PROD_TEMP = 0.1;                       // what pipeline-orchestrator.mjs uses
const LITE = 'gemini-3.1-flash-lite-preview';
const FLASH = 'gemini-3-flash-preview';
const OUT = args.out || 'scripts/output/ocr-self-agreement';
const KEY = process.env.GEMINI_API_KEY;
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

const SWEEP_LANGS = (args.langs || 'Tibetan,Latin').split(',');
const RANK_LANGS = (args.langs || 'Latin,German,English,French,Greek,Italian,Dutch,Tibetan,Chinese,Sanskrit,Arabic,Hebrew').split(',');
const TEMPS = (args.temps || '0,0.1,1.0').split(',').map(Number);

async function gemini(model, parts, temperature) {
  for (let a = 1; a <= 4; a++) {
    const res = await fetch(`${API}/${model}:generateContent?key=${KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature, maxOutputTokens: 8192 } }),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 2500 * a)); continue; }
    const j = await res.json();
    if (j.error) throw new Error(`${model}: ${j.error.message?.slice(0, 90)}`);
    const c = j.candidates?.[0];
    return c?.content?.parts?.map(p => p.text).join('') || '';
  }
  throw new Error(`${model}: retries exhausted`);
}

const strip = t => (t || '')
  .replace(/<(meta|summary|keywords|vocab|language|scan-quality|script|page-type|columns|warning|image-desc)[^>]*>[\s\S]*?<\/\1>/gi, '')
  .replace(/<[^>]+>/g, '').trim();
// One tokenizer for every script. Tibetan separates syllables with tsheg (་) and
// clauses with shad (།); Latin scripts use spaces and punctuation. Splitting on
// both keeps the measure comparable across languages.
// Space-less scripts have no word delimiters, so whitespace tokenizing collapses
// a whole Chinese page into one or two giant tokens — every Chinese page in the
// first run was discarded as "thin" (n=0), which looked like missing data and was
// really this bug. Same class of error `revision-agreement-corpus.mjs` already
// solved with character-level comparison. Here: character TRIGRAMS, which keep
// the set-containment measure meaningful (unigrams would overlap by chance).
const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}]/u;
const isSpaceless = t => {
  const letters = (t || '').replace(/[^\p{L}]/gu, '').slice(0, 1500);
  if (!letters) return false;
  let n = 0; for (const ch of letters) if (SPACELESS.test(ch)) n++;
  return n / letters.length > 0.3;
};
const toks = (t) => {
  const clean = fold(strip(t).toLowerCase());
  if (isSpaceless(t)) {
    const ch = [...clean.replace(/[^\p{L}]/gu, '')];
    const out = new Set();
    for (let i = 0; i + 3 <= ch.length; i++) out.add(ch.slice(i, i + 3).join(''));
    return out;
  }
  return new Set(clean.split(/[\s་།༎༏,.;:!?()\[\]"'\-—–]+/).filter(x => x.length > 1 && /\p{L}/u.test(x)));
};
// CONTAINMENT (overlap coefficient), not Jaccard. Jaccard divides by the union,
// so it collapses when one model transcribes MORE of the page than the other —
// measured on a German index page, lite emitted 211 words to flash's 118 and 86
// of flash's 92 tokens appeared in lite (93% containment), yet Jaccard read 54%
// and the run labelled German "NOT READING". It was reading perfectly; the two
// models merely stopped at different points and spell `Salz`/`Saltz`, `&`/`et`.
// Containment asks the question we actually mean: of the text they BOTH
// produced, do they agree? Jaccard is kept alongside to expose length mismatch.
const overlap = (a, b) => {
  const inter = [...a].filter(x => b.has(x)).length;
  const m = Math.min(a.size, b.size);
  return m ? inter / m : null;
};
const jaccard = (a, b) => {
  const inter = [...a].filter(x => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : null;
};
// Fold the conventions that differ between models but mean the same glyph.
const fold = s => s.replace(/\u017f/g, 's').replace(/&/g, 'et')
  .replace(/\u00e6/g, 'ae').replace(/\u0153/g, 'oe')
  .normalize('NFD').replace(/\p{M}+/gu, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function main() {
  if (!KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000, socketTimeoutMS: 300000 });
  await client.connect();
  const db = client.db('bookstore');
  const pd = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
  if (!pd?.content) throw new Error('no default OCR prompt in DB');
  const promptFor = lang => pd.content.replace('{language_instruction}', `**Source language:** ${lang}.`);

  // Sample pages from DISTINCT books — one book's scans share a photographer,
  // a binding and a hand, so several pages from it is one observation, not five.
  async function samplePages(lang, n) {
    const books = await db.collection('books').find(
      { language: lang, pages_ocr: { $gt: 10 }, visible: true },
      { projection: { id: 1, title: 1 } },
    ).limit(60).toArray();
    const out = [];
    for (const b of books) {
      if (out.length >= n) break;
      const p = await db.collection('pages').findOne(
        { book_id: b.id, 'ocr.data': { $type: 'string' } },
        { projection: { id: 1, book_id: 1, archived_photo: 1, display_photo: 1, photo: 1 }, skip: 3 },
      );
      const u = p?.archived_photo || p?.display_photo || p?.photo;
      if (u) out.push({ id: p.id, book: b.title, url: u });
    }
    return out;
  }
  const imgCache = new Map();
  async function b64(url) {
    if (!imgCache.has(url)) {
      const r = await fetch(url);
      imgCache.set(url, Buffer.from(await r.arrayBuffer()).toString('base64'));
    }
    return imgCache.get(url);
  }

  const results = [];

  if (MODE === 'books') {
    // Within ONE language, per book. This is what separates a script/typeface
    // effect from a language effect: /blog/rashi-ocr found Gemini hallucinates on
    // Rashi (a PRINTED semi-cursive Hebrew typeface) while reading Arabic and
    // Sanskrit fine — same Unicode as square Hebrew, different glyphs, so the
    // model knows the language but not the letterforms. If that is the axis, the
    // split shows up BETWEEN books of one language, not between languages.
    const lang = args.lang || 'Hebrew';
    console.log(`PER-BOOK, language=${lang}, temperature ${PROD_TEMP}\n`);
    console.log(`  ${'book'.padEnd(42)} ${'SELF'.padStart(5)} ${'CROSS'.padStart(6)}`);
    console.log('  ' + '-'.repeat(58));
    const books = await db.collection('books').find(
      { language: lang, pages_ocr: { $gt: 10 }, visible: true },
      { projection: { id: 1, title: 1 } },
    ).limit(parseInt(args.books || '10')).toArray();
    for (const b of books) {
      const pgs = await db.collection('pages').find(
        { book_id: b.id, 'ocr.data': { $type: 'string' } },
        { projection: { id: 1, archived_photo: 1, display_photo: 1, photo: 1 } },
      ).skip(4).limit(PAGES).toArray();
      const selfs = [], crosses = []; let thin = 0;
      for (const p of pgs) {
        const u = p.archived_photo || p.display_photo || p.photo; if (!u) continue;
        try {
          const im = await b64(u);
          const parts = [{ text: promptFor(lang) }, { inline_data: { mime_type: 'image/jpeg', data: im } }];
          const a1 = await gemini(LITE, parts, PROD_TEMP); await sleep(350);
          const a2 = await gemini(LITE, parts, PROD_TEMP); await sleep(350);
          const f1 = await gemini(FLASH, parts, PROD_TEMP); await sleep(350);
          const A1 = toks(a1), A2 = toks(a2), F1 = toks(f1);
          if (A1.size < 15 || A2.size < 15) { thin++; continue; }
          selfs.push(overlap(A1, A2));
          if (F1.size >= 15) crosses.push(overlap(A1, F1));
        } catch (e) { thin++; }
      }
      const sv = median(selfs), cv = median(crosses);
      console.log(`  ${(b.title || '?').slice(0, 42).padEnd(42)} ${sv == null ? '  n/a' : (100 * sv).toFixed(0).padStart(4) + '%'} ${cv == null ? '   n/a' : (100 * cv).toFixed(0).padStart(5) + '%'}` +
        (thin ? `   (${thin} thin)` : ''));
      results.push({ mode: 'books', lang, book: b.title, book_id: b.id, n: selfs.length, self_median: sv, cross_median: cv });
    }
    console.log('\n  A split BETWEEN books of one language is a typeface effect, not a language effect.');
  } else if (MODE === 'temps') {
    console.log(`TEMPERATURE SWEEP — self-agreement (same model twice), ${LITE}`);
    console.log(`production OCR runs at temperature ${PROD_TEMP}\n`);
    console.log(`  ${'language'.padEnd(10)} ${'temp'.padStart(5)}  ${'self-agreement (median of ' + PAGES + ')'.padEnd(30)}`);
    for (const lang of SWEEP_LANGS) {
      const pages = await samplePages(lang, PAGES);
      for (const t of TEMPS) {
        const vals = [], skipped = [];
        for (const p of pages) {
          try {
            const im = await b64(p.url);
            const parts = [{ text: promptFor(lang) }, { inline_data: { mime_type: 'image/jpeg', data: im } }];
            // Sequential, not Promise.all: parallel image calls trip 429s, and
            // the retry then eats the whole page. Slower, but n stops collapsing.
            const x = await gemini(LITE, parts, t);
            await sleep(400);
            const y = await gemini(LITE, parts, t);
            const a = toks(x), b = toks(y);
            if (a.size < 15 || b.size < 15) { skipped.push(`${p.id}: thin(${a.size}/${b.size})`); continue; }
            vals.push(overlap(a, b));
          } catch (e) { skipped.push(`${p.id}: ${e.message.slice(0, 50)}`); }
        }
        const m = median(vals);
        console.log(`  ${lang.padEnd(10)} ${String(t).padStart(5)}  ${m == null ? 'n/a' : (100 * m).toFixed(0) + '%'} (n=${vals.length})` +
          (skipped.length ? `   dropped ${skipped.length}: ${skipped[0]}` : ''));
        results.push({ mode: 'temps', lang, temp: t, n: vals.length, self_median: m });
      }
    }
    console.log('\n  Self-agreement rising with lower temperature is sampling noise, not reading.');
    console.log('  A deterministic fabrication scores 100% here — see --mode=languages for the real test.');
  } else {
    console.log(`LANGUAGE RANKING at production temperature ${PROD_TEMP}`);
    console.log(`  SELF  = ${LITE} twice  (determinism only)`);
    console.log(`  CROSS = ${LITE} vs ${FLASH}  (does the image constrain the output?)\n`);
    console.log(`  ${'language'.padEnd(11)} ${'n'.padStart(3)}  ${'SELF'.padStart(6)}  ${'CROSS'.padStart(6)}   verdict`);
    console.log('  ' + '-'.repeat(58));
    for (const lang of RANK_LANGS) {
      const pages = await samplePages(lang, PAGES);
      const selfs = [], crosses = [], skipped = [];
      for (const p of pages) {
        try {
          const im = await b64(p.url);
          const parts = [{ text: promptFor(lang) }, { inline_data: { mime_type: 'image/jpeg', data: im } }];
          const a1 = await gemini(LITE, parts, PROD_TEMP); await sleep(400);
          const a2 = await gemini(LITE, parts, PROD_TEMP); await sleep(400);
          const f1 = await gemini(FLASH, parts, PROD_TEMP); await sleep(400);
          const A1 = toks(a1), A2 = toks(a2), F1 = toks(f1);
          if (A1.size < 15 || A2.size < 15) { skipped.push(`${p.id}: thin`); continue; }
          selfs.push(overlap(A1, A2));
          if (F1.size >= 15) crosses.push(overlap(A1, F1));
        } catch (e) { skipped.push(`${p.id}: ${e.message.slice(0, 45)}`); }
      }
      if (skipped.length) console.log(`  ${''.padEnd(11)}     dropped ${skipped.length}: ${skipped[0]}`);
      const s = median(selfs), c = median(crosses);
      // Thresholds are calibrated on this corpus, not universal: Latin CROSS
      // sits ~77%, Tibetan self-agreement ran 6-26%. Treat as triage, not truth.
      // Read SELF and CROSS together. Low SELF is the fabrication signature —
      // the model is not constrained by the image at all. High SELF with lowish
      // CROSS is convention divergence between models, which is harmless.
      const verdict = c == null || s == null ? 'no data'
        : s < 0.6 ? 'NOT READING — output is not image-driven'
        : c >= 0.75 ? 'reading'
        : c >= 0.5 ? 'reading (models differ on convention/extent)'
        : 'suspect — inspect before spending';
      console.log(`  ${lang.padEnd(11)} ${String(selfs.length).padStart(3)}  ${s == null ? '   n/a' : (100 * s).toFixed(0).padStart(5) + '%'}  ${c == null ? '   n/a' : (100 * c).toFixed(0).padStart(5) + '%'}   ${verdict}`);
      results.push({ mode: 'languages', lang, n: selfs.length, self_median: s, cross_median: c, verdict });
    }
    console.log('\n  CROSS is the column to act on. High SELF with low CROSS = confident fabrication.');
  }

  const f = path.join(OUT, `${MODE}-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(f, JSON.stringify({ date: new Date().toISOString(), mode: MODE, prompt_version: pd.version, results }, null, 2));
  console.log(`\n  → ${f}`);
  await client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
