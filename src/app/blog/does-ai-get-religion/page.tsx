import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Does the AI Get Religion? — Research Notes — Source Library',
  description:
    "The longest page in our library is one leaf of a Javanese Old Testament that the AI translated into 491,418 characters of 'generations of generations of generations.' It does this only with scripture.",
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'Does the AI Get Religion?',
    description:
      "An AI translation model that picked up a book of sacred genealogies and could not stop generating generations. It only happens with scripture.",
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
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
          And it is always like this, and it is always scripture. Here is the AI translating a
          seventy-thousand-word Tibetan volume of the{' '}
          <a href="https://sourcelibrary.org/book/sgrub-pa-bka-brgyad-kyi-phrin-las-collection" className="text-accent-rust hover:underline">
            Buddhist canon
          </a>{' '}
          &mdash; a liturgy of accomplishment for the benefit of all beings &mdash; which it renders,
          faithfully, into the one thing the liturgy is for:
        </p>

        <div className="bg-stone-900 text-stone-200 rounded-lg p-5 my-8 font-mono text-xs leading-relaxed overflow-hidden">
          &hellip; producing happiness, producing happiness, producing happiness, producing happiness,
          producing happiness, producing happiness, producing happiness, producing happiness, producing
          happiness, producing happiness, producing happiness, producing happiness, producing happiness,
          producing happiness, producing happiness, producing happiness
          <span className="text-stone-500"> &mdash; [for 458,627 characters]</span>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Here it is inside a commentary on the{' '}
          <a href="https://sourcelibrary.org/book/hebrew-sefer-shiv-im-tikunei-ha-zohar" className="text-accent-rust hover:underline">
            Zohar
          </a>
          , the central text of Kabbalah, where it locks onto one of the divine attributes and will not
          let go &mdash; a mind circling a single mystery, which is more or less what the book is about:
        </p>

        <div className="bg-stone-900 text-stone-200 rounded-lg p-5 my-8 font-mono text-xs leading-relaxed overflow-hidden">
          &hellip; Foundation of the Secret Kindness. Foundation of the Secret Kindness. Foundation of
          the Secret Kindness. Foundation of the Secret Kindness. Foundation of the Secret Kindness.
          Foundation of the Secret Kindness. Foundation of the Secret Kindness. Foundation of the Secret
          Kindness. Foundation of the Secret Kindness
          <span className="text-stone-500"> &mdash; [for 372,416 characters]</span>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          It does this with the Taoist Canon (it comes apart on{' '}
          <a href="https://sourcelibrary.org/book/taoist-canon-daozang-masters" className="text-accent-rust hover:underline">
            98% of the pages
          </a>
          ), with Syriac homilies, with Ethiopic gospels, with the Mishnah. Hand it Cicero and it
          translates all day without breaking a sweat. But the texts that undo it are, almost without
          exception, the ones built out of <em>sacred repetition</em> &mdash; mantras meant to be recited
          ten thousand times, litanies, the names of God, the long chains of who begat whom. Repetition is
          the whole point: the thing a devotee chants on purpose, for hours, to empty the mind. Feed that
          to a machine that is already unsure of the script, and it does exactly what the devotee does. It
          falls into the chant.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The only difference is that the monk chooses to stop.
        </p>

        <p className="text-sm text-muted leading-relaxed mt-10 font-body">
          Excerpts are verbatim from the model&rsquo;s output. We&rsquo;ve since flagged the runaway
          pages and are re-translating them with a hand on the shoulder.
        </p>
      </article>

    </ContentPageLayout>
  );
}
