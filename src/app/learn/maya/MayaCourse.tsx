'use client';

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { CyclesMeet, Numeral } from '@/app/articles/maya-mathematics/MayaInteractives';
import {
  COURSE_KEY,
  type CourseState,
  type Day,
  type DaySign,
  dayLabel,
  addDays,
  describeNumeral,
  finishLesson,
  nextDayWrong,
  nextLesson,
  numeralWrong,
  parseCourse,
  placeMistake,
  placeValue,
  readSpelling,
  recordAnswer,
  reviewDue,
  reviewIntro,
  sameDay,
  spellingLabel,
  startSitting,
  toPlaces,
} from '@/lib/learn-maya-course';
import {
  COURSE_ITEMS,
  DAY_FIG,
  ENTRIES,
  INTRO,
  LESSONS,
  MAP_CREDITS,
  NODE_GLYPH,
  OPEN_LESSONS,
  STUART_CREDIT,
  STUART_SOURCE,
  SYLLABLES,
  WAYEB_NOTE,
  YUCATEC,
  dresdenPage,
  isConfusable,
  isItem,
  type Example,
  type Fig,
  type Item,
  type Lesson,
  type SyllableKey,
} from './course';
import crops from './course-crops.json';

type View =
  | { screen: 'choose' }
  | { screen: 'intro'; index: number }
  | { screen: 'map' }
  | { screen: 'review'; ids: string[]; index: number }
  | { screen: 'lesson'; lesson: string; step: number; right: number; graded: number }
  | { screen: 'done'; lesson: string; right: number; graded: number; missed: number };

/** What the learner answered and how it went, kept until they tap Continue. */
interface Answered { chose: string; correct: boolean; value: unknown }

const lessonById = (id: string) => LESSONS.find((l) => l.id === id)!;
// The look of /learn/yucatec (#6953): rounded-xl, ink for go, emerald for right, rust for wrong.
const btn = 'w-full min-h-14 py-4 rounded-xl font-medium transition-transform active:translate-y-px';
const btnInk = `${btn} bg-[#1a1612] text-white`;
const btnLight = `${btn} border-2 border-border-light bg-white text-primary`;
/** Missed items still in the course (an item dropped from course.ts is never asked again). */
const dueItems = (s: CourseState) => reviewDue({ ...s, missed: Object.fromEntries(Object.entries(s.missed).filter(([id]) => COURSE_ITEMS.has(id))) });

/**
 * Small motions, all stopped under prefers-reduced-motion. The site squares every
 * `rounded-*` class (globals.css); the lesson nodes, badges and progress bar are
 * round on purpose, so they carry lm-round instead.
 */
const MOTION = `
.lm-round { border-radius: 9999px }
@keyframes lm-shake { 0%,100% { transform: none } 20% { transform: translateX(-6px) } 40% { transform: translateX(6px) } 60% { transform: translateX(-4px) } 80% { transform: translateX(3px) } }
@keyframes lm-pop { 0%,100% { transform: scale(1) } 45% { transform: scale(1.05) } }
@keyframes lm-rise { from { transform: translateY(14px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes lm-bob { 0%,100% { transform: none } 50% { transform: translateY(-4px) } }
.lm-shake { animation: lm-shake .38s ease-in-out }
.lm-pop { animation: lm-pop .3s ease-out }
.lm-rise { animation: lm-rise .25s ease-out both }
.lm-bob { animation: lm-bob 1.6s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { .lm-shake, .lm-pop, .lm-rise, .lm-bob { animation: none } }
`;

