'use client';

/**
 * Ngram viewer (issue #3175) — client half of /ngrams.
 * Fetches precomputed year-series from /api/ngrams and renders them as an SVG
 * line chart (house convention: hand-rolled SVG + chart-utils, CSS-var colors).
 * State lives in the URL (?q=&corpus=&smoothing=&from=&to=) so charts are
 * shareable. Clicking a point opens /search scoped to that term + year window —
 * from trend line to readable pages in two clicks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { linearScale, linePath, areaPath, niceTicks, compactNumber } from '@/components/analytics/charts/chart-utils';
import { NGRAM_CORPORA, ORIGINAL_LANGUAGE_CORPUS } from '@/lib/ngram-normalize';
import { findTermFamily } from '@/lib/ngram-lexicon';
import UstcCoveragePanel from '@/components/ngrams/UstcCoveragePanel';

// tokens mode carries perMillion; docs mode (#3217) carries pctBooks, and
// count means distinct books rather than occurrences. smoothed rides on
// whichever value the mode uses, so the chart reads it uniformly.
interface Point { year: number; count: number; perMillion?: number; pctBooks?: number; smoothed: number }
interface Series {
  term: string; corpus: string; corpusLabel: string;
  ngram: string; found: boolean; tooLong: boolean;
  totalCount: number; bookCount: number; points: Point[];
}
type Mode = 'tokens' | 'docs';
interface ApiResponse {
  corpus: string; mode?: Mode; from: number; to: number; smoothing: number;
  totals: Array<{ year: number; tokens: number; books: number }>;
  series: Series[];
  error?: string;
}

const SERIES_COLORS = [
  'var(--accent-rust)',
  '#4a90d9',
  'var(--accent-sage-dark)',
  'var(--accent-violet)',
  '#d4873c',
  '#c4564c',
];

const EXAMPLES: Array<{ label: string; q: string; corpus: string }> = [
  { label: 'mercury, sulphur, salt', q: 'mercury,sulphur,salt', corpus: 'en' },
  { label: "philosopher's stone vs elixir", q: "philosopher's stone,elixir", corpus: 'en' },
  { label: 'kabbalah vs hieroglyphics', q: 'kabbalah,hieroglyphics', corpus: 'en' },
  { label: 'lapis philosophorum (Latin)', q: 'lapis philosophorum,quinta essentia', corpus: 'la' },
  { label: 'mercury across languages', q: 'mercury,mercurius:la,quecksilber:de,mercure:fr', corpus: 'en' },
];

// corpus id → books.language value, for the /search click-through filter.
const CORPUS_SEARCH_LANGUAGE: Record<string, string> = Object.fromEntries(
  Object.entries(ORIGINAL_LANGUAGE_CORPUS)
    .filter(([lang]) => lang !== 'ancient greek')
    .map(([lang, id]) => [id, lang.replace(/^./, c => c.toUpperCase())]),
);

const DEFAULT_Q = "philosopher's stone,elixir";

/** Fraction of the plot height where the corpus-volume backdrop tops out
 *  (0 = top of plot, 1 = baseline). It occupies the bottom 40%. */
const BACKDROP_TOP = 0.6;

