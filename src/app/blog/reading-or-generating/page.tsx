import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

const HERO = 'https://images.sourcelibrary.org/archived/fec0b295-0795-440f-a467-434e17ba2a8e/74.jpg';

export const metadata: Metadata = {
  title: 'Reading, or Generating? - Research Notes - Source Library',
  description: 'We kept every page our OCR ever overwrote — 191,221 of them. Reading that pile back taught us that the models fail on unfamiliar letterforms rather than unfamiliar languages, that the dangerous failure is the fluent one, and that five of our own measurements were wrong first.',
  openGraph: {
    title: 'Reading, or Generating?',
    description: 'What 191,221 re-read pages taught us about trusting machine transcription — and about trusting the instruments that measure it.',
    images: [{ url: HERO, width: 1200, height: 1600 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: HERO }],
  },
  alternates: {
    canonical: '/blog/reading-or-generating',
  },
};

function Finding({ n, claim, children }: { n: string; claim: string; children: React.ReactNode }) {
  return (
    <div className="border border-border-light rounded-xl overflow-hidden mb-4">
      <div className="bg-warm px-5 py-3 border-b border-border-light flex items-baseline gap-3">
        <span className="text-xs font-mono text-muted">{n}</span>
        <span className="text-primary font-medium">{claim}</span>
      </div>
      <div className="px-5 py-4 text-secondary leading-relaxed">{children}</div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-2xl text-primary font-serif">{value}</div>
      <div className="text-xs font-mono uppercase tracking-wider text-muted mt-1">{label}</div>
    </div>
  );
}

