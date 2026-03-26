/**
 * AI-Powered USTC Matcher via Gemini Function Calling
 *
 * Matches books to USTC editions using a two-tier approach:
 *   1. Fast word-overlap pre-filter (surname + decade blocking + title overlap)
 *   2. Gemini tool-calling for ambiguous cases (cross-language, variant names)
 *
 * Modeled on verify-first-translation.ts — same Gemini tool-calling pattern.
 *
 * Four tools available to the model:
 *   - search_ustc_editions: Supabase ustc_editions by author/title/year
 *   - search_ustc_enrichments: AI-enriched records with English titles
 *   - search_local_books: Check if we already have this in Source Library
 *   - make_match: Terminal tool — final USTC match determination
 *
 * GitHub issue: #343
 */

import { Db } from 'mongodb';
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import { logGeminiCall } from './gemini-logger';

const MODEL = 'gemini-3.1-flash-lite-preview';
const MAX_ROUNDS = 5;
const TEMPERATURE = 0.1;

// Supabase (read-only anon key — from env)
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

// ── Types ─────────────────────────────────────────────────────────────

export interface UstcMatch {
  ustc_sn: number;
  ustc_title: string;
  ustc_author: string;
  ustc_year: number;
  ustc_language: string;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  match_method: 'word_overlap' | 'ai_tool_calling';
  match_score?: number;
  alternatives: Array<{
    ustc_sn: number;
    title: string;
    author: string;
    year: number;
    reason_rejected: string;
  }>;
  tools_called: string[];
  matched_at: Date;
  model: string;
  cost_usd: number;
}

export interface MatchResult {
  success: boolean;
  match?: UstcMatch;
  error?: string;
  skipped?: string;
}

// ── Utility Functions ─────────────────────────────────────────────────

function extractSurname(author: string | null | undefined): string | null {
  if (!author) return null;
  let s = author
    .replace(/^\[+/, '').replace(/\]+$/, '')
    .replace(/\[!\]/g, '')
    .replace(/\s*\|.*/g, '')
    .replace(/;\s*.*/g, '')
    .replace(/\s*\(.*?\)/g, '')
    .replace(/pub\.\s+.*/i, '')
    .trim();
  if (/^(anonymous|unknown|anon\.?|onbekend|none)$/i.test(s)) return null;
  if (s.length <= 2) return null;
  const comma = s.indexOf(',');
  if (comma > 0) return s.substring(0, comma).trim().toLowerCase();
  const parts = s.split(/\s+/);
  return parts[parts.length - 1].toLowerCase();
}

/** Extract multiple candidate surnames for entity_aliases lookup.
 *  "Ludolf von Sachsen" → ["sachsen", "ludolf"]
 *  "Corvo, Andreas" → ["corvo"]
 *  Handles particles: von, van, de, di, del, of, ab, a */
function extractSurnameVariants(author: string | null | undefined): string[] {
  if (!author) return [];
  let s = author
    .replace(/^\[+/, '').replace(/\]+$/, '')
    .replace(/\[!\]/g, '')
    .replace(/\s*\|.*/g, '')
    .replace(/;\s*.*/g, '')
    .replace(/\s*\(.*?\)/g, '')
    .replace(/pub\.\s+.*/i, '')
    .trim();
  if (/^(anonymous|unknown|anon\.?|onbekend|none)$/i.test(s)) return [];
  if (s.length <= 2) return [];

  const variants = new Set<string>();
  const comma = s.indexOf(',');
  if (comma > 0) {
    // "Corvo, Andreas" → corvo
    variants.add(s.substring(0, comma).trim().toLowerCase());
  } else {
    // "Ludolf von Sachsen" → sachsen + ludolf
    const parts = s.split(/\s+/);
    const particles = new Set(['von', 'van', 'de', 'di', 'del', 'of', 'ab', 'a', 'da', 'du', 'des', 'der', 'den']);
    // Last word
    variants.add(parts[parts.length - 1].toLowerCase());
    // First word (often the actual name for "Firstname von Place" patterns)
    if (parts.length >= 2 && parts[0].length >= 3) {
      variants.add(parts[0].toLowerCase());
    }
    // Any non-particle word
    for (const p of parts) {
      if (p.length >= 3 && !particles.has(p.toLowerCase())) {
        variants.add(p.toLowerCase());
      }
    }
  }

  return Array.from(variants);
}

