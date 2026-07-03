import { getDb } from '@/lib/mongodb';
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import { logAiUsage } from '@/lib/log-ai-usage';
// Atlas keyword + Supabase semantic are now combined in @/lib/search/librarian-search.
// Atlas-search builders no longer imported here directly.
import { supabase } from '@/lib/supabase';
import { ObjectId } from 'mongodb';
import { stripAnnotations } from '@/lib/semantic-alignment';
import { CLIP_URL } from '@/lib/clip';

/**
 * The Librarian — Research agent for Source Library.
 *
 * Architecture: reason-first, search-second, accumulate findings.
 * Gemini reasons about the user's question, calls tools iteratively,
 * and builds up a persistent research notebook across the conversation.
 *
 * Tools:
 *   - search: Hybrid keyword + semantic via RRF (replaces the prior
 *             search_collection and search_semantic; both old names accepted
 *             as aliases for one release)
 *   - search_wikipedia: Wikipedia REST API for context
 *   - get_book_page: Read a specific translated page
 *   - read_nearby_pages: Read a range of pages around a finding
 *   - search_images: CLIP visual search over the gallery (with health probe)
 *   - search_artworks: Semantic search over standalone artworks
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
  type: 'thinking' | 'tool_call' | 'tool_result' | 'choices' | 'text' | 'sources' | 'notebook_update' | 'usage';
  text?: string;
  name?: string;
  query?: string;
  summary?: string;
  found?: number;
  options?: string[];
  descriptions?: (string | undefined)[];
  sources?: SourceCard[];
  // Token accounting for the whole turn (all agent rounds summed). Emitted
  // last and persisted on the AI message; never rendered to the user.
  usage?: TurnUsage;
  notebook?: {
    findingCount: number;
    topic?: string;
    // The finding just saved — lets the client render the notebook live
    // instead of only exposing a count badge.
    finding?: {
      quote: string;
      note: string;
      bookId: string;
      bookTitle: string;
      bookAuthor: string;
      bookSlug?: string;
      pageNumber: number;
    };
  };
}

export interface TurnUsage {
  model: string;
  rounds: number;
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cachedTokens: number;
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
    const url = `https://sourcelibrary.org/book/${f.source.bookSlug || f.source.bookId}/page-number/${f.source.pageNumber}`;
    text += `${i + 1}. "${f.quote.slice(0, 200)}${f.quote.length > 200 ? '...' : ''}" — *${f.source.bookTitle}* by ${f.source.bookAuthor}, [Page ${f.source.pageNumber}](${url})\n`;
    if (f.note) text += `   *Note:* ${f.note}\n`;
  }

  text += `\nBuild on these findings. Don't repeat searches you've already done. Suggest new angles or deeper dives.\n`;
  return text;
}

// ── Tool Declarations ─────────────────────────────────────────────────

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'search',
    description: 'Search Source Library — fuses keyword search (Atlas) with semantic search (AI embeddings) across the whole library. Returns the strongest matching passages plus relevant books. Works for both verbatim queries (Latin/German phrases, technical terms) and conceptual queries (modern paraphrases of historical ideas). Search in English for best coverage — nearly all books are translated.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Search query — use period-appropriate terms when known (e.g., "sympathetic magic" not "resonance", "flying ointment" not "psychedelics"). Modern paraphrases also work — semantic matching handles the mapping.' },
        collection: { type: Type.STRING, description: 'Optional. A collection slug from the "Collections" list in your instructions to FOCUS the search on. Results are weighted toward that collection but still include strong matches from the rest of the library — it is a lean, not a filter. Set this whenever the user\'s question is clearly about one collection\'s subject (e.g. a question about fungi or mushrooms → "mycology"; about tarot or planetary seals → "astrology"). Pick the single most relevant slug; if unsure or the topic spans the whole library, omit it.' },
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
    description: 'Search 23,000+ standalone artworks (paintings, prints, sculptures, engravings, manuscripts) by subject, artist, period, technique, or visual content. Unlike search_images (which finds illustrations extracted from book pages), this searches museum-quality artworks imported from Met Museum, Wikimedia Commons, Rijksmuseum, etc. Returns artwork title, artist, thumbnail, period, technique, culture, and connections to texts in the library.',
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
    description: 'Offer 2-3 deeper research directions AFTER you have already searched and delivered a substantive answer (overview, quotes, links, images). Choices are a follow-up that points the user toward where to go next — never a gate that blocks them from getting help first. Use this rarely, only when your answer surfaced genuinely divergent threads worth pursuing and the user hasn\'t already signaled which one they want. Do NOT use it to ask the user to disambiguate before searching — just search with your best interpretation. Each option has a short label and a 1-2 sentence description. The user clicks one or types their own direction.',
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

// ── Tenant Visibility ─────────────────────────────────────────────────

/**
 * Main-site library = books with no `tenantId`. Books tagged with a subdomain
 * tenant UUID (bph / kloss-collection / bhutan) belong to a partner reading
 * room and must NOT leak into the main-site librarian's results.
 *
 * Background: the AI librarian leaked a Bhutanese book to main-site users
 * because Atlas + semantic search returned every tenant's books indiscriminately
 * (the embedding RPC's tenant filter was explicitly dropped in PR #1780).
 * See .claude/docs/tenant-architecture-audit-2026-05-23.md.
 */
