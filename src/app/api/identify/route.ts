import { NextRequest, NextResponse } from 'next/server';
import { getNextApiKey } from '@/lib/gemini-client';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

// Max image size: 4MB (Vercel serverless body limit is 4.5MB)
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const IDENTIFY_PROMPT = `You are an art historian identifying a physical artwork or book page from a photograph taken in a museum or library.

Analyze this photograph and extract identifying information. The image may be:
- A print, engraving, or painting on a wall
- A page from an open book or manuscript
- A book cover or spine
- A detail/close-up of any of the above

CRITICAL: Read ALL text in the image FIRST, before making any attributions. Inscriptions on prints and engravings contain authoritative information about who made the work:
- "invenit" / "inv." / "pinxit" = the designer/painter (the creative author)
- "fecit" / "fe." / "sculpsit" / "sc." / "incidit" / "del." = the engraver
- "excudit" / "exc." / "excud." = the publisher/printer
- Signatures, monograms, and dates are also authoritative
These inscriptions OVERRIDE any guess based on visual style. Never attribute a work to an artist based on style alone when inscriptions name specific people.

Return JSON with these fields:
{
  "artist": "Primary creator. Use inscriptions first: 'invenit' names the designer, 'fecit'/'sculpsit' names the engraver. Format: 'Engraver (after Designer)' when both are named. Only fall back to style-based guesses if no inscriptions name the creator. Null if truly unknown.",
  "title": "Best guess at the title of this specific work. Null if unknown.",
  "inscriptions": "ALL visible text — transcribe every inscription, caption, verse, label, publisher line, plate number. Preserve line breaks. Null if none.",
  "publisher": "Person or firm named with 'excudit'/'exc.' in inscriptions. Null if none.",
  "subject": "Brief description of what is depicted (e.g., 'Saint John with eagle', 'alchemical laboratory', 'Allegory of Arithmetic'). Use the inscriptions and any Latin/vernacular text to inform the subject — do not guess the iconography when the text tells you.",
  "medium": "print | painting | drawing | manuscript | book | photograph | unknown",
  "period_guess": "Approximate century or date range (e.g., '16th century', 'c. 1580').",
  "confidence": "high | medium | low — high if inscriptions name the creator or the work is well-known; medium if attribution is from style/iconography; low if guessing",
  "confidence_reason": "One sentence explaining what evidence supports your identification (e.g., 'Inscriptions name Drebbel as engraver and Klobius as designer' or 'Attributed by style — no inscriptions visible').",
  "alternative_identifications": [
    {
      "artist": "Alternative artist attribution if plausible",
      "title": "Alternative title",
      "reasoning": "Why this is a possibility"
    }
  ],
  "search_terms": ["Array of 3-5 key search terms to find this work in a library catalog — include all names from inscriptions (invenit, fecit, excudit), key figures, distinctive words from inscriptions"]
}

RULES:
- Read and transcribe ALL visible text FIRST, even partially legible text (use [?] for uncertain characters).
- Use inscriptions as the primary evidence for attribution — they are more reliable than visual style.
- Be SPECIFIC about the subject. Identify the actual scene, figures, and any allegorical meaning.
- Include ALL names found in inscriptions in search_terms, not just the artist.
- If there are multiple plausible identifications, list alternatives ranked by likelihood.
- Return valid JSON only. No markdown, no commentary.`;

interface AlternativeIdentification {
  artist?: string | null;
  title?: string | null;
  reasoning?: string;
}