export default function MayaCourse() {
  const { data: session } = useSession();
  const signedIn = !!session?.user;
  const [state, setState] = useState<CourseState | null>(null);
  const [view, setView] = useState<View>({ screen: 'choose' });

  const save = useCallback((s: CourseState) => {
    setState(s);
    try { window.localStorage.setItem(COURSE_KEY, JSON.stringify(s)); } catch { /* private mode: progress lasts the visit */ }
  }, []);

  // One visit = one sitting. A first visitor chooses a course (glyphs here, or
  // Yucatec at /learn/yucatec), then gets lesson 0; a returning one gets last
  // sitting's misses, then the map. #lesson-N opens a lesson.
  useEffect(() => {
    const s = startSitting(parseCourse(window.localStorage.getItem(COURSE_KEY)));
    // localStorage exists only after mount; this runs once per visit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    save(s);
    const hash = window.location.hash.match(/^#lesson-(\d)$/);
    const linked = hash ? LESSONS.find((l) => l.n === Number(hash[1]) && (l.n === 0 || OPEN_LESSONS.includes(l.id))) : undefined;
    if (linked) setView(linked.n === 0 ? { screen: 'intro', index: 0 } : { screen: 'lesson', lesson: linked.id, step: 0, right: 0, graded: 0 });
    else if (!s.introSeen) setView({ screen: 'choose' });
    else if (dueItems(s).length) setView({ screen: 'review', ids: dueItems(s), index: 0 });
    else setView({ screen: 'map' });
  }, [save]);

  const go = (v: View) => {
    window.scrollTo(0, 0);
    setView(v);
  };

  if (!state) return <div className="max-w-md mx-auto px-5 py-8 animate-pulse"><div className="h-[60vh] bg-stone-200 rounded-xl" /></div>;

  const answer = (lesson: string, item: Item, a: Answered, right: string) => {
    save(recordAnswer(state, lesson, item.id, a.correct, a.chose, right));
    if (signedIn) {
      fetch('/api/learn/maya/judgements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, answer: a.chose, correct: a.correct, verdict: null, items_seen: state.answered }),
        keepalive: true,
      }).catch(() => { /* a lost judgement is not worth interrupting the learner for */ });
    }
  };

  const startLesson = (id: string) => go({ screen: 'lesson', lesson: id, step: 0, right: 0, graded: 0 });
  const upNext = nextLesson(state, OPEN_LESSONS);
  const seeIntro = () => save({ ...state, introSeen: true });

  let body: ReactNode;
  if (view.screen === 'choose') {
    body = (
      <Shell>
        <h1 className="font-serif text-3xl text-primary mt-4 mb-1">Learn Maya</h1>
        <p className="text-secondary mb-6">Two courses. Pick one.</p>
        <button onClick={() => go({ screen: 'intro', index: 0 })} className="w-full flex items-center gap-4 text-left rounded-xl border-2 border-border-light border-b-4 bg-white p-4 mb-3 active:translate-y-px">
          <span className="w-20 h-20 shrink-0 lm-round bg-[#efe6d6] overflow-hidden flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={DAY_FIG.Cimi!.fig.src} alt="The day sign Cimi, Dresden Codex page 53" className="w-full h-full object-cover" />
          </span>
          <span>
            <span className="block font-serif text-2xl text-primary">Read the glyphs</span>
            <span className="block text-secondary mt-1">Numbers, days and syllables, from the Dresden Codex and Landa’s key.</span>
          </span>
        </button>
        <a href={YUCATEC} className="w-full flex items-center gap-4 rounded-xl border-2 border-border-light border-b-4 bg-white p-4 active:translate-y-px">
          <span className="w-20 h-20 shrink-0 lm-round bg-[#efe6d6] flex items-center justify-center font-serif text-3xl text-primary" aria-hidden>Aa</span>
          <span>
            <span className="block font-serif text-2xl text-primary">Learn Yucatec Maya</span>
            <span className="block text-secondary mt-1">The language of the colonial Maya books, in Roman letters.</span>
          </span>
        </a>
      </Shell>
    );
  } else if (view.screen === 'intro') {
    const last = view.index === INTRO.length - 1;
    body = (
      <IntroScreenView
        index={view.index}
        onClose={() => { seeIntro(); go({ screen: 'map' }); }}
        onBack={view.index > 0 ? () => go({ screen: 'intro', index: view.index - 1 }) : undefined}
        onNext={() => {
          if (!last) return go({ screen: 'intro', index: view.index + 1 });
          seeIntro();
          startLesson(upNext);
        }}
        nextLabel={last ? `Start lesson ${lessonById(upNext).n}` : 'Continue'}
      />
    );
  } else if (view.screen === 'map') {
    body = (
      <Shell>
        <h1 className="font-serif text-3xl text-primary mt-2 mb-1">Read the glyphs</h1>
        <p className="text-secondary mb-2">Six lessons, about fifteen minutes each.</p>
        <CourseMap state={state} current={upNext} onOpen={(id) => (id === 'intro' ? go({ screen: 'intro', index: 0 }) : startLesson(id))} />
        <Sticky>
          <button onClick={() => startLesson(upNext)} className={btnInk}>
            {state.done[upNext] ? 'Go over' : Object.keys(state.done).length ? 'Continue' : 'Start'}: lesson {lessonById(upNext).n}, {lessonById(upNext).title}
          </button>
        </Sticky>
        <div className="mt-6 space-y-1 text-xs text-muted">
          {MAP_CREDITS.map((c) => (
            <p key={c.label}>{c.label}: {c.href ? <a href={c.href} className="underline underline-offset-2">{c.text}</a> : c.text}</p>
          ))}
        </div>
        <p className="text-sm text-secondary mt-4">The spoken language, in Roman letters: <a href={YUCATEC} className="underline underline-offset-2">Learn Yucatec Maya</a>.</p>
      </Shell>
    );
  } else if (view.screen === 'review') {
    const id = view.ids[view.index];
    const entry = COURSE_ITEMS.get(id)!;
    const next = () => (view.index + 1 < view.ids.length ? go({ ...view, index: view.index + 1 }) : go({ screen: 'map' }));
    body = (
      <Shell>
        <TopBar onClose={() => go({ screen: 'map' })} progress={view.index / view.ids.length} />
        {view.index === 0 && <p className="font-serif text-xl text-primary mb-4">{reviewIntro(state, view.ids)}</p>}
        <ItemView key={`review-${id}`} item={entry.item} onAnswer={(a, right) => answer(entry.lesson, entry.item, a, right)} onNext={next} />
      </Shell>
    );
  } else if (view.screen === 'done') {
    body = <Done view={view} onNext={startLesson} onMap={() => go({ screen: 'map' })} />;
  } else {
    const lesson = lessonById(view.lesson);
    const step = lesson.steps[view.step];
    const missedHere = () => Object.values(state.missed).filter((m) => m.lesson === lesson.id && m.sitting === state.sitting).length;
    const advance = (correct?: boolean) => {
      const right = view.right + (correct ? 1 : 0);
      const graded = view.graded + (correct === undefined ? 0 : 1);
      if (view.step + 1 < lesson.steps.length) return go({ ...view, step: view.step + 1, right, graded });
      save(finishLesson(state, lesson.id));
      go({ screen: 'done', lesson: lesson.id, right, graded, missed: missedHere() });
    };
    body = (
      <Shell>
        <TopBar onClose={() => go({ screen: 'map' })} progress={view.step / lesson.steps.length} />
        {isItem(step) ? (
          <ItemView key={step.id} item={step} onAnswer={(a, right) => answer(lesson.id, step, a, right)} onNext={advance} />
        ) : (
          <ExampleView key={`${lesson.id}-${view.step}`} example={step} onNext={() => advance()} />
        )}
      </Shell>
    );
  }

  return (
    <>
      <style>{MOTION}</style>
      {body}
    </>
  );
}

// ── Screens ──

function Shell({ children }: { children: ReactNode }) {
  return <div className="max-w-md mx-auto px-5 pt-4 pb-10">{children}</div>;
}

/** The bar that holds the one button that moves on: always under the thumb. */
function Sticky({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 z-10 -mx-5 px-5 pt-3 pb-4 mt-4 bg-cream">{children}</div>;
}

function TopBar({ onClose, progress }: { onClose: () => void; progress: number }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <button type="button" onClick={onClose} aria-label="Back to the course map" className="w-11 h-11 -ml-2 text-3xl leading-none text-muted">×</button>
      <div className="flex-1 h-3 lm-round bg-stone-200 overflow-hidden">
        <div className="h-full bg-emerald-600 lm-round transition-all duration-300" style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} />
      </div>
    </div>
  );
}