function tenantVisibilityFilter() {
  return {
    hidden: { $ne: true },
    tenantId: { $in: [null, undefined] },
  };
}

// ── Tool Execution ────────────────────────────────────────────────────

// Hybrid search — combines Atlas keyword + book-then-page semantic + global-page
// semantic via RRF, optionally cross-encoder reranks. See src/lib/search/
// librarian-search.ts for the implementation and the eval that supports the
// design (scripts/eval/librarian-search/).
//
// Replaces the prior executeSearchCollection (keyword-only) and
// executeSearchSemantic (book-then-page only) with a single unified path.
async function executeSearch(query: string, collection?: string | null): Promise<{
  passages: Array<{ book_id: string; bookTitle: string; bookAuthor: string; bookSlug?: string; page_number: number; text: string; score: number; source: string }>;
  books: Array<{ id: string; title: string; author?: string; authorSlug?: string; year?: number; slug?: string }>;
  collectionUsed: string | null;
}> {
  const { hybridSearch } = await import('@/lib/search/librarian-search');
  // The model may pass a slug, a name, or a loose topic phrase — normalize it to
  // a real slug (or null → plain global search). Weighting is soft, so a missed
  // resolution just searches the whole library unweighted.
  const { resolveCollectionSlug } = await import('@/lib/embassy/collection-catalog');
  const collectionUsed = await resolveCollectionSlug(collection);
  // Main-site only; pass tenant UUID here for per-tenant Librarian instances.
  const { passages, books } = await hybridSearch(query, {
    tenantId: null,
    collection: collectionUsed,
    // collectionWeight defaults to 2 in hybridSearch.
  });
  return { passages, books, collectionUsed };
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

async function executeSearchImages(query: string, bookId?: string): Promise<{
  images: Array<{ id: string; imageUrl: string; description: string; bookTitle: string; bookAuthor: string; bookSlug?: string; pageNumber: number; type?: string }>;
  clipUnavailable: boolean;
}> {
  // Use CLIP visual search via the gallery API for text-to-image matching
  const db = await getDb();

  // Try CLIP text-to-image search first. Distinguish "CLIP searched and found
  // nothing" (reachable, fall back to keyword search) from "CLIP is down"
  // (unreachable — we must NOT let the model imply no illustrations exist).
  let clipIds = new Map<string, number>();
  let clipUnavailable = false;
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
      } else {
        clipUnavailable = true; // responded without an embedding
      }
    } else {
      clipUnavailable = true; // non-2xx from the CLIP service
    }
  } catch {
    clipUnavailable = true; // network error / timeout — CLIP is down
  }
  if (clipUnavailable) {
    console.warn(`[Librarian] CLIP visual search unavailable (${CLIP_URL}); falling back to keyword image search`);
  }

  // Hybrid retrieval: run the keyword search ALONGSIDE CLIP and merge.
  // CLIP used to be winner-takes-all — a single plant-shaped folio scraping
  // past the 0.20 threshold suppressed gallery plates whose curated
  // descriptions literally name the subject (asking for cannabis surfaced
  // Voynich look-alikes while the Fuchs "Cannabis sativa" woodcut sat unshown
  // in the gallery). An exact keyword hit on the curated description is
  // stronger evidence than borderline visual similarity, so the merged order
  // is: corroborated by both → keyword-only → CLIP-only.
  const projection = { image_url: 1, description: 1, museum_description: 1, book_id: 1, book_title: 1, book_author: 1, book_slug: 1, page_number: 1, type: 1 };

  const textFilter: Record<string, unknown> = { gallery_quality: { $gte: 0.7 } };
  if (bookId) textFilter.book_id = bookId;
  const regex = query.split(/\s+/).map(w => `(?=.*${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`).join('');
  const textPromise = db.collection('gallery_images')
    .find({ ...textFilter, $or: [
      { description: { $regex: regex, $options: 'i' } },
      { museum_description: { $regex: regex, $options: 'i' } },
      { 'metadata.subjects': { $regex: regex, $options: 'i' } },
    ]})
    .sort({ gallery_quality: -1 })
    .limit(6)
    .project(projection)
    .toArray();

  // CLIP IDs may be ObjectId hex strings or other formats — filter to valid
  // ones. Book-scoped searches constrain the CLIP hits too (the old code let
  // CLIP return images from any book even when the model asked about one).
  const validClipIds = [...clipIds.keys()].filter(id => /^[a-f0-9]{24}$/.test(id));
  const clipPromise = validClipIds.length > 0
    ? db.collection('gallery_images')
        .find({ _id: { $in: validClipIds.map(id => new ObjectId(id)) }, ...(bookId ? { book_id: bookId } : {}) })
        .project(projection)
        .toArray()
    : Promise.resolve([] as Awaited<typeof textPromise>);

  const [textMatches, clipMatches] = await Promise.all([textPromise, clipPromise]);
  const clipHitIds = new Set(clipMatches.map(m => m._id.toString()));
  const seen = new Set<string>();
  const images: typeof textMatches = [];
  for (const list of [textMatches.filter(m => clipHitIds.has(m._id.toString())), textMatches, clipMatches]) {
    for (const img of list) {
      const key = img._id.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      images.push(img);
    }
  }

  return {
    images: images.slice(0, 6).map(img => ({
      id: img._id.toString(),
      imageUrl: img.image_url,
      description: (img.museum_description || img.description || '').slice(0, 300),
      bookTitle: img.book_title || 'Unknown',
      bookAuthor: img.book_author || 'Unknown',
      bookSlug: img.book_slug,
      pageNumber: img.page_number,
      type: img.type,
    })),
    clipUnavailable,
  };
}

