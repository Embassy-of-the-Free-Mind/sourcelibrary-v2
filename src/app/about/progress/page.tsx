import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import ContentPageLayout, { SubPageHeader } from '@/components/layout/ContentPageLayout';
import { BarChart3, BookOpen, Languages, Globe2, Scan, Sparkles, Library } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Progress | Source Library',
  description: 'Tracking progress toward scanning and translating every book printed in Europe between 1450 and 1700.',
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
    const db = await getDb();
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
        in_source_library: s.inSourceLibrary || 0,
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

    // Count scan sources
    const sourceCount = await db.collection('import_candidates')
      .distinct('source')
      .then(s => s.length)
      .catch(() => 11);

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
      source_count: sourceCount,
    };
  } catch {
    return null;
  }
}

// ── Live Source Library Stats ─────────────────────────────────────────

interface LiveStats {
  total_books: number;
  books_translated: number;
  books_over_90: number;
  first_translations: number;
  verified_total: number;
  top_languages: { language: string; count: number }[];
}

async function getLiveStats(): Promise<LiveStats | null> {
  try {
    const db = await getDb();
    const col = db.collection('books');

    const [total, translated, firstTrans, verified, langs, enrichSnap] = await Promise.all([
      col.countDocuments({ pages_count: { $gt: 0 } }),
      col.countDocuments({ pages_translated: { $gt: 0 } }),
      col.countDocuments({ is_first_translation: true }),
      col.countDocuments({ translation_verification: { $exists: true } }),
      col.aggregate([
        { $match: { pages_translated: { $gt: 0 }, pages_count: { $gt: 0 } } },
        { $group: { _id: '$language', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ], { maxTimeMS: 15000 }).toArray(),
      // Use enrichment snapshot for >90% count (avoids slow $expr scan)
      db.collection('system_config').findOne({ _id: 'enrichment_snapshot' as any }),
    ]);

    const over90 = (enrichSnap as any)?.milestones?.over_90_pct || 0;

    return {
      total_books: total,
      books_translated: translated,
      books_over_90: over90,
      first_translations: firstTrans,
      verified_total: verified,
      top_languages: langs.map(l => ({ language: l._id as string, count: l.count })),
    };
  } catch {
    return null;
  }
}

// ── Components ────────────────────────────────────────────────────────

function ProgressBar({ value, max, color = 'bg-amber-600' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full bg-stone-200 rounded-full h-3 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-border-light p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-stone-400" />
        <span className="text-xs uppercase tracking-wider text-stone-500 font-medium">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-primary">{value}</div>
      {sub && <div className="text-sm text-secondary mt-1">{sub}</div>}
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

// ── Page ──────────────────────────────────────────────────────────────

export default async function ProgressPage() {
  const [data, live] = await Promise.all([getCoverageData(), getLiveStats()]);

  if (!data) {
    return (
      <ContentPageLayout maxWidth="narrow" bg="bg-stone-50">
        <SubPageHeader title="Progress" subtitle="Coverage data not yet available" />
        <div className="bg-white rounded-xl border border-border-light p-6">
          <p className="text-secondary">
            The catalog coverage database hasn&apos;t been built yet. Check back soon.
          </p>
        </div>
      </ContentPageLayout>
    );
  }

  const topLanguages = data.languages.filter(l => l.editions >= 1000).slice(0, 12);
  const scannedNotTranslated = data.total_scanned - data.total_translated;

  return (
    <ContentPageLayout maxWidth="narrow" bg="bg-stone-50">
      <SubPageHeader
        title="Scanning the Renaissance"
        subtitle="Tracking progress toward scanning and translating every book printed in Europe between 1450 and 1700"
      />

      {/* Hero stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard icon={BookOpen} label="Editions cataloged" value={fmt(data.total_editions)} sub="from the Universal Short Title Catalogue" />
        <StatCard icon={Scan} label="Digitally scanned" value={`${data.pct_scanned.toFixed(1)}%`} sub={`${fmt(data.total_scanned)} editions`} />
        <StatCard icon={Languages} label="Translated" value={`${data.pct_translated.toFixed(1)}%`} sub={`${fmt(data.total_translated)} editions`} />
        <StatCard icon={Globe2} label="In Source Library" value={fmt(data.total_in_sl)} sub="OCR&apos;d and translated" />
      </div>

      {/* The opportunity */}
      <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-amber-100 rounded-lg">
            <BarChart3 className="w-5 h-5 text-amber-700" />
          </div>
          <h2 className="text-xl font-semibold text-primary">The Opportunity</h2>
        </div>

        <p className="text-secondary mb-6">
          Of the {fmt(data.total_editions)} editions printed in Europe before 1700,
          only {data.pct_scanned.toFixed(1)}% have known digital scans and {data.pct_translated.toFixed(1)}% have
          English translations. That means roughly {fmt(scannedNotTranslated)} works have been
          scanned but never translated — waiting to be read for the first time in centuries.
        </p>

        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-secondary">Scanned</span>
              <span className="font-medium text-primary">{data.pct_scanned.toFixed(1)}%</span>
            </div>
            <ProgressBar value={data.total_scanned} max={data.total_editions} color="bg-amber-600" />
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-secondary">Translated to English</span>
              <span className="font-medium text-primary">{data.pct_translated.toFixed(1)}%</span>
            </div>
            <ProgressBar value={data.total_translated} max={data.total_editions} color="bg-emerald-600" />
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-secondary">In Source Library</span>
              <span className="font-medium text-primary">{fmt(data.total_in_sl)}</span>
            </div>
            <ProgressBar value={data.total_in_sl} max={data.total_editions} color="bg-purple-600" />
          </div>
        </div>
      </section>

      {/* Source Library contribution */}
      {live && (
        <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Sparkles className="w-5 h-5 text-purple-700" />
            </div>
            <h2 className="text-xl font-semibold text-primary">Source Library&apos;s Contribution</h2>
          </div>

          <p className="text-secondary mb-6">
            Source Library is working through this corpus — scanning, OCR&apos;ing, and translating books that have
            never before been available in English. Many of these are first-ever English translations of texts that
            have waited centuries to be read.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center">
              <div className="text-2xl font-semibold text-primary">{fmt(live.total_books)}</div>
              <div className="text-xs text-stone-500 mt-1">Books digitized</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-semibold text-primary">{fmt(live.books_translated)}</div>
              <div className="text-xs text-stone-500 mt-1">With translation</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-semibold text-primary">{fmt(live.books_over_90)}</div>
              <div className="text-xs text-stone-500 mt-1">Over 90% translated</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-semibold text-amber-700 font-bold">{fmt(live.first_translations)}</div>
              <div className="text-xs text-stone-500 mt-1">First English translations</div>
            </div>
          </div>

          {live.top_languages.length > 0 && (
            <div className="border-t border-stone-100 pt-4">
              <h3 className="text-sm font-medium text-stone-500 mb-3 flex items-center gap-2">
                <Library className="w-3.5 h-3.5" />
                Translated from
              </h3>
              <div className="flex flex-wrap gap-2">
                {live.top_languages.map(l => (
                  <span key={l.language} className="px-3 py-1 bg-stone-100 rounded-full text-xs text-stone-600">
                    {l.language} <span className="text-stone-400">({fmt(l.count)})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Language breakdown */}
      <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
        <h2 className="text-xl font-semibold text-primary mb-4">By Language</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left">
                <th className="py-2 pr-4 font-medium text-stone-500">Language</th>
                <th className="py-2 pr-4 font-medium text-stone-500 text-right">Editions</th>
                <th className="py-2 pr-4 font-medium text-stone-500 text-right">Scanned</th>
                <th className="py-2 pr-4 font-medium text-stone-500 text-right">Translated</th>
                <th className="py-2 font-medium text-stone-500 text-right">In SL</th>
              </tr>
            </thead>
            <tbody>
              {topLanguages.map(lang => (
                <tr key={lang.language} className="border-b border-stone-100">
                  <td className="py-2 pr-4 font-medium text-primary">{lang.language}</td>
                  <td className="py-2 pr-4 text-right text-secondary">{fmt(lang.editions)}</td>
                  <td className="py-2 pr-4 text-right">
                    <span className="text-secondary">{fmt(lang.with_scan)}</span>
                    <span className="text-stone-400 ml-1">({lang.pct_scanned.toFixed(1)}%)</span>
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <span className="text-secondary">{fmt(lang.with_translation)}</span>
                    <span className="text-stone-400 ml-1">({lang.pct_translated.toFixed(1)}%)</span>
                  </td>
                  <td className="py-2 text-right text-secondary">{fmt(lang.in_source_library)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Data sources */}
      <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
        <h2 className="text-xl font-semibold text-primary mb-3">Data Sources</h2>
        <p className="text-secondary text-sm mb-3">
          Coverage data is compiled from the <a href="https://www.ustc.ac.uk" className="text-amber-700 hover:underline" target="_blank" rel="noopener">Universal Short Title Catalogue</a> (bibliographic
          records), {data.source_count} digital library scan sources, and scholarly translation catalogs.
        </p>
        <p className="text-stone-400 text-xs">
          Last updated: {data.built_at ? new Date(data.built_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown'}
        </p>
      </section>
    </ContentPageLayout>
  );
}
