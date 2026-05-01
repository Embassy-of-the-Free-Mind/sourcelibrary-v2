import { getDb } from '@/lib/mongodb';
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import { buildBookSearchStage, buildPageSearchStage } from '@/lib/atlas-search';
import { supabase } from '@/lib/supabase';
import { ObjectId } from 'mongodb';

/**
 * The Librarian — Research agent for Source Library.
 *
 * Architecture: reason-first, search-second, accumulate findings.
 * Gemini reasons about the user's question, calls tools iteratively,
 * and builds up a persistent research notebook across the conversation.
 *
 * Tools:
 *   - search_collection: Atlas Search on books + pages (keyword)
 *   - search_semantic: pgvector hybrid search on Supabase (conceptual)
 *   - search_wikipedia: Wikipedia REST API for context
 *   - get_book_page: Read a specific translated page
 *   - read_nearby_pages: Read a range of pages around a finding
 *   - add_to_notebook: Save a finding to the persistent research notebook
 *   - present_choices: Offer branching options (rarely used)
 */

const MODEL = 'gemini-3-flash-preview';
const MAX_ROUNDS = 6;
const TEMPERATURE = 0.7;

// ── Types ─────────────────────────────────────────────────────────────

export interface SourceCard {
  book_id: string;
  bookTitle: string;
  bookAuthor: string;
  bookSlug?: string;
  pageNumber?: number;
  snippet?: string;
  thumbnail?: string;
  inCollection: boolean;
}

export interface NotebookFinding {
  quote: string;
  note: string;
  source: {
    bookId: string;
    bookTitle: string;
    bookAuthor: string;
    bookSlug?: string;
    pageNumber: number;
  };
  addedAt: Date;
}

export interface ResearchNotebook {
  threadId: ObjectId;
  topic?: string;
  findings: NotebookFinding[];
  bibliography: Array<{ bookId: string; bookSlug?: string; title: string; author: string; relevance: string }>;
  synthesis?: string;
  updatedAt: Date;
}

