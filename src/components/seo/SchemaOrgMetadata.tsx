import { Book, TranslationEdition } from '@/lib/types';
import { BASE_URL, getLicenseUrl } from './schema-utils';
import { formatAuthor } from '@/lib/utils';

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
  baseUrl = BASE_URL,
  currentPage,
}: SchemaOrgMetadataProps) {
  // Canonical book path segment (slug preferred for SEO)
  const bookPath = book.slug || book.id;

  // Composition date from source work timeline (if available)
  const compositionLayer = book.source_work_dates?.find(l => l.type === 'composition');

  // Link author to their encyclopedia page if they have one
  const cleanAuthor = formatAuthor(book.author).name || book.author;
  const authorEncyclopediaUrl = cleanAuthor
    ? `${baseUrl}/encyclopedia/${encodeURIComponent(cleanAuthor)}`
    : undefined;

  // Original work metadata
  const originalWork = {
    '@type': 'Book',
    '@id': `${baseUrl}/book/${bookPath}#original`,
    name: book.title,
    author: {
      '@type': 'Person',
      name: cleanAuthor,
      ...(authorEncyclopediaUrl && {
        '@id': `${authorEncyclopediaUrl}#entity`,
        url: authorEncyclopediaUrl,
      }),
    },
    inLanguage: book.language,
    ...(book.published && { datePublished: book.published }),
    ...(compositionLayer && { dateCreated: compositionLayer.date_display }),
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
    ...(pageCount > 0 && { numberOfPages: pageCount }),
    ...(book.thumbnail && {
      image: book.thumbnail,
      thumbnailUrl: book.thumbnail,
    }),
    ...(book.categories && book.categories.length > 0 && {
      genre: book.categories,
      about: book.categories.map(c => ({ '@type': 'Thing', name: c })),
    }),
    copyrightNotice: `Public domain. Original published ${book.published || 'before 1900'}.`,
    acquireLicensePage: `${baseUrl}/book/${bookPath}`,
    creditText: book.image_source?.attribution || `Digitized by ${book.image_source?.provider_name || 'Internet Archive'}`,
  };

  // Extract translator info from edition contributors or default to AI
  const translators = currentEdition?.contributors
    ?.filter(c => c.role === 'translator')
    .map(c => ({
      '@type': c.type === 'ai' ? 'SoftwareApplication' as const : 'Person' as const,
      name: c.name,
      ...(c.orcid && { identifier: `https://orcid.org/${c.orcid}` }),
    }));

  // Translation metadata (if we have translations)
  const translationWork = translatedCount > 0 ? {
    '@type': 'CreativeWork',
    '@id': `${baseUrl}/book/${bookPath}#translation`,
    name: `English Translation of ${book.display_title || book.title}`,
    translationOfWork: { '@id': `${baseUrl}/book/${bookPath}#original` },
    inLanguage: 'en',
    isAccessibleForFree: true,
    ...(translators?.length
      ? { translator: translators }
      : { translator: { '@type': 'SoftwareApplication', name: 'Source Library AI (Gemini)' } }
    ),
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
    ? `${baseUrl}/book/${bookPath}/page/${currentPage}`
    : `${baseUrl}/book/${bookPath}`;

  const webPage = {
    '@type': 'WebPage',
    '@id': pageUrl,
    name: currentPage
      ? `${book.display_title || book.title} - Page ${currentPage}`
      : book.display_title || book.title,
    description: getDescription(book, translatedCount, pageCount),
    url: pageUrl,
    mainEntity: translationWork ? { '@id': `${baseUrl}/book/${bookPath}#translation` } : { '@id': `${baseUrl}/book/${bookPath}#original` },
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
      item: `${baseUrl}/book/${bookPath}`,
    },
  ];

  // Add page breadcrumb if viewing a specific page
  if (currentPage) {
    breadcrumbItems.push({
      '@type': 'ListItem',
      position: 3,
      name: `Page ${currentPage}`,
      item: `${baseUrl}/book/${bookPath}/page/${currentPage}`,
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

function getDescription(book: Book, translatedCount: number, pageCount: number): string {
  const parts = [];

  if (book.display_title && book.display_title !== book.title) {
    parts.push(`${book.display_title} (${book.title})`);
  } else {
    parts.push(book.title);
  }

  parts.push(`by ${formatAuthor(book.author).name || book.author}`);

  if (book.published) {
    parts.push(`(${book.published})`);
  }

  if (translatedCount > 0) {
    const percent = Math.round((translatedCount / pageCount) * 100);
    parts.push(`- English translation ${percent}% complete`);
  }

  return parts.join(' ');
}
