/**
 * IIIF Presentation API 3.0 Manifest
 *
 * GET /api/iiif/{bookId}/manifest
 *
 * Returns a standards-compliant IIIF manifest for any book in Source Library.
 * Canvases reference the best available image (archived > original > photo).
 * OCR and translation annotations are referenced (not inline) and loaded on demand
 * via /api/iiif/{bookId}/canvas/{pageNumber}/{ocr|translation}.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

const BASE = 'https://sourcelibrary.org';

// Map SPDX-ish license IDs to IIIF-required CC/RS URIs
const LICENSE_URIS: Record<string, string> = {
  publicdomain: 'http://creativecommons.org/publicdomain/mark/1.0/',
  'CC0-1.0': 'http://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY-4.0': 'http://creativecommons.org/licenses/by/4.0/',
  'CC-BY-SA-4.0': 'http://creativecommons.org/licenses/by-sa/4.0/',
  'CC-BY-NC-4.0': 'http://creativecommons.org/licenses/by-nc/4.0/',
  'CC-BY-NC-SA-4.0': 'http://creativecommons.org/licenses/by-nc-sa/4.0/',
  'in-copyright': 'http://rightsstatements.org/vocab/InC/1.0/',
};

// BCP 47 codes for languages we encounter
const LANG_CODES: Record<string, string> = {
  latin: 'la',
  german: 'de',
  french: 'fr',
  english: 'en',
  italian: 'it',
  dutch: 'nl',
  spanish: 'es',
  greek: 'el',
  hebrew: 'he',
  arabic: 'ar',
};

function langCode(language?: string): string {
  if (!language) return 'none';
  const lower = language.toLowerCase();
  if (lower === 'unknown' || lower === 'none') return 'none';
  return LANG_CODES[lower] || lower.slice(0, 2);
}

/**
 * Try to extract a IIIF Image Service URL from a page image URL.
 * Returns { id, type, profile } or null.
 */
