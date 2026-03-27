/**
 * AI-powered book metadata enrichment using OCR text.
 *
 * Shared module used by:
 * - post-import-pipeline cron (auto pipeline)
 * - scripts/enrich-metadata-text.mjs (manual batch)
 *
 * Reads the first N pages of OCR text, calls Gemini to classify language,
 * categories, year, description, etc. Only applies changes at medium+ confidence.
 */

import { Db } from 'mongodb';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { logGeminiCall } from './gemini-logger';
import { logAuditEvent } from './audit-logger';
import { logMetadataChange } from './book-changelog';
import { generateUniqueBookSlug } from './slugify';

const MODEL = 'gemini-3-flash-preview';
const MAX_OCR_PAGES = 25;
const MAX_TEXT_PER_PAGE = 2000;

const CATEGORIES = [
  // Core esoteric traditions
  'alchemy', 'hermeticism', 'jewish-kabbalah', 'christian-cabala', 'neoplatonism',
  'rosicrucianism', 'freemasonry', 'natural-philosophy', 'astrology', 'natural-magic',
  'ritual-magic', 'theurgy', 'mysticism', 'theology', 'medicine', 'gnosticism',
  'theosophy', 'pythagoreanism', 'divination', 'ars-notoria', 'paracelsian',
  'spiritual-alchemy', 'christian-mysticism', 'prisca-theologia', 'florentine-platonism',
  // General knowledge
  'astronomy', 'mathematics', 'botany', 'chemistry', 'geography', 'history',
  'law', 'literature', 'linguistics', 'music', 'architecture', 'art',
  'military', 'politics', 'philosophy',
  // Non-Western traditions
  'sufism', 'vedanta', 'buddhism', 'daoism', 'biblical-studies',
];

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

interface SourceWorkDateLayer {
  type: 'composition' | 'translation' | 'compilation' | 'commentary' | 'redaction' | 'edition' | 'abridgement' | 'adaptation';
  date: string;
  date_display: string;
  date_precision: 'exact' | 'decade' | 'century' | 'millennium';
  author?: string;
  work_title?: string;
  language?: string;
  notes?: string;
}

interface EnrichmentResult {
  language?: string;
  secondary_languages?: string[];
  script?: string;
  categories?: string[];
  estimated_year?: number | string;
  estimated_century?: string;
  description?: string;
  display_title?: string | null;
  confidence?: 'high' | 'medium' | 'low';
  author?: string | null;
  first_translation?: {
    status: string;
    reasoning?: string;
    known_translations?: string[];
    confidence?: string;
  };
  subject_keywords?: string[];
  source_work_dates?: {
    layers: SourceWorkDateLayer[];
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
  };
}

interface EnrichmentOutcome {
  success: boolean;
  changes: Array<{ field: string; previous: unknown; new_value: unknown }>;
  enrichment: Record<string, unknown>;
  error?: string;
}

