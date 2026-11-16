#!/usr/bin/env node
/**
 * Builds src/data/tibetan-expert-page.json for /research/tibetan: a census of the Tibetan books
 * and their page states, and verbatim excerpts of the example pages the page discusses.
 *
 * PRIOR ART: scripts/eval/tengyur-characterize/build-disclosure.mjs generates the Tengyur section
 * rates (src/data/tengyur-section-quality.json) and this page reads that file as is; it holds no
 * page excerpts and no census of the British Library manuscripts. scripts/eval/tibetan-bl-evidence/
 * draws samples for review; it does not snapshot what a reader sees today.
 *
 * Read-only against Mongo. Each excerpt is cut from the stored text at an anchor; if the anchor is
 * gone (the page was corrected or re-read), the build stops so the page is never left quoting text
 * that is no longer there. Fix the example or drop it, then re-run.
 *
 *   node --env-file=.env.production.local scripts/eval/tibetan-expert-page/build-examples.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { verdictQuery } from '../lib/judge-rows.mjs';

const OUT = path.join(process.cwd(), 'src/data/tibetan-expert-page.json');

// key, book id (or Derge Tengyur volume), page, Tibetan anchor + length, English anchor + length.
// An anchor of '' starts at the beginning of the text; a length of 0 leaves that side out.
const EXAMPLES = [
  { key: 'two-leaves', book: '69e7abd05f1a22ab19a9e929', page: 6, tib: ['', 210], en: ['', 330] },
  { key: 'cursive', book: '69e7481e85f786e884a4b4dc', page: 57, tib: ['', 250], en: ['', 0] },
  { key: 'byed-med', book: '69e7ab895f1a22ab19a99cb5', page: 25, tib: ['དོན་བཞི་བཞི་ལ', 58], en: ['the faculties are respectively', 232] },
  { key: 'good-bl', book: '69e788e74a6785cfd60d21ca', page: 18, tib: ['', 230], en: ['', 365] },
  { key: 'tengyur-good', book: 'vol:84', page: 256, tib: ['', 225], en: ['', 380] },
  { key: 'numeral', book: 'vol:18', page: 296, tib: ['ཀླུའི་རྒྱལ་པོ་སེང', 62], en: ['Wearing the king', 175] },
  { key: 'seam', book: '69e7ac425f1a22ab19aa607c', page: 190, tib: ['དགེ་བཅུ་དང་འཚམས', 58], en: ['The ten virtues and', 165] },
  { key: 'mansions', book: '6a14e1cf311a9edd46224259', page: 8, tib: ['མེ་བཞི་ལ', 52], en: ['In <term>Purvaphalguni</term>, it is bad in the land', 135] },
  { key: 'title-leaf', book: '6abebae6896ea18127c8795c', page: 86, tib: ['', 0], en: ['', 0] },
  { key: 'pramana', book: 'vol:174', page: 312, tib: ['དོན་ནི་མ་ཡིན་ཏེ', 108], en: ['It is not an external object', 195] },
  { key: 'vinaya', book: 'vol:152', page: 302, tib: ['བྱེད་པ་པོའི་དགེ་འདུན', 48], en: ['it also becomes a grave', 125] },
];

/** The reader shows <term>/<gloss> as a term with its gloss; show the same here, in plain text. */
function plainEnglish(s) {
  return s
    .replace(/<term>(.*?)<\/term>\s*<gloss>(.*?)<\/gloss>/g, '$1 ($2)')
    .replace(/<\/?(term|gloss)>/g, '')
    .replace(/<note>(.*?)<\/note>/g, '[note: $1]')
    .replace(/<leaf-break\/>/g, ' ‖ ')
    .replace(/<meta>.*?<\/meta>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cut(text, [anchor, len], key, side) {
  if (!len) return null;
  if (!text) throw new Error(`${key}: no ${side} text stored`);
  const at = anchor ? text.indexOf(anchor) : 0;
  if (at < 0) throw new Error(`${key}: ${side} anchor "${anchor}" is no longer in the stored text`);
  let piece = text.slice(at, at + len);
  const after = at + len < text.length;
  if (after) {
    // End on a whole word: a space in English, a tsheg or shad in Tibetan.
    const stop = side === 'Tibetan' ? Math.max(piece.lastIndexOf('་'), piece.lastIndexOf('།')) : piece.lastIndexOf(' ');
    if (stop > len / 2) piece = piece.slice(0, side === 'Tibetan' ? stop + 1 : stop);
  }
  return { text: piece, before: at > 0, after };
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

// ── Census ──────────────────────────────────────────────────────────────────────────────
const live = { language: 'Tibetan', visible: true, pages_count: { $gt: 0 } };
const liveBooks = await books
  .find(live, { projection: { id: 1, title: 1, display_title: 1, contributing_library: 1, pages_count: 1 } })
  .toArray();
const groups = {
  bl: liveBooks.filter((b) => b.contributing_library === 'British Library'),
  tengyur: liveBooks.filter((b) => /\(Derge Tengyur, vol\. \d+\)/.test(b.title || '')),
  kangyur: liveBooks.filter((b) => /\(Derge Kangyur, vol\. \d+\)/.test(b.title || '')),
};
const inGroup = new Set([...groups.bl, ...groups.tengyur, ...groups.kangyur].map((b) => b.id));
groups.other = liveBooks.filter((b) => !inGroup.has(b.id));

// Per group: totals, the engines that read and translated the pages, and per book
// [id, title, public, pages scanned, transcribed, translated] for the progress squares on the page.
async function pageStates(list) {
  const ids = list.map((b) => b.id);
  const titles = new Map(list.map((b) => [b.id, b.display_title || b.title]));
  const perBook = new Map();
  const t = { pages: 0, tibetan: 0, yigdzin: 0, etext: 0, not_legible: 0, english: 0, english_by_model: {}, reader_by_model: {} };
  for (let i = 0; i < ids.length; i += 100) {
    const rows = await pages
      .aggregate(
        [
          { $match: { book_id: { $in: ids.slice(i, i + 100) } } },
          {
            $group: {
              _id: {
                book: '$book_id',
                reader: { $ifNull: ['$ocr.model', '$ocr.source'] },
                has: { $and: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $ne: ['$ocr.data', ''] }] },
                unreadable: { $eq: ['$ocr.unreadable', true] },
                en: {
                  $cond: [
                    { $and: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, { $ne: ['$translation.data', ''] }] },
                    { $ifNull: ['$translation.model', 'unknown'] },
                    null,
                  ],
                },
              },
              n: { $sum: 1 },
            },
          },
        ],
        { maxTimeMS: 120000 },
      )
      .toArray();
    for (const { _id, n } of rows) {
      const b = perBook.get(_id.book) ?? [_id.book, titles.get(_id.book) ?? '', true, 0, 0, 0];
      perBook.set(_id.book, b);
      t.pages += n;
      b[3] += n;
      if (_id.unreadable) { t.not_legible += n; continue; }
      if (_id.has) {
        t.tibetan += n;
        b[4] += n;
        const reader = _id.reader || 'unrecorded';
        t.reader_by_model[reader] = (t.reader_by_model[reader] || 0) + n;
      }
      if (_id.has && _id.reader === 'bdrc-yigdzin-v1') t.yigdzin += n;
      if (_id.has && /^esukhia/.test(_id.reader || '')) t.etext += n;
      if (_id.en) {
        t.english += n;
        b[5] += n;
        t.english_by_model[_id.en] = (t.english_by_model[_id.en] || 0) + n;
      }
    }
  }
  t.book_pages = [...perBook.values()].sort((a, b) => b[5] - a[5] || b[3] - a[3]);
  return t;
}

