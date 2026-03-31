/**
 * Dublin Core meta tags for book pages.
 * Renders <meta name="DC.*"> and <link rel="schema.DCTERMS"> in the page head.
 * Makes book metadata discoverable by library crawlers and aggregators.
 */

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
      {author && <meta name="DC.creator" content={author} />}
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
