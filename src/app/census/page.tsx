import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getReadDb } from '@/lib/mongodb';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import CensusSearch from './CensusSearch';

export const metadata: Metadata = {
  title: 'Translation Census | Source Library',
  description:
    'A living record of which pre-modern European texts have been translated into English. Validated estimate: ~85% of all early-modern print, and ~93% of Renaissance-composed Latin, has never been Englished.',
  alternates: { canonical: '/census' },
};

export const revalidate = 3600; // 1 hour — census data changes slowly

// ── Validated gap estimates ──────────────────────────────────────────
// From the n=1000 dual-model validation (Gemini grounded-search adjudicator
// over all 1000 + independent Claude cross-check, blind, stratified,
// era post-stratified; 2026-06-22). These are study results, not live counts —
// they change only when the study is re-run. Source of truth:
// .claude/docs/translation-gap-methodology.md + translation-gap-paper.md;
// artifacts in scripts/analysis/eval-data/gap-validation-*.json (#2684).
// Doctrine: quote these with method + CI + denominator; the raw catalog join
// rate appears only as a labeled methodological footnote, never as a headline.
const VALIDATED = {
  allPrintGapPct: 84.9,
  allPrintCI: '82.3–87.3',
  renaissanceGapPct: 93.3,
  renaissanceCI: '91.3–95.2',
  matcherPrecisionPct: 78.7,
  sampleSize: 1000,
  // Shown beside every VALIDATED figure on the page so a reader can see its age (#5501).
  evalDate: 'June 2026',
  crossModelKappa: 0.82,
};

// Work-level census (#7751, October 2026): USTC editions printed 1400-1700 in each
// language, grouped into WORKS by scripts/translation-layer/11-work-graph.mjs
// (leader clustering within an author). Replaces the get_translation_census
// per-language counts, which used ustc_editions.work_cluster_id, a surname +
// first-six-title-words key that split much-printed works (Imitatio Christi:
// 252 editions in 69 "works"). Study results, not live counts: re-run phase 11
// to refresh. catalogued = works with a catalogued external English
// translation (a floor; outside Latin the catalogues are too thin to read as
// a rate, #7769). readable = works readable in English on Source Library.
const WORK_LEVEL = {
  date: 'October 2026',
  languages: [
    { language: 'Latin', editions: 499604, works: 306352, catalogued: 4249, held: 49458, readable: 5243 },
    { language: 'German', editions: 340205, works: 221931, catalogued: 34, held: 22745, readable: 651 },
    { language: 'French', editions: 233563, works: 124168, catalogued: 155, held: 1521, readable: 202 },
    { language: 'Dutch', editions: 113839, works: 74378, catalogued: 8, held: 339, readable: 223 },
    { language: 'Italian', editions: 110331, works: 68819, catalogued: 108, held: 861, readable: 193 },
    { language: 'Spanish', editions: 83510, works: 59582, catalogued: 75, held: 176, readable: 28 },
  ],
};
const WL_WORKS = WORK_LEVEL.languages.reduce((s, l) => s + l.works, 0);
const WL_EDITIONS = WORK_LEVEL.languages.reduce((s, l) => s + l.editions, 0);
const WL_READABLE = WORK_LEVEL.languages.reduce((s, l) => s + l.readable, 0);

// ── Data ─────────────────────────────────────────────────────────────

interface CensusData {
  total_editions: number;
  total_works: number;
  total_translated: number;
  raw_pct_translated: number;
  catalog_records: number;
  // Site-wide canonical counts (system_config.homepage_stats — same source as
  // the homepage; never re-derive these from a parallel query, see #3015)
  sl_first_translations: number;
  sl_books_readable: number;
  // State of our own corpus census (#2933)
  corpus_readable: number;
  corpus_checked: number;
  corpus_checked_pct: number;
  corpus_searched: number | null;
  stats_updated_at: Date | null;
}

