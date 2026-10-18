/**
 * Librarian speed A/B (#6904) — blind judge packets.
 *
 * PRIOR ART: scripts/eval/agentic-qa-6182/build-judge-packet.py blinds two
 * arms as X/Y for an Opus judge; its packets carry OCR pages, not a
 * Librarian answer and the pages it read. Same blinding, seeded per pair and
 * per judge, with the key kept out of the packet.
 *
 * One packet per (pair, judge): the question, answers X and Y (the text the
 * reader ends up seeing), and the page text of every page either arm
 * retrieved, cited pages first.
 *
 * Usage:
 *   npx tsx --env-file=/root/sourcelibrary/.env.production.local \
 *     scripts/eval/librarian-speed-6904/build-packets.ts --in=<main.jsonl> --dir=<judge dir>
 * Writes <dir>/packets/<pair>-<judge>.md and <dir>/key.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@/lib/mongodb';

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const inFile = arg('in')!;
const dir = arg('dir')!;
const judges = (arg('judges') ?? 'J1,J2,J3').split(',');
const MAX_PAGES = 40;
// Whole pages. A first pass cut pages at 2,500 characters and the judges then
// flagged real quotations as invented because they sat further down the page
// (q11 p.241 at char 3,160; q18 p.342 at 3,136) — that pass was discarded.
const PAGE_CHARS = 20000;

type Row = {
  id: string; q: string; arm: string; final: string; error?: string;
  sources: Array<{ book_id: string; bookSlug?: string; bookTitle: string; pageNumber?: number }>;
};

// Deterministic per-key coin (FNV-1a), so a rebuilt packet keeps its order.
function coin(key: string): boolean {
  let h = 0x811c9dc5;
  for (const c of key) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) & 1) === 1;
}

function citedPages(text: string): Array<{ slug: string; page: number }> {
  const out: Array<{ slug: string; page: number }> = [];
  // Both page-link shapes the Librarian writes: ?page=N and /page-number/N.
  for (const m of text.matchAll(/\/book\/([a-z0-9-]+)(?:\?page=|\/page-number\/)(\d+)/g)) out.push({ slug: m[1], page: Number(m[2]) });
  return out;
}

async function main() {
  const rows: Row[] = fs.readFileSync(inFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const by = new Map<string, Record<string, Row>>();
  for (const r of rows) {
    if (r.error) continue;
    by.set(r.id, { ...(by.get(r.id) ?? {}), [r.arm]: r });
  }
  const pairs: Array<{ pair: string; id: string; left: Row; right: Row }> = [];
  for (const [id, arms] of by) {
    if (arms.A && arms.B) pairs.push({ pair: `${id}-AB`, id, left: arms.A, right: arms.B });
    if (arms.A && arms.A2) pairs.push({ pair: `${id}-AA`, id, left: arms.A, right: arms.A2 });
  }

  const db = await getDb();
  fs.mkdirSync(path.join(dir, 'packets'), { recursive: true });
  const key: Record<string, Record<string, { X: string; Y: string }>> = {};

  for (const p of pairs) {
    // slug → book_id from what both arms retrieved.
    const slugToBook = new Map<string, string>();
    const keys: Array<{ book_id: string; page: number; cited: boolean }> = [];
    const seen = new Set<string>();
    for (const r of [p.left, p.right]) for (const s of r.sources) if (s.bookSlug) slugToBook.set(s.bookSlug, s.book_id);
    // A page read with get_book_page / read_nearby_pages has no source card:
    // resolve any cited slug the cards did not carry.
    const unknown = [...new Set([p.left, p.right].flatMap(r => citedPages(r.final).map(c => c.slug)).filter(sl => !slugToBook.has(sl)))];
    if (unknown.length) {
      for (const b of await db.collection('books').find({ slug: { $in: unknown } }).project({ id: 1, slug: 1 }).toArray()) {
        slugToBook.set(b.slug as string, b.id as string);
      }
    }
    const add = (book_id: string, page: number, cited: boolean) => {
      const k = `${book_id}:${page}`;
      if (seen.has(k)) return;
      seen.add(k);
      keys.push({ book_id, page, cited });
    };
    for (const r of [p.left, p.right]) for (const c of citedPages(r.final)) {
      const b = slugToBook.get(c.slug);
      if (b) add(b, c.page, true);
    }
    for (const r of [p.left, p.right]) for (const s of r.sources) if (s.pageNumber) add(s.book_id, s.pageNumber, false);
    const take = keys.slice(0, MAX_PAGES);
    const docs = take.length
      ? await db.collection('pages')
          .find({ $or: take.map(k => ({ book_id: k.book_id, page_number: k.page })) })
          .project({ book_id: 1, page_number: 1, 'translation.data': 1 })
          .toArray()
      : [];
    const books = await db.collection('books')
      .find({ id: { $in: [...new Set(take.map(k => k.book_id))] } })
      .project({ id: 1, title: 1, display_title: 1, slug: 1, author: 1 })
      .toArray();
    const bookOf = new Map(books.map(b => [b.id as string, b]));
    const pageBlocks = take.map(k => {
      const d = docs.find(x => x.book_id === k.book_id && x.page_number === k.page);
      const b = bookOf.get(k.book_id);
      const text = String(d?.translation?.data ?? '(no English text on this page)').slice(0, PAGE_CHARS);
      return `### ${b?.display_title || b?.title || k.book_id} — ${b?.author ?? ''} — /book/${b?.slug ?? '?'}?page=${k.page}${k.cited ? ' (cited)' : ''}\n\n${text}`;
    });

    key[p.pair] = {};
    for (const j of judges) {
      const swap = coin(`${p.pair}:${j}`);
      const X = swap ? p.right : p.left;
      const Y = swap ? p.left : p.right;
      key[p.pair][j] = { X: X.arm, Y: Y.arm };
      const md = `# Pair ${p.pair}-${j}\n\n## Question\n\n${p.left.q}\n\n## Answer X\n\n${X.final}\n\n## Answer Y\n\n${Y.final}\n\n## Pages the answers' tools retrieved (English translation, whole pages; cited pages first; up to ${MAX_PAGES} pages)\n\n${pageBlocks.join('\n\n---\n\n') || '(none)'}\n`;
      fs.writeFileSync(path.join(dir, 'packets', `${p.pair}-${j}.md`), md);
    }
  }
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(key, null, 2));
  console.log(`${pairs.length} pairs × ${judges.length} judges → ${dir}/packets`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
