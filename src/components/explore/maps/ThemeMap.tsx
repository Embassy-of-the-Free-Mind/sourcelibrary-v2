'use client';
// A timeline map (#4922), ported from sourcelibrary-atlas src/components/ThemeMap.tsx. The map,
// work panel and catalogue are drawn by mountTimeline (plain DOM); React owns the shell. The
// data is static JSON under /data/maps/, fetched on mount: no request-path queries.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { mountTimeline, type ThemeData, type LensData, type L2Data, type LayersData, type CitedData } from './timeline';
import type { MapTheme } from '@/lib/explore-maps';
import MapViews, { type MapView } from './MapViews';
import './theme-map.css';

const getJson = <T,>(url: string): Promise<T | null> =>
  fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);

/** A concept's sources view (#7646): the map under its conceptual history, the works the history cites ringed. */
export type SourcesOf = { concept: string; title: string; history: string };

export default function ThemeMap({ theme, sources }: { theme: MapTheme; sources?: SourcesOf }) {
  const root = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<MapView>('timeline');
  const [layersData, setLayersData] = useState<LayersData | null>(null);
  const [works, setWorks] = useState<ThemeData['works']>([]);
  const [cited, setCited] = useState<CitedData | null>(null);
  const showView = (v: MapView) => { setView(v); if (v === 'timeline') requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); };
  const showStory = (id: string) => { showView('timeline'); const sel = root.current?.querySelector<HTMLSelectElement>('#lystory'); if (sel) { sel.value = id; sel.dispatchEvent(new Event('change')); } root.current?.querySelector('#mapbox')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  useEffect(() => {
    let dispose: (() => void) | undefined; let alive = true;
    const lens = theme.lens ? getJson<LensData>(`/data/maps/lens-${theme.slug}.json`) : Promise.resolve(null);
    const l2 = theme.level2 ? getJson<L2Data>(`/data/maps/${theme.slug}-l2.json`) : Promise.resolve(null);
    const layers = theme.layers ? getJson<LayersData>(`/data/maps/${theme.slug}-layers.json`) : Promise.resolve(null);
    const citedP = sources ? getJson<CitedData>(`/data/maps/${theme.slug}-cited.json`) : Promise.resolve(null);
    fetch(`/data/maps/${theme.slug}.json`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(async (data: ThemeData) => {
        const [lensData, l2Data, layersData, citedData] = await Promise.all([lens, l2, layers, citedP]);
        if (!alive || !root.current) return;
        setLayersData(layersData); setWorks(data.works); setCited(citedData);
        const ct = sources && citedData ? { data: citedData, base: `${sources.history}/claims`, title: sources.title.toLowerCase() } : null;
        dispose = mountTimeline(root.current, data, { figLabels: theme.figLabels, adjacentLabel: theme.adjacentLabel, l2Topic: theme.l2Topic }, lensData, l2Data, layersData, ct);
        setReady(true);
      })
      .catch((e) => setErr(String(e)));
    return () => { alive = false; dispose?.(); };
  }, [theme, sources?.history]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={root} className="atlas-map">
      <header className="mast"><div className="wrap">
        {sources ? <>
          <p className="crumbs"><Link href="/explore">Explore</Link> / <Link href="/explore/histories">Histories</Link> / <Link href={sources.history}>{sources.title}</Link> / Sources</p>
          <p className="eyebrow">{theme.eyebrow}</p>
          <h1>The sources on <em>{theme.word.toLowerCase()}</em></h1>
          <p className="lede">Every work on {theme.word.toLowerCase()} the library knows of, by tradition and date: what you can read now, what we hold untranslated, what we lack.</p>
          {cited && <p className="purpose-note"><span className="sw c" aria-hidden="true"></span>Ringed in gold: the {Object.keys(cited.works).length} works that <Link href={sources.history}>the history of {sources.title.toLowerCase()}</Link> quotes, in {cited.linked.toLocaleString('en-US')} of its {cited.claims.toLocaleString('en-US')} claims. Click one for the claims.</p>}
        </> : <>
          <p className="crumbs"><Link href="/explore">Explore</Link> / <Link href="/explore/maps">Source surveys</Link></p>
          <p className="eyebrow">{theme.eyebrow}</p>
          <h1>A Map of <em>{theme.word}</em></h1>
          <p className="lede">{theme.lede}</p>
        </>}
        {!ready && <div className="loading">{err ? `Could not load the map data (${err}).` : 'Loading the survey…'}</div>}
        <div className="figs" id="figs"></div>
        {theme.layers && <p className="verdict" id="verdict" hidden></p>}
      </div></header>
      {theme.views && <div className="wrap"><nav className="viewtabs" aria-label="Views">{([['timeline', 'Timeline'], ['stories', 'Stories'], ['semantic', 'Semantic map'], ['river', 'Theme river']] as [MapView, string][]).map(([v, label]) => (
        <button key={v} className="viewtab" aria-pressed={view === v} onClick={() => showView(v)}>{label}</button>))}</nav></div>}
      {theme.views && view !== 'timeline' && <div className="wrap"><MapViews slug={theme.slug} view={view} layers={layersData} onShowStory={showStory}
        workLabel={(k) => { const w = works.find((x) => `${x.n}|||${x.tr}` === k); return w ? { n: w.n, d: w.d } : null; }} /></div>}
      <div hidden={view !== 'timeline'}>
      <div className="wrap">
        <div className="controls" role="group" aria-label="Filters">
          <div className="chips">
            <button className="chip" data-st="readable" aria-pressed="true"><span className="sw r"></span>Readable</button>
            <button className="chip" data-st="held" aria-pressed="true"><span className="sw t"></span>Held, not yet readable</button>
            <button className="chip" data-st="absent" aria-pressed="true"><span className="sw g"></span>Not held</button>
            <button className="chip" id="citedonly" aria-pressed="false" hidden><span className="sw c"></span>Only the works the history cites</button>
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
      </div>
      <footer className="site"><div className="wrap">
        <p><b>Method.</b> {theme.method}</p>
        <p><b>Limits.</b> {theme.limits}</p>
      </div></footer>
    </div>
  );
}
