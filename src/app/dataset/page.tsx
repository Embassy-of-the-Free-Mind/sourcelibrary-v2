import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { getDb } from '@/lib/mongodb';
import { DATASET_TIERS, DatasetTier } from '@/lib/dataset/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export const metadata: Metadata = {
  title: 'Historical Language Training Data — Source Library Dataset API',
  description:
    'Parallel text training data for Latin, Ancient Greek, Classical Chinese, Sanskrit, Sumerian, and 85+ other languages. 800K+ translated pages with original text, structured as JSONL via API.',
  alternates: { canonical: '/dataset' },
  openGraph: {
    title: 'Historical Language Training Data — Source Library',
    description:
      'Parallel text training data for Latin, Ancient Greek, Classical Chinese, Sanskrit, Sumerian, and 85+ other languages. Original text + English translation, page-aligned, via API.',
  },
};

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtPrice(cents: number, period: string): string {
  if (cents === 0) return 'Free';
  return `$${(cents / 100).toLocaleString('en-US')}/${period}`;
}

async function fetchStats() {
  const db = await getDb();
  const books = db.collection('books');
  const vis = { hidden: { $ne: true } };

  const [totalBooks, totalsAgg, langsAgg, clustersAgg] = await Promise.all([
    books.countDocuments(vis),
    books.aggregate<{ _id: null; pages: number; ocr: number; translated: number }>([
      { $match: vis },
      { $group: { _id: null, pages: { $sum: { $ifNull: ['$pages_count', 0] } }, ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } }, translated: { $sum: { $ifNull: ['$pages_translated', 0] } } } },
    ]).toArray(),
    books.aggregate<{ _id: string; count: number; translated: number }>([
      { $match: { ...vis, language: { $exists: true, $ne: 'Unknown' } } },
      { $group: { _id: '$language', count: { $sum: 1 }, translated: { $sum: { $ifNull: ['$pages_translated', 0] } } } },
      { $sort: { count: -1 } }, { $limit: 15 },
    ]).toArray(),
    books.aggregate<{ _id: string; count: number }>([
      { $match: { ...vis, 'taxonomy.cluster': { $exists: true } } },
      { $group: { _id: '$taxonomy.cluster', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 20 },
    ]).toArray(),
  ]);

  const t = totalsAgg[0] ?? { pages: 0, ocr: 0, translated: 0 };
  return {
    totalBooks,
    pagesTranslated: t.translated,
    tokens: Math.round(t.translated * 1000),
    langs: langsAgg.map(l => ({ lang: l._id, books: l.count, translated: l.translated })),
    clusters: clustersAgg.map(c => ({ name: c._id, books: c.count })),
  };
}