// --examples-only re-cuts the excerpts and keeps the census (and its date) from the existing file.
const examplesOnly = process.argv.includes('--examples-only');
const previous = examplesOnly ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
const census = previous ? previous.census : {};
if (!previous) {
  for (const [g, list] of Object.entries(groups)) {
    census[g] = { books: list.length, ...(await pageStates(list)) };
    const { book_pages, ...totals } = census[g];
    console.log(g, JSON.stringify(totals), `${book_pages.length} books`);
  }
}

// Tibetan volumes we hold that are not public yet: counted from the book records, not page by page.
const hidden = previous?.hidden ?? (await books
  .aggregate([
    { $match: { language: 'Tibetan', visible: { $ne: true }, pages_count: { $gt: 0 } } },
    { $group: { _id: null, books: { $sum: 1 }, pages: { $sum: '$pages_count' }, transcribed: { $sum: { $ifNull: ['$pages_ocr', 0] } }, translated: { $sum: { $ifNull: ['$pages_translated', 0] } } } },
    { $project: { _id: 0 } },
  ])
  .next());

// ── Book-level checks ───────────────────────────────────────────────────────────────────
// The latest row of `book_checks` for each public Tibetan book: [verdict, date, pages read, method].
// A check reads a few pages of a book against the page image; it is not a rate for the book.
let checks = previous?.checks;
if (!checks) {
  const rows = await db
    .collection('book_checks')
    .find({ book_id: { $in: liveBooks.map((b) => b.id) } }, { projection: { book_id: 1, verdict: 1, checked_at: 1, pages_read: 1, method_id: 1, 'reader.kind': 1 } })
    .sort({ checked_at: 1 })
    .toArray();
  const latest = {};
  for (const r of rows) {
    if (!['show', 'caveat', 'fix'].includes(r.verdict)) throw new Error(`book_checks ${r._id}: unknown verdict "${r.verdict}"`);
    latest[r.book_id] = [r.verdict, new Date(r.checked_at).toISOString().slice(0, 10), Array.isArray(r.pages_read) ? r.pages_read.length : 0, r.method_id];
  }
  const dates = rows.map((r) => new Date(r.checked_at).toISOString().slice(0, 10)).sort();
  checks = {
    rows: rows.length,
    by_people: rows.filter((r) => r.reader?.kind && r.reader.kind !== 'model').length,
    first: dates[0] ?? null,
    last: dates.at(-1) ?? null,
    latest,
  };
  console.log('checks', rows.length, 'rows,', Object.keys(latest).length, 'books,', checks.by_people, 'by people');
}

