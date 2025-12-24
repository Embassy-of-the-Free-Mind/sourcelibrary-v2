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

// Extract [[vocabulary: ...]] and [[keywords: ...]] from text
function extractTerms(text: string, tag: string): string[] {
  const pattern = new RegExp(`\\[\\[${tag}:\\s*(.*?)\\]\\]`, 'gi');
  const terms: string[] = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const items = match[1].split(',').map(t => t.trim()).filter(Boolean);
    terms.push(...items);
  }
  return terms;
}

// Extract [[summary: ...]] from text
function extractSummary(text: string): string | undefined {
  const match = text.match(/\[\[summary:\s*(.*?)\]\]/i);
  return match ? match[1].trim() : undefined;
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
}

interface GeneratedSummary {
  brief: string;
  abstract: string;
  detailed: string;
  sections: SectionSummary[];
}

// Generate hierarchical book summary using AI
async function generateBookSummary(
  pageSummaries: { page: number; summary: string }[],
  bookTitle: string,
  bookAuthor: string,
  bookLanguage?: string,
  researchContext?: string
): Promise<GeneratedSummary> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const summaryText = pageSummaries
    .map(s => `Page ${s.page}: ${s.summary}`)
    .join('\n');

  const languageContext = bookLanguage ? ` The original text is in ${bookLanguage}.` : '';

  const researchSection = researchContext ? `
## Wikipedia Context (verified)
${researchContext}
` : '';

  const pageSummarySection = summaryText ? `
## Page Contents
${summaryText}
` : '';

  const sectionsInstructions = summaryText ? `
4. **SECTIONS**: Group the pages into 3-8 thematic sections. For each:
   - A descriptive title based on the content
   - The page range
   - What the section covers (2-3 sentences)` : `
4. **SECTIONS**: Return an empty array since no page content is available.`;

  // If no page content, we can't generate a meaningful summary
  if (!summaryText) {
    return {
      brief: researchContext ? `A text by ${bookAuthor}. ${researchContext.substring(0, 200)}...` : `A text by ${bookAuthor}. Process page translations to generate a detailed summary.`,
      abstract: researchContext || 'No page content available yet. Process translations to generate a summary based on the actual text.',
      detailed: researchContext || 'This book has not been processed yet. Generate OCR and translations for the pages, then regenerate this summary to see content-based analysis.',
      sections: [],
    };
  }

  const prompt = `You're writing compelling copy to help readers discover "${bookTitle}" by ${bookAuthor}.${languageContext}

${researchSection}
${pageSummarySection}

## Your Task
Write summaries that make readers WANT to explore this text. Be engaging, highlight what's fascinating, but stay grounded in what's actually in the pages above.

1. **BRIEF** (2-3 punchy sentences):
   - Hook the reader - what's compelling about this text?
   - What questions does it tackle? What will readers discover?
   - Write like a book jacket, not an encyclopedia

2. **ABSTRACT** (1 paragraph, 4-6 sentences):
   - Open with what makes this text worth reading
   - What bold claims or intriguing ideas does it contain?
   - What's the author's unique perspective or approach?
   - What will readers learn or encounter?
   - End with why someone should dive in

3. **DETAILED** (2-4 paragraphs):
   - Paint a picture of the journey through this text
   - Highlight the most striking passages, ideas, or arguments
   - What surprising or thought-provoking content appears?
   - What concepts or figures play key roles?
   - Convey the texture and flavor of the writing
${sectionsInstructions}

Output as JSON:
{
  "brief": "...",
  "abstract": "...",
  "detailed": "...",
  "sections": [
    {"title": "...", "startPage": 1, "endPage": 5, "summary": "..."},
    ...
  ]
}

IMPORTANT: Be engaging and interesting, but only describe what's actually in the text. Don't invent historical claims or content not in the pages. If something is genuinely fascinating in the text, highlight it!`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  // Parse JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse book summary JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Ensure all fields are strings (AI sometimes returns objects or arrays)
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

    // Build concept index
    const conceptIndex = buildConceptIndex(pages);

    // Extract page summaries
    const pageSummaries = extractPageSummaries(pages);
    console.log(`Found ${pageSummaries.length} page summaries from ${pages.length} total pages`);

    // Generate book summary if we have page summaries OR translations
    let bookSummary = { brief: '', abstract: '', detailed: '' };
    let sectionSummaries: SectionSummary[] = [];

    // Research the book first (useful even without page summaries)
    const bookTitle = book.display_title || book.title;
    const bookAuthor = book.author || 'Unknown';
    let researchContext = '';

    try {
      console.log('Researching book:', bookTitle, 'by', bookAuthor);
      researchContext = await researchBook(bookTitle, bookAuthor);
      console.log('Research found:', researchContext ? researchContext.substring(0, 200) + '...' : 'none');
    } catch (e) {
      console.error('Research failed:', e);
    }

    // Generate summary if we have at least 1 page summary, or just research
    if (pageSummaries.length >= 1 || researchContext) {
      try {
        const generated = await generateBookSummary(
          pageSummaries,
          bookTitle,
          bookAuthor,
          book.language || undefined,
          researchContext || undefined
        );
        bookSummary = {
          brief: generated.brief,
          abstract: generated.abstract,
          detailed: generated.detailed,
        };
        sectionSummaries = generated.sections || [];
        console.log('Summary generated successfully');
      } catch (e) {
        console.error('Failed to generate book summary:', e);
      }
    } else {
      console.log('Skipping summary generation: no page summaries and no research context');
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
        model: 'gemini-2.0-flash'
      };
    }

    await db.collection('books').updateOne(
      { id },
      { $set: updateData }
    );

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