function titleWordSet(title: string | null | undefined): Set<string> {
  return new Set(
    (title || '')
      .toLowerCase()
      .replace(/[^a-zà-ÿ\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
  );
}

function titleWordOverlap(a: string | null | undefined, b: string | null | undefined): number {
  const wa = titleWordSet(a);
  const wb = titleWordSet(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let overlap = 0;
  Array.from(wa).forEach(w => { if (wb.has(w)) overlap++; });
  return overlap / Math.min(wa.size, wb.size);
}

// ── Entity Alias Lookup ──────────────────────────────────────────────

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Get all known surname variants for an author from entity_aliases.
 * Returns the original surname plus any variants from Wikidata/CERL.
 */
async function getAuthorVariants(db: Db, author: string | null | undefined): Promise<string[]> {
  const surnameVariants = extractSurnameVariants(author);
  if (surnameVariants.length === 0) return [];
  const variants = new Set<string>(surnameVariants);

  try {
    // Search entity_aliases by all surname candidates
    const searchTerms = surnameVariants.map(s => stripDiacritics(s.toLowerCase()));
    const docs = await db.collection('entity_aliases').find(
      { surnames: { $in: searchTerms } },
      { projection: { names: 1, surnames: 1 } }
    ).limit(10).toArray();

    for (const doc of docs) {
      // Extract all possible surname forms from every name variant
      for (const name of (doc.names || [])) {
        const comma = name.indexOf(',');
        if (comma > 0) {
          // "Corvus, Andreas" → "corvus"
          variants.add(name.substring(0, comma).trim().toLowerCase());
        }
        // Also add every word ≥4 chars as a potential surname
        // This catches "Andreas Corvus Mirandulensis" → "corvus"
        const particles = new Set(['von', 'van', 'de', 'di', 'del', 'of', 'ab', 'da', 'du', 'des', 'der', 'den', 'the']);
        for (const word of name.split(/\s+/)) {
          const w = word.toLowerCase().replace(/[^a-zà-ÿ]/g, '');
          if (w.length >= 4 && !particles.has(w)) {
            variants.add(w);
          }
        }
      }
      // Also add raw surnames from the doc
      for (const s of (doc.surnames || [])) {
        variants.add(s);
      }
    }
  } catch {
    // entity_aliases unavailable — use original surname only
  }

  return Array.from(variants).filter(s => s.length >= 3);
}

// ── Fast Pre-Filter (word overlap) ────────────────────────────────────

async function fastMatch(
  db: Db,
  book: { title: string; author?: string; year?: number },
): Promise<{ ustcEdition: Record<string, unknown>; score: number } | null> {
  const surname = extractSurname(book.author || null);
  if (!surname || !book.year) return null;

  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  };

  const yearLo = book.year - 20;
  const yearHi = book.year + 20;

  // Get all known name variants from entity_aliases (using full author string)
  const surnameVariants = await getAuthorVariants(db, book.author);

  // Try each variant until we find candidates
  let allCandidates: Record<string, unknown>[] = [];
  const seenSns = new Set<number>();

  for (const variant of surnameVariants) {
    const urlStr = `${SUPABASE_URL}/rest/v1/ustc_editions?select=sn,title,author_1,year,language_1,place&author_1=ilike.*${encodeURIComponent(variant)}*&year=gte.${yearLo}&year=lte.${yearHi}&limit=50`;

    try {
      const res = await fetch(urlStr, { headers, signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const candidates = await res.json();
      if (!Array.isArray(candidates)) continue;
      for (const c of candidates) {
        if (!seenSns.has(c.sn as number)) {
          seenSns.add(c.sn as number);
          allCandidates.push(c);
        }
      }
      // If we already have good candidates, no need to try more variants
      if (allCandidates.length > 0) break;
    } catch {
      // Timeout or network error — try next variant
    }
  }

  if (allCandidates.length === 0) return null;

  // Score by title word overlap (try both original and diacritics-stripped)
  let best: Record<string, unknown> | null = null;
  let bestScore = 0;
  for (const c of allCandidates) {
    const score = Math.max(
      titleWordOverlap(book.title, c.title as string),
      titleWordOverlap(stripDiacritics(book.title), stripDiacritics(c.title as string)),
    );
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (best && bestScore >= 0.6) {
    return { ustcEdition: best, score: bestScore };
  }

  return null;
}

// ── Tool Definitions ──────────────────────────────────────────────────

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'search_ustc_editions',
    description: 'Search the Universal Short Title Catalogue (1.6M editions, 1450-1700) by author and/or title. Returns USTC serial numbers, titles, authors, years, languages, and places. Use author surnames for best results. ALWAYS call this first.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        author: {
          type: Type.STRING,
          description: 'Author surname to search for (e.g., "Ficino", "Agrippa", "Paracelsus")',
        },
        title_keywords: {
          type: Type.STRING,
          description: 'Optional: title keywords (e.g., "platonic theology", "de triplici vita")',
        },
        year_from: {
          type: Type.NUMBER,
          description: 'Optional: earliest publication year',
        },
        year_to: {
          type: Type.NUMBER,
          description: 'Optional: latest publication year',
        },
      },
      required: ['author'],
    },
  },
  {
    name: 'search_ustc_enrichments',
    description: 'Search AI-enriched USTC records with English titles. Useful for cross-language matching — finds records where the original Latin/German/Dutch title has been translated to English. Returns enrichment IDs (NOT USTC SNs — use the USTC SN from the linked edition).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        english_title: {
          type: Type.STRING,
          description: 'English title or keywords to search for (e.g., "Golden Calf", "Occult Philosophy")',
        },
        author: {
          type: Type.STRING,
          description: 'Optional: author to narrow results',
        },
      },
      required: ['english_title'],
    },
  },
  {
    name: 'search_local_books',
    description: 'Search Source Library\'s own collection for books matching this work. Helps identify if we already have this edition or a related one.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Author and/or title keywords to search for',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'make_match',
    description: 'Make a final determination about which USTC edition matches this book. Call this AFTER searching. You MUST call this tool to complete the matching.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        ustc_sn: {
          type: Type.NUMBER,
          description: 'The USTC serial number of the best matching edition. Use 0 if no match found.',
        },
        ustc_title: {
          type: Type.STRING,
          description: 'Title of the matched USTC edition',
        },
        ustc_author: {
          type: Type.STRING,
          description: 'Author of the matched USTC edition',
        },
        ustc_year: {
          type: Type.NUMBER,
          description: 'Year of the matched USTC edition',
        },
        ustc_language: {
          type: Type.STRING,
          description: 'Language of the matched USTC edition',
        },
        confidence: {
          type: Type.STRING,
          description: 'Confidence: "high" (same author, title clearly matches), "medium" (likely match but some ambiguity), "low" (possible match, needs human review)',
          enum: ['high', 'medium', 'low'],
        },
        reasoning: {
          type: Type.STRING,
          description: 'Why this edition matches (or why no match was found). 1-3 sentences.',
        },
        alternatives: {
          type: Type.ARRAY,
          description: 'Other candidate USTC editions considered but rejected',
          items: {
            type: Type.OBJECT,
            properties: {
              ustc_sn: { type: Type.NUMBER },
              title: { type: Type.STRING },
              author: { type: Type.STRING },
              year: { type: Type.NUMBER },
              reason_rejected: { type: Type.STRING },
            },
            required: ['ustc_sn', 'title', 'reason_rejected'],
          },
        },
      },
      required: ['ustc_sn', 'confidence', 'reasoning', 'alternatives'],
    },
  },
];

