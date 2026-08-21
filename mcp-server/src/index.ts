#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import {
  searchLibrary,
  searchPassages,
  searchConcept,
  searchWithinBook,
  listBooks,
  getBook,
  getBookText,
  getQuote,
  searchImages,
  submitFeedback,
  shareFindings,
  checkDuplicate,
  ApiError,
} from "./api.js";

/**
 * Map a failed upstream call to a structured, machine-readable error envelope.
 * Agents should branch on `error` (the category) and honor `retry_after` —
 * never parse the human `message`. Categories:
 *   auth_required — sign in / supply an API key (401/403)
 *   rate_limited  — daily page budget reached; retry after the window (429)
 *   not_found     — the book/page/chapter does not exist (404)
 *   bad_request   — malformed call; fix params, do not retry as-is (400/422)
 *   transient     — upstream hiccup or network blip; a plain retry may succeed (5xx / fetch failure)
 *
 * NOTE: the bare "No approval received" string some agents see on get_book_text
 * is emitted by the MCP *client's* tool-approval gate (an approval timeout),
 * not by this server — see issue #2823. This envelope makes every error WE own
 * branchable so that, at minimum, real server-side gates never look opaque.
 */
function structuredError(error: unknown): {
  error: string;
  message: string;
  retryable: boolean;
  retry_after_seconds?: number;
  status?: number;
  details?: unknown;
} {
  if (error instanceof ApiError) {
    const body = error.body as Record<string, unknown> | undefined;
    const retryAfter =
      body && typeof body === "object" && typeof body.retry_after_seconds === "number"
        ? (body.retry_after_seconds as number)
        : undefined;
    const message =
      body && typeof body === "object" && typeof body.error === "string"
        ? (body.error as string)
        : error.message;

    let category: string;
    let retryable = false;
    let fallbackRetryAfter: number | undefined;
    if (error.status === 401 || error.status === 403) {
      category = "auth_required";
    } else if (error.status === 429) {
      category = "rate_limited";
      retryable = true;
      fallbackRetryAfter = 3600;
    } else if (error.status === 404) {
      category = "not_found";
    } else if (error.status === 400 || error.status === 422) {
      category = "bad_request";
    } else if (error.status >= 500) {
      category = "transient";
      retryable = true;
    } else {
      category = "error";
    }

    return {
      error: category,
      message,
      retryable,
      ...(retryAfter ?? fallbackRetryAfter
        ? { retry_after_seconds: retryAfter ?? fallbackRetryAfter }
        : {}),
      status: error.status,
      ...(body && typeof body === "object" ? { details: body } : {}),
    };
  }

  // Network failure, JSON parse error, or anything else — treat as transient
  // so a research agent retries rather than silently falling back to web search.
  return {
    error: "transient",
    message: error instanceof Error ? error.message : "Unknown error",
    retryable: true,
  };
}

// ── Tool Definitions ──────────────────────────────────────────────────

