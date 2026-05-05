import { Fragment } from 'react';
import { formatAuthor } from '@/lib/utils';

interface AuthorNameProps {
  author: string | undefined | null;
  className?: string;
  fallback?: string;
}

/**
 * Renders an author name, handling bibliographic bracket conventions.
 * Authors in [brackets] are displayed as "attr. Name" in italics,
 * indicating attributed (uncertain) authorship.
 * Multiple authors separated by "|" are rendered with " · " between them.
 */
export default function AuthorName({ author, className, fallback }: AuthorNameProps) {
  if (!author) return fallback ? <span className={className}>{fallback}</span> : null;

  const parts = author
    .split('|')
    .map(p => formatAuthor(p))
    .filter(p => p.name);

  if (parts.length === 0) return fallback ? <span className={className}>{fallback}</span> : null;

  return (
    <span className={className}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="opacity-50"> · </span>}
          {p.attributed ? (
            <span className="italic" title="Attributed author (uncertain)">attr. {p.name}</span>
          ) : (
            p.name
          )}
        </Fragment>
      ))}
    </span>
  );
}
