import type { Metadata } from 'next';
import { getReadDb } from '@/lib/mongodb';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import { Bars, HBars, Legend, Panel } from '@/app/admin/DashboardCharts';
import { Grid2, Section } from '@/app/admin/dashboard-layout';
import { SERIES, fmtFull } from '@/app/admin/dashboard-format';
import { ReadersMap } from '@/app/admin/ReadersMap';
import { readMetricsSnapshot } from '@/lib/library-dashboard';
import { countryName, regionOf } from '@/lib/world-regions';
import extract from './monthly-countries.json';

/**
 * About our readers (#8541): what kind of people read Source Library, and where.
 *
 * Sources, each named on the page:
 *  - who they are: metrics_snapshot.introductions, keyword tallies over the
 *    /welcome introductions (counts only), written daily at 05:45 by
 *    scripts/analytics/snapshot-metrics.mjs; and PORTRAITS below, paraphrased by
 *    hand with names, places, ages and institutions removed. Never quote an
 *    introduction here: readers wrote them to us, not for publication;
 *  - where they are: metrics_snapshot.geoReaders and .readersMonthly, from
 *    PostHog (browser-side geolocation; our own `country` was the Cloudflare
 *    edge's until #8532). ./monthly-countries.json is the 2026-11-11 extract,
 *    used only until the snapshot carries readersMonthly.
 *
 * No try/catch around the snapshot read: a failed read must throw so ISR keeps
 * the last good page (rendering-and-seo.md, "a frozen page").
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'About our readers | Source Library',
  description: 'What kind of people read Source Library, in their own words, and where they are, month by month since June 2026.',
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
  { who: 'A stage magician who wants to bring older esoteric knowledge into stage performances' },
  { who: 'An independent researcher comparing Hellenistic astrological texts with biblical ones' },
  { who: 'A speech therapist who writes poetry and essays', lang: 'Spanish' },
  { who: 'A philologist working on Erasmus, Agrippa and emblem books' },
  { who: 'A law student curious about secret societies' },
  { who: 'A symbolist painter drawn to mysticism' },
  { who: 'A Buddhist monk who draws charts of the teachings' },
  { who: 'An economist with an interest in mystical writing' },
  { who: 'A reader who came by way of Spinoza and is now reading Paracelsus', lang: 'Dutch' },
  { who: 'A student of archaeology', lang: 'Persian' },
  { who: 'An engineer who uses the stages of the alchemical work to design AI agents' },
  { who: 'A professor of music theory' },
  { who: 'A retired museum manager who ran digital collections' },
];

// Labels for INTRO_KINDS in snapshot-metrics.mjs. "curious" (no occupation
// given) is always shown last, whatever its size.
const KIND_LABELS: Record<string, string> = {
  student: 'Students',
  academic: 'Researchers and scholars, many independent',
  seeker: 'Spiritual and esoteric seekers',
  practitioner: 'Astrologers, tarot readers, Freemasons, magicians',
  health: 'Therapists, doctors, nurses, herbalists',
  artist: 'Artists, writers, musicians, designers',
  teacher: 'Teachers',
  professional: 'Lawyers, translators, journalists, business people',
  tech: 'Engineers and programmers',
  retired: 'Retired',
  library: 'Librarians, archivists, museum staff',
  clergy: 'Clergy, monks, theologians',
  curious: 'No occupation given: curious readers',
};
const INTEREST_LABELS: Record<string, string> = {
  esoteric: 'Esotericism, magic, mysticism',
  history: 'History',
  science_medicine: 'Science, medicine, plants',
  philosophy: 'Philosophy',
  religion: 'Religion and spirituality',
  hermetic: 'Hermeticism',
  alchemy: 'Alchemy',
  astrology_tarot: 'Astrology, tarot',
  languages: 'Old languages: Latin, Greek, Hebrew, Sanskrit, Arabic',
  kabbalah: 'Kabbalah',
};

const MONTH_REGIONS = ['Latin America', 'North America', 'Europe', 'Asia', 'Other'];
const monthName = (m: string, month: 'short' | 'long') => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month, timeZone: 'UTC' });
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);

function monthlyShares(months: Record<string, Record<string, number>>, current: string) {
  const entries = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
  const label = (m: string) => monthName(m, 'short') + (m === current ? ' (to date)' : '');
  const shares = entries.map(([, counts]) => {
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    const by = new Map<string, number>();
    for (const [cc, n] of Object.entries(counts)) {
      const r = regionOf(cc);
      const key = MONTH_REGIONS.includes(r) ? r : 'Other';
      by.set(key, (by.get(key) ?? 0) + n);
    }
    return (r: string) => (total ? Math.round((1000 * (by.get(r) ?? 0)) / total) / 10 : 0);
  });
  return {
    labels: entries.map(([m]) => label(m)),
    series: MONTH_REGIONS.map((name, i) => ({ name, color: SERIES[i], data: shares.map((s) => s(name)) })),
    top: entries.map(([m, counts]) => ({
      month: label(m),
      countries: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cc]) => countryName(cc)),
    })),
    first: shares[0]?.('Latin America') ?? 0,
    latest: shares[shares.length - 1]?.('Latin America') ?? 0,
    latestMonth: entries[entries.length - 1]?.[0] ?? current,
  };
}

export default async function ReadersPage() {
  const db = await getReadDb();
  const snap = (await readMetricsSnapshot(db))?.data;
  const intro = snap?.introductions;
  const kinds = intro?.kinds
    ? Object.entries(intro.kinds).filter(([k]) => KIND_LABELS[k]).sort((a, b) => (a[0] === 'curious' ? 1 : b[0] === 'curious' ? -1 : b[1] - a[1]))
    : [];
  const interests = intro?.interests
    ? Object.entries(intro.interests).filter(([k]) => INTEREST_LABELS[k]).sort((a, b) => b[1] - a[1])
    : [];
  const geo = snap?.geoReaders;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const m = monthlyShares(snap?.readersMonthly?.months ?? extract.months, currentMonth);

  return (
    <ContentPageLayout maxWidth="wide" className="grid gap-10">
      <header className="grid gap-1.5">
        <h1 className="text-3xl font-semibold text-stone-900">About our readers</h1>
        <p className="text-sm text-stone-600 max-w-3xl">What kind of people read Source Library, in their own words, and where in the world they are. Updated daily.</p>
      </header>

      <Section
        id="who"
        title="Who our readers are"
        intro={<>When readers join, we ask who they are and what draws them here. {intro ? <>{fmtFull(intro.n)} have answered since July 2026.</> : null} Most write in English; others write in Spanish, Dutch, Russian, Persian, Chinese and more.</>}
      >
        <Grid2>
          {intro && kinds.length ? (
            <Panel title="What kind of people they are" note={<>Each introduction is counted once, under the first of these that it mentions, sorted by keyword in English and Spanish. A retired professor counts as a scholar; a student who reads tarot counts as a student. Keyword sorting is rough, so read these as approximate shares.</>}>
              <HBars rows={kinds.map(([k, n]) => ({ label: KIND_LABELS[k], values: [pct(n, intro.n)] }))} suffix="%" labelWidth={250} />
            </Panel>
          ) : null}
          <Panel title="Some of the people who wrote to us" note="Paraphrased from what readers wrote, with names, places and other identifying details removed.">
            <ul className="grid gap-1.5 text-sm text-stone-800">
              {PORTRAITS.map((p) => (
                <li key={p.who}>{p.who}{p.lang ? <span className="text-stone-500"> (written in {p.lang})</span> : null}</li>
              ))}
            </ul>
          </Panel>
          {intro && interests.length ? (
            <Panel title="What draws them" note={<>Share of the {fmtFull(intro.n)} introductions that mention each subject. One introduction can mention several.</>}>
              <HBars rows={interests.map(([k, n]) => ({ label: INTEREST_LABELS[k], values: [pct(n, intro.n)] }))} suffix="%" labelWidth={250} />
            </Panel>
          ) : null}
        </Grid2>
      </Section>

      <Section id="map" title="Where readers are">
        {geo?.countries?.length ? (
          <Grid2>
            <ReadersMap
              countries={geo.countries}
              history={[]}
              audience="public"
              title="Where readers are, last 30 days"
              unit="pages read"
              note={<>Pages read on a phone or reached from a link on another site, which are almost all people; automated traffic arrives directly on a desktop. The location comes from each reader&apos;s own browser. Shading is logarithmic.</>}
            />
          </Grid2>
        ) : (
          <Panel title="The map appears after the next daily update">
            <p className="text-sm text-stone-600 max-w-3xl">The month-by-month record below already shows where readers are.</p>
          </Panel>
        )}
      </Section>

      <Section
        id="months"
        title="Month by month since June 2026"
        intro={<>In June 2026 a video about the library spread on Instagram, and for several weeks most readers were in Latin America and Spain, led by Mexico: Latin America alone was {m.first}% of readers that month. The share has fallen since, to {m.latest}% in {monthName(m.latestMonth, 'long')}, while the shares from the United States and Europe grew.</>}
      >
        <Grid2>
          <Panel title="Share of readers by region" note="Pages read on a phone or reached from another site, by the reader's own location. Source: PostHog.">
            <Legend names={m.series.map((s) => s.name)} colors={m.series.map((s) => s.color)} />
            <Bars labels={m.labels} series={m.series} unit="pct" ariaLabel="Share of readers by region, per month since June 2026" />
          </Panel>
          <Panel title="Top five countries each month">
            <table className="min-w-0 w-full text-sm">
              <tbody>{m.top.map((t) => (
                <tr key={t.month} className="border-t border-stone-100 first:border-t-0">
                  <td className="py-1 pr-3 whitespace-nowrap text-stone-500 align-top">{t.month}</td>
                  <td className="py-1">{t.countries.join(', ')}</td>
                </tr>
              ))}</tbody>
            </table>
          </Panel>
        </Grid2>
      </Section>

      <Section id="method" title="How we count">
        <p className="text-sm text-stone-600 max-w-3xl">Most traffic to a public library site is automated. Some of it runs a full browser and is hard to tell from a person, but it behaves differently: it arrives directly, on a desktop. So the maps and charts count pages read on a phone or reached from a link on another site. This leaves out desktop readers who type the address in. The introductions are a different group: people who made an account and chose to write a line about themselves. Everything on this page is a count; no single reader can be picked out of it.</p>
      </Section>
    </ContentPageLayout>
  );
}
