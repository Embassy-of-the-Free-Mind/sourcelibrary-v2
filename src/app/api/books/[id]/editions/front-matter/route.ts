import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { Book, Page, TranslationEdition } from '@/lib/types';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// POST /api/books/[id]/editions/front-matter - Generate front matter for an edition
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: bookId } = await context.params;
    const body = await request.json();
    const { edition_id, regenerate = false } = body as { edition_id?: string; regenerate?: boolean };

    const db = await getDb();

    // Get book with full details
    const book = await db.collection('books').findOne({ id: bookId }) as unknown as Book | null;
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get pages for context
    const pages = await db.collection('pages')
      .find({ book_id: bookId })
      .sort({ page_number: 1 })
      .toArray() as unknown as Page[];

    // Find edition if specified, otherwise use current
    let edition: TranslationEdition | undefined;
    if (edition_id) {
      edition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.id === edition_id);
    } else {
      edition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published');
    }

    // Check if front matter already exists and regenerate not requested
    if (edition?.front_matter?.introduction && !regenerate) {
      return NextResponse.json({
        success: true,
        front_matter: edition.front_matter,
        cached: true,
      });
    }

    // Gather context for AI generation
    const bookContext = buildBookContext(book, pages);

    // Generate introduction and methodology in parallel
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const [introResult, methodResult] = await Promise.all([
      generateIntroduction(model, book, bookContext),
      generateMethodology(model, book, pages),
    ]);

    const frontMatter = {
      introduction: introResult,
      methodology: methodResult,
      generated_at: new Date(),
      generated_by: 'gemini-2.0-flash',
    };

    // Save to edition if one exists
    if (edition) {
      const editions = (book.editions as TranslationEdition[]).map(e =>
        e.id === edition!.id ? { ...e, front_matter: frontMatter } : e
      );
      await db.collection('books').updateOne(
        { id: bookId },
        { $set: { editions, updated_at: new Date() } }
      );
    }

    return NextResponse.json({
      success: true,
      front_matter: frontMatter,
      cached: false,
    });
  } catch (error) {
    console.error('Error generating front matter:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate front matter' },
      { status: 500 }
    );
  }
}

function buildBookContext(book: Book, pages: Page[]): string {
  const parts: string[] = [];

  // Basic info
  parts.push(`Title: ${book.title}`);
  if (book.display_title) parts.push(`English Title: ${book.display_title}`);
  parts.push(`Author: ${book.author}`);
  parts.push(`Language: ${book.language}`);
  parts.push(`Published: ${book.published}`);
  if (book.place_published) parts.push(`Place: ${book.place_published}`);
  if (book.publisher) parts.push(`Publisher: ${book.publisher}`);
  if (book.ustc_id) parts.push(`USTC ID: ${book.ustc_id}`);

  // Book summary if available
  const bookIndex = book as unknown as { index?: { bookSummary?: { detailed?: string; abstract?: string } } };
  if (bookIndex.index?.bookSummary?.detailed) {
    parts.push(`\nBook Summary:\n${bookIndex.index.bookSummary.detailed}`);
  } else if (bookIndex.index?.bookSummary?.abstract) {
    parts.push(`\nBook Summary:\n${bookIndex.index.bookSummary.abstract}`);
  }

  // Sample of page summaries (first few and last few)
  const samplePages = [
    ...pages.slice(0, 5),
    ...pages.slice(-3),
  ];
  const summaries = samplePages
    .filter(p => p.summary?.data)
    .map(p => `Page ${p.page_number}: ${p.summary!.data.slice(0, 300)}...`);

  if (summaries.length > 0) {
    parts.push(`\nSample Page Summaries:\n${summaries.join('\n')}`);
  }

  // Key people and concepts from index
  const index = bookIndex.index as { people?: { term: string; pages: number[] }[]; concepts?: { term: string; pages: number[] }[] } | undefined;
  if (index?.people) {
    const topPeople = index.people.slice(0, 10).map(p => p.term);
    parts.push(`\nKey People: ${topPeople.join(', ')}`);
  }
  if (index?.concepts) {
    const topConcepts = index.concepts.slice(0, 15).map(c => c.term);
    parts.push(`\nKey Concepts: ${topConcepts.join(', ')}`);
  }

  return parts.join('\n');
}

