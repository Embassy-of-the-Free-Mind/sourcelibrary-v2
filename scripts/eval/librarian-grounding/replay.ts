/**
 * Librarian grounding eval (#5904) — replay. Re-runs the CURRENT grounding pass
 * (src/lib/embassy/grounding.ts) over the raw answers a recorded run produced,
 * with no model call: the way to test a change to the pass against real answers
 * for free, after the generation budget is spent.
 *
 * PRIOR ART: run.ts generates (costs money, re-rolls the answers); score.ts
 * scores the text a reader saw. Neither re-applies a changed pass to FIXED text.
 *
 * The support set is RECONSTRUCTED — the pages the answer cites ±1, the source
 * cards, the pages under the images — because a run does not record what the
 * tools returned. It lacks the tool-result text and pages read with
 * read_nearby_pages, so the replay is STRICTER than the live pass: anything it
 * keeps, the live pass keeps too. Captions are not replayed (no image records).
 *
 * Usage:
 *   npx tsx --env-file=/root/sourcelibrary/.env.production.local \
 *     scripts/eval/librarian-grounding/replay.ts --label=after [--only=id]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { groundAnswer, type GroundingPage } from '@/lib/embassy/grounding';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const label = arg('label');
if (!label) throw new Error('--label=<name> is required');
const only = arg('only');

async function main() {
  const rows = fs.readFileSync(path.join(HERE, 'results', `${label}.jsonl`), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db('bookstore');
  const totals = { blockquotesRemoved: 0, quotesUnquoted: 0, sentencesDropped: 0, attached: 0 };
  for (const row of rows) {
    if (row.error || (only && row.id !== only)) continue;
    const raw: string = row.raw;
    const keys = new Map<string, [string, number]>();
    const add = (b: string, p: number) => { if (p >= 1) keys.set(`${b}:${p}`, [b, p]); };
    for (const m of raw.matchAll(/sourcelibrary\.org(?:\/es)?\/book\/([a-z0-9-]+)(?:\/page-number\/|\?page=)(\d+)/g)) {
      const b = await db.collection('books').findOne({ $or: [{ slug: m[1] }, { slug_aliases: m[1] }, { id: m[1] }] }, { projection: { id: 1 } });
      if (b) for (const d of [-1, 0, 1]) add(b.id, Number(m[2]) + d);
    }
    for (const s of row.sources ?? []) if (s.pageNumber) add(s.book_id, s.pageNumber);
    for (const m of raw.matchAll(/\/archived\/([a-f0-9]{24})\/(\d+)\./g)) add(m[1], Number(m[2]));
    const byBook = new Map<string, number[]>();
    for (const [b, p] of keys.values()) byBook.set(b, [...(byBook.get(b) ?? []), p]);
    const pages: GroundingPage[] = [];
    for (const [bookId, ps] of byBook) {
      const book = await db.collection('books').findOne({ id: bookId }, { projection: { slug: 1, title: 1, display_title: 1 } });
      const docs = await db.collection('pages').find({ book_id: bookId, page_number: { $in: ps } }, { projection: { page_number: 1, 'translation.data': 1, 'ocr.data': 1 } }).toArray();
      for (const d of docs) {
        const parts = [d.translation?.data, d.ocr?.data].map(t => (typeof t === 'string' ? t : ''));
        pages.push({ bookId, bookSlug: book?.slug || bookId, bookTitle: book?.display_title || book?.title || '', page: d.page_number, text: parts.join('\n'), parts });
      }
    }
    const { report } = groundAnswer({ text: raw, pages, supportLoaded: true, images: [], question: row.q, siteBase: 'https://sourcelibrary.org' });
    totals.blockquotesRemoved += report.blockquotesRemoved;
    totals.quotesUnquoted += report.quotesUnquoted;
    totals.sentencesDropped += report.sentencesDropped;
    totals.attached += report.attached;
    const live = row.groundingReport ?? {};
    console.log(`${row.id.padEnd(20)} blockquotes removed live ${live.blockquotesRemoved ?? 0} → replay ${report.blockquotesRemoved} · unquoted live ${live.quotesUnquoted ?? 0} → replay ${report.quotesUnquoted}`);
    for (const d of report.details) if (!d.startsWith('caption')) console.log(`    ${d.slice(0, 150)}`);
  }
  console.log('REPLAY TOTALS', JSON.stringify(totals));
  await client.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
