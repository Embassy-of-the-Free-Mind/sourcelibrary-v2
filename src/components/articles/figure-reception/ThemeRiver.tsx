'use client';

// Theme river: each theme's share of the dated passages in each period, stacked to 100% (#7073). Reads the same
// map.json as FigureMap, so the themes, names and family colours match the map above it. Unassigned (grey) dots
// are left out: the shares are of passages the clustering placed in a theme. Periods with too few passages to
// give a share are dropped, and each period's count is printed under it so a reader can see how thin it is.

import { useEffect, useMemo, useRef, useState } from 'react';
import { area, curveMonotoneX, stack, stackOffsetExpand } from 'd3';
import { FAMILY_COLOR, useFigureJson, type MapData } from './data';

type Bin = { label: string; name: string; from: number; to: number };
const FINE: Bin[] = [
  { label: '<1200', name: 'before 1200', from: -10000, to: 1199 },
  { label: '1200', name: '1200–1449', from: 1200, to: 1449 },
  { label: '1450', name: '1450–1500', from: 1450, to: 1500 },
  ...[1501, 1551, 1601, 1651, 1701, 1751, 1801, 1851].map((y) => ({ label: String(y), name: `${y}–${y + 49}`, from: y, to: y + 49 })),
  { label: '1901', name: '1901 onward', from: 1901, to: 10000 },
];
const COARSE: Bin[] = [
  { label: '<1450', name: 'before 1450', from: -10000, to: 1449 },
  ...[1450, 1550, 1650, 1750].map((y) => ({ label: String(y), name: `${y}–${y + 99}`, from: y, to: y + 99 })),
  { label: '1850', name: '1850 onward', from: 1850, to: 10000 },
];
const MIN_PER_BIN = 12;

