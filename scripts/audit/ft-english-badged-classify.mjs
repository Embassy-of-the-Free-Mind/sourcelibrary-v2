#!/usr/bin/env node
/**
 * ft-english-badged-classify.mjs — issue #3524.
 *
 * Books badged "first English translation" while `books.language` says English.
 * That set looks like one bug and is three, needing OPPOSITE fixes — a bulk
 * demote would strip genuine badges from Hebrew and Latin works whose language
 * field is simply wrong. So this script only ever CLASSIFIES and reports; the
 * writes live in `scripts/maintenance/ft-english-badged-adjudicate.mjs`.
 *
 * Why page 1 lies: the first page of a scan is nearly always a cover or flyleaf,
 * and its OCR `<language>` tag describes the modern pencil cataloguing
 * annotations, not the text. That is how a 12/12-Hebrew book ends up tagged
 * English. So we sample CONTENT pages only (>= MIN_CONTENT_CHARS of OCR) and
 * take the modal tag, plus a non-Latin script census of the body text.
 *
 * Why the FRONT of the book lies too — the same trap one level up, and the one
 * that nearly demoted three legitimate badges on 2026-08-06. A scholarly edition
 * of a Latin text carries an English title page, preface and introduction: the
 * first dozen content pages of Quignones' *Breviarium Romanum*, Feltoe's
 * *Sacramentarium Leonianum* and Little's *Opus Tertium* all read English while
 * pages 112, 113 and 63 are solidly Latin. Sampling the first N content pages
 * therefore measures the APPARATUS, not the text. We spread the sample evenly
 * across the interior instead, skipping the front and back matter.
 *
 * Classes:
 *   1  `books.language` is wrong; the badge is probably RIGHT.  Fix the language.
 *   2  the text really is English; a "first English translation" of an English
 *      work is not a claim that can be true.  Demote via `not_applicable`.
 *   3  not enough OCR sampled to decide.  Send to the Tier-2 queue.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/ft-english-badged-classify.mjs
 *   node --env-file=.env.production.local scripts/audit/ft-english-badged-classify.mjs --json out.json
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const MAX_PAGES = 12;
const MIN_CONTENT_CHARS = 700;
/** Skip this share of content pages at the front (title page, preface, introduction). */
const SKIP_FRONT = 0.15;
/** Skip this share at the back (indices, colophons, publisher's advertisements). */
const SKIP_BACK = 0.05;
/** Body-text non-Latin characters above this mean the text is genuinely not English. */
const NONLATIN_REAL = 2000;
/** Between this and NONLATIN_REAL: quotation-scale. Report, do not auto-classify. */
const NONLATIN_QUOTE = 400;
/** Share of sampled content pages that must read English to call the text English. */
const ENGLISH_SHARE = 0.6;
/**
 * A demote must never rest on a thin sample. The Ānandakanda had exactly ONE
 * readable content page reading English — an editor's preface in front of a
 * Sanskrit text. Below this, the answer is "we don't know" (class 3), not
 * "it's English".
 */
const MIN_SAMPLE_TO_DEMOTE = 4;
/** Above this share, "the text is English" is unarguable and safe to auto-apply. */
const CLEAR_SHARE = 0.85;

const SCRIPTS = [
  ['HEBREW', /[֐-׿]/g],
  ['ARABIC', /[؀-ۿݐ-ݿ]/g],
  ['GREEK', /[Ͱ-Ͽἀ-῿]/g],
  ['CYRILLIC', /[Ѐ-ӿ]/g],
  ['CJK', /[぀-ヿ一-鿿]/g],
  ['DEVANAGARI', /[ऀ-ॿ]/g],
  ['TIBETAN', /[ༀ-࿿]/g],
  ['ARMENIAN', /[԰-֏]/g],
  ['MALAYALAM', /[ഀ-ൿ]/g],
  ['SYRIAC', /[܀-ݏ]/g],
];

const ENGLISH_TAGS = new Set(['en', 'eng', 'english', 'en-gb', 'en-us', 'modern english', 'early modern english']);
/** Tags the OCR emits when it could not read a language off the page. Never a vote. */
const NULL_TAGS = new Set(['none', 'n/a', 'na', 'null', 'unknown', 'undetermined', '-', '']);

/**
 * `pages.ocr` is an OBJECT — `{ data, model, prompt_hash, … }` — not a string.
 * Coercing it with String() yields "[object Object]" (15 chars), which silently
 * fails every length filter and reports a clean, wrong "no content pages" for
 * the whole corpus. Always read `.data`.
 */
function ocrText(ocr) {
  if (typeof ocr === 'string') return ocr;
  if (ocr && typeof ocr.data === 'string') return ocr.data;
  return '';
}

/** Strip the OCR markup so a `<language>English</language>` tag can't be counted as body text. */
function bodyText(ocr) {
  return ocrText(ocr).replace(/<[^>]*>/g, ' ');
}

function languageTag(ocr) {
  const m = ocrText(ocr).match(/<language>\s*([^<]+?)\s*<\/language>/i);
  if (!m) return null;
  const tag = m[1].trim().toLowerCase();
  return NULL_TAGS.has(tag) ? null : tag;
}

/**
 * Take `n` content pages spread evenly across the book's interior. Front and back
 * matter are trimmed first, because that is where an edition's English apparatus
 * lives; the interior is where its actual text lives. For a short item there is
 * no interior to speak of, so fall back to the whole set rather than return none.
 */
