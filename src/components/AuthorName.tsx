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
 */
export default function AuthorName({ author, className, fallback }: AuthorNameProps) {
  const { name, attributed } = formatAuthor(author);
  if (!name) return fallback ? <span className={className}>{fallback}</span> : null;

  if (attributed) {
    return (
      <span className={className}>
        <span className="italic" title="Attributed author (uncertain)">attr. {name}</span>
      </span>
    );
  }

  return <span className={className}>{name}</span>;
}
