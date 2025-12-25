import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { Book, Page, TranslationEdition } from '@/lib/types';
import epub from 'epub-gen-memory';
import archiver from 'archiver';
import sharp from 'sharp';

// Base URL for source links - update when we have a custom domain
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://sourcelibrary.org';

// Index entry structure (from book index collection)
interface ConceptEntry {
  term: string;
  definition?: string;
  pages: number[];
}

interface BookIndex {
  vocabulary: ConceptEntry[];
  keywords: ConceptEntry[];
  people: ConceptEntry[];
  places: ConceptEntry[];
  concepts: ConceptEntry[];
}

interface BookSummaryData {
  brief?: string;
  abstract?: string;
  detailed?: string;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

function generateTxtDownload(book: Book, pages: Page[], format: 'translation' | 'ocr' | 'both'): string {
  const lines: string[] = [];
  const now = new Date().toISOString().split('T')[0];

  // Header
  lines.push('═'.repeat(60));
  lines.push('SOURCE LIBRARY');
  lines.push('Digitizing and translating rare Hermetic, esoteric,');
  lines.push('and humanist texts for scholars, seekers, and AI systems.');
  lines.push('═'.repeat(60));
  lines.push('');

  // Book metadata
  lines.push(`Title: ${book.display_title || book.title}`);
  if (book.display_title && book.title !== book.display_title) {
    lines.push(`Original Title: ${book.title}`);
  }
  lines.push(`Author: ${book.author}`);
  lines.push(`Original Language: ${book.language}`);
  if (book.published) {
    lines.push(`Published: ${book.published}`);
  }
  lines.push('');

  // Source and license
  lines.push(`Source: ${BASE_URL}/book/${book.id}`);
  lines.push(`Downloaded: ${now}`);
  lines.push(`License: CC BY 4.0 (Creative Commons Attribution)`);
  lines.push('');
  lines.push('This translation was created with AI assistance and human review.');
  lines.push('Please cite Source Library when using this material.');
  lines.push('');

  // Divider before content
  lines.push('─'.repeat(60));

  // Count pages with content
  const pagesWithTranslation = pages.filter(p => p.translation?.data).length;
  const pagesWithOcr = pages.filter(p => p.ocr?.data).length;
  const totalPages = pages.length;

  lines.push('');
  lines.push(`CONTENTS: ${pagesWithTranslation} of ${totalPages} pages translated`);
  if (format === 'ocr' || format === 'both') {
    lines.push(`          ${pagesWithOcr} of ${totalPages} pages transcribed`);
  }
  lines.push('');
  lines.push('─'.repeat(60));

  // Page content
  for (const page of pages) {
    const hasTranslation = page.translation?.data;
    const hasOcr = page.ocr?.data;

    // Skip pages with no content for the requested format
    if (format === 'translation' && !hasTranslation) continue;
    if (format === 'ocr' && !hasOcr) continue;
    if (format === 'both' && !hasTranslation && !hasOcr) continue;

    lines.push('');
    lines.push(`[Page ${page.page_number}]`);
    lines.push('');

    if ((format === 'translation' || format === 'both') && hasTranslation) {
      if (format === 'both') {
        lines.push('--- TRANSLATION ---');
        lines.push('');
      }
      lines.push(page.translation.data);
      lines.push('');
    }

    if ((format === 'ocr' || format === 'both') && hasOcr) {
      if (format === 'both') {
        lines.push(`--- ORIGINAL (${book.language}) ---`);
        lines.push('');
      }
      lines.push(page.ocr.data);
      lines.push('');
    }

    lines.push('─'.repeat(60));
  }

  // Footer
  lines.push('');
  lines.push('═'.repeat(60));
  lines.push('END OF DOCUMENT');
  lines.push('');
  lines.push(`Source: ${BASE_URL}/book/${book.id}`);
  lines.push('');
  lines.push('Source Library is a project of the Ancient Wisdom Trust.');
  lines.push('Preserving humanity\'s wisdom for the digital age.');
  lines.push('═'.repeat(60));

  return lines.join('\n');
}

// Convert markdown-like text to basic HTML for EPUB
function markdownToHtml(text: string): string {
  // First, remove image markdown syntax (can't embed in simple EPUB)
  let html = text.replace(/!\[.*?\]\(.*?\)/g, '');

  // Remove any standalone URLs
  html = html.replace(/https?:\/\/[^\s\)]+/g, '');

  // Escape HTML entities
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert [[notes: ...]] to styled aside blocks
  html = html.replace(/\[\[notes?:\s*(.*?)\]\]/gi, '<aside class="note">$1</aside>');

