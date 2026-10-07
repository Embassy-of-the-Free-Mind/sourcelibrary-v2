/**
 * One page of one book, assembled from disk — the local reader's whole data path.
 *
 * PRIOR ART: src/app/book/[id]/page/[pageId]/reader-v2-data.ts and the inline
 * loader in `(reader)/page.tsx` — why they do not fit: both open with
 * `await getReadDb()` and three Atlas round trips. `getReadDb()` does have a
 * no-database escape hatch (`buildStubDb`, src/lib/mongodb.ts:111), but it
 * answers every query with an empty result, so dropping local mode in behind it
 * would render an empty reader rather than the corpus on the disk. This loader
 * returns the same three objects (book, page, page list) from the mirrors.
 *
 * The join, and why the URL carries a page NUMBER:
 *   ~/sl-corpus/books/<id>.jsonl  is keyed by page_number  (always present)
 *   ~/sl-scans/<id>/manifest.json is keyed by Mongo pages.id (only when mirrored)
 * With no scan mirrored — the normal case today — there is no Mongo page id on
 * this machine at all, so page_number is the only key that always exists. A Mongo
 * page id still works in the URL when a manifest is there to resolve it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { corpusDir, scansDir, isSafeRef } from './config';
import { findLocalBook, type LocalBook } from './catalog';

/** A page as the mirror stores it. `ocr`/`tr` are the raw tagged strings. */
export interface LocalPageText {
  page_number: number;
  ocr: string | null;
  tr: string | null;
  lang: string | null;
  type: string | null;
}

/** What the scan mirror knows about one page, when it has been mirrored. */
export interface LocalScan {
  /** Mongo `pages.id`, only ever known from a manifest. */
  id?: string;
  /** Same-origin URL served by /local-scans. null when the JPEG is not on disk. */
  url: string | null;
  width?: number;
  height?: number;
  page_type?: string;
}

export interface LocalReaderPage {
  book: LocalBook;
  /** Page numbers present in the text mirror, ascending. */
  pageNumbers: number[];
  page: LocalPageText;
  prev: number | null;
  next: number | null;
  scan: LocalScan | null;
  /** Chapters, only when a scan manifest carried them. */
  chapters: Array<{ title: string; page_number: number }>;
  /** Index of this page within pageNumbers, 0-based. */
  position: number;
}

interface Manifest {
  book?: Partial<LocalBook> & { chapters?: unknown };
  pages?: Array<{
    id?: string;
    page_number?: number;
    page_type?: string;
    image_width?: number;
    image_height?: number;
    file?: string;
  }>;
  width?: number;
  quality?: number;
}

function readManifest(bookId: string): Manifest | null {
  const file = path.join(scansDir(), bookId, 'manifest.json');
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;
  } catch {
    // A half-written manifest from an interrupted mirror run must not take the
    // reader down: text-only is the graceful answer, and the footer says so.
    return null;
  }
}

/** Every page of a book's text mirror, ascending. Empty when the book has none. */
function readPageText(bookId: string): LocalPageText[] {
  const file = path.join(corpusDir(), 'books', `${bookId}.jsonl`);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const pages: LocalPageText[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line) as { p?: string | number; ocr?: string; tr?: string; lang?: string; type?: string };
      // `p` is a string in the mirror's own output and a number in older dumps.
      const n = typeof d.p === 'number' ? d.p : Number.parseInt(String(d.p ?? ''), 10);
      if (!Number.isFinite(n)) continue;
      pages.push({
        page_number: n,
        ocr: d.ocr ?? null,
        tr: d.tr ?? null,
        lang: d.lang ?? null,
        type: d.type ?? null,
      });
    } catch {
      // One malformed line loses one page, not the book.
    }
  }
  pages.sort((a, b) => a.page_number - b.page_number);
  return pages;
}

function normalizeChapters(input: unknown): Array<{ title: string; page_number: number }> {
  if (!Array.isArray(input)) return [];
  const out: Array<{ title: string; page_number: number }> = [];
  for (const c of input) {
    if (!c || typeof c !== 'object') continue;
    const rec = c as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    const n = Number(rec.page_number ?? rec.page ?? rec.start_page);
    if (title && Number.isFinite(n)) out.push({ title, page_number: n });
  }
  return out.sort((a, b) => a.page_number - b.page_number);
}

/**
 * Resolve the `page` URL segment. A number is a page number; anything else is
 * treated as a Mongo page id and resolved through the manifest, which is the only
 * place those ids exist offline.
 */
function resolvePageNumber(ref: string, manifest: Manifest | null): number | null {
  if (/^\d+$/.test(ref)) return Number.parseInt(ref, 10);
  const hit = manifest?.pages?.find((p) => p.id === ref);
  return typeof hit?.page_number === 'number' ? hit.page_number : null;
}

/**
 * Load one page, or null when the book or page is not on this disk.
 *
 * Deliberately no hidden-book gate. `isHiddenBook` keeps unpublished books off
 * sourcelibrary.org; on Derek's laptop this is his own data on his own disk with
 * no server in front of it, and hiding half the mirror from the only reader would
 * be a gate protecting nobody. The route itself is the gate: it 404s unless
 * SL_LOCAL=1.
 */
export function loadLocalReaderPage(bookRef: string, pageRef: string): LocalReaderPage | null {
  if (!isSafeRef(bookRef) || !isSafeRef(pageRef)) return null;

  const book = findLocalBook(bookRef);
  if (!book) return null;

  const manifest = readManifest(book.id);
  const pages = readPageText(book.id);
  if (!pages.length) return null;

  const wanted = resolvePageNumber(pageRef, manifest);
  if (wanted === null) return null;

  const position = pages.findIndex((p) => p.page_number === wanted);
  if (position === -1) return null;

  const page = pages[position];
  const pageNumbers = pages.map((p) => p.page_number);

  let scan: LocalScan | null = null;
  const mp = manifest?.pages?.find((p) => p.page_number === page.page_number);
  if (mp?.file) {
    // A manifest entry is a promise the mirror made; the JPEG is the fact. A book
    // can be half-mirrored, so absence here is per-page, not per-book.
    const onDisk = fs.existsSync(path.join(scansDir(), book.id, mp.file));
    scan = {
      id: mp.id,
      url: onDisk ? `/local-scans/${encodeURIComponent(book.id)}/${encodeURIComponent(mp.file)}` : null,
      width: mp.image_width,
      height: mp.image_height,
      page_type: mp.page_type,
    };
  }

  return {
    // A manifest, when present, carries a fuller book record than the catalogue
    // (chapters, original_language, contributing_library). Catalogue fields win
    // on conflict — it is the newer of the two mirrors.
    book: { ...(manifest?.book as Partial<LocalBook> | undefined), ...book },
    pageNumbers,
    page,
    prev: position > 0 ? pages[position - 1].page_number : null,
    next: position < pages.length - 1 ? pages[position + 1].page_number : null,
    scan: scan && scan.url ? scan : null,
    chapters: normalizeChapters(manifest?.book?.chapters),
    position,
  };
}

/** The first page of a book that has any text, for `/local/<book>` with no page. */
export function firstLocalPage(bookRef: string): number | null {
  if (!isSafeRef(bookRef)) return null;
  const book = findLocalBook(bookRef);
  if (!book) return null;
  const pages = readPageText(book.id);
  // Prefer the first page that actually has a transcription: books commonly open
  // on a dozen blank endpapers, and landing the reader on those looks broken.
  const withText = pages.find((p) => (p.ocr && p.ocr.trim()) && p.type !== 'blank');
  return (withText ?? pages[0])?.page_number ?? null;
}
