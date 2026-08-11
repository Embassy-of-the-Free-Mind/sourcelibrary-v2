/**
 * The Translation Card, rendered (#3881 — the card method, rule 2).
 *
 * When a book's work has a clean card in `work_translation_history`, this
 * panel IS the first-translation surface: the one sentence, then the cited
 * entries. The page mounts it INSTEAD of the legacy FirstTranslationEvidence
 * panel whenever cardLabel() resolves — one decision point, no side-by-side
 * contradiction — and falls back to the legacy panel otherwise, so a book
 * without a card renders exactly as before this PR.
 */

import { cardLabel, type TranslationCard } from '@/lib/first-translation/card';

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
  return (
    <div className="mt-3 rounded border border-stone-700/40 bg-stone-800/20 px-3 py-2.5 text-sm">
      <div className="flex items-start gap-2">
        {isFirst ? (
          <span className="mt-0.5 inline-block whitespace-nowrap rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            First Translation
          </span>
        ) : (
          <p className="text-stone-300">{label.sentence}</p>
        )}
      </div>

      {label.entries.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-stone-700/30 pt-2">
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

    </div>
  );
}
