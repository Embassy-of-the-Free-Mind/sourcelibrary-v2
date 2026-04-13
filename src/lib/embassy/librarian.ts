import { getDb } from '@/lib/mongodb';
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import { buildBookSearchStage, buildPageSearchStage } from '@/lib/atlas-search';
import { supabase } from '@/lib/supabase';
import { ObjectId } from 'mongodb';

/**
 * The Librarian — Research agent for the Embassy Reading Room.
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
const MAX_ROUNDS = 12;
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
    description: 'RARELY USED. Only for genuinely ambiguous questions where the user could mean completely different things (e.g., "mercury" = element vs planet vs god). Most questions should just be answered directly — share your thinking as text and start searching.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        preamble: { type: Type.STRING, description: 'Brief intro before the choices (1-2 sentences)' },
        options: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '2-3 interpretive options for the user to choose from',
        },
      },
      required: ['preamble', 'options'],
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
  const embedUrl = process.env.EMBED_URL || 'http://46.224.122.120:3456';
  let queryEmbedding: number[] | null = null;
  try {
    const res = await fetch(`${embedUrl}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: [query], task: 'query' }),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      queryEmbedding = data?.embeddings?.[0] || null;
    }
  } catch { /* embedding server unavailable */ }

  if (!queryEmbedding) {
    const { data } = await supabase
      .from('page_translations')
      .select('page_id, book_id, page_number, translation, book_title, book_author')
      .textSearch('tsv', query, { type: 'websearch' })
      .limit(8);
    return (data || []).map(r => ({
      book_id: r.book_id, bookTitle: r.book_title || 'Unknown', bookAuthor: r.book_author || 'Unknown',
      page_number: r.page_number, snippet: (r.translation || '').slice(0, 500), score: 1,
    }));
  }

  const { data } = await supabase.rpc('hybrid_search', {
    query_text: query, query_embedding: JSON.stringify(queryEmbedding),
    match_count: 8, keyword_weight: 0.3, semantic_weight: 0.7,
  });

  return (data || []).map((r: Record<string, unknown>) => ({
    book_id: r.book_id as string, bookTitle: (r.book_title as string) || 'Unknown',
    bookAuthor: (r.book_author as string) || 'Unknown', bookSlug: undefined,
    page_number: r.page_number as number, snippet: ((r.translation as string) || '').slice(0, 500),
    score: Number(r.score) || 0,
  }));
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
    const ids = [...clipIds.keys()].map(id => new ObjectId(id));
    images = await db.collection('gallery_images')
      .find({ _id: { $in: ids } })
      .project({ image_url: 1, description: 1, museum_description: 1, book_id: 1, book_title: 1, book_author: 1, book_slug: 1, page_number: 1, type: 1 })
      .toArray();
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
): Promise<{ result: unknown; step: LibrarianStep }> {
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

      return {
        result: { found: totalFound, context },
        step: { type: 'tool_result', name: 'search_collection', query, found: totalFound,
          summary: totalFound > 0 ? `Found ${data.passages.length} passages across ${data.books.length} books` : 'No results' },
      };
    }

    case 'search_semantic': {
      const query = args.query as string;
      const results = await executeSearchSemantic(query);
      let context = results.length > 0 ? 'Semantic search results:\n' : 'No semantic matches found.';
      for (const r of results) {
        context += `\n--- ${r.bookTitle} by ${r.bookAuthor}, Page ${r.page_number} (score: ${r.score.toFixed(2)}) ---\n${r.snippet}\n`;
      }
      return {
        result: { found: results.length, context },
        step: { type: 'tool_result', name: 'search_semantic', query, found: results.length,
          summary: results.length > 0 ? `Found ${results.length} conceptually related passages` : 'No semantic matches' },
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
      const preamble = args.preamble as string;
      const options = args.options as string[];
      return {
        result: { status: 'choices_presented', note: 'The user will select an option. Wait for their response.' },
        step: { type: 'choices', text: preamble, options },
      };
    }

    default:
      return { result: { error: `Unknown tool: ${name}` }, step: { type: 'tool_result', name, summary: 'Unknown tool', found: 0 } };
  }
}

