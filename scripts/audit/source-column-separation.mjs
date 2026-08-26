#!/usr/bin/env node
/**
 * Does the Spanish-column test actually separate the columns? — the positive
 * control for `scripts/lib/source-column.mjs`.
 *
 * The mechanism it measures is cheap to believe and expensive to be wrong about:
 * it decides which half of a parallel-text page reaches a Spanish reader, and a
 * misfire puts K'iche' or Nahuatl into the Spanish lane, where it is retrieved
 * for Spanish queries and quoted as the Spanish edition. So the threshold is not
 * argued for in a comment — it is measured here, on every book the writer will
 * touch, plus controls at both ends:
 *
 *   POSITIVE  a book written in Spanish            → nearly every page accepted
 *   NEGATIVE  a monolingual non-Spanish book       → nearly no page accepted
 *
 * A run prints, per book, how many columns are CLOSE CALLS — columns whose
 * accept/decline verdict would flip if either threshold moved by a quarter. That
 * is the number to read. If it rises, the word list or the thresholds moved and
 * the writer must not be run until it is understood; see the note on the word
 * list in `source-column.mjs`, which is the thing most likely to have changed.
 *
 *   node --env-file=.env.production.local scripts/audit/source-column-separation.mjs
 *   node --env-file=.env.production.local scripts/audit/source-column-separation.mjs --book=<id>
 */
import { MongoClient } from 'mongodb';
import {
  pageColumns, spanishFunctionWordShare, spanishColumnText, isBilingualEditionLanguage,
  MIN_WORDS, MIN_SHARE, MIN_EXCLUSIVE,
} from '../lib/source-column.mjs';

const only = (process.argv.find((a) => a.startsWith('--book=')) || '').split('=')[1];

/**
 * The controls are named by `books.language`, not by id, so the audit keeps
 * working as the corpus grows and does not quietly measure a deleted book.
 */
const CONTROLS = [
  { label: 'POSITIVE (written in Spanish)', filter: { language: 'Spanish', visible: true, pages_ocr: { $gt: 200 } }, expect: 'most pages accepted' },
  { label: 'NEGATIVE (monolingual Latin)', filter: { language: 'Latin', visible: true, pages_ocr: { $gt: 200 } }, expect: 'almost no page accepted' },
  { label: 'NEGATIVE (monolingual Greek)', filter: { language: 'Greek', visible: true, pages_ocr: { $gt: 200 } }, expect: 'almost no page accepted' },
];

const pct = (x) => `${(100 * x).toFixed(1)}%`;
function quantiles(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], p25: q(0.25), med: q(0.5), p75: q(0.75), max: s[s.length - 1] };
}

async function measure(db, book, { sample = 0 } = {}) {
  const cursor = db.collection('pages').find({ book_id: book.id }).project({ page_number: 1, 'ocr.data': 1 }).sort({ page_number: 1 });
  if (sample) cursor.limit(sample);
  const pages = await cursor.toArray();

  const above = [];       // broad share of columns at or over the bar
  const below = [];       // broad share of columns under it
  const ambiguous = [];   // columns whose verdict is not robust to the thresholds
  const exclusiveAbove = [];
  const exclusiveBelow = [];
  let accepted = 0, noText = 0, declined = 0, singleCol = 0, multiCol = 0;

  for (const p of pages) {
    const cols = pageColumns(p.ocr?.data);
    if (!cols.length) { noText++; continue; }
    if (cols.length > 1) multiCol++; else singleCol++;
    const res = spanishColumnText(p.ocr?.data);
    if (res) accepted++; else declined++;
    // Score every column regardless of the verdict, so the distributions below
    // describe the DATA and not the decision the code just made.
    for (const c of cols) {
      const { share, exclusive, words } = spanishFunctionWordShare(c);
      if (words < MIN_WORDS) continue;
      if (share >= MIN_SHARE) { above.push(share); exclusiveAbove.push(exclusive); }
      else { below.push(share); exclusiveBelow.push(exclusive); }
      // A close call is a column whose verdict would FLIP if either threshold
      // moved by a quarter. Measuring "how many columns sit near the broad bar"
      // instead reports every French column as a close call on a book where the
      // exclusive test separates them by 19 points — it measures one half of a
      // two-part decision, which is how an instrument reports a problem the
      // mechanism does not have.
      const verdict = (s, x) => share >= s && exclusive >= x;
      const strict = verdict(MIN_SHARE * 1.25, MIN_EXCLUSIVE * 1.25);
      const loose = verdict(MIN_SHARE * 0.75, MIN_EXCLUSIVE * 0.75);
      if (strict !== loose) ambiguous.push({ share, exclusive, words, page: p.page_number });
    }
  }

  return { pages: pages.length, accepted, declined, noText, singleCol, multiCol, above, below, ambiguous, exclusiveAbove, exclusiveBelow };
}

