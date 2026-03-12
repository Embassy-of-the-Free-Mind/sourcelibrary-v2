/**
 * Unscanned Book Verification via Gemini Function Calling
 *
 * Adapted from verify-first-translation.ts — same multi-turn Gemini
 * function-calling loop, but searches digital library catalogs to determine
 * whether a historical book has been digitally scanned and is freely available.
 *
 * Four search tools + one terminal tool:
 *   - search_internet_archive: IA Advanced Search API
 *   - search_hathitrust: HathiTrust Catalog API
 *   - search_google_books: Google Books API (checks scan availability)
 *   - search_gallica: Gallica (BnF) search API
 *   - make_determination: Terminal tool — final verdict with evidence
 *
 * Designed for the Kloss Library / CMC catalog cross-reference project,
 * but works for any historical book metadata.
 */

import { Db } from 'mongodb';
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import { logGeminiCall } from './gemini-logger';

const MODEL = 'gemini-3-flash-preview';
const MAX_ROUNDS = 6;
const TEMPERATURE = 0.1;

// ── Types ─────────────────────────────────────────────────────────────

export type ScanDisposition =
  | 'confirmed_unscanned'   // No digital scan found anywhere
  | 'likely_unscanned'      // No full scan found, but some ambiguous evidence
  | 'scan_found'            // A complete digital scan exists and is accessible
  | 'partial_scan'          // Only partial or restricted scan exists
  | 'needs_review';         // Evidence conflicting or inconclusive

export interface ScanVerification {
  disposition: ScanDisposition;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  scans_found: Array<{
    title: string;
    source: string;           // 'internet_archive' | 'hathitrust' | 'google_books' | 'gallica'
    url: string;
    year?: string;
    access: 'open' | 'restricted' | 'partial' | 'unknown';
    format?: string;          // 'pdf' | 'djvu' | 'images' | 'unknown'
    match_confidence: 'exact' | 'likely' | 'possible';
  }>;
  tools_called: string[];
  verified_at: Date;
  model: string;
  cost_usd: number;
}

export interface ScanVerificationResult {
  success: boolean;
  verification?: ScanVerification;
  is_scanned?: boolean;
  error?: string;
}

// ── Tool Input Types ─────────────────────────────────────────────────

interface SearchArgs { query: string }

interface DeterminationArgs {
  disposition: ScanDisposition;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  scans_found: Array<{
    title: string;
    source: string;
    url: string;
    year?: string;
    access: string;
    format?: string;
    match_confidence: string;
  }>;
}

