#!/usr/bin/env node
/**
 * Three-tier first-translation verification for ISTC import candidates.
 *
 * Tier 1: Cross-ref against local translation_catalogs (free, instant)
 * Tier 2: Filter out English-language incunabula (free, instant)
 * Tier 3: Gemini FT verification with 7 catalog searches (~$0.002/book)
 *
 * Write-back: Tier 3 discoveries get added to translation_catalogs
 * so future Tier 1 runs catch them automatically.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/verify-istc-candidates.mjs
 *
 * Options:
 *   --dry-run         Preview without writing
 *   --limit=N         Max candidates to process
 *   --tier=1|2|3|all  Run specific tier (default: all)
 *   --concurrency=N   Gemini concurrency for Tier 3 (default: 3)
 *   --force           Re-verify already-verified candidates
 *   --in-scope-only   Only process in_scope candidates (default: true)
 *   --has-digital     Only process candidates with digital copies
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI, Type } from '@google/genai';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const HAS_DIGITAL = args.includes('--has-digital');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;
const TIER = args.find(a => a.startsWith('--tier='))?.split('=')[1] || 'all';
const CONCURRENCY = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '3');
const DELAY_MS = parseInt(args.find(a => a.startsWith('--delay='))?.split('=')[1] || '500');

// ── Tier 1: Local cross-ref ─────────────────────────────────────────

async function runTier1(db, candidates) {
  console.log('\n═══ Tier 1: Local catalog cross-reference ═══');

  // Pre-load all translation_catalogs grouped by author surname
  const allCatalogs = await db.collection('translation_catalogs')
    .find({}, {
      projection: {
        source: 1, author: 1, author_surname: 1, author_normalized: 1,
        canonical_author: 1, canonical_author_normalized: 1,
        english_title: 1, english_title_normalized: 1,
        canonical_work: 1, canonical_work_normalized: 1,
        original_title: 1, translator: 1, pub_year: 1, publisher: 1,
        completeness: 1,
      },
    })
    .toArray();

  // Index by normalized surname for fast lookup
  const bySurname = new Map();
  for (const rec of allCatalogs) {
    const surnames = new Set();
    if (rec.author_surname) surnames.add(rec.author_surname.toLowerCase());
    if (rec.canonical_author_normalized) {
      const parts = rec.canonical_author_normalized.split(/\s+/);
      if (parts.length > 0) surnames.add(parts[parts.length - 1]);
    }
    if (rec.author_normalized) {
      const parts = rec.author_normalized.split(/\s+/);
      if (parts.length > 0) surnames.add(parts[parts.length - 1]);
    }
    for (const s of surnames) {
      if (!s || s.length < 2) continue;
      if (!bySurname.has(s)) bySurname.set(s, []);
      bySurname.get(s).push(rec);
    }
  }

  console.log(`  Loaded ${allCatalogs.length} catalog records, indexed by ${bySurname.size} surnames`);

  let matched = 0, noMatch = 0, skipped = 0;
  const updates = [];

  for (const c of candidates) {
    if (c.ft_status && !FORCE) { skipped++; continue; }

    const surname = (c.author_surname || '').toLowerCase();
    const authorLower = (c.author || '').toLowerCase();

    // Find catalog records matching this author
    let authorMatches = [];
    // Try exact surname first
    if (surname && surname.length >= 2) {
      authorMatches = bySurname.get(surname) || [];
    }
    // For classical authors, try canonical name variants
    if (authorMatches.length === 0 && authorLower) {
      const firstWord = authorLower.split(/[,\s]+/)[0];
      // Only do fuzzy matching for long, distinctive names (>= 6 chars)
      // This avoids "alexander" matching every Alexander in the catalog
      if (firstWord && firstWord.length >= 6) {
        // Try exact match on first word as surname
        const exactFirst = bySurname.get(firstWord) || [];
        if (exactFirst.length > 0) {
          authorMatches = exactFirst;
        }
      }
    }

    if (authorMatches.length === 0) {
      noMatch++;
      continue;
    }

    // Filter by title keywords — require meaningful overlap
    const title = (c.title || '').toLowerCase();
    const STOP_WORDS = new Set(['with', 'from', 'this', 'that', 'also', 'item', 'liber', 'libri', 'opus',
      'super', 'contra', 'sancti', 'beati', 'editio', 'latin', 'english', 'german', 'french']);
    const titleWords = title
      .replace(/\[.*?\]/g, '') // remove [Latin], [English] etc
      .replace(/\(.*?\)/g, '') // remove (Tr: ...) etc
      .split(/[^a-z]+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w));

    let titleMatches = [];
    if (titleWords.length > 0) {
      // Score each catalog record by keyword overlap
      titleMatches = authorMatches
        .map(r => {
          const allText = [
            r.english_title, r.english_title_normalized,
            r.original_title, r.canonical_work, r.canonical_work_normalized,
          ].filter(Boolean).join(' ').toLowerCase();
          const hits = titleWords.filter(w => allText.includes(w));
          return { ...r, _hits: hits.length };
        })
        .filter(r => {
          // Require >=2 keyword hits, OR 1 hit if the word is very specific (>=7 chars)
          if (r._hits >= 2) return true;
          if (r._hits === 1) {
            const matchedWord = titleWords.find(w => {
              const allText = [r.english_title, r.original_title, r.canonical_work].filter(Boolean).join(' ').toLowerCase();
              return allText.includes(w);
            });
            return matchedWord && matchedWord.length >= 7;
          }
          return false;
        })
        .sort((a, b) => b._hits - a._hits);
    } else if (authorMatches.length <= 3) {
      // Very few author matches and no useful title words — include all author matches
      titleMatches = authorMatches;
    }

    if (titleMatches.length > 0) {
      matched++;
      const top = titleMatches.slice(0, 5).map(r => ({
        source: r.source,
        english_title: r.english_title,
        translator: r.translator,
        pub_year: r.pub_year,
        publisher: r.publisher,
        completeness: r.completeness,
      }));

      updates.push({
        updateOne: {
          filter: { _id: c._id },
          update: {
            $set: {
              ft_status: 'has_translation',
              ft_tier: 1,
              ft_details: {
                source: 'local_catalog_crossref',
                match_count: titleMatches.length,
                top_matches: top,
                verified_at: new Date(),
              },
            },
          },
        },
      });

      if (matched <= 10) {
        console.log(`  MATCH ${c.source_id} — ${(c.author || '').substring(0, 20)}: ${(c.title || '').substring(0, 45)}`);
        console.log(`    → ${top[0].english_title?.substring(0, 50)} (${top[0].translator || '?'}, ${top[0].pub_year || '?'})`);
      }
    } else {
      noMatch++;
    }
  }

  if (!DRY_RUN && updates.length > 0) {
    for (let i = 0; i < updates.length; i += 500) {
      await db.collection('import_candidates').bulkWrite(updates.slice(i, i + 500));
    }
  }

  console.log(`  Results: ${matched} matched, ${noMatch} no match, ${skipped} skipped (already verified)`);
  return { matched, noMatch, skipped };
}

// ── Tier 2: English filter ──────────────────────────────────────────

async function runTier2(db, candidates) {
  console.log('\n═══ Tier 2: English language filter ═══');

  const updates = [];
  let filtered = 0, skipped = 0;

  for (const c of candidates) {
    if (c.ft_status && !FORCE) { skipped++; continue; }

    const lang = (c.language || '').toLowerCase();
    if (lang === 'english') {
      filtered++;
      updates.push({
        updateOne: {
          filter: { _id: c._id },
          update: {
            $set: {
              ft_status: 'skip_english',
              ft_tier: 2,
              ft_details: { source: 'language_filter', verified_at: new Date() },
            },
          },
        },
      });
      if (filtered <= 5) {
        console.log(`  SKIP ${c.source_id} — ${(c.title || '').substring(0, 60)} [English]`);
      }
    }
  }

  if (!DRY_RUN && updates.length > 0) {
    await db.collection('import_candidates').bulkWrite(updates);
  }

  console.log(`  Filtered: ${filtered} English-language, ${skipped} already verified`);
  return { filtered, skipped };
}

// ── Tier 3: Gemini FT verification ──────────────────────────────────

async function runTier3(db, candidates) {
  console.log('\n═══ Tier 3: Gemini FT verification ═══');

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) { console.error('  GEMINI_API_KEY not set, skipping Tier 3'); return; }

  // Filter to unverified, non-English candidates
  const remaining = candidates.filter(c => {
    if (c.ft_status && !FORCE) return false;
    if ((c.language || '').toLowerCase() === 'english') return false;
    return true;
  });

  console.log(`  ${remaining.length} candidates need Gemini verification`);
  if (remaining.length === 0) return { verified: 0, errors: 0 };

  // Dynamic import of the TS verification function via tsx
  // We call the Gemini API directly instead to avoid tsx dependency in scripts
  const MODEL = 'gemini-3.1-flash-lite';
  const TEMPERATURE = 0.1;
  const MAX_ROUNDS = 10;

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Import tool declarations and logic from verify-first-translation
  // We replicate the essential flow here to avoid TS import complexity

  const TOOL_DECLARATIONS = [
    {
      name: 'search_local_catalogs',
      description: 'Search local translation catalogs (UNESCO, Loeb, Brill, Penguin, etc.) for known English translations. ALWAYS call first.',
      parameters: {
        type: 'OBJECT',
        properties: {
          author_query: { type: 'STRING', description: 'Author surname' },
          title_query: { type: 'STRING', description: 'Optional title keywords' },
        },
        required: ['author_query'],
      },
    },
    {
      name: 'search_open_library',
      description: 'Search Open Library for English editions.',
      parameters: {
        type: 'OBJECT',
        properties: { query: { type: 'STRING', description: 'Search query' } },
        required: ['query'],
      },
    },
    {
      name: 'search_google_books',
      description: 'Search Google Books for English editions.',
      parameters: {
        type: 'OBJECT',
        properties: { query: { type: 'STRING', description: 'Search query' } },
        required: ['query'],
      },
    },
    {
      name: 'search_internet_archive',
      description: 'Search Internet Archive for digitized English translations.',
      parameters: {
        type: 'OBJECT',
        properties: { query: { type: 'STRING', description: 'Search query' } },
        required: ['query'],
      },
    },
    {
      name: 'search_openalex',
      description: 'Search OpenAlex (250M+ scholarly works) for academic translations.',
      parameters: {
        type: 'OBJECT',
        properties: { query: { type: 'STRING', description: 'Search query' } },
        required: ['query'],
      },
    },
    {
      name: 'search_loc',
      description: 'Search Library of Congress catalog.',
      parameters: {
        type: 'OBJECT',
        properties: { query: { type: 'STRING', description: 'Search query' } },
        required: ['query'],
      },
    },
    {
      name: 'make_determination',
      description: 'Make final determination about first-translation status.',
      parameters: {
        type: 'OBJECT',
        properties: {
          disposition: {
            type: 'STRING',
            description: 'confirmed_first | first_from_source | first_complete_translation | first_modern_translation | translation_found | needs_review',
          },
          confidence: { type: 'STRING', description: 'high | medium | low' },
          reasoning: { type: 'STRING', description: 'Explanation of determination' },
          translations_found: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                english_title: { type: 'STRING' },
                translator: { type: 'STRING' },
                pub_year: { type: 'STRING' },
                publisher: { type: 'STRING' },
                completeness: { type: 'STRING' },
                evidence_source: { type: 'STRING' },
                url: { type: 'STRING' },
              },
            },
            description: 'Translations found in search results (ONLY from tool results)',
          },
        },
        required: ['disposition', 'confidence', 'reasoning', 'translations_found'],
      },
    },
  ];

  // ── Tool implementations ──────────────────────────────────────────

  async function searchLocalCatalogs(authorQuery, titleQuery) {
    const surname = authorQuery.toLowerCase().trim();
    const query = {
      $or: [
        { author_surname: { $regex: surname, $options: 'i' } },
        { canonical_author_normalized: { $regex: surname, $options: 'i' } },
        { author_normalized: { $regex: surname, $options: 'i' } },
      ],
    };
    let results = await db.collection('translation_catalogs')
      .find(query)
      .project({ source: 1, author: 1, english_title: 1, original_title: 1, canonical_author: 1, canonical_work: 1, translator: 1, pub_year: 1, publisher: 1, completeness: 1 })
      .limit(30)
      .toArray();

    if (titleQuery && results.length > 0) {
      const titleWords = titleQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (titleWords.length > 0) {
        const filtered = results.filter(r => {
          const allText = [r.english_title, r.original_title, r.canonical_work].filter(Boolean).join(' ').toLowerCase();
          return titleWords.some(w => allText.includes(w));
        });
        if (filtered.length > 0) results = filtered;
      }
    }

    return {
      match_count: results.length,
      records: results.slice(0, 15).map(r => ({
        source: r.source, author: r.canonical_author || r.author,
        english_title: r.english_title, original_title: r.original_title || r.canonical_work,
        translator: r.translator, pub_year: r.pub_year, publisher: r.publisher, completeness: r.completeness,
      })),
    };
  }

  async function searchOpenLibrary(query) {
    try {
      const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&language=eng&limit=10`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { error: `HTTP ${res.status}`, results: [] };
      const data = await res.json();
      return {
        total: data.numFound || 0,
        results: (data.docs || []).slice(0, 10).map(d => ({
          title: d.title, author: d.author_name?.[0], publisher: d.publisher?.[0],
          year: d.first_publish_year, editions: d.edition_count, language: d.language,
        })),
      };
    } catch (e) { return { error: e.message, results: [] }; }
  }

  async function searchGoogleBooks(query) {
    try {
      const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&langRestrict=en&maxResults=10`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { error: `HTTP ${res.status}`, results: [] };
      const data = await res.json();
      return {
        total: data.totalItems || 0,
        results: (data.items || []).slice(0, 10).map(item => {
          const v = item.volumeInfo || {};
          return { title: v.title, subtitle: v.subtitle, authors: v.authors, publisher: v.publisher, year: v.publishedDate, description: v.description?.substring(0, 200) };
        }),
      };
    } catch (e) { return { error: e.message, results: [] }; }
  }

  async function searchInternetArchive(query) {
    try {
      const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query + ' language:eng')}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=publisher&fl[]=language&rows=10&output=json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { error: `HTTP ${res.status}`, results: [] };
      const data = await res.json();
      return {
        total: data.response?.numFound || 0,
        results: (data.response?.docs || []).map(d => ({
          identifier: d.identifier, title: d.title, creator: d.creator, date: d.date, publisher: d.publisher,
          url: `https://archive.org/details/${d.identifier}`,
        })),
      };
    } catch (e) { return { error: e.message, results: [] }; }
  }

  async function searchOpenAlex(query) {
    try {
      const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&filter=language:en&per_page=10&mailto=derek@sourcelibrary.org`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { error: `HTTP ${res.status}`, results: [] };
      const data = await res.json();
      return {
        total: data.meta?.count || 0,
        results: (data.results || []).slice(0, 10).map(w => ({
          title: w.title, year: w.publication_year,
          authors: (w.authorships || []).slice(0, 3).map(a => a.author?.display_name),
          source: w.primary_location?.source?.display_name,
          doi: w.doi,
        })),
      };
    } catch (e) { return { error: e.message, results: [] }; }
  }

  async function searchLoc(query) {
    try {
      const url = `https://www.loc.gov/search/?q=${encodeURIComponent(query)}&fa=language:english&fo=json&c=10`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { error: `HTTP ${res.status}`, results: [] };
      const data = await res.json();
      return {
        total: data.pagination?.total || 0,
        results: (data.results || []).slice(0, 10).map(r => ({
          title: r.title, authors: r.contributor, date: r.date, publisher: r.publisher,
          url: r.url, subjects: r.subject?.slice(0, 5),
        })),
      };
    } catch (e) { return { error: e.message, results: [] }; }
  }

  async function executeTool(name, toolArgs) {
    switch (name) {
      case 'search_local_catalogs':
        return searchLocalCatalogs(toolArgs.author_query, toolArgs.title_query);
      case 'search_open_library':
        return searchOpenLibrary(toolArgs.query);
      case 'search_google_books':
        return searchGoogleBooks(toolArgs.query);
      case 'search_internet_archive':
        return searchInternetArchive(toolArgs.query);
      case 'search_openalex':
        return searchOpenAlex(toolArgs.query);
      case 'search_loc':
        return searchLoc(toolArgs.query);
      case 'make_determination':
        return toolArgs;
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  // ── Verify a single candidate ─────────────────────────────────────

  async function verifyOne(candidate) {
    const lang = candidate.language || 'Latin';
    const author = candidate.author || 'Unknown';
    const title = candidate.title || 'Unknown';
    const year = candidate.date_earliest || 'Unknown';

    const prompt = `You are verifying whether this book is a first English translation. Search catalogs for any existing English translations of this specific work, then make a determination.

## Book to Verify

- **Title:** ${title}
- **Author:** ${author}
- **Original Language:** ${lang}
- **Published:** ${year}
- **Catalog IDs:** ISTC ${candidate.source_id}${candidate.catalog_ids?.gw ? ', GW ' + candidate.catalog_ids.gw : ''}

## Instructions

Search these catalogs strategically:

### Phase 1: Core (ALWAYS do these)
1. **search_local_catalogs** — ALWAYS first. Searches 12+ scholarly catalogs. Free and instant.
2. **search_open_library** — For modern academic translations with ISBNs.
3. **search_google_books** — For academic press publications.

### Phase 2: Deep (use when Phase 1 inconclusive)
4. **search_internet_archive** — Digitized older/public domain translations.
5. **search_openalex** — 250M+ scholarly works.
6. **search_loc** — Library of Congress catalog.

After gathering evidence, call make_determination.

## CRITICAL: Evidence Must Come From Tool Results

translations_found must ONLY contain translations from your search results. Do NOT add translations from your own knowledge.

## CRITICAL: Source Text Matters

We are verifying whether THIS SPECIFIC TEXT (in ${lang}) has been translated to English. Many books are Latin translations of Greek works — if the Greek has been translated directly to English, that does NOT count as a translation of the Latin text.

## Determination Guidelines

- **confirmed_first**: No English translation of any kind exists for this specific ${lang} text.
- **first_from_source**: Translations exist from a DIFFERENT source language, but not from THIS ${lang} text.
- **first_complete_translation**: Only partial translations/excerpts exist. No complete translation published.
- **first_modern_translation**: Only old/antiquated translations exist (pre-1900). No modern scholarly translation.
- **translation_found**: A complete, modern English translation of THIS SPECIFIC ${lang} text exists.
- **needs_review**: Evidence is conflicting or inconclusive.`;

    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const toolsCalled = [];
    let totalInput = 0, totalOutput = 0;
    let determination = null;

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
      totalInput += (usage.promptTokenCount || 0);
      totalOutput += (usage.candidatesTokenCount || 0);

      const cand = response.candidates?.[0];
      if (!cand?.content?.parts) break;

      contents.push({ role: 'model', parts: cand.content.parts });

      const functionCalls = cand.content.parts.filter(p => p.functionCall);
      if (functionCalls.length === 0) break;

      const responseParts = [];
      for (const part of functionCalls) {
        const fc = part.functionCall;
        toolsCalled.push(fc.name);
        const result = await executeTool(fc.name, fc.args || {});
        if (fc.name === 'make_determination') determination = result;
        responseParts.push({ functionResponse: { name: fc.name, response: result } });
      }

      contents.push({ role: 'user', parts: responseParts });
      if (determination) break;

      if (round >= 4) {
        contents.push({
          role: 'user',
          parts: [{ text: 'You have done enough searching. Now call make_determination with your verdict.' }],
        });
      }
    }

    if (!determination) return { success: false, error: 'No determination' };

    const inputCost = (totalInput / 1_000_000) * 0.50;
    const outputCost = (totalOutput / 1_000_000) * 3.00;

    return {
      success: true,
      disposition: determination.disposition,
      confidence: determination.confidence,
      reasoning: determination.reasoning,
      translations_found: determination.translations_found || [],
      tools_called: toolsCalled,
      cost_usd: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000,
      tokens: { input: totalInput, output: totalOutput },
    };
  }

  // ── Run Tier 3 ────────────────────────────────────────────────────

  let verified = 0, errors = 0, totalCost = 0;
  const dispositions = {};

  // Simple sequential with delay (concurrency could be added later)
  for (const c of remaining) {
    if (verified + errors >= LIMIT) break;

    try {
      const result = await verifyOne(c);

      if (!result.success) {
        errors++;
        if (errors <= 5) console.log(`  ERR ${c.source_id} — ${result.error}`);
        continue;
      }

      // Normalize disposition — model sometimes returns malformed values
      let disposition = (result.disposition || 'needs_review').split(/[,;\s]/)[0].trim();
      if (disposition === 'first_translation') disposition = 'confirmed_first';
      if (disposition === 'first_full_translation') disposition = 'first_complete_translation';
      if (disposition === 'translation_exists') disposition = 'translation_found';
      const VALID = ['confirmed_first', 'first_from_source', 'first_complete_translation', 'first_modern_translation', 'translation_found', 'needs_review'];
      if (!VALID.includes(disposition)) disposition = 'needs_review';
      dispositions[disposition] = (dispositions[disposition] || 0) + 1;

      const isFirst = ['confirmed_first', 'first_from_source', 'first_complete_translation', 'first_modern_translation'].includes(disposition);
      const ftStatus = isFirst ? 'first_translation' : (disposition === 'translation_found' ? 'has_translation' : 'needs_review');

      if (!DRY_RUN) {
        await db.collection('import_candidates').updateOne(
          { _id: c._id },
          {
            $set: {
              ft_status: ftStatus,
              ft_tier: 3,
              ft_classification: disposition,
              ft_details: {
                source: 'gemini_ft_verification',
                disposition,
                confidence: result.confidence,
                reasoning: result.reasoning,
                translations_found: result.translations_found,
                tools_called: result.tools_called,
                cost_usd: result.cost_usd,
                model: MODEL,
                verified_at: new Date(),
              },
            },
          },
        );

        // Write-back: add discovered translations to translation_catalogs
        if (result.translations_found?.length > 0) {
          const newCatalogEntries = [];
          for (const t of result.translations_found) {
            if (!t.english_title) continue;
            // Check for existing entry to avoid dupes
            const existing = await db.collection('translation_catalogs').findOne({
              author_surname: c.author_surname || '',
              english_title_normalized: (t.english_title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(),
            });
            if (!existing) {
              newCatalogEntries.push({
                source: 'ft_verification_discovery',
                author: c.author,
                author_normalized: (c.author || '').toLowerCase(),
                author_surname: c.author_surname,
                english_title: t.english_title,
                english_title_normalized: (t.english_title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(),
                translator: t.translator,
                pub_year: t.pub_year,
                pub_year_int: parseInt(t.pub_year) || null,
                publisher: t.publisher,
                completeness: t.completeness || 'unknown',
                evidence_source: t.evidence_source,
                evidence_url: t.url,
                discovered_from_istc: c.source_id,
                imported_at: new Date(),
              });
            }
          }
          if (newCatalogEntries.length > 0) {
            await db.collection('translation_catalogs').insertMany(newCatalogEntries);
          }
        }
      }

      verified++;
      totalCost += result.cost_usd || 0;

      if (verified <= 20 || verified % 50 === 0) {
        const symbol = isFirst ? '★' : '·';
        console.log(`  ${symbol} [${verified}] ${c.source_id} — ${disposition} — ${(c.author || '').substring(0, 20)}: ${(c.title || '').substring(0, 40)}`);
      }

      // Polite delay
      if (DELAY_MS > 0) await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (e) {
      errors++;
      if (errors <= 5) console.log(`  ERR ${c.source_id} — ${e.message}`);
      await new Promise(r => setTimeout(r, 3000)); // longer delay after error
    }
  }

  console.log(`\n  Tier 3 results: ${verified} verified, ${errors} errors, $${totalCost.toFixed(2)} cost`);
  console.log('  Dispositions:', JSON.stringify(dispositions));
  return { verified, errors, totalCost, dispositions };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('ISTC First-Translation Verification');
  console.log('═══════════════════════════════════════════════');
  console.log(`Dry run: ${DRY_RUN}, Tier: ${TIER}, Limit: ${LIMIT === Infinity ? 'none' : LIMIT}, Concurrency: ${CONCURRENCY}`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Load candidates
  const query = { source: 'istc', in_scope: true };
  if (HAS_DIGITAL) query.has_digital = true;
  if (!FORCE) {
    // For tier-specific runs, only skip if already done by that tier or higher
    // For 'all', skip nothing extra — each tier checks internally
  }

  const candidates = await db.collection('import_candidates')
    .find(query)
    .sort({ source_id: 1 })
    .toArray();

  console.log(`\nLoaded ${candidates.length} in-scope ISTC candidates`);

  // Language breakdown
  const langCounts = {};
  for (const c of candidates) {
    const lang = c.language || 'Unknown';
    langCounts[lang] = (langCounts[lang] || 0) + 1;
  }
  const sortedLangs = Object.entries(langCounts).sort((a, b) => b[1] - a[1]);
  console.log('Languages:', sortedLangs.map(([l, n]) => `${l}: ${n}`).join(', '));

  // Already-verified breakdown
  const ftCounts = {};
  for (const c of candidates) {
    const status = c.ft_status || 'unverified';
    ftCounts[status] = (ftCounts[status] || 0) + 1;
  }
  console.log('FT status:', JSON.stringify(ftCounts));

  // Run tiers
  if (TIER === 'all' || TIER === '1') await runTier1(db, candidates);
  if (TIER === 'all' || TIER === '2') await runTier2(db, candidates);
  if (TIER === 'all' || TIER === '3') await runTier3(db, candidates);

  // Final summary
  const finalCounts = {};
  const finalCandidates = await db.collection('import_candidates')
    .find({ source: 'istc', in_scope: true })
    .project({ ft_status: 1 })
    .toArray();
  for (const c of finalCandidates) {
    const status = c.ft_status || 'unverified';
    finalCounts[status] = (finalCounts[status] || 0) + 1;
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('FINAL SUMMARY');
  console.log('═══════════════════════════════════════════════');
  for (const [status, count] of Object.entries(finalCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