function IntroScreenView({ index, onClose, onBack, onNext, nextLabel }: { index: number; onClose: () => void; onBack?: () => void; onNext: () => void; nextLabel: string }) {
  const s = INTRO[index];
  return (
    <Shell>
      <div className="flex items-center gap-3 mb-4">
        <button type="button" onClick={onClose} aria-label="Skip to the course map" className="w-11 h-11 -ml-2 text-3xl leading-none text-muted">×</button>
        <div className="flex-1 flex justify-center gap-2" aria-label={`Screen ${index + 1} of ${INTRO.length}`}>
          {INTRO.map((_, i) => <span key={i} className={`h-2 lm-round transition-all ${i === index ? 'w-6 bg-emerald-600' : i < index ? 'w-2 bg-emerald-600/50' : 'w-2 bg-stone-300'}`} />)}
        </div>
        <span className="w-11" />
      </div>
      <div key={index} className="lm-rise">
        {s.fig ? <FigView fig={s.fig} tall /> : <div className="h-6" />}
        <h1 className="font-serif text-3xl text-primary mt-5 mb-2">{s.title}</h1>
        <p className="text-lg text-primary"><Prose text={s.body} /></p>
        {s.note && <p className="text-sm text-muted mt-3"><Prose text={s.note} /></p>}
      </div>
      <Sticky>
        <div className="flex gap-2">
          {onBack && <button onClick={onBack} aria-label="Back" className="w-16 shrink-0 min-h-14 rounded-xl border-2 border-border-light bg-white text-2xl text-primary active:translate-y-px">‹</button>}
          <button onClick={onNext} className={btnInk}>{nextLabel}</button>
        </div>
      </Sticky>
    </Shell>
  );
}

