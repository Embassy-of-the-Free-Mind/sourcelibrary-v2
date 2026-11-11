'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Answer {
  status: 'none' | 'authentic' | 'unverified';
  zero_width: number;
  edition: string | null;
  message: string | null;
  signed_reference?: boolean;
  books: { title: string; url: string }[];
  books_sharing_code: number;
}

export default function MarkDecoder() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decode() {
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch('/api/decode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error || `The decoder answered ${res.status}.`);
      else setAnswer(body as Answer);
    } catch {
      setError('Could not reach the decoder. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <label htmlFor="mark-text" className="block text-secondary font-medium">
        Paste text copied from Source Library
      </label>
      <textarea
        id="mark-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        spellCheck={false}
        className="w-full rounded-lg border border-border-light bg-white p-3 text-base text-primary leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent-rust/40"
        placeholder="Copy a passage from any translated page, then paste it here."
      />
      <button
        type="button"
        onClick={decode}
        disabled={busy || text.length === 0}
        className="w-full sm:w-auto rounded-lg bg-primary px-6 py-3 text-white font-medium disabled:opacity-50"
      >
        {busy ? 'Reading…' : 'Read the mark'}
      </button>

      {error && <p role="alert" className="text-secondary">{error}</p>}

      {answer && (
        <div aria-live="polite" className="rounded-xl border border-border-light bg-white p-5 space-y-3 text-secondary leading-relaxed">
          {answer.status === 'none' && (
            <>
              <p className="text-primary font-medium">No mark found.</p>
              <p>
                {answer.zero_width === 0
                  ? 'This text has no hidden characters at all. Some apps strip them when you copy or paste; try copying straight from the reading page into this box.'
                  : `This text has ${answer.zero_width} hidden characters, but they do not form a Source Library mark.`}
              </p>
            </>
          )}
          {answer.status === 'unverified' && (
            <>
              <p className="text-primary font-medium">A mark is present, but its signature does not verify.</p>
              <p>
                It was not made by Source Library with our current key, or it was damaged in copying. We do not show
                what an unverified mark says, because anyone can write one.
              </p>
            </>
          )}
          {answer.status === 'authentic' && (
            <>
              <p className="text-primary font-medium">Signature verified: this mark was made by Source Library.</p>
              <p>
                Edition code <code className="font-mono">{answer.edition}</code>
                {answer.books.length === 1 ? (
                  <>
                    {' '}· from{' '}
                    <Link href={answer.books[0].url} className="text-accent-rust hover:underline">
                      {answer.books[0].title}
                    </Link>
                  </>
                ) : answer.books_sharing_code > 1 ? (
                  <> · shared by {answer.books_sharing_code > 5 ? 'several' : answer.books_sharing_code} books added at the same moment</>
                ) : null}
              </p>
              {answer.message ? (
                <blockquote className="border-l-2 border-border-light pl-4 whitespace-pre-wrap break-words">{answer.message}</blockquote>
              ) : (
                <p className="text-muted text-sm">
                  This passage carries only the short edition code. About one passage in six also carries a written note.
                </p>
              )}
              {answer.signed_reference && (
                <p className="text-sm">
                  The note ends with a signed reference to the account that downloaded this copy. It is a code, not a
                  name: only Source Library can match it to an account.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
