'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import s from './FolioPipeline.module.css';

/*
 * "One page through the pipeline" (#5846): one real Derge Tengyur side followed through the
 * six stage names Eternity uses, then pulled back to the whole canon. Built for a screen share
 * that Derek narrates (60–90 s), and to read alone on a laptop or a phone.
 *
 * Plays once when scrolled into view; each stage name is a button, so the narrator can stop and
 * jump. Reduced motion, "Show all stages" and no-JS all give the still version: every panel
 * stacked in its final state. No data is fetched: the page passes the folio snapshot
 * (canon-gap-folio.mjs) and the status counts (canon-gap-status.mjs) in at build time.
 */

export type FolioSnapshot = {
  book_title: string;
  book_public: boolean;
  volume: number;
  section: string;
  folio: string;
  image: { url: string; bdrc: string; width: number; height: number; line_bands: number[][] };
  typed: { name: string; repo: string; commit: string; licence: string; lines: string[]; karma_formula: string[] };
  alignment: { read_engine: string; samples: number; min_identity: number; max_control: number };
  draft: { model: string; drafted_at: string; text: string };
  repairs: { source: string; issue: number; reason: string; at: string }[];
  /** [text, pass that added it (null = first draft), pass that removed it (null = still there)] */
  tracked: [string, number | null, number | null][];
  published_text: string;
};

export type TengyurCounts = {
  perVolume: [number, number, number][];
  pagesWithText: number;
  pagesTranslated: number;
  usdPerPage: number;
  countedAt: string;
};

/** One automated check: what it measures across the run, and its write-up. */
export type CritiqueGate = { name: string; result: ReactNode; basis: string; source: string; onThisPage: ReactNode };

const STAGES = ['Pre-processing', 'Semantic Alignment', 'Draft Translation', 'Automated Critique', 'Human Review', 'Publication'] as const;
// Seconds each beat stays up while playing; the last is the pull-back to the whole canon.
const DURATION = [8, 12, 12, 21, 9, 9, 11];
// The excerpt follows the reply to the materialists, carved on lines 4–7 of the side.
const PASSAGE_LINES = [3, 4, 5, 6];

