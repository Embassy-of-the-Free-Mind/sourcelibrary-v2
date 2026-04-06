#!/usr/bin/env node
/**
 * Test improved chapter extraction on known broken books.
 * Compares old vs new results without saving to DB.
 *
 * Improvements over v1:
 * 1. Also extracts inline centered markers (->*...*<-) as headings
 * 2. Includes 3 lines of page context after each heading so Gemini can
 *    distinguish TOC entries from real chapter starts
 * 3. Tells Gemini which page ranges are front matter / TOC
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/test-chapter-extraction-v2.mjs [book_id]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!MONGODB_URI || !GEMINI_KEY) { console.error('Missing MONGODB_URI or GEMINI_API_KEY'); process.exit(1); }

const client = new MongoClient(MONGODB_URI);
const genAI = new GoogleGenerativeAI(GEMINI_KEY);

// Test books: known broken extractions
const TEST_BOOKS = [
  '69592b207c072c27f686dd71', // Ficino, Theologia Platonica (796 pages, inline markers)
  '69527367ab34727b1f048f38', // Kircher, Mundus Subterraneus (1004 pages, markdown headings)
  '6953e55777f38f6761bf05cf', // Vesalius, De Humani Corporis Fabrica (734 pages)
  '699062f5ef12272ffdc8e9d5', // Augustine, De Civitate Dei (617 pages)
  '6952d0c777f38f6761bc59f6', // Maier, Secretioris (322 pages, already good — control)
];

// V2 heading extractor: also catches centered markers and inline chapter labels
function extractHeadingsV2(text, pageNumber) {
  const headings = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Skip non-structural tags
    if (/^<(margin|meta|header|sig|page-num|language|page-type|columns|warning|summary|keywords)>/.test(line)) continue;

    let title = null;
    let level = 2;
    let context = '';

    // 1. Markdown headings (existing behavior)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      level = headingMatch[1].length;
      title = headingMatch[2].trim()
        .replace(/^->/, '').replace(/<-$/, '')
        .replace(/^\*\*/, '').replace(/\*\*$/, '')
        .trim();
    }

    // 2. Centered markers: ->*Caput V. De anima.*<-
    if (!title) {
      const centeredMatch = line.match(/^->\*(.+)\*<-$/);
      if (centeredMatch) {
        title = centeredMatch[1].trim();
        level = 2;
      }
    }

    // 3. Bold standalone structural labels: **LIBER PRIMUS**
    if (!title) {
      const boldMatch = line.match(/^\*\*([A-Z][^*]{3,80})\*\*$/);
      if (boldMatch) {
        title = boldMatch[1].trim();
        level = 1;
      }
    }

    if (!title || title.length < 3) continue;

    // Get 3 lines of context after the heading (helps Gemini distinguish TOC from body)
    const contextLines = [];
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const cl = lines[j].trim();
      if (cl && !cl.startsWith('<') && cl.length > 10) {
        contextLines.push(cl.slice(0, 100));
      }
    }
    context = contextLines.join(' | ').slice(0, 200);

    headings.push({ title, level, pageNumber, context });
  }

  return headings;
}

function buildPromptV2(book, headings, tocPages, sectionHints, pageCount) {
  let prompt = `You are analyzing the structure of a digitized historical book to find where each chapter/section actually begins in the body text.

**Book:** ${book.display_title || book.title}
**Author:** ${book.author || 'Unknown'}
**Language:** ${book.language || book.original_language || 'Unknown'}
**Total pages:** ${pageCount}

`;

  if (sectionHints.length > 0) {
    prompt += `## Prior Section Analysis (approximate)\n`;
    for (const s of sectionHints) {
      prompt += `- "${s.title}" (pp. ${s.startPage}–${s.endPage})\n`;
    }
    prompt += '\n';
  }

  if (tocPages.length > 0) {
    prompt += `## Table of Contents Pages (pp. ${tocPages.map(t => t.pageNumber).join(', ')})\n`;
    prompt += `These pages contain a printed table of contents. Headings found on these pages are TOC entries, NOT chapter start pages.\n\n`;
    for (const toc of tocPages.slice(0, 3)) {
      prompt += `### Page ${toc.pageNumber}\n\`\`\`\n${toc.text.slice(0, 2000)}\n\`\`\`\n\n`;
    }
  }

  // Group headings with their context
  prompt += `## Headings Found in the Text

Below are headings extracted from the book's OCR, with a few lines of context after each one.
- If the context shows body text (prose, arguments), this heading likely starts a real chapter.
- If the context shows more chapter titles or page numbers, this heading is probably inside a table of contents.
- If a heading appears in both the TOC section AND later in the body, the BODY occurrence is the chapter start page.

`;

  for (const h of headings) {
    prompt += `p.${h.pageNumber}: ${'#'.repeat(h.level)} ${h.title}`;
    if (h.context) {
      prompt += `\n  → ${h.context}`;
    }
    prompt += '\n';
  }

  prompt += `

## Instructions

Return the real structural chapters as a JSON array. CRITICAL rules:
- The "pageNumber" must be where the chapter TEXT BEGINS in the body, NOT where it appears in the table of contents
- If a heading like "Liber I" appears on p.5 (in the TOC) and again on p.30 (with body text following), use p.30
- Verify each chapter start by checking the context: does body text follow, or more chapter listings?
- A typical book has 5-50 chapters. Over 80 usually means noise.
- For multi-volume works: chapter numbering restarts in each volume. Use level 1 for volumes, level 2 for chapters.

Each entry:
- "title": Chapter title in original language
- "titleEn": English translation (omit if already English)
- "pageNumber": Page where this chapter's TEXT begins (not TOC reference)
- "level": 1=volume/book, 2=chapter/section, 3=sub-chapter
- "confidence": "high"/"medium"/"low"

Respond with ONLY a JSON array:
[{"title": "...", "titleEn": "...", "pageNumber": N, "level": N, "confidence": "..."}, ...]

Empty array [] if no discernible structure.`;

  return prompt;
}

