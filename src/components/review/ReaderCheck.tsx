'use client';

import { useMemo, useState } from 'react';
import FullscreenImageViewer from '@/components/reader/FullscreenImageViewer';
import NotesRenderer from '@/components/reader/NotesRenderer';

/**
 * The blind reader check (#7573): one page at a time, a scan and two versions
 * of its text, and one question.
 *
 * The reader is a scholar who got a personal link by email, is not a Claude
 * user, and is giving us half an hour. So: no sign-in, no account, nothing to
 * install, and no verdict of ours anywhere on the page, before or after they
 * answer. Versions are "A" and "B" only; which is which was randomised per page
 * when the link was minted, and this component never learns the arm names.
 *
 * Answers save page by page, so closing the tab loses nothing: the same link
 * reopens at the first unanswered page.
 */
type Item = {
  title: string;
  page_number: number;
  image_url: string;
  text_a: string;
  text_b: string;
};

type Choice = 'A' | 'B' | 'same' | 'cannot_tell';
type Answer = { choice: Choice; invented: boolean; note: string };

const CHOICES: { value: Choice; label: string }[] = [
  { value: 'A', label: 'A is more faithful' },
  { value: 'B', label: 'B is more faithful' },
  { value: 'same', label: 'About the same' },
  { value: 'cannot_tell', label: 'Cannot tell' },
];

function firstUnanswered(n: number, answers: Record<number, Answer>): number {
  for (let i = 0; i < n; i++) if (!answers[i]) return i;
  return n;
}