/** The course as a winding path of round lesson nodes, each carrying a glyph from its lesson. */
function CourseMap({ state, current, onOpen }: { state: CourseState; current: string; onOpen: (id: string) => void }) {
  const ROW = 128;
  const SWAY = [0, 22, 0, -22];
  const xs = LESSONS.map((_, i) => 50 + SWAY[i % SWAY.length]);
  const height = LESSONS.length * ROW;
  const path = xs.map((x, i) => `${i ? 'L' : 'M'} ${x} ${i * ROW + 44}`).join(' ');
  return (
    <div className="relative my-6" style={{ height }}>
      <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden>
        <path d={path} fill="none" stroke="#d6cfc4" strokeWidth={6} strokeDasharray="2 12" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <ol>
        {LESSONS.map((l, i) => {
          const open = l.n === 0 || OPEN_LESSONS.includes(l.id);
          const here = l.id === current;
          const done = !!state.done[l.id] || (l.n === 0 && state.introSeen);
          const status = !open ? 'locked' : here ? 'current' : done ? 'done' : 'open';
          return (
            <li key={l.id} className="absolute -translate-x-1/2 flex flex-col items-center w-36" style={{ left: `${xs[i]}%`, top: i * ROW }}>
              {here && <span className="lm-bob absolute -top-7 left-1/2 -translate-x-1/2 rounded-lg bg-white border-2 border-border-light px-2 py-0.5 text-xs font-medium text-primary whitespace-nowrap">{done ? 'Go over' : 'Start'}</span>}
              <button
                type="button"
                disabled={!open}
                onClick={() => onOpen(l.id)}
                aria-label={`Lesson ${l.n}: ${l.title}${status === 'locked' ? ' (coming)' : status === 'done' ? ' (done)' : ''}`}
                className={`relative w-[88px] h-[88px] lm-round border-4 border-b-8 overflow-visible transition-transform active:translate-y-0.5 ${
                  status === 'current' ? 'border-[#1a1612] bg-white' : status === 'done' ? 'border-emerald-600 bg-white' : status === 'open' ? 'border-border-medium bg-white' : 'border-stone-300 bg-stone-100'
                }`}
              >
                <span className="absolute inset-1 lm-round overflow-hidden flex items-center justify-center bg-[#efe6d6]">
                  <NodeGlyphView id={l.id} locked={status === 'locked'} />
                </span>
                {status === 'done' && <span className="absolute -right-1 -top-1 w-7 h-7 lm-round bg-emerald-600 text-white text-sm flex items-center justify-center border-2 border-cream" aria-hidden>✓</span>}
                {status === 'locked' && <LockBadge />}
              </button>
              <span className={`mt-1 text-center text-sm leading-tight ${status === 'locked' ? 'text-muted' : 'text-primary font-medium'}`}>
                {l.n}. {l.title}
              </span>
              {status === 'locked' && <span className="text-xs text-muted">coming</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function NodeGlyphView({ id, locked }: { id: string; locked: boolean }) {
  const g = NODE_GLYPH[id];
  const dim = locked ? 'grayscale opacity-40' : '';
  if (!g) return null;
  if ('numeral' in g) return <span className={dim}><Numeral value={g.numeral} size={40} label={`${g.numeral} in bars and dots`} /></span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={g.src} alt={g.alt} className={`w-full h-full ${g.drawing ? 'object-contain p-2 bg-white' : 'object-cover'} ${dim}`} />
  );
}

function LockBadge() {
  return (
    <span className="absolute -right-1 -top-1 w-7 h-7 lm-round bg-stone-300 flex items-center justify-center border-2 border-cream" aria-hidden>
      <svg width="12" height="14" viewBox="0 0 12 14"><rect x="1" y="6" width="10" height="7.5" rx="1.5" fill="#6b6560" /><path d="M3.5 6V4a2.5 2.5 0 015 0v2" fill="none" stroke="#6b6560" strokeWidth="1.6" /></svg>
    </span>
  );
}

function ExampleView({ example, onNext }: { example: Example; onNext: () => void }) {
  // Picture first; a long list (the day signs) gets its title above it.
  const heading = (
    <>
      <h1 className="font-serif text-3xl text-primary mb-2">{example.title}</h1>
      <p className="text-lg text-primary mb-4"><Prose text={example.body} /></p>
    </>
  );
  return (
    <section className="lm-rise">
      {example.days && heading}
      {example.figs && (
        <div className={`grid gap-3 mb-4 ${example.figs.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {example.figs.map((f) => (
            <div key={f.src}>
              <FigView fig={f} small={example.figs!.length > 1} />
              {(f.caption || f.numeral !== undefined) && (
                <div className="flex items-center justify-center gap-2 mt-1">
                  {f.numeral !== undefined && <Numeral value={f.numeral} size={26} />}
                  {f.caption && <span className="font-serif text-lg text-primary">{f.caption}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {example.stack && <div className="mb-4"><Stack digits={example.stack.digits} places={example.stack.places} showPlaces /></div>}
      {example.signs && <div className="mb-4"><Signs signs={example.signs} labels /></div>}
      {example.pairs?.map((p) => (
        <div key={p.caption} className="mb-3 rounded-xl border-2 border-border-light bg-white p-3">
          <div className="grid grid-cols-2 gap-3 items-end">
            <FigView fig={p.left} small />
            <FigView fig={p.right} small drawing />
          </div>
          <p className="font-serif text-lg text-primary mt-2">{p.caption}</p>
        </div>
      ))}
      {example.syllables && (
        <div className="mb-4">
          <div className="grid grid-cols-3 gap-2">
            {example.syllables.map((k) => (
              <div key={k} className="rounded-xl border-2 border-border-light bg-white p-2 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={SYLLABLES[k].src} alt={SYLLABLES[k].value} className="h-16 w-auto mx-auto" />
                <span className="font-serif text-lg text-primary">{SYLLABLES[k].value}</span>
              </div>
            ))}
          </div>
          <Credit href={STUART_SOURCE}>{STUART_CREDIT}</Credit>
        </div>
      )}
      {example.days && (
        <ul className="mb-4 space-y-2">
          {example.days.map((d) => DAY_FIG[d] && (
            <li key={d} className="flex items-center gap-3 rounded-xl border-2 border-border-light bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={DAY_FIG[d]!.fig.src} alt={d} className="h-14 w-14 object-contain rounded-lg bg-[#efe6d6] shrink-0" />
              <span><span className="block font-serif text-lg text-primary leading-tight">{d}</span><span className="block text-sm text-secondary">{DAY_FIG[d]!.feature}</span></span>
            </li>
          ))}
          <li className="text-xs text-muted"><a href={dresdenPage(32)} className="underline underline-offset-2">Dresden Codex, page 53</a></li>
        </ul>
      )}
      {example.interactive === 'cycles-13-20' && (
        <div className="-mx-2 mb-4">
          <CyclesMeet
            cycles={[
              { key: 'n', name: 'Numbers', unit: 'rounds of the 13 numbers', days: 13, truth: null },
              { key: 's', name: 'Day signs', unit: 'rounds of the 20 signs', days: 20, truth: null },
            ]}
            initial={{ n: true, s: true }}
            caption="Each tick ends a round: 13 days for the numbers, 20 for the signs. They end together after 260 days."
          />
        </div>
      )}
      {!example.days && heading}
      {example.chips && (
        <ol className="flex flex-wrap gap-1.5">
          {example.chips.map((c, i) => <li key={c} className="lm-round bg-white border border-border-light px-2.5 py-1 text-sm text-primary"><span className="text-muted mr-1">{i + 1}</span>{c}</li>)}
        </ol>
      )}
      {example.note && <p className="text-sm text-muted mt-3"><Prose text={example.note} /></p>}
      <Sticky><button onClick={onNext} className={btnInk}>Continue</button></Sticky>
    </section>
  );
}

// ── Items ──

function ItemView({ item, onAnswer, onNext }: { item: Item; onAnswer: (a: Answered, right: string) => void; onNext: (correct: boolean) => void }) {
  const [done, setDone] = useState<Answered | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!done) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    feedback.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
  }, [done]);
  const submit = (chose: string, correct: boolean, value: unknown) => {
    if (done) return;
    const a = { chose, correct, value };
    setDone(a);
    onAnswer(a, rightLabel(item));
  };
  return (
    <section className="lm-rise">
      {item.wild && <p className="inline-block lm-round bg-accent-rust text-white text-xs font-medium px-2.5 py-1 mb-2">On a real page</p>}
      <p className="font-serif text-2xl text-primary mb-4"><Prose text={item.prompt} /></p>
      <Prompt item={item} done={done} submit={submit} />
      {done && (
        <div ref={feedback} className={`lm-rise mt-5 -mx-5 px-5 py-4 border-t-4 ${done.correct ? 'bg-emerald-50 border-emerald-600' : 'bg-red-50 border-accent-rust'}`} aria-live="polite">
          {done.correct ? (
            <>
              <p className="font-serif text-2xl text-emerald-700 mb-1">Right.</p>
              <p className="text-primary"><Prose text={item.why} /></p>
              {item.kind === 'tap' && <div className="mt-3"><FigView fig={item.after} /></div>}
            </>
          ) : (
            <Wrong item={item} answered={done} />
          )}
          {item.wild && <a href={item.wild.href} className="inline-block mt-3 text-accent-rust font-medium underline underline-offset-2">{item.wild.label} →</a>}
        </div>
      )}
      {done && (
        <Sticky>
          <button onClick={() => onNext(done.correct)} className={`${btn} text-white ${done.correct ? 'bg-emerald-700' : 'bg-accent-rust'}`}>Continue</button>
        </Sticky>
      )}
    </section>
  );
}

function rightLabel(item: Item): string {
  switch (item.kind) {
    case 'count': return String(item.value);
    case 'place': return String(placeValue(item.digits, item.places));
    case 'day': return typeof item.answer === 'string' ? item.answer : dayLabel(item.answer);
    case 'next': return dayLabel(addDays(item.from, 1));
    case 'word': return ENTRIES[item.answer].word;
    case 'sign': return SYLLABLES[item.answer].value;
    case 'read': return readSpelling(item.signs.map((s) => SYLLABLES[s].value));
    case 'spell': return spellingLabel(item.answer);
    case 'tap': return item.zones[item.answer].label;
  }
}

/** An answer button: raised while open; after a tap, green if right, rust (and a shake) if it was the wrong pick. */
const optionBtn = (picked: boolean, right: boolean, done: boolean) => {
  const base = 'min-h-14 rounded-xl border-2 text-primary transition-colors';
  if (!done) return `${base} border-border-light border-b-4 bg-white active:border-b-2 active:translate-y-0.5`;
  if (right) return `${base} border-emerald-600 bg-emerald-50 text-emerald-900 ${picked ? 'lm-pop' : ''}`;
  if (picked) return `${base} border-accent-rust bg-red-50 lm-shake`;
  return `${base} border-border-light bg-white opacity-50`;
};

function Prompt({ item, done, submit }: { item: Item; done: Answered | null; submit: (chose: string, correct: boolean, value: unknown) => void }) {
  const isDone = !!done;
  switch (item.kind) {
    case 'count':
      return (
        <>
          <FigView fig={item.fig} big />
          <div className="grid grid-cols-5 gap-2 mt-4">
            {Array.from({ length: 20 }, (_, n) => (
              <button key={n} disabled={isDone} onClick={() => submit(String(n), n === item.value, n)} className={`text-lg font-medium ${optionBtn(done?.value === n, n === item.value, isDone)}`}>{n}</button>
            ))}
          </div>
        </>
      );
    case 'place': {
      const right = placeValue(item.digits, item.places);
      return (
        <>
          {item.fig ? <FigView fig={item.fig} big /> : <Stack digits={item.digits} places={item.places} showPlaces />}
          <div className="grid grid-cols-2 gap-2 mt-4">
            {item.options.map((o) => (
              <button key={o} disabled={isDone} onClick={() => submit(String(o), o === right, o)} className={`text-xl font-medium ${optionBtn(done?.value === o, o === right, isDone)}`}>{o.toLocaleString('en-GB')}</button>
            ))}
          </div>
        </>
      );
    }
    case 'day':
      return (
        <>
          <FigView fig={item.fig} big />
          {item.note && <p className="text-sm text-secondary mt-2">{item.note}</p>}
          <div className="grid grid-cols-2 gap-2 mt-4">
            {item.options.map((o) => {
              const label = typeof o === 'string' ? o : dayLabel(o);
              const ok = typeof o === 'string' ? o === item.answer : typeof item.answer !== 'string' && sameDay(o, item.answer);
              return <button key={label} disabled={isDone} onClick={() => submit(label, ok, o)} className={`font-serif text-xl ${optionBtn(done?.chose === label, ok, isDone)}`}>{label}</button>;
            })}
          </div>
        </>
      );
    case 'next': {
      const right = addDays(item.from, 1);
      const fromFig = DAY_FIG[item.from[1]];
      return (
        <>
          <div className="flex items-center justify-center gap-3 rounded-xl bg-[#efe6d6] p-4">
            <Numeral value={item.from[0]} size={36} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {fromFig && <img src={fromFig.fig.src} alt={item.from[1]} className="h-16 w-16 object-contain" />}
            <span className="font-serif text-2xl text-primary">{dayLabel(item.from)}</span>
            <span className="font-serif text-2xl text-muted" aria-hidden>→ ?</span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4">
            {item.options.map((o) => (
              <button key={dayLabel(o)} disabled={isDone} onClick={() => submit(dayLabel(o), sameDay(o, right), o)} className={`font-serif text-xl ${optionBtn(done?.chose === dayLabel(o), sameDay(o, right), isDone)}`}>{dayLabel(o)}</button>
            ))}
          </div>
        </>
      );
    }
    case 'word':
      return (
        <div className="grid grid-cols-2 gap-2">
          {item.options.map((k) => (
            <button key={k} disabled={isDone} onClick={() => submit(ENTRIES[k].word, k === item.answer, k)} className={`text-lg ${optionBtn(done?.value === k, k === item.answer, isDone)}`}>{ENTRIES[k].short}</button>
          ))}
        </div>
      );
    case 'sign':
      return (
        <>
          <div className="grid grid-cols-2 gap-2">
            {item.options.map((k) => (
              <button key={k} disabled={isDone} aria-label={`Sign ${item.options.indexOf(k) + 1}`} onClick={() => submit(SYLLABLES[k].value, k === item.answer, k)} className={`p-3 ${optionBtn(done?.value === k, k === item.answer, isDone)}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={SYLLABLES[k].src} alt="" className="h-24 w-auto mx-auto" />
                {isDone && <span className="block font-serif text-lg mt-1">{SYLLABLES[k].value}</span>}
              </button>
            ))}
          </div>
          <Credit href={STUART_SOURCE}>{STUART_CREDIT}</Credit>
        </>
      );
    case 'read': {
      const right = readSpelling(item.signs.map((s) => SYLLABLES[s].value));
      return (
        <>
          <Signs signs={item.signs} highlight={done && !done.correct ? (item.options.find((o) => o.text === done.chose)?.misread?.index ?? null) : null} />
          <div className="grid grid-cols-2 gap-2 mt-4">
            {item.options.map((o) => (
              <button key={o.text} disabled={isDone} onClick={() => submit(o.text, o.text === right, o)} className={`font-serif text-xl ${optionBtn(done?.chose === o.text, o.text === right, isDone)}`}>{o.text}</button>
            ))}
          </div>
        </>
      );
    }
    case 'spell':
      return (
        <div className="grid grid-cols-2 gap-2">
          {item.options.map((o) => {
            const label = spellingLabel(o);
            const ok = label === spellingLabel(item.answer);
            return (
              <button key={label} disabled={isDone} onClick={() => submit(label, ok, o)} className={`p-2 ${optionBtn(done?.chose === label, ok, isDone)}`}>
                <span className="flex justify-center gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {o.map((k, i) => <img key={i} src={SYLLABLES[k].src} alt={SYLLABLES[k].value} className="h-12 w-auto" />)}
                </span>
                <span className="block font-serif text-lg mt-1">{label}</span>
              </button>
            );
          })}
          <div className="col-span-2"><Credit href={STUART_SOURCE}>{STUART_CREDIT}</Credit></div>
        </div>
      );
    case 'tap':
      return (
        <>
          <div className="relative rounded-xl overflow-hidden bg-[#efe6d6]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.fig.src} alt={item.fig.alt} className="w-full" />
            {item.zones.map((z, i) => (
              <button
                key={z.label}
                disabled={isDone}
                aria-label={`Sign ${i + 1}`}
                onClick={() => submit(z.label, i === item.answer, i)}
                className={`absolute top-0 bottom-0 rounded-lg border-4 ${isDone && i === item.answer ? 'border-emerald-600 bg-emerald-500/10' : isDone && done?.value === i ? 'border-accent-rust bg-red-500/10 lm-shake' : 'border-dashed border-stone-400/70'}`}
                style={{ left: `${z.x0 * 100}%`, width: `${(z.x1 - z.x0) * 100}%` }}
              />
            ))}
          </div>
          <Credit href={item.fig.href}>{item.fig.credit}</Credit>
          {!isDone && <p className="text-secondary mt-2">{item.hint}</p>}
        </>
      );
  }
}

/** Every wrong answer: what you picked, what it is, and the one feature that tells them apart. */
function Wrong({ item, answered }: { item: Item; answered: Answered }) {
  const head = <p className="font-serif text-2xl text-accent-rust mb-2">Not quite.</p>;
  switch (item.kind) {
    case 'count': {
      const chosen = answered.value as number;
      return (
        <>
          {head}
          <p className="text-primary mb-3">{numeralWrong(chosen, item.value)}</p>
          <Side
            left={<FigView fig={item.fig} small />}
            leftLabel={`The page: ${item.value}`}
            right={<div className="flex justify-center items-center h-full min-h-20"><Numeral value={chosen} size={64} /></div>}
            rightLabel={`Your ${chosen}`}
          />
        </>
      );
    }
    case 'place': {
      const chosen = answered.value as number;
      const right = placeValue(item.digits, item.places);
      const why = placeMistake(chosen, item.digits, item.places);
      const theirs = toPlaces(chosen, item.places);
      const text: Record<string, string> = {
        sum: `You added the signs: ${item.digits.join(' + ')} = ${chosen}. Multiply each sign by its place.`,
        'upside-down': 'You read it from the bottom up. The top sign is the biggest place.',
        'plain-count': 'That uses 400 for the third place. Day counts use 360.',
        'skipped-top': 'You left out the top sign. It counts 360s.',
      };
      return (
        <>
          {head}
          <p className="text-primary mb-3">You picked {chosen.toLocaleString('en-GB')}. {why ? text[why] : `This is ${right.toLocaleString('en-GB')}.`}</p>
          <PlaceTable digits={item.digits} places={item.places} />
          {theirs && !why && (
            <div className="mt-3">
              <p className="text-sm text-secondary mb-1">Your {chosen} would look like this:</p>
              <Stack digits={theirs} places={item.places} showPlaces />
            </div>
          )}
        </>
      );
    }
    case 'day': {
      const chosen = answered.value as Day | DaySign;
      const right = item.answer;
      const [cN, cS] = typeof chosen === 'string' ? [null, chosen] : chosen;
      const [rN, rS] = typeof right === 'string' ? [null, right] : right;
      return (
        <>
          {head}
          {cS !== rS && (
            <>
              <p className="text-primary mb-3">
                You picked {cS}: {DAY_FIG[cS]?.feature ?? 'a different sign'}. This is {rS}: {DAY_FIG[rS]?.feature}.
              </p>
              <Side
                left={<FigView fig={DAY_FIG[rS]!.fig} small />}
                leftLabel={rS}
                right={DAY_FIG[cS] ? <FigView fig={DAY_FIG[cS]!.fig} small /> : <span />}
                rightLabel={`Your ${cS}`}
              />
            </>
          )}
          {cN !== null && rN !== null && cN !== rN && (
            <>
              <p className="text-primary mb-3 mt-3">You read {cN}, {describeNumeral(cN)}. The page has {describeNumeral(rN)}: {rN}. The number lies on its side, so the bar runs up and down.</p>
              <Side
                left={<div className="flex justify-center items-center min-h-20"><Numeral value={rN} size={56} /></div>}
                leftLabel={`${rN}`}
                right={<div className="flex justify-center items-center min-h-20"><Numeral value={cN} size={56} /></div>}
                rightLabel={`Your ${cN}`}
              />
            </>
          )}
          <p className="text-primary mt-3">It is {typeof right === 'string' ? right : dayLabel(right)}.</p>
        </>
      );
    }
    case 'next': {
      const chosen = answered.value as Day;
      const right = addDays(item.from, 1);
      return (
        <>
          {head}
          <p className="text-primary mb-3">{nextDayWrong(item.from, chosen)}</p>
          <div className="flex flex-wrap items-center gap-2 text-primary">
            <DayChip day={item.from} /> <span aria-hidden>→</span> <DayChip day={right} />
          </div>
        </>
      );
    }
    case 'word': {
      const chosen = ENTRIES[answered.value as string];
      const right = ENTRIES[item.answer];
      return (
        <>
          {head}
          <p className="text-primary mb-3">“{chosen.short}” is <em>{chosen.word}</em>. Both entries in Pío Pérez:</p>
          <EntryView entry={chosen} label={`You picked: ${chosen.word}`} />
          <EntryView entry={right} label={`The answer: ${right.word}`} />
        </>
      );
    }
    case 'sign':
      return (
        <>
          {head}
          <SignCompare chosen={answered.value as SyllableKey} right={item.answer} />
        </>
      );
    case 'read': {
      const opt = answered.value as Extract<Item, { kind: 'read' }>['options'][number];
      const values = item.signs.map((s) => SYLLABLES[s].value);
      const word = readSpelling(values);
      const entry = ENTRIES[item.entry];
      return (
        <>
          {head}
          {opt.misread ? (
            <>
              <p className="text-primary mb-3">You read the {ORD[opt.misread.index]} sign as <em>{SYLLABLES[opt.misread.as].value}</em>. It is <em>{values[opt.misread.index]}</em>.</p>
              <SignCompare chosen={opt.misread.as} right={item.signs[opt.misread.index]} lead="" />
            </>
          ) : (
            <p className="text-primary mb-3">
              {opt.rule === 'silent' && <>The last vowel is silent: {values.slice(0, -1).join('-')}-{values[values.length - 1].slice(0, -1)}<span className="line-through text-muted">{values[values.length - 1].slice(-1)}</span>, <em>{word}</em>.</>}
              {opt.rule === 'dropped' && <>Only the last vowel is silent. Its consonant is spoken: {spellingLabel(values)} is <em>{word}</em>.</>}
              {opt.rule === 'order' && <>Read the signs left to right: {spellingLabel(values)}, <em>{word}</em>.</>}
            </p>
          )}
          <p className="text-primary mt-3">It reads <em>{word}</em>. Pío Pérez: <a href={entry.href} className="underline underline-offset-2">“{entry.text}” (p. {entry.page})</a></p>
        </>
      );
    }
    case 'spell': {
      const chosen = answered.value as SyllableKey[];
      const right = item.answer;
      const entry = ENTRIES[item.entry];
      let text: string;
      if (chosen.length < right.length) text = `${spellingLabel(chosen)} reads ${readSpelling(chosen)}. A sign alone is read whole, so the final k needs a sign of its own, with a silent vowel.`;
      else if (spellingLabel([...chosen].reverse()) === spellingLabel(right)) text = `Signs read left to right, so ${spellingLabel(chosen)} is ${readSpelling(chosen)}.`;
      else text = `${spellingLabel(chosen)} also reads ${readSpelling(chosen)}. The silent last sign usually repeats the vowel before it: ${spellingLabel(right)}.`;
      return (
        <>
          {head}
          <p className="text-primary mb-3">{text}</p>
          <Signs signs={right} />
          <p className="text-primary mt-3">{spellingLabel(right)}, <em>{readSpelling(right)}</em>. Pío Pérez spells it <a href={entry.href} className="underline underline-offset-2"><em>{entry.word}</em>: “{entry.text}” (p. {entry.page})</a></p>
        </>
      );
    }
    case 'tap': {
      const chosen = item.zones[answered.value as number];
      const right = item.zones[item.answer];
      return (
        <>
          {head}
          <p className="text-primary mb-3">
            You tapped the sign Landa labelled <em>{chosen.label}</em>. <em>{right.label}</em> has the comb from Landa’s sign 11, here along the top of a round sign.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div><FigView fig={{ src: crops['landa-ca'].url, alt: 'Landa sign 11', credit: crops['landa-ca'].label, href: crops['landa-ca'].page_url }} small /><p className="text-sm font-medium text-primary mt-1">Landa’s “ca”</p></div>
            <div><FigView fig={{ src: SYLLABLES.ka.src, alt: 'ka', credit: STUART_CREDIT, href: STUART_SOURCE }} small drawing /><p className="text-sm font-medium text-primary mt-1">ka, Stuart’s drawing (carved form)</p></div>
          </div>
          <div className="mt-3"><FigView fig={item.after} /></div>
        </>
      );
    }
  }
}

const ORD = ['first', 'second', 'third', 'fourth'];

function SignCompare({ chosen, right, lead = 'You picked' }: { chosen: SyllableKey; right: SyllableKey; lead?: string }) {
  const c = SYLLABLES[chosen], r = SYLLABLES[right];
  return (
    <>
      <p className="text-primary mb-3">{lead ? <>{lead} <em>{c.value}</em>: </> : <><em>{c.value}</em> is </>}{c.feature}. <em>{r.value}</em> is {r.feature}.</p>
      <Side
        left={<SignImg k={right} />}
        leftLabel={r.value}
        right={<SignImg k={chosen} />}
        rightLabel={`Your ${c.value}`}
      />
      {isConfusable(chosen, right) && <p className="text-sm text-secondary mt-2">{WAYEB_NOTE}</p>}
      <Credit href={STUART_SOURCE}>{STUART_CREDIT}</Credit>
    </>
  );
}

// ── Lesson complete ──

type Learned = { label: string } & ({ numeral: number } | { src: string; drawing?: boolean });

/** The glyphs a lesson's items asked about: numbers drawn, day signs from the page, Stuart's syllables. */
function lessonGlyphs(lesson: Lesson): Learned[] {
  const out = new Map<string, Learned>();
  const syl = (k: SyllableKey) => out.set(`s-${k}`, { label: SYLLABLES[k].value, src: SYLLABLES[k].src, drawing: true });
  for (const it of lesson.steps.filter(isItem)) {
    if (it.kind === 'count') out.set(`n-${it.value}`, { label: String(it.value), numeral: it.value });
    if (it.kind === 'day') {
      const sign = typeof it.answer === 'string' ? it.answer : it.answer[1];
      if (DAY_FIG[sign]) out.set(`d-${sign}`, { label: typeof it.answer === 'string' ? sign : dayLabel(it.answer), src: DAY_FIG[sign]!.fig.src });
    }
    if (it.kind === 'sign') syl(it.answer);
    if (it.kind === 'read') it.signs.forEach(syl);
    if (it.kind === 'spell') it.answer.forEach(syl);
  }
  return [...out.values()];
}

function Done({ view, onNext, onMap }: { view: Extract<View, { screen: 'done' }>; onNext: (id: string) => void; onMap: () => void }) {
  const lesson = lessonById(view.lesson);
  const following = LESSONS.find((l) => l.n === lesson.n + 1);
  const glyphs = lessonGlyphs(lesson);
  const hasStuart = glyphs.some((g) => 'drawing' in g && g.drawing);
  return (
    <Shell>
      <div className="lm-rise text-center pt-6">
        <p className="w-16 h-16 mx-auto lm-round bg-emerald-600 text-white text-3xl flex items-center justify-center mb-3" aria-hidden>✓</p>
        <h1 className="font-serif text-3xl text-primary">Lesson {lesson.n} done</h1>
        <p className="text-secondary mt-1"><span className="font-medium text-primary">{view.right} of {view.graded}</span> right the first time</p>
      </div>
      <h2 className="font-serif text-xl text-primary mt-8 mb-3">Glyphs you read today</h2>
      <div className="grid grid-cols-4 gap-2">
        {glyphs.map((g, i) => (
          <div key={g.label} className="lm-rise rounded-xl border-2 border-border-light bg-white p-1.5 text-center" style={{ animationDelay: `${i * 40}ms` }}>
            <div className={`h-14 flex items-center justify-center rounded-lg ${'numeral' in g ? 'bg-[#efe6d6]' : g.drawing ? 'bg-white' : 'bg-[#efe6d6]'}`}>
              {'numeral' in g ? <Numeral value={g.numeral} size={30} /> : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.src} alt={g.label} className="max-h-14 w-auto object-contain" />
              )}
            </div>
            <span className="block font-serif text-primary mt-0.5">{g.label}</span>
          </div>
        ))}
      </div>
      {hasStuart && <Credit href={STUART_SOURCE}>{STUART_CREDIT}</Credit>}
      <ul className="mt-6 space-y-2">
        {lesson.recap.map((r) => (
          <li key={r} className="flex gap-2 text-primary"><span className="text-emerald-700 shrink-0" aria-hidden>✓</span><Prose text={r} /></li>
        ))}
      </ul>
      {view.missed > 0 && (
        <p className="text-secondary mt-4">You missed {view.missed === 1 ? 'one' : view.missed}. {view.missed === 1 ? 'It comes' : 'They come'} back next time.</p>
      )}
      <Sticky>
        {following?.open && OPEN_LESSONS.includes(following.id) ? (
          <>
            <button onClick={() => onNext(following.id)} className={btnInk}>Next: lesson {following.n}, {following.title}</button>
            <button onClick={onMap} className={`${btnLight} mt-2`}>Course map</button>
          </>
        ) : (
          <>
            <p className="text-center text-secondary mb-2">Lessons 4 to 6 are coming.</p>
            <button onClick={onMap} className={btnInk}>Course map</button>
          </>
        )}
      </Sticky>
    </Shell>
  );
}

// ── Pieces ──

function FigView({ fig, small, big, tall, drawing }: { fig: Fig; small?: boolean; big?: boolean; tall?: boolean; drawing?: boolean }) {
  return (
    <figure>
      <div className={`rounded-xl flex items-center justify-center overflow-hidden ${drawing ? 'bg-white' : 'bg-[#efe6d6]'} ${big ? 'min-h-[28vh]' : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fig.src} alt={fig.alt} className={`${small ? 'max-h-32' : big ? 'max-h-[38vh]' : tall ? 'max-h-[48vh]' : 'max-h-[50vh]'} w-full object-contain`} />
      </div>
      <Credit href={fig.href}>{fig.credit}</Credit>
    </figure>
  );
}

function Credit({ href, children }: { href: string; children: ReactNode }) {
  return <figcaption className="text-xs text-muted mt-1"><a href={href} className="underline underline-offset-2">{children}</a></figcaption>;
}

function Side({ left, leftLabel, right, rightLabel }: { left: ReactNode; leftLabel: string; right: ReactNode; rightLabel: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div><div className="rounded-xl border-2 border-emerald-600 bg-white p-1">{left}</div><p className="text-sm font-medium text-emerald-800 mt-1">{leftLabel}</p></div>
      <div><div className="rounded-xl border-2 border-accent-rust bg-white p-1">{right}</div><p className="text-sm font-medium text-accent-rust mt-1">{rightLabel}</p></div>
    </div>
  );
}

function SignImg({ k }: { k: SyllableKey }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={SYLLABLES[k].src} alt={SYLLABLES[k].value} className="h-24 w-auto mx-auto bg-white" />;
}

function Signs({ signs, highlight = null, labels }: { signs: SyllableKey[]; highlight?: number | null; labels?: boolean }) {
  return (
    <div>
      <div className="flex justify-center gap-2 rounded-xl bg-white border-2 border-border-light p-3">
        {signs.map((k, i) => (
          <div key={i} className={`rounded-lg p-1 text-center ${highlight === i ? 'ring-4 ring-accent-rust' : ''}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SYLLABLES[k].src} alt={labels ? SYLLABLES[k].value : `sign ${i + 1}`} className="h-20 w-auto" />
            {labels && <span className="block font-serif text-lg text-primary">{SYLLABLES[k].value}</span>}
          </div>
        ))}
      </div>
      <Credit href={STUART_SOURCE}>{STUART_CREDIT}</Credit>
    </div>
  );
}

