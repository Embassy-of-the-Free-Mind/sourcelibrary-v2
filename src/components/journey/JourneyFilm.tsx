'use client';

/**
 * The journey film (#5861, #6074): one translated page, from the scan to a
 * citable English page and the checks that run on it once it is published,
 * in the six steps of Figure 1 on /how-it-works. Ported from the approved prototype
 * (feat/journey-film-prototype, docs/prototypes/journey-film/) and driven by
 * `JourneyData`, so the same component renders any translated page.
 *
 * Controls: Space play/pause, ←/→ chapters, H hide the chrome, F fullscreen.
 * Keys act only while the film is on screen. Reduced motion: the film starts
 * paused and the camera does not sway. three.js is imported on mount, so it
 * is never part of another route's bundle.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Tiro_Devanagari_Sanskrit } from 'next/font/google';
import { buildJourneyCopy, type JourneyData } from '@/lib/journey/types';
import {
  buildTimeline, segAt, chapterAt, clamp, S, lerp, fade,
  type ScreenKey, type Seg,
} from './journey-timeline';
import { ScreenContent, screenText, screenUrl } from './JourneyScreens';
import type { JourneyScene } from './journey-scene';
import s from './JourneyFilm.module.css';

// Only pages in Devanagari reference this face; preload:false keeps every
// other journey page from downloading it (rendering-and-seo.md, fonts).
const tiro = Tiro_Devanagari_Sanskrit({ weight: '400', subsets: ['devanagari', 'latin'], display: 'swap', preload: false });

const ICON_PLAY = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg>;
const ICON_PAUSE = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2h3v12h-3zm6 0h3v12h-3z" /></svg>;
const SCREEN_KEYS: ScreenKey[] = ['ocr', 'english', 'search', 'links', 'overview', 'cite', 'trace', 'checks', 'draft'];

const fmt = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;

export default function JourneyFilm({ data }: { data: JourneyData }) {
  const { steps, parts } = useMemo(() => buildJourneyCopy(data), [data]);
  const tl = useMemo(() => buildTimeline(data, steps), [data, steps]);
  const originalFont = data.script === 'devanagari'
    ? `${tiro.style.fontFamily}, "Newsreader", serif`
    : data.script === 'latin' ? '"Newsreader", Georgia, serif' : 'serif';

  const prologue = data.config.prologue || {
    eyebrow: [data.author, data.published].filter(Boolean).join(' · ') || 'Source Library',
    title: data.displayTitle || data.title,
    body: `This film follows one page of it, from a scan${data.published ? ` of the ${data.published} edition` : ''} to an English page that anyone can read and cite.`,
  };
  const label = data.config.label || `${data.author ? `${data.author}, ` : ''}${data.displayTitle || data.title}, ${data.citation.locator}`;

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const capRef = useRef<HTMLElement>(null);
  const capTag = useRef<HTMLDivElement>(null);
  const capTitle = useRef<HTMLHeadingElement>(null);
  const capBody = useRef<HTMLParagraphElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const kEyebrow = useRef<HTMLDivElement>(null);
  const kTitle = useRef<HTMLHeadingElement>(null);
  const kBody = useRef<HTMLParagraphElement>(null);
  const kSteps = useRef<HTMLOListElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const screenBgRef = useRef<HTMLDivElement>(null);
  const screenUrlRef = useRef<HTMLSpanElement>(null);
  const screenViewRef = useRef<HTMLDivElement>(null);
  const contentRefs = useRef<Partial<Record<ScreenKey, HTMLDivElement | null>>>({});
  const outroRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const segRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const timeRef = useRef<HTMLSpanElement>(null);

  const [loading, setLoading] = useState(true);
  const [playing, setPlayingState] = useState(false);
  const [clean, setClean] = useState(false);

  // Mutable film state, read by the frame loop.
  const st = useRef({ T: 0, playing: false, dragging: false, last: 0, visible: true, shownCap: '', shownCard: '', shownScreen: '' as ScreenKey | '', swapTimer: 0 as ReturnType<typeof setTimeout> | 0 });

  const setPlaying = (p: boolean) => {
    st.current.playing = p;
    st.current.last = performance.now();
    setPlayingState(p);
  };
  const seek = (x: number) => { st.current.T = clamp(x, 0, tl.total - .001); };

  useEffect(() => {
    const root = rootRef.current!;
    const stage = stageRef.current!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let scene: JourneyScene | null = null;
    let raf = 0;
    let disposed = false;
    const focusCache = new Map<string, { x: number; y: number; z: number }>();
    const film = st.current;

    function setCaption(key: string, tag: string, title: string, body: string) {
      const S0 = st.current;
      if (key === S0.shownCap) return;
      S0.shownCap = key;
      if (S0.swapTimer) clearTimeout(S0.swapTimer);
      capRef.current?.classList.add(s.swap);
      S0.swapTimer = setTimeout(() => {
        if (capTag.current) capTag.current.textContent = tag;
        if (capTitle.current) capTitle.current.textContent = title;
        if (capBody.current) { capBody.current.textContent = body; capBody.current.hidden = !body; }
        capRef.current?.classList.remove(s.swap);
      }, 300);
    }

    /** Zoom target for a screen: the union of its highlighted elements. */
    function focusFor(key: ScreenKey, el: HTMLDivElement, W: number, H: number) {
      const ck = `${key}:${W}x${H}`;
      const hit = focusCache.get(ck);
      if (hit) return hit;
      const prev = el.style.transform;
      el.style.transform = 'none';
      // Bring the highlighted text into view inside each scrolling column.
      el.querySelectorAll<HTMLElement>('[data-scroll]').forEach(col => {
        col.style.transform = 'none';
        const anchor = col.querySelector<HTMLElement>('[data-hl]') || col.querySelector<HTMLElement>('[data-anchor]');
        const colH = col.parentElement?.clientHeight || H;
        if (!anchor) return;
        // "fit": move only as far as it takes to bring the highlight into view (lists);
        // otherwise set the highlight a third of the way down (running text).
        const shift = col.dataset.scroll === 'fit'
          ? anchor.offsetTop + anchor.offsetHeight - colH * .92
          : anchor.offsetTop - colH * .3;
        col.style.transform = `translateY(${-Math.max(0, shift)}px)`;
      });
      const base = el.getBoundingClientRect();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      el.querySelectorAll<HTMLElement>('[data-hl]').forEach(h => {
        for (const r of Array.from(h.getClientRects())) {
          x0 = Math.min(x0, r.left - base.left); y0 = Math.min(y0, r.top - base.top);
          x1 = Math.max(x1, r.right - base.left); y1 = Math.max(y1, r.bottom - base.top);
        }
      });
      el.style.transform = prev;
      let f = { x: W / 2, y: H / 2, z: 1 };
      if (x1 > x0) {
        const w = x1 - x0, h = y1 - y0;
        const z = clamp(Math.min(W / (w * 1.5), H / (h * 2.4)), 1, 2.2);
        f = { x: clamp((x0 + x1) / 2, W / (2 * z), W - W / (2 * z)), y: clamp((y0 + y1) / 2, H / (2 * z), H - H / (2 * z)), z };
      }
      focusCache.set(ck, f);
      return f;
    }

    function placeScreen(key: ScreenKey, local: number, d: number) {
      const view = screenViewRef.current, el = contentRefs.current[key];
      if (!view || !el) return;
      const W = view.clientWidth, H = view.clientHeight;
      const f = focusFor(key, el, W, H);
      const k = reduce ? 1 : S(.4, d - 1.2, local);
      const z = lerp(1, f.z, k);
      const cx = lerp(W / 2, f.x, k), cy = lerp(H / 2, f.y, k);
      el.style.transform = `translate(${W / 2 - cx * z}px, ${H / 2 - cy * z}px) scale(${z})`;
      el.style.setProperty('--hl', String(S(d * .45, d * .45 + .6, local)));
    }

    function syncUI(g: Seg, local: number) {
      const S0 = st.current;
      const step = steps[g.ch];
      // part cards
      const co = g.card ? fade(local, g.d, .7) : 0;
      if (g.card && S0.shownCard !== g.card) {
        S0.shownCard = g.card;
        const C = g.card === 'pro'
          ? { eyebrow: prologue.eyebrow, title: prologue.title, body: prologue.body, steps: [] as string[] }
          : parts.find(p => p.key === g.card)!;
        if (kEyebrow.current) kEyebrow.current.textContent = C.eyebrow;
        if (kTitle.current) kTitle.current.textContent = C.title;
        if (kBody.current) kBody.current.textContent = C.body;
        const ol = kSteps.current;
        if (ol) {
          ol.replaceChildren(...C.steps.map(k => {
            const n = steps.findIndex(x => x.key === k);
            const li = document.createElement('li');
            const sp = document.createElement('span');
            sp.textContent = String(n + 1);
            li.append(sp, steps[n].short);
            return li;
          }));
        }
      }
      if (cardRef.current) {
        cardRef.current.style.opacity = String(co);
        cardRef.current.style.visibility = co > .01 ? 'visible' : 'hidden';
      }
      // screens
      const so = g.screen ? fade(local, g.d, .5) : 0;
      if (g.screen) {
        if (S0.shownScreen !== g.screen) {
          S0.shownScreen = g.screen;
          if (screenUrlRef.current) screenUrlRef.current.textContent = screenUrl(data, g.screen);
          SCREEN_KEYS.forEach(k => {
            const el = contentRefs.current[k];
            if (el) el.style.visibility = k === g.screen ? 'visible' : 'hidden';
          });
        }
        placeScreen(g.screen, local, g.d);
        const tx = screenText(data, g.screen);
        setCaption(`s:${g.screen}`, `Chapter ${g.ch + 1} · ${step.short}`, tx.title, tx.body);
      } else if (!g.card && !g.end) {
        setCaption(`c:${g.ch}`, `Chapter ${g.ch + 1} · ${step.short}`, step.title, step.body);
      }
      if (screenRef.current) {
        screenRef.current.style.opacity = String(so);
        screenRef.current.style.visibility = so > .01 ? 'visible' : 'hidden';
      }
      if (screenBgRef.current) screenBgRef.current.style.opacity = String(g.end ? 1 : so * .94);
      // progress
      const cur = chapterAt(tl, S0.T);
      steps.forEach((_, i) => {
        const s0 = tl.chStart[i], s1 = tl.chStart[i + 1] ?? tl.total;
        const fill = fillRefs.current[i];
        if (fill) fill.style.transform = `scaleX(${clamp((S0.T - s0) / Math.max(.001, s1 - s0))})`;
        segRefs.current[i]?.classList.toggle(s.segOn, i === cur);
      });
      if (timeRef.current) timeRef.current.textContent = `${fmt(S0.T)} / ${fmt(tl.total)}`;
      const oo = g.end ? S(.2, 1.4, local) * (1 - S(g.d - .6, g.d, local)) : 0;
      if (outroRef.current) {
        outroRef.current.style.opacity = String(oo);
        outroRef.current.style.visibility = oo > .01 ? 'visible' : 'hidden';
      }
      if (capRef.current) capRef.current.style.opacity = g.card || g.end ? '0' : '';
    }

    function frame(now: number) {
      const S0 = st.current;
      const dt = Math.min(.1, (now - S0.last) / 1000);
      S0.last = now;
      if (S0.visible) {
        if (S0.playing && !S0.dragging) {
          S0.T += dt;
          if (S0.T >= tl.total) S0.T = 0;
        }
        const m = segAt(tl, S0.T);
        if (scene) { scene.update(m.t); scene.render(); }
        syncUI(m.g, m.local);
      }
      raf = requestAnimationFrame(frame);
    }

    const resize = () => {
      focusCache.clear();
      if (scene) scene.resize(stage.clientWidth, stage.clientHeight);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(stage);

    // Pause work while the film is off screen.
    const io = new IntersectionObserver(([e]) => { st.current.visible = e.isIntersecting; }, { threshold: 0 });
    io.observe(root);

    (async () => {
      const fontsReady = Promise.race([
        Promise.all([
          `600 40px "Inter"`, `28px "Newsreader"`, `italic 40px "Newsreader"`, `46px ${originalFont}`,
        ].map(f => document.fonts.load(f).catch(() => []))),
        new Promise(r => setTimeout(r, 3000)),
      ]);
      try {
        const [mod] = await Promise.all([import('./journey-scene'), fontsReady]);
        const imgs = await mod.loadSceneImages(data);
        if (disposed) return;
        scene = mod.createJourneyScene(data, imgs, {
          original: originalFont,
          label: '"Inter", sans-serif',
          body: '"Newsreader", Georgia, serif',
        });
        stage.appendChild(scene.canvas);
        resize();
      } catch (err) {
        // No WebGL: the cards, captions and reader panes still tell the whole story.
        console.warn('journey film: 3D scene unavailable', err);
      }
      if (disposed) return;
      setLoading(false);
      setPlaying(!reduce);
      // For contact sheets and review: jump to a film time and hold (as the prototype's window.__film).
      (window as unknown as { __journeyFilm?: unknown }).__journeyFilm = {
        total: tl.total,
        segs: tl.segs,
        seek: (x: number) => { st.current.T = clamp(x, 0, tl.total - .001); setPlaying(false); },
      };
      st.current.last = performance.now();
      raf = requestAnimationFrame(frame);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      if (film.swapTimer) clearTimeout(film.swapTimer);
      if (scene) { scene.canvas.remove(); scene.dispose(); }
    };
    // The film is rebuilt only when its data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tl]);

  const toggleFs = () => {
    const root = rootRef.current;
    if (!root) return;
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void root.requestFullscreen().catch(() => {});
    } catch { /* fullscreen unsupported */ }
  };

  // Keyboard: only while the film is mostly on screen, and never over a form field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root || e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName))) return;
      const r = root.getBoundingClientRect();
      const onScreen = document.fullscreenElement === root
        || (Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)) > r.height * .5;
      if (!onScreen) return;
      const S0 = st.current;
      if (e.code === 'Space') {
        if (tgt && tgt.tagName === 'BUTTON' && root.contains(tgt)) return; // the button handles it
        e.preventDefault(); setPlaying(!S0.playing);
      } else if (e.key === 'ArrowRight') {
        seek(tl.chStart[Math.min(steps.length - 1, chapterAt(tl, S0.T) + 1)] + .01);
      } else if (e.key === 'ArrowLeft') {
        const c = chapterAt(tl, S0.T);
        seek(tl.chStart[S0.T - tl.chStart[c] > 1.5 ? c : Math.max(0, c - 1)] + .01);
      } else if (e.key === 'h' || e.key === 'H') setClean(v => !v);
      else if (e.key === 'f' || e.key === 'F') toggleFs();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl, steps]);

  const seekFromX = (x: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (r) seek(clamp((x - r.left) / r.width) * tl.total);
  };

  return (
    <div
      ref={rootRef}
      className={`${s.film} ${clean ? s.clean : ''}`}
      role="region"
      aria-label={`How this page was made: ${label}`}
      tabIndex={-1}
    >
      <div
        ref={stageRef}
        className={s.stage}
        onClick={() => { if (clean) setClean(false); else setPlaying(!st.current.playing); }}
      />

      <header className={`${s.brand} ${s.ui}`}>
        <span className={s.eyebrow}>Source Library</span>
        <span className={s.brandName}>{label}</span>
      </header>

      <div className={`${s.hint} ${s.ui}`}>
        <kbd>Space</kbd> play · <kbd>←</kbd> <kbd>→</kbd> chapters · <kbd>H</kbd> hide · <kbd>F</kbd> fullscreen
      </div>

      <section ref={capRef} className={`${s.caption} ${s.ui}`} aria-live="polite">
        <div ref={capTag} className={s.capTag} />
        <h2 ref={capTitle} className={s.capTitle} />
        <p ref={capBody} className={s.capBody} />
      </section>

      <div ref={screenBgRef} className={s.screenBg} aria-hidden="true" />
      <div ref={screenRef} className={s.screen} aria-hidden="true">
        <div className={s.screenBar}><span ref={screenUrlRef} className={s.screenUrl} /></div>
        <div ref={screenViewRef} className={s.screenView}>
          {SCREEN_KEYS.filter(k => tl.segs.some(g => g.screen === k)).map(k => (
            <div
              key={k}
              ref={el => { contentRefs.current[k] = el; }}
              className={s.screenContent}
              style={{ visibility: 'hidden' }}
            >
              <ScreenContent d={data} k={k} originalFont={originalFont} />
            </div>
          ))}
        </div>
      </div>

      <div ref={cardRef} className={s.card} aria-live="polite">
        <div ref={kEyebrow} className={s.kEyebrow} />
        <h2 ref={kTitle} className={s.kTitle} />
        <div className={s.kRule} />
        <p ref={kBody} className={s.kBody} />
        <ol ref={kSteps} className={s.kSteps} />
      </div>

      <div ref={outroRef} className={s.outro}>
        <div className={s.oEyebrow}>{data.citation.locator}</div>
        <p className={s.oQuote}>“{data.outroQuote}”</p>
        <p className={s.oSource}>{data.outroSource}</p>
        <a className={s.oLink} href={data.readerPath}>Read this page on Source Library</a>
      </div>

      <nav className={`${s.controls} ${s.ui}`} aria-label="Film controls">
        <button className={s.btn} type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!st.current.playing)}>
          {playing ? ICON_PAUSE : ICON_PLAY}
        </button>
        <div
          ref={trackRef}
          className={s.track}
          onPointerDown={e => { st.current.dragging = true; e.currentTarget.setPointerCapture(e.pointerId); seekFromX(e.clientX); }}
          onPointerMove={e => { if (st.current.dragging) seekFromX(e.clientX); }}
          onPointerUp={() => { st.current.dragging = false; }}
        >
          {steps.map((step, i) => (
            <button
              key={step.key}
              ref={el => { segRefs.current[i] = el; }}
              type="button"
              className={s.seg}
              style={{ flex: String((tl.chStart[i + 1] ?? tl.total) - tl.chStart[i]) }}
              aria-label={`Chapter ${i + 1}: ${step.short}`}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); seek(tl.chStart[i] + .01); }}
            >
              <span className={s.lbl}>{i + 1} {step.short}</span>
              <span className={s.bar}><span ref={el => { fillRefs.current[i] = el; }} className={s.fill} /></span>
            </button>
          ))}
        </div>
        <span ref={timeRef} className={s.time}>0:00</span>
        <button className={s.btn} type="button" aria-label={clean ? 'Show controls' : 'Hide controls'} title="Hide controls (H)" onClick={() => setClean(v => !v)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4 3 1.5 6.2 1 8c.5 1.8 3 5 7 5s6.5-3.2 7-5c-.5-1.8-3-5-7-5zm0 8a3 3 0 110-6 3 3 0 010 6z" /></svg>
        </button>
        <button className={s.btn} type="button" aria-label="Fullscreen" title="Fullscreen (F)" onClick={toggleFs}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h5v2H4v3H2zm7 0h5v5h-2V4H9zM2 9h2v3h3v2H2zm10 0h2v5H9v-2h3z" /></svg>
        </button>
      </nav>

      {loading && <div className={s.loading}>Setting the type…</div>}
    </div>
  );
}