// ── Tool Definitions ──────────────────────────────────────────────────

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'search_internet_archive',
    description: 'Search the Internet Archive for digitized copies of this book. IA has the largest open-access collection of scanned historical books. Returns identifiers, titles, creators, dates, media types, and direct links. ALWAYS call this first — it is the most likely source for scanned books.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query — combine author + title keywords. For best results, use the original-language title. Example: "Kloss Freimaurerei" or "author:Kloss title:Geschichte der Freimaurerei"',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_hathitrust',
    description: 'Search the HathiTrust Digital Library for scanned copies. HathiTrust aggregates scans from major research libraries (Google Books partner library scans, IA scans, and library digitization projects). Returns catalog records with access status (full view = openly accessible scan, search-only = restricted). Good for finding US library scans.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query — author and/or title keywords. Example: "Geschichte Freimaurerei Kloss"',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_google_books',
    description: 'Search Google Books for digitized copies. Useful for finding books scanned by Google\'s library partners. Check the "viewability" field: "ALL_PAGES" means fully scanned and viewable, "PARTIAL" means some pages viewable, "NO_PAGES" means metadata only. Returns titles, authors, publishers, dates, and preview links.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query — author + title keywords. Example: "Kloss Geschichte der Freimaurerei"',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_gallica',
    description: 'Search Gallica (Bibliothèque nationale de France) for digitized copies. Gallica has a large collection of European historical texts, especially French and Latin works. Returns titles, dates, types, and links to digital copies.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query — author and/or title. Example: "Kloss Freimaurerei" or the French/Latin title if applicable.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'make_determination',
    description: 'Make a final determination about whether this book has been digitally scanned and is accessible online. Call this AFTER searching digital libraries. You MUST call this tool to complete the verification.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        disposition: {
          type: Type.STRING,
          description: 'The verdict: "confirmed_unscanned" (no digital scan found in any library), "likely_unscanned" (no definitive scan found, but some ambiguous matches that might be different editions), "scan_found" (a complete, accessible digital scan exists), "partial_scan" (only a restricted or incomplete scan exists), "needs_review" (conflicting evidence)',
          enum: ['confirmed_unscanned', 'likely_unscanned', 'scan_found', 'partial_scan', 'needs_review'],
        },
        confidence: {
          type: Type.STRING,
          description: 'Confidence: "high" (searched multiple sources with clear results), "medium" (some sources checked), "low" (limited search or ambiguous)',
          enum: ['high', 'medium', 'low'],
        },
        reasoning: {
          type: Type.STRING,
          description: 'Detailed reasoning explaining what was found (or not found) across the digital libraries searched. 2-4 sentences.',
        },
        scans_found: {
          type: Type.ARRAY,
          description: 'List of digital scans found in search results. ONLY include results that actually match this specific book (not just works by the same author). Empty array if no matching scans found.',
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Title as shown in the digital library catalog' },
              source: {
                type: Type.STRING,
                description: 'Which library has the scan',
                enum: ['internet_archive', 'hathitrust', 'google_books', 'gallica'],
              },
              url: { type: Type.STRING, description: 'Direct URL to the digital copy' },
              year: { type: Type.STRING, description: 'Publication year of the scanned edition' },
              access: {
                type: Type.STRING,
                description: 'Access level: "open" (freely viewable), "restricted" (login/IP required), "partial" (some pages), "unknown"',
                enum: ['open', 'restricted', 'partial', 'unknown'],
              },
              format: {
                type: Type.STRING,
                description: 'Digital format if known',
                enum: ['pdf', 'djvu', 'images', 'unknown'],
              },
              match_confidence: {
                type: Type.STRING,
                description: 'How confident are you this is the SAME book (not a different edition or work)?',
                enum: ['exact', 'likely', 'possible'],
              },
            },
            required: ['title', 'source', 'url', 'access', 'match_confidence'],
          },
        },
      },
      required: ['disposition', 'confidence', 'reasoning', 'scans_found'],
    },
  },
];

// ── Tool Implementations ──────────────────────────────────────────────

async function executeSearchInternetArchive(
  args: SearchArgs,
): Promise<Record<string, unknown>> {
  try {
    const q = args.query;
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=language&fl[]=mediatype&fl[]=description&fl[]=subject&output=json&rows=15&page=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `IA returned ${res.status}`, results: [] };

    const data = await res.json();
    const response = data.response || {};
    const docs = (response.docs || []).map((doc: Record<string, unknown>) => ({
      identifier: doc.identifier,
      title: doc.title,
      creator: doc.creator,
      date: doc.date,
      language: doc.language,
      mediatype: doc.mediatype,
      subject: typeof doc.subject === 'string' ? doc.subject.slice(0, 200) : undefined,
      url: `https://archive.org/details/${doc.identifier}`,
    }));

    return { total: response.numFound || 0, results: docs };
  } catch (error) {
    return { error: `IA search failed: ${error instanceof Error ? error.message : 'unknown'}`, results: [] };
  }
}

