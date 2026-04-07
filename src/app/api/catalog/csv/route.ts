import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CSV_COLUMNS = [
  'title', 'author', 'language', 'year', 'pages',
  'pages_transcribed', 'pages_translated', 'translation_pct',
  'is_first_english_translation', 'source_library',
  'categories', 'collections', 'url',
] as const;

function csvEscape(val: string): string {
  if (!val) return '';
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * GET /api/catalog/csv
 *
 * Public CSV download of the entire Source Library catalog.
 * Powered by Supabase books_catalog (fast, no MongoDB load).
 *
 * Query params:
 *   ?language=Latin        — filter by language
 *   ?collection=alchemy    — filter by collection
 *   ?translated=true       — only books with translations
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const language = searchParams.get('language') || '';
    const collection = searchParams.get('collection') || '';
    const translatedOnly = searchParams.get('translated') === 'true';

    // Paginate through all results (Supabase caps at 1000 per request)
    const PAGE_SIZE = 1000;
    const allRows: Record<string, any>[] = [];
    let offset = 0;

    while (true) {
      let query = supabase
        .from('books_catalog')
        .select('id, slug, title, display_title, author, language, year, pages_count, pages_ocr, pages_translated, pages_blank, is_first_translation, image_source_provider, categories, collections')
        .eq('visible', true)
        .gt('pages_count', 0)
        .order('sort_title', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (language) query = query.eq('language', language);
      if (collection) query = query.contains('collections', [collection]);
      if (translatedOnly) query = query.gt('pages_translated', 0);

      const { data, error } = await query;
      if (error) throw new Error(`Supabase query failed: ${error.message}`);
      if (!data || data.length === 0) break;

      allRows.push(...data);
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    // Build CSV
    const csvLines = [CSV_COLUMNS.join(',')];

    for (const book of allRows) {
      const pagesOcr = book.pages_ocr || 0;
      const pagesBlank = book.pages_blank || 0;
      const pagesTranslated = book.pages_translated || 0;
      const denominator = pagesOcr - pagesBlank;
      const translationPct = denominator > 0
        ? Math.round((pagesTranslated / denominator) * 100)
        : 0;

      const slug = book.slug || book.id;
      const url = `https://sourcelibrary.org/book/${slug}`;

      const row = [
        csvEscape(book.display_title || book.title || ''),
        csvEscape(book.author || ''),
        csvEscape(book.language || ''),
        String(book.year || ''),
        String(book.pages_count || 0),
        String(pagesOcr),
        String(pagesTranslated),
        String(translationPct),
        book.is_first_translation ? 'yes' : 'no',
        csvEscape(book.image_source_provider || ''),
        csvEscape((book.categories || []).join('; ')),
        csvEscape((book.collections || []).join('; ')),
        csvEscape(url),
      ];

      csvLines.push(row.join(','));
    }

    const csv = csvLines.join('\n');
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sourcelibrary-catalog-${date}.csv"`,
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    });
  } catch (error) {
    console.error('[catalog/csv] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'CSV generation failed' },
      { status: 500 }
    );
  }
}
