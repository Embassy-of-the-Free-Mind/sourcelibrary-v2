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
              text: `You are a search guide for Source Library (pre-modern primary sources: 10K+ books, 18K+ artworks).

Query: "${query}"

Your job: help the visitor FIND more. Not explain — guide.

Reply in this EXACT XML format:
<display>HINT</display>
<narration>One sentence (max 20 words). Point toward what to look for — a name, a title, a tradition. Not a definition or explanation. Think: "Try searching for X" or "The key figure here is X" or "Look in the Y tradition."</narration>
<terms>["term1","term2","term3","term4","term5"]</terms>
<image_terms>["artwork1","artwork2","artwork3"]</image_terms>

HINT = images_first | books_first | not_in_collection
- images_first: visual art, painting, diagram, illustration
- books_first: texts, concepts, authors, traditions
- not_in_collection: outside scope

TERMS = 3-5 search terms the visitor wouldn't think of — period-appropriate synonyms, Latin titles, original-language names, specific authors. These DRIVE additional searches.
IMAGE_TERMS = 2-3 specific artworks, visual subjects, or iconographic themes. These DRIVE gallery image searches.

The terms and image_terms are the most important part — they expand the search. The narration is secondary.`
            }]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 250,
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

          // Emit display hint early so layout can adjust
          if (!sentDisplay) {
            const displayMatch = fullText.match(/<display>(.*?)<\/display>/);
            if (displayMatch) {
              const hint = ['images_first', 'books_first', 'not_in_collection'].includes(displayMatch[1].trim())
                ? displayMatch[1].trim() : 'books_first';
              controller.enqueue(encoder.encode(`event: display\ndata: ${JSON.stringify(hint)}\n\n`));
              sentDisplay = true;
            }
          }
        }

        // Parse everything from complete text — no streaming narration (avoids tag leaks)
        console.log('[ai-expand] Full output:', JSON.stringify(fullText));

        if (!sentDisplay) {
          controller.enqueue(encoder.encode(`event: display\ndata: "books_first"\n\n`));
        }

        // Extract narration — clean, complete, no tag fragments
        const narrationMatch = fullText.match(/<narration>([\s\S]*?)<\/narration>/);
        const narrationPart = narrationMatch ? narrationMatch[1].trim() : '';
        if (narrationPart) {
          controller.enqueue(encoder.encode(`event: narration\ndata: ${JSON.stringify(narrationPart)}\n\n`));
        }

        // Parse terms
        let finalTerms: string[] = [];
        const termsMatch = fullText.match(/<terms>([\s\S]*?)<\/terms>/);
        if (termsMatch) {
          try {
            const parsed = JSON.parse(termsMatch[1].trim());
            if (Array.isArray(parsed)) {
              finalTerms = parsed.filter((t: unknown) => typeof t === 'string' && t.length >= 2).slice(0, 5);
            }
          } catch { /* parse failed */ }
        }
        controller.enqueue(encoder.encode(`event: terms\ndata: ${JSON.stringify(finalTerms)}\n\n`));

        // Parse image_terms
        let imageTerms: string[] = [];
        const imgMatch = fullText.match(/<image_terms>([\s\S]*?)<\/image_terms>/);
        if (imgMatch) {
          try {
            const parsed = JSON.parse(imgMatch[1].trim());
            if (Array.isArray(parsed)) {
              imageTerms = parsed.filter((t: unknown) => typeof t === 'string' && t.length >= 2).slice(0, 4);
            }
          } catch { /* no image terms */ }
        }
        if (imageTerms.length > 0) {
          controller.enqueue(encoder.encode(`event: image_terms\ndata: ${JSON.stringify(imageTerms)}\n\n`));
        }

        // Cache
        const displayHint = fullText.match(/<display>(.*?)<\/display>/)?.[1]?.trim() || 'books_first';
        responseCache.set(normalized, { display: displayHint, narration: narrationPart, terms: finalTerms, imageTerms, timestamp: Date.now() });

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