async function executeSearchHathiTrust(
  args: SearchArgs,
): Promise<Record<string, unknown>> {
  try {
    // HathiTrust Catalog API (full-text search via Solr)
    const url = `https://catalog.hathitrust.org/api/volumes/brief/title/${encodeURIComponent(args.query)}.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `HathiTrust returned ${res.status}`, results: [] };

    const data = await res.json();
    const items = data.items || [];
    const records = data.records || {};

    // Build results from records + items
    const results: Array<Record<string, unknown>> = [];
    for (const [recordId, record] of Object.entries(records)) {
      const rec = record as Record<string, unknown>;
      const recItems = items.filter((i: Record<string, unknown>) => String(i.fromRecord) === recordId);

      for (const item of recItems.slice(0, 3)) {
        results.push({
          record_id: recordId,
          title: Array.isArray(rec.titles) ? (rec.titles as string[])[0] : undefined,
          author: Array.isArray(rec.authors) ? Object.keys((rec.authors as Record<string, unknown>[])[0] || {}).join(', ') : undefined,
          published: Array.isArray(rec.publishDates) ? (rec.publishDates as string[])[0] : undefined,
          ht_id: (item as Record<string, unknown>).htid,
          access: (item as Record<string, unknown>).usRightsString,
          url: `https://babel.hathitrust.org/cgi/pt?id=${(item as Record<string, unknown>).htid}`,
        });
      }
    }

    return { total: Object.keys(records).length, results: results.slice(0, 10) };
  } catch (error) {
    return { error: `HathiTrust search failed: ${error instanceof Error ? error.message : 'unknown'}`, results: [] };
  }
}

async function executeSearchGoogleBooks(
  args: SearchArgs,
): Promise<Record<string, unknown>> {
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(args.query)}&maxResults=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { error: `Google Books returned ${res.status}`, results: [] };

    const data = await res.json();
    const results = (data.items || []).slice(0, 10).map((item: Record<string, unknown>) => {
      const vol = item.volumeInfo as Record<string, unknown> || {};
      const access = item.accessInfo as Record<string, unknown> || {};
      return {
        title: vol.title,
        subtitle: vol.subtitle,
        authors: vol.authors,
        publisher: vol.publisher,
        publishedDate: vol.publishedDate,
        language: vol.language,
        viewability: access.viewability,  // ALL_PAGES, PARTIAL, NO_PAGES
        accessViewStatus: access.accessViewStatus,
        embeddable: access.embeddable,
        publicDomain: access.publicDomain,
        epub_available: (access.epub as Record<string, unknown>)?.isAvailable,
        pdf_available: (access.pdf as Record<string, unknown>)?.isAvailable,
        url: (vol.infoLink as string) || (vol.previewLink as string) || undefined,
      };
    });

    return { total: data.totalItems || 0, results };
  } catch (error) {
    return { error: `Google Books search failed: ${error instanceof Error ? error.message : 'unknown'}`, results: [] };
  }
}

