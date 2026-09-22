import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

const HERO = 'https://images.sourcelibrary.org/archived/6a3ceccb4701a906f10db3cb/118.jpg';

export const metadata: Metadata = {
  title: 'How We Measure OCR Quality - Research Notes - Source Library',
  description:
    'One page per book, sealed before anyone looks, scored against a published edition, graded by how many referenced books the cell holds. The experimental design behind every engine decision, and what it cannot tell you.',
  openGraph: {
    title: 'How We Measure OCR Quality',
    description:
      'One page per book, sealed before anyone looks, scored against a published edition, graded by how many referenced books the cell holds. The design behind every engine decision.',
    images: [{ url: HERO, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: HERO }],
  },
  alternates: {
    canonical: '/blog/how-we-measure-ocr-quality',
  },
};

const th = 'text-left py-3 pr-6 font-medium';
const thR = 'text-right py-3 pr-6 font-medium';
const td = 'py-3 pr-6 align-top';
const tdR = 'text-right py-3 pr-6 align-top';
const row = 'border-b border-light';

export default function HowWeMeasureOcrQualityPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="How We Measure OCR Quality"
          subtitle="One page per book, a published edition as the reference, and a grade on every cell"
        >
          <p className="text-stone-400 text-sm mt-4">20 September 2026 &middot; 12 min read</p>
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
          Every engine or prompt decision at Source Library is made on a sealed sample of pages, one per book, scored against a published edition of the same text, and graded by how many referenced books the cell holds. Nothing is decided on a cell under fifty. This note explains the design, why each rule exists, and what it still cannot tell you.
        </p>

        {/* --- 1. The question --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The question a second engine cannot answer
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          When we ask whether an OCR engine reads a page well, the honest unit is the page a reader opens: does the text on the screen match the text on the leaf? The temptation is to answer it cheaply by running two engines and calling agreement accuracy. That measure has a hole in the middle. Two engines that share a training corpus share its errors, and a proxy engine can never show you the proxy engine&apos;s own mistakes. On brush-written Chinese, our production engine reads vertical columns as horizontal rows on one page in five; every engine we compared it against on those pages looked better or worse relative to a wrong answer.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          So the design starts from a rule that is expensive to keep: a page counts as evidence only when we hold an independent reference for it, a published edition of the same text aligned to that leaf. Everything else in this note follows from making that rule affordable at scale.
        </p>

        {/* --- 2. The sample --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The sample: one page per book, sealed before anyone looks
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          A book is one observation, not a bag of pages. Pages inside a book share a scribe, a printer, a scan session and a state of wear, so a hundred pages from one volume tell you about one volume. We draw one page per book, and the number that grades a cell is the number of books.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The draw is reproducible. Eligible books are sorted by identifier, shuffled with a seeded generator, and walked in order; the page is drawn uniformly from the interior 10 to 90 percent of the book, skipping covers, plates and blanks. The result is written to a registry file with the seed, the date and the rule, and that file, not the script, is the seal: imports keep adding books, so the same script on a later day would draw differently. Each stratum also draws spares in the same order, so a page every engine finds textless can be replaced by the next book in line rather than by a fresh, unsealed draw, and the replacement is recorded.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          A stratum is a question, not a language. &ldquo;Chinese&rdquo; was one stratum; it became two, manuscript and woodblock, the day we looked at the leaves. Sealed pages are excluded from any training or tuning we do, and a page that an engine was trained on is marked as contamination for that engine.
        </p>

        {/* --- 3. Look at the leaf --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Look at the leaf before scoring
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The catalogue knows the work. It does not know the page. A title dated 1716 can be a modern typeset reprint with reading marks; a &ldquo;Greek&rdquo; book can open to a Latin preface; a &ldquo;Chinese woodblock&rdquo; stratum can turn out to be something else entirely. So every sealed page is classified by eye before any score is computed: the language actually on the leaf, whether it is print or manuscript, and the typeface or hand. Cells are formed from the observed class, never from the draw.
        </p>

        <figure className="my-10">
          <img
            src={HERO}
            alt="A leaf of the Yuhai encyclopaedia in the Siku Quanshu fair copy: regular-script brush writing in ruled columns under the imperial header"
            className="w-full rounded shadow-md"
            loading="lazy"
          />
          <figcaption className="text-sm text-muted mt-3">
            A leaf from the <em>Yuhai</em> in the Siku Quanshu fair copy. Brush-written regular script in ruled columns, under the header 欽定四庫全書. To a model reader it looks like print; it is manuscript, and so are most of the Chinese pages we hold.
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-6">
          The Chinese cell is the cautionary example. It was drawn to test a specialist engine on woodblock print. Classified page by page, 24 of its 40 leaves were Siku Quanshu fair copies, brush-written regular script under the imperial header, 10 were modern typeset Buddhist editions, and 3 were woodblock. That is not a sampling accident. About 11,980 of our 13,117 Chinese books are Siku Quanshu volumes, and the copies also arrive under plain titles, so a second draw filtered to non-Siku titles still came back half manuscript. The engine verdict everyone had been reading as &ldquo;woodblock&rdquo; was a verdict on brush manuscript, which is also the class that holds nearly every Chinese page we serve.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Classification itself needs a second reader. Six model workers labelled 24 pages each; one of them called every Siku leaf woodblock while the others called them manuscript, and 11 of 144 labels were overturned by opening the disputed pages. The by-eye class files are committed beside the registry with who classified what and who arbitrated.
        </p>

        {/* --- 4. References --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          References: a published edition aligned to the page, or no score
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          A reference is a window of a published e-text that prints what this leaf prints. We do not transcribe pages by hand for the benchmark; we find the passage. A probe read of the page, from whichever engine produced the longest text in the right script, is searched against a canon corpus: CBETA for the Buddhist canon, Kanripo for the Chinese classics including the Siku Quanshu witness, Wikisource and Perseus for European print, Beth Mardutho ground truth for Syriac manuscripts, the 84000 translations for Tibetan. The e-text is cut to the densest window of shared four-character sequences around the probe, trimmed to what the page touches, and accepted only if at least 35 percent of the probe&apos;s distinct four-grams appear in it. Below that the page gets no reference and the reason is recorded.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Two rules keep this honest. A window that no engine comes within 50 percent character error of is treated as a different edition and demoted, so a wrong alignment cannot punish every engine equally and hide. And a page enters a cell only when its reference is in hand: there are no proxy-scored top-ups to reach a round number. When a reference builder was widened to search every chapter file of a work instead of the chapter the catalogue named, that change was logged as a deviation with the count it added, 29, under the same acceptance threshold.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Where no e-text exists, the reference is human reading time, roughly twenty minutes a page for a medieval Latin leaf, and the plan budgets it as such rather than pretending a second engine will do.
        </p>

        {/* --- 5. Arms and controls --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Arms and controls
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Every engine reads the identical JPEG, exported once at a maximum width of 2,400 pixels, so a difference in score is a difference in reading, not in pixels. The API engines all receive one fixed instruction, transcribe all visible text and output only the raw text, with model thinking disabled and temperature zero; the production prompt asks for tags and metadata no specialist emits, so it is deliberately not the benchmark prompt. Self-hosted engines run with their published defaults and a per-page timeout, on a leased GPU whose expiry is tagged on the machine so an idle box is stopped by a watchdog rather than by memory.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Each comparison is paired: the same page, engine A against production. That is what lets a modest sample say something, because page difficulty is held constant.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          A control arm answers the question the others cannot: how much would the production engine differ from itself? We ran it twice and it tied on 63 of 65 pages, so at temperature zero the repeat noise floor is effectively zero and the non-inferiority margin stands on its own. Had the floor been wider than the margin, the rule says the cell decides nothing.
        </p>

        {/* --- 6. Metrics --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What we measure on each page
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Four numbers, because one hides the failures that matter to a reader.
        </p>

        <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-3">
          <li><strong>Character error rate</strong> against the reference window, after folding script variants the reference and the engine spell differently (traditional and simplified forms, Japanese old and new character shapes). This is the headline number and the one the paired test runs on.</li>
          <li><strong>Catastrophic pages</strong>, error rate above 50 percent. A median can look fine while one page in five is unusable; the count is reported separately.</li>
          <li><strong>Invention</strong>, the share of an engine&apos;s content tokens that appear in neither the reference nor any other engine&apos;s output for that page. This is the fluent-but-false failure: a model that produces plausible scripture the leaf does not contain. It is the one that survives every agreement metric.</li>
          <li><strong>Loops</strong>, repeated runs of text that signal the model has stopped reading and started generating.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6">
          Reading order gets its own check, the gap between bag-of-words overlap and in-sequence overlap: column splicing keeps the words and destroys the order, a misread shrinks both together. On Chinese manuscript this is the single largest failure of the production engine.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Every cell reports a bootstrap interval on the median, an exact sign test on the paired wins and losses, and a confidence interval on each rate. The five worst pages per engine are listed with a 300-character excerpt beside the reference so a person can read what the number means.
        </p>

        {/* --- 7. Grades --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Evidence grades, and why the line is at fifty
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Every cell on the dashboard carries a grade fixed before any run, and the grade is the deliverable.
        </p>

        <div className="overflow-x-auto my-8">
          <table className="min-w-full text-secondary">
            <thead>
              <tr className={row}>
                <th className={th}>Grade</th>
                <th className={th}>Referenced books in the cell</th>
                <th className={th}>What it may support</th>
              </tr>
            </thead>
            <tbody>
              <tr className={row}>
                <td className={td}>Exploratory</td>
                <td className={td}>Under 30, or no reference (proxy-scored)</td>
                <td className={td}>An anecdote with an interval; a reason to draw more</td>
              </tr>
              <tr className={row}>
                <td className={td}>Directional</td>
                <td className={td}>30 to 49</td>
                <td className={td}>A working assumption, flagged as such</td>
              </tr>
              <tr className={row}>
                <td className={td}>Decision-grade</td>
                <td className={td}>50 or more, and 50 untied pairs for a paired claim</td>
                <td className={td}>A routing or spending decision</td>
              </tr>
              <tr className={row}>
                <td className={td}>Rate (loop, catastrophic)</td>
                <td className={td}>150 or more pages</td>
                <td className={td}>A rate quoted to plus or minus 5 points</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Fifty is where a paired sign test can detect a 70/30 split at 80 percent power and a bootstrap interval on a median stops being decoration. It is deliberately a count of referenced books, not of pages run: more proxy-scored pages buy nothing, because a proxy cannot show its own errors. When the grades were first computed on 18 September, 283 of 296 cells were exploratory, and the only decision-grade evidence we held sat on nineteenth-century print, the easiest reading in the collection, while every pending decision was on the hardest. The plan that followed orders cells by the cost of their references, cheapest first.
        </p>

        {/* --- 8. Preregistration --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Preregistration: the rule is written before the run
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Before any engine reads a sealed page, a preregistration file in the repository fixes the question, the sample, the reference sources, the arms, the metrics and the decision rule. Deviations are allowed, but they are reported as deviations with what they changed, never folded in silently.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Two rules have earned their keep. The <strong>better reader</strong> rule, for adopting a specialist over the production engine: the specialist must beat production by at least 5 points of error rate on at least 60 percent of pages, with no rise in invention. The <strong>cost lane</strong> rule, for a cheaper engine that only has to be no worse: median paired difference no more than 2 points against it, the upper bound of its interval no more than 5, no more than one extra catastrophic page, invention and loops not higher, and the repeat-noise floor narrower than the margin. A cell under 50 referenced pages is reported directional and decides nothing, and the shortfall is a draw-more item, never a top-up.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          A run also has a spend line attached. Each step posts its estimate on the tracking issue and waits for a yes, and a leased GPU is tagged with its expiry before it boots.
        </p>

        {/* --- 9. Worked example --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Worked example: the Chinese cost lane
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The question was whether a self-hosted engine, PaddleOCR-VL-1.6, could carry Chinese pages in place of the cloud production engine at lower cost. The first cell, 40 pages with 28 references, was exploratory, and by eye it was mostly manuscript. On 18 September a second draw added 80 pages in two classes, each drawn only from books a canon e-text could reference. References were built from Kanripo and CBETA; the Siku manuscript class reached 69 referenced books, decision-grade. The woodblock class reached 14 and stays exploratory, because the collection does not hold 50 canon-referenceable woodblock books at one page each.
        </p>

        <div className="overflow-x-auto my-8">
          <table className="min-w-full text-secondary">
            <thead>
              <tr className={row}>
                <th className={th}>Siku manuscript, 69 referenced pages</th>
                <th className={thR}>Paddle vs production</th>
              </tr>
            </thead>
            <tbody>
              <tr className={row}>
                <td className={td}>Median paired difference in character error rate</td>
                <td className={tdR}>2.8 points better (interval 1.4 to 3.6)</td>
              </tr>
              <tr className={row}>
                <td className={td}>Pages won / lost / tied</td>
                <td className={tdR}>57 / 10 / 2</td>
              </tr>
              <tr className={row}>
                <td className={td}>Catastrophic pages (error above 50%)</td>
                <td className={tdR}>0 vs 14</td>
              </tr>
              <tr className={row}>
                <td className={td}>Median invention</td>
                <td className={tdR}>0.13 vs 0.20</td>
              </tr>
              <tr className={row}>
                <td className={td}>Pages meeting the 5-point &ldquo;better reader&rdquo; bar</td>
                <td className={tdR}>38%, below the 60% required</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Verdict, applied from the preregistered rule: Paddle passes as a cost lane for Siku manuscript and fails as the better reader. The 14 catastrophic pages on the production side are one failure read by eye, vertical columns transcribed as horizontal rows, and that failure is what the cheaper engine does not have. The run cost 35 cents of API calls and 44 minutes of a leased GPU, about 55 cents. The sizing of a lane over the two million pages this class covers is the next, separate decision.
        </p>

        {/* --- 10. Limits --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What the design cannot tell you
        </h2>

        <ul className="list-disc pl-6 text-secondary leading-relaxed mb-8 space-y-3">
          <li><strong>Whether an engine has memorised the canon.</strong> CBETA, Kanripo and Wikisource are public; a model may have read them. Invention rate catches part of this, and the five worst and five best pages are read by a person, but a page recited from memory that happens to match the leaf scores as a correct read.</li>
          <li><strong>Quality by prompt.</strong> Every benchmark arm uses one fixed instruction, so the table has no prompt axis yet, and the production prompt has never been an arm. Production pages do record their prompt version, in three vocabularies from three writers, so the join is possible once those are normalised.</li>
          <li><strong>Within-book variation.</strong> One page per book is the right unit for comparing engines across a collection and the wrong one for saying how a particular volume reads.</li>
          <li><strong>Anything at one page per book that the collection cannot supply.</strong> Woodblock Chinese is the standing example: the honest answer is a directional cell and a note, not a top-up.</li>
          <li><strong>The classification of the leaf when only a model has looked.</strong> Model readers confused brush manuscript with carved print on a quarter of the disputed pages; a second, human-checked reading is part of the method, not a luxury.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6">
          The sealed registries, references, by-eye classes, preregistrations and results are in the public repository on{' '}
          <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/tree/main/scripts/eval" className="text-accent-rust hover:underline">GitHub</a>, under the evaluation scripts, and each decision is posted with its table on the issue that asked for it. The evidence table itself is regenerated from the committed result files after every run, with the grade printed on every cell.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Source Library is a project of the{' '}
          <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:underline">Embassy of the Free Mind</a> (Bibliotheca Philosophica Hermetica) in Amsterdam.
        </p>

      </article>

    </ContentPageLayout>
  );
}
