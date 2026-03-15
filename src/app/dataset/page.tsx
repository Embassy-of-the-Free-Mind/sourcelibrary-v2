import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { getDb } from '@/lib/mongodb';
import { DATASET_TIERS, DatasetTier } from '@/lib/dataset/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export const metadata: Metadata = {
  title: 'Dataset API — Source Library',
  description:
    'License structured training data from 10,000+ historical texts. Parallel translations in 90+ languages including Latin, Ancient Greek, Classical Chinese, Sanskrit, and Sumerian.',
  alternates: { canonical: '/dataset' },
  openGraph: {
    title: 'Dataset API — Source Library',
    description:
      'The only structured parallel-text dataset for historical languages. Page-aligned original text, English translation, and metadata for AI training.',
  },
};

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatPrice(cents: number, period: string): string {
  if (cents === 0) return 'Free';
  return `$${(cents / 100).toLocaleString('en-US')}/${period}`;
}

async function fetchDatasetStats() {
  const db = await getDb();
  const books = db.collection('books');
  const visible = { hidden: { $ne: true } };

  const [totalBooks, pageTotalsAgg, languagesAgg, clustersAgg] = await Promise.all([
    books.countDocuments(visible),
    books
      .aggregate<{ _id: null; pages: number; ocr: number; translated: number }>([
        { $match: visible },
        {
          $group: {
            _id: null,
            pages: { $sum: { $ifNull: ['$pages_count', 0] } },
            ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
            translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
          },
        },
      ])
      .toArray(),
    books
      .aggregate<{ _id: string; count: number; translated: number }>([
        { $match: { ...visible, language: { $exists: true, $ne: 'Unknown' } } },
        {
          $group: {
            _id: '$language',
            count: { $sum: 1 },
            translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ])
      .toArray(),
    books
      .aggregate<{ _id: string; count: number }>([
        { $match: { ...visible, 'taxonomy.cluster': { $exists: true } } },
        { $group: { _id: '$taxonomy.cluster', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ])
      .toArray(),
  ]);

  const totals = pageTotalsAgg[0] ?? { pages: 0, ocr: 0, translated: 0 };

  return {
    totalBooks,
    totalPages: totals.pages,
    pagesOcr: totals.ocr,
    pagesTranslated: totals.translated,
    estimatedTokens: Math.round(totals.translated * 1000),
    languages: languagesAgg.map((l) => ({
      language: l._id,
      books: l.count,
      pagesTranslated: l.translated,
    })),
    clusters: clustersAgg.map((c) => ({ cluster: c._id, books: c.count })),
  };
}

/* ── Section overline label ── */
function Overline({ children }: { children: string }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-accent-rust/70 mb-3 block">
      {children}
    </span>
  );
}

/* ── Source institution logos (trust signals) ── */
const SOURCE_INSTITUTIONS = [
  'Internet Archive',
  'Bodleian Library',
  'Bavarian State Library',
  'Biblioteca Apostolica Vaticana',
  'British Library',
  'Wellcome Collection',
  'Cambridge Digital Library',
  'Library of Congress',
  'Embassy of the Free Mind',
  'Gallica (BnF)',
];

const SAMPLE_JSONL = `{"book_id":"694f49d3...","page_number":12,"language":"Latin","original_text":"Omnia ab uno, & in unum omnia...","english_translation":"All things from one, and into one all things...","book_title":"Tabula Smaragdina","author":"Hermes Trismegistus","year":800,"cluster":"Western Alchemy","source_url":"https://sourcelibrary.org/book/tabula-smaragdina?page=12"}`;

const VALUE_PROPS = [
  {
    title: 'Parallel text in 90+ languages',
    description:
      'Original language + English translation, page-aligned. Latin, Ancient Greek, Classical Chinese, Sanskrit, Sumerian, Syriac, Arabic, early modern German, and dozens more.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802" />
      </svg>
    ),
  },
  {
    title: 'Translation Commons',
    description:
      'Every translation passes through our open review process. Hundreds of language specialists contribute corrections continuously. The dataset improves with every update.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.745 3.745 0 011.043 3.296A3.745 3.745 0 0121 12z" />
      </svg>
    ),
  },
  {
    title: 'Structured for training',
    description:
      'JSONL output with page-level alignment: original text, translation, book metadata, taxonomy classification, and source URLs. Ready for your pipeline.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
  },
  {
    title: 'Full provenance chain',
    description:
      'Every record traces to a specific page, in a specific book, held by a named institution. EU AI Act disclosure-ready out of the box.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
  {
    title: 'Living dataset',
    description:
      'New books, corrections, and translations added continuously. Quarterly updates with changelogs. Your license grows more valuable over time.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
      </svg>
    ),
  },
  {
    title: 'No comparable alternative',
    description:
      'The only structured, page-aligned, parallel-text dataset for historical and low-resource languages. This data did not exist before Source Library.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
      </svg>
    ),
  },
];

