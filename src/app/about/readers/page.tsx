import type { Metadata } from 'next';
import { getReadDb } from '@/lib/mongodb';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import { Bars, HBars, Legend, Panel } from '@/app/admin/DashboardCharts';
import { Grid2, Section } from '@/app/admin/dashboard-layout';
import { SERIES, fmtFull } from '@/app/admin/dashboard-format';
import { ReadersMap } from '@/app/admin/ReadersMap';
import { readMetricsSnapshot } from '@/lib/library-dashboard';
import { countryName, regionOf } from '@/lib/world-regions';
import monthly from './monthly-countries.json';

/**
 * About our readers (#8541): where readers are and who they say they are.
 *
 * Three sources, each named on the page:
 *  - the map: metrics_snapshot.geo, written daily at 05:45 by
 *    scripts/analytics/snapshot-metrics.mjs, counted only from the #8532
 *    release, when `country` became the reader's and not the Cloudflare edge's;
 *  - month by month: ./monthly-countries.json, a one-off PostHog
 *    extract (browser-side geolocation, unaffected by #8531), June 2026 onward;
 *  - introductions: keyword tallies from the same snapshot (counts only) and
 *    the PORTRAITS below, paraphrased by hand with names, places, ages and
 *    institutions removed. Never quote an introduction here: readers wrote them
 *    to us, not for publication.
 *
 * No try/catch around the snapshot read: a failed read must throw so ISR keeps
 * the last good page (rendering-and-seo.md, "a frozen page").
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'About our readers | Source Library',
  description: 'Where the people reading Source Library are, month by month since June 2026, and what they tell us about themselves when they join.',
  alternates: { canonical: '/about/readers' },
};

const PORTRAITS: { who: string; lang?: string }[] = [
  { who: 'A retired archaeologist and Egyptologist', lang: 'Dutch' },
  { who: 'A nurse interested in plants and old remedies', lang: 'Spanish' },
  { who: 'A librarian studying how alchemy shaped Jungian psychology' },
  { who: 'A theologian researching Comenius for a book' },
  { who: 'A student of Sanskrit, reading from the Veda to the commentaries on the Yoga Sutras' },
  { who: 'An herbalist looking for the earliest references to plants, from Dioscorides to Culpeper' },
  { who: 'A computer science student who wants to read Rashid al-Din’s history of the Mongols', lang: 'Chinese' },
  { who: 'An independent researcher comparing Hellenistic astrological texts with biblical ones' },
  { who: 'A philologist working on Erasmus, Agrippa and emblem books' },
  { who: 'A symbolist painter drawn to mysticism' },
  { who: 'A Buddhist monk who draws charts of the teachings' },
  { who: 'An archivist reading Platonic and Neoplatonic philosophy' },
  { who: 'A reader who came by way of Spinoza and is now reading Paracelsus', lang: 'Dutch' },
  { who: 'A student of archaeology', lang: 'Persian' },
  { who: 'An engineer who uses the stages of the alchemical work to design AI agents' },
  { who: 'A historian of music researching metaphysical ideas in American music' },
];

const THEME_LABELS: Record<string, string> = {
  esoteric: 'Esotericism, magic, mysticism',
  student: 'Studying',
  history: 'History',
  science_medicine: 'Science and medicine',
  researcher: 'Research',
  philosophy: 'Philosophy',
  religion: 'Religion and spirituality',
  hermetic: 'Hermeticism',
  artist_writer: 'Art, writing, music',
  alchemy: 'Alchemy',
  healer: 'Healing, therapy, herbs',
  teacher: 'Teaching',
  astrology_tarot: 'Astrology, tarot',
};

const MONTH_REGIONS = ['Latin America', 'North America', 'Europe', 'Asia', 'Other'];
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) + (m === monthly.partialMonth ? ' (to date)' : '');

function monthlyShares() {
  const months = Object.entries(monthly.months as Record<string, Record<string, number>>);
  const shares = months.map(([, counts]) => {
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    const by = new Map<string, number>();
    for (const [cc, n] of Object.entries(counts)) {
      const r = regionOf(cc);
      const key = MONTH_REGIONS.includes(r) ? r : 'Other';
      by.set(key, (by.get(key) ?? 0) + n);
    }
    return { total, share: (r: string) => (total ? Math.round((1000 * (by.get(r) ?? 0)) / total) / 10 : 0) };
  });
  return {
    labels: months.map(([m]) => monthLabel(m)),
    series: MONTH_REGIONS.map((name, i) => ({ name, color: SERIES[i], data: shares.map((s) => s.share(name)) })),
    top: months.map(([m, counts]) => ({ month: monthLabel(m), countries: Object.keys(counts).slice(0, 5) })),
    june: shares[0]?.share('Latin America') ?? 0,
    latest: shares[shares.length - 1]?.share('Latin America') ?? 0,
  };
}

export default async function ReadersPage() {
  const db = await getReadDb();
  const snap = await readMetricsSnapshot(db);
  const geo = snap?.data.geo;
  const intro = snap?.data.introductions;
  const m = monthlyShares();
  const themes = intro
    ? Object.entries(intro.themes).filter(([k]) => THEME_LABELS[k]).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <ContentPageLayout maxWidth="wide" className="grid gap-10">
      <header className="grid gap-1.5">
        <h1 className="text-3xl font-semibold text-stone-900">About our readers</h1>
        <p className="text-sm text-stone-600 max-w-3xl">Where the people reading Source Library are, and what they tell us about themselves when they join. The map updates daily.</p>
      </header>

      <Section id="map" title="Where readers are">
        {geo?.countries?.length ? (
          <Grid2><ReadersMap countries={geo.countries} history={[]} audience="public" since={geo.since} /></Grid2>
        ) : (
          <Panel title="The map starts on 12 November 2026">
            <p className="text-sm text-stone-600 max-w-3xl">Until then our own records placed each reader at the Cloudflare server that answered them, not where they were, so a reader in Mexico was usually counted in the United States. Those records cannot be corrected. The month-by-month record below comes from a second source that did not have this fault.</p>
          </Panel>
        )}
      </Section>

      <Section
        id="months"
        title="Month by month since June 2026"
        intro={<>In June 2026 a video about the library spread on Instagram, and for several weeks most readers were in Latin America and Spain, led by Mexico: Latin America alone was {m.june}% of readers that month. The share has fallen since, to {m.latest}% so far in {monthLabel(monthly.partialMonth).replace(' (to date)', '')}, while the shares from the United States and Europe grew.</>}
      >
        <Grid2>
          <Panel title="Share of readers by region" note={<>Pageviews from phones or from links on other sites, which are almost all people; the location comes from each reader&apos;s browser. Source: PostHog, extracted {monthly.extracted}.</>}>
            <Legend names={m.series.map((s) => s.name)} colors={m.series.map((s) => s.color)} />
            <Bars labels={m.labels} series={m.series} unit="pct" ariaLabel="Share of readers by region, per month since June 2026" />
          </Panel>
          <Panel title="Top five countries each month">
            <table className="min-w-0 w-full text-sm">
              <tbody>{m.top.map((t) => (
                <tr key={t.month} className="border-t border-stone-100 first:border-t-0">
                  <td className="py-1 pr-3 whitespace-nowrap text-stone-500 align-top">{t.month}</td>
                  <td className="py-1">{t.countries.map(countryName).join(', ')}</td>
                </tr>
              ))}</tbody>
            </table>
          </Panel>
        </Grid2>
      </Section>

      <Section
        id="introductions"
        title="In their own words"
        intro={<>When readers join, we ask who they are and what draws them here. {intro ? <>{fmtFull(intro.n)} have answered since July 2026.</> : null} Most write in English; others write in Spanish, Dutch, Russian, Persian, Chinese and more.</>}
      >
        <Grid2>
          <Panel title="Some of the people who wrote to us" note="Paraphrased from what readers wrote, with names, places and other identifying details removed.">
            <ul className="grid gap-1.5 text-sm text-stone-800">
              {PORTRAITS.map((p) => (
                <li key={p.who}>{p.who}{p.lang ? <span className="text-stone-500"> (written in {p.lang})</span> : null}</li>
              ))}
            </ul>
          </Panel>
          {intro && themes.length ? (
            <Panel title="What introductions mention" note={<>Share of the {fmtFull(intro.n)} introductions that mention each theme, by keyword in English or Spanish. One introduction can mention several themes; one that names none is still counted in the total.</>}>
              <HBars rows={themes.map(([k, n]) => ({ label: THEME_LABELS[k], values: [Math.round((100 * n) / intro.n)] }))} suffix="%" labelWidth={190} />
            </Panel>
          ) : null}
        </Grid2>
      </Section>

      <Section id="method" title="How we count">
        <p className="text-sm text-stone-600 max-w-3xl">Most traffic to a public library site is automated. Some of it runs a full browser and is hard to tell from a person, but it behaves differently: it arrives directly, on a desktop, and reads one or two pages. We count a browser as a reader when it came from a link on another site, read three or more pages, or was on a phone. This undercounts desktop readers who type the address and read one page, and it counts one person on two devices twice. The figures on this page are counts by country; no single reader can be picked out of them.</p>
      </Section>
    </ContentPageLayout>
  );
}
