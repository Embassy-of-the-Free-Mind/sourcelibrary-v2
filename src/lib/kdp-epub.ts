import archiver from 'archiver';
import sharp from 'sharp';
import type { Db } from 'mongodb';
import { resolveHoldingCopy } from '@/lib/holding-library';
import { resolveImprintPlace } from '@/lib/imprint';
import type { Book, Chapter, Page } from '@/lib/types';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { markForExport } from '@/lib/provenance';
import { getBookIndex } from '@/lib/book-index';
import { images } from '@/lib/api-client';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://sourcelibrary.org';

// Illustration fetch is bounded — gallery images filtered at quality >= 0.7 are
// typically a few dozen at most, but cap the worst case so an outlier book can't
// blow past the bundle route's maxDuration.
const MAX_ILLUSTRATIONS = 60;
// Wall-clock ceiling for the serial figure fetches, well inside the bundle
// route's maxDuration (300s) so cover + assembly still have room.
const FIGURE_FETCH_BUDGET_MS = 180_000;
const ILLUSTRATION_MIN_QUALITY = 0.7;

export interface KdpEpubOptions {
  /** AI-disclosure paragraph shown on the copyright page. */
  aiDisclosure?: string;
  /** Scholarly introduction (falls back to the book's reading summary). */
  introduction?: string;
  /** Translation methodology note (optional). */
  methodology?: string;
  /** SPDX/CC license id for the copyright page (default CC-BY-SA-4.0). */
  license?: string;
  /**
   * Pre-generated cover JPEG to embed as the EPUB cover-image. Pass the same
   * buffer the KDP bundle writes as cover.jpg so the two stay identical.
   */
  coverImage?: Buffer | null;
}

// ─── Index / gallery shapes ──────────────────────────────────────────────
// The stored book_indexes docs carry term/definition/pages arrays keyed by
// facet. getBookIndex()'s declared type is looser, so read through this view
// (mirrors the download route's scholarly EPUB path).
interface IndexEntry {
  term: string;
  definition?: string;
  pages?: number[];
}
interface BookIndexView {
  vocabulary?: IndexEntry[];
  keywords?: IndexEntry[];
  people?: IndexEntry[];
  places?: IndexEntry[];
  concepts?: IndexEntry[];
  bookSummary?: { brief?: string; abstract?: string; detailed?: string };
}

interface GalleryImage {
  page_number: number;
  detection_index: number;
  type?: string;
  gallery_quality?: number;
  museum_description?: string;
  description?: string;
  extracted_url?: string;
  image_url?: string;
}

