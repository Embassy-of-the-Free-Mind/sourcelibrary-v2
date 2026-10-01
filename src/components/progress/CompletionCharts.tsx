'use client';

/**
 * Public charts for /about/progress: how complete each book in Source Library is.
 * Two histograms (share of a book's pages transcribed / translated, 5% bands),
 * completion by century, and readable share by language. Site palette only
 * (rust for translation, teal for transcription, trace blue for readers), one
 * hue per measure, ordered bands shaded light to dark. Rust and teal sit side by
 * side only in the century chart, where the legend, bar order and hover text
 * carry the distinction too (their colour-blind contrast alone is too low).
 * Each SVG is drawn at its container's pixel width so labels stay legible on a
 * phone. Bars grow in on first paint unless the reader prefers reduced motion.
 *
 * PRIOR ART: src/app/admin/DashboardCharts.tsx — the admin charts; those use the
 * admin palette and admin copy, and the public page needs the site's own look,
 * direct labels on the two peaks, and no admin vocabulary.
 */
import { useEffect, useRef, useState } from 'react';
import type { CenturyRow, Completion, LanguageAllRow } from '@/lib/library-dashboard';

const RUST = '#9e4a3a', TEAL = '#3e7a6e', BLUE = '#496da3';
const INK = '#1a1612', MUTED = '#6b6560', GRID = '#e8e4dc';
const EASE = 'cubic-bezier(.2,.7,.2,1)';
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtK = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : String(Math.round(n)));
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((100 * part) / whole) : 0);

