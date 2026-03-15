import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { getDb } from '@/lib/mongodb';
import { DATASET_TIERS } from '@/lib/dataset/types';

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

const SAMPLE_JSONL = `{"book_id":"694f49d3...","page_number":12,"language":"Latin","original_text":"Omnia ab uno, & in unum omnia...","english_translation":"All things from one, and into one all things...","book_title":"Tabula Smaragdina","author":"Hermes Trismegistus","year":800,"cluster":"Western Alchemy","source_url":"https://sourcelibrary.org/book/tabula-smaragdina?page=12"}`;

/* Source institutions — trust signals */
const SOURCE_INSTITUTIONS = [
  'Internet Archive',
  'Bodleian Library, Oxford',
  'Vatican Library',
  'Bavarian State Library',
  'British Library',
  'Cambridge Digital Library',
  'Wellcome Collection',
  'Library of Congress',
  'Embassy of the Free Mind',
];

export default async function DatasetPage() {
  const stats = await fetchDatasetStats();
  const topLanguages = stats.languages.slice(0, 12);
  const maxLangBooks = topLanguages[0]?.books ?? 1;

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Training Data for Historical Languages"
          subtitle="Your models are weak on Latin, Sanskrit, and Classical Chinese because structured training data for them didn't exist. Now it does."
        />
      }
      maxWidth="wide"
    >
      {/* ── SOURCE INSTITUTIONS ── */}
      <section className="mb-16">
        <p className="text-xs uppercase tracking-widest text-muted mb-5">Sourced from</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {SOURCE_INSTITUTIONS.map((name) => (
            <span key={name} className="text-sm text-stone-500">{name}</span>
          ))}
        </div>
      </section>

      {/* ── HEADLINE STATS ── */}
      <section className="mb-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { value: formatNumber(stats.totalBooks), label: 'Historical texts' },
            { value: formatNumber(stats.pagesTranslated), label: 'Pages translated' },
            { value: `~${formatNumber(stats.estimatedTokens)}`, label: 'Tokens' },
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

      {/* ── THE PROBLEM ── */}
      <section className="mb-16">
        <p className="text-xs uppercase tracking-widest text-muted mb-5">The problem</p>
        <div className="max-w-3xl">
          <p className="font-serif text-xl text-primary leading-relaxed mb-4">
            Millions of historical texts have been digitized. But digitized is not structured.
            A scan of a 16th-century Latin alchemical text is useless for training until someone
            OCRs it, translates it, aligns the translation page-by-page, classifies it by domain,
            and verifies the quality.
          </p>
          <p className="text-secondary leading-relaxed">
            That work takes years of scholarly judgment and can&apos;t be automated.
            We&apos;ve done it for {formatNumber(stats.totalBooks)} texts across {stats.languages.length}+ languages,
            from Sumerian cuneiform tablets to Renaissance philosophical treatises.
            The result is the only structured parallel-text dataset for historical and low-resource languages.
          </p>
        </div>
      </section>

      {/* ── WHAT'S IN THE DATASET ── */}
      <section className="mb-16">
        <p className="text-xs uppercase tracking-widest text-muted mb-5">What you get</p>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl p-6 border border-border-light">
            <h3 className="font-semibold text-primary mb-2">Parallel text</h3>
            <p className="text-secondary text-sm leading-relaxed">
              Original language + English translation, aligned page by page. Latin, Ancient Greek,
              Classical Chinese, Sanskrit, Sumerian, Syriac, Arabic, early modern German, and
              {' '}{stats.languages.length - 8}+ more.
            </p>
          </div>
          <div className="bg-white rounded-xl p-6 border border-border-light">
            <h3 className="font-semibold text-primary mb-2">Scholarly metadata</h3>
            <p className="text-secondary text-sm leading-relaxed">
              Every record includes author, date, language, holding institution, taxonomy classification,
              and a citation URL. 48 scholarly domains from Western Alchemy to Sanskrit Jyotisha.
            </p>
          </div>
          <div className="bg-white rounded-xl p-6 border border-border-light">
            <h3 className="font-semibold text-primary mb-2">EU-compliant provenance</h3>
            <p className="text-secondary text-sm leading-relaxed">
              Full chain from API record to page scan to holding institution. Licensed access
              provides the documentation required by the EU AI Act&apos;s training data transparency
              obligations.
            </p>
          </div>
        </div>
      </section>

      {/* ── TRANSLATION COMMONS ── */}
      <section className="mb-16">
        <p className="text-xs uppercase tracking-widest text-muted mb-5">Quality assurance</p>
        <div className="bg-white rounded-xl p-6 md:p-8 border border-border-light max-w-3xl">
          <h3 className="font-serif text-xl text-primary mb-3">The Translation Commons</h3>
          <p className="text-secondary leading-relaxed mb-4">
            This is not a static dataset. Every translation is subject to ongoing community review
            by scholars, language specialists, and domain experts. Corrections flow back into the
            dataset continuously. Your license includes quarterly updates with changelogs documenting
            every improvement.
          </p>
          <p className="text-secondary leading-relaxed">
            The stewardship fee in each paid plan funds the Translation Commons — the human review process
            that makes this a living, improving resource. AI-generated translations verified by human expertise.
            The dataset gets better every quarter.
          </p>
        </div>
      </section>

      {/* ── AVAILABLE CORPORA ── */}
      <section className="mb-16" id="corpora">
        <p className="text-xs uppercase tracking-widest text-muted mb-5">Available corpora</p>
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

        {/* Domain clusters */}
        <div className="mt-6 bg-white rounded-xl p-6 border border-border-light">
          <h3 className="text-sm font-medium text-primary mb-3">By scholarly domain</h3>
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

      {/* ── DATA FORMAT ── */}
      <section className="mb-16" id="api">
        <p className="text-xs uppercase tracking-widest text-muted mb-5">Data format</p>
        <p className="text-secondary mb-4 max-w-2xl">
          Streaming JSONL. One record per page. Each record contains original-language text,
          English translation, book metadata, taxonomy, and a citation URL traceable to the
          holding institution.
        </p>
        <div className="bg-white rounded-xl border border-border-light overflow-hidden">
          <div className="bg-stone-100 px-4 py-2 border-b border-border-light flex items-center justify-between">
            <span className="text-sm font-medium text-stone-700">Sample record</span>
            <code className="text-xs text-muted">application/x-ndjson</code>
          </div>
          <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100 leading-relaxed">
            {JSON.stringify(JSON.parse(SAMPLE_JSONL), null, 2)}
          </pre>
        </div>
      </section>

      {/* ── QUICKSTART ── */}
      <section className="mb-16">
        <p className="text-xs uppercase tracking-widest text-muted mb-5">Quickstart</p>
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
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="mb-16" id="pricing">
        <p className="text-xs uppercase tracking-widest text-muted mb-5">Pricing</p>

        {/* Two-track framing */}
        <div className="grid md:grid-cols-2 gap-8 mb-10">
          {/* Self-serve track */}
          <div>
            <h2 className="font-serif text-2xl text-primary mb-2">Self-serve API</h2>
            <p className="text-secondary text-sm mb-6">
              Sign up, get an API key, start pulling data. All plans include quarterly
              dataset updates. Annual plans save two months.
            </p>

            <div className="space-y-3">
              {(['explorer', 'language', 'domain', 'full'] as const).map((key) => {
                const tier = DATASET_TIERS[key];
                const isFeatured = key === 'full';
                return (
                  <div
                    key={key}
                    className={`bg-white rounded-xl p-5 border ${
                      isFeatured ? 'border-accent-rust ring-1 ring-accent-rust/20' : 'border-border-light'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-primary">{tier.name}</h3>
                          {isFeatured && (
                            <span className="text-[10px] font-medium text-accent-rust uppercase tracking-wide px-1.5 py-0.5 bg-accent-rust/10 rounded">
                              Popular
                            </span>
                          )}
                        </div>
                        <p className="text-secondary text-sm mt-0.5">{tier.description}</p>
                        <div className="text-xs text-muted mt-2 flex flex-wrap gap-x-4 gap-y-0.5">
                          <span>{tier.requestsPerMinute} req/min</span>
                          {tier.pagesPerDay > 0 && <span>{tier.pagesPerDay} pages/day</span>}
                          {tier.scope === 'language' && <span>One language</span>}
                          {tier.scope === 'domain' && <span>One domain cluster</span>}
                          {tier.scope === 'full' && <span>All languages &amp; domains</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {tier.monthlyPrice === 0 ? (
                          <span className="text-lg text-primary font-light">Free</span>
                        ) : (
                          <>
                            <div className="text-lg text-primary font-light">
                              {formatPrice(tier.annualPrice, 'yr')}
                            </div>
                            <div className="text-xs text-muted">
                              or {formatPrice(tier.monthlyPrice, 'mo')}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <Link
              href="/auth/signin?callbackUrl=/dataset/dashboard"
              className="inline-flex items-center gap-2 mt-6 px-6 py-3 bg-accent-rust text-white rounded-full hover:bg-accent-rust/90 transition-colors font-medium"
            >
              Get API key
            </Link>
          </div>

          {/* Enterprise track */}
          <div>
            <h2 className="font-serif text-2xl text-primary mb-2">Enterprise partnership</h2>
            <p className="text-secondary text-sm mb-6">
              For AI labs training foundation models. Custom terms, dedicated support,
              and stewardship reports.
            </p>

            <div className="bg-gradient-to-br from-[#2a1f17] to-[#1a1612] rounded-xl p-6 text-white">
              <div className="space-y-4 text-sm text-stone-300">
                <div className="flex items-start gap-3">
                  <span className="text-stone-500 mt-0.5">&#x2014;</span>
                  <span>Exclusive access windows before other licensees</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-stone-500 mt-0.5">&#x2014;</span>
                  <span>Parquet bulk exports for direct pipeline integration</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-stone-500 mt-0.5">&#x2014;</span>
                  <span>Quarterly stewardship reports with translation quality metrics</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-stone-500 mt-0.5">&#x2014;</span>
                  <span>Segment by language, domain, or the full collection</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-stone-500 mt-0.5">&#x2014;</span>
                  <span>Custom SLA and dedicated technical contact</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-stone-500 mt-0.5">&#x2014;</span>
                  <span>Most-favored-nation pricing protection</span>
                </div>
              </div>

              <a
                href="mailto:data@sourcelibrary.org?subject=Enterprise%20Dataset%20License"
                className="inline-flex items-center gap-2 mt-6 px-6 py-3 bg-white text-stone-900 rounded-full hover:bg-stone-100 transition-colors font-medium text-sm"
              >
                Talk to an expert
              </a>
            </div>

            {/* Cost comparison */}
            <div className="mt-6 bg-white rounded-xl p-5 border border-border-light">
              <h3 className="text-sm font-medium text-primary mb-2">Cost of building this yourself</h3>
              <div className="space-y-2 text-sm text-secondary">
                <div className="flex justify-between">
                  <span>OCR {formatNumber(stats.pagesOcr)} pages</span>
                  <span className="text-muted tabular-nums">~$380K</span>
                </div>
                <div className="flex justify-between">
                  <span>Translate {formatNumber(stats.pagesTranslated)} pages</span>
                  <span className="text-muted tabular-nums">~$2.4M</span>
                </div>
                <div className="flex justify-between">
                  <span>Scholarly curation &amp; taxonomy</span>
                  <span className="text-muted tabular-nums">~$500K</span>
                </div>
                <div className="flex justify-between">
                  <span>Quality verification</span>
                  <span className="text-muted tabular-nums">~$200K</span>
                </div>
                <div className="flex justify-between border-t border-border-light pt-2 font-medium text-primary">
                  <span>Total estimated cost</span>
                  <span className="tabular-nums">~$3.5M</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Estimated time</span>
                  <span>3+ years</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── API REFERENCE ── */}
      <section className="mb-16">
        <p className="text-xs uppercase tracking-widest text-muted mb-5">API reference</p>
        <div className="bg-stone-100 rounded-lg px-4 py-2 mb-6 inline-block">
          <code className="text-stone-700">
            Base URL: <span className="text-accent-rust">https://sourcelibrary.org/api/dataset/v1</span>
          </code>
        </div>

        <div className="space-y-3">
          {[
            {
              method: 'GET',
              path: '/pages',
              desc: 'Streaming JSONL of page records with parallel text',
              params: 'language, cluster, from_year, to_year, content, offset, limit',
              auth: 'API key',
            },
            {
              method: 'GET',
              path: '/books',
              desc: 'Book-level metadata with translation progress',
              params: 'language, cluster, from_year, to_year, has_translation, offset, limit',
              auth: 'API key',
            },
            {
              method: 'GET',
              path: '/stats',
              desc: 'Corpus statistics — languages, clusters, page counts',
              params: 'none',
              auth: null,
            },
            {
              method: 'POST',
              path: '/keys',
              desc: 'Generate a new API key',
              params: 'name (body)',
              auth: 'Session',
            },
          ].map((ep) => (
            <div key={ep.path + ep.method} className="bg-white rounded-xl border border-border-light overflow-hidden">
              <div className="bg-stone-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-mono rounded">
                    {ep.method}
                  </span>
                  <code className="text-primary">{ep.path}</code>
                  {ep.auth && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded">
                      {ep.auth}
                    </span>
                  )}
                  {!ep.auth && (
                    <span className="px-2 py-0.5 bg-green-50 text-green-600 text-xs rounded">
                      Public
                    </span>
                  )}
                </div>
                <p className="text-secondary text-sm mt-1">{ep.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── LEGAL FRAMEWORK ── */}
      <section className="mb-16">
        <p className="text-xs uppercase tracking-widest text-muted mb-5">Legal framework</p>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl p-5 border border-border-light">
            <h3 className="font-semibold text-primary text-sm mb-2">Database rights</h3>
            <p className="text-secondary text-sm leading-relaxed">
              Protected under EU Database Directive (96/9/EC). The underlying texts are
              public domain; the curated compilation is separately protectable.
            </p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-border-light">
            <h3 className="font-semibold text-primary text-sm mb-2">AI Act compliance</h3>
            <p className="text-secondary text-sm leading-relaxed">
              Every record traces to a specific page in a specific book held by an identified
              institution. Licensed access satisfies transparency obligations.
            </p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-border-light">
            <h3 className="font-semibold text-primary text-sm mb-2">License terms</h3>
            <p className="text-secondary text-sm leading-relaxed">
              Non-exclusive. Covers training, fine-tuning, and evaluation.
              Redistribution not permitted.{' '}
              <Link href="/terms" className="text-accent-rust hover:underline">
                Full terms
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* ── FOOTER LINKS ── */}
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
          <a
            href="/api/dataset/v1/stats"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Corpus stats (JSON)
          </a>
        </div>
      </section>
    </ContentPageLayout>
  );
}
