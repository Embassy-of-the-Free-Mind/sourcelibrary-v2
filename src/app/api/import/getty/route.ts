import { NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * Import a book from the Getty Research Institute
 *
 * POST /api/import/getty
 * Body: {
 *   object_id: string,         // Getty object UUID or identifier
 *   manifest_url?: string,     // Direct IIIF manifest URL (if known)
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[],
 *   work_id?: string
 * }
 *
 * Getty uses UUID-based IIIF v3 manifests. Manifest URLs vary by collection.
 * Provide manifest_url directly, or object_id for lookup.
 */
export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const { object_id, manifest_url, title, display_title, author, language, published, categories, work_id } = body;

    if ((!object_id && !manifest_url) || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: (object_id or manifest_url), title, author' },
        { status: 400 }
      );
    }

    const identifier = object_id || manifest_url;
    const iiifUrl = manifest_url || `https://data.getty.edu/museum/api/iiif/manifest:${object_id}`;

    return await importBookFromIIIF({
      provider: 'getty',
      provider_name: 'Getty Research Institute',
      manifest_url: iiifUrl,
      identifier: identifier!,
      source_url: `https://www.getty.edu/art/collection/object/${object_id}`,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      license_default: 'CC-BY-4.0',
      attribution_default: 'Getty Research Institute',
      duplicate_query: {
        $or: [
          { getty_object_id: object_id },
          { 'dublin_core.dc_identifier': `GETTY:${object_id}` },
          { 'image_source.iiif_manifest': iiifUrl },
        ],
      },
      identifier_field: { getty_object_id: object_id || manifest_url },
    }, request);
  } catch (error) {
    console.error('Getty import error:', error);
    return NextResponse.json({ error: 'Import failed', details: String(error) }, { status: 500 });
  }
});
