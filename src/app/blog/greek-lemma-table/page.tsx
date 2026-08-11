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

// The ten Greek lemmas with the most attested shapes in our corpus
// (aggregated from lexicon_lemma_map_grc, 2026-08-10; homograph entries merged).
const SHAPE_DATA = [
  { headword: 'εἰμί', gloss: 'to be', forms: 1474 },
  { headword: 'ποιέω', gloss: 'to make, do', forms: 1138 },
  { headword: 'ἵημι', gloss: 'to send, let go', forms: 1019 },
  { headword: 'ἵστημι', gloss: 'to set, stand', forms: 1018 },
  { headword: 'δίδωμι', gloss: 'to give', forms: 962 },
  { headword: 'τίθημι', gloss: 'to place', forms: 957 },
  { headword: 'ἄγω', gloss: 'to lead', forms: 938 },
  { headword: 'ἔχω', gloss: 'to have, hold', forms: 872 },
  { headword: 'αἴρω', gloss: 'to lift', forms: 813 },
  { headword: 'δέω', gloss: 'to bind; to need', forms: 753 },
];

function ShapesFigure() {
  const max = SHAPE_DATA[0].forms;
  const barH = 22;
  const gap = 14;
  const labelW = 200;
  const chartW = 640;
  const H = SHAPE_DATA.length * (barH + gap) + 8;
  return (
    <figure className="my-10">
      <svg viewBox={`0 0 ${chartW} ${H}`} role="img" aria-label="Bar chart: the ten Greek dictionary words with the most attested spellings and inflected shapes in the Source Library corpus, from εἰμί with 1,474 shapes to δέω with 753" className="w-full h-auto">
        {SHAPE_DATA.map((d, i) => {
          const y = i * (barH + gap);
          const w = Math.round((d.forms / max) * (chartW - labelW - 64));
          return (
            <g key={d.headword}>
              <text x={labelW - 12} y={y + barH / 2} textAnchor="end" dominantBaseline="central" fontSize="15" fill="#44403c" fontWeight="600" lang="grc">
                {d.headword}
                <tspan fontWeight="400" fill="#78716c" fontSize="12" fontStyle="italic">
                  {'  '}{d.gloss}
                </tspan>
              </text>
              <rect x={labelW} y={y} width={w} height={barH} rx="4" fill="#c45d3a" opacity={0.9} />
              <text x={labelW + w + 8} y={y + barH / 2} dominantBaseline="central" fontSize="13" fill="#57534e">
                {d.forms.toLocaleString()}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-sm text-stone-500 mt-3">
        The ten dictionary words with the most attested shapes in our Greek books. The verb
        &ldquo;to be&rdquo; alone appears in 1,474 distinct forms &mdash; each one a way a reader
        can fail to find it in a dictionary.
      </figcaption>
    </figure>
  );
}

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
          <p className="text-stone-400 text-sm mt-4">10 August 2026 &middot; 6 min read</p>
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

      <p className="text-xl text-secondary leading-relaxed mb-8">
        Open a Greek book printed in 1590 and try to look up a word. The dictionary lists
        προσέχω &mdash; but the page in front of you says προσέχειν, or προσέσχομεν, or one of
        several hundred other shapes that verb can take. Greek words change form constantly
        &mdash; for tense, for case, for person &mdash; and dictionaries list each word only
        once, under its <em>lemma</em>, the headword. Between the page and the dictionary
        stands a gap that has stopped beginners cold for centuries.
      </p>

      <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The lifetime index</h2>
      <p className="text-secondary leading-relaxed mb-6">
        Scholars have always bridged that gap the hard way. Learning to read Greek is, in large
        part, years of training the eye to see προσέχειν and know to look under προσέχω. And
        when a scholar wants to study a <em>word</em> rather than a page &mdash; every place an
        author uses it, how its meaning shifts between authors or centuries &mdash; the
        traditional instrument is a concordance: an index of every occurrence of every word in
        one author&rsquo;s work, compiled by hand, sometimes over a lifetime. The concordance to
        one poet. The concordance to one philosopher. That was the bargain: a career of labor
        bought word-level access to a single author.
      </p>
      <p className="text-secondary leading-relaxed mb-6">
        What dissolves the gap &mdash; for the student and the scholar alike &mdash; is a
        table: every shape of every word, mapped to its dictionary entry. This week we built
        one for our Greek collection.
      </p>

      <ShapesFigure />

      <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Built from our own shelves</h2>
      <p className="text-secondary leading-relaxed mb-6">
        We swept all 1,040 Greek books in the library &mdash; 471,544 scanned pages &mdash; and
        collected every distinct word form that appears in them: 3.86 million, once early
        modern spelling and printing quirks have their say. The well-attested forms then went
        through Morpheus, the venerable open-source Greek analyzer developed by the Perseus
        Project, which can tell you that a given shape is the present infinitive of προσέχω.
        Joined to the great Liddell-Scott-Jones lexicon, the result is a table of{' '}
        <strong>568,918 word forms, each pointing to its dictionary entry</strong>.
      </p>
      <p className="text-secondary leading-relaxed mb-6">
        Because the table was generated from <em>our</em> books rather than a classical
        syllabus, it knows the Greek our readers actually meet &mdash; the spellings of
        Renaissance printers, Byzantine and patristic usage, the Greek that surfaces inside
        Latin scientific books. And because the analyzer, its grammatical tables, and the
        lexicon digitization are all openly licensed, the result is fully open too.
      </p>

      <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Is it any good? We checked.</h2>
      <p className="text-secondary leading-relaxed mb-6">
        A table like this is only worth sharing if you can say how accurate it is. So we tested
        it against the strongest gold standard there is: the Perseus treebanks, in which
        classicists hand-verified the dictionary form of every word across 132,156 words of
        ancient text. Our table covers <strong>88.8%</strong> of those words, and where it
        offers an answer it contains the scholars&rsquo; answer <strong>96.6%</strong> of the
        time. Most remaining disagreements are not errors but conventions &mdash; two reference
        works choosing different headwords for the same word; the genuine gaps are mostly
        proper names.
      </p>
      <p className="text-secondary leading-relaxed mb-6">
        The Latin table passes the same kind of exam. Tested against the Index Thomisticus
        treebank &mdash; 333,281 words of Thomas Aquinas, hand-verified, and medieval Latin
        rather than classical, so much closer to what our books contain &mdash; it covers{' '}
        <strong>91.4%</strong> of words and agrees with the scholars <strong>95.1%</strong> of
        the time where it answers.
      </p>
      <p className="text-secondary leading-relaxed mb-6">
        Against our own pages &mdash; real OCR of real early modern printing, not clean modern
        editions &mdash; a word tapped at random resolves to a dictionary entry about 80% of
        the time, with misses dominated by names and abbreviations rather than ordinary text.
      </p>

      <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">What the dataset is, exactly</h2>
      <p className="text-secondary leading-relaxed mb-6">
        One row per word form. Each row carries the form as it appears (normalized), the
        dictionary headword(s) it can belong to with their Liddell-Scott-Jones entry
        references, and how many times the form is attested across our books. 568,918 rows for
        Greek; the same build for Latin &mdash; where our collection is six times larger &mdash;
        carries 1.4 million forms mapped to Lewis &amp; Short. Both inherit only open licenses
        (MPL-2.0 machinery, CC&nbsp;BY&nbsp;4.0 lexicon data), so the tables can be republished,
        embedded in other tools, or used to train whatever comes next. Both are published as a
        citable dataset:{' '}
        <a href="https://doi.org/10.5281/zenodo.21884364" className="text-accent-rust hover:underline">
          doi.org/10.5281/zenodo.21884364
        </a>
        .
      </p>

      <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">What it makes possible</h2>
      <p className="text-secondary leading-relaxed mb-6">
        For a reader or a learner: tap any word on an original page and get its dictionary form
        and meaning &mdash; the beginning of reading Greek with the original in front of you,
        rather than about it.
      </p>
      <p className="text-secondary leading-relaxed mb-6">
        For a scholar: run the table in reverse and it becomes a concordance machine &mdash;
        not for one author, but for a whole library at once. Every attestation of a word across
        two centuries of books, regardless of the shape it takes on the page: when a term
        enters the literature, when it fades, how it was actually used, each passage one click
        from the scanned page it lives on. The kind of question that once cost a career to
        answer for a single author becomes an afternoon&rsquo;s work across thousands of books.
        That is what we are building next.
      </p>

      <p className="text-sm text-stone-500 mt-12 pt-6 border-t border-stone-200">
        Built on the Perseus Project&rsquo;s Morpheus analyzer (maintained by the Perseids
        Project, MPL-2.0), the lsj9 digitization of Liddell-Scott-Jones (CC&nbsp;BY&nbsp;4.0),
        and validated against the Ancient Greek Universal Dependencies treebanks. Gratitude to
        the Alpheios Project, whose reading tools first showed what tap-a-word Greek could feel
        like.
      </p>
    </ContentPageLayout>
  );
}
