import { getDb } from '@/lib/mongodb';
import {
  findCitedArtworkSlugs,
  findCitedBookLinks,
  findCitedCollectionSlugs,
  findEmbeddedImageUrls,
  type CitationFix,
} from '@/lib/embassy/citation-fixes';
import { PREFIXED_LOCALES, type Locale } from '@/lib/locale-path';
import {
  localizedTitle,
  localizedEditionFilter,
  isNativeEdition,
  type LocalizedBookMap,
} from '@/lib/localized';
import { GoogleGenAI, Type, type FunctionDeclaration, type GenerateContentResponse } from '@google/genai';
import { logAiUsage } from '@/lib/log-ai-usage';
// Atlas keyword + Supabase semantic are now combined in @/lib/search/librarian-search.
// Atlas-search builders no longer imported here directly.
import { supabase } from '@/lib/supabase';
import { ObjectId, type Document, type WithId } from 'mongodb';
import { stripAnnotations } from '@/lib/semantic-alignment';
import { getBookThumbnailUrl } from '@/lib/utils';
import { CLIP_URL } from '@/lib/clip';
import { BOOK_SEARCH_INDEX } from '@/lib/atlas-search';
import collectionRedirects from '@/lib/collection-redirects.json';

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
/** Broken slugs we attempt to repair in one turn; the rest are disclaimed. */
const MAX_REPAIR_SLUGS = 12;
/** Wall-clock ceiling on the whole repair loop, guarding the turn's deadline. */
const REPAIR_BUDGET_MS = 5000;

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
  type: 'thinking' | 'tool_call' | 'tool_result' | 'choices' | 'text' | 'sources' | 'notebook_update' | 'usage' | 'citation_fixes' | 'image_removals';
  text?: string;
  // Link repairs computed after citation verification — the route and the
  // streaming clients apply these to the already-emitted text (see
  // src/lib/embassy/citation-fixes.ts).
  fixes?: CitationFix[];
  // Fabricated `![](url)` embeds to strip from the already-emitted text.
  removeUrls?: string[];
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
    name: 'browse_catalog',
    description: 'Browse the CATALOGUE by filter and get an EXACT count — "what do you have in Spanish", "how many books from before 1600", "list everything in the astrology collection", "how many first translations". This answers how-many / show-me-everything questions that `search` structurally cannot: search returns only the strongest matching PASSAGES, so counting books from its results undercounts the shelf by orders of magnitude. Returns the real total, a representative list with links, and a browse URL for the rest.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        language: { type: Type.STRING, description: 'The language the edition is PRINTED in, named in English: "Spanish", "Latin", "Greek", "Chinese", "Tibetan". This is the language on the leaves of the scan — a Latin book we translated into English is still "Latin". Use this for "books published/written in X".' },
        readable_in: { type: Type.STRING, description: 'Two-letter code of a language the reader can READ the book in — currently only "es". Matches books written in Spanish PLUS books we have translated into Spanish. This, not `language`, is what "libros en español" / "books available in Spanish" means.' },
        collection: { type: Type.STRING, description: 'A collection slug from the "Collections" list in your instructions. Here it is a hard FILTER (in `search` the same argument is only a lean).' },
        author: { type: Type.STRING, description: 'Match part of the author name as catalogued (e.g. "Ficino", "Paracelsus").' },
        year_from: { type: Type.NUMBER, description: 'Earliest publication year, inclusive. ~13% of books carry no parsed year and drop out whenever either year bound is set — the result says so.' },
        year_to: { type: Type.NUMBER, description: 'Latest publication year, inclusive.' },
        first_translation: { type: Type.BOOLEAN, description: 'Only books carrying the first-translation badge.' },
        sort: { type: Type.STRING, description: 'oldest (default) | newest | title | most_translated' },
        limit: { type: Type.NUMBER, description: 'How many books to list back, 1-30 (default 15). The total count is exact no matter how few are listed.' },
      },
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

// ── Language ──────────────────────────────────────────────────────────

/**
 * Book URLs the model is handed (and told to copy verbatim) carry the locale
 * prefix, so a Spanish conversation cites `/es/book/…` and the reader stays in
 * the Spanish chrome. Every `/book/*` shape the Librarian emits has an `/es`
 * twin (see LOCALIZED_PATTERNS in src/lib/locale-path.ts).
 */
function siteBase(lang: Locale): string {
  return lang === 'en' ? 'https://sourcelibrary.org' : `https://sourcelibrary.org/${lang}`;
}

/**
 * The page text the Librarian quotes, in the reader's language when we hold
 * it. Search and the page tools read `translation.data` (English); for another
 * locale this looks up `pages.translations.<lang>.data` for the same pages and
 * returns what exists. A page with no edition in that language is simply
 * absent from the map — the caller keeps the English text and LABELS it, so
 * the model quotes our Spanish edition where there is one and never
 * re-translates the English on the fly (`.claude/docs/i18n.md` rule 4).
 */
async function loadLocalizedTexts(
  lang: Locale,
  keys: Array<{ book_id: string; page_number: number }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (lang === 'en' || keys.length === 0) return out;
  const db = await getDb();
  const field = `translations.${lang}.data`;
  const rows = await db.collection('pages')
    .find({ $or: keys.map(k => ({ book_id: k.book_id, page_number: k.page_number })), [field]: { $exists: true, $ne: '' } })
    .project({ book_id: 1, page_number: 1, [field]: 1 })
    .toArray();
  for (const r of rows) {
    const text = (r.translations as Record<string, { data?: string }> | undefined)?.[lang]?.data;
    if (typeof text === 'string' && text.trim()) out.set(`${r.book_id}:${r.page_number}`, text);
  }
  return out;
}

const LANG_NAMES: Record<Locale, string> = { en: 'English', es: 'Spanish' };

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

async function executeGetBookPage(bookId: string, pageNumber: number, lang: Locale = 'en'): Promise<{
  text: string; textLang: Locale; originalText?: string; bookTitle: string; bookAuthor: string; bookSlug?: string;
} | null> {
  const db = await getDb();
  const page = await db.collection('pages').findOne(
    { book_id: bookId, page_number: pageNumber },
    { projection: { 'translation.data': 1, 'ocr.data': 1 } },
  );
  if (!page) return null;
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { title: 1, display_title: 1, author: 1, slug: 1 } });
  const localized = (await loadLocalizedTexts(lang, [{ book_id: bookId, page_number: pageNumber }])).get(`${bookId}:${pageNumber}`);
  return {
    text: localized ?? page.translation?.data ?? '', textLang: localized ? lang : 'en', originalText: page.ocr?.data?.slice(0, 800),
    bookTitle: book?.display_title || book?.title || 'Unknown', bookAuthor: book?.author || 'Unknown', bookSlug: book?.slug,
  };
}

