import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logGeminiCall } from '@/lib/gemini-logger';
import { withAuth } from '@/lib/auth-helpers';
import { loadAliasResolver } from '@/lib/entity-aliases';
import { getChapterTexts, type ChapterText } from '@/lib/chapter-text';

export const maxDuration = 300;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Research a book/author using Wikipedia API and web search
async function researchBook(title: string, author: string): Promise<string> {
  const searchResults: string[] = [];

  // Search Wikipedia for the author
  try {
    const authorQuery = encodeURIComponent(author);
    const authorRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${authorQuery}`,
      { headers: { 'User-Agent': 'SourceLibrary/1.0' } }
    );
    if (authorRes.ok) {
      const data = await authorRes.json();
      if (data.extract && data.extract.length > 50) {
        searchResults.push(`About the author (${author}):\n${data.extract}`);
      }
    }
  } catch (e) {
    console.log('Wikipedia author search failed:', e);
  }

  // Search Wikipedia for the book title
  try {
    const titleQuery = encodeURIComponent(title.replace(/[^\w\s]/g, ''));
    const titleRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${titleQuery}`,
      { headers: { 'User-Agent': 'SourceLibrary/1.0' } }
    );
    if (titleRes.ok) {
      const data = await titleRes.json();
      if (data.extract && data.extract.length > 50) {
        searchResults.push(`About "${title}":\n${data.extract}`);
      }
    }
  } catch (e) {
    console.log('Wikipedia title search failed:', e);
  }

  // Skip Gemini research - too prone to hallucination
  // Only use Wikipedia results which are more reliable

  return searchResults.join('\n\n');
}

interface PageData {
  id: string;
  page_number: number;
  page_type?: string;
  ocr?: { data: string };
  translation?: { data: string };
  summary?: { data: string };
}

// Batch extraction result
interface BatchExtraction {
  pageRange: { start: number; end: number };
  themes: string[];
  quotes: Array<{ text: string; page: number; context?: string }>;
  people: string[];
  places: string[];
  concepts: string[];
  summary: string;
}

const TARGET_BATCH_CHARS = 50000; // ~12k tokens, leaves room for prompt

