import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Every Shape of Every Word - Research Notes - Source Library',
  description:
    'We mapped 570,000 Greek word forms to their dictionary entries — the invisible table that lets anyone tap a word in a 1590 book and understand it, and lets scholars trace a word across two centuries.',
  openGraph: {
    images: [
      {
        url: 'https://images.sourcelibrary.org/archived/adefe2d5-88a7-4595-9885-903a93abee51/391.jpg',
        alt: 'A Greek page of the Divini Platonis Opera omnia, 1590',
      },
    ],
    title: 'Every Shape of Every Word',
    description:
      'A 570,000-form Greek dictionary map for early modern books — checked against 132,000 words hand-verified by scholars, and open.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [
      {
        url: 'https://images.sourcelibrary.org/archived/adefe2d5-88a7-4595-9885-903a93abee51/391.jpg',
        alt: 'A Greek page of the Divini Platonis Opera omnia, 1590',
      },
    ],
  },
  alternates: {
    canonical: '/blog/greek-lemma-table',
  },
};

export default function GreekLemmaTablePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Every Shape of Every Word"
          subtitle="We mapped 570,000 Greek word forms to their dictionary entries — the invisible table that turns a 400-year-old page into something you can read"
          image="https://images.sourcelibrary.org/archived/adefe2d5-88a7-4595-9885-903a93abee51/391.jpg"
          imageAlt="A Greek page of the Divini Platonis Opera omnia, 1590"
        >
          <p className="text-stone-400 text-sm mt-4">10 August 2026 &middot; 5 min read</p>
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

      <div className="prose prose-stone max-w-none">
        <p className="lead">
          Open a Greek book printed in 1590 and try to look up a word. The dictionary lists
          προσέχω &mdash; but the page in front of you says προσέχειν, or προσέσχομεν, or one of
          several hundred other shapes that verb can take. Greek words change form constantly
          &mdash; for tense, for case, for person &mdash; and dictionaries only list one form of
          each: the <em>lemma</em>, the headword. Between the page and the dictionary stands a
          gap that has stopped beginners cold for centuries.
        </p>
        <p>
          Scholars have always bridged that gap the hard way. Learning to read Greek is, in
          large part, years of training your eye to see προσέχειν and know to look under
          προσέχω. And when a scholar wants to study a <em>word</em> rather than a page &mdash;
          every place an author uses it, how its meaning shifts between authors or centuries
          &mdash; the traditional instrument is a concordance: a printed index of every
          occurrence of every word in one author&rsquo;s work, compiled by hand, sometimes over a
          lifetime. The concordance to one poet. The concordance to one philosopher. That was
          the deal: a lifetime of labor bought you word-level access to a single author.
        </p>
        <p>
          What removes the gap &mdash; for the student and the scholar alike &mdash; is a table:
          every shape of every word, mapped to its dictionary entry. This week we built one for
          our Greek collection.
        </p>

        <h2>Built from our own shelves</h2>
        <p>
          We swept all 1,040 Greek books in the library &mdash; 471,544 scanned pages &mdash;
          and collected every distinct word form that actually appears in them: 3.86 million,
          once early modern spelling and printing quirks have their say. We then ran the
          well-attested forms through Morpheus, the venerable open-source Greek analyzer
          developed by the Perseus Project, which can tell you that a given shape is, say, the
          present infinitive of προσέχω. Joined to the great Liddell-Scott-Jones lexicon of
          1940, the result is a table of <strong>568,918 word forms, each pointing to its
          dictionary entry</strong>.
        </p>
        <p>
          Because the table was generated from <em>our</em> books rather than a classical
          syllabus, it knows the Greek our readers actually meet &mdash; the spellings of
          Renaissance printers, Byzantine and patristic usage, the Greek that surfaces inside
          Latin scientific books. And because the analyzer, its grammatical tables, and the
          lexicon digitization are all openly licensed, the result is fully open too.
        </p>

        <h2>Is it any good? We checked.</h2>
        <p>
          A table like this is only worth sharing if you can say how accurate it is &mdash; so
          we tested it against the strongest available gold standard: the Perseus treebanks,
          where classicists hand-verified the dictionary form of every single word across
          132,156 words of ancient text. Our table covers <strong>88.8%</strong> of those
          words, and where it offers an answer, it contains the scholars&rsquo; answer
          <strong> 96.6%</strong> of the time. Most of the remaining disagreements are not
          errors but conventions &mdash; cases where two reference works choose different
          headwords for the same word. The genuine gaps are mostly proper names.
        </p>
        <p>
          Against our own pages &mdash; real OCR of real early modern printing, not clean
          modern editions &mdash; a word tapped at random resolves to a dictionary entry about
          80% of the time, and the misses are dominated by names and abbreviations rather than
          ordinary Greek.
        </p>

        <h2>What it makes possible</h2>
        <p>
          For a reader or a learner: tap any word on an original page and get its dictionary
          form and meaning &mdash; the beginning of reading Greek with the original in front of
          you, rather than about it.
        </p>
        <p>
          For a scholar: run the table in reverse and it becomes a concordance machine &mdash;
          not for one author, but for a whole library at once. Every attestation of a word
          across two centuries of books, regardless of what shape it takes on the page: when a
          term enters the literature, when it fades, how it was actually used, with each passage
          one click from the scanned page it lives on. The kind of question that once cost a
          career to answer for a single author becomes an afternoon&rsquo;s work across
          thousands of books.
        </p>
        <p>
          We built the same machinery for Latin &mdash; 1.4 million word forms &mdash; where our
          collection is six times larger. The word-history tools are what we&rsquo;re building
          next.
        </p>
        <p>
          The Greek table is open. If it would be useful to your project, write to us &mdash;
          it wants to be shared.
        </p>

        <p className="text-sm text-stone-500 mt-8">
          Built on the Perseus Project&rsquo;s Morpheus analyzer (maintained by the Perseids
          Project, MPL-2.0), the lsj9 digitization of Liddell-Scott-Jones (CC&nbsp;BY&nbsp;4.0),
          and validated against the Ancient Greek Universal Dependencies treebanks. Gratitude to
          the Alpheios Project, whose reading tools first showed what tap-a-word Greek could
          feel like.
        </p>
      </div>
    </ContentPageLayout>
  );
}
