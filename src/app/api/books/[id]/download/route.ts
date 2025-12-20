import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { Book, Page } from '@/lib/types';
import epub from 'epub-gen-memory';

// Base URL for source links - update when we have a custom domain
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://sourcelibrary.org';

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
  let html = text
    // Escape HTML entities first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Convert [[notes: ...]] to styled aside blocks
    .replace(/\[\[notes?:\s*(.*?)\]\]/gi, '<aside class="note">$1</aside>')
    // Convert headers
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    // Convert bold and italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Convert line breaks to paragraphs (double newlines)
    .replace(/\n\n+/g, '</p><p>')
    // Convert single newlines to breaks
    .replace(/\n/g, '<br/>');

  // Wrap in paragraph tags
  html = '<p>' + html + '</p>';

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '').replace(/<p>\s*<\/p>/g, '');

  return html;
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

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'translation';

    // Valid formats: TXT (translation, ocr, both) and EPUB (epub-translation, epub-ocr, epub-both)
    const validFormats = ['translation', 'ocr', 'both', 'epub-translation', 'epub-ocr', 'epub-both'];
    if (!validFormats.includes(format)) {
      return NextResponse.json(
        { error: 'Invalid format. Use: translation, ocr, both, epub-translation, epub-ocr, or epub-both' },
        { status: 400 }
      );
    }

    const isEpub = format.startsWith('epub-');

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

    if (isEpub) {
      // Generate EPUB
      const epubBuffer = await generateEpubDownload(
        book as unknown as Book,
        pages as unknown as Page[],
        format as 'epub-translation' | 'epub-ocr' | 'epub-both'
      );

      const formatSuffix = format.replace('epub-', '');
      const filename = `${safeTitle}-${formatSuffix}.epub`;

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