// Process a batch of pages to extract structured information
async function processBatch(
  pages: PageData[],
  bookTitle: string,
  bookAuthor: string,
  bookLanguage?: string
): Promise<BatchExtraction> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.1-flash-lite-preview',
    generationConfig: {
      temperature: 0.2, // Low temperature for consistent extraction
      maxOutputTokens: 2000,
    }
  });

  const pageRange = {
    start: pages[0].page_number,
    end: pages[pages.length - 1].page_number
  };

  // Combine translation text from all pages in batch
  const batchContent = pages
    .filter(p => p.translation?.data)
    .map(p => {
      // Clean the translation text of metadata tags
      const cleanText = (p.translation?.data || '')
        .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/gi, '')
        .replace(/\[\[[^\]]+\]\]/g, '')
        .replace(/^```(?:markdown)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();
      return `[Page ${p.page_number}]\n${cleanText}`;
    })
    .join('\n\n---\n\n');

  if (!batchContent.trim()) {
    return {
      pageRange,
      themes: [],
      quotes: [],
      people: [],
      places: [],
      concepts: [],
      summary: ''
    };
  }

  const prompt = `You are analyzing pages ${pageRange.start}-${pageRange.end} of "${bookTitle}" by ${bookAuthor}${bookLanguage ? ` (translated from ${bookLanguage})` : ''}.

## Pages to analyze:
${batchContent}

## Task
Extract structured information from these pages.

Output as JSON:
{
  "themes": ["Main theme 1", "Main theme 2"],
  "quotes": [
    {"text": "Copy the EXACT words from the text - a striking, memorable, or important sentence or passage", "page": 5, "context": "Brief note on why this quote matters"},
    {"text": "Another VERBATIM quote copied directly from the pages above", "page": 7, "context": "Its significance"}
  ],
  "people": ["Person Name 1", "Person Name 2"],
  "places": ["Place Name 1", "Place Name 2"],
  "concepts": ["Key concept 1", "Technical term 2"],
  "summary": "2-3 sentence summary of what these pages cover and their key arguments. No em-dashes. No filler like 'delves into' or 'rich tapestry'. Short, direct sentences."
}

CRITICAL for quotes:
- Copy EXACT text from the pages - do not paraphrase or summarize
- Find memorable, striking, or important passages readers would want to highlight
- Look for: bold claims, definitions, vivid descriptions, key arguments
- Include the page number where each quote appears
- 3-5 quotes per batch`;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Log the Gemini call
    const usageMetadata = result.response.usageMetadata;
    logGeminiCall({
      type: 'index',
      mode: 'realtime',
      model: 'gemini-3.1-flash-lite-preview',
      page_count: pages.length,
      input_tokens: usageMetadata?.promptTokenCount || 0,
      output_tokens: usageMetadata?.candidatesTokenCount || 0,
      status: 'success',
      endpoint: '/api/books/[id]/index (processBatch)',
    }).catch(console.error); // Non-blocking

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Failed to parse batch extraction JSON');
      return {
        pageRange,
        themes: [],
        quotes: [],
        people: [],
        places: [],
        concepts: [],
        summary: ''
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      pageRange,
      themes: Array.isArray(parsed.themes) ? parsed.themes : [],
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
      people: Array.isArray(parsed.people) ? parsed.people : [],
      places: Array.isArray(parsed.places) ? parsed.places : [],
      concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary : ''
    };
  } catch (e) {
    console.error('Batch processing error:', e);
    return {
      pageRange,
      themes: [],
      quotes: [],
      people: [],
      places: [],
      concepts: [],
      summary: ''
    };
  }
}

// Group pages into batches based on character count
function createBatches(pages: PageData[]): PageData[][] {
  const translatedPages = pages.filter(p => p.translation?.data);
  if (translatedPages.length === 0) return [];

  const batches: PageData[][] = [];
  let currentBatch: PageData[] = [];
  let currentSize = 0;

  for (const page of translatedPages) {
    const pageSize = (page.translation?.data || '').length;

    // If adding this page would exceed target, start new batch
    // (unless current batch is empty - always include at least one page)
    if (currentSize + pageSize > TARGET_BATCH_CHARS && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }

    currentBatch.push(page);
    currentSize += pageSize;
  }

  // Don't forget the last batch
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

// Convert chapter_texts into PageData batches for processBatch()
function createBatchesFromChapters(
  chapterTexts: ChapterText[],
  pages: PageData[]
): PageData[][] {
  // Build page lookup
  const pageMap = new Map<number, PageData>();
  for (const p of pages) {
    pageMap.set(p.page_number, p);
  }

  const batches: PageData[][] = [];
  for (const ct of chapterTexts) {
    const batch: PageData[] = [];
    for (let pn = ct.pageStart; pn <= ct.pageEnd; pn++) {
      const page = pageMap.get(pn);
      if (page && page.translation?.data) {
        batch.push(page);
      }
    }
    if (batch.length > 0) {
      batches.push(batch);
    }
  }

  return batches;
}

// Process all pages in parallel batches (MapReduce approach)
async function processAllBatches(
  pages: PageData[],
  bookTitle: string,
  bookAuthor: string,
  bookLanguage?: string,
  chapterTexts?: ChapterText[]
): Promise<BatchExtraction[]> {
  // Use chapter-aligned batches when available, fall back to arbitrary char-count batches
  const pageBatches = chapterTexts && chapterTexts.length > 1
    ? createBatchesFromChapters(chapterTexts, pages)
    : createBatches(pages);
  if (pageBatches.length === 0) return [];

  const batchSource = chapterTexts && chapterTexts.length > 1 ? 'chapters' : 'char-count';
  console.log(`Processing ${pageBatches.length} batches (${batchSource}) in parallel...`);

  // Process all batches in parallel for speed
  const batchPromises = pageBatches.map((batchPages, i) => {
    const start = batchPages[0].page_number;
    const end = batchPages[batchPages.length - 1].page_number;
    console.log(`  Batch ${i + 1}: pages ${start}-${end} (${batchPages.length} pages)`);

    return processBatch(batchPages, bookTitle, bookAuthor, bookLanguage);
  });

  const results = await Promise.all(batchPromises);
  console.log(`All ${results.length} batches completed`);

  return results;
}

// Build concept index from batch extractions (new approach)
function buildConceptIndexFromBatches(
  batches: BatchExtraction[],
  pages: PageData[]
): {
  vocabulary: ConceptEntry[];
  keywords: ConceptEntry[];
  people: ConceptEntry[];
  places: ConceptEntry[];
  concepts: ConceptEntry[];
} {
  // Aggregate from batches
  const peopleMap = new Map<string, number[]>();
  const placesMap = new Map<string, number[]>();
  const conceptsMap = new Map<string, number[]>();

  for (const batch of batches) {
    const pageNumbers = Array.from(
      { length: batch.pageRange.end - batch.pageRange.start + 1 },
      (_, i) => batch.pageRange.start + i
    );

    for (const person of batch.people) {
      if (!peopleMap.has(person)) peopleMap.set(person, []);
      peopleMap.get(person)!.push(...pageNumbers);
    }

    for (const place of batch.places) {
      if (!placesMap.has(place)) placesMap.set(place, []);
      placesMap.get(place)!.push(...pageNumbers);
    }

    for (const concept of batch.concepts) {
      if (!conceptsMap.has(concept)) conceptsMap.set(concept, []);
      conceptsMap.get(concept)!.push(...pageNumbers);
    }
  }

  // Also extract vocabulary from OCR tags (existing approach)
  const vocabMap = new Map<string, number[]>();
  const keywordMap = new Map<string, number[]>();

  for (const page of pages) {
    const pageNum = page.page_number;

    if (page.ocr?.data) {
      const vocab = extractTerms(page.ocr.data, 'vocabulary');
      for (const term of vocab) {
        if (!vocabMap.has(term)) vocabMap.set(term, []);
        vocabMap.get(term)!.push(pageNum);
      }
    }

    if (page.translation?.data) {
      const keywords = extractTerms(page.translation.data, 'keywords');
      for (const term of keywords) {
        if (!keywordMap.has(term)) keywordMap.set(term, []);
        keywordMap.get(term)!.push(pageNum);
      }
    }
  }

  const mapToEntries = (map: Map<string, number[]>): ConceptEntry[] =>
    Array.from(map.entries())
      .map(([term, pgs]) => ({ term, pages: [...new Set(pgs)].sort((a, b) => a - b) }))
      .sort((a, b) => b.pages.length - a.pages.length);

  return {
    vocabulary: mapToEntries(vocabMap),
    keywords: mapToEntries(keywordMap),
    people: mapToEntries(peopleMap),
    places: mapToEntries(placesMap),
    concepts: mapToEntries(conceptsMap),
  };
}

interface ConceptEntry {
  term: string;
  pages: number[];
  context?: string; // Brief context from first occurrence
}

interface BookIndex {
  // Extracted from pages
  vocabulary: ConceptEntry[];     // Original language terms
  keywords: ConceptEntry[];       // English keywords
  people: ConceptEntry[];         // Named persons
  places: ConceptEntry[];         // Named places
  concepts: ConceptEntry[];       // Abstract concepts

  // Hierarchical summaries
  pageSummaries: { page: number; summary: string }[];
  sectionSummaries?: { title: string; startPage: number; endPage: number; summary: string }[];
  bookSummary: {
    brief: string;      // 1-2 sentences
    abstract: string;   // 1 paragraph
    detailed: string;   // Full with sections
  };

  // Metadata
  generatedAt: Date;
  pagesCovered: number;
  totalPages: number;
}

// Extract vocabulary/keywords from text - supports both [[tag:]] and <tag></tag> syntax
function extractTerms(text: string, tag: string): string[] {
  const terms: string[] = [];

  // XML syntax: <vocab>...</vocab> or <keywords>...</keywords>
  const xmlTag = tag === 'vocabulary' ? 'vocab' : tag;
  const xmlPattern = new RegExp(`<${xmlTag}>([\\s\\S]*?)</${xmlTag}>`, 'gi');
  let match;
  while ((match = xmlPattern.exec(text)) !== null) {
    const items = match[1].split(',').map(t => t.trim()).filter(Boolean);
    terms.push(...items);
  }

  // Legacy bracket syntax: [[vocabulary:...]] or [[keywords:...]]
  const bracketPattern = new RegExp(`\\[\\[${tag}:\\s*(.*?)\\]\\]`, 'gi');
  while ((match = bracketPattern.exec(text)) !== null) {
    const items = match[1].split(',').map(t => t.trim()).filter(Boolean);
    terms.push(...items);
  }

  return terms;
}

// Extract summary from text - supports both [[summary:]] and <summary></summary> syntax
function extractSummary(text: string): string | undefined {
  // Try XML syntax first
  const xmlMatch = text.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (xmlMatch) return xmlMatch[1].trim();

  // Fall back to bracket syntax
  const bracketMatch = text.match(/\[\[summary:\s*(.*?)\]\]/i);
  return bracketMatch ? bracketMatch[1].trim() : undefined;
}

// Categorize terms into people, places, concepts
function categorizeTerm(term: string): 'person' | 'place' | 'concept' {
  // Simple heuristics - could be enhanced with NER
  const personIndicators = ['of', 'von', 'de', 'da', 'the'];
  const lowerTerm = term.toLowerCase();

  // Capitalized multi-word names are often people
  if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(term)) {
    return 'person';
  }

  // Place indicators
  if (lowerTerm.includes('city') || lowerTerm.includes('kingdom') ||
      lowerTerm.includes('rome') || lowerTerm.includes('egypt')) {
    return 'place';
  }

  return 'concept';
}

// Build concept index from pages
function buildConceptIndex(pages: PageData[]): {
  vocabulary: ConceptEntry[];
  keywords: ConceptEntry[];
  people: ConceptEntry[];
  places: ConceptEntry[];
  concepts: ConceptEntry[];
} {
  const vocabMap = new Map<string, number[]>();
  const keywordMap = new Map<string, number[]>();
  const peopleMap = new Map<string, number[]>();
  const placesMap = new Map<string, number[]>();
  const conceptsMap = new Map<string, number[]>();

  for (const page of pages) {
    const pageNum = page.page_number;

    // Extract vocabulary from OCR
    if (page.ocr?.data) {
      const vocab = extractTerms(page.ocr.data, 'vocabulary');
      for (const term of vocab) {
        if (!vocabMap.has(term)) vocabMap.set(term, []);
        vocabMap.get(term)!.push(pageNum);
      }
    }

    // Extract keywords from translation
    if (page.translation?.data) {
      const keywords = extractTerms(page.translation.data, 'keywords');
      for (const term of keywords) {
        const category = categorizeTerm(term);
        const targetMap = category === 'person' ? peopleMap :
                          category === 'place' ? placesMap : conceptsMap;

        if (!keywordMap.has(term)) keywordMap.set(term, []);
        keywordMap.get(term)!.push(pageNum);

        if (!targetMap.has(term)) targetMap.set(term, []);
        targetMap.get(term)!.push(pageNum);
      }
    }
  }

  const mapToEntries = (map: Map<string, number[]>): ConceptEntry[] =>
    Array.from(map.entries())
      .map(([term, pages]) => ({ term, pages: [...new Set(pages)].sort((a, b) => a - b) }))
      .sort((a, b) => b.pages.length - a.pages.length); // Most frequent first

  return {
    vocabulary: mapToEntries(vocabMap),
    keywords: mapToEntries(keywordMap),
    people: mapToEntries(peopleMap),
    places: mapToEntries(placesMap),
    concepts: mapToEntries(conceptsMap),
  };
}

// Extract page summaries
function extractPageSummaries(pages: PageData[]): { page: number; summary: string }[] {
  const summaries: { page: number; summary: string }[] = [];

  for (const page of pages) {
    // Try [[summary:]] tag first, then dedicated summary field
    const text = page.translation?.data || '';
    let summary = extractSummary(text) || page.summary?.data;

    // If no explicit summary but we have translation text, use first paragraph
    if (!summary && text.length > 50) {
      // Strip metadata tags and get clean text
      let cleanText = text
        .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/gi, '') // Remove all <tag>...</tag> patterns
        .replace(/\[\[[^\]]+\]\]/g, '') // Remove all [[tag:...]] patterns
        .replace(/^```(?:markdown)?\s*\n?/i, '') // Remove code fences
        .replace(/\n?```\s*$/i, '')
        .trim();

      // Get first meaningful paragraph (skip very short lines)
      const paragraphs = cleanText.split(/\n\n+/).filter(p => p.trim().length > 30);
      if (paragraphs.length > 0) {
        // Take first paragraph, limit to ~300 chars
        summary = paragraphs[0].trim();
        if (summary.length > 300) {
          summary = summary.substring(0, 300).replace(/\s+\S*$/, '') + '...';
        }
      }
    }

    if (summary) {
      summaries.push({ page: page.page_number, summary });
    }
  }

  return summaries;
}

interface SectionSummary {
  title: string;
  startPage: number;
  endPage: number;
  summary: string;
  quotes?: Array<{
    text: string;
    page: number;
    page_id?: string;
    significance?: string;
  }>;
  concepts?: string[];
  source_chapter?: string;  // Original chapter heading from OCR
}

interface GeneratedSummary {
  brief: string;
  abstract: string;
  detailed: string;
  sections: SectionSummary[];
}

interface ChapterInfo {
  title: string;
  pageNumber: number;
  level: number;
}

// Build sections from detected chapters (merge if < 3 pages)
function buildSectionsFromChapters(
  chapters: ChapterInfo[],
  totalPages: number
): Array<{ title: string; startPage: number; endPage: number; source_chapter: string }> {
  if (chapters.length === 0) return [];

  const sections: Array<{ title: string; startPage: number; endPage: number; source_chapter: string }> = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const nextChapter = chapters[i + 1];
    const startPage = chapter.pageNumber;
    const endPage = nextChapter ? nextChapter.pageNumber - 1 : totalPages;

    // If this section would be < 3 pages and there's a next chapter, merge with next
    if (endPage - startPage + 1 < 3 && nextChapter && sections.length > 0) {
      // Extend the previous section instead
      sections[sections.length - 1].endPage = endPage;
      continue;
    }

    sections.push({
      title: chapter.title,
      startPage,
      endPage,
      source_chapter: chapter.title,
    });
  }

  return sections;
}

// Generate hierarchical book summary from batch extractions
async function generateBookSummary(
  batchExtractions: BatchExtraction[],
  bookTitle: string,
  bookAuthor: string,
  bookLanguage?: string,
  researchContext?: string,
  chapters?: ChapterInfo[]
): Promise<GeneratedSummary> {
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

  // If no batch extractions, fall back to research-only summary
  if (batchExtractions.length === 0) {
    return {
      brief: researchContext ? `A text by ${bookAuthor}. ${researchContext.substring(0, 200)}...` : `A text by ${bookAuthor}. Process page translations to generate a detailed summary.`,
      abstract: researchContext || 'No page content available yet. Process translations to generate a summary based on the actual text.',
      detailed: researchContext || 'This book has not been processed yet. Generate OCR and translations for the pages, then regenerate this summary to see content-based analysis.',
      sections: [],
    };
  }

  // Compile all extracted information
  const allThemes = [...new Set(batchExtractions.flatMap(b => b.themes))];
  const allQuotes = batchExtractions.flatMap(b => b.quotes);
  const allPeople = [...new Set(batchExtractions.flatMap(b => b.people))];
  const allPlaces = [...new Set(batchExtractions.flatMap(b => b.places))];
  const allConcepts = [...new Set(batchExtractions.flatMap(b => b.concepts))];

  // Build batch summaries section
  const batchSummariesText = batchExtractions
    .map(b => `Pages ${b.pageRange.start}-${b.pageRange.end}: ${b.summary}`)
    .join('\n');

  // Build quotes section (limit to best 15)
  const quotesText = allQuotes.slice(0, 15)
    .map(q => `- "${q.text}" (p. ${q.page})${q.context ? ` — ${q.context}` : ''}`)
    .join('\n');

  const languageContext = bookLanguage ? ` The original text is in ${bookLanguage}.` : '';

  const researchSection = researchContext ? `
## Wikipedia Context
${researchContext}
` : '';

  // Build chapter context if available
  const hasChapters = chapters && chapters.length > 0;
  const chapterSection = hasChapters ? `
## Detected Chapter Structure
${chapters.map(c => `- Page ${c.pageNumber}: ${c.title}`).join('\n')}
` : '';

  const prompt = `You're writing compelling copy to help readers discover "${bookTitle}" by ${bookAuthor}.${languageContext}

${researchSection}
${chapterSection}
## Extracted from the text:

**Themes:** ${allThemes.join(', ')}

**Key People:** ${allPeople.join(', ') || 'None identified'}

**Key Places:** ${allPlaces.join(', ') || 'None identified'}

**Key Concepts:** ${allConcepts.join(', ')}

## Section-by-section summaries:
${batchSummariesText}

## Notable quotes extracted:
${quotesText}

## Your Task
Synthesize the above into compelling summaries that make readers WANT to explore this text.

**Writing style:**
- Write like a knowledgeable human, not an AI. Be direct and concrete.
- NEVER use em-dashes (—). Use commas, colons, semicolons, or separate sentences instead.
- NEVER use these AI-isms: "delves into", "rich tapestry", "fascinating exploration", "sheds light on", "offers a window into", "comprehensive", "intricate", "nuanced", "multifaceted", "groundbreaking", "seminal".
- Prefer short, clear sentences over long compound ones.
- Scholarly but accessible. Say what the text does, not how impressive it is.

1. **BRIEF** (2-3 punchy sentences):
   - Hook the reader - what's compelling about this text?
   - What questions does it tackle? What will readers discover?

2. **ABSTRACT** (1 paragraph, 4-6 sentences):
   - What makes this text worth reading?
   - What bold claims or intriguing ideas does it contain?
   - What's the author's unique perspective?

3. **DETAILED** (2-4 paragraphs):
   - Paint a picture of the journey through this text
   - Highlight the most striking ideas or arguments
   - Convey the texture and flavor of the writing

4. **SECTIONS**: ${hasChapters ? 'Use the detected chapter structure.' : 'Group into 5-8 thematic sections.'} For each:
   - Title and page range
   - What it covers (2-3 sentences)
   - 2-4 notable quotes with page numbers and significance
   - Key concepts

Output as JSON:
{
  "brief": "...",
  "abstract": "...",
  "detailed": "...",
  "sections": [
    {
      "title": "Section Title",
      "startPage": 1,
      "endPage": 10,
      "summary": "What this section covers...",
      "quotes": [
        {"text": "Exact quote", "page": 3, "significance": "Why this matters"}
      ],
      "concepts": ["Key Term", "Important Concept"]
    }
  ]
}

IMPORTANT: Use the actual quotes provided above. Don't invent new ones.`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  // Log the Gemini call
  const usageMetadata = result.response.usageMetadata;
  logGeminiCall({
    type: 'summary',
    mode: 'realtime',
    model: 'gemini-3.1-flash-lite-preview',
    page_count: batchExtractions.length, // Number of batch sections processed
    input_tokens: usageMetadata?.promptTokenCount || 0,
    output_tokens: usageMetadata?.candidatesTokenCount || 0,
    status: 'success',
    endpoint: '/api/books/[id]/index (generateBookSummary)',
  }).catch(console.error); // Non-blocking

  // Parse JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse book summary JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Ensure all fields are strings
  const ensureString = (val: unknown): string => {
    if (typeof val === 'string') return val;
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) return val.join('\n\n');
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  };

  return {
    brief: ensureString(parsed.brief),
    abstract: ensureString(parsed.abstract),
    detailed: ensureString(parsed.detailed),
    sections: Array.isArray(parsed.sections) ? parsed.sections : [],
  };
}

