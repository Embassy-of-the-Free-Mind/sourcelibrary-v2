import { BASE_URL } from './schema-utils';
import { jsonLdHtml } from '@/lib/json-ld';

interface BlogPostSchemaProps {
  slug: string;
  title: string;
  description: string;
  /** ISO 8601 date string, e.g. "2026-02-20" */
  datePublished: string;
  /** Optional ISO 8601 date for last update */
  dateModified?: string;
  /** Hero / OG image URL (absolute) */
  image?: string;
  /** Default: Derek Lomas, Source Library */
  authorName?: string;
}

/**
 * Schema.org JSON-LD for /blog/[slug] posts. Emits Article (or
 * ScholarlyArticle for research-tagged posts) with author, publisher,
 * datePublished/Modified, mainEntityOfPage, and a BreadcrumbList.
 */
export default function BlogPostSchema({
  slug,
  title,
  description,
  datePublished,
  dateModified,
  image,
  authorName = 'Derek Lomas',
}: BlogPostSchemaProps) {
  const pageUrl = `${BASE_URL}/blog/${slug}`;

  const article: Record<string, unknown> = {
    '@type': 'Article',
    '@id': `${pageUrl}#article`,
    headline: title,
    description,
    datePublished,
    ...(dateModified && { dateModified }),
    ...(image && { image }),
    author: {
      '@type': 'Person',
      name: authorName,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Source Library',
      url: BASE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${BASE_URL}/og-image.jpg`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': pageUrl,
    },
  };

  const breadcrumbList = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: 'Research Notes', item: `${BASE_URL}/blog` },
      { '@type': 'ListItem', position: 3, name: title, item: pageUrl },
    ],
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [article, breadcrumbList],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
    />
  );
}
