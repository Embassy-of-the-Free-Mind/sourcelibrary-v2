import { getDb } from '@/lib/mongodb';
import { getGeminiClient } from '@/lib/gemini-client';
import { buildBookSearchStage, buildPageSearchStage } from '@/lib/atlas-search';

/**
 * The Librarian — AI assistant for the Embassy Reading Room.
 * Uses Atlas Search (indexed, fast) for corpus-wide retrieval + Gemini for conversation.
 */

interface BookResult {
  id: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  language?: string;
  slug?: string;
}

interface PageResult {
  book_id: string;
  page_number: number;
  text: string;
  bookTitle: string;
  bookAuthor: string;
  bookSlug?: string;
}

/**
 * Search the corpus for passages relevant to a query using Atlas Search.
 * Fast — uses the pages_search index, not regex scans.
 */
export async function searchCorpus(query: string, limit = 8): Promise<PageResult[]> {
  if (!query.trim()) return [];

  const db = await getDb();

  // Atlas Search on pages — searches translation.data (boosted) and ocr.data
  const searchStage = buildPageSearchStage(query);

  const pages = await db.collection('pages')
    .aggregate([
      searchStage,
      { $limit: limit * 2 }, // Fetch extra, then deduplicate by book
      {
        $project: {
          book_id: 1,
          page_number: 1,
          'translation.data': 1,
          score: { $meta: 'searchScore' },
        },
      },
    ])
    .toArray();

  if (pages.length === 0) return [];

  // Deduplicate: max 2 pages per book to get variety across the collection
  const perBook = new Map<string, number>();
  const deduped = pages.filter(p => {
    const count = perBook.get(p.book_id) || 0;
    if (count >= 2) return false;
    perBook.set(p.book_id, count + 1);
    return true;
  }).slice(0, limit);

  // Enrich with book metadata
  const bookIds = [...new Set(deduped.map(p => p.book_id))];
  const books = await db.collection('books')
    .find({ id: { $in: bookIds } })
    .project({ id: 1, title: 1, display_title: 1, author: 1, slug: 1 })
    .toArray();

  const bookMap = new Map(books.map(b => [b.id, b]));

  return deduped.map(page => {
    const book = bookMap.get(page.book_id);
    const rawText = page.translation?.data || '';
    const text = rawText
      .replace(/\[\[[^\]]+\]\]/g, '')
      .replace(/^```(?:markdown)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim()
      .slice(0, 1500);

    return {
      book_id: page.book_id,
      page_number: page.page_number,
      text,
      bookTitle: book?.display_title || book?.title || 'Unknown',
      bookAuthor: book?.author || 'Unknown',
      bookSlug: book?.slug,
    };
  });
}

/**
 * Search for relevant books by title/author using Atlas Search.
 */
export async function searchBooks(query: string, limit = 5): Promise<BookResult[]> {
  if (!query.trim()) return [];

  const db = await getDb();

  const searchStage = buildBookSearchStage(query, { hasTranslation: true }, { fuzzy: true });

  const books = await db.collection('books')
    .aggregate([
      searchStage,
      { $limit: limit },
      {
        $project: {
          id: 1,
          title: 1,
          display_title: 1,
          author: 1,
          year: 1,
          language: 1,
          slug: 1,
        },
      },
    ])
    .toArray();

  return books.map(b => ({
    id: b.id,
    title: b.display_title || b.title,
    display_title: b.display_title,
    author: b.author,
    year: b.year,
    language: b.language,
    slug: b.slug,
  }));
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ReaderActivity {
  bookTitle: string;
  bookAuthor: string;
  bookSlug?: string;
  readerCount: number;
  recentReaders: string[];
}

/**
 * Get recent reading activity — what people are reading in the Embassy.
 * The Librarian uses this to connect people with shared interests.
 */
export async function getRecentReadingActivity(limit = 10): Promise<ReaderActivity[]> {
  const db = await getDb();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const activity = await db.collection('reading_history')
    .aggregate([
      { $match: { started_at: { $gte: oneWeekAgo } } },
      { $group: {
        _id: '$book_id',
        readerIds: { $addToSet: '$user_id' },
        readerCount: { $sum: 1 },
        lastRead: { $max: '$updated_at' },
      }},
      { $match: { readerCount: { $gte: 1 } } },
      { $sort: { readerCount: -1, lastRead: -1 } },
      { $limit: limit },
    ])
    .toArray();

  if (activity.length === 0) return [];

  // Get book metadata
  const bookIds = activity.map(a => a._id);
  const books = await db.collection('books')
    .find({ id: { $in: bookIds } })
    .project({ id: 1, title: 1, display_title: 1, author: 1, slug: 1 })
    .toArray();
  const bookMap = new Map(books.map(b => [b.id, b]));

  // Get reader names (from embassy_profiles or users)
  const allReaderIds = [...new Set(activity.flatMap(a => a.readerIds))];
  const profiles = await db.collection('embassy_profiles')
    .find({ userId: { $in: allReaderIds } })
    .project({ userId: 1, displayName: 1 })
    .toArray();
  const profileMap = new Map(profiles.map(p => [p.userId, p.displayName]));

  return activity.map(a => {
    const book = bookMap.get(a._id);
    return {
      bookTitle: book?.display_title || book?.title || 'Unknown',
      bookAuthor: book?.author || 'Unknown',
      bookSlug: book?.slug,
      readerCount: a.readerIds.length,
      recentReaders: a.readerIds
        .slice(0, 3)
        .map((id: string) => profileMap.get(id) || 'A visitor'),
    };
  }).filter(a => a.bookTitle !== 'Unknown');
}

/**
 * Generate a Librarian response using Atlas Search + Gemini.
 */
export async function generateLibrarianResponse(
  userMessage: string,
  history: ConversationMessage[] = [],
): Promise<{ content: string; sources: PageResult[] }> {
  // Search the corpus for relevant passages + get community activity (parallel)
  const [passages, books, readingActivity] = await Promise.all([
    searchCorpus(userMessage, 8),
    searchBooks(userMessage, 5),
    getRecentReadingActivity(8),
  ]);

  // Build context from search results
  let context = '';

  if (books.length > 0) {
    context += '## Relevant Books in the Collection\n';
    for (const book of books) {
      context += `- **${book.title}** by ${book.author || 'Unknown'}`;
      if (book.year) context += ` (${book.year})`;
      if (book.slug) context += ` — https://sourcelibrary.org/book/${book.slug}`;
      context += '\n';
    }
    context += '\n';
  }

  if (passages.length > 0) {
    context += '## Relevant Passages from the Collection\n';
    for (const p of passages) {
      const bookUrl = p.bookSlug
        ? `https://sourcelibrary.org/book/${p.bookSlug}`
        : `https://sourcelibrary.org/book/${p.book_id}`;
      context += `\n### ${p.bookTitle} by ${p.bookAuthor}, Page ${p.page_number}\n`;
      context += `Source: ${bookUrl}/page/${p.page_number}\n`;
      context += p.text + '\n';
    }
  }

  // Build community context
  let communityContext = '';
  if (readingActivity.length > 0) {
    communityContext = '## Who\'s Reading What This Week\n';
    for (const activity of readingActivity) {
      const bookUrl = activity.bookSlug
        ? `https://sourcelibrary.org/book/${activity.bookSlug}`
        : '';
      const readers = activity.recentReaders.join(', ');
      communityContext += `- **${activity.bookTitle}** by ${activity.bookAuthor}`;
      if (bookUrl) communityContext += ` — ${bookUrl}`;
      communityContext += ` (${activity.readerCount} reader${activity.readerCount > 1 ? 's' : ''}: ${readers})\n`;
    }
    communityContext += '\n';
  }

  const systemPrompt = `You are the Librarian of the Embassy of the Free Mind — a digital scholarly institution dedicated to the Western esoteric tradition. You have deep knowledge of alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, and the intellectual history of the Renaissance and early modern period.

You are warm, knowledgeable, and genuinely enthusiastic about these texts. You speak like a learned scholar who loves sharing discoveries, not like a search engine. You are conversational but substantive.

${context ? `## Source Material from the Collection\n\nThe following texts were found in Source Library's collection of over 5,000 rare books, many translated into English for the first time:\n\n${context}` : '## No Source Material Found\n\nNo directly relevant passages were found in the collection for this query. You can still discuss the topic from your general knowledge, but note when you are speaking from general knowledge vs. from specific texts in the collection.'}

${communityContext ? communityContext : ''}## Instructions
- When citing texts from the collection, use direct quotes with page references and include the full URL so the reader can verify: "quoted text" — *Title* by Author, [Page N](url)
- Recommend specific books from the collection when relevant, with links
- If the query is about a topic you know the collection covers but no passages were found, suggest the user try different search terms
- Be honest about the limits of what's in the collection vs. your general knowledge
- Keep responses focused and conversational — this is a reading room conversation, not a lecture
- Use markdown formatting for readability
- When someone is new, make them feel welcome. The Embassy is a place of open inquiry.
- When relevant, naturally mention what other Embassy visitors have been reading. Connect people with shared interests — "A few visitors have been reading X this week, you might enjoy comparing notes." Don't force it; only mention when genuinely relevant to the conversation.`;

  const model = getGeminiClient().getGenerativeModel({ model: 'gemini-3-flash-preview' });

  const chatHistory = [
    { role: 'user' as const, parts: [{ text: systemPrompt }] },
    { role: 'model' as const, parts: [{ text: 'I understand. I\'m the Librarian of the Embassy, ready to help visitors explore the collection and discuss the Western esoteric tradition.' }] },
    ...history.map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'model') as 'user' | 'model',
      parts: [{ text: msg.content }],
    })),
  ];

  const chat = model.startChat({ history: chatHistory });
  const result = await chat.sendMessage(userMessage);
  const content = result.response.text();

  return { content, sources: passages };
}

