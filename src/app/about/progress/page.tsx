import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
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
      built_at: new Date().toISOString(),
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

/** Fallback: read from MongoDB catalog_coverage_meta if Supabase RPC fails */
async function getCoverageDataFallback(): Promise<CoverageData | null> {
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

interface LanguageProgress {
  language: string;
  total: number;
  translated: number;
  over_90: number;
  first_trans: number;
}

interface CenturyProgress {
  century_start: number;
  total: number;
  translated: number;
  over_90: number;
  first_trans: number;
}

interface LiveStats {
  total_books: number;
  translated_by_sl: number;
  english_digitized: number;
  books_over_90: number;
  first_translations: number;
  by_language: LanguageProgress[];
  by_century: CenturyProgress[];
}

async function getLiveStats(): Promise<LiveStats | null> {
  try {
    const { data, error } = await supabase.rpc('get_sl_progress');
    if (error || !data) return null;

    const d = data as any;
    return {
      total_books: Number(d.totals?.total_books || 0),
      translated_by_sl: Number(d.totals?.translated_by_sl || 0),
      english_digitized: Number(d.totals?.english_digitized || 0),
      books_over_90: Number(d.totals?.over_90_translated || 0),
      first_translations: Number(d.totals?.first_translations || 0),
      by_language: (d.by_language || []).map((l: any) => ({
        language: l.language,
        total: Number(l.total),
        translated: Number(l.translated),
        over_90: Number(l.over_90),
        first_trans: Number(l.first_trans),
      })),
      by_century: (d.by_century || []).map((c: any) => ({
        century_start: Number(c.century_start),
        total: Number(c.total),
        translated: Number(c.translated_by_sl ?? c.translated ?? 0),
        over_90: Number(c.over_90),
        first_trans: Number(c.first_trans),
      })),
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
            Source Library translates historical texts into English — many for the first time ever.
            Using AI-assisted OCR and translation, we&apos;re making texts readable that have waited
            centuries to be understood outside their original languages.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center">
              <div className="text-2xl font-semibold text-amber-700">{fmt(live.first_translations)}</div>
              <div className="text-xs text-stone-500 mt-1">First English translations</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-semibold text-primary">{fmt(live.translated_by_sl)}</div>
              <div className="text-xs text-stone-500 mt-1">Books translated</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-semibold text-primary">{fmt(live.books_over_90)}</div>
              <div className="text-xs text-stone-500 mt-1">Over 90% complete</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-semibold text-stone-400">{fmt(live.english_digitized)}</div>
              <div className="text-xs text-stone-500 mt-1">English books digitized</div>
            </div>
          </div>

          {/* By Language */}
          {live.by_language.length > 0 && (
            <div className="border-t border-stone-100 pt-4">
              <h3 className="text-sm font-medium text-stone-500 mb-3 flex items-center gap-2">
                <Library className="w-3.5 h-3.5" />
                By source language
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-left">
                      <th className="py-1.5 pr-3 font-medium text-stone-400 text-xs">Language</th>
                      <th className="py-1.5 pr-3 font-medium text-stone-400 text-xs text-right">Books</th>
                      <th className="py-1.5 pr-3 font-medium text-stone-400 text-xs text-right">Translated</th>
                      <th className="py-1.5 font-medium text-stone-400 text-xs text-right">First English</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.by_language.filter(l => l.total >= 10 && l.language !== 'Unknown').map(l => (
                      <tr key={l.language} className="border-b border-stone-50">
                        <td className="py-1.5 pr-3 text-primary">{l.language}</td>
                        <td className="py-1.5 pr-3 text-right text-secondary">{fmt(l.total)}</td>
                        <td className="py-1.5 pr-3 text-right text-secondary">{fmt(l.translated)}</td>
                        <td className="py-1.5 text-right font-medium text-amber-700">{fmt(l.first_trans)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* By Century */}
          {live.by_century.length > 0 && (
            <div className="border-t border-stone-100 pt-4 mt-4">
              <h3 className="text-sm font-medium text-stone-500 mb-3 flex items-center gap-2">
                <BarChart3 className="w-3.5 h-3.5" />
                By century
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-left">
                      <th className="py-1.5 pr-3 font-medium text-stone-400 text-xs">Period</th>
                      <th className="py-1.5 pr-3 font-medium text-stone-400 text-xs text-right">Books</th>
                      <th className="py-1.5 pr-3 font-medium text-stone-400 text-xs text-right">Translated</th>
                      <th className="py-1.5 font-medium text-stone-400 text-xs text-right">First English</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.by_century.filter(c => c.total >= 5).map(c => {
                      const label = c.century_start < 0
                        ? `${Math.abs(c.century_start)}s BCE`
                        : c.century_start < 100
                          ? '1st century'
                          : `${c.century_start}s`;
                      return (
                        <tr key={c.century_start} className="border-b border-stone-50">
                          <td className="py-1.5 pr-3 text-primary">{label}</td>
                          <td className="py-1.5 pr-3 text-right text-secondary">{fmt(c.total)}</td>
                          <td className="py-1.5 pr-3 text-right text-secondary">{fmt(c.translated)}</td>
                          <td className="py-1.5 text-right font-medium text-amber-700">{fmt(c.first_trans)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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

      {/* Census link */}
      <section className="bg-amber-50 rounded-xl border border-amber-200/50 p-6 mb-6">
        <p className="text-secondary text-sm">
          Want to know which specific works have been translated?{' '}
          <Link href="/census" className="text-amber-700 font-medium hover:underline">
            Search the Translation Census
          </Link>{' '}
          &mdash; the first comprehensive record of the Renaissance translation gap.
        </p>
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
