'use client';

// A map of what the books say a figure said or taught. Each dot is one passage (the passages that report a
// saying or teaching, exact repeats collapsed); passages that say similar things sit close together.
// Built by scripts/eval/figure-reception/map.py + prep-map.py (#7073): passages embedded locally with
// nomic-embed-text, laid out in two dimensions with UMAP, grouped with HDBSCAN into themes; theme names were
// written by reading each theme's sample passages. Dots the clustering left unassigned stay grey.
//
// Row shape: [x, y, theme (-1 = unassigned), year, book id, page, passage, title]

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FAMILY_COLOR, fmtYear, useFigureJson, type MapData, type Row } from './data';

const GREY = 'rgba(120,113,108,0.18)';
const YEAR_MIN = 800;
const YEAR_MAX = 1950;

type Props = {
  /** URL of the map.json that prep-map.py wrote. */
  dataUrl: string;
  /** Short name for the canvas label, e.g. "Pythagoras". */
  figure: string;
};

export default function FigureMap({ dataUrl, figure }: Props) {
  const { data, failed } = useFigureJson<MapData>(dataUrl);
  const [theme, setTheme] = useState<number | null>(null);
  const [until, setUntil] = useState(YEAR_MAX);
  const [hover, setHover] = useState<{ r: Row; x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const height = Math.round(width * 0.78);
  const themeById = useMemo(() => new Map((data?.themes ?? []).map((t) => [t.c, t])), [data]);

  // Data bounds → canvas pixels, with a margin so edge dots are not clipped.
  const project = useMemo(() => {
    if (!data) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const r of data.rows) { x0 = Math.min(x0, r[0]); x1 = Math.max(x1, r[0]); y0 = Math.min(y0, r[1]); y1 = Math.max(y1, r[1]); }
    const m = 14;
    return (r: Row): [number, number] => [m + ((r[0] - x0) / (x1 - x0)) * (width - 2 * m), m + ((r[1] - y0) / (y1 - y0)) * (height - 2 * m)];
  }, [data, width, height]);

  const visible = useCallback((r: Row) => (r[3] == null ? until === YEAR_MAX : r[3] <= until), [until]);

  // Label each theme at the median position of its dots.
  const centres = useMemo(() => {
    if (!data || !project) return new Map<number, [number, number]>();
    const acc = new Map<number, number[][]>();
    for (const r of data.rows) if (r[2] >= 0) { const p = project(r); (acc.get(r[2]) ?? acc.set(r[2], []).get(r[2])!).push(p); }
    const med = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1];
    return new Map([...acc].map(([c, ps]) => [c, [med(ps.map((p) => p[0])), med(ps.map((p) => p[1]))] as [number, number]]));
  }, [data, project]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !data || !project) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr; cv.height = height * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const draw = (r: Row, color: string, size: number) => { const [x, y] = project(r); ctx.fillStyle = color; ctx.fillRect(x - size / 2, y - size / 2, size, size); };
    // Unassigned and dimmed first, the highlighted theme last so it sits on top.
    for (const r of data.rows) {
      if (!visible(r)) continue;
      if (r[2] < 0) draw(r, GREY, 2);
      else if (theme != null && r[2] !== theme) draw(r, 'rgba(120,113,108,0.22)', 2);
    }
    for (const r of data.rows) {
      if (!visible(r) || r[2] < 0 || (theme != null && r[2] !== theme)) continue;
      const fam = themeById.get(r[2])?.family ?? '';
      ctx.globalAlpha = theme != null ? 0.95 : 0.7;
      draw(r, FAMILY_COLOR[fam] ?? '#555', theme != null ? 3.5 : 2.5);
      ctx.globalAlpha = 1;
    }
    // Theme labels: the selected one, or the dozen largest when nothing is selected.
    const labelled = theme != null ? data.themes.filter((t) => t.c === theme) : data.themes.slice(0, width < 520 ? 6 : 12);
    ctx.font = `${width < 520 ? 10 : 12}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (const t of labelled) {
      const p = centres.get(t.c); if (!p) continue;
      const label = t.name.length > 34 ? t.name.slice(0, 32) + '…' : t.name;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(250,247,240,0.9)'; ctx.strokeText(label, p[0], p[1]);
      ctx.fillStyle = '#292524'; ctx.fillText(label, p[0], p[1]);
    }
  }, [data, project, width, height, theme, visible, centres, themeById]);

  const nearest = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data || !project) return null;
    const rect = ev.currentTarget.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    let best: Row | null = null, bd = 49;
    for (const r of data.rows) {
      if (!visible(r) || (theme != null && r[2] !== theme)) continue;
      const [x, y] = project(r); const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bd) { bd = d; best = r; }
    }
    return best ? { r: best, x: mx, y: my } : null;
  };

  const samples = useMemo(() => {
    if (!data || theme == null) return [];
    return data.rows.filter((r) => r[2] === theme && visible(r)).sort((a, b) => (a[3] ?? 9999) - (b[3] ?? 9999));
  }, [data, theme, visible]);

  if (failed) return <p className="text-muted italic">The map could not be loaded. Reload the page to try again.</p>;
  if (!data) return <p className="text-muted italic">Loading the map…</p>;

  const shown = data.rows.filter(visible).length;
  const sel = theme != null ? themeById.get(theme) : null;

  return (
    <div className="not-prose flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm text-secondary">
        <label htmlFor={`${figure}-until`} className="font-mono text-xs text-muted">Written by</label>
        <input id={`${figure}-until`} type="range" min={YEAR_MIN} max={YEAR_MAX} step={10} value={until}
          onChange={(e) => setUntil(Number(e.target.value))} className="flex-1 min-w-[10rem] accent-[#b07d1a]" />
        <span className="font-mono text-sm tabular-nums text-primary w-14">{until === YEAR_MAX ? 'all' : until}</span>
        <span className="basis-full font-mono text-xs text-muted">{shown.toLocaleString()} passages shown{sel ? ` · ${sel.name}` : ''}</span>
      </div>

      <div ref={wrapRef} className="relative rounded-md border border-stone-200 bg-[#faf7f0]">
        <canvas ref={canvasRef} style={{ width, height }} className="block cursor-crosshair"
          onMouseMove={(e) => setHover(nearest(e))} onMouseLeave={() => setHover(null)}
          onClick={(e) => { const h = nearest(e); if (h) { if (theme == null && h.r[2] >= 0) setTheme(h.r[2]); else window.open(`/book/${h.r[4]}?page=${h.r[5]}`, '_blank'); } }}
          role="img" aria-label={`Map of passages about ${figure}, grouped by theme`} />
        {hover && (
          <div className="pointer-events-none absolute z-10 max-w-xs rounded border border-stone-300 bg-white/95 p-2.5 text-xs shadow-sm"
            style={{ left: Math.min(hover.x + 12, width - 300), top: Math.min(hover.y + 12, height - 120) }}>
            <div className="font-mono text-accent-gold">{fmtYear(hover.r[3])} · {themeById.get(hover.r[2])?.name ?? 'unassigned'}</div>
            <div className="text-muted mb-1">{hover.r[7]}</div>
            <div className="text-secondary leading-snug">{hover.r[6].slice(0, 200)}{hover.r[6].length > 200 ? '…' : ''}</div>
            <div className="mt-1 font-mono text-[10px] text-muted">{theme == null && hover.r[2] >= 0 ? 'click to select this theme' : `click to open p. ${hover.r[5]}`}</div>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {data.families.map((f) => (
          <div key={f.key} className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted">
              <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: FAMILY_COLOR[f.key] }} />{f.name}
            </div>
            <ul className="mt-1.5 flex flex-col">
              {data.themes.filter((t) => t.family === f.key).map((t) => (
                <li key={t.c}>
                  <button type="button" onClick={() => setTheme(theme === t.c ? null : t.c)}
                    className={`w-full text-left text-sm py-0.5 flex justify-between gap-3 hover:text-primary ${theme === t.c ? 'text-primary font-semibold' : 'text-secondary'}`}>
                    <span className="min-w-0">{t.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">{t.n} · from {fmtYear(t.earliest)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {sel && (
        <div className="rounded-md border border-stone-200 bg-white/70 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xl text-primary">{sel.name}</h3>
            <button type="button" onClick={() => setTheme(null)} className="font-mono text-xs text-muted hover:text-primary">show all themes</button>
          </div>
          <p className="font-mono text-xs text-muted mt-1">{sel.n.toLocaleString()} passages · earliest {fmtYear(sel.earliest)} · half written by {fmtYear(sel.median)}</p>
          <div className="mt-3 flex flex-col gap-3">
            {samples.slice(0, 8).map((r) => (
              <blockquote key={`${r[4]}-${r[5]}`} className="border-l-2 border-accent-gold pl-3 text-sm text-secondary leading-relaxed">
                <span className="font-mono text-xs text-accent-gold mr-2">{fmtYear(r[3])}</span>{r[6]}{' '}
                <a href={`/book/${r[4]}?page=${r[5]}`} className="whitespace-nowrap font-mono text-xs text-muted">{r[7].slice(0, 40)}, p.&nbsp;{r[5]}&nbsp;&rarr;</a>
              </blockquote>
            ))}
            {samples.length > 8 && <p className="font-mono text-xs text-muted">The earliest eight of {samples.length.toLocaleString()} are shown; hover the dots to read the rest.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