function spreadSample(content, n) {
  if (content.length <= n) return content;
  const from = Math.floor(content.length * SKIP_FRONT);
  const to = Math.ceil(content.length * (1 - SKIP_BACK));
  const interior = content.slice(from, to);
  const pool = interior.length >= n ? interior : content;
  const step = pool.length / n;
  return Array.from({ length: n }, (_, i) => pool[Math.floor(i * step)]);
}

function scriptCensus(text) {
  const out = {};
  for (const [name, re] of SCRIPTS) {
    const n = (text.match(re) || []).length;
    if (n > 0) out[name] = n;
  }
  return out;
}

function classify({ sampled, modal, modalCount, englishCount, nonLatinTotal }) {
  if (sampled === 0) return { cls: 3, why: 'no content pages sampled' };
  if (nonLatinTotal >= NONLATIN_REAL) {
    return { cls: 1, why: `body text carries ${nonLatinTotal} non-Latin chars` };
  }
  if (modal && !ENGLISH_TAGS.has(modal)) {
    return { cls: 1, why: `modal OCR language is "${modal}" (${modalCount}/${sampled})` };
  }
  const share = englishCount / sampled;
  if (share >= ENGLISH_SHARE) {
    if (sampled < MIN_SAMPLE_TO_DEMOTE) {
      return { cls: 3, why: `English ${englishCount}/${sampled} but only ${sampled} content page(s) — too thin to demote` };
    }
    if (nonLatinTotal >= NONLATIN_QUOTE) {
      return { cls: 2, review: true, why: `English ${englishCount}/${sampled}; ${nonLatinTotal} non-Latin chars — check it is quotation, not the text` };
    }
    if (share < CLEAR_SHARE) {
      return { cls: 2, review: true, why: `English ${englishCount}/${sampled} — majority but not decisive` };
    }
    return { cls: 2, why: `English ${englishCount}/${sampled} content pages` };
  }
  return { cls: 3, why: `no clear majority — English ${englishCount}/${sampled}, modal "${modal ?? 'none'}"` };
}

async function main() {
  const jsonOut = process.argv.includes('--json')
    ? process.argv[process.argv.indexOf('--json') + 1]
    : null;

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const books = await db.collection('books').find(
    {
      is_first_translation: true,
      visible: true,
      pages_translated: { $gt: 0 },
      language: /^en/i,
    },
    { projection: { id: 1, title: 1, author: 1, language: 1, year: 1, pages_count: 1, text_role: 1, first_translation_status: 1, first_translation: 1, _id: 0 } },
  ).toArray();

  console.log(`Badged + visible + translated + language=English: ${books.length} books\n`);

  const rows = [];
  for (const b of books) {
    const pages = await db.collection('pages')
      .find({ book_id: b.id }, { projection: { ocr: 1, page_number: 1, _id: 0 } })
      .sort({ page_number: 1 })
      .limit(400)
      .toArray();

    const allContent = pages.filter((p) => ocrText(p.ocr).length >= MIN_CONTENT_CHARS);
    const content = spreadSample(allContent, MAX_PAGES);
    const tags = content.map((p) => languageTag(p.ocr)).filter(Boolean);

    const counts = {};
    for (const t of tags) counts[t] = (counts[t] || 0) + 1;
    let modal = null, modalCount = 0;
    for (const [t, n] of Object.entries(counts)) if (n > modalCount) { modal = t; modalCount = n; }
    const englishCount = tags.filter((t) => ENGLISH_TAGS.has(t)).length;

    const census = scriptCensus(content.map((p) => bodyText(p.ocr)).join('\n'));
    const nonLatinTotal = Object.values(census).reduce((a, n) => a + n, 0);

    const verdict = classify({ sampled: content.length, modal, modalCount, englishCount, nonLatinTotal });
    rows.push({
      id: b.id,
      title: (b.title || '').slice(0, 70),
      author: (b.author || '').slice(0, 30),
      year: b.year ?? null,
      language: b.language,
      ft_status: b.first_translation_status ?? null,
      has_verdict: Boolean(b.first_translation),
      resolver: b.first_translation?.resolver ?? null,
      sampled: content.length,
      modal,
      modalCount,
      englishCount,
      census,
      nonLatinTotal,
      ...verdict,
    });
  }

  rows.sort((a, b) => a.cls - b.cls || b.nonLatinTotal - a.nonLatinTotal);

  for (const cls of [1, 2, 3]) {
    const set = rows.filter((r) => r.cls === cls);
    const label = { 1: 'CLASS 1 — books.language is WRONG; badge probably right; fix language', 2: 'CLASS 2 — text really is English; badge is definitionally impossible; demote via not_applicable', 3: 'CLASS 3 — insufficient OCR; send to Tier-2 queue' }[cls];
    console.log(`\n${label}  (${set.length})`);
    console.log('-'.repeat(110));
    for (const r of set) {
      const flag = r.review ? ' [REVIEW]' : '';
      console.log(`${r.id}  ${String(r.sampled).padStart(2)}pp  ${(r.modal ?? '-').padEnd(10)} nonLatin=${String(r.nonLatinTotal).padEnd(7)} ${r.author} — ${r.title}`);
      console.log(`    ${r.why}${flag}   [${r.ft_status ?? 'no status'}${r.has_verdict ? `, verdict resolver=${r.resolver}` : ', NO verdict (legacy bypass)'}]`);
    }
  }

  console.log(`\nTOTALS  class1=${rows.filter(r => r.cls === 1).length}  class2=${rows.filter(r => r.cls === 2).length}  class3=${rows.filter(r => r.cls === 3).length}  (n=${rows.length})`);

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ generated_at: new Date().toISOString(), n: rows.length, rows }, null, 2));
    console.log(`\nWrote ${jsonOut}`);
  }

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
