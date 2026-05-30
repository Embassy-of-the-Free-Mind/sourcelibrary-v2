import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'Does the AI Get Religion? — Research Notes — Source Library',
  description:
    "The longest page in our library is one leaf of a Javanese Old Testament that the AI translated into 491,418 characters of 'generations of generations of generations.' It does this only with scripture.",
  openGraph: {
    title: 'Does the AI Get Religion?',
    description:
      "An AI translation model that picked up a book of sacred genealogies and could not stop generating generations. It only happens with scripture.",
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
          subtitle="The longest page in our library is one leaf of a Javanese Bible that the AI translated into eighty thousand words. Here is how it goes."
        >
          <p className="text-stone-400 text-sm mt-4">30 May 2026 &middot; 3 min read</p>
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
          We sorted every translated page in Source Library by length, longest first, to see what was
          at the top. The single longest &ldquo;page&rdquo; in the whole library is page 184 of a
          nineteenth-century{' '}
          <a href="https://sourcelibrary.org/book/de-boeken-des-ouden-verbonds-old-testament-in-javanese" className="text-accent-rust hover:underline">
            Old Testament in Javanese
          </a>
          . The AI&rsquo;s English translation of that one leaf is <strong className="text-stone-800">491,418
          characters</strong> long &mdash; about eighty thousand words, longer than <em>The Great
          Gatsby</em>. It begins like an ordinary genealogy, and then it finds a word it likes:
        </p>

        <div className="bg-stone-900 text-stone-200 rounded-lg p-5 my-8 font-mono text-xs leading-relaxed overflow-hidden">
          &hellip; generations of generations of generations of generations of generations of
          generations of generations of generations of generations of generations of generations of
          generations of generations of generations of generations of generations of generations of
          generations of generations of generations of generations of generations of generations
          <span className="text-stone-500"> &mdash; [for 491,418 characters]</span>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          A genealogy &mdash; <em>the generations of Adam, the generations of Noah</em> &mdash; asked
          the machine for the generations, and the machine, ever obliging, generated them. Handed a list
          of begettings, it begat without end.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
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
          <span className="text-stone-500"> &mdash; [for 384,971 characters]</span>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          And it only does this with scripture. The model translates Cicero all day without breaking a
          sweat. But hand it the{' '}
          <a href="https://sourcelibrary.org/book/taoist-canon-daozang-masters" className="text-accent-rust hover:underline">
            Daozang
          </a>
          , the Taoist Canon, and it comes apart on 98% of the pages. Tibetan Buddhist sutras, Hebrew
          Kabbalah, Syriac homilies, Ethiopic gospels &mdash; the same thing, over and over. The texts
          that undo it are, almost without exception, the ones built out of <em>sacred repetition</em>:
          mantras meant to be recited ten thousand times, litanies, the names of God, the long chains of
          who begat whom. Repetition is the whole point &mdash; the thing a devotee chants on purpose, for
          hours, to empty the mind. Feed that to a machine that is already unsure of the script, and it
          does exactly what the devotee does. It falls into the chant.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The only difference is that the monk chooses to stop.
        </p>

        <p className="text-sm text-muted leading-relaxed mt-10 font-body">
          Excerpts are verbatim from the model&rsquo;s output. We&rsquo;ve since flagged the runaway
          pages and are re-translating them with a hand on the shoulder.
        </p>
      </article>

      <BlogComments slug="does-ai-get-religion" />
    </ContentPageLayout>
  );
}
