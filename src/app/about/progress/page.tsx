import { Metadata } from 'next';
import type { ObjectId } from 'mongodb';
import { getReadDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';
import { getSiteStats } from '@/lib/site-stats';
import { READABLE_IN_ENGLISH_FILTER } from '@/lib/page-counts';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import { Bars, HBars, Legend, Panel } from '@/app/admin/DashboardCharts';
import { Grid2, Section, Tiles } from '@/app/admin/dashboard-layout';
import { SERIES } from '@/app/admin/dashboard-format';
import { LIBRARY_DASHBOARD_ID, RATES, type LibraryDashboard } from '@/lib/library-dashboard';

export const metadata: Metadata = {
  title: 'Progress | Source Library',
  description: 'How much of Source Library can be read in English, by book, century and language, and how much of early modern European print has been scanned and translated.',
  alternates: { canonical: '/about/progress' },
};

export const revalidate = 60;

// ── Data Loading ──────────────────────────────────────────────────────

interface LanguageStat {
  language: string;
  editions: number;
  with_scan: number;
  pct_scanned: number;
  with_translation: number;
  pct_translated: number;
  in_source_library: number;
  distinct_works: number;
}

interface CoverageData {
  built_at: string;
  total_editions: number;
  total_works: number;
  total_scanned: number;
  total_translated: number;
  total_in_sl: number;
  pct_scanned: number;
  pct_translated: number;
  languages: LanguageStat[];
  source_count: number;
}

async function getCoverageData(): Promise<CoverageData | null> {
  try {
    // Query coverage stats directly from Supabase ustc_editions
    const { data: langRows, error } = await supabase.rpc('get_coverage_stats');

    if (error || !langRows) {
      // Fallback to MongoDB catalog_coverage_meta
      return getCoverageDataFallback();
    }

    const languages: LanguageStat[] = (langRows as any[])
      .map((r: any) => ({
        language: r.language,
        editions: Number(r.editions),
        with_scan: Number(r.with_scan),
        pct_scanned: Number(r.editions) > 0 ? (Number(r.with_scan) / Number(r.editions) * 100) : 0,
        with_translation: Number(r.with_translation),
        pct_translated: Number(r.editions) > 0 ? (Number(r.with_translation) / Number(r.editions) * 100) : 0,
        in_source_library: Number(r.in_sl),
        distinct_works: 0,
      }))
      .sort((a, b) => b.editions - a.editions);

    const totals = languages.reduce((acc, l) => ({
      editions: acc.editions + l.editions,
      scanned: acc.scanned + l.with_scan,
      translated: acc.translated + l.with_translation,
      in_sl: acc.in_sl + l.in_source_library,
    }), { editions: 0, scanned: 0, translated: 0, in_sl: 0 });

    return {
      // The RPC aggregates ustc_editions at request time, but the rows are only
      // as fresh as the last catalog-coverage build — "now" would lie (#5501).
      built_at: await getCoverageBuiltAt(),
      total_editions: totals.editions,
      total_works: 0,
      total_scanned: totals.scanned,
      total_translated: totals.translated,
      total_in_sl: totals.in_sl,
      pct_scanned: totals.editions > 0 ? (totals.scanned / totals.editions * 100) : 0,
      pct_translated: totals.editions > 0 ? (totals.translated / totals.editions * 100) : 0,
      languages,
      source_count: 13,
    };
  } catch {
    return getCoverageDataFallback();
  }
}

/**
 * When scripts/catalog-coverage/build.mjs last loaded ustc_editions (it stamps
 * catalog_coverage_meta in the same run). '' renders as "Unknown".
 */
async function getCoverageBuiltAt(): Promise<string> {
  try {
    const db = await getReadDb();
    const meta = await db.collection('catalog_coverage_meta').findOne(
      { _id: 'latest_build' as any },
      { projection: { built_at: 1, updatedAt: 1 }, maxTimeMS: 5000 },
    );
    const at = meta?.built_at || meta?.updatedAt;
    return at ? new Date(at).toISOString() : '';
  } catch {
    return '';
  }
}

/** Fallback: read from MongoDB catalog_coverage_meta if Supabase RPC fails */
async function getCoverageDataFallback(): Promise<CoverageData | null> {
  try {
    const db = await getReadDb();
    const meta = await db.collection('catalog_coverage_meta').findOne({ _id: 'latest_build' as any });
    if (!meta) return null;

    const stats = meta.stats || {};
    const languages: LanguageStat[] = Object.entries(stats)
      .map(([lang, s]: [string, any]) => ({
        language: lang,
        editions: s.editions || 0,
        with_scan: s.scans || 0,
        pct_scanned: s.editions > 0 ? ((s.scans || 0) / s.editions * 100) : 0,
        with_translation: s.translations || 0,
        pct_translated: s.editions > 0 ? ((s.translations || 0) / s.editions * 100) : 0,
        in_source_library: s.inSL || 0,
        distinct_works: s.distinctWorks || 0,
      }))
      .sort((a, b) => b.editions - a.editions);

    const totals = languages.reduce((acc, l) => ({
      editions: acc.editions + l.editions,
      scanned: acc.scanned + l.with_scan,
      translated: acc.translated + l.with_translation,
      in_sl: acc.in_sl + l.in_source_library,
      works: acc.works + l.distinct_works,
    }), { editions: 0, scanned: 0, translated: 0, in_sl: 0, works: 0 });

    return {
      built_at: meta.built_at || meta.updatedAt || '',
      total_editions: totals.editions,
      total_works: totals.works,
      total_scanned: totals.scanned,
      total_translated: totals.translated,
      total_in_sl: totals.in_sl,
      pct_scanned: totals.editions > 0 ? (totals.scanned / totals.editions * 100) : 0,
      pct_translated: totals.editions > 0 ? (totals.translated / totals.editions * 100) : 0,
      languages,
      source_count: 13,
    };
  } catch {
    return null;
  }
}

// ── Live Source Library Stats ─────────────────────────────────────────

/**
 * Headline book counts from the translation ladder's named views
 * (.claude/docs/translation-state.md): `readable_in_english` — the same view
 * as the homepage, /census and /admin — and `complete`. Live books only.
 * Both counts are backed by the translation_state_rung_english index.
 */
async function getLadderCounts(): Promise<{ readable: number; complete: number } | null> {
  try {
    const books = (await getReadDb()).collection('books');
    const live = { visible: true, pages_count: { $gt: 0 } };
    const [readable, complete] = await Promise.all([
      books.countDocuments({ ...live, ...READABLE_IN_ENGLISH_FILTER }, { maxTimeMS: 10000 }),
      books.countDocuments({ ...live, 'translation_state.rung': 'complete' }, { maxTimeMS: 10000 }),
    ]);
    return { readable, complete };
  } catch {
    return null;
  }
}

/**
 * Per-book completion from the nightly library snapshot
 * (scripts/analytics/snapshot-library-dashboard.mjs → system_config.library_dashboard).
 * One projected findOne, no aggregation on request. Null when the snapshot
 * predates the completion fields, so the section is left out rather than
 * drawn with zeros.
 */
async function getCompletion() {
  try {
    const doc = await (await getReadDb()).collection('system_config').findOne(
      { _id: LIBRARY_DASHBOARD_ID as unknown as ObjectId },
      { projection: { completion: 1, byCentury: 1, languagesAll: 1, finish: 1, works: 1, 'totals.readableLive': 1, 'totals.live': 1 }, maxTimeMS: 5000 },
    ) as Partial<LibraryDashboard> | null;
    if (!doc?.completion?.books || !doc.languagesAll?.length || !doc.totals?.live?.books) return null;
    return {
      completion: doc.completion,
      century: doc.byCentury ?? [],
      languages: doc.languagesAll,
      liveBooks: doc.totals.live.books,
      livePages: doc.totals.live.pages,
      liveTranslatedPages: doc.totals.live.translated,
      readable: doc.totals.readableLive,
      finish: doc.finish ?? null,
      works: doc.works ?? null,
    };
  } catch {
    return null;
  }
}

// ── Page ──────────────────────────────────────────────────────────────
// Laid out like /admin (#5757): number tiles first, then one titled section per
// question, each chart in a Panel with a one-line note. Same chart components.

const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((100 * part) / whole) : 0);
const millions = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : fmt(n));
const usd = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${Math.round(n)}`);
/** Model cost of transcribing `o` pages and translating `t`, low to high, at the September 2026 rates. */
const costRange = (o: number, t: number) => `${usd(o * RATES.ocr[0] + t * RATES.tr[0])} – ${usd(o * RATES.ocr[1] + t * RATES.tr[1])}`;

type CompletionData = NonNullable<Awaited<ReturnType<typeof getCompletion>>>;

function LibrarySections({ c, readable, complete, firstTranslations }: { c: CompletionData; readable: number; complete: number | null; firstTranslations: number }) {
  const C = c.completion, n = C.bins;
  const binLabel = (i: number) => (i === 0 ? '0–5' : i === n - 1 ? '95–100' : `${(100 * i) / n}`);
  const trNone = C.translated[0], trFull = C.translated[n - 1], trMid = C.books - trNone - trFull;
  const ocrNone = C.ocr[0], ocrFull = C.ocr[n - 1];
  const cents = c.century.filter(r => r.books > 0 && r.meanTrPct != null);
  const datedBooks = cents.reduce((a, r) => a + r.books, 0);
  const lagging = cents.filter(r => r.books >= datedBooks / 10).sort((a, b) => (a.meanTrPct ?? 0) - (b.meanTrPct ?? 0))[0];
  const langs = c.languages.filter(l => l.name !== '(none)' && l.name !== 'Unknown');
  const bigTwo = langs.slice(0, 2);
  const th = 'py-1 px-2 font-medium whitespace-nowrap';
  return (
    <>
      <Section id="glance" title="At a glance" intro={<>Counted by pages, {pct(c.liveTranslatedPages, c.livePages)}% of the library is translated. Counted by books it looks different: a book tends to be translated all at once or not at all, so {fmt(readable)} of {fmt(c.liveBooks)} books can be read in English today.</>}>
        <Tiles tiles={[
          { l: 'Books', v: fmt(c.liveBooks), n: `${millions(c.livePages)} pages` },
          { l: 'Pages translated', v: `${pct(c.liveTranslatedPages, c.livePages)}%`, n: `${millions(c.liveTranslatedPages)} pages` },
          { l: 'Readable in English', v: fmt(readable), n: `${pct(readable, c.liveBooks)}% of books` },
          ...(complete != null ? [{ l: 'Fully translated', v: fmt(complete), n: 'every page' }] : []),
          { l: 'First English translations', v: fmt(firstTranslations), n: 'never before in English' },
          ...(c.works ? [{ l: 'Distinct works', v: fmt(c.works.works), n: `${fmt(c.works.readable)} readable in English` }] : []),
        ]} />
      </Section>

      <Section id="books" title="How complete each book is">
        <Panel title="Share of each book's pages done" note={<>Each bar is a 5% band. Translated: <b className="text-stone-900">{fmt(trNone)}</b> books are under 5%, <b className="text-stone-900">{fmt(trMid)}</b> are in between, and <b className="text-stone-900">{fmt(trFull)}</b> are at 95% or more. Transcribed: {fmt(ocrNone)} under 5%, {fmt(ocrFull)} at 95% or more.</>}>
          <Grid2>
            <div className="min-w-0 grid gap-1">
              <div className="text-xs text-stone-600">Pages transcribed, per book ({fmt(C.books)} books)</div>
              <Bars labels={C.ocr.map((_, i) => binLabel(i))} series={[{ name: 'Books', data: C.ocr, color: SERIES[2] }]} height={220} ariaLabel="Histogram of the share of each book's pages transcribed" />
            </div>
            <div className="min-w-0 grid gap-1">
              <div className="text-xs text-stone-600">Pages translated, per book</div>
              <Bars labels={C.translated.map((_, i) => binLabel(i))} series={[{ name: 'Books', data: C.translated, color: SERIES[1] }]} height={220} ariaLabel="Histogram of the share of each book's pages translated" />
            </div>
          </Grid2>
        </Panel>
      </Section>

      {cents.length > 0 && (
        <Section id="century" title="By century">
          <Panel title="Average book, by century of publication" note={<>The {fmt(datedBooks)} books with a known year.{lagging && ` The ${lagging.label.replace(/ c\.$/, '')} century is furthest behind: on average ${Math.round(lagging.meanTrPct ?? 0)}% of a book's pages are translated.`} Hover a century for its numbers.</>}>
            <Legend names={['Pages transcribed', 'Pages translated', 'Books readable in English']} colors={[SERIES[2], SERIES[1], SERIES[0]]} />
            <Bars grouped unit="pct" w={1100} height={240} labels={cents.map(r => r.label)} series={[
              { name: 'Pages transcribed, mean per book', color: SERIES[2], data: cents.map(r => r.meanOcrPct ?? 0) },
              { name: 'Pages translated, mean per book', color: SERIES[1], data: cents.map(r => r.meanTrPct ?? 0) },
              { name: 'Books readable in English', color: SERIES[0], data: cents.map(r => (r.books ? (100 * (r.readable ?? 0)) / r.books : 0)) },
            ]} ariaLabel="Completion by century" />
          </Panel>
        </Section>
      )}

      {langs.length > 0 && (
        <Section id="languages" title="By language" intro={bigTwo.length === 2 ? `${bigTwo[0].name} and ${bigTwo[1].name} make up ${pct(bigTwo[0].books + bigTwo[1].books, C.books)}% of the library, so they decide most of the total. Books written in English count as readable once transcribed.` : undefined}>
          <Panel title="Pages translated, average book" note={`The ${Math.min(20, langs.length)} largest languages. The grey line under each name is how many of its books can be read in English.`}>
            <HBars labelWidth={200} sub suffix="%" colors={[SERIES[1]]} rows={langs.slice(0, 20).map(l => ({ label: l.name, sub: `${fmt(l.readable)} of ${fmt(l.books)} readable`, values: [l.meanTrPct], title: `${l.name}: on average ${l.meanTrPct}% of a book's pages translated; ${fmt(l.readable)} of ${fmt(l.books)} books readable in English` }))} />
            <details className="text-sm">
              <summary className="cursor-pointer text-stone-700">Every language ({fmt(langs.length)})</summary>
              <div className="overflow-x-auto mt-2"><table className="text-xs min-w-[560px] w-full">
                <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 text-right"><th className={`${th} text-left`}>Language</th><th className={th}>Books</th><th className={th}>Pages</th><th className={th}>Pages translated</th><th className={th}>Readable in English</th></tr></thead>
                <tbody>{langs.map(l => (
                  <tr key={l.name} className="border-t border-stone-100 text-right tabular-nums"><td className="py-0.5 px-2 text-left">{l.name}</td><td className="py-0.5 px-2">{fmt(l.books)}</td><td className="py-0.5 px-2">{fmt(l.pages)}</td><td className="py-0.5 px-2">{pct(l.translated, l.pages)}%</td><td className="py-0.5 px-2">{fmt(l.readable)}</td></tr>
                ))}</tbody>
              </table></div>
            </details>
          </Panel>
        </Section>
      )}

      {c.finish && c.works && (
        <Section id="left" title="What finishing would cost" intro={<>Leaving artworks aside, the {fmt(c.works.editions)} books hold about {fmt(c.works.works)} distinct works, and {fmt(c.works.readable)} ({pct(c.works.readable, c.works.works)}%) can already be read in English in at least one edition.</>}>
          <Tiles tiles={[
            { l: 'One readable edition of every work', v: costRange(c.works.toOpenOcrPages, c.works.toOpenTrPages), n: `${fmt(c.works.toOpen)} works · ${millions(c.works.toOpenOcrPages)} pages to transcribe, ${millions(c.works.toOpenTrPages)} to translate` },
            { l: 'Every page of every book', v: costRange(c.finish.ocrPages, c.finish.trPages), n: `${fmt(c.finish.books)} books · ${millions(c.finish.ocrPages)} pages to transcribe, ${millions(c.finish.trPages)} to translate` },
          ]} />
          <p className="text-xs text-stone-500 max-w-3xl leading-snug">
            Model costs only, at the rates paid per page in September 2026: ${RATES.ocr[0]} to ${RATES.ocr[1]} to transcribe, ${RATES.tr[0]} to ${RATES.tr[1]} to translate. Review, storage and staff time are not included. Editions are grouped into works automatically, which misses some matches, so the number of works is an upper bound.
            {c.finish.blockedBooks > 0 && ` ${fmt(c.finish.blockedBooks)} ${c.finish.blockedBooks === 1 ? 'book whose source can no longer be reached is' : 'books whose source can no longer be reached are'} left out.`}
          </p>
        </Section>
      )}
    </>
  );
}

