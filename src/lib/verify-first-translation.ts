/**
 * First-Translation Verification via Gemini Function Calling
 *
 * Uses Gemini with tool use to search multiple catalogs and make an
 * evidence-based determination of whether a book is a first English translation.
 *
 * Eight tools available to the model:
 *   - search_local_catalogs: MongoDB translation_catalogs collection
 *   - search_open_library: Open Library API
 *   - search_google_books: Google Books API
 *   - search_internet_archive: Internet Archive Advanced Search
 *   - search_openalex: OpenAlex scholarly works (250M+ records)
 *   - search_loc: Library of Congress live catalog
 *   - search_ustc: USTC Supabase to verify the original work
 *   - make_determination: Terminal tool — final verdict with evidence
 *
 * The LLM evaluates search results for relevance (not regex). This solves
 * the false-positive problem: if Open Library returns "Ficino: Platonic Theology"
 * it's the model that decides whether that's a translation of *this specific work*.
 */

import { Db } from 'mongodb';
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import { logGeminiCall } from './gemini-logger';
import { logMetadataChange } from './book-changelog';

const MODEL = 'gemini-3.1-flash-lite-preview';
const MAX_ROUNDS = 10; // Max Gemini round-trips (tool calls + responses)
const TEMPERATURE = 0.1;

// OpenAlex polite pool — faster rate limits when you provide a contact email
const OPENALEX_MAILTO = 'derek@sourcelibrary.org';

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';

// ── Types ─────────────────────────────────────────────────────────────

export interface TranslationVerification {
  disposition: 'confirmed_first' | 'first_from_source' | 'first_complete_translation' | 'first_modern_translation' | 'translation_found' | 'needs_review';
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  translations_found: Array<{
    english_title: string;
    translator?: string;
    pub_year?: string;
    publisher?: string;
    completeness: 'complete' | 'partial' | 'excerpts' | 'unknown';
    evidence_source: string;
    url?: string;
  }>;
  tools_called: string[];
  verified_at: Date;
  model: string;
  cost_usd: number;
  source: string;
  stage: number;
}

export interface VerificationResult {
  success: boolean;
  verification?: TranslationVerification;
  is_first_translation?: boolean;
  error?: string;
}

