'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  COURSE,
  modernForm,
  sentenceById,
  wordById,
  type Exercise,
  type Explanation,
  type Note,
  type Quote,
  type Word,
} from '@/lib/learn-yucatec';

// ── Where a thing comes from: always one tap away, never in the way ──

const DICTIONARIES = new Set(['piop', 'coord', 'motul1']);

/** "Beltrán's book (1859)", "Pío Pérez's dictionary (1866–77)", "the Motul dictionary". */
export function bookName(key: string): string {
  if (key === 'motul1') return 'the Motul dictionary';
  const cite = COURSE.books[key]?.cite ?? key;
  const author = cite.split(',')[0];
  const year = /\(([^)]+)\)\s*$/.exec(cite)?.[1];
  return `${author}’s ${DICTIONARIES.has(key) ? 'dictionary' : 'book'}${year ? ` (${year})` : ''}`;
}

const fromLabel = (refs: { key: string; page: number }[]) => {
  const byBook = new Map<string, number[]>();
  for (const r of refs) byBook.set(r.key, [...new Set([...(byBook.get(r.key) ?? []), r.page])].sort((a, b) => a - b));
  const parts = [...byBook].map(([k, ps]) => `${bookName(k)}, ${ps.length > 1 ? 'pp.' : 'p.'} ${ps.join(', ')}`);
  return `From ${parts.join(' and ')}`;
};

export function PageLink({ q, children }: { q: { url: string; key: string; page: number }; children?: ReactNode }) {
  return (
    <Link href={q.url} target="_blank" className="text-xs text-muted underline underline-offset-2 decoration-stone-300">
      {children ?? `Open ${bookName(q.key).replace(/^the /, '')}, p. ${q.page}`}
    </Link>
  );
}

/** A small "From … p. N" line that opens the source's own words and the page link. */
export function SourceTap({ refs, children }: { refs: { key: string; page: number }[]; children: ReactNode }) {
  return (
    <details className="group mt-4 text-sm">
      <summary className="list-none cursor-pointer select-none inline-flex items-center gap-1.5 text-muted min-h-11">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
        <span className="underline underline-offset-2 decoration-stone-300">{fromLabel(refs)}</span>
      </summary>
      <div className="mt-1 yk-r bg-white/70 border border-border-light p-3 space-y-3 text-secondary">{children}</div>
    </details>
  );
}

function SourceQuote({ q }: { q: Quote }) {
  return (
    <div>
      {q.es && <p className="text-primary">“{q.es}”</p>}
      {q.en && q.en !== q.es && <p className="italic">“{q.en}”</p>}
      <PageLink q={q} />
    </div>
  );
}

const entryOf = (w: Word): Quote => ({ ...w.dict });

// ── New word ──

