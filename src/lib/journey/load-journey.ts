/**
 * Server loader for the journey film (#5861): one page's record, read the way
 * the existing routes read it, turned into `JourneyData`.
 *
 * Reuses, rather than re-implements, what the quote route and the reader do:
 * `findBookByIdOrSlug` (slug/id/_id/alias), `getPageImageUrl`,
 * `generateCitations` (the quote route's citation apparatus),
 * `transcriptProvenance` + `isUnreviewedMachineTranslation` (the reader's own
 * "how was this read / has a person reviewed this English" rules) and the stored Trace
 * alignment. It never generates an alignment: Trace is shown only when the
 * page already has a current one, which costs nothing to read.
 *
 * Reads Mongo directly instead of fetching our own API routes from a server
 * component: same helpers, no self-HTTP hop, and none of the reader routes'
 * provenance marks in the text (quote-and-snippet-integrity.md, #3850).
 *
 * PRIOR ART: src/app/api/books/[id]/quote/route.ts — the closest loader; it
 * serves one flat quote and gates by request (bot budget), which a page
 * render does not need. Its projections are the model for the ones here.
 */
import type { Db, Document } from 'mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { isHiddenBook } from '@/lib/book-access';
import { generateCitations } from '@/lib/citation';
import { getPageImageUrl, type PageImageFields } from '@/lib/page-image-url';
import { readerPageUrl } from '@/lib/slugify';
import { transcriptProvenance, isUnreviewedMachineTranslation, modelDisplayName, translationCorpus } from '@/lib/text-provenance';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { hashAlignmentText, WORD_ALIGNMENT_VERSION, type WordAlignmentData } from '@/lib/word-alignment';
import { getBookThumbnailUrl } from '@/lib/utils';
import { IMPRINT_PLACE_PROJECTION } from '@/lib/imprint';
import { semanticPageSearchGlobal } from '@/lib/semantic-search';
import type { Book, Page, TranslationEdition } from '@/lib/types';
import {
  cleanPageLines, paneText, pickFilmLines,
  firstMarginNote, containsLoose, clip, pickOutroSentence,
} from './journey-text';
import type { JourneyConnect, JourneyData, JourneyImage, JourneyInstanceConfig, JourneyRevisions } from './types';

const SITE = 'https://sourcelibrary.org';
/** Only our own R2 host sends the CORS header WebGL textures need. */
const R2 = /^https:\/\/images\.sourcelibrary\.org\//;

const BOOK_PROJECTION = {
  _id: 1, id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1,
  language: 1, original_language: 1, visible: 1, hidden: 1, pages_count: 1, pages_archived: 1, work_id: 1,
  categories: 1, 'image_source.provider_name': 1, 'image_source.source_url': 1, thumbnail: 1, thumbnail_blob: 1, image_thumb: 1, image_display: 1,
  // generateCitations (see QUOTE_BOOK_PROJECTION in the quote route)
  text_role: 1, is_translation: 1, doi: 1, format: 1, publisher: 1, ustc_id: 1,
  content_type: 1, resource_type: 1, field_provenance: 1,
  ...IMPRINT_PLACE_PROJECTION,
  contributing_library: 1, shelfmark: 1,
  'image_source.contributing_library': 1, 'image_source.shelfmark': 1,
  'editions.id': 1, 'editions.status': 1, 'editions.doi': 1, 'editions.version': 1, 'editions.published_at': 1,
} as const;

const IMAGE_FIELDS = {
  photo: 1, photo_original: 1, archived_photo: 1, display_photo: 1, cropped_photo: 1, enhanced_photo: 1,
  thumbnail: 1, thumbnail_blob: 1, image_thumb: 1, crop: 1, split_from_spread: 1,
  image_width: 1, image_height: 1,
} as const;

const PAGE_PROJECTION = {
  _id: 0, id: 1, page_number: 1, printed_page: 1,
  ocr: 1, translation: 1, word_alignment: 1,
  ...IMAGE_FIELDS,
} as const;

const SHELF_SIZE = 48;
const VAULT_SIZE = 19;
const INDEX_MAX = 12;
const EDITIONS_MAX = 6;
/** The film shows the top of the results list; a page further down is not "found". */
const SEARCH_SHOWN = 6;

function r2Image(p: PageImageFields & { image_width?: number; image_height?: number }, size: 'thumb' | 'display'): JourneyImage | null {
  const url = getPageImageUrl(p, size);
  if (!url || !R2.test(url)) return null;
  const ar = p.image_width && p.image_height ? p.image_width / p.image_height : undefined;
  return { url, ar };
}

