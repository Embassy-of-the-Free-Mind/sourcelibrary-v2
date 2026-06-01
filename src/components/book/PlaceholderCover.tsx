import { cn } from '@/lib/utils';

/**
 * Generated typographic placeholder cover (Option A) for books with no
 * digitised cover image. Renders the book's own metadata on the site's
 * parchment background so an un-digitised book still looks intentionally
 * catalogued rather than "missing".
 *
 * Pure presentational + prop-driven (no image fetch), so it's crisp at any
 * size and works for all ~29k books. It fills its parent absolutely, inheriting
 * whatever aspect ratio the surrounding cover box already sets (2/3 in the
 * catalogue grid, 3/4 on cards and the detail hero). Typography is sized in
 * container-query units (cqw) so it scales identically across every surface.
 *
 * Colours/fonts come from design tokens (--color-cream, --color-border-light,
 * --font-serif/--font-sans, text-primary/text-muted utilities), not hardcoded
 * values. Author and year lines are omitted cleanly when missing.
 *
 * Gated to the embedded reading room by its call sites (useEmbed) — the main
 * sourcelibrary.org site keeps its existing icon fallback.
 */

interface PlaceholderCoverProps {
  title: string;
  author?: string | null;
  year?: string | number | null;
  className?: string;
}

/** Drop bibliographic non-values ("Unknown", "anonymous", "0", empty). */
function cleanAuthor(author?: string | null): string {
  const a = (author ?? '').trim();
  if (!a) return '';
  if (/^(unknown|unidentified|anonymous|anon\.?|n\.?a\.?)$/i.test(a)) return '';
  return a;
}

function cleanYear(year?: string | number | null): string {
  const y = year == null ? '' : String(year).trim();
  if (!y || y === '0') return '';
  return y;
}

export default function PlaceholderCover({ title, author, year, className }: PlaceholderCoverProps) {
  const authorStr = cleanAuthor(author);
  const yearStr = cleanYear(year);
  const hairline = { background: 'var(--color-border-light, #e8e4dc)', height: '1px', flex: '0 0 auto' } as const;

  return (
    <div
      aria-hidden="true"
      className={cn('absolute inset-0 overflow-hidden', className)}
      style={{
        containerType: 'inline-size',
        background: 'var(--color-cream, #fdfcf9)',
        border: '0.5px solid var(--color-border-light, #e8e4dc)',
      }}
    >
      <div className="absolute inset-0 flex flex-col" style={{ padding: '10cqw 9cqw' }}>
        {/* Top hairline rule */}
        <div style={hairline} />

        {/* Centred title / author / year, between the rules */}
        <div
          className="flex flex-col items-center justify-center text-center"
          style={{ flex: '1 1 0%', minHeight: 0, gap: '4cqw', padding: '6cqw 0' }}
        >
          <div
            className="text-primary"
            style={{
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              fontSize: '13cqw',
              lineHeight: 1.12,
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {title}
          </div>

          {authorStr && (
            <div
              className="text-muted"
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: '7cqw',
                lineHeight: 1.2,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {authorStr}
            </div>
          )}

          {yearStr && (
            <div
              className="text-muted"
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '4.5cqw',
                letterSpacing: '0.18em',
              }}
            >
              {yearStr}
            </div>
          )}
        </div>

        {/* Bottom hairline rule */}
        <div style={hairline} />
      </div>
    </div>
  );
}