async function testBook(db, bookId) {
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) { console.log('  Book not found: ' + bookId); return; }

  const title = (book.display_title || book.title || '').slice(0, 60);
  console.log(`\n=== ${title} (${book.pages_count || '?'} pages) ===`);
  console.log(`Old chapters: ${book.chapters?.length || 0}`);
  if (book.chapters?.length) {
    const biggest = book.chapters.reduce((max, ch, i, arr) => {
      const endP = i < arr.length - 1 ? arr[i+1].pageNumber : (book.pages_count || 0);
      const span = endP - ch.pageNumber;
      return span > max.span ? { span, title: ch.title } : max;
    }, { span: 0, title: '' });
    console.log(`  Biggest: "${biggest.title.slice(0, 50)}" (${biggest.span} pages)`);
  }

  // Fetch pages
  const pages = await db.collection('pages')
    .find(
      { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } },
      { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1, page_type: 1 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  // Extract headings with v2 extractor
  const allHeadings = [];
  for (const page of pages) {
    const ocrText = page.ocr?.data || '';
    allHeadings.push(...extractHeadingsV2(ocrText, page.page_number));
    const transText = page.translation?.data || '';
    if (transText) allHeadings.push(...extractHeadingsV2(transText, page.page_number));
  }

  // Identify TOC pages
  const tocPages = [];
  for (const page of pages) {
    const ocrText = (page.ocr?.data || '').toLowerCase();
    const isTocByType = page.page_type === 'table_of_contents' || page.page_type === 'index';
    const isTocByContent = /\b(tabula|index|contents|sommaire|inhalt|capitum|capitulorum)\b/i.test(ocrText)
      && page.page_number <= Math.min(30, pages.length * 0.1);
    if (isTocByType || isTocByContent) {
      tocPages.push({ pageNumber: page.page_number, text: page.ocr?.data || '' });
    }
  }

  // Section hints
  const sectionHints = [];
  if (book.index?.sectionSummaries) {
    for (const s of book.index.sectionSummaries) {
      if (s.title && s.startPage) {
        sectionHints.push({ title: s.title, startPage: s.startPage, endPage: s.endPage || s.startPage });
      }
    }
  }

  console.log(`V2 headings: ${allHeadings.length}, TOC pages: ${tocPages.length}, Section hints: ${sectionHints.length}`);

  // Build prompt and call Gemini
  const prompt = buildPromptV2(book, allHeadings, tocPages, sectionHints, pages.length);
  const inputTokenEst = Math.round(prompt.length / 4);
  console.log(`Prompt: ~${inputTokenEst} tokens`);

  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  let chapters;
  try {
    let cleaned = responseText.trim();
    const jsonBlock = cleaned.match(/```json?\s*\n?([\s\S]*?)\n?```/);
    if (jsonBlock) cleaned = jsonBlock[1].trim();
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) cleaned = arrayMatch[0];
    chapters = JSON.parse(cleaned);
  } catch {
    console.log('  PARSE ERROR: ' + responseText.slice(0, 300));
    return;
  }

  console.log(`\nV2 result: ${chapters.length} chapters`);
  for (const ch of chapters) {
    const conf = ch.confidence === 'high' ? '✓' : ch.confidence === 'medium' ? '~' : '?';
    const en = ch.titleEn ? ` — ${ch.titleEn}` : '';
    console.log(`  ${conf} p.${String(ch.pageNumber).padStart(4)}: [L${ch.level}] ${ch.title.slice(0, 60)}${en}`);
  }

  const usage = result.response.usageMetadata;
  console.log(`\nUsage: ${usage?.promptTokenCount || '?'} in, ${usage?.candidatesTokenCount || '?'} out`);
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  const bookIds = process.argv[2] ? [process.argv[2]] : TEST_BOOKS;

  for (const bookId of bookIds) {
    try {
      await testBook(db, bookId);
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
