import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { DEFAULT_MODEL } from '@/lib/types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const SECTION_SUMMARY_PROMPT = `You are creating a reading guide for a section of a historical text.

**Your task:** Analyze the translated pages and create:
1. A clear, engaging summary (2-3 paragraphs) that helps readers understand what this section covers
2. 2-4 key quotes that capture the essence or most interesting ideas
3. A list of key concepts/terms introduced in this section

**Format your response as JSON:**
{
  "summary": "Your 2-3 paragraph summary here...",
  "quotes": [
    { "text": "Exact quote from the translation", "page": 5 },
    { "text": "Another notable quote", "page": 8 }
  ],
  "concepts": ["Concept One", "Concept Two", "Technical Term"]
}

**Guidelines:**
- Write the summary for an educated general reader, not a specialist
- Choose quotes that are memorable, surprising, or essential to understanding
- Keep quotes concise (1-3 sentences max)
- Include page numbers for quotes so readers can find the original
- List 3-6 key concepts, especially technical terms or ideas central to the section

**IMPORTANT:** Return ONLY valid JSON, no markdown formatting or extra text.`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();
    const body = await request.json();

    const { sectionId, startPage, endPage, model = DEFAULT_MODEL } = body;

    if (!startPage || !endPage) {
      return NextResponse.json({ error: 'startPage and endPage required' }, { status: 400 });
    }

    // Get pages in range with translations
    const pages = await db.collection('pages')
      .find({
        book_id: bookId,
        page_number: { $gte: startPage, $lte: endPage }
      })
      .sort({ page_number: 1 })
      .toArray();

    // Gather translations
    const translatedPages = pages.filter(p => p.translation?.data);
    if (translatedPages.length === 0) {
      return NextResponse.json({
        error: 'No translated pages in this section'
      }, { status: 400 });
    }

    // Build context from translations
    const context = translatedPages.map(p => {
      // Strip [[tags]] for cleaner reading
      const cleanText = (p.translation?.data || '')
        .replace(/\[\[[^\]]+\]\]/g, '')
        .trim();
      return `--- Page ${p.page_number} ---\n${cleanText}`;
    }).join('\n\n');

    // Generate summary
    const aiModel = genAI.getGenerativeModel({ model });
    const prompt = `${SECTION_SUMMARY_PROMPT}\n\n**Section pages (${startPage}-${endPage}):**\n\n${context}`;

    const result = await aiModel.generateContent(prompt);
    const responseText = result.response.text();

    // Parse JSON response
    let parsed;
    try {
      // Try to extract JSON from response (in case there's extra text)
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

    // Update the section in the book if sectionId provided
    if (sectionId) {
      await db.collection('books').updateOne(
        { id: bookId, 'reading_sections.id': sectionId },
        {
          $set: {
            'reading_sections.$.summary': parsed.summary,
            'reading_sections.$.quotes': parsed.quotes,
            'reading_sections.$.concepts': parsed.concepts,
            'reading_sections.$.generated_at': new Date(),
            updated_at: new Date()
          }
        }
      );
    }

    // Track usage
    const usageMetadata = result.response.usageMetadata;
    await db.collection('cost_tracking').insertOne({
      book_id: bookId,
      action: 'section_summary',
      model,
      section_id: sectionId,
      pages_analyzed: translatedPages.length,
      input_tokens: usageMetadata?.promptTokenCount || 0,
      output_tokens: usageMetadata?.candidatesTokenCount || 0,
      created_at: new Date()
    });

    return NextResponse.json({
      summary: parsed.summary,
      quotes: parsed.quotes,
      concepts: parsed.concepts,
      pagesAnalyzed: translatedPages.length
    });
  } catch (error) {
    console.error('Error generating section summary:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate summary' },
      { status: 500 }
    );
  }
}