function buildPrompt(
  book: Record<string, unknown>,
  ocrSamples: Array<{ pageNumber: number; text: string }>,
): string {
  const ocrSection = ocrSamples.length > 0
    ? `\n\nHere is the OCR text from ${ocrSamples.length} pages of this book:\n\n` +
      ocrSamples.map(s => `--- Page ${s.pageNumber} ---\n${s.text}`).join('\n\n')
    : '\n\n(No OCR text available — classify based on metadata only.)';

  return `You are a rare books librarian and translation scholar examining transcribed text from a historical book.

Book metadata:
- Title: "${(book.display_title as string) || (book.title as string) || 'Unknown'}"
- Author: ${(book.author as string) || 'Unknown'}
- Current language field: ${(book.language as string) || 'Unknown'}
- Published: ${(book.published as string) || 'Unknown'}
- Year: ${book.year || 'Unknown'}
${ocrSection}

Based on this text and metadata, classify the book. Respond with JSON only — no markdown fences, no explanation.

{
  "language": "<primary language of the text, e.g. Latin, German, French, English, Chinese, Greek, Arabic, Hebrew, Italian, Dutch, Spanish, Sanskrit, Syriac, Armenian, Persian, Turkish, Japanese, Korean, etc.>",
  "author": "<detected author name from title page or text. Return the most complete form of the name. null if not identifiable>",
  "secondary_languages": ["<any other languages present>"],
  "script": "<writing system: Latin alphabet, Fraktur, Greek, Chinese characters, Hebrew, Arabic, Devanagari, etc.>",
  "categories": ["<1-4 subject tags from EXACTLY this list: ${CATEGORIES.join(', ')}>"],
  "estimated_year": "<best estimate of publication year as a number, e.g. 1617. null if truly impossible to determine>",
  "estimated_century": "<e.g. '17th century' or '15th-16th century' — fallback if exact year unclear>",
  "description": "<1-2 sentence scholarly description of what this book is about. No em-dashes. No filler like 'delves into', 'rich tapestry', 'fascinating exploration', 'comprehensive', 'intricate', 'nuanced'. Short, direct sentences.>",
  "display_title": "<A clear, natural English title for this book. Must be ENTIRELY in English — no foreign words. See display_title rules below.>",
  "confidence": "<high, medium, or low — how confident are you in this classification>",
  "subject_keywords": ["<3-5 subject keywords for discovery>"],
  "first_translation": {
    "status": "<one of: confirmed_first, likely_first, uncertain, has_partial, has_translation, not_applicable>",
    "reasoning": "<1-2 sentences>",
    "known_translations": ["<any known English translations>"],
    "confidence": "<high, medium, or low>"
  },
  "source_work_dates": {
    "layers": [
      {
        "type": "<composition|translation|compilation|commentary|redaction|edition|abridgement>",
        "date": "<year as string, negative for BCE, e.g. '-360', '300', '1484'>",
        "date_display": "<human readable, e.g. 'c. 360 BCE', '1484', '13th century'>",
        "date_precision": "<exact|decade|century|millennium>",
        "author": "<person responsible for this layer>",
        "work_title": "<title of the work at this layer, if different>",
        "language": "<language of the text at this layer>",
        "notes": "<brief note on dating basis>"
      }
    ],
    "confidence": "<high|medium|low>",
    "reasoning": "<1-2 sentences about the compositional history>"
  }
}

Rules:
- For language, identify the LANGUAGE OF THE TEXT, not the language of any modern library annotation
- If there are multiple languages (e.g. parallel Latin/Greek), list the primary one and put others in secondary_languages
- For categories, pick 1-4 using ONLY the exact slugs from the list above. Prefer specific esoteric tags over generic ones.
- Most pre-1800 Latin, German, and other non-English texts on alchemy, Hermeticism, Kabbalah, astrology, and natural philosophy were NEVER translated to English.
- If the book IS already in English, set first_translation status to "not_applicable"
- For author, look for author attributions on the title page (first 1-3 pages). Common patterns: "by [Name]", authorship in Latin ("auctore [Name]", "[Name] scripsit"). Return null if truly uncertain.
- For display_title, provide a clear English title. It must be ENTIRELY in English — no Latin, German, French, Arabic, Sanskrit, or any other foreign words. Rules:
  - Use conventional English names when they exist (e.g. "The Chemical Wedding" not "Chymische Hochzeit", "Discourse on the Method" not "Discours de la méthode")
  - If no conventional English name exists, translate the title literally into English
  - Do NOT include manuscript shelfmarks or catalog identifiers (no "MS. Bodl. 130", "Reg.lat.1278", "Harley MS 3667")
  - Do NOT include library names (no "Bodleian Library...", "Vatican Library...")
  - Do NOT include edition dates, publishers, or printing info (no "1645 Elzevier", "Basel edition")
  - Do NOT include the original-language title in parentheses (no "Origin of Medicine (Ortus Medicinae)")
  - For Sanskrit/Arabic/Hebrew transliterated titles, translate the MEANING into English (e.g. "Yuddha Jayarnava" → "Ocean of Victory in Battle", "Bhasha Svarodaya" → "Discourse on the Rising of Sounds")
  - Simple Latin titles that are well-known in Latin may keep the Latin form ONLY if universally recognized (e.g. "De Rerum Natura" is acceptable, but "De Triplici Minimo" should be "On the Threefold Minimum")
  - For English books, return null
  - Keep it concise — translate the essential title, not the full baroque subtitle
- For source_work_dates: determine the chronological layers of this work's compositional history.
  - Return empty layers [] if the book IS the original work by its stated author (the published date already captures it)
  - Include a "composition" layer when this is a translation/edition of an older work (e.g. a 1550 printing of Plato = composition layer at c. 360 BCE)
  - Include a "translation" layer when a specific translator adapted the work (e.g. Ficino's 1484 Latin translation)
  - Do NOT include the printing/publication date as a layer
  - For pseudepigraphical works (attributed to Hermes, Solomon, etc.), use scholarly consensus dates
  - Use negative years for BCE (date: "-360", date_display: "c. 360 BCE")
  - Use "c." prefix in date_display for approximate dates`;
}