// ── System Prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(notebookContext: string): string {
  return `You are the Librarian of the Embassy of the Free Mind — a research agent for scholars exploring the Western esoteric tradition. You have deep knowledge of alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, and the intellectual history of the Renaissance and early modern period.

You are warm, knowledgeable, and genuinely enthusiastic about these texts. You speak like a learned scholar who loves sharing discoveries.

## Your role

You are a research agent, not just a Q&A chatbot. You help users conduct real research across the collection. You accumulate findings, build on prior discoveries, and produce work the user can use.

## Your approach

1. **Think first.** Use your training knowledge to reason about the question. What historical concepts, authors, or traditions are relevant?

2. **Search strategically.** The collection includes books in Latin, German, French, Dutch, Hebrew, and more — nearly all translated into English. **Search in English first.** Use search_collection for keywords, search_semantic for concepts, search_wikipedia for context.

3. **Go deep.** When you find something promising, use read_nearby_pages to get more context. Follow threads across books. Don't stop at the first result.

4. **Save important findings.** Use add_to_notebook for quotes and passages directly relevant to the research question. Include analytical notes explaining why each finding matters. The notebook persists across messages — it's the user's accumulating body of research.

5. **Be honest about gaps.** If a hypothesis doesn't pan out, say so. If a relevant book isn't in the collection, mention it.

6. **Cite precisely.** For books found via tools, use the exact URLs from the tool results: https://sourcelibrary.org/book/{slug}?page={N}. Format: "quoted text" — *Title* by Author, [Page N](url). You may also mention books from your general knowledge, but note when you haven't verified they're in the collection. Links are automatically verified — broken links will be flagged.

7. **Suggest next steps.** After answering, proactively suggest what to explore next based on what you've found and what's still unexplored.
${notebookContext}
## Share your thinking naturally

For broad or exploratory questions, share your initial thinking conversationally — what you know, what directions you could search. Then search immediately. Don't wait for permission.

## When to use present_choices (rarely)

Only when the question genuinely splits into 2-3 completely different research directions. Most questions should just be answered directly.

## The collection

Source Library has over 10,000 rare books from the 15th-18th centuries, many translated into English for the first time. Topics include alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, demonology, and related traditions.

## Style

- Conversational but substantive — a research conversation, not a lecture
- Use markdown for readability
- Cite 2-4 key passages rather than dumping everything
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
  const systemPrompt = buildSystemPrompt(notebookContext);

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
  const searchCache = new Map<string, { passages: Array<{ book_id: string; bookTitle: string; bookAuthor: string; bookSlug?: string; page_number: number; text: string }>; books: Array<{ id: string; title: string; author?: string; year?: number; slug?: string }> }>();
  const semanticCache = new Map<string, Array<{ book_id: string; bookTitle: string; bookAuthor: string; bookSlug?: string; page_number: number; snippet: string; score: number }>>();

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
        } else if (p.text?.trim()) {
          yield { type: 'text', text: p.text };
        }
      }
    }

    if (allParts.length === 0) break;
    contents.push({ role: 'model', parts: allParts });

    if (functionCalls.length === 0) break;

    const responseParts: Array<Record<string, unknown>> = [];

    for (const part of functionCalls) {
      const fc = (part as { functionCall: { name: string; args: Record<string, unknown> } }).functionCall;

      yield { type: 'tool_call', name: fc.name, query: (fc.args?.query as string) || (fc.args?.quote as string)?.slice(0, 50) || '' };

      const { result, step } = await executeTool(fc.name, fc.args || {}, threadId);
      yield step;

      if (fc.name === 'present_choices') {
        if (allSources.length > 0) yield { type: 'sources', sources: allSources };
        responseParts.push({ functionResponse: { name: fc.name, response: result } });
        contents.push({ role: 'user', parts: responseParts });
        return;
      }

      // Collect source cards
      if (fc.name === 'search_collection') {
        const cacheKey = fc.args?.query as string;
        const data = searchCache.get(cacheKey) || await executeSearchCollection(cacheKey, fc.args?.search_books !== false);
        searchCache.set(cacheKey, data);
        for (const p of data.passages) {
          if (!allSources.some(s => s.book_id === p.book_id && s.pageNumber === p.page_number)) {
            allSources.push({ book_id: p.book_id, bookTitle: p.bookTitle, bookAuthor: p.bookAuthor, bookSlug: p.bookSlug,
              pageNumber: p.page_number, snippet: p.text.slice(0, 200), inCollection: true });
          }
        }
      }
      if (fc.name === 'search_semantic') {
        const cacheKey = fc.args?.query as string;
        const results = semanticCache.get(cacheKey) || await executeSearchSemantic(cacheKey);
        semanticCache.set(cacheKey, results);
        for (const r of results) {
          if (!allSources.some(s => s.book_id === r.book_id && s.pageNumber === r.page_number)) {
            allSources.push({ book_id: r.book_id, bookTitle: r.bookTitle, bookAuthor: r.bookAuthor, bookSlug: r.bookSlug,
              pageNumber: r.page_number, snippet: r.snippet.slice(0, 200), inCollection: true });
          }
        }
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
