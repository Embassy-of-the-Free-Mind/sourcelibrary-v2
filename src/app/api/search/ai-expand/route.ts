import { NextRequest } from 'next/server';
import { getGeminiClient } from '@/lib/gemini-client';

export const preferredRegion = 'fra1';

// Cache full responses (narration + terms + display hint + image terms) to avoid repeated AI calls
const responseCache = new Map<string, { display: string; narration: string; terms: string[]; imageTerms: string[]; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * POST /api/search/ai-expand — Streaming SSE endpoint
 *
 * Streams two types of events:
 *   event: narration  — incremental text chunks describing the search context
 *   event: terms      — JSON array of expanded search terms
 *   event: done       — signals stream end
 *
 * Uses gemini-2.0-flash for fastest TTFB on streaming.
 */
export async function POST(request: NextRequest) {
  const { query } = await request.json().catch(() => ({ query: '' }));

  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return new Response('data: {"event":"done"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }

  const normalized = query.trim().toLowerCase();

  // Check cache — replay instantly as SSE
  const cached = responseCache.get(normalized);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    const lines = [
      `event: display\ndata: ${JSON.stringify(cached.display)}\n`,
      `event: narration\ndata: ${JSON.stringify(cached.narration)}\n`,
      `event: terms\ndata: ${JSON.stringify(cached.terms)}\n`,
      ...(cached.imageTerms.length > 0 ? [`event: image_terms\ndata: ${JSON.stringify(cached.imageTerms)}\n`] : []),
      `event: done\ndata: {}\n`,
    ].join('\n');
    return new Response(lines, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response('event: done\ndata: {}\n\n', {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const client = getGeminiClient();
        // flash-lite follows structured format reliably and is 50% cheaper
        const model = client.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

        const result = await model.generateContentStream({
          contents: [{
            role: 'user',
            parts: [{
              text: `Search guide for a pre-modern primary source library (10K+ books, 18K+ artworks spanning alchemy, Hermetica, Kabbalah, natural philosophy, Sanskrit, Chinese, Arabic, and more).

Query: "${query}"

Reply EXACTLY in this format (no extra text):
DISPLAY_HINT
---DISPLAY---
2-3 sentences of scholarly context (40-80 words). Explain what this is, name key texts/authors/traditions, and what the searcher will find. Use *italics* for foreign terms and titles. Be substantive — this is the reader's first encounter with the topic.
---TERMS---
["term1","term2","term3"]
---IMAGE_TERMS---
["artwork1","artwork2"]

DISPLAY_HINT is one of: images_first, books_first, not_in_collection
- images_first: user wants a visual artwork/painting/diagram (e.g., "school of athens", "tree of life diagram")
- books_first: user wants texts/concepts/authors (e.g., "alchemy", "Paracelsus", "mystical ecstasy")
- not_in_collection: query is outside scope (modern art, pop culture). Explain what IS available.
Default to books_first when uncertain.

TERMS = 3-5 alternative book search terms (authors, titles, Latin/original-language equivalents)
IMAGE_TERMS = 2-4 specific artworks, visual subjects, or iconographic themes that a pre-modern art collection would contain. Think of actual paintings, engravings, diagrams — not synonyms.`
            }]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 500,
          },
        });

        // Simple approach: accumulate full text, stream narration chunks,
        // parse everything structured from the complete text at the end.
        let fullText = '';
        let sentDisplay = false;
        let inNarration = false;

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (!text) continue;
          fullText += text;

          // Emit display hint as soon as we see ---DISPLAY---
          if (!sentDisplay && fullText.includes('---DISPLAY---')) {
            const displayPart = fullText.split('---DISPLAY---')[0].trim();
            const hint = ['images_first', 'books_first', 'not_in_collection'].includes(displayPart)
              ? displayPart : 'books_first';
            controller.enqueue(encoder.encode(`event: display\ndata: ${JSON.stringify(hint)}\n\n`));
            sentDisplay = true;
            inNarration = true;
          }

          // Stream narration chunks (between ---DISPLAY--- and ---TERMS---)
          if (inNarration && !fullText.includes('---TERMS---')) {
            // Only send text that's clearly narration (after ---DISPLAY---, before ---TERMS---)
            if (!text.includes('---DISPLAY---')) {
              controller.enqueue(encoder.encode(`event: narration\ndata: ${JSON.stringify(text)}\n\n`));
            } else {
              // This chunk contains ---DISPLAY--- — send only the part after it
              const afterSep = text.split('---DISPLAY---').pop() || '';
              if (afterSep.trim()) {
                controller.enqueue(encoder.encode(`event: narration\ndata: ${JSON.stringify(afterSep)}\n\n`));
              }
            }
          }
          if (fullText.includes('---TERMS---')) inNarration = false;
        }

        // Debug: log full model output
        console.log('[ai-expand] Full output:', JSON.stringify(fullText));

        // Parse everything from complete text
        if (!sentDisplay) {
          controller.enqueue(encoder.encode(`event: display\ndata: "books_first"\n\n`));
        }

        // Extract narration
        const narrationPart = fullText.includes('---DISPLAY---')
          ? (fullText.split('---DISPLAY---')[1] || '').split('---TERMS---')[0].trim()
          : fullText.split('---TERMS---')[0].trim();
        // If narration wasn't streamed (no ---DISPLAY---), send it now
        if (!sentDisplay && narrationPart) {
          controller.enqueue(encoder.encode(`event: narration\ndata: ${JSON.stringify(narrationPart)}\n\n`));
        }

        // Parse terms (between ---TERMS--- and ---IMAGE_TERMS---)
        let finalTerms: string[] = [];
        if (fullText.includes('---TERMS---')) {
          const afterTerms = (fullText.split('---TERMS---')[1] || '').split('---IMAGE_TERMS---')[0].trim();
          try {
            const parsed = JSON.parse(afterTerms.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
            if (Array.isArray(parsed)) {
              finalTerms = parsed.filter((t: unknown) => typeof t === 'string' && t.length >= 2).slice(0, 5);
            }
          } catch { /* parse failed */ }
        }
        controller.enqueue(encoder.encode(`event: terms\ndata: ${JSON.stringify(finalTerms)}\n\n`));

        // Parse image_terms (after ---IMAGE_TERMS---)
        let imageTerms: string[] = [];
        if (fullText.includes('---IMAGE_TERMS---')) {
          const afterImageSep = fullText.split('---IMAGE_TERMS---').pop()?.trim() || '';
          try {
            const parsed = JSON.parse(afterImageSep.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
            if (Array.isArray(parsed)) {
              imageTerms = parsed.filter((t: unknown) => typeof t === 'string' && t.length >= 2).slice(0, 4);
            }
          } catch { /* no image terms */ }
        }
        if (imageTerms.length > 0) {
          controller.enqueue(encoder.encode(`event: image_terms\ndata: ${JSON.stringify(imageTerms)}\n\n`));
        }

        // Cache
        responseCache.set(normalized, { display: sentDisplay ? fullText.split('---DISPLAY---')[0].trim() : 'books_first', narration: narrationPart, terms: finalTerms, imageTerms, timestamp: Date.now() });

        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
        controller.close();
      } catch (error) {
        console.error('AI expand stream error:', error);
        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
        controller.close();
      }

      // Evict old cache entries
      if (responseCache.size > 500) {
        const now = Date.now();
        for (const [key, val] of responseCache) {
          if (now - val.timestamp > CACHE_TTL) responseCache.delete(key);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