// ── Tool Definitions ──────────────────────────────────────────────────

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'search_local_catalogs',
    description: 'Search the local translation catalogs database (UNESCO Index Translationum, Loeb Classical Library, Brill, Penguin Classics, Cambridge, etc.) for known English translations of works by this author. This is free, instant, and should ALWAYS be called first. Returns matching records with translator, publisher, year, and completeness.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        author_query: {
          type: Type.STRING,
          description: 'Author surname or name to search for (e.g., "Ficino", "Agrippa", "Paracelsus")',
        },
        title_query: {
          type: Type.STRING,
          description: 'Optional: title keywords to narrow results (e.g., "platonic theology", "occult philosophy")',
        },
      },
      required: ['author_query'],
    },
  },
  {
    name: 'search_open_library',
    description: 'Search Open Library for English editions of a work. Good for finding modern academic translations with ISBNs. Returns title, author, publisher, year, and edition count.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query — combine author + title keywords for best results (e.g., "Ficino Platonic Theology english")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_google_books',
    description: 'Search Google Books for English translations. Good for finding academic press publications. Returns title, author, publisher, year, and description.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query — combine author + title + "english translation" (e.g., "Marsilio Ficino Platonic Theology english translation")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_internet_archive',
    description: 'Search Internet Archive for digitized English translations. Excellent coverage of public domain translations, older academic press editions, and reprints. Returns title, creator, date, publisher, and description. Covers material that Open Library may miss (scanned books without modern catalog records).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query — combine author + title keywords (e.g., "ficino platonic theology")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_openalex',
    description: 'Search OpenAlex, an open catalog of 250M+ scholarly works including books, journal articles, and book chapters. Excellent for finding academic press translations (Brill, De Gruyter, Cambridge, Oxford UP) and translations published in journals or edited volumes that other catalogs miss. Returns title, authors, publication year, publisher/journal, DOI, and type.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query — author + title + "english translation" (e.g., "Ficino Platonic Theology english translation")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_loc',
    description: 'Search the Library of Congress live catalog. The most authoritative US library catalog, with records for translations held by LOC and contributed by other research libraries. May catch recent cataloging not present in bulk data dumps. Returns title, contributors, date, publisher, subjects, and description.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query — author + title keywords (e.g., "Ficino Platonic Theology english")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_ustc',
    description: 'Search the Universal Short Title Catalogue to verify the original work exists and find variant titles. Useful for confirming the identity of the source work being translated. Returns USTC records with title, author, language, year, and place of publication.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Author or title to search for in USTC (e.g., "Ficino" or "Theologia Platonica")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'make_determination',
    description: 'Make a final determination about whether this book is a first English translation. Call this AFTER searching catalogs. You MUST call this tool to complete the verification.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        disposition: {
          type: Type.STRING,
          description: 'The verdict: "confirmed_first" (no English translation of any kind exists), "first_from_source" (English translations exist from a DIFFERENT source language, but not from THIS specific language text — e.g., Greek→English exists but Latin→English does not), "first_complete_translation" (only partial translations, excerpts, or anthologized selections exist — no complete translation has been published), "first_modern_translation" (only old/antiquated translations exist, e.g. pre-1900, and no modern scholarly translation has been published), "translation_found" (a complete, modern English translation already exists), "needs_review" (evidence is conflicting or inconclusive)',
          enum: ['confirmed_first', 'first_from_source', 'first_complete_translation', 'first_modern_translation', 'translation_found', 'needs_review'],
        },
        confidence: {
          type: Type.STRING,
          description: 'Confidence in the determination: "high" (strong evidence), "medium" (some evidence), "low" (weak/conflicting evidence)',
          enum: ['high', 'medium', 'low'],
        },
        reasoning: {
          type: Type.STRING,
          description: 'Detailed reasoning explaining the evidence found (or not found) and why this determination was made. 2-4 sentences.',
        },
        translations_found: {
          type: Type.ARRAY,
          description: 'List of English translations found IN YOUR TOOL SEARCH RESULTS (empty if none found via tools). ONLY include translations that appeared in results from search_local_catalogs, search_open_library, search_google_books, or search_ustc. Do NOT include translations from your own knowledge — only what the tools returned.',
          items: {
            type: Type.OBJECT,
            properties: {
              english_title: { type: Type.STRING, description: 'Title of the English translation as it appeared in search results' },
              translator: { type: Type.STRING, description: 'Translator name(s) from search results' },
              pub_year: { type: Type.STRING, description: 'Publication year from search results' },
              publisher: { type: Type.STRING, description: 'Publisher from search results' },
              completeness: {
                type: Type.STRING,
                description: 'Is this a complete or partial translation?',
                enum: ['complete', 'partial', 'excerpts', 'unknown'],
              },
              evidence_source: {
                type: Type.STRING,
                description: 'Which tool found this translation. MUST be one of the listed values.',
                enum: ['local_catalogs', 'open_library', 'google_books', 'internet_archive', 'openalex', 'loc', 'ustc'],
              },
              url: { type: Type.STRING, description: 'URL from the search results (e.g., Open Library or Google Books link). Required when available.' },
            },
            required: ['english_title', 'completeness', 'evidence_source'],
          },
        },
      },
      required: ['disposition', 'confidence', 'reasoning', 'translations_found'],
    },
  },
];

// ── Tool Implementations ──────────────────────────────────────────────

