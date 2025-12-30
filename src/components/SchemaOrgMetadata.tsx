import { Book, TranslationEdition } from '@/lib/types';

interface SchemaOrgMetadataProps {
  book: Book;
  pageCount: number;
  translatedCount: number;
  currentEdition?: TranslationEdition;
  baseUrl?: string;
  /** Current page number if viewing a specific page */
  currentPage?: number;
}

/**
 * Generates Schema.org JSON-LD metadata for Google Scholar and search engines.
 * See: https://schema.org/Book, https://schema.org/ScholarlyArticle
 */
export default function SchemaOrgMetadata({
  book,
  pageCount,
  translatedCount,
  currentEdition,
  baseUrl = 'https://sourcelibrary.org',
  currentPage,
}: SchemaOrgMetadataProps) {
  // Original work metadata
  const originalWork = {
    '@type': 'Book',
    '@id': `${baseUrl}/book/${book.id}#original`,
    name: book.title,
    author: {
      '@type': 'Person',
      name: book.author,
    },
    inLanguage: book.language,
    ...(book.published && { datePublished: book.published }),
    ...(book.publisher && {
      publisher: {
        '@type': 'Organization',
        name: book.publisher,
      },
    }),
    ...(book.place_published && {
      locationCreated: {
        '@type': 'Place',
        name: book.place_published,
      },
    }),
    ...(book.ustc_id && {
      identifier: {
        '@type': 'PropertyValue',
        propertyID: 'USTC',
        value: book.ustc_id,
      },
    }),
  };

  // Translation metadata (if we have translations)
  const translationWork = translatedCount > 0 ? {
    '@type': 'CreativeWork',
    '@id': `${baseUrl}/book/${book.id}#translation`,
    name: `English Translation of ${book.display_title || book.title}`,
    translationOfWork: { '@id': `${baseUrl}/book/${book.id}#original` },
    inLanguage: 'en',
    isAccessibleForFree: true,
    ...(currentEdition && {
      version: currentEdition.version,
      datePublished: currentEdition.published_at
        ? new Date(currentEdition.published_at).toISOString().split('T')[0]
        : undefined,
      license: getLicenseUrl(currentEdition.license),
      ...(currentEdition.doi && {
        identifier: {
          '@type': 'PropertyValue',
          propertyID: 'DOI',
          value: currentEdition.doi,
        },
        sameAs: `https://doi.org/${currentEdition.doi}`,
      }),
      author: currentEdition.contributors.map(c => ({
        '@type': c.type === 'ai' ? 'SoftwareApplication' : 'Person',
        name: c.name,
        ...(c.orcid && { identifier: `https://orcid.org/${c.orcid}` }),
        ...(c.affiliation && {
          affiliation: {
            '@type': 'Organization',
            name: c.affiliation,
          },
        }),
      })),
    }),
    provider: {
      '@type': 'Organization',
      name: 'Source Library',
      url: baseUrl,
    },
  } : null;

  // Main page metadata
  const pageUrl = currentPage
    ? `${baseUrl}/book/${book.id}/page/${currentPage}`
    : `${baseUrl}/book/${book.id}`;

  const webPage = {
    '@type': 'WebPage',
    '@id': pageUrl,
    name: currentPage
      ? `${book.display_title || book.title} - Page ${currentPage}`
      : book.display_title || book.title,
    description: getDescription(book, translatedCount, pageCount),
    url: pageUrl,
    mainEntity: translationWork ? { '@id': `${baseUrl}/book/${book.id}#translation` } : { '@id': `${baseUrl}/book/${book.id}#original` },
    ...(book.thumbnail && { thumbnailUrl: book.thumbnail }),
  };

  // Breadcrumb navigation
  const breadcrumbItems = [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: baseUrl,
    },
    {
      '@type': 'ListItem',
      position: 2,
      name: book.display_title || book.title,
      item: `${baseUrl}/book/${book.id}`,
    },
  ];

  // Add page breadcrumb if viewing a specific page
  if (currentPage) {
    breadcrumbItems.push({
      '@type': 'ListItem',
      position: 3,
      name: `Page ${currentPage}`,
      item: `${baseUrl}/book/${book.id}/page/${currentPage}`,
    });
  }

  const breadcrumbList = {
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbItems,
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      webPage,
      originalWork,
      ...(translationWork ? [translationWork] : []),
      breadcrumbList,
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd, null, 0) }}
    />
  );
}

function getLicenseUrl(license: string): string {
  const licenseUrls: Record<string, string> = {
    'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
    'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
    'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
    'CC-BY-NC-4.0': 'https://creativecommons.org/licenses/by-nc/4.0/',
    'CC-BY-NC-SA-4.0': 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  };
  return licenseUrls[license] || license;
}

function getDescription(book: Book, translatedCount: number, pageCount: number): string {
  const parts = [];

  if (book.display_title && book.display_title !== book.title) {
    parts.push(`${book.display_title} (${book.title})`);
  } else {
    parts.push(book.title);
  }

  parts.push(`by ${book.author}`);

  if (book.published) {
    parts.push(`(${book.published})`);
  }

  if (translatedCount > 0) {
    const percent = Math.round((translatedCount / pageCount) * 100);
    parts.push(`- English translation ${percent}% complete`);
  }

  return parts.join(' ');
}
