import { NextRequest, NextResponse } from 'next/server';
import { getGeminiClient } from '@/lib/gemini-client';

export const preferredRegion = 'fra1';

// Cache expansions in memory to avoid repeated AI calls for the same query
const expansionCache = new Map<string, { terms: string[]; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * POST /api/search/ai-expand
 * Uses Gemini Flash to expand a search query into alternative terms
 * that are more likely to match the Source Library corpus.
 *
 * Returns: { original: string, terms: string[], note: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return NextResponse.json({ original: query, terms: [], note: '' });
    }

    const normalized = query.trim().toLowerCase();

    // Check cache
    const cached = expansionCache.get(normalized);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({
        original: query,
        terms: cached.terms,
        note: 'AI-expanded search',
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ original: query, terms: [], note: '' });
    }

    const client = getGeminiClient();
    const model = client.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{
          text: `You are a search assistant for Source Library, a digital library of Western esoteric tradition texts (alchemy, Hermetica, Kabbalah, Rosicrucianism, natural philosophy, early modern science). Texts are from the 15th-18th centuries, mostly in Latin, German, English, and French.

A user searched for "${query}".

Generate 3-5 related search terms that would help them explore further. Consider:
- Latin equivalents (e.g., "philosopher's stone" → "lapis philosophorum")
- Historical spellings (e.g., "kabbalah" → "cabala")
- Author name variants (e.g., "Paracelsus" → "Theophrastus")
- Key related authors, works, or concepts in the tradition
- Broader or narrower terms

Return ONLY a JSON array of strings. Example: ["lapis philosophorum", "chrysopoeia", "Geber"]`
        }]
      }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 200,
      },
    });

    const text = result.response.text().trim();

    // Parse JSON array from response, handling markdown code blocks
    let terms: string[] = [];
    try {
      const jsonStr = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        terms = parsed
          .filter((t: unknown) => typeof t === 'string' && t.length >= 2)
          .slice(0, 5);
      }
    } catch {
      // If JSON parsing fails, try splitting by newlines/commas
      terms = text
        .replace(/[\[\]"]/g, '')
        .split(/[,\n]/)
        .map(t => t.trim())
        .filter(t => t.length >= 2)
        .slice(0, 5);
    }

    // Cache the result
    expansionCache.set(normalized, { terms, timestamp: Date.now() });

    // Evict old cache entries
    if (expansionCache.size > 500) {
      const now = Date.now();
      for (const [key, val] of expansionCache) {
        if (now - val.timestamp > CACHE_TTL) expansionCache.delete(key);
      }
    }

    return NextResponse.json({
      original: query,
      terms,
      note: 'AI-expanded search',
    });
  } catch (error) {
    console.error('AI expand error:', error);
    return NextResponse.json({ original: '', terms: [], note: '' });
  }
}