// ─── XML / text helpers ────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert cleaned prose to EPUB XHTML paragraphs.
 *
 * The caller is responsible for running {@link stripEditorialWrappers} first —
 * that removes the AI page-description blocks (<meta>/<summary>/<keywords>/…)
 * that are never verbatim source text and must never be published as quotable
 * prose (PR #2232). Here we only handle the remaining body: markdown headers,
 * bold/italic, and paragraph/line breaks. Zero-width provenance marks from
 * markForExport() pass through untouched.
 */
function proseToHtml(clean: string): string {
  if (!clean?.trim()) return '';

  // stripEditorialWrappers() has already removed the AI page-description blocks.
  // What remains may still carry inline body marks/glosses (<note>/<term>/<margin>/
  // <gloss>/<unclear>/<header>/<sig>/<page-num>/…) which ARE real text — drop the
  // tag but keep the content so they read as prose rather than literal "<note>".
  clean = clean
    .replace(/<(?:column-break|page-break)\s*\/?>/gi, '\n\n')
    .replace(/<\/?[a-z][a-z0-9-]*\s*\/?>/gi, '');

  return clean
    .split(/\n\n+/)
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';

      const h1 = trimmed.match(/^# (.+)$/m);
      if (h1) return `<h2>${escapeXml(h1[1])}</h2>`;
      const h2 = trimmed.match(/^## (.+)$/m);
      if (h2) return `<h3>${escapeXml(h2[1])}</h3>`;
      const h3 = trimmed.match(/^### (.+)$/m);
      if (h3) return `<h4>${escapeXml(h3[1])}</h4>`;

      let html = escapeXml(trimmed);
      html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
      html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
      html = html.replace(/\n/g, '<br/>');
      return `<p>${html}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

/** Front-matter prose (introduction, methodology) — cleaned then paragraphed. */
function frontMatterToHtml(text: string): string {
  return proseToHtml(stripEditorialWrappers(text));
}

/** Page translation body — cleaned, provenance-marked, then paragraphed. */
function translationToHtml(text: string, bookId: string): string {
  const clean = stripEditorialWrappers(text);
  if (!clean.trim()) return '';
  return proseToHtml(markForExport(clean, bookId));
}

// ─── Chapter grouping ──────────────────────────────────────────────────────

const ROMAN = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
  'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV', 'XXVI', 'XXVII', 'XXVIII', 'XXIX', 'XXX',
];

/**
 * Group translated pages into chapters using book.chapters when present,
 * else ~20-page numbered sections.
 */
function buildChapterGroups(
  pages: Page[],
  chapters?: Chapter[]
): Array<{ title: string; pages: Page[] }> {
  const translatedPages = pages
    .filter(p => p.translation?.data)
    .sort((a, b) => a.page_number - b.page_number);

  if (!translatedPages.length) return [];

  if (chapters?.length) {
    const sorted = [...chapters].sort((a, b) => a.pageNumber - b.pageNumber);
    const groups: Array<{ title: string; pages: Page[] }> = [];

    for (let i = 0; i < sorted.length; i++) {
      const ch = sorted[i];
      const next = sorted[i + 1];
      const start = ch.pageNumber;
      const end = next ? next.pageNumber - 1 : Infinity;
      const chapterPages = translatedPages.filter(p => p.page_number >= start && p.page_number <= end);
      if (chapterPages.length > 0) {
        groups.push({ title: ch.titleEn || ch.title, pages: chapterPages });
      }
    }

    const firstChapterPage = sorted[0].pageNumber;
    const preface = translatedPages.filter(p => p.page_number < firstChapterPage);
    if (preface.length > 0) {
      groups.unshift({ title: 'Preliminary Matter', pages: preface });
    }

    if (groups.length > 0) return groups;
  }

  const SECTION_SIZE = 20;
  const groups: Array<{ title: string; pages: Page[] }> = [];
  for (let i = 0; i < translatedPages.length; i += SECTION_SIZE) {
    const idx = Math.floor(i / SECTION_SIZE);
    groups.push({
      title: `Section ${ROMAN[idx] || idx + 1}`,
      pages: translatedPages.slice(i, i + SECTION_SIZE),
    });
  }
  return groups;
}

// ─── Image fetching ────────────────────────────────────────────────────────

/** Resolve the best source scan URL for a page (mirrors the scholarly path). */
function pageScanUrl(page: Page | undefined): string | null {
  if (!page) return null;
  return page.cropped_photo || page.archived_photo || page.photo || null;
}

/**
 * Caption for one embedded image. Several detections can collapse onto a single
 * page scan, so join their distinct descriptions rather than showing only the
 * first — the reader is looking at the whole page.
 */
function captionForFigure(
  pageIllustrations: GalleryImage[],
  figId: string,
  figIdByDetection: Map<string, string>
): string {
  const parts: string[] = [];
  for (const img of pageIllustrations) {
    if (figIdByDetection.get(`${img.page_number}-${img.detection_index}`) !== figId) continue;
    const text = (img.museum_description || img.description || '').trim();
    if (text && !parts.includes(text)) parts.push(text);
  }
  const joined = parts.join(' \u00b7 ');
  return joined.length > 220 ? joined.slice(0, 219) + '\u2026' : joined;
}

/** Fetch + downscale an illustration/facsimile image to a Kindle-friendly JPEG. */
async function fetchFigureImage(url: string): Promise<Buffer | null> {
  try {
    const buffer = await images.fetchBuffer(url, { timeout: 25000 });
    return await sharp(buffer)
      .resize(1000, 1500, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    console.error(`[kdp-epub] failed to fetch figure: ${url}`, error);
    return null;
  }
}

// ─── XHTML wrappers ──────────────────────────────────────────────────────

function xhtml(title: string, bodyClass: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body class="${bodyClass}">
${body}
</body>
</html>`;
}

const KDP_CSS = `
body { font-family: Georgia, "Times New Roman", serif; line-height: 1.6; margin: 1em; color: #1a1a1a; }
h1, h2, h3, h4 { font-family: "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; margin: 1.5em 0 0.5em; }
h1 { font-size: 1.6em; text-align: center; margin-top: 2em; }
h2 { font-size: 1.3em; }
h3 { font-size: 1.1em; }
h4 { font-size: 1em; font-style: italic; }
p { margin: 0.8em 0; text-align: justify; text-indent: 1.5em; }
p:first-child, h1 + p, h2 + p, h3 + p, h4 + p, .chapter-title + p { text-indent: 0; }
blockquote { margin: 1em 2em; font-style: italic; color: #444; }
ul { margin: 0.5em 0; padding-left: 1.5em; }
li { margin: 0.3em 0; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-width: 100%; height: auto; }
.title-page { text-align: center; padding-top: 3em; }
.title-page h1 { font-size: 2em; margin-bottom: 0.3em; }
.title-page .original-title { font-style: italic; color: #555; }
.title-page .author { font-size: 1.3em; font-style: italic; margin: 0.8em 0; }
.title-page .year { font-size: 1.1em; color: #666; }
.title-page .translator { font-size: 1em; margin-top: 2em; color: #444; }
.title-page-scan { text-align: center; margin: 1.5em auto; }
.title-page-scan img { max-width: 78%; border: 1px solid #d4c4a8; }
.copyright-page p { text-indent: 0; margin: 0.5em 0; text-align: left; }
.disclosure { border-top: 1px solid #ccc; padding-top: 1em; margin-top: 1.5em; font-size: 0.92em; color: #444; }
.chapter-title { font-size: 1.5em; text-align: center; margin: 2em 0 1em; border-bottom: 1px solid #d4c4a8; padding-bottom: 0.4em; }
.folio-marker { display: block; font-size: 0.72em; color: #999; margin: 1.4em 0 0.3em; font-family: "Helvetica Neue", Arial, sans-serif; letter-spacing: 0.05em; }
figure.illustration { text-align: center; margin: 1.5em 0; page-break-inside: avoid; }
figure.illustration img { max-width: 100%; max-height: 88vh; object-fit: contain; border: 1px solid #d4c4a8; }
figure.illustration figcaption { font-size: 0.85em; color: #666; font-style: italic; margin-top: 0.5em; }
.illus-entry { margin: 0.5em 0; padding-left: 1em; border-left: 2px solid #d4c4a8; }
.illus-entry .illus-page { font-weight: bold; margin-right: 0.4em; }
.illus-entry .illus-type { font-variant: small-caps; color: #777; margin-right: 0.4em; }
.illus-entry .illus-desc { font-style: italic; color: #555; }
.glossary-term { margin: 0.7em 0; padding-left: 1em; border-left: 2px solid #d4c4a8; }
.glossary-term strong { color: #333; }
.glossary-term .definition { font-style: italic; color: #555; }
.glossary-term .pages, .index-entry .pages { font-size: 0.85em; color: #888; }
.index-entry { margin: 0.3em 0; }
.colophon-section { margin-top: 1em; }
.colophon-section p { text-indent: 0; margin: 0.3em 0; }
.colophon-label { font-weight: bold; color: #333; }
`;

// ─── Main generator ────────────────────────────────────────────────────────

/**
 * Generate a KDP-ready reflowable EPUB from a translated book.
 *
 * Structure: cover · title page (+ original title-page scan) · copyright &
 * AI disclosure · introduction · list of illustrations · chapter-grouped
 * translation with inline facsimile page images · glossary · index · colophon,
 * with a nested navigation document. All page text is routed through
 * stripEditorialWrappers() (so no AI page-description prose is published as
 * source) and carries the export provenance mark.
 */
export async function generateKdpEpub(
  book: Book,
  pages: Page[],
  db: Db,
  options?: KdpEpubOptions
): Promise<Buffer> {
  const bookTitle = book.display_title || book.title;
  const bookSlug = book.slug || book.id;
  const bookUrl = `${BASE_URL}/book/${bookSlug}`;
  const now = new Date().toISOString().split('T')[0];
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const uuid = `urn:uuid:${book.id}`;
  const license = options?.license || 'CC-BY-SA-4.0';

  const translatedPages = pages.filter(p => p.translation?.data);

  // Gallery illustrations worth showing inline (skip decorative initials/rules).
  let galleryImages: GalleryImage[] = [];
  try {
    galleryImages = await db.collection('gallery_images')
      .find({
        book_id: book.id,
        gallery_quality: { $gte: ILLUSTRATION_MIN_QUALITY },
        type: { $nin: ['decorative'] },
      })
      .sort({ page_number: 1, detection_index: 1 })
      .limit(MAX_ILLUSTRATIONS)
      .toArray() as unknown as GalleryImage[];
  } catch (e) {
    console.error('[kdp-epub] gallery lookup failed', e);
  }
  const illustrationsByPage = new Map<number, GalleryImage[]>();
  for (const img of galleryImages) {
    const arr = illustrationsByPage.get(img.page_number) || [];
    arr.push(img);
    illustrationsByPage.set(img.page_number, arr);
  }

  // Book index (glossary + index facets) and summary.
  let idx: BookIndexView | null = null;
  try {
    idx = (await getBookIndex(book.id)) as unknown as BookIndexView | null;
  } catch (e) {
    console.error('[kdp-epub] index lookup failed', e);
  }
  const hasIndex = !!(
    idx?.people?.length || idx?.places?.length || idx?.concepts?.length || idx?.keywords?.length
  );
  const hasGlossary = !!idx?.vocabulary?.length;

  const chapterGroups = buildChapterGroups(pages, book.chapters);

  // Original title-page scan (nice historical front matter).
  const titlePageScan = pages.find(p => p.page_type === 'title-page');

  const spine: string[] = [];
  const manifest: string[] = [];
  const navTop: string[] = [];

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('data', (c: Buffer) => chunks.push(c));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    (async () => {
      // mimetype MUST be first and stored (uncompressed).
      archive.append('application/epub+zip', { name: 'mimetype', store: true });
      archive.append(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`, { name: 'META-INF/container.xml' });

      // ── Cover ──
      const coverBuffer = options?.coverImage || null;
      if (coverBuffer) {
        manifest.push(`<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>`);
        manifest.push(`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
        spine.push(`<itemref idref="cover" linear="yes"/>`);
        archive.append(coverBuffer, { name: 'OEBPS/images/cover.jpg' });
        archive.append(
          xhtml('Cover', 'cover', `  <div class="cover"><img src="images/cover.jpg" alt="${escapeXml(bookTitle)}"/></div>`),
          { name: 'OEBPS/cover.xhtml' }
        );
      }

      // ── Title-page scan asset ──
      let titleScanBuffer: Buffer | null = null;
      if (titlePageScan) {
        const scanUrl = pageScanUrl(titlePageScan);
        if (scanUrl) {
          titleScanBuffer = await fetchFigureImage(scanUrl);
          if (titleScanBuffer) {
            manifest.push(`<item id="title-scan" href="images/title-scan.jpg" media-type="image/jpeg"/>`);
            archive.append(titleScanBuffer, { name: 'OEBPS/images/title-scan.jpg' });
          }
        }
      }

      // ── Title page ──
      const titleBody = `  <div class="title-page">
    ${titleScanBuffer ? `<div class="title-page-scan"><img src="images/title-scan.jpg" alt="Original title page"/></div>` : ''}
    <h1>${escapeXml(bookTitle)}</h1>
    ${book.title !== bookTitle ? `<p class="original-title">${escapeXml(book.title)}</p>` : ''}
    <p class="author">${escapeXml(book.author)}</p>
    ${book.published ? `<p class="year">${escapeXml(book.published)}</p>` : ''}
    <p class="translator">English translation by Source Library</p>
  </div>`;
      manifest.push(`<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`);
      spine.push(`<itemref idref="title"/>`);
      navTop.push(`<li><a href="title.xhtml">Title Page</a></li>`);
      archive.append(xhtml('Title Page', 'front-matter', titleBody), { name: 'OEBPS/title.xhtml' });

      // ── Copyright / license / AI disclosure ──
      const disclosure = options?.aiDisclosure ||
        `This translation was produced using artificial intelligence by Source Library ` +
        `(sourcelibrary.org), a free library of historical primary sources. AI translation ` +
        `captures the meaning and structure of the original text but may not reflect every ` +
        `nuance a specialist human translator would convey. The original-language text and ` +
        `high-resolution page scans are available at ${bookUrl}.`;
      const copyrightBody = `  <div class="copyright-page">
    <h1>Copyright &amp; License</h1>
    <p><strong>${escapeXml(bookTitle)}</strong></p>
    ${book.title !== bookTitle ? `<p>Original title: <em>${escapeXml(book.title)}</em></p>` : ''}
    <p>Original work by ${escapeXml(book.author)}${book.published ? ` (${escapeXml(book.published)})` : ''}.</p>
    <p>English translation prepared by Source Library.</p>
    <p><strong>License:</strong> ${escapeXml(license)} (Creative Commons Attribution-ShareAlike). You are free to share and adapt this material, provided you give appropriate credit and distribute under the same license.</p>
    ${options?.methodology ? `<h2>Translation Methodology</h2>${frontMatterToHtml(options.methodology)}` : ''}
    <div class="disclosure"><p>${escapeXml(disclosure)}</p></div>
    <p style="margin-top:1.5em;">Produced by SourceLibrary.org in Amsterdam, ${new Date().getFullYear()}.</p>
    <p>Source: ${escapeXml(bookUrl)}</p>
  </div>`;
      manifest.push(`<item id="copyright" href="copyright.xhtml" media-type="application/xhtml+xml"/>`);
      spine.push(`<itemref idref="copyright"/>`);
      navTop.push(`<li><a href="copyright.xhtml">Copyright &amp; License</a></li>`);
      archive.append(xhtml('Copyright & License', 'front-matter', copyrightBody), { name: 'OEBPS/copyright.xhtml' });

      // ── Introduction ──
      const introText = options?.introduction || book.reading_summary?.overview || idx?.bookSummary?.abstract;
      if (introText) {
        const introBody = `  <div class="front-matter"><h1>Introduction</h1>${frontMatterToHtml(introText)}</div>`;
        manifest.push(`<item id="introduction" href="introduction.xhtml" media-type="application/xhtml+xml"/>`);
        spine.push(`<itemref idref="introduction"/>`);
        navTop.push(`<li><a href="introduction.xhtml">Introduction</a></li>`);
        archive.append(xhtml('Introduction', 'front-matter', introBody), { name: 'OEBPS/introduction.xhtml' });
      }

      // ── List of illustrations ──
      if (galleryImages.length > 0) {
        const entries = galleryImages.map(img => {
          const raw = img.museum_description || img.description || 'Illustration';
          const desc = escapeXml(raw.slice(0, 140) + (raw.length > 140 ? '…' : ''));
          const typeLabel = escapeXml((img.type || 'illustration').replace(/_/g, ' '));
          return `    <div class="illus-entry"><span class="illus-page">p. ${img.page_number}</span><span class="illus-type">${typeLabel}</span><span class="illus-desc">${desc}</span></div>`;
        }).join('\n');
        const body = `  <div class="front-matter">
    <h1>List of Illustrations</h1>
    <p>${galleryImages.length} illustration${galleryImages.length !== 1 ? 's' : ''} from the original ${escapeXml(book.language)} edition.</p>
${entries}
  </div>`;
        manifest.push(`<item id="illustrations" href="illustrations.xhtml" media-type="application/xhtml+xml"/>`);
        spine.push(`<itemref idref="illustrations"/>`);
        navTop.push(`<li><a href="illustrations.xhtml">List of Illustrations</a></li>`);
        archive.append(xhtml('List of Illustrations', 'front-matter', body), { name: 'OEBPS/illustrations.xhtml' });
      }

      // ── Fetch illustration image assets (bounded set) ──
      // A figure is the full page scan (it frames better than a tight crop), so
      // every detection on a given page resolves to the SAME url. Key the asset
      // by url, not by detection, or a page holding two plates is fetched twice,
      // embedded twice, and rendered twice in a row.
      const figureBuffers = new Map<string, Buffer>();
      const figIdByUrl = new Map<string, string>();
      const figIdByDetection = new Map<string, string>();
      // Serial fetches against upstream scan hosts are the one unbounded cost in
      // here; the route only has maxDuration to spend. Stop fetching at the
      // budget and say what was dropped rather than letting the whole bundle
      // time out with no output at all.
      const figureDeadline = Date.now() + FIGURE_FETCH_BUDGET_MS;
      let figuresSkipped = 0;
      for (const img of galleryImages) {
        const detectionKey = `${img.page_number}-${img.detection_index}`;
        const url = pageScanUrl(pages.find(p => p.page_number === img.page_number)) || img.extracted_url || img.image_url;
        if (!url) continue;
        const alreadyFetched = figIdByUrl.get(url);
        if (alreadyFetched) {
          figIdByDetection.set(detectionKey, alreadyFetched);
          continue;
        }
        if (Date.now() > figureDeadline) {
          figuresSkipped++;
          continue;
        }
        const figId = `illus-${img.page_number}-${img.detection_index}`;
        const buf = await fetchFigureImage(url);
        if (buf) {
          figIdByUrl.set(url, figId);
          figIdByDetection.set(detectionKey, figId);
          figureBuffers.set(figId, buf);
          manifest.push(`<item id="${figId}" href="images/${figId}.jpg" media-type="image/jpeg"/>`);
          archive.append(buf, { name: `OEBPS/images/${figId}.jpg` });
        }
      }
      if (figuresSkipped > 0) {
        console.warn(`[kdp-epub] figure budget exhausted for ${book.id}: ${figuresSkipped} illustration(s) omitted`);
      }

      // ── Chapters (nested under "Translation") ──
      const chapterNav: string[] = [];
      for (const [i, group] of chapterGroups.entries()) {
        let body = `  <div class="chapter">\n  <h2 class="chapter-title">${escapeXml(group.title)}</h2>\n`;
        for (const page of group.pages) {
          const pageIllustrations = illustrationsByPage.get(page.page_number) || [];
          const emittedFigures = new Set<string>();
          for (const img of pageIllustrations) {
            const figId = figIdByDetection.get(`${img.page_number}-${img.detection_index}`);
            if (!figId || !figureBuffers.has(figId) || emittedFigures.has(figId)) continue;
            emittedFigures.add(figId);
            // One image can carry several detections; caption it with all of
            // them, since the reader sees the whole page, not one crop.
            const caption = escapeXml(captionForFigure(pageIllustrations, figId, figIdByDetection));
            body += `  <figure class="illustration"><img src="images/${figId}.jpg" alt="${caption}"/>${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>\n`;
          }
          const html = translationToHtml(page.translation!.data, book.id);
          if (html) {
            body += `  <span class="folio-marker" id="p-${page.page_number}">[p.&#160;${page.page_number}]</span>\n${html}\n`;
          }
        }
        body += '  </div>';
        manifest.push(`<item id="chapter-${i}" href="chapter-${i}.xhtml" media-type="application/xhtml+xml"/>`);
        spine.push(`<itemref idref="chapter-${i}"/>`);
        chapterNav.push(`        <li><a href="chapter-${i}.xhtml">${escapeXml(group.title)}</a></li>`);
        archive.append(xhtml(group.title, 'chapter', body), { name: `OEBPS/chapter-${i}.xhtml` });
      }
      if (chapterNav.length > 0) {
        navTop.push(`<li><a href="chapter-0.xhtml">Translation</a>\n      <ol>\n${chapterNav.join('\n')}\n      </ol>\n    </li>`);
      }

      // ── Glossary (from vocabulary) ──
      if (hasGlossary) {
        const terms = [...idx!.vocabulary!]
          .sort((a, b) => a.term.localeCompare(b.term))
          .map(e => `    <div class="glossary-term"><strong>${escapeXml(e.term)}</strong>${e.definition ? `<span class="definition"> — ${escapeXml(e.definition)}</span>` : ''}${e.pages?.length ? `<span class="pages"> (pp. ${e.pages.join(', ')})</span>` : ''}</div>`)
          .join('\n');
        const body = `  <div class="glossary">
    <h1>Glossary</h1>
    <p>Technical terms and vocabulary from the original ${escapeXml(book.language)} text.</p>
${terms}
  </div>`;
        manifest.push(`<item id="glossary" href="glossary.xhtml" media-type="application/xhtml+xml"/>`);
        spine.push(`<itemref idref="glossary"/>`);
        navTop.push(`<li><a href="glossary.xhtml">Glossary</a></li>`);
        archive.append(xhtml('Glossary', 'glossary', body), { name: 'OEBPS/glossary.xhtml' });
      }

      // ── Index (people / places / concepts / keywords) ──
      if (hasIndex) {
        const section = (title: string, entries?: IndexEntry[], cap?: number) => {
          if (!entries?.length) return '';
          const items = [...entries]
            .sort((a, b) => a.term.localeCompare(b.term))
            .slice(0, cap || entries.length)
            .map(e => `    <div class="index-entry">${escapeXml(e.term)}${e.pages?.length ? ` <span class="pages">${e.pages.join(', ')}</span>` : ''}</div>`)
            .join('\n');
          return `    <h2>${title}</h2>\n${items}\n`;
        };
        const body = `  <div class="index-section">
    <h1>Index</h1>
${section('People', idx!.people)}${section('Places', idx!.places)}${section('Concepts', idx!.concepts)}${section('Key Terms', idx!.keywords, 100)}  </div>`;
        manifest.push(`<item id="index" href="index.xhtml" media-type="application/xhtml+xml"/>`);
        spine.push(`<itemref idref="index"/>`);
        navTop.push(`<li><a href="index.xhtml">Index</a></li>`);
        archive.append(xhtml('Index', 'index-section', body), { name: 'OEBPS/index.xhtml' });
      }

      // ── Colophon ──
      const translatedCount = translatedPages.length;
      const models = new Set<string>();
      for (const p of pages) {
        if (p.translation?.model) models.add(p.translation.model);
        if (p.ocr?.model) models.add(p.ocr.model);
      }
      const provider = book.image_source?.provider_name || book.image_source?.provider;
      // Imprint place: resolve the stated/asserted/conjectural family, not the
      // bare import-tier column (#4043).
      const imprintPlace = resolveImprintPlace(book)?.display;
      const colophonBody = `  <div class="colophon">
    <h1>Colophon</h1>
    <div class="colophon-section">
      <p><span class="colophon-label">Title:</span> ${escapeXml(bookTitle)}</p>
      ${book.title !== bookTitle ? `<p><span class="colophon-label">Original Title:</span> ${escapeXml(book.title)}</p>` : ''}
      <p><span class="colophon-label">Author:</span> ${escapeXml(book.author)}</p>
      <p><span class="colophon-label">Original Language:</span> ${escapeXml(book.language)}</p>
      ${book.published ? `<p><span class="colophon-label">Published:</span> ${escapeXml(book.published)}</p>` : ''}
      ${imprintPlace ? `<p><span class="colophon-label">Place:</span> ${escapeXml(imprintPlace)}</p>` : ''}
      ${book.publisher ? `<p><span class="colophon-label">Printer/Publisher:</span> ${escapeXml(book.publisher)}</p>` : ''}
    </div>
    <div class="colophon-section">
      <h2>Source</h2>
      ${provider ? `<p><span class="colophon-label">Digital Scans:</span> ${escapeXml(provider)}</p>` : ''}
      ${book.image_source?.source_url ? `<p><span class="colophon-label">Original Record:</span> ${escapeXml(book.image_source.source_url)}</p>` : ''}
      ${book.ia_identifier ? `<p><span class="colophon-label">Internet Archive:</span> ${escapeXml(book.ia_identifier)}</p>` : ''}
    </div>
    <div class="colophon-section">
      <h2>Translation</h2>
      <p><span class="colophon-label">Pages Translated:</span> ${translatedCount} of ${pages.length}</p>
      ${models.size > 0 ? `<p><span class="colophon-label">AI Models:</span> ${escapeXml(Array.from(models).join(', '))}</p>` : ''}
      <p><span class="colophon-label">Generated:</span> ${now}</p>
      <p><span class="colophon-label">License:</span> ${escapeXml(license)}</p>
    </div>
    <div class="colophon-section">
      <h2>Read Online</h2>
      <p>Original scans, OCR, and interactive features: ${escapeXml(bookUrl)}</p>
      <p>Source Library: ${escapeXml(BASE_URL)}</p>
    </div>
  </div>`;
      manifest.push(`<item id="colophon" href="colophon.xhtml" media-type="application/xhtml+xml"/>`);
      spine.push(`<itemref idref="colophon"/>`);
      navTop.push(`<li><a href="colophon.xhtml">About This Edition</a></li>`);
      archive.append(xhtml('About This Edition', 'colophon', colophonBody), { name: 'OEBPS/colophon.xhtml' });

      // ── Nav + CSS ──
      manifest.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
      manifest.push(`<item id="css" href="styles.css" media-type="text/css"/>`);
      archive.append(KDP_CSS, { name: 'OEBPS/styles.css' });

      const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>Contents</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      ${navTop.join('\n      ')}
    </ol>
  </nav>
</body>
</html>`;
      archive.append(nav, { name: 'OEBPS/nav.xhtml' });

      // ── OPF package ──
      const description = (book.reading_summary?.overview || `English translation of ${bookTitle} by ${book.author}.`).slice(0, 500);
      const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uuid}</dc:identifier>
    <dc:title>${escapeXml(bookTitle)}</dc:title>
    <dc:creator>${escapeXml(book.author)}</dc:creator>
    <dc:contributor>Source Library (translator)</dc:contributor>
    <dc:publisher>Source Library</dc:publisher>
    ${(() => {
      // dc:source names the physical copy the facsimile reproduces (#4360).
      const copy = resolveHoldingCopy(book);
      return copy ? `<dc:source>${escapeXml(`Copy held by ${copy.holding_library}${copy.shelfmark ? `, shelfmark ${copy.shelfmark}` : ''}`)}</dc:source>` : '';
    })()}
    <dc:description>${escapeXml(description)}</dc:description>
    <dc:language>en</dc:language>
    <dc:date>${now}</dc:date>
    <dc:rights>${escapeXml(license)}</dc:rights>
    <meta property="dcterms:modified">${modified}</meta>
    ${options?.coverImage ? '<meta name="cover" content="cover-image"/>' : ''}
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine>
    ${spine.join('\n    ')}
  </spine>
</package>`;
      archive.append(opf, { name: 'OEBPS/content.opf' });

      await archive.finalize();
    })().catch(reject);
  });
}
