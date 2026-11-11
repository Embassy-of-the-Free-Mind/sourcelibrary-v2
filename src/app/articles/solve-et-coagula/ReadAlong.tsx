'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';

// The read-along for the Solve et Coagula episode: the video, its chapters and a transcript in which
// every word is timed. Click a word to seek; the word being spoken is highlighted; "Following" keeps it
// in view and switches off the moment the reader scrolls on their own. Numbered markers after a word
// point to reference cards (right margin on wide screens, after the paragraph on narrow ones).
//
// The player is the episode's own YouTube video (plays count for the podcast). The transcript is timed to
// the same cut as our copy of the video (both 5543.25 s), so if YouTube has not loaded within 10 s the
// page switches to that copy and nothing else changes.
//
// Data: public/articles/solve-et-coagula/transcript.<lang>.json, built from the standalone read-along
// (sourcelib-solve-et-coagula.vercel.app) with word end times dropped and library links made relative.

const YT_ID = 'MBSFA2FmOj0';
const FALLBACK_MP4 = 'https://images.sourcelibrary.org/podcasts/external/solve-et-coagula-2026-11/episode-720p.mp4';
const YT_TIMEOUT_MS = 10_000;
// A frame from the episode (Derek's screen share, both speakers in view).
const POSTER = '/articles/solve-et-coagula/poster.jpg';

type Lang = 'en' | 'es';

// Screen grabs from Derek's tour of the site, cut from the episode video (browser bar cropped off). Each sits
// before the first paragraph that starts at or after its time; clicking it plays from that moment.
interface Figure { s: number; src: string; alt: Record<Lang, string>; caption: Record<Lang, string> }
const FIGURES: Figure[] = [
  { s: 1850, src: '/articles/solve-et-coagula/screen-1850.jpg',
    alt: { en: 'The Source Library catalogue: a search box and a grid of book covers, sorted by most read.', es: 'El catálogo de Source Library: un buscador y una cuadrícula de portadas, ordenadas por las más leídas.' },
    caption: { en: 'The catalogue, every book in the library.', es: 'El catálogo, todos los libros de la biblioteca.' } },
  { s: 2050, src: '/articles/solve-et-coagula/screen-2050.jpg',
    alt: { en: 'Ask the Librarian: an answer about planetary seals and magic squares, with a picture from the books and links to them.', es: 'Pregunta al bibliotecario: una respuesta sobre sellos planetarios y cuadrados mágicos, con una imagen de los libros y enlaces a ellos.' },
    caption: { en: 'Ask the Librarian: an answer drawn from the books, with links to the pages.', es: 'Pregunta al bibliotecario: una respuesta sacada de los libros, con enlaces a las páginas.' } },
  { s: 2330, src: '/articles/solve-et-coagula/screen-2330.jpg',
    alt: { en: 'An emblem of Atalanta fugiens in the reader: the scan on the left, the English translation and notes on the right.', es: 'Un emblema de Atalanta fugiens en el lector: el escaneo a la izquierda, la traducción inglesa y las notas a la derecha.' },
    caption: { en: 'Reading Atalanta fugiens: the scan beside its English translation.', es: 'Leyendo Atalanta fugiens: el escaneo junto a su traducción al inglés.' } },
  { s: 2500, src: '/articles/solve-et-coagula/screen-2500.jpg',
    alt: { en: 'The collection page for Hermeticism, Rosicrucians and fraternal orders, with pictures for each sub-collection.', es: 'La página de la colección de hermetismo, rosacruces y órdenes fraternales, con una imagen para cada subcolección.' },
    caption: { en: 'A collection: secret societies and fraternal orders.', es: 'Una colección: sociedades secretas y órdenes fraternales.' } },
  { s: 2950, src: '/articles/solve-et-coagula/screen-2950.jpg',
    alt: { en: 'The article on Hyperborea, with its contents list in the margin.', es: 'El artículo sobre Hiperbórea, con su índice en el margen.' },
    caption: { en: 'An article: Hyperborea.', es: 'Un artículo: Hiperbórea.' } },
  { s: 3350, src: '/articles/solve-et-coagula/screen-3350.jpg',
    alt: { en: 'A world map of the library: 72,309 books across 2,728 cities, marked by where they were published and where their authors were born and died.', es: 'Un mapa del mundo de la biblioteca: 72.309 libros en 2.728 ciudades, según dónde se publicaron y dónde nacieron y murieron sus autores.' },
    caption: { en: 'The library on a map: where the books were published, and where their authors were born and died.', es: 'La biblioteca en un mapa: dónde se publicaron los libros y dónde nacieron y murieron sus autores.' } },
  { s: 3600, src: '/articles/solve-et-coagula/screen-3600.jpg',
    alt: { en: 'The page for The Splendour of the Sun (Splendor Solis), found by browsing pictures.', es: 'La página de El esplendor del sol (Splendor Solis), encontrada al explorar imágenes.' },
    caption: { en: 'Browsing by pictures: Splendor Solis.', es: 'Explorar por imágenes: Splendor Solis.' } },
  { s: 3820, src: '/articles/solve-et-coagula/screen-3820.jpg',
    alt: { en: 'Claude’s connector settings, with Source Library being added as a connector.', es: 'La configuración de conectores de Claude, al añadir Source Library como conector.' },
    caption: { en: 'Connecting Source Library to Claude.', es: 'Conectar Source Library con Claude.' } },
];

