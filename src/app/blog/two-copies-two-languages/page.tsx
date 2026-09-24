import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Two Copies, Two Languages - Research Notes - Source Library',
  description:
    'We hold the same 1495 Aldine grammar twice. One copy is catalogued Greek, the other Latin, and both are right. Fixing that meant measuring 21,481 books — and twice the largest finding turned out to be the measuring instrument.',
  openGraph: {
    images: [
      {
        url: 'https://images.sourcelibrary.org/pages/69b220ccf79d8af0eab7fd3a/0043.jpg',
        alt: 'A page of Greek type from the 1495 Aldine edition of Lascaris’ Erotemata',
      },
    ],
    title: 'Two Copies, Two Languages',
    description:
      'A Greek grammar with a Latin translation on facing pages broke our catalogue. Fixing it took three answers, and the first two were wrong in the same way.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [
      {
        url: 'https://images.sourcelibrary.org/pages/69b220ccf79d8af0eab7fd3a/0043.jpg',
        alt: 'A page of Greek type from the 1495 Aldine edition of Lascaris’ Erotemata',
      },
    ],
  },
  alternates: {
    canonical: '/blog/two-copies-two-languages',
  },
};

export default function TwoCopiesTwoLanguagesPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Two Copies, Two Languages"
          subtitle="A book that is genuinely two languages at once, and what it took to admit it"
          image="https://images.sourcelibrary.org/pages/69b220ccf79d8af0eab7fd3a/0043.jpg"
          imageAlt="A page of Greek type from the 1495 Aldine edition of Lascaris' Erotemata"
        >
          <p className="text-stone-400 text-sm mt-4">21 August 2026 &middot; 8 min read</p>
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
        <p className="text-xl text-secondary leading-relaxed mb-8">
          We were hunting letterforms in early Aldine printing when we noticed something odd
          about a grammar we hold two copies of. Filter the library to Latin and you get one of
          them. Filter to Greek and you get the other. There is no filter that shows you the
          book. Both entries are correct, the filter is working exactly as designed, and the
          book is still hiding.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">A book with two halves</h2>
        <p className="text-secondary leading-relaxed mb-6">
          The book is Constantine Lascaris&rsquo; <em>Erotemata</em>, a Greek grammar, printed in
          Venice in 1495 &mdash; among the first books Aldus Manutius put through his press, and
          the beginning of the Aldine Greek programme. It is not only a Greek book. Facing every
          page of Greek is Johannes Crastonus&rsquo; Latin translation, because the point of the
          book was to teach Greek to readers who had Latin. Open it anywhere and you are looking
          at two languages doing different jobs on facing leaves.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          Our catalogue, like most catalogues, has one field for language. It holds a single
          value. A cataloguer facing this book must decide whether it is Greek or Latin, and
          whichever they choose, the other half of the book becomes invisible to anyone
          filtering for it. Two different people made that call on our two copies, in opposite
          directions, and neither made a mistake.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          This is not an exotic edge case. Bilingualism by design is ordinary in early printing:
          Greek&ndash;Latin grammars and lexica, Hebrew&ndash;Latin bibles, Arabic&ndash;Latin
          medicine, the great polyglot bibles that run four and six languages in parallel
          columns. A single-language field quietly reports all of them as half of themselves.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The fix that was already there</h2>
        <p className="text-secondary leading-relaxed mb-6">
          The obvious answer is a list instead of a single value, so we went to add one. It
          already existed. A <code>languages</code> array had been sitting on 45,675 books since
          May, written by a maintenance script nobody had thought about since.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          It was also useless, in an instructive way. Of 17,857 published books carrying the
          field, exactly <strong>245</strong> held more than one language. Nothing in the site
          read it. The search filter that appears to use it &mdash; the parameter is literally
          named <code>languages</code> &mdash; queries the old single-value field instead.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          The reason the array was empty is the interesting part. The script that fills it works
          by <em>parsing the text already in the single field</em>. Give it{' '}
          <code>&ldquo;Greek-Latin&rdquo;</code> and it correctly produces two entries. Give it a
          book catalogued <code>&ldquo;Greek&rdquo;</code> that happens to be half Latin and it
          produces one. It had already run over both copies of the Lascaris and faithfully
          confirmed each cataloguer&rsquo;s guess. A field can be populated, idempotent, and
          structurally incapable of learning anything.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Ask the pages</h2>
        <p className="text-secondary leading-relaxed mb-6">
          There was better evidence in the building. When our OCR model reads a page it records
          what language it saw, page by page, and it has been doing so for millions of pages. We
          had never aggregated it. Reading the tags for the two Lascaris copies takes a few
          seconds and produces this, in order, straight down the middle of the book:
        </p>
        <p className="text-secondary leading-relaxed mb-6 font-mono text-sm bg-warm/50 rounded-lg p-5 border border-light">
          Latin &middot; Greek &middot; Latin &middot; Greek &middot; Latin &middot; Greek
          &middot; Latin &middot; Greek &middot; Latin &middot; Greek &middot; Latin &middot;
          Greek
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          That is the physical structure of the book, recovered from evidence rather than from a
          catalogue entry. Totalled across both copies:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm border border-light">
            <thead className="bg-warm/60">
              <tr>
                <th className="text-left p-3 font-semibold text-primary">Copy</th>
                <th className="text-right p-3 font-semibold text-primary">Latin pages</th>
                <th className="text-right p-3 font-semibold text-primary">Greek pages</th>
                <th className="text-left p-3 font-semibold text-primary">Catalogued as</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-light">
                <td className="p-3 text-secondary">First copy (340pp)</td>
                <td className="p-3 text-right text-secondary">178</td>
                <td className="p-3 text-right text-secondary">153</td>
                <td className="p-3 text-secondary">Greek</td>
              </tr>
              <tr className="border-t border-light">
                <td className="p-3 text-secondary">Second copy (336pp)</td>
                <td className="p-3 text-right text-secondary">178</td>
                <td className="p-3 text-right text-secondary">154</td>
                <td className="p-3 text-secondary">Latin</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Two different physical copies, scanned separately, read separately by a machine that
          was not told what to expect, agreeing to within one page. The catalogue gave two
          answers; the books gave one. So we wrote a detector that does this for the whole
          library and ran it over every published book with readable pages &mdash; 21,481 of
          them.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The first wrong answer</h2>
        <p className="text-secondary leading-relaxed mb-6">
          The first run reported that a couple of percent of books flatly contradicted their own
          catalogue entry. Before believing it we looked at the actual list, and the top of it
          was Comenius&rsquo; <em>Orbis Sensualium Pictus</em> &mdash; the famous illustrated
          schoolbook, catalogued in our system as <code>Latin/English</code>, measured at 93%
          English and 91% Latin.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          Which is to say: catalogued exactly right, and reported as broken. Our comparison read{' '}
          <code>&ldquo;Latin/English&rdquo;</code> as one opaque token, matched it against
          neither Latin nor English, and concluded the record disagreed with the book. Every one
          of the contradictions in that first slice was this. It turns out 96 of our 229
          distinct language values are already compound strings &mdash; cataloguers have been
          working around the single-value field by hand for years, writing{' '}
          <code>&ldquo;Hebrew and Aramaic&rdquo;</code> into a box that was only ever meant to
          hold one word.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The second wrong answer</h2>
        <p className="text-secondary leading-relaxed mb-6">
          Fixed that, re-ran, and got a real headline: <strong>6,230 books</strong> carrying a
          substantial second language nobody had recorded. Nearly a third of the library. It
          would have been a good number to publish.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          Sorted by frequency, the largest single group &mdash;{' '}
          <strong>2,423 books, 38% of the entire finding</strong> &mdash; was
          &ldquo;Chinese&nbsp;+&nbsp;Classical Chinese.&rdquo;
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          Those are not two languages in a book. That is one text, with the model calling it
          &ldquo;Chinese&rdquo; on some pages and &ldquo;Classical Chinese&rdquo; on others. We
          had told our own detector to treat those names as distinct, which is correct when
          you are cataloguing and wrong when you are asking whether a book is bilingual. The
          finding was an artifact of the instrument, and it was more than a third of the result.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          After teaching the comparison about language families &mdash; historical stages stay
          distinct as catalogue values, collapse when asking &ldquo;is this book
          bilingual?&rdquo; &mdash; the number fell to <strong>3,822</strong>. Still a great deal
          of unrecorded bilingualism. Just not the number we nearly published.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The rule we got out of it
        </h2>
        <p className="text-secondary leading-relaxed mb-6">
          Twice in one afternoon, the headline finding was the measuring instrument. Both times
          the output looked exactly like a data problem &mdash; a specific, plausible, countable
          defect in the corpus &mdash; and both times the defect was in the comparison.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          What makes this catchable is that <strong>an artifact is systematic, so it clumps</strong>.
          Real defects in a library of a hundred thousand books are scattered: a bit of this, a
          bit of that, no single cause. An instrument error applies the same wrong rule every
          time it fires, so it lands in one enormous pile. Which gives a cheap and general
          check: before quoting a rate, sort your findings by frequency and look hard at the
          biggest group. If it has a single crisp explanation, it is probably you.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          Both times, that check took under a minute and cost nothing. Both times, skipping it
          would have produced a confident and completely wrong published number.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The thing that looked like an error and was not
        </h2>
        <p className="text-secondary leading-relaxed mb-6">
          The corrected run still flags 1,014 books whose pages appear to be in a different
          language from their catalogue entry, and the largest group there deserves the same
          scepticism. It is <strong>196 books catalogued Korean whose pages are Classical
          Chinese</strong> &mdash; royal protocols of the Joseon court, Buddhist ritual manuals.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          Those records are not wrong either. Korean scholarly and official writing was done in
          literary Chinese for centuries; the practice has a name, <em>hanmun</em>. The
          provenance, the authorship and the readership are Korean, and the script on the page
          is Chinese, and a catalogue that has to pick one is going to disappoint somebody. Our
          Tibetan collection produces the same pattern with Sanskrit, 289 times over. These are
          facts about how the books were made, arriving in the shape of a data error.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          Which is the strongest argument for the list. Not that the old entries were mistakes
          &mdash; almost none of them were &mdash; but that a single value forced a true thing
          and another true thing to compete for one slot.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">What the pages said</h2>
        <p className="text-secondary leading-relaxed mb-6">
          Of the 21,481 published books with readable pages: 14,313 agree with their catalogue
          entry; <strong>3,822 carry an unrecorded second language</strong>; 1,014 contradict
          their entry outright; the rest have too few pages, or OCR old enough that it never
          recorded a language at all.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          Inside the bilingual group there are two distinguishable kinds of book. About 1,643
          have the second language on 40% of pages or more &mdash; facing-page editions, the
          Lascaris shape. About 1,571 sit between 10% and 25%, which is the shape of a treatise
          in one language quoting steadily in another: German alchemical works quoting Latin,
          Latin theology quoting Greek and Hebrew. Those are genuinely different books and no
          single percentage cut separates them, which is why the threshold is still an open
          question here rather than a setting we have already chosen.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          One more group is worth naming: 64 books catalogued as Greek whose pages are 99&ndash;100%
          Latin. Commandino&rsquo;s Hero of Alexandria, Vizzani&rsquo;s Ocellus Lucanus, a
          Hierocles. These are Renaissance Latin translations shelved under the language of the
          original &mdash; a Latin book presenting itself as a Greek one. We had suspected the
          pattern for a month without being able to name a single instance. Now there is a list.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Nothing has been changed yet</h2>
        <p className="text-secondary leading-relaxed mb-6">
          The detector writes nothing. It produces a report, and the switch that would let it
          edit the catalogue does not exist &mdash; running it with that flag exits with an
          error, on purpose. Given that its first two versions were confidently wrong in ways
          that took a human eye to catch, letting the third version rewrite a hundred thousand
          records unattended would be an odd conclusion to draw.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          There is also a specific hazard. Our language field records the language of{' '}
          <em>this edition</em>, not of the original work, so an English translation of Plato is
          correctly catalogued English. A well-meaning sweep in June inferred the opposite and
          proposed relabelling 547 books to their source languages; a dry run caught that 523 of
          them were ordinary English translation editions. It was not applied. That near-miss is
          why anything touching this field now runs as a report first and a human decision
          second.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          What we can say is what the books say. Two copies of one 1495 grammar, scanned
          separately and read by a machine that was never told what to expect, report the same
          thing to within a single page: roughly 178 pages of Latin and 153 of Greek, printed
          face to face so that one could teach the other. The catalogue will eventually be able
          to say that too.
        </p>

        <div className="mt-16 pt-8 border-t border-light">
          <p className="text-sm text-muted leading-relaxed">
            The detector is{' '}
            <code className="text-xs">scripts/audit/detect-book-languages.mjs</code> in our
            public repository, along with the shared language vocabulary and its tests. Both
            copies of the Lascaris are readable in full: the{' '}
            <Link
              href="/book/erotemata-greek-grammar-with-latin-translation-aldine-lascaris"
              className="text-accent-rust hover:underline"
            >
              first
            </Link>{' '}
            and the{' '}
            <Link
              href="/book/erotemata-with-the-latin-translation-of-johannes-crastonus-p"
              className="text-accent-rust hover:underline"
            >
              second
            </Link>
            .
          </p>
        </div>
      </article>
    </ContentPageLayout>
  );
}