export default function ReaderCheck({
  token,
  language,
  items,
  initialAnswers,
}: {
  token: string;
  language: string;
  items: Item[];
  initialAnswers: Record<number, Answer>;
}) {
  const total = items.length;
  const [answers, setAnswers] = useState<Record<number, Answer>>(initialAnswers);
  const answeredCount = Object.keys(answers).length;
  const [started, setStarted] = useState(answeredCount > 0);
  const [index, setIndex] = useState(() => firstUnanswered(total, initialAnswers));
  const [draft, setDraft] = useState<Answer | null>(() => initialAnswers[index] ?? null);
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [zoom, setZoom] = useState(false);
  // Below xl the two versions share one column; a switch shows one at a time so
  // a phone is not two full pages of text tall.
  const [shown, setShown] = useState<'A' | 'B'>('A');

  const languageName = useMemo(
    () => (language ? language.charAt(0).toUpperCase() + language.slice(1) : ''),
    [language],
  );

  function go(i: number) {
    setIndex(i);
    setDraft(answers[i] ?? null);
    setState('idle');
    setZoom(false);
    setShown('A');
    window.scrollTo({ top: 0 });
  }

  async function save() {
    if (!draft?.choice) return;
    setState('saving');
    try {
      const res = await fetch(`/api/check/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index, choice: draft.choice, invented: draft.invented, note: draft.note }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setState('error');
      return;
    }
    const next = { ...answers, [index]: draft };
    setAnswers(next);
    // Reviewing a finished set steps through it in order; otherwise go to the
    // next unanswered page after this one, then any earlier gap.
    if (firstUnanswered(total, next) === total) return go(index + 1);
    let gap = -1;
    for (let i = index + 1; i < total && gap < 0; i++) if (!next[i]) gap = i;
    go(gap >= 0 ? gap : firstUnanswered(total, next));
  }

  if (!started) {
    return (
      <div className="max-w-xl mx-auto px-6 py-12">
        <p className="text-xs uppercase tracking-wider text-stone-500 mb-2">
          Reader check{languageName ? `: ${languageName}` : ''}
        </p>
        <h1 className="text-2xl font-serif text-stone-900 leading-snug mb-4">
          Which transcription is more faithful to the page?
        </h1>
        <p className="text-stone-700 leading-relaxed">
          You will see {total} pages, one at a time. Each has the scan and two transcriptions of it,
          labelled A and B. They were made by different methods, and the order is shuffled on every
          page. Pick the one that better matches what is printed or written.
        </p>
        <ul className="text-sm text-stone-600 space-y-1.5 list-disc pl-5 mt-5">
          <li>About a minute or two per page. There are no wrong answers; &ldquo;Cannot tell&rdquo; is useful too.</li>
          <li>Your answers save as you go. You can stop at any time and reopen this link later.</li>
          <li>Tap or click the scan to enlarge it.</li>
        </ul>
        <button
          onClick={() => setStarted(true)}
          className="mt-8 px-5 py-2.5 rounded-md bg-accent-rust text-white text-sm font-medium hover:opacity-90"
        >
          Begin
        </button>
      </div>
    );
  }

  if (index >= total) {
    return (
      <div className="max-w-xl mx-auto px-6 py-16">
        <h1 className="text-2xl font-serif text-stone-900 mb-3">Thank you. All {total} pages are recorded.</h1>
        <p className="text-stone-700 leading-relaxed">
          Every number we publish about the quality of these texts rests on a machine reading the
          page. Your answers are how we find out whether that machine agrees with someone who
          actually reads {languageName || 'the language'}.
        </p>
        <p className="text-stone-700 leading-relaxed mt-3">
          If you would like another batch, or have something to tell us, reply to the email that
          brought you here. A person reads those.
        </p>
        <button onClick={() => go(0)} className="mt-6 text-sm text-stone-600 underline hover:text-stone-900">
          Review my answers
        </button>
      </div>
    );
  }

  const item = items[index];
  const choice = draft?.choice ?? null;

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <p className="text-xs uppercase tracking-wider text-stone-500">
          Reader check{languageName ? `: ${languageName}` : ''}
        </p>
        <p className="text-sm text-stone-700 tabular-nums" aria-live="polite">
          Page {index + 1} of {total}
          <span className="text-stone-500"> &middot; {answeredCount} answered</span>
        </p>
      </div>
      <div className="h-1 bg-stone-200 rounded-full overflow-hidden mb-5" aria-hidden>
        <div className="h-full bg-accent-rust" style={{ width: `${(answeredCount / total) * 100}%` }} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <button
            type="button"
            onClick={() => setZoom(true)}
            className="block w-full bg-stone-100 border border-stone-200 rounded-lg overflow-hidden cursor-zoom-in"
            aria-label="Enlarge the scan"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.image_url}
              alt={`Scan of page ${item.page_number}`}
              className="w-full h-auto lg:max-h-[calc(100vh-7rem)] object-contain"
            />
          </button>
          <p className="text-xs text-stone-500 mt-2">
            {item.title}, page {item.page_number}. Tap the scan to enlarge it.
          </p>
        </div>

        <div className="min-w-0">
          <div className="flex gap-2 mb-3 xl:hidden" role="group" aria-label="Which version to show">
            {(['A', 'B'] as const).map(label => (
              <button
                key={label}
                type="button"
                aria-pressed={shown === label}
                onClick={() => setShown(label)}
                className={`flex-1 px-3 py-2 rounded-md border-2 text-sm transition-colors ${
                  shown === label
                    ? 'border-stone-800 bg-stone-50 text-stone-900 font-medium'
                    : 'border-stone-200 bg-white text-stone-800 hover:border-stone-400'
                }`}
              >
                Version {label}
              </button>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {(['A', 'B'] as const).map(label => (
              <section
                key={label}
                className={`bg-white border border-stone-200 rounded-lg ${shown === label ? '' : 'hidden xl:block'}`}
              >
                <h2 className="px-4 py-2 border-b border-stone-200 text-sm font-medium text-stone-900">
                  Version {label}
                </h2>
                {/* The reader's own renderer, so margins, glosses and unclear
                    readings look exactly as they would on the site, and the
                    same way in both versions. */}
                <NotesRenderer
                  text={label === 'A' ? item.text_a : item.text_b}
                  showMetadata={false}
                  language={languageName}
                  className="px-4 py-3"
                />
              </section>
            ))}
          </div>
          <p className="text-xs text-stone-500 mt-2">
            Both versions are shown the way the library displays a transcription: marginal notes,
            glosses and unclear readings are set apart from the main text.
          </p>

          <fieldset className="mt-6 bg-white border border-stone-200 rounded-lg p-4">
            <legend className="px-1 text-base font-medium text-stone-900">
              Which is more faithful to the page?
            </legend>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
              {CHOICES.map(c => (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={choice === c.value}
                  onClick={() =>
                    setDraft(d => ({ choice: c.value, invented: d?.invented ?? false, note: d?.note ?? '' }))
                  }
                  className={`px-3 py-2.5 rounded-md border-2 text-sm text-left transition-colors ${
                    choice === c.value
                      ? 'border-stone-800 bg-stone-50 text-stone-900 font-medium'
                      : 'border-stone-200 bg-white text-stone-800 hover:border-stone-400'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <label className="flex items-start gap-2 mt-4 text-sm text-stone-800">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={draft?.invented ?? false}
                onChange={e =>
                  setDraft(d => ({
                    choice: d?.choice as Choice,
                    invented: e.target.checked,
                    note: d?.note ?? '',
                  }))
                }
              />
              <span>One of them says something the page does not.</span>
            </label>

            <label htmlFor="check-note" className="block text-sm text-stone-700 mt-4">
              Which words? <span className="text-stone-500">Optional. Quote them and say A or B.</span>
            </label>
            <textarea
              id="check-note"
              dir="auto"
              rows={2}
              maxLength={2000}
              value={draft?.note ?? ''}
              onChange={e =>
                setDraft(d => ({
                  choice: d?.choice as Choice,
                  invented: d?.invented ?? false,
                  note: e.target.value,
                }))
              }
              className="mt-1 w-full px-3 py-2 border border-stone-300 rounded-md text-sm text-stone-900 bg-white resize-y focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
            />

            <div className="flex items-center justify-between gap-3 mt-4">
              <button
                type="button"
                onClick={() => go(index - 1)}
                disabled={index === 0 || state === 'saving'}
                className="text-sm text-stone-600 underline hover:text-stone-900 disabled:opacity-0"
              >
                Previous page
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!choice || state === 'saving'}
                className="px-5 py-2.5 rounded-md bg-accent-rust text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {state === 'saving' ? 'Saving…' : index + 1 === total ? 'Save and finish' : 'Save and next'}
              </button>
            </div>
            {state === 'error' && (
              <p className="text-sm text-red-700 mt-3">
                That did not save. Please try again in a moment; if it keeps failing, reply to the
                email and tell us.
              </p>
            )}
          </fieldset>
        </div>
      </div>

      <FullscreenImageViewer
        src={item.image_url}
        alt={`Scan of page ${item.page_number}`}
        isOpen={zoom}
        onClose={() => setZoom(false)}
      />
    </div>
  );
}
