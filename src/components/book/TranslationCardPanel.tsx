/**
 * The Translation Card, rendered (#3881 — the card method, rule 2).
 *
 * Plain catalog voice: collapsed, the panel is the label alone — the badge
 * ("First Translation") or the earlier-translations line. Expanded, it is the
 * RECORD: the cited entries and the search line (what was consulted, when).
 * Provenance one click away, never a disclaimer in the reader's face.
 */

import { cardLabel, searchRecordLine, type TranslationCard } from '@/lib/first-translation/card';

export default function TranslationCardPanel({
  card,
  book,
  showExternalLinks,
}: {
  card: TranslationCard | null;
  book: { pages_translated?: number | null; language?: string | null };
  showExternalLinks: boolean;
}) {
  const label = cardLabel(card, book);
  if (!label) return null;

  const isFirst = label.register === 'first';
  const record = searchRecordLine(card);

  return (
    <div className="mt-3">
      <details className="group">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          {isFirst ? (
            <span className="inline-flex items-center gap-2 px-2.5 py-1 bg-accent-gold/20 text-accent-gold hover:bg-accent-gold/30 text-xs font-medium rounded-full border border-accent-gold/30 transition-colors">
              First Translation
            </span>
          ) : (
            <span className="text-sm text-stone-300 hover:text-stone-100 transition-colors">
              {label.sentence}
            </span>
          )}
        </summary>

        <div className="mt-2 rounded border border-stone-700/40 bg-stone-800/20 px-3 py-2.5 text-sm">
          {isFirst && (
            <p className="text-stone-300">The first English translation of this work.</p>
          )}

          {label.entries.length > 0 && (
            <ul className={`space-y-1 ${isFirst ? 'mt-2 border-t border-stone-700/30 pt-2' : ''}`}>
              {label.entries.map((e, i) => (
                <li key={i} className="text-[13px] text-stone-400">
                  {e.year && <span className="text-stone-500">{e.year} · </span>}
                  {e.translator && <span>{e.translator}, </span>}
                  {showExternalLinks && e.citation_url ? (
                    <a
                      href={e.citation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-stone-600 underline-offset-2 hover:text-stone-200"
                    >
                      {e.title ?? 'record'}
                    </a>
                  ) : (
                    <span>{e.title}</span>
                  )}
                  {e.completeness && e.completeness !== 'complete' && (
                    <span className="text-stone-500"> ({e.completeness})</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {record && (
            <p className="mt-2 text-[11px] leading-snug text-stone-500">{record}</p>
          )}
        </div>
      </details>
    </div>
  );
}

/**
 * The one quiet line for a book whose translation history has not been
 * researched — so silence never reads as "checked, nothing found". Rendered
 * by the page only for translated, non-English books with neither a card nor
 * any book-grain verdict.
 */
export function TranslationHistoryUnresearched() {
  return (
    <p className="mt-3 text-[12px] text-stone-500">
      Translation history: not yet researched.
    </p>
  );
}
