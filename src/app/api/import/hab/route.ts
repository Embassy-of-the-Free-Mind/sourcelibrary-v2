import { NextRequest, NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';

/**
 * Import a book from HAB Wolfenbüttel (Herzog August Bibliothek)
 *
 * POST /api/import/hab
 * Body: {
 *   hab_id: string,           // HAB manuscript/book ID, e.g. "cod-guelf-18-1-aug-2f"
 *   manifest_url?: string,    // Optional: provide full manifest URL if non-standard
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[]
 * }
 *
 * HAB's IIIF manifest URL patterns vary by collection. If the standard pattern
 * doesn't work, provide manifest_url directly. Common patterns:
 *   https://diglib.hab.de/iiif/manifest/${hab_id}.json
 *   https://diglib.hab.de/mss/${hab_id}/manifest.json
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { hab_id, manifest_url, title, display_title, author, language, published, categories, work_id } = body;

    if (!hab_id || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: hab_id, title, author' },
        { status: 400 }
      );
    }

    // HAB manifest URL patterns vary; allow user to provide directly
    const resolvedManifest = manifest_url
      || `https://diglib.hab.de/mss/${hab_id}/manifest.json`;

    return await importBookFromIIIF({
      provider: 'hab',
      provider_name: 'Herzog August Bibliothek Wolfenbüttel',
      manifest_url: resolvedManifest,
      identifier: hab_id,
      source_url: `https://diglib.hab.de/mss/${hab_id}/start.htm`,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      license_default: 'CC-BY-SA-4.0',
      attribution_default: 'Herzog August Bibliothek Wolfenbüttel',
      duplicate_query: {
        $or: [
          { hab_id },
          { 'dublin_core.dc_identifier': `HAB:${hab_id}` },
        ],
      },
      identifier_field: { hab_id },
    }, request);
  } catch (error) {
    console.error('HAB import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
}
