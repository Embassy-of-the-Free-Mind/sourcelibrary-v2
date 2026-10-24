'use client';

// Story family tree (#7073): pick a story, and every dated telling of it is drawn at its year, joined to the most
// similar EARLIER telling from a different work when the two are close enough (tree.json, built by
// scripts/eval/figure-reception/tree.py; the threshold and how it was chosen are documented there). Tellings with
// no close earlier one start a new line. The links measure similar wording, not proven copying, and the page says so.
//
// Layout: one row per passage, in depth-first order from each line's earliest telling, x = year (when it was
// written, not the edition's year: see scripts/eval/figure-reception/dating.py). In a large story, tellings that
// start a line and are never followed are hidden by default (they would be a long column of lone dots).

import { useEffect, useMemo, useRef, useState } from 'react';
import { FAMILY_COLOR, fmtYear, useFigureJson, type MapData, type Row, type TreeData } from './data';
import { DielsTag, useDiels } from './Diels';

const ROW = 9;
const MAX_HEIGHT = 560;
const AXIS = 22;
/** Stories this small show their lone tellings from the start. */
const SMALL = 40;

type Props = {
  mapUrl: string;
  treeUrl: string;
  /** Story keys offered as quick picks, in order; the first is shown on load. Theme stories are "t<theme id>". */
  featured: string[];
  /** diels.json, to mark tellings that retell a Diels entry. */
  dielsUrl?: string;
};

type Laid = { row: Row; parent: number; sim: number; depth: number; y: number; kids: number };