async function executeSearchLocalCatalogs(
  db: Db,
  args: { author_query: string; title_query?: string },
): Promise<Record<string, unknown>> {
  try {
    const authorNorm = args.author_query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const surname = authorNorm.split(/\s+/).pop() || authorNorm;

    // Search by author surname first (fast, indexed)
    const query: Record<string, unknown> = {
      $or: [
        { author_surname: { $regex: surname, $options: 'i' } },
        { canonical_author_normalized: { $regex: surname, $options: 'i' } },
        { author_normalized: { $regex: surname, $options: 'i' } },
      ],
    };

    let results = await db.collection('translation_catalogs')
      .find(query)
      .project({
        source: 1, author: 1, english_title: 1, original_title: 1,
        canonical_author: 1, canonical_work: 1,
        translator: 1, pub_year: 1, publisher: 1, series: 1, completeness: 1,
      })
      .limit(30)
      .toArray();

    // If title query provided, filter by title keywords
    if (args.title_query && results.length > 0) {
      const titleWords = args.title_query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (titleWords.length > 0) {
        const filtered = results.filter(r => {
          const allText = [r.english_title, r.original_title, r.canonical_work]
            .filter(Boolean).join(' ').toLowerCase();
          return titleWords.some(w => allText.includes(w));
        });
        // Return filtered if any matches, otherwise return all author matches
        if (filtered.length > 0) results = filtered;
      }
    }

    return {
      match_count: results.length,
      records: results.slice(0, 15).map(r => ({
        source: r.source,
        author: r.canonical_author || r.author,
        english_title: r.english_title,
        original_title: r.original_title || r.canonical_work,
        translator: r.translator,
        pub_year: r.pub_year,
        publisher: r.publisher,
        series: r.series,
        completeness: r.completeness,
      })),
    };
  } catch (error) {
    return { error: `Catalog search failed: ${error instanceof Error ? error.message : 'unknown'}`, match_count: 0, records: [] };
  }
}

async function executeSearchOpenLibrary(
  args: { query: string },
): Promise<Record<string, unknown>> {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(args.query)}&language=eng&limit=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { error: `Open Library returned ${res.status}`, results: [] };

    const data = await res.json();
    const results = (data.docs || []).slice(0, 10).map((doc: Record<string, unknown>) => ({
      title: doc.title,
      author: Array.isArray(doc.author_name) ? (doc.author_name as string[]).join(', ') : undefined,
      year: doc.first_publish_year,
      publisher: Array.isArray(doc.publisher) ? (doc.publisher as string[])[0] : undefined,
      edition_count: doc.edition_count,
      language: doc.language,
      isbn: Array.isArray(doc.isbn) ? (doc.isbn as string[])[0] : undefined,
      url: doc.key ? `https://openlibrary.org${doc.key}` : undefined,
    }));

    return { total: data.numFound || 0, results };
  } catch (error) {
    return { error: `Open Library search failed: ${error instanceof Error ? error.message : 'unknown'}`, results: [] };
  }
}

async function executeSearchGoogleBooks(
  args: { query: string },
): Promise<Record<string, unknown>> {
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(args.query)}&langRestrict=en&maxResults=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { error: `Google Books returned ${res.status}`, results: [] };

    const data = await res.json();
    const results = (data.items || []).slice(0, 10).map((item: Record<string, unknown>) => {
      const vol = item.volumeInfo as Record<string, unknown> || {};
      return {
        title: vol.title,
        subtitle: vol.subtitle,
        authors: vol.authors,
        publisher: vol.publisher,
        publishedDate: vol.publishedDate,
        description: typeof vol.description === 'string' ? vol.description.slice(0, 300) : undefined,
        language: vol.language,
        url: (vol.infoLink as string) || (item.selfLink as string) || undefined,
      };
    });

    return { total: data.totalItems || 0, results };
  } catch (error) {
    return { error: `Google Books search failed: ${error instanceof Error ? error.message : 'unknown'}`, results: [] };
  }
}

async function executeSearchUstc(
  args: { query: string },
): Promise<Record<string, unknown>> {
  try {
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    };

    const url = new URL(`${SUPABASE_URL}/rest/v1/ustc_enrichments`);
    url.searchParams.set('select', 'id,std_title,english_title,detected_language,work_type,original_author,subject_tags');
    url.searchParams.set('limit', '10');
    url.searchParams.set('or', `(std_title.ilike.*${args.query}*,english_title.ilike.*${args.query}*,original_author.ilike.*${args.query}*)`);

    const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { error: `USTC returned ${res.status}`, results: [] };

    const data = await res.json();
    return {
      total: data.length,
      results: data.slice(0, 10).map((row: Record<string, unknown>) => ({
        ustc_id: row.id,
        title: row.std_title,
        english_title: row.english_title,
        author: row.original_author,
        language: row.detected_language,
        work_type: row.work_type,
        subject_tags: row.subject_tags,
        url: row.id ? `https://www.ustc.ac.uk/editions/${row.id}` : undefined,
      })),
    };
  } catch (error) {
    return { error: `USTC search failed: ${error instanceof Error ? error.message : 'unknown'}`, results: [] };
  }
}

