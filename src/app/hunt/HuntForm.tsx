'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const STORE_KEY = 'sl-hunt-trithemius';
const TOTAL = 7;

interface Saved {
  progress: string | null;
  solved: number[];
  riddles: Record<number, string>;
  reads: Record<number, { citation: string; url: string | null }>;
  signed?: boolean;
}

interface Reply {
  correct?: boolean;
  step?: number;
  total?: number;
  read?: { citation: string; url: string | null } | null;
  next?: { step: number; riddle: string } | null;
  solved?: number[];
  complete?: boolean;
  progress?: string | null;
  error?: string;
}

const EMPTY: Saved = { progress: null, solved: [], riddles: {}, reads: {} };

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export default function HuntForm() {
  const [saved, setSaved] = useState<Saved>(EMPTY);
  const [step, setStep] = useState(1);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [showName, setShowName] = useState(false);

  useEffect(() => {
    const s = load();
    setSaved(s);
    const firstOpen = Array.from({ length: TOTAL }, (_, i) => i + 1).find((n) => !s.solved.includes(n));
    if (firstOpen) setStep(firstOpen);
  }, []);

  function persist(next: Saved) {
    setSaved(next);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* private mode: progress lasts for this visit only */
    }
  }

  async function check() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/hunt/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step, answer, progress: saved.progress }),
      });
      const body: Reply = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error || `The hunt answered ${res.status}.`);
        return;
      }
      if (!body.correct) {
        setMessage('Not that. Read the page again.');
        return;
      }
      const next: Saved = {
        ...saved,
        progress: body.progress ?? saved.progress,
        solved: body.solved ?? saved.solved,
        riddles: body.next ? { ...saved.riddles, [body.next.step]: body.next.riddle } : saved.riddles,
        reads: body.read ? { ...saved.reads, [step]: body.read } : saved.reads,
      };
      persist(next);
      setAnswer('');
      if (body.next) setStep(body.next.step);
      setMessage(body.complete ? 'That was the last one. You can sign the list below.' : 'Right.');
    } catch {
      setMessage('Could not reach the library. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function sign() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/hunt/solvers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress: saved.progress, name, show_name: showName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 409) {
        setMessage(body.error || `The list answered ${res.status}.`);
        return;
      }
      persist({ ...saved, signed: true });
      setMessage(
        body.name_pending
          ? 'Signed. Your name will appear once a librarian has seen it.'
          : 'Signed. Your solve is on the list.',
      );
    } catch {
      setMessage('Could not reach the library. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const complete = Array.from({ length: TOTAL }, (_, i) => i + 1).every((n) => saved.solved.includes(n));

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <label htmlFor="hunt-step" className="block text-secondary font-medium">
          Which riddle are you answering?
        </label>
        <select
          id="hunt-step"
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
          className="w-full sm:w-auto rounded-lg border border-border-light bg-white p-3 text-base text-primary"
        >
          {Array.from({ length: TOTAL }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              Riddle {n} of {TOTAL}
              {saved.solved.includes(n) ? ' (solved)' : ''}
            </option>
          ))}
        </select>

        <label htmlFor="hunt-answer" className="block text-secondary font-medium">
          Your answer
        </label>
        <input
          id="hunt-answer"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && answer.trim() && !busy) check();
          }}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-border-light bg-white p-3 text-base text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/40"
        />
        <button
          type="button"
          onClick={check}
          disabled={busy || !answer.trim()}
          className="w-full sm:w-auto rounded-lg bg-primary px-6 py-3 text-white font-medium disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Check'}
        </button>
        {message && (
          <p role="status" aria-live="polite" className="text-primary font-medium">
            {message}
          </p>
        )}
      </div>

      {saved.solved.length > 0 && (
        <div className="rounded-xl border border-border-light bg-white p-5 space-y-4 text-secondary leading-relaxed">
          <p className="text-primary font-medium">
            Solved: {saved.solved.length} of {TOTAL}
          </p>
          <ol className="space-y-4 list-none p-0 m-0">
            {Array.from({ length: TOTAL }, (_, i) => i + 1)
              .filter((n) => saved.riddles[n] || saved.reads[n])
              .map((n) => (
                <li key={n} className="space-y-1">
                  <p className="text-primary font-medium">Riddle {n}</p>
                  {saved.riddles[n] && <p className="whitespace-pre-line break-words">{saved.riddles[n]}</p>}
                  {saved.reads[n] && (
                    <p className="text-sm">
                      You read:{' '}
                      {saved.reads[n].url ? (
                        <a href={saved.reads[n].url!} className="text-accent-rust hover:underline">
                          {saved.reads[n].citation}
                        </a>
                      ) : (
                        saved.reads[n].citation
                      )}
                    </p>
                  )}
                </li>
              ))}
          </ol>
        </div>
      )}

      {complete && !saved.signed && (
        <div className="rounded-xl border border-border-light bg-white p-5 space-y-3 text-secondary leading-relaxed">
          <p className="text-primary font-medium">Sign the list of solvers</p>
          <p>
            The list shows the date you finished. It shows a name only if you give one and tick the box, and only after
            a librarian has seen it.
          </p>
          <input
            aria-label="Name to show (optional)"
            placeholder="Name to show (optional)"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border-light bg-white p-3 text-base text-primary"
          />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
            Show this name on the public list
          </label>
          <button
            type="button"
            onClick={sign}
            disabled={busy}
            className="w-full sm:w-auto rounded-lg bg-primary px-6 py-3 text-white font-medium disabled:opacity-50"
          >
            Sign
          </button>
        </div>
      )}

      {saved.signed && (
        <p>
          You are on the <Link href="/hunt/solvers" className="text-accent-rust hover:underline">list of solvers</Link>.
        </p>
      )}
    </div>
  );
}