// ── Examples ────────────────────────────────────────────────────────────────────────────
const examples = {};
for (const ex of EXAMPLES) {
  const book = ex.book.startsWith('vol:')
    ? await books.findOne({ title: new RegExp(`\\(Derge Tengyur, vol\\. ${ex.book.slice(4)}\\)`) })
    : await books.findOne({ id: ex.book });
  if (!book) throw new Error(`${ex.key}: book ${ex.book} not found`);
  const p = await pages.findOne({ book_id: book.id, page_number: ex.page });
  if (!p) throw new Error(`${ex.key}: page ${ex.page} not found`);
  const en = cut(p.translation?.data, ex.en, ex.key, 'English');
  examples[ex.key] = {
    book_id: book.id,
    title: book.display_title || book.title,
    page: ex.page,
    image: getPageSource(p),
    tibetan_source: p.ocr?.text_edition?.name || p.ocr?.engine?.model_label || p.ocr?.model || null,
    not_legible: !!p.ocr?.unreadable,
    english_model: p.translation?.model || null,
    english_withheld: !p.translation?.data && p.translation_withheld?.reason ? p.translation_withheld.reason : null,
    tibetan: cut(p.ocr?.data, ex.tib, ex.key, 'Tibetan'),
    english: en ? { ...en, text: plainEnglish(en.text) } : null,
  };
  console.log(ex.key, book.id, ex.page, examples[ex.key].tibetan_source, examples[ex.key].english_model);
}

// ── Specimens of what goes wrong ─────────────────────────────────────────────────────────
// Every defect an AI reviewer recorded on a public Tibetan page it read against the scan
// (`lane_judge_verdicts`), counted by kind, with up to three specimens per kind. A specimen is kept only
// if its quoted Tibetan is still in the stored text of that page, so the reader can find it there.
// The pages come from runs with different sampling, so these are counts of what was found, not rates.
// Always re-read (cheap); kinds are the page-error taxonomy's codes (.claude/docs/page-error-taxonomy.md).
const KINDS = {
  O6: 'A word misread as another plausible word',
  O5: 'Text left out',
  O4: 'Text repeated',
  O12: 'Marginal notes and small writing',
  O7: 'Numbers',
  O1: 'Text that is not on the leaf',
  O3: 'A well-known text given in place of what the leaf says',
  O8: 'Spelling silently regularised',
  O10: 'A second script on the page',
  I5: 'Two leaves in one photograph',
  I1: 'Text from a different leaf',
  I7: 'Catalogue record does not match the volume',
  T5: 'Text carried over from a neighbouring page',
};
const NAMES_A_MODEL = /gemini|claude|opus|sonnet|flash|yigdzin|gpt|\bmodel\b|\bOCR\b/i;
const titleOf = new Map(liveBooks.map((b) => [b.id, b.display_title || b.title]));
const verdicts = await db
  .collection('lane_judge_verdicts')
  .find(verdictQuery({ book_id: { $in: liveBooks.map((b) => b.id) }, task: 'ocr' }), { projection: { book_id: 1, page_id: 1, page_number: 1, judged_at: 1, 'verdict.defects': 1 } })
  .sort({ judged_at: 1, _id: 1 })
  .toArray();