// ── Tool Router ───────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  threadId?: string,
  collectionContext?: string | null,
): Promise<{ result: unknown; step: LibrarianStep; sources?: SourceCard[] }> {
  switch (name) {
    case 'search':
    // Aliases — accept old tool names for one release to avoid breakage if
    // an in-flight Librarian conversation calls the prior tools. Both
    // collapse to the same hybrid implementation.
    case 'search_collection':
    case 'search_semantic': {
      const query = args.query as string;
      // Explicit per-call collection wins; otherwise fall back to the thread's
      // collection context (set when the user opened the Librarian from a
      // collection page). Either way the weighting is soft.
      const collection = (args.collection as string | undefined) || collectionContext || null;
      const data = await executeSearch(query, collection);
      const totalFound = data.passages.length + data.books.length;

      let context = '';
      if (data.books.length > 0) {
        context += 'Books found:\n';
        for (const b of data.books) {
          // Give the model the resolvable author URL (or none) so it never has
          // to invent one by slugifying a name form it chose in prose — the
          // cause of 404 author links like /author/robert-bellarmine.
          const authorPart = b.author
            ? (b.authorSlug
              ? `[${b.author}](https://sourcelibrary.org/author/${b.authorSlug})`
              : b.author)
            : 'Unknown';
          context += `- "${b.title}" by ${authorPart}${b.year ? ` (${b.year})` : ''} — https://sourcelibrary.org/book/${b.slug || b.id}\n`;
        }
      }
      if (data.passages.length > 0) {
        context += '\nPassages found:\n';
        for (const p of data.passages) {
          const url = `https://sourcelibrary.org/book/${p.bookSlug || p.book_id}/page-number/${p.page_number}`;
          context += `\n--- ${p.bookTitle} by ${p.bookAuthor}, Page ${p.page_number} (${url}) ---\n${p.text}\n`;
        }
      }
      if (totalFound === 0) context = 'No results found for this query.';

      const sources: SourceCard[] = data.passages.map(p => ({
        book_id: p.book_id, bookTitle: p.bookTitle, bookAuthor: p.bookAuthor, bookSlug: p.bookSlug,
        pageNumber: p.page_number, snippet: stripAnnotations(p.text).slice(0, 200), inCollection: true,
      }));

      const focusNote = data.collectionUsed ? `, focused on ${data.collectionUsed}` : '';
      return {
        result: { found: totalFound, context, collection: data.collectionUsed },
        step: { type: 'tool_result', name: 'search', query, found: totalFound,
          summary: totalFound > 0 ? `Found ${data.passages.length} passages across ${data.books.length} books${focusNote}` : `No results${focusNote}` },
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
      const { images, clipUnavailable } = await executeSearchImages(query, bookId);

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
      } else if (clipUnavailable) {
        // CLIP is down and the keyword fallback found nothing. Do NOT let the
        // model conclude the library has no illustrations on this topic.
        context = 'Visual search is temporarily unavailable, so illustrations could not be searched for this query. Do not claim the library has no images on this topic — say image search is briefly unavailable and offer to look again later.';
      } else {
        context = 'No matching images found in the gallery.';
      }

      return {
        result: { found: images.length, clipUnavailable, context, images: images.map(i => ({ id: i.id, url: i.imageUrl, description: i.description.slice(0, 100), bookTitle: i.bookTitle })) },
        step: { type: 'tool_result', name: 'search_images', query, found: images.length,
          summary: images.length > 0 ? `Found ${images.length} illustrations` : (clipUnavailable ? 'Visual search unavailable' : 'No images found') },
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
          notebook: {
            findingCount: count,
            topic: args.topic as string | undefined,
            finding: {
              quote: finding.quote,
              note: finding.note,
              bookId: finding.source.bookId,
              bookTitle: finding.source.bookTitle,
              bookAuthor: finding.source.bookAuthor,
              bookSlug: finding.source.bookSlug,
              pageNumber: finding.source.pageNumber,
            },
          } },
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

function buildSystemPrompt(
  notebookContext: string,
  messageIndex: number,
  collectionOpts?: { catalog?: string; collectionContext?: string | null },
): string {
  const catalog = collectionOpts?.catalog?.trim();
  const collectionContext = collectionOpts?.collectionContext;

  // Tell the model it can focus a search on a collection, list the real slugs,
  // and — if the session started from a collection page — that it should lean
  // that way by default.
  const collectionSection = catalog
    ? `## Collections — focusing a search

The library is organized into thematic collections. The **search** tool takes an optional \`collection\` argument: pass the slug of the most relevant collection and results are *weighted toward* it while still surfacing strong matches from the rest of the library (a lean, not a filter). Set it whenever a question is clearly about one collection's subject — map the user's topic to the closest slug yourself (e.g. "mushrooms / fungi" → \`mycology\`; "tarot" → \`astrology\`). If a question spans the whole library or none fits, omit it.
${collectionContext ? `\n**This conversation started inside the "${collectionContext}" collection.** Unless the user clearly shifts to a different subject, pass \`collection: "${collectionContext}"\` on your searches so results stay focused there.\n` : ''}
Available collection slugs (slug — name):
${catalog}

`
    : '';

  return buildSystemPromptBody(notebookContext, messageIndex, collectionSection);
}

function buildSystemPromptBody(notebookContext: string, messageIndex: number, collectionSection: string): string {
  return `You are the Librarian of the Embassy of the Free Mind — a research agent for scholars exploring rare historical texts across the pre-modern intellectual tradition. Your knowledge spans alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, Indian philosophy, Sanskrit texts, Egyptian sources, early modern science, demonology, and the broader history of ideas from antiquity through the Enlightenment.

You are warm, knowledgeable, and genuinely enthusiastic about these texts. You speak like a learned scholar who loves sharing discoveries.

## Your role

You are a research agent, not just a Q&A chatbot. You help users conduct real research across the collection. You accumulate findings, build on prior discoveries, and produce work the user can use.

## Conversation state

This is message #${messageIndex} in the thread.${messageIndex >= 3 ? ' The user has established their direction — skip choices and go straight to research.' : ''}

## Your approach — conversational first, then deep research

**Step 1: Lead with substance — briefly.**
Before calling any tools, write 1-3 sentences (max 50 words) that name the key tradition, author, or concept. This streams immediately while searches run. Keep it SHORT — the user wants results, not a lecture. NEVER open with pleasantries like "It is a pleasure to assist you" or "What a fascinating question" — just start with substance. Save exposition for AFTER you have sources.

**Step 2: Default to helping first — don't gate the user behind a choice.**
Your job is to deliver a real answer, not to interview the user before lending a hand. For almost every question, pick the most useful interpretation and go straight to research (Step 4). Even when a topic could branch several ways, the right move is to search your best guess, give an overview with quotes, links, and images, and THEN — if genuinely divergent threads emerged — offer a couple of next directions via present_choices at the end.

Do NOT open with present_choices. Asking the user to disambiguate before you've searched is almost always a speed bump. If "sanskrit alchemy" could mean mercury processes, East-West transmission, or tantric dimensions, don't ask which — search, surface a bit of all three, and let the user pull the thread they care about (you can offer those three as follow-up directions once they're grounded in real results).

The only time to skip the answer-first pattern is when the request is truly unanswerable without one missing fact (e.g. the user names a person who could be two completely different historical figures, and the searches would be entirely disjoint). Even then, take your best shot and note the ambiguity rather than stalling.

On follow-up messages (message #3+), never present choices — the user has established their direction.

**Step 4: Deep, focused research.**
Once you have a direction (from a choice or a specific question), search strategically. The collection includes books in Latin, German, French, Dutch, Hebrew, Sanskrit, Arabic, Greek, and more — nearly all translated into English. **Search in English first.** Use the **search** tool for everything text-based — it fuses keyword and semantic matching so you don't have to choose between them. Use search_wikipedia for outside context. When you find something promising, use read_nearby_pages for more context. Follow threads across books.

For visual or symbolic topics (emblems, alchemical apparatus, diagrams, seals, planetary symbols, anatomical illustrations), proactively call search_images (for illustrations extracted from book pages) or search_artworks (for standalone museum artworks — paintings, prints, sculptures from Met, Rijksmuseum, Wikimedia Commons). The collection includes 23,000+ artworks spanning all cultures and periods. search_artworks supports filtering by genre, period, culture, and collection. Use it when users ask about visual art, specific artists, or when showing a painting/print would contextualize a text.

**Step 5: Save and cite with links.**
Use add_to_notebook for quotes directly relevant to the research question. The notebook persists across messages.

Cite with page-level links: "quoted text" — *[Title](https://sourcelibrary.org/book/SLUG)* by [Author](https://sourcelibrary.org/author/AUTHOR-SLUG), [Page N](https://sourcelibrary.org/book/SLUG?page=N).

Every mention of a book should link to it. Every mention of an author should link to their author page WHEN the tool results give you that author's link. Use the URLs from tool results verbatim — they contain the correct slugs, including the pre-built author link in each "Books found" line. **NEVER construct an author URL yourself by slugifying or translating a name.** The author's name in our catalog is often a different form than the one you'd write in prose (e.g. "Robert Bellarmine" is stored as "Bellarmino, Roberto, S.J"; "Bartholomaeus Fumus" as "Bartolomeo Fumo"), and a hand-built /author/... link will 404. If a tool result has no author link for someone, write their name as plain text — do not invent a link.

When quoting a key passage, include the original language text (Latin, German, Hebrew, etc.) alongside the English if it is notable or if the user appears to be working in that language. Use a blockquote with both versions.

**Step 6: Show images and suggest next steps.**
When search_images or search_artworks returns results, embed the best 1-3 images using markdown: \`![description](imageUrl)\`. **Only use URLs returned by a tool call this turn.** NEVER invent, paraphrase, guess, or recall image URLs — fabricated URLs render as broken thumbnails for the user. If you have no tool-returned image URL, do not write any \`![...](...)\` syntax at all.

When the user explicitly asks for pictures, images, or illustrations ("what pictures do we have of X", "show me X"), calling search_images is REQUIRED before you answer — search_artworks too if museum art could fit — and your answer must SHOW the results with \`![...](...)\`, not describe them. A prose description of a woodcut is never a substitute for embedding it. Prefer images whose descriptions name the subject over ones that merely look similar.

After you've delivered the answer, suggest what to explore next. Usually this is a sentence or two of prose ("You might follow this into Ficino's musical cosmology, or compare it with Kircher's acoustic experiments"). Only reach for present_choices here — at the very end, after the substantive answer — and only on an early message when your research genuinely opened up 2-3 distinct threads worth a dedicated search each. If a prose suggestion does the job, prefer it. Never replace the answer with choices.

Be honest about gaps — if a hypothesis doesn't pan out, say so. If a relevant book isn't in the collection, mention it.

## Choices are a last-resort follow-up, not a greeting

Default answer to "should I present choices?" is NO. Search first, answer with real sources, and only consider offering directions at the very end. Before calling present_choices, all of these must hold: (1) you've already delivered a substantive answer this turn, (2) it's an early message (not #3+), (3) your research surfaced 2-3 genuinely divergent threads, each needing a different search, and (4) a one-line prose "you might explore X or Y" wouldn't serve just as well. If any fail, skip the tool. When you do present choices, do NOT also list or number them in your text — the UI renders them as clickable buttons automatically, so listing them too makes them appear doubled.
${notebookContext}
## Know when to stop searching

After 2-3 rounds of searching (4-6 tool calls total), stop and synthesize what you've found. A focused, well-cited response from 2-4 sources is far better than an exhaustive survey of everything tangentially related.

- Found 2-3 strong passages? Stop searching, write your response.
- First search returned nothing? Try one more angle, then acknowledge the gap.
- Don't run the same search with slightly different wording — if keyword search missed, try semantic (or vice versa), then move on.
- read_nearby_pages is for deepening a promising find, not for fishing. Only use it after you've found something specific worth expanding.

## The collection

Source Library has over 10,000 rare books spanning antiquity through the 18th century, many translated into English for the first time. The collection covers alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, demonology, Indian philosophy, Sanskrit texts, Egyptian sources, early modern science, and related traditions across Western, Middle Eastern, and Asian intellectual history.

${collectionSection}## Formatting

- Use markdown headers (## and ###) to organize longer responses into clear sections
- Use **bold** for key terms and *italics* for book titles (linked: *[Title](url)*)
- Use blockquotes (>) for important quotations from primary sources — always with page citation
- Use paragraph breaks between distinct ideas — leave a blank line between paragraphs. Don't write walls of text
- Conversational but substantive — a research conversation, not a lecture
- Cite 2-4 key passages rather than dumping everything. Every passage needs a page number and link
- Link authors to their author pages ONLY with the author link supplied in the tool results — never a self-built /author/... URL. No tool-supplied link → plain text name.
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
  options?: { collection?: string | null },
): AsyncGenerator<LibrarianStep> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const _t0 = Date.now();

  const ai = new GoogleGenAI({ apiKey });

  // Load research notebook if thread exists
  const notebook = threadId ? await loadNotebook(threadId) : null;
  const notebookContext = formatNotebookForPrompt(notebook);
  // User messages in history = prior user turns. This message is the next one.
  const messageIndex = history.filter(m => m.role === 'user').length + 1;

  // Collection catalog (so the model can map a topic → the right slug) and the
  // optional collection context (when the Librarian was opened from a collection
  // page, searches lean toward it by default). Resolve the context to a real
  // slug so a stray value can't silently break weighting.
  const { formatCatalogForPrompt, resolveCollectionSlug } = await import('@/lib/embassy/collection-catalog');
  const [catalog, collectionContext] = await Promise.all([
    formatCatalogForPrompt(),
    resolveCollectionSlug(options?.collection),
  ]);
  const systemPrompt = buildSystemPrompt(notebookContext, messageIndex, { catalog, collectionContext });

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
  // `${bookId}:${page}` for every page the model actually retrieved this turn
  // (search hits + get_book_page + read_nearby_pages). Used to ground the
  // page citations in the final answer — see verifyCitations.
  const retrievedPageKeys = new Set<string>();
  let choicesPresented = false;
  // True once the model voluntarily stops searching and writes its answer. If it
  // instead runs out of search rounds (MAX_ROUNDS) while still calling tools, we
  // force a final synthesis turn below so the reader never gets a stub or an
  // empty reply (see the "kites" regression, issue #2826).
  let answeredNaturally = false;
  const usage: TurnUsage = { model: MODEL, rounds: 0, promptTokens: 0, outputTokens: 0, thinkingTokens: 0, cachedTokens: 0 };

  function collectSources(sources?: SourceCard[]) {
    if (!sources) return;
    for (const s of sources) {
      const key = `${s.book_id}:${s.pageNumber || 0}`;
      if (!seenSourceKeys.has(key)) {
        seenSourceKeys.add(key);
        allSources.push(s);
      }
      if (s.pageNumber) retrievedPageKeys.add(`${s.book_id}:${s.pageNumber}`);
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
    // usageMetadata is cumulative within one generateContentStream call —
    // keep the last chunk's value, then sum across rounds.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let roundUsage: any = null;

    for await (const chunk of stream) {
      if (chunk.usageMetadata) roundUsage = chunk.usageMetadata;
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

    usage.rounds++;
    if (roundUsage) {
      usage.promptTokens += roundUsage.promptTokenCount ?? 0;
      usage.outputTokens += roundUsage.candidatesTokenCount ?? 0;
      usage.thinkingTokens += roundUsage.thoughtsTokenCount ?? 0;
      usage.cachedTokens += roundUsage.cachedContentTokenCount ?? 0;
    }

    if (allParts.length === 0) break;
    contents.push({ role: 'model', parts: allParts });

    if (functionCalls.length === 0) { answeredNaturally = true; break; }

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
          return await executeTool(fc.name, fc.args || {}, threadId, collectionContext);
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

      // Pages read directly (not via search) also count as grounded.
      if (fc.name === 'get_book_page' && fc.args?.book_id != null && fc.args?.page_number != null) {
        retrievedPageKeys.add(`${fc.args.book_id}:${Number(fc.args.page_number)}`);
      } else if (fc.name === 'read_nearby_pages' && fc.args?.book_id != null && fc.args?.center_page != null) {
        const center = Number(fc.args.center_page);
        const r = Math.min(Number(fc.args.range) || 2, 3);
        for (let p = center - r; p <= center + r; p++) retrievedPageKeys.add(`${fc.args.book_id}:${p}`);
      }

      responseParts.push({ functionResponse: { name: fc.name, response: result } });

      // present_choices ends the turn: the model has delivered its answer and is
      // now offering follow-up directions. Stop after this round so the post-loop
      // source dedup + link verification still run over the answer text.
      if (fc.name === 'present_choices') {
        choicesPresented = true;
      }
    }

    contents.push({ role: 'user', parts: responseParts });

    if (choicesPresented) break;
  }

  // Forced synthesis. If the loop exited because it exhausted MAX_ROUNDS while
  // the model was still issuing tool calls, the model never got a turn to read
  // its last results and write an answer — so the reader gets a shallow stub or
  // (when no text was ever emitted) an empty reply. Give it one final turn with
  // NO tools available, which compels a text answer synthesized from everything
  // gathered above. Skipped when the model already answered on its own or ended
  // the turn with present_choices.
  if (!answeredNaturally && !choicesPresented) {
    contents.push({
      role: 'user',
      parts: [{
        text: 'You have gathered enough material. Stop searching now and write your answer for the reader using ONLY the sources and pages you retrieved above. Synthesize them into a focused, well-cited response with page links — do not call any more tools.',
      }],
    });

    try {
      const finalStream = await ai.models.generateContentStream({
        model: MODEL,
        // No tools in the config → the model cannot search and must answer.
        contents,
        config: { temperature: TEMPERATURE },
      });

      const finalParts: Array<Record<string, unknown>> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let finalUsage: any = null;
      for await (const chunk of finalStream) {
        if (chunk.usageMetadata) finalUsage = chunk.usageMetadata;
        const candidate = chunk.candidates?.[0];
        if (!candidate?.content?.parts) continue;
        for (const part of candidate.content.parts) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p = part as any;
          if (p.text) {
            finalParts.push(p);
            yield { type: 'text', text: p.text };
          }
        }
      }

      usage.rounds++;
      if (finalUsage) {
        usage.promptTokens += finalUsage.promptTokenCount ?? 0;
        usage.outputTokens += finalUsage.candidatesTokenCount ?? 0;
        usage.thinkingTokens += finalUsage.thoughtsTokenCount ?? 0;
        usage.cachedTokens += finalUsage.cachedContentTokenCount ?? 0;
      }
      if (finalParts.length > 0) contents.push({ role: 'model', parts: finalParts });
    } catch (err) {
      console.error('[Librarian] Forced synthesis failed:', err instanceof Error ? err.message : err);
    }
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

  const { brokenBooks, unverifiedPages } = await verifyCitations(fullText, retrievedPageKeys);
  const clauses: string[] = [];
  if (brokenBooks.length > 0) {
    clauses.push(
      `${brokenBooks.length === 1 ? 'a book link that points' : `${brokenBooks.length} book links that point`} to a record not in the collection (${brokenBooks.map(b => `\`${b}\``).join(', ')}) — these may be books we don't yet hold`,
    );
  }
  if (unverifiedPages.length > 0) {
    clauses.push(
      `${unverifiedPages.length === 1 ? 'a page citation' : `${unverifiedPages.length} page citations`} I couldn't confirm against the source (${unverifiedPages.map(p => `\`${p}\``).join(', ')}) — please open the linked page to check the quote before relying on it`,
    );
  }
  if (clauses.length > 0) {
    console.warn('[Librarian] citation check flagged', { brokenBooks, unverifiedPages });
    yield {
      type: 'text',
      text: `\n\n---\n*A note on sourcing: this answer contains ${clauses.join('; and ')}.*`,
    };
  }

  // Persist AI cost for the librarian — the heaviest request-path AI feature
  // (agentic, several Gemini calls per turn). usage is already summed across
  // rounds; thinking tokens bill at the output rate, so fold them in for cost.
  logAiUsage({
    feature: 'librarian',
    model: usage.model,
    inputTokens: usage.promptTokens,
    outputTokens: usage.outputTokens + usage.thinkingTokens,
    ms: Date.now() - _t0,
    ok: true,
  });

  yield { type: 'usage', usage };
}

/**
 * Verify the book + page citations in a response against the library.
 *
 * Two failure modes matter for a scholarly tool:
 *  - brokenBooks: links to /book/<slug> for a book that doesn't exist.
 *  - unverifiedPages: a specific page the model never actually retrieved this
 *    turn AND that doesn't exist in the page store (or is out of range) — the
 *    signature of a fabricated or misremembered page number.
 *
 * `retrievedPageKeys` holds `${bookId}:${page}` for every page the model read
 * (via search, get_book_page, or read_nearby_pages) during this turn; anything
 * it actually saw is trusted and not re-checked.
 */
export async function verifyCitations(
  text: string,
  retrievedPageKeys: Set<string>,
): Promise<{ brokenBooks: string[]; unverifiedPages: string[] }> {
  // /book/<slug>, optionally followed by ?page=N, /page-number/N, or /page/N.
  const citePattern = /sourcelibrary\.org\/book\/([a-z0-9-]+)(?:(?:\/page-number\/|\/page\/|\?page=)(\d+))?/g;
  const citedPages = new Map<string, Set<number>>();
  const allSlugs = new Set<string>();
  let match;
  while ((match = citePattern.exec(text)) !== null) {
    const slug = match[1];
    allSlugs.add(slug);
    if (match[2]) {
      if (!citedPages.has(slug)) citedPages.set(slug, new Set());
      citedPages.get(slug)!.add(Number(match[2]));
    }
  }
  if (allSlugs.size === 0) return { brokenBooks: [], unverifiedPages: [] };

  const db = await getDb();
  const books = await db.collection('books')
    .find({ slug: { $in: [...allSlugs] } })
    .project({ slug: 1, id: 1, pages_count: 1 })
    .toArray();

  const slugToBook = new Map(
    books.map(b => [b.slug as string, { id: b.id as string, pagesCount: b.pages_count as number | undefined }]),
  );
  const brokenBooks = [...allSlugs].filter(s => !slugToBook.has(s)).map(s => `sourcelibrary.org/book/${s}`);

  // A cited page is trusted if the model read it this turn; otherwise it must
  // exist in the page store and sit within the book's range.
  const unverified = new Set<string>();
  const toCheck: Array<{ slug: string; bookId: string; page: number }> = [];
  for (const [slug, pages] of citedPages) {
    const book = slugToBook.get(slug);
    if (!book) continue; // already counted as a broken book link
    for (const page of pages) {
      if (retrievedPageKeys.has(`${book.id}:${page}`)) continue;
      if (book.pagesCount && (page < 1 || page > book.pagesCount)) {
        unverified.add(`${slug} p.${page}`);
        continue;
      }
      toCheck.push({ slug, bookId: book.id, page });
    }
  }

  if (toCheck.length > 0) {
    const existing = await db.collection('pages')
      .find({ $or: toCheck.map(c => ({ book_id: c.bookId, page_number: c.page })) })
      .project({ book_id: 1, page_number: 1 })
      .toArray();
    const existingKeys = new Set(existing.map(p => `${p.book_id}:${p.page_number}`));
    for (const c of toCheck) {
      if (!existingKeys.has(`${c.bookId}:${c.page}`)) unverified.add(`${c.slug} p.${c.page}`);
    }
  }

  return { brokenBooks, unverifiedPages: [...unverified] };
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