async function getCensusData(): Promise<CensusData> {
  const db = await getReadDb();
  const [censusResult, catalogResult, homepageStats] = await Promise.all([
    // Materialized USTC × translation-catalog join, built by
    // scripts/catalog-coverage/build-census.mjs
    supabase.rpc('get_translation_census'),
    supabase.from('translation_catalogs').select('id', { count: 'exact', head: true }),
    db.collection('system_config').findOne({ _id: 'homepage_stats' } as never, { maxTimeMS: 5000 }),
  ]);

  const census = censusResult.data as any;
  // Let a failed load throw: with revalidate=3600, ISR keeps serving the last
  // good page on refresh failure. Rendering a fallback here would cache the
  // fallback instead (the #2974 pattern — don't reintroduce it).
  if (!census?.totals) {
    throw new Error(`Translation census RPC unavailable: ${censusResult.error?.message || 'no totals returned'}`);
  }
  if (!homepageStats?.firstTranslationCount) {
    throw new Error('homepage_stats unavailable — census page needs the canonical site counts');
  }

  const t = census.totals;

  const vc = homepageStats.verification_coverage || {};
  return {
    total_editions: Number(t.total_editions),
    total_works: Number(t.total_works),
    total_translated: Number(t.works_with_translation),
    raw_pct_translated: Number(t.pct_works_translated),
    catalog_records: catalogResult.count ?? 0,
    sl_first_translations: Number(homepageStats.firstTranslationCount),
    sl_books_readable: Number(homepageStats.readableInEnglish ?? homepageStats.translatedToEnglish ?? 0),
    corpus_readable: Number(vc.readable || 0),
    corpus_checked: Number(vc.checked || 0),
    corpus_checked_pct: Number(vc.pct || 0),
    corpus_searched: homepageStats.census_ledger?.booksSearched ?? null,
    stats_updated_at: homepageStats.updatedAt ? new Date(homepageStats.updatedAt) : null,
  };
}

// ── Presentation (tokens shared with /research/translation-gap) ─────

const fmt = (n: number) => n.toLocaleString('en-US');

function Stat({ n, unit, label }: { n: string; unit?: string; label: string }) {
  return (
    <div className="px-5 py-6 border-stone-200 [&:not(:last-child)]:border-r max-sm:[&:nth-child(odd)]:border-r max-sm:[&:nth-child(-n+2)]:border-b">
      <div className="font-serif text-3xl md:text-4xl text-stone-900 tracking-tight">
        {n}
        {unit && <span className="text-amber-800 text-2xl">{unit}</span>}
      </div>
      <div className="font-body text-sm text-stone-500 mt-1.5 leading-snug">{label}</div>
    </div>
  );
}

