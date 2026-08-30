/**
 * IIIF Presentation API 3.0 Manifest
 *
 * GET /api/iiif/{bookId}/manifest
 *
 * Returns a standards-compliant IIIF manifest for any book in Source Library.
 * Canvases PAINT the provenance-marked display variant (`display_photo`) and
 * offer the unmarked full-resolution original as a labelled `rendering`. That
 * ordering is the point, not an accident: crawlers read manifests and never run
 * JS, so the painted body is what gets harvested into datasets, and #2651's goal
 * is that every image leaving the system carries its attribution mark. Falls
 * back to archived > original > photo when a page has no marked variant (#4406).
 * OCR and translation annotations are referenced (not inline) and loaded on demand
 * via /api/iiif/{bookId}/canvas/{pageNumber}/{ocr|translation}.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { getPartnerByProvider, type LibraryPartner } from '@/lib/library-partners';
import { isBookReadable } from '@/lib/book-access';
import { resolveImprintPlace } from '@/lib/imprint';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { API_LIMITS } from '@/lib/api-limits';

const BASE = 'https://sourcelibrary.org';

// Map SPDX-ish license IDs to IIIF-required CC/RS URIs. Keys are matched
// case-insensitively (see resolveRights), so list the canonical form only.
const LICENSE_URIS: Record<string, string> = {
  publicdomain: 'http://creativecommons.org/publicdomain/mark/1.0/',
  pdm: 'http://creativecommons.org/publicdomain/mark/1.0/',
  'public-domain': 'http://creativecommons.org/publicdomain/mark/1.0/',
  'cc0-1.0': 'http://creativecommons.org/publicdomain/zero/1.0/',
  cc0: 'http://creativecommons.org/publicdomain/zero/1.0/',
  'cc-by-4.0': 'http://creativecommons.org/licenses/by/4.0/',
  'cc-by-sa-4.0': 'http://creativecommons.org/licenses/by-sa/4.0/',
  'cc-by-nd-4.0': 'http://creativecommons.org/licenses/by-nd/4.0/',
  'cc-by-nc-4.0': 'http://creativecommons.org/licenses/by-nc/4.0/',
  'cc-by-nc-sa-4.0': 'http://creativecommons.org/licenses/by-nc-sa/4.0/',
  'cc-by-nc-nd-4.0': 'http://creativecommons.org/licenses/by-nc-nd/4.0/',
  'in-copyright': 'http://rightsstatements.org/vocab/InC/1.0/',
  inc: 'http://rightsstatements.org/vocab/InC/1.0/',
  'noc-us': 'http://rightsstatements.org/vocab/NoC-US/1.0/',
  'noc-nc': 'http://rightsstatements.org/vocab/NoC-NC/1.0/',
  cne: 'http://rightsstatements.org/vocab/CNE/1.0/',
  und: 'http://rightsstatements.org/vocab/UND/1.0/',
};

/**
 * Resolve a stored license/rights value to a single IIIF `rights` URI.
 * Passes through values that are already CC / rightsstatements.org URIs, and
 * otherwise maps SPDX-ish IDs case-insensitively. The IIIF spec REQUIRES rights
 * to be exactly one CC or rightsstatements.org URI — anything else is dropped
 * rather than emitted as an invalid value.
 */
function resolveRights(license?: string): string | undefined {
  if (!license) return undefined;
  const raw = license.trim();
  if (/^https?:\/\/(creativecommons\.org|rightsstatements\.org)\//i.test(raw)) {
    return raw;
  }
  return LICENSE_URIS[raw.toLowerCase()];
}

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

