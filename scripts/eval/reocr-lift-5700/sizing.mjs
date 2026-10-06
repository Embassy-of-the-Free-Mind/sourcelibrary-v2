#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/t2/census.mjs and xlref-t4/census.mjs count translated pages per
// language from the books' cached counters; scripts/audit/quality-census (#5700 A1) estimates page shares from one
// sampled page per book. Neither knows WHICH ENGINE read each served page, and the pilot shows that is the cut that
// decides the lift (a Lite read gains, a Flash read does not). This counts it exactly, page by page, for the strata
// the pilot covers. scripts/lib/model-pricing.mjs supplies the Batch multiplier.
/** #5700 A5 sizing: exact served translated pages per script × period × print/manuscript × engine of the served OCR, priced for re-OCR + retranslation at Batch rates. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/reocr-lift-5700/sizing.mjs count   (Mongo, READ-ONLY, secondary)
 *   node scripts/eval/reocr-lift-5700/sizing.mjs price
 * count: live books (visible, pages_count > 0) in the pilot's languages, plus Latin printed to 1500; for each, pages
 *        with a non-empty translation, grouped by ocr.model and the page's script_type. Exact; no $sample. Tibetan and
 *        Syriac are not counted (never re-read with Gemini — DECISIONS.md).
 * price: joins the counts with the pilot's measured lift (lift.json) and its measured tokens per page (spend.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import { BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';

const args = process.argv.slice(2); const STAGE = args[0];
const DIR = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'scripts/eval/results/reocr-lift-2026-10';
const SCRIPT_OF = [[/^(ancient |byzantine |koine )?greek/i, 'Greek'], [/^(hebrew|aramaic)/i, 'Hebrew/Aramaic'], [/^arabic/i, 'Arabic'], [/^persian/i, 'Persian'], [/^sanskrit/i, 'Sanskrit'], [/^pali/i, 'Pali'], [/^(classical )?chinese/i, 'Chinese'], [/^latin$/i, 'Latin']];
const scriptOf = (l) => SCRIPT_OF.find(([re]) => re.test(String(l || '').trim()))?.[1] ?? null;
const period = (y) => (typeof y !== 'number' ? 'undated' : y <= 1500 ? 'to 1500' : y < 1600 ? '1501–1599' : y < 1800 ? '1600–1799' : '1800+');
const engine = (m) => (/lite/.test(m || '') ? 'lite' : /flash/.test(m || '') ? 'flash' : m ? 'other' : 'none');

async function stageCount() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' }); await c.connect(); const db = c.db('bookstore');
  const books = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } }, { projection: { id: 1, language: 1, year: 1, pages_translated: 1, text_role: 1 } }).toArray())
    .map((b) => ({ ...b, script: scriptOf(b.language) })).filter((b) => b.script && (b.script !== 'Latin' || (typeof b.year === 'number' && b.year <= 1500)));
  console.log(`${books.length} books, ${books.reduce((s, b) => s + b.pages_translated, 0)} translated pages by the books' counters`);
  const out = fs.existsSync(path.join(DIR, 'sizing-counts.jsonl')) ? fs.readFileSync(path.join(DIR, 'sizing-counts.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const done = new Set(out.map((r) => r.book_id)); const todo = books.filter((b) => !done.has(b.id));
  for (let i = 0; i < todo.length; i += 60) {
    const chunk = todo.slice(i, i + 60); const by = Object.fromEntries(chunk.map((b) => [b.id, b]));
    const rows = await db.collection('pages').aggregate([{ $match: { book_id: { $in: chunk.map((b) => b.id) }, 'translation.data': { $gt: '' } } },
      { $group: { _id: { b: '$book_id', m: '$ocr.model', s: '$script_type' }, n: { $sum: 1 } } }], { allowDiskUse: true, maxTimeMS: 600000 }).toArray();
    const per = {}; for (const r of rows) { const p = (per[r._id.b] ||= { pages: 0, cells: {} }); p.pages += r.n; const k = `${engine(r._id.m)}|${r._id.s || 'unknown'}`; p.cells[k] = (p.cells[k] || 0) + r.n; }
    const lines = chunk.map((b) => JSON.stringify({ book_id: b.id, script: b.script, language: b.language, year: b.year ?? null, period: period(b.year), text_role: b.text_role ?? null, counter_pages_translated: b.pages_translated, pages: per[b.id]?.pages ?? 0, cells: per[b.id]?.cells ?? {} }));
    fs.appendFileSync(path.join(DIR, 'sizing-counts.jsonl'), lines.join('\n') + '\n');
    console.log(`${Math.min(i + 60, todo.length)}/${todo.length} books`);
  }
  await c.close(); console.log('count done');
}

function stagePrice() {
  const rows = fs.readFileSync(path.join(DIR, 'sizing-counts.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const lift = JSON.parse(fs.readFileSync(path.join(DIR, 'lift.json'), 'utf8')); const spend = JSON.parse(fs.readFileSync(path.join(DIR, 'spend.json'), 'utf8'));
  const perPage = (g, k) => (BATCH_MULTIPLIER * spend[g][k].usd_realtime) / spend[g][k].n;
  const rate = { ocr_flash: perPage('ocr', 'reocr gemini-3-flash-preview'), tr_lite: perPage('translate', 'lite-reocr gemini-3.1-flash-lite'), tr_flash: perPage('translate', 'flash-reocr gemini-3-flash-preview') };
  const strata = {};
  for (const r of rows) for (const [k, n] of Object.entries(r.cells)) { const [eng, st] = k.split('|'); const hand = /hand|manuscript/i.test(st) ? 'manuscript' : st === 'unknown' ? 'script type not recorded' : 'print';
    const key = `${r.script} | ${r.period} | ${hand}`; const s = (strata[key] ||= { script: r.script, period: r.period, kind: hand, books: new Set(), pages: 0, lite: 0, flash: 0, other: 0 }); s.books.add(r.book_id); s.pages += n; s[eng === 'none' ? 'other' : eng] += n; }
  // A script's lift is used only when the pilot has ≥ 5 Lite-read pages of it; below that the stratum is sized and priced but not ranked.
  const MIN_N = 5;
  const pilot = (script) => { const c = lift.by_script_and_engine[`${script} | served lite`]; return c && c.n >= MIN_N ? c : null; };
  const out = Object.values(strata).map((s) => { const p = pilot(s.script); const usdLite = s.lite * (rate.ocr_flash + rate.tr_lite), usdFlash = s.lite * (rate.ocr_flash + rate.tr_flash);
    return { ...s, books: s.books.size, pilot_n: p?.n ?? 0, lift_lite: p?.lift_lite?.mean ?? null, lift_lite_ci: p?.lift_lite?.ci ?? null, lift_reocr_plus_flash: p?.lift_reocr_and_flash?.mean ?? null, lift_reocr_plus_flash_ci: p?.lift_reocr_and_flash?.ci ?? null,
      usd_reocr_plus_lite: Math.round(usdLite), usd_reocr_plus_flash: Math.round(usdFlash),
      page_points_per_1k_usd_lite: p?.lift_lite ? Math.round((1000 * p.lift_lite.mean) / (rate.ocr_flash + rate.tr_lite)) : null, page_points_per_1k_usd_flash: p?.lift_reocr_and_flash ? Math.round((1000 * p.lift_reocr_and_flash.mean) / (rate.ocr_flash + rate.tr_flash)) : null }; })
    .sort((a, b) => (b.page_points_per_1k_usd_lite ?? -1) - (a.page_points_per_1k_usd_lite ?? -1) || b.lite - a.lite);
  const byScript = {}; for (const s of out) { const t = (byScript[s.script] ||= { pages: 0, lite: 0, flash: 0, other: 0 }); t.pages += s.pages; t.lite += s.lite; t.flash += s.flash; t.other += s.other; }
  const counters = {}; for (const r of rows) { const t = (counters[r.script] ||= { books: 0, counter: 0, counted: 0 }); t.books++; t.counter += r.counter_pages_translated; t.counted += r.pages; }
  fs.writeFileSync(path.join(DIR, 'sizing.json'), JSON.stringify({ generated: new Date().toISOString(), counted: 'live books (visible, pages_count > 0), pages with a non-empty translation; exact page counts, no sampling', rates_usd_per_page_batch: rate, rate_basis: 'pilot tokens × list price × 0.5 (Batch). cost_usd is computed, not billed (#3576).', by_script: byScript, counter_check: counters, strata: out }, null, 1));
  const n = (x) => x.toLocaleString('en-US'); const sg = (x) => (x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(2)); const ci = (c) => (c ? ` [${sg(c[0])}, ${sg(c[1])}]` : '');
  // Script totals: the ranked table. Lite-read pages only (a Flash-read page measured no lift).
  const scripts = Object.entries(byScript).map(([script, t]) => { const p = pilot(script); const any = lift.by_script_and_engine[`${script} | served lite`];
    return { script, ...t, pilot_n: any?.n ?? 0, lift_lite: p?.lift_lite ?? null, lift_both: p?.lift_reocr_and_flash ?? null, usd_lite: Math.round(t.lite * (rate.ocr_flash + rate.tr_lite)), usd_flash: Math.round(t.lite * (rate.ocr_flash + rate.tr_flash)),
      pp_lite: p ? Math.round((1000 * p.lift_lite.mean) / (rate.ocr_flash + rate.tr_lite)) : null, pp_flash: p ? Math.round((1000 * p.lift_reocr_and_flash.mean) / (rate.ocr_flash + rate.tr_flash)) : null, clears_floor: p ? p.lift_lite.ci[0] > 0.2 : null }; })
    .sort((a, b) => (b.pp_lite ?? -1) - (a.pp_lite ?? -1));
  const j = JSON.parse(fs.readFileSync(path.join(DIR, 'sizing.json'), 'utf8')); j.ranked_by_script = scripts; fs.writeFileSync(path.join(DIR, 'sizing.json'), JSON.stringify(j, null, 1));
  const md = ['# Size and price of re-OCR + retranslation, per stratum (#5700 A5)', '',
    `Exact counts of served translated pages (live books; a page counts when its translation is non-empty), by the engine that made the served OCR. Only **Lite-read** pages are priced: on Flash-read pages the pilot measured no lift. Rates (Batch, computed from the pilot's tokens): re-OCR on gemini-3-flash-preview $${rate.ocr_flash.toFixed(5)}/page, retranslation on Lite $${rate.tr_lite.toFixed(5)}, on Flash $${rate.tr_flash.toFixed(5)}. Generated by \`sizing.mjs\`.`, '',
    '### Ranked by script', '', '| script | translated pages | Lite-read | Flash-read | pilot pages (Lite-read) | lift: re-read, Lite translates (vs Lite on served OCR) [95 % CI] | lift: re-read AND Flash translates (vs Lite on served OCR) [95 % CI] | price: re-OCR + Lite | price: re-OCR + Flash | page-points per $1K (Lite / Flash) |', '|---|---:|---:|---:|---:|---|---|---:|---:|---|',
    ...scripts.map((x) => `| ${x.script}${x.script === 'Latin' ? ' (editions to 1500 only)' : ''} | ${n(x.pages)} | ${n(x.lite)} | ${n(x.flash)} | ${x.pilot_n} | ${x.lift_lite ? sg(x.lift_lite.mean) + ci(x.lift_lite.ci) : 'not measured (n < 5)'} | ${x.lift_both ? sg(x.lift_both.mean) + ci(x.lift_both.ci) : '—'} | $${n(x.usd_lite)} | $${n(x.usd_flash)} | ${x.pp_lite == null ? '—' : n(x.pp_lite) + ' / ' + n(x.pp_flash)} |`), '',
    'A page-point is one page gaining one fidelity point (1–5 scale). The lift is the pilot\'s, measured on pages chosen because they scored low or were image-checked: a random page of the stratum gains less (see the write-up).', '',
    '### Script × edition date × print/manuscript (Lite-read pages ≥ 500)', '', '| script | `books.year` | page `script_type` | books | translated pages | Lite-read | Flash-read | price: re-OCR + Lite | re-OCR + Flash |', '|---|---|---|---:|---:|---:|---:|---:|---:|',
    ...out.filter((x) => x.lite >= 500).sort((a, b) => a.script.localeCompare(b.script) || b.lite - a.lite).map((x) => `| ${x.script} | ${x.period} | ${x.kind} | ${n(x.books)} | ${n(x.pages)} | ${n(x.lite)} | ${n(x.flash)} | $${n(x.usd_reocr_plus_lite)} | $${n(x.usd_reocr_plus_flash)} |`), '',
    '`books.year` is the date as catalogued; for non-Latin scripts it is often the date of the work, not of the edition, so "to 1500 | print" rows are mostly later printings of old works. A book appears in every row it has pages in.', ''].join('\n');
  fs.writeFileSync(path.join(DIR, 'sizing.md'), md);
  console.log(md.split('### Script ×')[0]);
}
await ({ count: stageCount, price: stagePrice })[STAGE]();
