/**
 * PRIOR ART: scripts/audit/source-image-urls.mjs — checks image URLs hardcoded in
 * application source, never page records. scripts/audit/archive-coverage.mjs counts
 * whether pages are archived (RECORD/FILE/MASTER), not whether the URL the reader is
 * handed will load. Neither runs the page resolver. #3510's investigation was a
 * scratch `$sample` that MIRRORED resolveSized's tier order and was not committed.
 *
 * refused-host-pages — does any live page resolve to an /api/image URL the proxy refuses?
 *
 * WHY THIS EXISTS (#3510)
 * ~9% of page-image references (and 17% of sampled visible pages) point at hosts
 * `/api/image` will not fetch: images.eap.bl.uk, mps.lib.harvard.edu, iiif.bdrc.io, …
 * Today that breaks nothing, because every one of those pages carries an R2
 * `display_photo`, and the reader takes that before it ever builds a proxy URL
 * (measured 2026-08-01: 0 of ~12,000 refused-host pages in visible books reached the
 * proxy). But the zero is empirical, not structural. Three paths still proxy:
 *
 *   - a crop-coords page always proxies its source, whatever variants it has;
 *   - a page with no matching R2 variant falls through to the proxy;
 *   - `hires` (magnifier / deep zoom) resizes the SOURCE, so a page whose only
 *     source is a refused host proxies there even when display_photo is on R2.
 *
 * Each reduces to "a book reached readers before the archiver re-hosted it", and each
 * fails silently: the proxy answers 403/400 and the reader sees an empty frame. The
 * fix for one is to archive the book, not to widen the allowlist — every allowlist
 * entry is outbound-fetch surface (#3508). This detector makes the zero checked.
 *
 * WHAT IT MEASURES
 * The real resolver — `getPageImageUrl` from src/lib/page-image-url.ts, imported, not
 * mirrored — at thumb, display and hires, for a sample of live books
 * (`visible: true, pages_count > 0`). Any result of the form `/api/image?url=<u>` where
 * `isAllowedImageHost(host(u))` is false is a finding. Sampling is by BOOK, then pages
 * spread through each book, because the failure is book-shaped (a whole book published
 * before archiving), and a page-level $sample of a 30M-row collection would see ten
 * pages of such a book at best.
 *
 * Not measured: CSP `img-src` misses (a direct IIIF URL the browser blocks). That is
 * the other allowlist — .claude/docs/invariants/image-host-allowlists.md.
 *
 * EXIT CONTRACT (.claude/docs/invariants/measurement-instruments.md)
 *   0  ran; no sampled page resolves to a refused proxy URL (prints sample size and
 *      the 95% upper bound on the book rate — a sample is never "clean")
 *   1  ran, found at least one
 *   2  could not run — no measurement was taken. Never read as clean.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/audit/refused-host-pages.ts [--books=400] [--pages=12] [--json]
 *   npx tsx scripts/audit/refused-host-pages.ts --book=<id>   # every page of one book,
 *                                                            # e.g. before unhiding it
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { getPageImageUrl, type ImageSize, type PageImageFields } from '../../src/lib/page-image-url';
import { isAllowedImageHost } from '../../src/lib/image-proxy-hosts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const BOOKS = parseInt(opt('books', '400'), 10);
const PAGES = parseInt(opt('pages', '12'), 10);
const ONE_BOOK = opt('book', '');
const JSON_OUT = argv.includes('--json');

const SIZES: ImageSize[] = ['thumb', 'display', 'hires'];
const PROJECTION = {
  _id: 0, book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1,
  enhanced_photo: 1, cropped_photo: 1, display_photo: 1, image_thumb: 1, thumbnail_blob: 1,
  thumbnail: 1, split_from_spread: 1, crop: 1,
};

/** The inner host of an /api/image URL the proxy will refuse, or null. */
function refusedProxyHost(resolved: string | null): string | null {
  if (!resolved || !resolved.startsWith('/api/image?')) return null;
  const inner = new URLSearchParams(resolved.slice('/api/image?'.length)).get('url');
  if (!inner) return '(no url)';
  try {
    const host = new URL(inner).hostname;
    return isAllowedImageHost(host) ? null : host;
  } catch {
    return '(unparseable)';
  }
}

