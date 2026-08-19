import epub from 'epub-gen-memory';
import { resolveImprintPlace } from '@/lib/imprint';
import type { Book, Chapter } from '@/lib/types';
import type { Page } from '@/lib/types';

const BASE_URL = 'https://sourcelibrary.org';

export interface KdpEpubOptions {
  aiDisclosure?: string;
  introduction?: string;
  methodology?: string;
}

interface IndexEntry {
  term: string;
  definition?: string;
  pages?: number[];
}

// Book.index includes these at runtime but the TS type only declares bookSummary/sectionSummaries
interface BookIndexData {
  people?: IndexEntry[];
  places?: IndexEntry[];
  concepts?: IndexEntry[];
  keywords?: IndexEntry[];
  vocabulary?: IndexEntry[];
  bookSummary?: { brief?: string; abstract?: string; detailed?: string };
}

/**
 * Strip XML/annotation tags from translation text, leaving clean prose.
 */
function stripXmlTags(text: string): string {
  // Remove metadata-only tags entirely (content is not human-readable)
  let clean = text.replace(
    /<(?:page-type|columns|detected-images|lang|language|page-num|folio|sig|header|meta|warning|abbrev|vocab|summary|keywords)>[\s\S]*?<\/(?:page-type|columns|detected-images|lang|language|page-num|folio|sig|header|meta|warning|abbrev|vocab|summary|keywords)>/gi,
    ''
  );
  // Remove self-closing tags like <column-break/>
  clean = clean.replace(/<column-break\s*\/?>/gi, '\n\n');
  // Remove any remaining XML tags but keep their content
  clean = clean.replace(/<\/?[a-z][a-z0-9-]*\s*\/?>/gi, '');
  return clean.trim();
}

/**
 * Escape XML entities for safe EPUB XHTML content.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert translation text to HTML paragraphs.
 * Strips XML tags, escapes entities, wraps in <p> tags.
 */
