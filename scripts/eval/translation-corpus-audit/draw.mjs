#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/sampling.mjs (sampleOnePagePerBook — unseeded $sample, returns no translation
// or model), scripts/eval/benchmark-seal.mjs (seeded 10–90% draw for OCR strata, no model quota),
// scripts/eval/tibetan-mt-ab/ (absolute fidelity judge, needs a human reference). None draws a seeded,
// one-interior-page-per-book sample of SERVED translations with a per-language model quota and blinded
// controls. This does. Design: .claude/docs/eval-design.md §3 (book unit, interior rule), §6 (controls), §8.
//
// Draw a stratified random sample of served translations for the corpus-wide fidelity audit.
//
//   node --env-file=.env.production.local scripts/eval/translation-corpus-audit/draw.mjs \
//        --out scripts/eval/results/translation-corpus-audit-2026-09-30 --seed 20260930 [--scale 1] [--arm-quota off] [--extra-per-lang 3]
//
// Monthly runs (monthly-draw.sh, #5301) use --scale 0.32 --arm-quota off --extra-per-lang 4: ~100 books, the model arm left to fall
// where the random book draw puts it. The 09-30 run's 50/50 arm quota over-weighted each language's minority
// arm and needed a separate arm-shares correction; without the quota the language weights are the only ones.
//
// Unit = one interior page of one book (15% front / 5% back skipped; ocr.data ≥ 200 chars; translation.data
// ≥ 100 chars; translation.source ∈ {ai, batch_api}; no edited_by; page_type not in EXCLUDED_TYPES).
// Strata = books.language (15 languages) with a quota per translation-model arm inside each language
// (lite = gemini-3.1-flash-lite*, flash = gemini-3-flash-preview). Period is recorded as a covariate.
// Controls (blinded, drawn from EXTRA books not in the main sample):
//   swap   translation replaced by another page's translation in the same language  → expect fidelity 1
//   drop   contiguous middle ~35% of the translation removed                           → expect omission
//   repeat a main item re-presented under a new id                                     → judge stability
// Writes: manifest.jsonl (ids + provenance + truth, NO text), items.jsonl (id + texts, for packets),
// draw-log.json (quotas, visits, exclusions). Texts stay reproducible via content hashes.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { resetSeed, seededRand } from '../lib/paired-stats.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const OUT = args.out || 'scripts/eval/results/translation-corpus-audit-2026-09-30';
const SEED = Number(args.seed || 20260930);
const SCALE = Number(args.scale || 1);
const ARM_QUOTA = args['arm-quota'] !== 'off';

// Quota in BOOKS per language (one page per book). Post-stratification weights come from live translated
// page counts measured at draw time and written to draw-log.json.
const QUOTA = {
  Latin: 60, English: 36, German: 36, Greek: 36, French: 24, Italian: 18, Dutch: 18, Chinese: 18,
  Sanskrit: 12, Hebrew: 12, Arabic: 12, Tibetan: 12, Korean: 6, Spanish: 6, Japanese: 6,
};
const EXTRA_PER_LANG = Number(args['extra-per-lang'] || 3); // control pool (monthly: 4, so 15 drops survive the ≥4-unit rule)
const N_SWAP = 15, N_DROP = 15, N_REPEAT = 15;
const EXCLUDED_TYPES = ['archived-spread', 'blank', 'title-page', 'toc', 'index', 'illustration', 'digitizer-insert', 'colophon', 'errata', 'cover', 'map', 'plate'];
const MIN_OCR = 200, MIN_TR = 100;
const MODERNIZATION_HASHES = ['d0e82fa7c2', '45790074ee']; // English Modernization v1/v2 prompt hashes (prompts.content_hash prefix)

const armOf = (m) => !m ? 'none' : /^gemini-3\.1-flash-lite/.test(m) ? 'lite' : /^gemini-3-flash-preview/.test(m) ? 'flash' : 'other';
const periodOf = (published) => {
  const m = String(published || '').match(/\b(1[0-9]\d\d|20[0-2]\d|[5-9]\d\d)\b/);
  if (!m) return 'unknown';
  const y = Number(m[1]);
  return y < 1500 ? 'pre-1500' : y < 1600 ? '1500s' : y < 1700 ? '1600s' : y < 1800 ? '1700s' : y < 1900 ? '1800s' : '1900+';
};
const sha16 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const newId = () => { let s = ''; for (let i = 0; i < 10; i++) s += Math.floor(seededRand() * 16).toString(16); return s; };

resetSeed(SEED);
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books'), pages = db.collection('pages');

const log = { seed: SEED, at: new Date().toISOString(), quota: QUOTA, scale: SCALE, arm_quota: ARM_QUOTA, weights: {}, visits: {}, exclusions: {}, arms: {} };
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

