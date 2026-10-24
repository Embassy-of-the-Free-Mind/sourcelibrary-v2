'use client';
// The other views of a map (#7129), beside the timeline: the traced stories (from the map's layers file), a semantic map
// of the pages found by meaning (FigureMap from the figure-reception articles, unchanged) and a theme river of the same
// pages by century (ThemeRiver, unchanged). Data: /data/maps/<slug>-semantic/map.json and semantic-report.json, built
// by scripts/eval/harmony-semantic/ (retrieve.mjs, umap.py, prep-map.py).
// PRIOR ART: src/components/articles/figure-reception/* draws a figure's reception from the same map.json shape; it is
//   reused here as is. Looked in src/components/explore for a story list: none.
import { useEffect, useState } from 'react';
import FigureMap from '@/components/articles/figure-reception/FigureMap';
import ThemeRiver from '@/components/articles/figure-reception/ThemeRiver';
import type { LayersData } from './timeline';

export type MapView = 'timeline' | 'stories' | 'semantic' | 'river';
type Report = { generated: string; threshold: number; probes: { dim: string; probe: string; hits: number; never_name: number; langs: number }[] };

const fmtY = (y: number) => (y < 0 ? `${-y} BCE` : String(y));

export default function MapViews({ slug, view, layers, workLabel, onShowStory }: {
  slug: string; view: MapView; layers: LayersData | null; workLabel: (key: string) => { n: string; d: number } | null; onShowStory: (id: string) => void;
}) {
  const base = `/data/maps/${slug}-semantic`;
  const [report, setReport] = useState<Report | null>(null);
  useEffect(() => { if (view !== 'semantic' || report) return; fetch(`${base}/semantic-report.json`).then((r) => (r.ok ? r.json() : null)).then(setReport).catch(() => {}); }, [view, report, base]);

  if (view === 'stories') {
    if (!layers) return <p className="sub">Loading…</p>;
    return (
      <div className="views stories">
        <p className="sub">Stories about harmony that the library’s books tell again and again, each traced from its earliest telling on this map. Where someone put a story to the test, the result is given with the page that reports it.</p>
        {layers.stories.map((s) => (
          <section key={s.id} className="story">
            <h3>{s.title} {s.tested && <span className={`tested ${s.tested.result}`}>{s.tested.result === 'true' ? 'Tested, and it holds' : 'Tested, and it fails'}</span>}</h3>
            <p>{s.line}</p>
            {s.tested ? <p className="how">{s.tested.how} <a href={`/book/${s.tested.b}?page=${s.tested.p}`} target="_blank" rel="noopener">{s.tested.pl || 'Read the page'}</a>.</p> : <p className="how">It was never put to a test.</p>}
            <ol className="chain">{s.chain.map((k) => ({ k, w: workLabel(k) })).filter((x) => x.w).sort((a, b) => a.w!.d - b.w!.d).map(({ k, w }) => <li key={k}><span className="yr">{fmtY(w!.d)}</span> {w!.n}</li>)}</ol>
            <button className="more" onClick={() => onShowStory(s.id)}>Show it on the timeline</button>
          </section>
        ))}
      </div>
    );
  }
  if (view === 'semantic') {
    const kinds = new Map<string, { hits: number; never: number }>();
    for (const p of report?.probes ?? []) { const k = kinds.get(p.dim) ?? { hits: 0, never: 0 }; k.hits += p.hits; k.never += p.never_name; kinds.set(p.dim, k); }
    return (
      <div className="views semantic">
        <p className="sub">Pages found by meaning, not by word. For each kind of harmony, six plain sentences describe what a page about it would say (“When one string is struck, another string tuned to the same note begins to sound by itself”). Each sentence was compared with every translated page in the library, and the closest pages are drawn here, near pages that say similar things. Most of them never use the word harmony.{report && <> Of the {report.probes.reduce((a, p) => a + p.hits, 0).toLocaleString()} matches, {report.probes.reduce((a, p) => a + p.never_name, 0).toLocaleString()} name neither harmony, sympathy, concord nor consonance.</>}</p>
        <p className="sub">Only translated pages can be found this way, so books not yet translated are missing. The dots are placed by a second, local model; the passage shown for a dot is the part of the page closest in wording to its sentence, and the page itself is one click away. Years are those of the edition, not of the work.</p>
        <FigureMap dataUrl={`${base}/map.json`} figure={slug} />
        {kinds.size > 0 && <p className="sub">Matches that never name the word, by kind: {[...kinds.entries()].map(([k, v]) => `${k} ${Math.round((100 * v.never) / v.hits)}%`).join(' · ')}.</p>}
      </div>
    );
  }
  if (view === 'river') {
    return (
      <div className="views river">
        <p className="sub">The same pages by the date of their edition: which kinds of harmony the library’s pages talk about, period by period, as a share of each period. Each band is one of the sentences above, grouped by kind. Thin periods are dropped, and each period’s count is printed under it.</p>
        <ThemeRiver dataUrl={`${base}/map.json`} />
      </div>
    );
  }
  return null;
}
