'use client';

/**
 * Collection-coverage panel for the ngram viewer (issue #3214).
 *
 * The curves above describe OUR collection, not print culture at large. This
 * panel quantifies that: it charts the USTC's universe of European print
 * (~1.6M dated editions, 1450-1700 authoritative) against what this corpus
 * contributes per year, plus the honest headline — the share of each year's
 * known editions we actually hold (`in_source_library` matches computed by the
 * catalog-coverage build). It measures bias; it deliberately does NOT reweight
 * the curves (that's a separate research question — see #3214).
 *
 * Data: src/generated/ustc-year-counts.json (static, checked in — regenerate
 * with scripts/analytics/ustc-year-counts.mjs after a coverage rebuild).
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import ustc from '@/generated/ustc-year-counts.json';
import { linePath, linearScale, niceTicks, compactNumber } from '@/components/analytics/charts/chart-utils';

// USTC is authoritative for European print in this window; the dump's sparse
// 1701-1744 tail would read as a collapse in printing rather than the end of
// the catalogue's scope, so the panel clamps to it.
const USTC_FROM = 1450;
const USTC_TO = 1700;

interface YearRow { year: number; editions: number; matched: number; scanned: number; translated: number }

interface Props {
  /** Per-year totals for the active corpus, from the /api/ngrams response. */
  totals: Array<{ year: number; tokens: number; books: number }>;
  from: number;
  to: number;
  /** Short label of the active corpus ("English", "Latin", …). */
  corpusLabel: string;
}