interface Ref {
  n: number;
  w: number;
  kind: 'lib' | 'article' | 'web';
  title: string;
  detail: string;
  url: string;
}
interface Para {
  w: [string, number][];
  note?: string;
  refs?: Ref[];
}
interface Turn {
  n: string;
  s: number;
  p: Para[];
}
interface Transcript {
  chapters: [number, string][];
  turns: Turn[];
}

const UI = {
  en: {
    follow: 'Following',
    followOff: 'Follow the video',
    followTitle: 'Scroll the transcript with the video',
    top: '↑ Back to the video',
    chapters: 'Chapters',
    loading: 'Loading the transcript…',
    failed: 'The transcript could not be loaded. Reload the page to try again.',
    kind: { lib: 'In Source Library', article: 'Source Library article', web: 'Elsewhere' },
    ref: 'Reference',
    jump: 'Play from',
  },
  es: {
    follow: 'Siguiendo',
    followOff: 'Seguir el vídeo',
    followTitle: 'Desplazar la transcripción con el vídeo',
    top: '↑ Volver al vídeo',
    chapters: 'Capítulos',
    loading: 'Cargando la transcripción…',
    failed: 'No se pudo cargar la transcripción. Recarga la página para intentarlo de nuevo.',
    kind: { lib: 'En Source Library', article: 'Artículo de Source Library', web: 'Fuera de Source Library' },
    ref: 'Referencia',
    jump: 'Reproducir desde',
  },
} as const;

export function fmtTime(t: number): string {
  t = Math.floor(t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + ':' + String(s).padStart(2, '0');
}

// ---- The player: YouTube, or our MP4 if YouTube is not ready in time ----

interface YTPlayer {
  getCurrentTime(): number;
  seekTo(t: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: unknown) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface Player {
  time(): number;
  seek(t: number, play?: boolean): void;
  paused(): boolean;
}

function usePlayer(ytBox: React.RefObject<HTMLDivElement | null>, videoEl: React.RefObject<HTMLVideoElement | null>) {
  const [mode, setMode] = useState<'youtube' | 'fallback'>('youtube');
  const [playing, setPlaying] = useState(false);
  const player = useRef<Player>({ time: () => 0, seek: () => {}, paused: () => true });

  useEffect(() => {
    let yt: YTPlayer | null = null;
    let ready = false;
    let usingFallback = false;
    let disposed = false;
    // ?t=SECONDS starts the episode there.
    const startAt = parseFloat(new URLSearchParams(window.location.search).get('t') || '');
    let pendingSeek: number | null = startAt > 0 ? startAt : null;
    let wantPlay = false;
    let isPaused = true;

    const media = () => (usingFallback ? videoEl.current : null);
    player.current = {
      time() {
        const m = media();
        if (m) return m.currentTime;
        if (ready && yt) return yt.getCurrentTime();
        return pendingSeek ?? 0;
      },
      seek(t, play = true) {
        const m = media();
        if (m) {
          if (m.readyState >= 1) m.currentTime = t;
          else {
            pendingSeek = t;
            m.preload = 'metadata';
          }
          if (play) void m.play().catch(() => {});
          return;
        }
        if (ready && yt) {
          yt.seekTo(t, true);
          if (play) yt.playVideo();
        } else {
          pendingSeek = t;
          if (play) wantPlay = true;
        }
      },
      paused() {
        const m = media();
        return m ? m.paused : isPaused;
      },
    };

    const init = () => {
      if (disposed || usingFallback || !ytBox.current || !window.YT?.Player) return;
      const YT = window.YT;
      // A fresh host each time: the API replaces it with its iframe.
      const host = document.createElement('div');
      ytBox.current.replaceChildren(host);
      yt = new YT.Player(host, {
        videoId: YT_ID,
        playerVars: { playsinline: 1, rel: 0, ...(pendingSeek ? { start: Math.floor(pendingSeek) } : {}) },
        events: {
          onReady() {
            if (disposed || usingFallback) return;
            ready = true;
            window.clearTimeout(timer);
            if (pendingSeek != null) yt?.seekTo(pendingSeek, true);
            if (wantPlay) yt?.playVideo();
          },
          onStateChange(e: { data: number }) {
            if (e.data === YT.PlayerState.PLAYING) isPaused = false;
            else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) isPaused = true;
            setPlaying(!isPaused);
          },
        },
      });
    };

    const timer = window.setTimeout(() => {
      if (ready || disposed) return;
      usingFallback = true;
      setMode('fallback');
      try {
        yt?.destroy();
      } catch {}
      yt = null;
      ytBox.current?.replaceChildren();
      const m = videoEl.current;
      if (!m) return;
      m.preload = 'metadata';
      const sync = () => setPlaying(!m.paused);
      m.addEventListener('play', sync);
      m.addEventListener('pause', sync);
      m.addEventListener('ended', sync);
      m.addEventListener(
        'loadedmetadata',
        () => {
          if (pendingSeek != null) m.currentTime = pendingSeek;
          if (wantPlay) void m.play().catch(() => {});
        },
        { once: true },
      );
    }, YT_TIMEOUT_MS);

    if (window.YT?.Player) init();
    else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        init();
      };
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;
        document.head.appendChild(tag);
      }
    }

    const box = ytBox.current;
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      try {
        yt?.destroy();
      } catch {}
      box?.replaceChildren();
    };
  }, [ytBox, videoEl]);

  return { mode, playing, player };
}