const TOOLS: Tool[] = [
  // ── Discovery & Browse ──
  {
    name: "search_library",
    title: "Search Library",
    description:
      "Full-text search across Source Library's 22,000+ rare historical books. Searches titles, authors, translations, and OCR text. Returns matching books and page snippets with citation URLs. ORIENTATION HINT: when the user has named a specific author or work, call get_book directly (or list_books to find the ID first) — the AI-generated book summary is usually the right first answer and saves repeated passage hunting.",
    annotations: { title: "Search Library", readOnlyHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (searches titles, authors, translations, OCR text)",
        },
        language: {
          type: "string",
          description: "Filter by original language (e.g., 'Latin', 'German', 'Greek', 'Sanskrit')",
        },
        year_from: {
          type: "number",
          description: "Filter by publication year (start, inclusive)",
        },
        year_to: {
          type: "number",
          description: "Filter by publication year (end, inclusive)",
        },
        has_doi: {
          type: "boolean",
          description: "Only return books with DOIs",
        },
        has_translation: {
          type: "boolean",
          description: "Only return books with translations",
        },
        sort: {
          type: "string",
          enum: ["relevance", "date_asc", "date_desc", "title"],
          description: "Sort order (default: relevance)",
        },
        limit: {
          type: "number",
          description: "Maximum results (default 10, max 100)",
        },
        offset: {
          type: "number",
          description: "Pagination offset (default 0)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_books",
    title: "List Books",
    description:
      "Browse the catalog by metadata — filter by author/title fragment, language, category, or translation recency. Returns books with title, author, language, year, page counts, and translation progress. Use this to discover WHAT EXISTS by an author or in a tradition before searching content; for content matches (passages on a topic) use search_translations or search_concept.",
    annotations: { title: "List Books", readOnlyHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        search: {
          type: "string",
          description: "Filter by title or author (diacritic-insensitive, e.g., 'bohme' matches 'Böhme')",
        },
        language: {
          type: "string",
          description: "Filter by language (e.g., 'Latin', 'German', 'Greek')",
        },
        category: {
          type: "string",
          description: "Filter by category",
        },
        sort: {
          type: "string",
          enum: ["recent-translation", "recent", "title-asc", "title-desc"],
          description: "Sort order (default: recent-translation)",
        },
        limit: {
          type: "number",
          description: "Maximum results (default 100, max 200)",
        },
        skip: {
          type: "number",
          description: "Pagination offset (default 0)",
        },
      },
    },
  },

  {
    name: "search_translations",
    title: "Search Translations",
    description:
      "Search inside translated page text across the entire library. THE tool for sweeping across many books for evidence on a theme. Unlike search_library (which matches titles/authors), this searches inside the actual text. Returns passage snippets with page numbers, book info, and citation URLs. ORIENTATION HINT: if the user has named a specific author or work, prefer get_book first — every book has an AI-generated summary + chapter outline that is usually the right first read. Use search_translations when looking for evidence across multiple books. (Also available as 'search_passages'.)",
    annotations: { title: "Search Translations", readOnlyHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query — searches inside page translations and OCR text (e.g., 'divine providence', 'philosopher stone', 'harmony of the spheres')",
        },
        language: {
          type: "string",
          description: "Filter by a single original language (e.g., 'Latin', 'German', 'Greek')",
        },
        languages: {
          type: "array",
          items: { type: "string" },
          description: 'Filter to any of these languages, e.g. ["Sanskrit", "Arabic", "Chinese"]. Use instead of language when targeting multiple traditions.',
        },
        exclude_languages: {
          type: "array",
          items: { type: "string" },
          description: 'Exclude these languages, e.g. ["Latin", "French", "German", "English"] to surface non-Western sources.',
        },
        year_from: {
          type: "number",
          description: "Filter by publication year (start, inclusive)",
        },
        year_to: {
          type: "number",
          description: "Filter by publication year (end, inclusive)",
        },
        book_id: {
          type: "string",
          description: "Search within a specific book only",
        },
        limit: {
          type: "number",
          description: "Maximum results (default 20, max 50)",
        },
      },
      required: ["query"],
    },
  },

  {
    name: "search_concept",
    title: "Semantic Concept Search",
    description:
      "Conceptual / semantic passage search across the whole library. Use when the modern term won't literally appear in historical texts — e.g. \"distributed cognition\" maps to passages about active intellect, art of memory, wax tablet metaphors; \"social contract\" maps to pre-Hobbesian discussions of consent and authority. Ranks passages by cosine similarity on Gemini embeddings, so paraphrases and conceptually adjacent phrasings match even when no keyword overlaps. ORIENTATION HINT: if the user named a specific author or work, prefer get_book first — semantic search is expensive and best reserved for cross-corpus discovery. Prefer search_translations for literal phrases or distinctive single terms; use search_concept when the concept matters more than the wording. Similarity calibration: 0.70+ strong match, 0.55–0.70 worth reading but verify, below 0.55 mostly conceptual drift.",
    annotations: { title: "Semantic Concept Search", readOnlyHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "A concept or natural-language description — full sentences are fine. Unlike search_translations, this does NOT require words that appear in the corpus.",
        },
        language: {
          type: "string",
          description: "Filter by a single original language (e.g., Latin, German, Greek, Arabic, Chinese, Sanskrit, Hebrew, Persian, Tibetan). Use this filter when you want passages from a specific tradition — unfiltered English queries skew toward Latin/German/English results, so set language=Chinese/Arabic/etc. explicitly to surface those texts.",
        },
        languages: {
          type: "array",
          items: { type: "string" },
          description: 'Filter to any of these languages, e.g. ["Sanskrit", "Arabic", "Chinese"]. Use instead of language when targeting multiple traditions.',
        },
        exclude_languages: {
          type: "array",
          items: { type: "string" },
          description: 'Exclude these languages, e.g. ["Latin", "French", "German", "English"] to surface non-Western sources.',
        },
        year_from: {
          type: "number",
          description: "Filter by publication year (start, inclusive)",
        },
        year_to: {
          type: "number",
          description: "Filter by publication year (end, inclusive)",
        },
        limit: {
          type: "number",
          description: "Max passages (default 15, max 50)",
        },
      },
      required: ["query"],
    },
  },

  {
    name: "search_within_book",
    title: "Search Within Book",
    description:
      "Search inside a specific book's pages (OCR and translations). Returns matching pages with snippets and citation URLs. Use after finding a book to locate specific passages.",
    annotations: { title: "Search Within Book", readOnlyHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        book_id: {
          type: "string",
          description: "The book ID to search within",
        },
        query: {
          type: "string",
          description: "Search query — finds matches in both original text (OCR) and English translations",
        },
      },
      required: ["book_id", "query"],
    },
  },

  // ── Reading & Text ──
  {
    name: "get_book",
    title: "Get Book",
    description:
      "Get a book's AI-generated summary, chapter list, index stats, edition metadata, DOI, page counts, processing status, and cover image (attached inline so you and the user can see the book). THIS IS THE RIGHT FIRST CALL whenever the user has named a specific author or work — the summary is typically a multi-paragraph orientation covering the book's argument, structure, and significance, often answering the question without any further searching. Pair with get_book_text to read selected chapters, or search_within_book to locate passages inside it.",
    annotations: { title: "Get Book", readOnlyHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        book_id: {
          type: "string",
          description: "The book ID",
        },
      },
      required: ["book_id"],
    },
  },
  {
    name: "get_book_text",
    title: "Read Book Text",
    description:
      "READ A BOOK — start here. Preferred: use 'chapter' param to read one chapter at a time (includes page markers like [Page 42] for citation). Or use page ranges (from/to) for focused reading. Call get_book first to see the chapter list. TRUNCATION: the response always includes truncated: true/false. When truncated=true, the truncation_note field gives the exact next from/to values to call — this means content was cut short by a page-budget limit, NOT that the book ended. An AI agent MUST NOT infer end-of-book from pages_returned alone; always check truncated first. Budget limits apply to anonymous callers (~50 pages per 24h); sign in at sourcelibrary.org/auth/signin or get an API key at sourcelibrary.org/developers for higher limits.",
    annotations: { title: "Read Book Text", readOnlyHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        book_id: {
          type: "string",
          description: "The book ID",
        },
        chapter: {
          type: "number",
          description: "Chapter index (0-based). Returns chapter text with embedded [Page N] markers for citation. Preferred over from/to. If the chapter has multiple parts, returns part 1 — check parts_total in response.",
        },
        part: {
          type: "number",
          description: "Part number (1-based) for large chapters split into multiple parts.",
        },
        content: {
          type: "string",
          enum: ["ocr", "translation", "both"],
          description: "Which text to return: 'ocr' (original), 'translation' (English), or 'both' (default)",
        },
        from: {
          type: "number",
          description: "Start page number (inclusive). Use with to for explicit page ranges. If the response has truncated=true, use the next from/to from truncation_note.",
        },
        to: {
          type: "number",
          description: "End page number (inclusive). Recommended chunk size: 50 pages. If the response has truncated=true, use the next from/to from truncation_note.",
        },
        format: {
          type: "string",
          enum: ["json", "plain"],
          description: "Response format: 'json' (structured, default) or 'plain' (concatenated text with page markers)",
        },
        include_metadata: {
          type: "boolean",
          description: "Include page-level metadata (model, language, page_type, columns)",
        },
      },
      required: ["book_id"],
    },
  },

  // ── Quoting ──
  {
    name: "get_quote",
    title: "Get Quote",
    description:
      "Get the exact translated text of a single page for quoting. Returns the verbatim translation, original OCR text, and a formatted citation. ALWAYS use this tool before putting text in quotation marks — copy the exact text from the response, do not paraphrase or reconstruct from memory. The response headline is citation_link (the stable sourcelibrary.org/q/… shortlink) — present it to the user alongside the quote and its page number. Render as:\n> [exact translation text, verbatim]\n> — [Author], p. [N]. [citation_link]\nNON-LATIN SCRIPTS: where the page is Greek, Hebrew, Arabic, Sanskrit, Cyrillic and so on, the response also carries romanized — the romanization of the original — so the citation can be shown in three layers: original → romanized → translation → citation_link. It is AI-generated reading apparatus, not a transcription; quote the source from original or translation, never from romanized. Absent on Latin-script pages and on non-Latin pages not yet romanized.\nENGLISH ORIGINALS: where the leaf is already English there is no translation and none is needed — the response omits `translation`, sets `text_source: \"ocr_original\"`, and the verbatim text is `original`. Quote it as the source's own words, never as a translation, and expect period spelling and long-s (ſ). `text_source` is on every response (`translation` otherwise), so branch on it rather than inferring from pages_translated, which is 0 for an English-original book by construction.",
    annotations: { title: "Get Quote", readOnlyHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        book_id: {
          type: "string",
          description: "The book ID or slug",
        },
        page: {
          type: "number",
          description: "Page number to quote from",
        },
        include_image: {
          type: "boolean",
          description: "Also return the scan of the cited leaf as an inline image (display size, ≤1200px). Set this when the user would benefit from SEEING the page — an illustrated leaf, a title page, a diagram, disputed OCR — or asks to see it.",
        },
      },
      required: ["book_id", "page"],
    },
  },

  // ── Gallery ──
  {
    name: "search_images",
    title: "Search Images",
    description:
      "Search the visual collection: 50,000+ illustrations extracted from book pages PLUS 23,000+ standalone artworks (paintings, frescoes, prints, sculptures from Met, Rijksmuseum, Wikimedia, NGA). Filter by type, subject, figure, symbol, year, book, or text query. Each result has a `source` field — `gallery` (illustration in a book) or `artwork` (standalone museum work). Use `type=painting` or `type=fresco` to find standalone works; `type=woodcut`, `type=engraving`, `type=emblem` etc. surface mostly book illustrations. The `source` parameter narrows the search: 'all' (default), 'gallery' (illustrations only), or 'artworks' (standalone works only). The first few results also return as inline images YOU can see — some chat clients show them only inside the collapsed tool-result view, so never tell the user images are \"rendered above\"; describe what you see and give each image's url link instead. If images.length is 0, read the note field — an empty result under book_id means that book has no EXTRACTED images yet, not that the physical book has no plates.",
    annotations: { title: "Search Images", readOnlyHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Text search across descriptions, subjects, figures, titles, and artists (e.g., 'ouroboros', 'Raphael fresco', 'Botticelli')",
        },
        source: {
          type: "string",
          enum: ["all", "gallery", "artworks"],
          description: "Which collection to search. 'all' (default) returns both illustrations and standalone artworks, interleaved. 'gallery' = book illustrations only. 'artworks' = standalone paintings/prints/sculptures only.",
        },
        type: {
          type: "string",
          description: "Image type. For book illustrations: woodcut, engraving, emblem, diagram, frontispiece, portrait, illustration, map, chart, decorative, musical_score, symbol. For standalone artworks: painting, drawing, print, fresco, engraving, woodcut, emblem, map, tablet, object.",
        },
        subject: {
          type: "string",
          description: "Subject filter (e.g., 'alchemy', 'astronomy', 'anatomy')",
        },
        figure: {
          type: "string",
          description: "Figure depicted (e.g., 'Mercury', 'philosopher', 'king')",
        },
        symbol: {
          type: "string",
          description: "Symbol depicted (e.g., 'ouroboros', 'caduceus', 'sun')",
        },
        year_from: {
          type: "number",
          description: "Filter by publication year (start)",
        },
        year_to: {
          type: "number",
          description: "Filter by publication year (end)",
        },
        book_id: {
          type: "string",
          description: "Only return images from a specific book or artwork id",
        },
        min_quality: {
          type: "number",
          description: "Minimum gallery quality score 0-1 (default 0.5). Applies to gallery illustrations only.",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default 20, max 50)",
        },
      },
    },
  },
  // ── Curation ──
  {
    name: "check_duplicate",
    title: "Check Duplicate",
    description:
      "Check if a book already exists in Source Library before importing. Uses 4-tier matching: source fingerprint, title+author normalization, keyword search, and semantic similarity. Returns confidence level, matches with URLs, and a suggestion (safe to import / review matches / likely duplicate). Use this BEFORE every import to avoid duplicates.",
    annotations: { title: "Check Duplicate", readOnlyHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Book title (original language or English)",
        },
        author: {
          type: "string",
          description: "Author name (any format: 'First Last', 'Last, First', etc.)",
        },
        year: {
          type: "string",
          description: "Publication year (optional, for context)",
        },
        language: {
          type: "string",
          description: "Language hint for semantic search (optional)",
        },
        ia_id: {
          type: "string",
          description: "Internet Archive identifier (optional, for exact fingerprint match)",
        },
        manifest: {
          type: "string",
          description: "IIIF manifest URL (optional, for exact fingerprint match)",
        },
      },
      required: ["title"],
    },
  },

  // ── Feedback ──
  {
    name: "submit_feedback",
    title: "Submit Feedback",
    description:
      "Submit feedback, bug reports, feature requests, or comments to the Source Library team. Messages go directly to the maintainers.",
    annotations: {
      title: "Submit Feedback",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "Your feedback, bug report, or feature request (2-5000 characters)",
        },
        name: {
          type: "string",
          description: "Your name (optional)",
        },
        email: {
          type: "string",
          description: "Your email for follow-up (optional)",
        },
        page: {
          type: "string",
          description: "Related page URL or path (optional, e.g., 'https://sourcelibrary.org/book/...')",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "share_findings",
    title: "Share Findings",
    description:
      "Share a research dossier back to the Source Library team — a title, an optional summary, and an ordered list of citations (the passages your thesis rests on). Each citation is a reference { book_id, page, note }, NOT copied text: the library re-renders the canonical quote from the reference, so links stay authoritative. Use this when the user has assembled a thesis backed by passages across one or more books and wants to contribute it back. Like submit_feedback, it goes to the team for review (not an instant public page).",
    annotations: {
      title: "Share Findings",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Title of the dossier / thesis (2-300 characters)",
        },
        summary: {
          type: "string",
          description: "Optional prose summarizing the argument (max 5000 characters)",
        },
        citations: {
          type: "array",
          description:
            "Ordered list of supporting passages (1-50). Get book_id + page from get_quote / search_translations.",
          items: {
            type: "object",
            properties: {
              book_id: { type: "string", description: "The book ID" },
              page: { type: "number", description: "Page number" },
              note: { type: "string", description: "Optional note on why this passage matters" },
            },
            required: ["book_id", "page"],
          },
        },
        name: { type: "string", description: "Your name (optional)" },
        email: { type: "string", description: "Your email for follow-up (optional)" },
      },
      required: ["title", "citations"],
    },
  },
];

