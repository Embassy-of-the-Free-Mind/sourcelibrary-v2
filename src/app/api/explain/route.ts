import { NextRequest, NextResponse } from 'next/server';
import { getGeminiClient } from '@/lib/gemini';
import { DEFAULT_MODEL } from '@/lib/types';
import { MODEL_PRICING } from '@/lib/ai';

function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

const DEFAULT_PROMPT = `You are a helpful guide explaining historical texts to modern readers.

A reader is reading a passage {context} and wants to understand it better.

Here is the passage they selected:
"{text}"

Please explain this passage in plain, accessible English. Your explanation should:
1. Clarify any archaic or technical language
2. Provide brief historical/cultural context if relevant
3. Explain the main idea or argument
4. Keep it concise (2-3 short paragraphs max)

Write in a warm, conversational tone - like a knowledgeable friend explaining something interesting. Don't be condescending, but do assume the reader may not know specialized terms.

If the text references alchemical, philosophical, religious, or esoteric concepts, briefly explain what they mean in their historical context.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, book_title, book_author, page_number, customPrompt } = body;

    if (!text) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    // Allow up to 8000 chars for full page explanations
    if (text.length > 8000) {
      return NextResponse.json(
        { error: 'Text too long. Please select a shorter passage.' },
        { status: 400 }
      );
    }

    const model = getGeminiClient().getGenerativeModel({ model: DEFAULT_MODEL });

    // Build context string
    const contextInfo = [
      book_title && `from "${book_title}"`,
      book_author && `by ${book_author}`,
      page_number && `(page ${page_number})`,
    ].filter(Boolean).join(' ');

    // Use custom prompt if provided, otherwise use default
    const promptTemplate = customPrompt || DEFAULT_PROMPT;

    // Replace variables in the prompt
    const prompt = promptTemplate
      .replace('{context}', contextInfo || 'from a historical text')
      .replace('{text}', text);

    const result = await model.generateContent(prompt);
    const response = result.response;
    const explanation = response.text();

    // Track usage
    const usageMetadata = response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;

    return NextResponse.json({
      explanation,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd: calculateCost(inputTokens, outputTokens, DEFAULT_MODEL),
        model: DEFAULT_MODEL,
      },
    });
  } catch (error) {
    console.error('Error explaining text:', error);
    return NextResponse.json(
      { error: 'Failed to explain text' },
      { status: 500 }
    );
  }
}
