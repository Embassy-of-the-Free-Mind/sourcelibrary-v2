import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export const metadata: Metadata = {
  title: 'Dataset — Source Library',
  description:
    'Structured training data from 10,000+ historical texts in 90+ languages. The only parallel-text dataset for historical languages.',
  alternates: { canonical: '/dataset' },
  openGraph: {
    title: 'Dataset — Source Library',
    description:
      'The only structured parallel-text dataset for historical languages. Page-aligned original text, English translation, and metadata.',
  },
};

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

async function fetchDatasetStats() {
  const db = await getDb();
  const books = db.collection('books');
  const visible = { hidden: { $ne: true } };

  const [totalBooks, pageTotalsAgg, languagesAgg] = await Promise.all([
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
  ]);

  const totals = pageTotalsAgg[0] ?? { pages: 0, ocr: 0, translated: 0 };

  return {
    totalBooks,
    totalPages: totals.pages,
    pagesOcr: totals.ocr,
    pagesTranslated: totals.translated,
    languages: languagesAgg.map((l) => ({
      language: l._id,
      books: l.count,
      pagesTranslated: l.translated,
    })),
  };
}

export default async function DatasetPage() {
  const stats = await fetchDatasetStats();

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Dataset"
          subtitle="Structured parallel text for historical languages, available for licensing."
        />
      }
      maxWidth="medium"
      bg="bg-[#faf9f7]"
    >
      {/* ── Opening statement ── */}
      <section className="mb-24">
        <p className="font-serif text-2xl md:text-[28px] text-[#1a1a18] leading-[1.5] max-w-[640px]">
          {formatNumber(stats.totalBooks)} historical texts. {formatNumber(stats.pagesTranslated)} pages
          translated into English. {stats.languages.length} languages, from Sumerian to Renaissance Latin.
          Page-aligned, structured, and available via API.
        </p>
      </section>

      {/* ── The problem, in prose ── */}
      <section className="mb-24 max-w-[640px]">
        <p className="text-[#444] leading-[1.75] mb-6">
          Large language models perform poorly on historical languages because structured training data
          for them has never existed. The texts have been digitized — millions of pages sit in the archives
          of the Bodleian Library, the Vatican, the Bavarian State Library, the British Library — but
          a scan of a 16th-century Latin alchemical treatise is not training data.
        </p>
        <p className="text-[#444] leading-[1.75]">
          Training data requires OCR, translation, page-level alignment, scholarly classification,
          and quality verification. That curation takes years and cannot be fully automated.
          We have done it for {formatNumber(stats.totalBooks)} texts across {stats.languages.length} languages.
        </p>
      </section>

      {/* ── Source institutions ── */}
      <section className="mb-24">
        <p className="text-xs uppercase tracking-[0.15em] text-[#999] mb-6">Sourced from</p>
        <div className="space-y-1">
          {[
            'Bodleian Library, University of Oxford',
            'Biblioteca Apostolica Vaticana',
            'Bavarian State Library',
            'British Library',
            'Library of Congress',
            'Cambridge University Library',
            'Wellcome Collection',
            'Internet Archive',
            'Embassy of the Free Mind',
          ].map((name) => (
            <p key={name} className="text-[#666] text-[15px]">{name}</p>
          ))}
        </div>
      </section>

      {/* ── Languages ── */}
      <section className="mb-24">
        <p className="text-xs uppercase tracking-[0.15em] text-[#999] mb-6">Languages</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-12 gap-y-4">
          {stats.languages.map((l) => (
            <div key={l.language} className="flex justify-between items-baseline border-b border-[#e8e6e3] pb-2">
              <span className="text-[#1a1a18] text-[15px]">{l.language}</span>
              <span className="text-[#999] text-sm tabular-nums">
                {formatNumber(l.books)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── What the data looks like ── */}
      <section className="mb-24">
        <p className="text-xs uppercase tracking-[0.15em] text-[#999] mb-6">Data format</p>
        <p className="text-[#444] leading-[1.75] mb-6 max-w-[640px]">
          Each record is a single page. Original-language text and English translation,
          with author, date, language, and a citation URL traceable to the holding institution.
          Delivered as streaming JSONL.
        </p>
        <div className="rounded-lg border border-[#e8e6e3] overflow-hidden">
          <pre className="p-5 text-[13px] overflow-x-auto bg-[#1a1a18] text-[#d4d0c8] leading-relaxed">
{JSON.stringify({
  book_id: '694f49d3...',
  page_number: 12,
  language: 'Latin',
  original_text: 'Omnia ab uno, & in unum omnia...',
  english_translation: 'All things from one, and into one all things...',
  book_title: 'Tabula Smaragdina',
  author: 'Hermes Trismegistus',
  year: 800,
  source_url: 'https://sourcelibrary.org/book/tabula-smaragdina?page=12',
}, null, 2)}
          </pre>
        </div>
      </section>

      {/* ── Translation Commons ── */}
      <section className="mb-24 max-w-[640px]">
        <p className="text-xs uppercase tracking-[0.15em] text-[#999] mb-6">Quality</p>
        <p className="font-serif text-xl text-[#1a1a18] leading-[1.6] mb-4">
          The Translation Commons
        </p>
        <p className="text-[#444] leading-[1.75] mb-4">
          This is not a static dataset. Every translation is subject to ongoing review
          by scholars and language specialists. Corrections flow back into the data continuously.
          Paid licenses include quarterly updates with changelogs documenting every improvement.
        </p>
        <p className="text-[#444] leading-[1.75]">
          The stewardship fee in each plan funds this process — AI-assisted translation
          verified by human expertise. The dataset improves every quarter.
        </p>
      </section>

      {/* ── Access ── */}
      <section className="mb-24">
        <p className="text-xs uppercase tracking-[0.15em] text-[#999] mb-6">Access</p>

        <div className="max-w-[640px] mb-10">
          <p className="text-[#444] leading-[1.75] mb-6">
            The dataset is available through a tiered API. A free key gives access to 100 pages
            per day for evaluation. Paid plans unlock full corpora by language or domain.
            Enterprise partnerships include Parquet exports, exclusive access windows, and
            dedicated stewardship reports.
          </p>
        </div>

        <div className="space-y-px rounded-lg border border-[#e8e6e3] overflow-hidden">
          {[
            { name: 'Explorer', price: 'Free', scope: '100 pages/day, any language', note: 'For evaluation' },
            { name: 'Single Language', price: '$4,990/yr', scope: 'One language corpus, unlimited', note: 'or $499/mo' },
            { name: 'Domain', price: '$14,990/yr', scope: 'One scholarly domain, unlimited', note: 'or $1,499/mo' },
            { name: 'Full Collection', price: '$49,990/yr', scope: 'All languages, all domains', note: 'or $4,999/mo' },
            { name: 'Enterprise', price: 'Custom', scope: 'Parquet exports, exclusivity, SLA', note: null },
          ].map((tier) => (
            <div key={tier.name} className="flex items-baseline justify-between gap-4 px-5 py-4 bg-white">
              <div className="flex-1">
                <span className="text-[#1a1a18] text-[15px] font-medium">{tier.name}</span>
                <span className="text-[#999] text-sm ml-3">{tier.scope}</span>
              </div>
              <div className="text-right shrink-0">
                <span className="text-[#1a1a18] text-[15px] tabular-nums">{tier.price}</span>
                {tier.note && (
                  <span className="text-[#bbb] text-xs ml-2">{tier.note}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-4 mt-8">
          <Link
            href="/auth/signin?callbackUrl=/dataset/dashboard"
            className="px-6 py-3 bg-[#1a1a18] text-white rounded-full text-sm font-medium hover:bg-[#333] transition-colors"
          >
            Get API key
          </Link>
          <a
            href="mailto:data@sourcelibrary.org?subject=Dataset%20License%20Inquiry"
            className="px-6 py-3 border border-[#ccc] text-[#444] rounded-full text-sm font-medium hover:border-[#999] transition-colors"
          >
            Talk to an expert
          </a>
        </div>
      </section>

      {/* ── Quickstart ── */}
      <section className="mb-24">
        <p className="text-xs uppercase tracking-[0.15em] text-[#999] mb-6">Quickstart</p>
        <div className="rounded-lg border border-[#e8e6e3] overflow-hidden">
          <pre className="p-5 text-[13px] overflow-x-auto bg-[#1a1a18] text-[#d4d0c8] leading-relaxed">
{`curl -H "Authorization: Bearer sl_data_YOUR_KEY" \\
  "https://sourcelibrary.org/api/dataset/v1/pages?language=Latin&limit=1000"`}
          </pre>
        </div>
      </section>

      {/* ── Legal ── */}
      <section className="mb-24 max-w-[640px]">
        <p className="text-xs uppercase tracking-[0.15em] text-[#999] mb-6">Legal</p>
        <p className="text-[#444] leading-[1.75] mb-4">
          The dataset is protected under the EU Database Directive (96/9/EC).
          The underlying texts are in the public domain; the curated compilation —
          OCR, translations, taxonomy, and metadata — is separately protectable.
        </p>
        <p className="text-[#444] leading-[1.75]">
          Licensed access provides the provenance documentation required by the
          EU AI Act&apos;s training data transparency obligations. Licenses are
          non-exclusive and cover training, fine-tuning, and evaluation.{' '}
          <Link href="/terms" className="text-[#1a1a18] underline underline-offset-2 decoration-[#ccc] hover:decoration-[#1a1a18] transition-colors">
            Terms
          </Link>
        </p>
      </section>

      {/* ── Footer ── */}
      <section className="border-t border-[#e8e6e3] pt-10">
        <div className="flex flex-wrap gap-6">
          <Link href="/data" className="text-sm text-[#666] hover:text-[#1a1a18] transition-colors">
            The collection
          </Link>
          <Link href="/developers" className="text-sm text-[#666] hover:text-[#1a1a18] transition-colors">
            Developers
          </Link>
          <a href="/api/dataset/v1/stats" className="text-sm text-[#666] hover:text-[#1a1a18] transition-colors">
            Corpus stats (JSON)
          </a>
          <a href="mailto:data@sourcelibrary.org" className="text-sm text-[#666] hover:text-[#1a1a18] transition-colors">
            data@sourcelibrary.org
          </a>
        </div>
      </section>
    </ContentPageLayout>
  );
}
