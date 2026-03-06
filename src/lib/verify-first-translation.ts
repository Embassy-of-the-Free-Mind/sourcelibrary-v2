/**
 * First-Translation Verification via Gemini Function Calling
 *
 * Uses Gemini with tool use to search multiple catalogs and make an
 * evidence-based determination of whether a book is a first English translation.
 *
 * Five tools available to the model:
 *   - search_local_catalogs: MongoDB translation_catalogs collection
 *   - search_open_library: Open Library API
 *   - search_google_books: Google Books API
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

const MODEL = 'gemini-3-flash-preview';
const MAX_ROUNDS = 6; // Max Gemini round-trips (tool calls + responses)
const TEMPERATURE = 0.1;

// USTC Supabase (public anon key — read-only access)
const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraHhhZWNiYnhhYXFsdWp1emRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNjExMDEsImV4cCI6MjA4MDYzNzEwMX0.O2chfnHGQWLOaVSFQ-F6UJMlya9EzPbsUh848SEOPj4';

// ── Types ─────────────────────────────────────────────────────────────

export interface TranslationVerification {
  disposition: 'first_translation' | 'translation_exists' | 'first_full_translation' | 'needs_review';
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
          description: 'The verdict: "first_translation" (no complete English translation exists), "translation_exists" (complete English translation already published), "first_full_translation" (only partial/excerpt translations exist), "needs_review" (evidence is inconclusive)',
          enum: ['first_translation', 'translation_exists', 'first_full_translation', 'needs_review'],
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
          description: 'List of English translations found (empty if none). Include ALL translations found, even partial ones.',
          items: {
            type: Type.OBJECT,
            properties: {
              english_title: { type: Type.STRING, description: 'Title of the English translation' },
              translator: { type: Type.STRING, description: 'Translator name(s)' },
              pub_year: { type: Type.STRING, description: 'Publication year' },
              publisher: { type: Type.STRING, description: 'Publisher' },
              completeness: {
                type: Type.STRING,
                description: 'Is this a complete or partial translation?',
                enum: ['complete', 'partial', 'excerpts', 'unknown'],
              },
              evidence_source: { type: Type.STRING, description: 'Where this was found (e.g., "unesco_master", "open_library", "google_books")' },
              url: { type: Type.STRING, description: 'URL link to the catalog entry or book page (from the search results)' },
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

  // Include OCR samples for context
  if (ocrSamples.length > 0) {
    prompt += `## Sample OCR Text (first pages)
${ocrSamples.map((s, i) => `Page ${i + 1}: ${s.slice(0, 500)}`).join('\n\n')}

`;
  }

  prompt += `## Instructions

1. ALWAYS call \`search_local_catalogs\` first with the author's surname. This searches 12+ scholarly catalogs including UNESCO Index Translationum, Loeb Classical Library, Brill, Penguin Classics, etc.
2. If the local catalog search finds matches, evaluate whether they are translations of THIS SPECIFIC WORK (not just any work by the same author).
3. If no local matches (or matches are for different works), call \`search_open_library\` and/or \`search_google_books\` to check for translations not in our catalogs.
4. You may optionally call \`search_ustc\` to verify the identity of the original work.
5. After gathering evidence, call \`make_determination\` with your verdict. Do NOT do more than 3-4 searches — make your determination based on what you have found.

## CRITICAL: Source Text Matters

We are verifying whether THIS SPECIFIC TEXT (in ${lang}) has been translated to English. This is NOT about whether the underlying work has ever appeared in English from any source.

Many books in this library are Latin translations of Greek works (e.g. Ficino's Latin Iamblichus, Ficino's Latin Plato). If the original Greek has been translated directly to English by others, that does NOT count — we are asking whether the LATIN TEXT ITSELF has been translated. Different source languages produce different translations with different scholarly value.

Example: Iamblichus' "De Mysteriis" in Ficino's Latin — even though Taylor (1821) and Clarke (2003) translated the Greek original to English, Ficino's Latin rendering has never been translated to English. This is a FIRST TRANSLATION.

## Determination Guidelines

- **first_translation**: No complete English translation of this specific ${lang} text has been published. Strong evidence = no matches across multiple sources, OR only translations from a different source language exist.
- **translation_exists**: A complete English translation of THIS SPECIFIC ${lang} text already exists. Cite the specific translation found. The translation must be FROM THIS LANGUAGE, not from the original language of the work.
- **first_full_translation**: Only partial translations, excerpts, or anthologized selections of this ${lang} text exist. A full/complete translation has not been published.
- **needs_review**: Evidence is conflicting or inconclusive. Use sparingly — prefer a determination when possible.

Important: Be precise about matching. A translation of a different work by the same author does NOT count. A translation from a different source language (e.g. Greek→English when we have the Latin text) does NOT count. "Selected works" or "excerpts" are partial, not complete translations.`;

  return prompt;
}

// ── Main Verification Function ────────────────────────────────────────

export async function verifyFirstTranslation(
  db: Db,
  bookId: string,
  options?: { dryRun?: boolean },
): Promise<VerificationResult> {
  const startTime = Date.now();

  // Fetch book
  const book = await db.collection('books').findOne(
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

  // Fetch first 3 pages of OCR for context
  const pages = await db.collection('pages')
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

      // After 3 rounds of searching, nudge the model to make a determination
      if (round >= 2 && !determination) {
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

    const verification: TranslationVerification = {
      disposition,
      confidence,
      reasoning,
      translations_found: translations,
      tools_called: toolsCalled,
      verified_at: new Date(),
      model: MODEL,
      cost_usd: costUsd,
    };

    const isFirstTranslation = disposition === 'first_translation' || disposition === 'first_full_translation';

    // Persist to database (skip in dry-run mode)
    if (!options?.dryRun) {
      const previousVerification = book.translation_verification;
      const previousIsFirst = book.is_first_translation;

      await db.collection('books').updateOne(
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