/**
 * Clean translation text of metadata tags for matching.
 */
function cleanTranslationText(text: string): string {
  return text
    .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/gi, '')
    .replace(/\[\[[^\]]+\]\]/g, '')
    .replace(/^```(?:markdown)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

/**
 * Find the best matching substring in sourceText for the given quote words.
 * Uses a sliding window approach: score = fraction of quote words found in window.
 * After finding the best window, snaps to sentence boundaries for clean quotes.
 * Returns { score, extractedText } or null if no good match.
 */
function findBestMatch(
  quoteText: string,
  sourceText: string
): { score: number; extractedText: string } | null {
  const quoteWords = quoteText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (quoteWords.length === 0) return null;

  const sourceWords = sourceText.split(/\s+/);
  if (sourceWords.length === 0) return null;

  // Window size: same number of words as the quote, with some slack
  const windowSize = Math.max(quoteWords.length, 5);
  const maxWindow = Math.min(windowSize + Math.ceil(windowSize * 0.5), sourceWords.length);

  let bestScore = 0;
  let bestStart = 0;
  let bestEnd = 0;

  // Slide across source text
  for (let start = 0; start <= sourceWords.length - windowSize; start++) {
    // Try a few window sizes around the quote length
    for (let winSize = windowSize; winSize <= maxWindow && start + winSize <= sourceWords.length; winSize++) {
      const windowText = sourceWords.slice(start, start + winSize).join(' ').toLowerCase();
      const matchCount = quoteWords.filter(w => windowText.includes(w)).length;
      const score = matchCount / quoteWords.length;

      if (score > bestScore) {
        bestScore = score;
        bestStart = start;
        bestEnd = start + winSize;
      }
    }
  }

  if (bestScore < 0.8) return null;

  // Snap to sentence boundaries for cleaner quotes
  const snapped = snapToSentenceBoundaries(sourceWords, bestStart, bestEnd);

  // Clean the extracted text: remove markdown artifacts
  let extractedText = sourceWords.slice(snapped.start, snapped.end).join(' ');
  extractedText = cleanExtractedQuote(extractedText);

  // Trim trailing incomplete sentence if quote doesn't end with punctuation
  if (extractedText.length > 60 && !/[.!?]["'\u201d\u2019)]*$/.test(extractedText)) {
    const lastSentenceEnd = Math.max(
      extractedText.lastIndexOf('.'),
      extractedText.lastIndexOf('!'),
      extractedText.lastIndexOf('?')
    );
    if (lastSentenceEnd > extractedText.length * 0.4) {
      extractedText = extractedText.substring(0, lastSentenceEnd + 1);
    }
  }

  // Trim leading incomplete sentence fragment if it starts lowercase
  if (/^[a-z]/.test(extractedText)) {
    const firstSentenceStart = extractedText.search(/[.!?]\s+[A-Z]/);
    if (firstSentenceStart > 0 && firstSentenceStart < extractedText.length * 0.4) {
      extractedText = extractedText.substring(firstSentenceStart + 2).trim();
    }
  }

  if (extractedText.length < 30) return null;

  return { score: bestScore, extractedText };
}

/**
 * Snap window boundaries to the nearest sentence start/end.
 * For start: looks backward for period, then forward for capital letter.
 * For end: looks forward for sentence-ending punctuation.
 */
function snapToSentenceBoundaries(
  words: string[],
  start: number,
  end: number
): { start: number; end: number } {
  const sentenceEnd = /[.!?]["'\u201d\u2019)]*$/;
  const maxExtend = 12; // max words to extend in either direction

  // Snap start: first try backward for a sentence-ending word
  let newStart = start;
  let foundStart = false;
  for (let i = start - 1; i >= Math.max(0, start - maxExtend); i--) {
    if (sentenceEnd.test(words[i])) {
      newStart = i + 1;
      foundStart = true;
      break;
    }
  }
  // If no period found, look forward for a capital letter (sentence beginning)
  if (!foundStart) {
    for (let i = start; i < Math.min(words.length, start + maxExtend); i++) {
      if (/^[A-Z\u201c\u201e"'(]/.test(words[i])) {
        newStart = i;
        break;
      }
    }
  }

  // Snap end: look forward for sentence-ending punctuation
  let newEnd = end;
  for (let i = end - 1; i < Math.min(words.length, end + maxExtend); i++) {
    if (sentenceEnd.test(words[i])) {
      newEnd = i + 1;
      break;
    }
  }

  return { start: newStart, end: newEnd };
}

/**
 * Clean extracted quote text: remove markdown artifacts, stray page numbers,
 * blockquote markers, XML tags, and other formatting noise.
 */
function cleanExtractedQuote(text: string): string {
  return text
    .replace(/^>\s*/gm, '')              // Remove blockquote markers
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1') // Remove bold/italic markdown
    .replace(/\*/g, '')                  // Remove any remaining stray asterisks
    .replace(/^\d{1,3}\s+/g, '')         // Remove leading page numbers (e.g. "257 The soul...")
    .replace(/\s+\d{1,3}\s*\*?\s*\*/g, '') // Remove inline page refs (e.g. "110* *")
    .replace(/<\/?[a-z-]+\/?>/gi, '')    // Remove stray XML/HTML tags (e.g. </margin>, <column-break/>)
    .replace(/->/g, '')                  // Remove arrow markers
    .replace(/<-/g, '')                  // Remove reverse arrow markers
    .replace(/^[IVX]+\s+/g, '')          // Remove leading chapter numbers (e.g. "II ")
    .replace(/\s{2,}/g, ' ')             // Collapse whitespace
    .trim();
}

/**
 * Ground quotes against source translation text.
 * Instead of just filtering, find the actual verbatim text in the translation
 * and replace the AI's paraphrase. Also resolves page_id.
 * Excludes non-content pages (index, TOC, title pages, etc.).
 */
const NON_CONTENT_PAGE_TYPES = new Set([
  'index', 'table_of_contents', 'title_page', 'blank_page', 'colophon', 'errata',
]);

function groundQuotes(
  quotes: Array<{ text: string; page: number; context?: string; significance?: string }>,
  pages: PageData[]
): Array<{ text: string; page: number; page_id: string; context?: string; significance?: string }> {
  // Build lookup of clean translation text by page number, preserving page_id
  // Exclude non-content pages (index, TOC, etc.) to avoid quoting index entries
  const pageIndex = new Map<number, { text: string; page_id: string }>();
  for (const page of pages) {
    if (page.translation?.data && !NON_CONTENT_PAGE_TYPES.has(page.page_type || '')) {
      pageIndex.set(page.page_number, {
        text: cleanTranslationText(page.translation.data),
        page_id: page.id,
      });
    }
  }

  const grounded: Array<{ text: string; page: number; page_id: string; context?: string; significance?: string }> = [];

  for (const quote of quotes) {
    if (!quote.text || quote.text.length < 30) continue;

    // 1. Try the specified page first
    const specifiedPage = pageIndex.get(quote.page);
    if (specifiedPage) {
      const match = findBestMatch(quote.text, specifiedPage.text);
      if (match) {
        grounded.push({
          text: match.extractedText,
          page: quote.page,
          page_id: specifiedPage.page_id,
          context: quote.context,
          significance: quote.significance,
        });
        continue;
      }
    }

    // 2. Search all pages (AI often gets page numbers wrong)
    let bestOverall: { score: number; extractedText: string; pageNum: number; pageId: string } | null = null;
    for (const [pageNum, pageData] of pageIndex) {
      if (pageNum === quote.page) continue; // Already tried
      const match = findBestMatch(quote.text, pageData.text);
      if (match && (!bestOverall || match.score > bestOverall.score)) {
        bestOverall = {
          score: match.score,
          extractedText: match.extractedText,
          pageNum,
          pageId: pageData.page_id,
        };
      }
    }

    if (bestOverall) {
      grounded.push({
        text: bestOverall.extractedText,
        page: bestOverall.pageNum,
        page_id: bestOverall.pageId,
        context: quote.context,
        significance: quote.significance,
      });
      continue;
    }

    // 3. No good match anywhere — drop the quote
  }

  return grounded;
}

// Sync entities from a single book to the cross-book entities collection
async function syncBookEntities(
  db: Awaited<ReturnType<typeof getDb>>,
  bookId: string,
  bookTitle: string,
  bookAuthor: string,
  conceptIndex: {
    people: ConceptEntry[];
    places: ConceptEntry[];
    concepts: ConceptEntry[];
    vocabulary: ConceptEntry[];
    keywords: ConceptEntry[];
  },
  bookYear?: number | null
) {
  const now = new Date();

  // Load alias resolver to merge variant names into canonical entities
  const aliasResolver = await loadAliasResolver(db);

  const syncEntity = async (term: string, type: 'person' | 'place' | 'concept', pages: number[]) => {
    // Resolve to canonical name
    const canonicalName = aliasResolver.resolve(term, type);

    const update: Record<string, unknown> = {
      $set: { updated_at: now },
      $setOnInsert: { name: canonicalName, type, created_at: now },
      $addToSet: {
        books: {
          book_id: bookId,
          book_title: bookTitle,
          book_author: bookAuthor,
          ...(bookYear ? { book_year: bookYear } : {}),
          pages: pages
        },
      } as Record<string, unknown>,
    };

    // If this term is a variant, add it to aliases
    if (term !== canonicalName) {
      (update.$addToSet as Record<string, unknown>).aliases = term;
    }

    await db.collection('entities').updateOne(
      { name: canonicalName, type },
      update,
      { upsert: true }
    );
  };

  // Sync all entity types
  const promises: Promise<void>[] = [];

  for (const person of conceptIndex.people) {
    if (!person.term) continue;
    promises.push(syncEntity(person.term, 'person', person.pages));
  }

  for (const place of conceptIndex.places) {
    if (!place.term) continue;
    promises.push(syncEntity(place.term, 'place', place.pages));
  }

  for (const concept of conceptIndex.concepts) {
    if (!concept.term) continue;
    promises.push(syncEntity(concept.term, 'concept', concept.pages));
  }

  await Promise.all(promises);

  // Update book_count and total_mentions for affected entities
  // Use canonical names for the lookup
  const allTerms = [
    ...conceptIndex.people.filter(p => p.term).map(p => ({ name: aliasResolver.resolve(p.term, 'person'), type: 'person' as const })),
    ...conceptIndex.places.filter(p => p.term).map(p => ({ name: aliasResolver.resolve(p.term, 'place'), type: 'place' as const })),
    ...conceptIndex.concepts.filter(p => p.term).map(p => ({ name: aliasResolver.resolve(p.term, 'concept'), type: 'concept' as const }))
  ];

  // Deduplicate — multiple variants may resolve to the same canonical
  const uniqueTerms = [...new Map(allTerms.map(t => [`${t.type}:${t.name}`, t])).values()];

  for (const { name, type } of uniqueTerms) {
    const entity = await db.collection('entities').findOne({ name, type });
    if (entity) {
      const bookCount = entity.books?.length || 0;
      const totalMentions = (entity.books || []).reduce(
        (sum: number, b: { pages: number[] }) => sum + (b.pages?.length || 0),
        0
      );
      await db.collection('entities').updateOne(
        { name, type },
        { $set: { book_count: bookCount, total_mentions: totalMentions } }
      );
    }
  }

  console.log(`Synced ${promises.length} entities for book "${bookTitle}"`);
}

// GET /api/books/[id]/index - Get or generate book index
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Return cached index if it exists — regeneration only via POST
    if (book.index && book.index.generatedAt) {
      return NextResponse.json(book.index);
    }

    // No index exists yet — generate one
    const pages = await db.collection('pages')
      .find({ book_id: id })
      .sort({ page_number: 1 })
      .toArray() as unknown as PageData[];

    // Book metadata
    const bookTitle = book.display_title || book.title;
    const bookAuthor = book.author || 'Unknown';

    // Get chapters for section structure
    const chapters: ChapterInfo[] = (book.chapters || []).map((c: { title: string; pageNumber: number; level?: number }) => ({
      title: c.title,
      pageNumber: c.pageNumber,
      level: c.level || 1,
    }));

    // Fetch chapter texts for chapter-aligned batching (only use extracted chapters, not topic-detected)
    const chapterTexts = await getChapterTexts(db, id);
    const useChapters = chapterTexts.length > 1;
    if (useChapters) {
      console.log(`Using ${chapterTexts.length} chapter-aligned batches`);
    }

    // Research the book via Wikipedia (runs in parallel with batch processing)
    const researchPromise = researchBook(bookTitle, bookAuthor)
      .then(result => {
        console.log('Research found:', result ? result.substring(0, 100) + '...' : 'none');
        return result;
      })
      .catch(e => {
        console.error('Research failed:', e);
        return '';
      });

    // Process pages in parallel batches (MapReduce approach)
    console.log(`\n=== Generating summary for "${bookTitle}" ===`);
    const translatedCount = pages.filter(p => p.translation?.data).length;
    console.log(`${translatedCount} of ${pages.length} pages have translations`);

    const batchExtractions = await processAllBatches(
      pages,
      bookTitle,
      bookAuthor,
      book.language || undefined,
      useChapters ? chapterTexts : undefined
    );

    // Wait for research to complete
    const researchContext = await researchPromise;

    // Build concept index from batch extractions
    const conceptIndex = buildConceptIndexFromBatches(batchExtractions, pages);

    // Build page summaries from batch extractions (for backward compatibility)
    const pageSummaries = batchExtractions.flatMap(batch =>
      batch.summary ? [{
        page: batch.pageRange.start,
        summary: batch.summary
      }] : []
    );

    // Generate final summary from batch extractions
    let bookSummary = { brief: '', abstract: '', detailed: '' };
    let sectionSummaries: SectionSummary[] = [];

    if (batchExtractions.length > 0 || researchContext) {
      try {
        console.log('Synthesizing final summary from batch extractions...');
        const generated = await generateBookSummary(
          batchExtractions,
          bookTitle,
          bookAuthor,
          book.language || undefined,
          researchContext || undefined,
          chapters.length > 0 ? chapters : undefined
        );
        bookSummary = {
          brief: generated.brief,
          abstract: generated.abstract,
          detailed: generated.detailed,
        };
        sectionSummaries = generated.sections || [];
        console.log('Summary generated with', sectionSummaries.length, 'sections');
      } catch (e) {
        console.error('Failed to generate book summary:', e);
      }
    } else {
      console.log('Skipping summary: no translations and no research context');
    }

    // Ground quotes against source text — replace paraphrases with verbatim passages
    const allBatchQuotes = batchExtractions.flatMap(b => b.quotes);
    const groundedBatchQuotes = groundQuotes(allBatchQuotes, pages);
    const droppedBatch = allBatchQuotes.length - groundedBatchQuotes.length;
    if (droppedBatch > 0) {
      console.log(`Quote grounding: dropped ${droppedBatch}/${allBatchQuotes.length} batch quotes (no source match)`);
    }

    // Also ground section quotes
    for (const section of sectionSummaries) {
      if (section.quotes && section.quotes.length > 0) {
        const before = section.quotes.length;
        section.quotes = groundQuotes(section.quotes, pages);
        const dropped = before - section.quotes.length;
        if (dropped > 0) {
          console.log(`Quote grounding: dropped ${dropped}/${before} quotes from section "${section.title}"`);
        }
      }
    }

    const index: BookIndex = {
      ...conceptIndex,
      pageSummaries,
      sectionSummaries,
      bookSummary,
      generatedAt: new Date(),
      pagesCovered: pageSummaries.length,
      totalPages: pages.length,
    };

    // Cache the index on the book and save brief summary for display
    const updateData: Record<string, unknown> = {
      index,
      updated_at: new Date()
    };

    // Save the brief as the book summary for display on the book page (with historical context)
    if (bookSummary.brief) {
      updateData.summary = {
        data: bookSummary.brief,
        generated_at: new Date(),
        page_coverage: Math.round((pageSummaries.length / pages.length) * 100),
        model: 'gemini-3.1-flash-lite-preview'
      };
      // Also save as reading_summary (expected by pipeline, docs, and downstream checks)
      updateData.reading_summary = {
        overview: bookSummary.abstract || bookSummary.brief,
        detailed: bookSummary.detailed || '',
        themes: batchExtractions.flatMap(b => b.themes).filter((v, i, a) => a.indexOf(v) === i).slice(0, 20),
        quotes: groundedBatchQuotes.slice(0, 15),
        generated_at: new Date(),
        model: 'gemini-3.1-flash-lite-preview'
      };
    }

    await db.collection('books').updateOne(
      { id },
      { $set: updateData, $unset: { enrichment_stale: '' } }
    );

    // Sync entities to cross-book entity collection (non-blocking)
    syncBookEntities(db, id, bookTitle, bookAuthor, conceptIndex, book.year || null).catch(err => {
      console.error('Entity sync failed:', err);
    });

    return NextResponse.json(index);
  } catch (error) {
    console.error('Error generating book index:', error);
    return NextResponse.json(
      { error: 'Failed to generate index' },
      { status: 500 }
    );
  }
}

// POST /api/books/[id]/index - Force regenerate index
export const POST = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const db = await getDb();

    // Clear cached index and summary
    await db.collection('books').updateOne(
      { id },
      { $unset: { index: '', summary: '' } }
    );

    // Return success - client will call GET to generate fresh
    return NextResponse.json({ success: true, message: 'Cache cleared' });
  } catch (error) {
    console.error('Error regenerating index:', error);
    return NextResponse.json(
      { error: 'Failed to regenerate index' },
      { status: 500 }
    );
  }
});
