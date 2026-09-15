import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getGeminiClient } from '@/lib/gemini-client';
import { withAuth } from '@/lib/auth-helpers';
import { isBookReadable } from '@/lib/book-access';
import { getChapterTexts } from '@/lib/chapter-text';
import { z } from 'zod';

// Validation schema for chat messages
const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1, 'Message cannot be empty').max(10000, 'Message too long'),
});

const chatRequestSchema = z.object({
  messages: z.array(messageSchema)
    .min(1, 'At least one message required')
    .max(50, 'Too many messages in conversation'),
});

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface PageData {
  page_number: number;
  translation?: { data: string };
}

interface BookData {
  id: string;
  title: string;
  display_title?: string;
  author?: string;
  language?: string;
  pages_count?: number;
  index?: {
    bookSummary?: {
      abstract?: string;
      detailed?: string;
    };
  };
}

// Clean translation text by removing metadata tags
function cleanText(text: string): string {
  return text
    .replace(/\[\[[^\]]+\]\]/g, '')
    .replace(/^```(?:markdown)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

// Extract keywords from a query for searching
function extractKeywords(query: string): string[] {
  // Remove common stop words and split into keywords
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'between',
    'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
    'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
    'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
    'she', 'her', 'it', 'its', 'they', 'them', 'their',
    'about', 'tell', 'says', 'said', 'does', 'mean', 'book', 'text', 'author',
    'page', 'pages', 'read', 'write', 'wrote', 'written'
  ]);

  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
}

// Search pages within a book for relevant content
async function searchBookPages(
  bookId: string,
  query: string,
  limit: number = 15
): Promise<PageData[]> {
  const db = await getDb();
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    // No meaningful keywords - return first few pages
    return await db.collection('pages')
      .find({ book_id: bookId, 'translation.data': { $exists: true } })
      .sort({ page_number: 1 })
      .limit(limit)
      .toArray() as unknown as PageData[];
  }

  // Build regex patterns for each keyword
  const regexPatterns = keywords.map(k => new RegExp(k, 'i'));

  // Search for pages containing any of the keywords
  const pages = await db.collection('pages')
    .find({
      book_id: bookId,
      'translation.data': { $exists: true },
      $or: regexPatterns.map(r => ({ 'translation.data': r }))
    })
    .toArray() as unknown as PageData[];

  // Score pages by keyword matches
  const scoredPages = pages.map(page => {
    const text = (page.translation?.data || '').toLowerCase();
    let score = 0;
    for (const keyword of keywords) {
      const matches = (text.match(new RegExp(keyword, 'gi')) || []).length;
      score += matches;
    }
    return { page, score };
  });

  // Sort by score and return top matches
  scoredPages.sort((a, b) => b.score - a.score);
  return scoredPages.slice(0, limit).map(sp => sp.page);
}

// Search chapter texts for relevant content using keyword matching
async function searchChapterTexts(
  bookId: string,
  query: string,
  limit: number = 3,
): Promise<Array<{ index: number; title: string; titleEn?: string; pageStart: number; pageEnd: number; text: string; score: number }>> {
  const db = await getDb();
  const chapters = await getChapterTexts(db, bookId);
  if (chapters.length === 0) return [];

  const keywords = extractKeywords(query);
  if (keywords.length === 0) {
    // No keywords — return first chapter
    return chapters.slice(0, 1).map(ct => ({
      index: ct.chapter_index,
      title: ct.title,
      titleEn: ct.titleEn,
      pageStart: ct.pageStart,
      pageEnd: ct.pageEnd,
      text: ct.text,
      score: 0,
    }));
  }

  // Score each chapter by keyword density
  const scored = chapters.map(ct => {
    const text = ct.text.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      const matches = (text.match(new RegExp(kw, 'gi')) || []).length;
      score += matches;
    }
    return {
      index: ct.chapter_index,
      title: ct.title,
      titleEn: ct.titleEn,
      pageStart: ct.pageStart,
      pageEnd: ct.pageEnd,
      text: ct.text,
      score,
    };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Build context from book data — prefers chapter-level retrieval, falls back to page-level
async function buildBookContext(
  bookId: string,
  userQuery: string
): Promise<{ context: string; pageCount: number }> {
  const db = await getDb();

  const book = await db.collection('books').findOne({ id: bookId }) as unknown as BookData | null;
  if (!book) throw new Error('Book not found');

  // Merge full index from dedicated collection
  const indexDoc = await db.collection('book_indexes').findOne(
    { book_id: bookId },
    { projection: { _id: 0, book_id: 0 }, maxTimeMS: 5000 }
  ).catch(() => null);
  if (indexDoc) {
    (book as any).index = { ...(book as any).index, ...indexDoc };
  }

  const totalPages = book.pages_count || 0;

  let context = `# Book Information
Title: ${book.display_title || book.title}
Author: ${book.author || 'Unknown'}
Language: ${book.language || 'Unknown'}
Total Pages: ${totalPages}
`;

  if (book.index?.bookSummary?.abstract) {
    context += `\n## Summary\n${book.index.bookSummary.abstract}\n`;
  }

  if (book.index?.bookSummary?.detailed) {
    context += `\n## Detailed Overview\n${book.index.bookSummary.detailed}\n`;
  }

  // Try chapter-level retrieval first (better context, includes page markers for citation)
  const relevantChapters = await searchChapterTexts(bookId, userQuery, 3);

  if (relevantChapters.length > 0) {
    context += `\n## Relevant Chapters\n`;
    // Budget: ~80K chars total for chapter text to stay within model limits
    let charBudget = 80000;
    for (const ch of relevantChapters) {
      const title = ch.titleEn || ch.title;
      context += `\n### ${title} (pages ${ch.pageStart}–${ch.pageEnd})\n`;
      if (ch.text.length <= charBudget) {
        context += ch.text + '\n';
        charBudget -= ch.text.length;
      } else {
        context += ch.text.substring(0, charBudget) + '\n...(truncated)\n';
        break;
      }
    }
  } else {
    // Fall back to page-level search (no chapter texts materialized)
    const relevantPages = await searchBookPages(bookId, userQuery, 15);

    if (relevantPages.length > 0) {
      context += `\n## Relevant Pages (based on your question)\n`;
      relevantPages.sort((a, b) => a.page_number - b.page_number);

      for (const page of relevantPages) {
        const cleaned = cleanText(page.translation?.data || '');
        if (cleaned.length > 50) {
          const content = cleaned.length > 2000
            ? cleaned.substring(0, 2000) + '...'
            : cleaned;
          context += `\n### Page ${page.page_number}\n${content}\n`;
        }
      }
    }
  }

  return { context, pageCount: totalPages };
}