/**
 * The honest question is NOT "how far apart are the two groups the threshold just
 * created" — partitioning at 18% and then reporting min(above) − max(below)
 * measures the instrument, not the corpus, and reads as 0.0% on any dense
 * distribution. It is "how much of the corpus sits where the decision is a
 * coin-flip", which is what CLOSE CALLS counts. The two distributions are still
 * printed, because a reader should be able to see the shape the verdict came
 * from rather than take one summary number on trust.
 */
function report(label, book, m) {
  const a = quantiles(m.above);
  const b = quantiles(m.below);
  const ea = quantiles(m.exclusiveAbove);
  const eb = quantiles(m.exclusiveBelow);
  const scored = m.above.length + m.below.length;
  const ambRate = scored ? m.ambiguous.length / scored : 0;
  console.log(`\n${label}`);
  console.log(`  ${String(book.title || '').slice(0, 74)}`);
  console.log(`  id=${book.id}  language=${JSON.stringify(book.language)}  pages=${m.pages}`);
  console.log(`  columns: ${m.multiCol} multi · ${m.singleCol} single · ${m.noText} no text`);
  console.log(`  verdict: ${m.accepted} pages yield Spanish · ${m.declined} declined  (${pct(m.accepted / Math.max(1, m.pages))} of pages)`);
  console.log(`  broad share    ≥${pct(MIN_SHARE)} (n=${m.above.length}): ${a ? `med ${pct(a.med)} · p25 ${pct(a.p25)}` : '—'}   <${pct(MIN_SHARE)} (n=${m.below.length}): ${b ? `med ${pct(b.med)} · p75 ${pct(b.p75)}` : '—'}`);
  console.log(`  exclusive      same split (bar ${pct(MIN_EXCLUSIVE)}): ${ea ? `med ${pct(ea.med)} · p25 ${pct(ea.p25)}` : '—'}   |   ${eb ? `med ${pct(eb.med)} · p75 ${pct(eb.p75)}` : '—'}`);
  console.log(`  CLOSE CALLS (verdict flips if either bar moves ±25%): ${m.ambiguous.length}/${scored} columns = ${pct(ambRate)} ${ambRate < 0.03 ? '(clean)' : '*** the threshold is splitting a continuum — hand-check before running the writer ***'}`);
  if (m.ambiguous.length) {
    const sample = m.ambiguous.slice(0, 5).map((x) => `p${x.page} ${pct(x.share)}/${pct(x.exclusive)}`).join('  ');
    console.log(`    sample (broad/exclusive): ${sample}`);
  }
}

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');

// The books the writer would touch: catalogued bilingual with Spanish, plus any
// book explicitly named on the command line (the Ximénez manuscript is
// catalogued under K'iche' alone and is the reason --book exists).
const candidates = only
  ? await db.collection('books').find({ id: only }).project({ id: 1, title: 1, language: 1 }).toArray()
  : (await db.collection('books').find({ visible: true, pages_ocr: { $gt: 0 } })
      .project({ id: 1, title: 1, language: 1 }).toArray())
      .filter((b) => isBilingualEditionLanguage(b.language, 'es'));

console.log(`Spanish-column separation — ${candidates.length} candidate book(s)`);
for (const b of candidates) report('CANDIDATE', b, await measure(db, b));

if (!only) {
  for (const c of CONTROLS) {
    const book = await db.collection('books').find(c.filter).project({ id: 1, title: 1, language: 1 }).limit(1).next();
    if (!book) { console.log(`\n${c.label}: no book matched ${JSON.stringify(c.filter)}`); continue; }
    report(`${c.label} — expect ${c.expect}`, book, await measure(db, book, { sample: 200 }));
  }
}

await client.close();