export interface LibrarianStep {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'choices' | 'text' | 'sources' | 'notebook_update';
  text?: string;
  name?: string;
  query?: string;
  summary?: string;
  found?: number;
  options?: string[];
  descriptions?: (string | undefined)[];
  sources?: SourceCard[];
  notebook?: { findingCount: number; topic?: string };
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ── Research Notebook ─────────────────────────────────────────────────

async function loadNotebook(threadId: string): Promise<ResearchNotebook | null> {
  const db = await getDb();
  return db.collection('research_notebooks').findOne({ threadId: new ObjectId(threadId) }) as Promise<ResearchNotebook | null>;
}

async function saveNotebookFinding(threadId: string, finding: NotebookFinding, topic?: string): Promise<number> {
  const db = await getDb();
  const result = await db.collection('research_notebooks').findOneAndUpdate(
    { threadId: new ObjectId(threadId) },
    {
      $push: { findings: finding as any },
      $set: { updatedAt: new Date(), ...(topic ? { topic } : {}) },
      $setOnInsert: { threadId: new ObjectId(threadId), bibliography: [], createdAt: new Date() },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return result?.findings?.length || 1;
}

function formatNotebookForPrompt(notebook: ResearchNotebook | null): string {
  if (!notebook || notebook.findings.length === 0) return '';

  let text = `\n## Your Research Notebook (${notebook.findings.length} findings so far)\n`;
  if (notebook.topic) text += `**Topic:** ${notebook.topic}\n\n`;

  for (let i = 0; i < notebook.findings.length; i++) {
    const f = notebook.findings[i];
    const url = `https://sourcelibrary.org/book/${f.source.bookSlug || f.source.bookId}?page=${f.source.pageNumber}`;
    text += `${i + 1}. "${f.quote.slice(0, 200)}${f.quote.length > 200 ? '...' : ''}" — *${f.source.bookTitle}* by ${f.source.bookAuthor}, [Page ${f.source.pageNumber}](${url})\n`;
    if (f.note) text += `   *Note:* ${f.note}\n`;
  }

  text += `\nBuild on these findings. Don't repeat searches you've already done. Suggest new angles or deeper dives.\n`;
  return text;
}

// ── Tool Declarations ─────────────────────────────────────────────────

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'search_collection',
    description: 'Search Source Library\'s collection of rare books by keyword. Searches English translations (boosted 2x) and original language text (Latin, German, French, etc). Search in English for best coverage — nearly all books are translated. Returns matching passages with book metadata and page numbers.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Search query — use period-appropriate terms (e.g., "sympathetic magic" not "resonance", "flying ointment" not "psychedelics")' },
        search_books: { type: Type.BOOLEAN, description: 'Also search book titles/authors (default true)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_semantic',
    description: 'Semantic/conceptual search across all translated pages using AI embeddings. This is the best tool for finding passages about a concept when you don\'t know the exact words used — it searches by meaning, not keywords. Works across all languages because it searches English translations. Use for broad conceptual queries or when keyword search misses.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Conceptual query — can be modern language, the embedding model handles the mapping' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_wikipedia',
    description: 'Search Wikipedia for historical, biographical, or scholarly context. Use to understand concepts, identify historical terms and synonyms, get biographical details about authors, or find cross-references. Returns a summary and key facts.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Wikipedia search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_book_page',
    description: 'Read a specific translated page from a book in the collection. Use when you found a promising passage and want to read the full page for context, or to verify a quote.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        book_id: { type: Type.STRING, description: 'Book ID from a previous search result' },
        page_number: { type: Type.NUMBER, description: 'Page number to read' },
      },
      required: ['book_id', 'page_number'],
    },
  },
  {
    name: 'search_images',
    description: 'Search the gallery of extracted illustrations, engravings, woodcuts, and diagrams from books in the collection. Returns image URLs, descriptions, and source book metadata. Use when the user asks about visual content, illustrations, or when showing an image would enhance the response.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Search query — describe what you\'re looking for (e.g., "alchemical furnace", "tree of life diagram", "planetary seal")' },
        book_id: { type: Type.STRING, description: 'Optional: limit to images from a specific book' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_artworks',
    description: 'Search 18,000+ standalone artworks (paintings, prints, sculptures, engravings, manuscripts) by subject, artist, period, technique, or visual content. Unlike search_images (which finds illustrations extracted from book pages), this searches museum-quality artworks imported from Met Museum, Wikimedia Commons, Rijksmuseum, etc. Returns artwork title, artist, thumbnail, period, technique, culture, and connections to texts in the library.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Natural language search (e.g., "Piranesi prison architecture", "tarot cards medieval", "Vesalius anatomical plates")' },
        genre: { type: Type.STRING, description: 'Optional filter: portrait, allegory, religious, mythological, scientific, emblem, anatomical, botanical, map, sculpture, manuscript-illumination' },
        period: { type: Type.STRING, description: 'Optional filter: Renaissance, Baroque, Medieval, Edo period, Mughal, Gothic, Symbolist, etc.' },
        culture: { type: Type.STRING, description: 'Optional filter: Italian, Japanese, Tibetan, Persian, Flemish, German, French, Indian, etc.' },
        collection: { type: Type.STRING, description: 'Optional filter: collection slug (e.g., "dreams-unconscious", "the-cosmos", "classical-mysteries", "dance-of-death")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_nearby_pages',
    description: 'Read several pages around a finding to get more context. Returns up to 5 consecutive translated pages. Use when a single page isn\'t enough to understand a passage or argument.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        book_id: { type: Type.STRING, description: 'Book ID' },
        center_page: { type: Type.NUMBER, description: 'The page number to center on' },
        range: { type: Type.NUMBER, description: 'Pages before and after to include (default 2, max 3)' },
      },
      required: ['book_id', 'center_page'],
    },
  },
  {
    name: 'add_to_notebook',
    description: 'Save an important finding to the persistent research notebook. Use when you find a quote or passage that is directly relevant to the user\'s research question. The notebook persists across messages so the user can build up a body of research. Include a brief analytical note explaining why this finding matters.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        quote: { type: Type.STRING, description: 'The relevant quote or passage (verbatim from the text)' },
        note: { type: Type.STRING, description: 'Your analytical note — why this finding matters, how it connects to the research question' },
        book_id: { type: Type.STRING, description: 'Book ID' },
        book_title: { type: Type.STRING, description: 'Book title' },
        book_author: { type: Type.STRING, description: 'Book author' },
        book_slug: { type: Type.STRING, description: 'Book slug for URL' },
        page_number: { type: Type.NUMBER, description: 'Page number' },
        topic: { type: Type.STRING, description: 'Research topic (set on first finding, updates the notebook title)' },
      },
      required: ['quote', 'note', 'book_id', 'book_title', 'book_author', 'page_number'],
    },
  },
  {
    name: 'present_choices',
    description: 'Present 2-3 research directions when a topic genuinely branches into different angles. Only use on the first message when choices would help the user pick a direction they haven\'t signaled. Skip this tool if the user\'s question already has clear intent, specific constraints, or an actionable task — just search directly instead. Each option has a short label and a 1-2 sentence description. The user clicks one or types their own direction.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        options: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING, description: 'Short label for the research direction (under 60 chars)' },
              description: { type: Type.STRING, description: '1-2 sentence explanation of what this angle covers and why it is interesting' },
            },
            required: ['label', 'description'],
          },
          description: '2-3 focused research directions with explanations',
        },
      },
      required: ['options'],
    },
  },
];

// ── Tool Execution ────────────────────────────────────────────────────