export default function ReadingOrGeneratingPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Reading, or Generating?"
          subtitle="We kept every page our OCR ever overwrote. Reading the pile back was not reassuring."
          image={HERO}
          imageAlt="A page of Asis rimonim, a Kabbalistic manuscript in Hebrew cursive, which our OCR could not read"
        >
          <p className="text-stone-400 text-sm mt-4">6 August 2026 &middot; 12 min read</p>
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

        {/* --- Lead --- */}
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Every time our pipeline overwrites a page&rsquo;s transcription, the old text is kept. Nobody designed
          that as a dataset &mdash; it just accumulated. By August it held <strong>191,221 stored OCR revisions
          across 2,135 books</strong>: pages read twice, sometimes three times, by different models at different
          moments.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          That looked like a free experiment. The same page, read again, with nobody needed to say which reading
          is right: where two passes agree the text is probably really there, and where they diverge something is
          wrong. We had already used a smaller version of this idea to measure
          {' '}<a href="/blog/ocr-consistency" className="text-accent-rust hover:underline">a 1.8% disagreement rate on Latin and German</a>.
          This is what happened when we tried it at scale. The findings first, then the route, including the wrong
          turns &mdash; of which there were more than we expected, and most of them were ours rather than the
          machine&rsquo;s.
        </p>

        {/* --- FINDINGS --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What we found
        </h2>

        <Finding n="01" claim="OCR fails on unfamiliar letterforms, not unfamiliar languages">
          Arabic scores 80% and Sanskrit 65% on our agreement measure &mdash; both non-Latin, both fine. Hebrew in
          printed square type scores <strong>96%</strong>. The <em>same language</em> in a cursive hand scores{' '}
          <strong>9%</strong>, and the Zohar returns almost nothing at all. A page of{' '}
          <em>Mikraot Gedolot</em> that sets biblical text in square type <em>surrounded by</em> commentary in
          Rashi type lands in between, at 28%. The axis varies within a single page, which no theory about
          languages can produce.
        </Finding>

        <Finding n="02" claim="The dangerous failure is the fluent one">
          Given a page it could not read, the cheap model produced 1,554 characters of polished rabbinic Hebrew
          &mdash; <em>&ldquo;I have told you that all I wrote above is true and clear, without any doubt&hellip;&rdquo;</em>
          &mdash; bearing no relation to the image. A better model marked the illegible spans{' '}
          <span className="font-mono text-sm">[...]</span> and stopped. <strong>The honest output scores worse
          under any fluency-based metric.</strong> Garbled-but-anchored is recoverable; fluent-but-unanchored reads
          perfectly and corresponds to nothing.
        </Finding>

        <Finding n="03" claim="Two models disagreeing is a cheap, general detector">
          Two model families do not share a fabrication, so tokens they agree on are tokens the image put there.
          It needs no ground truth, no human, and costs cents per page. It catches exactly the case that our
          existing quality scoring passed &mdash; because that compared OCR against its own translation, and both
          had been generated from the same hallucination.
        </Finding>

        <Finding n="04" claim="A third of the “double-OCR corpus” is not double OCR">
          56,413 of the 191,221 revisions are a data repair that <em>moved text between pages</em> to fix an
          off-by-one alignment error. On those rows the &ldquo;before&rdquo; text is the neighbouring page&rsquo;s
          transcription, not an earlier reading of this one. It had been labelled all along, in a column nobody
          was filtering on. Applying that one filter drops the apparent rate of &ldquo;the two passes read
          different leaves&rdquo; from about 40% to <strong>4.2%</strong>.
        </Finding>

        <div className="bg-warm border border-border-light rounded-xl p-6 mb-12 mt-8">
          <p className="text-xs font-mono uppercase tracking-wider text-muted mb-3">And the finding that outlasts the rest</p>
          <p className="text-secondary leading-relaxed">
            Five of our own measurements produced confident, plausible, <em>wrong</em> answers before something
            external contradicted them: a similarity metric that called working German OCR &ldquo;not
            reading&rdquo;, a tokenizer that silently deleted every Chinese page, a signal scored against a label
            it had helped define. Four of the five looked right until they were checked against something that did
            not share their assumptions. They are described at the end, because they are the part most likely to
            be useful to somebody else.
          </p>
        </div>

        {/* --- THE DATA --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The data
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Everything below is reproducible. The builder reads only our database and costs nothing to run; the
          report and the audit read only the resulting files and need no network at all.
        </p>

        <div className="border border-border-light rounded-xl overflow-hidden mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border-light bg-warm">
            <Stat value="2,135" label="Books" />
            <Stat value="779,409" label="Pages" />
            <Stat value="191,221" label="Revisions" />
            <Stat value="131,965" label="Usable pairs" />
          </div>
        </div>

        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light">
                <th className="text-left py-2 pr-4 font-mono text-xs uppercase tracking-wider text-muted font-medium">Table</th>
                <th className="text-right py-2 pr-4 font-mono text-xs uppercase tracking-wider text-muted font-medium">Rows</th>
                <th className="text-left py-2 font-mono text-xs uppercase tracking-wider text-muted font-medium">What one row is</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light"><td className="py-2 pr-4 font-mono text-xs">books.csv</td><td className="py-2 pr-4 text-right font-mono">2,135</td><td className="py-2">A book, with its re-OCR history</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4 font-mono text-xs">pages.csv</td><td className="py-2 pr-4 text-right font-mono">779,409</td><td className="py-2">A page &mdash; re-OCR&rsquo;d <em>and</em> single-OCR, so there is a control</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4 font-mono text-xs">revisions.csv</td><td className="py-2 pr-4 text-right font-mono">191,221</td><td className="py-2">One stored prior text, with its provenance</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4 font-mono text-xs">book_terms.csv</td><td className="py-2 pr-4 text-right font-mono">83,776</td><td className="py-2">A (book, term) TF-IDF pair</td></tr>
              <tr><td className="py-2 pr-4 font-mono text-xs">review-queue.csv</td><td className="py-2 pr-4 text-right font-mono">1,861</td><td className="py-2">A page flagged by two or more quality signals</td></tr>
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-3 mb-6">
          <a href="/data/corpus/books.csv" download
             className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-warm border border-border-light text-sm text-secondary hover:text-primary transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            books.csv <span className="text-muted font-mono text-xs">2,135 rows &middot; 1.5&nbsp;MB</span>
          </a>
          <a href="/data/corpus/pages-sample.csv" download
             className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-warm border border-border-light text-sm text-secondary hover:text-primary transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            pages-sample.csv <span className="text-muted font-mono text-xs">18,301 rows &middot; 2.3&nbsp;MB</span>
          </a>
        </div>

        <p className="text-muted text-sm leading-relaxed mb-4">
          <span className="text-secondary">books.csv</span> is the complete book table. <span className="text-secondary">pages-sample.csv</span>{' '}
          is one page in forty, spanning every book and length &mdash; the full 779,409-row table is 160&nbsp;MB and
          lives in the repo rather than here. Both are CC0; the underlying scans belong to the libraries credited
          in the <span className="font-mono text-xs">provider</span> column.
        </p>

        <p className="text-muted text-sm leading-relaxed mb-12">
          Scripts:{' '}
          <span className="font-mono text-xs">build-corpus-dataset.mjs</span>,{' '}
          <span className="font-mono text-xs">corpus-dataset-report.mjs</span>,{' '}
          <span className="font-mono text-xs">corpus-signal-audit.mjs</span>,{' '}
          <span className="font-mono text-xs">ocr-self-agreement.mjs</span>,{' '}
          <span className="font-mono text-xs">ocr-quality-screen.mjs</span> &mdash; all under{' '}
          <span className="font-mono text-xs">scripts/eval/</span>.
        </p>


        {/* --- EXPLORING THE CORPUS --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What the corpus looks like
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Before any of the quality questions, the tables describe the collection itself. These 2,135 books are the
          ones our pipeline happened to re-read, so they are not a random sample of the library &mdash; but they are
          a large and reasonably varied slice of it, and the shape is worth seeing.
        </p>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="border border-border-light rounded-xl overflow-hidden">
            <div className="bg-warm px-4 py-2 border-b border-border-light">
              <span className="text-xs font-mono uppercase tracking-wider text-muted">By century</span>
            </div>
            <div className="px-4 py-3 font-mono text-xs text-secondary leading-relaxed">
              <div>1400s &nbsp;103 &nbsp;<span className="text-accent-rust">████</span></div>
              <div>1500s &nbsp;491 &nbsp;<span className="text-accent-rust">████████████████████</span></div>
              <div>1600s &nbsp;466 &nbsp;<span className="text-accent-rust">███████████████████</span></div>
              <div>1700s &nbsp;517 &nbsp;<span className="text-accent-rust">█████████████████████</span></div>
              <div>1800s &nbsp;319 &nbsp;<span className="text-accent-rust">█████████████</span></div>
              <div>1900s &nbsp;181 &nbsp;<span className="text-accent-rust">███████</span></div>
            </div>
          </div>
          <div className="border border-border-light rounded-xl overflow-hidden">
            <div className="bg-warm px-4 py-2 border-b border-border-light">
              <span className="text-xs font-mono uppercase tracking-wider text-muted">By language</span>
            </div>
            <div className="px-4 py-3 font-mono text-xs text-secondary leading-relaxed">
              <div>Latin &nbsp;&nbsp;&nbsp;823</div>
              <div>German &nbsp;&nbsp;456</div>
              <div>English &nbsp;298</div>
              <div>French &nbsp;&nbsp;105</div>
              <div>Tibetan &nbsp;&nbsp;91</div>
              <div>Greek &nbsp;&nbsp;&nbsp;&nbsp;65</div>
              <div className="text-muted">+ Chinese, Italian, Sanskrit, Arabic, Hebrew&hellip;</div>
            </div>
          </div>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          A median book is <strong>240 pages</strong>; the longest is 4,198. Half were printed between{' '}
          <strong>1529 and 1893</strong>, with the median at 1688. The scans come mostly from the Bibliotheca
          Philosophica Hermetica (662 books), the Internet Archive (548) and e-rara (405).
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">How much text is on a page?</h3>

        <p className="text-secondary leading-relaxed mb-4">
          Across 732,037 transcribed pages the median is <strong>272 words</strong>. But the figure moves with the
          language, and here the numbers need a warning before they are read:
        </p>

        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light">
                <th className="text-left py-2 pr-4 font-mono text-xs uppercase tracking-wider text-muted font-medium">Language</th>
                <th className="text-right py-2 pr-4 font-mono text-xs uppercase tracking-wider text-muted font-medium">Median words/page</th>
                <th className="text-right py-2 font-mono text-xs uppercase tracking-wider text-muted font-medium">Pages measured</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Hebrew</td><td className="py-2 pr-4 text-right font-mono">393</td><td className="py-2 text-right font-mono text-muted">9,291</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">English</td><td className="py-2 pr-4 text-right font-mono">332</td><td className="py-2 text-right font-mono text-muted">91,892</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Latin</td><td className="py-2 pr-4 text-right font-mono">303</td><td className="py-2 text-right font-mono text-muted">271,959</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Greek</td><td className="py-2 pr-4 text-right font-mono">288</td><td className="py-2 text-right font-mono text-muted">38,044</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">German</td><td className="py-2 pr-4 text-right font-mono">252</td><td className="py-2 text-right font-mono text-muted">146,802</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">French</td><td className="py-2 pr-4 text-right font-mono">238</td><td className="py-2 text-right font-mono text-muted">40,638</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4 text-muted">Tibetan <span className="text-xs">&dagger;</span></td><td className="py-2 pr-4 text-right font-mono text-muted">203</td><td className="py-2 text-right font-mono text-muted">21,864</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4 text-muted">Sanskrit <span className="text-xs">&dagger;</span></td><td className="py-2 pr-4 text-right font-mono text-muted">111</td><td className="py-2 text-right font-mono text-muted">19,399</td></tr>
              <tr><td className="py-2 pr-4 text-muted">Chinese <span className="text-xs">&dagger;</span></td><td className="py-2 pr-4 text-right font-mono text-muted">68</td><td className="py-2 text-right font-mono text-muted">8,804</td></tr>
            </tbody>
          </table>
        </div>

        <div className="bg-warm border border-border-light rounded-xl p-6 mb-8">
          <p className="text-xs font-mono uppercase tracking-wider text-muted mb-3">&dagger; Do not compare the last three</p>
          <p className="text-secondary leading-relaxed">
            A &ldquo;word&rdquo; here is a run of letters between spaces. Chinese does not put spaces between words,
            so a densely printed Chinese page counts as 68 of them &mdash; that is a fact about the tokenizer, not
            about the page. Tibetan and Sanskrit are distorted the same way. The honest reading is that these three
            rows are <em>not measured</em> rather than low, which is exactly the kind of silent artefact the rest of
            this note is about.
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-12">
          By century the figure is flatter than you might expect &mdash; 272 in the 1500s, 274 in the 1600s, 254 in
          the 1700s, 287 in the 1900s. Page size, type size and margins changed enormously over those four hundred
          years, and the amount of text on a page barely moved.
        </p>

        {/* --- WALKTHROUGH --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          How we got there
        </h2>

        <h3 className="text-xl text-primary mt-10 mb-4">First question: is the pile even usable?</h3>

        <p className="text-secondary leading-relaxed mb-6">
          Before measuring quality we had to ask what the revisions actually record. They are not a sample of
          &ldquo;the same page read twice&rdquo;. They are a log of every time stored text was overwritten, and the
          largest single contributor turned out to be an <em>administrative event</em>: a repair that shifted every
          page&rsquo;s text one position to fix a scanning off-by-one. On those 56,413 rows the two sides are
          neighbouring pages, so they disagree completely and tell you nothing about reading.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          It was labelled. A <span className="font-mono text-sm">source</span> column had said so all along.
          Filtering on it leaves <strong>131,965 pairs, 69% of the corpus</strong>, where both sides plausibly read
          the same image. There is a real caveat: the check that confirms two passes saw the same leaf relies on
          the printed page number the model transcribes off the page, and that is legible on both sides of only
          half the pairs. So 4.2% is a floor on image churn, not a measurement of it.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">Second question: what does re-reading change?</h3>

        <p className="text-secondary leading-relaxed mb-6">
          Mostly nothing. <strong>38% of pages come back with exactly the same word count</strong>, and 71% land
          within ten words. The median change is zero. The distribution is nearly symmetric &mdash; 32% shorter,
          29% longer.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          But the mean is <strong>+11.3 against a median of 0</strong>, and the extremes run from &minus;24,442 to
          +7,974 words on a single page. That gap is the whole story. A page that loses 24,000 words is not OCR
          failing; it is a repetition loop being <em>replaced</em> by a real transcription. The tails hold both the
          repairs and the damage, which is why direction alone tells you nothing.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">Third question: which disagreements matter?</h3>

        <p className="text-secondary leading-relaxed mb-6">
          We built ten candidate signals &mdash; page emptied, script changed, vocabulary collapsed, length moved
          &mdash; and scored each against a definition of &ldquo;broken&rdquo;. The ranking looked excellent. Then we
          scored the same signals against a <em>different</em> definition, one that shared no machinery with them,
          and the ranking reordered completely. The strongest signal on the first scoring fell to nothing on the
          second: it had been predicting its own definition.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          That is the moment the project changed shape. The question stopped being &ldquo;how good is our
          OCR&rdquo; and became <em>&ldquo;how would we know?&rdquo;</em>
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">Then we opened the queue, and were wrong again</h3>

        <p className="text-secondary leading-relaxed mb-6">
          The surviving signals produced a review queue of 220 pages. At the top sat Hooke&rsquo;s{' '}
          <em>Micrographia</em> with 36 flagged pages &mdash; pages that had held 500 words of text and now held
          none. It looked like catastrophic loss.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Reading the two texts against each other said otherwise. The &ldquo;before&rdquo; text was a Greek and
          Latin page from Mersenne&rsquo;s <em>Harmonicorum Libri</em>, a music-theory book &mdash; another
          book&rsquo;s page entirely, left behind by an old archiving fault. The &ldquo;after&rdquo; text correctly
          described Micrographia&rsquo;s engraved plate of a gnat. The re-OCR had <em>repaired</em> the page. Our
          best detector was firing on the fix.
        </p>

        <div className="bg-warm border border-border-light rounded-xl p-6 mb-8">
          <p className="text-xs font-mono uppercase tracking-wider text-muted mb-3">Why that keeps happening</p>
          <p className="text-secondary leading-relaxed">
            The signals concentrate where the instrument that could adjudicate them cannot run. The
            printed-page-number test abstains on half the corpus &mdash; but on <strong>97%</strong> of that review
            queue, because a page that has become an illustration plate has no printed number to compare. The
            failures cluster precisely in the blind spot.
          </p>
        </div>

        {/* --- WHY IT FAILS --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Why OCR fails where it does
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Tibetan had the worst numbers in the corpus, so we chased the cause through three explanations and
          discarded all of them.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>&ldquo;It&rsquo;s the cheap model.&rdquo;</strong> We tested the flagship. It fails too &mdash;
          three model tiers reading one page agreed with each other between 2% and 15%.{' '}
          <strong>&ldquo;It&rsquo;s non-Latin script.&rdquo;</strong> Arabic and Sanskrit are the <em>best</em>{' '}
          performers in the corpus. <strong>&ldquo;It&rsquo;s handwriting.&rdquo;</strong> Rashi script is a printed
          typeface, and it fails.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The explanation that survives is the one our own{' '}
          <a href="/blog/rashi-ocr" className="text-accent-rust hover:underline">earlier note on Rashi</a> proposed:
          the model knows the <em>language</em> and not the <em>letterforms</em>. Rashi maps to the same Unicode as
          square Hebrew, so the model has enough Hebrew to write fluently and not enough Rashi to read &mdash; and
          nothing in its output marks the difference.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          What makes that more than a story is that the split appears <em>within one language</em>, holding model,
          prompt and settings constant:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light">
                <th className="text-left py-2 pr-4 font-mono text-xs uppercase tracking-wider text-muted font-medium">Hebrew book</th>
                <th className="text-right py-2 pr-4 font-mono text-xs uppercase tracking-wider text-muted font-medium">Agreement</th>
                <th className="text-left py-2 font-mono text-xs uppercase tracking-wider text-muted font-medium">What is on the page</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Samaritan Pentateuch</td><td className="py-2 pr-4 text-right font-mono">98%</td><td className="py-2">printed, square type</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Chamisha chumshe Torah</td><td className="py-2 pr-4 text-right font-mono">96%</td><td className="py-2">printed, square type</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Sefer ha-bahir</td><td className="py-2 pr-4 text-right font-mono">68%</td><td className="py-2">&mdash;</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4"><em>Mikraot Gedolot</em>, Venice 1517</td><td className="py-2 pr-4 text-right font-mono">28%</td><td className="py-2">square type <strong>plus Rashi commentary</strong></td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4">Codex Vaticanus Hebr. 14</td><td className="py-2 pr-4 text-right font-mono">20%</td><td className="py-2">manuscript</td></tr>
              <tr className="border-b border-border-light"><td className="py-2 pr-4"><a href="https://sourcelibrary.org/book/essence-of-pomegranates-gallico" className="text-accent-rust hover:underline">Asis rimonim</a></td><td className="py-2 pr-4 text-right font-mono">9%</td><td className="py-2">cursive manuscript</td></tr>
              <tr><td className="py-2 pr-4">Zohar &middot; Betser ba-Midbar</td><td className="py-2 pr-4 text-right font-mono">0%</td><td className="py-2">produced almost nothing</td></tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-12">
          <em>Mikraot Gedolot</em> is the tell. It is a Bible, so a language-based account puts it with the other
          Bibles at 96%. Its classic layout surrounds the scriptural text with commentary set in Rashi type, and it
          scores 28%. A mixed page returns a mixed score.
        </p>

        {/* --- WHAT WE GOT WRONG --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Five things we got wrong first
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Every one produced a confident, plausible answer that survived until something outside its own
          assumptions contradicted it.
        </p>

        <div className="space-y-4 mb-8">
          <div className="border-l-2 border-border-light pl-5">
            <p className="text-primary font-medium mb-1">The wrong similarity metric</p>
            <p className="text-secondary leading-relaxed">
              Jaccard divides by the union, so it collapses when one model simply transcribes further down the page
              than the other. It labelled German OCR &ldquo;not reading&rdquo; at 31% when the real overlap was 93%
              &mdash; the two texts differed by <span className="font-mono text-sm">Salz</span> versus{' '}
              <span className="font-mono text-sm">Saltz</span>.
            </p>
          </div>
          <div className="border-l-2 border-border-light pl-5">
            <p className="text-primary font-medium mb-1">A tokenizer that deleted a script</p>
            <p className="text-secondary leading-relaxed">
              Splitting on whitespace collapses a Chinese page into one enormous token, so every Chinese page was
              discarded as &ldquo;too thin to score&rdquo; and the language reported no data at all. Missing data
              that was really a bug &mdash; and the same bug our own earlier code had already solved elsewhere.
            </p>
          </div>
          <div className="border-l-2 border-border-light pl-5">
            <p className="text-primary font-medium mb-1">Circular scoring</p>
            <p className="text-secondary leading-relaxed">
              &ldquo;Degenerate&rdquo; was <em>defined</em> as low vocabulary variety, so length-based signals were
              predicting their own definition. One signal scored 5.1&times; against that target and 1.1&times;
              &mdash; nothing at all &mdash; against an independent one.
            </p>
          </div>
          <div className="border-l-2 border-border-light pl-5">
            <p className="text-primary font-medium mb-1">A detector that found the opposite of what it claimed</p>
            <p className="text-secondary leading-relaxed">
              The strongest surviving signal fires mostly on <em>repairs</em>. 61 of the 72 pages it flagged in the
              review queue have a perfectly good current transcription.
            </p>
          </div>
          <div className="border-l-2 border-border-light pl-5">
            <p className="text-primary font-medium mb-1">Abstention that is not random</p>
            <p className="text-secondary leading-relaxed">
              An instrument that declines to judge half the corpus is not judging a random half. It abstained on
              97% of the pages our signals flagged.
            </p>
          </div>
        </div>

        <div className="bg-warm border border-border-light rounded-xl p-6 mb-12">
          <p className="text-xs font-mono uppercase tracking-wider text-muted mb-3">The pattern</p>
          <p className="text-secondary leading-relaxed">
            A metric validated only against its own outputs will confirm itself indefinitely. Which is why what we
            actually shipped is a cheap screen and a <strong>separately constructed verifier</strong>, rather than
            one number asked to do both jobs.
          </p>
        </div>

        {/* --- WHAT NOW --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What happens next
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The screen scores every page from text we already hold &mdash; compression ratio catches repetition loops,
          script purity catches a model leaking its own reasoning into a transcription &mdash; at no cost and at any
          scale. It flags; it does not judge.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Judging is a person&rsquo;s job, and the sampling is built so that the person&rsquo;s answer means
          something. Pages are drawn evenly across the whole score range rather than from the worst end, because a
          sample of only-suspect pages can measure how often we are right and never how often we are wrong. The
          reviewer sees no score and no ranking &mdash; a reviewer shown a flag will find something wrong with the
          page. Known-good pages are mixed in: if those come back marked bad, the review is miscalibrated rather
          than the corpus.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          There is one thing none of this supplies. Deciding whether a Hebrew or Tibetan transcription is right
          needs somebody who reads Hebrew or Tibetan. Every number in this note is a proxy standing in for that
          judgement, and two of the proxies have already been caught pointing the wrong way.{' '}
          <Link href="/contribute/volunteer" className="text-accent-rust hover:underline">If you read either, we would like to hear from you.</Link>
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          One practical decision falls out of it immediately: we are not bulk re-running OCR on Tibetan and CJK
          material on the current models. It would replace detectable damage &mdash; loops, which a metric catches
          &mdash; with undetectable damage, which reads beautifully and is not there.
        </p>

        <p className="text-muted text-sm leading-relaxed mt-12 pt-6 border-t border-border-light">
          Figures measured 2&ndash;6 August 2026 against the live corpus and reproducible from the files above.
          Where a number is a floor or a proxy rather than a measurement, the text says so.
        </p>

      </article>
    </ContentPageLayout>
  );
}
