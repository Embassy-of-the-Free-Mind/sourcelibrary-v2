import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const revalidate = 86400; // Revalidate daily

/**
 * GET /api/nde/dataset
 *
 * Schema.org / DCAT dataset description for the NDE Dataset Register.
 * https://netwerkdigitaalerfgoed.nl
 *
 * This endpoint serves a JSON-LD document describing Source Library's
 * BPH (Bibliotheca Philosophica Hermetica) holdings so they can be
 * discovered through the Dutch Digital Heritage Network.
 *
 * NDE's crawler periodically fetches this URL after registration.
 */
export async function GET() {
  const db = await getDb();
  const books = db.collection('books');

  // Live stats for the BPH subset
  const bphFilter = { 'image_source.provider': 'bph', hidden: { $ne: true } };

  const [totalBooks, pageTotalsAgg] = await Promise.all([
    books.countDocuments(bphFilter),
    books.aggregate<{ _id: null; pages: number; translated: number }>([
      { $match: bphFilter },
      {
        $group: {
          _id: null,
          pages: { $sum: { $ifNull: ['$pages_count', 0] } },
          translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        },
      },
    ]).toArray(),
  ]);

  const pageTotals = pageTotalsAgg[0] ?? { pages: 0, translated: 0 };

  const dataset = {
    '@context': 'https://schema.org/',
    '@type': 'Dataset',
    '@id': 'https://sourcelibrary.org/api/nde/dataset',
    name: 'Bibliotheca Philosophica Hermetica — Source Library Digital Edition',
    alternateName: 'BPH Collection on Source Library',
    description:
      `Digital facsimiles, OCR transcriptions, and AI-assisted English translations of ${totalBooks} books ` +
      `(${pageTotals.pages.toLocaleString()} pages) from the Bibliotheca Philosophica Hermetica (BPH), ` +
      `housed at the Embassy of the Free Mind in Amsterdam. The collection covers Hermetica, alchemy, ` +
      `Kabbalah, Rosicrucianism, and Western esoteric traditions from the 15th–19th centuries. ` +
      `${pageTotals.translated.toLocaleString()} pages have been translated into English.`,
    url: 'https://sourcelibrary.org/libraries/bibliotheca-philosophica-hermetica',
    mainEntityOfPage: 'https://sourcelibrary.org/libraries/bibliotheca-philosophica-hermetica',
    license: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    inLanguage: ['la', 'de', 'nl', 'fr', 'en', 'it'],
    temporalCoverage: '1450/1900',
    spatialCoverage: {
      '@type': 'Place',
      name: 'Europe',
    },
    keywords: [
      'Hermetica',
      'alchemy',
      'Kabbalah',
      'Rosicrucianism',
      'Western esotericism',
      'early modern philosophy',
      'rare books',
      'digital facsimiles',
      'OCR',
      'machine translation',
    ],
    creator: {
      '@type': 'Organization',
      '@id': 'https://sourcelibrary.org',
      name: 'Source Library',
      url: 'https://sourcelibrary.org',
      description:
        'A digital library providing AI-translated access to pre-modern texts on Western esoteric traditions.',
    },
    publisher: {
      '@type': 'Organization',
      '@id': 'https://sourcelibrary.org',
      name: 'Source Library',
      url: 'https://sourcelibrary.org',
    },
    isBasedOn: {
      '@type': 'Collection',
      name: 'Bibliotheca Philosophica Hermetica',
      description:
        'The Ritman Library collection at the Embassy of the Free Mind, Amsterdam. ' +
        'UNESCO Memory of the World (Netherlands) since 2022.',
      url: 'https://embassyofthefreemind.com/en/library',
      maintainer: {
        '@type': 'Organization',
        name: 'Embassy of the Free Mind',
        url: 'https://embassyofthefreemind.com',
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Keizersgracht 123',
          addressLocality: 'Amsterdam',
          postalCode: '1015 CJ',
          addressCountry: 'NL',
        },
      },
    },
    distribution: [
      {
        '@type': 'DataDownload',
        name: 'IIIF Presentation API (per-book manifests)',
        contentUrl: 'https://sourcelibrary.org/api/iiif/{book_id}/manifest',
        encodingFormat: 'application/ld+json',
        description:
          'IIIF Presentation API v3 manifests for each digitized book. ' +
          'Replace {book_id} with a Source Library book identifier.',
      },
      {
        '@type': 'DataDownload',
        name: 'Dataset REST API',
        contentUrl: 'https://sourcelibrary.org/api/dataset/v1/books?library=bph',
        encodingFormat: 'application/json',
        description:
          'Paginated JSON API returning book metadata, OCR text, and translations. ' +
          'Requires an API key (see https://sourcelibrary.org/dataset).',
        usageInfo: 'https://sourcelibrary.org/dataset#api',
      },
      {
        '@type': 'DataDownload',
        name: 'Human-readable browse',
        contentUrl: 'https://sourcelibrary.org/libraries/bibliotheca-philosophica-hermetica',
        encodingFormat: 'text/html',
        description: 'Browse and read BPH books with page-level OCR and English translations.',
      },
    ],
    datePublished: '2024-01-01',
    dateModified: new Date().toISOString().split('T')[0],
    measurementTechnique:
      'OCR via Google Gemini AI; English translations via Google Gemini AI with cross-page context.',
    size: `${totalBooks} books, ${pageTotals.pages.toLocaleString()} pages`,
  };

  return new NextResponse(JSON.stringify(dataset, null, 2), {
    headers: {
      'Content-Type': 'application/ld+json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
    },
  });
}