/** Round an axis maximum up to 1, 2, 2.5 or 5 × a power of ten. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/** Mix a hex colour toward white by t (0 = colour, 1 = white). */
function tint(hex: string, t: number) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const m = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${m(r)} ${m(g)} ${m(b)})`;
}

/**
 * `on` turns true one frame after mount, so bars drawn at zero grow to size;
 * `tr` gives the CSS transition, or none when the reader prefers reduced motion.
 */
function useGrow() {
  const [s, setS] = useState({ on: false, animate: false });
  useEffect(() => {
    const id = requestAnimationFrame(() => setS({
      on: true,
      animate: typeof matchMedia === 'undefined' || !matchMedia('(prefers-reduced-motion: reduce)').matches,
    }));
    return () => cancelAnimationFrame(id);
  }, []);
  return { on: s.on, tr: (t: string) => (s.animate ? t : 'none') };
}

/** An SVG bar scaled up from its own baseline (CSS `y`/`height` transitions do not run in Safari). */
const growStyle = (on: boolean): React.CSSProperties => ({ transformBox: 'fill-box', transformOrigin: 'bottom', transform: on ? 'scaleY(1)' : 'scaleY(0)' });

/** The element's content width in CSS pixels; `fallback` until measured. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Hover note above a chart; `x` is the anchor in px, flipped left past 60% of the width. */
function Tip({ x, w, children }: { x: number; w: number; children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute top-0 z-10 max-w-[240px] rounded-md border border-border-light bg-white px-2.5 py-1.5 text-xs text-primary shadow-sm" style={{ left: x, transform: x > w * 0.6 ? 'translateX(-100%)' : 'none' }}>
      {children}
    </div>
  );
}

/** One histogram: `bins` counts over equal bands of 0–100%. The first and last bands are labelled directly. */
export function Histogram({ bins, color, title, noun = 'books', emptyLabel, fullLabel }: {
  bins: number[]; color: string; title: string; noun?: string; emptyLabel: string; fullLabel: string;
}) {
  const { on: grow, tr } = useGrow();
  const [ref, W] = useWidth<HTMLDivElement>(340);
  const [hi, setHi] = useState<number | null>(null);
  const H = 200, L = 34, R = 6, T = 22, B = 22;
  const iw = W - L - R, ih = H - T - B, n = bins.length;
  const yMax = niceMax(Math.max(1, ...bins));
  const slot = iw / n, bw = slot * 0.74;
  const band = (i: number) => `${(100 * i) / n}–${(100 * (i + 1)) / n}%`;
  return (
    <div className="grid gap-1.5 min-w-0">
      <div className="text-sm font-medium text-primary">{title}</div>
      <div ref={ref} className="relative">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${fmt(bins[0])} ${noun} in the lowest band, ${fmt(bins[n - 1])} in the highest`} className="block max-w-full" onMouseLeave={() => setHi(null)}>
          {[0, 0.5, 1].map(f => (
            <g key={f}>
              <line x1={L} x2={W - R} y1={T + ih - ih * f} y2={T + ih - ih * f} stroke={GRID} strokeWidth={1} />
              <text x={L - 6} y={T + ih - ih * f + 3.5} fontSize={11} textAnchor="end" fill={MUTED}>{fmtK(yMax * f)}</text>
            </g>
          ))}
          {bins.map((v, i) => {
            const h = (ih * v) / yMax, x = L + slot * i + (slot - bw) / 2, y = T + ih - h;
            const shade = tint(color, 0.62 - (0.62 * i) / (n - 1));
            return (
              <g key={i} onMouseEnter={() => setHi(i)} onClick={() => setHi(i)}>
                <rect x={L + slot * i} y={T} width={slot} height={ih} fill="transparent" />
                <rect x={x} y={y} width={bw} height={h} rx={2} fill={shade} stroke={hi === i ? INK : 'none'} strokeWidth={1} style={{ ...growStyle(grow), transition: tr(`transform .7s ${EASE} ${i * 18}ms`) }} />
              </g>
            );
          })}
          {/* Peak labels drawn after every bar, so a taller neighbour never covers them. */}
          {[0, n - 1].map(i => {
            const v = bins[i], x = L + slot * i + (slot - bw) / 2, y = T + ih - (ih * v) / yMax;
            return v > 0 && (
              <text key={i} x={i === 0 ? x : x + bw} y={Math.max(12, y - 6)} fontSize={12} fontWeight={600} textAnchor={i === 0 ? 'start' : 'end'} fill={INK} stroke="#fff" strokeWidth={3} paintOrder="stroke">{fmt(v)}</text>
            );
          })}
          {[0, 0.5, 1].map(f => (
            <text key={f} x={L + iw * f} y={H - 6} fontSize={11} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} fill={MUTED}>{Math.round(100 * f)}%</text>
          ))}
        </svg>
        {hi != null && <Tip x={L + slot * hi + slot / 2} w={W}><b>{band(hi)}</b> of pages · {fmt(bins[hi])} {noun}</Tip>}
      </div>
      <div className="flex justify-between gap-3 text-xs text-muted"><span>{emptyLabel}</span><span className="text-right">{fullLabel}</span></div>
    </div>
  );
}