async function executeSearchInternetArchive(
  args: { query: string },
): Promise<Record<string, unknown>> {
  try {
    // Internet Archive Advanced Search — free, no auth required
    // Filter to texts in English. Use mediatype:texts to exclude audio/video.
    const iaQuery = `(${args.query}) AND language:(eng OR english) AND mediatype:(texts)`;
    const params = new URLSearchParams({
      q: iaQuery,
      'fl[]': 'identifier,title,creator,date,publisher,language,description',
      rows: '10',
      output: 'json',
      sort: 'downloads desc', // Most-downloaded first = most likely to be real translations
    });
    // fl[] needs to be repeated — URLSearchParams only keeps last value
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(iaQuery)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=publisher&fl[]=language&fl[]=description&rows=10&output=json&sort=downloads+desc`;

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `Internet Archive returned ${res.status}`, results: [] };

    const data = await res.json();
    const docs = data.response?.docs || [];
    const results = docs.slice(0, 10).map((doc: Record<string, unknown>) => ({
      title: doc.title,
      creator: doc.creator,
      date: doc.date,
      publisher: doc.publisher,
      description: typeof doc.description === 'string' ? doc.description.slice(0, 300) :
        Array.isArray(doc.description) ? (doc.description as string[])[0]?.slice(0, 300) : undefined,
      url: doc.identifier ? `https://archive.org/details/${doc.identifier}` : undefined,
    }));

    return { total: data.response?.numFound || 0, results };
  } catch (error) {
    return { error: `Internet Archive search failed: ${error instanceof Error ? error.message : 'unknown'}`, results: [] };
  }
}

async function executeSearchOpenAlex(
  args: { query: string },
): Promise<Record<string, unknown>> {
  try {
    // OpenAlex — free, open catalog of 250M+ scholarly works
    // Polite pool (faster rate limits) when providing mailto
    const params = new URLSearchParams({
      search: args.query,
      'filter': 'language:en',
      per_page: '10',
      mailto: OPENALEX_MAILTO,
    });
    const url = `https://api.openalex.org/works?${params.toString()}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `OpenAlex returned ${res.status}`, results: [] };

    const data = await res.json();
    const results = (data.results || []).slice(0, 10).map((work: Record<string, unknown>) => {
      const authorships = (work.authorships || []) as Array<Record<string, unknown>>;
      const authors = authorships
        .map(a => (a.author as Record<string, unknown>)?.display_name)
        .filter(Boolean)
        .join(', ');
      const source = work.primary_location as Record<string, unknown> | undefined;
      const sourceObj = source?.source as Record<string, unknown> | undefined;

      return {
        title: work.title || work.display_name,
        authors: authors || undefined,
        year: work.publication_year,
        type: work.type, // e.g., 'book', 'article', 'book-chapter'
        publisher: sourceObj?.display_name || sourceObj?.host_organization_name,
        journal_or_series: sourceObj?.display_name,
        doi: work.doi,
        url: (work.doi as string) || (work.id as string) || undefined,
      };
    });

    return { total: data.meta?.count || 0, results };
  } catch (error) {
    return { error: `OpenAlex search failed: ${error instanceof Error ? error.message : 'unknown'}`, results: [] };
  }
}

async function executeSearchLoc(
  args: { query: string },
): Promise<Record<string, unknown>> {
  try {
    // Library of Congress JSON API — searches catalog and digital collections
    // fa=language:english filters to English-language items
    const params = new URLSearchParams({
      q: args.query,
      fa: 'language:english',
      fo: 'json',
      c: '10', // count
    });
    const url = `https://www.loc.gov/books/?${params.toString()}`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return { error: `Library of Congress returned ${res.status}`, results: [] };

    const data = await res.json();
    const results = (data.results || []).slice(0, 10).map((item: Record<string, unknown>) => {
      const contributors = Array.isArray(item.contributor) ? (item.contributor as string[]).join(', ') : undefined;
      return {
        title: item.title,
        contributors,
        date: item.date,
        description: Array.isArray(item.description)
          ? (item.description as string[]).slice(0, 2).join(' ').slice(0, 300)
          : typeof item.description === 'string' ? (item.description as string).slice(0, 300) : undefined,
        subjects: Array.isArray(item.subject) ? (item.subject as string[]).slice(0, 5) : undefined,
        url: item.url || item.id || undefined,
      };
    });

    return { total: data.pagination?.total || results.length, results };
  } catch (error) {
    return { error: `Library of Congress search failed: ${error instanceof Error ? error.message : 'unknown'}`, results: [] };
  }
}