/* ── Feature comparison data ── */
const COMPARISON_FEATURES = [
  { feature: 'Page records', explorer: '100/day', language: 'Unlimited', domain: 'Unlimited', full: 'Unlimited', enterprise: 'Unlimited' },
  { feature: 'Languages', explorer: 'All (sample)', language: '1 language', domain: 'All in cluster', full: 'All 90+', enterprise: 'All 90+' },
  { feature: 'Domains', explorer: 'All (sample)', language: 'All', domain: '1 cluster', full: 'All 48', enterprise: 'All 48' },
  { feature: 'Original text (OCR)', explorer: 'Yes', language: 'Yes', domain: 'Yes', full: 'Yes', enterprise: 'Yes' },
  { feature: 'English translation', explorer: 'Yes', language: 'Yes', domain: 'Yes', full: 'Yes', enterprise: 'Yes' },
  { feature: 'Book metadata', explorer: 'Yes', language: 'Yes', domain: 'Yes', full: 'Yes', enterprise: 'Yes' },
  { feature: 'Taxonomy classification', explorer: 'Yes', language: 'Yes', domain: 'Yes', full: 'Yes', enterprise: 'Yes' },
  { feature: 'Rate limit', explorer: '10 req/min', language: '60 req/min', domain: '120 req/min', full: '300 req/min', enterprise: 'Custom' },
  { feature: 'Quarterly updates', explorer: 'No', language: 'Yes', domain: 'Yes', full: 'Yes', enterprise: 'Yes' },
  { feature: 'Parquet bulk export', explorer: 'No', language: 'No', domain: 'No', full: 'No', enterprise: 'Yes' },
  { feature: 'Stewardship reports', explorer: 'No', language: 'No', domain: 'No', full: 'No', enterprise: 'Yes' },
  { feature: 'Exclusive access window', explorer: 'No', language: 'No', domain: 'No', full: 'No', enterprise: 'Yes' },
  { feature: 'SLA', explorer: 'No', language: 'No', domain: 'No', full: '99.9%', enterprise: 'Custom' },
];

