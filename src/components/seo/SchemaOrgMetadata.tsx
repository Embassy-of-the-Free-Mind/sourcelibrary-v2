import { Book, TranslationEdition } from '@/lib/types';
import { CONTENT_LICENSE } from '@/lib/license-info';
import { BASE_URL, PUBLIC_DOMAIN_MARK_URL, getLicenseUrl } from './schema-utils';
import { formatAuthor } from '@/lib/utils';
import { jsonLdHtml } from '@/lib/json-ld';
import { institutionalByline, bylineClaimsAuthorship } from '@/lib/corporate-bylines';
import { resolveImprintPlace } from '@/lib/imprint';

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

  /**
   * `author` USED TO BE EMITTED AS `Person` UNCONDITIONALLY, which told search
   * engines that Thadrak Temple is a human being who wrote the Tantra
   * collection — 142 books — and the same of the Council of Trent, the Indian
   * Hemp Drugs Commission and the Bible societies. That is #3483's defect
   * (institutions rendered as schema.org `Person`) reappearing here, reached
   * through `books.author` rather than through the thesaurus.
   *
   * Two independent corrections, because they are two different mistakes:
   *   - an organisation is an `Organization`, never a `Person`; and
   *   - a HOLDER or an ISSUER did not write the book, so no `author` should be
   *     asserted for it at all. A monastery that keeps a manuscript is
   *     provenance; the volume itself is a collective work with no one author.
   * A hand-typed corporate author (a council's own canons) keeps its `author`
   * slot and only changes @type.
   */
  const institutional = institutionalByline(book.author);
  const authorNode = cleanAuthor && bylineClaimsAuthorship(book.author)
    ? {
        '@type': institutional ? 'Organization' : 'Person',
        name: cleanAuthor,
        ...(authorEncyclopediaUrl && !institutional && {
          '@id': `${authorEncyclopediaUrl}#entity`,
          url: authorEncyclopediaUrl,
        }),
      }
    : undefined;
  // A holder/issuer still belongs in the record — just not as the author.
  const provenanceNode = institutional && !bylineClaimsAuthorship(book.author)
    ? { '@type': 'Organization', name: cleanAuthor }
    : undefined;

  // Original work metadata
  const originalWork = {
    '@type': 'Book',
    '@id': `${baseUrl}/book/${bookPath}#original`,
    name: book.title,
    ...(authorNode && { author: authorNode }),
    ...(provenanceNode && institutional?.role === 'holder' && { provider: provenanceNode }),
    ...(provenanceNode && institutional?.role !== 'holder' && { publisher: provenanceNode }),
    inLanguage: book.language,
    ...(book.published && { datePublished: book.published }),
    ...(compositionLayer && { dateCreated: compositionLayer.date_display }),
    ...(book.publisher && {
      publisher: {
        '@type': 'Organization',
        name: book.publisher,
      },
    }),
    // Family resolver (#4043) — the place may live in a sibling column.
    ...(resolveImprintPlace(book) && {
      locationCreated: {
        '@type': 'Place',
        name: resolveImprintPlace(book)!.display,
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
    ...((book.thumbnail_blob || book.thumbnail) && {
      image: book.thumbnail_blob || book.thumbnail,
      thumbnailUrl: book.thumbnail_blob || book.thumbnail,
    }),
    ...(book.categories && book.categories.length > 0 && {
      genre: book.categories,
      about: book.categories.map(c => ({ '@type': 'Thing', name: c })),
    }),
    copyrightNotice: `Public domain. Original published ${book.published || 'before 1900'}.`,
    license: PUBLIC_DOMAIN_MARK_URL,
    usageInfo: `${baseUrl}/licensing`,
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
    // Translations/OCR default to the site-wide CC BY-SA license; a published
    // edition's own license (which may differ, e.g. CC0 on Zenodo) wins.
    license:
      (currentEdition?.license && getLicenseUrl(currentEdition.license)) ||
      CONTENT_LICENSE.url,
    usageInfo: `${baseUrl}/licensing`,
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
    ...((book.thumbnail_blob || book.thumbnail) && { thumbnailUrl: book.thumbnail_blob || book.thumbnail }),
  };

  // Breadcrumb navigation
  // Insert primary collection as intermediate level when available
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collections = (book as any).collections as string[] | undefined;
  const primaryCollection = collections?.[0];
  const primaryCollectionName = primaryCollection
    ? primaryCollection.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : undefined;

  const breadcrumbItems: Array<{ '@type': string; position: number; name: string; item: string }> = [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: baseUrl,
    },
  ];

  let nextPosition = 2;

  if (primaryCollection && primaryCollectionName) {
    breadcrumbItems.push({
      '@type': 'ListItem',
      position: nextPosition++,
      name: primaryCollectionName,
      item: `${baseUrl}/collections/${primaryCollection}`,
    });
  }

  breadcrumbItems.push({
    '@type': 'ListItem',
    position: nextPosition++,
    name: book.display_title || book.title,
    item: `${baseUrl}/book/${bookPath}`,
  });

  // Add page breadcrumb if viewing a specific page
  if (currentPage) {
    breadcrumbItems.push({
      '@type': 'ListItem',
      position: nextPosition++,
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
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
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

  // "by X" is an authorship claim in prose. A holding monastery or an issuing
  // Bible society did not write the book, so name the relation instead.
  //
  // The parts are joined with spaces, so a bare qualifier ran straight into the
  // title — "…rGyud 'bum Ka manuscript collection Thadrak Temple". Punctuate
  // the non-author cases so the relation reads as an aside rather than as more
  // title.
  const bylineName = formatAuthor(book.author).name || book.author;
  if (bylineName) {
    const inst = institutionalByline(book.author);
    if (!inst || inst.role === 'corporate-author') {
      parts.push(`by ${bylineName}`);
    } else if (inst.role === 'holder') {
      parts.push(`— ${bylineName} ${inst.qualifier || 'collection'}`);
    } else {
      parts.push(`— ${inst.qualifier || 'issued by'} ${bylineName}`);
    }
  }

  if (book.published) {
    parts.push(`(${book.published})`);
  }

  if (translatedCount > 0) {
    const percent = Math.round((translatedCount / pageCount) * 100);
    parts.push(`- English translation ${percent}% complete`);
  }

  return parts.join(' ');
}