// Known IIIF image hosts whose API version/profile we can state precisely.
// Anything else that is still IIIF-shaped falls through to a conservative
// default (see extractImageService).
const KNOWN_IIIF_HOSTS: Array<{ test: RegExp; type: string; profile: string }> = [
  { test: /iiif\.archive\.org\/image\/iiif\/3\//, type: 'ImageService3', profile: 'level2' },
  { test: /gallica\.bnf\.fr\/iiif\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' },
  { test: /api\.digitale-sammlungen\.de\/iiif\/image\/v2\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' },
  { test: /e-rara\.ch\/i3f\/v20\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level1.json' },
  { test: /iiif\.wellcomecollection\.org\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' },
  { test: /iiif\.bodleian\.ox\.ac\.uk\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' },
  { test: /tile\.loc\.gov\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' },
  { test: /digi\.vatlib\.it\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level1.json' },
  { test: /ids\.lib\.harvard\.edu\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' },
  { test: /images\.lib\.cam\.ac\.uk\//, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level2.json' },
];

/**
 * Try to extract a IIIF Image Service from a stored page image URL.
 *
 * Works for ANY upstream IIIF endpoint, not a fixed host list: a canonical
 * Image API request is `{service}/{region}/{size}/{rotation}/{quality}.{format}`,
 * so we strip those four trailing segments to recover the service base. Known
 * hosts get their exact API version/profile; an unrecognized but IIIF-shaped
 * URL gets the most widely supported default (viewers read info.json for the
 * truth). Plain re-hosted JPEGs (our R2 derivatives) don't match and correctly
 * return null — we don't run an Image API server over those.
 */
function extractImageService(url: string): { id: string; type: string; profile: string } | null {
  const m = url.match(
    /^(https?:\/\/.+?)\/(full|square|\d+,\d+,\d+,\d+|pct:[\d.,]+)\/(max|full|\^?!?\d*,\d*|pct:[\d.]+)\/(!?-?\d+(?:\.\d+)?)\/(default|color|gray|bitonal)\.(jpg|jpeg|png|tif|tiff|gif|jp2|webp)$/i
  );
  if (!m) return null;
  const base = m[1];
  for (const host of KNOWN_IIIF_HOSTS) {
    if (host.test.test(base)) {
      return { id: base, type: host.type, profile: host.profile };
    }
  }
  // IIIF-shaped URL from an unrecognized host: declare the broadly compatible
  // v2/level1 and let the viewer confirm via info.json.
  return { id: base, type: 'ImageService2', profile: 'http://iiif.io/api/image/2/level1.json' };
}

// Default canvas dimensions, used only when a page has no stored pixel size.
const DEFAULT_WIDTH = 1500;
const DEFAULT_HEIGHT = 2160;

// Width cap the provenance bake regenerates display variants at
// (scripts/maintenance/bake-provenance-mark.mjs DISPLAY_MAX_W). Used only to
// estimate a marked body's size when the writer recorded no dimensions.
const MARKED_DISPLAY_MAX_W = 2000;

// `image_source.provider` has accumulated alternate keys over time; map the
// aliases back to the canonical key that LIBRARY_PARTNERS is registered under
// so the holding institution still resolves.
const PROVIDER_KEY_ALIASES: Record<string, string> = {
  ia: 'internet_archive',
  bsb: 'mdz',
  e_rara: 'e-rara',
  vatlib: 'vatican',
  ndl: 'ndl_japan',
};

function resolvePartner(provider?: string): LibraryPartner | undefined {
  if (!provider) return undefined;
  return (
    getPartnerByProvider(provider) ||
    getPartnerByProvider(PROVIDER_KEY_ALIASES[provider] ?? provider)
  );
}

/**
 * IIIF `provider` agents, holding institution FIRST.
 *
 * The library that digitized the book is the primary provider — IIIF's whole
 * model rests on consumers crediting the source institution structurally, not
 * demoting it to a free-text metadata row. Source Library is listed second as
 * the aggregator that re-hosts and adds AI OCR/translation. Falls back to the
 * stored `provider_name` / `source_url` when the institution isn't a registered
 * LIBRARY_PARTNER, so long-tail sources are still credited.
 */
function buildProviders(
  imageSource: { provider?: string; provider_name?: string; source_url?: string } | undefined,
): Array<Record<string, unknown>> {
  const providers: Array<Record<string, unknown>> = [];

  const partner = resolvePartner(imageSource?.provider);
  const name = partner?.name || imageSource?.provider_name;
  const homepageUrl = partner?.url || imageSource?.source_url;

  if (name) {
    const agent: Record<string, unknown> = {
      id: homepageUrl || BASE,
      type: 'Agent',
      label: { en: [name] },
    };
    if (homepageUrl) {
      agent.homepage = [
        { id: homepageUrl, type: 'Text', label: { en: [name] }, format: 'text/html' },
      ];
    }
    if (partner) {
      agent.seeAlso = [
        {
          id: `${BASE}/libraries/${partner.slug}`,
          type: 'Text',
          label: { en: [`${name} on Source Library`] },
          format: 'text/html',
        },
      ];
    }
    providers.push(agent);
  }

  providers.push({
    id: BASE,
    type: 'Agent',
    label: { en: ['Source Library'] },
    homepage: [
      {
        id: BASE,
        type: 'Text',
        label: { en: ['Source Library — re-hosted edition with AI OCR & translation'] },
        format: 'text/html',
      },
    ],
  });

  return providers;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Public and keyless by design, but not unmetered (#4366): a light
  // per-IP ceiling far above any reader or viewer, low enough to blunt scripts.
  const _rl = checkRateLimit({ name: 'iiif-read', limit: API_LIMITS.publicReads.iiifPerMinute, windowSeconds: 60 }, getClientIp(request));
  if (!_rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(_rl.retryAfter) } });
  }
  try {
    const { id } = await params;
    const db = await getReadDb();

    const book = await db.collection('books').findOne({ id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Hidden (visible:false) books are not public — 404 unless editor / CRON_SECRET.
    if (!(await isBookReadable(book, request))) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Merge full index from dedicated collection
    const indexDoc = await db.collection('book_indexes').findOne(
      { book_id: id },
      { projection: { _id: 0, book_id: 0 }, maxTimeMS: 5000 }
    ).catch(() => null);
    if (indexDoc) {
      (book as any).index = { ...(book as any).index, ...indexDoc };
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
            display_photo: 1,
            display_width: 1, display_height: 1,
            image_width: 1, image_height: 1,
            thumbnail_blob: 1, image_thumb: 1,
            thumbnail: 1, image_display: 1,
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

    // Visual art (content_type:'artwork') has no `pages` documents — it's a single
    // object/image. Synthesize one canvas from the book-level image fields so artworks
    // get a valid IIIF manifest just like books. full_width/full_height match image_full
    // (both written at import from the same buffer), so canvas dims line up with the body.
    if (pagesLight.length === 0) {
      const artImage = (book as any).image_full || (book as any).archived_full_url || (book as any).image_display || book.thumbnail;
      if (artImage) {
        pagesLight.push({
          page_number: 1,
          photo: artImage,
          photo_original: (book as any).image_full || (book as any).archived_full_url || artImage,
          image_width: (book as any).full_width || undefined,
          image_height: (book as any).full_height || undefined,
          thumbnail_blob: (book as any).image_thumb || (book as any).image_display || book.thumbnail,
          thumbnail: (book as any).image_display || book.thumbnail,
          hasOcr: false,
          hasTranslation: false,
        });
      }
    }

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
    const imprintPlace = resolveImprintPlace(book)?.display; // family resolver, #4043
    if (imprintPlace) {
      metadata.push({
        label: { en: ['Place of Publication'] },
        value: { none: [imprintPlace] },
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
    // License + TDM reservation travel inside the manifest (headers are
    // stripped when manifests are harvested/re-hosted). Prices live on
    // /licensing only.
    metadata.push({
      label: { en: ['License'] },
      value: {
        en: [
          'Original texts: public domain. OCR, translations and annotations: <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, attribution: Source Library (https://sourcelibrary.org).',
        ],
      },
    });
    metadata.push({
      label: { en: ['AI Training / TDM'] },
      value: {
        en: [
          'Reserved (EU Directive 2019/790 Art. 4). A standard license is available — see <a href="https://sourcelibrary.org/licensing">sourcelibrary.org/licensing</a>.',
        ],
      },
    });

    // Summary
    const summaryText =
      (typeof book.summary === 'string' ? book.summary : book.summary?.data) ||
      book.reading_summary?.overview ||
      book.index?.bookSummary?.brief;

    // Rights. Books without a stored license value default to the Public
    // Domain Mark: everything served here is a publicly readable facsimile of
    // a pre-1900 original (copyright-held books are hidden and 404 above).
    // The CC BY-SA claim on our OCR/translation layer lives in the License
    // metadata row — IIIF `rights` takes exactly one URI, and the facsimile
    // images are the manifest's primary content.
    const license = book.image_source?.license || book.license;
    const rightsUri =
      resolveRights(license) || 'http://creativecommons.org/publicdomain/mark/1.0/';

    // Attribution — always credit the digitizing institution. Prefer an explicit
    // attribution string when stored; otherwise build one from the institution
    // name so the required statement is never empty.
    const institutionName =
      resolvePartner(book.image_source?.provider)?.name || book.image_source?.provider_name;
    const attribution =
      book.image_source?.attribution ||
      (institutionName
        ? `Digitized by ${institutionName}. Re-hosted with AI-generated OCR and translation by Source Library.`
        : 'Re-hosted with AI-generated OCR and translation by Source Library.');

    // Build canvases
    const canvases = pagesLight.map((page) => {
      const pageNum = page.page_number;
      const canvasId = `${BASE}/api/iiif/${id}/canvas/p${pageNum}`;
      // The ORIGINAL, unmarked master (or the partner's IIIF URL on
      // derivative-only pages). Still offered — as an explicit `rendering`
      // below — but no longer the default body. See #4406.
      const originalUrl = page.archived_photo || page.photo_original || page.photo;
      // The provenance-marked display variant is what we PAINT (#2651): crawlers
      // read manifests and never run JS, so the body is what gets harvested, and
      // #2651's goal is that every image leaving the system carries the mark.
      const paintedUrl = page.display_photo || originalUrl;
      const isMarked = Boolean(page.display_photo);
      // A `service` must describe the body it is attached to. The marked variant
      // is a plain R2 object with no Image API service, so only attach the
      // upstream service when the body IS that upstream image.
      const service = !isMarked && paintedUrl ? extractImageService(paintedUrl) : null;

      // Use the real digitized pixel size when archiving recorded it, so that
      // xywh region citation / annotation targeting lands on the correct part
      // of the image. Fall back to a nominal page size only when unknown.
      // NOTE: canvas dimensions stay in the MASTER's pixel space even when the
      // painted body is the smaller marked variant — existing annotation targets
      // are expressed against it, and IIIF viewers scale the body to the canvas.
      const width = page.image_width || DEFAULT_WIDTH;
      const height = page.image_height || DEFAULT_HEIGHT;

      const imageBody: Record<string, unknown> = {
        id: paintedUrl,
        type: 'Image',
        format: 'image/jpeg',
      };
      // Body dimensions, most trustworthy first:
      //  1. what the variant writer actually recorded (display_width/height);
      //  2. else derive from the master, capped at the bake's DISPLAY_MAX_W —
      //     exact for baked pages, and for the not-yet-baked 1200px ones still
      //     the right ASPECT (which is what a viewer lays out on), only a
      //     pixel-density hint that is generous;
      //  3. else fall through to the canvas dimensions.
      if (isMarked && page.display_width && page.display_height) {
        imageBody.width = page.display_width;
        imageBody.height = page.display_height;
      } else if (isMarked && page.image_width && page.image_height) {
        const bodyW = Math.min(MARKED_DISPLAY_MAX_W, page.image_width);
        imageBody.width = bodyW;
        imageBody.height = Math.round((page.image_height * bodyW) / page.image_width);
      } else {
        imageBody.width = width;
        imageBody.height = height;
      }
      if (service) {
        imageBody.service = [service];
      }

      const canvas: Record<string, unknown> = {
        id: canvasId,
        type: 'Canvas',
        label: { none: [`p. ${pageNum}`] },
        width,
        height,
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

      // Keep the full-resolution original reachable for legitimate scholarly use —
      // as a labelled `rendering`, not as the thing a bulk harvester takes by
      // default. Only when it is a DIFFERENT image from the one we painted.
      if (originalUrl && originalUrl !== paintedUrl) {
        canvas.rendering = [
          {
            id: originalUrl,
            type: 'Image',
            format: 'image/jpeg',
            label: { en: ['Full-resolution original scan'] },
          },
        ];
      }

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

      provider: buildProviders(book.image_source),

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

    manifest.requiredStatement = {
      label: { en: ['Attribution'] },
      value: { en: [attribution] },
    };

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