// POST /api/books/[id]/chat - Chat with the book (auth required to prevent Gemini API abuse)
export const POST = withAuth(async (
  request: NextRequest,
) => {
  try {
    // Extract book ID from URL path: /api/books/[id]/chat
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const id = pathParts[pathParts.indexOf('books') + 1];
    const rawBody = await request.json();

    // Validate request body
    const parseResult = chatRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { messages } = parseResult.data;

    // Get the user's current question to find relevant pages
    const lastMessage = messages[messages.length - 1];
    const userQuery = lastMessage.content;

    // Build book context with RAG-based page retrieval
    const { context: bookContext, pageCount } = await buildBookContext(id, userQuery);

    // Create the model
    const model = getGeminiClient({ endpoint: '/api/books/[id]/chat', type: 'other' }).getGenerativeModel({ model: 'gemini-3-flash-preview' });

    // System prompt
    const systemPrompt = `You are a knowledgeable guide helping readers understand a historical text. You have access to the book's content below.

${bookContext}

## Instructions
- Answer questions based on the book's actual content shown above
- The pages shown are the most relevant to the user's question (searched from the full ${pageCount}-page book)
- **IMPORTANT**: When referencing the text, include direct quotes and cite like this:
  > "quoted text from the source" [Page 5]
- Use blockquotes (>) for direct quotes from the text
- Always include the page number after quotes: [Page X]
- If the answer isn't in the pages shown, say you couldn't find it in the relevant sections and suggest the user ask differently
- Explain archaic or technical terms in modern language
- Be conversational but scholarly
- Keep responses concise unless asked for detail

## Quote Format Example
When the text says something relevant, quote it like:
> "The soul is immortal and imperishable" [Page 12]

This helps readers verify and explore further.`;

    // Build conversation history for Gemini
    const chatHistory = messages.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    // Start chat with history
    const chat = model.startChat({
      history: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'I understand. I\'m ready to help readers explore this text.' }] },
        ...chatHistory,
      ],
    });

    // Send the latest message
    const result = await chat.sendMessage(userQuery);
    const response = result.response.text();

    return NextResponse.json({
      message: {
        role: 'assistant',
        content: response,
      },
    });

  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { error: 'Failed to process chat message' },
      { status: 500 }
    );
  }
});

// GET /api/books/[id]/chat - Get initial greeting with summary (no auth needed, just returns greeting)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const book = await db.collection('books').findOne({ id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Hidden (visible:false) books are not public — 404 unless editor / CRON_SECRET.
    if (!(await isBookReadable(book, request))) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Merge full index from dedicated collection
    const indexDoc = await db.collection('book_indexes').findOne(
      { book_id: id },
      { projection: { _id: 0, book_id: 0 }, maxTimeMS: 5000 }
    ).catch(() => null);
    if (indexDoc) {
      (book as any).index = { ...(book as any).index, ...indexDoc };
    }

    const title = book.display_title || book.title;
    const author = book.author || 'Unknown';
    const summary = book.index?.bookSummary?.brief || book.summary?.data || '';

    let greeting = `Welcome! I'm here to help you explore **${title}** by ${author}.`;

    if (summary) {
      greeting += `\n\n${summary}`;
    }

    greeting += `\n\nWhat would you like to know about this text?`;

    return NextResponse.json({
      message: {
        role: 'assistant',
        content: greeting,
      },
    });

  } catch (error) {
    console.error('Chat init error:', error);
    return NextResponse.json(
      { error: 'Failed to initialize chat' },
      { status: 500 }
    );
  }
}