function Section({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <section className="py-12 border-b border-stone-200">
      <div className="font-body text-xs tracking-[0.16em] uppercase text-amber-700 font-semibold mb-3">{kicker}</div>
      <h2 className="font-serif text-2xl md:text-3xl text-stone-900 mb-4 tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Callout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-6 bg-stone-50 border-l-2 border-amber-600 rounded-r-sm px-5 py-4 text-base text-stone-700">
      <div className="font-body text-xs tracking-wider uppercase text-amber-700 font-semibold mb-1">{label}</div>
      {children}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default async function CensusPage() {
  const data = await getCensusData();
  const asOf = data.stats_updated_at
    ? data.stats_updated_at.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Translation Census"
          subtitle="A living record of which pre-modern European texts have been translated into English, and which never have. The validated answer: most of early-modern thought has never been Englished. We are closing that gap, verifiably."
        />
      }
    >
      <div className="max-w-3xl mx-auto font-body text-stone-700 text-lg leading-relaxed">
        {/* stat band */}
        <div className="grid grid-cols-2 md:grid-cols-4 border border-stone-200 rounded-sm bg-stone-50 my-8">
          <Stat
            n={`${Math.round(WL_WORKS / 1000)}K`}
            label={`distinct works printed 1400 to 1700 in Latin and five vernaculars (${WORK_LEVEL.date})`}
          />
          <Stat
            n={`~${Math.round(100 - VALIDATED.allPrintGapPct)}`}
            unit="%"
            label={`of all early-modern Latin print translated (validated estimate, ${VALIDATED.evalDate})`}
          />
          <Stat
            n={`~${Math.round(100 - VALIDATED.renaissanceGapPct)}`}
            unit="%"
            label={`of Renaissance-composed Latin works translated (validated ${VALIDATED.evalDate})`}
          />
          <Stat
            n={fmt(data.catalog_records)}
            label="translation records federated from 30+ catalogs, counted live"
          />
        </div>

        {/* ── The gap, measured ───────────────────────────────── */}
        <Section kicker="The finding" title="Most of early-modern thought has never been Englished">
          <p className="mb-4">
            Between the invention of the printing press and 1700, European presses produced{' '}
            {fmt(data.total_editions)} recorded editions in Latin, German, French, Italian, Dutch,
            Spanish, and other languages. In Latin and the five largest vernaculars alone, the{' '}
            {fmt(WL_EDITIONS)} editions hold about {fmt(WL_WORKS)} distinct works. The
            intellectual output of the Renaissance, the Reformation, and the Scientific Revolution.
          </p>
          <p className="mb-4">
            How much of it can an English reader actually read? Our validated estimate ({VALIDATED.evalDate}): across{' '}
            <strong>all</strong> early-modern Latin print, <strong>{VALIDATED.allPrintGapPct}%</strong>{' '}
            <span className="text-stone-500">[{VALIDATED.allPrintCI}]</span> has no known English
            translation. Restricted to works actually <em>composed</em> in the Renaissance, not
            reprints of ancient classics, the Latin gap rises to{' '}
            <strong>{VALIDATED.renaissanceGapPct}%</strong>{' '}
            <span className="text-stone-500">[{VALIDATED.renaissanceCI}]</span>: essentially the
            whole of Renaissance Latin thought.
          </p>
          <p>
            These figures come from a blind, stratified validation of n={fmt(VALIDATED.sampleSize)}{' '}
            works ({VALIDATED.evalDate}): a grounded-search adjudicator over the full sample,
            an independent second model cross-checking an overlap set (agreement κ=
            {VALIDATED.crossModelKappa}), post-stratified by composition era. Denominator: the{' '}
            <a
              href="https://www.ustc.ac.uk"
              className="text-amber-800 underline hover:text-amber-900"
              target="_blank"
              rel="noopener noreferrer"
            >
              Universal Short Title Catalogue
            </a>
            &rsquo;s record of European print to 1700.
          </p>
          <Callout label="Why not quote the raw catalog number?">
            A naive join of the USTC against our {fmt(data.catalog_records)} federated translation
            records finds a catalogued English translation for only{' '}
            {(100 * WORK_LEVEL.languages[0].catalogued / WORK_LEVEL.languages[0].works).toFixed(1)}% of
            Latin works. That raw figure{' '}
            <strong>overstates the gap</strong>: translated ancient and medieval classics hide in
            it under divergent titles, and author-level matches inflate the translated side where
            it matters least. The validation run measured both errors and corrected for them,
            which is why we headline the debiased estimates above, with their confidence
            intervals, and treat the raw join only as a lower-bound floor. Full method, data, and
            robustness checks:{' '}
            <Link href="/research/translation-gap" className="text-amber-800 underline hover:text-amber-900">
              The Translation Gap
            </Link>
            .
          </Callout>
        </Section>

        {/* ── Search ──────────────────────────────────────────── */}
        <Section kicker="Look it up" title="Has it been translated?">
          <p className="mb-6 text-stone-600">
            Search by author or title to check whether a pre-1700 work has a known English
            translation, and whether Source Library holds the original.
          </p>
          <CensusSearch editionCount={data.total_editions} catalogCount={data.catalog_records} />
        </Section>

        {/* ── By language ─────────────────────────────────────── */}
        <Section kicker="The map of the gap" title="Editions, works and translations by language">
          <p className="mb-6 text-stone-600">
            Editions are printings; works are the texts, however often they were printed.
            Translation happens to works, so every share on this page is a share of works.
            &ldquo;Catalogued&rdquo; counts works with an English translation we could find and
            match in the federated catalogs: a floor. For Latin the validated sample above shows the
            catalogs see well under half of real translations; for the vernaculars the catalogs are
            still too thin to read as a rate, and we are building that side now. Figures as of{' '}
            {WORK_LEVEL.date}.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="text-left text-stone-800 border-b border-stone-300">
                  <th className="py-2 pr-4 font-medium">Language</th>
                  <th className="py-2 pr-4 font-medium text-right">Editions</th>
                  <th className="py-2 pr-4 font-medium text-right">Works</th>
                  <th className="py-2 pr-4 font-medium text-right">Catalogued in English</th>
                  <th className="py-2 pr-4 font-medium text-right">Held here</th>
                  <th className="py-2 pr-4 font-medium text-right">Readable here</th>
                </tr>
              </thead>
              <tbody>
                {WORK_LEVEL.languages.map(l => (
                  <tr key={l.language} className="border-b border-stone-200 text-stone-700">
                    <td className="py-2 pr-4 text-stone-900">{l.language}</td>
                    <td className="py-2 pr-4 text-right">{fmt(l.editions)}</td>
                    <td className="py-2 pr-4 text-right">{fmt(l.works)}</td>
                    <td className="py-2 pr-4 text-right">{fmt(l.catalogued)}</td>
                    <td className="py-2 pr-4 text-right">{fmt(l.held)}</td>
                    <td className="py-2 pr-4 text-right">
                      {fmt(l.readable)}{' '}
                      <span className="text-stone-400">({(100 * l.readable / l.works).toFixed(2)}%)</span>
                    </td>
                  </tr>
                ))}
                <tr className="text-stone-900 font-semibold">
                  <td className="py-2 pr-4">Six languages</td>
                  <td className="py-2 pr-4 text-right">{fmt(WL_EDITIONS)}</td>
                  <td className="py-2 pr-4 text-right">{fmt(WL_WORKS)}</td>
                  <td className="py-2 pr-4 text-right">{fmt(WORK_LEVEL.languages.reduce((t, l) => t + l.catalogued, 0))}</td>
                  <td className="py-2 pr-4 text-right">{fmt(WORK_LEVEL.languages.reduce((t, l) => t + l.held, 0))}</td>
                  <td className="py-2 pr-4 text-right">{fmt(WL_READABLE)} <span className="text-stone-400 font-normal">({(100 * WL_READABLE / WL_WORKS).toFixed(2)}%)</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-stone-500">
            For every tradition beyond European print, from Hebrew manuscripts to the Tibetan canon,
            see{' '}
            <Link href="/articles/how-much-in-english" className="text-amber-800 underline hover:text-amber-900">
              How much of the written past can you read in English?
            </Link>
          </p>
        </Section>

        {/* ── State of our census (#2933) ─────────────────────── */}
        <Section kicker="The state of the census" title="Verifying our own shelves">
          <p className="mb-6 text-stone-600">
            The census does more than measure the world&rsquo;s catalogs. It runs over our
            own corpus too. Every readable non-English book in Source Library is being put through
            a documented, grounded search for prior English translations, so that every
            &ldquo;first translation&rdquo; claim we make is evidenced, not asserted.
            {asOf && <> Figures as of {asOf}.</>}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 border border-stone-200 rounded-sm bg-stone-50">
            <Stat n={fmt(data.corpus_readable)} label="readable books in the first-translation pool" />
            <Stat
              n={fmt(data.corpus_checked)}
              label={`checked against the catalogs (${data.corpus_checked_pct}% of the pool)`}
            />
            {data.corpus_searched !== null && (
              <Stat n={fmt(data.corpus_searched)} label="books with a documented grounded search on file" />
            )}
            <Stat n={fmt(data.sl_first_translations)} label="verified first English translations, readable now" />
          </div>
          <Callout label="One number, site-wide">
            The first-translation count above is the same canonical figure shown on the{' '}
            <Link href="/" className="text-amber-800 underline hover:text-amber-900">homepage</Link>
            : verified badges on books you can actually read, refreshed nightly. Claims that fail
            verification are demoted; the count only ever reflects the evidence on file.
          </Callout>
        </Section>

        {/* ── Source Library's contribution ───────────────────── */}
        <Section kicker="Closing it" title="Source Library&rsquo;s contribution">
          <p className="mb-6">
            Source Library pairs facsimiles of the originals with complete English translations:{' '}
            {fmt(data.sl_books_readable)} books readable in English so far, including{' '}
            {fmt(data.sl_first_translations)} first-ever English translations. Each one moves a
            work from the untranslated column of this census into the translated one.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/search?first_translation=true"
              className="font-body text-sm font-semibold bg-amber-800 hover:bg-amber-900 text-stone-50 px-6 py-3 rounded-sm transition-colors"
            >
              Browse the first translations
            </Link>
            <Link
              href="/about/progress"
              className="font-body text-sm font-semibold border border-amber-800 text-amber-800 hover:bg-amber-50 px-6 py-3 rounded-sm transition-colors"
            >
              Full progress breakdown
            </Link>
          </div>
        </Section>

        {/* ── Methodology ─────────────────────────────────────── */}
        <Section kicker="How to read the numbers" title="Methodology &amp; caveats">
          <ul className="list-disc pl-5 space-y-2.5 text-base">
            <li>
              <strong>Two kinds of figures.</strong> The headline gap estimates (
              {VALIDATED.allPrintGapPct}% all-print, {VALIDATED.renaissanceGapPct}%
              Renaissance-composed Latin) are debiased measurements with confidence intervals,
              validated in {VALIDATED.evalDate} and unchanged until the study is re-run. The per-language catalogued counts and the raw Latin join rate
              are catalog floors: lower bounds from record matching, useful for shape, not for
              headlines.
            </li>
            <li>
              <strong>&ldquo;Works,&rdquo; not editions.</strong> The USTC records{' '}
              {fmt(data.total_editions)} editions. We group them into works, so that every printing
              of the same text counts once: within each author, an edition joins a work when the
              rare words of its title match that work&rsquo;s own title ({WORK_LEVEL.date}). In
              Latin and the five largest vernaculars that turns {fmt(WL_EDITIONS)} editions into
              about {fmt(WL_WORKS)} works. An earlier key, built from the first six words of each
              title, split much-printed works into dozens of pieces (252 editions of the{' '}
              <em>Imitation of Christ</em> became 69 &ldquo;works&rdquo;), which inflated the count
              of works and, above all, of translated ones. A translation of any edition covers the work.
            </li>
            <li>
              <strong>The catalogs are a floor.</strong> Our {fmt(data.catalog_records)} federated
              records (counted live, growing daily) miss translations buried in dissertations,
              anthologies, and out-of-print editions. The validation step exists precisely to
              measure what the catalogs miss.
            </li>
            <li>
              <strong>Match precision is era-dependent.</strong> Of pipeline-matched
              &ldquo;translated&rdquo; works, {VALIDATED.matcherPrecisionPct}% had a confirmed
              real translation in the {VALIDATED.evalDate} validation, higher for classics, lower for Renaissance titles, which is one
              of the biases the debiased estimates correct.
            </li>
            <li>
              <strong>A human gold standard is pending.</strong> The current estimates rest on two
              independent AI adjudicators in high agreement; a human-scored gold subset is the
              next binding step and may shift the figures within their stated intervals.
            </li>
          </ul>
        </Section>

        {/* ── Data sources ────────────────────────────────────── */}
        <div className="py-10">
          <div className="font-body text-xs tracking-[0.16em] uppercase text-stone-500 font-semibold mb-3">
            Data sources
          </div>
          <p className="font-body text-sm text-stone-500 leading-relaxed">
            Denominator: the Universal Short Title Catalogue (University of St Andrews).
            Translation records federated from the UNESCO Index Translationum, Library of Congress,
            Open Library / Internet Archive, HathiTrust, the Loeb Classical Library, I Tatti and
            Dumbarton Oaks, Brill, Oxford, Cambridge, Yale, Chicago, Penguin Classics, and other
            catalogs and publisher series, {fmt(data.catalog_records)} records at last count.
            Author reconciliation via VIAF, Wikidata, GND, and CERL. Gap estimates validated
            against an n={fmt(VALIDATED.sampleSize)} blind sample, {VALIDATED.evalDate}.{' '}
            Know of a translation we missed?{' '}
            <Link href="/contribute" className="text-amber-800 underline hover:text-amber-900">
              Let us know
            </Link>
            .
          </p>
        </div>
      </div>
    </ContentPageLayout>
  );
}
