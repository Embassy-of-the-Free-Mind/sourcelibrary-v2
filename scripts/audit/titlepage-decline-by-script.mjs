#!/usr/bin/env node
/**
 * Is "the front matter names no author" a fact about the BOOK, or about the
 * reader?
 *
 * The full run returned that verdict for 2,641 of 3,856 books and I reported it
 * as the model correctly declining. A spot check of twelve of them says
 * otherwise, and this file is the measurement that followed.
 *
 *   NON-LATIN script languages : 93% declined  (1,679 of 1,815)
 *   Latin script languages     : 47% declined  (962 of 2,065)
 *
 *   Chinese 99% · Korean 100% · Japanese 100% · Tibetan 98% · Malay 100%
 *   Hebrew 92% · Arabic 89% · Sumerian 99%   vs   Italian 22% · Latin 44%
 *
 * Some of that is real: the Sumerian is ETCSL transliteration of genuinely
 * anonymous literature, and a Tibetan Kanjur volume is canonical scripture with
 * no personal author. Those SHOULD decline near 100%.
 *
 * But Chinese at 99% and Arabic at 89% are not credible, and the spot check
 * shows why — the author is on the page and the reader cannot see it:
 *
 *   三才圖會   p2 「雲間元翰父王圻纂集 - 男思義校正」
 *              = compiled by Wang Qi, collated by his son Siyi. That IS the
 *                catalogued byline, stated in the standard Chinese formula.
 *   Ajwibat…   p1 «لابن أبي بكر الكردي» = "by Ibn Abi Bakr al-Kurdi", and the
 *                preface repeats it in full. Also the catalogued byline.
 *
 * CAUSE: the prompt teaches European attribution formulas only — the Latin
 * genitive, `auctore`, `par`, `tradotto da`, `apud`. It says nothing about
 * 撰 / 著 / 纂集 / 輯 / 校正, Arabic لـ and تأليف, or the Tibetan and Korean
 * colophon conventions. A reader taught one tradition's grammar reports the
 * others as silent.
 *
 * WHY THIS MATTERS BEYOND THIS SCRIPT: "no author named" reads like a fact
 * about the book. It was being produced at 93% for the non-Latin corpus, which
 * is the same population already measured as having almost no English titles
 * (Chinese 17% / Tibetan 0% / Korean 0% coverage). The library underserves the
 * same books twice, and both times the instrument reports silence rather than
 * failure.
 *
 * Read-only.
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';

const lines = readFileSync('scripts/output/titlepage-attribution-proposals.jsonl', 'utf8').trim().split('\n')
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const noAuthor = lines.filter((r) => r.no_author_named).map((r) => r.book_id);
const proposed = new Set(lines.filter((r) => r.proposed).map((r) => r.book_id));

const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await c.connect();
const B = c.db('bookstore').collection('books');

const stat = new Map(); // language -> {no, yes}
const bump = (lang, key) => {
  if (!stat.has(lang)) stat.set(lang, { no: 0, yes: 0 });
  stat.get(lang)[key]++;
};
for (let i = 0; i < noAuthor.length; i += 500) {
  for (const b of await B.find({ id: { $in: noAuthor.slice(i, i + 500) } }, { projection: { id: 1, language: 1 } }).toArray()) {
    bump(b.language ?? 'unknown', 'no');
  }
}
for (const chunk of [[...proposed]]) {
  for (let i = 0; i < chunk.length; i += 500) {
    for (const b of await B.find({ id: { $in: chunk.slice(i, i + 500) } }, { projection: { id: 1, language: 1 } }).toArray()) {
      bump(b.language ?? 'unknown', 'yes');
    }
  }
}

const NON_LATIN = new Set(['Chinese', 'Literary Chinese', 'Classical Chinese', 'Japanese', 'Korean', 'Tibetan',
  'Arabic', 'Persian', 'Hebrew', 'Sanskrit', 'Sumerian', 'Akkadian', 'Russian', 'Greek', 'Syriac', 'Armenian', 'Coptic']);

console.log('  language           no-author   proposed    % declined');
let nlNo = 0, nlYes = 0, latNo = 0, latYes = 0;
for (const [lang, v] of [...stat.entries()].sort((a, b) => (b[1].no + b[1].yes) - (a[1].no + a[1].yes)).slice(0, 16)) {
  const tot = v.no + v.yes;
  console.log(`  ${String(lang).slice(0, 18).padEnd(18)} ${String(v.no).padStart(6)} ${String(v.yes).padStart(10)} ${String(Math.round(100 * v.no / tot) + '%').padStart(12)}`);
}
for (const [lang, v] of stat) {
  if (NON_LATIN.has(lang)) { nlNo += v.no; nlYes += v.yes; } else { latNo += v.no; latYes += v.yes; }
}
console.log(`\n  NON-LATIN-SCRIPT languages : ${nlNo} declined / ${nlNo + nlYes} read = ${Math.round(100 * nlNo / (nlNo + nlYes))}% declined`);
console.log(`  Latin-script languages     : ${latNo} declined / ${latNo + latYes} read = ${Math.round(100 * latNo / (latNo + latYes))}% declined`);
await c.close();
