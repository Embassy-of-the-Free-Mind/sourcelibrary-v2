'use client';

/**
 * Where likely-human readers are (#8522). A choropleth of the 30-day
 * `metrics_snapshot.geo` counts plus a region share table and, once
 * `metrics_history.geoLikely` has accrued, each region's share over time.
 *
 * "Likely human" is defined in scripts/analytics/snapshot-metrics.mjs: a visitor
 * fingerprint that came from another site, read 3+ pages, or used a phone. Raw
 * fingerprint counts are mostly residential-proxy fleets, so they are shown only
 * as a comparison column, never on the map.
 *
 * Geometry: public/geo-countries-110m.json, a GeoJSON FeatureCollection made once
 * from world-atlas 2.0.2 countries-110m (Natural Earth, public domain): ISO
 * alpha-2 written into each country's properties via i18n-iso-countries,
 * coordinates rounded to 0.01 degrees (172 KB, 54 KB gzipped). No runtime
 * topojson dependency. N. Cyprus, Somaliland and Kosovo have no code and stay grey.
 */
import { useEffect, useMemo, useState } from 'react';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { Legend, LineChart, Panel } from './DashboardCharts';
import { RAMP, SERIES, dayLabel, fmtFull } from './dashboard-format';
import { REGION_ORDER, countryName, regionOf } from '@/lib/world-regions';

export interface GeoCountry { country: string; all: number; likely: number; referred: number }
export interface GeoHistoryRow { date: string; geoLikely?: Record<string, number> }

type CountryProps = { iso: string | null; name: string };
const W = 640, H = 330;