async function executeSearchGallica(
  args: SearchArgs,
): Promise<Record<string, unknown>> {
  try {
    const url = `https://gallica.bnf.fr/SRU?version=1.2&operation=searchRetrieve&query=(gallica all "${args.query}")&maximumRecords=10&startRecord=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `Gallica returned ${res.status}`, results: [] };

    const xml = await res.text();

    // Simple XML extraction — Gallica returns SRU XML
    const results: Array<Record<string, unknown>> = [];
    const recordMatches = xml.match(/<srw:record>[\s\S]*?<\/srw:record>/g) || [];

    for (const recordXml of recordMatches.slice(0, 10)) {
      const extract = (tag: string) => {
        const match = recordXml.match(new RegExp(`<dc:${tag}[^>]*>([^<]+)<\/dc:${tag}>`));
        return match ? match[1].trim() : undefined;
      };
      const extractAll = (tag: string) => {
        const re = new RegExp(`<dc:${tag}[^>]*>([^<]+)<\/dc:${tag}>`, 'g');
        const found: string[] = [];
        let m;
        while ((m = re.exec(recordXml)) !== null) found.push(m[1].trim());
        return found;
      };

      const identifiers = extractAll('identifier');
      const gallicaUrl = identifiers.find(id => id.includes('gallica.bnf.fr'));

      results.push({
        title: extract('title'),
        creator: extract('creator'),
        date: extract('date'),
        type: extract('type'),
        language: extract('language'),
        publisher: extract('publisher'),
        url: gallicaUrl || identifiers[0],
      });
    }

    // Extract total from numberOfRecords
    const totalMatch = xml.match(/<srw:numberOfRecords>(\d+)<\/srw:numberOfRecords>/);
    const total = totalMatch ? parseInt(totalMatch[1], 10) : results.length;

    return { total, results };
  } catch (error) {
    return { error: `Gallica search failed: ${error instanceof Error ? error.message : 'unknown'}`, results: [] };
  }
}

// ── Tool Dispatch ─────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'search_internet_archive':
      return executeSearchInternetArchive(args as unknown as SearchArgs);
    case 'search_hathitrust':
      return executeSearchHathiTrust(args as unknown as SearchArgs);
    case 'search_google_books':
      return executeSearchGoogleBooks(args as unknown as SearchArgs);
    case 'search_gallica':
      return executeSearchGallica(args as unknown as SearchArgs);
    case 'make_determination':
      return args; // Terminal tool — result is the args themselves
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── Build System Prompt ───────────────────────────────────────────────

function buildPrompt(record: Record<string, unknown>): string {
  const title = record.title || 'Unknown title';
  const authors = Array.isArray(record.authors)
    ? (record.authors as string[]).join(', ')
    : record.authors || 'Unknown author';
  const year = record.year || 'Unknown date';
  const place = record.place_of_publication || '';
  const publisher = record.publisher || '';
  const shelfMark = record.shelf_mark || record.kloss_shelf_mark || '';
  const notes = Array.isArray(record.notes) ? (record.notes as string[]).join('; ') : record.notes || '';
  const materialType = record.material_type || '';

  return `You are checking whether a historical book from the Bibliotheca Klossiana (a Masonic/esoteric collection in The Hague) has been digitally scanned and is available online. Your job is to search digital libraries for existing scans of this specific book, then make a determination.

## Book to Check

- **Title:** ${title}
- **Author(s):** ${authors}
- **Year:** ${year}
- **Place of publication:** ${place}
- **Publisher:** ${publisher}
- **Material type:** ${materialType}
- **Shelf mark:** ${shelfMark}
- **Catalog notes:** ${notes}

## Instructions

1. ALWAYS call \`search_internet_archive\` first with the title and/or author. IA is the most likely source for scanned historical books.
2. If IA finds no matches (or only ambiguous ones), call \`search_hathitrust\` and/or \`search_google_books\`.
3. For European texts (especially French, Latin, or Dutch), also try \`search_gallica\`.
4. After gathering evidence, call \`make_determination\` with your verdict. Do NOT do more than 3-4 searches.

## CRITICAL: Match Specificity

You must determine whether search results match THIS SPECIFIC BOOK — not just any book by the same author, not a different edition from a different century, and not a modern reprint or commentary.

Consider matching criteria:
- **Title match**: Does the title closely match? Account for spelling variations, abbreviations, and language differences.
- **Author match**: Is this the same author? Watch for common surnames.
- **Date/Edition match**: Is this the same edition (or close enough)? A scan of a 1786 edition of a work originally published in 1786 is a match. A scan of a 1890 reprint might also suffice. But a modern scholarly edition with commentary is different.
- **Content match**: For manuscripts (Kl.MS. items), an exact match is very unlikely — these are unique. Search for the title/subject but expect most manuscripts to be unscanned.

## Determination Guidelines

- **confirmed_unscanned**: No digital scan of this book (or a closely matching edition) found in any searched library. Thorough search across 2+ sources yielded nothing. High bar — you should have searched at least Internet Archive + one other source.
- **likely_unscanned**: No clear scan found, but there are ambiguous matches that MIGHT be the same work (e.g., similar title but different edition, or a result you can't fully evaluate). Needs human review.
- **scan_found**: A complete, accessible digital scan exists. Cite the URL. The scan should be of this specific work (any edition is acceptable unless it's a manuscript).
- **partial_scan**: A scan exists but is restricted (behind paywall/IP restriction) or incomplete (Google Books snippet view, HathiTrust search-only). Still useful information.
- **needs_review**: Conflicting evidence. Use sparingly.

## Manuscript Handling

Items with shelf marks like "Kl.MS." are unique manuscripts. These are overwhelmingly likely to be unscanned — digitized manuscripts from obscure Masonic collections are extremely rare. A quick search is sufficient; if nothing obvious appears, determine "confirmed_unscanned" with high confidence.`;
}

// ── Main Verification Function ────────────────────────────────────────

export async function verifyUnscanned(
  catalogRecord: Record<string, unknown>,
  options?: { dryRun?: boolean; db?: Db },
): Promise<ScanVerificationResult> {
  const startTime = Date.now();
  const priref = catalogRecord.priref as string || 'unknown';

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { success: false, error: 'GEMINI_API_KEY not set' };

  const ai = new GoogleGenAI({ apiKey });
  const systemPrompt = buildPrompt(catalogRecord);

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

        const result = await executeTool(fc.name, fc.args || {});

        if (fc.name === 'make_determination') {
          determination = result;
        }

        responseParts.push({
          functionResponse: { name: fc.name, response: result },
        });
      }

      contents.push({ role: 'user', parts: responseParts });

      if (determination) break;

      // Nudge after 3 rounds
      if (round >= 2) {
        contents.push({
          role: 'user',
          parts: [{ text: 'You have done enough searching. Now call make_determination with your verdict based on the evidence gathered so far.' }],
        });
      }
    }

    const durationMs = Date.now() - startTime;

    if (!determination) {
      return { success: false, error: 'Model did not call make_determination' };
    }

    // Build result
    const scansFound = (determination.scans_found as DeterminationArgs['scans_found'] || []).map(s => ({
      title: s.title || '',
      source: s.source || 'unknown',
      url: s.url || '',
      year: s.year,
      access: (s.access || 'unknown') as 'open' | 'restricted' | 'partial' | 'unknown',
      format: s.format as 'pdf' | 'djvu' | 'images' | 'unknown' | undefined,
      match_confidence: (s.match_confidence || 'possible') as 'exact' | 'likely' | 'possible',
    }));

    const disposition = determination.disposition as ScanDisposition;
    const confidence = determination.confidence as 'high' | 'medium' | 'low';
    const reasoning = (determination.reasoning as string) || '';

    const inputCost = (totalInputTokens / 1_000_000) * 0.50;
    const outputCost = (totalOutputTokens / 1_000_000) * 3.00;
    const costUsd = Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;

    const verification: ScanVerification = {
      disposition,
      confidence,
      reasoning,
      scans_found: scansFound,
      tools_called: toolsCalled,
      verified_at: new Date(),
      model: MODEL,
      cost_usd: costUsd,
    };

    const isScanned = ['scan_found', 'partial_scan'].includes(disposition);

    // Persist to MongoDB if db provided and not dry-run
    if (options?.db && !options.dryRun) {
      await options.db.collection('kloss_catalog').updateOne(
        { priref },
        {
          $set: {
            scan_verification: verification,
            is_scanned: isScanned,
            verified_at: new Date(),
          },
        },
      );

      await logGeminiCall({
        type: 'other',
        mode: 'realtime',
        model: MODEL,
        book_id: priref,
        book_title: (catalogRecord.title as string) || 'unknown',
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        status: 'success',
        duration_ms: durationMs,
        endpoint: 'lib/verify-unscanned',
      });
    }

    return { success: true, verification, is_scanned: isScanned };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (options?.db) {
      await logGeminiCall({
        type: 'other',
        mode: 'realtime',
        model: MODEL,
        book_id: priref,
        book_title: (catalogRecord.title as string) || 'unknown',
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'unknown',
        duration_ms: durationMs,
        endpoint: 'lib/verify-unscanned',
      });
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}
