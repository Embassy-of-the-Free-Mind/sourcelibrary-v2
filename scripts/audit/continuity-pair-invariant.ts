// PRIOR ART: scripts/lib/block-drift.mjs — compares whole text BLOCKS across pages to find
// shifted leaves; it never calls pageContinuity, so it cannot say whether get_quote's two
// edge flags agree. tests/unit/page-continuity.test.ts asserts the invariant on three
// captured pages only. Nothing measured it over the corpus.
/**
 * continuity-pair-invariant — do get_quote's continuity flags agree across a leaf?
 *
 * WHY THIS EXISTS (#3721)
 * `pageContinuity` (src/lib/page-continuity.ts) judges each page's two edges on
 * its own. For adjacent pages N and N+1 the two verdicts describe the SAME
 * boundary, so
 *
 *     N.continues_on_next  ===  (N+1).continues_from_previous
 *
 * should hold without reading a word of either page. Where it does not, one
 * side is wrong, and the reporter of #3721 found the detector wrong in both
 * directions that way. Two mechanisms were found from single pages (#3723: the
 * translator's ellipsis; this script's PR: a trailing <note>). This is the
 * class-level view the issue asked for.
 *
 * WHAT IT MEASURES
 * A random draw of live books, one run of consecutive pages from each, text
 * treated exactly as the quote API serves it (stripEditorialWrappers, trimmed)
 * and judged by the real `pageContinuity` — imported, not reimplemented.
 *
 * WHAT IT DOES NOT SAY
 * A disagreement is not always a detector bug. The invariant is only well posed
 * when both flags describe the same stream; facing-page translations, footnote
 * streams and a page that ends a chapter above a catch-line all break it
 * honestly (the reporter's own caveat on #3721). So this prints a RATE and the
 * tail shapes behind it, and exits 0. It is an instrument for whoever changes
 * the predicates, not an alarm.
 *
 * USAGE (read-only; ~1 min)
 *   npx tsx --env-file=.env.production.local scripts/audit/continuity-pair-invariant.ts
 *     [--books 150] [--run 24] [--seed 1] [--out <file.jsonl>]
 *
 * The draw is seeded, so the same --seed reads the same pages before and after a
 * change to the predicates. --out writes every disagreeing pair.
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';
import { pageContinuity } from '../../src/lib/page-continuity';
import { stripEditorialWrappers } from '../../src/lib/strip-editorial-wrappers';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BOOKS = Number(arg('books', '150'));
const RUN = Number(arg('run', '24'));
const OUT = arg('out', '');

/** mulberry32 — a seeded draw, so a before/after comparison reads the same pages. */
let seed = Number(arg('seed', '1')) >>> 0;
function rand(): number {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** What the raw tail ends on — the thing the edge test actually has to see through. */
function tailShape(text: string): string {
  const t = text.trimEnd();
  const tag = t.match(/<\/([a-z][a-z-]*)>$/i);
  if (tag) return `</${tag[1].toLowerCase()}>`;
  if (/(?:…|\.\s*\.\s*\.)[»”"'’)\]]*$/.test(t)) return 'ellipsis';
  if (/\p{L}-$/u.test(t)) return 'hyphen';
  if (/[.!?]["”’»)\]]*$/.test(t)) return 'full stop';
  if (/[,;:]$/.test(t)) return 'comma/colon';
  return 'bare word';
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set — run with --env-file=.env.production.local');
    process.exit(2);
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');

  const eligible = await db.collection('books')
    .find(
      { visible: true, pages_count: { $gt: RUN + 20 }, pages_translated: { $gt: RUN } },
      { projection: { _id: 0, id: 1, pages_count: 1 } },
    )
    .sort({ id: 1 })
    .toArray();
  const books: typeof eligible = [];
  for (let i = 0; i < BOOKS && eligible.length; i++) {
    books.push(eligible.splice(Math.floor(rand() * eligible.length), 1)[0]);
  }

  let pairs = 0;
  let agree = 0;
  let ontoOnly = 0; // N says it runs on, N+1 says it opens clean
  let fromOnly = 0; // N says it ends clean, N+1 says it opens mid-sentence
  const shapes = new Map<string, { pairs: number; ontoOnly: number; fromOnly: number }>();
  const rows: string[] = [];

  for (const book of books) {
    // Skip front matter: title pages and dedications are not running prose.
    const start = 10 + Math.floor(rand() * Math.max(1, book.pages_count - RUN - 15));
    const pages = await db.collection('pages')
      .find(
        { book_id: book.id, page_number: { $gte: start, $lt: start + RUN } },
        { projection: { page_number: 1, 'translation.data': 1, 'ocr.data': 1 } },
      )
      .sort({ page_number: 1 })
      .toArray();

    const judged = new Map<number, { text: string; c: ReturnType<typeof pageContinuity> }>();
    for (const p of pages) {
      const raw = p.translation?.data;
      if (typeof raw !== 'string' || !raw) continue;
      const text = stripEditorialWrappers(raw).trim();
      const original = typeof p.ocr?.data === 'string' ? stripEditorialWrappers(p.ocr.data).trim() : null;
      // The 200-char floor in pageContinuity returns all-false for plates and
      // blanks; a pair with one of those on it is not a prose boundary.
      if (text.length < 200) continue;
      judged.set(p.page_number, { text, c: pageContinuity(text, original) });
    }

    for (const [n, a] of judged) {
      const b = judged.get(n + 1);
      if (!b) continue;
      pairs++;
      const shape = tailShape(a.text);
      const s = shapes.get(shape) ?? { pairs: 0, ontoOnly: 0, fromOnly: 0 };
      s.pairs++;
      const onto = a.c.continues_on_next;
      const from = b.c.continues_from_previous;
      if (onto === from) agree++;
      else {
        if (onto) { ontoOnly++; s.ontoOnly++; } else { fromOnly++; s.fromOnly++; }
        rows.push(JSON.stringify({
          book_id: book.id, page: n, kind: onto ? 'onto_only' : 'from_only', shape,
          tail: a.text.slice(-140), next_head: b.text.slice(0, 140),
        }));
      }
      shapes.set(shape, s);
    }
  }
  await client.close();

  const pct = (x: number, of: number) => (of ? `${((100 * x) / of).toFixed(1)}%` : 'n/a');
  console.log(`continuity pair invariant — ${new Date().toISOString().slice(0, 10)}`);
  console.log(`books drawn: ${books.length} of ${books.length + eligible.length} eligible   adjacent prose pairs: ${pairs}`);
  console.log(`agree:                       ${agree}  (${pct(agree, pairs)})`);
  console.log(`N runs on, N+1 opens clean:  ${ontoOnly}  (${pct(ontoOnly, pairs)})`);
  console.log(`N ends clean, N+1 mid-sent.: ${fromOnly}  (${pct(fromOnly, pairs)})`);
  console.log('\nby what page N ends on (raw, before the edge test strips anything):');
  console.log('  shape              pairs  onto_only  from_only');
  for (const [shape, s] of [...shapes].sort((x, y) => y[1].pairs - x[1].pairs)) {
    console.log(`  ${shape.padEnd(18)} ${String(s.pairs).padStart(5)}  ${String(s.ontoOnly).padStart(9)}  ${String(s.fromOnly).padStart(9)}`);
  }
  if (OUT) {
    writeFileSync(OUT, rows.join('\n') + (rows.length ? '\n' : ''));
    console.log(`\n${rows.length} disagreeing pairs written to ${OUT}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
