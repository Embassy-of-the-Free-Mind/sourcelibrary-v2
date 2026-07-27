import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogPostSchema from '@/components/seo/BlogPostSchema';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'How Big Is the Library? - Research Notes - Source Library',
  description:
    "We counted every word Source Library holds — original OCR, AI translation, and enrichment. The answer: roughly 5-7 billion words, about the size of English Wikipedia. Here is how we measured it, junk pages and all.",
  openGraph: {
    title: 'How Big Is the Library?',
    description:
      'Roughly 5-7 billion words across 6.5 million pages — about the size of English Wikipedia. With the methodology, and the recitation-loop bug that nearly tripled the count.',
    images: [
      {
        url: 'https://images.sourcelibrary.org/gallery/a5d0c381-d4ea-42cd-8864-44457e7fda33/69500509f426a210d109c5bd-0.jpg',
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/gallery/a5d0c381-d4ea-42cd-8864-44457e7fda33/69500509f426a210d109c5bd-0.jpg' }],
  },
  alternates: {
    canonical: '/blog/how-big-is-the-library',
  },
};

// --- Data (measured 2026-06-01; see scripts/analytics/corpus-size.mjs) ---
// Winsorized-mean basis (caps junk pages at 3,000 words/page). Median basis is
// the conservative floor; raw mean is inflated by recitation-loop junk pages.
const WORDS = {
  originals: 3.28, // B, OCR of source-language pages
  translations: 3.76, // B, AI English translation
  enrichment: 0.02, // B, summaries + image descriptions + book metadata
};
const TOTAL = WORDS.originals + WORDS.translations + WORDS.enrichment; // 7.06 B
const FLOOR = 4.87; // B, median-basis floor
const TOKENS = 9.9; // B, ~1.4x words (mixed scripts tokenize denser)

// Comparison baselines (billions of words)
const WIKI_EN = 4.7; // English Wikipedia article prose
const WIKI_ALL = 30; // all 300+ language editions combined

// Horizontal stacked bar — values in billions of words
function Bar({
  label,
  segments,
  total,
  scaleMax,
  note,
}: {
  label: string;
  segments: { value: number; color: string; name: string }[];
  total: number;
  scaleMax: number;
  note?: string;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="font-serif text-primary text-base md:text-lg">{label}</span>
        <span className="font-mono text-sm text-secondary tabular-nums">
          {total.toFixed(1)}B words
        </span>
      </div>
      <div className="flex h-7 w-full overflow-hidden rounded-sm bg-stone-100 ring-1 ring-stone-200">
        {segments.map((s) => (
          <div
            key={s.name}
            className={s.color}
            style={{ width: `${(s.value / scaleMax) * 100}%` }}
            title={`${s.name}: ${s.value.toFixed(2)}B`}
          />
        ))}
      </div>
      {note && <p className="text-xs text-muted mt-1 italic">{note}</p>}
    </div>
  );
}

export default function HowBigIsTheLibraryPage() {
  const scaleMax = WIKI_ALL; // longest bar sets the scale
  return (
    <>
      <BlogPostSchema
        slug="how-big-is-the-library"
        title="How Big Is the Library?"
        description="We counted every word Source Library holds — original OCR, AI translation, and enrichment. Roughly 5-7 billion words, about the size of English Wikipedia."
        datePublished="2026-06-01"
        image="https://images.sourcelibrary.org/gallery/a5d0c381-d4ea-42cd-8864-44457e7fda33/69500509f426a210d109c5bd-0.jpg"
      />
      <ContentPageLayout
        header={
          <ContentHeader
            title="How Big Is the Library?"
            subtitle="Roughly five to seven billion words — about the size of English Wikipedia"
            image="https://images.sourcelibrary.org/gallery/a5d0c381-d4ea-42cd-8864-44457e7fda33/69500509f426a210d109c5bd-0.jpg"
            imageAlt="Frontispiece of Athanasius Kircher's Ars Magna Lucis et Umbrae (1671)"
          >
            <p className="text-stone-400 text-sm mt-4">1 June 2026 &middot; 6 min read</p>
          </ContentHeader>
        }
        bg="bg-cream"
      >
        <div className="mb-8">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            All notes
          </Link>
        </div>

        <article className="prose-content max-w-none">
          {/* Lede */}
          <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
            A natural question for any library: how much is in here? We have 6.5&nbsp;million
            pages across roughly 15,500 readable books in 158 languages. But pages and books are
            containers. We wanted the contents &mdash; the actual <em>words</em>.
          </p>

          <p className="text-secondary leading-relaxed mb-10 font-body">
            So we counted. Not just the original texts, but everything the pipeline adds: the
            facing-page English translations, the per-page summaries, the descriptions our vision
            models write for 142,000 illustrations. The answer is about{' '}
            <strong className="text-primary">seven billion words</strong> &mdash; or, if you only
            trust the most conservative count, about five. Either way, that puts Source Library at
            roughly the scale of <strong className="text-primary">English Wikipedia</strong>.
          </p>

          {/* Headline numbers */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-10">
            {[
              { n: '~7B', l: 'words of text' },
              { n: '~10B', l: 'tokens' },
              { n: '6.5M', l: 'pages' },
              { n: '158', l: 'languages' },
            ].map((s) => (
              <div key={s.l} className="bg-white rounded-lg border border-border-light p-4 text-center">
                <div className="font-serif text-3xl text-accent-rust">{s.n}</div>
                <div className="text-xs text-muted mt-1 uppercase tracking-wide">{s.l}</div>
              </div>
            ))}
          </div>

          <hr className="border-border-light my-12" />

          {/* The comparison */}
          <section className="mb-14">
            <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
              Against the obvious yardstick
            </h2>
            <p className="text-secondary leading-relaxed mb-8 font-body">
              Wikipedia is the reference everyone has a feel for. English Wikipedia is about{' '}
              <strong className="text-primary">4.7&nbsp;billion words</strong> of article prose;
              all 300-plus language editions together come to roughly{' '}
              <strong className="text-primary">30&nbsp;billion</strong>. Here is where we land,
              counting our original texts and their translations as two layers of the same bar:
            </p>

            <div className="bg-white rounded-lg border border-border-light p-6 my-8">
              <Bar
                label="Source Library"
                total={TOTAL}
                scaleMax={scaleMax}
                segments={[
                  { value: WORDS.originals, color: 'bg-accent-rust', name: 'Originals (OCR)' },
                  { value: WORDS.translations, color: 'bg-amber-400', name: 'Translations' },
                  { value: WORDS.enrichment, color: 'bg-stone-400', name: 'Enrichment' },
                ]}
                note="Original-language OCR + AI English translation + enrichment"
              />
              <Bar
                label="English Wikipedia"
                total={WIKI_EN}
                scaleMax={scaleMax}
                segments={[{ value: WIKI_EN, color: 'bg-sky-600', name: 'Article prose' }]}
              />
              <Bar
                label="All Wikipedias"
                total={WIKI_ALL}
                scaleMax={scaleMax}
                segments={[{ value: WIKI_ALL, color: 'bg-sky-800', name: '300+ languages' }]}
              />
              <div className="flex flex-wrap gap-x-5 gap-y-2 mt-5 pt-4 border-t border-border-light text-xs text-secondary">
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-accent-rust inline-block" />Originals (OCR)</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" />Translations</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-stone-400 inline-block" />Enrichment</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-sky-600 inline-block" />Wikipedia</span>
              </div>
            </div>

            <p className="text-secondary leading-relaxed mb-6 font-body">
              Counting originals and translations together, we are a little <em>larger</em> than
              English Wikipedia. Counting only the original source texts &mdash; the
              centuries-old Latin, Greek, Chinese, Sanskrit, Arabic, and the rest &mdash; we are
              about two-thirds of it. And against the whole multilingual Wikipedia, we are
              something like a quarter. For a library of pre-modern primary sources, assembled in
              a few years, that is a strange and slightly vertiginous fact.
            </p>
          </section>

          <hr className="border-border-light my-12" />

          {/* The layers */}
          <section className="mb-14">
            <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
              What&apos;s actually in the count
            </h2>
            <p className="text-secondary leading-relaxed mb-8 font-body">
              The number is the sum of distinct layers. Roughly half is the original text, scanned
              and OCR&apos;d page by page. Almost as much again is the AI translation that sits
              beside it &mdash; a little larger per page, because Latin and Greek are compact and
              English spells everything out. The enrichment layer (summaries, keywords, the
              museum-style descriptions for every illustration) is real but small.
            </p>

            <div className="bg-white rounded-lg border border-border-light p-6 my-8 space-y-4">
              {[
                { name: 'Original text (OCR)', v: WORDS.originals, color: 'bg-accent-rust', sub: '~6.2M pages · 158 languages' },
                { name: 'English translation', v: WORDS.translations, color: 'bg-amber-400', sub: '~5.5M pages translated' },
                { name: 'Enrichment & captions', v: WORDS.enrichment, color: 'bg-stone-400', sub: 'summaries + 142K image descriptions' },
              ].map((r) => (
                <div key={r.name}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="font-serif text-primary">{r.name}</span>
                    <span className="font-mono text-sm text-secondary tabular-nums">{r.v.toFixed(2)}B</span>
                  </div>
                  <div className="h-5 w-full rounded-sm bg-stone-100 overflow-hidden ring-1 ring-stone-200">
                    <div className={r.color} style={{ width: `${(r.v / WORDS.translations) * 100}%`, height: '100%' }} />
                  </div>
                  <p className="text-xs text-muted mt-1">{r.sub}</p>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-border-light my-12" />

          {/* The honest part: how hard it was to measure */}
          <section className="mb-14">
            <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
              Why we give a range, not a number
            </h2>
            <p className="text-secondary leading-relaxed mb-6 font-body">
              The honest answer is a range &mdash; <strong className="text-primary">five to
              seven billion words</strong> &mdash; and the gap between those two figures is itself
              a story about machine translation.
            </p>
            <p className="text-secondary leading-relaxed mb-6 font-body">
              When we first averaged the words per translated page, the number came out absurdly
              high: nearly 1,900 words a page, which would have implied a translation corpus of
              over ten billion words on its own. A typical page has about 460. Something was
              dragging the average up by a factor of four.
            </p>
            <p className="text-secondary leading-relaxed mb-6 font-body">
              The culprit was a familiar failure mode. About <strong className="text-primary">2.4%
              of pages</strong> &mdash; on the order of 150,000 of them &mdash; carry translations
              that <em>run away</em>. The model, an older preview build, hits a repetitive passage
              and gets stuck, emitting the same phrase tens of thousands of times until it slams
              into its output ceiling. One leaf of a Tibetan sutra translated into the sentence{' '}
              <span className="italic">&ldquo;They see the Dharma.&rdquo;</span> repeated{' '}
              <strong className="text-primary">6,522 times</strong> &mdash; 52,000 words from a
              page whose original is 1,600. (We wrote about the most extreme case, a Javanese
              Bible leaf, in{' '}
              <Link href="/blog/does-ai-get-religion" className="text-accent-rust hover:text-accent-rust underline">
                Does the AI Get Religion?
              </Link>
              )
            </p>
            <p className="text-secondary leading-relaxed mb-6 font-body">
              A handful of 50,000-word junk pages can fabricate billions of words that no reader
              would ever see. So we don&apos;t use the raw average. We cap each page&apos;s
              contribution at a generous 3,000 words &mdash; more than any real folio &mdash;
              which gives the seven-billion headline. The five-billion floor is the page{' '}
              <em>median</em>, which ignores the long tail entirely. The truth sits between, and
              both comfortably clear &ldquo;about the size of Wikipedia.&rdquo; Those runaway pages
              are now on the list to be re-translated and purged from search.
            </p>
            <div className="bg-stone-50 border-l-2 border-accent-rust pl-5 py-3 my-8">
              <p className="text-sm text-secondary font-body italic">
                The whole measurement is reproducible:{' '}
                <code className="text-xs bg-white px-1.5 py-0.5 rounded border border-border-light not-italic">
                  scripts/analytics/corpus-size.mjs
                </code>{' '}
                samples pages from the database, strips the editorial annotation that wraps each
                one, and reports the median, winsorized, and raw figures side by side &mdash; plus
                a <code className="text-xs bg-white px-1.5 py-0.5 rounded border border-border-light not-italic">--outliers</code>{' '}
                mode that lists the runaway pages.
              </p>
            </div>
          </section>

          <hr className="border-border-light my-12" />

          {/* Close */}
          <section className="mb-10">
            <p className="text-secondary leading-relaxed mb-6 font-body">
              Size is not the point of a library &mdash; a single readable page of Ficino that no
              one could read before is worth more than a million words of boilerplate. But scale
              does say something. A few years ago this was one untranslated book in a glass case in
              Amsterdam. It is now, by word count, a Wikipedia&apos;s worth of primary sources that
              had mostly never been carried into English &mdash; sitting in one place, readable and
              quotable, page by facing page.
            </p>
            <p className="text-muted text-sm font-body">
              Counts measured 1&nbsp;June 2026 from the production database. Wikipedia baselines:
              English ~4.7B words of article prose; all editions ~30B. Word totals are{' '}
              <code className="text-xs">$sample</code> extrapolations (±a few percent); token
              estimates assume ~1.4 tokens per word for mixed scripts.
            </p>
          </section>
        </article>

      </ContentPageLayout>
    </>
  );
}
