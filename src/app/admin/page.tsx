import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { getDb } from '@/lib/mongodb';
import { getSession } from '@/lib/auth-helpers';
import { readFreshDashboardSnapshot } from '@/lib/dashboard-snapshot';
import { getSpendReport, redactForViewer, resolveSpendViewer, type SpendData } from '@/lib/spend-report';
import {
  readHomepageStats, readLibraryDashboard, readMetricsHistory, readMetricsSnapshot,
  type Ladder, type LibraryDashboard, type Rung,
} from '@/lib/library-dashboard';
import {
  Bars, HBars, Legend, LineChart, Panel, PipelineCumulative, RAMP, SERIES,
  dayLabel, fmtFull, fmtK, fmtUsd, monthLabel,
} from './DashboardCharts';

/**
 * /admin — the whole library on one page (#3943, replaces the 2026-05 GitHub-dark
 * client dashboard). Server-rendered from snapshots only (#2980): the hourly
 * dashboard_snapshot, the daily library_dashboard (Hetzner, 05:55 UTC), the daily
 * metrics_snapshot + metrics_history, homepage_stats, and the private spend
 * report for allow-listed viewers (same gate as /admin/spend). Nothing here
 * aggregates on request. Each section links to the detailed page it summarises.
 */
export const metadata: Metadata = { title: 'Dashboard', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmtK(Math.abs(n))}`;
const ago = (ms: number) => ms < 3600e3 ? `${Math.max(1, Math.round(ms / 60e3))} min ago` : ms < 48 * 3600e3 ? `${Math.round(ms / 3600e3)} h ago` : `${Math.round(ms / 86400e3)} days ago`;
const RUNG_NAME: Record<Rung, string> = { no_text: 'No text', transcribing: 'Transcribing', transcribed: 'Transcribed', translating: 'Translating', readable: 'Readable', complete: 'Complete' };
const RATES = { ocr: [0.00106, 0.00138], tr: [0.00058, 0.00174] } as const; // September 2026 measured, per page (ops spend report)
const usdRange = (lo: number, hi: number) => `${fmtUsd(lo)} – ${fmtUsd(hi)}`;

function Section({ id, title, intro, link, children }: { id: string; title: string; intro?: ReactNode; link?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section id={id} className="grid gap-3 content-start min-w-0 scroll-mt-16">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold text-stone-900">{title}</h2>
        {link && <Link href={link.href} className="text-xs text-accent-rust hover:underline">{link.label} →</Link>}
      </div>
      {intro && <p className="text-sm text-stone-600 max-w-3xl leading-snug">{intro}</p>}
      {children}
    </section>
  );
}

function Tiles({ tiles }: { tiles: { l: string; v: string; n?: string; up?: boolean }[] }) {
  return (
    <div className="grid gap-px rounded border border-stone-200 bg-stone-200 overflow-hidden" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
      {tiles.map(t => (
        <div key={t.l} className="bg-white px-4 py-3 grid gap-0.5 content-start min-w-0">
          <div className="text-xs text-stone-600">{t.l}</div>
          <div className="text-2xl font-semibold text-stone-900 leading-tight">{t.v}</div>
          {t.n && <div className={`text-[11px] font-mono ${t.up ? 'text-green-800' : 'text-stone-500'}`}>{t.n}</div>}
        </div>
      ))}
    </div>
  );
}

function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 min-w-0" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))' }}>{children}</div>;
}

const NAV = [['glance', 'At a glance'], ['library', 'The library'], ['pipeline', 'Pipeline'], ['backlog', 'What’s left'], ['spend', 'Spend'], ['readers', 'Readers'], ['storage', 'Storage'], ['defs', 'Definitions']] as const;

function LadderBar({ title, l, rungs }: { title: string; l: Ladder; rungs: Rung[] }) {
  const n = rungs.map(r => (l.other[r] || 0) + (l.en[r] || 0)), tot = n.reduce((a, b) => a + b, 0);
  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-xs text-stone-600"><span>{title}</span><span>{fmtFull(tot)} books</span></div>
      <div className="flex gap-0.5 h-6">
        {rungs.map((r, i) => n[i] > 0 && (
          <div key={r} className="flex items-center justify-center font-mono text-[11px] min-w-0" title={`${RUNG_NAME[r]}: ${fmtFull(n[i])} books (${pct(n[i], tot)})`}
            style={{ flex: `${n[i]} 0 0`, background: RAMP[i], color: i >= 3 ? '#fff' : '#1c1917', borderRadius: i === 0 ? '4px 0 0 4px' : i === rungs.length - 1 ? '0 4px 4px 0' : 0 }}>
            {n[i] / tot >= 0.09 && <span>{fmtK(n[i])}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Missing({ what, how }: { what: string; how: string }) {
  return <div className="rounded border border-amber-200 bg-amber-50 text-amber-900 text-sm px-3 py-2">{what} has not been written yet. {how}</div>;
}

export default async function AdminDashboard() {
  const db = await getDb();
  const session = await getSession();
  const [lib, snap, metricsRead, history, home, spendViewer] = await Promise.all([
    readLibraryDashboard(db), readFreshDashboardSnapshot(db), readMetricsSnapshot(db), readMetricsHistory(db), readHomepageStats(db), resolveSpendViewer(session),
  ]);
  const metrics = metricsRead?.data ?? null, metricsAge = metricsRead?.ageMs ?? null;
  let spend: SpendData | null = null;
  if (spendViewer) { const doc = await getSpendReport(); if (doc) spend = redactForViewer(doc.data, spendViewer); }

  const L: LibraryDashboard | null = lib?.data ?? null;
  const live = L?.totals.live, all = L?.totals.all;
  const days = L?.pipeline.days ?? [];
  const lastDay = days.at(-1), monthAgo = days[Math.max(0, days.length - 31)];
  const latestSpendMonth = spend?.monthly.months.at(-1);
  const monthTotal = (m: { vendors: Record<string, { v: number }> }) => Object.values(m.vendors).reduce((a, c) => a + (c?.v || 0), 0);

  return (
    <main className="px-4 sm:px-6 py-8 max-w-7xl mx-auto grid gap-10">
      <header className="grid gap-1.5">
        <div className="text-[11px] uppercase tracking-wider text-stone-500 font-mono">Source Library · the whole library on one page</div>
        <h1 className="text-3xl font-semibold text-stone-900">Dashboard</h1>
        {live && L && (
          <p className="text-sm text-stone-600 max-w-3xl">
            <b className="text-stone-900">{fmtFull(live.books)} books</b> and <b className="text-stone-900">{fmtK(live.pages)} pages</b> are open to readers{home ? ` in ${home.languageCount} languages` : ''}. <b className="text-stone-900">{fmtFull(L.totals.readableLive)}</b> of those books can be read in English today.
            {metrics && <> {fmtK(metrics.engagement.mau)} people read something in the last 30 days.</>}
            {latestSpendMonth && <> {monthLabel(latestSpendMonth.month)} cost {fmtUsd(monthTotal(latestSpendMonth))} in vendors.</>}
          </p>
        )}
        <p className="text-[11px] text-stone-500 font-mono">
          breakdowns {lib ? ago(lib.ageMs) : 'missing'}{lib?.stale ? ' (stale)' : ''} · totals {snap ? ago(snap.ageMs) : 'missing'} · readers {metricsAge != null ? ago(metricsAge) : 'missing'}
        </p>
      </header>

      <nav className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-[var(--bg-warm,#f7f5f2)]/95 backdrop-blur border-b border-stone-200 flex gap-1 overflow-x-auto text-xs" aria-label="Sections">
        {NAV.map(([id, l]) => <a key={id} href={`#${id}`} className="shrink-0 px-2.5 py-1 rounded-full text-stone-700 hover:bg-stone-200/60">{l}</a>)}
      </nav>

      {/* ───────── At a glance ───────── */}
      <Section id="glance" title="At a glance">
        {!L || !live ? <Missing what="The daily breakdown snapshot" how="On Hetzner: node scripts/analytics/snapshot-library-dashboard.mjs (cron 05:55 UTC)." /> : (
          <Tiles tiles={[
            { l: 'Live books', v: fmtFull(live.books), n: snap ? `${fmtK(snap.data.invisible?.total_books ?? 0)} more hidden · ${fmtK(snap.data.warehouse?.total_books ?? 0)} in the warehouse` : undefined },
            { l: 'Pages readers can open', v: fmtK(live.pages), n: all ? `${fmtK(all.pages)} across every book with pages` : undefined },
            { l: 'Readable in English', v: fmtFull(L.totals.readableLive), n: `${pct(L.totals.readableLive, live.books)} of live books` },
            { l: 'Transcribed', v: pct(live.ocr, live.pages), n: lastDay && monthAgo && lastDay.ocr != null && monthAgo.ocr != null ? `${fmtK(live.ocr)} live pages · ${signed(lastDay.ocr - monthAgo.ocr)} in 30 days (all books)` : `${fmtK(live.ocr)} live pages` },
            { l: 'Translated', v: pct(live.translated, live.pages), n: lastDay && monthAgo && lastDay.translated != null && monthAgo.translated != null ? (lastDay.translated < monthAgo.translated ? `${fmtK(live.translated)} live pages · ${fmtK(monthAgo.translated - lastDay.translated)} withheld in 30 days` : `${fmtK(live.translated)} live pages · ${signed(lastDay.translated - monthAgo.translated)} in 30 days (all books)`) : `${fmtK(live.translated)} live pages` },
            { l: 'First translations', v: fmtFull(home?.firstTranslationCount ?? snap?.data.canon.first_translations ?? 0), n: home?.firstTranslatedWorksProvisional ? `${fmtFull(home.firstTranslatedWorksProvisional)} provisional` : undefined },
            { l: 'Languages', v: String(home?.languageCount ?? '—'), n: home ? `${fmtFull(home.authorCount)} authors` : undefined },
            { l: 'Collections', v: fmtFull(L.totals.visibleCollections), n: home ? `${fmtK(home.illustrationCount)} illustrations · ${fmtK(home.artworkCount)} artworks` : undefined },
            { l: 'Readers, 30 days', v: metrics ? fmtK(metrics.engagement.mau) : '—', n: metrics ? `${fmtFull(metrics.engagement.avgDau)} a day on average` : undefined },
            { l: 'Accounts', v: metrics ? fmtFull(metrics.users.total) : '—', n: metrics ? `${signed(metrics.users.new7)} in 7 days` : undefined, up: !!metrics && metrics.users.new7 > 0 },
            { l: latestSpendMonth ? `Spend, ${monthLabel(latestSpendMonth.month)}` : 'Spend', v: latestSpendMonth ? fmtUsd(monthTotal(latestSpendMonth)) : 'allow-listed', n: latestSpendMonth ? 'vendors, before people' : 'see /admin/spend' },
            { l: 'Open feedback', v: fmtFull(L.totals.feedbackOpen), n: metrics ? `${metrics.social.feedbackUnread} unread` : undefined },
          ]} />
        )}
        <p className="text-xs text-stone-500 max-w-3xl leading-snug">Hidden books are imports waiting for processing or review, duplicates, and takedowns; the warehouse holds imports not yet enrolled in the pipeline. Neither is on the site. Everything below is about live books unless it says otherwise.</p>
      </Section>

      {/* ───────── The library ───────── */}
      {L && live && (
        <Section id="library" title="The library" intro="What readers can open today: live books only (visible, with page images)." link={{ href: '/admin/canon', label: 'Canon detail' }}>
          <Grid2>
            <div className="md:col-span-full min-w-0">
              <Panel title="How far each language has come" note={<>Bar length is pages. {L.noLanguage ? `${fmtFull(L.noLanguage)} live books carry no language. ` : ''}Tibetan is transcribed but its translations are withheld until the OCR is verified.</>}>
                <Legend names={['Translated pages', 'Transcribed, not yet translated', 'No text yet']} colors={[RAMP[4], RAMP[2], RAMP[0]]} />
                <HBars sub colors={[RAMP[4], RAMP[2], RAMP[0]]} labelWidth={170}
                  rows={L.byLanguage.map(r => ({ label: r.name, sub: `${fmtFull(r.books)} books`, values: [r.translated, Math.max(0, r.ocr - r.translated), Math.max(0, r.pages - r.ocr)], title: `${r.name}: ${fmtFull(r.pages)} pages · ${pct(r.translated, r.pages)} translated · ${pct(r.ocr, r.pages)} transcribed` }))} />
              </Panel>
            </div>
            <Panel title="The translation ladder" note={<>Every book sits on one rung (#3402). Readable in English = the last two rungs plus English originals at transcribed or above: {fmtFull(L.totals.readableLive)} live, {fmtFull(L.totals.readableAll)} across every book. {L.ladder.all.unstamped ? `${fmtFull(L.ladder.all.unstamped)} books have no rung stamped yet.` : ''}</>}>
              <div className="grid gap-3">
                <LadderBar title="Live books" l={L.ladder.live} rungs={L.ladder.rungs} />
                <LadderBar title="Every book with pages" l={L.ladder.all} rungs={L.ladder.rungs} />
                <Legend names={L.ladder.rungs.map(r => RUNG_NAME[r])} colors={RAMP} />
              </div>
            </Panel>
            <Panel title="Books by century" note={`By the numeric publication year. ${fmtFull(L.yearMissing)} live books have no year (most of the Chinese canon and many manuscripts) and are not on this chart.`}>
              <Bars labels={L.byCentury.map(c => c.label)} series={[{ name: 'Books', data: L.byCentury.map(c => c.books) }]} height={220} ariaLabel="Live books by century" />
            </Panel>
            <Panel title="Where the scans come from" note={`Books with a named contributing library. ${fmtFull(L.noLibrary)} live books do not name one yet; /libraries is where institutions are credited.`}>
              <HBars rows={L.libraries.map(r => ({ label: r.name, values: [r.books] }))} labelWidth={200} />
            </Panel>
            <Panel title="Largest collections" note="Texts = every visible member; Readable = the subset the collection grid shows (translated or English).">
              <div className="overflow-x-auto"><table className="text-sm min-w-full">
                <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500"><th className="text-left py-1 pr-2 font-medium">Collection</th><th className="text-right py-1 px-2 font-medium">Texts</th><th className="text-right py-1 px-2 font-medium">Readable</th><th className="text-right py-1 pl-2 font-medium">Artworks</th></tr></thead>
                <tbody>{L.collections.map(c => (
                  <tr key={c.slug} className="border-t border-stone-100"><td className="py-1 pr-2"><Link href={`/collections/${c.slug}`} className="hover:underline">{c.name}</Link></td><td className="text-right py-1 px-2 tabular-nums">{fmtFull(c.texts)}</td><td className="text-right py-1 px-2 tabular-nums">{fmtFull(c.readable)}</td><td className="text-right py-1 pl-2 tabular-nums">{c.art ? fmtFull(c.art) : '—'}</td></tr>
                ))}</tbody>
              </table></div>
            </Panel>
            <div className="md:col-span-full min-w-0">
              <Panel title="Books added to the live library, by month" note="By the month each record was created. Most of the June 2026 imports still wait for OCR (see “What’s left”).">
                <Bars labels={L.addedByMonth.map(m => monthLabel(m.month))} series={[{ name: 'Books', data: L.addedByMonth.map(m => m.books) }]} height={200} ariaLabel="Live books by month of creation" />
              </Panel>
            </div>
          </Grid2>
        </Section>
      )}

      {/* ───────── Pipeline ───────── */}
      <Section id="pipeline" title="How the library has grown" intro="Imported (we hold the record), transcribed (we have the text) and translated, day by day since 19 February 2026, across every book with pages. Archived over time is not snapshotted; see /admin/r2-coverage for today's figure." link={{ href: '/admin/pipeline', label: 'Pipeline control' }}>
        {days.length < 2 ? <Missing what="The pipeline day series" how="It is part of the daily breakdown snapshot." /> : (
          <Grid2>
            <div className="md:col-span-full min-w-0">
              <Panel title="Pages at each stage" note="The pipeline's own counters, summed across books, last reading of each day. Drops are explained on the pipeline page: the 31 Mar warehouse migration, the 13 May BPH duplicate hide, the 8 Aug blank-leaf recount, and the September withheld translations.">
                <PipelineCumulative labels={days.map(d => dayLabel(d.day))} series={[
                  { name: 'Imported', data: days.map(d => d.total), color: SERIES[0] }, { name: 'Transcribed', data: days.map(d => d.ocr), color: SERIES[2] }, { name: 'Translated', data: days.map(d => d.translated), color: SERIES[1] },
                ]} />
              </Panel>
            </div>
            <Panel title="Pages added per day" note="7-day average of each day's change. Below zero means pages left the count (duplicates hidden, translations withheld), not that work was undone.">
              <Legend names={['Imported', 'Transcribed', 'Translated']} colors={[SERIES[0], SERIES[2], SERIES[1]]} />
              <LineChart labels={days.map(d => dayLabel(d.day))} series={(['total', 'ocr', 'translated'] as const).map((k, i) => ({ name: ['Imported', 'Transcribed', 'Translated'][i], color: [SERIES[0], SERIES[2], SERIES[1]][i], data: rate(days.map(d => d[k])) }))} ariaLabel="Pages per day by stage" />
            </Panel>
            <Panel title="Books by pipeline stage" note="The status each book carries. “Archive complete” is images saved, waiting for OCR under the spending dial; “needs attention” is a failed stage waiting for a person or a retry.">
              <Legend names={(L?.pipeline.funnel ?? []).map(f => f.replace(/_/g, ' '))} colors={SERIES} />
              <LineChart labels={days.map(d => dayLabel(d.day))} series={(L?.pipeline.funnel ?? []).map((f, i) => ({ name: f.replace(/_/g, ' '), color: SERIES[i % 8], data: days.map(d => d.funnel?.[f] ?? null) }))} ariaLabel="Books by pipeline status over time" />
            </Panel>
          </Grid2>
        )}
      </Section>

      {/* ───────── What's left ───────── */}
      {L && <Backlog L={L} />}

      {/* ───────── Spend ───────── */}
      {spend && latestSpendMonth && (
        <Section id="spend" title="Spend" intro={<>Vendors only, before people. <b className="text-stone-900">{fmtUsd(monthTotal(latestSpendMonth))}</b> in {monthLabel(latestSpendMonth.month)}; {fmtUsd(spend.monthly.months.filter(m => m.month >= '2026-01').reduce((a, m) => a + monthTotal(m), 0))} so far in 2026. Estimated or exported months are marked in the tooltip.</>} link={{ href: '/admin/spend', label: 'Full spend report' }}>
          <Grid2>
            <div className="md:col-span-full min-w-0">
              <Panel title="Monthly cost by vendor" note={`Report generated ${new Date(spend.generated).toISOString().slice(0, 10)}. Not counted: ${spend.monthly.excluded.length} items (v0 seats, GitHub, the other projects sharing the Supabase and Atlas organisations).`}>
                <Legend names={spend.monthly.vendors} />
                <Bars labels={spend.monthly.months.map(m => monthLabel(m.month))} series={spend.monthly.vendors.map(v => ({ name: v, data: spend!.monthly.months.map(m => m.vendors[v]?.v ?? 0) }))} format={n => fmtUsd(n)} valueFormat={n => '$' + Math.round(n).toLocaleString('en-US')} ariaLabel="Monthly spend by vendor" />
              </Panel>
            </div>
            {spend.output && (
              <Panel title="Pages produced per month" note="Pages whose OCR or translation was written that month, from the pages themselves.">
                <Legend names={['Transcribed (OCR)', 'Translated']} colors={[SERIES[2], SERIES[3]]} />
                <Bars labels={spend.output.months.filter(m => m.month >= '2025-12').map(m => monthLabel(m.month))} series={[{ name: 'Transcribed', color: SERIES[2], data: spend.output.months.filter(m => m.month >= '2025-12').map(m => m.ocr_pages) }, { name: 'Translated', color: SERIES[3], data: spend.output.months.filter(m => m.month >= '2025-12').map(m => m.translated_pages) }]} ariaLabel="Pages transcribed and translated per month" />
              </Panel>
            )}
            {L && L.gemini.length > 0 && (
              <Panel title="Model spend per day, by job" note="Metered at the call (gemini_usage_daily), last 90 days, list price before batch discounts and tax. Goes quiet when the pipeline is paused.">
                <Legend names={['OCR', 'Translation', 'Index, summaries, chapters', 'Other']} colors={[SERIES[0], SERIES[1], SERIES[6], SERIES[4]]} />
                <Bars labels={L.gemini.map(d => dayLabel(d.day))} series={[{ name: 'OCR', color: SERIES[0], data: L.gemini.map(d => d.ocr) }, { name: 'Translation', color: SERIES[1], data: L.gemini.map(d => d.translation) }, { name: 'Index, summaries, chapters', color: SERIES[6], data: L.gemini.map(d => d.enrich) }, { name: 'Other', color: SERIES[4], data: L.gemini.map(d => d.other) }]} format={n => fmtUsd(n)} valueFormat={n => '$' + n.toFixed(2)} ariaLabel="Model spend per day by job" />
              </Panel>
            )}
          </Grid2>
        </Section>
      )}

      {/* ───────── Readers ───────── */}
      {metrics && (
        <Section id="readers" title="Readers" intro={<><b className="text-stone-900">{fmtK(metrics.engagement.mau)}</b> people read something in the last 30 days{history[0] ? `, up from ${fmtK(history[0].mau)} when the daily record began on ${dayLabel(history[0].date)}` : ''}. The median session with more than one page lasts <b className="text-stone-900">{Math.floor(metrics.engagement.dwellMedianSec / 60)}m {String(metrics.engagement.dwellMedianSec % 60).padStart(2, '0')}s</b>.</>} link={{ href: '/platform/admin/metrics', label: 'Audience and usage detail' }}>
          <Tiles tiles={[
            { l: 'Unique visitors, 30 days', v: fmtK(metrics.conversion.uniqVisitors), n: `${pct(metrics.conversion.returningVisitors, metrics.conversion.uniqVisitors)} came back on another day` },
            { l: 'Daily readers', v: fmtFull(metrics.engagement.avgDau), n: '14-day average' },
            { l: 'Page views, 7 days', v: fmtK(metrics.deltas.pageviews7.now), n: `${signed(metrics.deltas.pageviews7.now - metrics.deltas.pageviews7.prev)} on the week before`, up: metrics.deltas.pageviews7.now > metrics.deltas.pageviews7.prev },
            { l: 'New accounts, 30 days', v: fmtFull(metrics.users.new30), n: `${metrics.users.new7} in the last 7 days` },
            { l: 'Verified accounts', v: fmtFull(metrics.users.verified), n: `${pct(metrics.users.verified, metrics.users.total)} of ${fmtFull(metrics.users.total)}` },
            { l: 'Downloads, 30 days', v: fmtFull(metrics.missionActions.download), n: `${metrics.missionActions.share} shares · ${metrics.missionActions.cite} citations` },
          ]} />
          <Grid2>
            {history.length > 1 && (
              <Panel title="Monthly and daily readers" note="Unique visitor fingerprints (IP and browser), humans only, recorded daily.">
                <Legend names={['Monthly active (30-day unique)', 'Daily active (14-day average)']} colors={[SERIES[0], SERIES[2]]} />
                <LineChart labels={history.map(h => dayLabel(h.date))} series={[{ name: 'Monthly active', color: SERIES[0], data: history.map(h => h.mau) }, { name: 'Daily active', color: SERIES[2], data: history.map(h => h.avgDau) }]} ariaLabel="Monthly and daily active readers over time" />
              </Panel>
            )}
            {history.length > 1 && (
              <Panel title="Accounts" note={`${fmtFull(metrics.users.everLoggedIn)} accounts have signed in at least once; the verified gap is people who started a sign-up and never confirmed the email.`}>
                <Legend names={['Accounts', 'Email verified']} colors={[SERIES[0], SERIES[6]]} />
                <LineChart labels={history.map(h => dayLabel(h.date))} series={[{ name: 'Accounts', color: SERIES[0], data: history.map(h => h.signupsTotal) }, { name: 'Email verified', color: SERIES[6], data: history.map(h => h.verified) }]} ariaLabel="Accounts and verified accounts over time" />
              </Panel>
            )}
            <Panel title="Page views per day, last 30 days" note="Bots excluded. Spikes line up with newsletter and social pushes.">
              <LineChart labels={metrics.traffic.dailyPageviews.slice(0, -1).map(d => dayLabel(d.date))} series={[{ name: 'Page views', data: metrics.traffic.dailyPageviews.slice(0, -1).map(d => d.hits), fill: true }]} height={200} ariaLabel="Human page views per day" />
            </Panel>
            <Panel title="Sign-ups per day, last 90 days">
              <Bars labels={metrics.series.signupsByDay.slice(0, -1).map(d => dayLabel(d.date))} series={[{ name: 'New accounts', data: metrics.series.signupsByDay.slice(0, -1).map(d => d.n) }]} height={200} ariaLabel="New accounts per day" />
            </Panel>
            <Panel title="What people search for" note={`${fmtFull(metrics.search.human)} human searches in 30 days, ${fmtFull(metrics.search.zeroResult)} with no result. Zero-result queries are mostly truncated typeahead; the named works are acquisition leads.`}>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[['Top queries', metrics.search.topQueries.slice(0, 10)], ['Found nothing', metrics.search.zeroQueries.slice(0, 10)]].map(([t, rows]) => (
                  <table key={t as string} className="min-w-0"><thead><tr className="text-[11px] uppercase tracking-wider text-stone-500"><th className="text-left py-1 font-medium">{t as string}</th><th className="text-right py-1 font-medium">n</th></tr></thead>
                    <tbody>{(rows as { query: string; count: number }[]).map(q => <tr key={q.query} className="border-t border-stone-100"><td className="py-0.5 pr-2 truncate max-w-[220px]">{q.query}</td><td className="py-0.5 text-right tabular-nums">{q.count}</td></tr>)}</tbody></table>
                ))}
              </div>
            </Panel>
            {metrics.readingMembers && (
              <Panel title="How deeply members read" note={`Signed-in members only. ${Math.round(100 * metrics.readingMembers.top10PctPageShare)}% of member page reads come from the top 10% of readers.`}>
                <div className="grid gap-3 text-sm" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                  {[['Readers, 30 days', fmtFull(metrics.readingMembers.users)], ['Reading sessions', fmtFull(metrics.readingMembers.sessions)], ['Books opened', fmtFull(metrics.readingMembers.books)], ['Median pages per session', String(metrics.readingMembers.median)], ['90th percentile', `${metrics.readingMembers.p90} pages`], ['Read 10+ pages', `${fmtFull(metrics.readingMembers.deep + metrics.readingMembers.veryDeep)} sessions`], ['Came back another day', fmtFull(metrics.readingMembers.multiDayUsers)], ['Read more than one book', fmtFull(metrics.readingMembers.multiBookUsers)]].map(([k, v]) => (
                    <div key={k} className="grid gap-0.5"><span className="text-xs text-stone-500">{k}</span><span className="text-lg font-semibold text-stone-900">{v}</span></div>
                  ))}
                </div>
              </Panel>
            )}
          </Grid2>
        </Section>
      )}

      {/* ───────── Storage & pipeline status ───────── */}
      {L && (
        <Section id="storage" title="Storage and pipeline status" link={{ href: '/admin/r2-coverage', label: 'R2 coverage' }}>
          {(() => { const s = history.at(-1)?.storage; return s ? (
            <Tiles tiles={[
              { l: 'Images on R2', v: `${(s.r2_bytes / 1e12).toFixed(1)} TB`, n: `${fmtK(s.r2_objects)} objects` },
              { l: 'Text held', v: `${(s.text_bytes_est / 1e9).toFixed(0)} GB`, n: `OCR and translation, ${fmtK(s.pages_total)} page records` },
              { l: 'Held books', v: fmtFull(L.totals.held), n: 'kept out of every lane on purpose' },
              { l: 'Enriched', v: snap ? fmtFull(snap.data.enrichment.with_summary) : '—', n: snap ? `summaries · ${fmtFull(snap.data.enrichment.with_index)} indexes · ${fmtFull(snap.data.enrichment.with_images)} with images` : undefined },
            ]} />
          ) : null; })()}
          <Grid2>
            <Panel title="Live books by pipeline status" note="The status label a book carries today. It records what last ran, not what the book still needs: thousands of “complete” books still wait for OCR (see “What’s left”).">
              <HBars rows={L.statusLive.slice(0, 10).map(r => ({ label: r.status.replace(/_/g, ' '), values: [r.n] }))} labelWidth={170} />
            </Panel>
          </Grid2>
        </Section>
      )}

      {/* ───────── Definitions ───────── */}
      <Section id="defs" title="What each number means, and where it comes from">
        <div className="rounded border border-stone-200 bg-white p-4">
          <dl className="grid gap-x-5 gap-y-2 text-sm text-stone-700" style={{ gridTemplateColumns: 'minmax(130px, 190px) 1fr' }}>
            {([
              ['Live book', <><code className="font-mono text-xs bg-stone-100 px-1 rounded">visible: true</code> and at least one page image: the public filter every site surface uses. Artworks are counted separately.</>],
              ['Readable in English', <>The translation ladder’s <code className="font-mono text-xs bg-stone-100 px-1 rounded">readable</code> and <code className="font-mono text-xs bg-stone-100 px-1 rounded">complete</code> rungs (90%+ of translatable pages translated, text itself 90%+ transcribed) plus English originals at transcribed or above. One definition for the board, the card and the spend page (#3402); the homepage’s older rule counts preview-only books and is being retired.</>],
              ['Transcribed, translated', <>Sums of the per-book counters <code className="font-mono text-xs bg-stone-100 px-1 rounded">pages_ocr</code> and <code className="font-mono text-xs bg-stone-100 px-1 rounded">pages_translated</code>. A blank leaf never counts as translated (#3747).</>],
              ['Next step', <>The draft rule from #5469, recomputed read-only every night: what each book needs next given its counters, regardless of the status label it carries.</>],
              ['Spend', <>The private spend report the ops repo pushes (vendor invoices, Google Cloud billing export, Atlas CLI). Shown only to the spend allow-list; people and hours never appear here.</>],
              ['Readers', <>The daily metrics snapshot (05:45 UTC) over first-party page-view logs. Sessions are IP plus browser, so a person on two devices is two readers. Bots are filtered by user agent and pace.</>],
              ['Freshness', <>Breakdowns and the pipeline series: daily at 05:55 UTC on Hetzner (<code className="font-mono text-xs bg-stone-100 px-1 rounded">scripts/analytics/snapshot-library-dashboard.mjs</code>). Totals and enrichment: hourly (<code className="font-mono text-xs bg-stone-100 px-1 rounded">/api/cron/dashboard-snapshot</code>). Nothing on this page is computed when you load it.</>],
            ] as [string, ReactNode][]).map(([k, v]) => <div key={k} className="contents"><dt className="font-medium text-stone-900">{k}</dt><dd className="min-w-0 max-w-3xl">{v}</dd></div>)}
          </dl>
        </div>
      </Section>
    </main>
  );
}

/** 7-day average of the day-over-day change; null until four readings exist. */
function rate(series: (number | null)[]): (number | null)[] {
  const d = series.map((v, i) => (i === 0 || v == null || series[i - 1] == null ? null : v - (series[i - 1] as number)));
  return d.map((_, i) => { const w = d.slice(Math.max(0, i - 6), i + 1).filter((x): x is number => x != null); return w.length < 4 ? null : w.reduce((a, b) => a + b, 0) / w.length; });
}

function Backlog({ L }: { L: LibraryDashboard }) {
  const S = L.nextStep.steps;
  const g = (k: string) => S[k] ?? { live: 0, hidden: 0, pages_live: 0, pages_hidden: 0 };
  const enOcr = L.nextStep.ocrBacklog.find(r => r.name === 'English')?.pages ?? 0;
  const ocrPages = g('ocr').pages_live, afterOcr = Math.max(0, ocrPages - enOcr);
  const rows: { key: string | null; name: string; sub: string; pages: number | null; cost: readonly [number, number] | null; lane: string }[] = [
    { key: 'translate:tail', name: 'Translate the last 10%', sub: 'readable, not yet complete', pages: g('translate:tail').pages_live, cost: RATES.tr, lane: 'gap-fill, when nothing fresh waits' },
    { key: 'translate:body', name: 'Translate', sub: 'transcribed, under 90% translated', pages: g('translate:body').pages_live, cost: RATES.tr, lane: 'realtime at priority 90+, else chained batch' },
    { key: 'enrich', name: 'Summary and chapters', sub: 'translation done', pages: null, cost: null, lane: 'enrich worker' },
    { key: 'archive', name: 'Archive images', sub: 'under 90% on R2', pages: g('archive').pages_live, cost: null, lane: 'archive workers, unmetered' },
    { key: 'ocr', name: 'Transcribe (OCR)', sub: 'preview only or no text', pages: ocrPages, cost: RATES.ocr, lane: 'phase 2, selects archive-complete books' },
    { key: null, name: 'Translate after OCR', sub: 'the same books, non-English pages', pages: afterOcr, cost: RATES.tr, lane: 'follows OCR' },
    { key: 'blocked:held', name: 'Held', sub: 'a decision with an issue', pages: null, cost: null, lane: 'none until released' },
  ];
  let tb = 0, tp = 0, lo = 0, hi = 0;
  const rendered = rows.map(r => {
    const b = r.key ? g(r.key).live : null; if (b) tb += b; if (r.pages && r.key !== 'archive') tp += r.pages;
    const c = r.cost && r.pages ? [r.pages * r.cost[0], r.pages * r.cost[1]] : null; if (c) { lo += c[0]; hi += c[1]; }
    return { ...r, b, c };
  });
  const trOnly = [g('translate:body').pages_live + g('translate:tail').pages_live, g('translate:body').live + g('translate:tail').live];
  const order: [string, string][] = [['archive', 'Archive'], ['ocr', 'Transcribe (OCR)'], ['translate:body', 'Translate'], ['translate:tail', 'Translate last 10%'], ['enrich', 'Summary and chapters'], ['done', 'Done'], ['blocked:held', 'Blocked: held'], ['blocked:source_unreachable', 'Blocked: source unreachable'], ['blocked:source_restricted', 'Blocked: source restricted'], ['blocked:source_dead', 'Blocked: source dead'], ['blocked:unstamped', 'Blocked: no rung stamped']];
  const top = L.nextStep.ocrBacklog.slice(0, 8), rest = L.nextStep.ocrBacklog.slice(8).reduce((o, r) => ({ books: o.books + r.books, pages: o.pages + r.pages }), { books: 0, pages: 0 });
  const totOcr = L.nextStep.ocrBacklog.reduce((a, r) => a + r.pages, 0), ch = L.nextStep.ocrBacklog.find(r => r.name === 'Chinese');
  return (
    <Section id="backlog" title="What’s left, and what it costs" link={{ href: '/admin/processing', label: 'Per-book processing table' }}
      intro={<>For books readers can already open, <b className="text-stone-900">{fmtK(ocrPages)} pages</b> still need transcribing and <b className="text-stone-900">{fmtK(trOnly[0])}</b> need translating; translating the newly transcribed pages comes on top. All in, roughly <b className="text-stone-900">{usdRange(lo, hi)}</b> at the September rates, or {Math.round(lo / 300)} to {Math.round(hi / 300)} days at a $300-a-day dial. The cheapest win for readers is translation: about {usdRange(trOnly[0] * RATES.tr[0], trOnly[0] * RATES.tr[1])} covers the {fmtFull(trOnly[1])} live books that only need translating.</>}>
      <Grid2>
        <div className="md:col-span-full min-w-0">
          <Panel title="Next step for the live library" note="Rates are the September 2026 measured rates per page (OCR lite batch $0.00106 to $0.00138; translation lite batch $0.00058 to $0.00174, Flash at the top). Archive and enrichment are unmetered or small. “Translate after OCR” is the same books once their text exists, excluding English.">
            <div className="overflow-x-auto"><table className="text-sm min-w-[640px] w-full">
              <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500"><th className="text-left py-1 pr-2 font-medium">Step</th><th className="text-right py-1 px-2 font-medium">Books</th><th className="text-right py-1 px-2 font-medium">Pages</th><th className="text-right py-1 px-2 font-medium">Cost at today’s rates</th><th className="text-left py-1 pl-2 font-medium">Who does it</th></tr></thead>
              <tbody>{rendered.map(r => (
                <tr key={r.name} className="border-t border-stone-100 align-top"><td className="py-1.5 pr-2">{r.name}<span className="block text-xs text-stone-500">{r.sub}</span></td><td className="py-1.5 px-2 text-right tabular-nums">{r.b != null ? fmtFull(r.b) : '—'}</td><td className="py-1.5 px-2 text-right tabular-nums">{r.pages ? fmtFull(r.pages) : '—'}</td><td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{r.c ? usdRange(r.c[0], r.c[1]) : r.key === 'archive' ? 'unmetered' : r.key === 'enrich' ? 'small' : '—'}</td><td className="py-1.5 pl-2 text-stone-700">{r.lane}</td></tr>
              ))}</tbody>
              <tfoot><tr className="border-t border-stone-300 font-semibold"><td className="py-1.5 pr-2">All steps that spend money</td><td className="py-1.5 px-2 text-right tabular-nums">{fmtFull(tb)}</td><td className="py-1.5 px-2 text-right tabular-nums">{fmtFull(tp)} model pages</td><td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{usdRange(lo, hi)}</td><td /></tr></tfoot>
            </table></div>
          </Panel>
        </div>
        <Panel title="Books by next step" note="Every book with pages. “Done” means transcribed, translated where needed, summarised and chaptered. Blocked books wait on a decision or on a source that no longer answers.">
          <Legend names={['Live', 'Hidden']} colors={[SERIES[0], SERIES[1]]} />
          <HBars colors={[SERIES[0], SERIES[1]]} labelWidth={190} rows={order.filter(([k]) => S[k]).map(([k, l]) => ({ label: l, values: [g(k).live, g(k).hidden], title: `${l}: ${fmtFull(g(k).live)} live · ${fmtFull(g(k).hidden)} hidden` }))} />
        </Panel>
        <Panel title="The OCR backlog by language (live books)" note={<>Pages still to transcribe in live books, by the book’s language.{ch ? ` Chinese is ${pct(ch.pages, totOcr)} of the backlog: ${fmtFull(ch.books)} books, ${fmtK(ch.pages)} pages.` : ''} English pages can take the Internet Archive’s own OCR where it passes.</>}>
          <HBars sub rows={[...top, { name: 'Other', ...rest }].map(r => ({ label: r.name, sub: `${fmtFull(r.books)} books`, values: [r.pages] }))} />
        </Panel>
      </Grid2>
    </Section>
  );
}