async function generateIntroduction(
  model: ReturnType<typeof genAI.getGenerativeModel>,
  book: Book,
  context: string
): Promise<string> {
  const prompt = `You are a scholarly editor writing an introduction for a digital edition of a historical text.

Write a comprehensive but accessible introduction (800-1200 words) for this work:

${context}

The introduction should include:

1. **Historical Context** (2-3 paragraphs)
   - When and where was this written?
   - What was happening in the intellectual/cultural world at this time?
   - Who was the author and what do we know about them?

2. **The Work Itself** (2-3 paragraphs)
   - What is this text about?
   - What genre does it belong to (natural philosophy, alchemy, etc.)?
   - How does it relate to other works of its period?

3. **Significance** (1-2 paragraphs)
   - Why does this text matter today?
   - What can modern readers learn from it?
   - How does it fit into the history of science/philosophy?

4. **This Edition** (1 paragraph)
   - Note that this is a new English translation
   - Mention the digital format allows facsimile + translation viewing
   - Briefly note the AI-assisted translation approach (details in Methodology)

Write in clear, scholarly prose accessible to educated general readers. Use markdown formatting with ## headings. Do not use bullet points in the main text. Include specific historical details where possible.

Do NOT include any preamble like "Here is an introduction..." - start directly with the first heading.`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function generateMethodology(
  model: ReturnType<typeof genAI.getGenerativeModel>,
  book: Book,
  pages: Page[]
): Promise<string> {
  // Gather translation stats
  const models = new Set<string>();
  const promptNames = new Set<string>();

  pages.forEach(p => {
    if (p.ocr?.model) models.add(p.ocr.model);
    if (p.translation?.model) models.add(p.translation.model);
    if (p.ocr?.prompt_name) promptNames.add(p.ocr.prompt_name);
    if (p.translation?.prompt_name) promptNames.add(p.translation.prompt_name);
  });

  const prompt = `You are a scholarly editor writing a methodology section for a digital edition that uses AI-assisted translation.

Write a clear methodology section (500-800 words) explaining how this translation was produced:

**Source Text:**
- Title: ${book.title}
- Language: ${book.language}
- Published: ${book.published}
- Total pages: ${pages.length}

**Technical Details:**
- AI Models used: ${Array.from(models).join(', ')}
- Processing approach: OCR of page images, then translation

The methodology section should include:

1. **Translation Approach** (1-2 paragraphs)
   - This is an AI-assisted translation using large language models
   - The goal is scholarly accessibility: accurate to the source, readable for modern audiences
   - Human oversight in the translation process

2. **OCR Process** (1 paragraph)
   - Page images were processed using vision AI models
   - Source language preserved with original spelling
   - Annotations capture marginalia, abbreviations, unclear readings

3. **Translation Process** (1-2 paragraphs)
   - Explain the translation philosophy: faithful to original, explanatory notes added
   - Technical terms preserved in original with translations
   - Inline <note> tags provide context for modern readers

4. **Editorial Conventions** (as a formatted list)
   - <note> = translator's explanatory additions
   - <margin> = marginalia from the original
   - <unclear> = uncertain readings
   - <term> = technical vocabulary with definitions
   - Original paragraph structure preserved
   - etc.

5. **Limitations & Future Work** (1 paragraph)
   - Acknowledge AI translation limitations
   - Note that human review is recommended for critical scholarship
   - Mention the translation is versioned and can be improved

Write in clear, professional prose. Use ## markdown headings. The conventions section can use bullet points.

Do NOT include any preamble - start directly with the first heading.`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}