// ── Server Setup ──────────────────────────────────────────────────────

// Orientation for the calling model. Sent via the MCP `instructions` field
// on the initialize response — this is the spec-blessed channel for
// server-level guidance and is surfaced by Claude clients.
const SERVER_INSTRUCTIONS = `Source Library is a project to recover and open up the vast untranslated inheritance of pre-modern thought — alchemy, Hermetica, Kabbalah, Rosicrucianism, natural philosophy, theology, the early scientific revolution. Most of these ~22,000 books have been effectively sealed for centuries: rare, never reprinted after their 16th–18th century editions, locked behind Latin, German, Greek, Arabic, and the difficulty of microfilm-quality scans. This is also, by the same fact, the corpus current LLMs were *not* trained on — the knowledge sitting just beyond what AI already knows. Source Library brings it back into circulation with AI-generated translations, summaries, and structured chapter outlines, so the texts that shaped Ficino, Newton, Leibniz, Jung — and the ones they were reading that we've forgotten — become readable again.

How to use it well: treat Source Library and your own training as complementary. You know what Ficino, Paracelsus, or Robert Fludd argued in broad outline — Source Library has the actual pages. You know that "the unconscious" is anachronistic for 1600 — but you may not know whether to search for spiritus, anima sensitiva, imaginatio, or vis imaginativa in a given author. When in doubt, web-search for the historical terminology first, then query Source Library with the words a period author would have used. Don't ask Source Library "what is alchemy" — ask it for the specific texts, passages, and images that let you answer that yourself with primary evidence.

Practical orientation: named author/work → get_book first (the AI summary often answers the question). Cross-corpus themes → search_concept (semantic) or search_translations (literal). Always get_quote before quoting — paraphrasing from memory will hallucinate.

Feedback: submit_feedback. Partnerships: team@sourcelibrary.org.`;

