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

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Third, and to us most instructive: a judge that cannot do the task does not say
          so &mdash; it says &ldquo;faithful.&rdquo;</strong> Before scaling the grading, we tested
          whether a cheap model from the same family as our translator could stand in for the
          expensive judges. Given the identical entries, the identical rubric, and errors we knew
          were present because they were already catalogued, it called 47 of 49 entries clean
          &mdash; missing 90% of the faults, with zero false alarms. Agreement with the gold
          labels: &kappa; = 0.107, barely above chance. A bigger model of the same family with four
          times the thinking budget did no better. We initially read this as the obvious morality
          tale &mdash; a model going easy on its own family&rsquo;s homework &mdash; and an earlier
          version of this paragraph said exactly that.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Then we ran the control an honest reviewer would demand, and the morality tale fell
          apart. We had fresh translations of the same entries made by the judge&rsquo;s rival
          family, and had both families grade the identical artifacts: on focused
          Greek-plus-translation pairs, the cheap judge found errors at the same rate as its
          expensive rival &mdash; including, decisively, <em>6 of 7 known error-entries in its own
          family&rsquo;s work</em> once we re-presented them in the focused format. The blindness
          was never loyalty. It was task collapse: our original test asked the judge to first
          locate one entry&rsquo;s translation inside a full translated page and then grade it, and
          the cheap model cannot do that composite task &mdash; so it silently returned
          &ldquo;faithful,&rdquo; forty-seven times, instead of once saying &ldquo;I
          can&rsquo;t.&rdquo; The practical rule survives in sharper form: validate a cheap judge
          on the exact task format you will deploy it on, because its incapacity will arrive
          dressed as approval. And the methodological rule above it: when a result flatters your
          suspicion of someone else&rsquo;s model, that is precisely the result to attack with a
          control.
        </p>

        {/* ── The census ── */}
        <h2 className="text-2xl font-serif text-primary mt-12 mb-4">The census</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The same cheap model had gone two-for-two on the coarse checks in the small test, so we
          gave it what looked like the job it could hold: a categorical sweep of all 27,149 aligned
          entries, twenty-four at a time. Is the translation present? Is the alignment right? Does
          the English contradict the Greek in the direction of received knowledge? It returned
          97.4% of entries clean, with 446 flagged translation-not-found, 342 for alignment, and 66
          for possible recitation, for $1.11.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Then we did to the sweep what we had just done to the judge, and it failed too. The 49
          gold-labelled entries were inside those 27,149, so the sweep could be scored against
          them: it missed all three of the known events &mdash; the real recitation case, the real
          misalignment &mdash; and added one false alarm. We then seeded twelve entries with a
          deliberate contradiction, a name in the English that the Greek does not contain, and ran
          them through both call formats. The twenty-four-at-a-time format caught four of twelve.
          One entry per call caught five. Neither is a measuring instrument.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          So the numbers above are a <em>screen</em>, not a census. We then sent all sixty-six
          recitation candidates to cross-family judges, one entry each, and the screen came out
          worse than its sensitivity alone suggested: <strong>two of the sixty-six were
          real</strong>. One is lovely &mdash; our Greek reads &delta;&oacute;&rho;&upsilon;,{' '}
          <em>spear</em>, and our English says a small Persian <em>sword</em>, which is what an
          akinakes actually was. In the other, our page reads &ldquo;died aged 58,&rdquo; the
          reading Adler prints, while our English gives 69, the age every reference book assigns
          Aeschylus. Both contradict our own scan in the direction of received knowledge. That is
          the fingerprint.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The other sixty-four failed in one consistent way, and it is the more interesting half.
          The screen had flagged any disagreement between our English and the scholars&rsquo;,
          without regard to direction &mdash; and most of those disagreements turned out to be our
          translation faithfully following a <em>corrupted</em> line of our own scan, and so
          departing from Adler. That is the mirror image of recitation: evidence the translator was
          reading the page rather than remembering the book. A detector built to catch a machine
          trusting its memory had mostly caught the machine trusting its eyes. It also, while
          failing, handed us something useful &mdash; a list of real scanning errors, spotted in
          passing by judges who were busy rejecting the flag attached to them.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Which leaves the honest position on the number itself: we do not know it. Three
          recitation cases are now confirmed in this corpus. The pilot&rsquo;s rate of one in
          forty-nine carries, at that sample size, a confidence interval running from roughly 0.4%
          to 11% &mdash; somewhere between a hundred and three thousand entries, which is less a
          measurement than an admission. Getting it properly will take a verified sample judged by
          judges that can do the task. A cheap sweep turned out to be a fair way to find candidates
          and a bad way to count them &mdash; and the two it did find were worth the dollar.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Everything in this note that touched a paid API cost <strong>$1.18</strong>, the sweep
          included &mdash; and the experiments that demolished two of our own conclusions cost
          about four cents of that. Against the sixteen years of volunteer labour all of it is
          measured with, the asymmetry is the fact of our era; it is also, we think, the reason to
          be slow about believing cheap numbers. The scholarship was the expensive part and it is
          the part that held.
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

        <h2 className="text-2xl font-serif text-primary mt-12 mb-4">Corrections</h2>

        <p className="text-secondary leading-relaxed mb-4">
          This note is a running record of an investigation, and the investigation kept overturning
          it. Every change to a factual claim is logged here rather than made quietly; the evidence
          for each is in the public issue linked below.
        </p>

        <ul className="list-disc pl-6 text-secondary leading-relaxed mb-8 space-y-2">
          <li>
            <strong>12 August 2026 &mdash; errors found in the reference: 6 &rarr; 5.</strong> The
            six claims were re-adjudicated with the Suda On Line&rsquo;s own annotations restored
            and instructions to extend it maximal charity. One dissolved: SOL&rsquo;s reading
            faithfully rendered the transmitted Greek and <em>our</em> translation had normalised
            it. Five survived.
          </li>
          <li>
            <strong>12 August 2026 &mdash; &ldquo;a model cannot grade its own family&rsquo;s
            homework&rdquo; withdrawn.</strong> A control &mdash; the same cheap judge, its
            rival&rsquo;s translations, and its own family&rsquo;s work re-presented as focused
            pairs &mdash; showed the blindness was task collapse on our packet format, not
            loyalty. The section now reports the corrected finding.
          </li>
          <li>
            <strong>12 August 2026 &mdash; the 27,149-entry census demoted to a screen.</strong>
            Scored against the gold labels it missed all three known events, and on seeded
            contradictions it caught four of twelve. Its clean-rate and recitation percentages were
            removed as statistics and are now described as candidates at measured low sensitivity.
          </li>
          <li>
            <strong>12 August 2026 &mdash; all 66 recitation candidates verified; 2 were real.</strong>{' '}
            Cross-family judges cleared 64 of them, most because our translation had faithfully
            followed a corrupted scan rather than a remembered text. The section now reports the
            verified outcome and states plainly that the corpus-wide rate remains unmeasured.
          </li>
        </ul>

        <p className="text-muted text-sm leading-relaxed mb-2">
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