/** `audience="public"` (/about/readers) drops the fleet-comparison column and the daily trend, and words the notes for readers. */
export function ReadersMap({ countries, history, audience = 'admin', since }: { countries: GeoCountry[]; history: GeoHistoryRow[]; audience?: 'admin' | 'public'; since?: string }) {
  const pub = audience === 'public';
  const [shapes, setShapes] = useState<Feature<Geometry, CountryProps>[] | null>(null);
  const [hover, setHover] = useState<{ name: string; n: number; all: number } | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/geo-countries-110m.json').then(r => r.json()).then((fc: FeatureCollection<Geometry, CountryProps>) => {
      if (live) setShapes(fc.features);
    }).catch(() => { /* map stays empty; the tables below still render */ });
    return () => { live = false; };
  }, []);

  const byCc = useMemo(() => new Map(countries.map(c => [c.country, c])), [countries]);
  const total = countries.reduce((s, c) => s + c.likely, 0);
  const totalAll = countries.reduce((s, c) => s + c.all, 0);
  const max = Math.max(2, ...countries.filter(c => c.country !== 'unknown').map(c => c.likely));
  // Log scale: the US is ~10x the next country, so a linear ramp leaves the rest of the world blank.
  const shade = (n: number) => n <= 0 ? '#f5f5f4' : RAMP[Math.min(RAMP.length - 1, Math.floor((Math.log10(n) / Math.log10(max)) * RAMP.length))];

  const path = useMemo(() => geoPath(geoNaturalEarth1().fitSize([W, H], { type: 'Sphere' })), []);

  const regions = useMemo(() => {
    const m = new Map<string, { likely: number; all: number }>();
    for (const c of countries) {
      const r = regionOf(c.country); const v = m.get(r) ?? { likely: 0, all: 0 };
      v.likely += c.likely; v.all += c.all; m.set(r, v);
    }
    return REGION_ORDER.filter(r => m.has(r)).map(r => ({ region: r, ...m.get(r)! }));
  }, [countries]);

  // Region share of likely-human visitors per day, from metrics_history (starts the day this shipped).
  const trend = useMemo(() => {
    const rows = history.filter(h => h.geoLikely && Object.keys(h.geoLikely).length);
    const shareOf = (h: GeoHistoryRow, region: string) => {
      const g = h.geoLikely!; const t = Object.values(g).reduce((s, n) => s + n, 0);
      const n = Object.entries(g).filter(([cc]) => regionOf(cc) === region).reduce((s, [, v]) => s + v, 0);
      return t ? Math.round((1000 * n) / t) / 10 : 0;
    };
    const names = ['North America', 'Europe', 'Latin America', 'Asia'];
    return { labels: rows.map(h => dayLabel(h.date)), series: names.map((name, i) => ({ name, color: SERIES[i], data: rows.map(h => shareOf(h, name)) })) };
  }, [history]);

  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '–');

  return (
    <>
      <Panel
        title={pub ? (since ? `Where readers are, since ${new Date(since).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}` : 'Where readers are') : 'Where readers are, last 30 days'}
        right={<span className="text-xs text-stone-500">{hover ? (pub ? `${hover.name}: ${fmtFull(hover.n)}` : `${hover.name}: ${fmtFull(hover.n)} likely human of ${fmtFull(hover.all)} fingerprints`) : `${fmtFull(total)} ${pub ? 'readers' : 'likely-human visitors'}`}</span>}
        note={pub ? <>A reader here is a browser that arrived from another site, read three or more pages, or was on a phone. Automated traffic does none of these, and it is most of what reaches the site. A person on two devices counts twice. Countries come from Cloudflare, which sees each reader&apos;s own connection. Shading is logarithmic; updated daily.</> : <>Likely-human visitors: a browser fingerprint that arrived from another site, read three or more pages, or used a phone. Proxy fleets do none of these; they are desktop, direct and one page deep, and they are most of the {fmtFull(totalAll)} raw fingerprints. A person on two devices counts twice. Shading is logarithmic.</>}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="World map of likely-human visitors by country, last 30 days">
          <path d={path({ type: 'Sphere' }) ?? undefined} fill="#fafaf9" stroke="#e7e5e4" />
          {shapes?.map((f, i) => {
            const c = f.properties.iso ? byCc.get(f.properties.iso) : undefined;
            const n = c?.likely ?? 0;
            return (
              <path key={f.properties.iso ?? `x${i}`} d={path(f) ?? undefined} fill={shade(n)} stroke="#ffffff" strokeWidth={0.5}
                onMouseEnter={() => setHover({ name: f.properties.name, n, all: c?.all ?? 0 })} onMouseLeave={() => setHover(null)}>
                <title>{`${f.properties.name}: ${fmtFull(n)}`}</title>
              </path>
            );
          })}
        </svg>
      </Panel>
      <Panel title="Readers by region" note={pub ? 'Share of readers on the map above.' : 'Share of likely-human visitors. The raw column counts every non-bot fingerprint, fleets included, to show how much the filter removes.'}>
        <table className="min-w-0 w-full text-sm">
          <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500"><th className="text-left py-1 font-medium">Region</th><th className="text-right py-1 font-medium">{pub ? 'readers' : 'likely human'}</th><th className="text-right py-1 font-medium">share</th>{!pub && <th className="text-right py-1 font-medium">raw</th>}</tr></thead>
          <tbody>{regions.map(r => (
            <tr key={r.region} className="border-t border-stone-100"><td className="py-0.5 pr-2">{r.region}</td><td className="py-0.5 text-right tabular-nums">{fmtFull(r.likely)}</td><td className="py-0.5 text-right tabular-nums font-medium">{pct(r.likely, total)}</td>{!pub && <td className="py-0.5 text-right tabular-nums text-stone-500">{fmtFull(r.all)}</td>}</tr>
          ))}</tbody>
        </table>
        <table className="min-w-0 w-full text-sm mt-2">
          <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500"><th className="text-left py-1 font-medium">Top countries</th><th className="text-right py-1 font-medium">{pub ? 'readers' : 'likely human'}</th><th className="text-right py-1 font-medium">from another site</th></tr></thead>
          <tbody>{countries.filter(c => c.country !== 'unknown').slice(0, 12).map(c => (
            <tr key={c.country} className="border-t border-stone-100"><td className="py-0.5 pr-2">{countryName(c.country)}</td><td className="py-0.5 text-right tabular-nums">{fmtFull(c.likely)}</td><td className="py-0.5 text-right tabular-nums text-stone-500">{fmtFull(c.referred)}</td></tr>
          ))}</tbody>
        </table>
      </Panel>
      {!pub && trend.labels.length > 1 && (
        <Panel title="Region share over time" note="Share of each day's likely-human visitors (rolling 24 hours, recorded at 05:45 UTC).">
          <Legend names={trend.series.map(s => s.name)} colors={trend.series.map(s => s.color)} />
          <LineChart labels={trend.labels} series={trend.series} unit="pct" ariaLabel="Share of likely-human visitors by region over time" />
        </Panel>
      )}
    </>
  );
}
