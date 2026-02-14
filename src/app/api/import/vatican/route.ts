import { NextRequest, NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';

/**
 * Import a book from the Vatican Library (DigiVatLib)
 *
 * POST /api/import/vatican
 * Body: {
 *   mss_id: string,          // Manuscript code, e.g. "Pal.lat.235" or "Vat.lat.3225"
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[]
 * }
 *
 * The manuscript ID is normalized: dots become periods in the URL,
 * e.g. "Pal.lat.235" → "MSS_Pal.lat.235" in the IIIF manifest path.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mss_id, title, display_title, author, language, published, categories } = body;

    if (!mss_id || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: mss_id, title, author' },
        { status: 400 }
      );
    }

    const mssCode = `MSS_${mss_id}`;

    return await importBookFromIIIF({
      provider: 'vatican',
      provider_name: 'Biblioteca Apostolica Vaticana',
      manifest_url: `https://digi.vatlib.it/iiif/${mssCode}/manifest.json`,
      identifier: mss_id,
      source_url: `https://digi.vatlib.it/view/${mssCode}`,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      license_default: 'CC-BY-NC-4.0',
      attribution_default: 'Biblioteca Apostolica Vaticana',
      duplicate_query: {
        $or: [
          { vatican_mss_id: mss_id },
          { 'dublin_core.dc_identifier': `VATICAN:${mss_id}` },
        ],
      },
      identifier_field: { vatican_mss_id: mss_id },
    }, request);
  } catch (error) {
    console.error('Vatican import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
}
