'use client';

/**
 * Collection-coverage panel for the ngram viewer (issue #3214).
 *
 * The curves above describe OUR collection, not print culture at large. This
 * panel quantifies that: it charts the USTC's universe of European print
 * (~1.6M dated editions, 1450-1700 authoritative) against what this corpus
 * contributes per year, plus the honest headline — the share of known editions
 * we actually hold (`in_source_library` matches from the catalog-coverage
 * build). It measures bias; it deliberately does NOT reweight the curves.
 *
 * Original-language corpora facet to USTC's same-language editions (the `la`
 * corpus reads against USTC's Latin subset — apples to apples). The `en`
 * corpus is translations of EVERYTHING, so it reads against all of European
 * print, and the copy says so.
 *
 * The held-share strip uses 5-year bins: single years early in the window can
 * have a handful of editions, and 1 match in 2 editions would spike to 500‰
 * and flatten every real year to the baseline (shipped that way, caught by
 * Derek within the hour).
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
const RATIO_BIN = 5; // years per held-share bin

interface YearRow { year: number; editions: number; matched: number }
interface LangEntry { label: string; years: YearRow[] }

interface Props {
  /** Per-year totals for the active corpus, from the /api/ngrams response. */
  totals: Array<{ year: number; tokens: number; books: number }>;
  from: number;
  to: number;
  /** Active corpus id ("en", "la", …) — picks the USTC language facet. */
  corpus: string;
  /** Short label of the active corpus ("English", "Latin", …). */
  corpusLabel: string;
}

