import { NextRequest, NextResponse } from 'next/server';
import { getNextApiKey } from '@/lib/gemini-client';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 30;

const IDENTIFY_PROMPT = `You are an art historian identifying a physical artwork or book page from a photograph taken in a museum or library.

Analyze this photograph and extract identifying information. The image may be:
- A print, engraving, or painting on a wall
- A page from an open book or manuscript
- A book cover or spine
- A detail/close-up of any of the above

Return JSON with these fields:
{
  "artist": "Artist name if identifiable (from style, signature, or monogram). Null if unknown.",
  "title": "Best guess at the title of this specific work. Null if unknown.",
  "inscriptions": "ALL visible text — transcribe every inscription, caption, verse, label, publisher line, plate number. Preserve line breaks. Null if none.",
  "subject": "Brief description of what is depicted (e.g., 'Saint John with eagle', 'alchemical laboratory', 'title page of a Latin treatise').",
  "medium": "print | painting | drawing | manuscript | book | photograph | unknown",
  "period_guess": "Approximate century or date range (e.g., '16th century', 'c. 1580').",
  "search_terms": ["Array of 3-5 key search terms to find this work in a library catalog — include artist surname, key figures, distinctive words from inscriptions"]
}

RULES:
- Be SPECIFIC. Identify the actual scene, figures, and any text.
- Transcribe ALL visible text, even partially legible text (use [?] for uncertain characters).
- If you recognize the artist's style or monogram, name them.
- Return valid JSON only. No markdown, no commentary.`;

interface IdentifyResult {
  artist?: string | null;
  title?: string | null;
  inscriptions?: string | null;
  subject?: string | null;
  medium?: string;
  period_guess?: string;
  search_terms?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('image') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // Convert to base64
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString('base64');
    const mimeType = file.type || 'image/jpeg';

    // Call Gemini vision
    const apiKey = getNextApiKey();
    const model = 'gemini-3.1-flash-lite-preview';
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: IDENTIFY_PROMPT },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          }],
          generationConfig: { temperature: 0.1 },
        }),
      },
    );

    if (!resp.ok) {
      const err = await resp.text();
      console.error('[identify] Gemini error:', resp.status, err);
      return NextResponse.json({ error: 'Vision API failed' }, { status: 502 });
    }

    const geminiData = await resp.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON from response
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    let identification: IdentifyResult;
    try {
      identification = JSON.parse(jsonMatch[1].trim());
    } catch {
      return NextResponse.json({ error: 'Failed to parse vision response', raw: text.substring(0, 500) }, { status: 500 });
    }

    // Search the library for matches
    const db = await getDb();
    const books = db.collection('books');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matches: any[] = [];

    // Strategy 1: Artist + title regex (strongest signal)
    if (identification.artist) {
      const artistRegex = identification.artist.split(/\s+/).pop() || identification.artist;
      const artistQuery: Record<string, unknown> = {
        author: { $regex: artistRegex, $options: 'i' },
        $or: [
          { pages_count: { $gt: 0 } },
          { resource_type: { $exists: true } },
        ],
      };

      const artistBooks = await books
        .find(artistQuery, {
          projection: {
            _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1,
            published: 1, thumbnail: 1, thumbnail_blob: 1, resource_type: 1,
            'enrichment.subject': 1, 'enrichment.inscriptions': 1,
          },
          maxTimeMS: 8000,
        })
        .limit(50)
        .toArray();

      // Score each match by how many search terms appear in its fields
      const terms = identification.search_terms || [];
      const scored = artistBooks.map(book => {
        const haystack = [
          book.title, book.display_title, book.author,
          book.enrichment?.subject, book.enrichment?.inscriptions,
        ].filter(Boolean).join(' ').toLowerCase();

        let score = 10; // Base score for artist match
        for (const term of terms) {
          if (haystack.includes(term.toLowerCase())) score += 5;
        }
        // Title match bonus
        if (identification.title) {
          const titleWords = identification.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
          for (const w of titleWords) {
            if (haystack.includes(w)) score += 3;
          }
        }
        // Inscription match bonus
        if (identification.inscriptions && book.enrichment?.inscriptions) {
          const inscWords = identification.inscriptions.toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 10);
          for (const w of inscWords) {
            if (book.enrichment.inscriptions.toLowerCase().includes(w)) score += 4;
          }
        }
        return { ...book, _score: score };
      });

      scored.sort((a, b) => b._score - a._score);
      matches.push(...scored.slice(0, 10));
    }

    // Strategy 2: Search terms against title/display_title (fallback if no artist or few matches)
    if (matches.length < 3 && identification.search_terms?.length) {
      const termQueries = identification.search_terms
        .filter(t => t.length > 2)
        .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

      if (termQueries.length > 0) {
        const termRegex = termQueries.join('|');
        const existingIds = new Set(matches.map(m => m.id));

        const termBooks = await books
          .find(
            {
              $or: [
                { title: { $regex: termRegex, $options: 'i' } },
                { display_title: { $regex: termRegex, $options: 'i' } },
                { 'enrichment.subject': { $regex: termRegex, $options: 'i' } },
                { 'enrichment.inscriptions': { $regex: termRegex, $options: 'i' } },
              ],
              $and: [
                { $or: [{ pages_count: { $gt: 0 } }, { resource_type: { $exists: true } }] },
              ],
            },
            {
              projection: {
                _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1,
                published: 1, thumbnail: 1, thumbnail_blob: 1, resource_type: 1,
                'enrichment.subject': 1,
              },
              maxTimeMS: 8000,
            },
          )
          .limit(20)
          .toArray();

        for (const book of termBooks) {
          if (!existingIds.has(book.id)) {
            matches.push({ ...book, _score: 5 });
          }
        }
      }
    }

    return NextResponse.json({
      identification,
      matches: matches.slice(0, 10).map(({ _score, enrichment, ...rest }) => ({
        ...rest,
        score: _score,
        subject: enrichment?.subject,
      })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[identify] Error:', msg);
    return NextResponse.json({ error: 'Identification failed', detail: msg }, { status: 500 });
  }
}
