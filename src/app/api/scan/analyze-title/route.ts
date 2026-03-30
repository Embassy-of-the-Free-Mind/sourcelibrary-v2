export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { performOCRWithBuffer } from '@/lib/ai';

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

const ANALYZE_TITLE_PROMPT = `Analyze this photo of a book's title page. Return ONLY valid JSON with these fields:

1. "ocr_text": Full transcription of all visible text on the page.
2. "corners": The 4 corners of the book/page boundary as [x, y] pairs with normalized 0-1 coordinates, ordered clockwise from top-left: [[topLeft_x, topLeft_y], [topRight_x, topRight_y], [bottomRight_x, bottomRight_y], [bottomLeft_x, bottomLeft_y]]. Only include the page itself, not the desk/background. If the page fills the entire image, return [[0,0],[1,0],[1,1],[0,1]].
3. "title": The book title (in the original language). null if not identifiable.
4. "author": The author name(s). null if not identifiable.
5. "language": The primary language of the text (e.g. "Latin", "English", "German"). null if unclear.
6. "year": Publication year as a number, or null if not visible.
7. "search_query": A short search query (in English if possible) to find this book in catalogs. Use the most distinctive part of the title + author surname. e.g. "Paracelsus Aurora Philosophorum" or "Agrippa Occult Philosophy". null if not identifiable.

Return ONLY the JSON object, no markdown fences or other text.`;

interface CatalogMatch {
  source: 'open_library' | 'google_books' | 'ustc';
  title: string;
  author?: string;
  year?: string | number;
  language?: string;
  url?: string;
}

async function searchOpenLibrary(query: string): Promise<CatalogMatch[]> {
  try {
    const res = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=3`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.docs || []).slice(0, 3).map((doc: Record<string, unknown>) => ({
      source: 'open_library' as const,
      title: doc.title as string,
      author: Array.isArray(doc.author_name) ? (doc.author_name as string[]).join(', ') : undefined,
      year: doc.first_publish_year as number | undefined,
      language: Array.isArray(doc.language) ? (doc.language as string[])[0] : undefined,
      url: doc.key ? `https://openlibrary.org${doc.key}` : undefined,
    }));
  } catch {
    return [];
  }
}

async function searchGoogleBooks(query: string): Promise<CatalogMatch[]> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=3`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).slice(0, 3).map((item: Record<string, unknown>) => {
      const vol = (item.volumeInfo || {}) as Record<string, unknown>;
      return {
        source: 'google_books' as const,
        title: vol.title as string,
        author: Array.isArray(vol.authors) ? (vol.authors as string[]).join(', ') : undefined,
        year: vol.publishedDate as string | undefined,
        language: vol.language as string | undefined,
        url: vol.infoLink as string | undefined,
      };
    });
  } catch {
    return [];
  }
}

async function searchUstc(query: string): Promise<CatalogMatch[]> {
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/ustc_enrichments`);
    url.searchParams.set('select', 'id,std_title,english_title,detected_language,original_author');
    url.searchParams.set('limit', '3');
    url.searchParams.set('or', `(std_title.ilike.*${query}*,english_title.ilike.*${query}*,original_author.ilike.*${query}*)`);

    const res = await fetch(url.toString(), {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data || []).slice(0, 3).map((row: Record<string, unknown>) => ({
      source: 'ustc' as const,
      title: (row.std_title || row.english_title) as string,
      author: row.original_author as string | undefined,
      language: row.detected_language as string | undefined,
      url: row.id ? `https://www.ustc.ac.uk/editions/${row.id}` : undefined,
    }));
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file || !file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Image file required' },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Single Gemini vision call: OCR + corners + metadata + search query
    const visionResult = await performOCRWithBuffer(
      buffer,
      file.type,
      ANALYZE_TITLE_PROMPT
    );

    let ocrText = '';
    let corners: [number, number][] | null = null;
    let title: string | null = null;
    let author: string | null = null;
    let language: string | null = null;
    let year: number | null = null;
    let searchQuery: string | null = null;

    try {
      const cleaned = visionResult.text
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      ocrText = parsed.ocr_text || '';
      corners = parsed.corners || null;
      title = parsed.title || null;
      author = parsed.author || null;
      language = parsed.language || null;
      year = parsed.year || null;
      searchQuery = parsed.search_query || null;
    } catch {
      ocrText = visionResult.text;
    }

    // Fire parallel catalog searches using Gemini's search query
    let catalogMatches: CatalogMatch[] = [];
    const query = searchQuery || title || '';

    if (query) {
      const [olResults, gbResults, ustcResults] = await Promise.all([
        searchOpenLibrary(query),
        searchGoogleBooks(query),
        searchUstc(query),
      ]);
      catalogMatches = [...olResults, ...gbResults, ...ustcResults];
    }

    return NextResponse.json({
      ocr_text: ocrText,
      title,
      author,
      language,
      year,
      corners,
      catalog_matches: catalogMatches,
    });
  } catch (error) {
    console.error('Title analysis error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