export default async function DatasetPage() {
  const stats = await fetchDatasetStats();
  const topLanguages = stats.languages.slice(0, 12);
  const maxLangBooks = topLanguages[0]?.books ?? 1;

  const tierKeys: Array<{ key: DatasetTier; cta: string; ctaStyle: 'primary' | 'secondary' }> = [
    { key: 'explorer', cta: 'Get Free API Key', ctaStyle: 'secondary' },
    { key: 'language', cta: 'Get Started', ctaStyle: 'secondary' },
    { key: 'domain', cta: 'Get Started', ctaStyle: 'secondary' },
    { key: 'full', cta: 'Get Started', ctaStyle: 'primary' },
    { key: 'enterprise', cta: 'Talk to an Expert', ctaStyle: 'secondary' },
  ];

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Dataset API"
          subtitle="Structured parallel-text training data from 10,000+ historical texts in 90+ languages. The only dataset of its kind."
        />
      }
      maxWidth="wide"
    >
      {/* ── Headline stats ── */}
      <section className="mb-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { value: formatNumber(stats.totalBooks), label: 'Historical texts' },
            { value: formatNumber(stats.pagesTranslated), label: 'Translated pages' },
            { value: `~${formatNumber(stats.estimatedTokens)}`, label: 'Estimated tokens' },
            { value: String(stats.languages.length) + '+', label: 'Languages' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl p-5 border border-border-light">
              <div className="text-3xl text-accent-rust mb-1" style={{ fontWeight: 300 }}>
                {s.value}
              </div>
              <div className="text-muted text-sm">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Source institutions (trust bar) ── */}
      <section className="mb-16">
        <Overline>Sourced from</Overline>
        <div className="flex flex-wrap gap-x-6 gap-y-2 items-center">
          {SOURCE_INSTITUTIONS.map((name) => (
            <span key={name} className="text-sm text-stone-400 font-medium whitespace-nowrap">
              {name}
            </span>
          ))}
        </div>
      </section>

      {/* ── Why this dataset ── */}
      <section className="mb-16">
        <Overline>Why this data</Overline>
        <h2 className="font-serif text-2xl text-primary mb-8">
          Your models are weak on historical languages because this data didn&apos;t exist
        </h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {VALUE_PROPS.map((vp) => (
            <div key={vp.title} className="bg-white rounded-xl p-6 border border-border-light">
              <div className="w-10 h-10 bg-accent-gold/15 rounded-lg flex items-center justify-center text-accent-rust mb-4">
                {vp.icon}
              </div>
              <h3 className="font-semibold text-primary mb-2">{vp.title}</h3>
              <p className="text-secondary text-sm leading-relaxed">{vp.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Cost comparison ── */}
      <section className="mb-16">
        <Overline>The alternative</Overline>
        <h2 className="font-serif text-2xl text-primary mb-6">Build it yourself?</h2>
        <div className="bg-white rounded-xl border border-border-light overflow-hidden">
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border-light">
            <div className="p-6 md:p-8">
              <h3 className="text-sm font-medium text-muted uppercase tracking-wide mb-4">Do it yourself</h3>
              <div className="space-y-3 text-secondary text-sm">
                <div className="flex justify-between">
                  <span>Identify &amp; acquire 10,000+ rare texts</span>
                  <span className="text-stone-400 tabular-nums">2+ years</span>
                </div>
                <div className="flex justify-between">
                  <span>OCR 1.2M pages of historical print</span>
                  <span className="text-stone-400 tabular-nums">~$120,000</span>
                </div>
                <div className="flex justify-between">
                  <span>Translate 800K pages across 90+ languages</span>
                  <span className="text-stone-400 tabular-nums">~$800,000</span>
                </div>
                <div className="flex justify-between">
                  <span>Human review &amp; correction</span>
                  <span className="text-stone-400 tabular-nums">~$200,000</span>
                </div>
                <div className="flex justify-between">
                  <span>Taxonomy, metadata, alignment</span>
                  <span className="text-stone-400 tabular-nums">~$80,000</span>
                </div>
                <div className="flex justify-between border-t border-border-light pt-3 font-medium text-primary">
                  <span>Total</span>
                  <span className="tabular-nums">~$1.2M + 2 years</span>
                </div>
              </div>
            </div>
            <div className="p-6 md:p-8 bg-stone-50/50">
              <h3 className="text-sm font-medium text-accent-rust uppercase tracking-wide mb-4">Source Library Dataset API</h3>
              <div className="space-y-3 text-secondary text-sm">
                <div className="flex justify-between">
                  <span>Full collection access</span>
                  <span className="text-accent-rust tabular-nums font-medium">$49,990/yr</span>
                </div>
                <div className="flex justify-between">
                  <span>Quarterly updates included</span>
                  <span className="text-stone-400">Yes</span>
                </div>
                <div className="flex justify-between">
                  <span>Human-verified quality</span>
                  <span className="text-stone-400">Yes</span>
                </div>
                <div className="flex justify-between">
                  <span>EU AI Act provenance chain</span>
                  <span className="text-stone-400">Yes</span>
                </div>
                <div className="flex justify-between">
                  <span>Ready today, not in 2 years</span>
                  <span className="text-stone-400">Yes</span>
                </div>
                <div className="flex justify-between border-t border-border-light pt-3">
                  <span className="font-medium text-primary">Time to first data</span>
                  <span className="text-accent-rust tabular-nums font-medium">5 minutes</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Available corpora — by language ── */}
      <section className="mb-16" id="corpora">
        <Overline>The corpus</Overline>
        <h2 className="font-serif text-2xl text-primary mb-6">Available languages</h2>
        <div className="bg-white rounded-xl p-6 border border-border-light">
          <div className="space-y-3">
            {topLanguages.map((l) => (
              <div key={l.language} className="flex items-center gap-3">
                <span className="text-sm text-secondary w-32 shrink-0 text-right">{l.language}</span>
                <div className="flex-1 bg-stone-100 rounded-full h-7 overflow-hidden relative">
                  <div
                    className="h-full rounded-full bg-accent-sage"
                    style={{ width: `${Math.max(3, (l.books / maxLangBooks) * 100)}%` }}
                  />
                  <span className="absolute inset-y-0 left-3 flex items-center text-xs text-stone-600 font-medium">
                    {formatNumber(l.books)} books &middot; {formatNumber(l.pagesTranslated)} pages translated
                  </span>
                </div>
              </div>
            ))}
          </div>
          {stats.languages.length > 12 && (
            <p className="text-sm text-muted mt-4">
              and {stats.languages.length - 12} more languages &mdash;{' '}
              <a href="/api/dataset/v1/stats" className="text-accent-rust hover:underline">
                see full stats via API
              </a>
            </p>
          )}
        </div>
      </section>

      {/* ── By domain ── */}
      <section className="mb-16">
        <Overline>Domains</Overline>
        <h2 className="font-serif text-2xl text-primary mb-6">Taxonomy clusters</h2>
        <div className="bg-white rounded-xl p-6 border border-border-light">
          <div className="flex flex-wrap gap-2">
            {stats.clusters.map((c) => (
              <span
                key={c.cluster}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-accent-violet/8 text-accent-violet"
              >
                {c.cluster}
                <span className="text-accent-violet/60 text-xs">{c.books}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Sample data + download ── */}
      <section className="mb-16" id="api">
        <Overline>Data format</Overline>
        <h2 className="font-serif text-2xl text-primary mb-3">Streaming JSONL</h2>
        <p className="text-secondary mb-4 max-w-2xl">
          Every record is a single page with parallel text, metadata, and a citation URL.
          One JSON object per line, ready for your training pipeline.
        </p>
        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-4">
          <div className="bg-stone-100 px-4 py-2 border-b border-border-light flex items-center justify-between">
            <span className="text-sm font-medium text-stone-700">Sample record</span>
            <code className="text-xs text-muted">application/x-ndjson</code>
          </div>
          <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100 leading-relaxed">
            {JSON.stringify(JSON.parse(SAMPLE_JSONL), null, 2)}
          </pre>
        </div>
        <a
          href="/api/dataset/v1/stats"
          className="inline-flex items-center gap-2 text-sm text-accent-rust hover:underline"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Try the stats endpoint (no auth required)
        </a>
      </section>

      {/* ── API quickstart ── */}
      <section className="mb-16">
        <Overline>Quickstart</Overline>
        <h2 className="font-serif text-2xl text-primary mb-6">Three lines to first data</h2>
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-border-light overflow-hidden">
            <div className="bg-stone-100 px-4 py-2 border-b border-border-light">
              <span className="text-sm font-medium text-stone-700">Get all Latin pages with translations</span>
            </div>
            <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100">
{`curl -H "Authorization: Bearer sl_data_YOUR_KEY" \\
  "https://sourcelibrary.org/api/dataset/v1/pages?language=Latin&content=both&limit=1000"`}
            </pre>
          </div>
          <div className="bg-white rounded-xl border border-border-light overflow-hidden">
            <div className="bg-stone-100 px-4 py-2 border-b border-border-light">
              <span className="text-sm font-medium text-stone-700">Python — stream into a training pipeline</span>
            </div>
            <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100">
{`import requests, json

resp = requests.get(
    "https://sourcelibrary.org/api/dataset/v1/pages",
    headers={"Authorization": "Bearer sl_data_YOUR_KEY"},
    params={"language": "Latin", "content": "both", "limit": 5000},
    stream=True
)

for line in resp.iter_lines():
    record = json.loads(line)
    # record["original_text"]       → Latin OCR
    # record["english_translation"] → English translation
    # record["cluster"]             → "Western Alchemy", etc.
    print(f'{record["book_title"]}, p.{record["page_number"]}')`}
            </pre>
          </div>
          <div className="bg-white rounded-xl border border-border-light overflow-hidden">
            <div className="bg-stone-100 px-4 py-2 border-b border-border-light">
              <span className="text-sm font-medium text-stone-700">Browse available books in a corpus</span>
            </div>
            <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100">
{`curl -H "Authorization: Bearer sl_data_YOUR_KEY" \\
  "https://sourcelibrary.org/api/dataset/v1/books?language=Sanskrit&has_translation=true"`}
            </pre>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="mb-10" id="pricing">
        <Overline>Pricing</Overline>
        <h2 className="font-serif text-2xl text-primary mb-3">Self-serve API access</h2>
        <p className="text-secondary mb-8 max-w-2xl">
          All paid plans include quarterly dataset updates with changelogs. Annual plans save two months.
        </p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tierKeys.map(({ key, cta, ctaStyle }) => {
            const tier = DATASET_TIERS[key];
            const isFeatured = key === 'full';
            return (
              <div
                key={key}
                className={`bg-white rounded-xl p-6 border ${
                  isFeatured ? 'border-accent-rust shadow-md ring-1 ring-accent-rust/20' : 'border-border-light'
                } flex flex-col`}
              >
                {isFeatured && (
                  <span className="text-[11px] font-medium text-accent-rust uppercase tracking-[0.15em] mb-2">
                    Most popular
                  </span>
                )}
                <h3 className="text-lg font-semibold text-primary">{tier.name}</h3>
                <p className="text-secondary text-sm mt-1 mb-4 flex-1">{tier.description}</p>

                {key === 'enterprise' ? (
                  <div className="mb-4">
                    <span className="text-2xl text-primary font-light">Custom</span>
                  </div>
                ) : tier.monthlyPrice === 0 ? (
                  <div className="mb-4">
                    <span className="text-2xl text-primary font-light">Free</span>
                    <span className="text-muted text-sm ml-2">{tier.pagesPerDay} pages/day</span>
                  </div>
                ) : (
                  <div className="mb-4">
                    <span className="text-2xl text-primary font-light">
                      {formatPrice(tier.annualPrice, 'yr')}
                    </span>
                    <span className="text-muted text-sm ml-2">
                      or {formatPrice(tier.monthlyPrice, 'mo')}
                    </span>
                  </div>
                )}

                <div className="text-sm text-muted mb-4 space-y-1">
                  <div>{tier.requestsPerMinute} req/min</div>
                  {tier.pagesPerDay > 0 && <div>{tier.pagesPerDay} pages/day limit</div>}
                  {tier.scope === 'language' && <div>Choose any single language</div>}
                  {tier.scope === 'domain' && <div>Choose any taxonomy cluster</div>}
                  {tier.scope === 'full' && <div>All languages and domains</div>}
                </div>

                {key === 'enterprise' ? (
                  <a
                    href="mailto:data@sourcelibrary.org?subject=Enterprise%20Dataset%20License"
                    className="block text-center px-4 py-2.5 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50 transition-colors text-sm font-medium"
                  >
                    {cta}
                  </a>
                ) : key === 'explorer' ? (
                  <Link
                    href="/auth/signin?callbackUrl=/dataset/dashboard"
                    className="block text-center px-4 py-2.5 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50 transition-colors text-sm font-medium"
                  >
                    {cta}
                  </Link>
                ) : (
                  <Link
                    href={`/auth/signin?callbackUrl=/dataset/dashboard?tier=${key}`}
                    className={`block text-center px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      ctaStyle === 'primary'
                        ? 'bg-accent-rust text-white hover:bg-accent-rust/90'
                        : 'border border-stone-300 text-stone-700 hover:bg-stone-50'
                    }`}
                  >
                    {cta}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Feature comparison table ── */}
      <section className="mb-16">
        <div className="bg-white rounded-xl border border-border-light overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light">
                <th className="text-left py-3 px-4 font-medium text-muted w-48">Feature</th>
                <th className="text-center py-3 px-3 font-medium text-stone-500">Explorer</th>
                <th className="text-center py-3 px-3 font-medium text-stone-500">Language</th>
                <th className="text-center py-3 px-3 font-medium text-stone-500">Domain</th>
                <th className="text-center py-3 px-3 font-medium text-accent-rust">Full</th>
                <th className="text-center py-3 px-3 font-medium text-stone-500">Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_FEATURES.map((row, i) => (
                <tr key={row.feature} className={i < COMPARISON_FEATURES.length - 1 ? 'border-b border-stone-100' : ''}>
                  <td className="py-2.5 px-4 text-secondary">{row.feature}</td>
                  {(['explorer', 'language', 'domain', 'full', 'enterprise'] as const).map((tier) => {
                    const val = row[tier];
                    const isCheck = val === 'Yes';
                    const isNo = val === 'No';
                    return (
                      <td key={tier} className={`py-2.5 px-3 text-center ${tier === 'full' ? 'bg-accent-rust/[0.03]' : ''}`}>
                        {isCheck ? (
                          <svg className="w-4 h-4 text-accent-sage-dark mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        ) : isNo ? (
                          <span className="text-stone-300">&mdash;</span>
                        ) : (
                          <span className="text-stone-600">{val}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── API Reference ── */}
      <section className="mb-16">
        <Overline>API Reference</Overline>
        <h2 className="font-serif text-2xl text-primary mb-4">Endpoints</h2>
        <div className="bg-stone-100 rounded-lg px-4 py-2 mb-6 inline-block">
          <code className="text-stone-700">
            Base URL: <span className="text-accent-rust">https://sourcelibrary.org/api/dataset/v1</span>
          </code>
        </div>

        <div className="space-y-4">
          {[
            {
              method: 'GET',
              path: '/pages',
              desc: 'Streaming JSONL of page records with parallel text',
              params: 'language, cluster, from_year, to_year, content, offset, limit',
              auth: true,
            },
            {
              method: 'GET',
              path: '/books',
              desc: 'Book-level metadata with translation progress',
              params: 'language, cluster, from_year, to_year, has_translation, offset, limit',
              auth: true,
            },
            {
              method: 'GET',
              path: '/stats',
              desc: 'Corpus statistics — languages, clusters, page counts',
              params: 'none',
              auth: false,
            },
            {
              method: 'GET',
              path: '/keys',
              desc: 'List your API keys',
              params: 'none',
              auth: true,
              note: 'Session auth (not API key)',
            },
            {
              method: 'POST',
              path: '/keys',
              desc: 'Generate a new API key',
              params: 'name (body)',
              auth: true,
              note: 'Session auth',
            },
          ].map((ep) => (
            <div key={ep.path + ep.method} className="bg-white rounded-xl border border-border-light overflow-hidden">
              <div className="bg-stone-50 px-4 py-3 border-b border-border-light">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">
                    {ep.method}
                  </span>
                  <code className="text-primary">{ep.path}</code>
                  {ep.auth && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded">
                      {ep.note || 'API key'}
                    </span>
                  )}
                </div>
                <p className="text-secondary text-sm mt-1">{ep.desc}</p>
                {ep.params !== 'none' && (
                  <p className="text-muted text-xs mt-1">Params: {ep.params}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Legal & provenance ── */}
      <section className="mb-16">
        <Overline>Legal framework</Overline>
        <h2 className="font-serif text-2xl text-primary mb-6">Provenance &amp; compliance</h2>
        <div className="bg-white rounded-xl p-6 border border-border-light space-y-4">
          <div>
            <h3 className="font-semibold text-primary mb-1">EU Database Directive (96/9/EC)</h3>
            <p className="text-secondary text-sm">
              The underlying historical texts are public domain. The curated, structured, translated dataset
              — including OCR, English translations, taxonomy, and metadata — represents substantial investment
              in compilation and is protected under the EU sui generis database right.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-primary mb-1">EU AI Act compliance</h3>
            <p className="text-secondary text-sm">
              Every API response includes provenance metadata traceable to specific pages in specific books
              held by identified cultural institutions. Licensed access provides the documentation chain
              required by the EU AI Act&apos;s training data transparency obligations (effective August 2025).
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-primary mb-1">License terms</h3>
            <p className="text-secondary text-sm">
              Dataset licenses are non-exclusive and cover AI model training, fine-tuning, and evaluation.
              Redistribution of raw dataset records is not permitted. Enterprise licensees receive custom
              terms including exclusivity windows and SLAs.{' '}
              <Link href="/terms" className="text-accent-rust hover:underline">
                Full terms
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* ── Enterprise CTA ── */}
      <section className="mb-16">
        <div className="bg-gradient-to-br from-[#2a1f17] to-[#1a1612] rounded-xl p-8 md:p-12 text-white">
          <Overline>Enterprise</Overline>
          <h2 className="font-serif text-3xl mb-4 text-white">Managed partnership</h2>
          <p className="text-stone-300 max-w-2xl mb-6 leading-relaxed">
            For AI labs training foundation models. Custom terms including exclusive access windows,
            Parquet bulk exports, dedicated stewardship reports, and SLAs. Segmented by language,
            domain, or the full collection.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="mailto:data@sourcelibrary.org?subject=Enterprise%20Dataset%20License"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white text-stone-900 rounded-full hover:bg-stone-100 transition-colors font-medium"
            >
              Talk to an expert
            </a>
            <a
              href="/api/dataset/v1/stats"
              className="inline-flex items-center gap-2 px-6 py-3 border border-stone-500 text-stone-300 rounded-full hover:bg-white/10 transition-colors"
            >
              View corpus stats (JSON)
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer links ── */}
      <section className="border-t border-border-light pt-8">
        <div className="flex flex-wrap gap-4">
          <Link
            href="/data"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Browse the collection
          </Link>
          <Link
            href="/developers"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Free MCP server &amp; CLI
          </Link>
          <Link
            href="/terms"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Terms of use
          </Link>
        </div>
      </section>
    </ContentPageLayout>
  );
}
