'use client';

import { useState } from 'react';
import { getRatingOptions } from '@/lib/review-queue';

/**
 * The page an emailed invitation opens.
 *
 * Everything here is shaped by one fact: the reader did not ask for this and
 * owes us nothing. So there is no sign-in, no account, no queue to learn, and
 * no next item pushed at them — one page, one question, and a way to leave.
 * A verdict is one click plus one confirm; the detail is optional and clearly
 * marked as such.
 *
 * The confirm step is not politeness. Mail scanners fetch every link in a
 * message before a human sees it, so the verdict cannot be recorded by the
 * link itself — see the POST-only note in /api/review/invite-submit.
 */
export default function InviteCheck({
  token,
  url,
  language,
  bookTitle,
  preselect,
}: {
  token: string;
  url: string;
  language: string;
  bookTitle: string;
  preselect: string | null;
}) {
  const ratings = getRatingOptions('translation-check');
  const [rating, setRating] = useState<string | null>(preselect);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');

  async function submit() {
    if (!rating && !note.trim()) return;
    setState('saving');
    const res = await fetch('/api/review/invite-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, rating, note }),
    });
    setState(res.ok ? 'done' : 'error');
  }

  if (state === 'done') {
    return (
      <div className="max-w-xl mx-auto px-6 py-16">
        <h1 className="text-2xl font-serif text-stone-900 mb-3">Thank you — that is recorded.</h1>
        <p className="text-stone-700 leading-relaxed">
          You have just done something almost nobody has done: read one of our machine
          translations against the original. Every claim we make about the quality of this
          library rests on a few dozen judgments like yours.
        </p>
        <p className="text-stone-700 leading-relaxed mt-3">
          If you would like another page, or would rather stop, just reply to the email — a
          person reads those.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-12">
      <p className="text-xs uppercase tracking-wider text-stone-500 mb-2">
        Translation check{language ? ` — ${language}` : ''}
      </p>
      <h1 className="text-2xl font-serif text-stone-900 leading-snug mb-4">
        Does our English say what the {language || 'original'} says?
      </h1>
      {bookTitle && <p className="text-stone-600 text-sm mb-5">{bookTitle}</p>}

      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-block px-4 py-2 rounded-md bg-accent-rust text-white text-sm font-medium hover:opacity-90"
      >
        Open the page &rarr;
      </a>

      <ol className="text-sm text-stone-600 space-y-1.5 list-decimal pl-5 mt-6">
        <li>Look at the scan — does our transcription match what is on the page?</li>
        <li>Then the English — does it say what the original says?</li>
        <li>If the transcription is wrong, the English cannot be judged; say so instead.</li>
      </ol>

      <div className="mt-6 space-y-2">
        {ratings.map(r => (
          <button
            key={r.rating}
            onClick={() => setRating(r.rating)}
            className={`w-full text-left px-4 py-3 rounded-md border-2 transition-colors ${
              rating === r.rating ? 'border-stone-800 bg-white' : 'border-stone-200 bg-white hover:border-stone-400'
            }`}
            style={{ borderLeftColor: r.color, borderLeftWidth: 6 }}
          >
            <div className="font-medium text-stone-900">{r.label}</div>
            <div className="text-xs text-stone-600 mt-0.5">{r.hint}</div>
          </button>
        ))}
      </div>

      <label htmlFor="invite-note" className="block text-sm font-medium text-stone-700 mt-6">
        Anything you noticed? <span className="font-normal text-stone-500">Optional.</span>
      </label>
      <p className="text-xs text-stone-500 mt-0.5 mb-2">
        A quoted line and what it should have said is the most useful thing you can give us — it
        is something we can actually fix.
      </p>
      <textarea
        id="invite-note"
        value={note}
        onChange={e => setNote(e.target.value)}
        rows={4}
        className="w-full px-3 py-2 border border-stone-300 rounded-md text-sm text-stone-900 bg-white resize-y focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
        placeholder="e.g. line 4 renders 'nisi' as 'if' — it should be 'unless', which reverses the sense"
      />

      <button
        onClick={submit}
        disabled={state === 'saving' || (!rating && !note.trim())}
        className="mt-4 px-5 py-2.5 rounded-md bg-accent-rust text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {state === 'saving' ? 'Recording…' : 'Send my answer'}
      </button>
      {state === 'error' && (
        <p className="text-sm text-red-700 mt-3">
          That did not save. Reply to the email instead and a person will record it.
        </p>
      )}
    </div>
  );
}