// ---- The page ----

export default function ReadAlong({ lang, otherLanguage }: { lang: Lang; otherLanguage?: { href: string; label: string; hrefLang: string } }) {
  const t = UI[lang];
  const [data, setData] = useState<Transcript | null>(null);
  const [failed, setFailed] = useState(false);
  const [follow, setFollow] = useState(true);
  const [chapter, setChapter] = useState(-1);
  const [docked, setDocked] = useState(false);

  const ytBox = useRef<HTMLDivElement>(null);
  const videoEl = useRef<HTMLVideoElement>(null);
  const slotEl = useRef<HTMLDivElement>(null);
  const transcriptEl = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  // Chapters start folded on phones, where the list would push the transcript a screen down.
  const chaptersEl = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (chaptersEl.current && window.matchMedia('(max-width: 639px)').matches) chaptersEl.current.open = false;
  }, []);

  const { mode, playing, player } = usePlayer(ytBox, videoEl);

  useEffect(() => {
    let live = true;
    fetch(`/articles/solve-et-coagula/transcript.${lang}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: Transcript) => live && setData(j))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [lang]);

  // Word start times in document order, matched to the spans after render.
  const starts = useMemo(() => (data ? data.turns.flatMap((tu) => tu.p.flatMap((p) => p.w.map((w) => w[1]))) : []), [data]);
  const spans = useRef<HTMLElement[]>([]);
  useEffect(() => {
    spans.current = transcriptEl.current ? Array.from(transcriptEl.current.querySelectorAll<HTMLElement>('[data-i]')) : [];
  }, [data]);

  const seek = (s: number) => player.current.seek(s, true);

  // Highlight the word being spoken, keep it in view while following, mark the chapter.
  useEffect(() => {
    if (!starts.length) return;
    let last = -1;
    const id = window.setInterval(() => {
      const now = player.current.time();
      let lo = 0;
      let hi = starts.length - 1;
      let best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= now) {
          best = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (best !== last && best >= 0) {
        spans.current[last]?.classList.remove('sc-active');
        const el = spans.current[best];
        el?.classList.add('sc-active');
        last = best;
        if (el && followRef.current && !player.current.paused()) {
          const r = el.getBoundingClientRect();
          if (r.top < 120 || r.bottom > window.innerHeight - 120) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      if (data) {
        let c = -1;
        data.chapters.forEach(([s], i) => {
          if (s <= now) c = i;
        });
        setChapter(c);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [starts, data, player]);

  // Following stops the moment the reader scrolls on their own (wheel, touch or scroll keys), so the
  // page never drags them back while they read ahead. The button turns it back on.
  useEffect(() => {
    const stop = () => followRef.current && setFollow(false);
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (e.key === ' ' && tag === 'BUTTON') return;
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) stop();
    };
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchmove', stop, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Dock the video in the corner while it plays and its place is scrolled away.
  const [slotVisible, setSlotVisible] = useState(true);
  useEffect(() => {
    const el = slotEl.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setSlotVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Docks when it starts playing out of view or scrolls out of view while playing; stays docked if paused
  // there; undocks when its place is back on screen. (State adjusted during render, not in an effect.)
  const [seen, setSeen] = useState({ slotVisible: true, playing: false });
  if (seen.slotVisible !== slotVisible || seen.playing !== playing) {
    setSeen({ slotVisible, playing });
    if (slotVisible) setDocked(false);
    else if (playing) setDocked(true);
  }

  const onTranscriptClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
    if (el) seek(parseFloat(el.dataset.s || '0'));
  };

  let wordIndex = 0;
  let figCursor = 0; // next FIGURES entry to place, in reading order

  return (
    <div className="sc-readalong not-prose">
      <style>{CSS}</style>

      <div ref={slotEl} className="aspect-video w-full">
        <div className={docked ? 'sc-docked' : 'w-full h-full'}>
          <div className="relative w-full aspect-video bg-dark overflow-hidden rounded-sm shadow-md">
            <div className={mode === 'youtube' ? 'absolute inset-0' : 'hidden'}>
              <div ref={ytBox} className="sc-yt w-full h-full" />
            </div>
            <video
              ref={videoEl}
              className={mode === 'fallback' ? 'absolute inset-0 w-full h-full bg-dark' : 'hidden'}
              controls
              playsInline
              preload="none"
              poster={POSTER}
              src={FALLBACK_MP4}
            />
          </div>
          {docked && (
            <div className="flex justify-end gap-2 pt-2">
              <FollowButton follow={follow} setFollow={setFollow} t={t} />
              <button type="button" className="sc-btn" onClick={() => slotEl.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                {t.top}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-3 font-sans text-sm text-muted">
        <span>
          {lang === 'es'
            ? 'La conversación es en inglés; esta es una traducción al español. Haz clic en cualquier palabra para ir a ese momento.'
            : 'Click any word to jump to that moment in the video.'}
          {otherLanguage && (
            <>
              {' '}
              <a href={otherLanguage.href} hrefLang={otherLanguage.hrefLang} lang={otherLanguage.hrefLang} className="sc-plain-link">
                {otherLanguage.label}
              </a>
            </>
          )}
        </span>
        {!docked && <FollowButton follow={follow} setFollow={setFollow} t={t} />}
      </div>

      <details ref={chaptersEl} className="mt-8 border-y border-border-light py-4" open>
        <summary className="cursor-pointer font-sans text-xs font-semibold uppercase tracking-wider text-primary">{t.chapters}</summary>
        {data ? (
          <ol className="sc-chapters mt-4 font-sans text-sm" data-testid="chapters">
            {data.chapters.map(([s, title], i) => (
              <li key={s}>
                <button type="button" onClick={() => seek(s)} className={`sc-chapter ${i === chapter ? 'sc-now' : ''}`} aria-label={`${t.jump} ${fmtTime(s)}: ${title}`}>
                  <span className="sc-time">{fmtTime(s)}</span>
                  <span className="sc-chapter-title">{title}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </details>

      <div ref={transcriptEl} className="mt-10 font-body text-secondary" onClick={onTranscriptClick} data-testid="transcript" aria-live="off">
        {failed && <p className="text-muted">{t.failed}</p>}
        {!data && !failed && <p className="text-muted font-sans text-sm">{t.loading}</p>}
        {data?.turns.map((turn, ti) => (
          <div key={ti} className="mb-8">
            <div className="flex items-baseline gap-3 mb-2 font-sans text-xs font-semibold uppercase tracking-wider text-primary">
              <span>{turn.n}</span>
              <button type="button" className="sc-ts" data-s={turn.s} aria-label={`${t.jump} ${fmtTime(turn.s)}`}>
                {fmtTime(turn.s)}
              </button>
            </div>
            {turn.p.map((para, pi) => {
              const paraStart = para.w[0]?.[1] ?? turn.s;
              const figsHere: Figure[] = [];
              while (figCursor < FIGURES.length && FIGURES[figCursor].s <= paraStart) figsHere.push(FIGURES[figCursor++]);
              const hasAside = !!(para.note || para.refs?.length);
              const refsAt = new Map<number, Ref[]>();
              para.refs?.forEach((r) => refsAt.set(r.w, [...(refsAt.get(r.w) || []), r]));
              return (
                <div key={pi}>
                {figsHere.map((f) => (
                  <figure key={f.src} className="sc-figure" data-s={f.s} data-testid="screen-grab">
                    <Image src={f.src} alt={f.alt[lang]} width={1280} height={658} sizes="(min-width: 1024px) 720px, 100vw" className="sc-figure-img" />
                    <figcaption className="font-sans">
                      <span className="sc-time">{fmtTime(f.s)}</span> {f.caption[lang]}
                    </figcaption>
                  </figure>
                ))}
                <div className={`sc-para ${hasAside ? 'sc-has-aside' : ''}`}>
                  <p className="sc-text leading-relaxed" data-testid="para">
                    {para.note && (
                      <span className="sc-note sc-note-inline" data-s={para.w[0]?.[1] ?? turn.s}>
                        {para.note}
                      </span>
                    )}
                    {para.w.map(([text, s], wi) => {
                      const i = wordIndex++;
                      const m = text.match(/^(\s*)([\s\S]*)$/);
                      const lead = m?.[1] ?? '';
                      const word = m?.[2] ?? text;
                      const marks = refsAt.get(wi);
                      return (
                        <span key={wi}>
                          {lead}
                          <span className="sc-w" data-i={i} data-s={s}>
                            {word}
                          </span>
                          {marks?.map((r) => (
                            <sup key={r.n} className="sc-fn">
                              <a href={`#sc-ref-${r.n}`} aria-label={`${t.ref} ${r.n}`} className="bg-transparent" data-testid="fn" onClick={(e) => e.stopPropagation()}>
                                {r.n}
                              </a>
                            </sup>
                          ))}
                        </span>
                      );
                    })}
                  </p>
                  {hasAside && (
                    <aside className="sc-aside font-sans">
                      {para.note && (
                        <span className="sc-note sc-note-aside" data-s={para.w[0]?.[1] ?? turn.s}>
                          {para.note}
                        </span>
                      )}
                      {para.refs?.map((r) => (
                        <a
                          key={r.n}
                          id={`sc-ref-${r.n}`}
                          href={r.url}
                          target="_blank"
                          rel="noopener"
                          className={`sc-card bg-transparent ${r.kind === 'web' ? 'sc-card-web' : ''}`}
                          data-testid="ref-card"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="sc-card-kind">
                            {r.n} · {t.kind[r.kind]}
                          </span>
                          <span className="sc-card-title">{r.title}</span>
                          <span className="sc-card-detail">{r.detail}</span>
                        </a>
                      ))}
                    </aside>
                  )}
                </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function FollowButton({ follow, setFollow, t }: { follow: boolean; setFollow: (f: boolean) => void; t: (typeof UI)[Lang] }) {
  return (
    <button type="button" className={`sc-btn ${follow ? 'sc-on' : ''}`} title={t.followTitle} aria-pressed={follow} onClick={() => setFollow(!follow)}>
      {follow ? t.follow : t.followOff}
    </button>
  );
}