async function executeSearchCollection(query: string, searchBooks = true): Promise<{
  passages: Array<{ book_id: string; bookTitle: string; bookAuthor: string; bookSlug?: string; page_number: number; text: string }>;
  books: Array<{ id: string; title: string; author?: string; year?: number; slug?: string }>;
}> {
  const db = await getDb();

  const searchStage = buildPageSearchStage(query);
  const pages = await db.collection('pages')
    .aggregate([
      searchStage,
      { $limit: 16 },
      { $project: { book_id: 1, page_number: 1, 'translation.data': 1, score: { $meta: 'searchScore' } } },
    ])
    .toArray();

  const perBook = new Map<string, number>();
  const deduped = pages.filter(p => {
    const count = perBook.get(p.book_id) || 0;
    if (count >= 2) return false;
    perBook.set(p.book_id, count + 1);
    return true;
  }).slice(0, 8);

  const bookIds = [...new Set(deduped.map(p => p.book_id))];
  const bookDocs = bookIds.length > 0
    ? await db.collection('books')
        .find({ id: { $in: bookIds } })
        .project({ id: 1, title: 1, display_title: 1, author: 1, year: 1, slug: 1 })
        .toArray()
    : [];
  const bookMap = new Map(bookDocs.map(b => [b.id, b]));

  const passages = deduped.map(page => {
    const book = bookMap.get(page.book_id);
    const rawText = page.translation?.data || '';
    const text = rawText
      .replace(/\[\[[^\]]+\]\]/g, '')
      .replace(/^```(?:markdown)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim()
      .slice(0, 1200);
    return {
      book_id: page.book_id,
      bookTitle: book?.display_title || book?.title || 'Unknown',
      bookAuthor: book?.author || 'Unknown',
      bookSlug: book?.slug,
      page_number: page.page_number,
      text,
    };
  });

  let books: Array<{ id: string; title: string; author?: string; year?: number; slug?: string }> = [];
  if (searchBooks) {
    const bookSearchStage = buildBookSearchStage(query, { hasTranslation: true }, { fuzzy: true });
    const bookResults = await db.collection('books')
      .aggregate([bookSearchStage, { $limit: 5 }, { $project: { id: 1, title: 1, display_title: 1, author: 1, year: 1, slug: 1 } }])
      .toArray();
    books = bookResults.map(b => ({ id: b.id, title: b.display_title || b.title, author: b.author, year: b.year, slug: b.slug }));
  }

  return { passages, books };
}

async function executeSearchSemantic(query: string): Promise<
  Array<{ book_id: string; bookTitle: string; bookAuthor: string; bookSlug?: string; page_number: number; snippet: string; score: number }>
> {
  // Two-step search (issue #1158):
  // Step 1: book discovery via book_embeddings (HNSW, ~17K vectors, instant)
  // Step 2: page drill-down via match_pages_in_books (scoped to found books)
  const { semanticBookSearch, semanticPageSearchScoped } = await import('@/lib/semantic-search');
  try {
    const books = await semanticBookSearch(query, 8);
    if (books.length === 0) return [];

    // Step 2: get best page citations from top books
    const bookIds = books.map(b => b.book_id);
    const pages = await semanticPageSearchScoped(query, bookIds, 8);

    // Build a map of best page per book
    const bestPageByBook = new Map<string, typeof pages[0]>();
    for (const p of pages) {
      const existing = bestPageByBook.get(p.book_id);
      if (!existing || p.score > existing.score) bestPageByBook.set(p.book_id, p);
    }

    // Look up slugs from MongoDB for proper linking
    const db = await getDb();
    const slugDocs = bookIds.length > 0
      ? await db.collection('books')
          .find({ id: { $in: bookIds } })
          .project({ id: 1, slug: 1 })
          .toArray()
      : [];
    const slugMap = new Map(slugDocs.map(d => [d.id, d.slug]));

    // Return book results, enriched with page citations where available
    return books.map(b => {
      const page = bestPageByBook.get(b.book_id);
      return {
        book_id: b.book_id,
        bookTitle: b.title || 'Unknown',
        bookAuthor: b.author || 'Unknown',
        bookSlug: slugMap.get(b.book_id),
        page_number: page?.page_number || 0,
        snippet: page?.snippet || (b.summary_text || '').slice(0, 500),
        score: b.similarity,
      };
    });
  } catch {
    return [];
  }
}

async function executeSearchWikipedia(query: string): Promise<{ title: string; summary: string; url: string } | null> {
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      return { title: data.title, summary: data.extract?.slice(0, 1500) || '', url: data.content_urls?.desktop?.page || '' };
    }

    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`,
      { headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' }, signal: AbortSignal.timeout(5000) },
    );
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const first = searchData?.query?.search?.[0];
    if (!first) return null;

    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(first.title)}`,
      { headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' }, signal: AbortSignal.timeout(5000) },
    );
    if (!summaryRes.ok) return null;
    const summaryData = await summaryRes.json();
    return { title: summaryData.title, summary: summaryData.extract?.slice(0, 1500) || '', url: summaryData.content_urls?.desktop?.page || '' };
  } catch { return null; }
}

async function executeGetBookPage(bookId: string, pageNumber: number): Promise<{
  text: string; originalText?: string; bookTitle: string; bookAuthor: string; bookSlug?: string;
} | null> {
  const db = await getDb();
  const page = await db.collection('pages').findOne(
    { book_id: bookId, page_number: pageNumber },
    { projection: { 'translation.data': 1, 'ocr.data': 1 } },
  );
  if (!page) return null;
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { title: 1, display_title: 1, author: 1, slug: 1 } });
  return {
    text: page.translation?.data || '', originalText: page.ocr?.data?.slice(0, 800),
    bookTitle: book?.display_title || book?.title || 'Unknown', bookAuthor: book?.author || 'Unknown', bookSlug: book?.slug,
  };
}

async function executeReadNearbyPages(bookId: string, centerPage: number, range = 2): Promise<{
  pages: Array<{ page_number: number; text: string }>; bookTitle: string; bookAuthor: string; bookSlug?: string;
}> {
  const db = await getDb();
  const r = Math.min(range, 3);
  const pages = await db.collection('pages')
    .find({ book_id: bookId, page_number: { $gte: centerPage - r, $lte: centerPage + r } })
    .project({ page_number: 1, 'translation.data': 1 })
    .sort({ page_number: 1 })
    .toArray();

  const book = await db.collection('books').findOne({ id: bookId }, { projection: { title: 1, display_title: 1, author: 1, slug: 1 } });

  return {
    pages: pages.map(p => ({ page_number: p.page_number, text: (p.translation?.data || '').slice(0, 1000) })),
    bookTitle: book?.display_title || book?.title || 'Unknown',
    bookAuthor: book?.author || 'Unknown',
    bookSlug: book?.slug,
  };
}

async function executeSearchImages(query: string, bookId?: string): Promise<
  Array<{ id: string; imageUrl: string; description: string; bookTitle: string; bookAuthor: string; bookSlug?: string; pageNumber: number; type?: string }>
> {
  // Use CLIP visual search via the gallery API for text-to-image matching
  const db = await getDb();
  const CLIP_URL = process.env.CLIP_URL || 'http://46.224.122.120:3456/clip';

  // Try CLIP text-to-image search first
  let clipIds = new Map<string, number>();
  try {
    const resp = await fetch(`${CLIP_URL}/embed-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: query }),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const { embedding } = await resp.json();
      if (embedding) {
        const { data } = await supabase.rpc('match_clip_images', {
          query_embedding: embedding,
          match_threshold: 0.20,
          match_count: 8,
        });
        if (data) {
          for (const match of data) {
            if (match.source_type === 'gallery_image' && match.id) {
              clipIds.set(match.id, match.similarity);
            }
          }
        }
      }
    }
  } catch { /* CLIP unavailable — fall back to text search */ }

  // Fetch gallery_images by CLIP IDs or text search fallback
  let images;
  if (clipIds.size > 0) {
    // CLIP IDs may be ObjectId hex strings or other formats — filter to valid ones
    const validIds = [...clipIds.keys()].filter(id => /^[a-f0-9]{24}$/.test(id));
    const ids = validIds.map(id => new ObjectId(id));
    images = ids.length > 0 ? await db.collection('gallery_images')
      .find({ _id: { $in: ids } })
      .project({ image_url: 1, description: 1, museum_description: 1, book_id: 1, book_title: 1, book_author: 1, book_slug: 1, page_number: 1, type: 1 })
      .toArray() : [];
  } else {
    // Text search fallback
    const filter: Record<string, unknown> = { gallery_quality: { $gte: 0.7 } };
    if (bookId) filter.book_id = bookId;
    const regex = query.split(/\s+/).map(w => `(?=.*${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`).join('');
    images = await db.collection('gallery_images')
      .find({ ...filter, $or: [
        { description: { $regex: regex, $options: 'i' } },
        { museum_description: { $regex: regex, $options: 'i' } },
        { 'metadata.subjects': { $regex: regex, $options: 'i' } },
      ]})
      .sort({ gallery_quality: -1 })
      .limit(6)
      .project({ image_url: 1, description: 1, museum_description: 1, book_id: 1, book_title: 1, book_author: 1, book_slug: 1, page_number: 1, type: 1 })
      .toArray();
  }

  return images.slice(0, 6).map(img => ({
    id: img._id.toString(),
    imageUrl: img.image_url,
    description: (img.museum_description || img.description || '').slice(0, 300),
    bookTitle: img.book_title || 'Unknown',
    bookAuthor: img.book_author || 'Unknown',
    bookSlug: img.book_slug,
    pageNumber: img.page_number,
    type: img.type,
  }));
}