const ENGLISH = '#0b9488';
const fmt = (n: number) => n.toLocaleString('en-US');
const d = (sec: number) => ({ '--d': `${sec}s` }) as CSSProperties;
// UTC, so the server render and the browser agree on the day.
const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
// Esukhia's "#" marks a point where the Peydurma notes a variant; it is markup, not text.
const tib = (line: string) => line.replace(/#/g, '');

function Strip({ f, focus, sweep, crop, stagger }: { f: FolioSnapshot; focus?: number[]; sweep?: boolean; crop?: [number, number]; stagger?: number }) {
  const { width: W, height: H, line_bands: bands } = f.image;
  const [y0, y1] = crop ?? [0, H];
  const h = y1 - y0;
  return (
    <div className="relative overflow-hidden rounded-sm border border-stone-300 bg-stone-100" style={{ aspectRatio: `${W} / ${h}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed 2001-px strip; next/image would only resize it */}
      <img
        src={f.image.url}
        alt={`Woodblock print, Derge Tengyur vol. ${f.volume}, folio ${f.folio}`}
        className="absolute left-0 w-full max-w-none"
        style={{ top: `${(-y0 / h) * 100}%`, height: `${(H / h) * 100}%` }}
        loading="lazy"
      />
      {focus &&
        bands.map(([a, b], i) =>
          a >= y0 && b <= y1 ? (
            <div
              key={i}
              className={`${s.band} ${s.fade}`}
              data-focus={focus.includes(i)}
              style={{ top: `${((a - y0) / h) * 100}%`, height: `${((b - a) / h) * 100}%`, ...d(stagger != null ? 0.5 + i * stagger : 0.3) }}
            />
          ) : null,
        )}
      {sweep && <div className={s.sweep} />}
    </div>
  );
}

function Panel({ i, on, title, lede, aside, children }: { i: number; on: boolean; title: string; lede: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <section className={s.panel} data-on={on} aria-label={i < 6 ? `Stage ${i + 1}: ${STAGES[i]}` : 'All pages'}>
      <div className="font-body text-[11px] uppercase tracking-[0.16em] text-amber-700 font-semibold">
        {i < 6 ? `Stage ${i + 1} of 6 · ${STAGES[i]}` : 'Pull back'}
      </div>
      <div className="font-serif text-xl md:text-2xl text-stone-900 mt-1 mb-3 tracking-tight">{title}</div>
      <div className="font-body text-[15px] leading-relaxed text-stone-700 max-w-3xl mb-5">{lede}</div>
      {children}
      {aside && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-5 font-body text-sm text-stone-600 leading-snug">{aside}</div>}
    </section>
  );
}

function Fact({ k, children, delay }: { k: string; children: ReactNode; delay?: number }) {
  return (
    <div className={`${s.rise} border-l-2 border-amber-600 pl-3`} style={d(delay ?? 0)}>
      <div className="text-[11px] uppercase tracking-wider text-stone-400">{k}</div>
      <div className="text-stone-800">{children}</div>
    </div>
  );
}

function Src({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-amber-800 underline decoration-amber-800/30 underline-offset-2 hover:decoration-amber-800">
      {children}
    </a>
  );
}

/** English with each repair pass marked: struck where removed, tinted where added. */
function Tracked({ f, delays }: { f: FolioSnapshot; delays: number[] }) {
  let n = 0;
  return (
    <>
      {f.tracked.map(([t, born, died], i) => {
        if (born == null && died == null) return <span key={i}>{t}</span>;
        const pass = (died ?? born) as number;
        const cls = died != null ? s.del : s.ins;
        return (
          <span key={i} className={cls} style={d(delays[pass] + 0.35 * n++)} title={f.repairs[pass]?.reason}>
            {t}
          </span>
        );
      })}
    </>
  );
}

function Paragraphs({ text, words }: { text: string; words?: boolean }) {
  let w = 0;
  return (
    <>
      {text.split(/\n\n+/).map((p, i) => (
        <p key={i} className="mb-3 last:mb-0">
          {words
            ? p.split(/(?<=\s)/).map((word, j) => (
                <span key={j} className={s.fade} style={d(0.6 + 0.045 * w++)}>
                  {word}
                </span>
              ))
            : p}
        </p>
      ))}
    </>
  );
}

function TrackedParagraphs({ f, delays }: { f: FolioSnapshot; delays: number[] }) {
  // Paragraph breaks are never inside a changed run, so split the same-runs only.
  const paras: [string, number | null, number | null][][] = [[]];
  for (const seg of f.tracked) {
    const [t, born, died] = seg;
    if (born != null || died != null || !t.includes('\n\n')) {
      paras[paras.length - 1].push(seg);
      continue;
    }
    t.split(/\n\n+/).forEach((piece, k) => {
      if (k > 0) paras.push([]);
      if (piece) paras[paras.length - 1].push([piece, null, null]);
    });
  }
  let offset = 0;
  return (
    <>
      {paras.map((p, i) => {
        const sub = { ...f, tracked: p };
        const changed = p.filter(([, b, dd]) => b != null || dd != null).length;
        const node = (
          <p key={i} className="mb-3 last:mb-0">
            <Tracked f={sub} delays={delays.map((x) => x + 0.35 * offset)} />
          </p>
        );
        offset += changed;
        return node;
      })}
    </>
  );
}

export default function FolioPipeline({
  folio: f,
  tengyur: tg,
  gates,
  draftLabel,
}: {
  folio: FolioSnapshot;
  tengyur: TengyurCounts;
  gates: [CritiqueGate, CritiqueGate, CritiqueGate];
  draftLabel: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState(0);
  const [mode, setMode] = useState<'play' | 'all'>('play');
  // playing = advance on its own; held = the viewer pressed Pause, so the active stage freezes too.
  const [playing, setPlaying] = useState(false);
  const [held, setHeld] = useState(false);
  const [inView, setInView] = useState(false);
  const started = useRef(false);

  // Start once, the first time the figure reaches the middle of the screen; pause while it is away.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setInView(e.isIntersecting);
        if (e.isIntersecting && !started.current) {
          started.current = true;
          setPlaying(true);
        }
      },
      // "In view" = crossing the middle third of the screen. A ratio threshold would never fire on a
      // phone, where the figure is taller than the screen.
      { rootMargin: '-33% 0px -33% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !inView || mode !== 'play') return;
    const t = setTimeout(() => {
      if (beat < DURATION.length - 1) setBeat(beat + 1);
      else setPlaying(false);
    }, DURATION[beat] * 1000);
    return () => clearTimeout(t);
  }, [beat, playing, inView, mode]);

  const go = useCallback((i: number) => {
    setMode('play');
    setBeat(Math.max(0, Math.min(DURATION.length - 1, i)));
    setPlaying(false);
    setHeld(false);
    started.current = true;
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(beat + 1);
    else if (e.key === 'ArrowLeft') go(beat - 1);
  };

  const ended = !playing && beat === DURATION.length - 1;
  const crop: [number, number] = [f.image.line_bands[PASSAGE_LINES[0]][0] - 8, f.image.line_bands[PASSAGE_LINES[PASSAGE_LINES.length - 1]][1] + 6];
  const reviewNote = f.repairs.find((r) => r.issue === 5800);
  // The four items as the corrected English words them; shown only if the English still says so.
  const FORMULA_EN = ['are the owners of their karma', 'are born from their karma', 'follow their karma', 'have karma as their portion'];
  const formulaEnglish = FORMULA_EN.every((p) => f.published_text.includes(p)) && f.typed.karma_formula.length === FORMULA_EN.length ? FORMULA_EN : null;
  const centsPerPage = (tg.usdPerPage * 100).toFixed(2);
  const vol = tg.perVolume.find((v) => v[0] === f.volume);
  const stateOf = ([, text, tr]: [number, number, number]) => (text && tr >= 0.95 * text ? 'done' : tr > 0 ? 'partly' : 'none');
  const COLOR = { done: ENGLISH, partly: `${ENGLISH}66`, none: '#d6d3d1' } as const;

  return (
    <div
      ref={root}
      className={`${s.root} rounded-sm border border-stone-200 bg-white overflow-hidden`}
      data-mode={mode}
      data-playing={playing && inView}
      data-paused={mode === 'play' && (held || !inView)}
      onKeyDown={onKey}
    >
      {/* Stage rail: the six names, in Eternity's words, plus the pull-back. */}
      <div className="bg-stone-900 text-stone-300 px-3 md:px-5 pt-4 pb-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="font-body text-[11px] uppercase tracking-[0.16em] text-stone-400">
            One page, start to finish · Derge Tengyur vol. {f.volume} ({f.section}), folio {f.folio}
          </div>
          <div className={`${s.controls} flex gap-2 font-body text-xs`}>
            {mode === 'play' && (
              <button
                type="button"
                onClick={() => {
                  if (ended) setBeat(0);
                  const next = ended ? true : !playing;
                  setPlaying(next);
                  setHeld(!next);
                  started.current = true;
                }}
                className="px-2.5 py-1 rounded-sm border border-stone-600 hover:border-amber-500 hover:text-white"
              >
                {ended ? 'Replay' : playing ? 'Pause' : 'Play'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'play' ? 'all' : 'play');
                setPlaying(false);
                setHeld(false);
              }}
              className="px-2.5 py-1 rounded-sm border border-stone-600 hover:border-amber-500 hover:text-white"
            >
              {mode === 'play' ? 'Show all stages' : 'Step through'}
            </button>
          </div>
        </div>
        <ol className={`${s.controls} grid grid-cols-7 gap-1 mt-3`} aria-label="Stages">
          {[...STAGES, 'All pages'].map((name, i) => {
            const state = mode === 'all' ? 'done' : i === beat ? 'on' : i < beat ? 'done' : 'next';
            return (
              <li key={name} className="min-w-0">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={state === 'on' ? 'step' : undefined}
                  className={`w-full text-left rounded-sm px-1.5 md:px-2 py-1.5 font-body leading-tight transition-colors ${
                    state === 'on' ? 'bg-amber-700 text-white' : state === 'done' ? 'bg-stone-800 text-stone-200 hover:bg-stone-700' : 'text-stone-500 hover:text-stone-200 hover:bg-stone-800'
                  }`}
                >
                  <span className="block text-[10px] tabular-nums opacity-80">{i < 6 ? i + 1 : '→'}</span>
                  <span className="block text-[12px] lg:text-[13px] max-sm:hidden">{name}</span>
                </button>
                <div className="h-[2px] mt-1 bg-stone-800 overflow-hidden">
                  {state === 'on' && (
                    <div className={`h-full bg-amber-500 ${s.progress}`} style={{ '--dur': `${DURATION[i]}s`, ...(playing ? {} : { transform: 'scaleX(0)' }) } as CSSProperties} />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <div className={`${s.controls} sm:hidden font-body text-sm text-white mt-2`} aria-hidden>
          {beat < 6 ? `${beat + 1}. ${STAGES[beat]}` : 'All pages'}
        </div>
      </div>

      <div className="px-4 py-6 md:px-8 md:py-8 overflow-x-clip">
        <div className={s.stack} data-fp-stack="">
          {/* 1 · Pre-processing */}
          <Panel
            i={0}
            on={beat === 0}
            title="The page image"
            lede={
              <p>
                One side of a printed leaf from the Derge woodblocks, {f.typed.lines.length} carved lines, as the{' '}
                <Src href="https://library.bdrc.io/show/bdr:W23703">Buddhist Digital Resource Center</Src> scanned it. This side
                needs no OCR: <Src href={f.typed.repo}>Esukhia</Src> has already typed the whole Derge Tengyur and released it into the
                public domain.
              </p>
            }
            aside={
              <>
                <Fact k="Scan" delay={1}>
                  BDRC, public domain · {fmt(f.image.width)} × {fmt(f.image.height)} px
                </Fact>
                <Fact k="Text" delay={2.5}>
                  typed by Esukhia, not read by a model
                </Fact>
              </>
            }
          >
            <Strip f={f} sweep />
          </Panel>

          {/* 2 · Semantic Alignment */}
          <Panel
            i={1}
            on={beat === 1}
            title="The typed text, matched to the image"
            lede={
              <p>
                Esukhia&rsquo;s folio {f.folio} is laid against the scan line by line, so every sentence can be checked against
                the woodblock. The match is tested, not assumed: an OCR engine read sample sides of this volume, and each read
                had to match its own typed folio far better than any other.
              </p>
            }
            aside={
              <>
                <Fact k="Check on this volume" delay={1}>
                  {f.alignment.samples} sides read · each at least {Math.round(f.alignment.min_identity * 100)}% like its own folio, at
                  most {Math.round(f.alignment.max_control * 100)}% like folios two or more sides away
                </Fact>
                <Fact k="Typed edition" delay={2.5}>
                  <Src href={`${f.typed.repo}/tree/${f.typed.commit}`}>Esukhia, commit {f.typed.commit.slice(0, 7)}</Src>
                </Fact>
              </>
            }
          >
            <Strip f={f} focus={[0, 1, 2, 3, 4, 5, 6]} stagger={1.2} />
            <ol className={`${s.tibetan} mt-3 text-[15px] md:text-base text-stone-800 space-y-0.5`} lang="bo">
              {f.typed.lines.map((line, i) => (
                <li key={i} className={`${s.fade} flex gap-3`} style={d(0.5 + i * 1.2)}>
                  <span className="font-body text-[11px] text-amber-700 tabular-nums pt-1.5 w-3 shrink-0">{i + 1}</span>
                  <span className="min-w-0 break-words">{tib(line)}</span>
                </li>
              ))}
            </ol>
          </Panel>

          {/* 3 · Draft Translation */}
          <Panel
            i={2}
            on={beat === 2}
            title="A first English draft"
            lede={
              <p>
                A model drafts English for the side on its own, one page per request. Shown here: lines {PASSAGE_LINES[0] + 1}–
                {PASSAGE_LINES[PASSAGE_LINES.length - 1] + 1}, where the author sets out the materialists&rsquo; case against
                rebirth and begins his reply. This is the draft as written, before any check.
              </p>
            }
            aside={
              <>
                <Fact k="Model" delay={0.5}>
                  Gemini 3 Flash{f.draft.model.endsWith('-preview') ? ' (preview)' : ''}, drafted {date(f.draft.drafted_at)}
                </Fact>
                <Fact k="Cost" delay={1.5}>
                  ${tg.usdPerPage.toFixed(4)} a page ({centsPerPage}¢), averaged over the Tengyur run
                </Fact>
              </>
            }
          >
            <Strip f={f} focus={PASSAGE_LINES} crop={crop} />
            <div className="mt-4 rounded-sm bg-stone-50 border border-stone-200 px-4 py-3 font-serif text-[15px] md:text-base leading-relaxed text-stone-800">
              <Paragraphs text={f.draft.text} words />
            </div>
          </Panel>

          {/* 4 · Automated Critique */}
          <Panel
            i={3}
            on={beat === 3}
            title="Machine checks, then repairs"
            lede={
              <p>
                Three checks run over the draft. The rates are measured across the Tengyur run; the marks in the text are what
                changed on this page. <span className="text-stone-500">Every check here is made by a model, not by a person.</span>
              </p>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_20rem] gap-5">
              <div className="rounded-sm bg-stone-50 border border-stone-200 px-4 py-3 font-serif text-[15px] md:text-base leading-relaxed text-stone-800 self-start">
                <TrackedParagraphs f={f} delays={[6.5, 12]} />
                {formulaEnglish && <div className={`${s.rise} mt-4 pt-3 border-t border-stone-200 font-body text-sm`} style={d(15.5)}>
                  <div className="text-[11px] uppercase tracking-wider text-stone-400 mb-1">The woodblock lists four, not five</div>
                  <ol className="space-y-0.5">
                    {f.typed.karma_formula.map((t, i) => (
                      <li key={i} className="flex gap-2 items-baseline">
                        <span className={`${s.tibetan} text-stone-900`} lang="bo">
                          {t}
                        </span>
                        <span className="text-stone-500">{formulaEnglish[i]}</span>
                      </li>
                    ))}
                  </ol>
                </div>}
              </div>
              <ol className="space-y-3 font-body text-sm">
                {gates.map((g, i) => (
                  <li key={g.name} className={`${s.gate} rounded-sm border border-stone-300 px-3 py-2.5`} style={d([0.4, 5.5, 11][i])}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] tabular-nums text-amber-700 font-semibold">{i + 1}</span>
                      <span className="font-semibold text-stone-900">{g.name}</span>
                    </div>
                    <div className="text-stone-800 mt-1">{g.result}</div>
                    <div className="text-[12px] text-stone-500 mt-1 leading-snug">
                      {g.basis}. <Src href={g.source}>Source</Src>
                    </div>
                    <div className="text-[12px] text-stone-700 mt-1.5 pt-1.5 border-t border-stone-200 leading-snug">
                      <span className="font-semibold">This page:</span> {g.onThisPage}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            {reviewNote && <p className="sr-only">{reviewNote.reason}</p>}
          </Panel>

          {/* 5 · Human Review */}
          <Panel
            i={4}
            on={beat === 4}
            title="Awaiting a scholar"
            lede={
              <p>
                No page of the Tengyur draft has yet been read by a scholar. The machine checks above measure how often the draft
                goes wrong; only a reader who knows the text can say where, on a given page, and fix it. We have asked a
                Tibetologist to read the first 15 pages (<Src href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5800">#5800</Src>).
                Drafting this page cost {centsPerPage}¢; reviewing it is the step that needs support.
              </p>
            }
            aside={
              <>
                <Fact k="Read by a scholar" delay={1}>
                  <span className="font-serif text-3xl text-stone-900 tabular-nums">0</span>{' '}
                  <span className="text-stone-500">of {fmt(tg.pagesWithText)} pages</span>
                </Fact>
              </>
            }
          >
            <div className="flex items-center justify-center py-4">
              <svg viewBox="0 0 120 130" className="w-28 h-32 md:w-36 md:h-40" role="img" aria-label="An empty chair">
                {/* A chair seen from three-quarters: back, seat, four legs. */}
                <g fill="none" stroke="#a8a29e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={s.chair}>
                  <path d="M34 8 H82 V64 M34 8 V64 M34 26 H82 M34 44 H82" />
                  <path d="M34 64 L22 80 H74 L82 64 Z" />
                  <path d="M22 80 V124 M74 80 V124 M34 64 V112 M82 64 V112" />
                </g>
              </svg>
            </div>
          </Panel>

          {/* 6 · Publication */}
          <Panel
            i={5}
            on={beat === 5}
            title="The page as a reader will see it"
            lede={
              <p>
                Woodblock, Tibetan and English side by side, with the label on every page of machine English.{' '}
                {f.book_public
                  ? 'This volume is public.'
                  : 'The Tengyur volumes stay out of public view until their English has been checked, so this is the reader as it will appear.'}
              </p>
            }
          >
            <div className="rounded-sm border border-stone-300 overflow-hidden">
              <div className="bg-stone-100 border-b border-stone-300 px-3 py-1.5 font-body text-xs text-stone-500 truncate">{f.book_title}</div>
              <div className="p-3 md:p-4">
                <Strip f={f} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className={`${s.tibetan} ${s.fade} text-[15px] text-stone-800`} lang="bo" style={d(0.6)}>
                    {PASSAGE_LINES.map((k) => (
                      <span key={k}>{tib(f.typed.lines[k])} </span>
                    ))}
                  </div>
                  <div className={`${s.fade}`} style={d(1.2)}>
                    <p className="font-sans text-[11.5px] leading-snug mb-3" style={{ color: 'var(--accent-gold-dark, #8a6a1d)' }}>
                      {draftLabel}
                    </p>
                    <div className="font-serif text-[15px] leading-relaxed text-stone-800">
                      <Paragraphs text={f.published_text} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {/* 7 · Pull back */}
          <Panel
            i={6}
            on={beat === 6}
            title={`One of ${fmt(tg.pagesWithText)} pages`}
            lede={
              <p>
                Each square is one of the {tg.perVolume.length} volumes; this page is in volume {f.volume}. Volumes as counted on{' '}
                {date(tg.countedAt)}.
              </p>
            }
            aside={
              <>
                <Fact k="Pages with typed text" delay={3}>
                  {fmt(tg.pagesWithText)}
                </Fact>
                <Fact k="With a draft English" delay={3.8}>
                  {fmt(tg.pagesTranslated)}
                </Fact>
                <Fact k="Read by a scholar" delay={4.6}>
                  0
                </Fact>
              </>
            }
          >
            <div className="grid grid-cols-[repeat(auto-fill,minmax(14px,1fr))] gap-[3px] max-w-xl mx-auto py-2" role="img" aria-label={`${tg.perVolume.length} volumes; volume ${f.volume} holds this page`}>
              {tg.perVolume.map((v) => {
                const here = v[0] === f.volume;
                return (
                  <div
                    key={v[0]}
                    className={`relative aspect-square rounded-[2px] ${here ? 'ring-2 ring-amber-600 ring-offset-1 z-10' : ''}`}
                    style={{ backgroundColor: COLOR[stateOf(v)] }}
                    title={`vol. ${v[0]}`}
                  >
                    {here && (
                      <div
                        className={s.shrinker}
                        style={{
                          backgroundImage: `url(${f.image.url})`,
                          width: `${(f.image.width / f.image.height) * 100}%`,
                          left: `${-((f.image.width / f.image.height - 1) / 2) * 100}%`,
                          '--from': 6,
                        } as CSSProperties}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="font-body text-xs text-stone-600 mt-2 text-center">
              <span className="inline-flex items-center gap-1.5 mr-4">
                <span className="inline-block w-3 h-3 rounded-[2px]" style={{ backgroundColor: COLOR.done }} /> drafted in English
              </span>
              <span className="inline-flex items-center gap-1.5 mr-4">
                <span className="inline-block w-3 h-3 rounded-[2px]" style={{ backgroundColor: COLOR.partly }} /> partly
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-[2px]" style={{ backgroundColor: COLOR.none }} /> not yet
              </span>
              {vol && stateOf(vol) === 'none' && f.draft.drafted_at > tg.countedAt && (
                <span className="block mt-1 text-stone-500">This page was drafted after that count.</span>
              )}
            </div>
          </Panel>
        </div>
      </div>
      <noscript>
        <style>{`[data-fp-stack]>section{display:block!important;margin-top:2rem}`}</style>
      </noscript>
    </div>
  );
}
