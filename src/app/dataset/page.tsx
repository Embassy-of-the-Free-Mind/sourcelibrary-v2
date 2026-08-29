import { Metadata } from 'next';
import OutboundLink from '@/components/analytics/OutboundLink';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { getReadDb } from '@/lib/mongodb';

// ISR: rebuild every 6 hours. Allow 60s for first-hit generation.
// Must be a finite number — `false` would cache a bad-render fallback forever.
export const revalidate = 21600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Dataset — Source Library',
  description:
    'Structured parallel-text training data from 19,000+ historical texts in 200+ languages. Page-aligned OCR, English translations, and scholarly metadata.',
  alternates: { canonical: '/dataset' },
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'Dataset — Source Library',
    description:
      'The only structured parallel-text dataset for historical languages. Page-aligned original text, English translation, and metadata.',
  },
};

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

// No try/catch: a thrown error during ISR revalidation keeps serving the
// last good page, while catching it here would render (and cache) stale
// snapshot numbers as if they were live for the full revalidate window.
// Cold failures land on src/app/error.tsx.
async function fetchDatasetStats() {
  const db = await getReadDb();

  const books = db.collection('books');
  // Only texts with actual pages — the visible set also holds single-image
  // artworks and unprocessed stubs, which aren't parallel-text training data.
  const visible = { visible: true, pages_count: { $gt: 0 } };
  // 'Visual' and 'No linguistic content' are language-field values for
  // artwork/plate records, not languages of the text corpus.
  const nonLanguages = ['Unknown', 'Visual', 'No linguistic content'];
  const maxTimeMS = 45000;

  const [totalBooks, pageTotalsAgg, languagesAgg] = await Promise.all([
    books.countDocuments(visible, { maxTimeMS }),
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
      ], { maxTimeMS })
      .toArray(),
    books
      .aggregate<{ _id: string; count: number; translated: number }>([
        { $match: { ...visible, language: { $exists: true, $nin: nonLanguages } } },
        {
          $group: {
            _id: '$language',
            count: { $sum: 1 },
            translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
          },
        },
        { $sort: { count: -1 } },
      ], { maxTimeMS })
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
          subtitle="Page-aligned parallel text for historical languages. OCR, English translation, and scholarly metadata — ready for training."
        />
      }
      maxWidth="standard"
      bg="bg-[#faf9f7]"
    >
      {/* ── Opening statement ── */}
      <section className="mb-24">
        <p className="font-serif text-2xl md:text-[28px] text-[#1a1a18] leading-[1.5] max-w-2xl">
          {formatNumber(stats.totalBooks)} texts. {formatNumber(stats.pagesTranslated)} pages
          translated into English. {stats.languages.length} languages — Sumerian to Renaissance Latin.
          Available via streaming API.
        </p>
      </section>

      {/* ── The problem, in prose ── */}
      <section className="mb-24 max-w-2xl">
        <p className="text-[#444] leading-[1.75] mb-6">
          Millions of pages of pre-modern text have been digitized by the world&apos;s great libraries.
          But a scan of a 16th-century Latin treatise is not training data. It requires OCR,
          translation, page-level alignment, classification, and quality verification.
        </p>
        <p className="text-[#444] leading-[1.75]">
          We have done that work for {formatNumber(stats.totalBooks)} texts
          across {stats.languages.length} languages — and the dataset grows every week.
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
        <p className="text-xs uppercase tracking-[0.15em] text-[#999] mb-6">
          {stats.languages.length} languages
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-12 gap-y-4">
          {stats.languages.slice(0, 21).map((l) => (
            <div key={l.language} className="flex justify-between items-baseline border-b border-[#e8e6e3] pb-2">
              <span className="text-[#1a1a18] text-[15px]">{l.language}</span>
              <span className="text-[#999] text-sm tabular-nums">
                {formatNumber(l.books)}
              </span>
            </div>
          ))}
        </div>
        {stats.languages.length > 21 && (
          <p className="text-[#999] text-sm mt-4">
            and {stats.languages.length - 21} more
          </p>
        )}
      </section>

      {/* ── What the data looks like ── */}
      <section className="mb-24">
        <p className="text-xs uppercase tracking-[0.15em] text-[#999] mb-6">Data format</p>
        <p className="text-[#444] leading-[1.75] mb-6 max-w-2xl">
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

      {/* ── Quality ── */}
      <section className="mb-24 max-w-2xl">
        <p className="text-xs uppercase tracking-[0.15em] text-[#999] mb-6">Quality</p>
        <p className="text-[#444] leading-[1.75] mb-4">
          Not a static dump. Translations are continuously reviewed and corrected
          by language specialists. Licensed access includes quarterly updates
          with changelogs documenting every improvement.
        </p>
        <p className="text-[#444] leading-[1.75]">
          Each record traces back to its source institution via a permanent citation URL.
          Provenance documentation meets EU AI Act training data transparency requirements.
        </p>
      </section>

      {/* ── Access ── */}
      <section className="mb-24">
        <p className="text-xs uppercase tracking-[0.15em] text-[#999] mb-6">Access</p>

        <div className="max-w-2xl mb-10">
          <p className="text-[#444] leading-[1.75] mb-6">
            Available through a streaming JSONL API. Free tier for evaluation.
            Paid plans unlock full corpora by language or domain.
          </p>
        </div>

        <div className="space-y-px rounded-lg border border-[#e8e6e3] overflow-hidden">
          {[
            { name: 'Explorer', price: 'Free', scope: '2,000 pages/day, any language', note: 'Self-serve — instant' },
            { name: 'Single Language', price: '$4,990/yr', scope: 'One language corpus, unlimited', note: 'or $499/mo' },
            { name: 'Domain', price: '$14,990/yr', scope: 'One scholarly domain, unlimited', note: 'or $1,499/mo' },
            { name: 'Full Collection', price: '$49,990/yr', scope: 'All languages, all domains + unmarked image serving', note: 'or $4,999/mo' },
            { name: 'Enterprise', price: 'Custom', scope: 'Parquet exports, custom scopes, SLA + unmarked image serving', note: null },
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

        <p className="text-[#666] text-[15px] leading-[1.75] mt-6 max-w-2xl">
          These subscriptions are the cooperative path to a training license:
          non-exclusive, with attribution, delivered through the API rather than
          crawling. Outside a subscription, our standing rate card applies —
          at least $250 per book, or $200,000/year for full-corpus export with
          quarterly refresh — and it is the basis on which unlicensed training
          use is invoiced. See{' '}
          <Link href="/licensing" className="text-[#1a1a18] underline hover:no-underline">
            AI &amp; Data-Mining Licensing
          </Link>{' '}
          for the full policy.
        </p>

        <p className="text-[#666] text-[15px] leading-[1.75] mt-4 max-w-2xl">
          Building a retrieval or RAG product rather than training? Grounding
          with attribution is permitted under our content signals; a{' '}
          <Link href="/licensing" className="text-[#1a1a18] underline hover:no-underline">
            Grounding API subscription
          </Link>{' '}
          ($499/mo, or $1,999/mo with SLA) removes the daily page budgets for
          retrieval at scale.
        </p>

        <div className="flex flex-wrap gap-4 mt-8">
          <OutboundLink
            href="mailto:team@sourcelibrary.org?subject=Dataset%20Access%20Request"
            surface="dataset"
            channel="email"
            intent="inquiry"
            className="px-6 py-3 bg-[#1a1a18] text-white rounded-full text-sm font-medium hover:bg-[#333] transition-colors"
          >
            Request access
          </OutboundLink>
          <a
            href="/api/dataset/v1/stats"
            className="px-6 py-3 border border-[#ccc] text-[#444] rounded-full text-sm font-medium hover:border-[#999] transition-colors"
          >
            View corpus stats
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
      <section className="mb-24 max-w-2xl">
        <p className="text-xs uppercase tracking-[0.15em] text-[#999] mb-6">Legal</p>
        <p className="text-[#444] leading-[1.75]">
          Source texts are public domain. The curated compilation — OCR, translations,
          taxonomy, and metadata — is protected under the EU Database Directive (96/9/EC).
          Licenses are non-exclusive and cover training, fine-tuning, and evaluation.
          Our full position — what&apos;s freely permitted, what&apos;s reserved, and the
          standard training rate card — is at{' '}
          <Link href="/licensing" className="text-[#1a1a18] underline hover:no-underline">
            /licensing
          </Link>.
        </p>
      </section>

      {/* ── Footer ── */}
      <section className="border-t border-[#e8e6e3] pt-10">
        <div className="flex flex-wrap gap-6">
          <Link href="/" className="text-sm text-[#666] hover:text-[#1a1a18] transition-colors">
            Browse the collection
          </Link>
          <a href="/api/dataset/v1/stats" className="text-sm text-[#666] hover:text-[#1a1a18] transition-colors">
            Corpus stats (JSON)
          </a>
          <a href="mailto:team@sourcelibrary.org" className="text-sm text-[#666] hover:text-[#1a1a18] transition-colors">
            team@sourcelibrary.org
          </a>
        </div>
      </section>
    </ContentPageLayout>
  );
}
