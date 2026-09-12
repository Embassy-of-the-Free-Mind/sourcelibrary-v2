import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { getGeminiClient } from '@/lib/gemini-client';

// Lazy: resolving an API key at module scope would turn a missing
// GEMINI_API_KEY into an import-time throw, and route modules are imported
// during the build.
let _genAI: ReturnType<typeof getGeminiClient> | null = null;
const genAI = () => (_genAI ??= getGeminiClient({ endpoint: '/api/books/[id]/index/stream', type: 'index' }));

interface PageData {
  page_number: number;
  translation?: { data: string };
}

interface BatchExtraction {
  pageRange: { start: number; end: number };
  themes: string[];
  quotes: Array<{ text: string; page: number; context?: string }>;
  people: string[];
  places: string[];
  concepts: string[];
  summary: string;
}

const TARGET_BATCH_CHARS = 50000;

// Stream a progress update
function streamProgress(
  controller: ReadableStreamDefaultController,
  type: 'status' | 'batch' | 'complete' | 'error',
  data: Record<string, unknown>
) {
  const message = JSON.stringify({ type, ...data }) + '\n';
  controller.enqueue(new TextEncoder().encode(message));
}

// Process a single batch
async function processBatch(
  pages: PageData[],
  bookTitle: string,
  bookAuthor: string,
  bookLanguage?: string
): Promise<BatchExtraction> {
  const model = genAI().getGenerativeModel({
    model: 'gemini-3-flash-preview',
    generationConfig: { temperature: 0.2, maxOutputTokens: 2000 }
  });

  const pageRange = {
    start: pages[0].page_number,
    end: pages[pages.length - 1].page_number
  };

  const batchContent = pages
    .filter(p => p.translation?.data)
    .map(p => {
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
    return { pageRange, themes: [], quotes: [], people: [], places: [], concepts: [], summary: '' };
  }

  const prompt = `Analyze pages ${pageRange.start}-${pageRange.end} of "${bookTitle}" by ${bookAuthor}${bookLanguage ? ` (from ${bookLanguage})` : ''}.

${batchContent}

Extract as JSON:
{
  "themes": ["theme1", "theme2"],
  "quotes": [{"text": "EXACT verbatim quote", "page": N, "context": "why it matters"}],
  "people": ["Name1"],
  "places": ["Place1"],
  "concepts": ["concept1"],
  "summary": "2-3 sentences on key content. No em-dashes. No filler like 'delves into' or 'rich tapestry'. Short, direct sentences."
}

For quotes: Copy EXACT text, find striking/memorable passages, 3-5 per batch.`;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { pageRange, themes: [], quotes: [], people: [], places: [], concepts: [], summary: '' };

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
  } catch {
    return { pageRange, themes: [], quotes: [], people: [], places: [], concepts: [], summary: '' };
  }
}