const server = new Server(
  {
    name: "source-library",
    version: "4.5.0",
  },
  {
    capabilities: {
      tools: {},
    },
    instructions: SERVER_INSTRUCTIONS,
  }
);

// Handle list tools. _meta.about is a fallback for clients that don't surface
// the InitializeResult.instructions field to the model.
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
    _meta: {
      about: "Source Library — ~22,000 rare pre-modern books (alchemy, Hermetica, Kabbalah, theology, early science) with AI-generated English translations. See server instructions for orientation. Feedback: submit_feedback. Partnerships: team@sourcelibrary.org.",
    },
  };
});

// ── Inline image attachments (#3937: parity with the remote server) ──
//
// Tools whose results carry imagery return image URLs in their JSON; this
// layer turns the first few into MCP `image` content blocks so clients
// render them inline. audience includes 'assistant' so the model can SEE
// the plates it cites, not just relay them.
const MAX_INLINE_IMAGES = 5;
const IMAGE_AUDIENCE = { audience: ["user", "assistant"] };

async function fetchImageBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const mimeType = contentType.split(";")[0].trim();
    const buffer = await resp.arrayBuffer();
    // Skip images larger than 1MB to keep responses reasonable
    if (buffer.byteLength > 1_000_000) return null;
    return { data: Buffer.from(buffer).toString("base64"), mimeType };
  } catch {
    return null;
  }
}

