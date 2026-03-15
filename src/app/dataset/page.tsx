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
    'Ten thousand historical texts in 90+ languages, translated and structured for the first time. From the Bodleian to the Vatican, now available as a single API.',
  alternates: { canonical: '/dataset' },
  openGraph: {
    title: 'Dataset API — Source Library',
    description:
      'Ten thousand historical texts in 90+ languages, translated and structured for the first time. From the Bodleian to the Vatican, now available as a single API.',
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
        { $limit: 15 },
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

function Overline({ children }: { children: string }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-accent-rust/70 mb-4 block">
      {children}
    </span>
  );
}

const SOURCE_INSTITUTIONS = [
  'Internet Archive',
  'Bavarian State Library',
  'Embassy of the Free Mind',
  'Gallica (BnF)',
  'Biblioteca Medicea Laurenziana',
  'Bodleian Library, Oxford',
  'Biblioteca Apostolica Vaticana',
  'Library of Congress',
  'Cambridge Digital Library',
  'Leiden University Library',
  'British Library',
  'Wellcome Collection',
  'Allard Pierson, Amsterdam',
  'e-codices',
  'Bibliotheca Klossiana',
];

const SAMPLE_JSONL = `{"book_id":"694f49d3...","page_number":12,"language":"Latin","original_text":"Omnia ab uno, & in unum omnia...","english_translation":"All things from one, and into one all things...","book_title":"Tabula Smaragdina","author":"Hermes Trismegistus","year":800,"cluster":"Western Alchemy","source_url":"https://sourcelibrary.org/book/tabula-smaragdina?page=12"}`;

