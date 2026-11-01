'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  COURSE,
  allLessons,
  LOCAL_KEY,
  buildLesson,
  buildReview,
  completeLesson,
  dayOf,
  emptyProgress,
  explain,
  grade,
  isUnlocked,
  itemOf,
  markDay,
  mergeProgress,
  nextLesson,
  noteById,
  parseProgress,
  progressFromLog,
  recordItem,
  reviewQueue,
  streak,
  unitOf,
  wordById,
  wordsLearned,
  type Exercise,
  type Lesson,
  type Progress,
} from '@/lib/learn-yucatec';
import { ExerciseView, Feedback, NoteView, TeachCard } from './ExerciseView';
import { GlyphMark, GlyphStory } from './Glyph';

type View =
  | { name: 'map' }
  | { name: 'note'; noteId: string; then: string | null }
  | { name: 'session'; lessonId: string | null; exercises: Exercise[]; index: number; right: number; graded: number }
  | { name: 'done'; lessonId: string | null; right: number; graded: number; before: number };

const SOURCES = ['berendt', 'ruz', 'decl1860', 'piop', 'coord', 'motul1', 'arte', 'tozzer'];

export default function YucatecCourse() {
  const { data: session } = useSession();
  const signedIn = !!session?.user;
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>({ name: 'map' });
  const [answer, setAnswer] = useState('');
  const [checked, setChecked] = useState<null | boolean>(null);
  const [misses, setMisses] = useState<{ word: string; chosen: string }[]>([]);
  const today = dayOf(new Date());

  // localStorage exists only in the browser, so progress is read after the first render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(parseProgress(window.localStorage.getItem(LOCAL_KEY)));
    setHydrated(true);
  }, []);

  const save = useCallback((p: Progress) => {
    setProgress(p);
    try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(p)); } catch { /* private mode: progress lasts the visit */ }
  }, []);

  // Signed in: the server's log follows the learner between devices.
  useEffect(() => {
    if (!signedIn || !hydrated) return;
    let cancelled = false;
    fetch('/api/learn/yucatec/attempts')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setProgress((local) => {
          const merged = mergeProgress(local, progressFromLog(d.attempts ?? [], d.lessons ?? []));
          try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
          return merged;
        });
      })
      .catch(() => { /* offline: local progress stands */ });
    return () => { cancelled = true; };
  }, [signedIn, hydrated]);

  const send = useCallback((body: Record<string, unknown>) => {
    if (!signedIn) return;
    fetch('/api/learn/yucatec/attempts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  }, [signedIn]);

  const propose = useCallback(async (wordId: string, form: string, place: string) => {
    const r = await fetch('/api/learn/yucatec/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ word_id: wordId, form, place: place || undefined }) }).catch(() => null);
    return !!r?.ok;
  }, []);

  const startSession = useCallback((lessonId: string | null, p: Progress = progress) => {
    const exercises = lessonId ? buildLesson(lessonId) : buildReview(p);
    if (!exercises.length) return;
    setAnswer('');
    setChecked(null);
    setMisses([]);
    setView({ name: 'session', lessonId, exercises, index: 0, right: 0, graded: 0 });
    window.scrollTo(0, 0);
  }, [progress]);

  const openLesson = useCallback((lessonId: string) => {
    const unit = unitOf(lessonId)!;
    if (!progress.notes.includes(unit.note)) {
      setView({ name: 'note', noteId: unit.note, then: lessonId });
      window.scrollTo(0, 0);
      return;
    }
    startSession(lessonId);
  }, [progress.notes, startSession]);

  const queue = useMemo(() => reviewQueue(progress), [progress]);
  const days = streak(progress.days, today);

  if (view.name === 'note') {
    const note = noteById(view.noteId)!;
    return (
      <Shell>
        <TopBar onClose={() => setView({ name: 'map' })} />
        <NoteView note={note} />
        <BottomBar>
          <BigButton
            onClick={() => {
              const p = progress.notes.includes(note.id) ? progress : { ...progress, notes: [...progress.notes, note.id] };
              save(p);
              if (view.then) startSession(view.then, p);
              else setView({ name: 'map' });
            }}
          >
            {view.then ? 'Got it: start' : 'Back to the path'}
          </BigButton>
        </BottomBar>
      </Shell>
    );
  }

  if (view.name === 'done') {
    const lesson = view.lessonId ? allLessons().find((l) => l.id === view.lessonId) ?? null : null;
    const next = nextLesson(progress);
    const learned = wordsLearned(progress);
    const fresh = learned - view.before;
    return (
      <Shell>
        <div className="pt-6 text-center">
          {lesson ? (
            <details className="group">
              <summary className="list-none cursor-pointer inline-flex flex-col items-center">
                <span className="relative inline-flex items-center justify-center w-40 h-40 yk-pill bg-white border-4 border-emerald-600 shadow-[0_6px_0_#047857] yk-pop">
                  <GlyphMark glyph={lesson.glyph} size={104} />
                </span>
                <span className="mt-3 text-sm text-muted underline underline-offset-2 decoration-stone-300">Your glyph for this lesson: tap to read it</span>
              </summary>
              <div className="mt-3 text-left yk-r bg-white border-2 border-border-light p-4">
                <GlyphStory glyph={lesson.glyph} />
              </div>
            </details>
          ) : (
            <span className="inline-flex items-center justify-center w-28 h-28 yk-pill bg-emerald-600 text-white text-5xl yk-pop">✓</span>
          )}
          <h1 className="font-serif text-4xl text-primary mt-5">{lesson ? 'Lesson done' : 'Review done'}</h1>
          {lesson && <p className="text-secondary mt-1">{lesson.title}</p>}
        </div>

        <div className="grid grid-cols-3 gap-2 mt-8">
          <Stat value={`${view.right}/${view.graded}`} label="right first try" />
          <Stat value={String(days)} label={days === 1 ? 'day in a row' : 'days in a row'} tone="rust" />
          <Stat value={String(learned)} label={fresh > 0 ? `words (+${fresh})` : 'words learned'} tone="green" />
        </div>
        {queue.length > 0 && <p className="text-sm text-muted mt-4 text-center">{queue.length} {queue.length === 1 ? 'word comes' : 'words come'} back in review.</p>}

        <BottomBar>
          {next && <BigButton onClick={() => openLesson(next.id)}>Next: {next.title}</BigButton>}
          <button type="button" onClick={() => setView({ name: 'map' })} className="w-full min-h-14 mt-2 yk-r text-secondary font-medium">
            Back to the path
          </button>
        </BottomBar>
      </Shell>
    );
  }

  if (view.name === 'session') {
    const ex = view.exercises[view.index];
    const total = view.exercises.length;
    const finish = (p: Progress, right: number, graded: number) => {
      const before = wordsLearned(progress);
      save(view.lessonId ? completeLesson(p, view.lessonId, today) : markDay(p, today));
      if (view.lessonId) send({ kind: 'lesson', lesson_id: view.lessonId, day: today });
      setView({ name: 'done', lessonId: view.lessonId, right, graded, before });
      window.scrollTo(0, 0);
    };
    const advance = (p: Progress, wasRight: boolean | null) => {
      const right = view.right + (wasRight ? 1 : 0);
      const graded = view.graded + (wasRight === null ? 0 : 1);
      setAnswer('');
      setChecked(null);
      setMisses([]);
      if (view.index + 1 >= total) return finish(p, right, graded);
      setView({ ...view, index: view.index + 1, right, graded });
      window.scrollTo(0, 0);
    };
    const check = (forced?: boolean) => {
      const ok = forced ?? grade(ex, answer);
      setChecked(ok);
      let p = progress;
      if (ex.kind === 'match') {
        for (const w of ex.words) p = recordItem(p, w, !misses.some((m) => m.word === w));
        for (const w of ex.words) send({ item_id: w, answer: misses.find((m) => m.word === w)?.chosen ?? '', correct: !misses.some((m) => m.word === w), exercise: 'match', lesson_id: view.lessonId });
      } else {
        const item = itemOf(ex);
        if (item) {
          p = recordItem(p, item, ok);
          send({ item_id: item, answer: answer.slice(0, 300), correct: ok, exercise: ex.kind, lesson_id: view.lessonId });
        }
      }
      save(p);
    };
    const settled = checked !== null && ex.kind !== 'teach';
    return (
      <Shell>
        <TopBar onClose={() => setView({ name: 'map' })} progress={(view.index + (checked !== null || ex.kind === 'teach' ? 1 : 0)) / total} />
        <div className="min-h-[50vh] pb-4">
          {ex.kind === 'teach' ? (
            <TeachCard key={ex.id} word={wordById(ex.word)!} signedIn={signedIn} onPropose={(f, pl) => propose(ex.word, f, pl)} />
          ) : (
            <ExerciseView
              key={ex.id}
              ex={ex}
              answer={answer}
              setAnswer={setAnswer}
              locked={checked !== null}
              onMatchMiss={(w, chosen) => setMisses((m) => (m.some((x) => x.word === w) ? m : [...m, { word: w, chosen }]))}
              onMatchDone={() => check(misses.length === 0)}
            />
          )}
        </div>

        <BottomBar tone={settled ? (checked ? 'right' : 'wrong') : undefined}>
          {settled && (
            <div className="max-h-[55vh] overflow-y-auto mb-3">
              <Feedback ex={ex} correct={!!checked} explanation={explain(ex, answer)} misses={misses} />
            </div>
          )}
          {ex.kind === 'teach' ? (
            <BigButton onClick={() => advance(progress, null)}>Continue</BigButton>
          ) : checked === null ? (
            ex.kind === 'match' ? (
              <p className="text-center text-sm text-muted min-h-14 flex items-center justify-center">Match all the pairs</p>
            ) : (
              <BigButton disabled={!answer} onClick={() => check()}>Check</BigButton>
            )
          ) : (
            <BigButton tone={checked ? 'right' : 'wrong'} onClick={() => advance(progress, checked)}>Continue</BigButton>
          )}
        </BottomBar>
      </Shell>
    );
  }

  // ── Course map: a winding path of lessons, one glyph each ──
  const next = nextLesson(progress);
  const learned = wordsLearned(progress);
  let n = 0;
  return (
    <Shell>
      <header className="mb-5">
        <h1 className="font-serif text-4xl text-primary">Yucatec Maya</h1>
        <p className="text-secondary mt-1">Five minutes a day, from real books of the 1800s.</p>
        <div className="flex gap-2 mt-4">
          <Pill>{hydrated ? days : '–'} {days === 1 ? 'day' : 'days'} in a row</Pill>
          <Pill>{hydrated ? learned : '–'} words</Pill>
          {queue.length > 0 && (
            <button type="button" onClick={() => startSession(null)} className="yk-pill min-h-11 px-4 text-sm font-semibold bg-accent-rust text-white">
              Review {queue.length}
            </button>
          )}
        </div>
      </header>

      {COURSE.units.map((u, ui) => {
        const band = BANDS[ui % BANDS.length];
        return (
          <section key={u.id} className="mb-6">
            <div className={`sticky top-0 z-10 yk-r px-4 py-3 flex items-center justify-between ${band.bg} text-white shadow-[0_4px_0_rgba(0,0,0,0.18)]`}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Unit {u.n}</p>
                <h2 className="text-lg font-semibold leading-tight">{u.title}</h2>
              </div>
              <button type="button" onClick={() => setView({ name: 'note', noteId: u.note, then: null })} className="shrink-0 ml-2 yk-r border-2 border-white/40 px-3 min-h-11 text-sm font-semibold">
                Tip
              </button>
            </div>
            <ol className="flex flex-col items-center pt-8 pb-2">
              {u.lessons.map((l) => {
                const offset = PATH[n++ % PATH.length];
                const done = !!progress.lessons[l.id];
                const open = hydrated && isUnlocked(progress, l.id);
                const current = hydrated && next?.id === l.id;
                return (
                  <li key={l.id} className="mb-6 flex flex-col items-center" style={{ transform: `translateX(${offset}px)` }}>
                    <PathNode lesson={l} done={done} open={open} current={current} ring={band.ring} onOpen={() => openLesson(l.id)} />
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}

      <details className="border-t border-border-light pt-4 text-sm text-secondary">
        <summary className="cursor-pointer min-h-11 text-muted">About these lessons</summary>
        <div className="space-y-3 pt-2">
          <p>Every word and line comes from a real page, one tap away. Every meaning comes from a dictionary page.</p>
          <p>The spelling is from the 1800s: x sounds like sh, c is always k. No audio yet.</p>
          <p>Glyph drawings marked Stuart: Drawing © David Stuart, used with permission. Day signs and numbers: the Dresden Codex.</p>
          <ul className="text-xs text-muted space-y-1">
            {SOURCES.map((k) => (
              <li key={k}><Link href={`/book/${COURSE.books[k].id}`} className="underline underline-offset-2 decoration-stone-300">{COURSE.books[k].cite}</Link></li>
            ))}
          </ul>
          <p>
            The same numbers and day signs are in the glyph course: <Link href="/learn/maya" className="underline underline-offset-2">Read the glyphs</Link>.
          </p>
          {!signedIn && (
            <p className="text-xs text-muted">
              Your progress stays on this device. <Link href="/auth/signin?callbackUrl=/learn/yucatec" className="underline underline-offset-2">Sign in</Link> to keep it on every device.
            </p>
          )}
        </div>
      </details>
    </Shell>
  );
}

/** Horizontal offsets that make the lesson column wind. */
const PATH = [0, 52, 72, 52, 0, -52, -72, -52];
const BANDS = [
  { bg: 'bg-accent-rust', ring: 'border-accent-rust' },
  { bg: 'bg-[#1a1612]', ring: 'border-[#1a1612]' },
  { bg: 'bg-accent-gold-dark', ring: 'border-accent-gold-dark' },
];

function PathNode({ lesson, done, open, current, ring, onOpen }: { lesson: Lesson; done: boolean; open: boolean; current: boolean; ring: string; onOpen: () => void }) {
  const size = current ? 96 : 76;
  return (
    <>
      {current && (
        <span className="relative mb-2 yk-r bg-white border-2 border-border-light px-3 py-1 text-sm font-bold text-accent-rust yk-bob">
          Start
          <span aria-hidden className="absolute left-1/2 -bottom-[7px] -translate-x-1/2 w-3 h-3 rotate-45 bg-white border-r-2 border-b-2 border-border-light" />
        </span>
      )}
      <button
        type="button"
        disabled={!open}
        onClick={onOpen}
        aria-label={`${lesson.title}${done ? ', done' : open ? '' : ', locked'}`}
        className={`relative yk-pill flex items-center justify-center border-4 transition-transform ${
          done ? 'bg-white border-emerald-600 shadow-[0_5px_0_#047857]' : current ? `bg-white ${ring} shadow-[0_6px_0_rgba(0,0,0,0.25)]` : open ? 'bg-white border-border-light shadow-[0_5px_0_#d6d3d1]' : 'bg-stone-100 border-stone-200'
        } ${open ? 'active:translate-y-1 active:shadow-none' : ''}`}
        style={{ width: size, height: size }}
      >
        <GlyphMark glyph={lesson.glyph} size={size - 22} muted={!open} />
        {done && <span aria-hidden className="absolute -right-1 -top-1 w-7 h-7 yk-pill bg-emerald-600 text-white text-sm flex items-center justify-center border-2 border-white">✓</span>}
        {!open && (
          <span aria-hidden className="absolute -right-1 -top-1 w-7 h-7 yk-pill bg-stone-300 flex items-center justify-center border-2 border-white">
            <svg width="12" height="14" viewBox="0 0 12 14" fill="white"><rect x="1" y="6" width="10" height="8" rx="1.5" /><path d="M3 6V4a3 3 0 0 1 6 0v2" stroke="white" strokeWidth="1.8" fill="none" /></svg>
          </span>
        )}
      </button>
      <span className={`mt-2 text-sm text-center max-w-[9rem] leading-tight ${open ? 'text-primary font-medium' : 'text-muted'}`}>{lesson.title}</span>
    </>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="yk-pill min-h-11 px-4 inline-flex items-center text-sm font-semibold bg-white border-2 border-border-light text-primary">{children}</span>;
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'rust' | 'green' }) {
  const color = tone === 'rust' ? 'text-accent-rust border-accent-rust/40' : tone === 'green' ? 'text-emerald-700 border-emerald-600/40' : 'text-primary border-border-light';
  return (
    <div className={`yk-r border-2 bg-white px-2 py-3 text-center ${color}`}>
      <p className="font-serif text-3xl">{value}</p>
      <p className="text-xs text-muted mt-0.5">{label}</p>
    </div>
  );
}

function BigButton({ children, onClick, disabled, tone }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; tone?: 'right' | 'wrong' }) {
  const color = disabled
    ? 'bg-stone-200 text-stone-400'
    : tone === 'right'
      ? 'bg-emerald-600 text-white shadow-[0_4px_0_#047857]'
      : tone === 'wrong'
        ? 'bg-accent-rust text-white shadow-[0_4px_0_#6f3328]'
        : 'bg-[#1a1612] text-white shadow-[0_4px_0_#000]';
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`w-full min-h-14 yk-r text-lg font-bold transition-transform ${color} ${disabled ? '' : 'active:translate-y-1 active:shadow-none'}`}>
      {children}
    </button>
  );
}

function BottomBar({ children, tone }: { children: React.ReactNode; tone?: 'right' | 'wrong' }) {
  const bg = tone === 'right' ? 'bg-emerald-50 border-emerald-600' : tone === 'wrong' ? 'bg-red-50 border-accent-rust' : 'bg-cream border-transparent';
  return <div className={`sticky bottom-0 -mx-5 px-5 pt-4 pb-5 border-t-2 ${bg} ${tone ? 'yk-up' : ''}`}>{children}</div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto px-5 pt-4">
      <style>{MOTION}</style>
      {children}
    </div>
  );
}

/* This page keeps round nodes and rounded tiles (Derek's brief, #6921): its own
   classes, because the site's square-corner rule overrides every rounded-* utility. */
const MOTION = `
@keyframes yk-pop { 0% { transform: scale(.7); opacity: 0 } 60% { transform: scale(1.06); opacity: 1 } 100% { transform: scale(1) } }
@keyframes yk-shake { 0%, 100% { transform: translateX(0) } 20%, 60% { transform: translateX(-6px) } 40%, 80% { transform: translateX(6px) } }
@keyframes yk-up { from { transform: translateY(40%); opacity: .4 } to { transform: translateY(0); opacity: 1 } }
@keyframes yk-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
.yk-r { border-radius: 16px } .yk-r-lg { border-radius: 24px } .yk-pill { border-radius: 9999px }
.yk-pop { animation: yk-pop .35s ease-out both }
.yk-shake { animation: yk-shake .4s ease-in-out }
.yk-up { animation: yk-up .25s ease-out }
.yk-bob { animation: yk-bob 1.6s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { .yk-pop, .yk-shake, .yk-up, .yk-bob { animation: none !important } }
`;

function TopBar({ onClose, progress }: { onClose: () => void; progress?: number }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <button type="button" onClick={onClose} aria-label="Back to the path" className="text-3xl leading-none text-muted w-11 h-11 -ml-2 flex items-center justify-center">×</button>
      {progress !== undefined && (
        <div className="flex-1 h-4 yk-pill bg-stone-200 overflow-hidden">
          <div className="h-full yk-pill bg-emerald-600 transition-all duration-300" style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} />
        </div>
      )}
    </div>
  );
}