/**
 * Stream a Librarian response — yields text chunks as they arrive from Gemini.
 * Used by the SSE chat endpoint for a responsive conversational feel.
 */
export async function streamLibrarianResponse(
  userMessage: string,
  history: ConversationMessage[] = [],
): Promise<{ stream: AsyncIterable<string>; sources: PageResult[]; getFullText: () => string }> {
  const [passages, books, readingActivity] = await Promise.all([
    searchCorpus(userMessage, 8),
    searchBooks(userMessage, 5),
    getRecentReadingActivity(8),
  ]);

  // Reuse same context-building logic
  let context = '';
  if (books.length > 0) {
    context += '## Relevant Books in the Collection\n';
    for (const book of books) {
      context += `- **${book.title}** by ${book.author || 'Unknown'}`;
      if (book.year) context += ` (${book.year})`;
      if (book.slug) context += ` — https://sourcelibrary.org/book/${book.slug}`;
      context += '\n';
    }
    context += '\n';
  }
  if (passages.length > 0) {
    context += '## Relevant Passages from the Collection\n';
    for (const p of passages) {
      const bookUrl = p.bookSlug
        ? `https://sourcelibrary.org/book/${p.bookSlug}`
        : `https://sourcelibrary.org/book/${p.book_id}`;
      context += `\n### ${p.bookTitle} by ${p.bookAuthor}, Page ${p.page_number}\n`;
      context += `Source: ${bookUrl}/page/${p.page_number}\n`;
      context += p.text + '\n';
    }
  }

  let communityContext = '';
  if (readingActivity.length > 0) {
    communityContext = '## Who\'s Reading What This Week\n';
    for (const activity of readingActivity) {
      const bookUrl = activity.bookSlug ? `https://sourcelibrary.org/book/${activity.bookSlug}` : '';
      communityContext += `- **${activity.bookTitle}** by ${activity.bookAuthor}`;
      if (bookUrl) communityContext += ` — ${bookUrl}`;
      communityContext += ` (${activity.readerCount} reader${activity.readerCount > 1 ? 's' : ''}: ${activity.recentReaders.join(', ')})\n`;
    }
    communityContext += '\n';
  }

  const systemPrompt = `You are the Librarian of the Embassy of the Free Mind — a digital scholarly institution dedicated to the Western esoteric tradition. You have deep knowledge of alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, and the intellectual history of the Renaissance and early modern period.

You are warm, knowledgeable, and genuinely enthusiastic about these texts. You speak like a learned scholar who loves sharing discoveries, not like a search engine. You are conversational but substantive.

${context ? `## Source Material from the Collection\n\nThe following texts were found in Source Library's collection of over 5,000 rare books, many translated into English for the first time:\n\n${context}` : '## No Source Material Found\n\nNo directly relevant passages were found in the collection for this query. You can still discuss the topic from your general knowledge, but note when you are speaking from general knowledge vs. from specific texts in the collection.'}

${communityContext}## Instructions
- When citing texts from the collection, use direct quotes with page references and include the full URL so the reader can verify: "quoted text" — *Title* by Author, [Page N](url)
- Recommend specific books from the collection when relevant, with links
- Keep responses focused and conversational — this is a reading room conversation, not a lecture
- Use markdown formatting for readability
- When relevant, naturally mention what other visitors have been reading.`;

  const model = getGeminiClient().getGenerativeModel({ model: 'gemini-3-flash-preview' });
  const chatSession = model.startChat({
    history: [
      { role: 'user' as const, parts: [{ text: systemPrompt }] },
      { role: 'model' as const, parts: [{ text: 'I understand. I\'m the Librarian of the Embassy, ready to help visitors explore the collection.' }] },
      ...history.map(msg => ({
        role: (msg.role === 'user' ? 'user' : 'model') as 'user' | 'model',
        parts: [{ text: msg.content }],
      })),
    ],
  });

  const result = await chatSession.sendMessageStream(userMessage);
  let fullText = '';

  const textStream = {
    async *[Symbol.asyncIterator]() {
      for await (const chunk of result.stream) {
        const text = chunk.text();
        fullText += text;
        yield text;
      }
    },
  };

  return {
    stream: textStream,
    sources: passages,
    getFullText: () => fullText,
  };
}
