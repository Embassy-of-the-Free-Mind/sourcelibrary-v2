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

interface Point { year: number; count: number; perMillion: number; smoothed: number }
interface Series {
  term: string; ngram: string; found: boolean; tooLong: boolean;
  totalCount: number; bookCount: number; points: Point[];
}
interface ApiResponse {
  corpus: string; from: number; to: number; smoothing: number;
  totals: Array<{ year: number; tokens: number }>;
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
];

// corpus id → books.language value, for the /search click-through filter.
const CORPUS_SEARCH_LANGUAGE: Record<string, string> = Object.fromEntries(
  Object.entries(ORIGINAL_LANGUAGE_CORPUS)
    .filter(([lang]) => lang !== 'ancient greek')
    .map(([lang, id]) => [id, lang.replace(/^./, c => c.toUpperCase())]),
);

const DEFAULT_Q = "philosopher's stone,elixir";

export default function NgramViewer() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get('q') || DEFAULT_Q);
  const [corpus, setCorpus] = useState(searchParams.get('corpus') || 'en');
  const [smoothing, setSmoothing] = useState(Number(searchParams.get('smoothing') ?? 3));
  const [from, setFrom] = useState(Number(searchParams.get('from') ?? 1450));
  const [to, setTo] = useState(Number(searchParams.get('to') ?? 1950));
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
  }, [committed, corpus, smoothing, from, to, router]);

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
  const tokensMax = useMemo(() => Math.max(1, ...(data?.totals || []).map(t => t.tokens)), [data]);

  const xScale = useMemo(() => linearScale(from, to, 0, plotW), [from, to, plotW]);
  const yScale = useMemo(() => linearScale(0, yMax * 1.05, plotH, 0), [yMax, plotH]);
  // Token backdrop rides in the bottom quarter of the plot on its own scale.
  const tokenScale = useMemo(() => linearScale(0, tokensMax, plotH, plotH * 0.75), [tokensMax, plotH]);

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
    const term = shown[hover.seriesIdx].term;
    const params = new URLSearchParams({
      q: term,
      date_from: String(Math.max(from, hover.year - 5)),
      date_to: String(Math.min(to, hover.year + 5)),
    });
    const lang = CORPUS_SEARCH_LANGUAGE[corpus];
    if (lang) params.set('language', lang);
    window.open(`/search?${params.toString()}`, '_blank');
  }, [hover, shown, corpus, from, to]);

  const hoverInfo = hover && shown[hover.seriesIdx]
    ? { series: shown[hover.seriesIdx], point: shown[hover.seriesIdx].points.find(p => p.year === hover.year) }
    : null;

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="flex-1 min-w-[260px]">
          <span className="block text-xs text-[var(--text-muted)] mb-1">Terms (comma-separated, up to 6, max 3 words each)</span>
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
            <span key={s.term} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-[3px] rounded"
                style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length], opacity: s.found ? 1 : 0.3 }}
              />
              <span className={s.found ? '' : 'text-[var(--text-faint)] line-through'}>{s.term}</span>
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
              {/* Token-volume backdrop — the honesty layer: how much corpus is under each year */}
              <path
                d={areaPath(data.totals.map(t => ({ x: xScale(t.year), y: tokenScale(t.tokens) })), plotH)}
                fill="var(--text-faint)"
                opacity={0.12}
              />

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
                per million tokens
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
              {hoverInfo.point.smoothed.toFixed(2)}/million (smoothed)
            </div>
            <div className="text-[var(--text-muted)]">
              {hoverInfo.point.count.toLocaleString()} raw hits that year
            </div>
            <div className="mt-1 text-[var(--accent-rust)]">Click to read these passages →</div>
          </div>
        )}
      </div>
    </div>
  );
}