export default function UstcCoveragePanel({ totals, from, to, corpusLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const winFrom = Math.max(from, USTC_FROM);
  const winTo = Math.min(to, USTC_TO);
  const hasWindow = winFrom <= winTo;

  const rows = useMemo(
    () => (ustc.years as YearRow[]).filter(r => r.year >= winFrom && r.year <= winTo),
    [winFrom, winTo],
  );
  const booksByYear = useMemo(() => new Map(totals.map(t => [t.year, t.books])), [totals]);

  const windowStats = useMemo(() => {
    const editions = rows.reduce((s, r) => s + r.editions, 0);
    const matched = rows.reduce((s, r) => s + r.matched, 0);
    const scanned = rows.reduce((s, r) => s + r.scanned, 0);
    const translated = rows.reduce((s, r) => s + r.translated, 0);
    let ourBooks = 0;
    for (const [year, books] of booksByYear) {
      if (year >= winFrom && year <= winTo) ourBooks += books;
    }
    return { editions, matched, scanned, translated, ourBooks };
  }, [rows, booksByYear, winFrom, winTo]);

  // ---- geometry: main chart (bars + line) over a per-mille ratio strip ----
  const width = 900;
  const mainH = 170;
  const stripH = 56;
  const gap = 26; // room for the strip's own title
  const margin = { top: 8, right: 24, bottom: 24, left: 56 };
  const plotW = width - margin.left - margin.right;
  const height = margin.top + mainH + gap + stripH + margin.bottom;

  const xScale = useMemo(() => linearScale(winFrom, winTo, 0, plotW), [winFrom, winTo, plotW]);
  const barW = Math.max(0.6, plotW / Math.max(1, winTo - winFrom + 1) - 0.4);

  const editionsMax = useMemo(() => Math.max(1, ...rows.map(r => r.editions)), [rows]);
  const editionsScale = useMemo(() => linearScale(0, editionsMax * 1.05, mainH, 0), [editionsMax]);
  const ourMax = useMemo(() => {
    let m = 1;
    for (const r of rows) m = Math.max(m, booksByYear.get(r.year) ?? 0);
    return m;
  }, [rows, booksByYear]);
  const ourScale = useMemo(() => linearScale(0, ourMax * 1.05, mainH, 0), [ourMax]);

  const perMille = useCallback(
    (r: YearRow) => (r.editions > 0 ? (r.matched / r.editions) * 1000 : 0),
    [],
  );
  const ratioMax = useMemo(() => Math.max(0.1, ...rows.map(perMille)), [rows, perMille]);
  const ratioScale = useMemo(() => linearScale(0, ratioMax * 1.1, stripH, 0), [ratioMax, stripH]);
  const stripTop = mainH + gap;

  const xTicks = useMemo(() => niceTicks(winFrom, winTo, 8), [winFrom, winTo]);
  const editionTicks = useMemo(() => niceTicks(0, editionsMax * 1.05, 4), [editionsMax]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || !rows.length) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (width / rect.width) - margin.left;
    if (mx < 0 || mx > plotW) { setHoverYear(null); return; }
    setHoverYear(Math.round(winFrom + (mx / plotW) * (winTo - winFrom)));
  }, [rows.length, plotW, winFrom, winTo, margin.left]);

  const hoverRow = hoverYear !== null ? rows.find(r => r.year === hoverYear) : undefined;

  const pm = (windowStats.matched / Math.max(1, windowStats.editions)) * 1000;
  const builtAt = ustc.coverage_built_at ? new Date(ustc.coverage_built_at) : null;

  return (
    <div className="mt-4 border border-[var(--border-light)] rounded-lg">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <span>
          <span className="font-medium">Collection coverage</span>
          <span className="text-[var(--text-muted)]"> — how much of European print do these curves rest on?</span>
        </span>
        <span className="text-[var(--text-faint)] shrink-0">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3">
          {!hasWindow ? (
            <p className="text-sm text-[var(--text-muted)] py-2">
              The USTC (Universal Short Title Catalogue) is authoritative for European print
              {' '}{USTC_FROM}–{USTC_TO}; the current year range falls entirely outside it, so
              there is no print universe to compare against here.
            </p>
          ) : (
            <>
              <p className="text-sm text-[var(--text-secondary)] mb-2">
                In {winFrom}–{winTo} the USTC records{' '}
                <strong>{windowStats.editions.toLocaleString()}</strong> European printed editions.
                Source Library holds <strong>{windowStats.matched.toLocaleString()}</strong> of them
                ({pm.toFixed(1)}‰), and the {corpusLabel} corpus charted above draws on{' '}
                <strong>{windowStats.ourBooks.toLocaleString()}</strong> books in this window.
              </p>

              <div className="relative">
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${width} ${height}`}
                  className="w-full"
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setHoverYear(null)}
                >
                  <g transform={`translate(${margin.left},${margin.top})`}>
                    {/* USTC universe: editions per year (bars) */}
                    {rows.map(r => (
                      <rect
                        key={r.year}
                        x={xScale(r.year) - barW / 2}
                        y={editionsScale(r.editions)}
                        width={barW}
                        height={mainH - editionsScale(r.editions)}
                        fill="var(--text-faint)"
                        opacity={hoverYear === r.year ? 0.55 : 0.3}
                      />
                    ))}

                    {/* Our books per year for the active corpus (line, own scale) */}
                    <path
                      d={linePath(rows.map(r => ({ x: xScale(r.year), y: ourScale(booksByYear.get(r.year) ?? 0) })))}
                      fill="none"
                      stroke="var(--accent-rust)"
                      strokeWidth={1.75}
                    />

                    {/* Main-chart axes */}
                    <line x1={0} y1={mainH} x2={plotW} y2={mainH} stroke="var(--border-medium)" />
                    {editionTicks.map(t => (
                      <text key={`el-${t}`} x={-8} y={editionsScale(t) + 4}
                        fontSize={10} fill="var(--text-muted)" textAnchor="end">{compactNumber(t)}</text>
                    ))}
                    <text x={-44} y={mainH / 2} fontSize={10} fill="var(--text-secondary)"
                      textAnchor="middle" transform={`rotate(-90, -44, ${mainH / 2})`}>
                      USTC editions
                    </text>

                    {/* Ratio strip: share of each year's known print we hold */}
                    <g transform={`translate(0,${stripTop})`}>
                      <text x={0} y={-8} fontSize={10} fill="var(--text-secondary)">
                        Held here, as ‰ of that year&apos;s known European print
                      </text>
                      <path
                        d={linePath(rows.map(r => ({ x: xScale(r.year), y: ratioScale(perMille(r)) })))}
                        fill="none"
                        stroke="var(--accent-sage-dark)"
                        strokeWidth={1.5}
                      />
                      <line x1={0} y1={stripH} x2={plotW} y2={stripH} stroke="var(--border-medium)" />
                      <text x={-8} y={ratioScale(ratioMax) + 4} fontSize={10} fill="var(--text-muted)" textAnchor="end">
                        {ratioMax.toFixed(1)}‰
                      </text>
                      <text x={-8} y={stripH} fontSize={10} fill="var(--text-muted)" textAnchor="end">0</text>
                    </g>

                    {/* Hover marker + x ticks */}
                    {hoverRow && (
                      <line x1={xScale(hoverRow.year)} y1={0} x2={xScale(hoverRow.year)} y2={stripTop + stripH}
                        stroke="var(--border-medium)" strokeDasharray="3,3" />
                    )}
                    {xTicks.map(t => (
                      <text key={`xl-${t}`} x={xScale(t)} y={stripTop + stripH + 16}
                        fontSize={10} fill="var(--text-muted)" textAnchor="middle">{t}</text>
                    ))}
                  </g>
                </svg>

                {hoverRow && (
                  <div className="absolute top-0 right-0 bg-white/95 border border-[var(--border-light)] rounded px-2 py-1 text-xs text-[var(--text-secondary)] pointer-events-none">
                    <span className="font-medium">{hoverRow.year}</span>
                    {' · '}USTC: {hoverRow.editions.toLocaleString()} editions
                    {' · '}held here: {hoverRow.matched.toLocaleString()} ({perMille(hoverRow).toFixed(1)}‰)
                    {' · '}{corpusLabel} corpus: {(booksByYear.get(hoverRow.year) ?? 0).toLocaleString()} books
                  </div>
                )}
              </div>

              <ul className="mt-2 text-xs text-[var(--text-faint)] space-y-0.5 list-disc pl-4">
                <li>
                  Gray bars: editions per year in the{' '}
                  <a href="https://www.ustc.ac.uk" target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--accent-rust)]">
                    Universal Short Title Catalogue
                  </a>{' '}
                  — European <em>printed</em> output only, including broadsheets and ephemera. The rust
                  line is this corpus&apos;s books per year (its own scale); the green strip is the share
                  of each year&apos;s known editions positively matched to a Source Library copy.
                </li>
                <li>
                  The match is conservative, and most of Source Library lies outside USTC&apos;s scope
                  entirely (manuscripts, non-European material, post-1700 print) — this measures how much
                  of USTC&apos;s universe we hold, not how much of our library USTC describes.
                  Across all of print, {(100 * ustc.total_scanned / ustc.total_editions).toFixed(0)}% of
                  USTC editions have any open scan anywhere, and{' '}
                  {(100 * ustc.total_translated / ustc.total_editions).toFixed(1)}% any English translation.
                </li>
                <li>
                  This panel quantifies sampling bias; it does not correct the curves above.
                  {builtAt && ` Coverage matches computed ${builtAt.toISOString().slice(0, 10)}.`}
                </li>
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
