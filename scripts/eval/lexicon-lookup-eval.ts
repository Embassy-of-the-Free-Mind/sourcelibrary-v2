/**
 * Phase-1 eval gate for the parsing reader (#3823): measure the lexicon
 * lookup chain against REAL OCR — not clean critical editions — before any
 * UI ships on top of it.
 *
 * Samples words from interior OCR pages of visible Latin books (front matter
 * lies — see lesson), runs the exact production chain (lookupLatinWord), and
 * reports hit rate per tier plus every miss and a random sample of hits for
 * manual precision spot-checking. Writes a scorecard JSON to
 * scripts/eval/results/.
 *
 * Run:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/eval/lexicon-lookup-eval.ts [--books 25] [--words 500]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { lookupLatinWord } from '../../src/lib/lexicon/lookup';
import { cleanOcrToken, normalizeLatin } from '../../src/lib/lexicon/normalize';

const args = process.argv.slice(2);
function flag(name: string, dflt: number): number {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
}
const N_BOOKS = flag('books', 25);
const N_WORDS = flag('words', 500);

const ROMAN_NUMERAL = /^[ivxlcdm]+$/;

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'bookstore';
  if (!uri) throw new Error('MONGODB_URI not set');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // Latin books, canonical live filter (visible + processed).
  const books = await db
    .collection('books')
    .aggregate([
      {
        $match: {
          visible: true,
          pages_ocr: { $gt: 20 },
          language: { $in: ['la', 'lat', 'Latin', 'latin'] },
        },
      },
      { $sample: { size: N_BOOKS } },
      { $project: { id: 1, title: 1, published: 1, pages_count: 1 } },
    ])
    .toArray();
  if (books.length < 15) throw new Error(`Only ${books.length} Latin books matched — check the language filter.`);
  console.log(`Sampled ${books.length} Latin books`);

  const perBook = Math.ceil(N_WORDS / books.length);
  interface Sample { word: string; bookId: string; title: string; page: number }
  const samples: Sample[] = [];

  for (const b of books) {
    // Interior pages only: skip the first/last 15% (front matter lies).
    const total = b.pages_count || 100;
    const lo = Math.floor(total * 0.15);
    const hi = Math.ceil(total * 0.85);
    const pages = await db
      .collection('pages')
      .aggregate([
        { $match: { book_id: b.id, page_number: { $gte: lo, $lte: hi }, 'ocr.data': { $type: 'string' } } },
        { $sample: { size: 3 } },
        { $project: { page_number: 1, 'ocr.data': 1 } },
      ])
      .toArray();
    const words: string[] = [];
    for (const p of pages) {
      // OCR text embeds structural XML (<page-type>, <scan-quality>,
      // <image-desc>English prose</image-desc>, <margin>, <vocab>…) — strip
      // element content that isn't source text, then the tags themselves,
      // before tokenizing. A reader clicking words never sees these.
      const text: string = (p.ocr?.data ?? '')
        .replace(/<(image-desc|page-type|scan-quality|script|header)>[\s\S]*?<\/\1>/g, ' ')
        .replace(/<[^<>]{1,60}>/g, ' ')
        // rejoin line-break hyphenation: "ha-\nbentur" → habentur
        .replace(/[-­]\s*\n\s*/g, '');
      for (const tok of text.split(/[\s.·:]+/)) {
        const w = cleanOcrToken(tok);
        const norm = normalizeLatin(w);
        if (norm.length >= 3 && !ROMAN_NUMERAL.test(norm) && !/[\d<>="/]/.test(w)) {
          words.push(w);
        }
      }
    }
    // Random sample without replacement, dedupe within book.
    const seen = new Set<string>();
    while (seen.size < perBook && words.length) {
      const i = Math.floor(Math.random() * words.length);
      const [w] = words.splice(i, 1);
      if (!seen.has(w.toLowerCase())) {
        seen.add(w.toLowerCase());
        const page = pages[0]?.page_number ?? 0;
        samples.push({ word: w, bookId: b.id, title: String(b.title).slice(0, 60), page });
      }
    }
  }
  const finalSamples = samples.slice(0, N_WORDS);
  console.log(`Collected ${finalSamples.length} word samples; running lookups…`);

  const tierCounts: Record<string, number> = {};
  const misses: Array<{ word: string; title: string }> = [];
  const hits: Array<{ word: string; headword: string; tier: string; title: string }> = [];
  let done = 0;
  for (const s of finalSamples) {
    const res = await lookupLatinWord(db, s.word);
    if (res.found) {
      const m = res.matches[0];
      tierCounts[m.matchType] = (tierCounts[m.matchType] || 0) + 1;
      hits.push({ word: s.word, headword: m.headword, tier: m.matchType, title: s.title });
    } else {
      tierCounts.miss = (tierCounts.miss || 0) + 1;
      misses.push({ word: s.word, title: s.title });
    }
    if (++done % 100 === 0) console.log(`  ${done}/${finalSamples.length}`);
  }

  const n = finalSamples.length;
  const found = n - (tierCounts.miss || 0);
  const confident = (tierCounts.exact || 0) + (tierCounts.variant || 0) + (tierCounts.irregular || 0) + (tierCounts.inflected || 0);
  const scorecard = {
    date: new Date().toISOString().slice(0, 10),
    issue: 3823,
    sample: { books: books.length, words: n, selection: 'interior pages (15–85%), tokens ≥3 letters, non-numeric' },
    hitRate: +(found / n).toFixed(3),
    confidentHitRate: +(confident / n).toFixed(3),
    tierCounts,
    spotCheckHits: hits.sort(() => Math.random() - 0.5).slice(0, 40),
    misses,
  };
  const outPath = path.join('scripts/eval/results', `lexicon-lookup-eval-${scorecard.date}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(scorecard, null, 2));
  console.log(`\nHit rate: ${(scorecard.hitRate * 100).toFixed(1)}% (confident tiers: ${(scorecard.confidentHitRate * 100).toFixed(1)}%)`);
  console.log('Tiers:', tierCounts);
  console.log(`Scorecard → ${outPath}`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
