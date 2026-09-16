#!/usr/bin/env node
/**
 * PRIOR ART: `scripts/maintenance/detect-language-mislabels.mjs` (#3026) detects and —
 * with `--apply` — FIXES `books.language` from OCR body text, scoring 7 script ranges
 * plus function words. It is a repair tool with a narrow script list (Greek,
 * Devanagari, Tibetan, Arabic, Hebrew, Cyrillic, Chinese): Syriac and Avestan, the
 * classes #4766 is about, are not in it and cannot be, without deciding what to write.
 * `scripts/maintenance/audit-language-mismatch.mjs` and
 * `classify-language-mismatch-content.mjs` classify a KNOWN mismatch set; nothing
 * produced the confusion MATRIX #4766 asks for first. This never writes, and it is
 * deliberately not a fixer: "do not batch-write language fields off a detector's
 * output without a hand-check of the largest cluster" (#4766).
 *
 * NOTE for whoever reads #4766: its suggested instrument does not exist.
 * `scripts/eval/lib/metrics.mjs` exports `scriptClassOf`, but that is a binary
 * spaced/spaceless selector for choosing an agreement metric, and there is no
 * `SCRIPT_DEFS`. This file carries the Unicode script classes instead.
 *
 * Which books' catalogued language disagrees with the script on their pages? (#4766)
 *
 * WHY IT MATTERS MORE THAN METADATA HYGIENE
 * Since #4762 `books.language` is a ROUTING input on two lanes: OCR picks flash vs
 * flash-lite from it, and translation picks its model from it. A non-Latin book
 * mislabelled as a Latin-script language routes to lite for OCR, which is the case
 * #1726 exists to prevent — lite hallucinates rather than fails on low-resource
 * scripts. It also corrupts every measurement stratified by language.
 *
 * METHOD, AND ITS LIMITS
 * One observation per BOOK (a book's pages are not independent samples): up to
 * `--pages` body pages are sampled, the OCR's own metadata tags and English image
 * descriptions are stripped, and the dominant Unicode script of what remains is
 * compared with the script(s) the catalogued language is written in.
 *
 * It can only speak about SCRIPT. Latin-script languages are one class here, so
 * French catalogued as Latin is invisible to this instrument — that is
 * `detect-language-mislabels.mjs`'s job, with its function words. What this catches is
 * the class that misroutes: a script the label does not predict.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/language-script-confusion.mjs --books=500
 *   node scripts/audit/language-script-confusion.mjs --mirror=$HOME/sl-corpus/books
 *   … --pages=N     body pages sampled per book (default 12)
 *   … --out=FILE    JSONL of every disagreeing book (default scripts/output/language-script-confusion.jsonl)
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
if (process.argv.includes('--apply') || process.argv.includes('--fix')) {
  console.error('This script never writes. Repairing a language field is a reviewed, separate step (#4766).');
  process.exit(2);
}
const MIRROR = arg('mirror', '');
const N_BOOKS = Number(arg('books', '500'));
const PAGES = Number(arg('pages', '12'));
const OUT = arg('out', 'scripts/output/language-script-confusion.jsonl');

/** Unicode script classes we can tell apart. Latin-script languages collapse to one. */
const SCRIPTS = [
  ['latin', /\p{Script=Latin}/u],
  ['greek', /\p{Script=Greek}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['syriac', /\p{Script=Syriac}/u],
  ['avestan', /\p{Script=Avestan}/u],
  ['armenian', /\p{Script=Armenian}/u],
  ['georgian', /\p{Script=Georgian}/u],
  ['ethiopic', /\p{Script=Ethiopic}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['bengali', /\p{Script=Bengali}/u],
  ['tamil', /\p{Script=Tamil}/u],
  ['tibetan', /\p{Script=Tibetan}/u],
  ['thai', /\p{Script=Thai}/u],
  ['khmer', /\p{Script=Khmer}/u],
  ['myanmar', /\p{Script=Myanmar}/u],
  ['balinese', /\p{Script=Balinese}/u],
  ['javanese', /\p{Script=Javanese}/u],
  ['sinhala', /\p{Script=Sinhala}/u],
  ['han', /\p{Script=Han}/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['cuneiform', /\p{Script=Cuneiform}/u],
  ['egyptian', /\p{Script=Egyptian_Hieroglyphs}/u],
  ['mongolian', /\p{Script=Mongolian}/u],
  ['coptic', /\p{Script=Coptic}/u],
];

/**
 * What script(s) a catalogued language is written in, for the languages this corpus
 * actually holds. A language absent here is reported as `unmapped` rather than guessed
 * — an unmapped label is a gap in this table, not evidence against the book.
 *
 * Several entries carry TWO scripts on purpose: Sanskrit is printed in Devanagari here
 * but romanised elsewhere; Middle Persian appears in Pahlavi (unencoded, transcribed
 * into Latin) and in Avestan script; Sogdian and Parthian likewise reach us mostly as
 * Latin transcription. Treating those as mismatches would fill the matrix with the
 * corpus's own editorial conventions.
 */
const LANG_SCRIPTS = {
  latin: ['latin'], english: ['latin'], german: ['latin'], french: ['latin'],
  italian: ['latin'], dutch: ['latin'], spanish: ['latin'], portuguese: ['latin'],
  swedish: ['latin'], danish: ['latin'], norwegian: ['latin'], polish: ['latin'],
  czech: ['latin'], hungarian: ['latin'], romanian: ['latin'], turkish: ['latin'],
  finnish: ['latin'], catalan: ['latin'], welsh: ['latin'], irish: ['latin'],
  malay: ['latin', 'arabic'], indonesian: ['latin'], vietnamese: ['latin', 'han'],
  'middle english': ['latin'], 'old english': ['latin'], esperanto: ['latin'],
  greek: ['greek'], 'ancient greek': ['greek'], 'classical greek': ['greek'],
  russian: ['cyrillic'], ukrainian: ['cyrillic'], bulgarian: ['cyrillic'],
  serbian: ['cyrillic', 'latin'], 'church slavonic': ['cyrillic'],
  hebrew: ['hebrew'], yiddish: ['hebrew'], aramaic: ['hebrew', 'syriac'],
  arabic: ['arabic'], persian: ['arabic'], urdu: ['arabic'], ottoman: ['arabic'],
  syriac: ['syriac'], avestan: ['avestan'],
  'middle persian': ['latin', 'avestan', 'arabic'], parthian: ['latin'], sogdian: ['latin'],
  armenian: ['armenian'], georgian: ['georgian'], "ge'ez": ['ethiopic'], amharic: ['ethiopic'],
  sanskrit: ['devanagari', 'latin'], hindi: ['devanagari'], marathi: ['devanagari'],
  nepali: ['devanagari'], bengali: ['bengali'], tamil: ['tamil'],
  pali: ['latin', 'devanagari', 'sinhala', 'thai', 'khmer', 'myanmar'],
  tibetan: ['tibetan'], dzongkha: ['tibetan'],
  thai: ['thai'], khmer: ['khmer'], burmese: ['myanmar'], sinhala: ['sinhala'],
  balinese: ['balinese'], javanese: ['javanese', 'latin'],
  chinese: ['han'], 'classical chinese': ['han'], korean: ['hangul', 'han'],
  japanese: ['kana', 'han'], mongolian: ['mongolian', 'cyrillic'], coptic: ['coptic'],
  sumerian: ['cuneiform', 'latin'], akkadian: ['cuneiform', 'latin'],
  'egyptian hieroglyphs': ['egyptian', 'latin'], egyptian: ['egyptian', 'latin'],
  'old turkic': ['latin'],
};

/** Metadata tags and English image-description prose are not the page's script. */
function bodyOf(ocr) {
  return String(ocr || '')
    .replace(/<image-desc[\s\S]*?<\/image-desc>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ');
}

function dominantScript(text) {
  const letters = [...bodyOf(text).replace(/[^\p{L}]/gu, '')].slice(0, 4000);
  if (letters.length < 40) return { script: 'unknown', share: 0, letters: letters.length };
  const counts = new Map();
  for (const ch of letters) {
    for (const [name, re] of SCRIPTS) {
      if (re.test(ch)) { counts.set(name, (counts.get(name) || 0) + 1); break; }
    }
  }
  let best = ['unknown', 0];
  for (const e of counts) if (e[1] > best[1]) best = e;
  return { script: best[0], share: best[1] / letters.length, letters: letters.length };
}

/** The catalogued language, lower-cased and stripped of the corpus's own decorations. */
function normLang(lang) {
  return String(lang || '')
    .replace(/\(script\)/gi, ' ')
    .split(/[;,/|]/)[0]
    .replace(/[^a-z' ]/gi, ' ')
    .trim()
    .toLowerCase();
}

const stats = { books: 0, judged: 0, agree: 0, disagree: 0, unmapped: 0, unknownScript: 0 };
const matrix = new Map();

function judge({ id, title, lang, texts }, sink) {
  stats.books++;
  const joined = texts.filter(Boolean).slice(0, PAGES).join('\n');
  const { script, share, letters } = dominantScript(joined);
  if (script === 'unknown') { stats.unknownScript++; return; }
  const key = normLang(lang);
  const expected = LANG_SCRIPTS[key];
  if (!expected) { stats.unmapped++; return; }
  stats.judged++;
  const ok = expected.includes(script);
  if (ok) { stats.agree++; return; }
  stats.disagree++;
  const cell = `${key} → ${script}`;
  matrix.set(cell, (matrix.get(cell) || 0) + 1);
  sink.write(`${JSON.stringify({ book_id: id, title, language: lang, expected, found: script, share: +share.toFixed(2), letters, pages_sampled: texts.length })}\n`);
}

async function fromMirror(sink) {
  const files = fs.readdirSync(MIRROR).filter((f) => f.endsWith('.jsonl'));
  const langById = new Map();
  const booksJsonl = path.join(path.dirname(MIRROR), 'books.jsonl');
  if (fs.existsSync(booksJsonl)) {
    for (const line of fs.readFileSync(booksJsonl, 'utf8').split('\n')) {
      if (!line) continue;
      try { const b = JSON.parse(line); langById.set(b.id, { lang: b.lang ?? b.language, title: b.title }); } catch { /* skip */ }
    }
  }
  console.log(`mirror: ${files.length} books, ${langById.size} catalogue rows`);
  for (const f of files) {
    const id = f.replace(/\.jsonl$/, '');
    const meta = langById.get(id);
    if (!meta?.lang) continue;
    let texts = [];
    try {
      const rows = fs.readFileSync(path.join(MIRROR, f), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
      // Skip the front matter: covers and title pages are where a Latin-script
      // library stamp sits on an otherwise non-Latin book.
      texts = rows.slice(Math.min(8, Math.floor(rows.length / 4))).map((r) => r.ocr).filter(Boolean).slice(0, PAGES);
    } catch { continue; }
    if (!texts.length) continue;
    judge({ id, title: meta.title, lang: meta.lang, texts }, sink);
  }
}

async function fromAtlas(sink) {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = await db.collection('books').aggregate([
    { $match: { visible: true, pages_ocr: { $gt: 10 }, language: { $exists: true, $nin: [null, ''] } } },
    { $sample: { size: N_BOOKS } },
    { $project: { id: 1, title: 1, language: 1 } },
  ], { maxTimeMS: 180000 }).toArray();
  console.log(`atlas: ${books.length} sampled books`);
  for (const b of books) {
    const rows = await db.collection('pages')
      .find({ book_id: b.id, page_number: { $gt: 8 }, 'ocr.data': { $exists: true, $ne: '' } },
        { projection: { _id: 0, 'ocr.data': 1 } })
      .limit(PAGES).toArray();
    if (!rows.length) continue;
    judge({ id: b.id, title: b.title, lang: b.language, texts: rows.map((r) => r.ocr?.data) }, sink);
  }
  await client.close();
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const sink = fs.createWriteStream(OUT, { flags: 'w' });
  if (MIRROR) await fromMirror(sink);
  else {
    if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }
    await fromAtlas(sink);
  }
  sink.end();

  console.log(`\nbooks seen ${stats.books} | judged ${stats.judged} | agree ${stats.agree} | DISAGREE ${stats.disagree}`);
  console.log(`skipped: ${stats.unmapped} unmapped language, ${stats.unknownScript} too little text to judge`);
  console.log('\nconfusion (catalogued → found on the page):');
  for (const [cell, n] of [...matrix].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`  ${String(n).padStart(5)}  ${cell}`);
  }
  console.log(`\nRows: ${OUT}`);
  console.log('Largest cluster first, and hand-read it before believing it (#4766).');
}

main().catch((e) => { console.error(e); process.exit(1); });