interface Finding { book_id: string; title: string; page_number: number; size: ImageSize; host: string }

async function main(): Promise<number> {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URL;
  if (!uri) {
    console.error('Missing MONGODB_URI — no measurement taken.');
    return 2;
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'bookstore');
    const books = db.collection('books');
    const pages = db.collection('pages');

    // A book is looked up by `id` OR `_id` (book-deletion-and-identity.md); pages
    // reference it by the string `id`.
    const bookDocs = ONE_BOOK
      ? await books.find({ $or: [{ id: ONE_BOOK }, { _id: ONE_BOOK as never }] },
          { projection: { id: 1, title: 1, display_title: 1, pages_count: 1 } }).toArray()
      : await books.aggregate([
          { $match: { visible: true, pages_count: { $gt: 0 } } },
          { $sample: { size: BOOKS } },
          { $project: { id: 1, title: 1, display_title: 1, pages_count: 1 } },
        ]).toArray();
    if (!bookDocs.length) {
      console.error(ONE_BOOK ? `No book ${ONE_BOOK} — no measurement taken.` : 'No live books sampled — no measurement taken.');
      return 2;
    }

    const findings: Finding[] = [];
    const booksHit = new Set<string>();
    let pagesChecked = 0;
    for (const b of bookDocs) {
      const bookId = String(b.id ?? b._id);
      const title = String(b.display_title || b.title || '').slice(0, 60);
      const n = Number(b.pages_count) || 0;
      let filter: Record<string, unknown> = { book_id: bookId };
      if (!ONE_BOOK && n > PAGES) {
        // Pages spread through the book, not its first leaves.
        const step = n / PAGES;
        filter = { book_id: bookId, page_number: { $in: Array.from({ length: PAGES }, (_, i) => Math.floor(i * step) + 1) } };
      }
      for await (const p of pages.find(filter, { projection: PROJECTION }).batchSize(1000)) {
        pagesChecked += 1;
        for (const size of SIZES) {
          const host = refusedProxyHost(getPageImageUrl(p as PageImageFields, size));
          if (!host) continue;
          findings.push({ book_id: bookId, title, page_number: p.page_number as number, size, host });
          booksHit.add(bookId);
        }
      }
    }

    // Rule of three: with 0 hits in n books, the 95% upper bound on the rate is ~3/n.
    const upper = booksHit.size === 0 ? `<= ${(300 / bookDocs.length).toFixed(2)}% of live books (95%, rule of three)` : null;
    if (JSON_OUT) {
      console.log(JSON.stringify({ books: bookDocs.length, pages: pagesChecked, books_hit: booksHit.size, upper_bound: upper, findings }, null, 2));
    } else {
      console.log(`refused-host-pages: ${bookDocs.length} book(s), ${pagesChecked} page(s), sizes ${SIZES.join('/')}`);
      if (!findings.length) {
        console.log(`  0 pages resolve to an /api/image URL the proxy refuses${upper && !ONE_BOOK ? ` — book rate ${upper}` : ''}`);
      } else {
        const byHost = new Map<string, number>();
        for (const f of findings) byHost.set(`${f.host} [${f.size}]`, (byHost.get(`${f.host} [${f.size}]`) ?? 0) + 1);
        console.log(`  ${findings.length} refused proxy URL(s) in ${booksHit.size} book(s):`);
        for (const [k, v] of [...byHost].sort((a, z) => z[1] - a[1])) console.log(`    ${String(v).padStart(5)}  ${k}`);
        for (const f of findings.slice(0, 20)) console.log(`    ${f.book_id} p${f.page_number} ${f.size} ${f.host}  ${f.title}`);
        console.log('  Fix: archive the book to R2 (display_photo / archived_photo), not the allowlist (#3510, #3508).');
      }
    }
    return findings.length ? 1 : 0;
  } catch (err) {
    console.error(`Could not run — no measurement taken: ${(err as Error).message}`);
    return 2;
  } finally {
    await client.close().catch(() => {});
  }
}

main().then((code) => process.exit(code));