export function TeachCard({ word, signedIn, onPropose }: { word: Word; signedIn: boolean; onPropose: (form: string, place: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState('');
  const [place, setPlace] = useState('');
  const [sent, setSent] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const modern = modernForm(word);
  const lineIsLonger = word.attest.text.length > word.form.length + 3;
  return (
    <div>
      <Chip>New word</Chip>
      <div className="mt-4 yk-r-lg bg-white border-2 border-border-light px-5 py-6 text-center yk-pop">
        {word.dresden && (
          <a href={word.dresden.url} target="_blank" className="inline-block mb-3" aria-label={`${word.dresden.value} in bar-and-dot, Dresden Codex p. ${word.dresden.codex_page}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={word.dresden.crop_url} alt="" className="h-20 w-28 object-contain mx-auto mix-blend-multiply" />
            <span className="block text-[11px] text-muted">Dresden Codex, p. {word.dresden.codex_page}</span>
          </a>
        )}
        <h2 className="font-serif text-5xl text-primary">{word.form}</h2>
        <p className="text-xl text-secondary mt-2">{word.short}</p>
      </div>

      {lineIsLonger && (
        <div className="mt-5">
          <p className="text-xs uppercase tracking-wide text-muted mb-1">In a real line</p>
          <p className="font-serif text-xl text-primary">{word.attest.text}</p>
        </div>
      )}

      {word.note && <p className="mt-4 text-base text-primary">{word.note}</p>}

      <SourceTap refs={[word.dict, ...(lineIsLonger ? [] : [word.attest])]}>
        <SourceQuote q={entryOf(word)} />
        {word.source_note && <p>{word.source_note}</p>}
        <PageLink q={word.attest}>The line {word.attest.text} is on p. {word.attest.page} of {bookName(word.attest.key)}</PageLink>
        {word.note_ref && <p><PageLink q={word.note_ref} /></p>}
      </SourceTap>

      {modern ? (
        <p className="mt-4 text-sm"><span className="text-muted">Said today:</span> <span className="font-medium text-primary">{modern}</span></p>
      ) : (
        <div className="mt-2">
          {!open ? (
            <button type="button" onClick={() => setOpen(true)} className="text-sm text-muted underline underline-offset-2 min-h-11">
              Do people say it differently today?
            </button>
          ) : !signedIn ? (
            <p className="text-sm text-secondary">
              <Link href="/auth/signin?callbackUrl=/learn/yucatec" className="underline underline-offset-2">Sign in</Link> to tell us. A Maya speaker checks it before it shows here.
            </p>
          ) : sent === 'sent' ? (
            <p className="text-sm text-secondary">Thank you. It shows here once a speaker confirms it.</p>
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
              <input id="modern-form" value={form} onChange={(e) => setForm(e.target.value)} maxLength={80} className="w-full yk-r border border-border-light p-3 text-base bg-white" />
              <label className="block text-sm text-secondary" htmlFor="modern-place">Where (town, optional)</label>
              <input id="modern-place" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={80} className="w-full yk-r border border-border-light p-3 text-base bg-white" />
              <div className="flex gap-2">
                <button type="submit" disabled={sent === 'sending'} className="px-4 min-h-11 yk-r bg-[#1a1612] text-white text-sm">Send</button>
                <button type="button" onClick={() => setOpen(false)} className="px-4 min-h-11 yk-r border border-border-light bg-white text-sm text-secondary">Cancel</button>
              </div>
              {sent === 'error' && <p className="text-sm text-accent-rust">That did not send. Try again.</p>}
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export function Chip({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'rust' }) {
  return (
    <span className={`inline-block yk-pill px-3 py-1 text-xs font-semibold uppercase tracking-wide ${tone === 'rust' ? 'bg-accent-rust/10 text-accent-rust' : 'bg-stone-200/70 text-secondary'}`}>
      {children}
    </span>
  );
}

// ── Graded exercises ──

type ChoiceState = 'right' | 'wrong' | undefined;

/** A big, rounded, pressable tile (min 56px). */
const tile = (selected: boolean, locked: boolean, state: ChoiceState, extra = '') =>
  `w-full min-h-14 px-4 py-3 yk-r border-2 border-b-4 text-base transition-all ${
    state === 'right'
      ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
      : state === 'wrong'
        ? 'border-accent-rust bg-red-50 text-accent-rust yk-shake'
        : selected
          ? 'border-[#1a1612] bg-stone-50 text-primary'
          : 'border-border-light bg-white text-primary'
  } ${locked ? '' : 'active:translate-y-0.5 active:border-b-2'} ${extra}`;

const stateOf = (locked: boolean, isRight: boolean, isChosen: boolean): ChoiceState => (locked ? (isRight ? 'right' : isChosen ? 'wrong' : undefined) : undefined);

interface ViewProps {
  ex: Exercise;
  answer: string;
  setAnswer: (a: string) => void;
  locked: boolean;
  /** match only: reports each wrong pairing as it happens, and the end. */
  onMatchMiss?: (wordId: string, chosenShort: string) => void;
  onMatchDone?: () => void;
}

function Ask({ children }: { children: ReactNode }) {
  return <h2 className="text-xl font-semibold text-primary mb-5">{children}</h2>;
}

export function ExerciseView({ ex, answer, setAnswer, locked, onMatchMiss, onMatchDone }: ViewProps) {
  if (ex.kind === 'pick') {
    const w = wordById(ex.word)!;
    return (
      <div>
        <Ask>What does this mean?</Ask>
        <p className="font-serif text-5xl text-primary text-center mb-8">{w.form}</p>
        <div className="space-y-3">
          {ex.options.map((o) => (
            <button key={o} type="button" disabled={locked} onClick={() => setAnswer(o)} className={tile(answer === o, locked, stateOf(locked, o === ex.word, answer === o), 'text-left')}>
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
            <Ask>Which number is this?</Ask>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={w.dresden.crop_url} alt="A bar-and-dot number from the Dresden Codex" className="h-32 w-full object-contain bg-white yk-r border-2 border-border-light mb-2" />
            <p className="text-xs text-muted mb-6 text-center">A dot is one, a bar is five. Dresden Codex, p. {w.dresden.codex_page}</p>
          </>
        ) : (
          <>
            <Ask>Which word means</Ask>
            <p className="font-serif text-3xl text-primary text-center mb-8">“{w.short}”?</p>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          {ex.options.map((o) => (
            <button key={o} type="button" disabled={locked} onClick={() => setAnswer(o)} className={tile(answer === o, locked, stateOf(locked, o === ex.word, answer === o), 'text-center font-serif text-xl')}>
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
        <Ask>Fill the gap</Ask>
        <p className="font-serif text-3xl text-primary leading-snug mb-2">
          {parts[0]}
          <span className={`inline-block min-w-20 border-b-4 mx-1 text-center ${answer ? 'border-[#1a1612]' : 'border-stone-300'}`}>{answer || ' '}</span>
          {parts[1]}
        </p>
        <p className="text-secondary mb-8">“{s.en}”</p>
        <div className="grid grid-cols-2 gap-3">
          {ex.options.map((o) => (
            <button key={o.text} type="button" disabled={locked} onClick={() => setAnswer(o.text)} className={tile(answer === o.text, locked, stateOf(locked, o.text === ex.blank, answer === o.text), 'text-center font-serif text-xl')}>
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
        <Ask>What does this line say?</Ask>
        <p className="font-serif text-3xl text-primary leading-snug mb-8 yk-r bg-white border-2 border-border-light px-4 py-5">{s.show}</p>
        <div className="space-y-3">
          {ex.options.map((o) => (
            <button key={o} type="button" disabled={locked} onClick={() => setAnswer(o)} className={tile(answer === o, locked, stateOf(locked, o === ex.sentence, answer === o), 'text-left')}>
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
  const chip = 'min-h-14 px-4 yk-r border-2 border-b-4 font-serif text-xl';
  return (
    <div>
      <Ask>Say it in Maya</Ask>
      <p className="text-lg text-primary mb-5">“{s.tiles_en ?? s.en}”</p>
      <div className="min-h-[7.5rem] flex flex-wrap content-start gap-2 border-y-2 border-border-light py-3 mb-6">
        {order.map((i, k) => (
          <button key={`${i}-${k}`} type="button" disabled={locked} onClick={() => place(order.filter((_, j) => j !== k))} className={`${chip} border-[#1a1612] bg-white text-primary yk-pop`}>
            {ex.tiles[i]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {ex.tiles.map((t, i) => (
          <button key={i} type="button" disabled={locked || order.includes(i)} onClick={() => place([...order, i])} className={`${chip} ${order.includes(i) ? 'border-stone-200 bg-stone-200 text-transparent' : 'border-border-light bg-white text-primary active:translate-y-0.5'}`}>
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
  const base = 'w-full min-h-14 px-3 py-2 yk-r border-2 border-b-4 transition-all';
  return (
    <div>
      <Ask>Tap the pairs</Ask>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-3">
          {ex.words.map((w) => (
            <button key={w} type="button" disabled={done.includes(w) || locked} onClick={() => setLeft(w)} className={`${base} font-serif text-xl ${done.includes(w) ? 'border-emerald-200 bg-emerald-50 text-emerald-700/50' : left === w ? 'border-[#1a1612] bg-stone-50 text-primary' : 'border-border-light bg-white text-primary'}`}>
              {wordById(w)!.form}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {ex.right.map((r) => (
            <button key={r} type="button" disabled={done.includes(r) || locked} onClick={() => tapRight(r)} className={`${base} text-sm leading-tight ${done.includes(r) ? 'border-emerald-200 bg-emerald-50 text-emerald-700/50' : flash === r ? 'border-accent-rust bg-red-50 text-accent-rust yk-shake' : 'border-border-light bg-white text-primary'}`}>
              {shorts[r]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── After the check: one warm line if right; what you picked, the answer, one line why, if wrong ──

export function Feedback({ ex, correct, explanation, misses }: { ex: Exercise; correct: boolean; explanation: Explanation | null; misses?: { word: string; chosen: string }[] }) {
  const sentence = ex.kind === 'read' || ex.kind === 'fill' || ex.kind === 'build' ? sentenceById(ex.sentence) : undefined;
  const x = explanation;
  const lines: ReactNode[] = [];

  if (correct) {
    if ((ex.kind === 'pick' || ex.kind === 'pick-form') && x) lines.push(<>Yes: <Maya>{x.right.label}</Maya> is “{x.right.means}”.</>);
    else if (ex.kind === 'fill' && sentence) lines.push(<>Yes: <Maya>{sentence.show}</Maya></>);
    else if (sentence) lines.push(<>Yes: “{sentence.tiles_en && ex.kind === 'build' ? sentence.tiles_en : sentence.en}”</>);
    else lines.push(<>All pairs right.</>);
  } else if (ex.kind === 'match') {
    for (const m of misses ?? []) {
      const w = wordById(m.word)!;
      lines.push(<><Maya>{w.form}</Maya> is “{w.short}”, not “{m.chosen}”.</>);
    }
  } else if (x) {
    if (ex.kind === 'pick' && x.chosen) lines.push(<>“{x.chosen.means}” is <Maya>{x.chosen.label}</Maya>. <Maya>{x.right.label}</Maya> is “{x.right.means}”.</>);
    else if ((ex.kind === 'pick-form' || ex.kind === 'fill') && x.chosen) lines.push(<><Maya>{x.chosen.label}</Maya> means “{x.chosen.means}”. The answer is <Maya>{x.right.label}</Maya>: “{x.right.means}”.</>);
    else if (ex.kind === 'read' && x.chosen?.sentence) lines.push(<>That is another line: <Maya>{x.chosen.sentence.show}</Maya> This one says “{x.right.label}”.</>);
    else if (ex.kind === 'build') lines.push(<>The page has: <Maya>{x.right.label}</Maya></>);
    else lines.push(<>The answer is <Maya>{x.right.label}</Maya>: “{x.right.means}”.</>);
    if (x.rule) lines.push(<>{x.rule.text}</>);
  }

  const refs = [
    ...(sentence ? [sentence] : []),
    ...(!correct && x?.right.quote ? [x.right.quote] : []),
    ...(!correct && x?.chosen?.quote ? [x.chosen.quote] : []),
    ...(!correct && x?.rule?.quoteRef ? [x.rule.quoteRef] : []),
  ];

  return (
    <div className="text-base">
      <p className={`flex items-center gap-2 font-bold text-xl mb-1 ${correct ? 'text-emerald-700' : 'text-accent-rust'}`}>
        <span aria-hidden className={`inline-flex w-8 h-8 yk-pill items-center justify-center text-white text-lg yk-pop ${correct ? 'bg-emerald-600' : 'bg-accent-rust'}`}>{correct ? '✓' : '×'}</span>
        {correct ? 'Nice!' : 'Not quite'}
      </p>
      <div className={`space-y-1 ${correct ? 'text-emerald-900' : 'text-primary'}`}>
        {lines.map((l, i) => <p key={i}>{l}</p>)}
      </div>
      {refs.length > 0 && (
        <SourceTap refs={refs}>
          {sentence && (
            <div>
              <p className="font-serif text-primary">{sentence.show}</p>
              {sentence.es && <p>Spanish on the page: “{sentence.es}”</p>}
              <p>“{sentence.en}”</p>
              {sentence.show_note && <p className="text-xs text-muted mt-1">{sentence.show_note}</p>}
              <PageLink q={sentence} />
            </div>
          )}
          {!correct && x?.right.quote && <SourceQuote q={x.right.quote} />}
          {!correct && x?.chosen?.quote && <SourceQuote q={x.chosen.quote} />}
          {!correct && x?.rule?.quoteRef && <SourceQuote q={x.rule.quoteRef} />}
        </SourceTap>
      )}
    </div>
  );
}

function Maya({ children }: { children: ReactNode }) {
  return <span className="font-serif font-semibold">{children}</span>;
}

// ── Grammar card: the Maya first, then one line ──

export function NoteView({ note }: { note: Note }) {
  const refs = [...(note.table ? [note.table] : []), ...note.quotes];
  return (
    <article>
      <Chip tone="rust">Tip</Chip>
      <h2 className="font-serif text-3xl text-primary mt-3 mb-5">{note.title}</h2>
      <div className="yk-r-lg bg-white border-2 border-border-light overflow-hidden yk-pop">
        {note.examples.map(([maya, en]) => (
          <div key={maya} className="flex items-baseline justify-between gap-4 px-5 py-4 border-b border-border-light last:border-0">
            <span className="font-serif text-2xl text-primary">{maya}</span>
            <span className="text-secondary text-right">{en}</span>
          </div>
        ))}
      </div>
      <p className="text-lg text-primary mt-6">{note.body}</p>
      <SourceTap refs={refs}>
        {note.table && (
          <div>
            <table className="w-full text-sm">
              <tbody>
                {note.table.rows.map(([h, es, en]) => (
                  <tr key={h} className="border-b border-border-light last:border-0">
                    <td className="py-1.5 pr-2 font-serif text-base text-primary">{h.replace(/,$/, '')}</td>
                    <td className="py-1.5 pr-2 text-primary">{es}</td>
                    <td className="py-1.5 italic">{en}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PageLink q={note.table} />
          </div>
        )}
        {note.quotes.map((q, i) => <SourceQuote key={i} q={q} />)}
      </SourceTap>
    </article>
  );
}
