#!/usr/bin/env node
// PRIOR ART: scripts/lib/translate-batch-chained.mjs — the lane that produced the served Tengyur
// pilot English (#5497): blocks of 8, chained on the previous page's stored translation, one
// `<translation page="N">` per page. This harness sends the SAME prompt builder
// (translate-core buildBlockTranslationPrompt) with the one new option `folioMarkers` and the
// chain fed from its own output, realtime through gemini-script-client (60 pages do not need a
// Batch round trip). scripts/eval/translation-batch-continuity-ab.mjs — the seam A/B harness; it
// judges with a model, this one measures marker placement against the source and is read by eye.
/**
 * folio-markers-5678 — continuous English with `<pb n="N"/>` page markers, on the Tengyur pilot.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/folio-markers-5678.mjs run
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/folio-markers-5678.mjs check
 *
 * `run` translates each stretch in chained blocks of up to 8 pages and writes one JSON per block
 * (the raw response) and one per page to scripts/eval/results/folio-markers-5678/. It resumes:
 * a block whose file exists is not sent again. Spend is held under the `folio-markers-5678`
 * envelope ($3) — checked against the meter before every call. NO writes to `pages` or `books`.
 *
 * `check` ($0) compares, at every in-block page turn, where the marker falls in the English
 * (share of English characters before it, notes removed) with where the page turns in the source
 * (share of Tibetan syllables before it), and the same measure on the served pilot English (its
 * per-page lengths), and writes check.json.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import {
  loadTranslationPrompts, buildBlockTranslationPrompt, LEAF_BREAK_ONLY, SAFETY_SETTINGS, MODEL_FLASH,
} from '../lib/translate-core.mjs';
import { maxOutputTokensFor } from '../lib/translate-batch-seam.mjs';
import { parseFolioMarkedText } from '../lib/folio-markers.mjs';
import { callGemini } from '../lib/gemini-script-client.mjs';
import { getScopeSpendUsd } from '../lib/spend-guard.mjs';
import { costOf } from '../lib/model-pricing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'results', 'folio-markers-5678');
const ENDPOINT = 'scripts/eval/folio-markers-5678.mjs';
const SCOPE = 'folio-markers-5678';
const BUDGET_USD = 3;
const BLOCK = 8;
const MODEL = MODEL_FLASH; // gemini-3-flash-preview, the pilot's model

// The brief's stretches (#5678), widened at the ends to ~60 pages so every known-bad turn is
// INSIDE a block (a block's first marker is trivially at 0 and measures nothing).
export const STRETCHES = [
  { vol: 96, book_id: '6abeb158896ea18127c82682', from: 28, to: 43, known: [34, 35] },
  { vol: 96, book_id: '6abeb158896ea18127c82682', from: 113, to: 124, known: [119] },
  { vol: 113, book_id: '6abeb583896ea18127c84e6f', from: 116, to: 126, known: [121, 122] },
  { vol: 113, book_id: '6abeb583896ea18127c84e6f', from: 224, to: 234, known: [] },
  { vol: 33, book_id: '6abe932b6a920ffd924d73b0', from: 170, to: 180, known: [176] },
];

// ── Tibetan syllables and English reading length ───────────────────────────
/** Syllables of an Esukhia e-text page: markup ({D####}, #, (x,y) → x, [x]) removed. */
export function tibetanSyllables(text) {
  const t = String(text || '')
    .replace(/\{D\d+[a-z]?\}/g, ' ')
    .replace(/\(([^,()]*),[^()]*\)/g, '$1')
    .replace(/[#\\[\]]/g, '');
  return t.split(/[་།-༔\s]+/).filter((s) => /[ཀ-ྼ]/.test(s)).length;
}
/** English as read: notes dropped, other inline tags unwrapped, whitespace collapsed. */
export function readingText(text) {
  return String(text || '')
    .replace(/<note>[\s\S]*?<\/note>/gi, ' ')
    .replace(/<(summary|keywords|meta|vocab|warning)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
/**
 * Blocks of up to BLOCK pages, broken at a page with no e-text (vol 96 p38, f. 19b, has none and
 * f. 20a has no page at all): the text is not continuous across it, so the chain restarts there
 * unseeded. `seed` says what the block's continuity context is.
 */
export function planStretchBlocks(pages) {
  const runs = [];
  let cur = [];
  for (const p of pages) {
    if ((p.ocr?.data || '').length < 200 || (cur.length && cur.at(-1).page_number + 1 !== p.page_number)) {
      if (cur.length) runs.push(cur);
      cur = [];
      if ((p.ocr?.data || '').length < 200) continue;
    }
    cur.push(p);
  }
  if (cur.length) runs.push(cur);
  const blocks = [];
  runs.forEach((run, r) => {
    for (let i = 0; i < run.length; i += BLOCK) blocks.push({ pages: run.slice(i, i + BLOCK), seed: i > 0 ? 'chain' : (r === 0 ? 'served' : 'none') });
  });
  return blocks;
}
const SENTENCE_END = /[.!?…]["'”’)\]]*(?=\s|$)/g;

// ── run ────────────────────────────────────────────────────────────────────
async function loadStretch(db, s) {
  const pages = await db.collection('pages')
    .find({ book_id: s.book_id, page_number: { $gte: s.from - 1, $lte: s.to } })
    .project({ id: 1, page_number: 1, page_label: 1, archived_photo: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1, 'translation.engine.call_site': 1 })
    .sort({ page_number: 1 }).toArray();
  return pages;
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  try {
    const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
    const env = control?.allow_scopes?.[SCOPE];
    if (!env) throw new Error(`no allow_scopes.${SCOPE} envelope — open it with set-scope.mjs first`);
    const ids = [...new Set(STRETCHES.map((s) => s.book_id))];
    const since = new Date(env.created_at);
    const prompts = await loadTranslationPrompts(db);
    let localUsd = 0;

    for (const s of STRETCHES) {
      const book = await db.collection('books').findOne({ id: s.book_id }, { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1 } });
      const all = await loadStretch(db, s);
      const seedPage = all.find((p) => p.page_number === s.from - 1);
      const pages = all.filter((p) => p.page_number >= s.from);
      // The chain: the first block is seeded with the served translation of the page before the
      // stretch (exactly as the chained lane seeds it); each later block with this run's own span.
      let previousTranslation = '';
      for (const plan of planStretchBlocks(pages)) {
        if (plan.seed === 'served') previousTranslation = seedPage?.translation?.data || '';
        if (plan.seed === 'none') previousTranslation = '';
        const block = plan.pages.map((p) => ({ page_number: p.page_number, ocr: p.ocr?.data || '' }));
        const key = `v${s.vol}-p${block[0].page_number}-${block.at(-1).page_number}`;
        const file = join(OUT, 'blocks', `${key}.json`);
        if (existsSync(file)) {
          const saved = JSON.parse(readFileSync(file, 'utf8'));
          previousTranslation = saved.parsed.pages.at(-1).span;
          console.log(`${key}: cached`);
          continue;
        }
        const { prompt, promptRef } = buildBlockTranslationPrompt({ prompts, book, pages: block, previousTranslation, pageBreak: LEAF_BREAK_ONLY, folioMarkers: true });
        let attempt = 0;
        let r;
        let parsed;
        while (attempt < 2) {
          attempt++;
          const spent = await getScopeSpendUsd(db, { ids, since });
          if (spent.meterError) console.warn(`meter: ${spent.meterError}`);
          if (Math.max(spent.usd, localUsd) >= BUDGET_USD - 0.1) throw new Error(`envelope ${SCOPE} at $${Math.max(spent.usd, localUsd).toFixed(3)} — stopping`);
          r = await callGemini({
            model: MODEL, prompt, endpoint: ENDPOINT, type: 'eval', triggeredBy: 'job-folio-markers-5678',
            temperature: 1, maxOutputTokens: maxOutputTokensFor(block.map((p) => ({ ocr: { data: p.ocr } }))),
            safetySettings: SAFETY_SETTINGS, bookId: s.book_id,
            pageIds: plan.pages.map((p) => p.id), promptVersion: `folio-markers-5678/${promptRef.version}`,
          });
          localUsd += costOf(MODEL, r.inputTokens, r.outputTokens);
          parsed = parseFolioMarkedText(r.text, block.map((p) => p.page_number));
          const ok = !parsed.missing.length && !parsed.duplicated.length && !parsed.outOfOrder;
          console.log(`${key} try ${attempt}: ${r.inputTokens}→${r.outputTokens} tok, finish ${r.finishReason}, missing [${parsed.missing}] dup [${parsed.duplicated}] order ${parsed.outOfOrder ? 'BAD' : 'ok'}; run $${localUsd.toFixed(4)}`);
          if (ok) break;
        }
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({
          key, vol: s.vol, book_id: s.book_id, pages: block.map((p) => p.page_number), model: MODEL, attempts: attempt,
          prompt_ref: promptRef, input_tokens: r.inputTokens, output_tokens: r.outputTokens, finish_reason: r.finishReason,
          usd: costOf(MODEL, r.inputTokens, r.outputTokens), seeded_from: plan.seed === 'served' ? `served p${s.from - 1}` : plan.seed === 'chain' ? 'this run' : 'none (after a gap)',
          response: r.text, parsed,
        }, null, 1));
        previousTranslation = parsed.pages.at(-1).span || previousTranslation;
      }
    }
    const spent = await getScopeSpendUsd(db, { ids, since });
    console.log(`done. this run ≈ $${localUsd.toFixed(4)} (prices × tokens); envelope meter $${spent.usd.toFixed(4)} over ${spent.rows} rows`);
    writeFileSync(join(OUT, 'spend.json'), JSON.stringify({ local_usd: localUsd, envelope_usd: spent.usd, envelope_rows: spent.rows, at: new Date().toISOString() }, null, 1));
  } finally {
    await client.close();
  }
}

// ── check ($0) ─────────────────────────────────────────────────────────────
function sentencesBetween(text, a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let n = 0;
  for (const m of text.matchAll(SENTENCE_END)) { const at = m.index + m[0].length; if (at > lo && at <= hi) n++; }
  return n;
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = s.length; return k ? (k % 2 ? s[(k - 1) / 2] : (s[k / 2 - 1] + s[k / 2]) / 2) : null; };
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };

async function check() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const rows = [];
  const pagesOut = [];
  try {
    for (const s of STRETCHES) {
      const all = await loadStretch(db, s);
      const byN = new Map(all.map((p) => [p.page_number, p]));
      const pages = all.filter((p) => p.page_number >= s.from);
      for (const plan of planStretchBlocks(pages)) {
        const nums = plan.pages.map((p) => p.page_number);
        const key = `v${s.vol}-p${nums[0]}-${nums.at(-1)}`;
        const saved = JSON.parse(readFileSync(join(OUT, 'blocks', `${key}.json`), 'utf8'));
        const parsed = parseFolioMarkedText(saved.response, nums);
        const syl = nums.map((n) => tibetanSyllables(byN.get(n).ocr?.data));
        const sylTotal = syl.reduce((a, b) => a + b, 0);
        const newLen = parsed.pages.map((p) => readingText(p.span).length);
        const newText = parsed.pages.map((p) => readingText(p.span)).join(' ');
        const newTotal = newText.length;
        const oldSpans = nums.map((n) => readingText(byN.get(n).translation?.data));
        const oldText = oldSpans.join(' ');
        const oldTotal = oldText.length;
        let sylBefore = 0; let newBefore = 0; let oldBefore = 0;
        nums.forEach((n, j) => {
          const p = byN.get(n);
          const pg = parsed.pages[j];
          if (j > 0) {
            const srcFrac = sylBefore / sylTotal;
            const newFrac = newBefore / newTotal;
            const oldFrac = oldBefore / oldTotal;
            const expectNew = srcFrac * newTotal;
            const expectOld = srcFrac * oldTotal;
            rows.push({
              vol: s.vol, book_id: s.book_id, page_number: n, page_label: p.page_label, block: key,
              known_bad: s.known.includes(n) || s.known.includes(nums[j - 1]),
              src_frac: +srcFrac.toFixed(4),
              new_frac: +newFrac.toFixed(4), new_err: +(newFrac - srcFrac).toFixed(4),
              new_err_words: Math.round((newBefore - expectNew) / 6), new_err_sentences: sentencesBetween(newText, newBefore, expectNew),
              old_frac: +oldFrac.toFixed(4), old_err: +(oldFrac - srcFrac).toFixed(4),
              old_err_words: Math.round((oldBefore - expectOld) / 6), old_err_sentences: sentencesBetween(oldText, oldBefore, expectOld),
              marker_missing: pg.marker_offset == null,
            });
          }
          const prev = byN.get(n - 1);
          const next = byN.get(n + 1);
          pagesOut.push({
            vol: s.vol, book_id: s.book_id, page_number: n, page_label: p.page_label, image: p.archived_photo,
            tibetan: p.ocr?.data || '', syllables: syl[j],
            span: pg.span, head: pg.head, tail: pg.tail,
            head_from: pg.head ? prev?.page_label : null, tail_on: pg.tail ? next?.page_label : null,
            marker_offset: pg.marker_offset, marker_fraction: pg.marker_fraction, block: key, block_index: j,
            old_translation: p.translation?.data || '', old_call_site: p.translation?.engine?.call_site || null,
            new_words: readingText(pg.span).split(/\s+/).filter(Boolean).length,
            old_words: readingText(p.translation?.data).split(/\s+/).filter(Boolean).length,
            new_len: newLen[j],
          });
          sylBefore += syl[j]; newBefore += newLen[j] + (j < nums.length - 1 ? 1 : 0); oldBefore += oldSpans[j].length + 1;
        });
      }
    }
  } finally {
    await client.close();
  }
  const abs = (k) => rows.map((r) => Math.abs(r[k]));
  const summary = {
    n_pages: pagesOut.length,
    n_turns: rows.length,
    markers_missing: rows.filter((r) => r.marker_missing).length,
    new: { median_abs_err: median(abs('new_err')), p90_abs_err: quantile(abs('new_err'), 0.9), median_abs_words: median(abs('new_err_words')), median_abs_sentences: median(abs('new_err_sentences')), off_gt_1_sentence: rows.filter((r) => r.new_err_sentences > 1).map((r) => `${r.vol}/p${r.page_number}`) },
    old: { median_abs_err: median(abs('old_err')), p90_abs_err: quantile(abs('old_err'), 0.9), median_abs_words: median(abs('old_err_words')), median_abs_sentences: median(abs('old_err_sentences')), off_gt_1_sentence: rows.filter((r) => r.old_err_sentences > 1).map((r) => `${r.vol}/p${r.page_number}`) },
  };
  writeFileSync(join(OUT, 'check.json'), JSON.stringify({ summary, turns: rows }, null, 1));
  mkdirSync(join(OUT, 'pages'), { recursive: true });
  for (const p of pagesOut) writeFileSync(join(OUT, 'pages', `v${p.vol}-p${String(p.page_number).padStart(3, '0')}.json`), JSON.stringify(p, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  console.table(rows.map((r) => ({ page: `${r.vol}/${r.page_number}`, bad: r.known_bad ? '*' : '', src: r.src_frac, new: r.new_err, newS: r.new_err_sentences, old: r.old_err, oldS: r.old_err_sentences })));
}

const cmd = process.argv[2];
if (cmd === 'run') await run();
else if (cmd === 'check') await check();
else { console.error('usage: folio-markers-5678.mjs run|check'); process.exit(1); }