const COMPARISON_FEATURES = [
  { feature: 'Page records', explorer: '100/day', language: 'Unlimited', domain: 'Unlimited', full: 'Unlimited', enterprise: 'Unlimited' },
  { feature: 'Languages', explorer: 'All (sample)', language: '1 language', domain: 'All in cluster', full: 'All 90+', enterprise: 'All 90+' },
  { feature: 'Domains', explorer: 'All (sample)', language: 'All', domain: '1 cluster', full: 'All 48', enterprise: 'All 48' },
  { feature: 'Original text + translation', explorer: 'Yes', language: 'Yes', domain: 'Yes', full: 'Yes', enterprise: 'Yes' },
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
          title="The Collection, Structured"
          subtitle="Ten thousand historical texts from thirty institutions, translated into English and aligned page by page. Now available as a single API."
        />
      }
      maxWidth="wide"
    >
      {/* ── Stats ── */}
      <section className="mb-28">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {[
            { value: formatNumber(stats.totalBooks), label: 'Historical texts' },
            { value: formatNumber(stats.pagesTranslated), label: 'Translated pages' },
            { value: `~${formatNumber(stats.estimatedTokens)}`, label: 'Estimated tokens' },
            { value: String(stats.languages.length) + '+', label: 'Languages' },
          ].map((s) => (
            <div key={s.label} className="py-2">
              <div className="text-3xl md:text-4xl text-accent-rust mb-2" style={{ fontWeight: 300 }}>
                {s.value}
              </div>
              <div className="text-muted text-sm">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Institutions ── */}
      <section className="mb-32">
        <Overline>Held by</Overline>
        <div className="flex flex-wrap gap-x-8 gap-y-3 items-baseline">
          {SOURCE_INSTITUTIONS.map((name) => (
            <span key={name} className="text-[13px] text-stone-400 whitespace-nowrap">
              {name}
            </span>
          ))}
          <span className="text-[13px] text-stone-300 italic">and 20 more</span>
        </div>
      </section>

      {/* ── Why this matters ── */}
      <section className="mb-32">
        <div className="max-w-3xl space-y-6">
          <p className="font-serif text-2xl md:text-3xl text-primary leading-snug">
            Most of what humanity has written is invisible to AI.
          </p>
          <p className="text-lg text-secondary leading-relaxed">
            The intellectual foundations of civilizations &mdash; in Latin, Greek, Arabic, Sanskrit,
            Chinese, Sumerian &mdash; are largely absent from training data. AI systems today
            hallucinate about historical concepts, mistranslate classical languages, and can&apos;t
            distinguish Hermetic from Neoplatonic thought. This is a gap in capability, and it
            matters for anyone building models that need to reason about the full span of
            human knowledge.
          </p>
          <p className="text-lg text-secondary leading-relaxed">
            This dataset is the corrective.
          </p>
        </div>
      </section>

      {/* ── What people do with it ── */}
      <section className="mb-32">
        <Overline>Use</Overline>
        <div className="max-w-3xl">
          <div className="space-y-8">
            <div>
              <h3 className="font-medium text-primary mb-1">Improve multilingual and historical language capability</h3>
              <p className="text-secondary leading-relaxed">
                Fine-tune or evaluate models on parallel text in languages where structured training data
                barely exists. Latin, Classical Chinese, Sanskrit, Sumerian &mdash; the aligned translations
                teach models how these languages actually work, not how the internet guesses they work.
              </p>
            </div>
            <div>
              <h3 className="font-medium text-primary mb-1">Train document understanding models</h3>
              <p className="text-secondary leading-relaxed">
                Page-level alignment between original text and translation, with full book metadata,
                provides the structure that document AI models need to learn from historical typography,
                manuscript layouts, and non-Latin scripts.
              </p>
            </div>
            <div>
              <h3 className="font-medium text-primary mb-1">Build scholarly and cultural heritage tools</h3>
              <p className="text-secondary leading-relaxed">
                Cross-language search, automatic translation of newly digitized texts,
                citation-aware research assistants, educational tools for reading ancient authors.
                The provenance chain and citation URLs make every result verifiable.
              </p>
            </div>
            <div>
              <h3 className="font-medium text-primary mb-1">Benchmark and evaluate</h3>
              <p className="text-secondary leading-relaxed">
                Test how well your model handles low-resource historical languages with
                real parallel text, not synthetic benchmarks. The Translation Commons
                provides an ongoing, human-verified quality baseline.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── What it is ── */}
      <section className="mb-32">
        <Overline>The collection</Overline>
        <div className="max-w-3xl space-y-6">
          <p className="text-lg text-secondary leading-relaxed">
            {formatNumber(stats.totalBooks)} texts from thirty cultural institutions &mdash;
            manuscripts, printed books, and cuneiform tablets spanning four millennia,
            transcribed and translated page by page into English.
            Each record carries its original text, its translation, and a provenance chain
            back to the holding institution.
          </p>
          <p className="text-lg text-secondary leading-relaxed">
            The translations pass through an open scholarly review we call the{' '}
            <em>Translation Commons</em>. Language specialists contribute corrections
            continuously, and the collection improves with each quarterly update.
          </p>
        </div>
      </section>

      {/* ── Languages ── */}
      <section className="mb-32" id="corpora">
        <Overline>Languages</Overline>
        <div className="space-y-4">
          {topLanguages.map((l) => (
            <div key={l.language} className="flex items-center gap-4">
              <span className="text-sm text-secondary w-36 shrink-0 text-right">{l.language}</span>
              <div className="flex-1 bg-stone-200/50 rounded-full h-6 overflow-hidden relative">
                <div
                  className="h-full rounded-full bg-accent-sage/70"
                  style={{ width: `${Math.max(3, (l.books / maxLangBooks) * 100)}%` }}
                />
                <span className="absolute inset-y-0 left-3 flex items-center text-xs text-stone-500">
                  {formatNumber(l.books)} books &middot; {formatNumber(l.pagesTranslated)} translated
                </span>
              </div>
            </div>
          ))}
        </div>
        {stats.languages.length > 12 && (
          <p className="text-sm text-muted mt-6 ml-40">
            and {stats.languages.length - 12} more &mdash;{' '}
            <a href="/api/dataset/v1/stats" className="text-accent-rust hover:underline">
              full stats via API
            </a>
          </p>
        )}
      </section>

      {/* ── Domains ── */}
      <section className="mb-32">
        <Overline>Domains</Overline>
        <div className="flex flex-wrap gap-2.5">
          {stats.clusters.map((c) => (
            <span
              key={c.cluster}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-accent-violet/8 text-accent-violet"
            >
              {c.cluster}
              <span className="text-accent-violet/50 text-xs">{c.books}</span>
            </span>
          ))}
        </div>
      </section>

      {/* ── Format ── */}
      <section className="mb-32" id="api">
        <Overline>Format</Overline>
        <h2 className="font-serif text-2xl text-primary mb-3">One page, one record</h2>
        <p className="text-secondary mb-8 max-w-2xl">
          Original text, English translation, book metadata, taxonomy, and citation URL.
          Delivered as streaming JSONL.
        </p>
        <div className="rounded-xl border border-border-light overflow-hidden">
          <pre className="p-6 text-sm overflow-x-auto bg-stone-900 text-stone-100 leading-relaxed">
            {JSON.stringify(JSON.parse(SAMPLE_JSONL), null, 2)}
          </pre>
        </div>
        <div className="mt-6 flex flex-wrap gap-6">
          <a
            href="/api/dataset/v1/stats"
            className="text-sm text-accent-rust hover:underline"
          >
            Try the stats endpoint
          </a>
          <Link
            href="/developers"
            className="text-sm text-accent-rust hover:underline"
          >
            Full API documentation
          </Link>
        </div>
      </section>

      {/* ── Quickstart ── */}
      <section className="mb-32">
        <Overline>Quickstart</Overline>
        <div className="rounded-xl border border-border-light overflow-hidden">
          <div className="bg-stone-100 px-5 py-3 border-b border-border-light">
            <span className="text-sm font-medium text-stone-600">Stream Latin parallel text</span>
          </div>
          <pre className="p-5 text-sm overflow-x-auto bg-stone-900 text-stone-100 leading-relaxed">
{`curl -H "Authorization: Bearer sl_data_YOUR_KEY" \\
  "https://sourcelibrary.org/api/dataset/v1/pages?language=Latin&content=both&limit=1000"`}
          </pre>
        </div>
      </section>

      {/* ── What it took ── */}
      <section className="mb-32">
        <Overline>Provenance</Overline>
        <h2 className="font-serif text-2xl text-primary mb-8">What it took to build this</h2>
        <div className="rounded-xl border border-border-light overflow-hidden">
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border-light">
            <div className="p-8 md:p-10 bg-white">
              <div className="space-y-4 text-secondary text-sm">
                <div className="flex justify-between">
                  <span>Identifying &amp; acquiring 10,000+ rare texts</span>
                  <span className="text-stone-400 tabular-nums">30 institutions</span>
                </div>
                <div className="flex justify-between">
                  <span>OCR of 1.2 million pages of historical print</span>
                  <span className="text-stone-400 tabular-nums">~$120,000</span>
                </div>
                <div className="flex justify-between">
                  <span>Translation of 800K pages across 90+ languages</span>
                  <span className="text-stone-400 tabular-nums">~$800,000</span>
                </div>
                <div className="flex justify-between">
                  <span>Scholarly review &amp; correction</span>
                  <span className="text-stone-400 tabular-nums">~$200,000</span>
                </div>
                <div className="flex justify-between">
                  <span>Taxonomy, metadata, page alignment</span>
                  <span className="text-stone-400 tabular-nums">~$80,000</span>
                </div>
                <div className="flex justify-between border-t border-border-light pt-4 font-medium text-primary">
                  <span>Investment to date</span>
                  <span className="tabular-nums">~$1.2M over 2 years</span>
                </div>
              </div>
            </div>
            <div className="p-8 md:p-10 bg-stone-50/50">
              <div className="space-y-4 text-secondary text-sm">
                <div className="flex justify-between">
                  <span>Full collection</span>
                  <span className="text-accent-rust tabular-nums font-medium">from $49,990/yr</span>
                </div>
                <div className="flex justify-between">
                  <span>Single language corpus</span>
                  <span className="text-stone-500 tabular-nums">from $4,990/yr</span>
                </div>
                <div className="flex justify-between">
                  <span>Quarterly updates &amp; changelogs</span>
                  <span className="text-stone-400">Included</span>
                </div>
                <div className="flex justify-between">
                  <span>Ongoing scholarly review</span>
                  <span className="text-stone-400">Included</span>
                </div>
                <div className="flex justify-between">
                  <span>EU AI Act provenance chain</span>
                  <span className="text-stone-400">Included</span>
                </div>
                <div className="flex justify-between border-t border-border-light pt-4">
                  <span className="font-medium text-primary">Time to first data</span>
                  <span className="text-accent-rust tabular-nums font-medium">5 minutes</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Plans ── */}
      <section className="mb-12" id="pricing">
        <Overline>Access</Overline>
        <h2 className="font-serif text-2xl text-primary mb-3">Plans</h2>
        <p className="text-secondary mb-10 max-w-2xl">
          All paid plans include quarterly updates with changelogs. Annual plans save two months.
        </p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {tierKeys.map(({ key, cta, ctaStyle }) => {
            const tier = DATASET_TIERS[key];
            const isFeatured = key === 'full';
            return (
              <div
                key={key}
                className={`bg-white rounded-xl p-7 border ${
                  isFeatured ? 'border-accent-rust shadow-md ring-1 ring-accent-rust/20' : 'border-border-light'
                } flex flex-col`}
              >
                {isFeatured && (
                  <span className="text-[11px] font-medium text-accent-rust uppercase tracking-[0.15em] mb-2">
                    Most popular
                  </span>
                )}
                <h3 className="text-lg font-semibold text-primary">{tier.name}</h3>
                <p className="text-secondary text-sm mt-1 mb-5 flex-1">{tier.description}</p>

                {key === 'enterprise' ? (
                  <div className="mb-5">
                    <span className="text-2xl text-primary font-light">Custom</span>
                  </div>
                ) : tier.monthlyPrice === 0 ? (
                  <div className="mb-5">
                    <span className="text-2xl text-primary font-light">Free</span>
                    <span className="text-muted text-sm ml-2">{tier.pagesPerDay} pages/day</span>
                  </div>
                ) : (
                  <div className="mb-5">
                    <span className="text-2xl text-primary font-light">
                      {formatPrice(tier.annualPrice, 'yr')}
                    </span>
                    <span className="text-muted text-sm ml-2">
                      or {formatPrice(tier.monthlyPrice, 'mo')}
                    </span>
                  </div>
                )}

                <div className="text-sm text-muted mb-5 space-y-1.5">
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

      {/* ── Comparison table ── */}
      <section className="mb-32">
        <div className="rounded-xl border border-border-light overflow-x-auto bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light">
                <th className="text-left py-3.5 px-5 font-medium text-muted w-48">Feature</th>
                <th className="text-center py-3.5 px-3 font-medium text-stone-500">Explorer</th>
                <th className="text-center py-3.5 px-3 font-medium text-stone-500">Language</th>
                <th className="text-center py-3.5 px-3 font-medium text-stone-500">Domain</th>
                <th className="text-center py-3.5 px-3 font-medium text-accent-rust">Full</th>
                <th className="text-center py-3.5 px-3 font-medium text-stone-500">Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_FEATURES.map((row, i) => (
                <tr key={row.feature} className={i < COMPARISON_FEATURES.length - 1 ? 'border-b border-stone-100' : ''}>
                  <td className="py-3 px-5 text-secondary">{row.feature}</td>
                  {(['explorer', 'language', 'domain', 'full', 'enterprise'] as const).map((tier) => {
                    const val = row[tier];
                    const isCheck = val === 'Yes';
                    const isNo = val === 'No';
                    return (
                      <td key={tier} className={`py-3 px-3 text-center ${tier === 'full' ? 'bg-accent-rust/[0.03]' : ''}`}>
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

      {/* ── Enterprise ── */}
      <section className="mb-32">
        <div className="bg-gradient-to-br from-[#2a1f17] to-[#1a1612] rounded-xl p-10 md:p-14 text-white">
          <Overline>Partnership</Overline>
          <h2 className="font-serif text-3xl md:text-4xl mb-5 text-white">For foundation model teams</h2>
          <p className="text-stone-300 max-w-2xl mb-8 text-lg leading-relaxed">
            Dedicated access with custom terms. Exclusive windows on new translations,
            Parquet bulk exports, stewardship reports, and SLAs. The collection can be segmented
            by language, domain, time period, or delivered whole.
          </p>
          <div className="flex flex-wrap gap-4">
            <a
              href="mailto:data@sourcelibrary.org?subject=Enterprise%20Dataset%20License"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-stone-900 rounded-full hover:bg-stone-100 transition-colors font-medium"
            >
              Talk to an expert
            </a>
            <a
              href="/api/dataset/v1/stats"
              className="inline-flex items-center gap-2 px-7 py-3.5 border border-stone-500 text-stone-300 rounded-full hover:bg-white/10 transition-colors"
            >
              View corpus stats
            </a>
          </div>
        </div>
      </section>

      {/* ── Legal (brief) ── */}
      <section className="mb-32">
        <p className="text-sm text-muted max-w-3xl leading-relaxed">
          The dataset is protected under the EU Database Directive (96/9/EC).
          Every API response includes provenance metadata for EU AI Act compliance.
          Licenses are non-exclusive and cover model training, fine-tuning, and evaluation.{' '}
          <Link href="/terms" className="text-accent-rust hover:underline">
            Full terms
          </Link>
        </p>
      </section>

      {/* ── Footer ── */}
      <section className="border-t border-border-light pt-10">
        <div className="flex flex-wrap gap-5">
          <Link
            href="/data"
            className="text-sm text-stone-500 hover:text-accent-rust transition-colors"
          >
            Browse the collection
          </Link>
          <Link
            href="/developers"
            className="text-sm text-stone-500 hover:text-accent-rust transition-colors"
          >
            MCP server &amp; CLI
          </Link>
          <Link
            href="/terms"
            className="text-sm text-stone-500 hover:text-accent-rust transition-colors"
          >
            Terms
          </Link>
        </div>
      </section>
    </ContentPageLayout>
  );
}