/**
 * Enrich a single book's metadata using AI analysis of its OCR text.
 *
 * Reads first 25 OCR pages, calls Gemini, applies changes at medium+ confidence.
 * Logs to gemini_usage and audit_log. Also surfaces AI description to top-level
 * `description` field when it's empty (#26 Task 2).
 */
export async function enrichBookMetadata(
  db: Db,
  bookId: string,
): Promise<EnrichmentOutcome> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { success: false, changes: [], enrichment: {}, error: 'No GEMINI_API_KEY configured' };
  }

  // Fetch book
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) {
    return { success: false, changes: [], enrichment: {}, error: 'Book not found' };
  }

  // Fetch first N OCR pages
  const pages = await db.collection('pages')
    .find(
      { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } },
      { projection: { page_number: 1, 'ocr.data': 1 } },
    )
    .sort({ page_number: 1 })
    .limit(MAX_OCR_PAGES)
    .toArray();

  if (pages.length < 5) {
    return { success: false, changes: [], enrichment: {}, error: `Only ${pages.length} OCR pages (need ≥5)` };
  }

  const ocrSamples = pages.map(p => ({
    pageNumber: p.page_number as number,
    text: ((p.ocr?.data as string) || '').substring(0, MAX_TEXT_PER_PAGE),
  }));

  // Call Gemini
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: MODEL,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  });

  const prompt = buildPrompt(book, ocrSamples);
  const startTime = Date.now();

  let parsed: EnrichmentResult;
  let usage = { input_tokens: 0, output_tokens: 0 };

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const candidates = response.candidates || [];
    const allParts = candidates[0]?.content?.parts || [];
    const fullText = allParts.map(p => p.text || '').join('');
    const text = fullText.trim() || response.text().trim();
    const usageMeta = response.usageMetadata;
    usage = {
      input_tokens: usageMeta?.promptTokenCount || 0,
      output_tokens: usageMeta?.candidatesTokenCount || 0,
    };

    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse JSON response');
      }
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    // Log the failed call
    await logGeminiCall({
      type: 'other',
      mode: 'realtime',
      model: MODEL,
      book_id: bookId,
      book_title: (book.display_title || book.title) as string,
      page_count: ocrSamples.length,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      status: 'failed',
      error_message: err instanceof Error ? err.message : 'unknown',
      duration_ms: durationMs,
      endpoint: 'metadata-enrichment',
    });
    return {
      success: false,
      changes: [],
      enrichment: {},
      error: err instanceof Error ? err.message : 'AI call failed',
    };
  }

  const durationMs = Date.now() - startTime;

  // Only apply changes at medium or high confidence
  const confidence = parsed.confidence || 'low';
  if (confidence === 'low') {
    // Still log the call and save ai_metadata, but don't change top-level fields
    await logGeminiCall({
      type: 'other',
      mode: 'realtime',
      model: MODEL,
      book_id: bookId,
      book_title: (book.display_title || book.title) as string,
      page_count: ocrSamples.length,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      status: 'success',
      duration_ms: durationMs,
      endpoint: 'metadata-enrichment',
    });

    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          ai_metadata: {
            ...parsed,
            model: MODEL,
            pages_checked: ocrSamples.length,
            enriched_at: new Date(),
            enrichment_method: 'text',
            changes: [],
          },
          updated_at: new Date(),
        },
      },
    );

    return { success: true, changes: [], enrichment: parsed as Record<string, unknown> };
  }

  // Build updates
  const now = new Date();
  const changes: Array<{ field: string; previous: unknown; new_value: unknown }> = [];
  const updates: Record<string, unknown> = { updated_at: now };

  // Language: auto-update if Unknown. If the AI disagrees with an existing value,
  // store the AI detection but don't auto-overwrite — many "mismatches" are intentional
  // (e.g. catalog says "Sanskrit" for a Sanskrit work held as an English translation).
  const currentLang = (book.language as string) || 'Unknown';
  const aiLang = parsed.language || '';

  if (aiLang && currentLang === 'Unknown') {
    updates.language = aiLang;
    updates.language_source = 'gemini_text';
    updates.language_confidence = confidence;
    changes.push({ field: 'language', previous: currentLang, new_value: aiLang });
  } else if (aiLang && aiLang.toLowerCase() !== currentLang.toLowerCase() && confidence === 'high') {
    // Don't overwrite, but record the discrepancy for review
    updates.language_source = 'gemini_text';
    updates.language_confidence = confidence;
    updates.ai_detected_language = aiLang;
  }

  // Author: auto-update if Unknown or missing
  const currentAuthor = (book.author as string) || 'Unknown';
  const aiAuthor = parsed.author || '';

  if (aiAuthor && (currentAuthor === 'Unknown' || !currentAuthor)) {
    updates.author = aiAuthor;
    changes.push({ field: 'author', previous: currentAuthor, new_value: aiAuthor });
  } else if (aiAuthor && aiAuthor.toLowerCase() !== currentAuthor.toLowerCase() && confidence === 'high') {
    updates.ai_detected_author = aiAuthor;
  }

  // Year: set if missing
  if (!book.year && parsed.estimated_year) {
    const year = parseInt(String(parsed.estimated_year));
    if (!isNaN(year) && year > 0 && year < 2100) {
      updates.year = year;
      changes.push({ field: 'year', previous: null, new_value: year });
      if (!book.published || book.published === 'Unknown') {
        updates.published = String(year);
        changes.push({ field: 'published', previous: book.published || null, new_value: String(year) });
      }
    }
  }

  // Categories: merge with existing
  if (parsed.categories && parsed.categories.length > 0) {
    const existing = (book.categories as string[]) || [];
    const merged = [...new Set([...existing, ...parsed.categories])];
    if (merged.length !== existing.length) {
      updates.categories = merged;
      changes.push({ field: 'categories', previous: existing, new_value: merged });
    }
  }

  // Description: set if missing (#26 Task 2 — surface AI descriptions)
  if (parsed.description && !book.description) {
    updates.description = parsed.description;
    changes.push({ field: 'description', previous: null, new_value: parsed.description });
  }

  // Display title: set if missing and book is non-English
  const currentDisplayTitle = (book.display_title as string) || '';
  const effectiveLang = (updates.language as string) || currentLang;
  if (parsed.display_title && !currentDisplayTitle && effectiveLang.toLowerCase() !== 'english') {
    updates.display_title = parsed.display_title;
    changes.push({ field: 'display_title', previous: null, new_value: parsed.display_title });
  }

  // Subject keywords: new field
  if (parsed.subject_keywords && parsed.subject_keywords.length > 0) {
    updates.subject_keywords = parsed.subject_keywords;
    changes.push({ field: 'subject_keywords', previous: null, new_value: parsed.subject_keywords });
  }

  // First translation: derive top-level boolean
  if (parsed.first_translation?.status) {
    const isFirst = ['confirmed_first', 'likely_first'].includes(parsed.first_translation.status);
    updates.is_first_translation = isFirst;
    changes.push({ field: 'is_first_translation', previous: book.is_first_translation ?? null, new_value: isFirst });
  }

  // Source work dates: save compositional timeline
  if (parsed.source_work_dates && Array.isArray(parsed.source_work_dates.layers)) {
    const validTypes = ['composition', 'translation', 'compilation', 'commentary', 'redaction', 'edition', 'abridgement', 'adaptation'];
    const validPrecisions = ['exact', 'decade', 'century', 'millennium'];

    // Validate and clean layers
    const validLayers = parsed.source_work_dates.layers.filter(layer => {
      if (!layer.type || !layer.date || !layer.date_display || !layer.date_precision) return false;
      // Fix pipe-separated types from model
      if (layer.type.includes('|')) layer.type = layer.type.split('|')[0].trim() as SourceWorkDateLayer['type'];
      return validTypes.includes(layer.type) && validPrecisions.includes(layer.date_precision);
    });

    // Only write if book doesn't already have source_work_dates
    if (!book.source_work_dates) {
      updates.source_work_dates = validLayers;
      updates.source_work_dates_meta = {
        enriched_at: now,
        model: MODEL,
        confidence: parsed.source_work_dates.confidence || 'medium',
        source: 'ai_enrichment',
        reasoning: parsed.source_work_dates.reasoning || '',
      };
      changes.push({
        field: 'source_work_dates',
        previous: null,
        new_value: validLayers,
      });
    }
  }

  // Save ai_metadata
  const enrichment = {
    ...parsed,
    model: MODEL,
    pages_checked: ocrSamples.length,
    enriched_at: new Date(),
    enrichment_method: 'text',
    changes,
  };
  updates.ai_metadata = enrichment;

  // Field provenance
  const aiSource = {
    source: 'ai_enrichment',
    model: MODEL,
    date: now,
    confidence,
    pages_checked: ocrSamples.length,
  };
  const provenance = (book.field_provenance as Record<string, unknown>) || {};
  if (parsed.language) {
    if (updates.language) {
      provenance.language = { ...aiSource, previous_value: book.language };
    } else if (!provenance.language) {
      provenance.language = {
        source: 'import',
        note: `AI confirmed as "${parsed.language}" (${confidence})`,
        ai_confirmed_at: now,
      };
    }
  }
  if (updates.author) provenance.author = { ...aiSource, previous_value: currentAuthor };
  if (updates.is_first_translation !== undefined) provenance.is_first_translation = aiSource;
  if (updates.year) provenance.year = { ...aiSource, previous_value: null };
  if (updates.published) provenance.published = { ...aiSource, previous_value: book.published || null };
  if (updates.categories) provenance.categories = { ...aiSource, previous_value: book.categories || [] };
  if (updates.display_title) provenance.display_title = aiSource;
  if (updates.description) provenance.description = aiSource;
  if (updates.subject_keywords) provenance.subject_keywords = aiSource;
  updates.field_provenance = provenance;

  // Write to DB
  await db.collection('books').updateOne({ id: bookId }, { $set: updates });

  // Regenerate slug if display_title was just set and current slug is bad
  if (updates.display_title) {
    const currentSlug = (book.slug as string) || '';
    if (!currentSlug || currentSlug === 'undefined' || currentSlug.startsWith('untitled')) {
      const newSlug = await generateUniqueBookSlug(
        db, book.title as string, (updates.author || book.author) as string, updates.display_title as string
      );
      if (newSlug !== currentSlug) {
        await db.collection('books').updateOne({ id: bookId }, { $set: { slug: newSlug } });
        changes.push({ field: 'slug', previous: currentSlug, new_value: newSlug });
      }
    }
  }

  // Log to gemini_usage
  await logGeminiCall({
    type: 'other',
    mode: 'realtime',
    model: MODEL,
    book_id: bookId,
    book_title: (book.display_title || book.title) as string,
    page_count: ocrSamples.length,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    status: 'success',
    duration_ms: durationMs,
    endpoint: 'metadata-enrichment',
  });

  // Log to audit_log if changes were made
  if (changes.length > 0) {
    await logAuditEvent({
      action: 'book_metadata_updated',
      book_id: bookId,
      book_title: (book.display_title || book.title) as string,
      metadata: {
        source: 'ai_enrichment',
        model: MODEL,
        confidence,
        changes,
      },
    });

    // Append-only changelog
    logMetadataChange(db, {
      book_id: bookId,
      source: 'ai_enrichment',
      model: MODEL,
      changes,
      note: `Confidence: ${confidence}, ${ocrSamples.length} pages analyzed`,
    });
  }

  return {
    success: true,
    changes,
    enrichment: enrichment as Record<string, unknown>,
  };
}