export default function NgramViewer() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get('q') || DEFAULT_Q);
  const [corpus, setCorpus] = useState(searchParams.get('corpus') || 'en');
  const [mode, setMode] = useState<Mode>(searchParams.get('mode') === 'docs' ? 'docs' : 'tokens');
  const [smoothing, setSmoothing] = useState(Number(searchParams.get('smoothing') ?? 3));
  const [from, setFrom] = useState(Number(searchParams.get('from') ?? 1450));
  // 1930 default: later years are thin and dominated by reprint/edition noise.
  const [to, setTo] = useState(Number(searchParams.get('to') ?? 1930));
  const [committed, setCommitted] = useState(query);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<{ year: number; seriesIdx: number; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Debounce free-typing; commit immediately on Enter/preset.
  useEffect(() => {
    const t = setTimeout(() => setCommitted(query), 600);
    return () => clearTimeout(t);
  }, [query]);

  // Sync state → URL (shareable), then fetch.
  useEffect(() => {
    const params = new URLSearchParams();
    if (committed.trim()) params.set('q', committed);
    params.set('corpus', corpus);
    // Only non-default so existing shared links (and their CDN cache keys) stay unchanged.
    if (mode === 'docs') params.set('mode', mode);
    params.set('smoothing', String(smoothing));
    params.set('from', String(from));
    params.set('to', String(to));
    router.replace(`/ngrams?${params.toString()}`, { scroll: false });

    if (!committed.trim()) { setData(null); return; }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/ngrams?${params.toString()}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((json: ApiResponse) => {
        if (json.error) { setError(json.error); setData(null); }
        else { setData(json); setError(null); }
      })
      .catch((e) => { if (e.name !== 'AbortError') setError('Lookup failed'); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [committed, corpus, mode, smoothing, from, to, router]);

  // ---- chart geometry ----
  const width = 900, height = 420;
  const margin = { top: 16, right: 24, bottom: 40, left: 56 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const shown = useMemo(() => (data?.series || []).filter(s => s.found), [data]);
  const yMax = useMemo(() => {
    let m = 0;
    for (const s of shown) for (const p of s.points) m = Math.max(m, p.smoothed);
    return m || 1;
  }, [shown]);
  // Backdrop scale: the corpus is dominated by a handful of freak years (1700
  // alone holds 104M tokens — 8x the 99th percentile — because round years are
  // the fallback for undated editions). Scaling the backdrop to the true max
  // flattened every other year into an invisible smear at ~3% of a quarter-
  // height band. Scale to the 98th percentile instead and let the outliers clip
  // flat against the band top, so the shape of the ordinary years is readable.
  const tokenBand = useMemo(() => {
    const vals = (data?.totals || []).map(t => t.tokens).sort((a, b) => a - b);
    if (!vals.length) return { top: 1, clipped: 0 };
    const top = Math.max(1, vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.98))]);
    return { top, clipped: vals.filter(v => v > top).length };
  }, [data]);

  const xScale = useMemo(() => linearScale(from, to, 0, plotW), [from, to, plotW]);
  const yScale = useMemo(() => linearScale(0, yMax * 1.05, plotH, 0), [yMax, plotH]);
  // Backdrop rides in the bottom ~40% of the plot on its OWN scale — it shares
  // the x-axis with the curves but nothing else. The y-axis labels describe the
  // curves only; the band's own ceiling is labelled at its top edge.
  const tokenScale = useMemo(
    () => linearScale(0, tokenBand.top, plotH, plotH * BACKDROP_TOP),
    [tokenBand, plotH],
  );

  const xTicks = useMemo(() => niceTicks(from, to, 8), [from, to]);
  const yTicks = useMemo(() => niceTicks(0, yMax * 1.05, 5), [yMax]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || !shown.length) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = width / rect.width;
    const mx = (e.clientX - rect.left) * sx - margin.left;
    const my = (e.clientY - rect.top) * (height / rect.height) - margin.top;
    if (mx < 0 || mx > plotW) { setHover(null); return; }
    const year = Math.round(from + (mx / plotW) * (to - from));
    let best: { year: number; seriesIdx: number; px: number; py: number } | null = null;
    let bestDist = Infinity;
    shown.forEach((s, i) => {
      let closest: Point | null = null;
      for (const p of s.points) {
        if (!closest || Math.abs(p.year - year) < Math.abs(closest.year - year)) closest = p;
      }
      if (!closest) return;
      const py = yScale(closest.smoothed);
      const dist = Math.abs(py - my);
      if (dist < bestDist) {
        bestDist = dist;
        best = { year: closest.year, seriesIdx: i, px: xScale(closest.year), py };
      }
    });
    setHover(best);
  }, [shown, from, to, plotW, xScale, yScale, margin.left, margin.top]);

  const handleClick = useCallback(() => {
    if (!hover || !shown[hover.seriesIdx]) return;
    const s = shown[hover.seriesIdx];
    const params = new URLSearchParams({
      q: s.term,
      date_from: String(Math.max(from, hover.year - 5)),
      date_to: String(Math.min(to, hover.year + 5)),
    });
    // Scope the search to the series' own corpus language (a tagged term like
    // mercurius:la searches Latin books even when the default corpus is en).
    const lang = CORPUS_SEARCH_LANGUAGE[s.corpus];
    if (lang) params.set('language', lang);
    window.open(`/search?${params.toString()}`, '_blank');
  }, [hover, shown, from, to]);

  // Short language name for legend/chips: "Latin (originals)" → "Latin".
  const shortLabel = (label: string) => label.split(/[—(]/)[0].trim();

  // Cross-language suggestions: for every charted term that belongs to a
  // lexicon family, offer the other languages' equivalents not already charted.
  const chartedKeys = useMemo(
    () => new Set((data?.series || []).map(s => `${s.corpus}:${s.term.toLowerCase()}`)),
    [data],
  );
  const suggestions = useMemo(() => {
    if (!data) return [];
    const out: Array<{ display: string; append: string; language: string }> = [];
    const seen = new Set<string>();
    for (const s of data.series) {
      const fam = findTermFamily(s.term);
      if (!fam) continue;
      for (const [corpusId, forms] of Object.entries(fam.forms)) {
        const form = forms[0];
        const key = `${corpusId}:${form.toLowerCase()}`;
        if (seen.has(key) || chartedKeys.has(key)) continue;
        if (corpusId === s.corpus && form.toLowerCase() === s.term.toLowerCase()) continue;
        const label = NGRAM_CORPORA.find(c => c.id === corpusId)?.label;
        if (!label) continue;
        seen.add(key);
        out.push({ display: form, append: `${form}:${corpusId}`, language: shortLabel(label) });
      }
      // The English headword itself, when a foreign form is charted.
      const enKey = `en:${fam.en}`;
      if (!seen.has(enKey) && !chartedKeys.has(enKey) && s.term.toLowerCase() !== fam.en) {
        seen.add(enKey);
        out.push({ display: fam.en, append: fam.en, language: 'English' });
      }
    }
    return out.slice(0, 8);
  }, [data, chartedKeys]);

  const addTerm = useCallback((append: string) => {
    const next = query.trim() ? `${query.replace(/,\s*$/, '')},${append}` : append;
    setQuery(next);
    setCommitted(next);
  }, [query]);

  const hoverInfo = hover && shown[hover.seriesIdx]
    ? { series: shown[hover.seriesIdx], point: shown[hover.seriesIdx].points.find(p => p.year === hover.year) }
    : null;

  const totalsByYear = useMemo(
    () => new Map((data?.totals || []).map(t => [t.year, t])),
    [data],
  );
  const hoverVolume = hover ? totalsByYear.get(hover.year) : null;

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="flex-1 min-w-[260px]">
          <span className="block text-xs text-[var(--text-muted)] mb-1">Terms (comma-separated, up to 6, max 3 words · tag a language with :la, :de, :fr…)</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setCommitted(query); }}
            placeholder="philosopher's stone, elixir"
            className="w-full border border-[var(--border-medium)] rounded px-3 py-1.5 text-sm bg-transparent"
          />
        </label>
        <label>
          <span className="block text-xs text-[var(--text-muted)] mb-1">Corpus</span>
          <select
            value={corpus}
            onChange={(e) => setCorpus(e.target.value)}
            className="border border-[var(--border-medium)] rounded px-2 py-1.5 text-sm bg-transparent"
          >
            {NGRAM_CORPORA.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label>
          <span className="block text-xs text-[var(--text-muted)] mb-1">From</span>
          <input
            type="number" value={from} min={800} max={2030}
            onChange={(e) => setFrom(Number(e.target.value))}
            className="w-20 border border-[var(--border-medium)] rounded px-2 py-1.5 text-sm bg-transparent"
          />
        </label>
        <label>
          <span className="block text-xs text-[var(--text-muted)] mb-1">To</span>
          <input
            type="number" value={to} min={800} max={2030}
            onChange={(e) => setTo(Number(e.target.value))}
            className="w-20 border border-[var(--border-medium)] rounded px-2 py-1.5 text-sm bg-transparent"
          />
        </label>
        <label>
          <span className="block text-xs text-[var(--text-muted)] mb-1">Smoothing</span>
          <select
            value={smoothing}
            onChange={(e) => setSmoothing(Number(e.target.value))}
            className="border border-[var(--border-medium)] rounded px-2 py-1.5 text-sm bg-transparent"
          >
            {[0, 1, 2, 3, 5, 10].map(s => <option key={s} value={s}>±{s}y</option>)}
          </select>
        </label>
        <div>
          <span className="block text-xs text-[var(--text-muted)] mb-1">Measure</span>
          <div className="inline-flex rounded border border-[var(--border-medium)] overflow-hidden text-sm" role="group">
            {([['tokens', 'per million tokens'], ['docs', '% of books']] as Array<[Mode, string]>).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                title={m === 'docs'
                  ? 'Share of each year’s books that mention the term at least once — robust to one wordy treatise dominating a thin year'
                  : 'Occurrences per million tokens of the corpus that year'}
                className={`px-2 py-1.5 transition-colors ${mode === m
                  ? 'bg-[var(--accent-rust)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--accent-rust)]'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Example queries */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {EXAMPLES.map(ex => (
          <button
            key={ex.label}
            onClick={() => { setQuery(ex.q); setCommitted(ex.q); setCorpus(ex.corpus); }}
            className="px-2 py-0.5 text-xs rounded-full border border-[var(--border-medium)] text-[var(--text-secondary)] hover:border-[var(--accent-rust)] hover:text-[var(--accent-rust)] transition-colors"
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* Legend */}
      {data && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-sm">
          {data.series.map((s, i) => (
            <span key={`${s.corpus}:${s.term}`} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-[3px] rounded"
                style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length], opacity: s.found ? 1 : 0.3 }}
              />
              <span className={s.found ? '' : 'text-[var(--text-faint)] line-through'}>{s.term}</span>
              {s.corpus !== data.corpus && (
                <span className="text-xs px-1 rounded bg-[var(--bg-warm,#f5f0e8)] text-[var(--text-muted)]">
                  {shortLabel(s.corpusLabel)}
                </span>
              )}
              {s.found && (
                <span className="text-xs text-[var(--text-muted)]">
                  {compactNumber(s.totalCount)}× in {compactNumber(s.bookCount)} books
                </span>
              )}
              {!s.found && (
                <span className="text-xs text-[var(--text-faint)]">
                  {s.tooLong ? 'phrases max 3 words' : 'no data'}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Cross-language comparison chips */}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2 text-xs text-[var(--text-muted)]">
          <span>Compare across languages:</span>
          {suggestions.map(s => (
            <button
              key={s.append}
              onClick={() => addTerm(s.append)}
              className="px-2 py-0.5 rounded-full border border-[var(--border-medium)] text-[var(--text-secondary)] hover:border-[var(--accent-rust)] hover:text-[var(--accent-rust)] transition-colors"
              title={`Add ${s.display} (${s.language} corpus) to the chart`}
            >
              {s.display} <span className="text-[var(--text-faint)]">· {s.language}</span>
            </button>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="relative border border-[var(--border-light)] rounded-lg p-2 bg-[var(--surface-primary,transparent)]">
        {error && <div className="p-8 text-center text-sm text-[var(--text-muted)]">{error}</div>}
        {!error && !data && !loading && (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">Type a term to begin.</div>
        )}
        {!error && data && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className="w-full"
            style={{ cursor: hover ? 'pointer' : 'crosshair', opacity: loading ? 0.5 : 1 }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHover(null)}
            onClick={handleClick}
          >
            <g transform={`translate(${margin.left},${margin.top})`}>
              {/* Token-volume backdrop — the honesty layer: how much corpus is
                  under each year. Own scale, clipped at the 98th percentile. */}
              <path
                d={areaPath(
                  data.totals.map(t => ({
                    x: xScale(t.year),
                    y: tokenScale(Math.min(t.tokens, tokenBand.top)),
                  })),
                  plotH,
                )}
                fill="var(--text-faint)"
                opacity={0.16}
              />
              {/* Band ceiling — gives the grey a number so it isn't a scaleless
                  smear. Long dashes so it doesn't read as one of the y-gridlines
                  (which are 2,4); the label carries a surface-colored halo so it
                  stays legible where a curve crosses this height. */}
              <line
                x1={0} y1={plotH * BACKDROP_TOP} x2={plotW} y2={plotH * BACKDROP_TOP}
                stroke="var(--text-faint)" strokeDasharray="7,5" opacity={0.45}
              />
              <text
                x={plotW - 2} y={plotH * BACKDROP_TOP - 5}
                fontSize={10} fill="var(--text-faint)" textAnchor="end"
                stroke="var(--surface-primary, #fdfcf8)" strokeWidth={3}
                paintOrder="stroke"
              >
                {compactNumber(tokenBand.top)} tokens/yr
                {tokenBand.clipped > 0 && ' (peaks clipped)'}
              </text>

              {/* Grid */}
              {yTicks.map(t => (
                <line key={`yg-${t}`} x1={0} y1={yScale(t)} x2={plotW} y2={yScale(t)}
                  stroke="var(--border-light)" strokeDasharray="2,4" />
              ))}

              {/* Series lines */}
              {shown.map((s, i) => (
                <path
                  key={s.term}
                  d={linePath(s.points.map(p => ({ x: xScale(p.year), y: yScale(p.smoothed) })))}
                  fill="none"
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={hover?.seriesIdx === i ? 2.5 : 1.75}
                  opacity={hover && hover.seriesIdx !== i ? 0.35 : 1}
                />
              ))}

              {/* Hover marker */}
              {hover && (
                <>
                  <line x1={hover.px} y1={0} x2={hover.px} y2={plotH}
                    stroke="var(--border-medium)" strokeDasharray="3,3" />
                  <circle cx={hover.px} cy={hover.py} r={4}
                    fill={SERIES_COLORS[hover.seriesIdx % SERIES_COLORS.length]} />
                </>
              )}

              {/* Axes */}
              <line x1={0} y1={plotH} x2={plotW} y2={plotH} stroke="var(--border-medium)" />
              {xTicks.map(t => (
                <text key={`xl-${t}`} x={xScale(t)} y={plotH + 18}
                  fontSize={11} fill="var(--text-muted)" textAnchor="middle">{t}</text>
              ))}
              <line x1={0} y1={0} x2={0} y2={plotH} stroke="var(--border-medium)" />
              {yTicks.map(t => (
                <text key={`yl-${t}`} x={-8} y={yScale(t) + 4}
                  fontSize={11} fill="var(--text-muted)" textAnchor="end">
                  {t >= 100 ? Math.round(t) : t.toPrecision(2)}
                </text>
              ))}
              <text x={-44} y={plotH / 2} fontSize={11} fill="var(--text-secondary)"
                textAnchor="middle" transform={`rotate(-90, -44, ${plotH / 2})`}>
                {mode === 'docs' ? '% of books mentioning' : 'per million tokens'}
              </text>
            </g>
          </svg>
        )}

        {/* Tooltip */}
        {hoverInfo?.point && svgRef.current && (
          <div
            className="pointer-events-none absolute z-50 bg-white border border-[var(--border-medium)] rounded-lg shadow-lg px-3 py-2 text-xs"
            style={{
              left: Math.min(
                (hover!.px + margin.left) * (svgRef.current.clientWidth / width),
                svgRef.current.clientWidth - 180,
              ),
              top: Math.max(0, (hover!.py + margin.top) * (svgRef.current.clientHeight / height) - 70),
            }}
          >
            <div className="font-medium">{hoverInfo.series.term} · {hover!.year}</div>
            <div className="text-[var(--text-muted)] mt-0.5">
              {mode === 'docs'
                ? `${hoverInfo.point.smoothed.toFixed(1)}% of books (smoothed)`
                : `${hoverInfo.point.smoothed.toFixed(2)}/million (smoothed)`}
            </div>
            <div className="text-[var(--text-muted)]">
              {mode === 'docs'
                // "of N" only when the series rides the default corpus — hoverVolume
                // holds the default corpus's book count, not a tagged term's.
                ? `mentioned in ${hoverInfo.point.count.toLocaleString()}${hoverVolume && hoverInfo.series.corpus === data?.corpus ? ` of ${hoverVolume.books.toLocaleString()}` : ''} books that year`
                : `${hoverInfo.point.count.toLocaleString()} raw hits that year`}
            </div>
            {hoverVolume && (
              <div className="text-[var(--text-faint)] mt-0.5 pt-0.5 border-t border-[var(--border-light)]">
                corpus in {hover!.year}: {hoverVolume.books.toLocaleString()} books · {compactNumber(hoverVolume.tokens)} tokens
              </div>
            )}
            <div className="mt-1 text-[var(--accent-rust)]">Click to read these passages →</div>
          </div>
        )}
      </div>

      {data && (
        <p className="mt-1.5 text-xs text-[var(--text-faint)]">
          Gray backdrop: how much text each year contributes ({compactNumber(data.totals.reduce((s, t) => s + t.books, 0))} books
          across this range). It has its own scale — the dashed line marks{' '}
          {compactNumber(tokenBand.top)} tokens in a year
          {tokenBand.clipped > 0 && `, and ${tokenBand.clipped} outlier ${tokenBand.clipped === 1 ? 'year runs' : 'years run'} off the top of it`}
          {' '}— so it says nothing about the y-axis on the left, which belongs to the curves.
          Hover any point for that year&apos;s exact book and token counts.
        </p>
      )}

      {/* USTC coverage panel (#3214): quantify how much of European print the curves rest on */}
      {data && (
        <UstcCoveragePanel
          totals={data.totals}
          from={from}
          to={to}
          corpus={data.corpus}
          corpusLabel={shortLabel(NGRAM_CORPORA.find(c => c.id === data.corpus)?.label || data.corpus)}
        />
      )}
    </div>
  );
}
