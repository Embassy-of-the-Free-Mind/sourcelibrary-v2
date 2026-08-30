/**
 * Dublin Core meta tags for book pages.
 * Renders <meta name="DC.*"> and <link rel="schema.DCTERMS"> in the page head.
 * Makes book metadata discoverable by library crawlers and aggregators.
 */
import { bylineClaimsAuthorship, institutionalByline } from '@/lib/corporate-bylines';

interface DublinCoreMetaProps {
  title: string;
  displayTitle?: string;
  author?: string;
  language?: string;
  year?: number | string;
  description?: string;
  categories?: string[];
  keywords?: string[];
  publisher?: string;
  rights?: string;
  identifier: string; // canonical URL
  source?: string; // source library URL
  pageCount?: number;
  doi?: string;
  ustcSn?: string;
}

export default function DublinCoreMeta({
  title,
  displayTitle,
  author,
  language,
  year,
  description,
  categories,
  keywords,
  publisher,
  rights,
  identifier,
  source,
  pageCount,
  doi,
  ustcSn,
}: DublinCoreMetaProps) {
  return (
    <>
      <link rel="schema.DC" href="http://purl.org/dc/elements/1.1/" />
      <link rel="schema.DCTERMS" href="http://purl.org/dc/terms/" />
      <meta name="DC.title" content={displayTitle || title} />
      {displayTitle && displayTitle !== title && (
        <meta name="DC.title.alternative" content={title} />
      )}
      {/* DC.creator is an AUTHORSHIP claim, and `author` here is the raw
          `books.author` string — which for ~470 books names a holding
          monastery or an issuing society rather than a writer. Dublin Core
          has a better slot for those: DCTERMS.provenance for a holder,
          DC.publisher for an issuer, both emitted below. Deciding it here
          rather than at the call sites means every caller gets it right,
          including the second one in book/[id]/page.tsx. */}
      {author && bylineClaimsAuthorship(author) && (
        <meta name="DC.creator" content={author} />
      )}
      {author && !bylineClaimsAuthorship(author) && (
        institutionalByline(author)?.role === 'holder'
          ? <meta name="DCTERMS.provenance" content={author} />
          : <meta name="DC.publisher" content={author} />
      )}
      {language && <meta name="DC.language" content={language} />}
      {year && <meta name="DC.date" content={String(year)} />}
      {description && <meta name="DC.description" content={description} />}
      {categories?.map((cat, i) => (
        <meta key={`cat-${i}`} name="DC.subject" content={cat} />
      ))}
      {keywords?.map((kw, i) => (
        <meta key={`kw-${i}`} name="DC.subject" content={kw} />
      ))}
      {publisher && <meta name="DC.publisher" content={publisher} />}
      <meta name="DC.rights" content={rights || 'CC BY-SA 4.0'} />
      <meta name="DC.identifier" content={identifier} />
      <meta name="DC.type" content="Text" />
      {source && <meta name="DC.source" content={source} />}
      {pageCount && <meta name="DC.format" content={`${pageCount} pages`} />}
      {doi && <meta name="DC.identifier" content={`doi:${doi}`} />}
      {ustcSn && <meta name="DC.identifier" content={`USTC:${ustcSn}`} />}
      <meta name="DC.contributor" content="Source Library (AI translation)" />
    </>
  );
}