function RenaissanceSection({ data }: { data: CoverageData }) {
  const top = data.languages.filter(l => l.editions >= 1000).slice(0, 12);
  const th = 'py-1 px-2 font-medium whitespace-nowrap';
  return (
    <Section id="renaissance" title="Europe in print, 1450–1700" link={{ href: '/census', label: 'Translation Census' }} intro={<>Beyond our own shelves: of the {fmt(data.total_editions)} editions printed in Europe before 1700, {data.pct_scanned.toFixed(1)}% have a known digital scan and {data.pct_translated.toFixed(1)}% have an English translation. About {fmt(data.total_scanned - data.total_translated)} have been scanned but never translated.</>}>
      <Tiles tiles={[
        { l: 'Editions catalogued', v: fmt(data.total_editions), n: 'Universal Short Title Catalogue' },
        { l: 'Digitally scanned', v: `${data.pct_scanned.toFixed(1)}%`, n: `${fmt(data.total_scanned)} editions` },
        { l: 'Translated to English', v: `${data.pct_translated.toFixed(1)}%`, n: `${fmt(data.total_translated)} editions` },
        { l: 'In Source Library', v: fmt(data.total_in_sl), n: 'editions' },
      ]} />
      <Panel title="By language of printing" note={<>From the <a href="https://www.ustc.ac.uk" className="underline" target="_blank" rel="noopener">Universal Short Title Catalogue</a>, {data.source_count} digital-library scan sources and scholarly translation catalogues.{data.built_at && ` Updated ${new Date(data.built_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`}</>}>
        <div className="overflow-x-auto"><table className="text-xs min-w-[520px] w-full">
          <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 text-right"><th className={`${th} text-left`}>Language</th><th className={th}>Editions</th><th className={th}>Scanned</th><th className={th}>Translated</th><th className={th}>In Source Library</th></tr></thead>
          <tbody>{top.map(l => (
            <tr key={l.language} className="border-t border-stone-100 text-right tabular-nums"><td className="py-1 px-2 text-left">{l.language}</td><td className="py-1 px-2">{fmt(l.editions)}</td><td className="py-1 px-2">{l.pct_scanned.toFixed(1)}%</td><td className="py-1 px-2">{l.pct_translated.toFixed(1)}%</td><td className="py-1 px-2">{fmt(l.in_source_library)}</td></tr>
          ))}</tbody>
        </table></div>
      </Panel>
    </Section>
  );
}

export default async function ProgressPage() {
  const [data, siteStats, ladder, completion] = await Promise.all([getCoverageData(), getSiteStats(), getLadderCounts(), getCompletion()]);
  return (
    <ContentPageLayout maxWidth="wide" className="grid gap-10">
      <header className="grid gap-1.5">
        <h1 className="text-3xl font-semibold text-stone-900">Progress</h1>
        <p className="text-sm text-stone-600 max-w-3xl">How much of Source Library can be read in English, by book, century and language, and how much of early modern European print has been scanned and translated anywhere. Updated daily.</p>
      </header>
      {completion && (
        <LibrarySections
          c={completion}
          readable={ladder?.readable ?? completion.readable}
          complete={ladder?.complete ?? null}
          firstTranslations={siteStats.firstTranslationCount}
        />
      )}
      {data && <RenaissanceSection data={data} />}
      {!completion && !data && <p className="text-sm text-stone-600">Progress figures are not available right now. Check back soon.</p>}
    </ContentPageLayout>
  );
}