function Swatch({ color, round, children }: { color: string; round?: boolean; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5" style={{ background: color, borderRadius: round ? '50%' : 2 }} />{children}</span>;
}

/** Mean completion by century: two bars per century (transcribed, translated) and a dot for the readable share. */
export function CenturyChart({ rows }: { rows: CenturyRow[] }) {
  const { on: grow, tr } = useGrow();
  const [ref, W] = useWidth<HTMLDivElement>(640);
  const [hi, setHi] = useState<number | null>(null);
  const data = rows.filter(r => r.books > 0 && r.meanOcrPct != null);
  const H = 220, L = 36, R = 4, T = 14, B = 26;
  const iw = W - L - R, ih = H - T - B, n = data.length, slot = iw / Math.max(1, n), bw = Math.min(16, slot * 0.32);
  const y = (p: number) => T + ih - (ih * p) / 100;
  const narrow = slot < 44;
  const short = (label: string) => (label.startsWith('Before') ? (narrow ? '≤10' : 'pre-1000') : label.replace(/ c\.$/, '').replace(/(st|nd|rd|th)$/, narrow ? '' : '$1'));
  return (
    <div className="grid gap-2 min-w-0">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
        <Swatch color={TEAL}>Pages transcribed, mean per book</Swatch>
        <Swatch color={RUST}>Pages translated, mean per book</Swatch>
        <Swatch color={BLUE} round>Books readable in English</Swatch>
      </div>
      <div ref={ref} className="relative">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mean share of pages transcribed and translated, and share of books readable in English, by century of publication" className="block max-w-full" onMouseLeave={() => setHi(null)}>
          {[0, 50, 100].map(p => (
            <g key={p}>
              <line x1={L} x2={W - R} y1={y(p)} y2={y(p)} stroke={GRID} strokeWidth={1} />
              <text x={L - 6} y={y(p) + 3.5} fontSize={11} textAnchor="end" fill={MUTED}>{p}%</text>
            </g>
          ))}
          {data.map((r, i) => {
            const cx = L + slot * i + slot / 2, readable = pct(r.readable ?? 0, r.books);
            const bars: [number, string][] = [[r.meanOcrPct ?? 0, TEAL], [r.meanTrPct ?? 0, RUST]];
            return (
              <g key={r.label} onMouseEnter={() => setHi(i)} onClick={() => setHi(i)}>
                <rect x={L + slot * i} y={T} width={slot} height={ih} fill={hi === i ? 'rgba(0,0,0,.03)' : 'transparent'} />
                {bars.map(([p, c], bi) => (
                  <rect key={bi} x={cx - bw - 1 + bi * (bw + 2)} y={y(p)} width={bw} height={y(0) - y(p)} rx={2} fill={c} style={{ ...growStyle(grow), transition: tr(`transform .7s ${EASE} ${i * 30}ms`) }} />
                ))}
                <circle cx={cx} cy={y(readable)} r={4.5} fill={BLUE} stroke="#fff" strokeWidth={2} style={{ opacity: grow ? 1 : 0, transition: tr(`opacity .5s ${300 + i * 30}ms`) }} />
                <text x={cx} y={H - 8} fontSize={11} textAnchor="middle" fill={MUTED}>{short(r.label)}</text>
              </g>
            );
          })}
        </svg>
        {hi != null && (
          <Tip x={L + slot * hi + slot / 2} w={W}>
            <b>{data[hi].label.startsWith('Before') ? data[hi].label : `${data[hi].label.replace(/ c\.$/, '')} century`}</b> · {fmt(data[hi].books)} books<br />
            Transcribed {Math.round(data[hi].meanOcrPct ?? 0)}% · translated {Math.round(data[hi].meanTrPct ?? 0)}% of pages, on average<br />
            Readable in English: {fmt(data[hi].readable ?? 0)} ({pct(data[hi].readable ?? 0, data[hi].books)}%)
          </Tip>
        )}
      </div>
    </div>
  );
}

/** Readable share by language, one row per language, with the mean translated share as a lighter underlay. */
export function LanguageBars({ rows, limit = 15 }: { rows: LanguageAllRow[]; limit?: number }) {
  const { on: grow, tr } = useGrow();
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <div className="grid gap-2 min-w-0">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
        <Swatch color={RUST}>Books readable in English</Swatch>
        <Swatch color={tint(RUST, 0.72)}>Pages translated, mean per book</Swatch>
      </div>
      <div className="grid gap-2">
        {shown.map((l, i) => {
          const readable = pct(l.readable, l.books);
          return (
            <div key={l.name} className="grid items-center gap-3 text-sm" style={{ gridTemplateColumns: 'minmax(84px, 140px) 1fr' }} title={`${l.name}: ${fmt(l.readable)} of ${fmt(l.books)} books readable in English (${readable}%); on average ${Math.round(l.meanTrPct)}% of a book's pages translated, ${Math.round(l.meanOcrPct)}% transcribed`}>
              <div className="min-w-0 truncate text-primary leading-tight">{l.name}<span className="block text-xs text-muted">{fmt(l.books)} books</span></div>
              <div className="relative h-5 min-w-0">
                <div className="absolute inset-y-0 left-0 rounded-r" style={{ width: grow ? `${0.7 * l.meanTrPct}%` : 0, background: tint(RUST, 0.72), transition: tr(`width .7s ${EASE} ${i * 25}ms`) }} />
                <div className="absolute inset-y-1 left-0 rounded-r" style={{ width: grow ? `${0.7 * readable}%` : 0, background: RUST, transition: tr(`width .7s ${EASE} ${i * 25}ms`) }} />
                <span className="absolute inset-y-0 flex items-center font-mono text-xs text-secondary whitespace-nowrap" style={{ left: `calc(${0.7 * Math.max(readable, l.meanTrPct)}% + 6px)` }}>{readable}%</span>
              </div>
            </div>
          );
        })}
      </div>
      {rows.length > limit && (
        <button type="button" onClick={() => setAll(v => !v)} className="justify-self-start text-sm text-accent-rust hover:underline py-1">
          {all ? `Show the ${limit} largest` : `Show all ${rows.length} languages`}
        </button>
      )}
    </div>
  );
}

