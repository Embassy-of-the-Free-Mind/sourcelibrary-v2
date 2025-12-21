import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

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
    // Try translation first, then dedicated summary
    const text = page.translation?.data || '';
    const summary = extractSummary(text) || page.summary?.data;

    if (summary) {
      summaries.push({ page: page.page_number, summary });
    }
  }

  return summaries;
}

// Generate hierarchical book summary using AI
async function generateBookSummary(
  pageSummaries: { page: number; summary: string }[],
  bookTitle: string,
  bookAuthor: string
): Promise<{ brief: string; abstract: string; detailed: string }> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const summaryText = pageSummaries
    .map(s => `Page ${s.page}: ${s.summary}`)
    .join('\n');

  const prompt = `You are summarizing a historical text: "${bookTitle}" by ${bookAuthor}.

Here are the page-by-page summaries:
${summaryText}

Generate three levels of summary:

1. **BRIEF** (1-2 sentences): A tweet-length description for browsing.

2. **ABSTRACT** (1 paragraph, 4-6 sentences): A catalog-style description covering the main themes, arguments, and significance.

3. **DETAILED** (2-4 paragraphs): A fuller summary organized by the book's natural sections/themes. Include:
   - The book's purpose and context
   - Key arguments or teachings
   - Major figures or concepts discussed
   - Historical significance

Output as JSON:
{
  "brief": "...",
  "abstract": "...",
  "detailed": "..."
}`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  // Parse JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse book summary JSON');
  }

  return JSON.parse(jsonMatch[0]);
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

    // Generate book summary if we have enough page summaries
    let bookSummary = { brief: '', abstract: '', detailed: '' };
    if (pageSummaries.length >= 3) {
      try {
        bookSummary = await generateBookSummary(
          pageSummaries,
          book.display_title || book.title,
          book.author || 'Unknown'
        );
      } catch (e) {
        console.error('Failed to generate book summary:', e);
      }
    }

    const index: BookIndex = {
      ...conceptIndex,
      pageSummaries,
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

    // Save the abstract as the book summary for display on the book page
    if (bookSummary.abstract) {
      updateData.summary = {
        data: bookSummary.abstract,
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

    // Clear cached index
    await db.collection('books').updateOne(
      { id },
      { $unset: { index: '' } }
    );

    // Redirect to GET to generate fresh
    const url = new URL(request.url);
    return NextResponse.redirect(url, 303);
  } catch (error) {
    console.error('Error regenerating index:', error);
    return NextResponse.json(
      { error: 'Failed to regenerate index' },
      { status: 500 }
    );
  }
}
