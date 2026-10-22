// PRIOR ART: generateEpubDownload in src/app/api/books/[id]/download/route.ts (and its tenant twin) made one EPUB
// chapter per page — a hard break at every page turn on a Kindle — and dropped every illustration. src/lib/flow-join.ts
// (the continuous /read view) joins pages; this reuses it for the export, shared by both routes so they cannot drift.
/**
 * The continuous EPUB (#7118): the book as one reading text, for a Kindle or any e-reader.
 *
 * Pages run on where the sentence does (flow-join), with a small linked page number at every
 * boundary. Chapters are the book's own (when it has them), else runs of PAGES_PER_SECTION pages,
 * so the reader's table of contents stays usable. Illustrations stand in the text at their page,
 * as small grayscale JPEGs (the export's own recompressor: 600×900, the size of an e-ink screen),
 * and ONLY when the book's scans may be redistributed (`classifyImageAccess` is 'open'): a crop is
 * part of the scan. When images are left out, or capped, the EPUB says so in its own front matter.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Db } from 'mongodb';
import { joinPagesHtml, type FlowPage } from '@/lib/flow-join';
import { markdownToHtml } from '@/lib/export-markdown-html';
import { markForExport } from '@/lib/provenance';
import { galleryFilter } from '@/lib/gallery-scope';
import { fetchAndCompressImage } from '@/lib/export-page-images';

export const PAGES_PER_SECTION = 40;
/** At ~40 KB each, 400 illustrations (Fludd's Utriusque cosmi has 402) keep the EPUB near 16 MB: inside Send to
 *  Kindle's email limit (50 MB) and a function's 300 s window (150 took 13 s, measured 2026-10-22). */
export const FLOW_EPUB_MAX_IMAGES = 400;
const IMAGE_CONCURRENCY = 6;

export const FLOW_EPUB_CSS = `
.page-marker { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 0.6em; vertical-align: super; color: #999; text-decoration: none; padding: 0 0.15em; }
.flow-footnote { font-size: 0.85em; color: #555; padding-left: 1em; }
.flow-figure { margin: 1.5em 0; text-align: center; page-break-inside: avoid; }
.flow-figure img { max-width: 100%; max-height: 90vh; height: auto; }
`;

interface FlowBookDoc {
  id: string;
  chapters?: Array<{ title?: string; titleEn?: string; pageNumber?: number; confidence?: string }>;
}
interface FlowPageDoc {
  id: string;
  page_number: number;
  page_type?: string;
  translation?: { data?: string } | null;
  ocr?: { data?: string } | null;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface FlowEpub {
  chapters: { title: string; content: string }[];
  imagesTotal: number;
  imagesIncluded: number;
  /** One sentence for the front matter when the illustrations are not all there; null when they are. */
  imagesNote: string | null;
  /** Removes the temporary image files. Call after the EPUB is built. */
  cleanup: () => void;
}

/** Fetch, recompress and stage the book's illustrations as files the EPUB builder embeds. */
async function stageFigures(db: Db, bookId: string, pageNumbers: Set<number>): Promise<{ byPage: Map<number, string>; total: number; included: number; dir: string | null }> {
  const rows = await db.collection('gallery_images')
    .find(galleryFilter({ bookId, minQuality: 0.5 }), { projection: { _id: 0, page_number: 1, extracted_url: 1, description: 1, bbox: 1, detection_index: 1, gallery_quality: 1 }, maxTimeMS: 10000 })
    .toArray()
    .catch(() => []) as unknown as Array<{ page_number: number; extracted_url: string; description?: string; bbox?: { y?: number }; detection_index?: number; gallery_quality?: number }>;
  const imgs = rows.filter(r => pageNumbers.has(r.page_number));
  const byPage = new Map<number, string>();
  if (imgs.length === 0) return { byPage, total: 0, included: 0, dir: null };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `flow-epub-${bookId}-`));
  // Over the cap, the best illustrations across the whole book, not the first N (which would strip every plate
  // from the book's later parts); then back into reading order.
  const wanted = [...imgs].sort((a, b) => (b.gallery_quality ?? 0) - (a.gallery_quality ?? 0)).slice(0, FLOW_EPUB_MAX_IMAGES)
    .sort((a, b) => a.page_number - b.page_number || (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0) || (a.detection_index ?? 0) - (b.detection_index ?? 0));
  const files: (string | null)[] = new Array(wanted.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: IMAGE_CONCURRENCY }, async () => {
    for (let i = next++; i < wanted.length; i = next++) {
      const buf = await fetchAndCompressImage(wanted[i].extracted_url);
      if (!buf) continue;
      const file = path.join(dir, `fig-${i}.jpg`);
      fs.writeFileSync(file, buf);
      files[i] = file;
    }
  }));
  let included = 0;
  wanted.forEach((img, i) => {
    if (!files[i]) return;
    included++;
    const alt = escapeHtml((img.description || 'Illustration').slice(0, 300));
    byPage.set(img.page_number, (byPage.get(img.page_number) || '') + `<figure class="flow-figure"><img src="file://${files[i]}" alt="${alt}"/></figure>`);
  });
  return { byPage, total: imgs.length, included, dir };
}

