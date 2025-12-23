import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface PageData {
  page_number: number;
  translation?: { data: string };
}

// Build context from book data
async function buildBookContext(bookId: string): Promise<string> {
  const db = await getDb();

  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) throw new Error('Book not found');

  const pages = await db.collection('pages')
    .find({ book_id: bookId })
    .sort({ page_number: 1 })
    .toArray() as unknown as PageData[];

  // Build context string
  let context = `# Book Information
Title: ${book.display_title || book.title}
Author: ${book.author || 'Unknown'}
Language: ${book.language || 'Unknown'}
`;

  // Add summary if available
  if (book.index?.bookSummary?.abstract) {
    context += `\n## Summary\n${book.index.bookSummary.abstract}\n`;
  }

  if (book.index?.bookSummary?.detailed) {
    context += `\n## Detailed Overview\n${book.index.bookSummary.detailed}\n`;
  }

  // Add page translations (limit to avoid token overflow)
  const translatedPages = pages.filter(p => p.translation?.data);

  if (translatedPages.length > 0) {
    context += `\n## Page Contents\n`;

    // For shorter books, include all pages
    // For longer books, include first/last pages and summaries
    const maxPages = 50;
    const pagesToInclude = translatedPages.length <= maxPages
      ? translatedPages
      : [
          ...translatedPages.slice(0, 20),
          ...translatedPages.slice(-10)
        ];

    for (const page of pagesToInclude) {
      // Clean translation text (remove metadata tags)
      const cleanText = (page.translation?.data || '')
        .replace(/\[\[[^\]]+\]\]/g, '')
        .replace(/^```(?:markdown)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();

      if (cleanText.length > 50) {
        // Limit each page to ~500 chars to fit more pages
        const truncated = cleanText.length > 500
          ? cleanText.substring(0, 500) + '...'
          : cleanText;
        context += `\n### Page ${page.page_number}\n${truncated}\n`;
      }
    }

    if (translatedPages.length > maxPages) {
      context += `\n(Note: ${translatedPages.length - 30} middle pages omitted for brevity)\n`;
    }
  }

  return context;
}

// POST /api/books/[id]/chat - Chat with the book
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { messages } = await request.json() as { messages: Message[] };

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Messages array required' },
        { status: 400 }
      );
    }

    // Build book context
    const bookContext = await buildBookContext(id);

    // Create the model
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // System prompt
    const systemPrompt = `You are a knowledgeable guide helping readers understand a historical text. You have access to the book's content below.

${bookContext}

## Instructions
- Answer questions based on the book's actual content
- **IMPORTANT**: When referencing the text, include direct quotes and cite like this:
  > "quoted text from the source" [Page 5]
- Use blockquotes (>) for direct quotes from the text
- Always include the page number after quotes: [Page X]
- If asked about something not in the text, say so honestly
- Explain archaic or technical terms in modern language
- Be conversational but scholarly
- Keep responses concise unless asked for detail
- If the user hasn't asked a question yet, give a brief welcome and ask what they'd like to explore

## Quote Format Example
When the text says something relevant, quote it like:
> "The soul is immortal and imperishable" [Page 12]

This helps readers verify and explore further.`;

    // Build conversation history for Gemini
    const chatHistory = messages.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    const lastMessage = messages[messages.length - 1];

    // Start chat with history
    const chat = model.startChat({
      history: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'I understand. I\'m ready to help readers explore this text.' }] },
        ...chatHistory,
      ],
    });

    // Send the latest message
    const result = await chat.sendMessage(lastMessage.content);
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
}

// GET /api/books/[id]/chat - Get initial greeting with summary
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
