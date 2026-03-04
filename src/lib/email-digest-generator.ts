/**
 * AI Digest Generator for Source Library newsletters.
 * Queries MongoDB for recent activity and uses Gemini to write newsletter content.
 */

import { getGeminiClient } from './gemini-client';
import { getDb } from './mongodb';
import { DigestContent, renderDigestHtml } from './email-templates';
import { logGeminiCall } from './gemini-logger';

interface DigestContext {
  new_books: Array<{
    title: string;
    author: string;
    year?: number;
    slug?: string;
    language?: string;
    category?: string;
  }>;
  popular_books: Array<{
    title: string;
    author: string;
    slug?: string;
    read_count: number;
  }>;
  gallery_image_count: number;
  stats: {
    total_books: number;
    total_pages_ocr: number;
    total_pages_translated: number;
  };
}

async function gatherDigestContext(periodDays: number): Promise<DigestContext> {
  const db = await getDb();
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const [newBooks, popularBooks, galleryCount, totalBooks, ocrCount, translatedCount] = await Promise.all([
    // New books in period
    db.collection('books')
      .find({ created_at: { $gte: since } })
      .sort({ created_at: -1 })
      .limit(10)
      .project({ title: 1, author: 1, year: 1, slug: 1, language: 1, category: 1 })
      .toArray(),

    // Most-read books (all time, top 5)
    db.collection('books')
      .find({ read_count: { $gt: 0 } })
      .sort({ read_count: -1 })
      .limit(5)
      .project({ title: 1, author: 1, slug: 1, read_count: 1 })
      .toArray(),

    // Gallery images added in period
    db.collection('gallery_images')
      .countDocuments({ created_at: { $gte: since } }),

    // Total stats
    db.collection('books').countDocuments(),
    db.collection('pages').countDocuments({ 'ocr.data': { $exists: true, $ne: '' } }),
    db.collection('pages').countDocuments({ 'translation.data': { $exists: true, $ne: '' } }),
  ]);

  return {
    new_books: newBooks.map(b => ({
      title: b.title || b.display_title,
      author: b.author || 'Unknown',
      year: b.year,
      slug: b.slug || b._id?.toString(),
      language: b.language,
      category: b.category,
    })),
    popular_books: popularBooks.map(b => ({
      title: b.title || b.display_title,
      author: b.author || 'Unknown',
      slug: b.slug || b._id?.toString(),
      read_count: b.read_count,
    })),
    gallery_image_count: galleryCount,
    stats: {
      total_books: totalBooks,
      total_pages_ocr: ocrCount,
      total_pages_translated: translatedCount,
    },
  };
}

function buildDigestPrompt(ctx: DigestContext, periodDays: number): string {
  const newBooksList = ctx.new_books.length > 0
    ? ctx.new_books.map(b => `- "${b.title}" by ${b.author}${b.year ? ` (${b.year})` : ''}${b.language ? `, ${b.language}` : ''}`).join('\n')
    : '(No new books this period)';

  const popularList = ctx.popular_books.map(b => `- "${b.title}" by ${b.author} — ${b.read_count} reads`).join('\n');

  return `You are writing a newsletter digest for Source Library, a digital archive of rare Western esoteric texts (alchemy, Hermetica, Kabbalah, Renaissance philosophy, mysticism). The audience is scholars, enthusiasts, and curious readers who signed up for updates.

CONTEXT (last ${periodDays} days):

New books added (${ctx.new_books.length}):
${newBooksList}

Most popular books:
${popularList}

New gallery images: ${ctx.gallery_image_count}

Collection stats:
- ${ctx.stats.total_books.toLocaleString()} books total
- ${ctx.stats.total_pages_ocr.toLocaleString()} pages OCR'd
- ${ctx.stats.total_pages_translated.toLocaleString()} pages translated

INSTRUCTIONS:
Write a newsletter digest email. Be warm, knowledgeable, and concise. Write like a librarian who loves these texts, not a marketer. No hype, no exclamation marks.

For each new book, write a 1-sentence description that captures why it's interesting — what's in it, why it matters, what a reader will find. Don't just repeat the title.

OUTPUT FORMAT (JSON only, no markdown):
{
  "subject": "Short email subject line (under 60 chars)",
  "greeting": "Opening paragraph (2-3 sentences). Personal, sets context for what's new.",
  "new_books": [
    { "title": "Book Title", "author": "Author", "year": 1617, "description": "One sentence about why this book matters." }
  ],
  "popular_section_intro": "One sentence introducing the most-read books.",
  "gallery_note": "One sentence about the gallery if there are new images, or null.",
  "closing": "Closing paragraph (1-2 sentences). Forward-looking, inviting."
}

Only include new_books entries for books that actually have interesting content to describe. If there are too many, pick the 5 most notable.`;
}

export async function generateDigest(periodDays: number = 14): Promise<{
  html: string;
  subject: string;
  context: DigestContext;
  model: string;
}> {
  const ctx = await gatherDigestContext(periodDays);
  const prompt = buildDigestPrompt(ctx, periodDays);
  const model = 'gemini-3-flash-preview';

  const genAI = getGeminiClient();
  const geminiModel = genAI.getGenerativeModel({ model });

  const startTime = Date.now();
  const result = await geminiModel.generateContent(prompt);
  const text = result.response.text();
  const duration = Date.now() - startTime;

  // Parse AI response
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  } else {
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) jsonStr = objMatch[0];
  }
  const parsed = JSON.parse(jsonStr);

  // Build structured content
  const digestContent: DigestContent = {
    subject: parsed.subject,
    greeting: parsed.greeting,
    new_books: (parsed.new_books || []).map((b: any) => ({
      title: b.title,
      author: b.author,
      year: b.year,
      description: b.description,
      url: `https://sourcelibrary.org/book/${ctx.new_books.find(nb => nb.title === b.title)?.slug || ''}`,
    })),
    popular_books: ctx.popular_books.map(b => ({
      title: b.title,
      author: b.author,
      url: `https://sourcelibrary.org/book/${b.slug || ''}`,
      reads: b.read_count,
    })),
    gallery_highlight: parsed.gallery_note ? {
      description: parsed.gallery_note,
      url: 'https://sourcelibrary.org/gallery',
    } : undefined,
    stats: ctx.stats,
    closing: parsed.closing,
  };

  const html = renderDigestHtml(digestContent);

  // Log AI usage
  const usage = result.response.usageMetadata;
  logGeminiCall({
    type: 'other',
    mode: 'realtime',
    model,
    input_tokens: usage?.promptTokenCount || 0,
    output_tokens: usage?.candidatesTokenCount || 0,
    status: 'success',
    duration_ms: duration,
  }).catch(() => {});

  return { html, subject: parsed.subject, context: ctx, model };
}