async function executeReadNearbyPages(bookId: string, centerPage: number, range = 2, lang: Locale = 'en'): Promise<{
  pages: Array<{ page_number: number; text: string; textLang: Locale }>; bookTitle: string; bookAuthor: string; bookSlug?: string;
}> {
  const db = await getDb();
  const r = Math.min(range, 3);
  const pages = await db.collection('pages')
    .find({ book_id: bookId, page_number: { $gte: centerPage - r, $lte: centerPage + r } })
    .project({ page_number: 1, 'translation.data': 1 })
    .sort({ page_number: 1 })
    .toArray();

  const book = await db.collection('books').findOne({ id: bookId }, { projection: { title: 1, display_title: 1, author: 1, slug: 1 } });
  const localized = await loadLocalizedTexts(lang, pages.map(p => ({ book_id: bookId, page_number: p.page_number })));

  return {
    pages: pages.map(p => {
      const local = localized.get(`${bookId}:${p.page_number}`);
      return { page_number: p.page_number, text: (local ?? p.translation?.data ?? '').slice(0, 1000), textLang: (local ? lang : 'en') as Locale };
    }),
    bookTitle: book?.display_title || book?.title || 'Unknown',
    bookAuthor: book?.author || 'Unknown',
    bookSlug: book?.slug,
  };
}

// Terms that appear in virtually every gallery row (every entry IS an
// illustration). In a $text query their posting lists cover the whole
// collection, exploding the scoring set without adding signal.
const IMAGE_QUERY_NOISE = new Set([
  'illustration', 'illustrations', 'image', 'images', 'picture', 'pictures',
  'depiction', 'depictions', 'drawing', 'drawings', 'print', 'prints',
  'plate', 'plates', 'figure', 'figures', 'engraving', 'engravings',
  'woodcut', 'woodcuts', 'diagram', 'diagrams', 'historical', 'antique',
  'showing', 'depicting', 'of', 'the', 'a', 'an', 'and', 'with', 'in',
]);

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
  const projection = { id: 1, page_id: 1, detection_index: 1, image_url: 1, description: 1, museum_description: 1, book_id: 1, book_title: 1, book_author: 1, book_slug: 1, page_number: 1, type: 1 };

  // The keyword arm uses the weighted $text index (gallery_images_text_idx:
  // description ×5, museum_description ×3, subjects/figures/symbols ×2), NOT a
  // regex. The previous multi-token lookahead regex was an unindexed full scan
  // over 200K docs that ran 30s+ — as the old CLIP-empty fallback it was a
  // latent landmine (the June "timeout_warning" pattern on image-heavy
  // queries), and running it on every call froze the whole agent turn.
  //
  // Two guards keep $text fast: strip gallery-noise terms whose posting lists
  // span nearly every row (every doc IS an illustration/woodcut/print, so
  // those words only inflate the scoring set — "…botanical illustration"
  // pushed the query past 8s), and cap at 4 terms. maxTimeMS degrades the arm
  // to CLIP-only instead of hanging the turn.
  const textFilter: Record<string, unknown> = { gallery_quality: { $gte: 0.7 } };
  if (bookId) textFilter.book_id = bookId;
  const searchTerms = query.split(/\s+/)
    .filter(w => !IMAGE_QUERY_NOISE.has(w.toLowerCase()))
    .slice(0, 4)
    .join(' ');
  const textPromise = searchTerms
    ? db.collection('gallery_images')
        .find(
          { ...textFilter, $text: { $search: searchTerms } },
          { projection: { ...projection, score: { $meta: 'textScore' } } },
        )
        .sort({ score: { $meta: 'textScore' } })
        .limit(6)
        .maxTimeMS(8000)
        .toArray()
        .catch((err: unknown) => {
          console.warn('[Librarian] gallery text search failed:', err instanceof Error ? err.message : err);
          return [] as WithId<Document>[];
        })
    : Promise.resolve([] as WithId<Document>[]);

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
  const images: Document[] = [];
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
      // Viewer id is the compound `<pageId>-<detectionIndex>` (gallery_images.id),
      // NOT the Mongo ObjectId — /gallery/image/<objectIdHex> can't be parsed
      // by the viewer route and soft-404s.
      id: img.id || `${img.page_id}-${img.detection_index}`,
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

// ── Catalogue Browse ──────────────────────────────────────────────────

/**
 * The shelf, not the passages.
 *
 * `search` ranks passages, so every "what do you have in X / how many / list
 * them all" question used to be answered from whatever the top few hits
 * happened to be: asked for "all the books published in Spanish" the Librarian
 * replied with 5 books drawn from 8 passages, against a shelf of 74. A count is
 * a different query from a relevance ranking, and this is it — filter, exact
 * count, a representative page of rows, and the browse URL showing the rest.
 */

const BROWSE_MAX_LIMIT = 30;
const BROWSE_DEFAULT_LIMIT = 15;