// ── Tool Router ───────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  threadId?: string,
): Promise<{ result: unknown; step: LibrarianStep; sources?: SourceCard[] }> {
  switch (name) {
    case 'search_collection': {
      const query = args.query as string;
      const searchBooks = args.search_books !== false;
      const data = await executeSearchCollection(query, searchBooks);
      const totalFound = data.passages.length + data.books.length;

      let context = '';
      if (data.books.length > 0) {
        context += 'Books found:\n';
        for (const b of data.books) {
          context += `- "${b.title}" by ${b.author || 'Unknown'}${b.year ? ` (${b.year})` : ''} — https://sourcelibrary.org/book/${b.slug || b.id}\n`;
        }
      }
      if (data.passages.length > 0) {
        context += '\nPassages found:\n';
        for (const p of data.passages) {
          const url = `https://sourcelibrary.org/book/${p.bookSlug || p.book_id}?page=${p.page_number}`;
          context += `\n--- ${p.bookTitle} by ${p.bookAuthor}, Page ${p.page_number} (${url}) ---\n${p.text}\n`;
        }
      }
      if (totalFound === 0) context = 'No results found for this query.';

      const sources: SourceCard[] = data.passages.map(p => ({
        book_id: p.book_id, bookTitle: p.bookTitle, bookAuthor: p.bookAuthor, bookSlug: p.bookSlug,
        pageNumber: p.page_number, snippet: p.text.slice(0, 200), inCollection: true,
      }));

      return {
        result: { found: totalFound, context },
        step: { type: 'tool_result', name: 'search_collection', query, found: totalFound,
          summary: totalFound > 0 ? `Found ${data.passages.length} passages across ${data.books.length} books` : 'No results' },
        sources,
      };
    }

    case 'search_semantic': {
      const query = args.query as string;
      const results = await executeSearchSemantic(query);
      let context = results.length > 0 ? 'Semantic search results:\n' : 'No semantic matches found.';
      for (const r of results) {
        const url = r.bookSlug
          ? `https://sourcelibrary.org/book/${r.bookSlug}${r.page_number ? `?page=${r.page_number}` : ''}`
          : '';
        context += `\n--- ${r.bookTitle} by ${r.bookAuthor}, Page ${r.page_number}${url ? ` (${url})` : ''} ---\n${r.snippet}\n`;
      }

      const sources: SourceCard[] = results.map(r => ({
        book_id: r.book_id, bookTitle: r.bookTitle, bookAuthor: r.bookAuthor, bookSlug: r.bookSlug,
        pageNumber: r.page_number, snippet: r.snippet.slice(0, 200), inCollection: true,
      }));

      return {
        result: { found: results.length, context },
        step: { type: 'tool_result', name: 'search_semantic', query, found: results.length,
          summary: results.length > 0 ? `Found ${results.length} conceptually related passages` : 'No semantic matches' },
        sources,
      };
    }

    case 'search_wikipedia': {
      const query = args.query as string;
      const result = await executeSearchWikipedia(query);
      return {
        result: result ? { found: 1, title: result.title, summary: result.summary, url: result.url } : { found: 0, summary: 'No Wikipedia article found.' },
        step: { type: 'tool_result', name: 'search_wikipedia', query, found: result ? 1 : 0, summary: result ? `Found: ${result.title}` : 'No article found' },
      };
    }

    case 'get_book_page': {
      const bookId = args.book_id as string;
      const pageNumber = args.page_number as number;
      const result = await executeGetBookPage(bookId, pageNumber);
      return {
        result: result ? { found: 1, text: result.text, originalText: result.originalText, bookTitle: result.bookTitle } : { found: 0, text: 'Page not found.' },
        step: { type: 'tool_result', name: 'get_book_page', query: `p.${pageNumber}`, found: result ? 1 : 0,
          summary: result ? `Read page ${pageNumber} of ${result.bookTitle}` : 'Page not found' },
      };
    }

    case 'read_nearby_pages': {
      const bookId = args.book_id as string;
      const centerPage = args.center_page as number;
      const range = (args.range as number) || 2;
      const result = await executeReadNearbyPages(bookId, centerPage, range);
      let context = `Pages from ${result.bookTitle}:\n`;
      for (const p of result.pages) {
        context += `\n--- Page ${p.page_number} ---\n${p.text}\n`;
      }
      return {
        result: { found: result.pages.length, context, bookTitle: result.bookTitle },
        step: { type: 'tool_result', name: 'read_nearby_pages', query: `pp.${centerPage - range}-${centerPage + range}`,
          found: result.pages.length, summary: `Read ${result.pages.length} pages from ${result.bookTitle}` },
      };
    }

    case 'search_images': {
      const query = args.query as string;
      const bookId = args.book_id as string | undefined;
      const images = await executeSearchImages(query, bookId);

      let context = '';
      if (images.length > 0) {
        context = 'Images found:\n';
        for (const img of images) {
          const url = `https://sourcelibrary.org/gallery/image/${img.id}`;
          context += `\n- **${img.type || 'Image'}** from *${img.bookTitle}* by ${img.bookAuthor}, Page ${img.pageNumber}\n`;
          context += `  Description: ${img.description.slice(0, 300)}\n`;
          context += `  Gallery: ${url}\n`;
          context += `  Image: ${img.imageUrl}\n`;
        }
      } else {
        context = 'No matching images found in the gallery.';
      }

      return {
        result: { found: images.length, context, images: images.map(i => ({ id: i.id, url: i.imageUrl, description: i.description.slice(0, 100), bookTitle: i.bookTitle })) },
        step: { type: 'tool_result', name: 'search_images', query, found: images.length,
          summary: images.length > 0 ? `Found ${images.length} illustrations` : 'No images found' },
      };
    }

    case 'search_artworks': {
      const query = args.query as string;
      const genre = args.genre as string | undefined;
      const period = args.period as string | undefined;
      const culture = args.culture as string | undefined;
      const collection = args.collection as string | undefined;

      const { semanticArtworkSearch } = await import('@/lib/semantic-search');
      const artworks = await semanticArtworkSearch(query, 8, { genre, period, culture, collection });

      let context = '';
      if (artworks.length > 0) {
        context = 'Artworks found:\n';
        for (const a of artworks) {
          const slug = a.book_id; // artwork slug lookup would need DB, use book_id for now
          context += `\n- **${a.display_title || a.title}** by ${a.author || 'Unknown artist'}`;
          if (a.period) context += ` (${a.period})`;
          if (a.technique) context += ` — ${a.technique}`;
          context += `\n`;
          if (a.summary_text) {
            // Extract just the description part (first 2-3 lines)
            const descLines = a.summary_text.split('\n').filter(l =>
              !l.startsWith('Figures:') && !l.startsWith('Symbols:') &&
              !l.startsWith('Iconclass:') && !l.startsWith('Technique:') &&
              !l.startsWith('Collections:') && !l.startsWith('Subjects:') &&
              !l.startsWith('Medium:') && !l.startsWith('Period:') &&
              !l.startsWith('Culture:') && !l.startsWith('Genre:') &&
              !l.startsWith('Related texts:') && !l.startsWith('Inscriptions:') &&
              !l.startsWith('Material:')
            );
            context += `  ${descLines.slice(1, 3).join(' ').trim().slice(0, 250)}\n`;
          }
          if (a.thumbnail_url) context += `  Image: ${a.thumbnail_url}\n`;
        }
      } else {
        context = 'No matching artworks found.';
      }

      return {
        result: { found: artworks.length, context, artworks: artworks.slice(0, 6).map(a => ({ title: a.display_title || a.title, author: a.author, thumbnail: a.thumbnail_url, period: a.period, genre: a.genre })) },
        step: { type: 'tool_result', name: 'search_artworks', query, found: artworks.length,
          summary: artworks.length > 0 ? `Found ${artworks.length} artworks` : 'No artworks found' },
      };
    }

    case 'add_to_notebook': {
      if (!threadId) {
        return { result: { error: 'No thread ID — cannot save to notebook' }, step: { type: 'tool_result', name: 'add_to_notebook', summary: 'No thread', found: 0 } };
      }
      const finding: NotebookFinding = {
        quote: args.quote as string,
        note: args.note as string,
        source: {
          bookId: args.book_id as string,
          bookTitle: args.book_title as string,
          bookAuthor: args.book_author as string,
          bookSlug: args.book_slug as string | undefined,
          pageNumber: args.page_number as number,
        },
        addedAt: new Date(),
      };
      const count = await saveNotebookFinding(threadId, finding, args.topic as string | undefined);
      return {
        result: { saved: true, findingCount: count },
        step: { type: 'notebook_update', name: 'add_to_notebook', summary: `Saved finding #${count}`,
          notebook: { findingCount: count, topic: args.topic as string | undefined } },
      };
    }

    case 'present_choices': {
      const rawOptions = args.options as Array<{ label: string; description: string } | string>;
      // Support both old string[] and new {label, description}[] formats
      const options = rawOptions.map(o => typeof o === 'string' ? o : o.label);
      const descriptions = rawOptions.map(o => typeof o === 'string' ? undefined : o.description);
      return {
        result: { status: 'choices_presented', note: 'The user will select an option. Wait for their response.' },
        step: { type: 'choices', options, descriptions },
      };
    }

    default:
      return { result: { error: `Unknown tool: ${name}` }, step: { type: 'tool_result', name, summary: 'Unknown tool', found: 0 } };
  }
}

