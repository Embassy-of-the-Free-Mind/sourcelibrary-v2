import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, book_title, book_author, page_number } = body;

    if (!text) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    if (text.length > 2000) {
      return NextResponse.json(
        { error: 'Text too long. Please select a shorter passage.' },
        { status: 400 }
      );
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const contextInfo = [
      book_title && `from "${book_title}"`,
      book_author && `by ${book_author}`,
      page_number && `(page ${page_number})`,
    ].filter(Boolean).join(' ');

    const prompt = `You are a helpful guide explaining historical texts to modern readers.

A reader is reading a passage ${contextInfo || 'from a historical text'} and wants to understand it better.

Here is the passage they selected:
"${text}"

Please explain this passage in plain, accessible English. Your explanation should:
1. Clarify any archaic or technical language
2. Provide brief historical/cultural context if relevant
3. Explain the main idea or argument
4. Keep it concise (2-3 short paragraphs max)

Write in a warm, conversational tone - like a knowledgeable friend explaining something interesting. Don't be condescending, but do assume the reader may not know specialized terms.

If the text references alchemical, philosophical, religious, or esoteric concepts, briefly explain what they mean in their historical context.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const explanation = response.text();

    return NextResponse.json({ explanation });
  } catch (error) {
    console.error('Error explaining text:', error);
    return NextResponse.json(
      { error: 'Failed to explain text' },
      { status: 500 }
    );
  }
}