interface IdentifyResult {
  artist?: string | null;
  title?: string | null;
  inscriptions?: string | null;
  publisher?: string | null;
  subject?: string | null;
  medium?: string;
  period_guess?: string;
  confidence?: 'high' | 'medium' | 'low';
  confidence_reason?: string;
  alternative_identifications?: AlternativeIdentification[];
  search_terms?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('image') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: `Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 4MB.` },
        { status: 400 },
      );
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
      const detail = resp.status === 429 ? 'Rate limited — try again in a moment' : `Vision API error (${resp.status})`;
      return NextResponse.json({ error: detail }, { status: 502 });
    }

    const geminiData = await resp.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON from response
    if (!text) {
      return NextResponse.json({ error: 'Vision API returned empty response — try a different image' }, { status: 502 });
    }
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = (jsonMatch?.[1] || text).trim();
    let identification: IdentifyResult;
    try {
      identification = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json({ error: 'Could not parse vision response — try a clearer image', detail: text.substring(0, 300) }, { status: 500 });
    }

    // Search the library for matches
    const db = await getDb();
    const books = db.collection('books');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matches: any[] = [];

    // Strategy 1: Artist + title regex (strongest signal)
    if (identification.artist) {
      const artistLast = identification.artist.split(/\s+/).pop() || identification.artist;
      const artistRegex = artistLast.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        .toArray()
        .catch(() => []);

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
          .toArray()
          .catch(() => []);

        for (const book of termBooks) {
          if (!existingIds.has(book.id)) {
            matches.push({ ...book, _score: 5 });
          }
        }
      }
    }

    // Phase 2: Find the exact page within top book matches using inscription text
    const topMatches = matches.slice(0, 5);
    const pages = db.collection('pages');

    // Build search terms from inscriptions — pick distinctive words and short phrases.
    // Full lines often don't match OCR exactly (line breaks differ), so we extract
    // individual distinctive words and 2-word phrases.
    const inscriptionText = identification.inscriptions || '';
    const allWords = inscriptionText
      .split(/[\n\s,.:;()[\]]+/)
      .map(w => w.trim())
      .filter(w => w.length > 4 && !/^\d+$/.test(w));
    // Deduplicate and pick the most distinctive words (longer = more distinctive)
    const uniqueWords = [...new Set(allWords.map(w => w.toLowerCase()))];
    // Common Latin/print words to skip
    const stopWords = new Set(['latin', 'french', 'german', 'dutch', 'verse', 'column', 'image', 'below', 'above', 'title', 'label', 'print']);
    const searchTerms = uniqueWords
      .filter(w => !stopWords.has(w))
      .sort((a, b) => b.length - a.length)
      .slice(0, 12);

    // Also extract 2-3 word phrases from inscription lines (stronger signal)
    const lines = inscriptionText.split('\n').map(l => l.trim()).filter(l => l.length > 8);
    const phrases = lines
      .filter(l => !/^\[.*\]$/.test(l) && !/^\d+$/.test(l))
      .slice(0, 6);

    // Also use subject keywords as fallback
    const subjectWords = (identification.subject || '')
      .split(/\s+/)
      .filter(w => w.length > 4)
      .slice(0, 5);

    const pageMatches: { bookId: string; pageNumber: number; score: number }[] = [];

    if ((searchTerms.length > 0 || phrases.length > 0) && topMatches.length > 0) {
      const bookIds = topMatches.map(m => m.id);

      // Strategy A: Search for distinctive phrases (strongest signal — exact multi-word match)
      for (const phrase of phrases.slice(0, 4)) {
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const found = await pages
          .find(
            {
              book_id: { $in: bookIds },
              'ocr.data': { $regex: escaped, $options: 'i' },
            },
            {
              projection: { book_id: 1, page_number: 1 },
              maxTimeMS: 5000,
            },
          )
          .limit(10)
          .toArray()
          .catch(() => []);

        for (const p of found) {
          const existing = pageMatches.find(
            pm => pm.bookId === p.book_id && pm.pageNumber === p.page_number,
          );
          if (existing) {
            existing.score += 15;
          } else {
            pageMatches.push({ bookId: p.book_id, pageNumber: p.page_number, score: 15 });
          }
        }
      }

      // Strategy B: Search for individual distinctive words (more queries but catches
      // pages where OCR line breaks differ from the inscriptions)
      for (const term of searchTerms.slice(0, 6)) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const found = await pages
          .find(
            {
              book_id: { $in: bookIds },
              'ocr.data': { $regex: escaped, $options: 'i' },
            },
            {
              projection: { book_id: 1, page_number: 1 },
              maxTimeMS: 3000,
            },
          )
          .limit(20)
          .toArray()
          .catch(() => []);

        for (const p of found) {
          const existing = pageMatches.find(
            pm => pm.bookId === p.book_id && pm.pageNumber === p.page_number,
          );
          if (existing) {
            existing.score += 5;
          } else {
            pageMatches.push({ bookId: p.book_id, pageNumber: p.page_number, score: 5 });
          }
        }
      }
    }

    // Also check detected_images descriptions if no page match from OCR
    if (pageMatches.length === 0 && subjectWords.length > 0 && topMatches.length > 0) {
      const bookIds = topMatches.map(m => m.id);
      const subjectRegex = subjectWords.slice(0, 3).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const imgPages = await db.collection('gallery_images')
        .find(
          {
            book_id: { $in: bookIds },
            $or: [
              { description: { $regex: subjectRegex, $options: 'i' } },
              { type: { $regex: subjectRegex, $options: 'i' } },
            ],
          },
          { projection: { book_id: 1, page_number: 1 }, maxTimeMS: 5000 },
        )
        .limit(10)
        .toArray()
        .catch(() => []);

      for (const img of imgPages) {
        if (img.page_number) {
          pageMatches.push({ bookId: img.book_id, pageNumber: img.page_number, score: 5 });
        }
      }
    }

    // Sort page matches by score and attach to book results
    pageMatches.sort((a, b) => b.score - a.score);
    const bestPage = pageMatches[0] || null;

    return NextResponse.json({
      identification,
      matches: matches.slice(0, 10).map(({ _score, enrichment, ...rest }) => {
        // Attach page match if this book has one
        const pm = pageMatches.find(p => p.bookId === rest.id);
        return {
          ...rest,
          score: _score,
          subject: enrichment?.subject,
          ...(pm ? { page_number: pm.pageNumber, page_score: pm.score } : {}),
        };
      }),
      page: bestPage ? {
        book_id: bestPage.bookId,
        page_number: bestPage.pageNumber,
        score: bestPage.score,
      } : null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[identify] Error:', msg);
    return NextResponse.json({ error: 'Identification failed', detail: msg }, { status: 500 });
  }
}