// ── Tool Dispatch ─────────────────────────────────────────────────────

async function executeTool(
  db: Db,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'search_local_catalogs':
      return executeSearchLocalCatalogs(db, args as { author_query: string; title_query?: string });
    case 'search_open_library':
      return executeSearchOpenLibrary(args as { query: string });
    case 'search_google_books':
      return executeSearchGoogleBooks(args as { query: string });
    case 'search_internet_archive':
      return executeSearchInternetArchive(args as { query: string });
    case 'search_openalex':
      return executeSearchOpenAlex(args as { query: string });
    case 'search_loc':
      return executeSearchLoc(args as { query: string });
    case 'search_ustc':
      return executeSearchUstc(args as { query: string });
    case 'make_determination':
      // Terminal tool — we extract the result from args directly
      return args;
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── Build System Prompt ───────────────────────────────────────────────

function buildPrompt(book: Record<string, unknown>, ocrSamples: string[]): string {
  const lang = book.language || book.original_language || 'Unknown';
  const author = book.author || 'Unknown';
  const title = book.display_title || book.title || 'Unknown';
  const year = book.year || book.published || 'Unknown';

  let prompt = `You are verifying whether this book is a first English translation. Your job is to search catalogs for any existing English translations of this specific work, then make a determination.

## Book to Verify

- **Title:** ${title}
- **Author:** ${author}
- **Original Language:** ${lang}
- **Published:** ${year}

`;

  // Include existing AI metadata if available
  const aiMeta = book.ai_metadata as Record<string, unknown> | undefined;
  if (aiMeta?.first_translation) {
    const ft = aiMeta.first_translation as Record<string, unknown>;
    prompt += `## AI Metadata Enrichment (preliminary, unverified)
- Status: ${ft.status}
- Reasoning: ${ft.reasoning || 'none'}
- Known translations: ${JSON.stringify(ft.known_translations || [])}

`;
  }

  // Include existing weak verification data as search hints
  const existingVerification = book.translation_verification as Record<string, unknown> | undefined;
  if (existingVerification?.source === 'gemini_knowledge_lookup') {
    const translations = existingVerification.translations as Array<Record<string, unknown>> | undefined;
    prompt += `## Previous AI Assessment (unverified — use as search hints)
`;
    if (existingVerification.reasoning) {
      prompt += `- Assessment: ${existingVerification.reasoning}
`;
    }
    if (translations && translations.length > 0) {
      prompt += `- Claimed translations to search for:
`;
      for (const t of translations.slice(0, 5)) {
        const parts = [t.english_title, t.translator, t.publisher, t.pub_year].filter(Boolean);
        if (parts.length > 0) {
          prompt += `  - ${parts.join(' / ')} (${t.completeness || 'unknown completeness'})
`;
        }
      }
    }
    if (existingVerification.has_english_translation) {
      prompt += `- Previous AI claimed a translation EXISTS — verify this with catalog searches
`;
    } else {
      prompt += `- Previous AI claimed NO translation exists — verify this with catalog searches
`;
    }
    prompt += `
`;
  }

  // Include OCR samples for context
  if (ocrSamples.length > 0) {
    prompt += `## Sample OCR Text (first pages)
${ocrSamples.map((s, i) => `Page ${i + 1}: ${s.slice(0, 500)}`).join('\n\n')}

`;
  }

  prompt += `## Instructions

You have access to 7 search tools covering different catalog ecosystems. Use them strategically:

### Phase 1: Core catalog search (ALWAYS do these)
1. **\`search_local_catalogs\`** — ALWAYS call first with the author's surname. Searches 12+ scholarly catalogs (UNESCO Index Translationum, Loeb, Brill, Penguin, Cambridge, etc.). Free and instant.
2. **\`search_open_library\`** — Search Open Library for English editions. Good for modern academic translations with ISBNs.
3. **\`search_google_books\`** — Search Google Books. Good for academic press publications.

### Phase 2: Deep verification (use when Phase 1 is inconclusive)
4. **\`search_internet_archive\`** — Search Internet Archive for digitized English translations. Excellent for older public domain translations, reprints, and out-of-print academic editions that other catalogs miss.
5. **\`search_openalex\`** — Search OpenAlex (250M+ scholarly works). Catches academic press translations (Brill, De Gruyter, OUP, CUP) and translations published in journals or edited volumes.
6. **\`search_loc\`** — Search the Library of Congress live catalog. The most authoritative US library catalog — may have records not in our bulk data.

### Phase 3: Work identity verification (optional)
7. **\`search_ustc\`** — Verify the original work exists in the USTC and find variant titles.

### Search strategy
- For well-known authors (Ficino, Agrippa, Paracelsus, Boehme): run Phase 1 + Phase 2 (all 6 translation searches). These authors are most likely to have translations in niche catalogs.
- For obscure authors or anonymous works: Phase 1 is usually sufficient. If Phase 1 finds nothing, run 1-2 Phase 2 searches for confirmation.
- Vary your search queries across tools — try different combinations of author name, title keywords, and "english translation".
- After gathering evidence, call \`make_determination\` with your verdict.

## CRITICAL: Evidence Must Come From Tool Results

When calling \`make_determination\`, the \`translations_found\` array must ONLY contain translations that appeared in your tool search results. Do NOT add translations from your own knowledge, training data, or general awareness. If you know a translation exists but it did not appear in any search results, mention it in your \`reasoning\` text instead — but do NOT add it to \`translations_found\`.

This rule exists because we need verifiable evidence. Each entry in \`translations_found\` should be traceable back to a specific tool call result. Include the URL from the search results when available.

If your tools found nothing but you believe a translation exists from your own knowledge, set disposition to \`needs_review\` with your reasoning explaining what you think exists but couldn't verify.

## CRITICAL: Source Text Matters

We are verifying whether THIS SPECIFIC TEXT (in ${lang}) has been translated to English. This is NOT about whether the underlying work has ever appeared in English from any source.

Many books in this library are Latin translations of Greek works (e.g. Ficino's Latin Iamblichus, Ficino's Latin Plato). If the original Greek has been translated directly to English by others, that does NOT count — we are asking whether the LATIN TEXT ITSELF has been translated. Different source languages produce different translations with different scholarly value.

Example: Iamblichus' "De Mysteriis" in Ficino's Latin — even though Taylor (1821) and Clarke (2003) translated the Greek original to English, Ficino's Latin rendering has never been translated to English. This is a FIRST TRANSLATION.

## Determination Guidelines

- **confirmed_first**: No English translation of any kind exists for this specific ${lang} text. No complete, partial, or excerpt translations found across any source. Strong evidence = no matches across multiple catalog searches, OR only translations from a different source language exist.
- **first_from_source**: English translations exist from a DIFFERENT source language, but not from THIS ${lang} text. E.g., Greek→English exists but Latin→English does not. Use this instead of confirmed_first when translations from other source languages were found.
- **first_complete_translation**: Partial translations, excerpts, or anthologized selections exist, but NO complete/full English translation has been published. This is still a significant "first" — the first COMPLETE translation. List the partial translations found.
- **first_modern_translation**: Old or antiquated English translations exist (typically pre-1900), but no modern scholarly translation has been published. The existing translation(s) may be unreliable, archaic, or lack critical apparatus. List the old translations found.
- **translation_found**: A complete, modern English translation of THIS SPECIFIC ${lang} text already exists. Cite the specific translation found. The translation must be FROM THIS LANGUAGE, not from the original language of the work.
- **needs_review**: Evidence is conflicting or inconclusive. Use sparingly — prefer a determination when possible.

Important: Be precise about matching. A translation of a different work by the same author does NOT count. A translation from a different source language (e.g. Greek→English when we have the Latin text) does NOT count. "Selected works" or "excerpts" are partial, not complete translations.`;

  return prompt;
}

// ── Main Verification Function ────────────────────────────────────────

export async function verifyFirstTranslation(
  db: Db,
  bookId: string,
  options?: { dryRun?: boolean; force?: boolean; collection?: 'books' | 'books_warehouse' },
): Promise<VerificationResult> {
  const startTime = Date.now();
  const booksCol = options?.collection || 'books';
  const pagesCol = booksCol === 'books_warehouse' ? 'pages_warehouse' : 'pages';

  // Fetch book
  const book = await db.collection(booksCol).findOne(
    { id: bookId },
    { projection: {
      id: 1, title: 1, display_title: 1, author: 1, language: 1,
      original_language: 1, year: 1, published: 1, ai_metadata: 1,
      is_first_translation: 1, translation_verification: 1,
    }},
  );

  if (!book) return { success: false, error: `Book not found: ${bookId}` };

  // English books skip — they don't need first-translation verification
  const lang = ((book.language || book.original_language || '') as string).toLowerCase();
  if (lang === 'english') {
    return { success: true, is_first_translation: false, verification: undefined };
  }

  // Skip if already verified with tool-calling (prevents concurrent run overwrites)
  const existingVerification = book.translation_verification as Record<string, unknown> | undefined;
  if (existingVerification?.tools_called && !options?.force) {
    return {
      success: true,
      verification: existingVerification as unknown as TranslationVerification,
      is_first_translation: book.is_first_translation as boolean,
    };
  }

  // Fetch first 3 pages of OCR for context
  const pages = await db.collection(pagesCol)
    .find({ book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } })
    .sort({ page_number: 1 })
    .project({ 'ocr.data': 1 })
    .limit(3)
    .toArray();
  const ocrSamples = pages.map(p => (p.ocr?.data || '') as string).filter(Boolean);

  // Build prompt
  const systemPrompt = buildPrompt(book, ocrSamples);

  // Set up Gemini with function calling
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { success: false, error: 'GEMINI_API_KEY not set' };

  const ai = new GoogleGenAI({ apiKey });

  const toolsCalled: string[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let determination: Record<string, unknown> | null = null;

  // Conversation history for multi-turn
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [
    { role: 'user', parts: [{ text: systemPrompt }] },
  ];

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: {
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          temperature: TEMPERATURE,
        },
      });

      const usage = response.usageMetadata || {};
      totalInputTokens += (usage.promptTokenCount || 0);
      totalOutputTokens += (usage.candidatesTokenCount || 0);

      const candidate = response.candidates?.[0];
      if (!candidate?.content?.parts) break;

      // Add model response to conversation
      contents.push({
        role: 'model',
        parts: candidate.content.parts as Array<Record<string, unknown>>,
      });

      // Check for function calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const functionCalls = candidate.content.parts.filter(
        (p: any) => p.functionCall,
      );

      if (functionCalls.length === 0) {
        // Model finished without calling make_determination — try to extract from text
        break;
      }

      // Execute function calls and build responses
      const responseParts: Array<Record<string, unknown>> = [];

      for (const part of functionCalls) {
        const fc = part.functionCall as { name: string; args: Record<string, unknown> };
        toolsCalled.push(fc.name);

        const result = await executeTool(db, fc.name, fc.args || {});

        if (fc.name === 'make_determination') {
          determination = result;
        }

        responseParts.push({
          functionResponse: {
            name: fc.name,
            response: result,
          },
        });
      }

      contents.push({ role: 'user', parts: responseParts });

      // If determination was made, we're done
      if (determination) break;

      // After 5 rounds of searching, nudge the model to make a determination
      if (round >= 4 && !determination) {
        contents.push({
          role: 'user',
          parts: [{ text: 'You have done enough searching. Now call make_determination with your verdict based on the evidence gathered so far.' }],
        });
      }
    }

    const durationMs = Date.now() - startTime;

    // If no determination was made via tool call, the verification failed
    if (!determination) {
      return { success: false, error: 'Model did not call make_determination' };
    }

    // Build verification result
    const translations = (determination.translations_found as Array<Record<string, unknown>> || []).map(t => ({
      english_title: (t.english_title as string) || '',
      translator: t.translator as string | undefined,
      pub_year: t.pub_year as string | undefined,
      publisher: t.publisher as string | undefined,
      completeness: (t.completeness as 'complete' | 'partial' | 'excerpts' | 'unknown') || 'unknown',
      evidence_source: (t.evidence_source as string) || 'unknown',
      url: t.url as string | undefined,
    }));

    const disposition = determination.disposition as TranslationVerification['disposition'];
    const confidence = determination.confidence as TranslationVerification['confidence'];
    const reasoning = (determination.reasoning as string) || '';

    // Calculate cost
    const inputCost = (totalInputTokens / 1_000_000) * 0.50;
    const outputCost = (totalOutputTokens / 1_000_000) * 3.00;
    const costUsd = Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;

    // Normalize disposition to standard values (model may return old names)
    const normalizedDisposition = (() => {
      const d = (disposition as string) || '';
      if (d === 'first_translation') return 'confirmed_first' as const;
      if (d === 'first_full_translation') return 'first_complete_translation' as const;
      if (d === 'translation_exists') return 'translation_found' as const;
      if (['confirmed_first', 'first_from_source', 'first_complete_translation', 'first_modern_translation', 'translation_found', 'needs_review'].includes(d)) return d as typeof disposition;
      return 'needs_review' as const;
    })();

    const verification: TranslationVerification = {
      disposition: normalizedDisposition,
      confidence,
      reasoning,
      translations_found: translations,
      tools_called: toolsCalled,
      verified_at: new Date(),
      model: MODEL,
      cost_usd: costUsd,
      source: 'catalog_and_llm',
      stage: 2,
    };

    const isFirstTranslation = ['confirmed_first', 'first_from_source', 'first_complete_translation', 'first_modern_translation'].includes(normalizedDisposition);

    // Persist to database (skip in dry-run mode)
    if (!options?.dryRun) {
      const previousVerification = book.translation_verification;
      const previousIsFirst = book.is_first_translation;

      await db.collection(booksCol).updateOne(
        { id: bookId },
        {
          $set: {
            translation_verification: verification,
            is_first_translation: isFirstTranslation,
          },
        },
      );

      // Log to gemini_usage
      await logGeminiCall({
        type: 'ft_verification',
        mode: 'realtime',
        model: MODEL,
        book_id: bookId,
        book_title: (book.display_title || book.title) as string,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        status: 'success',
        duration_ms: durationMs,
        endpoint: 'lib/verify-first-translation',
      });

      // Log metadata change
      const changes: Array<{ field: string; previous: unknown; new_value: unknown }> = [];
      if (JSON.stringify(previousVerification) !== JSON.stringify(verification)) {
        changes.push({
          field: 'translation_verification',
          previous: previousVerification ?? null,
          new_value: { disposition, confidence, translations_found: translations.length },
        });
      }
      if (previousIsFirst !== isFirstTranslation) {
        changes.push({
          field: 'is_first_translation',
          previous: previousIsFirst ?? null,
          new_value: isFirstTranslation,
        });
      }
      if (changes.length > 0) {
        await logMetadataChange(db, {
          book_id: bookId,
          source: 'ai_enrichment',
          model: MODEL,
          changes,
          note: `FT verification: ${disposition} (${confidence}) — ${toolsCalled.length} tools called`,
        });
      }
    }

    return { success: true, verification, is_first_translation: isFirstTranslation };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    // Log failed attempt
    await logGeminiCall({
      type: 'ft_verification',
      mode: 'realtime',
      model: MODEL,
      book_id: bookId,
      book_title: (book.display_title || book.title) as string,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'unknown',
      duration_ms: durationMs,
      endpoint: 'lib/verify-first-translation',
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}