export default function UstcCoveragePanel({ totals, from, to, corpus, corpusLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const winFrom = Math.max(from, USTC_FROM);
  const winTo = Math.min(to, USTC_TO);
  const hasWindow = winFrom <= winTo;

  // Facet: original-language corpora read against USTC's same-language subset.
  // `en` (translations of everything) and unmapped corpora read against all.
  const facet = (ustc.languages as Record<string, LangEntry | undefined>)[corpus];
  const universeLabel = facet ? `USTC ${facet.label} editions` : 'USTC editions (all languages)';

  const rows = useMemo(
    () => ((facet?.years ?? ustc.years) as YearRow[]).filter(r => r.year >= winFrom && r.year <= winTo),
    [facet, winFrom, winTo],
  );
  const booksByYear = useMemo(() => new Map(totals.map(t => [t.year, t.books])), [totals]);

  const windowStats = useMemo(() => {
    const editions = rows.reduce((s, r) => s + r.editions, 0);
    const matched = rows.reduce((s, r) => s + r.matched, 0);
    let ourBooks = 0;
    for (const [year, books] of booksByYear) {
      if (year >= winFrom && year <= winTo) ourBooks += books;
    }
    return { editions, matched, ourBooks };
  }, [rows, booksByYear, winFrom, winTo]);

  // Held-share bins: sum matched / sum editions per RATIO_BIN years. Per-year
  // ratios are meaningless when a year has a handful of editions.
  const ratioBins = useMemo(() => {
    const bins: Array<{ year: number; editions: number; matched: number; perMille: number }> = [];
    for (let start = winFrom; start <= winTo; start += RATIO_BIN) {
      const end = Math.min(start + RATIO_BIN - 1, winTo);
      let editions = 0, matched = 0;
      for (const r of rows) {
        if (r.year >= start && r.year <= end) { editions += r.editions; matched += r.matched; }
      }
      if (editions === 0) continue;
      bins.push({ year: (start + end) / 2, editions, matched, perMille: (matched / editions) * 1000 });
    }
    return bins;
  }, [rows, winFrom, winTo]);

  // ---- geometry: main chart (bars + line) over the held-share strip ----
  const width = 900;
  const mainH = 260;
  const stripH = 64;
  const gap = 28; // room for the strip's own title
  const margin = { top: 8, right: 24, bottom: 24, left: 56 };
  const plotW = width - margin.left - margin.right;
  const height = margin.top + mainH + gap + stripH + margin.bottom;

  const xScale = useMemo(() => linearScale(winFrom, winTo, 0, plotW), [winFrom, winTo, plotW]);
  const barW = Math.max(0.8, plotW / Math.max(1, winTo - winFrom + 1) - 0.3);

  const editionsMax = useMemo(() => Math.max(1, ...rows.map(r => r.editions)), [rows]);
  const editionsScale = useMemo(() => linearScale(0, editionsMax * 1.05, mainH, 0), [editionsMax]);
  const ourMax = useMemo(() => {
    let m = 1;
    for (const r of rows) m = Math.max(m, booksByYear.get(r.year) ?? 0);
    return m;
  }, [rows, booksByYear]);
  const ourScale = useMemo(() => linearScale(0, ourMax * 1.05, mainH, 0), [ourMax]);

  const ratioMax = useMemo(() => Math.max(0.1, ...ratioBins.map(b => b.perMille)), [ratioBins]);
  const ratioScale = useMemo(() => linearScale(0, ratioMax * 1.15, stripH, 0), [ratioMax, stripH]);
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
  const hoverBin = hoverYear !== null
    ? ratioBins.find(b => Math.abs(b.year - hoverYear) <= RATIO_BIN / 2)
    : undefined;

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
                <strong>{windowStats.editions.toLocaleString()}</strong>{' '}
                {facet ? `${facet.label}-language ` : ''}European printed editions.
                Source Library holds <strong>{windowStats.matched.toLocaleString()}</strong> of them
                ({pm.toFixed(1)}‰), and the {corpusLabel} corpus charted above draws on{' '}
                <strong>{windowStats.ourBooks.toLocaleString()}</strong> books in this window.
                {!facet && corpus === 'en' && (
                  <span className="text-[var(--text-muted)]">
                    {' '}(The English corpus is our translations of works in every language, so it
                    reads against all of European print; pick an original-language corpus for a
                    same-language comparison.)
                  </span>
                )}
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
                        fill="var(--text-muted)"
                        opacity={hoverYear === r.year ? 0.9 : 0.55}
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
                      {universeLabel}
                    </text>

                    {/* Held-share strip: matched ‰ of known print, RATIO_BIN-year bins */}
                    <g transform={`translate(0,${stripTop})`}>
                      <text x={0} y={-8} fontSize={10} fill="var(--text-secondary)">
                        Held here, as ‰ of known {facet ? `${facet.label} ` : ''}print ({RATIO_BIN}-year bins)
                      </text>
                      <path
                        d={linePath(ratioBins.map(b => ({ x: xScale(b.year), y: ratioScale(b.perMille) })))}
                        fill="none"
                        stroke="var(--accent-sage-dark)"
                        strokeWidth={1.75}
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
                    {' · '}{facet ? `USTC ${facet.label}` : 'USTC'}: {hoverRow.editions.toLocaleString()} editions
                    {' · '}{corpusLabel} corpus: {(booksByYear.get(hoverRow.year) ?? 0).toLocaleString()} books
                    {hoverBin && (
                      <>
                        {' · '}held {hoverBin.matched.toLocaleString()} of {hoverBin.editions.toLocaleString()}
                        {' '}({hoverBin.perMille.toFixed(1)}‰, {RATIO_BIN}y bin)
                      </>
                    )}
                  </div>
                )}
              </div>

              <ul className="mt-2 text-xs text-[var(--text-faint)] space-y-0.5 list-disc pl-4">
                <li>
                  Gray bars: {facet ? `${facet.label}-language editions` : 'editions'} per year in the{' '}
                  <a href="https://www.ustc.ac.uk" target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--accent-rust)]">
                    Universal Short Title Catalogue
                  </a>{' '}
                  — European <em>printed</em> output only, including broadsheets and ephemera. The rust
                  line is this corpus&apos;s books per year (its own scale); the green strip is the share
                  of known editions positively matched to a Source Library copy, in {RATIO_BIN}-year bins.
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