function translationToHtml(text: string): string {
  const clean = stripXmlTags(text);
  if (!clean) return '';

  // Split on double newlines for paragraphs
  const blocks = clean.split(/\n\n+/);

  return blocks
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      // Check for markdown headers
      const h1 = trimmed.match(/^# (.+)$/m);
      if (h1) return `<h2>${escapeXml(h1[1])}</h2>`;
      const h2 = trimmed.match(/^## (.+)$/m);
      if (h2) return `<h3>${escapeXml(h2[1])}</h3>`;
      const h3 = trimmed.match(/^### (.+)$/m);
      if (h3) return `<h4>${escapeXml(h3[1])}</h4>`;

      // Convert bold/italic before escaping
      let html = escapeXml(trimmed);
      // Re-apply markdown formatting after escaping
      html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
      html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
      // Single newlines become <br/>
      html = html.replace(/\n/g, '<br/>');
      return `<p>${html}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Group pages into chapters using book.chapters or auto-generated sections.
 */
function buildChapterGroups(
  pages: Page[],
  chapters?: Chapter[]
): Array<{ title: string; pages: Page[] }> {
  const translatedPages = pages
    .filter(p => p.translation?.data)
    .sort((a, b) => a.page_number - b.page_number);

  if (!translatedPages.length) return [];

  // Use book chapters if available
  if (chapters?.length) {
    // Sort chapters by page number
    const sortedChapters = [...chapters].sort((a, b) => a.pageNumber - b.pageNumber);
    const groups: Array<{ title: string; pages: Page[] }> = [];

    for (let i = 0; i < sortedChapters.length; i++) {
      const ch = sortedChapters[i];
      const nextCh = sortedChapters[i + 1];
      const startPage = ch.pageNumber;
      const endPage = nextCh ? nextCh.pageNumber - 1 : Infinity;

      const chapterPages = translatedPages.filter(
        p => p.page_number >= startPage && p.page_number <= endPage
      );

      if (chapterPages.length > 0) {
        const title = ch.titleEn || ch.title;
        groups.push({ title, pages: chapterPages });
      }
    }

    // Any pages before the first chapter
    if (sortedChapters.length > 0) {
      const firstChapterPage = sortedChapters[0].pageNumber;
      const prefacePages = translatedPages.filter(p => p.page_number < firstChapterPage);
      if (prefacePages.length > 0) {
        groups.unshift({ title: 'Preliminary Matter', pages: prefacePages });
      }
    }

    return groups;
  }

  // No chapters — divide into ~20-page sections
  const SECTION_SIZE = 20;
  const groups: Array<{ title: string; pages: Page[] }> = [];
  const romanNumerals = [
    'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
    'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
    'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV', 'XXVI', 'XXVII', 'XXVIII', 'XXIX', 'XXX',
  ];

  for (let i = 0; i < translatedPages.length; i += SECTION_SIZE) {
    const sectionPages = translatedPages.slice(i, i + SECTION_SIZE);
    const sectionIndex = Math.floor(i / SECTION_SIZE);
    const numeral = romanNumerals[sectionIndex] || `${sectionIndex + 1}`;
    groups.push({ title: `Section ${numeral}`, pages: sectionPages });
  }

  return groups;
}

/**
 * Build index HTML from book.index data.
 */
function buildIndexHtml(index: BookIndexData): string {
  const sections: string[] = [];

  const renderEntries = (title: string, entries?: IndexEntry[]) => {
    if (!entries?.length) return;
    const items = entries
      .sort((a, b) => a.term.localeCompare(b.term))
      .map(e => {
        const def = e.definition ? ` &mdash; ${escapeXml(e.definition)}` : '';
        return `<li><strong>${escapeXml(e.term)}</strong>${def}</li>`;
      })
      .join('\n');
    sections.push(`<h2>${title}</h2>\n<ul>\n${items}\n</ul>`);
  };

  renderEntries('People', index.people);
  renderEntries('Places', index.places);
  renderEntries('Concepts', index.concepts);
  renderEntries('Key Terms', index.keywords);

  return sections.join('\n');
}

const KDP_CSS = `
body {
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.6;
  margin: 1em;
  color: #1a1a1a;
}
h1, h2, h3, h4 {
  font-family: "Helvetica Neue", Arial, sans-serif;
  color: #1a1a1a;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}
h1 { font-size: 1.6em; text-align: center; margin-top: 2em; }
h2 { font-size: 1.3em; }
h3 { font-size: 1.1em; }
h4 { font-size: 1em; font-style: italic; }
p {
  margin: 0.8em 0;
  text-align: justify;
  text-indent: 1.5em;
}
p:first-child, h1 + p, h2 + p, h3 + p, h4 + p {
  text-indent: 0;
}
blockquote {
  margin: 1em 2em;
  font-style: italic;
  color: #444;
}
ul {
  margin: 0.5em 0;
  padding-left: 1.5em;
}
li {
  margin: 0.3em 0;
}
.title-page {
  text-align: center;
  padding-top: 4em;
}
.title-page h1 {
  font-size: 2em;
  margin-bottom: 0.3em;
}
.title-page .author {
  font-size: 1.3em;
  font-style: italic;
  margin: 0.5em 0;
}
.title-page .year {
  font-size: 1.1em;
  color: #666;
  margin: 0.3em 0;
}
.title-page .translator {
  font-size: 1em;
  margin-top: 2em;
  color: #444;
}
.disclosure {
  border-top: 1px solid #ccc;
  padding-top: 1em;
  margin-top: 2em;
  font-size: 0.9em;
  color: #444;
}
.colophon-section {
  margin-top: 1em;
  padding-top: 0.5em;
}
.colophon-section p {
  text-indent: 0;
  margin: 0.3em 0;
}
.colophon-label {
  font-weight: bold;
  color: #333;
}
.folio-marker {
  display: block;
  font-size: 0.75em;
  color: #888;
  margin-top: 1.5em;
  margin-bottom: 0.3em;
  font-family: "Helvetica Neue", Arial, sans-serif;
  letter-spacing: 0.05em;
}
`;

/**
 * Generate a KDP-ready reflowable EPUB with translation text only.
 *
 * Structure:
 * 1. Title page
 * 2. About this translation (AI disclosure)
 * 3. Introduction (from reading_summary if available)
 * 4. Translation chapters
 * 5. Index (people, places, concepts — if available)
 * 6. Colophon (provenance and credits)
 */
export async function generateKdpEpub(
  book: Book,
  pages: Page[],
  options?: KdpEpubOptions
): Promise<Buffer> {
  const bookTitle = book.display_title || book.title;
  const bookSlug = book.slug || book.id;
  const bookUrl = `${BASE_URL}/book/${bookSlug}`;
  const now = new Date().toISOString().split('T')[0];

  const epubChapters: Array<{ title: string; content: string }> = [];

  // 1. Title page
  const titlePageHtml = `
    <div class="title-page">
      <h1>${escapeXml(bookTitle)}</h1>
      ${book.title !== bookTitle ? `<p><em>${escapeXml(book.title)}</em></p>` : ''}
      <p class="author">${escapeXml(book.author)}</p>
      ${book.published ? `<p class="year">${escapeXml(book.published)}</p>` : ''}
      <p class="translator">Translated by Source Library</p>
    </div>
  `;
  epubChapters.push({ title: 'Title Page', content: titlePageHtml });

  // 2. About this translation
  const defaultDisclosure =
    'This translation was produced using artificial intelligence by Source Library ' +
    '(sourcelibrary.org), a project dedicated to digitizing and translating rare Hermetic, ' +
    'esoteric, and humanist texts. AI translation captures the meaning and structure of the ' +
    'original text but may not reflect every nuance a specialist human translator would convey. ' +
    'Readers are encouraged to consult the original language text, available at the Source Library ' +
    'website alongside high-resolution scans of the original pages.';

  const disclosure = options?.aiDisclosure || defaultDisclosure;

  let aboutHtml = `<h1>About This Translation</h1>`;
  aboutHtml += `<p>${escapeXml(disclosure)}</p>`;

  if (options?.methodology) {
    aboutHtml += `<h2>Methodology</h2>`;
    aboutHtml += `<p>${escapeXml(options.methodology)}</p>`;
  }

  aboutHtml += `<p>The full text with original scans, OCR transcription, and interactive features ` +
    `is available at: ${escapeXml(bookUrl)}</p>`;

  epubChapters.push({ title: 'About This Translation', content: aboutHtml });

  // 3. Introduction
  const introText = options?.introduction || book.reading_summary?.overview;
  if (introText) {
    const introHtml = `<h1>Introduction</h1>\n${translationToHtml(introText)}`;
    epubChapters.push({ title: 'Introduction', content: introHtml });
  }

  // 4. Translation chapters
  const chapterGroups = buildChapterGroups(pages, book.chapters);

  for (const group of chapterGroups) {
    let chapterHtml = `<h1>${escapeXml(group.title)}</h1>\n`;
    for (const page of group.pages) {
      if (page.translation?.data) {
        // Insert folio marker so scholars can cite specific pages
        chapterHtml += `<span class="folio-marker" id="p-${page.page_number}">[p.&nbsp;${page.page_number}]</span>\n`;
        chapterHtml += translationToHtml(page.translation.data) + '\n';
      }
    }
    epubChapters.push({ title: group.title, content: chapterHtml });
  }

  // 5. Index
  const indexData = book.index as unknown as BookIndexData | undefined;
  if (indexData) {
    const indexHtml = buildIndexHtml(indexData);
    if (indexHtml) {
      epubChapters.push({
        title: 'Index',
        content: `<h1>Index</h1>\n${indexHtml}`,
      });
    }
  }

  // 6. Colophon
  const translatedCount = pages.filter(p => p.translation?.data).length;
  const totalCount = pages.length;

  let colophonHtml = `<h1>Colophon</h1>`;

  colophonHtml += `<div class="colophon-section">`;
  colophonHtml += `<p><span class="colophon-label">Title:</span> ${escapeXml(bookTitle)}</p>`;
  if (book.title !== bookTitle) {
    colophonHtml += `<p><span class="colophon-label">Original Title:</span> ${escapeXml(book.title)}</p>`;
  }
  colophonHtml += `<p><span class="colophon-label">Author:</span> ${escapeXml(book.author)}</p>`;
  colophonHtml += `<p><span class="colophon-label">Original Language:</span> ${escapeXml(book.language)}</p>`;
  if (book.published) {
    colophonHtml += `<p><span class="colophon-label">Published:</span> ${escapeXml(book.published)}</p>`;
  }
  const imprintPlace = resolveImprintPlace(book)?.display; // family resolver, #4043
  if (imprintPlace) {
    colophonHtml += `<p><span class="colophon-label">Place:</span> ${escapeXml(imprintPlace)}</p>`;
  }
  if (book.publisher) {
    colophonHtml += `<p><span class="colophon-label">Printer/Publisher:</span> ${escapeXml(book.publisher)}</p>`;
  }
  colophonHtml += `</div>`;

  // Source information
  colophonHtml += `<div class="colophon-section">`;
  colophonHtml += `<h2>Source</h2>`;
  const provider = book.image_source?.provider_name || book.image_source?.provider;
  if (provider) {
    colophonHtml += `<p><span class="colophon-label">Digital Scans:</span> ${escapeXml(provider)}</p>`;
  }
  if (book.image_source?.source_url) {
    colophonHtml += `<p><span class="colophon-label">Original:</span> ${escapeXml(book.image_source.source_url)}</p>`;
  }
  if (book.ia_identifier) {
    colophonHtml += `<p><span class="colophon-label">Internet Archive:</span> ${escapeXml(book.ia_identifier)}</p>`;
  }
  colophonHtml += `</div>`;

  // Translation provenance
  colophonHtml += `<div class="colophon-section">`;
  colophonHtml += `<h2>Translation</h2>`;
  colophonHtml += `<p><span class="colophon-label">Pages Translated:</span> ${translatedCount} of ${totalCount}</p>`;

  // Collect unique AI models used
  const models = new Set<string>();
  for (const page of pages) {
    if (page.translation?.model) models.add(page.translation.model);
    if (page.ocr?.model) models.add(page.ocr.model);
  }
  if (models.size > 0) {
    colophonHtml += `<p><span class="colophon-label">AI Models:</span> ${escapeXml(Array.from(models).join(', '))}</p>`;
  }
  colophonHtml += `<p><span class="colophon-label">Generated:</span> ${now}</p>`;
  colophonHtml += `<p><span class="colophon-label">License:</span> CC BY-SA 4.0</p>`;
  colophonHtml += `</div>`;

  // Links
  colophonHtml += `<div class="colophon-section">`;
  colophonHtml += `<h2>Links</h2>`;
  colophonHtml += `<p>Read online with original scans: ${escapeXml(bookUrl)}</p>`;
  colophonHtml += `<p>Browse the gallery: ${escapeXml(`${BASE_URL}/gallery?book=${book.id}`)}</p>`;
  colophonHtml += `<p>Source Library: ${escapeXml(BASE_URL)}</p>`;
  colophonHtml += `</div>`;

  // Generate the EPUB
  const description = book.reading_summary?.overview
    ? book.reading_summary.overview.substring(0, 500)
    : `English translation of ${bookTitle} by ${book.author}.`;

  const epubBuffer = await epub(
    {
      title: bookTitle,
      author: book.author,
      publisher: 'Source Library',
      description,
      lang: 'en',
      tocTitle: 'Contents',
      css: KDP_CSS,
      date: now,
    },
    epubChapters
  );

  return epubBuffer;
}