const PLACE_NAME: Record<number, string> = { 1: 'ones', 20: 'twenties', 360: '360s', 400: '400s' };

function Stack({ digits, places, showPlaces }: { digits: number[]; places: number[]; showPlaces?: boolean }) {
  return (
    <div className="rounded-xl bg-[#efe6d6] p-4 space-y-3">
      {digits.map((d, i) => (
        <div key={i} className="flex items-center justify-center gap-4 border-b border-black/10 last:border-0 pb-3 last:pb-0">
          {showPlaces && <span className="w-20 text-sm text-secondary text-right">{PLACE_NAME[places[i]] ?? places[i]}</span>}
          <div className="w-16 flex justify-center"><Numeral value={d} size={48} /></div>
        </div>
      ))}
    </div>
  );
}

function PlaceTable({ digits, places }: { digits: number[]; places: number[] }) {
  return (
    <table className="w-full text-sm bg-white rounded-xl">
      <tbody>
        {digits.map((d, i) => (
          <tr key={i} className="border-b border-border-light">
            <td className="py-1 px-2 w-14"><Numeral value={d} size={32} /></td>
            <td className="py-1 font-mono text-primary">{d} × {places[i]} = {d * places[i]}</td>
          </tr>
        ))}
        <tr><td /><td className="py-1 font-mono font-medium text-primary">total {placeValue(digits, places)}</td></tr>
      </tbody>
    </table>
  );
}

function DayChip({ day }: { day: Day }) {
  const f = DAY_FIG[day[1]];
  return (
    <span className="inline-flex items-center gap-1 rounded-xl bg-[#efe6d6] px-2 py-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {f && <img src={f.fig.src} alt="" className="h-10 w-10 object-contain" />}
      <span className="font-serif text-lg">{dayLabel(day)}</span>
    </span>
  );
}

function EntryView({ entry, label }: { entry: (typeof ENTRIES)[string]; label: string }) {
  return (
    <div className="mb-2">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="font-serif text-lg text-primary"><a href={entry.href} className="underline underline-offset-2">{entry.text.replace(/\s*\|\s*/g, ' ')}</a> <span className="text-sm text-muted">(p. {entry.page})</span></p>
    </div>
  );
}

/** [label](href) links and *italics*; nothing else. */
function Prose({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/);
  return (
    <>
      {parts.map((p, i) => {
        const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) return <a key={i} href={link[2]} className="underline underline-offset-2">{link[1]}</a>;
        if (/^\*[^*]+\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