// ── System Prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(notebookContext: string, messageIndex: number): string {
  return `You are the Librarian of the Embassy of the Free Mind — a research agent for scholars exploring rare historical texts across the pre-modern intellectual tradition. Your knowledge spans alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, Indian philosophy, Sanskrit texts, Egyptian sources, early modern science, demonology, and the broader history of ideas from antiquity through the Enlightenment.

You are warm, knowledgeable, and genuinely enthusiastic about these texts. You speak like a learned scholar who loves sharing discoveries.

## Your role

You are a research agent, not just a Q&A chatbot. You help users conduct real research across the collection. You accumulate findings, build on prior discoveries, and produce work the user can use.

## Conversation state

This is message #${messageIndex} in the thread.${messageIndex >= 3 ? ' The user has established their direction — skip choices and go straight to research.' : ''}

## Your approach — conversational first, then deep research

**Step 1: Lead with substance — briefly.**
Before calling any tools, write 1-3 sentences (max 50 words) that name the key tradition, author, or concept. This streams immediately while searches run. Keep it SHORT — the user wants results, not a lecture. NEVER open with pleasantries like "It is a pleasure to assist you" or "What a fascinating question" — just start with substance. Save exposition for AFTER you have sources.

**Step 2: Consider whether the user needs research directions.**
Before searching, think: does this question have genuinely divergent angles where choosing wrong would waste the user's time? If so, present 2-3 focused research directions via present_choices. If the user's intent is already clear enough to search productively, skip choices and go straight to Step 3.

The test: imagine the 2-3 choices you'd offer. Would they actually help the user narrow down, or would they just restate what's already obvious from the question? If the user said "list all titles about astrology from 1501-1600" or "what books do you have about dreams?", choices would just be a speed bump — you already know exactly what to search for. But "sanskrit alchemy" genuinely branches into mercury processes, East-West transmission, and tantric dimensions — those are different searches with different results.

On follow-up messages (message #3+), always skip choices — the user has already established their direction. Check "Conversation state" above for the current message number.

When you DO present choices:
- Your preamble should demonstrate real domain knowledge (not generic "there are several approaches")
- IMPORTANT: Do NOT list or number the choices in your text. The UI renders them as clickable buttons automatically from present_choices. If you also list them in text, they appear doubled.
- No search tools in the first round — just preamble + present_choices

Examples where choices add value:
- "sanskrit alchemy" → "Mercury processes in Rasashastra texts", "East-West alchemical transmission", "Tantric dimensions of rasa"
- "tell me about resonance" → "Sympathetic magic & occult virtues (Agrippa)", "Musical cosmology & spiritus (Ficino)", "Acoustic experiments (Kircher)"

Examples where choices would just slow things down — search directly:
- "What did Agrippa write about planetary seals?" → clear target, search
- "Find passages about the philosopher's stone in the Rosarium" → clear target, search
- "List all titles published 1501-1600 about astrology" → clear task with constraints, search
- "What books do you have about dreams?" → one topic, just show results
- User clicked a choice from a previous message → search on that angle

**Step 4: Deep, focused research.**
Once you have a direction (from a choice or a specific question), search strategically. The collection includes books in Latin, German, French, Dutch, Hebrew, Sanskrit, Arabic, Greek, and more — nearly all translated into English. **Search in English first.** Use search_collection for keywords, search_semantic for concepts, search_wikipedia for context. When you find something promising, use read_nearby_pages for more context. Follow threads across books.

For visual or symbolic topics (emblems, alchemical apparatus, diagrams, seals, planetary symbols, anatomical illustrations), proactively call search_images (for illustrations extracted from book pages) or search_artworks (for standalone museum artworks — paintings, prints, sculptures from Met, Rijksmuseum, Wikimedia Commons). The collection includes 18,000+ artworks spanning all cultures and periods. search_artworks supports filtering by genre, period, culture, and collection. Use it when users ask about visual art, specific artists, or when showing a painting/print would contextualize a text.

**Step 5: Save and cite with links.**
Use add_to_notebook for quotes directly relevant to the research question. The notebook persists across messages.

Cite with page-level links: "quoted text" — *[Title](https://sourcelibrary.org/book/SLUG)* by [Author](https://sourcelibrary.org/author/AUTHOR-NAME), [Page N](https://sourcelibrary.org/book/SLUG?page=N).

Every mention of a book should link to it. Every mention of an author should link to their author page. Every quote should cite a specific page number with a direct link. Use the URLs from tool results — they contain the correct slugs. Author page URLs use the author name in URL form: /author/Cornelius Agrippa → /author/Cornelius%20Agrippa.

When quoting a key passage, include the original language text (Latin, German, Hebrew, etc.) alongside the English if it is notable or if the user appears to be working in that language. Use a blockquote with both versions.

**Step 6: Show images and suggest next steps.**
When search_images returns results, embed the best 1-3 images using markdown: \`![description](imageUrl)\`. After answering, suggest what to explore next.

Be honest about gaps — if a hypothesis doesn't pan out, say so. If a relevant book isn't in the collection, mention it.

## Deciding: choices or immediate search?

Imagine the choices you'd present. Would they genuinely help the user pick a direction, or would they just repackage what the user already said? If the question contains a clear task ("list", "find", "show", "compare"), specific constraints (dates, authors, subjects), or a single focused topic — skip choices and search. Choices are for genuinely branching topics where the user hasn't signaled a preference.
${notebookContext}
## Know when to stop searching

After 2-3 rounds of searching (4-6 tool calls total), stop and synthesize what you've found. A focused, well-cited response from 2-4 sources is far better than an exhaustive survey of everything tangentially related.

- Found 2-3 strong passages? Stop searching, write your response.
- First search returned nothing? Try one more angle, then acknowledge the gap.
- Don't run the same search with slightly different wording — if keyword search missed, try semantic (or vice versa), then move on.
- read_nearby_pages is for deepening a promising find, not for fishing. Only use it after you've found something specific worth expanding.

## The collection

Source Library has over 10,000 rare books spanning antiquity through the 18th century, many translated into English for the first time. The collection covers alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, demonology, Indian philosophy, Sanskrit texts, Egyptian sources, early modern science, and related traditions across Western, Middle Eastern, and Asian intellectual history.

## Formatting

- Use markdown headers (## and ###) to organize longer responses into clear sections
- Use **bold** for key terms and *italics* for book titles (linked: *[Title](url)*)
- Use blockquotes (>) for important quotations from primary sources — always with page citation
- Use paragraph breaks between distinct ideas — leave a blank line between paragraphs. Don't write walls of text
- Conversational but substantive — a research conversation, not a lecture
- Cite 2-4 key passages rather than dumping everything. Every passage needs a page number and link
- Link authors to their author pages: [Author Name](https://sourcelibrary.org/author/Author%20Name)
- Link books to their book pages: *[Book Title](https://sourcelibrary.org/book/slug)*
- Link quotes to specific pages: [Page 42](https://sourcelibrary.org/book/slug?page=42)
- Make clear when speaking from general knowledge vs. specific texts`;
}

