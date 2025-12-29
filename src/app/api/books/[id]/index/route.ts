import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
  page_number: number;
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
    model: 'gemini-3-flash-preview',
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
  "summary": "2-3 sentence summary of what these pages cover and their key arguments."
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

// Process all pages in parallel batches (MapReduce approach)
async function processAllBatches(
  pages: PageData[],
  bookTitle: string,
  bookAuthor: string,
  bookLanguage?: string
): Promise<BatchExtraction[]> {
  const pageBatches = createBatches(pages);
  if (pageBatches.length === 0) return [];

  console.log(`Processing ${pageBatches.length} batches in parallel...`);

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
  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

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
  }
) {
  const now = new Date();

  const syncEntity = async (term: string, type: 'person' | 'place' | 'concept', pages: number[]) => {
    await db.collection('entities').updateOne(
      { name: term, type },
      {
        $set: {
          updated_at: now
        },
        $setOnInsert: {
          name: term,
          type,
          created_at: now
        },
        $addToSet: {
          books: {
            book_id: bookId,
            book_title: bookTitle,
            book_author: bookAuthor,
            pages: pages
          }
        }
      },
      { upsert: true }
    );
  };

  // Sync all entity types
  const promises: Promise<void>[] = [];

  for (const person of conceptIndex.people) {
    promises.push(syncEntity(person.term, 'person', person.pages));
  }

  for (const place of conceptIndex.places) {
    promises.push(syncEntity(place.term, 'place', place.pages));
  }

  for (const concept of conceptIndex.concepts) {
    promises.push(syncEntity(concept.term, 'concept', concept.pages));
  }

  await Promise.all(promises);

  // Update book_count and total_mentions for affected entities
  const allTerms = [
    ...conceptIndex.people.map(p => ({ name: p.term, type: 'person' })),
    ...conceptIndex.places.map(p => ({ name: p.term, type: 'place' })),
    ...conceptIndex.concepts.map(p => ({ name: p.term, type: 'concept' }))
  ];

  for (const { name, type } of allTerms) {
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

    // Check if we have a cached index
    if (book.index && book.index.generatedAt) {
      const indexAge = Date.now() - new Date(book.index.generatedAt).getTime();
      const oneDay = 24 * 60 * 60 * 1000;

      // Return cached if less than 1 day old
      if (indexAge < oneDay) {
        return NextResponse.json(book.index);
      }
    }

    // Generate fresh index
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
      book.language || undefined
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
        model: 'gemini-3-flash-preview'
      };
    }

    await db.collection('books').updateOne(
      { id },
      { $set: updateData }
    );

    // Sync entities to cross-book entity collection (non-blocking)
    syncBookEntities(db, id, bookTitle, bookAuthor, conceptIndex).catch(err => {
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
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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
}
