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

// Prompt to analyze text and identify confusing elements
const ANALYZE_PROMPT = `You are helping a modern reader understand a historical text.

Analyze this passage and identify 3-6 specific things that might be confusing or interesting to explain:
- Archaic or unusual words/phrases
- Historical references (people, places, events)
- Technical or specialized concepts
- Metaphors or symbolic language
- Cultural context that's not obvious today

Text from {context}:
---
{text}
---

Return ONLY a JSON array of objects, each with:
- "term": the specific word, phrase, or concept (keep it short, 1-5 words)
- "type": one of "word", "reference", "concept", "metaphor", "context"
- "preview": a 5-10 word hint of what it means (tease, don't fully explain)

Example format:
[
  {"term": "the White Stone", "type": "concept", "preview": "An alchemical stage of purification"},
  {"term": "gross and subtle", "type": "word", "preview": "Dense matter vs refined essence"}
]

Return 3-6 items, most interesting first. JSON only, no other text:`;

// Prompt to explain a specific term/concept
const EXPLAIN_TERM_PROMPT = `You are a helpful guide explaining historical texts to modern readers.

A reader is studying a passage {context} and wants to understand a specific term or concept.

The passage:
---
{text}
---

The reader wants to understand: "{term}"

Explain this clearly in 2-3 short paragraphs:
1. What it literally means
2. Why it matters in this context
3. Any interesting background (if relevant)

Be warm and conversational, like a knowledgeable friend. Don't be condescending.`;

// Original full explanation prompt (fallback)
const FULL_EXPLAIN_PROMPT = `You are a helpful guide explaining historical texts to modern readers.

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
    const {
      text,
      book_title,
      book_author,
      page_number,
      customPrompt,
      mode = 'analyze', // 'analyze' | 'explain_term' | 'full'
      term // for explain_term mode
    } = body;

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
    ].filter(Boolean).join(' ') || 'from a historical text';

    let prompt: string;

    if (mode === 'analyze') {
      // Analyze mode: identify confusing elements
      prompt = ANALYZE_PROMPT
        .replace('{context}', contextInfo)
        .replace('{text}', text);
    } else if (mode === 'explain_term' && term) {
      // Explain a specific term
      prompt = (customPrompt || EXPLAIN_TERM_PROMPT)
        .replace('{context}', contextInfo)
        .replace('{text}', text)
        .replace('{term}', term);
    } else {
      // Full explanation (fallback or explicit)
      prompt = (customPrompt || FULL_EXPLAIN_PROMPT)
        .replace('{context}', contextInfo)
        .replace('{text}', text);
    }

    const result = await model.generateContent(prompt);
    const response = result.response;
    const responseText = response.text();

    // Track usage
    const usageMetadata = response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;

    // For analyze mode, parse the JSON response
    if (mode === 'analyze') {
      try {
        // Extract JSON from response (handle markdown code blocks)
        let jsonStr = responseText;
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }

        const items = JSON.parse(jsonStr);
        return NextResponse.json({
          items,
          usage: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            costUsd: calculateCost(inputTokens, outputTokens, DEFAULT_MODEL),
            model: DEFAULT_MODEL,
          },
        });
      } catch (parseError) {
        console.error('Failed to parse analyze response:', parseError, responseText);
        // Fallback: return as full explanation
        return NextResponse.json({
          explanation: responseText,
          usage: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            costUsd: calculateCost(inputTokens, outputTokens, DEFAULT_MODEL),
            model: DEFAULT_MODEL,
          },
        });
      }
    }

    return NextResponse.json({
      explanation: responseText,
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
