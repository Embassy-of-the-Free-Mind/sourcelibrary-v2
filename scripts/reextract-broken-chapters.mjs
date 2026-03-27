#!/usr/bin/env node
/**
 * Re-extract chapters for books where one chapter has >80% of content.
 * Uses the production API endpoint which now has v2 extraction improvements.
 *
 * After extraction, re-materializes chapter texts.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/reextract-broken-chapters.mjs [--limit N] [--dry-run]
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!GEMINI_API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

const args = process.argv.slice(2);
const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 0;
const dryRun = args.includes('--dry-run');

const client = new MongoClient(MONGODB_URI);

// Inline the v2 extraction logic since we can't import TS from mjs
import { GoogleGenerativeAI } from '@google/generative-ai';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

function extractHeadingsV2(text, pageNumber) {
  const headings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (/^<(margin|meta|header|sig|page-num|language|page-type|columns|warning|summary|keywords)>/.test(trimmed)) continue;
    let title = null, level = 2;
    const hm = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (hm) { level = hm[1].length; title = hm[2].trim().replace(/^->/, '').replace(/<-$/, '').replace(/^\*\*/, '').replace(/\*\*$/, '').trim(); }
    if (!title) { const cm = trimmed.match(/^->\*(.+)\*<-$/); if (cm) { title = cm[1].trim(); level = 2; } }
    if (!title) { const bm = trimmed.match(/^\*\*([A-Z][^*]{3,80})\*\*$/); if (bm) { title = bm[1].trim(); level = 1; } }
    if (!title || title.length < 3) continue;
    const ctx = [];
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const cl = lines[j].trim();
      if (cl && !cl.startsWith('<') && cl.length > 10) ctx.push(cl.slice(0, 100));
    }
    headings.push({ title, level, pageNumber, context: ctx.join(' | ').slice(0, 200) || undefined });
  }
  return headings;
}

function buildPrompt(book, headings, tocPages, sectionHints, pageCount) {
  const tocPageNumbers = new Set(tocPages.map(t => t.pageNumber));
  let prompt = `You are analyzing the structure of a digitized historical book to find where each chapter/section actually begins in the body text.

**Book:** ${book.display_title || book.title}
**Author:** ${book.author || 'Unknown'}
**Language:** ${book.language || book.original_language || 'Unknown'}
**Total pages:** ${pageCount}

`;
  if (sectionHints.length > 0) {
    prompt += `## Prior Section Analysis (approximate)\n`;
    for (const s of sectionHints) prompt += `- "${s.title}" (pp. ${s.startPage}–${s.endPage})\n`;
    prompt += '\n';
  }
  if (tocPages.length > 0) {
    prompt += `## Table of Contents Pages (pp. ${tocPages.map(t => t.pageNumber).join(', ')})\nHeadings on these pages are TOC entries, NOT chapter start pages.\n\n`;
    for (const toc of tocPages.slice(0, 3)) {
      prompt += `### Page ${toc.pageNumber}\n\`\`\`\n${toc.text.slice(0, 2000)}\n\`\`\`\n\n`;
    }
  }
  prompt += `## Headings Found in the Text\n\nBelow are headings with context lines. If context shows body text, this heading starts a real chapter. If context shows more titles, it's inside a TOC.\n\n`;
  for (const h of headings) {
    const prefix = tocPageNumbers.has(h.pageNumber) ? '[TOC] ' : '';
    prompt += `${prefix}p.${h.pageNumber}: ${'#'.repeat(h.level)} ${h.title}\n`;
    if (h.context) prompt += `  → ${h.context}\n`;
  }
  prompt += `\n\n## Instructions\n\nReturn the real structural chapters as a JSON array. CRITICAL:\n- "pageNumber" = where chapter TEXT BEGINS in body, NOT TOC page\n- Verify by context: body prose follows = real chapter; more titles follow = TOC entry\n- 5-50 chapters typical. Over 80 = noise.\n- Level: 1=volume/book, 2=chapter, 3=sub-chapter\n\nJSON array only, no fences:\n[{"title":"...","titleEn":"...","pageNumber":N,"level":N,"confidence":"high|medium|low"},...]\n\nEmpty [] if no structure.`;
  return prompt;
}

const MAX_CHUNK_CHARS = 400000;

function computeEndPages(chapters, totalPages) {
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].endPage = i < chapters.length - 1 ? chapters[i + 1].pageNumber - 1 : totalPages;
  }
  return chapters;
}

