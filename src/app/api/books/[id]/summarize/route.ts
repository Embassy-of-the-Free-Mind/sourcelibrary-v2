import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { DEFAULT_MODEL } from '@/lib/types';
import { logGeminiCall } from '@/lib/gemini-logger';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const BOOK_SUMMARY_PROMPT = `You are creating a reading guide for a historical/philosophical text.

**Your task:** Analyze the translated pages and create:
1. A clear, engaging overview (2-4 paragraphs) that helps readers understand what this text is about
2. 3-5 notable quotes that capture key ideas or are particularly striking
3. A list of 4-8 major themes or topics covered

**Format your response as JSON:**
{
  "overview": "Your 2-4 paragraph overview here. Explain the main purpose and argument of the text, its historical context if relevant, and what readers will gain from it...",
  "quotes": [
    { "text": "Exact quote from the translation", "page": 5 },
    { "text": "Another notable quote", "page": 12 }
  ],
  "themes": ["Theme One", "Theme Two", "Key Concept"]
}

**Guidelines:**
- Write for an educated general reader curious about historical texts
- The overview should explain: What is this text? What does it argue or explore? Why might it matter?
- Choose quotes that are memorable, insightful, or essential to the text's argument
- Keep quotes concise (1-3 sentences max)
- Include accurate page numbers so readers can find the original
- Themes should be substantive (e.g., "Self-knowledge and identity" not just "Philosophy")

**IMPORTANT:** Return ONLY valid JSON, no markdown formatting or extra text.`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();
    const body = await request.json().catch(() => ({}));

    const model = body.model || DEFAULT_MODEL;

    // Find the book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get all pages with translations
    const pages = await db.collection('pages')
      .find({ book_id: bookId })
      .sort({ page_number: 1 })
      .toArray();

    // Gather translations
    const translatedPages = pages.filter(p => p.translation?.data);
    if (translatedPages.length === 0) {
      return NextResponse.json({
        error: 'No translated pages in this book'
      }, { status: 400 });
    }

    // Build context from translations (limit to avoid token limits)
    const maxChars = 100000; // ~25k tokens
    let totalChars = 0;
    const contextParts: string[] = [];

    for (const p of translatedPages) {
      const cleanText = (p.translation?.data || '')
        .replace(/\[\[[^\]]+\]\]/g, '')
        .trim();

      if (totalChars + cleanText.length > maxChars) {
        // Add truncation notice
        contextParts.push(`\n\n[... ${translatedPages.length - contextParts.length} more pages truncated for brevity ...]`);
        break;
      }

      contextParts.push(`--- Page ${p.page_number} ---\n${cleanText}`);
      totalChars += cleanText.length;
    }

    const context = contextParts.join('\n\n');

    // Generate summary
    const aiModel = genAI.getGenerativeModel({ model });
    const prompt = `${BOOK_SUMMARY_PROMPT}\n\n**Book: "${book.title || 'Untitled'}"**\n${book.author ? `**Author: ${book.author}**\n` : ''}${book.year ? `**Year: ${book.year}**\n` : ''}\n\n**Translated pages:**\n\n${context}`;

    const result = await aiModel.generateContent(prompt);
    const responseText = result.response.text();

    // Parse JSON response
    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch {
      console.error('Failed to parse AI response:', responseText);
      return NextResponse.json({
        error: 'Failed to parse AI response'
      }, { status: 500 });
    }

    // Save to book
    const summary = {
      overview: parsed.overview,
      quotes: parsed.quotes,
      themes: parsed.themes,
      generated_at: new Date(),
      model,
      pages_analyzed: translatedPages.length
    };

    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          reading_summary: summary,
          updated_at: new Date()
        }
      }
    );

    // Track usage
    const usageMetadata = result.response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;

    await db.collection('cost_tracking').insertOne({
      book_id: bookId,
      action: 'book_summary',
      model,
      pages_analyzed: translatedPages.length,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      created_at: new Date()
    });

    // Log to gemini_usage for auditing
    await logGeminiCall({
      type: 'summarize',
      mode: 'realtime',
      model,
      book_id: bookId,
      book_title: book?.title,
      page_count: translatedPages.length,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      status: 'success',
      endpoint: '/api/books/[id]/summarize',
    });

    return NextResponse.json(summary);
  } catch (error) {
    console.error('Error generating book summary:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate summary' },
      { status: 500 }
    );
  }
}

// GET: Retrieve existing summary
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();

    const book = await db.collection('books').findOne(
      { id: bookId },
      { projection: { reading_summary: 1 } }
    );

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    if (!book.reading_summary) {
      return NextResponse.json({ error: 'No summary generated yet' }, { status: 404 });
    }

    return NextResponse.json(book.reading_summary);
  } catch (error) {
    console.error('Error fetching book summary:', error);
    return NextResponse.json({ error: 'Failed to fetch summary' }, { status: 500 });
  }
}

// DELETE: Clear summary
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();

    const result = await db.collection('books').updateOne(
      { id: bookId },
      {
        $unset: { reading_summary: '' },
        $set: { updated_at: new Date() }
      }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error clearing summary:', error);
    return NextResponse.json({ error: 'Failed to clear summary' }, { status: 500 });
  }
}
