'use client';
// A timeline map (#4922), ported from sourcelibrary-atlas src/components/ThemeMap.tsx. The map,
// work panel and catalogue are drawn by mountTimeline (plain DOM); React owns the shell. The
// data is static JSON under /data/maps/, fetched on mount: no request-path queries.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { mountTimeline, type ThemeData, type LensData, type L2Data, type LayersData } from './timeline';
import type { MapTheme } from '@/lib/explore-maps';
import './theme-map.css';

const getJson = <T,>(url: string): Promise<T | null> =>
  fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);

export default function ThemeMap({ theme }: { theme: MapTheme }) {
  const root = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dispose: (() => void) | undefined; let alive = true;
    const lens = theme.lens ? getJson<LensData>(`/data/maps/lens-${theme.slug}.json`) : Promise.resolve(null);
    const l2 = theme.level2 ? getJson<L2Data>(`/data/maps/${theme.slug}-l2.json`) : Promise.resolve(null);
    const layers = theme.layers ? getJson<LayersData>(`/data/maps/${theme.slug}-layers.json`) : Promise.resolve(null);
    fetch(`/data/maps/${theme.slug}.json`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(async (data: ThemeData) => {
        const [lensData, l2Data, layersData] = await Promise.all([lens, l2, layers]);
        if (!alive || !root.current) return;
        dispose = mountTimeline(root.current, data, { figLabels: theme.figLabels, adjacentLabel: theme.adjacentLabel, l2Topic: theme.l2Topic }, lensData, l2Data, layersData);
        setReady(true);
      })
      .catch((e) => setErr(String(e)));
    return () => { alive = false; dispose?.(); };
  }, [theme]);

  return (
    <div ref={root} className="atlas-map">
      <header className="mast"><div className="wrap">
        <p className="crumbs"><Link href="/explore">Explore</Link> / <Link href="/explore/maps">Maps</Link></p>
        <p className="eyebrow">{theme.eyebrow}</p>
        <h1>A Map of <em>{theme.word}</em></h1>
        <p className="lede">{theme.lede}</p>
        {!ready && <div className="loading">{err ? `Could not load the map data (${err}).` : 'Loading the survey…'}</div>}
        <div className="figs" id="figs"></div>
        {theme.layers && <p className="verdict" id="verdict" hidden></p>}
      </div></header>
      <div className="wrap">
        <div className="controls" role="group" aria-label="Filters">
          <div className="chips">
            <button className="chip" data-st="readable" aria-pressed="true"><span className="sw r"></span>Readable</button>
            <button className="chip" data-st="held" aria-pressed="true"><span className="sw t"></span>Held, not yet readable</button>
            <button className="chip" data-st="absent" aria-pressed="true"><span className="sw g"></span>Not held</button>
          </div>
          <label className="tog" id="adjwrap" hidden><input type="checkbox" id="adj" /> {theme.adjacentLabel || 'Include adjacent works'}</label>
          <input type="search" id="q" placeholder="Search a work, author or tradition" aria-label="Search" />
          <label className="tog lens" id="lenswrap" hidden title="Light up the works whose pages a translator flagged with this concept; the rest fade">Idea <input list="lens-list" id="lens" placeholder="e.g. samādhi, dhikr" aria-label="Highlight works that attest a concept" /><datalist id="lens-list"></datalist></label>
          <span className="count" id="count"></span>
        </div>
        {theme.layers && <div className="layers" id="layers" role="group" aria-label="Layers" hidden></div>}
        {theme.layers && <div className="lynote" id="lynote" hidden></div>}
        <div className="mapbox" id="mapbox"><svg className="map" id="map" role="img" aria-label={`Timeline of ${theme.word.toLowerCase()} literature by tradition`}></svg></div>
        <div className="detail empty" id="detail">{theme.detailHint || 'Click a mark on the map, or a title in the catalogue below, to see the library’s editions of that work.'}</div>
      </div>
      <section className="cat"><div className="wrap">
        <h2>The catalogue</h2>
        <p className="sub">Works in order of composition within each tradition. Every public edition links to its reading page, with its page count and how many pages are translated. A work marked “not held” names the best public-domain copy the surveys could find; ones marked “unsure” were not checked.</p>
        <div id="catalogue"></div>
      </div></section>
      <footer className="site"><div className="wrap">
        <p><b>Method.</b> {theme.method}</p>
        <p><b>Limits.</b> {theme.limits}</p>
      </div></footer>
    </div>
  );
}