async function materializeBook(db, bookId, chapters, totalPages) {
  computeEndPages(chapters, totalPages);
  const pages = await db.collection('pages')
    .find({ book_id: bookId }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } })
    .sort({ page_number: 1 }).toArray();
  const pageMap = new Map();
  for (const p of pages) pageMap.set(p.page_number, { ocr: p.ocr?.data, translation: p.translation?.data });

  const docs = [];
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const startPage = ch.pageNumber;
    const endPage = ch.endPage || totalPages;
    const pageTexts = [];
    for (let pn = startPage; pn <= endPage; pn++) {
      const page = pageMap.get(pn);
      if (!page) continue;
      const marker = `[Page ${pn}]`;
      const trans = page.translation ? `${marker}\n${page.translation}` : page.ocr ? `${marker}\n${page.ocr}` : '';
      const ocr = page.ocr ? `${marker}\n${page.ocr}` : '';
      if (trans || ocr) pageTexts.push({ pn, trans, ocr });
    }
    const chunks = [];
    let current = { pageStart: startPage, pageEnd: startPage, transParts: [], ocrParts: [] };
    let currentChars = 0;
    for (const pt of pageTexts) {
      const pageChars = pt.trans.length + 4;
      if (currentChars > 0 && currentChars + pageChars > MAX_CHUNK_CHARS) {
        chunks.push(current);
        current = { pageStart: pt.pn, pageEnd: pt.pn, transParts: [], ocrParts: [] };
        currentChars = 0;
      }
      if (pt.trans) current.transParts.push(pt.trans);
      if (pt.ocr) current.ocrParts.push(pt.ocr);
      current.pageEnd = pt.pn;
      currentChars += pageChars;
    }
    if (current.transParts.length > 0) chunks.push(current);
    const needsSplit = chunks.length > 1;
    for (let partIdx = 0; partIdx < chunks.length; partIdx++) {
      const chunk = chunks[partIdx];
      const label = ch.titleEn ? `# ${ch.title}\n## ${ch.titleEn}` : `# ${ch.title}`;
      const suffix = needsSplit ? ` (part ${partIdx + 1} of ${chunks.length})` : '';
      chunk.transParts.unshift(label + suffix);
      chunk.ocrParts.unshift(`# ${ch.title}${suffix}`);
      const text = chunk.transParts.join('\n\n');
      const ocrText = chunk.ocrParts.join('\n\n');
      const doc = { book_id: bookId, chapter_index: i, title: ch.title, titleEn: ch.titleEn, level: ch.level,
        pageStart: chunk.pageStart, pageEnd: chunk.pageEnd, text, ocr_text: ocrText || undefined,
        token_estimate: Math.round(text.length / 4), materialized_at: new Date() };
      if (needsSplit) { doc.part = partIdx + 1; doc.parts_total = chunks.length; }
      docs.push(doc);
    }
  }
  await db.collection('chapter_texts').deleteMany({ book_id: bookId });
  if (docs.length > 0) {
    try { await db.collection('chapter_texts').insertMany(docs); }
    catch (e) { if (!e.message?.includes('larger than the maximum size')) throw e; }
  }
  return docs.length;
}