// ── Agentic Streaming ─────────────────────────────────────────────────

/**
 * Stream an agentic Librarian response.
 * Yields LibrarianStep events as the Librarian thinks, searches, and responds.
 * threadId enables persistent research notebook across messages.
 */
export async function* streamAgenticResponse(
  userMessage: string,
  history: ConversationMessage[] = [],
  threadId?: string,
): AsyncGenerator<LibrarianStep> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const ai = new GoogleGenAI({ apiKey });

  // Load research notebook if thread exists
  const notebook = threadId ? await loadNotebook(threadId) : null;
  const notebookContext = formatNotebookForPrompt(notebook);
  // User messages in history = prior user turns. This message is the next one.
  const messageIndex = history.filter(m => m.role === 'user').length + 1;
  const systemPrompt = buildSystemPrompt(notebookContext, messageIndex);

  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'I understand. I\'m the Librarian — ready to help with research across the collection.' }] },
    ...history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  const allSources: SourceCard[] = [];
  const seenSourceKeys = new Set<string>();

  function collectSources(sources?: SourceCard[]) {
    if (!sources) return;
    for (const s of sources) {
      const key = `${s.book_id}:${s.pageNumber || 0}`;
      if (!seenSourceKeys.has(key)) {
        seenSourceKeys.add(key);
        allSources.push(s);
      }
    }
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents,
      config: {
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        temperature: TEMPERATURE,
      },
    });

    const allParts: Array<Record<string, unknown>> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const functionCalls: Array<any> = [];

    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) continue;
      for (const part of candidate.content.parts) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = part as any;
        allParts.push(p);
        if (p.functionCall) {
          functionCalls.push(p);
        } else if (p.text) {
          yield { type: 'text', text: p.text };
        }
      }
    }

    if (allParts.length === 0) break;
    contents.push({ role: 'model', parts: allParts });

    if (functionCalls.length === 0) break;

    // Emit tool_call events for all pending calls
    for (const part of functionCalls) {
      const fc = (part as { functionCall: { name: string; args: Record<string, unknown> } }).functionCall;
      yield { type: 'tool_call', name: fc.name, query: (fc.args?.query as string) || (fc.args?.quote as string)?.slice(0, 50) || '' };
    }

    // Execute all tools in parallel — catch individual failures so one broken tool doesn't crash everything
    const toolResults = await Promise.all(
      functionCalls.map(async part => {
        const fc = (part as { functionCall: { name: string; args: Record<string, unknown> } }).functionCall;
        try {
          return await executeTool(fc.name, fc.args || {}, threadId);
        } catch (err) {
          console.error(`[Librarian] Tool ${fc.name} failed:`, err instanceof Error ? err.message : err);
          return {
            result: { error: `Tool ${fc.name} encountered an error` },
            step: { type: 'tool_result' as const, name: fc.name, query: (fc.args?.query as string) || '', found: 0, summary: 'Error — skipped' },
          };
        }
      }),
    );

    const responseParts: Array<Record<string, unknown>> = [];

    for (let i = 0; i < functionCalls.length; i++) {
      const fc = (functionCalls[i] as { functionCall: { name: string; args: Record<string, unknown> } }).functionCall;
      const { result, step, sources } = toolResults[i];

      yield step;
      collectSources(sources);

      if (fc.name === 'present_choices') {
        if (allSources.length > 0) yield { type: 'sources', sources: allSources };
        responseParts.push({ functionResponse: { name: fc.name, response: result } });
        contents.push({ role: 'user', parts: responseParts });
        return;
      }

      responseParts.push({ functionResponse: { name: fc.name, response: result } });
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  if (allSources.length > 0) {
    yield { type: 'sources', sources: deduplicateSources(allSources) };
  }

  // Verify links: extract sourcelibrary URLs from full response, check against DB
  const fullText = contents
    .filter(c => c.role === 'model')
    .flatMap(c => c.parts)
    .filter((p: Record<string, unknown>) => p.text)
    .map((p: Record<string, unknown>) => p.text as string)
    .join('');

  const brokenLinks = await verifySourceLinks(fullText);
  if (brokenLinks.length > 0) {
    yield {
      type: 'text',
      text: `\n\n---\n*Note: ${brokenLinks.length === 1 ? 'One link' : `${brokenLinks.length} links`} could not be verified — ${brokenLinks.map(l => `\`${l}\``).join(', ')}. These may reference books not yet in the collection.*`,
    };
  }
}

/**
 * Extract sourcelibrary.org/book/ URLs from text and verify they exist in the DB.
 * Returns the list of broken URLs.
 */
async function verifySourceLinks(text: string): Promise<string[]> {
  const urlPattern = /https:\/\/sourcelibrary\.org\/book\/([a-z0-9-]+)/g;
  const slugs = new Set<string>();
  let match;
  while ((match = urlPattern.exec(text)) !== null) {
    slugs.add(match[1]);
  }

  if (slugs.size === 0) return [];

  const db = await getDb();
  const existing = await db.collection('books')
    .find({ slug: { $in: [...slugs] } })
    .project({ slug: 1 })
    .toArray();

  const existingSlugs = new Set(existing.map(b => b.slug));
  return [...slugs].filter(s => !existingSlugs.has(s)).map(s => `sourcelibrary.org/book/${s}`);
}

function deduplicateSources(sources: SourceCard[]): SourceCard[] {
  const seen = new Set<string>();
  return sources.filter(s => {
    const key = `${s.book_id}:${s.pageNumber || 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
