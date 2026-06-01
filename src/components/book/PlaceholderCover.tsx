import { cn } from '@/lib/utils';

/**
 * Generated typographic placeholder cover for books with no digitised cover
 * image. A dark warm-brown "book cover" with cream type, rendered from the
 * book's own metadata so an un-digitised book still looks intentionally
 * catalogued rather than "missing".
 *
 * Pure presentational + prop-driven (no image fetch), so it's crisp at any
 * size and works for all ~29k books. It fills its parent absolutely, inheriting
 * whatever aspect ratio the surrounding cover box already sets (2/3 in the
 * catalogue grid, 3/4 on cards and the detail hero). Typography is sized in
 * container-query units (cqw) so it scales identically across every surface,
 * and wraps/breaks/clamps so long titles never cross the card edges.
 *
 * Colours/fonts come from theme tokens (--color-cover-* + --font-serif/sans),
 * so the whole look retheme​s by editing globals.css — nothing hardcoded here.
 * Author and year lines are omitted cleanly when missing.
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

/**
 * Display-time author cleanup (does NOT mutate the underlying data):
 * strips a surrounding pair of square brackets + whitespace
 * ("[Agrippa, Henricus Cornelius]" → "Agrippa, Henricus Cornelius") and drops
 * bibliographic non-values ("Unknown", "anonymous", …).
 */
function cleanAuthor(author?: string | null): string {
  let a = (author ?? '').trim();
  a = a.replace(/^\[+\s*/, '').replace(/\s*\]+$/, '').trim();
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
  const hairline = { background: 'var(--color-cover-rule, #46413a)', height: '1px', flex: '0 0 auto' } as const;
  // Keep long unbroken strings inside the card.
  const wrap = { overflowWrap: 'break-word', wordBreak: 'break-word', hyphens: 'auto', maxWidth: '100%' } as const;

  return (
    <div
      aria-hidden="true"
      className={cn('absolute inset-0 overflow-hidden', className)}
      style={{
        containerType: 'inline-size',
        background: 'var(--color-cover-bg, #2b2722)',
        border: '0.5px solid var(--color-cover-rule, #46413a)',
      }}
    >
      {/* Generous side padding so type never reaches the edges. */}
      <div className="absolute inset-0 flex flex-col" style={{ padding: '11cqw 13cqw' }}>
        {/* Top hairline rule */}
        <div style={hairline} />

        {/* Centred title / author / year, between the rules */}
        <div
          className="flex flex-col items-center justify-center text-center"
          style={{ flex: '1 1 0%', minHeight: 0, gap: '4cqw', padding: '7cqw 0' }}
        >
          <div
            style={{
              ...wrap,
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              fontSize: '10.5cqw',
              lineHeight: 1.14,
              color: 'var(--color-cover-title, #e9e1d0)',
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
              style={{
                ...wrap,
                fontFamily: 'var(--font-serif)',
                fontSize: '6cqw',
                lineHeight: 1.22,
                color: 'var(--color-cover-muted, #b3a890)',
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
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '4cqw',
                letterSpacing: '0.18em',
                color: 'var(--color-cover-muted, #b3a890)',
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