async function processBook(db, book) {
  const pages = await db.collection('pages')
    .find({ book_id: book.id, 'ocr.data': { $exists: true, $ne: '' } },
      { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, page_type: 1 } })
    .sort({ page_number: 1 }).toArray();
  if (pages.length === 0) return { status: 'skip', reason: 'no pages' };

  const allHeadings = [];
  for (const page of pages) {
    allHeadings.push(...extractHeadingsV2(page.ocr?.data || '', page.page_number));
    if (page.translation?.data) allHeadings.push(...extractHeadingsV2(page.translation.data, page.page_number));
  }

  const tocPages = [];
  for (const page of pages) {
    const ocrText = (page.ocr?.data || '').toLowerCase();
    const isToc = page.page_type === 'table_of_contents' || page.page_type === 'index' || page.page_type === 'toc' ||
      (/\b(tabula|index|contents|sommaire|inhalt|capitum|capitulorum)\b/i.test(ocrText) && page.page_number <= Math.min(30, pages.length * 0.1));
    if (isToc) tocPages.push({ pageNumber: page.page_number, text: page.ocr?.data || '' });
  }

  const sectionHints = [];
  if (book.index?.sectionSummaries) {
    for (const s of book.index.sectionSummaries) {
      if (s.title && s.startPage) sectionHints.push({ title: s.title, startPage: s.startPage, endPage: s.endPage || s.startPage });
    }
  }

  const prompt = buildPrompt(book, allHeadings, tocPages, sectionHints, pages.length);

  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  let aiChapters;
  try {
    let cleaned = responseText.trim();
    const jsonBlock = cleaned.match(/```json?\s*\n?([\s\S]*?)\n?```/);
    if (jsonBlock) cleaned = jsonBlock[1].trim();
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) cleaned = arrayMatch[0];
    aiChapters = JSON.parse(cleaned);
  } catch {
    return { status: 'parse-error', preview: responseText.slice(0, 200) };
  }

  // Build page ID mapping
  const pageByNumber = new Map();
  for (const p of pages) pageByNumber.set(p.page_number, p.id || p._id?.toString());

  const chapters = [];
  for (const ch of aiChapters) {
    if (!ch.title || !ch.pageNumber) continue;
    let pageId = pageByNumber.get(ch.pageNumber);
    if (!pageId) {
      for (let off = 1; off <= 2; off++) {
        pageId = pageByNumber.get(ch.pageNumber + off) || pageByNumber.get(ch.pageNumber - off);
        if (pageId) break;
      }
    }
    if (!pageId) continue;
    const chapter = { title: ch.title, pageId, pageNumber: ch.pageNumber, level: Math.min(Math.max(ch.level || 1, 1), 3) };
    if (ch.titleEn) chapter.titleEn = ch.titleEn;
    if (['high', 'medium', 'low'].includes(ch.confidence)) chapter.confidence = ch.confidence;
    chapters.push(chapter);
  }
  chapters.sort((a, b) => a.pageNumber - b.pageNumber);

  if (dryRun) {
    return { status: 'would-fix', chapters: chapters.length, sample: chapters.slice(0, 3).map(c => `p.${c.pageNumber}: ${c.title.slice(0, 60)}`) };
  }

  // Save chapters to book
  computeEndPages(chapters, pages.length);
  try {
    await db.collection('books').updateOne({ id: book.id }, {
      $set: { chapters, chapters_extracted_at: new Date(), chapters_method: 'v2-reextract' }
    });
  } catch (e) {
    if (!e.message?.includes('larger than the maximum size')) throw e;
    await db.collection('books').updateOne({ id: book.id }, { $set: { chapters_extracted_at: new Date(), chapters_method: 'v2-reextract' } });
  }

  // Re-materialize
  const chunkCount = await materializeBook(db, book.id, chapters, pages.length);

  const usage = result.response.usageMetadata;
  return { status: 'fixed', chapters: chapters.length, chunks: chunkCount, tokens: usage?.promptTokenCount || 0 };
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  // Find broken books
  const broken = await db.collection('chapter_texts').aggregate([
    { $group: { _id: '$book_id', total_chapters: { $sum: 1 }, max_tokens: { $max: '$token_estimate' }, total_tokens: { $sum: '$token_estimate' } }},
    { $match: { total_chapters: { $gte: 2 } } },
    { $project: { max_pct: { $multiply: [{ $divide: ['$max_tokens', { $max: ['$total_tokens', 1] }] }, 100] } }},
    { $match: { max_pct: { $gt: 80 } }}
  ]).toArray();

  let bookIds = broken.map(b => b._id);
  console.log(`Found ${bookIds.length} broken books${dryRun ? ' (DRY RUN)' : ''}`);
  if (limitArg > 0) bookIds = bookIds.slice(0, limitArg);

  let fixed = 0, skipped = 0, errors = 0, totalTokens = 0;

  for (let i = 0; i < bookIds.length; i++) {
    const book = await db.collection('books').findOne({ id: bookIds[i] },
      { projection: { id: 1, title: 1, display_title: 1, pages_count: 1, language: 1, original_language: 1, author: 1, 'index.sectionSummaries': 1 } });
    if (!book) continue;
    const title = (book.display_title || book.title || '').slice(0, 50);

    try {
      const result = await processBook(db, book);
      if (result.status === 'fixed' || result.status === 'would-fix') {
        console.log(`  ✓ ${book.id} — ${title} (${result.chapters} ch${result.chunks ? ', ' + result.chunks + ' chunks' : ''})`);
        if (result.sample) result.sample.forEach(s => console.log(`    ${s}`));
        if (result.tokens) totalTokens += result.tokens;
        fixed++;
      } else if (result.status === 'parse-error') {
        console.log(`  ✗ ${book.id} — ${title} (parse error: ${result.preview?.slice(0, 80)})`);
        errors++;
      } else {
        console.log(`  - ${book.id} — ${title} (${result.reason})`);
        skipped++;
      }
    } catch (err) {
      console.log(`  ✗ ${book.id} — ${title} (${err.message?.slice(0, 100)})`);
      errors++;
    }

    if ((i + 1) % 20 === 0) console.log(`  Progress: ${i + 1}/${bookIds.length} (${fixed} fixed, ${errors} errors, ~${Math.round(totalTokens / 1000)}K tokens)`);
  }

  console.log(`\nDone: ${fixed} fixed, ${skipped} skipped, ${errors} errors, ~${Math.round(totalTokens / 1000)}K tokens total`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
