import { NextRequest, NextResponse } from 'next/server';
import { getGeminiClient } from '@/lib/gemini';
import { DEFAULT_MODEL } from '@/lib/types';
import { MODEL_PRICING } from '@/lib/ai';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface SourceQuote {
  translation: string;
  page: number;
  bookTitle: string;
  author: string;
  citation: string;
}

function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

// Fetch author's works from Source Library API
async function fetchAuthorSources(searchTerms: string[]): Promise<SourceQuote[]> {
  const API_BASE = 'https://sourcelibrary.org/api';
  const sources: SourceQuote[] = [];
  const seenBooks = new Set<string>();

  try {
    // Search for each term and combine results
    for (const term of searchTerms.slice(0, 2)) { // Limit to first 2 terms
      const searchUrl = `${API_BASE}/search?q=${encodeURIComponent(term)}&has_translation=true&limit=8`;
      const searchRes = await fetch(searchUrl);

      if (!searchRes.ok) continue;

      const searchData = await searchRes.json();

      for (const result of (searchData.results || [])) {
        if (sources.length >= 3) break;
        if (seenBooks.has(result.book_id)) continue;
        seenBooks.add(result.book_id);

        try {
          // Use page_number if available (page result), otherwise pick a representative page
          const pageNum = result.page_number || 10;
          const quoteUrl = `${API_BASE}/books/${result.book_id}/quote?page=${pageNum}`;
          const quoteRes = await fetch(quoteUrl);

          if (quoteRes.ok) {
            const quoteData = await quoteRes.json();
            const translation = quoteData.quote?.translation || '';

            // Skip blank/empty pages
            if (translation.length < 100 || translation.includes('[[warning:')) {
              // Try a different page
              const altQuoteRes = await fetch(`${API_BASE}/books/${result.book_id}/quote?page=15`);
              if (altQuoteRes.ok) {
                const altData = await altQuoteRes.json();
                if (altData.quote?.translation && altData.quote.translation.length > 100) {
                  sources.push({
                    translation: altData.quote.translation.slice(0, 500),
                    page: altData.quote.page,
                    bookTitle: altData.quote.display_title || altData.quote.book_title,
                    author: altData.quote.author,
                    citation: altData.citation?.inline || `(${altData.quote.author}, p. ${altData.quote.page})`,
                  });
                }
              }
            } else {
              sources.push({
                translation: translation.slice(0, 500),
                page: quoteData.quote.page,
                bookTitle: quoteData.quote.display_title || quoteData.quote.book_title,
                author: quoteData.quote.author,
                citation: quoteData.citation?.inline || `(${quoteData.quote.author}, p. ${quoteData.quote.page})`,
              });
            }
          }
        } catch {
          // Skip failed quote fetches
        }
      }

      if (sources.length >= 3) break;
    }
  } catch (error) {
    console.error('Failed to fetch author sources:', error);
  }

  return sources;
}

function formatSourcesForPrompt(sources: SourceQuote[], personaName: string): string {
  if (sources.length === 0) return '';

  let text = `\nHere are excerpts from ${personaName}'s own works in the Source Library that you may cite:\n\n`;

  for (const source of sources) {
    text += `From "${source.bookTitle}" ${source.citation}:\n`;
    text += `"${source.translation}"\n\n`;
  }

  return text;
}

const DEFAULT_PROMPT = `You are a helpful guide explaining historical texts to modern readers.

A reader is studying page {page_number} from {book_context}.

Here is the text from this page:
---
{page_text}
---

{conversation_history}The reader now asks: "{question}"

Please answer their question helpfully:
- Be concise but thorough
- Reference specific parts of the text when relevant
- Explain any archaic terms or concepts
- If the answer isn't in the text, say so honestly
- Keep a warm, conversational tone

Answer:`;

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
      pageNumber,
      customPrompt,
      authorSearchTerms,
      personaName
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
    ].filter(Boolean).join(' ') || 'a historical text';

    // Build conversation history for context
    const conversationHistory = history.length > 0
      ? history.map((msg: Message) =>
          `${msg.role === 'user' ? 'Reader' : 'Assistant'}: ${msg.content}`
        ).join('\n\n') + '\n\n'
      : '';

    // Truncate page text if too long
    const truncatedText = pageText.length > 6000
      ? pageText.slice(0, 6000) + '\n\n[Text truncated for length]'
      : pageText;

    // Fetch author's sources from Source Library if search terms provided
    let authorSources = '';
    if (authorSearchTerms && authorSearchTerms.length > 0 && personaName) {
      const sources = await fetchAuthorSources(authorSearchTerms);
      authorSources = formatSourcesForPrompt(sources, personaName);
    }

    // Use custom prompt if provided, otherwise use default
    const promptTemplate = customPrompt || DEFAULT_PROMPT;

    // Replace variables in the prompt
    const prompt = promptTemplate
      .replace('{page_number}', pageNumber || '?')
      .replace('{book_context}', bookContext)
      .replace('{page_text}', truncatedText)
      .replace('{conversation_history}', conversationHistory)
      .replace('{author_sources}', authorSources)
      .replace('{question}', question);

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