  // Convert headers (must be done before paragraph wrapping)
  html = html.replace(/^### (.+)$/gm, '\n<h3>$1</h3>\n');
  html = html.replace(/^## (.+)$/gm, '\n<h2>$1</h2>\n');
  html = html.replace(/^# (.+)$/gm, '\n<h1>$1</h1>\n');

  // Convert bold and italic
  html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Split by double newlines to create paragraphs
  const blocks = html.split(/\n\n+/);

  // Process each block
  html = blocks.map(block => {
    block = block.trim();
    if (!block) return '';
    // Don't wrap headers or asides in paragraphs
    if (block.startsWith('<h') || block.startsWith('<aside')) {
      return block;
    }
    // Replace single newlines with breaks within paragraphs
    block = block.replace(/\n/g, '<br/>');
    return `<p>${block}</p>`;
  }).filter(b => b).join('\n');

  // Clean up empty paragraphs and whitespace issues
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p><br\/><\/p>/g, '');

  return html || '<p></p>';
}

// Custom CSS for EPUB styling
const EPUB_CSS = `
body {
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.6;
  margin: 1em;
  color: #333;
}
h1, h2, h3 {
  font-family: "Helvetica Neue", Arial, sans-serif;
  color: #1a1a1a;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}
h1 { font-size: 1.5em; }
h2 { font-size: 1.3em; }
h3 { font-size: 1.1em; }
p {
  margin: 0.8em 0;
  text-align: justify;
}
.note {
  background: #f9f5e9;
  border-left: 3px solid #d4a656;
  padding: 0.5em 1em;
  margin: 1em 0;
  font-size: 0.9em;
  font-style: italic;
  color: #666;
}
.page-header {
  font-size: 0.8em;
  color: #888;
  border-bottom: 1px solid #ddd;
  padding-bottom: 0.5em;
  margin-bottom: 1em;
}
.colophon {
  margin-top: 2em;
  padding-top: 1em;
  border-top: 1px solid #ddd;
  font-size: 0.8em;
  color: #666;
}
`;

// Loeb Classical Library style CSS - facing pages layout
const LOEB_CSS = `
body {
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.6;
  margin: 0;
  padding: 1em;
  color: #333;
}
h1, h2, h3 {
  font-family: "Helvetica Neue", Arial, sans-serif;
  color: #1a1a1a;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}
h1 { font-size: 1.5em; }
h2 { font-size: 1.3em; }
h3 { font-size: 1.1em; }
p {
  margin: 0.5em 0;
  text-align: justify;
}
.note {
  background: #f9f5e9;
  border-left: 3px solid #d4a656;
  padding: 0.3em 0.8em;
  margin: 0.5em 0;
  font-size: 0.85em;
  font-style: italic;
  color: #666;
}
.page-header {
  font-size: 0.85em;
  color: #8b0000;
  text-align: center;
  border-bottom: 2px solid #8b0000;
  padding-bottom: 0.5em;
  margin-bottom: 1em;
  font-variant: small-caps;
  letter-spacing: 0.1em;
}
.colophon {
  margin-top: 2em;
  padding-top: 1em;
  border-top: 1px solid #ddd;
  font-size: 0.8em;
  color: #666;
}
.original-text {
  background: #fdfcf9;
  padding: 0.5em;
}
.translation-text {
  background: #ffffff;
  padding: 0.5em;
}
.loeb-intro {
  text-align: center;
  margin: 2em 0;
  padding: 1em;
  border: 1px solid #8b0000;
  background: #fdf6e3;
}
.loeb-intro h2 {
  color: #8b0000;
  font-variant: small-caps;
  letter-spacing: 0.1em;
}
`;

async function generateEpubDownload(
  book: Book,
  pages: Page[],
  format: 'epub-translation' | 'epub-ocr' | 'epub-both'
): Promise<Buffer> {
  const now = new Date().toISOString().split('T')[0];
  const bookTitle = book.display_title || book.title;

  // Build description
  let description = `A digitized and translated text from the Source Library collection.`;
  if (book.summary) {
    const summaryText = typeof book.summary === 'string' ? book.summary : book.summary.data;
    if (summaryText) {
      description = summaryText.substring(0, 500);
    }
  }

  // Determine content type label
  const contentLabel = format === 'epub-translation' ? 'English Translation' :
                       format === 'epub-ocr' ? `Original Text (${book.language})` :
                       'Complete (Translation + Original)';

  // Build chapters from pages
  const chapters: { title: string; content: string }[] = [];

  // Add front matter chapter
  const frontMatter = `
    <h1>${bookTitle}</h1>
    <p><strong>Author:</strong> ${book.author}</p>
    <p><strong>Original Language:</strong> ${book.language}</p>
    ${book.published ? `<p><strong>Published:</strong> ${book.published}</p>` : ''}
    <p><strong>Content:</strong> ${contentLabel}</p>
    <div class="colophon">
      <p><strong>Source:</strong> <a href="${BASE_URL}/book/${book.id}">${BASE_URL}/book/${book.id}</a></p>
      <p><strong>Downloaded:</strong> ${now}</p>
      <p><strong>License:</strong> CC BY 4.0 (Creative Commons Attribution)</p>
      <p>This text was digitized and translated with AI assistance and human review by the Source Library, a project of the Ancient Wisdom Trust.</p>
    </div>
  `;
  chapters.push({ title: 'Title Page', content: frontMatter });

  // Add page content
  for (const page of pages) {
    const hasTranslation = page.translation?.data;
    const hasOcr = page.ocr?.data;

    // Skip pages with no content for the requested format
    if (format === 'epub-translation' && !hasTranslation) continue;
    if (format === 'epub-ocr' && !hasOcr) continue;
    if (format === 'epub-both' && !hasTranslation && !hasOcr) continue;

    let content = `<div class="page-header">Page ${page.page_number}</div>`;

    if ((format === 'epub-translation' || format === 'epub-both') && hasTranslation) {
      if (format === 'epub-both') {
        content += '<h2>Translation</h2>';
      }
      content += markdownToHtml(page.translation.data);
    }

    if ((format === 'epub-ocr' || format === 'epub-both') && hasOcr) {
      if (format === 'epub-both') {
        content += `<h2>Original (${book.language})</h2>`;
      }
      content += markdownToHtml(page.ocr.data);
    }

    chapters.push({
      title: `Page ${page.page_number}`,
      content: content
    });
  }

  // Add colophon chapter at the end
  const colophon = `
    <h1>About This Edition</h1>
    <p>This digital edition was prepared by the <strong>Source Library</strong>, a project dedicated to digitizing and translating rare Hermetic, esoteric, and humanist texts for scholars, seekers, and AI systems.</p>
    <p><strong>Source:</strong> ${BASE_URL}/book/${book.id}</p>
    <p><strong>License:</strong> This translation is released under a Creative Commons Attribution 4.0 International License (CC BY 4.0). You are free to share and adapt this material for any purpose, provided you give appropriate credit.</p>
    <p>Source Library is a project of the Ancient Wisdom Trust. Preserving humanity's wisdom for the digital age.</p>
  `;
  chapters.push({ title: 'About This Edition', content: colophon });

  // Generate EPUB
  const epubBuffer = await epub({
    title: bookTitle,
    author: book.author,
    publisher: 'Source Library',
    description: description,
    lang: format === 'epub-ocr' ? book.language : 'en',
    tocTitle: 'Contents',
    css: EPUB_CSS,
    date: now,
  }, chapters);

  return epubBuffer;
}

// Fixed-layout EPUB page dimensions
const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 900;

// Generate fixed-layout EPUB with true facing pages (Loeb Classical Library style)
async function generateLoebEpubDownload(
  book: Book,
  pages: Page[]
): Promise<Buffer> {
  const now = new Date().toISOString().split('T')[0];
  const bookTitle = book.display_title || book.title;
  const bookId = `urn:uuid:${book.id}`;

  // Collect pages with both OCR and translation
  const validPages = pages.filter(p => p.translation?.data && p.ocr?.data);

  // Build the EPUB as a ZIP archive
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    // 1. mimetype (must be first, uncompressed)
    archive.append('application/epub+zip', { name: 'mimetype', store: true });

    // 2. META-INF/container.xml
    archive.append(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`, { name: 'META-INF/container.xml' });

    // 3. Build spine items and manifest entries
    const spineItems: string[] = [];
    const manifestItems: string[] = [];
    const navItems: string[] = [];

    // Title page
    manifestItems.push(`<item id="title" href="title.xhtml" media-type="application/xhtml+xml" properties="svg"/>`);
    spineItems.push(`<itemref idref="title" properties="page-spread-right"/>`);
    navItems.push(`<li><a href="title.xhtml">Title Page</a></li>`);

    // Content pages (pairs: original left, translation right)
    let pageIndex = 0;
    for (const page of validPages) {
      const origId = `page-${page.page_number}-orig`;
      const transId = `page-${page.page_number}-trans`;

      manifestItems.push(`<item id="${origId}" href="${origId}.xhtml" media-type="application/xhtml+xml"/>`);
      manifestItems.push(`<item id="${transId}" href="${transId}.xhtml" media-type="application/xhtml+xml"/>`);

      // Left page (original) - even pages are verso (left)
      spineItems.push(`<itemref idref="${origId}" properties="page-spread-left"/>`);
      // Right page (translation) - odd pages are recto (right)
      spineItems.push(`<itemref idref="${transId}" properties="page-spread-right"/>`);

      navItems.push(`<li><a href="${origId}.xhtml">Page ${page.page_number}</a></li>`);
      pageIndex++;
    }

    // Colophon
    manifestItems.push(`<item id="colophon" href="colophon.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="colophon" properties="page-spread-right"/>`);
    navItems.push(`<li><a href="colophon.xhtml">About This Edition</a></li>`);

    // Add nav and CSS to manifest
    manifestItems.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
    manifestItems.push(`<item id="css" href="styles.css" media-type="text/css"/>`);

    // 4. OEBPS/content.opf (package document with fixed-layout metadata)
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${escapeXml(bookTitle)} (Parallel Text)</dc:title>
    <dc:creator>${escapeXml(book.author)}</dc:creator>
    <dc:publisher>Source Library</dc:publisher>
    <dc:language>en</dc:language>
    <dc:date>${now}</dc:date>
    <dc:rights>CC BY 4.0</dc:rights>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
    <!-- Fixed-layout metadata -->
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">both</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
    archive.append(opf, { name: 'OEBPS/content.opf' });

    // 5. OEBPS/nav.xhtml (navigation document)
    const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <title>Contents</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      ${navItems.join('\n      ')}
    </ol>
  </nav>
</body>
</html>`;
    archive.append(nav, { name: 'OEBPS/nav.xhtml' });

    // 6. OEBPS/styles.css (fixed-layout styles with auto-scaling text)
    const css = `
@page {
  margin: 0;
}
html, body {
  margin: 0;
  padding: 0;
  width: ${PAGE_WIDTH}px;
  height: ${PAGE_HEIGHT}px;
  overflow: hidden;
}
body {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 11px;
  line-height: 1.4;
  padding: 20px;
  box-sizing: border-box;
  background: #fffef9;
}
.page-left {
  background: #f8f6f0;
  border-right: 1px solid #d4c4a8;
}
.page-right {
  background: #fffef9;
  border-left: 1px solid #d4c4a8;
}
.page-header {
  font-size: 9px;
  color: #8b0000;
  text-align: center;
  font-variant: small-caps;
  letter-spacing: 0.1em;
  border-bottom: 1px solid #8b0000;
  padding-bottom: 5px;
  margin-bottom: 10px;
}
.content {
  height: calc(${PAGE_HEIGHT}px - 70px);
  overflow: hidden;
  font-size: 10px;
  line-height: 1.35;
}
/* Auto-scale text for long content */
.content.small-text {
  font-size: 9px;
  line-height: 1.3;
}
.content.tiny-text {
  font-size: 8px;
  line-height: 1.25;
}
h1 {
  font-size: 20px;
  color: #1a1a1a;
  text-align: center;
  margin-top: 60px;
}
h2 {
  font-size: 14px;
  color: #8b0000;
  text-align: center;
  font-variant: small-caps;
}
h3 {
  font-size: 12px;
  color: #333;
  margin: 0.5em 0;
}
p {
  margin: 0.5em 0;
  text-align: justify;
  text-indent: 1em;
}
p:first-of-type {
  text-indent: 0;
}
.note {
  font-size: 9px;
  font-style: italic;
  color: #666;
  background: #f5f0e0;
  padding: 5px;
  margin: 8px 0;
  border-left: 2px solid #8b0000;
}
.title-page {
  text-align: center;
  padding-top: 80px;
}
.title-page h1 {
  margin-top: 0;
  font-size: 22px;
}
.colophon {
  font-size: 10px;
  margin-top: 30px;
  padding-top: 15px;
  border-top: 1px solid #ccc;
  color: #666;
}
.loeb-intro {
  margin: 30px 15px;
  padding: 12px;
  border: 1px solid #8b0000;
  background: #fdf6e3;
  text-align: center;
}
/* Image page styles */
.image-page {
  padding: 10px;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.image-page .page-header {
  flex-shrink: 0;
}
.image-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.image-container img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
`;
    archive.append(css, { name: 'OEBPS/styles.css' });

    // 7. Title page
    const titlePage = createFixedPage(`
      <div class="title-page">
        <h1>${escapeXml(bookTitle)}</h1>
        <p style="text-indent:0;text-align:center;margin-top:20px;"><strong>${escapeXml(book.author)}</strong></p>
        ${book.published ? `<p style="text-indent:0;text-align:center;">${escapeXml(book.published)}</p>` : ''}
        <div class="loeb-intro">
          <h2>Parallel Text Edition</h2>
          <p style="text-indent:0;text-align:center;">Original ${escapeXml(book.language)} with English translation</p>
        </div>
        <div class="colophon">
          <p style="text-indent:0;text-align:center;">Source Library · ${now}</p>
          <p style="text-indent:0;text-align:center;">CC BY 4.0</p>
        </div>
      </div>
    `, 'Title Page', 'page-right');
    archive.append(titlePage, { name: 'OEBPS/title.xhtml' });

    // 8. Content pages
    for (const page of validPages) {
      const ocrHtml = markdownToHtml(page.ocr.data);
      const translationHtml = markdownToHtml(page.translation.data);

      // Determine text size class based on content length
      const ocrSizeClass = getTextSizeClass(page.ocr.data);
      const transSizeClass = getTextSizeClass(page.translation.data);

      // Original (left page)
      const origPage = createFixedPage(`
        <div class="page-header">${escapeXml(book.language)} · ${page.page_number}</div>
        <div class="content ${ocrSizeClass}">${ocrHtml}</div>
      `, `Page ${page.page_number} - ${book.language}`, 'page-left');
      archive.append(origPage, { name: `OEBPS/page-${page.page_number}-orig.xhtml` });

      // Translation (right page)
      const transPage = createFixedPage(`
        <div class="page-header">English · ${page.page_number}</div>
        <div class="content ${transSizeClass}">${translationHtml}</div>
      `, `Page ${page.page_number} - English`, 'page-right');
      archive.append(transPage, { name: `OEBPS/page-${page.page_number}-trans.xhtml` });
    }

    // 9. Colophon
    const colophonPage = createFixedPage(`
      <h1>About This Edition</h1>
      <p>This parallel text edition was prepared by the <strong>Source Library</strong> in the tradition of the Loeb Classical Library.</p>
      <p>The Source Library digitizes and translates rare Hermetic, esoteric, and humanist texts for scholars, seekers, and AI systems.</p>
      <div class="colophon">
        <p><strong>Source:</strong> ${BASE_URL}/book/${book.id}</p>
        <p><strong>License:</strong> CC BY 4.0 (Creative Commons Attribution)</p>
        <p>Source Library is a project of the Ancient Wisdom Trust.</p>
      </div>
    `, 'About This Edition', 'page-right');
    archive.append(colophonPage, { name: 'OEBPS/colophon.xhtml' });

    archive.finalize();
  });
}

// Helper to create a fixed-layout XHTML page
function createFixedPage(content: string, title: string, pageClass: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${PAGE_WIDTH}, height=${PAGE_HEIGHT}"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body class="${pageClass}">
  ${content}
</body>
</html>`;
}

// Helper to escape XML special characters
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Helper to determine text size class based on content length
function getTextSizeClass(text: string): string {
  const length = text.length;
  if (length > 3000) return 'tiny-text';
  if (length > 2000) return 'small-text';
  return '';
}

// Image dimensions for fixed-layout EPUB
const IMAGE_WIDTH = 600;
const IMAGE_HEIGHT = 900;

// Fetch and process image for EPUB embedding
// Uses minimal processing: grayscale + normalize (auto contrast)
async function fetchAndCompressImage(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(60000) // 60 second timeout
    });
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Process with sharp: resize, grayscale, normalize, compress
    const processed = await sharp(buffer)
      .resize(IMAGE_WIDTH, IMAGE_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .grayscale()
      .normalize()  // Auto contrast stretch
      .jpeg({
        quality: 75,
        mozjpeg: true
      })
      .toBuffer();

    console.log(`Image processed: ${url.slice(-30)} -> ${(processed.length / 1024).toFixed(1)}KB`);
    return processed;
  } catch (error) {
    console.error(`Failed to fetch/process image: ${url}`, error);
    return null;
  }
}

// Generate facsimile EPUB: original page image on left, translation on right
async function generateFacsimileEpubDownload(
  book: Book,
  pages: Page[]
): Promise<Buffer> {
  const now = new Date().toISOString().split('T')[0];
  const bookTitle = book.display_title || book.title;
  const bookId = `urn:uuid:${book.id}`;

  // Collect pages with photo and translation
  const validPages = pages.filter(p => p.translation?.data && (p.photo || p.compressed_photo));

  return new Promise(async (resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    // 1. mimetype
    archive.append('application/epub+zip', { name: 'mimetype', store: true });

    // 2. META-INF/container.xml
    archive.append(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`, { name: 'META-INF/container.xml' });

    // Build manifest and spine
    const spineItems: string[] = [];
    const manifestItems: string[] = [];
    const navItems: string[] = [];

    // Title page
    manifestItems.push(`<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="title" properties="page-spread-right"/>`);
    navItems.push(`<li><a href="title.xhtml">Title Page</a></li>`);

    // Content pages with images
    for (const page of validPages) {
      const imgId = `img-${page.page_number}`;
      const pageId = `page-${page.page_number}-img`;
      const transId = `page-${page.page_number}-trans`;

      // Image asset
      manifestItems.push(`<item id="${imgId}" href="images/${imgId}.jpg" media-type="image/jpeg"/>`);
      // Image page
      manifestItems.push(`<item id="${pageId}" href="${pageId}.xhtml" media-type="application/xhtml+xml"/>`);
      // Translation page
      manifestItems.push(`<item id="${transId}" href="${transId}.xhtml" media-type="application/xhtml+xml"/>`);

      spineItems.push(`<itemref idref="${pageId}" properties="page-spread-left"/>`);
      spineItems.push(`<itemref idref="${transId}" properties="page-spread-right"/>`);
      navItems.push(`<li><a href="${pageId}.xhtml">Page ${page.page_number}</a></li>`);
    }

    // Colophon
    manifestItems.push(`<item id="colophon" href="colophon.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="colophon" properties="page-spread-right"/>`);
    navItems.push(`<li><a href="colophon.xhtml">About This Edition</a></li>`);

    manifestItems.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
    manifestItems.push(`<item id="css" href="styles.css" media-type="text/css"/>`);

    // OPF
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${escapeXml(bookTitle)} (Facsimile Edition)</dc:title>
    <dc:creator>${escapeXml(book.author)}</dc:creator>
    <dc:publisher>Source Library</dc:publisher>
    <dc:language>en</dc:language>
    <dc:date>${now}</dc:date>
    <dc:rights>CC BY 4.0</dc:rights>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">both</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
    archive.append(opf, { name: 'OEBPS/content.opf' });

    // Navigation
    const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <title>Contents</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      ${navItems.join('\n      ')}
    </ol>
  </nav>
</body>
</html>`;
    archive.append(nav, { name: 'OEBPS/nav.xhtml' });

    // CSS (same as Loeb but with image styles)
    const css = `
@page { margin: 0; }
html, body {
  margin: 0; padding: 0;
  width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px;
  overflow: hidden;
}
body {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 11px; line-height: 1.4;
  padding: 20px; box-sizing: border-box;
  background: #fffef9;
}
.page-left { background: #f8f6f0; }
.page-right { background: #fffef9; }
.page-header {
  font-size: 9px; color: #8b0000;
  text-align: center; font-variant: small-caps;
  letter-spacing: 0.1em;
  border-bottom: 1px solid #8b0000;
  padding-bottom: 5px; margin-bottom: 10px;
}
.content {
  height: calc(${PAGE_HEIGHT}px - 70px);
  overflow: hidden;
  font-size: 10px; line-height: 1.35;
}
.content.small-text { font-size: 9px; line-height: 1.3; }
.content.tiny-text { font-size: 8px; line-height: 1.25; }
.image-page { padding: 5px; }
.image-page .page-header { margin-bottom: 5px; }
.image-container {
  height: calc(${PAGE_HEIGHT}px - 50px);
  display: flex; align-items: center; justify-content: center;
}
.image-container img {
  max-width: 100%; max-height: 100%;
  object-fit: contain;
  border: 1px solid #ddd;
}
h1 { font-size: 20px; text-align: center; margin-top: 60px; }
h2 { font-size: 14px; color: #8b0000; text-align: center; font-variant: small-caps; }
p { margin: 0.5em 0; text-align: justify; text-indent: 1em; }
p:first-of-type { text-indent: 0; }
.note { font-size: 9px; font-style: italic; color: #666; background: #f5f0e0; padding: 5px; margin: 8px 0; border-left: 2px solid #8b0000; }
.title-page { text-align: center; padding-top: 80px; }
.title-page h1 { margin-top: 0; font-size: 22px; }
.colophon { font-size: 10px; margin-top: 30px; padding-top: 15px; border-top: 1px solid #ccc; color: #666; }
.loeb-intro { margin: 30px 15px; padding: 12px; border: 1px solid #8b0000; background: #fdf6e3; text-align: center; }
`;
    archive.append(css, { name: 'OEBPS/styles.css' });

    // Title page
    const titlePage = createFixedPage(`
      <div class="title-page">
        <h1>${escapeXml(bookTitle)}</h1>
        <p style="text-indent:0;text-align:center;margin-top:20px;"><strong>${escapeXml(book.author)}</strong></p>
        ${book.published ? `<p style="text-indent:0;text-align:center;">${escapeXml(book.published)}</p>` : ''}
        <div class="loeb-intro">
          <h2>Facsimile Edition</h2>
          <p style="text-indent:0;text-align:center;">Original page images with English translation</p>
        </div>
        <div class="colophon">
          <p style="text-indent:0;text-align:center;">Source Library · ${now}</p>
        </div>
      </div>
    `, 'Title Page', 'page-right');
    archive.append(titlePage, { name: 'OEBPS/title.xhtml' });

    // Fetch and compress all images first (async)
    console.log(`Fetching ${validPages.length} images for facsimile EPUB...`);
    const imagePromises = validPages.map(async (page) => {
      const imageUrl = page.compressed_photo || page.photo;
      const imageBuffer = await fetchAndCompressImage(imageUrl);
      return { page, imageBuffer };
    });
    const pageImages = await Promise.all(imagePromises);

    // Add images and content pages
    for (const { page, imageBuffer } of pageImages) {
      const translationHtml = markdownToHtml(page.translation.data);
      const transSizeClass = getTextSizeClass(page.translation.data);

      // Add compressed image to archive (if successfully fetched)
      if (imageBuffer) {
        archive.append(imageBuffer, { name: `OEBPS/images/img-${page.page_number}.jpg` });

        // Image page (left) - reference local embedded image
        const imgPage = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${PAGE_WIDTH}, height=${PAGE_HEIGHT}"/>
  <title>Page ${page.page_number}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body class="page-left image-page">
  <div class="page-header">Original · ${page.page_number}</div>
  <div class="image-container">
    <img src="images/img-${page.page_number}.jpg" alt="Page ${page.page_number}"/>
  </div>
</body>
</html>`;
        archive.append(imgPage, { name: `OEBPS/page-${page.page_number}-img.xhtml` });
      } else {
        // Fallback if image failed - show placeholder
        const imgPage = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${PAGE_WIDTH}, height=${PAGE_HEIGHT}"/>
  <title>Page ${page.page_number}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body class="page-left image-page">
  <div class="page-header">Original · ${page.page_number}</div>
  <div class="image-container">
    <p style="color:#999;text-align:center;">[Image unavailable]</p>
  </div>
</body>
</html>`;
        archive.append(imgPage, { name: `OEBPS/page-${page.page_number}-img.xhtml` });
      }

      // Translation page (right)
      const transPage = createFixedPage(`
        <div class="page-header">English · ${page.page_number}</div>
        <div class="content ${transSizeClass}">${translationHtml}</div>
      `, `Page ${page.page_number} - English`, 'page-right');
      archive.append(transPage, { name: `OEBPS/page-${page.page_number}-trans.xhtml` });
    }

    // Colophon
    const colophonPage = createFixedPage(`
      <h1>About This Edition</h1>
      <p>This facsimile edition presents original manuscript pages alongside translations.</p>
      <div class="colophon">
        <p><strong>Source:</strong> ${BASE_URL}/book/${book.id}</p>
        <p><strong>License:</strong> CC BY 4.0</p>
        <p>Source Library · Ancient Wisdom Trust</p>
      </div>
    `, 'About This Edition', 'page-right');
    archive.append(colophonPage, { name: 'OEBPS/colophon.xhtml' });

    archive.finalize();
  });
}

// Generate ZIP of all page images
async function generateImagesZip(
  book: Book,
  pages: Page[]
): Promise<Buffer> {
  const validPages = pages.filter(p => p.photo || p.compressed_photo);

  return new Promise(async (resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    // Fetch and add each image
    console.log(`Fetching ${validPages.length} images for ZIP...`);
    for (const page of validPages) {
      const imageUrl = page.compressed_photo || page.photo;
      const imageBuffer = await fetchAndCompressImage(imageUrl);
      if (imageBuffer) {
        const paddedNum = String(page.page_number).padStart(4, '0');
        archive.append(imageBuffer, { name: `page-${paddedNum}.jpg` });
      }
    }

    archive.finalize();
  });
}

// Generate images-only EPUB (no translation, just the processed page images)
async function generateImagesOnlyEpubDownload(
  book: Book,
  pages: Page[]
): Promise<Buffer> {
  const now = new Date().toISOString().split('T')[0];
  const bookTitle = book.display_title || book.title;
  const bookId = `urn:uuid:${book.id}`;

  const validPages = pages.filter(p => p.photo || p.compressed_photo);

  return new Promise(async (resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    // mimetype
    archive.append('application/epub+zip', { name: 'mimetype', store: true });

    // container.xml
    archive.append(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`, { name: 'META-INF/container.xml' });

    const spineItems: string[] = [];
    const manifestItems: string[] = [];
    const navItems: string[] = [];

    // Title page
    manifestItems.push(`<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="title"/>`);
    navItems.push(`<li><a href="title.xhtml">Title Page</a></li>`);

    // Image pages
    for (const page of validPages) {
      const imgId = `img-${page.page_number}`;
      const pageId = `page-${page.page_number}`;
      manifestItems.push(`<item id="${imgId}" href="images/${imgId}.jpg" media-type="image/jpeg"/>`);
      manifestItems.push(`<item id="${pageId}" href="${pageId}.xhtml" media-type="application/xhtml+xml"/>`);
      spineItems.push(`<itemref idref="${pageId}"/>`);
      navItems.push(`<li><a href="${pageId}.xhtml">Page ${page.page_number}</a></li>`);
    }

    manifestItems.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
    manifestItems.push(`<item id="css" href="styles.css" media-type="text/css"/>`);

    // OPF
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${escapeXml(bookTitle)}</dc:title>
    <dc:creator>${escapeXml(book.author)}</dc:creator>
    <dc:publisher>Source Library</dc:publisher>
    <dc:language>${book.language || 'en'}</dc:language>
    <dc:date>${now}</dc:date>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:spread">auto</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
    archive.append(opf, { name: 'OEBPS/content.opf' });

    // Nav
    const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>${navItems.join('\n')}</ol>
  </nav>
</body>
</html>`;
    archive.append(nav, { name: 'OEBPS/nav.xhtml' });

    // CSS
    const css = `
@page { margin: 0; }
html, body { margin: 0; padding: 0; width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px; }
body { background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
.page-container { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.page-container img { max-width: 100%; max-height: 100%; object-fit: contain; }
.title-page { text-align: center; color: #fff; padding: 40px; }
.title-page h1 { font-size: 24px; margin-bottom: 20px; }
`;
    archive.append(css, { name: 'OEBPS/styles.css' });

    // Title page
    const titlePage = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${PAGE_WIDTH}, height=${PAGE_HEIGHT}"/>
  <title>Title</title>
  <link rel="stylesheet" href="styles.css"/>
</head>
<body>
  <div class="title-page">
    <h1>${escapeXml(bookTitle)}</h1>
    <p>${escapeXml(book.author)}</p>
    ${book.published ? `<p>${escapeXml(book.published)}</p>` : ''}
    <p style="margin-top:40px;font-size:12px;color:#888;">Source Library · ${now}</p>
  </div>
</body>
</html>`;
    archive.append(titlePage, { name: 'OEBPS/title.xhtml' });

    // Fetch images and create pages
    console.log(`Fetching ${validPages.length} images for images-only EPUB...`);
    for (const page of validPages) {
      const imageUrl = page.compressed_photo || page.photo;
      const imageBuffer = await fetchAndCompressImage(imageUrl);

      if (imageBuffer) {
        archive.append(imageBuffer, { name: `OEBPS/images/img-${page.page_number}.jpg` });
      }

      const imgPage = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${PAGE_WIDTH}, height=${PAGE_HEIGHT}"/>
  <title>Page ${page.page_number}</title>
  <link rel="stylesheet" href="styles.css"/>
</head>
<body>
  <div class="page-container">
    ${imageBuffer ? `<img src="images/img-${page.page_number}.jpg" alt="Page ${page.page_number}"/>` : '<p style="color:#666;">Image unavailable</p>'}
  </div>
</body>
</html>`;
      archive.append(imgPage, { name: `OEBPS/page-${page.page_number}.xhtml` });
    }

    archive.finalize();
  });
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'translation';

    // Valid formats: TXT, EPUB, and ZIP
    const validFormats = ['translation', 'ocr', 'both', 'epub-translation', 'epub-ocr', 'epub-both', 'epub-parallel', 'epub-facsimile', 'epub-images', 'images-zip'];
    if (!validFormats.includes(format)) {
      return NextResponse.json(
        { error: 'Invalid format' },
        { status: 400 }
      );
    }

    const isEpub = format.startsWith('epub-');
    const isLoeb = format === 'epub-parallel';
    const isFacsimile = format === 'epub-facsimile';
    const isImagesOnly = format === 'epub-images';
    const isImagesZip = format === 'images-zip';

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get all pages sorted by page number
    const pages = await db.collection('pages')
      .find({ book_id: id })
      .sort({ page_number: 1 })
      .toArray();

    // Create safe filename base
    const safeTitle = (book.display_title || book.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);

    // Handle images ZIP download
    if (isImagesZip) {
      const zipBuffer = await generateImagesZip(
        book as unknown as Book,
        pages as unknown as Page[]
      );
      return new Response(new Uint8Array(zipBuffer), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${safeTitle}-images.zip"`,
          'Cache-Control': 'no-cache',
        },
      });
    }

    if (isEpub) {
      let epubBuffer: Buffer;
      let filename: string;

      if (isImagesOnly) {
        // Generate images-only EPUB (no translation text)
        epubBuffer = await generateImagesOnlyEpubDownload(
          book as unknown as Book,
          pages as unknown as Page[]
        );
        filename = `${safeTitle}-images.epub`;
      } else if (isFacsimile) {
        // Generate facsimile EPUB (page images + translation)
        epubBuffer = await generateFacsimileEpubDownload(
          book as unknown as Book,
          pages as unknown as Page[]
        );
        filename = `${safeTitle}-facsimile.epub`;
      } else if (isLoeb) {
        // Generate Loeb-style parallel text EPUB
        epubBuffer = await generateLoebEpubDownload(
          book as unknown as Book,
          pages as unknown as Page[]
        );
        filename = `${safeTitle}-parallel.epub`;
      } else {
        // Generate standard EPUB
        epubBuffer = await generateEpubDownload(
          book as unknown as Book,
          pages as unknown as Page[],
          format as 'epub-translation' | 'epub-ocr' | 'epub-both'
        );
        const formatSuffix = format.replace('epub-', '');
        filename = `${safeTitle}-${formatSuffix}.epub`;
      }

      return new Response(new Uint8Array(epubBuffer), {
        headers: {
          'Content-Type': 'application/epub+zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-cache',
        },
      });
    } else {
      // Generate TXT
      const content = generateTxtDownload(
        book as unknown as Book,
        pages as unknown as Page[],
        format as 'translation' | 'ocr' | 'both'
      );

      const filename = `${safeTitle}-${format}.txt`;

      return new Response(content, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-cache',
        },
      });
    }
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json(
      { error: 'Download failed' },
      { status: 500 }
    );
  }
}
