import { NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';
import { withCuratorAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * Import a book from the Vatican Apostolic Library (DigiVatLib)
 *
 * POST /api/import/vatlib
 * Body: {
 *   mss_id: string,            // Shelfmark, e.g. "Vat.gr.1209", "Pal.gr.108"
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[],
 *   work_id?: string
 * }
 *
 * IIIF manifest pattern: https://digi.vatlib.it/iiif/MSS_{shelfmark}/manifest.json
 * Shelfmark encoding: spaces → underscores, dots preserved
 */
export const POST = withCuratorAuth(async (request, session) => {
  try {
    const body = await request.json();
    const { mss_id, title, display_title, author, language, published, categories, work_id } = body;

    if (!mss_id || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: mss_id, title, author' },
        { status: 400 }
      );
    }

    // Normalize shelfmark: spaces to underscores for IIIF URL
    const normalizedId = mss_id.replace(/\s+/g, '_');
    const iiifId = `MSS_${normalizedId}`;

    return await importBookFromIIIF({
      provider: 'vatlib',
      provider_name: 'Vatican Apostolic Library (DigiVatLib)',
      manifest_url: `https://digi.vatlib.it/iiif/${iiifId}/manifest.json`,
      identifier: mss_id,
      source_url: `https://digi.vatlib.it/view/${iiifId}`,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      license_default: 'CC-BY-NC-4.0',
      attribution_default: 'Biblioteca Apostolica Vaticana',
      duplicate_query: {
        $or: [
          { vatlib_mss_id: mss_id },
          { 'dublin_core.dc_identifier': `VATLIB:${mss_id}` },
          { 'image_source.iiif_manifest': `https://digi.vatlib.it/iiif/${iiifId}/manifest.json` },
        ],
      },
      identifier_field: { vatlib_mss_id: mss_id },
    }, request);
  } catch (error) {
    console.error('Vatican import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