export default function ThemeRiver({ dataUrl }: { dataUrl: string }) {
  const { data, failed } = useFigureJson<MapData>(dataUrl);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<{ c: number; bin: number } | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const model = useMemo(() => {
    if (!data) return null;
    const dated = data.rows.filter((r) => r[2] >= 0 && r[3] != null);
    const all = dated.length > 4000 ? FINE : COARSE;
    const counts = all.map(() => new Map<number, number>());
    const totals = all.map(() => 0);
    for (const r of dated) {
      const b = all.findIndex((x) => r[3]! >= x.from && r[3]! <= x.to);
      counts[b].set(r[2], (counts[b].get(r[2]) ?? 0) + 1);
      totals[b]++;
    }
    const keep = all.map((_, i) => i).filter((i) => totals[i] >= MIN_PER_BIN);
    // Families in their own order, themes within a family largest first, so each family is one block of colour.
    const order = data.families.flatMap((f) => data.themes.filter((t) => t.family === f.key).map((t) => t.c));
    const table = keep.map((i) => Object.fromEntries(order.map((c) => [c, counts[i].get(c) ?? 0])) as Record<number, number>);
    const series = stack<Record<number, number>, number>().keys(order).offset(stackOffsetExpand)(table);
    return { bins: keep.map((i) => all[i]), totals: keep.map((i) => totals[i]), series, dropped: all.length - keep.length };
  }, [data]);

  if (failed) return <p className="text-muted italic">The chart could not be loaded. Reload the page to try again.</p>;
  if (!data || !model) return <p className="text-muted italic">Loading the chart…</p>;

  const narrow = width < 520;
  const height = narrow ? 260 : 320;
  const padX = 6;
  const x = (i: number) => padX + (i / Math.max(1, model.bins.length - 1)) * (width - 2 * padX);
  const y = (v: number) => v * height;
  const themeById = new Map(data.themes.map((t) => [t.c, t]));
  const shade = new Map<number, number>();
  for (const f of data.families) data.themes.filter((t) => t.family === f.key).forEach((t, i) => shade.set(t.c, i % 2));
  const path = area<[number, number] & { data: Record<number, number> }>()
    .x((_, i) => x(i)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(curveMonotoneX);

  const active = pinned ?? hover?.c ?? null;
  const binAt = (clientX: number, el: Element) => {
    const px = clientX - el.getBoundingClientRect().left;
    return Math.max(0, Math.min(model.bins.length - 1, Math.round(((px - padX) / (width - 2 * padX)) * (model.bins.length - 1))));
  };
  const info = (() => {
    if (active == null) return null;
    const t = themeById.get(active);
    if (!t) return null;
    const s = model.series.find((k) => k.key === active)!;
    const bin = hover?.c === active ? hover.bin : s.reduce((best, d, i) => (d[1] - d[0] > s[best][1] - s[best][0] ? i : best), 0);
    const share = s[bin][1] - s[bin][0];
    return { t, bin, share, n: Math.round(share * model.totals[bin]) };
  })();

  return (
    <figure className="not-prose flex flex-col gap-3">
      <div className="min-h-[3.25rem] text-sm">
        {info ? (
          <>
            <div className="text-primary font-semibold">
              <i className="inline-block h-2.5 w-2.5 rounded-sm mr-2 align-[-1px]" style={{ background: FAMILY_COLOR[info.t.family] }} />
              {info.t.name}
            </div>
            <div className="font-mono text-xs text-muted">
              {Math.round(info.share * 100)}% of the passages written {model.bins[info.bin].name} ({info.n} of {model.totals[info.bin]})
              {pinned != null && <button type="button" onClick={() => setPinned(null)} className="ml-3 hover:text-primary">clear</button>}
            </div>
          </>
        ) : (
          <div className="font-mono text-xs text-muted pt-1">{narrow ? 'Tap' : 'Hover'} a band to see which story it is; {narrow ? 'tap again to clear' : 'click to keep it'}.</div>
        )}
      </div>
      <div ref={wrapRef} className="relative">
        <svg width={width} height={height} className="block touch-pan-y" role="img"
          aria-label="Share of passages in each theme, by period"
          onPointerLeave={() => setHover(null)}>
          {model.series.map((s) => {
            const t = themeById.get(s.key);
            const fam = t?.family ?? '';
            const dim = active != null && active !== s.key;
            return (
              <path key={s.key} d={path(s as never) ?? ''} fill={FAMILY_COLOR[fam] ?? '#888'}
                fillOpacity={dim ? 0.18 : shade.get(s.key) ? 0.62 : 0.9} stroke="#faf7f0" strokeWidth={0.6}
                className="cursor-pointer"
                onPointerMove={(e) => setHover({ c: s.key, bin: binAt(e.clientX, e.currentTarget.ownerSVGElement!) })}
                onClick={() => setPinned(pinned === s.key ? null : s.key)}>
                <title>{t?.name}</title>
              </path>
            );
          })}
          {info && <line x1={x(info.bin)} x2={x(info.bin)} y1={0} y2={height} stroke="#292524" strokeOpacity={0.35} strokeDasharray="2 3" pointerEvents="none" />}
        </svg>
        <div className="relative h-8 mt-1 font-mono text-[10px] text-muted">
          {model.bins.map((b, i) => (
            <span key={b.label} className="absolute -translate-x-1/2 text-center whitespace-nowrap"
              style={{ left: Math.min(Math.max(x(i), 14), width - 14) }}>
              {narrow && i % 2 ? '' : b.label}
              <span className="block text-[9px] opacity-80">{narrow && i % 2 ? '' : `n=${model.totals[i]}`}</span>
            </span>
          ))}
        </div>
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
        {data.families.map((f) => (
          <span key={f.key}><i className="inline-block h-2.5 w-2.5 rounded-sm mr-1.5 align-[-1px]" style={{ background: FAMILY_COLOR[f.key] }} />{f.name}</span>
        ))}
        {model.dropped > 0 && <span className="basis-full">Periods with fewer than {MIN_PER_BIN} passages in a theme are left out.</span>}
      </figcaption>
    </figure>
  );
}