// ── Tool Implementations ──────────────────────────────────────────────

async function executeSearchUstcEditions(
  args: { author: string; title_keywords?: string; year_from?: number; year_to?: number },
): Promise<Record<string, unknown>> {
  try {
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    };

    // Build filter parts
    const filters: string[] = [];
    filters.push(`author_1=ilike.*${encodeURIComponent(args.author)}*`);
    if (args.year_from) filters.push(`year=gte.${args.year_from}`);
    if (args.year_to) filters.push(`year=lte.${args.year_to}`);

    let urlStr = `${SUPABASE_URL}/rest/v1/ustc_editions?select=sn,title,author_1,year,language_1,place&${filters.join('&')}&limit=20`;

    // If title keywords provided, add title filter
    if (args.title_keywords) {
      // Use first significant keyword for title filter
      const keywords = args.title_keywords.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      if (keywords.length > 0) {
        urlStr += `&title=ilike.*${encodeURIComponent(keywords[0])}*`;
      }
    }

    const res = await fetch(urlStr, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { error: `USTC returned ${res.status}`, results: [] };

    const data = await res.json();
    return {
      total: data.length,
      results: (data as Array<Record<string, unknown>>).slice(0, 20).map(row => ({
        ustc_sn: row.sn,
        title: row.title,
        author: row.author_1,
        year: row.year,
        language: row.language_1,
        place: row.place,
      })),
    };
  } catch (error) {
    return { error: `USTC search failed: ${error instanceof Error ? error.message : 'unknown'}`, results: [] };
  }
}

