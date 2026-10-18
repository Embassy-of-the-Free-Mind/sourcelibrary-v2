'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  COURSE,
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
  type Exercise,
  type Progress,
} from '@/lib/learn-yucatec';
import { ExerciseView, Feedback, NoteView, TeachCard } from './ExerciseView';

type View =
  | { name: 'map' }
  | { name: 'note'; noteId: string; then: string | null }
  | { name: 'session'; lessonId: string | null; exercises: Exercise[]; index: number; right: number; graded: number }
  | { name: 'done'; lessonId: string | null; right: number; graded: number };

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
        <button
          type="button"
          onClick={() => {
            const p = progress.notes.includes(note.id) ? progress : { ...progress, notes: [...progress.notes, note.id] };
            save(p);
            if (view.then) startSession(view.then, p);
            else setView({ name: 'map' });
          }}
          className="mt-8 w-full py-4 rounded-xl bg-[#1a1612] text-white font-medium"
        >
          {view.then ? 'Start the lesson' : 'Back to the course'}
        </button>
      </Shell>
    );
  }

  if (view.name === 'done') {
    const lesson = view.lessonId ? COURSE.units.flatMap((u) => u.lessons).find((l) => l.id === view.lessonId) : null;
    const next = nextLesson(progress);
    return (
      <Shell>
        <div className="py-10 text-center">
          <p className="text-sm text-muted uppercase tracking-wide mb-2">{lesson ? lesson.title : 'Review'}</p>
          <p className="font-serif text-5xl text-primary mb-2">{view.right}<span className="text-2xl text-muted"> / {view.graded}</span></p>
          <p className="text-secondary mb-1">right the first time</p>
          <p className="text-secondary">{days === 1 ? '1 day' : `${days} days`} in a row</p>
          {queue.length > 0 && <p className="text-sm text-muted mt-4">{queue.length} missed {queue.length === 1 ? 'item comes' : 'items come'} back in review.</p>}
        </div>
        {next && (
          <button type="button" onClick={() => openLesson(next.id)} className="w-full py-4 rounded-xl bg-[#1a1612] text-white font-medium mb-2">
            Next: {next.title}
          </button>
        )}
        <button type="button" onClick={() => setView({ name: 'map' })} className="w-full py-4 rounded-xl border border-border-light bg-white text-secondary">
          Course map
        </button>
      </Shell>
    );
  }

  if (view.name === 'session') {
    const ex = view.exercises[view.index];
    const total = view.exercises.length;
    const finish = (p: Progress, right: number, graded: number) => {
      save(view.lessonId ? completeLesson(p, view.lessonId, today) : markDay(p, today));
      if (view.lessonId) send({ kind: 'lesson', lesson_id: view.lessonId, day: today });
      setView({ name: 'done', lessonId: view.lessonId, right, graded });
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
    return (
      <Shell>
        <TopBar onClose={() => setView({ name: 'map' })} progress={(view.index + (checked !== null || ex.kind === 'teach' ? 1 : 0)) / total} />
        <div className="min-h-[40vh]">
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

        {checked !== null && ex.kind !== 'teach' && (
          <div className={`mt-6 -mx-5 px-5 py-4 border-t-2 ${checked ? 'bg-emerald-50 border-emerald-600' : 'bg-red-50 border-accent-rust'}`}>
            <Feedback ex={ex} correct={checked} explanation={explain(ex, answer)} misses={misses} />
          </div>
        )}

        <div className="sticky bottom-0 -mx-5 px-5 py-3 bg-cream">
          {ex.kind === 'teach' ? (
            <button type="button" onClick={() => advance(progress, null)} className="w-full py-4 rounded-xl bg-[#1a1612] text-white font-medium">Continue</button>
          ) : checked === null ? (
            ex.kind === 'match' ? (
              <p className="text-center text-sm text-muted py-4">Match all the pairs</p>
            ) : (
              <button type="button" disabled={!answer} onClick={() => check()} className={`w-full py-4 rounded-xl font-medium ${answer ? 'bg-[#1a1612] text-white' : 'bg-stone-200 text-stone-400'}`}>Check</button>
            )
          ) : (
            <button type="button" onClick={() => advance(progress, checked)} className={`w-full py-4 rounded-xl font-medium text-white ${checked ? 'bg-emerald-700' : 'bg-accent-rust'}`}>Continue</button>
          )}
        </div>
      </Shell>
    );
  }

  // ── Course map ──
  const next = nextLesson(progress);
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted">Source Library · Learn</p>
        <h1 className="font-serif text-3xl text-primary mt-1">Yucatec Maya</h1>
        <p className="text-secondary mt-2">
          Five-minute lessons built from real sentences in Yucatec primers and catechisms of 1845–1871. Every word and line links to its page; every meaning quotes a dictionary page.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2 mb-6">
        <div className="rounded-xl bg-white border border-border-light p-3">
          <p className="font-serif text-2xl text-primary">{hydrated ? days : '–'}</p>
          <p className="text-xs text-muted">{days === 1 ? 'day in a row' : 'days in a row'}</p>
        </div>
        <button
          type="button"
          disabled={!queue.length}
          onClick={() => startSession(null)}
          className={`rounded-xl border p-3 text-left ${queue.length ? 'bg-white border-accent-rust' : 'bg-white border-border-light'}`}
        >
          <p className={`font-serif text-2xl ${queue.length ? 'text-accent-rust' : 'text-primary'}`}>{hydrated ? queue.length : '–'}</p>
          <p className="text-xs text-muted">{queue.length ? 'to review: start' : 'to review'}</p>
        </button>
      </div>

      {next && hydrated && (
        <button type="button" onClick={() => openLesson(next.id)} className="w-full py-4 rounded-xl bg-[#1a1612] text-white font-medium mb-8">
          {Object.keys(progress.lessons).length ? 'Continue' : 'Start'}: {next.title}
        </button>
      )}

      {COURSE.units.map((u) => (
        <section key={u.id} className="mb-8">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-serif text-xl text-primary">Unit {u.n} · {u.title}</h2>
            <button type="button" onClick={() => setView({ name: 'note', noteId: u.note, then: null })} className="text-sm text-muted underline underline-offset-2 shrink-0 ml-2">
              Grammar
            </button>
          </div>
          <ol className="space-y-2">
            {u.lessons.map((l, i) => {
              const done = progress.lessons[l.id];
              const open = hydrated && isUnlocked(progress, l.id);
              const isNext = next?.id === l.id;
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    disabled={!open}
                    onClick={() => openLesson(l.id)}
                    className={`w-full flex items-center gap-3 rounded-xl border-2 p-3 text-left ${isNext ? 'border-[#1a1612] bg-white' : done ? 'border-border-light bg-white' : 'border-transparent bg-stone-100'} ${open ? '' : 'opacity-60'}`}
                  >
                    <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-sm font-medium ${done ? 'bg-emerald-700 text-white' : isNext ? 'bg-[#1a1612] text-white' : 'bg-stone-200 text-stone-500'}`}>
                      {done ? '✓' : i + 1}
                    </span>
                    <span className="flex-1">
                      <span className="block text-primary">{l.title}</span>
                      <span className="block text-xs text-muted">
                        {l.new.slice(0, 4).map((w) => wordById(w)!.form).join(', ')}{l.new.length > 4 ? '…' : ''}
                        {done ? ` · done${done.done > 1 ? ` ${done.done}×` : ''}` : open ? '' : ' · locked'}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <section className="border-t border-border-light pt-4 text-sm text-secondary space-y-3">
        <p>
          The same numbers, day names and words are in the glyph course: <Link href="/learn/maya" className="underline underline-offset-2">Read the glyphs</Link>.
        </p>
        <p>
          These are 19th-century spellings (x for sh, c for k, the barred cħ, tħ, ꝑ and ɔ for the hard consonants). No audio yet. Where a word is said differently today, a speaker can say so on its card; nothing shows until a speaker confirms it.
        </p>
        <div>
          <p className="text-xs text-muted mb-1">Sources</p>
          <ul className="text-xs text-muted space-y-0.5">
            {SOURCES.map((k) => (
              <li key={k}><Link href={`/book/${COURSE.books[k].id}`} className="underline underline-offset-2 decoration-stone-300">{COURSE.books[k].cite}</Link></li>
            ))}
          </ul>
        </div>
        {!signedIn && (
          <p className="text-xs text-muted">
            Your progress stays on this device. <Link href="/auth/signin?callbackUrl=/learn/yucatec" className="underline underline-offset-2">Sign in</Link> to keep it across devices.
          </p>
        )}
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="max-w-md mx-auto px-5 pt-4 pb-6">{children}</div>;
}

function TopBar({ onClose, progress }: { onClose: () => void; progress?: number }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <button type="button" onClick={onClose} aria-label="Back to the course map" className="text-2xl leading-none text-muted px-1">×</button>
      {progress !== undefined && (
        <div className="flex-1 h-3 rounded-full bg-stone-200 overflow-hidden">
          <div className="h-full bg-emerald-600 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
