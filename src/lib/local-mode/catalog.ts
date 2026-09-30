/**
 * The offline catalogue: one book record, looked up by id or slug.
 *
 * PRIOR ART: src/lib/book-lookup.ts (findBookByIdOrSlug) — why it does not fit:
 * it takes a live Mongo `Db` and runs an indexed `findOne`. Same contract here
 * (id OR slug, one record, projection-shaped), against `~/sl-corpus/catalog.jsonl`
 * instead. The `id` OR `_id` lesson does not apply: the mirror writes `books.id`
 * only, so there is one key.
 *
 * `catalog.jsonl` is 92 MB and 113,512 lines, which is too much to parse per
 * request and small enough to index in one pass: 286 ms measured, ~360 MB peak
 * while scanning, a few MB retained (two Maps of id/slug → byte offset). The
 * index is built once per process, lazily, and one `read()` at the recorded
 * offset answers every later lookup. Records are NOT uniform — `original_language`,
 * `contributing_library` and `chapters` are absent from most of them — so every
 * field here is optional and the reader must degrade rather than assume.
 */
import fs from 'node:fs';
import path from 'node:path';
import { corpusDir } from './config';

export interface LocalBook {
  id: string;
  slug?: string;
  title?: string;
  display_title?: string;
  english_title?: string;
  author?: string;
  author_id?: string;
  language?: string;
  original_language?: string;
  published?: string;
  year?: number;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  summary?: string;
  work_id?: string;
  text_role?: string;
  visible?: boolean;
  contributing_library?: string;
  collections?: string[];
  /** Only ever present when a scan manifest supplied it. */
  chapters?: Array<{ title?: string; page_number?: number; page?: number }>;
}

type Entry = { off: number; len: number };

let index: { byId: Map<string, Entry>; bySlug: Map<string, Entry>; file: string } | null = null;

/**
 * Pull id and slug out of a line without parsing it. `JSON.parse` on 113k lines
 * costs ~30x this and we only ever need one of them.
 */
const RE_ID = /"id":"([^"]+)"/;
const RE_SLUG = /"slug":"([^"]+)"/;

function buildIndex(file: string) {
  const byId = new Map<string, Entry>();
  const bySlug = new Map<string, Entry>();
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.statSync(file).size;
    const buf = Buffer.allocUnsafe(1 << 22);
    let pos = 0;
    let carry = Buffer.alloc(0);
    while (pos < size) {
      const read = fs.readSync(fd, buf, 0, buf.length, pos);
      if (read <= 0) break;
      const chunk = carry.length
        ? Buffer.concat([carry, buf.subarray(0, read)])
        : Buffer.from(buf.subarray(0, read));
      const base = pos - carry.length;
      let nl: number;
      let lineStart = 0;
      while ((nl = chunk.indexOf(0x0a, lineStart)) !== -1) {
        const line = chunk.toString('utf8', lineStart, nl);
        const entry: Entry = { off: base + lineStart, len: nl - lineStart };
        const id = RE_ID.exec(line);
        if (id) byId.set(id[1], entry);
        const slug = RE_SLUG.exec(line);
        if (slug) bySlug.set(slug[1], entry);
        lineStart = nl + 1;
      }
      carry = Buffer.from(chunk.subarray(lineStart));
      pos += read;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { byId, bySlug, file };
}

function getIndex() {
  const file = path.join(corpusDir(), 'catalog.jsonl');
  if (index && index.file === file) return index;
  if (!fs.existsSync(file)) return null;
  index = buildIndex(file);
  return index;
}

function readAt(file: string, entry: Entry): LocalBook | null {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(entry.len);
    fs.readSync(fd, buf, 0, entry.len, entry.off);
    return JSON.parse(buf.toString('utf8')) as LocalBook;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** One book by `books.id` or by slug. null when the catalogue has neither. */
export function findLocalBook(ref: string): LocalBook | null {
  const idx = getIndex();
  if (!idx) return null;
  const entry = idx.byId.get(ref) ?? idx.bySlug.get(ref);
  if (!entry) return null;
  const book = readAt(idx.file, entry);
  if (!book) return null;
  // The catalogue is the mirror's copy of `books`; `id` is the only identity the
  // rest of local mode joins on, so refuse a record that somehow lacks one.
  return book.id ? book : null;
}

/** How many books the catalogue holds — for the local-mode status line. */
export function localCatalogSize(): number {
  return getIndex()?.byId.size ?? 0;
}
