// Inline source citation — links to specific pages in primary source books

import { SourceKey, SOURCES, sourceUrl, sourceLabel } from '@/lib/rithmomachia/sources';

interface SourceCitationProps {
  source: SourceKey;
  page?: number;
  detail?: string;
  inline?: boolean; // compact inline style vs block style
}

export function SourceCitation({ source, page, detail, inline }: SourceCitationProps) {
  const src = SOURCES[source];
  const url = sourceUrl(source, page);
  const label = `${src.author} (${src.year})${page ? `, p. ${page}` : ''}`;

  if (inline) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-rust hover:underline"
        title={detail || src.shortTitle}
      >
        {label}
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-1.5 text-xs text-muted hover:text-secondary transition-colors group"
      title={detail || src.shortTitle}
    >
      <span className="text-accent-rust/60 group-hover:text-accent-rust shrink-0">{src.language.slice(0, 2)}</span>
      <span>
        {src.author} ({src.year}){page ? `, p. ${page}` : ''}
        {detail && <span className="text-muted/70 ml-1">— {detail}</span>}
      </span>
    </a>
  );
}

// List of source citations for a concept
interface SourceListProps {
  refs: { source: SourceKey; page?: number; detail?: string }[];
  compact?: boolean; // single line vs multi-line
}

export function SourceList({ refs, compact }: SourceListProps) {
  if (compact) {
    return (
      <span className="text-xs text-muted">
        Sources:{' '}
        {refs.map((ref, i) => (
          <span key={i}>
            {i > 0 && ', '}
            <SourceCitation source={ref.source} page={ref.page} detail={ref.detail} inline />
          </span>
        ))}
      </span>
    );
  }

  return (
    <div className="space-y-0.5 mt-1">
      {refs.map((ref, i) => (
        <SourceCitation key={i} source={ref.source} page={ref.page} detail={ref.detail} />
      ))}
    </div>
  );
}
