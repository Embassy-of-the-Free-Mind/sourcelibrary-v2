import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'Does the AI Get Religion? — Research Notes — Source Library',
  description:
    'We tried to measure how big our library is and found a single translated page that ran to 491,418 characters. The AI translation model falls into devotional loops — but only on sacred texts. A field note on recitation loops, robust statistics, and why the mean joined a monastery.',
  openGraph: {
    title: 'Does the AI Get Religion?',
    description:
      'An AI translation model that picked up a book of sacred genealogies and could not stop generating generations. What 35,081 runaway pages taught us about scripture, repetition, and the difference between fluency and truth.',
  },
  alternates: {
    canonical: '/blog/does-ai-get-religion',
  },
};

export default function DoesAiGetReligionPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Does the AI Get Religion?"
          subtitle="We tried to measure how big our library is, and found a single page that ran to 491,418 characters &mdash; a translation model that picked up a book of sacred genealogies and could not stop generating generations."
        >
          <p className="text-stone-400 text-sm mt-4">30 May 2026 &middot; 7 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          It started as a bookkeeping question. We wanted one number: how big is Source Library,
          really &mdash; not in books, but in <em>words</em>. We had translated something like four
          million pages, and someone asked the obvious follow-up. How does that compare to, say, all
          of Wikipedia? A reasonable question. It led us, by the end of the afternoon, to a single
          page of a Javanese Bible that an AI had translated into roughly eighty thousand words, and
          to a slightly uncomfortable theological question about our own software.
        </p>

        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">A number at war with itself</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The first thing we did was sample the corpus and measure the length of a typical translated
          page. Two numbers came back, and they disagreed violently:
        </p>

        <div className="bg-warm border border-border-light rounded-lg p-6 my-8">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-border-light">
                <td className="py-2 text-secondary">Median translated page</td>
                <td className="py-2 text-right tabular-nums text-stone-800 font-medium">488 words</td>
              </tr>
              <tr>
                <td className="py-2 text-secondary">Mean translated page</td>
                <td className="py-2 text-right tabular-nums text-accent-rust font-medium">2,039 words</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          A library where the average page is four times longer than the typical page is a library
          hiding something. When the mean runs that far ahead of the median, it is almost always one
          thing: a small number of monstrous outliers, dragging the average up by the collar. So we
          stopped averaging and went looking for the monsters. We sorted every translated page in the
          collection by length, longest first, and looked at the top of the list.
        </p>

        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">The eighty-thousand-word page</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The single longest &ldquo;page&rdquo; in Source Library is page 184 of a nineteenth-century{' '}
          <a href="https://sourcelibrary.org/book/de-boeken-des-ouden-verbonds-old-testament-in-javanese" className="text-accent-rust hover:underline">
            Old Testament in Javanese
          </a>
          . The model&rsquo;s English translation of that one leaf is <strong className="text-stone-800">491,418
          characters</strong> long &mdash; about eighty thousand words, longer than <em>The Great
          Gatsby</em> and <em>Of Mice and Men</em> put together, on a single page of a Bible. It begins
          like an ordinary translation of a genealogy. And then it finds a word it likes:
        </p>

        <div className="bg-stone-900 text-stone-200 rounded-lg p-5 my-8 font-mono text-xs leading-relaxed overflow-hidden">
          &hellip; generations of generations of generations of generations of generations of
          generations of generations of generations of generations of generations of generations of
          generations of generations of generations of generations of generations of generations of
          generations of generations of generations of generations of generations of generations
          <span className="text-stone-500"> &mdash; [continues for 491,418 characters]</span>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          A genealogy &mdash; <em>the generations of Adam, the generations of Noah</em> &mdash; had
          asked the machine for the generations, and the machine, ever obliging, kept generating them.
          It is the most literal possible failure of a translation: handed a list of begettings, it
          begat without end.
        </p>

        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">It only happens to the holy books</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          One freak page is a curiosity. So we wrote a detector &mdash; a few dozen lines that flag any
          page whose translation balloons past twenty thousand characters, or runs more than three times
          longer than its own source &mdash; and ran it across the entire corpus. It found{' '}
          <strong className="text-stone-800">35,081 runaway pages across 3,523 books</strong>: about
          0.86% of everything we&rsquo;ve translated. Then we sorted them by language, and the joke wrote
          itself.
        </p>

        <div className="bg-warm border border-border-light rounded-lg p-6 my-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-medium">
                <th className="text-left py-2 text-secondary font-medium">Language</th>
                <th className="text-right py-2 text-secondary font-medium">Runaway pages</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Tibetan', '11,645'],
                ['Chinese', '8,060'],
                ['Hebrew', '1,645'],
                ['Syriac', '1,521'],
                ["Ge'ez", '1,091'],
                ['Sanskrit', '1,053'],
                ['Latin (Cicero, Caesar, Aquinas)', '— vanishingly rare —'],
              ].map(([l, n]) => (
                <tr key={l} className="border-b border-border-light last:border-0">
                  <td className="py-2 text-secondary">{l}</td>
                  <td className="py-2 text-right tabular-nums text-muted">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Tibetan Buddhist canon. Chinese Daoist canon. Hebrew Kabbalah. Syriac homilies. Ethiopic
          scripture. The model translates Cicero all day without breaking a sweat &mdash; but hand it
          the{' '}
          <a href="https://sourcelibrary.org/book/taoist-canon-daozang-masters" className="text-accent-rust hover:underline">
            Daozang, the Taoist Canon
          </a>
          , and it loses its composure on <strong className="text-stone-800">98% of the pages</strong>.
          Here is what it does to the{' '}
          <a href="https://sourcelibrary.org/book/old-testament-begins-with-book-of-enoch-not-genesis-anonymous" className="text-accent-rust hover:underline">
            Book of Enoch
          </a>{' '}
          (page 382, 384,971 characters):
        </p>

        <div className="bg-stone-900 text-stone-200 rounded-lg p-5 my-8 font-mono text-xs leading-relaxed overflow-hidden">
          &hellip; and before there comes everything within them, and before there comes everything
          within them, and before there comes everything within them, and before there comes everything
          within them, and before there comes everything within them, and before there comes everything
          within them
          <span className="text-stone-500"> &mdash; [continues for 384,971 characters]</span>
        </div>

        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">So &mdash; does the AI get religion?</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          In the boring, technical sense, no. What we are looking at is <em>degenerate repetition</em>,
          a well-known failure mode of language models: when a model is uncertain about what comes next,
          and the safest-looking continuation is to repeat what just came, it can fall into a groove and
          loop until something forces it to stop. Two things make it worse. One is an unfamiliar script
          &mdash; the model reads Tibetan or Ge&rsquo;ez far less confidently than it reads Latin, so it
          is uncertain more often. The other is repetitive source text, which keeps whispering that the
          next word is the same word.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          And here is the part that is hard to ignore. The texts that break the machine are, almost
          without exception, the ones built out of <em>sacred repetition</em>. Mantras meant to be
          recited ten thousand times. Litanies. Genealogies &mdash; <em>and X begat Y, and Y begat
          Z</em>. The names of God, over and over. This is the architecture of devotion: the repetition
          is the point, the thing a human chants on purpose, for hours, to empty the mind. Feed that to
          a model that is already unsure of the script, and it does exactly what the devotee does &mdash;
          it falls into the chant. The only difference is that the monk chooses to stop. So no, the AI
          does not get religion. But when you hand it scripture, it does the one thing scripture was
          engineered to make a mind do.
        </p>

        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">The mean had joined a monastery</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Back to the bookkeeping. Those 35,081 runaway pages are 0.86% of the corpus &mdash;
          statistically almost nothing. But because each one is enormous, together they held roughly{' '}
          <strong className="text-stone-800">two-thirds of all our translation text by raw volume</strong>.
          The average page length wasn&rsquo;t describing our library. It was describing a few thousand
          pages where the model had wandered off to pray. The mean had joined a monastery; the median
          stayed home and did the work.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          This is the second time a quality problem here has shown up not as an obvious error but as a
          kind of <em>excess confidence</em>. In{' '}
          <a href="https://sourcelibrary.org/blog/confident-hallucinator" className="text-accent-rust hover:underline">
            The Confident Hallucinator
          </a>{' '}
          a model was perfectly consistent and perfectly wrong. Here it is perfectly fluent and
          perfectly stuck. Length looks like substance; consistency looks like correctness; fluency
          looks like sense. None of them are. The lesson keeps being the same one: never trust an
          average where a median will do, and never let a machine&rsquo;s confidence stand in for its
          accuracy.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          For the record, the honest measurement &mdash; taken with medians, after the runaways were set
          aside &mdash; is about <strong className="text-stone-800">1.7 billion words</strong> of English
          translation, and roughly <strong className="text-stone-800">3.5 billion words</strong> across
          the whole corpus once you count the original transcriptions beside each translation. That is on
          the scale of the entire English Wikipedia, in primary sources rather than summaries. The number
          we were after all along &mdash; it just had a ghost standing in front of it.
        </p>

        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">Teaching it to stop</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The fix is unglamorous. The detector that found these pages can also flag them, hide them from
          readers, and send them back through translation with a length cap and a penalty on repetition
          &mdash; the model equivalent of a hand on the shoulder. The monks of the Daozang can chant for
          as long as they like. The machine has to stop at the bottom of the page.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Every old library has a ghost in it somewhere. Ours, it turns out, is a language model, deep in
          the Book of Enoch, still going.
        </p>

        <p className="text-sm text-muted leading-relaxed mt-10 font-body">
          Figures from an exact scan of the Source Library corpus, 30 May 2026: 35,081 flagged pages
          across 3,523 books; longest single page 491,418 characters. Excerpts are verbatim from the
          model&rsquo;s output. Affected pages are being re-translated.
        </p>
      </article>

      <BlogComments slug="does-ai-get-religion" />
    </ContentPageLayout>
  );
}
