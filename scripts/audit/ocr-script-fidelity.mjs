#!/usr/bin/env node
/**
 * Does a book's OCR actually contain the script its language is written in?
 *
 * WHY (#4523)
 * -----------
 * Tibetan manuscript folios were found transcribed as Devanagari Hindu
 * scripture — "॥ श्रीरामचन्द्राय नमः ॥" on a Bhutanese Nyingma pecha, with the
 * English translation faithfully rendering the invention. The images were
 * correct; the transcription layer had invented a different text in a different
 * language, script and religion.
 *
 * The existing `detect-fabricated-ocr.mjs` cannot catch this: it keys on INK
 * COVERAGE, finding invented text on near-blank leaves. These folios are
 * densely written, so they pass that screen. This is the same failure class on
 * NON-blank pages, and it needs its own detector.
 *
 * THE SCREEN IS A SCREEN, NOT A VERDICT — and the first version of it was
 * wrong. Measuring only "page lacks its own script" reported Korean at 8.9% and
 * Greek at 19.6%, which looks catastrophic and is almost entirely an artifact:
 *
 *   - Korean classical texts are written in HANMUN — Chinese characters. A
 *     Korean book full of 漢字 is correct, not broken. (29% of its pages are
 *     front matter, 58% legitimate hanmun; only 4.3% is unexplained.)
 *   - Greek editions are frequently bilingual with Latin. (0.9% unexplained.)
 *   - Front matter — title pages, bookplates, Google/IA boilerplate — is in
 *     English by nature.
 *
 * So the signal is not "own script missing". It is "own script missing AND the
 * substitute has no legitimate story", and the strongest form is a substitute
 * from a FOREIGN NON-LATIN script — a Tibetan page rendered in Devanagari has
 * no innocent explanation, where a Tibetan page rendered in Latin might be
 * romanisation.
 *
 * Measured 2026-09-01, 60 books x 12 pages per language:
 *
 *   language    expected%  frontmatter%  legit-sub%  UNEXPLAINED%
 *   Tibetan       69.0        8.8          0.0        22.3   <-- devanagari:104
 *   Syriac        38.3       42.2          0.0        19.5
 *   Persian       38.9       41.8          0.0        19.3
 *   Hebrew        54.1       32.7          0.0        13.2
 *   Arabic        67.3       24.4          0.0         8.3
 *   Armenian      51.5       41.1          0.0         7.5
 *   Japanese      66.2       17.0         11.8         5.0
 *   Korean         8.9       29.2         57.6         4.3
 *   Chinese       96.5        2.4          0.0         1.0
 *   Greek         19.6       54.2         25.3         0.9
 *   Sanskrit      77.9        7.4         14.7         0.0
 *   Russian       66.3       30.7          3.0         0.0
 *
 * Tibetan is the outlier, and the only language whose unexplained substitute is
 * a foreign non-Latin script at scale. Elsewhere the residue is `latin-only`,
 * which is a milder and different question (romanisation vs. transcription).
 *
 * NEVER WRITES. Quarantine and re-OCR are separate, reviewed steps.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/ocr-script-fidelity.mjs
 *   node --env-file=.env.production.local scripts/audit/ocr-script-fidelity.mjs \
 *     --language=Tibetan --books=200 --pages=20 --list
 */
import { MongoClient } from 'mongodb';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const ONLY = arg('language', null);
const NBOOKS = parseInt(arg('books', '60'), 10);
const NPAGES = parseInt(arg('pages', '12'), 10);
const LIST = process.argv.includes('--list');

const S = {
  tibetan: /[ༀ-࿿]/, han: /[一-鿿]/, kana: /[぀-ヿ]/, hangul: /[가-힯ᄀ-ᇿ]/,
  arabic: /[؀-ۿ]/, hebrew: /[֐-׿]/, syriac: /[܀-ݏ]/, armenian: /[԰-֏]/,
  devanagari: /[ऀ-ॿ]/, greek: /[Ͱ-Ͽἀ-῿]/, cyrillic: /[Ѐ-ӿ]/,
};
const EXPECT = {
  Tibetan: 'tibetan', Chinese: 'han', Japanese: 'kana', Korean: 'hangul',
  Arabic: 'arabic', Persian: 'arabic', Hebrew: 'hebrew', Syriac: 'syriac',
  Armenian: 'armenian', Sanskrit: 'devanagari', Greek: 'greek', Russian: 'cyrillic',
};
/** Substitutes with a real-world explanation, per language. */
const LEGIT = {
  Korean: ['han'], Japanese: ['han'], Sanskrit: ['tibetan', 'latin'],
  Greek: ['latin'], Russian: ['latin'], Persian: ['arabic'], Tibetan: [],
};
const FRONT = /google|digiti[sz]|bookplate|library of|ex libris|this is a digital copy|internet archive|<page-type>\s*(cover|blank|title-page|frontispiece)/i;

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');

const langs = ONLY ? { [ONLY]: EXPECT[ONLY] } : EXPECT;
console.log('language    pages  expected%  frontmatter%  legit-sub%  UNEXPLAINED%   top substitutes');
for (const [lang, want] of Object.entries(langs)) {
  if (!want) { console.error(`unknown language "${lang}"`); continue; }
  const bs = await db.collection('books')
    .find({ language: lang, pages_ocr: { $gt: 0 } }, { projection: { id: 1, title: 1, is_first_translation: 1 } })
    .limit(NBOOKS).toArray();
  if (!bs.length) continue;
  let n = 0, ok = 0, front = 0, legit = 0, bad = 0;
  const subs = new Map();
  const flagged = [];
  for (const b of bs) {
    const pages = await db.collection('pages')
      .find({ book_id: String(b.id), 'ocr.data': { $type: 'string' } }, { projection: { page_number: 1, 'ocr.data': 1 } })
      .limit(NPAGES).toArray();
    let bookBad = 0;
    for (const p of pages) {
      const t = p.ocr?.data || '';
      if (t.length < 80) continue;
      n++;
      if (S[want].test(t)) { ok++; continue; }
      if (FRONT.test(t)) { front++; continue; }
      const present = Object.entries(S).filter(([k, rx]) => k !== want && rx.test(t)).map(([k]) => k);
      const allowed = LEGIT[lang] || [];
      if (present.length && present.every((x) => allowed.includes(x))) { legit++; continue; }
      if (!present.length && allowed.includes('latin')) { legit++; continue; }
      bad++; bookBad++;
      for (const x of (present.length ? present : ['latin-only'])) subs.set(x, (subs.get(x) || 0) + 1);
    }
    if (bookBad) flagged.push({ id: String(b.id), title: (b.title || '').slice(0, 46), bad: bookBad, badged: b.is_first_translation === true });
  }
  if (!n) continue;
  const top = [...subs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(
    `${lang.padEnd(11)} ${String(n).padStart(5)}  ${((100 * ok) / n).toFixed(1).padStart(7)}%  ${((100 * front) / n).toFixed(1).padStart(10)}%  ${((100 * legit) / n).toFixed(1).padStart(8)}%  ${((100 * bad) / n).toFixed(1).padStart(10)}%   ${top}`,
  );
  if (LIST) {
    flagged.sort((a, b) => b.bad - a.bad);
    for (const f of flagged.slice(0, 40)) console.log(`    ${String(f.bad).padStart(3)} pages  badged=${f.badged ? 'Y' : 'n'}  ${f.id}  ${f.title}`);
  }
}
await c.close();