/**
 * The whole section. Every sentence is computed from the snapshot so it cannot
 * drift from the charts beneath it.
 */
export function CompletionSection({ completion, century, languages, liveBooks, livePages, liveTranslatedPages, readable }: {
  completion: Completion; century: CenturyRow[]; languages: LanguageAllRow[];
  liveBooks: number; livePages: number; liveTranslatedPages: number; readable: number;
}) {
  const n = completion.bins;
  const trNone = completion.translated[0], trFull = completion.translated[n - 1], trMid = completion.books - trNone - trFull;
  const ocrFull = completion.ocr[n - 1];
  const langs = languages.filter(l => l.name !== '(none)' && l.name !== 'Unknown');
  const dated = century.filter(r => r.books > 0 && r.meanTrPct != null);
  const datedBooks = dated.reduce((a, r) => a + r.books, 0);
  // The century furthest behind, among those holding at least a tenth of the dated books.
  const lagging = dated.filter(r => r.books >= datedBooks / 10).sort((a, b) => (a.meanTrPct ?? 0) - (b.meanTrPct ?? 0))[0];
  const bigTwo = langs.slice(0, 2);
  const bigTwoShare = pct(bigTwo.reduce((a, l) => a + l.books, 0), completion.books);
  return (
    <section className="bg-white rounded-xl border border-border-light p-6 mb-6 grid gap-6">
      <div className="grid gap-2">
        <h2 className="text-xl font-semibold text-primary">How complete each book is</h2>
        <p className="text-sm text-secondary max-w-2xl leading-relaxed">
          Counted by pages, {pct(liveTranslatedPages, livePages)}% of the library is translated. Counted by books, it looks different:
          of the <b className="text-primary">{fmt(liveBooks)}</b> books readers can open, <b className="text-primary">{fmt(readable)}</b> can be read in English today.
          A book tends to be translated all at once or not at all. {fmt(trFull)} books are at least 95% translated, {fmt(trNone)} are under 5%, and only {fmt(trMid)} are in between.
        </p>
      </div>
      <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))' }}>
        <Histogram bins={completion.ocr} color={TEAL} title="Share of each book's pages transcribed" emptyLabel="none yet" fullLabel={`${fmt(ocrFull)} at 95% or more`} />
        <Histogram bins={completion.translated} color={RUST} title="Share of each book's pages translated" emptyLabel="none yet" fullLabel={`${fmt(trFull)} at 95% or more`} />
      </div>
      {dated.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-base font-semibold text-primary">By century of publication</h3>
          <CenturyChart rows={century} />
          <p className="text-xs text-muted max-w-2xl">
            The {fmt(datedBooks)} books with a known year of publication.
            {lagging && ` The ${lagging.label.replace(/ c\.$/, '')} century is furthest behind: on average ${Math.round(lagging.meanTrPct ?? 0)}% of a book's pages are translated.`}
          </p>
        </div>
      )}
      {langs.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-base font-semibold text-primary">By language</h3>
          <LanguageBars rows={langs} />
          <p className="text-xs text-muted max-w-2xl">
            {bigTwo.length === 2 && `${bigTwo[0].name} and ${bigTwo[1].name} make up ${bigTwoShare}% of the library, so they decide most of the total. `}
            Books written in English count as readable once transcribed.
          </p>
        </div>
      )}
    </section>
  );
}