// Try candidate URLs in order until one fetches within the size cap.
async function fetchFirstImage(urls: Array<string | undefined | null>): Promise<{ data: string; mimeType: string } | null> {
  for (const url of urls) {
    if (!url) continue;
    const img = await fetchImageBase64(url);
    if (img) return img;
  }
  return null;
}

interface ImageAttachment {
  urls: Array<string | undefined | null>;
  caption: string;
}

function collectImageAttachments(name: string, result: unknown): ImageAttachment[] {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;

  if (name === "search_images" && Array.isArray(r.images)) {
    return (r.images as Array<Record<string, unknown>>)
      .slice(0, MAX_INLINE_IMAGES)
      .filter((img) => typeof img.image_url === "string")
      .map((img) => ({
        urls: [img.image_url as string],
        caption: `${(img.description as string) || (img.title as string) || "Image"}\n${img.url as string}`,
      }));
  }

  if (name === "get_quote") {
    const quote = r.quote as Record<string, unknown> | undefined;
    if (typeof quote?.page_image_url === "string") {
      return [{
        urls: [quote.page_image_url],
        caption: `Scan of the cited leaf — p. ${quote.page}, ${quote.author || quote.book_title}`,
      }];
    }
    return [];
  }

  if (name === "get_book" && typeof r.cover_thumb_url === "string") {
    return [{
      urls: [r.cover_thumb_url, r.cover_image_url as string | undefined],
      caption: `Cover — ${r.title}${r.author ? `, ${r.author}` : ""}`,
    }];
  }

  return [];
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case "search_library":
        result = await searchLibrary(args as Parameters<typeof searchLibrary>[0]);
        break;
      case "search_translations":
      case "search_passages":
        result = await searchPassages(args as Parameters<typeof searchPassages>[0]);
        break;
      case "search_concept":
        result = await searchConcept(args as Parameters<typeof searchConcept>[0]);
        break;
      case "search_within_book":
        result = await searchWithinBook(args as Parameters<typeof searchWithinBook>[0]);
        break;
      case "list_books":
        result = await listBooks(args as Parameters<typeof listBooks>[0]);
        break;
      case "get_book":
        result = await getBook(args as Parameters<typeof getBook>[0]);
        break;
      case "get_book_text":
        result = await getBookText(args as Parameters<typeof getBookText>[0]);
        break;
      case "get_quote":
        result = await getQuote(args as Parameters<typeof getQuote>[0]);
        break;
      case "search_images":
        result = await searchImages(args as Parameters<typeof searchImages>[0]);
        break;
      case "check_duplicate":
        result = await checkDuplicate(args as Parameters<typeof checkDuplicate>[0]);
        break;
      case "submit_feedback":
        result = await submitFeedback(args as Parameters<typeof submitFeedback>[0]);
        break;
      case "share_findings":
        result = await shareFindings(args as Parameters<typeof shareFindings>[0]);
        break;
      default:
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    // Plain text results (from get_book_text with format=plain)
    if (typeof result === "string") {
      return { content: [{ type: "text" as const, text: result }] };
    }

    // Attach inline image blocks for tools whose results carry imagery
    // (search_images results, get_quote page scans, get_book covers).
    const attachments = collectImageAttachments(name, result);
    if (attachments.length > 0) {
      const content: Array<
        { type: "text"; text: string } |
        { type: "image"; data: string; mimeType: string; annotations?: { audience: string[] } }
      > = [{ type: "text" as const, text: JSON.stringify(result, null, 2) }];
      const fetched = await Promise.all(attachments.map((a) => fetchFirstImage(a.urls)));
      for (let i = 0; i < attachments.length; i++) {
        const img = fetched[i];
        if (img) {
          content.push({ type: "image" as const, data: img.data, mimeType: img.mimeType, annotations: IMAGE_AUDIENCE });
          content.push({ type: "text" as const, text: attachments[i].caption });
        }
      }
      return { content };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    // Structured, machine-readable error so agents can branch on the category
    // (auth_required / rate_limited / transient / …) and honor retry_after,
    // instead of regexing an opaque "Error: …" string. See issue #2823.
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(structuredError(error), null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Source Library MCP server v4.6.0 running (${TOOLS.length} tools)`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
