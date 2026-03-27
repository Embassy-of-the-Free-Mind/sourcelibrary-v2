import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic'; // Don't prerender — needs DB at runtime

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

  // NDE SHACL requires: Organization with name, contactPoint (with name), identifier
  const slContact = {
    '@type': 'ContactPoint',
    name: { '@language': 'en', '@value': 'Source Library general inquiries' },
    url: 'https://sourcelibrary.org/about',
    email: 'derek@sourcelibrary.org',
  };

  const dataset = {
    '@context': 'https://schema.org/',
    '@type': 'Dataset',
    '@id': 'https://sourcelibrary.org/api/nde/dataset',
    name: {
      '@language': 'en',
      '@value': 'Bibliotheca Philosophica Hermetica — Source Library Digital Edition',
    },
    alternateName: 'BPH Collection on Source Library',
    description: {
      '@language': 'en',
      '@value':
        `Digital facsimiles, OCR transcriptions, and AI-assisted English translations of ${totalBooks} books ` +
        `(${pageTotals.pages.toLocaleString()} pages) from the Bibliotheca Philosophica Hermetica (BPH), ` +
        `housed at the Embassy of the Free Mind in Amsterdam. The collection covers Hermetica, alchemy, ` +
        `Kabbalah, Rosicrucianism, and Western esoteric traditions from the 15th–19th centuries. ` +
        `${pageTotals.translated.toLocaleString()} pages have been translated into English.`,
    },
    url: 'https://sourcelibrary.org/libraries/bibliotheca-philosophica-hermetica',
    mainEntityOfPage: 'https://sourcelibrary.org/libraries/bibliotheca-philosophica-hermetica',
    license: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    inLanguage: ['la', 'de', 'nl', 'fr', 'en', 'it'],
    temporalCoverage: '1450/1900',
    spatialCoverage: {
      '@type': 'Place',
      name: 'Europe',
    },
    genre: [
      'http://vocab.getty.edu/aat/300055911', // alchemy
      'http://vocab.getty.edu/aat/300264849', // Hermetica
      'http://vocab.getty.edu/aat/300055918', // Kabbalah
      'http://vocab.getty.edu/aat/300055915', // Rosicrucianism
    ],
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
      '@id': 'https://sourcelibrary.org/#organization',
      name: { '@language': 'en', '@value': 'Source Library' },
      url: 'https://sourcelibrary.org',
      identifier: 'https://sourcelibrary.org',
      contactPoint: slContact,
    },
    publisher: {
      '@type': 'Organization',
      '@id': 'https://sourcelibrary.org/#publisher',
      name: { '@language': 'en', '@value': 'Source Library' },
      url: 'https://sourcelibrary.org',
      identifier: 'https://sourcelibrary.org',
      contactPoint: slContact,
    },
    isBasedOn: {
      '@type': 'Collection',
      name: { '@language': 'en', '@value': 'Bibliotheca Philosophica Hermetica' },
      description: {
        '@language': 'en',
        '@value': 'The Ritman Library collection at the Embassy of the Free Mind, Amsterdam. ' +
          'UNESCO Memory of the World (Netherlands) since 2022.',
      },
      url: 'https://embassyofthefreemind.com/en/library',
    },
    distribution: [
      {
        '@type': 'DataDownload',
        name: 'Dataset REST API',
        contentUrl: 'https://sourcelibrary.org/api/dataset/v1/stats',
        encodingFormat: 'application/json',
        description:
          'JSON API returning book metadata, OCR text, and translations for BPH holdings. ' +
          'Full access requires an API key (see https://sourcelibrary.org/dataset).',
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
    dateCreated: '2024-01-01',
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