async function executeSearchUstcEnrichments(
  args: { english_title: string; author?: string },
): Promise<Record<string, unknown>> {
  try {
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    };

    // Extract keywords for ilike search
    const keywords = args.english_title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (keywords.length === 0) return { error: 'No significant keywords', results: [] };

    // Use the 2 most distinctive words (longest)
    const searchWords = keywords.sort((a, b) => b.length - a.length).slice(0, 2);
    let filters = searchWords.map(w => `english_title=ilike.*${encodeURIComponent(w)}*`).join('&');
    if (args.author) {
      filters += `&original_author=ilike.*${encodeURIComponent(args.author)}*`;
    }

    const urlStr = `${SUPABASE_URL}/rest/v1/ustc_enrichments?select=id,english_title,std_title,original_author,detected_language&${filters}&limit=15`;
    const res = await fetch(urlStr, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { error: `Enrichments returned ${res.status}`, results: [] };

    const enrichments = await res.json() as Array<Record<string, unknown>>;
    if (enrichments.length === 0) return { total: 0, results: [] };

    // Look up the real USTC edition for each enrichment (enrichment.id = Supabase row ID, not USTC SN)
    const results: Array<Record<string, unknown>> = [];
    for (const e of enrichments.slice(0, 10)) {
      try {
        const edUrl = `${SUPABASE_URL}/rest/v1/ustc_editions?id=eq.${e.id}&select=sn,title,author_1,year,language_1,place`;
        const edRes = await fetch(edUrl, { headers, signal: AbortSignal.timeout(5000) });
        if (!edRes.ok) continue;
        const editions = await edRes.json() as Array<Record<string, unknown>>;
        if (editions.length === 0) continue;
        const ed = editions[0];
        results.push({
          ustc_sn: ed.sn,
          title: ed.title,
          english_title: e.english_title,
          author: ed.author_1,
          year: ed.year,
          language: ed.language_1,
          place: ed.place,
        });
      } catch {
        // Skip failed lookups
      }
    }

    return { total: results.length, results };
  } catch (error) {
    return { error: `Enrichment search failed: ${error instanceof Error ? error.message : 'unknown'}`, results: [] };
  }
}

async function executeSearchLocalBooks(
  db: Db,
  args: { query: string },
): Promise<Record<string, unknown>> {
  try {
    const words = args.query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (words.length === 0) return { total: 0, results: [] };

    // Search by author or title keywords
    const regexParts = words.slice(0, 3).map(w => ({ $or: [
      { title: { $regex: w, $options: 'i' } },
      { author: { $regex: w, $options: 'i' } },
    ]}));

    const results = await db.collection('books')
      .find({ $and: regexParts })
      .project({ id: 1, title: 1, author: 1, year: 1, published: 1, ustc_id: 1 })
      .limit(10)
      .toArray();

    return {
      total: results.length,
      results: results.map(b => ({
        book_id: b.id,
        title: b.title,
        author: b.author,
        year: b.year || b.published,
        ustc_id: b.ustc_id || null,
      })),
    };
  } catch (error) {
    return { error: `Local search failed: ${error instanceof Error ? error.message : 'unknown'}`, results: [] };
  }
}

