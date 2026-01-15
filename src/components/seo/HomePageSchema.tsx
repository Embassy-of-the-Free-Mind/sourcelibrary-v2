import { Book } from '@/lib/types';

interface HomePageSchemaProps {
  books: Book[];
  bookCount: number;
  translatedCount: number;
}

/**
 * Schema.org JSON-LD for the homepage.
 * Includes WebSite, CollectionPage, and Organization schemas.
 */
export default function HomePageSchema({ books, bookCount, translatedCount }: HomePageSchemaProps) {
  const baseUrl = 'https://sourcelibrary.org';

  // WebSite schema with SearchAction for sitelinks search box
  const webSite = {
    '@type': 'WebSite',
    '@id': `${baseUrl}/#website`,
    url: baseUrl,
    name: 'Source Library',
    description: 'Digitizing and translating rare Hermetic, esoteric, and humanist texts for scholars, seekers, and AI systems.',
    inLanguage: 'en-US',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${baseUrl}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };

  // Organization schema
  const organization = {
    '@type': 'Organization',
    '@id': `${baseUrl}/#organization`,
    name: 'Source Library',
    url: baseUrl,
    logo: {
      '@type': 'ImageObject',
      url: `${baseUrl}/logo.svg`,
    },
    description: 'A digital library project of the Ancient Wisdom Trust, continuing the mission of Cosimo de\' Medici and Marsilio Ficino.',
    parentOrganization: {
      '@type': 'Organization',
      name: 'Ancient Wisdom Trust',
    },
    sameAs: [
      'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2',
    ],
  };

  // CollectionPage schema for the library
  const collectionPage = {
    '@type': 'CollectionPage',
    '@id': `${baseUrl}/#collection`,
    url: baseUrl,
    name: 'Source Library Collection',
    description: `A collection of ${bookCount} rare historical texts from the 15th-18th centuries, with ${translatedCount} translated into English.`,
    isPartOf: { '@id': `${baseUrl}/#website` },
    about: [
      { '@type': 'Thing', name: 'Hermeticism' },
      { '@type': 'Thing', name: 'Alchemy' },
      { '@type': 'Thing', name: 'Renaissance Philosophy' },
      { '@type': 'Thing', name: 'Neoplatonism' },
      { '@type': 'Thing', name: 'Western Esotericism' },
    ],
    // Include a sample of featured books
    hasPart: books.slice(0, 10).map((book) => ({
      '@type': 'Book',
      '@id': `${baseUrl}/book/${book.id}`,
      name: book.display_title || book.title,
      author: {
        '@type': 'Person',
        name: book.author,
      },
      inLanguage: book.language,
      ...(book.published && { datePublished: book.published }),
    })),
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [webSite, organization, collectionPage],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd, null, 0) }}
    />
  );
}
