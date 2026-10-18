'use client';

import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { CyclesMeet, Numeral, NumeralBuilder } from '@/app/articles/maya-mathematics/MayaInteractives';
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
  LESSONS,
  OPEN_LESSONS,
  STUART_CREDIT,
  STUART_SOURCE,
  SYLLABLES,
  WAYEB_NOTE,
  YUCATEC,
  dresdenPage,
  isConfusable,
  isItem,
  landaPage,
  type Example,
  type Fig,
  type Item,
  type SyllableKey,
} from './course';
import crops from './course-crops.json';

type View =
  | { screen: 'choose' }
  | { screen: 'intro' }
  | { screen: 'map' }
  | { screen: 'review'; ids: string[]; index: number }
  | { screen: 'lesson'; lesson: string; step: number }
  | { screen: 'recap'; lesson: string; missed: number };

/** What the learner answered and how it went, kept until they tap Next. */
interface Answered { chose: string; correct: boolean; value: unknown }

const lessonById = (id: string) => LESSONS.find((l) => l.id === id)!;
const btnDark = 'w-full py-4 rounded-lg bg-[#1a1612] text-white font-medium';
const btnLight = 'w-full py-3 rounded-lg border border-border-light bg-white text-primary';
const PALENQUE_PAGE = '/book/6a9f3f9c83c3b522416e4456?page=222';
/** Missed items still in the course (an item dropped from course.ts is never asked again). */
const dueItems = (s: CourseState) => reviewDue({ ...s, missed: Object.fromEntries(Object.entries(s.missed).filter(([id]) => COURSE_ITEMS.has(id))) });

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
  // Yucatec at /learn/yucatec), then gets the introduction; a returning
  // one gets last sitting's misses, then the next lesson. #lesson-N opens a lesson.
  useEffect(() => {
    const s = startSitting(parseCourse(window.localStorage.getItem(COURSE_KEY)));
    // localStorage exists only after mount; this runs once per visit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    save(s);
    const hash = window.location.hash.match(/^#lesson-(\d)$/);
    const linked = hash ? LESSONS.find((l) => l.n === Number(hash[1]) && (l.n === 0 || OPEN_LESSONS.includes(l.id))) : undefined;
    if (linked) setView(linked.n === 0 ? { screen: 'intro' } : { screen: 'lesson', lesson: linked.id, step: 0 });
    else if (!s.introSeen) setView({ screen: 'choose' });
    else if (dueItems(s).length) setView({ screen: 'review', ids: dueItems(s), index: 0 });
    else setView({ screen: 'map' });
  }, [save]);

  const go = (v: View) => {
    window.scrollTo(0, 0);
    setView(v);
  };

  if (!state) return <div className="max-w-md mx-auto px-5 py-8 animate-pulse"><div className="h-[60vh] bg-stone-200 rounded-lg" /></div>;

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

  const startLesson = (id: string) => go({ screen: 'lesson', lesson: id, step: 0 });
  const upNext = nextLesson(state, OPEN_LESSONS);

  if (view.screen === 'choose') {
    return (
      <Shell>
        <h1 className="font-serif text-3xl text-primary mt-4 mb-2">Learn Maya</h1>
        <p className="text-secondary mb-6">Two courses, from the books in this library.</p>
        <button onClick={() => go({ screen: 'intro' })} className="block w-full text-left rounded-lg border border-border-light bg-white p-4 mb-3 active:bg-stone-100">
          <span className="block font-serif text-2xl text-primary">Read the glyphs</span>
          <span className="block text-secondary mt-1">Read the numbers, days and syllables of the Dresden Codex and of the key a Maya scribe wrote for Diego de Landa.</span>
        </button>
        <a href={YUCATEC} className="block rounded-lg border border-border-light bg-white p-4 active:bg-stone-100">
          <span className="block font-serif text-2xl text-primary">Learn Yucatec Maya</span>
          <span className="block text-secondary mt-1">Read and understand the language of the colonial Maya books, written in Roman letters.</span>
        </a>
      </Shell>
    );
  }

  if (view.screen === 'intro') {
    return (
      <Intro
        state={state}
        onOpen={(id) => { save({ ...state, introSeen: true }); startLesson(id); }}
        onMap={() => { save({ ...state, introSeen: true }); go({ screen: 'map' }); }}
      />
    );
  }

  if (view.screen === 'map') {
    return (
      <Shell>
        <h1 className="font-serif text-3xl text-primary mb-2">Learn to read Maya</h1>
        <p className="text-secondary mb-6">Six lessons, each one sitting of about fifteen minutes.</p>
        <CourseMap state={state} current={upNext} onOpen={(id) => (id === 'intro' ? go({ screen: 'intro' }) : startLesson(id))} />
        <button onClick={() => startLesson(upNext)} className={`${btnDark} mt-6`}>
          {state.done[upNext] ? 'Go over' : 'Start'} lesson {lessonById(upNext).n}: {lessonById(upNext).title}
        </button>
        <p className="text-sm text-secondary mt-6">The language itself, in Roman letters: <a href={YUCATEC} className="underline underline-offset-2">Learn Yucatec Maya</a>.</p>
      </Shell>
    );
  }

  if (view.screen === 'review') {
    const id = view.ids[view.index];
    const entry = COURSE_ITEMS.get(id)!;
    const next = () => (view.index + 1 < view.ids.length ? go({ ...view, index: view.index + 1 }) : startLesson(upNext));
    return (
      <Shell>
        <TopBar label="Before the next lesson" onMap={() => go({ screen: 'map' })} progress={(view.index + 1) / view.ids.length} />
        {view.index === 0 && <p className="font-serif text-2xl text-primary mb-5">{reviewIntro(state, view.ids)}</p>}
        <ItemView key={`review-${id}`} item={entry.item} onAnswer={(a, right) => answer(entry.lesson, entry.item, a, right)} onNext={next} />
      </Shell>
    );
  }

  if (view.screen === 'recap') {
    const lesson = lessonById(view.lesson);
    const following = LESSONS.find((l) => l.n === lesson.n + 1);
    return (
      <Shell>
        <TopBar label={`Lesson ${lesson.n} · ${lesson.title}`} onMap={() => go({ screen: 'map' })} progress={1} />
        <h1 className="font-serif text-3xl text-primary mb-4">What you can read now</h1>
        <ul className="space-y-3 mb-6">
          {lesson.recap.map((r) => <li key={r} className="text-lg text-primary border-l-2 border-accent-rust pl-3"><Prose text={r} /></li>)}
        </ul>
        {view.missed > 0 && (
          <p className="text-secondary mb-6">
            You missed {view.missed === 1 ? 'one item' : `${view.missed} items`}. {view.missed === 1 ? 'It opens' : 'They open'} your next sitting.
          </p>
        )}
        {following?.open && OPEN_LESSONS.includes(following.id) ? (
          <>
            <p className="text-secondary mb-3">Next time: lesson {following.n}, {following.title.toLowerCase()}.</p>
            <button onClick={() => startLesson(following.id)} className={btnDark}>Go on to lesson {following.n} now</button>
          </>
        ) : (
          <p className="text-secondary mb-3">Lessons 4 to 6 are being written.</p>
        )}
        <button onClick={() => go({ screen: 'map' })} className={`${btnLight} mt-3`}>Course map</button>
      </Shell>
    );
  }

  const lesson = lessonById(view.lesson);
  const step = lesson.steps[view.step];
  const missedHere = () => Object.values(state.missed).filter((m) => m.lesson === lesson.id && m.sitting === state.sitting).length;
  const advance = () => {
    if (view.step + 1 < lesson.steps.length) return go({ ...view, step: view.step + 1 });
    save(finishLesson(state, lesson.id));
    go({ screen: 'recap', lesson: lesson.id, missed: missedHere() });
  };
  return (
    <Shell>
      <TopBar label={`Lesson ${lesson.n} · ${lesson.title}`} onMap={() => go({ screen: 'map' })} progress={(view.step + 1) / (lesson.steps.length + 1)} />
      {isItem(step) ? (
        <ItemView key={step.id} item={step} onAnswer={(a, right) => answer(lesson.id, step, a, right)} onNext={advance} />
      ) : (
        <ExampleView key={`${lesson.id}-${view.step}`} example={step} first={view.step === 0} onNext={advance} />
      )}
    </Shell>
  );
}

