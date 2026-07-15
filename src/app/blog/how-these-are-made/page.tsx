import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'How These Notes Are Made - Source Library',
  description:
    'The research notes on Source Library are AI-assisted reports from an ongoing project to digitize and translate historical texts — directed, reviewed, and published by Derek Lomas. Here is how they are made, and why.',
  alternates: {
    canonical: '/blog/how-these-are-made',
  },
  openGraph: {
    title: 'How These Notes Are Made',
    description:
      'The research notes on Source Library are AI-assisted reports from an ongoing digitization project. How they are made, and why.',
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
  },
};

export default function HowTheseAreMadePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="How These Notes Are Made"
          subtitle="A colophon for the research notes"
        />
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
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          The notes on this site are written with AI. I want to be plain about
          that, and about why I think it&apos;s worth doing anyway.
        </p>

        <p>
          Source Library is a project to digitize, transcribe, and translate
          historical texts &mdash; tens of thousands of books, most of which
          have never been available in English. AI does the reading at a scale
          no person could: it transcribes the pages, translates them, and
          searches across the whole corpus at once. When something interesting
          turns up &mdash; a first translation, a forgotten diagram, a line of
          influence between two books three centuries apart &mdash; I want to
          write it down while it&apos;s fresh. These notes are those write-ups.
        </p>

        <h2>The process</h2>
        <p>
          I direct the research: the question, the angle, what&apos;s worth
          pursuing and what isn&apos;t. AI models do the digging &mdash;
          searching the library, reading the sources, assembling the evidence
          &mdash; and draft the note. I review and publish. Some notes get
          heavy editing; some go out close to how the machine drafted them.
        </p>
        <p>
          The rule that makes this trustworthy is simple:{' '}
          <strong>every quotation is checked, by machine, against the scanned
          page it comes from, and linked to it.</strong> You can click any
          quote in these notes and land on the original page image &mdash; the
          actual ink. That&apos;s a standard of verifiability most writing
          about historical sources doesn&apos;t attempt, and it&apos;s the
          discipline that separates a research report from AI slop. Claims
          without a source under them don&apos;t survive review.
        </p>

        <h2>Why publish them at all</h2>
        <p>
          Partly it&apos;s working in public: the library grows every week,
          and the notes are a record of what we&apos;re finding as we go.
          Partly it&apos;s discovery for myself &mdash; writing these reports
          is how I learn what&apos;s actually in the collection. And partly
          it&apos;s an experiment in what AI-assisted scholarship can look
          like when it&apos;s done with sources showing. I&apos;d rather run
          that experiment in the open, labeled honestly, than pretend a human
          wrote all of this.
        </p>
        <p>
          So think of these less as blog posts and more as lab reports from an
          unusual library. They aren&apos;t finished essays and they
          don&apos;t claim to be the last word on anything.
        </p>

        <h2>Living documents</h2>
        <p>
          Because they&apos;re research reports, they get revised &mdash; when
          a reader catches an error, when the library acquires a better
          source, when a claim turns out to need tightening. Every note shows
          its last-revised date, and the full revision history is public: this
          whole site is open source, and each note is a file{' '}
          <a
            href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/tree/main/src/app/blog"
            target="_blank"
            rel="noopener noreferrer"
          >
            in the repository
          </a>
          , with every change on record.
        </p>
        <p>
          Which also means anyone can propose a correction. If you spot an
          error &mdash; a wrong date, a misattributed quote, a claim you can
          refute &mdash; use the &ldquo;suggest an edit&rdquo; link at the
          bottom of any note, or the feedback link in the site footer.
          Corrections are the point of publishing this way, not an
          embarrassment to it.
        </p>

        <p className="text-muted text-sm mt-10">
          &mdash; Derek Lomas
        </p>
      </article>
    </ContentPageLayout>
  );
}
