/**
 * Scholarly PDF generator for Zenodo DOI deposits.
 *
 * Generates a clean, typeset PDF with:
 *   - Title page
 *   - About this translation
 *   - Introduction (from front matter)
 *   - Methodology (from front matter)
 *   - Translation text with page markers
 *   - Index (people, places, concepts)
 *   - Colophon
 *
 * Uses PDFKit (pure Node.js, no browser).
 */

import PDFDocument from 'pdfkit';

// ── Tag stripping (from kdp-epub.ts) ────────────────────────────────

function stripXmlTags(text) {
  let clean = text.replace(
    /<(?:page-type|columns|detected-images|lang|language|page-num|folio|sig|header|meta|warning|abbrev|vocab|summary|keywords)>[\s\S]*?<\/(?:page-type|columns|detected-images|lang|language|page-num|folio|sig|header|meta|warning|abbrev|vocab|summary|keywords)>/gi,
    ''
  );
  clean = clean.replace(/<column-break\s*\/?>/gi, '\n\n');
  // Convert <note>...</note> to [Note: ...]
  clean = clean.replace(/<note>([\s\S]*?)<\/note>/gi, '[Note: $1]');
  // Convert <term>...</term> to italics marker
  clean = clean.replace(/<term>([\s\S]*?)<\/term>/gi, '$1');
  // Convert <margin>...</margin> to [Margin: ...]
  clean = clean.replace(/<margin>([\s\S]*?)<\/margin>/gi, '[Margin: $1]');
  // Convert <unclear>...</unclear> to [?...]
  clean = clean.replace(/<unclear>([\s\S]*?)<\/unclear>/gi, '[?$1]');
  // Remove arrow tags like ->WORD<- (common in title pages)
  clean = clean.replace(/->([\s\S]*?)<-/g, '$1');
  // Remove AI preambles
  clean = clean.replace(/^(?:Okay,?\s*)?(?:Here(?:'s| is) (?:the|my) (?:translation|modernization|transcription)[\s\S]*?:\s*\n+)/i, '');
  // Strip markdown formatting (translations shouldn't have markdown)
  clean = clean.replace(/^#{1,6}\s+/gm, '');      // heading markers
  clean = clean.replace(/^\s*---+\s*$/gm, '');     // horizontal rules
  clean = clean.replace(/\*\*(.+?)\*\*/g, '$1');   // bold
  clean = clean.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1'); // italic
  // Remove remaining tags
  clean = clean.replace(/<\/?[a-z][a-z0-9-]*\s*\/?>/gi, '');
  return clean.trim();
}

// ── Markdown to PDF rendering ───────────────────────────────────────

/**
 * Render markdown text to PDFKit document.
 * Handles ## headings, **bold**, *italic*, and paragraphs.
 */
function renderMarkdown(doc, text, opts = {}) {
  const { fontSize = 10.5, lineGap = 4 } = opts;
  const lines = text.split('\n');
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (inList) { inList = false; }
      doc.moveDown(0.3);
      continue;
    }

    // Headings
    if (trimmed.startsWith('## ')) {
      doc.moveDown(0.5);
      doc.fontSize(13).font('Helvetica-Bold')
        .text(trimmed.replace(/^## /, ''), { lineGap });
      doc.moveDown(0.3);
      doc.fontSize(fontSize).font('Helvetica');
      continue;
    }

    if (trimmed.startsWith('### ')) {
      doc.moveDown(0.3);
      doc.fontSize(11.5).font('Helvetica-Bold')
        .text(trimmed.replace(/^### /, ''), { lineGap });
      doc.moveDown(0.2);
      doc.fontSize(fontSize).font('Helvetica');
      continue;
    }

    // Bullet points
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      inList = true;
      const content = trimmed.replace(/^[-*] /, '');
      renderRichText(doc, `  \u2022  ${content}`, fontSize, lineGap);
      continue;
    }

    // Regular paragraph
    renderRichText(doc, trimmed, fontSize, lineGap);
  }
}

/**
 * Render a single line with **bold** and *italic* spans.
 */
function renderRichText(doc, text, fontSize, lineGap) {
  // Simple approach: split on bold/italic markers and render segments
  // For scholarly PDFs, plain text with occasional bold is fine
  const segments = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Bold: **...**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Italic: *...*
    const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);

    const nextBold = boldMatch ? remaining.indexOf(boldMatch[0]) : Infinity;
    const nextItalic = italicMatch ? remaining.indexOf(italicMatch[0]) : Infinity;

    if (nextBold === Infinity && nextItalic === Infinity) {
      segments.push({ text: remaining, font: 'Helvetica' });
      break;
    }

    if (nextBold <= nextItalic) {
      if (nextBold > 0) segments.push({ text: remaining.substring(0, nextBold), font: 'Helvetica' });
      segments.push({ text: boldMatch[1], font: 'Helvetica-Bold' });
      remaining = remaining.substring(nextBold + boldMatch[0].length);
    } else {
      if (nextItalic > 0) segments.push({ text: remaining.substring(0, nextItalic), font: 'Helvetica' });
      segments.push({ text: italicMatch[1], font: 'Helvetica-Oblique' });
      remaining = remaining.substring(nextItalic + italicMatch[0].length);
    }
  }

  // Render all segments inline
  if (segments.length === 1) {
    doc.font(segments[0].font).fontSize(fontSize).text(segments[0].text, { lineGap });
    doc.font('Helvetica');
  } else {
    // Use continued text for inline formatting
    for (let i = 0; i < segments.length; i++) {
      const isLast = i === segments.length - 1;
      doc.font(segments[i].font).fontSize(fontSize)
        .text(segments[i].text, { continued: !isLast, lineGap: isLast ? lineGap : 0 });
    }
    doc.font('Helvetica');
  }
}

// ── PDF Generator ───────────────────────────────────────────────────

/**
 * Generate a scholarly PDF for a book.
 *
 * @param {Object} book - Book document from MongoDB
 * @param {Array} pages - Page documents with translation.data
 * @param {Object} options - { introduction, methodology }
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function generateScholarlyPdf(book, pages, options = {}) {
  const { introduction, methodology } = options;
  const bookTitle = book.display_title || book.title;
  const bookSlug = book.slug || book.id;
  const now = new Date().toISOString().split('T')[0];

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 72, bottom: 72, left: 72, right: 72 },
    info: {
      Title: `English Translation of ${bookTitle}`,
      Author: book.author || 'Anonymous',
      Creator: 'Source Library (sourcelibrary.org)',
      Producer: 'PDFKit',
      Subject: `AI-assisted translation of ${book.title} (${book.published || 'n.d.'})`,
    },
    bufferPages: true,
  });

  // Collect buffer
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));

  // ── Title page ──

  doc.moveDown(6);
  doc.fontSize(24).font('Helvetica-Bold')
    .text(bookTitle, { align: 'center' });

  if (book.title !== bookTitle) {
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Oblique')
      .text(book.title, { align: 'center' });
  }

  doc.moveDown(1);
  doc.fontSize(14).font('Helvetica')
    .text(book.author || 'Anonymous', { align: 'center' });

  if (book.published) {
    doc.moveDown(0.3);
    doc.fontSize(12).text(book.published, { align: 'center' });
  }

  doc.moveDown(3);
  doc.fontSize(11).font('Helvetica')
    .text('Translated by Source Library', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(10).text(`sourcelibrary.org/book/${bookSlug}`, { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(10).text(now, { align: 'center' });

  // ── About this translation ──

  doc.addPage();
  doc.fontSize(16).font('Helvetica-Bold')
    .text('About This Translation', { align: 'center' });
  doc.moveDown(1);
  doc.fontSize(10.5).font('Helvetica');

  const disclosure = `This translation was produced using artificial intelligence by Source Library (sourcelibrary.org), a project dedicated to digitizing and translating rare historical texts. The original ${book.language || 'source language'} text was transcribed using optical character recognition (OCR) and then translated into English using large language models.

This AI-assisted translation has NOT been reviewed by human editors or translators. It captures the meaning and structure of the original text but may not reflect every nuance a specialist human translator would convey. Readers are encouraged to consult the original language text, available alongside this translation at Source Library.

This work is licensed under Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).`;

  doc.text(disclosure, { lineGap: 4 });

  // ── Introduction ──

  if (introduction) {
    doc.addPage();
    doc.fontSize(16).font('Helvetica-Bold')
      .text('Introduction', { align: 'center' });
    doc.moveDown(1);
    renderMarkdown(doc, introduction);
  }

  // ── Methodology ──

  if (methodology) {
    doc.addPage();
    doc.fontSize(16).font('Helvetica-Bold')
      .text('Methodology', { align: 'center' });
    doc.moveDown(1);
    renderMarkdown(doc, methodology);
  }

  // ── Translation ──

  doc.addPage();
  doc.fontSize(16).font('Helvetica-Bold')
    .text('Translation', { align: 'center' });
  doc.moveDown(1);

  // Filter out non-content pages (covers, blanks, illustrations-only)
  const SKIP_PAGE_TYPES = new Set(['blank', 'illustration', 'map', 'frontispiece', 'diagram']);
  const translatedPages = pages.filter(p => {
    if (!p.translation?.data) return false;
    if (p.page_type && SKIP_PAGE_TYPES.has(p.page_type)) return false;
    // Skip pages that are primarily physical descriptions (covers, blank pages, spines)
    const text = p.translation.data;
    const isPhysicalDescription = /\b(blank\s+(page|sheet)|book\s+spine|front\s+cover|back\s+cover|binding\s+(is|shows|has)|no\s+text\s+(is\s+)?visible|devoid\s+of\s+(any\s+)?text|leather\s+sections|marbled\s+pattern)\b/i.test(text);
    if (isPhysicalDescription && text.length < 500) return false;
    return true;
  });

  // Group by chapters if available
  const chapters = book.chapters || [];
  let currentChapterIdx = 0;

  for (const page of translatedPages) {
    // Check if we're entering a new chapter
    if (chapters.length > 0 && currentChapterIdx < chapters.length) {
      const chapter = chapters[currentChapterIdx];
      if (page.page_number >= chapter.start_page) {
        doc.moveDown(0.5);
        doc.fontSize(13).font('Helvetica-Bold')
          .text(chapter.title, { lineGap: 4 });
        doc.moveDown(0.3);
        currentChapterIdx++;
        // Skip ahead to find next chapter
        while (currentChapterIdx < chapters.length &&
               chapters[currentChapterIdx].start_page <= page.page_number) {
          currentChapterIdx++;
        }
      }
    }

    // Page marker
    doc.fontSize(8).font('Helvetica-Oblique')
      .fillColor('#888888')
      .text(`[p. ${page.page_number}]`, { lineGap: 2 });
    doc.fillColor('#000000');

    // Translation text
    const text = stripXmlTags(page.translation.data);
    if (text) {
      doc.fontSize(10.5).font('Helvetica')
        .text(text, { lineGap: 4 });
      doc.moveDown(0.5);
    }

    // Add page break every ~30 pages to avoid very long continuous text
    // PDFKit handles page overflow automatically, but chapter breaks are nice
  }

  // ── Index ──

  const index = book.index;
  if (index && (index.people?.length || index.places?.length || index.concepts?.length)) {
    doc.addPage();
    doc.fontSize(16).font('Helvetica-Bold')
      .text('Index', { align: 'center' });
    doc.moveDown(1);

    const renderIndexSection = (title, entries) => {
      if (!entries?.length) return;
      doc.fontSize(12).font('Helvetica-Bold').text(title);
      doc.moveDown(0.3);
      for (const entry of entries.slice(0, 100)) { // Cap at 100 entries
        const pageRefs = entry.pages?.length ? ` (pp. ${entry.pages.slice(0, 10).join(', ')})` : '';
        doc.fontSize(9.5).font('Helvetica')
          .text(`${entry.term}${pageRefs}`, { lineGap: 2 });
      }
      doc.moveDown(0.5);
    };

    renderIndexSection('People', index.people);
    renderIndexSection('Places', index.places);
    renderIndexSection('Concepts', index.concepts);

    // Vocabulary/glossary
    if (index.vocabulary?.length) {
      doc.fontSize(12).font('Helvetica-Bold').text('Glossary');
      doc.moveDown(0.3);
      for (const entry of index.vocabulary.slice(0, 100)) {
        doc.fontSize(9.5).font('Helvetica-Bold')
          .text(entry.term, { continued: true });
        doc.font('Helvetica')
          .text(entry.definition ? ` — ${entry.definition}` : '', { lineGap: 2 });
      }
      doc.moveDown(0.5);
    }
  }

  // ── Colophon ──

  doc.addPage();
  doc.fontSize(16).font('Helvetica-Bold')
    .text('Colophon', { align: 'center' });
  doc.moveDown(1);

  doc.fontSize(10).font('Helvetica');
  const colophon = [
    `This digital edition of "${bookTitle}" was produced by Source Library.`,
    '',
    `Original author: ${book.author || 'Anonymous'}`,
    `Original language: ${book.language || 'Unknown'}`,
    book.published ? `Original publication: ${book.published}` : null,
    book.place_published ? `Place of publication: ${book.place_published}` : null,
    book.publisher ? `Publisher: ${book.publisher}` : null,
    book.ustc_id ? `USTC ID: ${book.ustc_id}` : null,
    '',
    `Pages translated: ${translatedPages.length}`,
    `Generated: ${now}`,
    '',
    `Source Library: https://sourcelibrary.org/book/${bookSlug}`,
    book.ia_identifier ? `Internet Archive: https://archive.org/details/${book.ia_identifier}` : null,
    '',
    'License: CC BY-SA 4.0',
    'https://creativecommons.org/licenses/by-sa/4.0/',
  ].filter(Boolean);

  doc.text(colophon.join('\n'), { lineGap: 4 });

  // ── Add page numbers ──

  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    if (i === 0) continue; // Skip title page
    doc.fontSize(8).font('Helvetica')
      .fillColor('#999999')
      .text(
        String(i + 1),
        0, doc.page.height - 50,
        { align: 'center', width: doc.page.width }
      );
    doc.fillColor('#000000');
  }

  // Finalize
  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
