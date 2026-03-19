import { NextRequest } from 'next/server';
import { getGeminiClient } from '@/lib/gemini-client';

export const preferredRegion = 'fra1';

// Cache full responses (narration + terms) to avoid repeated AI calls
const responseCache = new Map<string, { narration: string; terms: string[]; timestamp: number }>();
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
      `event: narration\ndata: ${JSON.stringify(cached.narration)}\n`,
      `event: terms\ndata: ${JSON.stringify(cached.terms)}\n`,
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
        const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const result = await model.generateContentStream({
          contents: [{
            role: 'user',
            parts: [{
              text: `You are a search guide for Source Library, a digital library of Western esoteric texts (alchemy, Hermetica, Kabbalah, Rosicrucianism, natural philosophy, early modern science, 15th-18th century, Latin/German/English/French).

A user searched for "${query}".

Respond in TWO parts, separated by exactly "---TERMS---" on its own line:

PART 1: Write 1-2 brief, scholarly sentences (max 40 words) contextualizing this search within the tradition. Use italics for Latin/foreign terms. Be specific and knowledgeable, not generic. Don't say "Source Library" or "our collection." Write as if you're a knowledgeable librarian whispering helpful context.

PART 2: After the ---TERMS--- separator, write ONLY a JSON array of 3-5 alternative search terms. Include Latin equivalents, historical spellings, key authors, or related concepts.

Example response:
The *lapis philosophorum* was the supreme goal of chrysopoeia — the art of gold-making. Geber's *Summa Perfectionis* and Ripley's *Compound of Alchemy* are foundational texts.
---TERMS---
["lapis philosophorum", "chrysopoeia", "Geber", "George Ripley", "Summa Perfectionis"]`
            }]
          }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 300,
          },
        });

        let fullText = '';
        let sentTerms = false;
        let hitSeparator = false;

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (!text) continue;

          fullText += text;

          // Check if we've just hit the separator
          if (!hitSeparator && fullText.includes('---TERMS---')) {
            hitSeparator = true;
            // Send any trailing narration before the separator that wasn't sent yet
            // (the chunk that contains "---TERMS---" may have narration text before it)
            const separatorIdx = text.indexOf('---TERMS---');
            if (separatorIdx > 0) {
              controller.enqueue(encoder.encode(`event: narration\ndata: ${JSON.stringify(text.slice(0, separatorIdx))}\n\n`));
            }
          } else if (hitSeparator && !sentTerms) {
            // Accumulating terms JSON — try to parse on each chunk
            const [narration, termsSection] = fullText.split('---TERMS---');
            const termsText = termsSection?.trim();
            if (termsText) {
              try {
                const jsonStr = termsText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
                const parsed = JSON.parse(jsonStr);
                if (Array.isArray(parsed)) {
                  const terms = parsed.filter((t: unknown) => typeof t === 'string' && t.length >= 2).slice(0, 5);
                  controller.enqueue(encoder.encode(`event: terms\ndata: ${JSON.stringify(terms)}\n\n`));
                  sentTerms = true;
                  responseCache.set(normalized, { narration: narration.trim(), terms, timestamp: Date.now() });
                }
              } catch {
                // JSON not complete yet
              }
            }
          } else if (!hitSeparator) {
            // Still in narration part — stream delta
            controller.enqueue(encoder.encode(`event: narration\ndata: ${JSON.stringify(text)}\n\n`));
          }
        }

        // Final attempt to parse terms if not yet sent
        if (!sentTerms && fullText.includes('---TERMS---')) {
          const [narration, termsSection] = fullText.split('---TERMS---');
          const termsText = termsSection?.trim();
          if (termsText) {
            try {
              const jsonStr = termsText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
              const parsed = JSON.parse(jsonStr);
              if (Array.isArray(parsed)) {
                const terms = parsed.filter((t: unknown) => typeof t === 'string' && t.length >= 2).slice(0, 5);
                controller.enqueue(encoder.encode(`event: terms\ndata: ${JSON.stringify(terms)}\n\n`));
                responseCache.set(normalized, { narration: narration.trim(), terms, timestamp: Date.now() });
              }
            } catch {
              // Parse failed, send empty terms
              controller.enqueue(encoder.encode(`event: terms\ndata: []\n\n`));
            }
          }
        } else if (!sentTerms) {
          // No separator found — model didn't follow format. Still try to extract terms.
          controller.enqueue(encoder.encode(`event: terms\ndata: []\n\n`));
        }

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
