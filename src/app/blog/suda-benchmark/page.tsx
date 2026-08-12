import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

const OG_IMAGE = 'https://images.sourcelibrary.org/pages/69a99ce86c7545e2236e12de/0300.jpg';
const OG_ALT =
  'A two-column page of Bekker’s 1854 edition of the Suda, dense Greek type listing the seven men named Didymus.';
const DESCRIPTION =
  'The Suda has 31,000 entries. Two hundred volunteer scholars spent sixteen years translating it; our pipeline did it as ordinary throughput. Then we aligned the two, let each grade the other, and measured something neither could see alone — for $1.15.';

export const metadata: Metadata = {
  title: 'Graded by the Suda - Research Notes - Source Library',
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: OG_IMAGE, alt: OG_ALT }],
    title: 'Graded by the Suda',
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: OG_IMAGE, alt: OG_ALT }],
  },
  alternates: {
    canonical: '/blog/suda-benchmark',
  },
};

export default function SudaBenchmarkPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Graded by the Suda"
          subtitle="We aligned our AI translation of a 31,000-entry Byzantine encyclopedia with twenty-five years of volunteer scholarship &mdash; and let each grade the other."
          image={OG_IMAGE}
          imageAlt={OG_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">11 August 2026 &middot; 9 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link href="/blog" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          The Suda is a tenth-century Byzantine encyclopedia with about 31,000 entries &mdash; part
          dictionary, part gossip column, part salvage operation for a thousand ancient books that
          no longer exist. It was long considered untranslatable by any one person. The{' '}
          <a href="https://www.cs.uky.edu/~raphael/sol/sol-html/" target="_blank" rel="noopener noreferrer">
            Suda On Line
          </a>{' '}
          proved it could be done by two hundred people: starting in 1998, volunteer classicists
          translated it entry by entry, finishing in 2014 &mdash; sixteen years, one of the first
          great crowdsourced scholarship projects on the web.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We hold{' '}
          <Link href="/book/suidae-lexicon-suidas">Bekker&rsquo;s 1854 edition of the Suda</Link>{' '}
          &mdash; 1,158 dense two-column pages, alpha to omega &mdash; and our pipeline translated
          it the way it translates everything: as ordinary throughput. Which raises the question
          every page of this library should be asked. <em>How good is it?</em>
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          For almost every book we hold, that question has no external answer &mdash; there is no
          prior translation to check against, which is usually the reason the book is here at all.
          The Suda is the great exception: 31,000 entries of scholar-vetted English, sitting right
          there. So we spent a day building the comparison, and it told us things we could not have
          learned any other way. Some of them are not about us.
        </p>

        {/* ── The alignment ── */}
        <h2 className="text-2xl font-serif text-primary mt-12 mb-4">Two books, one text, different orders</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Step one was mirroring the Suda On Line &mdash; all 31,342 entries, with their
          translations, translator names, vetting status, and (a gift we had not expected) the
          Greek text of Adler&rsquo;s 1928&ndash;38 critical edition embedded in every entry. Step
          two was cutting our OCR of Bekker into entries and matching the two lists up.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          That sounds mechanical. It is actually philology. Scholars cite the Suda by Adler number
          (&ldquo;delta 872&rdquo;), but Adler numbers postdate our edition by seventy-five years
          &mdash; nothing on Bekker&rsquo;s pages carries one. Worse, the two editions do not even
          agree on the order of the alphabet: the Suda&rsquo;s native arrangement is{' '}
          <em>antistoichic</em> &mdash; letters grouped by Byzantine pronunciation, so that
          &alpha;&iota;- words file after alpha as their own block &mdash; and Adler kept that
          arrangement while Bekker quietly re-alphabetized it. Our first alignment pass scored
          exactly 0% on three letter-groups before we understood why. And when several people share
          a name &mdash; the Suda has seven consecutive entries for men called Didymus &mdash;
          Adler&rsquo;s numbering does not follow Bekker&rsquo;s printed order, so the only way to
          match them is by what the entries actually say.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The finished aligner matches on headwords, insists the sequence stay monotonic, uses the
          scholarly reference itself to find entry boundaries our OCR ran together, and
          disambiguates homonyms by text similarity against Adler&rsquo;s Greek. It aligned{' '}
          <strong>27,149 entries &mdash; 86.6% of the Suda</strong> &mdash; each one now carrying
          its Adler number, its scan page, our Greek, our English, and the scholars&rsquo; English.
        </p>

        {/* ── The grading ── */}
        <h2 className="text-2xl font-serif text-primary mt-12 mb-4">The grading</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Then we graded a stratified sample of 49 entries the slow way: an independent AI judge per
          entry &mdash; deliberately from a different model family than the one that made the
          translations, for reasons that will become obvious &mdash; with both Greek texts on the
          desk as arbiters. Every discrepancy had to be traced to its source: our translation, the
          scholars&rsquo; translation, or the two editions genuinely disagreeing.
        </p>

        <p className="text-secondary leading-relaxed mb-6">The verdict on our translation:</p>

        <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-2">
          <li>
            <strong>28 of 49 entries fully faithful; 21 with minor issues; none with major
            errors.</strong> The 64 individual faults catalogued are dominated by flattened nuance
            and small mistranslations &mdash; a Greek second-person rendered as third, an
            &ldquo;in part&rdquo; dropped &mdash; not fabrication.
          </li>
          <li>
            <strong>Recitation &mdash; translating from memory instead of from the page &mdash;
            appeared exactly once in 49 entries.</strong> Readers of{' '}
            <Link href="/blog/reciting-not-reading">our earlier note on models reciting canonical
            texts</Link> will know why we hunt this failure specifically: in one entry, our OCR
            reads &mu;&epsilon;&iota;&zeta;&omicron;&nu; (&ldquo;greater&rdquo;) but our English
            asserts what Adler&rsquo;s text says instead. The model knew the passage too well.
          </li>
          <li>
            The judges also documented the opposite &mdash; <em>anti</em>-recitation: our
            translation preserving Bekker&rsquo;s readings against the standard text. Where Bekker
            prints Aristarchus and Adler prints Archilochus, our English says Aristarchus. Where
            Bekker&rsquo;s entry ends two sentences before Adler&rsquo;s, our translation stops
            exactly where our page stops. That is what translating-from-source looks like when you
            can check.
          </li>
        </ul>

        <p className="text-secondary leading-relaxed mb-8">
          Forty-nine entries is a pilot, not a proof &mdash; the error bars on those percentages
          are about &plusmn;14 points, and we are growing the gold set. But the shape of the result
          matches what we found reading pages by hand: reliable for reading and finding, with a
          known failure mode &mdash; confident fluency over corrupt input &mdash; concentrated
          exactly where the OCR met the hardest Greek.
        </p>

        {/* ── The graders graded ── */}
        <h2 className="text-2xl font-serif text-primary mt-12 mb-4">The graders, graded</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Three findings came out of the comparison that are not about our translation at all.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>First: the editions disagree far more than anyone tells you.</strong> 42 of our 49
          sampled entries contained genuine differences between Bekker&rsquo;s 1854 text and
          Adler&rsquo;s critical text &mdash; different quotations included, different case
          readings, different entry boundaries. Anyone who graded an AI translation of Bekker
          against a translation of Adler without checking the Greek would count every one of those
          as an AI error. Most published evaluations of historical-text translation do exactly
          that. The aligned corpus is, as a side effect, the raw material for a systematic
          collation of the two editions &mdash; something that does not currently exist.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Second: the reference makes mistakes too.</strong> In 5 of 49 entries the judges
          found the scholarly translation erring against its own Greek &mdash; small things, a word
          construed against its attested sense, a misparsed genitive, the ordinary residue of any
          twenty-five-year project. (We first counted six. On re-examination with SOL&rsquo;s own
          annotations in view, one claim dissolved &mdash; the error in that entry was ours, and we
          have corrected this paragraph accordingly. Every surviving claim was re-adjudicated the
          same way, with instructions to extend SOL maximal charity.) We say this with gratitude,
          not glee: the Suda On Line is the only reason this measurement exists, and we will report
          what we found upstream, with the evidence, the way their own contributors would. When a machine translation and a human translation can each
          be checked against the Greek, each becomes an error-detector for the other. That
          reciprocity &mdash; not replacement &mdash; is the actual relationship between AI
          translation and scholarship that this experiment demonstrates.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>Third, and to us most important: a model cannot grade its own family&rsquo;s
          homework.</strong> Before scaling the grading, we tested whether a cheap model from the
          same family as our translator could stand in for the expensive cross-family judges. Given
          the identical entries, the identical rubric, and errors we knew were present because they
          were already catalogued, it called 47 of 49 entries clean &mdash; missing 90% of the
          faults, with zero false alarms. Agreement with the gold labels: &kappa; = 0.107, barely
          above chance. Escalating to the bigger model of the same family with four times the
          thinking budget changed nothing. The misses all point one direction: pure leniency toward
          its own family&rsquo;s output. It is hard to imagine a cleaner argument that AI systems
          must be evaluated by their rivals, never by their relatives.
        </p>

        {/* ── The census ── */}
        <h2 className="text-2xl font-serif text-primary mt-12 mb-4">The census</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The same cheap model, though, went two-for-two on the coarse checks it could do &mdash;
          spotting the one misaligned entry and the one recitation case. So we gave it the job it
          could actually hold: a categorical census of all 27,149 aligned entries. Is the
          translation present? Is the alignment right? Does the English contradict the Greek in the
          direction of received knowledge?
        </p>

        <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-2">
          <li><strong>97.4%</strong> of entries fully clean;</li>
          <li><strong>1.6%</strong> flagged translation-not-found;</li>
          <li><strong>1.3%</strong> flagged for alignment review;</li>
          <li>
            <strong>0.24%</strong> flagged for possible recitation &mdash; the corpus-wide rate,
            consistent with the pilot&rsquo;s 1-in-49.
          </li>
        </ul>

        <p className="text-secondary leading-relaxed mb-8">
          Every flag is a candidate, not a conviction &mdash; each gets cross-family verification
          before anything changes. The whole census cost <strong>$1.11</strong>. With the
          validation runs included, everything in this note that touched a paid API cost $1.15
          &mdash; against the sixteen years of volunteer labor it is measured with, which is the
          juxtaposition of our era in one line.
        </p>

        {/* ── What happens with it ── */}
        <h2 className="text-2xl font-serif text-primary mt-12 mb-4">What happens with it</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The 750 flagged entries become a repair worklist before most readers ever hit them. The
          alignment becomes Adler-number citation for our Suda &mdash; cite &ldquo;Suda &delta;
          872&rdquo; and land on the leaf. And the aligned corpus &mdash; two Greek edition texts,
          our OCR, our translation, the scholars&rsquo; translation, per-entry quality labels
          &mdash; is being prepared for release as an open dataset, because parallel corpora for
          ancient Greek with vetted ground truth essentially do not exist at this scale, and we
          would like the next pipeline to be graded harder than ours was. The Suda On Line&rsquo;s
          translations are CC BY-NC-SA, and the dataset will honor that: a full aligned version
          under their terms, and an our-columns-only version under CC BY-SA that anyone can rejoin.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          One book in our library came with its own answer key. We used it, and the grade was:
          good, honestly flawed, measurably improving &mdash; and now we know which 2.6% of the
          entries to fix first. The other 34,000 books have no answer key. The method &mdash;
          align, arbitrate against the source, never let a model grade its relatives &mdash; is
          how we intend to grade ourselves anyway.
        </p>

        <p className="text-muted text-sm leading-relaxed mt-12 mb-2">
          Read the Suda:{' '}
          <Link href="/book/suidae-lexicon-suidas">sourcelibrary.org/book/suidae-lexicon-suidas</Link>.
          The Suda On Line lives at{' '}
          <a href="https://www.cs.uky.edu/~raphael/sol/sol-html/" target="_blank" rel="noopener noreferrer">
            cs.uky.edu/~raphael/sol
          </a>{' '}
          &mdash; twenty-five years of open scholarship without which none of this measurement
          would be possible. Methods, alignment code, and the full evaluation trail are public in{' '}
          <a
            href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/3884"
            target="_blank"
            rel="noopener noreferrer"
          >
            issue #3884
          </a>
          .
        </p>
      </article>
    </ContentPageLayout>
  );
}
