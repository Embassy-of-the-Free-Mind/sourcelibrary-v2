import { getDb } from '@/lib/mongodb';
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import { buildBookSearchStage, buildPageSearchStage } from '@/lib/atlas-search';
import { supabase } from '@/lib/supabase';

/**
 * The Librarian — Agentic AI assistant for the Embassy Reading Room.
 *
 * Architecture: reason-first, search-second.
 * Gemini reasons about the user's question, then calls tools iteratively
 * to search the collection, Wikipedia, and semantic search. Each step is
 * streamed to the client as a structured event.
 *
 * Tools:
 *   - search_collection: Atlas Search on books + pages (keyword)
 *   - search_semantic: pgvector hybrid search on Supabase (conceptual)
 *   - search_wikipedia: Wikipedia REST API for historical/biographical context
 *   - get_book_page: Read a specific translated page
 *   - present_choices: Offer the user branching options before searching
 */

const MODEL = 'gemini-3-flash-preview';
const MAX_ROUNDS = 6;
const TEMPERATURE = 0.7;

// ── Types ──────────────────────────────────────���──────────────────────

export interface SourceCard {
  book_id: string;
  bookTitle: string;
  bookAuthor: string;
  bookSlug?: string;
  pageNumber?: number;
  snippet?: string;
  thumbnail?: string;
  inCollection: boolean; // false = "ghost card"
}

export interface LibrarianStep {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'choices' | 'text' | 'sources';
  // thinking: text is the reasoning
  // tool_call: name + query describe what's being searched
  // tool_result: name + summary + found (count)
  // choices: options array for branching
  // text: response text chunk
  // sources: source cards array
  text?: string;
  name?: string;
  query?: string;
  summary?: string;
  found?: number;
  options?: string[];
  sources?: SourceCard[];
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ── Tool Declarations ───────────────────────────��─────────────────────

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
    name: 'present_choices',
    description: 'Present the user with 2-4 interpretation options before searching. Use when the question is ambiguous and could mean different things. The user will select one to guide your search. Each option should be a short phrase (under 60 chars).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        preamble: { type: Type.STRING, description: 'Brief intro before the choices (1-2 sentences)' },
        options: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '2-4 interpretive options for the user to choose from',
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

  // Search pages via Atlas Search
  const searchStage = buildPageSearchStage(query);
  const pages = await db.collection('pages')
    .aggregate([
      searchStage,
      { $limit: 16 },
      { $project: { book_id: 1, page_number: 1, 'translation.data': 1, score: { $meta: 'searchScore' } } },
    ])
    .toArray();

  // Deduplicate: max 2 pages per book
  const perBook = new Map<string, number>();
  const deduped = pages.filter(p => {
    const count = perBook.get(p.book_id) || 0;
    if (count >= 2) return false;
    perBook.set(p.book_id, count + 1);
    return true;
  }).slice(0, 8);

  // Enrich with book metadata
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

  // Search books by title/author
  let books: Array<{ id: string; title: string; author?: string; year?: number; slug?: string }> = [];
  if (searchBooks) {
    const bookSearchStage = buildBookSearchStage(query, { hasTranslation: true }, { fuzzy: true });
    const bookResults = await db.collection('books')
      .aggregate([
        bookSearchStage,
        { $limit: 5 },
        { $project: { id: 1, title: 1, display_title: 1, author: 1, year: 1, slug: 1 } },
      ])
      .toArray();
    books = bookResults.map(b => ({
      id: b.id,
      title: b.display_title || b.title,
      author: b.author,
      year: b.year,
      slug: b.slug,
    }));
  }

  return { passages, books };
}

async function executeSearchSemantic(query: string): Promise<
  Array<{ book_id: string; bookTitle: string; bookAuthor: string; bookSlug?: string; page_number: number; snippet: string; score: number }>
