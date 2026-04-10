import { Metadata } from 'next';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getDb } from '@/lib/mongodb';
import ContentPageLayout, { SubPageHeader } from '@/components/layout/ContentPageLayout';
import { BookOpen, Languages, Search, BarChart3, Sparkles, ExternalLink } from 'lucide-react';
import CensusSearch from './CensusSearch';

export const metadata: Metadata = {
  title: 'Translation Census | Source Library',
  description: 'The first comprehensive record of which pre-modern European texts have been translated into English. Of 1.4 million editions printed before 1700, less than 2% have known translations.',
  alternates: { canonical: '/census' },
};

export const revalidate = 3600; // 1 hour — census data changes slowly

// ── Data ─────────────────────────────────────────────────────────────

interface CensusLanguage {
  language: string;
  editions: number;
  distinct_works: number;
  estimated_translated: number;
  pct_works_translated: number;
  top_untranslated: { surname: string; works: number }[];
}

interface CensusData {
  total_editions: number;
  total_works: number;
  total_translated: number;
  pct_translated: number;
  catalog_records: number;
  languages: CensusLanguage[];
  sl_first_translations: number;
  sl_books_translated: number;
}

async function getCensusData(): Promise<CensusData | null> {
  try {
    // 1. Get USTC coverage stats from Supabase
    const { data: coverageRows } = await supabase.rpc('get_coverage_stats');

    // 2. Get live SL stats
    const { data: slProgress } = await supabase.rpc('get_sl_progress');

    // 3. Load pre-computed census results (from analysis scripts)
    // These contain the detailed per-language work-level estimates
    let censusJson: any = null;
    try {
      const db = await getDb();
      censusJson = await db.collection('system_config').findOne({ _id: 'census_data' as any });
    } catch { /* census data may not be in DB yet */ }

    // If no DB census data, use the coverage stats directly
    const languages: CensusLanguage[] = [];

    // Pre-computed census data (from scripts/analysis/translation-census-all-languages.mjs)
    // These are the best estimates of work-level translation rates
    const CENSUS_ESTIMATES: Record<string, { works: number; translated: number; topUntranslated: { surname: string; works: number }[] }> = censusJson?.languages || {
      Latin: {
        works: 362263, translated: 3501,
        topUntranslated: [
          { surname: 'Martini', works: 1299 }, { surname: 'Fabricius', works: 763 },
          { surname: 'Bartolus de Saxoferrato', works: 477 }, { surname: 'Goclenius', works: 565 },
        ],
      },
      German: {
        works: 124394, translated: 1032,
        topUntranslated: [
          { surname: 'Sachs', works: 628 }, { surname: 'Spangenberg', works: 554 },
          { surname: 'Olearius', works: 448 }, { surname: 'Dach', works: 384 },
        ],
      },
      French: {
        works: 65266, translated: 1223,
        topUntranslated: [
          { surname: 'Corneille', works: 377 }, { surname: 'Ronsard', works: 187 },
          { surname: 'Du Moulin', works: 246 }, { surname: 'Arnauld', works: 314 },
        ],
      },
      Italian: {
        works: 70284, translated: 642,
        topUntranslated: [
          { surname: 'Croce', works: 909 }, { surname: 'Segneri', works: 291 },
          { surname: 'Cicognini', works: 304 }, { surname: 'Aretino', works: 168 },
        ],
      },
      Dutch: {
        works: 29649, translated: 683,
        topUntranslated: [
          { surname: 'Vondel', works: 293 }, { surname: 'Cats', works: 173 },
          { surname: 'Teellinck', works: 212 }, { surname: 'Goes', works: 279 },
        ],
      },
      Spanish: {
        works: 37484, translated: 323,
        topUntranslated: [
          { surname: 'Calderon de la Barca', works: 294 }, { surname: 'Vega Carpio', works: 178 },
          { surname: 'Guevara', works: 130 }, { surname: 'Salazar', works: 213 },
        ],
      },
      Portuguese: {
        works: 3795, translated: 36,
        topUntranslated: [
          { surname: 'Vieira', works: 87 }, { surname: 'Camoes', works: 25 },
          { surname: 'Carvalho', works: 79 }, { surname: 'Almeida', works: 47 },
        ],
      },
    };

    if (coverageRows) {
      for (const row of coverageRows as any[]) {
        const lang = row.language;
        const census = CENSUS_ESTIMATES[lang];
        if (!census) continue;

        languages.push({
          language: lang,
          editions: Number(row.editions),
          distinct_works: census.works,
          estimated_translated: census.translated,
          pct_works_translated: census.works > 0
            ? +((census.translated / census.works) * 100).toFixed(2)
            : 0,
          top_untranslated: census.topUntranslated,
        });
      }
    }

    // Sort by editions descending
    languages.sort((a, b) => b.editions - a.editions);

    const totalWorks = languages.reduce((s, l) => s + l.distinct_works, 0);
    const totalTranslated = languages.reduce((s, l) => s + l.estimated_translated, 0);
    const totalEditions = languages.reduce((s, l) => s + l.editions, 0);

    const slData = slProgress as any;

    return {
      total_editions: totalEditions,
      total_works: totalWorks,
      total_translated: totalTranslated,
      pct_translated: totalWorks > 0 ? +((totalTranslated / totalWorks) * 100).toFixed(2) : 0,
      catalog_records: 13862,
      languages,
      sl_first_translations: Number(slData?.totals?.first_translations || 0),
      sl_books_translated: Number(slData?.totals?.translated_by_sl || 0),
    };
  } catch (err) {
    console.error('Census data load error:', err);
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function ProgressBar({ value, max, color = 'bg-amber-600' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full bg-stone-200 rounded-full h-2.5 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.max(pct, 0.5)}%` }}
      />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default async function CensusPage() {
  const data = await getCensusData();

  if (!data) {
    return (
      <ContentPageLayout maxWidth="narrow" bg="bg-stone-50">
        <SubPageHeader title="Translation Census" subtitle="Census data is loading..." />
      </ContentPageLayout>
    );
  }

  const gap = data.total_works - data.total_translated;

  return (
    <ContentPageLayout maxWidth="narrow" bg="bg-stone-50">
      <SubPageHeader
        title="The Translation Census"
        subtitle="The first comprehensive record of which pre-modern European texts have been translated into English"
      />

      {/* ── Hero: The Gap ───────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-border-light p-6 md:p-8 mb-6">
        <div className="text-center mb-8">
          <div className="text-5xl md:text-6xl font-bold text-primary mb-2">
            {data.pct_translated}%
          </div>
          <p className="text-secondary text-lg">
            of pre-1700 European works have a known English translation
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="text-center">
            <div className="text-2xl font-semibold text-primary">{fmt(data.total_editions)}</div>
            <div className="text-xs text-stone-500 mt-0.5">editions cataloged</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-primary">{fmt(data.total_works)}</div>
            <div className="text-xs text-stone-500 mt-0.5">distinct works</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-emerald-700">{fmt(data.total_translated)}</div>
            <div className="text-xs text-stone-500 mt-0.5">with English translation</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-stone-400">{fmt(gap)}</div>
            <div className="text-xs text-stone-500 mt-0.5">waiting to be translated</div>
          </div>
        </div>

        <ProgressBar value={data.total_translated} max={data.total_works} color="bg-emerald-600" />
        <div className="flex justify-between text-xs text-stone-400 mt-1.5">
          <span>0%</span>
          <span>{data.pct_translated}% translated</span>
          <span>100%</span>
        </div>
      </section>

      {/* ── The Story ────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-amber-100 rounded-lg">
            <BookOpen className="w-5 h-5 text-amber-700" />
          </div>
          <h2 className="text-xl font-semibold text-primary">The Scale of the Gap</h2>
        </div>
        <div className="prose-content text-secondary text-sm space-y-3">
          <p>
            Between the invention of the printing press (c. 1450) and 1700, European presses
            produced over {fmt(data.total_editions)} recorded editions in Latin, German, French,
            Italian, Dutch, Spanish, Portuguese, and other languages. These represent roughly {fmt(data.total_works)} distinct
            works &mdash; the intellectual output of the Renaissance, Reformation, and Scientific Revolution.
          </p>
          <p>
            Of these, only about {fmt(data.total_translated)} have a known English translation.
            That&apos;s {data.pct_translated}%. The other {(100 - data.pct_translated).toFixed(1)}% &mdash;
            roughly {fmt(gap)} works &mdash; remain inaccessible to English readers.
          </p>
          <p>
            This census is built by joining the <a href="https://www.ustc.ac.uk" className="text-amber-700 hover:underline" target="_blank" rel="noopener noreferrer">Universal Short Title Catalogue</a> ({fmt(data.total_editions)} editions) against {fmt(data.catalog_records)} known
            English translations from UNESCO Index Translationum, Open Library, HathiTrust,
            the Loeb Classical Library, Penguin Classics, Brill, Cambridge University Press, and other sources.
          </p>
        </div>
      </section>

      {/* ── Search ────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-stone-100 rounded-lg">
            <Search className="w-5 h-5 text-stone-600" />
          </div>
          <h2 className="text-xl font-semibold text-primary">Has It Been Translated?</h2>
        </div>
        <p className="text-secondary text-sm mb-4">
          Search by author or title to check whether a pre-1700 work has a known English translation.
        </p>
        <CensusSearch />
      </section>

      {/* ── By Language ──────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-stone-100 rounded-lg">
            <Languages className="w-5 h-5 text-stone-600" />
          </div>
          <h2 className="text-xl font-semibold text-primary">By Language</h2>
        </div>
        <p className="text-secondary text-sm mb-6">
          Translation coverage varies by language. Latin is the largest corpus but also the
          most studied; German, French, and Dutch literatures have vast untranslated portions.
        </p>

        <div className="space-y-6">
          {data.languages.map(lang => (
            <div key={lang.language} className="border-b border-stone-100 pb-5 last:border-0 last:pb-0">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="font-medium text-primary">{lang.language}</h3>
                <div className="text-sm">
                  <span className="text-emerald-700 font-medium">{fmt(lang.estimated_translated)}</span>
                  <span className="text-stone-400"> / {fmt(lang.distinct_works)} works</span>
                  <span className="text-stone-400 ml-1">({lang.pct_works_translated}%)</span>
                </div>
              </div>
              <ProgressBar value={lang.estimated_translated} max={lang.distinct_works} color="bg-emerald-600" />

              {/* Top untranslated authors */}
              {lang.top_untranslated.length > 0 && (
                <div className="mt-2">
                  <span className="text-[10px] uppercase tracking-wider text-stone-400">Notable untranslated authors: </span>
                  <span className="text-xs text-stone-500">
                    {lang.top_untranslated.map((a, i) => (
                      <span key={a.surname}>
                        {i > 0 && ', '}
                        {a.surname}
                        <span className="text-stone-300"> ({fmt(a.works)})</span>
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Source Library's Contribution ─────────────────────── */}
      {(data.sl_first_translations > 0 || data.sl_books_translated > 0) && (
        <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Sparkles className="w-5 h-5 text-purple-700" />
            </div>
            <h2 className="text-xl font-semibold text-primary">Source Library&apos;s Contribution</h2>
          </div>
          <p className="text-secondary text-sm mb-4">
            Source Library is actively translating books from this census &mdash; many for the first
            time in any modern language. Each translation updates the count.
          </p>
          <div className="flex items-center gap-8">
            <div>
              <div className="text-3xl font-bold text-amber-700">{fmt(data.sl_first_translations)}</div>
              <div className="text-xs text-stone-500">first English translations</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary">{fmt(data.sl_books_translated)}</div>
              <div className="text-xs text-stone-500">books translated</div>
            </div>
          </div>
          <div className="mt-4">
            <Link
              href="/about/progress"
              className="text-sm text-amber-700 hover:underline inline-flex items-center gap-1"
            >
              See full progress breakdown <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </section>
      )}

      {/* ── Methodology ──────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-stone-100 rounded-lg">
            <BarChart3 className="w-5 h-5 text-stone-600" />
          </div>
          <h2 className="text-xl font-semibold text-primary">Methodology &amp; Caveats</h2>
        </div>
        <div className="prose-content text-secondary text-sm space-y-3">
          <p>
            <strong>What we count:</strong> &ldquo;Works&rdquo; are distinct titles by the same author,
            deduplicated from USTC editions. &ldquo;Translated&rdquo; means at least one English-language
            version exists in our catalog of {fmt(data.catalog_records)} records from 12 sources.
          </p>
          <p>
            <strong>This is a lower bound.</strong> The translation catalogs are not exhaustive.
            Translations in dissertations, obscure journals, out-of-print 19th-century editions,
            and anthology excerpts may not appear. The true number of translated works is likely
            higher &mdash; but probably not dramatically so.
          </p>
          <p>
            <strong>Editions vs. works:</strong> The USTC records multiple editions of the same work.
            A translation of one edition covers the work, not just that edition. We count at the
            work level to avoid inflating the untranslated figure.
          </p>
          <p>
            <strong>Not all editions are books.</strong> The USTC includes broadsides, pamphlets,
            and single-sheet prints. Some may not need &ldquo;translation&rdquo; in the traditional sense.
          </p>
        </div>
      </section>

      {/* ── Data Sources ─────────────────────────────────────── */}
      <section className="bg-stone-100/50 rounded-xl border border-stone-200/50 p-6 mb-6">
        <h3 className="text-sm font-medium text-stone-500 mb-3">Data Sources</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-xs text-stone-500">
          <div>Universal Short Title Catalogue (USTC)</div>
          <div>UNESCO Index Translationum</div>
          <div>Open Library / Internet Archive</div>
          <div>HathiTrust Digital Library</div>
          <div>Loeb Classical Library</div>
          <div>Penguin Classics catalog</div>
          <div>Brill Publishers</div>
          <div>Cambridge University Press</div>
          <div>Routledge / De Gruyter</div>
          <div>CUA / Paulist Press (Church Fathers)</div>
          <div>Broadview / Norton / Hackett</div>
          <div>University of Chicago / Indiana UP</div>
        </div>
        <p className="text-[10px] text-stone-400 mt-3">
          Know of a translation we missed? <Link href="/contribute" className="underline hover:text-stone-600">Let us know</Link>.
        </p>
      </section>
    </ContentPageLayout>
  );
}
