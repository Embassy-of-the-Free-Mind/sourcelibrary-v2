import { NextRequest } from 'next/server';
import { getGeminiClient } from '@/lib/gemini-client';
import { logAiUsage } from '@/lib/log-ai-usage';

export const preferredRegion = 'fra1';

// Cache full responses (narration + terms + display hint + image terms) to avoid repeated AI calls
const responseCache = new Map<string, { display: string; strategy: string; narration: string; terms: string[]; imageTerms: string[]; timestamp: number }>();
const STRATEGIES = ['navigational', 'conceptual', 'verbatim'];
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
      ...(cached.strategy ? [`event: strategy\ndata: ${JSON.stringify(cached.strategy)}\n`] : []),
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

  const _aiStart = Date.now();
  const country = request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || null;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const client = getGeminiClient({ endpoint: '/api/search/ai-expand', type: 'other' });
        // flash-lite follows structured format reliably and is 50% cheaper
        const model = client.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });

        const result = await model.generateContentStream({
          contents: [{
            role: 'user',
            parts: [{
              text: `You are a search guide for Source Library (16K+ books across 150+ languages, 24K+ artworks).

LIBRARY SCOPE — a global library of premodern thought. Strongest from antiquity through the 19th century; ancient and medieval sources are well represented and there are real (not sparse) holdings into the early 20th century. Western esoterica is the historic core, but the collection is much broader now — when a subject sits near one we hold, guide toward the nearest rich tradition rather than calling it out of scope. What's actually here:
- Western esoterica (the founding core): alchemy (Dorn, Khunrath, Ripley, Maier, Mylius, Trismosin, Flamel), Hermetica (Corpus Hermeticum, Ficino, Bruno, Trismegistus), Kabbalah (Zohar, Luria, Reuchlin, Knorr von Rosenroth), Renaissance natural magic (Agrippa, Della Porta, Dee, Paracelsus), Rosicrucian and Masonic texts, gnostic and apocryphal sources.
- Philosophy & religion (the largest core): classical philosophy and Neoplatonism (Plotinus, Proclus, Iamblichus), the history of philosophy broadly, Christian theology, biblical and patristic studies, mysticism.
- Science & medicine: natural philosophy, astronomy, mathematics, optics, medicine, botany and herbalism, materia medica — Newton, Galileo, Kepler, Huygens, and into the 19th century (Maxwell, Faraday, Rayleigh appear, though hard modern science is thinner).
- World traditions: the Tibetan Buddhist canon (large), Chinese classics and science, Sanskrit and Indic traditions, the ancient Near East (Sumerian/cuneiform, Egyptian, Syriac), Arabic and Hebrew sources.
- Also: literature, history, law, politics, geography, linguistics.
- Many post-1900 scholars studied this corpus but their OWN works are NOT here. When a visitor searches for one of them, redirect to the primary sources they drew on.

MODERN-FIGURE RULE — if the query names a scholar/author working primarily after ~1900 whose subject IS in the library:
- C.G. Jung / Carl Jung → alchemy sources he interpreted: Dorn, Khunrath, Ripley, Mylius, Rosarium Philosophorum, Splendor Solis, Aurora Consurgens, Mutus Liber, Atalanta Fugiens
- Mircea Eliade → primary religious/alchemical texts, gnostic sources, Mithraic and shamanic materials in the library
- Frances Yates → Bruno (De Umbris Idearum), Ficino, Dee, Fludd, Ramon Llull (Ars Magna)
- Gershom Scholem → Zohar, Lurianic Kabbalah, Sefer Yetzirah, Knorr von Rosenroth (Kabbala Denudata), Reuchlin
- Henry Corbin → Suhrawardi (Hikmat al-Ishraq), Ibn 'Arabi (Futuhat al-Makkiyya, Fusus al-Hikam), Avicenna
- Antoine Faivre / Wouter Hanegraaff → the esoteric primary-source canon broadly
For these queries: set HINT to not_in_collection, narration acknowledges the figure is out of scope but their sources are here, terms and image_terms point to those primary sources.

Query: "${query}"

Your job: help the visitor FIND more. Not explain — guide.

Reply in this EXACT XML format:
<display>HINT</display>
<strategy>STRATEGY</strategy>
<narration>One sentence (max 20 words). Point toward what to look for — a name, a title, a tradition. Not a definition or explanation. Think: "Try searching for X" or "The key figure here is X" or "Look in the Y tradition."</narration>
<terms>["term1","term2","term3","term4","term5"]</terms>
<image_terms>["artwork1","artwork2","artwork3"]</image_terms>

HINT = images_first | books_first | not_in_collection
- images_first: visual art, painting, diagram, illustration
- books_first: texts, concepts, authors, traditions
- not_in_collection: use SPARINGLY — only when the subject is genuinely far outside a premodern global library (e.g. a living pop-culture figure, a modern brand, a contemporary news event), OR a post-1900 scholar whose primary sources we hold. A premodern or 19th-century person, place, science, or tradition is almost never out of scope — narrate toward the nearest holdings instead, and never assert we lack something the search itself can find.

STRATEGY = navigational | conceptual | verbatim — how search should rank results
- navigational: looking for a specific known book/author/title (e.g. "boehme", "de occulta philosophia", "agrippa")
- conceptual: a theme, idea, or question spanning many works (e.g. "alchemy and the transformation of the soul")
- verbatim: hunting an exact phrase or quotation to locate its source

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

        // Log AI usage + cost (usageMetadata is available once the stream drains)
        try {
          const meta = (await result.response)?.usageMetadata;
          logAiUsage({
            feature: 'ai_search_expand',
            model: 'gemini-3.1-flash-lite',
            inputTokens: meta?.promptTokenCount || 0,
            outputTokens: meta?.candidatesTokenCount || 0,
            ms: Date.now() - _aiStart,
            ok: true,
            country,
          });
        } catch { /* never block the stream on logging */ }

        // Parse everything from complete text — no streaming narration (avoids tag leaks)
        console.log('[ai-expand] Full output:', JSON.stringify(fullText));

        if (!sentDisplay) {
          controller.enqueue(encoder.encode(`event: display\ndata: "books_first"\n\n`));
        }

        // Extract retrieval strategy (drives ladder-vs-RRF routing in /api/search).
        const strategyRaw = fullText.match(/<strategy>(.*?)<\/strategy>/)?.[1]?.trim() || '';
        const strategy = STRATEGIES.includes(strategyRaw) ? strategyRaw : '';
        if (strategy) {
          controller.enqueue(encoder.encode(`event: strategy\ndata: ${JSON.stringify(strategy)}\n\n`));
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
        responseCache.set(normalized, { display: displayHint, strategy, narration: narrationPart, terms: finalTerms, imageTerms, timestamp: Date.now() });

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