> {
  // Generate embedding via Hetzner
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
    // Fall back to keyword search on Supabase
    const { data } = await supabase
      .from('page_translations')
      .select('page_id, book_id, page_number, translation, book_title, book_author')
      .textSearch('tsv', query, { type: 'websearch' })
      .limit(8);

    return (data || []).map(r => ({
      book_id: r.book_id,
      bookTitle: r.book_title || 'Unknown',
      bookAuthor: r.book_author || 'Unknown',
      page_number: r.page_number,
      snippet: (r.translation || '').slice(0, 500),
      score: 1,
    }));
  }

  const { data } = await supabase.rpc('hybrid_search', {
    query_text: query,
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: 8,
    keyword_weight: 0.3,
    semantic_weight: 0.7,
  });

  return (data || []).map((r: Record<string, unknown>) => ({
    book_id: r.book_id as string,
    bookTitle: (r.book_title as string) || 'Unknown',
    bookAuthor: (r.book_author as string) || 'Unknown',
    bookSlug: undefined, // Supabase doesn't have slug, we'll resolve later
    page_number: r.page_number as number,
    snippet: ((r.translation as string) || '').slice(0, 500),
    score: Number(r.score) || 0,
  }));
}

async function executeSearchWikipedia(query: string): Promise<{ title: string; summary: string; url: string } | null> {
  try {
    const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title,
        summary: data.extract?.slice(0, 1500) || '',
        url: data.content_urls?.desktop?.page || '',
      };
    }

    // If direct lookup fails, try search
    const searchApiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`;
    const searchRes = await fetch(searchApiUrl, {
      headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' },
      signal: AbortSignal.timeout(5000),
    });

    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const firstResult = searchData?.query?.search?.[0];
    if (!firstResult) return null;

    // Fetch summary for the first result
    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(firstResult.title)}`,
      {
        headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!summaryRes.ok) return null;
    const summaryData = await summaryRes.json();
    return {
      title: summaryData.title,
      summary: summaryData.extract?.slice(0, 1500) || '',
      url: summaryData.content_urls?.desktop?.page || '',
    };
  } catch {
    return null;
  }
}

async function executeGetBookPage(bookId: string, pageNumber: number): Promise<{
  text: string;
  originalText?: string;
  bookTitle: string;
  bookAuthor: string;
  bookSlug?: string;
} | null> {
  const db = await getDb();
  const page = await db.collection('pages').findOne(
    { book_id: bookId, page_number: pageNumber },
    { projection: { 'translation.data': 1, 'ocr.data': 1, book_id: 1, page_number: 1 } },
  );
  if (!page) return null;

  const book = await db.collection('books').findOne(
    { id: bookId },
    { projection: { title: 1, display_title: 1, author: 1, slug: 1 } },
  );

  return {
    text: page.translation?.data || '',
    originalText: page.ocr?.data?.slice(0, 800),
    bookTitle: book?.display_title || book?.title || 'Unknown',
    bookAuthor: book?.author || 'Unknown',
    bookSlug: book?.slug,
  };
}

// ── Tool Router ───────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: unknown; step: LibrarianStep }> {
  switch (name) {
    case 'search_collection': {
      const query = args.query as string;
      const searchBooks = args.search_books !== false;
      const data = await executeSearchCollection(query, searchBooks);
      const totalFound = data.passages.length + data.books.length;

      // Build context for Gemini
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
          const url = `https://sourcelibrary.org/book/${p.bookSlug || p.book_id}/page/${p.page_number}`;
          context += `\n--- ${p.bookTitle} by ${p.bookAuthor}, Page ${p.page_number} (${url}) ---\n${p.text}\n`;
        }
      }
      if (totalFound === 0) {
        context = 'No results found for this query.';
      }

      return {
        result: { found: totalFound, context },
        step: {
          type: 'tool_result',
          name: 'search_collection',
          query,
          found: totalFound,
          summary: totalFound > 0
            ? `Found ${data.passages.length} passages across ${data.books.length} books`
            : 'No results',
        },
      };
    }

    case 'search_semantic': {
      const query = args.query as string;
      const results = await executeSearchSemantic(query);

      let context = '';
      if (results.length > 0) {
        context = 'Semantic search results:\n';
        for (const r of results) {
          context += `\n--- ${r.bookTitle} by ${r.bookAuthor}, Page ${r.page_number} (score: ${r.score.toFixed(2)}) ---\n${r.snippet}\n`;
        }
      } else {
        context = 'No semantic matches found.';
      }

      return {
        result: { found: results.length, context },
        step: {
          type: 'tool_result',
          name: 'search_semantic',
          query,
          found: results.length,
          summary: results.length > 0
            ? `Found ${results.length} conceptually related passages`
            : 'No semantic matches',
        },
      };
    }

    case 'search_wikipedia': {
      const query = args.query as string;
      const result = await executeSearchWikipedia(query);

      return {
        result: result
          ? { found: 1, title: result.title, summary: result.summary, url: result.url }
          : { found: 0, summary: 'No Wikipedia article found.' },
        step: {
          type: 'tool_result',
          name: 'search_wikipedia',
          query,
          found: result ? 1 : 0,
          summary: result
            ? `Found: ${result.title}`
            : 'No article found',
        },
      };
    }

    case 'get_book_page': {
      const bookId = args.book_id as string;
      const pageNumber = args.page_number as number;
      const result = await executeGetBookPage(bookId, pageNumber);

      return {
        result: result
          ? { found: 1, text: result.text, originalText: result.originalText, bookTitle: result.bookTitle }
          : { found: 0, text: 'Page not found.' },
        step: {
          type: 'tool_result',
          name: 'get_book_page',
          query: `${bookId} p.${pageNumber}`,
          found: result ? 1 : 0,
          summary: result
            ? `Read page ${pageNumber} of ${result.bookTitle}`
            : 'Page not found',
        },
      };
    }

    case 'present_choices': {
      const preamble = args.preamble as string;
      const options = args.options as string[];
      return {
        result: { status: 'choices_presented', note: 'The user will select an option. Wait for their response.' },
        step: {
          type: 'choices',
          text: preamble,
          options,
        },
      };
    }

    default:
      return {
        result: { error: `Unknown tool: ${name}` },
        step: { type: 'tool_result', name, summary: 'Unknown tool', found: 0 },
      };
  }
}

