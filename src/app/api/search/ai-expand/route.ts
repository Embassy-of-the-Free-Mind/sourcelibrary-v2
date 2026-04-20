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
        const model = client.getGenerativeModel({ model: 'gemini-3-flash-preview' });

        const result = await model.generateContentStream({
          contents: [{
            role: 'user',
            parts: [{
              text: `You are a search guide for Source Library, a digital library of over 10,000 pre-modern primary sources AND 18,000+ historical artworks/illustrations. The collection includes: Western alchemy and Hermetica, Kabbalah, Rosicrucianism, natural philosophy, early modern science, Sanskrit texts (rasayana, Tantra, Vedanta, Ayurveda), Chinese and Japanese classics, Arabic and Islamic philosophy, Egyptian and Near Eastern sources, Korean and Southeast Asian manuscripts, Tibetan Buddhism, and more. Artwork includes paintings, engravings, woodcuts, manuscript illuminations, alchemical emblems, scientific diagrams, and portraits from these traditions. Languages include Latin, Greek, Arabic, Sanskrit, Hebrew, German, English, French, Italian, Dutch, Chinese, Japanese, Korean, and many others. Dates range from antiquity through the 19th century.

A user searched for "${query}".

Respond in THREE parts, separated by "---DISPLAY---" and "---TERMS---" on their own lines:

PART 1 (DISPLAY HINT): Write ONLY one of these exact words on the first line:
- "images_first" — if the user is clearly looking for a visual artwork, painting, illustration, or image (e.g., "school of athens", "tree of life diagram", "alchemical emblems", "Bosch garden")
- "books_first" — if the user wants texts, concepts, authors, or ideas (e.g., "alchemy", "Paracelsus", "mystical ecstasy", "kabbalah")
- "not_in_collection" — if the query is about something clearly outside the collection's scope (e.g., "Taylor Swift", "quantum computing", "goya" — we have pre-modern sources, not modern/19th-century+ art unless it relates to esoteric traditions)

When uncertain, default to "books_first".

PART 2 (NARRATION): After "---DISPLAY---", write 1-2 brief, scholarly sentences (max 40 words) contextualizing this search. Use italics for Latin/foreign terms. Be specific, not generic. Don't say "Source Library" or "our collection." Write as if you're a knowledgeable librarian whispering helpful context. If "not_in_collection", briefly explain what IS available that's related.

PART 3 (TERMS): After "---TERMS---", write ONLY a JSON array of 3-5 alternative search terms for BOOKS (authors, titles, concepts, original-language equivalents).

PART 4 (IMAGE TERMS): After "---IMAGE_TERMS---", write ONLY a JSON array of 2-4 search terms to find IMAGES related to this query. Don't just rephrase the query — think about what specific artworks, famous paintings, engravings, diagrams, or illustrations actually depict this subject. Name specific works, artists, or iconographic subjects that a pre-modern art collection would contain. Examples:
- "mystical ecstasy" → ["Bernini Teresa", "Hildegard visions", "stigmata", "ascension"] (specific artworks depicting ecstasy)
- "alchemy" → ["alchemical furnace", "philosopher's stone emblem", "distillation apparatus"] (things you'd see in alchemical illustrations)
- "Paracelsus" → ["portrait Paracelsus", "iatrochemistry laboratory", "Paracelsus woodcut"] (visual depictions of the person/practice)

Skip this section entirely if images genuinely aren't relevant.

Example response:
images_first
---DISPLAY---
Raphael's fresco depicts the great philosophers of antiquity — Plato, Aristotle, Pythagoras — in the Vatican's *Stanza della Segnatura*. Many of their works are in the collection.
---TERMS---
["Plato Aristotle", "Stanza della Segnatura", "Raphael Vatican"]
---IMAGE_TERMS---
["School of Athens", "Raphael philosophers", "Plato Aristotle fresco"]`
            }]
          }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 400,
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