// ── Screens ──

function Shell({ children }: { children: ReactNode }) {
  return <div className="max-w-md mx-auto px-5 pt-4 pb-16">{children}</div>;
}

function TopBar({ label, onMap, progress }: { label: string; onMap: () => void; progress: number }) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="text-sm text-secondary">{label}</span>
        <button onClick={onMap} className="text-sm text-muted underline underline-offset-2 shrink-0">Course map</button>
      </div>
      <div className="h-1 bg-stone-200 rounded"><div className="h-1 bg-accent-rust rounded" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
    </div>
  );
}

function Intro({ state, onOpen, onMap }: { state: CourseState; onOpen: (id: string) => void; onMap: () => void }) {
  const leaf = crops['dresden-53-leaf'];
  const upNext = lessonById(nextLesson(state, OPEN_LESSONS));
  return (
    <div className="max-w-md mx-auto pb-16">
      <figure className="bg-[#efe6d6]">
        <a href={leaf.page_url}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={leaf.url} alt="A page of the Dresden Codex: columns of glyphs, bar-and-dot numbers in red and black, and two seated figures" className="w-full max-h-[78vh] object-contain" />
        </a>
        <figcaption className="text-xs text-muted px-5 py-1"><a href={leaf.page_url} className="underline underline-offset-2">Dresden Codex, page 53</a></figcaption>
      </figure>
      <div className="px-5">
        <h1 className="font-serif text-3xl text-primary mt-5 mb-3">Learn to read Maya</h1>
        <p className="text-lg text-primary mb-3">
          This is a page of the <a href={dresdenPage(32)} className="underline underline-offset-2">Dresden Codex</a>, one of four Maya books that survived. By the end of this course you will read a date and a name from it, and a sentence carved at <a href={PALENQUE_PAGE} className="underline underline-offset-2">Palenque</a> in 692.
        </p>

        <h2 className="font-serif text-2xl text-primary mt-8 mb-3">A key misread for 386 years</h2>
        <p className="text-primary mb-3">
          In 1566 Bishop Diego de Landa wrote that the friars had found many of these books and, <a href={landaPage(439)} className="underline underline-offset-2">in his words</a>, &ldquo;burned them all&rdquo;. In the same chapter he set down an &ldquo;a, b, c&rdquo; that a Maya scribe wrote for him, a Spanish letter beside each sign.
        </p>
        <FigView fig={{ src: crops['landa-abc'].url, alt: "The scribe's signs for Landa, with Landa's letters", credit: crops['landa-abc'].label, href: crops['landa-abc'].page_url }} />
        <p className="text-primary mb-3 mt-4">
          He also shows how the scribe wrote a word. Landa spelled <em>le</em>, &ldquo;noose&rdquo;, the Spanish way, letter by letter; the scribe wrote <a href={landaPage(441)} className="underline underline-offset-2">four signs</a>, which Landa labelled e, L, e, Lé.
        </p>
        <FigView fig={{ src: crops['landa-le'].url, alt: 'Four signs for le, labelled e, L, e, Lé', credit: crops['landa-le'].label, href: crops['landa-le'].page_url }} />
        <p className="text-primary mb-3 mt-4">
          The scribe was writing the sounds he heard, syllable by syllable. Landa took the signs for letters, and read as letters <a href={landaPage(443)} className="underline underline-offset-2">his key</a> made no sense. It sat misread until 1952, when Yuri Knorozov saw that the signs were syllables. Lesson 3 reads Landa&rsquo;s page the way Knorozov did.
        </p>
        <p className="text-sm text-secondary mb-8">Further reading: Michael D. Coe, <em>Breaking the Maya Code</em>, tells the story of the decipherment.</p>

        <h2 className="font-serif text-2xl text-primary mb-1">The course</h2>
        <p className="text-secondary mb-4">Six lessons, each one sitting of about fifteen minutes. Each ends with something you read on a real page.</p>
        <CourseMap state={state} current="intro" onOpen={(id) => id !== 'intro' && onOpen(id)} />
        <button onClick={() => onOpen(upNext.id)} className={`${btnDark} mt-6`}>Start lesson {upNext.n}: {upNext.title}</button>
        <button onClick={onMap} className={`${btnLight} mt-3`}>Course map</button>
      </div>
    </div>
  );
}