function extractImageService(url: string): { id: string; type: string; profile: string } | null {
  // Internet Archive IIIF v3
  // e.g. https://iiif.archive.org/image/iiif/3/identifier%24pagenum/full/max/0/default.jpg
  const iaMatch = url.match(/^(https:\/\/iiif\.archive\.org\/image\/iiif\/3\/[^/]+)\/full\//);
  if (iaMatch) {
    return { id: iaMatch[1], type: 'ImageService3', profile: 'level2' };
  }

  // Gallica IIIF v2
  // e.g. https://gallica.bnf.fr/iiif/ark:/12148/bpt6k.../f42/full/full/0/native.jpg
  const gallicaMatch = url.match(/^(https:\/\/gallica\.bnf\.fr\/iiif\/ark:\/12148\/[^/]+\/f\d+)\/full\//);
  if (gallicaMatch) {
    return { id: gallicaMatch[1], type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' };
  }

  // MDZ / BSB IIIF
  // e.g. https://api.digitale-sammlungen.de/iiif/image/v2/bsb.../full/...
  const mdzMatch = url.match(/^(https:\/\/api\.digitale-sammlungen\.de\/iiif\/image\/v2\/[^/]+)\/full\//);
  if (mdzMatch) {
    return { id: mdzMatch[1], type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' };
  }

  // e-rara IIIF
  const eraraMatch = url.match(/^(https:\/\/www\.e-rara\.ch\/i3f\/v20\/[^/]+)\/full\//);
  if (eraraMatch) {
    return { id: eraraMatch[1], type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level1.json' };
  }

  return null;
}

// Default canvas dimensions (reasonable for a book page)
const DEFAULT_WIDTH = 1500;
const DEFAULT_HEIGHT = 2160;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const book = await db.collection('books').findOne({ id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get pages — image URLs + just enough OCR/translation to know if they exist.
    // We include ocr.language for the annotation language tag, and a single char
    // of ocr.data / translation.data via $substr to detect existence without
    // transferring full text (which can be megabytes for large books).
    const pagesLight = await db
      .collection('pages')
      .aggregate([
        { $match: { book_id: id } },
        { $sort: { page_number: 1 } },
        {
          $project: {
            page_number: 1,
            photo: 1,
            photo_original: 1,
            archived_photo: 1,
            thumbnail_blob: 1,
            thumbnail: 1,
            'ocr.language': 1,
            hasOcr: {
              $and: [
                { $gt: ['$ocr.data', null] },
                { $ne: ['$ocr.data', ''] },
              ],
            },
            hasTranslation: {
              $and: [
                { $gt: ['$translation.data', null] },
                { $ne: ['$translation.data', ''] },
              ],
            },
          },
        },
      ])
      .toArray();

    const manifestId = `${BASE}/api/iiif/${id}/manifest`;
    const originalLang = langCode(book.language);

    // Build label with original language + English display title
    const label: Record<string, string[]> = {};
    if (originalLang !== 'en' && book.title) {
      label[originalLang] = [book.title];
    }
    if (book.display_title) {
      label['en'] = [book.display_title];
    } else if (originalLang === 'en' && book.title) {
      label['en'] = [book.title];
    }
    if (Object.keys(label).length === 0) {
      label['none'] = [book.title || 'Untitled'];
    }

    // Metadata pairs
    const metadata: Array<{ label: Record<string, string[]>; value: Record<string, string[]> }> = [];

    if (book.author) {
      metadata.push({
        label: { en: ['Author'] },
        value: { none: [book.author] },
      });
    }
    if (book.published) {
      metadata.push({
        label: { en: ['Date'] },
        value: { none: [book.published] },
      });
    }
    if (book.place_published) {
      metadata.push({
        label: { en: ['Place of Publication'] },
        value: { none: [book.place_published] },
      });
    }
    if (book.publisher) {
      metadata.push({
        label: { en: ['Publisher'] },
        value: { none: [book.publisher] },
      });
    }
    if (book.language) {
      metadata.push({
        label: { en: ['Language'] },
        value: { none: [book.language] },
      });
    }
    if (book.format) {
      metadata.push({
        label: { en: ['Format'] },
        value: { none: [book.format] },
      });
    }
    if (book.ustc_id) {
      metadata.push({
        label: { en: ['USTC'] },
        value: { none: [`<a href="https://www.ustc.ac.uk/editions/${book.ustc_id}">${book.ustc_id}</a>`] },
      });
    }
    if (book.doi) {
      metadata.push({
        label: { en: ['DOI'] },
        value: { none: [`<a href="https://doi.org/${book.doi}">${book.doi}</a>`] },
      });
    }
    if (book.image_source?.source_url) {
      metadata.push({
        label: { en: ['Source'] },
        value: {
          none: [
            `<a href="${book.image_source.source_url}">${book.image_source.provider_name || book.image_source.provider}</a>`,
          ],
        },
      });
    }

    // Summary
    const summaryText =
      (typeof book.summary === 'string' ? book.summary : book.summary?.data) ||
      book.reading_summary?.overview ||
      book.index?.bookSummary?.brief;

    // Rights
    const license = book.image_source?.license || book.license;
    const rightsUri = license ? LICENSE_URIS[license] : undefined;

    // Attribution
    const attribution = book.image_source?.attribution;

    // Build canvases
    const canvases = pagesLight.map((page) => {
      const pageNum = page.page_number;
      const canvasId = `${BASE}/api/iiif/${id}/canvas/p${pageNum}`;
      const imageUrl = page.archived_photo || page.photo_original || page.photo;
      const service = imageUrl ? extractImageService(imageUrl) : null;

      const imageBody: Record<string, unknown> = {
        id: imageUrl,
        type: 'Image',
        format: 'image/jpeg',
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      };
      if (service) {
        imageBody.service = [service];
      }

      const canvas: Record<string, unknown> = {
        id: canvasId,
        type: 'Canvas',
        label: { none: [`p. ${pageNum}`] },
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        items: [
          {
            id: `${canvasId}/painting`,
            type: 'AnnotationPage',
            items: [
              {
                id: `${canvasId}/painting/image`,
                type: 'Annotation',
                motivation: 'painting',
                body: imageBody,
                target: canvasId,
              },
            ],
          },
        ],
      };

      // Thumbnail
      const thumbUrl = page.thumbnail_blob || page.thumbnail;
      if (thumbUrl) {
        canvas.thumbnail = [
          {
            id: thumbUrl,
            type: 'Image',
            format: 'image/jpeg',
          },
        ];
      }

      // Referenced annotation pages (loaded on demand by viewers)
      const annotations: Array<{ id: string; type: string }> = [];
      if (page.hasOcr || page.ocr?.language) {
        annotations.push({
          id: `${BASE}/api/iiif/${id}/canvas/${pageNum}/ocr`,
          type: 'AnnotationPage',
        });
      }
      if (page.hasTranslation) {
        annotations.push({
          id: `${BASE}/api/iiif/${id}/canvas/${pageNum}/translation`,
          type: 'AnnotationPage',
        });
      }
      if (annotations.length > 0) {
        canvas.annotations = annotations;
      }

      return canvas;
    });

    // Build structures (table of contents) from chapters
    let structures: unknown[] | undefined;
    if (book.chapters?.length) {
      structures = [
        {
          id: `${manifestId}/range/toc`,
          type: 'Range',
          label: { en: ['Table of Contents'] },
          items: book.chapters.map(
            (ch: { title: string; pageNumber: number; level: number }, i: number) => ({
              id: `${manifestId}/range/ch${i}`,
              type: 'Range',
              label: { none: [ch.title] },
              items: [
                {
                  id: `${BASE}/api/iiif/${id}/canvas/p${ch.pageNumber}`,
                  type: 'Canvas',
                },
              ],
            })
          ),
        },
      ];
    }

    // Assemble the manifest
    const manifest: Record<string, unknown> = {
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: manifestId,
      type: 'Manifest',
      label,
      metadata,
      behavior: ['paged'],
      viewingDirection: 'left-to-right',

      provider: [
        {
          id: BASE,
          type: 'Agent',
          label: { en: ['Source Library'] },
          homepage: [
            {
              id: BASE,
              type: 'Text',
              label: { en: ['Source Library — Digital Archive of Western Esoteric Texts'] },
              format: 'text/html',
            },
          ],
        },
      ],

      homepage: [
        {
          id: `${BASE}/book/${id}`,
          type: 'Text',
          label: { en: ['View on Source Library'] },
          format: 'text/html',
        },
      ],

      seeAlso: [
        {
          id: `${BASE}/api/books/${id}`,
          type: 'Dataset',
          label: { en: ['Book metadata (JSON)'] },
          format: 'application/json',
        },
      ],

      items: canvases,
    };

    if (summaryText) {
      manifest.summary = { en: [summaryText.slice(0, 1000)] };
    }

    if (rightsUri) {
      manifest.rights = rightsUri;
    }

    if (attribution) {
      manifest.requiredStatement = {
        label: { en: ['Attribution'] },
        value: { en: [attribution] },
      };
    }

    if (book.published) {
      // navDate needs ISO 8601 — approximate from year
      const year = parseInt(book.published);
      if (!isNaN(year)) {
        manifest.navDate = `${year}-01-01T00:00:00Z`;
      }
    }

    if (book.thumbnail) {
      manifest.thumbnail = [
        {
          id: book.thumbnail,
          type: 'Image',
          format: 'image/jpeg',
        },
      ];
    }

    // Link to original IIIF manifest if we imported from one
    if (book.image_source?.iiif_manifest) {
      (manifest.seeAlso as unknown[]).push({
        id: book.image_source.iiif_manifest,
        type: 'Manifest',
        label: { en: ['Original IIIF manifest'] },
        format: 'application/ld+json',
      });
    }

    // Content Search service (only if book has OCR)
    if (book.pages_ocr > 0) {
      manifest.service = [
        {
          id: `${BASE}/api/iiif/${id}/search`,
          type: 'SearchService2',
          service: [
            {
              id: `${BASE}/api/iiif/${id}/autocomplete`,
              type: 'AutoCompleteService2',
            },
          ],
        },
      ];
    }

    if (structures) {
      manifest.structures = structures;
    }

    return new NextResponse(JSON.stringify(manifest, null, 2), {
      headers: {
        'Content-Type': 'application/ld+json;profile="http://iiif.io/api/presentation/3/context.json"',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    });
  } catch (error) {
    console.error('Error building IIIF manifest:', error);
    return NextResponse.json({ error: 'Failed to build manifest' }, { status: 500 });
  }
}

// CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