export async function buildFlowEpub(
  db: Db,
  book: FlowBookDoc,
  pages: FlowPageDoc[],
  opts: { text: 'translation' | 'ocr'; baseUrl: string; includeImages: boolean },
): Promise<FlowEpub> {
  const readable = pages.filter(p => p.page_type !== 'digitizer-insert' && p.page_type !== 'archived-spread' && p.page_number >= 0);
  const figures = opts.includeImages
    ? await stageFigures(db, book.id, new Set(readable.map(p => p.page_number)))
    : { byPage: new Map<number, string>(), total: await db.collection('gallery_images').countDocuments(galleryFilter({ bookId: book.id, minQuality: 0.5 }), { maxTimeMS: 5000 }).catch(() => 0), included: 0, dir: null };

  const flowPage = (p: FlowPageDoc): FlowPage => {
    const raw = opts.text === 'translation'
      ? (p.translation?.data ? markForExport(p.translation.data, book.id) : '')
      : (p.ocr?.data || '');
    const html = raw.trim() ? markdownToHtml(raw) : '';
    return { n: p.page_number, html: html && html !== '<p></p>' ? html : null, href: `${opts.baseUrl}/book/${book.id}/page/${p.id}`, figures: figures.byPage.get(p.page_number) };
  };

  // Sections: the book's chapters when it has them (low-confidence ones are guesses), else even runs of pages.
  const starts = (book.chapters || [])
    .filter(c => typeof c.pageNumber === 'number' && c.confidence !== 'low' && (c.titleEn || c.title))
    .map(c => ({ page: c.pageNumber as number, title: (c.titleEn || c.title) as string }))
    .sort((a, b) => a.page - b.page);
  const sections: { title: string; pages: FlowPageDoc[] }[] = [];
  for (const p of readable) {
    const chapter = starts.find(c => c.page === p.page_number);
    const startsRun = starts.length === 0 && (sections.length === 0 || sections[sections.length - 1].pages.length >= PAGES_PER_SECTION);
    if (sections.length === 0 || chapter || startsRun) sections.push({ title: chapter?.title || '', pages: [] });
    sections[sections.length - 1].pages.push(p);
  }
  const chapters = sections
    .map(s => {
      const first = s.pages[0].page_number, last = s.pages[s.pages.length - 1].page_number;
      const title = s.title || (first === last ? `Page ${first}` : `Pages ${first}–${last}`);
      const body = joinPagesHtml(s.pages.map(flowPage));
      return { title, content: `${s.title ? `<h2>${escapeHtml(s.title)}</h2>\n` : ''}${body}` };
    })
    .filter(c => /<p>|<figure/.test(c.content));

  const imagesNote = figures.total === 0 ? null
    : !opts.includeImages ? `This edition carries the text only: the scans of this book are not released for redistribution, so its ${figures.total} illustrations are not included. They can be seen at ${opts.baseUrl}/book/${book.id}.`
    : figures.included < figures.total ? `${figures.included} of this book's ${figures.total} illustrations are included${figures.total > FLOW_EPUB_MAX_IMAGES ? ` (an e-book carries at most ${FLOW_EPUB_MAX_IMAGES})` : ''}; all of them can be seen at ${opts.baseUrl}/book/${book.id}.`
    : null;

  return {
    chapters,
    imagesTotal: figures.total,
    imagesIncluded: figures.included,
    imagesNote,
    cleanup: () => { if (figures.dir) fs.rmSync(figures.dir, { recursive: true, force: true }); },
  };
}
