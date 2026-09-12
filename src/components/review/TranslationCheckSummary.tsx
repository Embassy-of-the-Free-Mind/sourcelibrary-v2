'use client';

import { useEffect, useState } from 'react';

/**
 * What the checking has found so far, per language.
 *
 * This exists because the review system's only feedback to a volunteer was
 * three counters that can only go up — ratings, notes, yours. An activity count
 * reports effort, not progress: it cannot distinguish a corpus getting better
 * from people clicking more, and it never finishes. This shows COVERAGE against
 * a stated target instead, so a language can visibly be done.
 *
 * The three numbers are kept apart on purpose:
 *   checked   — pages at least one person has judged
 *   decided   — pages where enough people agreed to call it
 *   faithful  — of the pages whose TRANSCRIPTION held, how many read faithfully
 *
 * Reporting only `checked` would overstate what we know; folding transcription
 * failures into the faithfulness figure would answer a different question than
 * the one asked.
 */
type Lang = {
  language: string;
  queued: number;
  checked: number;
  decided: number;
  target: number;
  verdicts: Record<string, number>;
  transcription_failed: number;
  faithful_pct: number | null;
  faithful_basis: number;
};

export default function TranslationCheckSummary() {
  const [languages, setLanguages] = useState<Lang[] | null>(null);

  useEffect(() => {
    fetch('/api/review/translation-check/summary')
      .then(r => r.json())
      .then(d => setLanguages(d.languages ?? []))
      .catch(() => setLanguages([]));
  }, []);

  if (!languages) return null;
  if (languages.length === 0) return null;

  return (
    <section className="mt-8 border-t border-stone-200 pt-6">
      <h2 className="text-sm font-semibold text-stone-900">What readers have found so far</h2>
      <p className="text-xs text-stone-500 mt-1 mb-4 max-w-2xl">
        Every claim we make about translation quality across the whole library currently rests on
        32 pages a person has actually read. {languages[0].target} pages in a language is enough
        to say something honest about that language.
      </p>

      <div className="space-y-3">
        {languages.map(l => {
          const pct = Math.min(100, Math.round((l.checked / l.target) * 100));
          return (
            <div key={l.language} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-stone-900">{l.language}</span>
                <span className="text-stone-600 text-xs">
                  {l.checked} of {l.target} checked
                  {l.decided > 0 && <> · {l.decided} settled</>}
                </span>
              </div>
              <div className="h-1.5 mt-1.5 rounded bg-stone-200 overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{ width: `${pct}%`, background: 'var(--accent-rust, #9e4a3a)' }}
                />
              </div>
              {l.faithful_pct !== null && (
                <p className="text-xs text-stone-600 mt-1">
                  Of {l.faithful_basis} settled pages whose transcription was sound,{' '}
                  <b>{l.faithful_pct}%</b> read faithfully.
                  {l.transcription_failed > 0 && (
                    <>
                      {' '}
                      A further {l.transcription_failed} failed before the translation —
                      the transcription did not match the page.
                    </>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
