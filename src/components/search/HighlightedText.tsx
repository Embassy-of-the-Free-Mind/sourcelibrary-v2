'use client';

import { splitByMatches } from '@/lib/highlight';

interface HighlightedTextProps {
  text: string;
  query: string;
  className?: string;
}

const MARK_CLASS = 'bg-accent-gold/25 text-accent-gold-dark rounded-sm px-0.5';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders text with query matches highlighted.
 *
 * Why dangerouslySetInnerHTML (and why it stays XSS-safe): in-page translators
 * — Google Translate above all — rewrite and MERGE text nodes across element
 * boundaries to reflow a sentence. When the snippet is built from React's own
 * <mark>/<span> children, Translate desyncs the live DOM from React's fiber
 * tree, and the next render throws "Failed to execute 'insertBefore' on 'Node'"
 * (3k+/day on /search during the Spanish-speaking traffic surge). Rendering the
 * snippet as a single innerHTML string makes React treat the inner DOM as
 * opaque: it never reconciles the individual nodes Translate touched, it only
 * replaces innerHTML wholesale when props change. Every segment is HTML-escaped;
 * the only markup we inject is our own fixed-class <mark>, so there's no
 * injection surface.
 */
export default function HighlightedText({ text, query, className }: HighlightedTextProps) {
  const html =
    !query || !text
      ? escapeHtml(text ?? '')
      : splitByMatches(text, query)
          .map((segment) =>
            segment.highlight
              ? `<mark class="${MARK_CLASS}">${escapeHtml(segment.text)}</mark>`
              : escapeHtml(segment.text),
          )
          .join('');

  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