/**
 * Surface existing AI descriptions to the top-level description field.
 * For books that already have ai_metadata.description but empty top-level description.
 * Returns the number of books updated.
 */
export async function backfillAiDescriptions(
  db: Db,
  options: { limit?: number; dryRun?: boolean } = {},
): Promise<{ updated: number; candidates: number }> {
  const { limit = 500, dryRun = true } = options;

  const candidates = await db.collection('books')
    .find({
      'ai_metadata.description': { $exists: true, $ne: '' },
      $or: [
        { description: { $exists: false } },
        { description: '' },
        { description: null },
      ],
    })
    .project({ id: 1, 'ai_metadata.description': 1 })
    .limit(limit)
    .toArray();

  if (dryRun) {
    return { updated: 0, candidates: candidates.length };
  }

  let updated = 0;
  for (const book of candidates) {
    const desc = book.ai_metadata?.description;
    if (desc) {
      await db.collection('books').updateOne(
        { id: book.id },
        {
          $set: {
            description: desc,
            'field_provenance.description': {
              source: 'ai_enrichment',
              note: 'Surfaced from ai_metadata.description',
              date: new Date(),
            },
            updated_at: new Date(),
          },
        },
      );
      updated++;
    }
  }

  return { updated, candidates: candidates.length };
}