// 1. Frame: live books with translations, per language, and the live translated-page weights.
const frame = {};
for (const lang of Object.keys(QUOTA)) {
  const rows = await books.find(
    { visible: { $ne: false }, hidden: { $ne: true }, pages_translated: { $gt: 0 }, pages_count: { $gt: 0 }, language: lang },
    { projection: { id: 1, title: 1, author: 1, published: 1, pages_count: 1, pages_translated: 1, provider: 1 } },
  ).toArray();
  frame[lang] = shuffle(rows);
  log.weights[lang] = { books: rows.length, translated_pages: rows.reduce((s, b) => s + (b.pages_translated || 0), 0) };
  console.error(`${lang}: ${rows.length} books, ${log.weights[lang].translated_pages} translated pages`);
}

// 2. One interior page per book, seeded.
async function drawPage(book) {
  const lo = Math.floor(book.pages_count * 0.15), hi = Math.ceil(book.pages_count * 0.95);
  const cands = await pages.aggregate([
    { $match: { book_id: book.id, page_number: { $gt: lo, $lt: hi }, 'translation.data': { $type: 'string' }, 'ocr.data': { $type: 'string' } } },
    { $project: { page_number: 1, page_type: 1, ol: { $strLenCP: '$ocr.data' }, tl: { $strLenCP: '$translation.data' }, tm: '$translation.model', ts: '$translation.source', ted: '$translation.edited_by', tph: '$translation.prompt_hash' } },
  ], { maxTimeMS: 60000 }).toArray();
  const ok = cands.filter((p) => {
    if (EXCLUDED_TYPES.includes(p.page_type)) { bump(log.exclusions, 'page_type'); return false; }
    if (p.ol < MIN_OCR) { bump(log.exclusions, 'short_ocr'); return false; }
    if (p.tl < MIN_TR) { bump(log.exclusions, 'short_translation'); return false; }
    if (!['ai', 'batch_api'].includes(p.ts)) { bump(log.exclusions, 'source_' + p.ts); return false; }
    if (p.ted) { bump(log.exclusions, 'edited_by'); return false; }
    if (armOf(p.tm) === 'other' || armOf(p.tm) === 'none') { bump(log.exclusions, 'arm_' + armOf(p.tm)); return false; }
    return true;
  });
  if (!ok.length) return null;
  const pick = ok[Math.floor(seededRand() * ok.length)];
  const full = await pages.findOne({ book_id: book.id, page_number: pick.page_number }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'ocr.content_hash': 1, 'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1, 'translation.prompt_hash': 1, 'translation.source': 1, 'translation.updated_at': 1, 'translation.content_hash': 1, 'translation.engine': 1, display_photo: 1, photo: 1, cropped_photo: 1, split_from_spread: 1 } });
  return { book, page: full, n_candidates: ok.length };
}

function toItem(kind, book, page, extra = {}) {
  const t = page.translation, o = page.ocr;
  const ph = (t.prompt_hash || '').slice(0, 10);
  return {
    id: newId(), kind, book_id: book.id, page_number: page.page_number, page_id: page.id, page_type: page.page_type || null,
    title: book.title, author: book.author || null, provider: book.provider || null,
    language: book.language, period: periodOf(book.published), published: book.published || null,
    arm: armOf(t.model), model: t.model, prompt_version: t.prompt_version || null, prompt_hash: t.prompt_hash || null,
    modernization: MODERNIZATION_HASHES.includes(ph),
    translation_source: t.source, translated_at: t.updated_at || null, ocr_model: o.model || null, ocr_source: o.source || null,
    ocr_at: o.updated_at || null, translation_older_than_ocr: !!(t.updated_at && o.updated_at && new Date(t.updated_at) < new Date(o.updated_at)),
    ocr_chars: o.data.length, translation_chars: t.data.length, ocr_hash: sha16(o.data), translation_hash: sha16(t.data),
    image: page.display_photo || page.cropped_photo || page.photo || null,
    url: `https://sourcelibrary.org/book/${book.id}?page=${page.page_number}`,
    ...extra,
  };
}

const main = [], extras = [], texts = {};
for (const lang of Object.keys(QUOTA)) {
  const target = Math.max(1, Math.round(QUOTA[lang] * SCALE));
  const armCap = { lite: Math.ceil(target / 2), flash: Math.ceil(target / 2) };
  const got = { lite: 0, flash: 0 };
  let taken = 0, visits = 0, extra = 0;
  for (const book of frame[lang]) {
    if (taken >= target && extra >= EXTRA_PER_LANG) break;
    if (visits >= target * 8 + EXTRA_PER_LANG * 8) break;
    visits++;
    const r = await drawPage(book).catch((e) => { bump(log.exclusions, 'error'); console.error('draw error', book.id, e.message); return null; });
    if (!r) { bump(log.exclusions, 'no_candidate_page'); continue; }
    const arm = armOf(r.page.translation.model);
    if (taken < target && (!ARM_QUOTA || got[arm] < armCap[arm] || (visits > target * 4))) {
      // after 4× the quota in visits, relax the arm cap so a one-arm language still fills its quota
      const it = toItem('main', { ...book, language: lang }, r.page, { n_candidates: r.n_candidates });
      main.push(it); texts[it.id] = { source: r.page.ocr.data, translation: r.page.translation.data };
      got[arm]++; taken++;
    } else if (extra < EXTRA_PER_LANG) {
      const it = toItem('extra', { ...book, language: lang }, r.page);
      extras.push(it); texts[it.id] = { source: r.page.ocr.data, translation: r.page.translation.data };
      extra++;
    }
  }
  log.visits[lang] = { visits, taken, extra, arms: got };
  console.error(`${lang}: took ${taken}/${target} (lite ${got.lite}, flash ${got.flash}) + ${extra} extra in ${visits} visits`);
}

// 3. Controls.
const splitUnits = (s) => {
  let u = s.split(/(?<=[.!?。।])\s+/).filter((x) => x.trim());
  if (u.length < 6) u = s.split(/\n+/).filter((x) => x.trim());
  return u;
};
const controls = [];
const pool = shuffle([...extras]);
const byLang = {};
for (const e of pool) (byLang[e.language] ||= []).push(e);
// swap: pair extras within a language, round-robin over languages
let swaps = 0;
for (const lang of shuffle(Object.keys(byLang))) {
  const arr = byLang[lang];
  if (arr.length < 2 || swaps >= N_SWAP) continue;
  const [a, b] = arr.splice(0, 2);
  const it = { ...a, id: newId(), kind: 'swap', control_of: a.id, swap_translation_from: b.id, expected: { fidelity: 1, wrong_page: true } };
  controls.push(it); texts[it.id] = { source: texts[a.id].source, translation: texts[b.id].translation };
  swaps++;
}
// drop: middle ~35% removed from remaining extras
let drops = 0;
for (const lang of shuffle(Object.keys(byLang))) {
  for (const e of byLang[lang]) {
    if (drops >= N_DROP) break;
    const units = splitUnits(texts[e.id].translation);
    if (units.length < 4) continue;
    const k = Math.max(1, Math.round(units.length * 0.35)), start = Math.floor((units.length - k) / 2);
    const kept = [...units.slice(0, start), ...units.slice(start + k)];
    const removed = units.slice(start, start + k).join(' ');
    const it = { ...e, id: newId(), kind: 'drop', control_of: e.id, dropped_units: k, total_units: units.length, dropped_chars: removed.length, expected: { omission: true } };
    controls.push(it); texts[it.id] = { source: texts[e.id].source, translation: kept.join(units.length >= 6 && /[.!?。।]\s/.test(texts[e.id].translation) ? ' ' : '\n') };
    drops++;
  }
}
// repeat: main items re-presented under a new id (spread across languages)
const repeatPool = shuffle([...main]);
const seenLang = {};
let repeats = 0;
for (const m of repeatPool) {
  if (repeats >= N_REPEAT) break;
  if ((seenLang[m.language] || 0) >= 2) continue;
  seenLang[m.language] = (seenLang[m.language] || 0) + 1;
  const it = { ...m, id: newId(), kind: 'repeat', repeat_of: m.id };
  controls.push(it); texts[it.id] = texts[m.id];
  repeats++;
}
log.controls = { swap: swaps, drop: drops, repeat: repeats };

// 4. Write.
fs.mkdirSync(OUT, { recursive: true });
const manifest = [...main, ...controls];
fs.writeFileSync(path.join(OUT, 'manifest.jsonl'), manifest.map((m) => JSON.stringify(m)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'items.jsonl'), manifest.map((m) => JSON.stringify({ id: m.id, language: m.language, source: texts[m.id].source, translation: texts[m.id].translation })).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'draw-log.json'), JSON.stringify(log, null, 2));
// Page weights for score.mjs's page-weighted sensitivity (a random PAGE rather than a random BOOK).
const bookW = {};
for (const lang of Object.keys(frame)) for (const b of frame[lang]) if (main.some((m) => m.book_id === b.id)) bookW[b.id] = { pages_translated: b.pages_translated || 0, pages_count: b.pages_count || 0 };
fs.writeFileSync(path.join(OUT, 'book-weights.json'), JSON.stringify(bookW, null, 1));
console.error(`wrote ${main.length} main + ${controls.length} controls → ${OUT}`);
await client.close();