function humanize(slug: string): string {
  const s = slug.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function scriptOf(text: string): JourneyData['script'] {
  if (/[ऀ-ॿ]/.test(text)) return 'devanagari';
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (!letters) return 'latin';
  const latin = letters.replace(/[^\p{Script=Latin}]/gu, '').length;
  return latin / letters.length > 0.8 ? 'latin' : 'other';
}

/** The stored Trace pairs, only when they still match the page's current text. */
function currentAlignment(page: Page & { word_alignment?: WordAlignmentData }): WordAlignmentData | null {
  const wa = page.word_alignment;
  if (!wa || wa.version !== WORD_ALIGNMENT_VERSION || !wa.pairs?.length) return null;
  const src = stripEditorialWrappers(page.ocr?.data || '').slice(0, 20000);
  const tr = stripEditorialWrappers(page.translation?.data || '').slice(0, 20000);
  if (hashAlignmentText(src) !== wa.ocr_hash || hashAlignmentText(tr) !== wa.translation_hash) return null;
  return wa;
}

function readByLabel(page: Page): { readBy: string; readByModel: boolean } {
  const prov = transcriptProvenance(page);
  switch (prov?.kind) {
    case 'model': {
      const name = modelDisplayName(prov.model);
      return { readBy: /^gemini/i.test(prov.model) ? 'Gemini' : name, readByModel: true };
    }
    case 'ia': return { readBy: 'the Internet Archive’s own OCR of the scan', readByModel: false };
    case 'manual': return { readBy: 'a transcription made by hand', readByModel: false };
    case 'corpus': return { readBy: prov.corpus.name, readByModel: false };
    case 'text_source': return { readBy: prov.source.name, readByModel: false };
    default: return { readBy: 'the scan', readByModel: false };
  }
}

/**
 * Covers of other visible books sharing this book's subjects, from the first
 * subject on, until the shelf is full. Only covers on our own R2 host.
 */
async function loadShelf(db: Db, bookId: string, categories: string[]): Promise<{ images: JourneyImage[]; label?: string }> {
  const seen = new Set<string>();
  const images: JourneyImage[] = [];
  const used: string[] = [];
  for (const cat of categories.slice(0, 3)) {
    const docs = await db.collection('books').find(
      { categories: cat, visible: true, pages_count: { $gt: 0 }, id: { $ne: bookId } },
      { projection: { _id: 0, id: 1, thumbnail: 1, thumbnail_blob: 1, image_thumb: 1, image_display: 1 } },
    ).limit(SHELF_SIZE * 3).toArray();
    let added = 0;
    for (const b of docs) {
      if (seen.has(b.id)) continue;
      const url = getBookThumbnailUrl(b as Parameters<typeof getBookThumbnailUrl>[0], 'thumb');
      if (!url || !R2.test(url)) continue;
      seen.add(b.id);
      images.push({ url });
      added++;
      if (images.length >= SHELF_SIZE) break;
    }
    if (added) used.push(humanize(cat).toLowerCase());
    if (images.length >= SHELF_SIZE / 2) break;
  }
  if (images.length < 12) return { images: [] };
  return { images, label: `Other books in the library on ${used.join(' and ')}` };
}

/** The public search's rule (/api/search/semantic): neither `visible: false` nor `hidden: true`. */
const openToReaders = (b: Document) => !isHiddenBook(b as never) && b.hidden !== true;

const TYPE_ORDER: Record<string, number> = { person: 0, place: 1, concept: 2 };

/**
 * Names the book's index ties to this page. Only page-precise entries: an
 * entry with a page range was never verified against this page's text
 * (entity-page-attribution.md), so it is not a claim about this page.
 */
async function loadIndexNames(db: Db, bookId: string, pageNumber: number): Promise<JourneyConnect['index']> {
  const docs = await db.collection('entities').find(
    { books: { $elemMatch: { book_id: bookId, page_precision: 'page', pages: pageNumber } } },
    { projection: { _id: 0, name: 1, type: 1 } },
  ).limit(60).toArray();
  const seen = new Set<string>();
  return docs
    .filter(e => typeof e.name === 'string' && e.name.trim())
    .sort((a, b) => (TYPE_ORDER[a.type] ?? 3) - (TYPE_ORDER[b.type] ?? 3))
    .filter(e => {
      const k = e.name.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, INDEX_MAX)
    .map(e => ({ name: e.name.trim(), type: String(e.type || 'concept'), href: `/encyclopedia/${encodeURIComponent(e.name.trim())}` }));
}

/** Other editions of the same work that a reader can open (visible, with pages). */
async function loadEditions(db: Db, bookId: string, workId: string | undefined): Promise<JourneyConnect['editions']> {
  if (!workId) return [];
  const docs = await db.collection('books').find(
    { work_id: workId, id: { $ne: bookId }, visible: true, pages_count: { $gt: 0 } },
    { projection: { _id: 0, id: 1, slug: 1, title: 1, display_title: 1, language: 1, published: 1, visible: 1, hidden: 1 } },
  ).limit(EDITIONS_MAX * 2).toArray();
  return docs
    .filter(openToReaders)
    .sort((a, b) => String(a.published ?? '').localeCompare(String(b.published ?? '')))
    .slice(0, EDITIONS_MAX)
    .map(b => ({
      title: (b.display_title || b.title) as string,
      language: b.language as string | undefined,
      published: b.published != null ? String(b.published) : undefined,
      href: `/book/${b.slug || b.id}`,
    }));
}

/**
 * Runs the curated search by meaning and keeps it only if this page is near
 * the top. A failed search throws (the page's last good render keeps serving,
 * rendering-and-seo.md); a search that simply no longer finds the page drops
 * the claim.
 */
async function loadSearch(
  db: Db,
  query: string,
  here: { bookId: string; pageId: string; workId?: string },
): Promise<JourneyConnect['search']> {
  const rows = await semanticPageSearchGlobal(query, 20);
  if (!rows.length) throw new Error(`journey: the search "${query}" returned nothing`);
  const books = await db.collection('books').find(
    { id: { $in: [...new Set(rows.map(r => r.book_id))] } },
    { projection: { _id: 0, id: 1, slug: 1, title: 1, display_title: 1, visible: 1, hidden: 1, work_id: 1 } },
  ).toArray();
  const byId = new Map(books.filter(openToReaders).map(b => [b.id as string, b]));
  const results = rows
    .filter(r => byId.has(r.book_id))
    .map(r => {
      const b = byId.get(r.book_id)!;
      return {
        title: (b.display_title || b.title) as string,
        page: r.page_number,
        href: `/book/${b.slug || b.id}/page/${r.page_id}`,
        here: r.page_id === here.pageId,
        sameWork: !!here.workId && b.work_id === here.workId && b.id !== here.bookId,
      };
    });
  const at = results.findIndex(r => r.here);
  if (at < 0 || at >= SEARCH_SHOWN) return undefined;
  return { query, rank: at + 1, results: results.slice(0, SEARCH_SHOWN) };
}

async function loadRevisions(db: Db, pageId: string): Promise<JourneyRevisions> {
  const [count, latest] = await Promise.all([
    db.collection('page_revisions').countDocuments({ page_id: pageId }),
    db.collection('page_revisions').findOne(
      { page_id: pageId },
      { sort: { created_at: -1 }, projection: { _id: 0, field: 1, created_at: 1 } },
    ),
  ]);
  const at = latest?.created_at instanceof Date ? latest.created_at.toISOString() : undefined;
  return { count, latest: latest ? { field: String(latest.field || 'translation'), at } : undefined };
}

/**
 * Returns null when the book or page does not exist, is hidden, or the page
 * has no English translation (the film is about a translated page).
 */
export async function loadJourney(
  db: Db,
  idOrSlug: string,
  pageNumber: number,
  config: JourneyInstanceConfig = {},
): Promise<JourneyData | null> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;
  const found = await findBookByIdOrSlug(db, idOrSlug, BOOK_PROJECTION);
  if (!found || isHiddenBook(found.book)) return null;
  const book = found.book as unknown as Book & Document;
  if (!book.pages_count) return null;

  const page = await db.collection('pages').findOne(
    { book_id: book.id, page_number: pageNumber },
    { projection: PAGE_PROJECTION },
  ) as unknown as (Page & { word_alignment?: WordAlignmentData; image_width?: number; image_height?: number }) | null;
  if (!page?.ocr?.data || !page.translation?.data) return null;

  const ocrCleaned = cleanPageLines(page.ocr.data);
  const enCleaned = cleanPageLines(page.translation.data);
  const paneOriginal = paneText(ocrCleaned);
  const paneEnglish = paneText(enCleaned);
  if (!paneOriginal || !paneEnglish) return null;

  const alignment = currentAlignment(page);
  const lines = pickFilmLines(ocrCleaned, enCleaned, alignment?.pairs ?? null, config.lineMatch, config.lineCount);
  if (!lines) return null;

  // Trace: the first stored pair that lands on the lifted lines (else any pair)
  // and is findable verbatim in both panes.
  let trace: JourneyData['trace'];
  if (alignment) {
    const findable = alignment.pairs.filter(p => p.s.trim().length >= 4 && paneOriginal.includes(p.s) && paneEnglish.includes(p.t));
    const onLines = findable.find(p => lines.original.some(l => l.replace(/…$/, '').includes(p.s) || p.s.includes(l.replace(/…$/, ''))));
    const pick = onLines || findable[0];
    if (pick) trace = { s: pick.s, t: pick.t };
  }

  const scan = r2Image(page, 'display') || (() => {
    const u = getPageImageUrl(page, 'display');
    return u ? { url: u, ar: page.image_width && page.image_height ? page.image_width / page.image_height : undefined } : null;
  })();
  if (!scan) return null;

  // A spread of the book's own pages for the "copy" stretch, evenly sampled.
  const n = book.pages_count;
  const wanted = Array.from(new Set(Array.from({ length: VAULT_SIZE }, (_, i) => Math.max(1, Math.round(1 + (i * (n - 1)) / Math.max(1, VAULT_SIZE - 1)))))).filter(x => x !== pageNumber);
  const workId = (book as { work_id?: string }).work_id;
  const [vaultDocs, shelfDocs, index, editions, search, revisions] = await Promise.all([
    db.collection('pages').find(
      { book_id: book.id, page_number: { $in: wanted } },
      { projection: { _id: 0, page_number: 1, ...IMAGE_FIELDS } },
    ).sort({ page_number: 1 }).toArray(),
    loadShelf(db, book.id, (book.categories as string[] | undefined) || []),
    loadIndexNames(db, book.id, pageNumber),
    loadEditions(db, book.id, workId),
    config.search?.query ? loadSearch(db, config.search.query, { bookId: book.id, pageId: page.id, workId }) : Promise.resolve(undefined),
    loadRevisions(db, page.id),
  ]);
  const vault = vaultDocs.map(p => r2Image(p as PageImageFields, 'thumb')).filter((x): x is JourneyImage => !!x);
  const shelf = shelfDocs.images;
  const coverUrl = getBookThumbnailUrl(book, 'thumb');
  const cover = coverUrl && R2.test(coverUrl) ? { url: coverUrl } : undefined;

  // Curated strings are claims about the page; each must be found on it, or it is dropped.
  let note: JourneyData['note'];
  if (config.note && containsLoose(paneOriginal, config.note.text)) note = config.note;
  else {
    const m = firstMarginNote(page.ocr.data);
    if (m && scriptOf(m) === 'latin') note = { label: 'A note on the page, read as text', text: clip(m, 180) };
  }

  const fallbackQuote = pickOutroSentence(paneEnglish, [...lines.english].reverse())
    || clip(paneEnglish.split('\n').find(l => l.length > 20) || paneEnglish, 140);
  const outroQuote = config.outroQuote && containsLoose(paneEnglish, config.outroQuote)
    ? config.outroQuote
    : fallbackQuote;
  const year = typeof book.published === 'string' ? book.published : book.published ? String(book.published) : undefined;

  const edition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published');
  const cit = generateCitations(book, pageNumber, book.id, page.id, SITE, edition, undefined, page.printed_page);

  const { readBy, readByModel } = readByLabel(page);
  const archived = !!page.archived_photo && R2.test(page.archived_photo);
  const pagesArchived = archived ? Math.min(n, (book as { pages_archived?: number }).pages_archived || 0) || undefined : undefined;
  const slugOrId = book.slug || book.id;
  const corpus = translationCorpus(page);
  const language = book.language || 'original';

  return {
    bookId: book.id,
    pageId: page.id,
    pageNumber,
    bookPath: `/book/${slugOrId}`,
    readerPath: readerPageUrl(book, page.id),
    title: book.title,
    displayTitle: book.display_title && book.display_title !== book.title ? book.display_title : undefined,
    author: book.author || undefined,
    published: year,
    language,
    pagesCount: n,
    providerName: (book.image_source as { provider_name?: string } | undefined)?.provider_name,
    sourceUrl: (book.image_source as { source_url?: string } | undefined)?.source_url,
    pagesArchived,
    readBy,
    readByModel,
    machineDraft: isUnreviewedMachineTranslation(page),
    cover,
    scan,
    vault,
    shelf,
    shelfLabel: shelfDocs.label,
    lines,
    paneOriginal,
    paneEnglish,
    trace,
    note,
    outroQuote,
    outroSource: config.outroSource
      || [book.author, book.display_title || book.title, year].filter(Boolean).join(', ') + `, page ${pageNumber}. ${language}, with an English translation ${corpus ? `from the ${corpus.name}` : 'by Source Library'}.`,
    citation: {
      locator: cit.locator, chicago: cit.chicago, inline: cit.inline,
      url: cit.url, short_url: cit.short_url, doi_url: cit.doi_url,
    },
    connect: { search, index, editions },
    revisions,
    script: scriptOf(lines.original.join(' ')),
    config,
  };
}