// ── System Prompt ─���────────────────────���──────────────────────────────

function buildSystemPrompt(): string {
  return `You are the Librarian of the Embassy of the Free Mind — a digital scholarly institution dedicated to the Western esoteric tradition. You have deep knowledge of alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, and the intellectual history of the Renaissance and early modern period.

You are warm, knowledgeable, and genuinely enthusiastic about these texts. You speak like a learned scholar who loves sharing discoveries.

## Your approach

You are a research librarian. When a user asks a question:

1. **Think first.** Use your training knowledge to reason about what the user is really asking. What historical concepts, authors, or traditions are relevant? What terms would appear in 15th-18th century texts?

2. **Hypothesize.** Form specific hypotheses about what might be in the collection. "Porta probably discussed psychoactive plants." "Agrippa covered planetary correspondences." Some hypotheses will be wrong — that's fine.

3. **Search strategically.** Call tools to validate your hypotheses. The collection includes books in Latin, German, French, Dutch, Hebrew, and more — but nearly all are translated into English, so **search in English first**. Use search_collection for keyword matches in the English translations. Use search_semantic for conceptual/fuzzy matches — it finds related passages even when exact terms differ. Use search_wikipedia for biographical context or to discover historical terminology you can then search for.

4. **Be honest about what you find and what you don't.** If a hypothesis doesn't pan out, say so. If a relevant book isn't in the collection, mention it as a gap. "We don't have Ficino's De Vita yet, but Agrippa covers similar ground."

5. **Cite precisely.** Every claim grounded in the collection must include the full URL: https://sourcelibrary.org/book/{slug}/page/{N}. Use the format: "quoted text" — *Title* by Author, [Page N](url).

## When to use present_choices

If the user's question is genuinely ambiguous and could lead to very different searches, use present_choices to offer 2-4 interpretations. For example:
- "What is the philosopher's stone?" → search directly (not ambiguous)
- "Tell me about resonance" → present choices: sympathetic magic, musical cosmology, acoustic experiments

Only present choices when the ambiguity would lead to materially different search strategies. Most questions should just be answered directly.

## The collection

Source Library has over 5,000 rare books from the 15th-18th centuries, many translated into English for the first time. Topics include alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, demonology, and related traditions. The collection is growing.

## Style

- Conversational but substantive — reading room conversation, not a lecture
- Use markdown for readability
- Keep responses focused — cite 2-4 key passages rather than dumping everything
- When you're speaking from general knowledge vs. from specific texts, make it clear`;
}

// ── Agentic Streaming ────────────���────────────────────────────────────

/**
 * Stream an agentic Librarian response.
 * Yields LibrarianStep events as the Librarian thinks, searches, and responds.
 */