// ── Tool Dispatch ─────────────────────────────────────────────────────

async function executeTool(
  db: Db,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'search_ustc_editions':
      return executeSearchUstcEditions(args as { author: string; title_keywords?: string; year_from?: number; year_to?: number });
    case 'search_ustc_enrichments':
      return executeSearchUstcEnrichments(args as { english_title: string; author?: string });
    case 'search_local_books':
      return executeSearchLocalBooks(db, args as { query: string });
    case 'make_match':
      return args; // Terminal tool — extract result from args
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── Build Prompt ──────────────────────────────────────────────────────

function buildPrompt(book: {
  title: string;
  author?: string;
  year?: number;
  language?: string;
}): string {
  return `You are matching a book from a library catalog to the Universal Short Title Catalogue (USTC), which records every known edition printed in Europe between 1450 and 1700.

## Book to Match

- **Title:** ${book.title}
- **Author:** ${book.author || 'Unknown'}
- **Year:** ${book.year || 'Unknown'}
- **Language:** ${book.language || 'Unknown'}

## Instructions

1. ALWAYS call \`search_ustc_editions\` first with the author's surname and year range (±20 years).
2. If no results or ambiguous results, try \`search_ustc_enrichments\` with an English translation of the title — this catches cross-language matches (e.g., "Guldenes Kalb" → "Golden Calf").
3. Optionally call \`search_local_books\` to check if Source Library already has this.
4. After gathering evidence, call \`make_match\` with the best USTC edition.

## Matching Rules

- **Same work, different edition** is still a match. A 1498 printing of "De Triplici Vita" matches a 1489 first edition.
- **Author name variants** are common: "Marsilius Ficinus" = "Marsilio Ficino", "Henricus Cornelius Agrippa" = "Agrippa von Nettesheim".
- **Cross-language titles** are common: a Dutch catalog may list "Het gouden kalf" while USTC has the Latin "Vitulus aureus".
- **Compilations/anthologies** should match individual works if identifiable.
- Set \`ustc_sn: 0\` if no match found — this is a valid outcome (manuscripts, post-1700 works, genuinely rare items).
- Keep searches efficient — 2-3 searches should suffice for most cases. Don't over-search.`;
}

// ── Main Match Function ───────────────────────────────────────────────

export async function matchToUstc(
  db: Db,
  book: {
    title: string;
    author?: string;
    year?: number;
    language?: string;
    id?: string; // Source Library book ID or external catalog ID
  },
  options?: { force?: boolean; skipFastPath?: boolean },
): Promise<MatchResult> {
  // Step 1: Try fast word-overlap match (free, instant) — now with entity_aliases
  if (!options?.skipFastPath) {
    const fast = await fastMatch(db, book);
    if (fast && fast.score >= 0.6) {
      const ed = fast.ustcEdition;
      return {
        success: true,
        match: {
          ustc_sn: ed.sn as number,
          ustc_title: ed.title as string,
          ustc_author: ed.author_1 as string,
          ustc_year: ed.year as number,
          ustc_language: ed.language_1 as string,
          confidence: fast.score >= 0.8 ? 'high' : 'medium',
          reasoning: `Fast word-overlap match (score: ${fast.score.toFixed(2)})`,
          match_method: 'word_overlap',
          match_score: fast.score,
          alternatives: [],
          tools_called: [],
          matched_at: new Date(),
          model: 'word_overlap',
          cost_usd: 0,
        },
      };
    }
  }

  // Step 2: AI tool-calling match
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { success: false, error: 'GEMINI_API_KEY not set' };

  const ai = new GoogleGenAI({ apiKey });
  const systemPrompt = buildPrompt(book);
  const toolsCalled: string[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let determination: Record<string, unknown> | null = null;

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

      contents.push({
        role: 'model',
        parts: candidate.content.parts as Array<Record<string, unknown>>,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const functionCalls = candidate.content.parts.filter((p: any) => p.functionCall);

      if (functionCalls.length === 0) break;

      const responseParts: Array<Record<string, unknown>> = [];

      for (const part of functionCalls) {
        const fc = part.functionCall as { name: string; args: Record<string, unknown> };
        toolsCalled.push(fc.name);

        const result = await executeTool(db, fc.name, fc.args || {});

        if (fc.name === 'make_match') {
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

      if (determination) break;

      // Nudge after 3 rounds
      if (round >= 2 && !determination) {
        contents.push({
          role: 'user',
          parts: [{ text: 'Make your determination now. Call make_match with the best USTC edition found, or ustc_sn: 0 if none match.' }],
        });
      }
    }

    if (!determination) {
      return { success: false, error: 'Model did not call make_match' };
    }

    // Flash-lite pricing: $0.075/M input, $0.30/M output
    const inputCost = (totalInputTokens / 1_000_000) * 0.075;
    const outputCost = (totalOutputTokens / 1_000_000) * 0.30;
    const costUsd = Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;

    const ustcSn = (determination.ustc_sn as number) || 0;

    if (ustcSn === 0) {
      return {
        success: true,
        match: undefined,
        skipped: (determination.reasoning as string) || 'No USTC match found',
      };
    }

    const match: UstcMatch = {
      ustc_sn: ustcSn,
      ustc_title: (determination.ustc_title as string) || '',
      ustc_author: (determination.ustc_author as string) || '',
      ustc_year: (determination.ustc_year as number) || 0,
      ustc_language: (determination.ustc_language as string) || '',
      confidence: (determination.confidence as 'high' | 'medium' | 'low') || 'medium',
      reasoning: (determination.reasoning as string) || '',
      match_method: 'ai_tool_calling',
      alternatives: ((determination.alternatives as Array<Record<string, unknown>>) || []).map(a => ({
        ustc_sn: (a.ustc_sn as number) || 0,
        title: (a.title as string) || '',
        author: (a.author as string) || '',
        year: (a.year as number) || 0,
        reason_rejected: (a.reason_rejected as string) || '',
      })),
      tools_called: toolsCalled,
      matched_at: new Date(),
      model: MODEL,
      cost_usd: costUsd,
    };

    // Log to gemini_usage for cost tracking
    try {
      await logGeminiCall({
        type: 'other',
        mode: 'realtime',
        model: MODEL,
        book_id: book.id,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        status: 'success',
      });
    } catch {
      // Non-critical — don't fail the match
    }

    return { success: true, match };
  } catch (error) {
    return { success: false, error: `Gemini error: ${error instanceof Error ? error.message : 'unknown'}` };
  }
}

// ── Batch Match Helper ────────────────────────────────────────────────

export async function matchBookToUstc(
  db: Db,
  bookId: string,
  options?: { force?: boolean },
): Promise<MatchResult> {
  const book = await db.collection('books').findOne(
    { id: bookId },
    { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, original_language: 1, ustc_id: 1, ustc_match: 1 } },
  );

  if (!book) return { success: false, error: `Book not found: ${bookId}` };

  // Skip if already matched (unless forced)
  if (book.ustc_id && !options?.force) {
    return { success: true, skipped: 'Already matched' };
  }

  const result = await matchToUstc(db, {
    title: (book.display_title || book.title) as string,
    author: book.author as string | undefined,
    year: (book.year || book.published) as number | undefined,
    language: (book.language || book.original_language) as string | undefined,
    id: book.id as string,
  }, options);

  // Persist match to database
  if (result.success && result.match) {
    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          ustc_id: result.match.ustc_sn,
          ustc_match: {
            ustc_sn: result.match.ustc_sn,
            confidence: result.match.confidence,
            reasoning: result.match.reasoning,
            match_method: result.match.match_method,
            match_score: result.match.match_score,
            alternatives: result.match.alternatives,
            tools_called: result.match.tools_called,
            matched_at: result.match.matched_at,
            model: result.match.model,
            cost_usd: result.match.cost_usd,
          },
          'field_provenance.ustc_id': {
            source: 'ai-matcher',
            method: result.match.match_method,
            confidence: result.match.confidence,
            date: new Date(),
          },
          'field_provenance.ustc_match': {
            source: 'ai-matcher',
            method: result.match.match_method,
            confidence: result.match.confidence,
            date: new Date(),
          },
        },
      },
    );
  }

  return result;
}