export default function StoryTree({ mapUrl, treeUrl, featured, dielsUrl }: Props) {
  const map = useFigureJson<MapData>(mapUrl);
  const diels = useDiels(dielsUrl);
  const tree = useFigureJson<TreeData>(treeUrl);
  const [key, setKey] = useState(featured[0]);
  const [showLone, setShowLone] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [map.data, tree.data]);

  const story = tree.data?.stories.find((s) => s.key === key) ?? null;
  const themeById = useMemo(() => new Map((map.data?.themes ?? []).map((t) => [t.c, t])), [map.data]);

  // Depth-first order from each root, children by year, so a line of descent reads top to bottom.
  const laid = useMemo(() => {
    if (!story || !map.data) return null;
    const rows = story.rows ?? map.data.rows;
    const kids = new Map<number, number[]>();
    for (const [r, p] of story.nodes) if (p >= 0) (kids.get(p) ?? kids.set(p, []).get(p)!).push(r);
    const info = new Map(story.nodes.map(([r, p, s]) => [r, { p, s }]));
    const out = new Map<number, Laid>();
    let y = 0;
    let lone = 0;
    const visit = (r: number, depth: number) => {
      const ks = kids.get(r) ?? [];
      out.set(r, { row: rows[r], parent: info.get(r)!.p, sim: info.get(r)!.s, depth, y: y++, kids: ks.length });
      for (const k of ks) visit(k, depth + 1);
    };
    for (const [r, p] of story.nodes) {
      if (p >= 0) continue;
      if (!showLone && !kids.has(r)) { lone++; continue; }
      visit(r, 0);
    }
    const years = story.nodes.map(([r]) => rows[r][3] as number);
    const linked = story.nodes.filter(([, p]) => p >= 0).length;
    return { out, rows: y, lone, linked, total: story.nodes.length, y0: Math.min(...years), y1: Math.max(...years) };
  }, [story, map.data, showLone]);

  useEffect(() => setShowLone((story?.nodes.length ?? 0) <= SMALL), [story]);
  useEffect(() => setSel(null), [key, showLone]);

  if (map.failed || tree.failed) return <p className="text-muted italic">The tree could not be loaded. Reload the page to try again.</p>;
  if (!map.data || !tree.data || !story || !laid) return <p className="text-muted italic">Loading the tree…</p>;

  const narrow = width < 520;
  const pad = 10;
  // Years before 1400 are few; give them the first sixth of the width so the crowded centuries get the rest.
  const knee = Math.max(laid.y0, Math.min(1400, laid.y1 - 1));
  const kneeX = laid.y0 < knee ? 0.16 : 0;
  const x = (yr: number) => {
    const f = yr <= knee ? (laid.y0 === knee ? 0 : ((yr - laid.y0) / (knee - laid.y0)) * kneeX) : kneeX + ((yr - knee) / Math.max(1, laid.y1 - knee)) * (1 - kneeX);
    return pad + f * (width - 2 * pad);
  };
  const height = Math.max(laid.rows * ROW + 8, 40);
  const ticks = [laid.y0, ...[-400, 0, 500, 1000, 1200, 1400, 1500, 1600, 1700, 1800, 1900].filter((t) => t > laid.y0 + 40 && t < laid.y1 - 40), laid.y1]
    .filter((t, i, a) => !narrow || i === 0 || i === a.length - 1 || t % 200 === 0);

  const colour = story.theme != null ? FAMILY_COLOR[themeById.get(story.theme)?.family ?? ''] ?? '#8a5a33' : '#b07d1a';
  const chain: Laid[] = [];
  for (let r = sel; r != null && r >= 0; ) {
    const n = laid.out.get(r);
    if (!n) break;
    chain.push(n);
    r = n.parent;
  }
  const inChain = new Set(chain.map((n) => n.row));
  const themes = map.data.families.map((f) => ({ f, ts: map.data!.themes.filter((t) => t.family === f.key) }));
  const keywordStories = tree.data.stories.filter((s) => s.theme == null);
  const pct = Math.round(tree.data.threshold * 100);

  return (
    <div className="not-prose flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {featured.map((k) => {
          const s = tree.data!.stories.find((x) => x.key === k);
          return s ? (
            <button key={k} type="button" onClick={() => setKey(k)}
              className={`rounded-full border px-3 py-1 text-sm ${k === key ? 'border-primary bg-primary text-cream' : 'border-stone-300 text-secondary hover:border-primary'}`}>
              {s.name}
            </button>
          ) : null;
        })}
        <select value={key} onChange={(e) => setKey(e.target.value)} aria-label="Pick any story"
          className="max-w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm text-primary">
          {keywordStories.length > 0 && (
            <optgroup label="Stories">{keywordStories.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</optgroup>
          )}
          {themes.map(({ f, ts }) => (
            <optgroup key={f.key} label={f.name}>{ts.map((t) => <option key={t.c} value={`t${t.c}`}>{t.name}</option>)}</optgroup>
          ))}
        </select>
      </div>

      <p className="font-mono text-xs text-muted">
        {laid.total.toLocaleString()} dated tellings, {fmtYear(laid.y0)}–{fmtYear(laid.y1)}. {laid.linked.toLocaleString()} sit
        close ({pct}% similar or more) to an earlier telling in another work; the rest start a line of their own.
        {laid.lone > 0 && (
          <> {' '}<button type="button" onClick={() => setShowLone(!showLone)} className="underline hover:text-primary">
            {showLone ? 'Hide' : 'Show'} the {laid.lone.toLocaleString()} that no later telling resembles
          </button></>
        )}
      </p>

      <div ref={wrapRef} className="rounded-md border border-stone-200 bg-[#faf7f0]">
        <div className="relative h-[22px] border-b border-stone-200 font-mono text-[10px] text-muted" style={{ height: AXIS }}>
          {ticks.map((t) => (
            <span key={t} className="absolute top-1 -translate-x-1/2 whitespace-nowrap" style={{ left: Math.min(Math.max(x(t), 16), width - 16) }}>{fmtYear(t)}</span>
          ))}
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: MAX_HEIGHT }}>
          {laid.rows === 0 ? (
            <p className="p-4 text-sm text-muted italic">No telling of this story resembles an earlier one closely enough to draw a line.</p>
          ) : (
            <svg width={width} height={height} className="block" role="img"
              aria-label={`Family tree of the tellings of “${story.name}”, by year`}>
              {ticks.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={height} stroke="#e7e5e4" />)}
              {[...laid.out.values()].map((n) => {
                const p = n.parent >= 0 ? laid.out.get(n.parent) : null;
                if (!p) return null;
                const hot = inChain.has(n.row) && inChain.has(p.row);
                const cy = n.y * ROW + 6, py = p.y * ROW + 6;
                return (
                  <path key={`e${n.y}`} d={`M${x(p.row[3]!)},${py} V${cy} H${x(n.row[3]!)}`} fill="none"
                    stroke={hot ? '#292524' : colour} strokeOpacity={hot ? 0.9 : 0.35} strokeWidth={hot ? 1.6 : 1} />
                );
              })}
              {[...laid.out.entries()].map(([r, n]) => (
                <circle key={r} cx={x(n.row[3]!)} cy={n.y * ROW + 6} r={sel === r ? 4.5 : n.parent < 0 ? 3.4 : 2.6}
                  fill={n.parent < 0 ? '#faf7f0' : colour} stroke={sel === r || inChain.has(n.row) ? '#292524' : colour} strokeWidth={n.parent < 0 ? 1.4 : 0.8}
                  className="cursor-pointer" onClick={() => setSel(sel === r ? null : r)}>
                  <title>{`${fmtYear(n.row[3])} · ${n.row[7]}`}</title>
                </circle>
              ))}
            </svg>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 font-mono text-[11px] text-muted">
        <span><svg width="10" height="10" className="inline align-[-1px] mr-1.5"><circle cx="5" cy="5" r="3.4" fill="#faf7f0" stroke={colour} strokeWidth="1.4" /></svg>earliest telling of a line</span>
        <span><svg width="10" height="10" className="inline align-[-1px] mr-1.5"><circle cx="5" cy="5" r="2.6" fill={colour} /></svg>closest to the telling it hangs from</span>
        <span>{narrow ? 'Tap' : 'Click'} a dot to read it and its line back to the start.</span>
      </div>

      {chain.length > 0 && (
        <div className="rounded-md border border-stone-200 bg-white/70 p-4 flex flex-col gap-3">
          {chain.slice(0, 6).map((n, i) => (
            <blockquote key={i} className={`border-l-2 pl-3 text-sm leading-relaxed ${i === 0 ? 'border-accent-gold text-secondary' : 'border-stone-300 text-muted'}`}>
              <span className="font-mono text-xs text-accent-gold mr-2">{fmtYear(n.row[3])}</span>
              {i > 0 && <span className="font-mono text-[11px] mr-2">{chain[i - 1].sim}% like the one above ·</span>}
              {n.row[6]}{' '}
              <a href={`/book/${n.row[4]}?page=${n.row[5]}`} className="break-words font-mono text-xs text-muted">{n.row[7].slice(0, 44)}, p.&nbsp;{n.row[5]}&nbsp;&rarr;</a>
              <DielsTag data={diels} id={n.row[4]} page={n.row[5]} text={n.row[6]} />
            </blockquote>
          ))}
          {chain.length > 6 && <p className="font-mono text-xs text-muted">…and {chain.length - 6} earlier tellings back to the start of this line.</p>}
          {chain.length === 1 && <p className="font-mono text-xs text-muted">This telling starts a line: nothing earlier in the library is close enough to it.</p>}
        </div>
      )}
    </div>
  );
}