// Scoped styles. Every colour is a site token (globals.css); no red.
const CSS = `
.sc-readalong { --sc-hl: color-mix(in srgb, var(--color-accent-gold) 38%, transparent); }
.sc-btn { font-family: var(--font-sans); font-size: 0.75rem; font-weight: 500; white-space: nowrap; border: 1px solid var(--color-border-medium);
  background: var(--color-cream); color: var(--color-muted); border-radius: 999px; padding: 0.4rem 0.9rem; cursor: pointer; }
.sc-btn:hover { color: var(--color-primary); border-color: var(--color-accent-gold); }
.sc-btn.sc-on { background: var(--color-warm); color: var(--color-primary); border-color: var(--color-accent-gold-dark); }
.sc-docked { position: fixed; right: 16px; bottom: 84px; width: min(360px, calc(100vw - 32px)); z-index: 40;
  background: var(--color-cream); padding: 6px; border-radius: 6px; box-shadow: 0 6px 30px rgba(26,22,18,0.28); }
.sc-yt iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.sc-plain-link { color: inherit; text-decoration: underline; text-decoration-color: var(--color-accent-gold); text-underline-offset: 0.2em; }
.sc-chapters { list-style: none; padding: 0; margin-bottom: 0; }
@media (min-width: 768px) { .sc-chapters { columns: 2; column-gap: 2rem; } }
.sc-chapters li { break-inside: avoid; margin: 0 0 0.4rem; }
.sc-chapter { display: flex; gap: 0.6rem; text-align: left; line-height: 1.35; color: var(--color-secondary); background: none; border: 0; padding: 0; cursor: pointer; }
.sc-chapter:hover .sc-chapter-title { text-decoration: underline; text-decoration-color: var(--color-accent-gold); }
.sc-time { color: var(--color-muted); font-variant-numeric: tabular-nums; min-width: 3.2em; }
.sc-chapter.sc-now .sc-chapter-title { color: var(--color-primary); font-weight: 600; }
.sc-ts { font-weight: 400; letter-spacing: 0.02em; color: var(--color-muted); background: none; border: 0; padding: 0; cursor: pointer; }
.sc-ts:hover { color: var(--color-primary); text-decoration: underline; }
.sc-para { margin: 0 0 1rem; }
.sc-figure { margin: 1.75rem 0; cursor: pointer; }
.sc-figure-img { display: block; width: 100%; height: auto; border: 1px solid var(--color-border-light); border-radius: 4px; }
.sc-figure figcaption { margin-top: 0.45rem; font-size: 0.8rem; line-height: 1.4; color: var(--color-muted); }
.sc-figure:hover .sc-figure-img { border-color: var(--color-accent-gold); }
.sc-text { margin: 0; font-size: var(--reader-font-size, 1.125rem); overflow-wrap: anywhere; }
.sc-w { cursor: pointer; border-radius: 2px; }
.sc-w:hover { background: var(--color-warm); }
.sc-w.sc-active { background: var(--sc-hl); box-shadow: 0 0 0 2px var(--sc-hl); color: var(--color-primary); }
.sc-note { display: block; font-family: var(--font-serif); font-style: italic; font-weight: 600; font-size: 1.05rem; line-height: 1.3;
  color: var(--color-accent-gold-dark); cursor: pointer; }
.sc-note-inline { margin: 0 0 0.15rem; }
.sc-note-aside { display: none; }
.sc-fn { font-family: var(--font-sans); font-size: 0.65em; line-height: 0; margin-left: 1px; }
.sc-readalong .sc-fn a { color: var(--color-accent-gold-dark); text-decoration: none; padding: 0 1px; font-weight: 600; }
.sc-readalong .sc-fn a:hover { text-decoration: underline; }
.sc-aside { font-size: 0.8rem; line-height: 1.4; margin: 0.6rem 0 0; }
.sc-readalong a.sc-card { display: block; text-decoration: none; color: var(--color-secondary); border-left: 2px solid var(--color-accent-gold);
  padding: 0.5rem 0.75rem; margin: 0.5rem 0 0; background: var(--color-warm); border-radius: 0 4px 4px 0; scroll-margin-top: 30vh; }
.sc-readalong a.sc-card.sc-card-web { border-left-color: var(--color-border-medium); }
.sc-card-kind { display: block; font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-muted); }
.sc-card-title { display: block; font-family: var(--font-serif); font-style: italic; font-weight: 600; font-size: 1.05rem; line-height: 1.2; color: var(--color-primary); }
.sc-card-detail { display: block; color: var(--color-muted); }
.sc-readalong a.sc-card:hover .sc-card-title, .sc-readalong a.sc-card:focus-visible .sc-card-title { text-decoration: underline; text-decoration-color: var(--color-accent-gold); }
.sc-readalong a.sc-card:target { box-shadow: 0 0 0 2px var(--color-accent-gold); }
/* Wide screens: notes and references in a right-hand margin beside their paragraph. */
@media (min-width: 1024px) {
  .sc-para.sc-has-aside { display: grid; grid-template-columns: minmax(0, 1fr) 13.5rem; column-gap: 2rem; align-items: start; }
  .sc-para:not(.sc-has-aside) { margin-right: 15.5rem; }
  .sc-figure { margin-right: 15.5rem; }
  .sc-has-aside .sc-note-inline { display: none; }
  .sc-note-aside { display: block; margin: 0.2rem 0 0.25rem; }
  .sc-aside { margin: 0; }
  .sc-readalong a.sc-card { background: transparent; padding: 0.2rem 0 0.2rem 0.65rem; border-radius: 0; }
  .sc-readalong a.sc-card:first-of-type { margin-top: 0.25rem; }
}
`;