function CourseMap({ state, current, onOpen }: { state: CourseState; current: string; onOpen: (id: string) => void }) {
  return (
    <ol className="border-l-2 border-border-light ml-2">
      {LESSONS.map((l) => {
        const available = l.n === 0 || OPEN_LESSONS.includes(l.id);
        const here = l.id === current;
        const done = !!state.done[l.id] || (l.n === 0 && state.introSeen);
        return (
          <li key={l.id} className="relative pl-5 pb-4 last:pb-0">
            <span className={`absolute -left-[7px] top-1.5 w-3 h-3 rounded-full border-2 ${here ? 'bg-accent-rust border-accent-rust' : done ? 'bg-[#1a1612] border-[#1a1612]' : 'bg-cream border-border-medium'}`} />
            {available ? (
              <button onClick={() => onOpen(l.id)} className="text-left">
                <span className={`block font-medium ${here ? 'text-accent-rust' : 'text-primary'}`}>{l.n}. {l.title}{done && !here ? ' ✓' : ''}{here ? ' · you are here' : ''}</span>
                <span className="block text-sm text-secondary">{l.blurb}</span>
              </button>
            ) : (
              <div>
                <span className="block font-medium text-muted">{l.n}. {l.title} · coming</span>
                <span className="block text-sm text-muted">{l.blurb}</span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ExampleView({ example, first, onNext }: { example: Example; first: boolean; onNext: () => void }) {
  return (
    <section>
      <p className="text-xs uppercase tracking-wide text-muted mb-1">{first ? 'Worked example' : 'Next'}</p>
      <h1 className="font-serif text-3xl text-primary mb-4">{example.title}</h1>
      {example.body.map((p) => <p key={p} className="text-lg text-primary mb-3"><Prose text={p} /></p>)}
      {example.figs && (
        <div className={`grid gap-3 my-4 ${example.figs.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {example.figs.map((f) => (
            <div key={f.src}>
              <FigView fig={f} small={example.figs!.length > 1} />
              {(f.caption || f.numeral !== undefined) && (
                <div className="flex items-center gap-2 mt-1">
                  {f.numeral !== undefined && <Numeral value={f.numeral} size={28} />}
                  {f.caption && <span className="text-sm text-primary">{f.caption}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {example.pairs?.map((p) => (
        <div key={p.caption} className="my-4 rounded-lg border border-border-light bg-white p-3">
          <div className="grid grid-cols-2 gap-3 items-end">
            <FigView fig={p.left} small />
            <FigView fig={p.right} small drawing />
          </div>
          <p className="text-sm text-primary mt-2">{p.caption}</p>
        </div>
      ))}
      {example.syllables && (
        <div className="grid grid-cols-3 gap-2 my-4">
          {example.syllables.map((k) => (
            <div key={k} className="rounded-lg border border-border-light bg-white p-2 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={SYLLABLES[k].src} alt={SYLLABLES[k].value} className="h-16 w-auto mx-auto" />
              <span className="font-serif text-lg text-primary">{SYLLABLES[k].value}</span>
            </div>
          ))}
          <p className="col-span-3 text-xs text-muted"><a href={STUART_SOURCE} className="underline underline-offset-2">{STUART_CREDIT}</a></p>
        </div>
      )}
      {example.days && (
        <ul className="my-4 space-y-2">
          {example.days.map((d) => DAY_FIG[d] && (
            <li key={d} className="flex items-center gap-3 rounded-lg border border-border-light bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={DAY_FIG[d]!.fig.src} alt={d} className="h-14 w-14 object-contain rounded bg-[#efe6d6] shrink-0" />
              <span><span className="font-serif text-lg text-primary">{d}</span> <span className="text-sm text-secondary">· {DAY_FIG[d]!.feature}</span></span>
            </li>
          ))}
          <li className="text-xs text-muted"><a href={dresdenPage(32)} className="underline underline-offset-2">Dresden Codex, page 53</a></li>
        </ul>
      )}
      {example.interactive === 'numeral-builder' && <div className="-mx-2"><NumeralBuilder /></div>}
      {example.interactive === 'cycles-13-20' && (
        <div className="-mx-2">
          <CyclesMeet
            cycles={[
              { key: 'n', name: 'Numbers', unit: 'rounds of the 13 numbers', days: 13, truth: null },
              { key: 's', name: 'Day signs', unit: 'rounds of the 20 signs', days: 20, truth: null },
            ]}
            initial={{ n: true, s: true }}
            caption="Each tick is the end of a round: 13 days for the numbers, 20 for the signs. They end together first after 260 days."
          />
        </div>
      )}
      {example.after?.map((p) => <p key={p} className="text-primary mb-3"><Prose text={p} /></p>)}
      <button onClick={onNext} className={`${btnDark} mt-4`}>Try it</button>
    </section>
  );
}

// ── Items ──

function ItemView({ item, onAnswer, onNext }: { item: Item; onAnswer: (a: Answered, right: string) => void; onNext: () => void }) {
  const [done, setDone] = useState<Answered | null>(null);
  const submit = (chose: string, correct: boolean, value: unknown) => {
    if (done) return;
    const a = { chose, correct, value };
    setDone(a);
    onAnswer(a, rightLabel(item));
  };
  return (
    <section>
      {item.wild && <p className="text-xs uppercase tracking-wide text-accent-rust font-medium mb-1">In the wild</p>}
      <p className="text-lg text-primary mb-3"><Prose text={item.prompt} /></p>
      <Prompt item={item} done={done} submit={submit} />
      {done && (
        <div className="mt-5" aria-live="polite">
          {done.correct ? (
            <div className="rounded-lg bg-white border border-border-light p-4">
              <p className="font-serif text-2xl text-primary mb-1">Yes.</p>
              <p className="text-primary"><Prose text={item.why} /></p>
              {item.kind === 'tap' && <div className="mt-3"><FigView fig={item.after} /></div>}
            </div>
          ) : (
            <Wrong item={item} answered={done} />
          )}
          {item.wild && (
            <a href={item.wild.href} className="block mt-3 text-accent-rust underline underline-offset-2">{item.wild.label}</a>
          )}
          <button onClick={onNext} className={`${btnDark} mt-4`}>Next</button>
        </div>
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

const optionBtn = (picked: boolean, right: boolean, done: boolean) =>
  `rounded-lg border bg-white text-primary active:bg-stone-100 ${done && right ? 'border-[#1a1612] border-2' : done && picked ? 'border-accent-rust border-2' : 'border-border-light'}`;

function Prompt({ item, done, submit }: { item: Item; done: Answered | null; submit: (chose: string, correct: boolean, value: unknown) => void }) {
  const isDone = !!done;
  switch (item.kind) {
    case 'count':
      return (
        <>
          <FigView fig={item.fig} big />
          <div className="grid grid-cols-5 gap-2 mt-3">
            {Array.from({ length: 20 }, (_, n) => (
              <button key={n} disabled={isDone} onClick={() => submit(String(n), n === item.value, n)} className={`h-12 text-lg font-medium ${optionBtn(done?.value === n, n === item.value, isDone)}`}>{n}</button>
            ))}
          </div>
        </>
      );
    case 'place': {
      const right = placeValue(item.digits, item.places);
      return (
        <>
          {item.fig ? <FigView fig={item.fig} big /> : <Stack digits={item.digits} places={item.places} showPlaces />}
          <div className="grid grid-cols-2 gap-2 mt-3">
            {item.options.map((o) => (
              <button key={o} disabled={isDone} onClick={() => submit(String(o), o === right, o)} className={`h-14 text-lg font-medium ${optionBtn(done?.value === o, o === right, isDone)}`}>{o.toLocaleString('en-GB')}</button>
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
          <div className="grid grid-cols-2 gap-2 mt-3">
            {item.options.map((o) => {
              const label = typeof o === 'string' ? o : dayLabel(o);
              const ok = typeof o === 'string' ? o === item.answer : typeof item.answer !== 'string' && sameDay(o, item.answer);
              return <button key={label} disabled={isDone} onClick={() => submit(label, ok, o)} className={`h-14 font-serif text-lg ${optionBtn(done?.chose === label, ok, isDone)}`}>{label}</button>;
            })}
          </div>
        </>
      );
    case 'next': {
      const right = addDays(item.from, 1);
      const fromFig = DAY_FIG[item.from[1]];
      return (
        <>
          <div className="flex items-center gap-3 rounded-lg bg-[#efe6d6] p-3">
            <Numeral value={item.from[0]} size={36} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {fromFig && <img src={fromFig.fig.src} alt={item.from[1]} className="h-16 w-16 object-contain" />}
            <span className="font-serif text-2xl text-primary">{dayLabel(item.from)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {item.options.map((o) => (
              <button key={dayLabel(o)} disabled={isDone} onClick={() => submit(dayLabel(o), sameDay(o, right), o)} className={`h-14 font-serif text-lg ${optionBtn(done?.chose === dayLabel(o), sameDay(o, right), isDone)}`}>{dayLabel(o)}</button>
            ))}
          </div>
        </>
      );
    }
    case 'word':
      return (
        <div className="grid grid-cols-2 gap-2">
          {item.options.map((k) => (
            <button key={k} disabled={isDone} onClick={() => submit(ENTRIES[k].word, k === item.answer, k)} className={`h-14 text-lg ${optionBtn(done?.value === k, k === item.answer, isDone)}`}>{ENTRIES[k].short}</button>
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
          <div className="grid grid-cols-2 gap-2 mt-3">
            {item.options.map((o) => (
              <button key={o.text} disabled={isDone} onClick={() => submit(o.text, o.text === right, o)} className={`h-14 font-serif text-xl ${optionBtn(done?.chose === o.text, o.text === right, isDone)}`}>{o.text}</button>
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
          <div className="relative rounded-lg overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.fig.src} alt={item.fig.alt} className="w-full" />
            {item.zones.map((z, i) => (
              <button
                key={z.label}
                disabled={isDone}
                aria-label={`Sign ${i + 1}`}
                onClick={() => submit(z.label, i === item.answer, i)}
                className={`absolute top-0 bottom-0 rounded border-2 ${isDone && i === item.answer ? 'border-[#1a1612]' : isDone && done?.value === i ? 'border-accent-rust' : 'border-dashed border-stone-400/70'}`}
                style={{ left: `${z.x0 * 100}%`, width: `${(z.x1 - z.x0) * 100}%` }}
              />
            ))}
          </div>
          <Credit href={item.fig.href}>{item.fig.credit}</Credit>
          {!isDone && <p className="text-sm text-secondary mt-2">{item.hint}</p>}
        </>
      );
  }
}

/** Every wrong answer explains itself: what you chose, drawn next to what it is, and the feature that tells them apart. */
function Wrong({ item, answered }: { item: Item; answered: Answered }) {
  const box = 'rounded-lg border-2 border-accent-rust/40 bg-white p-4';
  const head = <p className="font-serif text-2xl text-accent-rust mb-2">Not quite.</p>;
  switch (item.kind) {
    case 'count': {
      const chosen = answered.value as number;
      return (
        <div className={box}>
          {head}
          <p className="text-primary mb-3">{numeralWrong(chosen, item.value)}</p>
          <Side
            left={<FigView fig={item.fig} small />}
            leftLabel={`The page: ${item.value}`}
            right={<div className="flex justify-center items-center h-full min-h-20"><Numeral value={chosen} size={64} /></div>}
            rightLabel={`Your ${chosen}`}
          />
        </div>
      );
    }
    case 'place': {
      const chosen = answered.value as number;
      const right = placeValue(item.digits, item.places);
      const why = placeMistake(chosen, item.digits, item.places);
      const theirs = toPlaces(chosen, item.places);
      const text: Record<string, string> = {
        sum: `You added the signs (${item.digits.join(' + ')} = ${chosen}). Each place multiplies: read it place by place.`,
        'upside-down': 'You read the stack from the bottom up. The top sign is the biggest place; the bottom one counts ones.',
        'plain-count': `That is plain counting, with 400 in the third place. In the codex day counts the third place is 360, so the top dot is 360 days.`,
        'skipped-top': 'You left out the top sign. It sits in the third place, 360 days.',
      };
      return (
        <div className={box}>
          {head}
          <p className="text-primary mb-3">You said {chosen.toLocaleString('en-GB')}. {why ? text[why] : `This is ${right.toLocaleString('en-GB')}.`}</p>
          <PlaceTable digits={item.digits} places={item.places} />
          {theirs && !why && (
            <div className="mt-3">
              <p className="text-sm text-secondary mb-1">Your {chosen} in the same places would look like this:</p>
              <Stack digits={theirs} places={item.places} showPlaces />
            </div>
          )}
        </div>
      );
    }
    case 'day': {
      const chosen = answered.value as Day | DaySign;
      const right = item.answer;
      const [cN, cS] = typeof chosen === 'string' ? [null, chosen] : chosen;
      const [rN, rS] = typeof right === 'string' ? [null, right] : right;
      return (
        <div className={box}>
          {head}
          {cS !== rS && (
            <>
              <p className="text-primary mb-3">
                You chose {cS}: {DAY_FIG[cS]?.feature ?? 'a different sign'}. This is {rS}: {DAY_FIG[rS]?.feature}.
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
              <p className="text-primary mb-3 mt-3">The number: you read {cN}, {describeNumeral(cN)}. The page has {describeNumeral(rN)}: {rN}. On the codex the number stands on its side, so the bar runs up and down.</p>
              <Side
                left={<div className="flex justify-center items-center min-h-20"><Numeral value={rN} size={56} /></div>}
                leftLabel={`${rN}`}
                right={<div className="flex justify-center items-center min-h-20"><Numeral value={cN} size={56} /></div>}
                rightLabel={`Your ${cN}`}
              />
            </>
          )}
          <p className="text-primary mt-3">It is {typeof right === 'string' ? right : dayLabel(right)}.</p>
        </div>
      );
    }
    case 'next': {
      const chosen = answered.value as Day;
      const right = addDays(item.from, 1);
      return (
        <div className={box}>
          {head}
          <p className="text-primary mb-3">{nextDayWrong(item.from, chosen)}</p>
          <div className="flex items-center gap-2 text-primary">
            <DayChip day={item.from} /> <span aria-hidden>→</span> <DayChip day={right} />
          </div>
        </div>
      );
    }
    case 'word': {
      const chosen = ENTRIES[answered.value as string];
      const right = ENTRIES[item.answer];
      return (
        <div className={box}>
          {head}
          <p className="text-primary mb-3">&ldquo;{chosen.short}&rdquo; is <em>{chosen.word}</em>. Here are both entries in Pío Pérez:</p>
          <EntryView entry={chosen} label={`What you chose: ${chosen.word}`} />
          <EntryView entry={right} label={`The answer: ${right.word}`} />
        </div>
      );
    }
    case 'sign': {
      const chosen = answered.value as SyllableKey;
      const right = item.answer;
      return (
        <div className={box}>
          {head}
          <SignCompare chosen={chosen} right={right} />
        </div>
      );
    }
    case 'read': {
      const opt = answered.value as Extract<Item, { kind: 'read' }>['options'][number];
      const values = item.signs.map((s) => SYLLABLES[s].value);
      const word = readSpelling(values);
      const entry = ENTRIES[item.entry];
      return (
        <div className={box}>
          {head}
          {opt.misread ? (
            <>
              <p className="text-primary mb-3">You read the {ORD[opt.misread.index]} sign as <em>{SYLLABLES[opt.misread.as].value}</em>. It is <em>{values[opt.misread.index]}</em>.</p>
              <SignCompare chosen={opt.misread.as} right={item.signs[opt.misread.index]} lead="" />
            </>
          ) : (
            <p className="text-primary mb-3">
              {opt.rule === 'silent' && <>Every sign ends in a vowel, but the last one is not spoken: {values.slice(0, -1).join('-')}-{values[values.length - 1].slice(0, -1)}<span className="line-through text-muted">{values[values.length - 1].slice(-1)}</span>, <em>{word}</em>.</>}
              {opt.rule === 'dropped' && <>The last sign counts: only its vowel is silent, its consonant is spoken. {spellingLabel(values)} is <em>{word}</em>.</>}
              {opt.rule === 'order' && <>Signs are read left to right: {spellingLabel(values)}, <em>{word}</em>.</>}
            </p>
          )}
          <p className="text-primary mt-3">It reads <em>{word}</em>. Pío Pérez: <a href={entry.href} className="underline underline-offset-2">&ldquo;{entry.text}&rdquo; (p. {entry.page})</a></p>
        </div>
      );
    }
    case 'spell': {
      const chosen = answered.value as SyllableKey[];
      const right = item.answer;
      const entry = ENTRIES[item.entry];
      let text: string;
      if (chosen.length < right.length) text = `${spellingLabel(chosen)} reads ${readSpelling(chosen)}: a sign alone is read whole. The final k needs a sign of its own, whose vowel is silent.`;
      else if (spellingLabel([...chosen].reverse()) === spellingLabel(right)) text = `Signs are read left to right, so ${spellingLabel(chosen)} would be ${readSpelling(chosen)}.`;
      else text = `${spellingLabel(chosen)} also reads ${readSpelling(chosen)}, but the silent last sign usually repeats the vowel before it: ${spellingLabel(right)}.`;
      return (
        <div className={box}>
          {head}
          <p className="text-primary mb-3">{text}</p>
          <Signs signs={right} />
          <p className="text-primary mt-3">{spellingLabel(right)}, <em>{readSpelling(right)}</em>. Pío Pérez spells it <a href={entry.href} className="underline underline-offset-2"><em>{entry.word}</em>: &ldquo;{entry.text}&rdquo; (p. {entry.page})</a></p>
        </div>
      );
    }
    case 'tap': {
      const chosen = item.zones[answered.value as number];
      const right = item.zones[item.answer];
      return (
        <div className={box}>
          {head}
          <p className="text-primary mb-3">
            You tapped the sign Landa labelled <em>{chosen.label}</em>. <em>{right.label}</em> carries the comb you know from Landa&rsquo;s sign 11 and from Stuart&rsquo;s drawing; here it runs along the top of a round sign.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div><FigView fig={{ src: crops['landa-ca'].url, alt: 'Landa sign 11', credit: crops['landa-ca'].label, href: crops['landa-ca'].page_url }} small /><p className="text-sm font-medium text-primary mt-1">Landa&rsquo;s &ldquo;ca&rdquo;</p></div>
            <div><FigView fig={{ src: SYLLABLES.ka.src, alt: 'ka', credit: STUART_CREDIT, href: STUART_SOURCE }} small drawing /><p className="text-sm font-medium text-primary mt-1">ka, in Stuart&rsquo;s drawing</p></div>
          </div>
          <div className="mt-3"><FigView fig={item.after} /></div>
        </div>
      );
    }
  }
}

const ORD = ['first', 'second', 'third', 'fourth'];

function SignCompare({ chosen, right, lead = 'You chose' }: { chosen: SyllableKey; right: SyllableKey; lead?: string }) {
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

// ── Pieces ──

function FigView({ fig, small, big, drawing }: { fig: Fig; small?: boolean; big?: boolean; drawing?: boolean }) {
  return (
    <figure>
      <div className={`rounded-lg flex items-center justify-center ${drawing ? 'bg-white' : 'bg-[#efe6d6]'} ${big ? 'min-h-[30vh]' : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fig.src} alt={fig.alt} className={`${small ? 'max-h-32' : big ? 'max-h-[40vh]' : 'max-h-[60vh]'} w-full object-contain rounded-lg`} />
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
      <div><div className="rounded-lg border-2 border-[#1a1612] p-1">{left}</div><p className="text-sm font-medium text-primary mt-1">{leftLabel}</p></div>
      <div><div className="rounded-lg border-2 border-accent-rust p-1">{right}</div><p className="text-sm font-medium text-accent-rust mt-1">{rightLabel}</p></div>
    </div>
  );
}

function SignImg({ k }: { k: SyllableKey }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={SYLLABLES[k].src} alt={SYLLABLES[k].value} className="h-24 w-auto mx-auto bg-white" />;
}

function Signs({ signs, highlight = null }: { signs: SyllableKey[]; highlight?: number | null }) {
  return (
    <div>
      <div className="flex justify-center gap-2 rounded-lg bg-white border border-border-light p-3">
        {signs.map((k, i) => (
          <div key={i} className={`rounded p-1 ${highlight === i ? 'ring-2 ring-accent-rust' : ''}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SYLLABLES[k].src} alt={`sign ${i + 1}`} className="h-20 w-auto" />
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
    <div className="rounded-lg bg-[#efe6d6] p-4 space-y-3">
      {digits.map((d, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-black/10 last:border-0 pb-3 last:pb-0">
          {showPlaces && <span className="w-20 text-sm text-secondary text-right">{PLACE_NAME[places[i]] ?? places[i]}</span>}
          <div className="w-16 flex justify-center"><Numeral value={d} size={48} /></div>
        </div>
      ))}
    </div>
  );
}

function PlaceTable({ digits, places }: { digits: number[]; places: number[] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {digits.map((d, i) => (
          <tr key={i} className="border-b border-border-light">
            <td className="py-1 w-14"><Numeral value={d} size={32} /></td>
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
    <span className="inline-flex items-center gap-1 rounded-lg bg-[#efe6d6] px-2 py-1">
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