export async function* streamAgenticResponse(
  userMessage: string,
  history: ConversationMessage[] = [],
): AsyncGenerator<LibrarianStep> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const ai = new GoogleGenAI({ apiKey });
  const systemPrompt = buildSystemPrompt();

  // Build conversation history for Gemini
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'I understand. I\'m the Librarian, ready to help visitors explore the collection using my tools and knowledge.' }] },
    // Prior conversation turns
    ...history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    })),
    // Current message
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  const allSources: SourceCard[] = [];
  // Cache search results to avoid double-execution for source cards
  const searchCache = new Map<string, { passages: Array<{ book_id: string; bookTitle: string; bookAuthor: string; bookSlug?: string; page_number: number; text: string }>; books: Array<{ id: string; title: string; author?: string; year?: number; slug?: string }> }>();
  const semanticCache = new Map<string, Array<{ book_id: string; bookTitle: string; bookAuthor: string; bookSlug?: string; page_number: number; snippet: string; score: number }>>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        temperature: TEMPERATURE,
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) break;

    // Add model response to conversation
    contents.push({
      role: 'model',
      parts: candidate.content.parts as Array<Record<string, unknown>>,
    });

    // Process parts: text chunks and function calls
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const functionCalls = candidate.content.parts.filter((p: any) => p.functionCall);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textParts = candidate.content.parts.filter((p: any) => p.text);

    // Emit any thinking/text from this round
    for (const part of textParts) {
      const text = (part as { text: string }).text;
      if (text.trim()) {
        if (functionCalls.length > 0) {
          yield { type: 'thinking', text };
        } else {
          yield { type: 'text', text };
        }
      }
    }

    // No function calls = final response, we're done
    if (functionCalls.length === 0) break;

    // Execute tools and stream results
    const responseParts: Array<Record<string, unknown>> = [];

    for (const part of functionCalls) {
      const fc = (part as { functionCall: { name: string; args: Record<string, unknown> } }).functionCall;

      // Emit tool_call event (what's being searched)
      yield {
        type: 'tool_call',
        name: fc.name,
        query: (fc.args?.query as string) || (fc.args?.preamble as string) || '',
      };

      // Execute the tool
      const { result, step } = await executeTool(fc.name, fc.args || {});

      // Emit the result
      yield step;

      // If it's present_choices, stop and wait for user
      if (fc.name === 'present_choices') {
        if (allSources.length > 0) {
          yield { type: 'sources', sources: allSources };
        }
        responseParts.push({ functionResponse: { name: fc.name, response: result } });
        contents.push({ role: 'user', parts: responseParts });
        return;
      }

      // Collect source cards from search results
      if (fc.name === 'search_collection') {
        const cacheKey = fc.args?.query as string;
        // The executeTool already ran the search — extract structured data from the result
        const data = searchCache.get(cacheKey) || await executeSearchCollection(cacheKey, fc.args?.search_books !== false);
        searchCache.set(cacheKey, data);
        for (const p of data.passages) {
          if (!allSources.some(s => s.book_id === p.book_id && s.pageNumber === p.page_number)) {
            allSources.push({
              book_id: p.book_id,
              bookTitle: p.bookTitle,
              bookAuthor: p.bookAuthor,
              bookSlug: p.bookSlug,
              pageNumber: p.page_number,
              snippet: p.text.slice(0, 200),
              inCollection: true,
            });
          }
        }
      }

      if (fc.name === 'search_semantic') {
        const cacheKey = fc.args?.query as string;
        const results = semanticCache.get(cacheKey) || await executeSearchSemantic(cacheKey);
        semanticCache.set(cacheKey, results);
        for (const r of results) {
          if (!allSources.some(s => s.book_id === r.book_id && s.pageNumber === r.page_number)) {
            allSources.push({
              book_id: r.book_id,
              bookTitle: r.bookTitle,
              bookAuthor: r.bookAuthor,
              bookSlug: r.bookSlug,
              pageNumber: r.page_number,
              snippet: r.snippet.slice(0, 200),
              inCollection: true,
            });
          }
        }
      }

      responseParts.push({ functionResponse: { name: fc.name, response: result } });
    }

    // Add tool responses to conversation
    contents.push({ role: 'user', parts: responseParts });
  }

  // Emit source cards at the end
  if (allSources.length > 0) {
    yield { type: 'sources', sources: deduplicateSources(allSources) };
  }
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