// Create batches based on character count
function createBatches(pages: PageData[]): PageData[][] {
  const translated = pages.filter(p => p.translation?.data);
  if (translated.length === 0) return [];

  const batches: PageData[][] = [];
  let current: PageData[] = [];
  let size = 0;

  for (const page of translated) {
    const pageSize = (page.translation?.data || '').length;
    if (size + pageSize > TARGET_BATCH_CHARS && current.length > 0) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(page);
    size += pageSize;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// Generate final summary from batch results
async function synthesizeSummary(
  batches: BatchExtraction[],
  bookTitle: string,
  bookAuthor: string,
  bookLanguage?: string
): Promise<{ brief: string; abstract: string; detailed: string }> {
  const model = genAI().getGenerativeModel({
    model: 'gemini-3-flash-preview',
    generationConfig: { temperature: 0.3, maxOutputTokens: 3000 }
  });

  const allThemes = [...new Set(batches.flatMap(b => b.themes))];
  const allQuotes = batches.flatMap(b => b.quotes).slice(0, 15);
  const batchSummaries = batches.map(b => `Pages ${b.pageRange.start}-${b.pageRange.end}: ${b.summary}`).join('\n');
  const quotesText = allQuotes.map(q => `- "${q.text}" (p.${q.page})`).join('\n');

  const prompt = `You are a scholarly cataloger. Write a description of "${bookTitle}" by ${bookAuthor}${bookLanguage ? ` (from ${bookLanguage})` : ''}.

Themes: ${allThemes.join(', ')}

Section summaries:
${batchSummaries}

Notable quotes:
${quotesText}

Style: Write like a rare books librarian. State what the text is and contains. Do not sell or promote it. Never open with "Step into", "Discover", "Explore", "Unlock", or similar invitations. Never address the reader as "you". Be precise and concrete.

Output JSON:
{
  "brief": "2-3 declarative sentences: what the text is, what it argues or contains",
  "abstract": "1 paragraph (4-6 sentences) summarizing contents, structure, and context",
  "detailed": "2-4 paragraphs describing the work's structure, arguments, and significance"
}

Use the actual quotes provided. Be accurate.`;

  const result = await model.generateContent(prompt);
  const jsonMatch = result.response.text().match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse summary');

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    brief: parsed.brief || '',
    abstract: parsed.abstract || '',
    detailed: parsed.detailed || ''
  };
}

export const GET = withAuth(async (request, _session, context) => {
  const { id } = await context.params;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const db = await getDb();
        const book = await db.collection('books').findOne({ id });

        if (!book) {
          streamProgress(controller, 'error', { message: 'Book not found' });
          controller.close();
          return;
        }

        const bookTitle = book.display_title || book.title;
        const bookAuthor = book.author || 'Unknown';

        streamProgress(controller, 'status', { message: 'Loading pages...' });

        const pages = await db.collection('pages')
          .find({ book_id: id })
          .sort({ page_number: 1 })
          .toArray() as unknown as PageData[];

        const pageBatches = createBatches(pages);
        const totalBatches = pageBatches.length;

        if (totalBatches === 0) {
          streamProgress(controller, 'error', { message: 'No translated pages found' });
          controller.close();
          return;
        }

        streamProgress(controller, 'status', {
          message: `Processing ${totalBatches} batches...`,
          totalBatches,
          totalPages: pages.length
        });

        // Process batches sequentially so we can stream progress
        const batchResults: BatchExtraction[] = [];

        for (let i = 0; i < pageBatches.length; i++) {
          const batch = pageBatches[i];
          const start = batch[0].page_number;
          const end = batch[batch.length - 1].page_number;

          streamProgress(controller, 'batch', {
            current: i + 1,
            total: totalBatches,
            pages: `${start}-${end}`,
            message: `Analyzing pages ${start}-${end}...`
          });

          const result = await processBatch(batch, bookTitle, bookAuthor, book.language);
          batchResults.push(result);

          // Stream intermediate results
          streamProgress(controller, 'batch', {
            current: i + 1,
            total: totalBatches,
            pages: `${start}-${end}`,
            quotesFound: result.quotes.length,
            themesFound: result.themes.length,
            done: true
          });
        }

        streamProgress(controller, 'status', { message: 'Synthesizing final summary...' });

        const summary = await synthesizeSummary(batchResults, bookTitle, bookAuthor, book.language);

        // Compile all extracted data
        const allQuotes = batchResults.flatMap(b => b.quotes);
        const allPeople = [...new Set(batchResults.flatMap(b => b.people))];
        const allPlaces = [...new Set(batchResults.flatMap(b => b.places))];
        const allConcepts = [...new Set(batchResults.flatMap(b => b.concepts))];

        // Save to database
        const index = {
          bookSummary: summary,
          quotes: allQuotes,
          people: allPeople.map(p => ({ term: p, pages: [] })),
          places: allPlaces.map(p => ({ term: p, pages: [] })),
          concepts: allConcepts.map(c => ({ term: c, pages: [] })),
          generatedAt: new Date(),
          pagesCovered: pages.filter(p => p.translation?.data).length,
          totalPages: pages.length
        };

        await db.collection('books').updateOne(
          { id },
          {
            $set: {
              index,
              summary: { data: summary.brief, generated_at: new Date() },
              updated_at: new Date()
            }
          }
        );

        streamProgress(controller, 'complete', {
          message: 'Summary generated!',
          summary,
          quotesExtracted: allQuotes.length,
          peopleFound: allPeople.length,
          conceptsFound: allConcepts.length
        });

        controller.close();
      } catch (error) {
        console.error('Stream error:', error);
        streamProgress(controller, 'error', {
          message: error instanceof Error ? error.message : 'Unknown error'
        });
        controller.close();
      }
    }
  });

  // NextResponse (not the bare Response this used to return) because `withAuth`
  // is typed to it. NextResponse extends Response and takes the same BodyInit,
  // so the streaming behaviour is unchanged.
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  });
}, { minRole: 'editor' });