interface BrowseRow {
  id: string;
  slug?: string;
  title?: string;
  display_title?: string;
  localized?: LocalizedBookMap | null;
  author?: string;
  year?: number;
  published?: string;
  language?: string;
  pages_count?: number;
  pages_translated?: number;
  pages_translated_es?: number;
  is_first_translation?: boolean;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Live, main-site books only — the same set every public browse surface counts. */
function browseBaseFilter(): Record<string, unknown> {
  return { visible: true, pages_count: { $gt: 0 }, ...tenantVisibilityFilter() };
}

// The catalogued `language` values with their live counts. Cached because the
// model asks for "Spanish" the same way on every thread and the histogram moves
// by a handful of books a week.
let languageHistogramCache: { at: number; rows: Array<{ language: string; count: number }> } | null = null;

async function languageHistogram(): Promise<Array<{ language: string; count: number }>> {
  if (languageHistogramCache && Date.now() - languageHistogramCache.at < 600_000) {
    return languageHistogramCache.rows;
  }
  const db = await getDb();
  const rows = await db.collection('books').aggregate<{ _id: string; n: number }>([
    { $match: { ...browseBaseFilter(), language: { $type: 'string', $ne: '' } } },
    { $group: { _id: '$language', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ], { maxTimeMS: 20000 }).toArray();
  languageHistogramCache = { at: Date.now(), rows: rows.map(r => ({ language: r._id, count: r.n })) };
  return languageHistogramCache.rows;
}

/**
 * Map what the model typed to the values actually in the catalogue.
 *
 * Exact (case-insensitive) first, because that is what `/languages/<slug>`
 * counts — a tool that reports 74 and links a page showing 68 is a worse answer
 * than one that reports 68. Compound values ("Old Spanish", "Spanish / Latin",
 * "Nahuatl-Spanish") are separate shelves and come back as `variants` for the
 * model to mention, never silently folded into the total.
 */
async function resolveLanguageValues(input: string): Promise<{
  matched: string[];
  variants: Array<{ language: string; count: number }>;
  suggestions: string[];
}> {
  const hist = await languageHistogram();
  const wanted = input.trim().toLowerCase();
  const exact = hist.filter(r => r.language.trim().toLowerCase() === wanted);
  const word = new RegExp(`(^|[^a-z])${escapeRegex(wanted)}([^a-z]|$)`, 'i');
  const near = hist.filter(r => r.language.trim().toLowerCase() !== wanted && word.test(r.language));
  if (exact.length > 0) return { matched: exact.map(r => r.language), variants: near, suggestions: [] };
  // No exact shelf: fall back to the compound ones so "Nahuatl" still answers.
  if (near.length > 0) return { matched: near.map(r => r.language), variants: [], suggestions: [] };
  return { matched: [], variants: [], suggestions: hist.slice(0, 12).map(r => `${r.language} (${r.count})`) };
}

interface BrowseArgs {
  language?: string;
  readable_in?: string;
  collection?: string;
  author?: string;
  year_from?: number;
  year_to?: number;
  first_translation?: boolean;
  sort?: string;
  limit?: number;
}

const BROWSE_SORTS: Record<string, Record<string, 1 | -1>> = {
  oldest: { year: 1, title: 1 },
  newest: { year: -1, title: 1 },
  title: { title: 1 },
  most_translated: { pages_translated: -1, title: 1 },
};

async function executeBrowseCatalog(args: BrowseArgs, lang: Locale): Promise<{
  total: number;
  rows: BrowseRow[];
  filterLabel: string;
  browseUrl: string | null;
  notes: string[];
  sort: string;
}> {
  const db = await getDb();
  const conditions: Record<string, unknown>[] = [browseBaseFilter()];
  const labels: string[] = [];
  const notes: string[] = [];
  // Only a single-axis filter has a browse page showing exactly the same set.
  // Anything narrower gets no URL rather than one that quietly means something
  // else.
  let linkable: { kind: 'language' | 'collection' | 'readable'; value: string } | null = null;

  const languageInput = (args.language || '').trim();
  if (languageInput) {
    const { matched, variants, suggestions } = await resolveLanguageValues(languageInput);
    if (matched.length === 0) {
      notes.push(`No shelf is catalogued as "${languageInput}". The largest languages we do hold: ${suggestions.join(', ')}.`);
      conditions.push({ language: '__no_such_language__' });
    } else {
      conditions.push(matched.length === 1 ? { language: matched[0] } : { language: { $in: matched } });
      linkable = { kind: 'language', value: matched[0] };
    }
    labels.push(`printed in ${matched.length > 0 ? matched.join(' / ') : languageInput}`);
    if (variants.length > 0) {
      notes.push(`Counted only books catalogued exactly as "${matched[0]}". Related shelves NOT in this total: ${variants.map(v => `${v.language} (${v.count})`).join(', ')}.`);
    }
  }

  const readable = (args.readable_in || '').trim().toLowerCase();
  if (readable) {
    if (readable === 'en') {
      notes.push('English is the root edition — nearly every book is readable in English, so `readable_in: "en"` was ignored.');
    } else if ((PREFIXED_LOCALES as string[]).includes(readable)) {
      // Native original OR pages translated into that language — the same
      // predicate every /es surface gates on (src/lib/localized.ts), so this
      // total matches what the reader can actually open.
      conditions.push(localizedEditionFilter(readable as Exclude<Locale, 'en'>));
      labels.push(`readable in ${LANG_NAMES[readable as Locale] || readable}`);
      linkable = { kind: 'readable', value: readable };
    } else {
      notes.push(`We do not publish editions in "${readable}" yet — that filter was ignored.`);
    }
  }

  const collectionInput = (args.collection || '').trim();
  if (collectionInput) {
    const { resolveCollectionSlug } = await import('@/lib/embassy/collection-catalog');
    const slug = await resolveCollectionSlug(collectionInput);
    if (slug) {
      conditions.push({ collections: slug });
      labels.push(`in the "${slug}" collection`);
      linkable = { kind: 'collection', value: slug };
    } else {
      notes.push(`No collection matches "${collectionInput}" — that filter was ignored.`);
    }
  }

  const author = (args.author || '').trim();
  if (author) {
    conditions.push({ author: new RegExp(escapeRegex(author), 'i') });
    labels.push(`author matching "${author}"`);
    linkable = null;
  }

  const yearFrom = typeof args.year_from === 'number' ? Math.round(args.year_from) : null;
  const yearTo = typeof args.year_to === 'number' ? Math.round(args.year_to) : null;
  if (yearFrom !== null || yearTo !== null) {
    const range: Record<string, number> = {};
    if (yearFrom !== null) range.$gte = yearFrom;
    if (yearTo !== null) range.$lte = yearTo;
    conditions.push({ year: range });
    labels.push(`published ${yearFrom ?? '…'}–${yearTo ?? '…'}`);
    notes.push('Books with no parsed publication year are excluded from a year-bounded count.');
    linkable = null;
  }

  if (args.first_translation) {
    conditions.push({ is_first_translation: true });
    labels.push('first translations');
    linkable = null;
  }

  const filter = conditions.length === 1 ? conditions[0] : { $and: conditions };
  const sortKey = BROWSE_SORTS[args.sort || ''] ? (args.sort as string) : 'oldest';
  const limit = Math.min(Math.max(Math.round(args.limit ?? BROWSE_DEFAULT_LIMIT), 1), BROWSE_MAX_LIMIT);

  const [total, rows] = await Promise.all([
    db.collection('books').countDocuments(filter, { maxTimeMS: 20000 }),
    db.collection('books').find(filter, {
      projection: {
        _id: 0, id: 1, slug: 1, title: 1, display_title: 1, localized: 1, author: 1, year: 1,
        published: 1, language: 1, pages_count: 1, pages_translated: 1, pages_translated_es: 1,
        is_first_translation: 1,
      },
      sort: BROWSE_SORTS[sortKey],
      limit,
      maxTimeMS: 20000,
      collation: { locale: 'en', strength: 1 },
    }).toArray() as unknown as Promise<BrowseRow[]>,
  ]);

  const base = siteBase(lang);
  let browseUrl: string | null = null;
  if (linkable?.kind === 'collection') {
    browseUrl = `${base}/collections/${linkable.value}`;
  } else if (linkable?.kind === 'readable' && linkable.value === 'es') {
    browseUrl = `${base}/collections/en-espanol`;
  } else if (linkable?.kind === 'language') {
    // /languages/<slug> has no localized twin (LOCALIZED_PATTERNS in
    // locale-path.ts), so it is always the unprefixed URL — an /es/languages/…
    // link would 404.
    browseUrl = `https://sourcelibrary.org/languages/${linkable.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
  } else if (labels.length === 0) {
    browseUrl = `${base}/collections`;
  }

  return { total, rows, filterLabel: labels.join(', ') || 'the whole library', browseUrl, notes, sort: sortKey };
}

/**
 * The rows as the model should see them: the title to show, the link, and how
 * much of the book is readable in THIS conversation's language.
 */
function formatBrowseRows(rows: BrowseRow[], lang: Locale): string {
  const base = siteBase(lang);
  return rows.map(b => {
    const shown = localizedTitle(b, lang);
    const original = b.title && b.title !== shown ? ` [original title: ${b.title}]` : '';
    const year = b.year || (b.published || '').trim();
    const pages = b.pages_count || 0;
    let readable: string;
    if (lang === 'en') {
      const pct = pages > 0 ? Math.round(((b.pages_translated || 0) / pages) * 100) : 0;
      readable = `${pct}% in English`;
    } else if (isNativeEdition(b as unknown as Record<string, unknown>, lang)) {
      readable = `original ${LANG_NAMES[lang]} edition`;
    } else {
      const counter = lang === 'es' ? (b.pages_translated_es || 0) : 0;
      const pct = pages > 0 ? Math.round((counter / pages) * 100) : 0;
      readable = `${pct}% in ${LANG_NAMES[lang]}`;
    }
    const bits = [b.language, `${pages} pp`, readable];
    if (b.is_first_translation) bits.push('first translation');
    return `- "${shown}"${original} by ${b.author || 'Unknown'}${year ? ` (${year})` : ''} — ${bits.filter(Boolean).join(', ')} — ${base}/book/${b.slug || b.id}`;
  }).join('\n');
}

// ── Tool Router ───────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  threadId?: string,
  collectionContext?: string | null,
  lang: Locale = 'en',
): Promise<{ result: unknown; step: LibrarianStep; sources?: SourceCard[] }> {
  const base = siteBase(lang);
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
      // Spanish conversation: swap in the Spanish edition for every passage
      // that has one, and say which language each passage is in so the model
      // can label an English-only quote instead of translating it itself.
      const localized = await loadLocalizedTexts(lang, data.passages.map(p => ({ book_id: p.book_id, page_number: p.page_number })));
      for (const p of data.passages) {
        const t = localized.get(`${p.book_id}:${p.page_number}`);
        if (t) p.text = t.slice(0, 1200);
      }

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
          context += `- "${b.title}" by ${authorPart}${b.year ? ` (${b.year})` : ''} — ${base}/book/${b.slug || b.id}\n`;
        }
      }
      if (data.passages.length > 0) {
        context += '\nPassages found:\n';
        for (const p of data.passages) {
          const url = `${base}/book/${p.bookSlug || p.book_id}/page-number/${p.page_number}`;
          const langTag = lang === 'en'
            ? ''
            : (localized.has(`${p.book_id}:${p.page_number}`)
              ? ` [text: ${LANG_NAMES[lang]} edition]`
              : ` [text: English only — no ${LANG_NAMES[lang]} edition of this page]`);
          context += `\n--- ${p.bookTitle} by ${p.bookAuthor}, Page ${p.page_number} (${url})${langTag} ---\n${p.text}\n`;
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

    case 'browse_catalog': {
      const data = await executeBrowseCatalog(args as BrowseArgs, lang);
      let context = `Catalogue browse — ${data.total} book${data.total === 1 ? '' : 's'} match: ${data.filterLabel}. This count is EXACT and covers the whole library — report IT as the answer, never the number of rows listed below.\n`;
      if (data.notes.length > 0) context += `${data.notes.map(n => `Note: ${n}`).join('\n')}\n`;
      if (data.rows.length > 0) {
        context += `\nShowing ${data.rows.length} of ${data.total} (${data.sort} first):\n${formatBrowseRows(data.rows, lang)}\n`;
      }
      if (data.browseUrl) context += `\nBrowse all ${data.total} here — link this so the reader can see the rest: ${data.browseUrl}\n`;
      return {
        result: { found: data.total, context },
        step: { type: 'tool_result', name: 'browse_catalog', query: data.filterLabel, found: data.total,
          summary: `${data.total} books — ${data.filterLabel}` },
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
      const result = await executeGetBookPage(bookId, pageNumber, lang);
      return {
        result: result ? { found: 1, text: result.text, textLanguage: LANG_NAMES[result.textLang], originalText: result.originalText, bookTitle: result.bookTitle } : { found: 0, text: 'Page not found.' },
        step: { type: 'tool_result', name: 'get_book_page', query: `p.${pageNumber}`, found: result ? 1 : 0,
          summary: result ? `Read page ${pageNumber} of ${result.bookTitle}` : 'Page not found' },
      };
    }

    case 'read_nearby_pages': {
      const bookId = args.book_id as string;
      const centerPage = args.center_page as number;
      const range = (args.range as number) || 2;
      const result = await executeReadNearbyPages(bookId, centerPage, range, lang);
      let context = `Pages from ${result.bookTitle}:\n`;
      for (const p of result.pages) {
        const langTag = lang === 'en' ? '' : ` [text: ${p.textLang === 'en' ? 'English only' : `${LANG_NAMES[lang]} edition`}]`;
        context += `\n--- Page ${p.page_number}${langTag} ---\n${p.text}\n`;
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
      const { filterVisibleArtworks } = await import('@/lib/artwork-visibility');
      const artworkDb = await getDb();
      const rawArtworks = await semanticArtworkSearch(query, 8, { genre, period, culture, collection });
      const artworks = await filterVisibleArtworks(artworkDb, rawArtworks);

      // The Supabase `thumbnail_url` is a stale 150px `book-thumbnails/{id}-thumb.jpg`
      // snapshot — too small to embed in a chat answer (reported on /librarian,
      // #3051), and the real high-res lives at a different path we can't derive
      // from that string. Resolve each artwork's live display image (2000px
      // /artwork, Wikimedia CDN, or IIIF) from Mongo via getBookThumbnailUrl.
      const displayImageById = new Map<string, string>();
      if (artworks.length > 0) {
        const artBooks = await artworkDb.collection('books')
          .find(
            { id: { $in: artworks.map(a => a.book_id) } },
            { projection: { _id: 0, id: 1, image_display: 1, image_thumb: 1, thumbnail: 1, thumbnail_blob: 1 }, maxTimeMS: 3000 },
          )
          .toArray()
          .catch(() => [] as Array<Record<string, unknown>>);
        for (const b of artBooks) {
          const url = getBookThumbnailUrl(b as Parameters<typeof getBookThumbnailUrl>[0], 'display');
          if (url && b.id) displayImageById.set(b.id as string, url);
        }
      }
      const imageFor = (a: (typeof artworks)[number]): string | null =>
        displayImageById.get(a.book_id) || a.thumbnail_url;

      let context = '';
      if (artworks.length > 0) {
        context = 'Artworks found:\n';
        for (const a of artworks) {
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
          const img = imageFor(a);
          if (img) context += `  Image: ${img}\n`;
        }
      } else {
        context = 'No matching artworks found.';
      }

      return {
        result: { found: artworks.length, context, artworks: artworks.slice(0, 6).map(a => ({ title: a.display_title || a.title, author: a.author, thumbnail: imageFor(a), period: a.period, genre: a.genre })) },
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
  lang: Locale = 'en',
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

  return buildSystemPromptBody(notebookContext, messageIndex, collectionSection, lang);
}

/**
 * The language block for a non-English conversation. The model already answers
 * in whatever language it is addressed in; what it cannot know on its own is
 * that we HOLD a Spanish edition of many pages and that quoting our edition
 * beats improvising a translation of the English. The tool results carry a
 * `[text: …]` tag per passage for exactly this.
 */
function languageSection(lang: Locale): string {
  if (lang === 'en') return '';
  const name = LANG_NAMES[lang];
  const base = siteBase(lang);
  return `## Language — this is a ${name} conversation

The reader is using the ${name} edition of the library. Write your whole answer in ${name} (headers, captions, suggested next steps included), unless the reader switches language.

Searching: the search index is English, so write your **search queries in English** (translate the reader's terms yourself — "piedra filosofal" → "philosopher's stone") even though you answer in ${name}.

Quotations: each passage a tool returns is tagged \`[text: ${name} edition]\` or \`[text: English only …]\`. Quote the ${name} edition text verbatim when you have it. When a passage is English only, quote it in English inside the blockquote and say in ${name} that this page has not been translated into ${name} yet — do NOT translate the English yourself and present it as a quotation. Paraphrasing in ${name} outside the blockquote is fine. The "original language" rule below still applies: Latin, German, Hebrew etc. can sit alongside.

Links: the tool results give URLs under \`${base}/book/…\` — copy them exactly as given (the \`/${lang}\` prefix keeps the reader in the ${name} site). Page links use the same prefix: [Página N](${base}/book/SLUG?page=N).

`;
}

function buildSystemPromptBody(notebookContext: string, messageIndex: number, collectionSection: string, lang: Locale = 'en'): string {
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
Once you have a direction (from a choice or a specific question), search strategically. The collection includes books in Latin, German, French, Dutch, Hebrew, Sanskrit, Arabic, Greek, and more — nearly all translated into English. **Search in English first.** Use the **search** tool for everything text-based — it fuses keyword and semantic matching so you don't have to choose between them. Note that **search covers books and their pages only — it does NOT return the standalone artworks**; those live in a separate index reachable only via search_artworks (and page illustrations via search_images). So a question the 23,000+ artworks could answer will come back empty from search alone — reach for search_artworks explicitly. Use search_wikipedia for outside context. When you find something promising, use read_nearby_pages for more context. Follow threads across books.

For visual or symbolic topics (emblems, alchemical apparatus, diagrams, seals, planetary symbols, anatomical illustrations), proactively call search_images (for illustrations extracted from book pages) or search_artworks (for standalone museum artworks — paintings, prints, sculptures from Met, Rijksmuseum, Wikimedia Commons). The collection includes 23,000+ artworks spanning all cultures and periods. search_artworks supports filtering by genre, period, culture, and collection. Use it when users ask about visual art, specific artists, or when showing a painting/print would contextualize a text.

**Catalogue questions are a different tool.** "What do you have in Spanish?", "how many books from before 1600?", "list everything in the astrology collection", "how many first translations are there?" are questions about the SHELF, not about passages. \`search\` ranks passages and returns only the strongest handful, so counting books from its results undercounts the library by orders of magnitude — asked for "all the books published in Spanish" it once answered with the 5 books its 8 passages happened to come from, out of 74. Call **browse_catalog** for anything of the form how many / what do you have / list them all / everything by X, report the exact total it returns, show a representative handful with their links, and link the browse URL it hands you so the reader can see the rest. If a question is both ("what do you have in Spanish about alchemy?"), browse for the count and search for the passages.

**Step 5: Save and cite with links.**
Use add_to_notebook for quotes directly relevant to the research question. The notebook persists across messages.

Cite with page-level links: "quoted text" — *[Title](https://sourcelibrary.org/book/SLUG)* by [Author](https://sourcelibrary.org/author/AUTHOR-SLUG), [Page N](https://sourcelibrary.org/book/SLUG?page=N).

Every mention of a book should link to it. Every mention of an author should link to their author page WHEN the tool results give you that author's link. Use the URLs from tool results verbatim — they contain the correct slugs, including the pre-built author link in each "Books found" line. **NEVER construct an author URL yourself by slugifying or translating a name.** The author's name in our catalog is often a different form than the one you'd write in prose (e.g. "Robert Bellarmine" is stored as "Bellarmino, Roberto, S.J"; "Bartholomaeus Fumus" as "Bartolomeo Fumo"), and a hand-built /author/... link will 404. If a tool result has no author link for someone, write their name as plain text — do not invent a link.

**The same rule applies to book URLs.** Only write a /book/... link whose slug appeared verbatim in a tool result THIS turn. Our slugs encode edition, volume, and cataloguing details you cannot guess (the Corpus Hermeticum lives at slugs like \`poimandres-corpus-hermeticum-ficino\`, never \`the-corpus-hermeticum\`), so a slug built from a title will 404 even when we hold the book. If you mention a book the tools did not return this turn, give its title in plain italics with no link — or run a quick search for it first if a link would genuinely help.

When quoting a key passage, include the original language text (Latin, German, Hebrew, etc.) alongside the English if it is notable or if the user appears to be working in that language. Use a blockquote with both versions.

**Step 6: Show images and suggest next steps.**
When search_images or search_artworks returns results, embed the best 1-3 images using markdown: \`![description](imageUrl)\`. **Only use URLs returned by a tool call this turn.** NEVER invent, paraphrase, guess, or recall image URLs — copy them character for character, and never build one by slugifying a title or an artwork's description. Fabricated embeds are stripped from your answer before the reader sees it, and the answer is then labelled as containing an illustration that could not be sourced. If you have no tool-returned image URL, do not write any \`![...](...)\` syntax at all.

When the user explicitly asks for pictures, images, illustrations, **art, artworks, paintings, prints, engravings, or sculptures** ("what pictures do we have of X", "show me X", "what art / artworks do you have of X", "any paintings of X"), calling search_artworks is REQUIRED before you answer (call search_images too when book-page illustrations could also fit) — and your answer must SHOW the results with \`![...](...)\`, not describe them. The word "artwork" (or art/painting/print/sculpture) in the user's question is an unambiguous signal to call search_artworks — never answer an art question from search results alone, since search does not index the standalone artworks. A prose description of a woodcut is never a substitute for embedding it. Prefer images whose descriptions name the subject over ones that merely look similar.

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

${languageSection(lang)}## The collection

Source Library has over 10,000 rare books spanning antiquity through the 18th century, many translated into English for the first time. The collection covers alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, demonology, Indian philosophy, Sanskrit texts, Egyptian sources, early modern science, and related traditions across Western, Middle Eastern, and Asian intellectual history.

${collectionSection}## Formatting

- Use markdown headers (## and ###) to organize longer responses into clear sections
- Use **bold** for key terms and *italics* for book titles (linked: *[Title](url)*)
- Use blockquotes (>) for important quotations from primary sources — always with page citation
- Use paragraph breaks between distinct ideas — leave a blank line between paragraphs. Don't write walls of text
- Conversational but substantive — a research conversation, not a lecture
- Cite 2-4 key passages rather than dumping everything. Every passage needs a page number and link
- Link authors to their author pages ONLY with the author link supplied in the tool results — never a self-built /author/... URL. No tool-supplied link → plain text name.
- Link books to their book pages: *[Book Title](https://sourcelibrary.org/book/slug)* — slug copied exactly from a tool result this turn, never built from the title
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
  options?: { collection?: string | null; lang?: Locale },
): AsyncGenerator<LibrarianStep> {
  const apiKey = process.env.GEMINI_API_KEY;
  const lang: Locale = options?.lang ?? 'en';
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
  const systemPrompt = buildSystemPrompt(notebookContext, messageIndex, { catalog, collectionContext }, lang);

  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: lang === 'es'
      ? 'Entendido. Soy el Bibliotecario: listo para investigar en la colección, en español.'
      : 'I understand. I\'m the Librarian — ready to help with research across the collection.' }] },
    ...history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  // Transient Gemini failures (503 UNAVAILABLE "service overloaded", 500/504)
  // occasionally kill a turn mid-research and the reader gets an apology
  // instead of an answer. Retry the request with a short backoff — but only
  // when this attempt hasn't streamed anything to the reader yet, because
  // re-running after partial output would duplicate the streamed text.
  const isTransientGeminiError = (err: unknown): boolean => {
    const status = (err as { status?: number })?.status;
    if (status && [500, 502, 503, 504].includes(status)) return true;
    const msg = err instanceof Error ? err.message : String(err);
    return /UNAVAILABLE|overloaded|Internal error encountered|"code":\s*50[0234]\b/i.test(msg);
  };

  async function* streamWithRetry(
    request: Parameters<typeof ai.models.generateContentStream>[0],
  ): AsyncGenerator<GenerateContentResponse> {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      let chunksSeen = false;
      try {
        const stream = await ai.models.generateContentStream(request);
        for await (const chunk of stream) {
          chunksSeen = true;
          yield chunk;
        }
        return;
      } catch (err) {
        if (chunksSeen || attempt >= MAX_ATTEMPTS || !isTransientGeminiError(err)) throw err;
        console.warn(`[Librarian] Transient Gemini error (attempt ${attempt}/${MAX_ATTEMPTS}), retrying:`, err instanceof Error ? err.message.slice(0, 200) : err);
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
    }
  }

  const allSources: SourceCard[] = [];
  const seenSourceKeys = new Set<string>();
  // `${bookId}:${page}` for every page the model actually retrieved this turn
  // (search hits + get_book_page + read_nearby_pages). Used to ground the
  // page citations in the final answer — see verifyCitations.
  const retrievedPageKeys = new Set<string>();
  // Every image URL any tool returned this turn. The model is allowed to embed
  // these and nothing else; anything else in an `![](...)` is fabricated.
  const toolImageUrls = new Set<string>();
  // Text the model produced THIS turn. `contents` is seeded with the thread
  // history, so scanning it for citations re-flags every earlier answer's
  // broken links — which crowds real, new breakage out of the repair budget.
  const generatedChunks: string[] = [];
  let choicesPresented = false;
  // True once the model voluntarily stops searching and writes its answer. If it
  // instead runs out of search rounds (MAX_ROUNDS) while still calling tools, we
  // force a final synthesis turn below so the reader never gets a stub or an
  // empty reply (see the "kites" regression, issue #2826).
  let answeredNaturally = false;
  const usage: TurnUsage = { model: MODEL, rounds: 0, promptTokens: 0, outputTokens: 0, thinkingTokens: 0, cachedTokens: 0 };

  // Harvest every URL a tool handed back, wherever it sits in the payload
  // (search_images `imageUrl`, search_artworks `thumbnail`, the prose
  // `context` blocks). Scanning the serialized result keeps this correct when
  // a tool grows a new image field.
  function collectToolImageUrls(result: unknown) {
    if (!result) return;
    let blob: string;
    try {
      blob = JSON.stringify(result);
    } catch {
      return;
    }
    for (const m of blob.matchAll(/https?:\/\/[^\s"'\\)]+/g)) toolImageUrls.add(m[0]);
  }

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
    const stream = streamWithRetry({
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
          generatedChunks.push(p.text);
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
          return await executeTool(fc.name, fc.args || {}, threadId, collectionContext, lang);
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
      collectToolImageUrls(result);

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
      const finalStream = streamWithRetry({
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
            generatedChunks.push(p.text);
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

  // Verify links against the DB — but only over what the model wrote THIS
  // turn. Scanning the whole `contents` array would re-flag (and re-disclaim)
  // every broken link from earlier answers in the thread.
  const fullText = generatedChunks.join('');

  const { brokenBooks, hiddenBooks, unverifiedPages, brokenLinks } = await verifyCitations(fullText, retrievedPageKeys);

  // Fabricated image embeds: the model was told to use only tool-returned URLs.
  // Anything else renders as a broken thumbnail, so drop the embed.
  const fabricatedImages = [...new Set(
    findEmbeddedImageUrls(fullText).filter(u => !toolImageUrls.has(u)),
  )];
  if (fabricatedImages.length > 0) {
    yield { type: 'image_removals', removeUrls: fabricatedImages };
  }

  // Repair before disclaiming: a broken slug is almost always a title-composed
  // near-miss of a book we hold under a different slug (and a hidden book often
  // has a public edition). Resolve each to a held, visible book and emit the
  // rewrites — the route applies them to the persisted message, the streaming
  // clients to the on-screen text. Only what can't be repaired gets the note.
  //
  // Every lookup is indexed now, so the cap is generous; the wall-clock budget
  // is the real guard, because a slow Atlas Search must never push the whole
  // turn past its response deadline.
  const badSlugs = [...new Set([...brokenBooks, ...hiddenBooks])].slice(0, MAX_REPAIR_SLUGS);
  const repairDeadline = Date.now() + REPAIR_BUDGET_MS;
  const fixes: CitationFix[] = [];
  const unrepaired: string[] = [];
  for (const slug of badSlugs) {
    if (Date.now() >= repairDeadline) { unrepaired.push(slug); continue; }
    try {
      const held = await resolveSlugToHeldBook(slug);
      if (held) fixes.push({ fromSlug: slug, toSlug: held.slug, toTitle: held.title });
      else unrepaired.push(slug);
    } catch {
      unrepaired.push(slug);
    }
  }
  // Slugs past the cap are still dead — say so rather than let them pass silently.
  const uncheckedSlugs = [...new Set([...brokenBooks, ...hiddenBooks])].slice(MAX_REPAIR_SLUGS);
  unrepaired.push(...uncheckedSlugs);

  if (fixes.length > 0) {
    yield { type: 'citation_fixes', fixes };
  }

  const clauses: string[] = [];
  if (unrepaired.length > 0) {
    clauses.push(
      `${unrepaired.length === 1 ? 'a book link that points' : `${unrepaired.length} book links that point`} to a record not currently available in the collection (${unrepaired.map(s => `\`sourcelibrary.org/book/${s}\``).join(', ')})`,
    );
  }
  if (brokenLinks.length > 0) {
    clauses.push(
      `${brokenLinks.length === 1 ? 'a link' : `${brokenLinks.length} links`} to a page that doesn't exist (${brokenLinks.map(p => `\`${p}\``).join(', ')})`,
    );
  }
  if (fabricatedImages.length > 0) {
    clauses.push(
      `${fabricatedImages.length === 1 ? 'an illustration I could not source, which I removed' : `${fabricatedImages.length} illustrations I could not source, which I removed`}`,
    );
  }
  if (unverifiedPages.length > 0) {
    clauses.push(
      `${unverifiedPages.length === 1 ? 'a page citation' : `${unverifiedPages.length} page citations`} I couldn't confirm against the source (${unverifiedPages.map(p => `\`${p}\``).join(', ')}) — please open the linked page to check the quote before relying on it`,
    );
  }
  if (clauses.length > 0) {
    yield {
      type: 'text',
      text: `\n\n---\n*A note on sourcing: this answer contains ${clauses.join('; and ')}.*`,
    };
  }

  // Leave a trace for monitoring — broken citations were previously invisible
  // outside per-message disclaimers (and soft-404s never hit status-code logs).
  if (badSlugs.length > 0 || unverifiedPages.length > 0 || brokenLinks.length > 0 || fabricatedImages.length > 0) {
    console.warn('[Librarian] citation check flagged', { brokenBooks, hiddenBooks, unverifiedPages, brokenLinks, fabricatedImages, fixes });
    try {
      const db = await getDb();
      await db.collection('embassy_errors').insertOne({
        kind: 'broken_citation',
        threadId: threadId ?? null,
        brokenBooks,
        hiddenBooks,
        unverifiedPages,
        brokenLinks,
        fabricatedImages,
        repaired: fixes,
        unrepaired,
        createdAt: new Date(),
      });
    } catch { /* best effort */ }
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
 * Four failure modes matter for a scholarly tool:
 *  - brokenBooks: links to /book/<slug> for a book that doesn't exist —
 *    usually a slug the model composed from a title instead of copying from a
 *    tool result (the real book almost always exists under another slug).
 *  - hiddenBooks: links to a book that exists but is not public
 *    (visible: false) — the reader 404s these just like missing books.
 *  - unverifiedPages: a specific page the model never actually retrieved this
 *    turn AND that doesn't exist in the page store (or is out of range) — the
 *    signature of a fabricated or misremembered page number.
 *  - brokenLinks: /artwork/<slug> and /collections/<slug> links that resolve
 *    to nothing. These are reported, never repaired: there is no safe
 *    substitution for a picture or a curated set.
 *
 * brokenBooks/hiddenBooks are returned as bare slugs so the caller can try to
 * repair them (see resolveSlugToHeldBook).
 *
 * A cited path is matched the way the live routes match it, or we would report
 * working links as dead and "repair" them onto a different book: /book/<x>
 * resolves by `slug`, then `slug_aliases`, then `id` (see findBookByIdOrSlug —
 * and note the model is handed an id URL whenever a book has no slug).
 *
 * `retrievedPageKeys` holds `${bookId}:${page}` for every page the model read
 * (via search, get_book_page, or read_nearby_pages) during this turn; anything
 * it actually saw is trusted and not re-checked.
 */
export async function verifyCitations(
  text: string,
  retrievedPageKeys: Set<string>,
): Promise<{ brokenBooks: string[]; hiddenBooks: string[]; unverifiedPages: string[]; brokenLinks: string[] }> {
  const brokenLinks = await verifyNonBookLinks(text);

  const citedPages = new Map<string, Set<number>>();
  const allSlugs = new Set<string>();
  for (const { slug, page } of findCitedBookLinks(text)) {
    allSlugs.add(slug);
    if (page !== undefined) {
      if (!citedPages.has(slug)) citedPages.set(slug, new Set());
      citedPages.get(slug)!.add(page);
    }
  }
  if (allSlugs.size === 0) return { brokenBooks: [], hiddenBooks: [], unverifiedPages: [], brokenLinks };

  const db = await getDb();
  const cited = [...allSlugs];
  const books = await db.collection('books')
    .find({ $or: [{ slug: { $in: cited } }, { slug_aliases: { $in: cited } }, { id: { $in: cited } }] })
    .project({ slug: 1, slug_aliases: 1, id: 1, pages_count: 1, visible: 1 })
    .toArray();

  // One cited token may resolve by slug, by alias, or by id — index all three.
  const slugToBook = new Map<string, { id: string; pagesCount?: number; visible?: boolean }>();
  for (const b of books) {
    const entry = { id: b.id as string, pagesCount: b.pages_count as number | undefined, visible: b.visible as boolean | undefined };
    for (const key of [b.slug as string, b.id as string, ...((b.slug_aliases as string[]) || [])]) {
      if (key && allSlugs.has(key)) slugToBook.set(key, entry);
    }
  }
  const brokenBooks = cited.filter(s => !slugToBook.has(s));
  const hiddenBooks = cited.filter(s => slugToBook.get(s)?.visible === false);

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

  return { brokenBooks, hiddenBooks, unverifiedPages: [...unverified], brokenLinks };
}

/**
 * Check the non-book library links the model likes to compose: /artwork/<slug>
 * and /collections/<slug>. Returns the dead ones as paths, for the disclaimer.
 *
 * `/collection/<slug>` (singular) is never a route — it hits the app's 404 —
 * so it is always dead, no lookup needed.
 */
async function verifyNonBookLinks(text: string): Promise<string[]> {
  const { plural, singular } = findCitedCollectionSlugs(text);
  const artworkSlugs = new Set(findCitedArtworkSlugs(text));
  const collectionSlugs = new Set(plural);
  const dead: string[] = singular.map(s => `/collection/${s}`);

  if (artworkSlugs.size === 0 && collectionSlugs.size === 0) return dead;
  const db = await getDb();

  if (artworkSlugs.size > 0) {
    // Mirrors /artwork/[slug]: exact slug or an `art-` prefixed variant, and
    // never a textual book.
    const wanted = [...artworkSlugs];
    const variants = wanted.flatMap(s => [s, `art-${s}`]);
    const found = await db.collection('books')
      .find({ slug: { $in: variants }, resource_type: { $exists: true }, content_type: { $ne: 'book' }, visible: { $ne: false } })
      .project({ slug: 1 })
      .toArray();
    const live = new Set(found.map(a => (a.slug as string).replace(/^art-/, '')));
    for (const s of wanted) if (!live.has(s)) dead.push(`/artwork/${s}`);
  }

  if (collectionSlugs.size > 0) {
    const wanted = [...collectionSlugs];
    const found = await db.collection('collections')
      .find({ slug: { $in: wanted }, visible: { $ne: false } })
      .project({ slug: 1 })
      .toArray();
    const live = new Set(found.map(c => c.slug as string));
    const redirects = collectionRedirects as Record<string, string>;
    for (const s of wanted) if (!live.has(s) && !redirects[s]) dead.push(`/collections/${s}`);
  }

  return dead;
}

// Slug tokens too generic to anchor a repair lookup on their own.
//
// The cataloguing words matter as much as the stopwords: a model composing a
// slug from a title reaches for `-manuscript`, `-collection`, `-facsimile`,
// and our catalogue rarely carries them. Leaving them in makes the lookup
// require a word no candidate has, so it matches nothing (this is exactly how
// `splendor-solis-manuscript` stayed unrepairable while we hold five editions
// of the book).
const SLUG_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'les', 'des', 'der', 'die', 'das',
  'von', 'van', 'del', 'della', 'sive', 'seu', 'cum', 'per', 'quae', 'qua',
  'vol', 'volume', 'tome', 'tomus', 'pars', 'part', 'complete', 'edition',
  'trans', 'translated', 'translation', 'various', 'anonymous',
  // Cataloguing / format words — describe the artefact, not the work.
  'manuscript', 'manuscripts', 'codex', 'facsimile', 'collection',
  'collections', 'compilation', 'digitization', 'unknown', 'author', 'authors',
]);

/**
 * Fields carried by the `books_search` Atlas index. `slug` is NOT among them,
 * which is fine: every token worth anchoring on also appears in the title or
 * the author.
 */
const REPAIR_SEARCH_PATHS = ['title', 'display_title', 'english_title', 'author'];

/** Hard ceiling on one repair lookup — `$search` ignores maxTimeMS. */
const REPAIR_QUERY_TIMEOUT_MS = 2500;

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms); });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface RepairCandidate {
  slug: string;
  title?: string;
  display_title?: string;
  english_title?: string;
  author?: string;
  read_count?: number;
  pages_count?: number;
}

const normalizeForMatch = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Reject a candidate whose only connection to the broken slug is the author's
 * name. `inscriptionessac00apia-petrus-apian` matches *Cosmographia Petri
 * Apiani* on "apian" alone — a different work by the same man, and a wrong-book
 * substitution is worse than a dead link. Demand that at least one token land
 * in the candidate's title without also being part of its author.
 */
function matchesBeyondAuthor(tokens: string[], cand: RepairCandidate): boolean {
  const titleText = normalizeForMatch([cand.title, cand.display_title, cand.english_title].filter(Boolean).join(' '));
  const authorText = normalizeForMatch(cand.author || '');
  return tokens.some(t => {
    const tok = normalizeForMatch(t);
    return titleText.includes(tok) && !authorText.includes(tok);
  });
}

/**
 * Indexed candidate lookup. `minimumShouldMatch === tokens.length` gives the
 * same AND semantics the old regex chain had, but as one `$search` hit instead
 * of up to four collection scans.
 */
async function findRepairCandidates(
  tokens: string[],
  minimumShouldMatch: number,
  excludeSlug: string,
): Promise<RepairCandidate[]> {
  const db = await getDb();
  const pipeline = [
    {
      $search: {
        index: BOOK_SEARCH_INDEX,
        compound: {
          should: tokens.map(t => ({ text: { query: t, path: REPAIR_SEARCH_PATHS } })),
          minimumShouldMatch,
        },
      },
    },
    { $limit: 60 },
    // `visible` and `pages_count` are not in the search index, so gate after.
    { $match: { visible: true, pages_count: { $gt: 0 }, slug: { $exists: true, $nin: [null, excludeSlug] } } },
    { $project: { _id: 0, slug: 1, title: 1, display_title: 1, english_title: 1, author: 1, read_count: 1, pages_count: 1 } },
    { $limit: 10 },
  ];
  return withTimeout(
    db.collection('books').aggregate(pipeline).toArray() as Promise<RepairCandidate[]>,
    REPAIR_QUERY_TIMEOUT_MS,
    [],
  );
}

/**
 * Try to resolve a broken/hidden book slug to a public book we actually hold.
 *
 * The failure mode this repairs: the model links a famous work with a slug it
 * composed from the title (`oedipus-aegyptiacus-kircher`) while the library
 * holds the book under a catalogued slug
 * (`oedipus-aegyptiacus-volume-i-1652-kircher`). Match strategy: every
 * significant token of the broken slug must appear in the candidate's title or
 * author (conservative — a wrong-book substitution would be worse than a dead
 * link). Among candidates, prefer the most-read edition.
 *
 * Returns null when no candidate matches — the caller falls back to the
 * sourcing disclaimer.
 */
// Extract a volume designator ("vol-ix", "volume-2", "tomus-i") from a slug so
// a repair never silently swaps volumes of a multi-volume work. Roman numerals
// are normalized so vol-ix and vol-9 compare equal.
function volumeOf(slug: string): number | null {
  const m = slug.match(/(?:^|-)(?:vol|volume|tome|tomus|pars|part)-?([0-9]+|[ivxlc]+)(?:-|$)/i);
  if (!m) return null;
  const v = m[1].toLowerCase();
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  const R: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    const cur = R[v[i]];
    const next = R[v[i + 1]] || 0;
    n += cur < next ? -cur : cur;
  }
  return n;
}

export async function resolveSlugToHeldBook(
  slug: string,
): Promise<{ slug: string; title: string } | null> {
  const tokens = [...new Set(
    slug.split('-').filter(t => t.length >= 3 && !SLUG_STOPWORDS.has(t) && !/^\d+$/.test(t)),
  )].slice(0, 8);
  if (tokens.length === 0) return null;

  // Strict first: every token must match. Only if that finds nothing do we
  // allow exactly one token to be missing — a composed slug often carries one
  // word the catalogue lacks ("extrakt", "reformatum"). Relaxing by count
  // rather than by dropping tokens one at a time removes the old ordering
  // sensitivity, where the token most likely to be spurious was the last one
  // tried because it happened to be the longest.
  let candidates = await findRepairCandidates(tokens, tokens.length, slug);
  if (candidates.length === 0 && tokens.length >= 3) {
    candidates = await findRepairCandidates(tokens, tokens.length - 1, slug);
  }

  // Never swap volumes: if both slugs carry a volume designator and they
  // disagree, the candidate is a different physical book of the same work.
  const wantVol = volumeOf(slug);
  candidates = candidates.filter(cand => {
    const candVol = volumeOf(cand.slug);
    return !(wantVol && candVol && wantVol !== candVol);
  });
  // Never swap works: an author-only match is a different book by the same hand.
  candidates = candidates.filter(cand => matchesBeyondAuthor(tokens, cand));
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => (b.read_count || 0) - (a.read_count || 0) || (b.pages_count || 0) - (a.pages_count || 0));
  const best = candidates[0];
  return { slug: best.slug, title: best.display_title || best.title || best.slug };
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