const storedText = new Map();
for (let i = 0; i < verdicts.length; i += 200) {
  const ids = verdicts.slice(i, i + 200).map((v) => v.page_id);
  for await (const p of pages.find({ id: { $in: ids } }, { projection: { id: 1, 'ocr.data': 1 } }).batchSize(1000)) storedText.set(p.id, p.ocr?.data || '');
}
const kinds = {};
let otherDefects = 0;
for (const v of verdicts) {
  for (const d of v.verdict?.defects || []) {
    if (!KINDS[d.class]) { otherDefects++; continue; }
    if (!['cosmetic', 'misleads', 'wrong_text'].includes(d.severity)) throw new Error(`verdict ${v._id}: unknown severity "${d.severity}"`);
    const k = (kinds[d.class] ||= { code: d.class, name: KINDS[d.class], cosmetic: 0, misleads: 0, wrong_text: 0, pages: new Set(), candidates: [] });
    k[d.severity]++;
    k.pages.add(v.page_id);
    const quote = (d.quote || '').trim();
    const what = (d.what || '').trim();
    if (d.severity === 'cosmetic' || !/[ཀ-ྼ]/.test(quote) || quote.length < 6 || quote.length > 140 || what.length < 20 || what.length > 320) continue;
    if (NAMES_A_MODEL.test(what) || !storedText.get(v.page_id)?.includes(quote)) continue;
    k.candidates.push({ book_id: v.book_id, title: titleOf.get(v.book_id) ?? '', page: v.page_number, severity: d.severity, quote, what });
  }
}
const judgedDates = verdicts.filter((v) => v.judged_at && new Date(v.judged_at).getFullYear() > 2020).map((v) => new Date(v.judged_at).toISOString().slice(0, 10)).sort();
const zoo = {
  judged_pages: verdicts.length,
  judged_books: new Set(verdicts.map((v) => v.book_id)).size,
  first: judgedDates[0] ?? null,
  last: judgedDates.at(-1) ?? null,
  other_defects: otherDefects,
  kinds: Object.values(kinds)
    .map(({ pages: pg, candidates, ...k }) => {
      // wrong text first, then one specimen per book, in the order the pages were judged
      const seen = new Set();
      const specimens = [...candidates]
        .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'wrong_text' ? -1 : 1))
        .filter((s) => (seen.has(s.book_id) ? false : seen.add(s.book_id)))
        .slice(0, 3);
      return { ...k, pages: pg.size, specimens };
    })
    .sort((a, b) => b.wrong_text + b.misleads - (a.wrong_text + a.misleads) || b.cosmetic - a.cosmetic),
};
console.log('zoo', zoo.judged_pages, 'judged pages,', zoo.kinds.map((k) => `${k.code}:${k.wrong_text}/${k.misleads}/${k.cosmetic} s${k.specimens.length}`).join(' '), 'other', otherDefects);

// ── Where a scholars' translation exists ─────────────────────────────────────────────────
// The Tengyur texts 84000 had published by 3 October 2026 (scripts/eval/results/tengyur-ref-2026-10/,
// the list the reference test used), each with the page in our volume where that text opens, so a reader
// can set 84000's English beside ours and the leaf. We link to 84000; we do not copy its text.
const published = JSON.parse(fs.readFileSync(new URL('../results/tengyur-ref-2026-10/84000-tengyur-published.json', import.meta.url), 'utf8'));
const human = [];
for (const t of published) {
  const vol = await books.findOne({ title: new RegExp(`\\(Derge Tengyur, vol\\. ${t.vol}\\)`), visible: true }, { projection: { id: 1 } });
  if (!vol) throw new Error(`84000 ${t.toh}: Derge Tengyur vol. ${t.vol} is not public`);
  const d = `D${t.toh.replace(/^toh/, '').replace(/[a-z]$/, '')}`;
  const opens =
    (await pages.findOne({ book_id: vol.id, 'ocr.text_edition.tohoku': d }, { projection: { page_number: 1, 'ocr.text_edition.folio': 1, 'translation.data': 1 } })) ??
    (await pages.findOne({ book_id: vol.id, 'ocr.text_edition.folio': { $in: [`${t.folio}a`, `${t.folio}b`] } }, { projection: { page_number: 1, 'ocr.text_edition.folio': 1, 'translation.data': 1 } }, { sort: { page_number: 1 } }));
  if (!opens) throw new Error(`84000 ${t.toh}: no page for ${d} or folio ${t.folio} in vol. ${t.vol}`);
  human.push({
    toh: t.toh.replace(/^toh/, ''),
    title: t.title,
    published: t.date,
    sides: Number(t.num_pages),
    vol: t.vol,
    book_id: vol.id,
    page: opens.page_number,
    folio: opens.ocr?.text_edition?.folio ?? null,
    has_english: typeof opens.translation?.data === 'string' && opens.translation.data !== '',
    url: `https://84000.co/translation/${t.toh}`,
  });
}
console.log('human', human.map((h) => `${h.toh}:v${h.vol}p${h.page}(${h.folio})${h.has_english ? '' : ' NO-EN'}`).join(' '));

await client.close();
const out = {
  _generated: 'by scripts/eval/tibetan-expert-page/build-examples.mjs, read-only from Mongo; do not edit by hand',
  measured: previous ? previous.measured : new Date().toISOString().slice(0, 10),
  census,
  hidden,
  checks,
  zoo,
  human,
  examples,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('wrote', OUT);
