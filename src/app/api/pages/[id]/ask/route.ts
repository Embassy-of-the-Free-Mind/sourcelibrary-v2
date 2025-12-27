import { NextRequest, NextResponse } from 'next/server';
import { getGeminiClient } from '@/lib/gemini';
import { DEFAULT_MODEL } from '@/lib/types';
import { MODEL_PRICING } from '@/lib/ai';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pageId } = await params;
    const body = await request.json();
    const {
      question,
      history = [],
      pageText,
      bookTitle,
      bookAuthor,
      pageNumber
    } = body;

    if (!question) {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 });
    }

    if (!pageText) {
      return NextResponse.json({ error: 'Page text is required' }, { status: 400 });
    }

    const model = getGeminiClient().getGenerativeModel({ model: DEFAULT_MODEL });

    // Build context from book info
    const bookContext = [
      bookTitle && `"${bookTitle}"`,
      bookAuthor && `by ${bookAuthor}`,
    ].filter(Boolean).join(' ');

    // Build conversation history for context
    const conversationHistory = history.map((msg: Message) =>
      `${msg.role === 'user' ? 'Reader' : 'Assistant'}: ${msg.content}`
    ).join('\n\n');

    // Truncate page text if too long
    const truncatedText = pageText.length > 6000
      ? pageText.slice(0, 6000) + '\n\n[Text truncated for length]'
      : pageText;

    const prompt = `You are a helpful guide explaining historical texts to modern readers.

A reader is studying page ${pageNumber || '?'} from ${bookContext || 'a historical text'}.

Here is the text from this page:
---
${truncatedText}
---

${conversationHistory ? `Previous conversation:\n${conversationHistory}\n\n` : ''}The reader now asks: "${question}"

Please answer their question helpfully:
- Be concise but thorough
- Reference specific parts of the text when relevant
- Explain any archaic terms or concepts
- If the answer isn't in the text, say so honestly
- Keep a warm, conversational tone

Answer:`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const answer = response.text();

    // Track usage
    const usageMetadata = response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;

    return NextResponse.json({
      answer,
      pageId,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd: calculateCost(inputTokens, outputTokens, DEFAULT_MODEL),
        model: DEFAULT_MODEL,
      },
    });
  } catch (error) {
    console.error('Error answering question:', error);
    return NextResponse.json(
      { error: 'Failed to answer question' },
      { status: 500 }
    );
  }
}
