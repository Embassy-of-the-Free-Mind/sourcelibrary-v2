'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  cite,
  modernForm,
  sentenceById,
  wordById,
  type Exercise,
  type Explanation,
  type Note,
  type Quote,
  type Word,
} from '@/lib/learn-yucatec';

const pageLabel = (key: string, page: number) => `${cite(key)}, p. ${page}`;

export function SourceLink({ q, className = '' }: { q: { key: string; page: number; url: string }; className?: string }) {
  return (
    <Link href={q.url} target="_blank" className={`underline underline-offset-2 decoration-stone-300 ${className}`}>
      {pageLabel(q.key, q.page)}
    </Link>
  );
}

/** A dictionary entry as printed (Spanish) with the site's translation under it. */
export function Entry({ q }: { q: Quote }) {
  return (
    <div className="text-sm">
      {q.es && <p className="text-primary">{q.es}</p>}
      {q.en && q.en !== q.es && <p className="text-secondary italic">{q.en}</p>}
      <p className="text-xs text-muted mt-0.5"><SourceLink q={q} /></p>
    </div>
  );
}

// ── Teach card ──

export function TeachCard({ word, signedIn, onPropose }: { word: Word; signedIn: boolean; onPropose: (form: string, place: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState('');
  const [place, setPlace] = useState('');
  const [sent, setSent] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const modern = modernForm(word);
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted mb-2">New word</p>
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h2 className="font-serif text-4xl text-primary">{word.form}</h2>
          <p className="text-lg text-secondary mt-1">{word.short}</p>
        </div>
        {word.dresden && (
          <a href={word.dresden.url} target="_blank" className="block w-24 shrink-0 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={word.dresden.crop_url} alt={`${word.dresden.value} in bar-and-dot, Dresden Codex`} className="w-24 h-16 object-contain bg-white rounded border border-border-light" />
            <span className="block text-[11px] text-muted mt-1 leading-tight">Dresden Codex, p. {word.dresden.codex_page}</span>
          </a>
        )}
      </div>

      <section className="mt-5 border-t border-border-light pt-3">
        <p className="text-xs text-muted mb-1">In the dictionary</p>
        <Entry q={{ ...word.dict, cite: cite(word.dict.key) }} />
      </section>

      <section className="mt-4">
        <p className="text-xs text-muted mb-1">On the page</p>
        <p className="font-serif text-lg text-primary">{word.attest.text}</p>
        <p className="text-xs text-muted"><SourceLink q={word.attest} /></p>
      </section>

      {word.note && (
        <p className="mt-4 text-sm text-secondary">
          {word.note}
          {word.note_ref && <> (<SourceLink q={word.note_ref} />)</>}
        </p>
      )}
      {word.dresden && (
        <p className="mt-3 text-sm text-secondary">
          The same number in bar-and-dot is in the glyph course: <Link href="/learn/maya" className="underline underline-offset-2">Read the glyphs</Link>.
        </p>
      )}

      {modern ? (
        <p className="mt-4 text-sm"><span className="text-muted">Said today:</span> <span className="font-medium text-primary">{modern}</span></p>
      ) : (
        <div className="mt-5">
          {!open ? (
            <button type="button" onClick={() => setOpen(true)} className="text-sm text-muted underline underline-offset-2">
              People say it differently today?
            </button>
          ) : !signedIn ? (
            <p className="text-sm text-secondary">
              <Link href="/auth/signin?callbackUrl=/learn/yucatec" className="underline underline-offset-2">Sign in</Link> to suggest how people say it today. Suggestions go to Maya speakers to check; nothing shows here until one confirms it.
            </p>
          ) : sent === 'sent' ? (
            <p className="text-sm text-secondary">Thank you. It goes to the speakers&apos; queue; it shows here only once a speaker confirms it.</p>
          ) : (
            <form
              className="space-y-2"
              onSubmit={async (ev) => {
                ev.preventDefault();
                if (!form.trim()) return;
                setSent('sending');
                setSent((await onPropose(form.trim(), place.trim())) ? 'sent' : 'error');
              }}
            >
              <label className="block text-sm text-secondary" htmlFor="modern-form">People here say</label>
              <input id="modern-form" value={form} onChange={(e) => setForm(e.target.value)} maxLength={80} className="w-full rounded-lg border border-border-light p-3 text-base bg-white" />
              <label className="block text-sm text-secondary" htmlFor="modern-place">Where (town, optional)</label>
              <input id="modern-place" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={80} className="w-full rounded-lg border border-border-light p-3 text-base bg-white" />
              <div className="flex gap-2">
                <button type="submit" disabled={sent === 'sending'} className="px-4 py-2 rounded-lg bg-[#1a1612] text-white text-sm">Send to speakers</button>
                <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg border border-border-light bg-white text-sm text-secondary">Cancel</button>
              </div>
              {sent === 'error' && <p className="text-sm text-accent-rust">That did not send. Try again.</p>}
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ── Graded exercises ──

const choiceClass = (selected: boolean, locked: boolean, state?: 'right' | 'wrong') =>
  `w-full text-left px-4 py-3 rounded-xl border-2 text-base transition-colors ${
    state === 'right' ? 'border-emerald-600 bg-emerald-50' : state === 'wrong' ? 'border-accent-rust bg-red-50' : selected ? 'border-[#1a1612] bg-white' : 'border-border-light bg-white'
  } ${locked ? '' : 'active:scale-[0.99]'}`;

interface ViewProps {
  ex: Exercise;
  answer: string;
  setAnswer: (a: string) => void;
  locked: boolean;
  /** match only: reports each wrong pairing as it happens, and the end. */
  onMatchMiss?: (wordId: string, chosenShort: string) => void;
  onMatchDone?: () => void;
}

export function ExerciseView({ ex, answer, setAnswer, locked, onMatchMiss, onMatchDone }: ViewProps) {
  if (ex.kind === 'pick') {
    const w = wordById(ex.word)!;
    return (
      <div>
        <p className="text-sm text-muted mb-3">What does this mean?</p>
        <p className="font-serif text-4xl text-primary mb-1">{w.form}</p>
        <p className="text-xs text-muted mb-6">{w.attest.text.length > w.form.length + 3 ? `as in “${w.attest.text}”` : '\u00a0'}</p>
        <div className="space-y-2">
          {ex.options.map((o) => (
            <button key={o} type="button" disabled={locked} onClick={() => setAnswer(o)} className={choiceClass(answer === o, locked, locked ? (o === ex.word ? 'right' : answer === o ? 'wrong' : undefined) : undefined)}>
              {wordById(o)!.short}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (ex.kind === 'pick-form') {
    const w = wordById(ex.word)!;
    return (
      <div>
        {w.dresden ? (
          <>
            <p className="text-sm text-muted mb-3">Which number is painted here?</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={w.dresden.crop_url} alt="A bar-and-dot number from the Dresden Codex" className="h-28 w-full object-contain bg-white rounded-lg border border-border-light mb-1" />
            <p className="text-xs text-muted mb-6">Dresden Codex, p. {w.dresden.codex_page}. A dot is one, a bar is five.</p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted mb-3">Which word means</p>
            <p className="font-serif text-3xl text-primary mb-6">“{w.short}”?</p>
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          {ex.options.map((o) => (
            <button key={o} type="button" disabled={locked} onClick={() => setAnswer(o)} className={`${choiceClass(answer === o, locked, locked ? (o === ex.word ? 'right' : answer === o ? 'wrong' : undefined) : undefined)} text-center font-serif text-xl`}>
              {wordById(o)!.form}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (ex.kind === 'fill') {
    const s = sentenceById(ex.sentence)!;
    const parts = splitOnBlank(s.show, ex.blank);
    return (
      <div>
        <p className="text-sm text-muted mb-3">Fill the missing word</p>
        <p className="font-serif text-2xl text-primary leading-snug mb-2">
          {parts[0]}
          <span className={`inline-block min-w-16 border-b-2 mx-1 text-center ${answer ? 'border-[#1a1612]' : 'border-stone-400'}`}>{answer || ' '}</span>
          {parts[1]}
        </p>
        <p className="text-secondary mb-1">“{s.en}”</p>
        <p className="text-xs text-muted mb-6">{pageLabel(s.key, s.page)}</p>
        <div className="grid grid-cols-2 gap-2">
          {ex.options.map((o) => (
            <button key={o.text} type="button" disabled={locked} onClick={() => setAnswer(o.text)} className={`${choiceClass(answer === o.text, locked, locked ? (o.text === ex.blank ? 'right' : answer === o.text ? 'wrong' : undefined) : undefined)} text-center font-serif text-xl`}>
              {o.text}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (ex.kind === 'read') {
    const s = sentenceById(ex.sentence)!;
    return (
      <div>
        <p className="text-sm text-muted mb-3">Read this line. What does it say?</p>
        <blockquote className="font-serif text-2xl text-primary leading-snug border-l-4 border-accent-rust pl-3 mb-1">{s.show}</blockquote>
        <p className="text-xs text-muted mb-6 pl-4">{pageLabel(s.key, s.page)}</p>
        <div className="space-y-2">
          {ex.options.map((o) => (
            <button key={o} type="button" disabled={locked} onClick={() => setAnswer(o)} className={choiceClass(answer === o, locked, locked ? (o === ex.sentence ? 'right' : answer === o ? 'wrong' : undefined) : undefined)}>
              {sentenceById(o)!.en_short ?? sentenceById(o)!.en}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (ex.kind === 'build') return <BuildView ex={ex} answer={answer} setAnswer={setAnswer} locked={locked} />;
  if (ex.kind === 'match') return <MatchView ex={ex} locked={locked} onMiss={onMatchMiss} onDone={onMatchDone} />;
  return null;
}

function splitOnBlank(text: string, blank: string): [string, string] {
  const re = new RegExp(`(^|[\\s,.;:¿?¡!])(${blank.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[\\s,.;:?!])`, 'iu');
  const m = re.exec(text);
  if (!m) return [text, ''];
  const start = m.index + m[1].length;
  return [text.slice(0, start), text.slice(start + m[2].length)];
}

function BuildView({ ex, answer, setAnswer, locked }: { ex: Extract<Exercise, { kind: 'build' }>; answer: string; setAnswer: (a: string) => void; locked: boolean }) {
  const s = sentenceById(ex.sentence)!;
  // Tiles are tracked by position in ex.tiles, so a repeated word cannot be picked twice.
  const [order, setOrder] = useState<number[]>([]);
  const place = (next: number[]) => {
    setOrder(next);
    setAnswer(next.length === ex.tiles.length ? next.map((i) => ex.tiles[i]).join(' ') : '');
  };
  return (
    <div>
      <p className="text-sm text-muted mb-3">Put the words in order</p>
      <p className="font-serif text-2xl text-primary mb-1">“{s.tiles_en ?? s.en}”</p>
      <p className="text-xs text-muted mb-5">{pageLabel(s.key, s.page)}</p>
      <div className="min-h-16 flex flex-wrap gap-2 border-b-2 border-border-light pb-3 mb-5">
        {order.map((i, k) => (
          <button key={`${i}-${k}`} type="button" disabled={locked} onClick={() => place(order.filter((_, j) => j !== k))} className="px-3 py-2 rounded-lg border-2 border-[#1a1612] bg-white font-serif text-lg">
            {ex.tiles[i]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {ex.tiles.map((t, i) => (
          <button key={i} type="button" disabled={locked || order.includes(i)} onClick={() => place([...order, i])} className={`px-3 py-2 rounded-lg border-2 font-serif text-lg ${order.includes(i) ? 'border-stone-200 bg-stone-100 text-transparent' : 'border-border-light bg-white text-primary'}`}>
            {t}
          </button>
        ))}
      </div>
      {answer && !locked && <p className="sr-only">Ready to check: {answer}</p>}
    </div>
  );
}

function MatchView({ ex, locked, onMiss, onDone }: { ex: Extract<Exercise, { kind: 'match' }>; locked: boolean; onMiss?: (wordId: string, chosenShort: string) => void; onDone?: () => void }) {
  const [left, setLeft] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const shorts = useMemo(() => Object.fromEntries(ex.words.map((w) => [w, wordById(w)!.short])), [ex.words]);
  const tapRight = (r: string) => {
    if (!left || locked) return;
    if (r === left) {
      const next = [...done, r];
      setDone(next);
      setLeft(null);
      if (next.length === ex.words.length) onDone?.();
    } else {
      onMiss?.(left, shorts[r]);
      setFlash(r);
      setTimeout(() => setFlash(null), 500);
      setLeft(null);
    }
  };
  return (
    <div>
      <p className="text-sm text-muted mb-4">Tap a word, then its meaning</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          {ex.words.map((w) => (
            <button key={w} type="button" disabled={done.includes(w) || locked} onClick={() => setLeft(w)} className={`w-full px-3 py-3 rounded-xl border-2 font-serif text-lg ${done.includes(w) ? 'border-stone-200 text-stone-300 bg-stone-50' : left === w ? 'border-[#1a1612] bg-white' : 'border-border-light bg-white text-primary'}`}>
              {wordById(w)!.form}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {ex.right.map((r) => (
            <button key={r} type="button" disabled={done.includes(r) || locked} onClick={() => tapRight(r)} className={`w-full px-3 py-3 rounded-xl border-2 text-sm leading-tight ${done.includes(r) ? 'border-stone-200 text-stone-300 bg-stone-50' : flash === r ? 'border-accent-rust bg-red-50' : 'border-border-light bg-white text-primary'}`}>
              {shorts[r]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── After the check ──

export function Feedback({ ex, correct, explanation, misses }: { ex: Exercise; correct: boolean; explanation: Explanation | null; misses?: { word: string; chosen: string }[] }) {
  const sentence = ex.kind === 'read' || ex.kind === 'fill' || ex.kind === 'build' ? sentenceById(ex.sentence) : undefined;
  return (
    <div className="text-sm">
      <p className={`font-semibold text-base mb-2 ${correct ? 'text-emerald-700' : 'text-accent-rust'}`}>{correct ? 'Right.' : 'Not quite.'}</p>

      {!correct && ex.kind === 'match' && misses && misses.length > 0 && (
        <div className="space-y-3">
          {misses.map((m, i) => {
            const w = wordById(m.word)!;
            return (
              <div key={i}>
                <p className="text-primary">You matched <b>{w.form}</b> with “{m.chosen}”. <b>{w.form}</b> is “{w.short}”:</p>
                <Entry q={{ ...w.dict, cite: cite(w.dict.key) }} />
              </div>
            );
          })}
        </div>
      )}

      {!correct && explanation?.chosen && ex.kind !== 'build' && (
        <div className="mb-3">
          {ex.kind === 'read' && explanation.chosen.sentence ? (
            <>
              <p className="text-primary">You chose “{explanation.chosen.label}”. That is the line</p>
              <p className="font-serif text-base text-primary">{explanation.chosen.sentence.show}</p>
              <p className="text-xs text-muted"><SourceLink q={explanation.chosen.sentence} /></p>
            </>
          ) : (
            <>
              <p className="text-primary">You chose <b>{explanation.chosen.label}</b>: “{explanation.chosen.means}”.</p>
              {explanation.chosen.quote && <Entry q={explanation.chosen.quote} />}
            </>
          )}
        </div>
      )}

      {explanation && (ex.kind === 'pick' || ex.kind === 'pick-form' || ex.kind === 'fill') && (
        <div className="mb-3">
          <p className="text-primary">{correct ? '' : 'The answer: '}<b>{explanation.right.label}</b> is “{explanation.right.means}”.</p>
          {!correct && explanation.right.quote && <Entry q={explanation.right.quote} />}
        </div>
      )}

      {!correct && ex.kind === 'build' && explanation && (
        <div className="mb-3">
          {explanation.chosen && <p className="text-secondary">You wrote: <span className="font-serif">{explanation.chosen.label}</span></p>}
          <p className="text-primary">On the page: <span className="font-serif text-base">{explanation.right.label}</span></p>
        </div>
      )}

      {!correct && explanation?.rule && (
        <div className="mb-3 rounded-lg bg-white border border-border-light p-3">
          <p className="text-primary">{explanation.rule.text}</p>
          {explanation.rule.quoteRef && (
            <blockquote className="mt-2 text-secondary italic">
              “{explanation.rule.quoteRef.en ?? explanation.rule.quoteRef.es}”
              <span className="block not-italic text-xs text-muted mt-0.5"><SourceLink q={explanation.rule.quoteRef} /></span>
            </blockquote>
          )}
        </div>
      )}

      {sentence && (
        <div className="mt-2 border-t border-border-light pt-2">
          <p className="font-serif text-base text-primary">{sentence.show}</p>
          {sentence.es && <p className="text-secondary">Spanish on the page: “{sentence.es}”</p>}
          <p className="text-secondary">“{sentence.en}”</p>
          <p className="text-xs text-muted"><SourceLink q={sentence} />{sentence.show_note ? ` · ${sentence.show_note}` : ''}</p>
        </div>
      )}
    </div>
  );
}

// ── Grammar note ──

export function NoteView({ note }: { note: Note }) {
  return (
    <article>
      <p className="text-xs uppercase tracking-wide text-muted mb-2">Grammar note</p>
      <h2 className="font-serif text-3xl text-primary mb-3">{note.title}</h2>
      <p className="text-base text-primary leading-relaxed mb-5">{note.body}</p>
      {note.table && (
        <figure className="mb-5">
          <table className="w-full text-sm bg-white rounded-lg border border-border-light">
            <tbody>
              {note.table.rows.map(([h, es, en]) => (
                <tr key={h} className="border-b border-border-light last:border-0">
                  <td className="px-3 py-2 font-serif text-lg text-primary">{h.replace(/,$/, '')}</td>
                  <td className="px-3 py-2 text-primary">{es}</td>
                  <td className="px-3 py-2 text-secondary italic">{en}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <figcaption className="text-xs text-muted mt-1"><SourceLink q={note.table} /></figcaption>
        </figure>
      )}
      <div className="space-y-4">
        {note.quotes.map((q, i) => (
          <blockquote key={i} className="border-l-4 border-stone-300 pl-3">
            {q.es && <p className="text-primary">“{q.es}”</p>}
            {q.en && <p className={q.es ? 'text-secondary italic' : 'text-primary'}>“{q.en}”</p>}
            <p className="text-xs text-muted mt-0.5"><SourceLink q={q} /></p>
          </blockquote>
        ))}
      </div>
    </article>
  );
}
