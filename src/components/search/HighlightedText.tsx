'use client';

import { splitByMatches } from '@/lib/highlight';

interface HighlightedTextProps {
  text: string;
  query: string;
  className?: string;
}

/**
 * Renders text with query matches highlighted.
 * XSS-safe by construction — React escapes all text, no dangerouslySetInnerHTML.
 */
export default function HighlightedText({ text, query, className }: HighlightedTextProps) {
  if (!query || !text) {
    return <span className={className}>{text}</span>;
  }

  const segments = splitByMatches(text, query);

  return (
    <span className={className}>
      {segments.map((segment, i) =>
        segment.highlight ? (
          <mark key={i} className="bg-amber-200/60 text-amber-900 rounded-sm px-0.5">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </span>
  );
}