export default async function DatasetPage() {
  const s = await fetchStats();
  const topLangs = s.langs.slice(0, 12);
  const maxBooks = topLangs[0]?.books ?? 1;

  const tiers: Array<{ key: DatasetTier; cta: string; primary?: boolean }> = [
    { key: 'explorer', cta: 'Get Free API Key' },
    { key: 'language', cta: 'Get Started' },
    { key: 'domain', cta: 'Get Started' },
    { key: 'full', cta: 'Get Started', primary: true },
    { key: 'enterprise', cta: 'Talk to Us' },
  ];

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Historical Language Training Data"
          subtitle={`${fmt(s.totalBooks)} texts in ${s.langs.length}+ languages. Original text + English translation, page-aligned. Available via API.`}
        />
      }
      maxWidth="wide"
    >

      {/* ── What this is ── */}
      <section className="mb-20 max-w-3xl">
        <p className="text-lg text-secondary leading-relaxed mb-6">
          Source Library is a collection of {fmt(s.totalBooks)} historical texts &mdash; Latin, Ancient Greek,
          Classical Chinese, Sanskrit, Sumerian, Arabic, early modern German, and {s.langs.length - 7}+ other
          languages &mdash; sourced from the Bodleian Library, the Vatican, the Bavarian State Library,
          the Library of Congress, and thirty other institutions.
        </p>
        <p className="text-lg text-secondary leading-relaxed mb-6">
          Each text has been OCR&apos;d and translated into English, page by page.
          The dataset contains {fmt(s.pagesTranslated)} translated pages (~{fmt(s.tokens)} tokens)
          of parallel text: the original language alongside its English translation,
          with book metadata, taxonomy classification, and a citation URL for every page.
        </p>
        <p className="text-lg text-secondary leading-relaxed">
          This data is available as a streaming JSONL API for AI model training,
          fine-tuning, evaluation, and research.
        </p>
      </section>

      {/* ── What it's for ── */}
      <section className="mb-20 max-w-3xl">
        <h2 className="text-xl font-semibold text-primary mb-4">What it&apos;s for</h2>
        <ul className="space-y-3 text-secondary leading-relaxed">
          <li><strong className="text-primary">Historical language capability.</strong> Parallel text for training and evaluating translation models on languages that are underrepresented in existing datasets.</li>
          <li><strong className="text-primary">Document understanding.</strong> Page-aligned text with metadata for training models on historical typography, manuscript layouts, and non-Latin scripts.</li>
          <li><strong className="text-primary">Scholarly tools.</strong> Cross-language search, research assistants, and educational tools for reading ancient texts. Every record has a citation URL.</li>
          <li><strong className="text-primary">Evaluation.</strong> Benchmark your model on real historical text with human-verified translations, not synthetic tests.</li>
        </ul>
      </section>

      {/* ── Languages ── */}
      <section className="mb-20" id="languages">
        <h2 className="text-xl font-semibold text-primary mb-6">Languages</h2>
        <div className="space-y-3">
          {topLangs.map(l => (
            <div key={l.lang} className="flex items-center gap-4">
              <span className="text-sm text-secondary w-36 shrink-0 text-right">{l.lang}</span>
              <div className="flex-1 bg-stone-200/40 rounded-full h-5 overflow-hidden relative">
                <div
                  className="h-full rounded-full bg-accent-sage/60"
                  style={{ width: `${Math.max(3, (l.books / maxBooks) * 100)}%` }}
                />
                <span className="absolute inset-y-0 left-3 flex items-center text-xs text-stone-500">
                  {fmt(l.books)} books &middot; {fmt(l.translated)} pages
                </span>
              </div>
            </div>
          ))}
        </div>
        {s.langs.length > 12 && (
          <p className="text-sm text-muted mt-4 ml-40">
            + {s.langs.length - 12} more languages
          </p>
        )}
      </section>

      {/* ── Domains ── */}
      <section className="mb-20">
        <h2 className="text-xl font-semibold text-primary mb-4">Domains</h2>
        <div className="flex flex-wrap gap-2">
          {s.clusters.map(c => (
            <span key={c.name} className="px-3 py-1 rounded-full text-sm bg-stone-100 text-stone-600">
              {c.name} <span className="text-stone-400">{c.books}</span>
            </span>
          ))}
        </div>
      </section>

      {/* ── Data format ── */}
      <section className="mb-20" id="format">
        <h2 className="text-xl font-semibold text-primary mb-2">Data format</h2>
        <p className="text-secondary mb-4">
          Streaming JSONL. One record per page. Each record contains:
        </p>
        <div className="rounded-lg overflow-hidden mb-4">
          <pre className="p-5 text-sm overflow-x-auto bg-stone-900 text-stone-100 leading-relaxed">
{`{
  "book_id": "694f49d3...",
  "page_number": 12,
  "language": "Latin",
  "original_text": "Omnia ab uno, & in unum omnia...",
  "english_translation": "All things from one, and into one all things...",
  "book_title": "Tabula Smaragdina",
  "author": "Hermes Trismegistus",
  "year": 800,
  "cluster": "Western Alchemy",
  "source_url": "https://sourcelibrary.org/book/tabula-smaragdina?page=12"
}`}
          </pre>
        </div>
        <div className="rounded-lg overflow-hidden">
          <pre className="p-5 text-sm overflow-x-auto bg-stone-900 text-stone-100">
{`curl -H "Authorization: Bearer sl_data_YOUR_KEY" \\
  "https://sourcelibrary.org/api/dataset/v1/pages?language=Latin&limit=1000"`}
          </pre>
        </div>
      </section>

      {/* ── Quality ── */}
      <section className="mb-20 max-w-3xl">
        <h2 className="text-xl font-semibold text-primary mb-4">Quality and updates</h2>
        <p className="text-secondary leading-relaxed mb-4">
          Translations are reviewed through an open scholarly process (the <em>Translation Commons</em>).
          The collection is updated quarterly with new books, corrections, and expanded translations.
          Paid plans include update changelogs.
        </p>
        <p className="text-secondary leading-relaxed">
          Every record includes a provenance chain back to the holding institution.
          The dataset is protected under the EU Database Directive (96/9/EC) and
          provides the documentation required for EU AI Act training data disclosure.{' '}
          <Link href="/terms" className="text-accent-rust hover:underline">Terms</Link>
        </p>
      </section>

      {/* ── Pricing ── */}
      <section className="mb-10" id="pricing">
        <h2 className="text-xl font-semibold text-primary mb-6">Pricing</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tiers.map(({ key, cta, primary }) => {
            const t = DATASET_TIERS[key];
            return (
              <div
                key={key}
                className={`bg-white rounded-lg p-6 border ${
                  primary ? 'border-accent-rust ring-1 ring-accent-rust/20' : 'border-border-light'
                } flex flex-col`}
              >
                <h3 className="font-semibold text-primary">{t.name}</h3>
                <p className="text-secondary text-sm mt-1 mb-4 flex-1">{t.description}</p>
                {key === 'enterprise' ? (
                  <div className="mb-4"><span className="text-xl text-primary">Custom</span></div>
                ) : t.monthlyPrice === 0 ? (
                  <div className="mb-4"><span className="text-xl text-primary">Free</span> <span className="text-muted text-sm">{t.pagesPerDay}/day</span></div>
                ) : (
                  <div className="mb-4">
                    <span className="text-xl text-primary">{fmtPrice(t.annualPrice, 'yr')}</span>
                    <span className="text-muted text-sm ml-2">or {fmtPrice(t.monthlyPrice, 'mo')}</span>
                  </div>
                )}
                <div className="text-sm text-muted mb-4 space-y-1">
                  <div>{t.requestsPerMinute} req/min</div>
                  {t.scope === 'language' && <div>One language</div>}
                  {t.scope === 'domain' && <div>One taxonomy cluster</div>}
                  {t.scope === 'full' && <div>All languages and domains</div>}
                </div>
                {key === 'enterprise' ? (
                  <a href="mailto:data@sourcelibrary.org?subject=Dataset%20License" className="block text-center px-4 py-2 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50 transition-colors text-sm font-medium">{cta}</a>
                ) : (
                  <Link href={key === 'explorer' ? '/auth/signin?callbackUrl=/dataset/dashboard' : `/auth/signin?callbackUrl=/dataset/dashboard?tier=${key}`} className={`block text-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${primary ? 'bg-accent-rust text-white hover:bg-accent-rust/90' : 'border border-stone-300 text-stone-700 hover:bg-stone-50'}`}>{cta}</Link>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Enterprise ── */}
      <section className="mb-16 max-w-3xl">
        <p className="text-secondary leading-relaxed">
          For foundation model teams: exclusive access windows, Parquet bulk exports,
          stewardship reports, and SLAs. The collection can be segmented by language,
          domain, time period, or delivered whole.{' '}
          <a href="mailto:data@sourcelibrary.org?subject=Dataset%20License" className="text-accent-rust hover:underline">data@sourcelibrary.org</a>
        </p>
      </section>

      {/* ── Links ── */}
      <section className="border-t border-border-light pt-8">
        <div className="flex flex-wrap gap-6 text-sm">
          <a href="/api/dataset/v1/stats" className="text-stone-500 hover:text-accent-rust">Corpus stats (JSON)</a>
          <Link href="/developers" className="text-stone-500 hover:text-accent-rust">API docs &amp; MCP server</Link>
          <Link href="/data" className="text-stone-500 hover:text-accent-rust">Browse the collection</Link>
          <Link href="/terms" className="text-stone-500 hover:text-accent-rust">Terms</Link>
        </div>
      </section>
    </ContentPageLayout>
  );
}
