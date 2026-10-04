import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

// Sources of the figures here: OCR error rates from the #5660 bake-offs (comments of
// 2026-10-03, PR #5684 and #5750); translation fidelity from the corpus audit
// (scripts/eval/experiments/2026-09-30-translation-corpus-audit-…-5274.md) and the Suda
// gold sample (#3884); the August Greek tune from #4320. If a number is not in one of
// those, it does not belong here.

const HERO = 'https://images.sourcelibrary.org/archived/69a99ce86c7545e2236e12de/100.jpg';
const HERO_ALT =
  'Page 88 of Bekker’s 1854 edition of the Suda, the Byzantine lexicon: two columns of polytonic Greek, the entries from Ἀναγυράσιος δαίμων to ἀναδρομαί.';

const TITLE = 'Should a library train its own AI models?';
const DESCRIPTION =
  'Gemini reads and translates almost every page in this library. We have measured how good that work is, slice by slice. Where it is good, it can train a smaller open model of our own; where it is weak, we need human-made text to do better. What we have tried, what it would save, and who else is doing this.';

export const metadata: Metadata = {
  title: `${TITLE} - Research Notes - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description:
      'Where training our own models pays, where it does not, and what it would cost. Measured on our own pages.',
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/blog/training-our-own-models' },
};

const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';
const TH = 'text-left font-medium text-primary py-2 pr-4 border-b border-border-light';
const TD = 'py-2 pr-4 align-top border-b border-border-light text-secondary';
const A = 'text-accent-rust hover:underline';

const ISSUE = (n: number) => `https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/${n}`;
const SUDA_BOOK = 'https://sourcelibrary.org/book/suidae-lexicon-suidas';
const SUDA_PAGE = 'https://sourcelibrary.org/book/suidae-lexicon-suidas?page=100';

function Issue({ n }: { n: number }) {
  return (
    <a href={ISSUE(n)} className={A}>
      #{n}
    </a>
  );
}

export default function TrainingOurOwnModelsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title={TITLE}
          subtitle="Our pages are good training data where we have measured them to be good. Reading the scripts Gemini gets wrong needs human-made text. Our first open translation model, trained on 18,600 Latin pages, is cheap to run but not yet good enough."
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">4 October 2026 &middot; 10 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link href="/blog" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Almost every page in this library was read and translated by one commercial model, Google’s
          Gemini. That gives us about 6.9 million transcribed pages and 5.2 million translated ones. Can
          we use them to train smaller, open models of our own, which we could run on our own computer,
          publish, and hand to other libraries? Our answer, after measuring: yes for some of the work,
          not yet for the rest. Where our evaluations show the text is good, it is usable training data.
          Where Gemini reads badly, as in early Greek print, copying Gemini cannot do better than Gemini,
          and we need text that people made. Our first open translation model, trained on our Latin
          pages, failed its test: it would cost very little to run, but it is clearly less faithful than
          Gemini.
        </p>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>Two ideas in one sentence each</h2>
          <p className={P}>
            <strong>Distillation</strong> means training a small “student” model to copy the output of a
            large “teacher”; the student is cheaper to run, and at best it is as good as the teacher.{' '}
            <strong>LoRA</strong> (low-rank adaptation) is a cheap way to do that training: instead of
            changing the whole model, it trains a small add-on layer on top of an existing open model, in
            hours rather than weeks.
          </p>
          <p className={P}>
            One distinction decides most of what follows. Training a student on the teacher’s text is
            ordinary practice; the open OCR model olmOCR and Google’s TranslateGemma were both built
            partly that way. Grading the student only against the teacher’s text is circular: it measures
            how well the student imitates, not whether either is right. For grading we need an
            independent reference, a transcription or translation that a person made.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>How good is the text we have?</h2>
          <p className={P}>
            We do not have to guess. Over the past month we scored Gemini’s readings against published
            transcriptions of the same pages, one page per book, with the test pages sealed before any
            engine read them (the method is in{' '}
            <Link href="/blog/how-we-measure-ocr-quality" className={A}>How We Measure OCR Quality</Link>
            ). The measure is character error rate: the share of letters that differ from the reference.
          </p>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm font-body">
              <thead>
                <tr>
                  <th className={TH}>Printed pages</th>
                  <th className={TH}>Character error</th>
                  <th className={TH}>Pages scored</th>
                  <th className={TH}>Usable for training?</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className={TD}>German (mostly Fraktur)</td><td className={TD}>0.5%</td><td className={TD}>29</td><td className={TD}>Yes</td></tr>
                <tr><td className={TD}>Latin, 1700 and later</td><td className={TD}>0.7%</td><td className={TD}>39</td><td className={TD}>Yes</td></tr>
                <tr><td className={TD}>English, 1700 and later</td><td className={TD}>2.2%</td><td className={TD}>106</td><td className={TD}>Yes</td></tr>
                <tr><td className={TD}>English, 1600–1699</td><td className={TD}>5.3%</td><td className={TD}>59</td><td className={TD}>With care: the long s (ſ) is often read as f</td></tr>
                <tr><td className={TD}>Latin, 1500–1699</td><td className={TD}>6.7%</td><td className={TD}>36</td><td className={TD}>With care, for the same reason</td></tr>
                <tr><td className={TD}>Greek</td><td className={TD}>14.5%</td><td className={TD}>114</td><td className={TD}>No</td></tr>
              </tbody>
            </table>
          </div>
          <p className={P}>
            Source: the open-engine comparison in <Issue n={5660} />. Most cells hold fewer than fifty
            books, which we treat as directional rather than decisive.
          </p>
          <p className={P}>
            Translations were measured two ways. In an audit of 311 served pages, one per book across 15
            languages, a separate judge model (Claude, a different family from the translator) checked
            each English page against its source, and we read 20 of them ourselves. 87 to 89 percent were
            rated faithful (4 or 5 on a 5-point scale), and 11 to 14 percent carried at least one major
            defect (<Issue n={5274} />). Latin-script languages did best: 93 percent faithful. Greek was
            at 75 percent, Sanskrit and Tibetan lower still. The second measure has a human reference:
            for the Suda, the Byzantine lexicon on the page above, scholars at the Suda On Line have
            translated some 31,000 entries. On 150 entries drawn at random, 77 percent of ours were
            faithful to the Greek, 21 percent had minor issues and 2 percent major errors (
            <Issue n={3884} />;{' '}
            <a href={SUDA_PAGE} className={A}>our scan, p. 88</a> of{' '}
            <a href={SUDA_BOOK} className={A}>Bekker’s edition</a>).
          </p>
          <p className={P}>
            So the text is good training data on the slices where it measures well, and that is most of
            the Latin, German and English. It cannot teach a model to read what Gemini misreads, and it
            cannot grade itself. Human corrections in our own pages are still very few, a few dozen. The
            human-made texts we lean on are published ones: proofread Wikisource pages, EEBO-TCP
            keyings, the Kanripo Chinese canon, the 84000 Tibetan translations, the Suda On Line.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What we have already tried</h2>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm font-body">
              <thead>
                <tr>
                  <th className={TH}>When</th>
                  <th className={TH}>What</th>
                  <th className={TH}>Result</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className={TD}>Oct 2026</td><td className={TD}>An open translation model trained on our Latin pages (<Issue n={5793} />)</td><td className={TD}>Failed the preset bar: against published human translations of 71 pages it scored 3.32 of 5, Gemini 4.16. Training helped (the untrained model scored 2.75), but it often reverses the sense of a clause</td></tr>
                <tr><td className={TD}>Oct 2026</td><td className={TD}>Kraken, an open line-by-line reader, fine-tuned on Latin print of 1500–1699 (<Issue n={5730} />)</td><td className={TD}>Running</td></tr>
                <tr><td className={TD}>Oct 2026</td><td className={TD}>Open page-reading models against Gemini on the same 632 pages (<Issue n={5660} />)</td><td className={TD}>olmOCR wins only on English of 1600–1699 (3.6% vs 5.3%), where it reads the long s correctly; on Greek every open model failed badly (48–51% error)</td></tr>
                <tr><td className={TD}>Aug 2026</td><td className={TD}>A Gemini model tuned on 15,332 of our Greek translations, for $42 (<Issue n={4320} />)</td><td className={TD}>Preferred on 158 of 200 test pages, but graded against our own translations, so the test was circular. It also learned to copy our editorial notes into its output</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Where training pays</h2>
          <ol className="list-decimal pl-6 space-y-4 mb-6 text-secondary font-body leading-relaxed">
            <li>
              <strong>Reading the scripts Gemini gets wrong.</strong> We hold 2.2 million pages of Greek
              in 5,014 books, and about 340,000 of them have not been read yet. Gemini misreads about one
              Greek character in seven on our early printed pages. There is published ground truth for
              Greek print: line transcriptions of the Patrologia Graeca, released on{' '}
              <a href="https://zenodo.org/records/7296539" className={A}>Zenodo</a>, and a reported
              fine-tune of the open Qwen3-VL-8B model at about 1 percent error. We have not yet tested it
              ourselves (<Issue n={4744} />). The same pattern holds for Syriac, Tibetan, Persian and the
              Chinese imperial library, each with a published text to align against.
            </li>
            <li>
              <strong>Page checkers.</strong> Small models that sort pages: is this a plate or text,
              which language and script, is the reading garbled or looping, is the image the right leaf?
              Here Gemini’s own labels are acceptable training data, because the checker only sorts and a
              set of pages we read by eye tests it. Run on our own GPU, such a checker costs almost
              nothing per page, where asking Gemini about every one of 10 million pages would cost tens
              of thousands of dollars.
            </li>
            <li>
              <strong>Translation, as a test.</strong> Because 93 percent of our Latin-script
              translations measure as faithful, a student trained on the good ones might match Gemini at
              a fraction of the price. We tested that on 4 October (<Issue n={5793} />): Qwen3-8B, an
              open model of 8 billion parameters, trained with LoRA on 18,587 filtered Latin pages, then
              judged blind against published human translations beside Gemini’s, on 71 pages from books
              it never saw. The bar, set before training, was “no worse than Gemini”. It scored 3.32 of 5
              to Gemini’s 4.16 and lost on 54 of the 71 pages. Its typical error is fluent English that
              reverses the Latin: “not counted among” for <em>numerantur</em>, “the learned” for{' '}
              <em>indocti</em>. Cost is not the obstacle: on our own GPU it would translate for about
              €0.15 per thousand pages. Quality is. A larger model, cleaner data, or training
              against human translations are the next levers; we will not retrain a model on its own
              output, because errors compound that way.
            </li>
            <li>
              <strong>Search across languages.</strong> Our semantic search only finds translated books.
              Open multilingual models can index the Latin, Greek and Chinese directly; we are testing
              ready-made ones before training anything (<Issue n={5729} />).
            </li>
          </ol>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What it costs, and what it saves</h2>
          <p className={P}>
            Gemini Flash-Lite reads a page for about $0.45 per thousand in batch mode and translates one
            for $0.60 to $1.70 per thousand. An open model of olmOCR’s size, on the GPU server we are
            setting up, reads for about $0.26 per thousand. Each training run costs $10 to $60 of rented
            GPU time.
          </p>
          <p className={P}>
            The sums are modest. The 10.5 million pages still waiting to be read would cost Gemini about
            $4,700 in batch mode; open models would save part of that only where they read at least as
            well, which so far is one cell. Translating the backlog on our own machine could have saved
            $6,000 to $17,000 once, but our first open translation model is not good enough yet. The
            larger gain is reach.
            Some 24,500 Latin books we hold are not yet public because nobody has read them; with our own
            models, reading them becomes a matter of machine time rather than a budget decision.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Who else is doing this</h2>
          <p className={P}>
            Many projects train models on historical texts. Each covers one tradition or one task. We
            have not found another that holds the page image, the transcription and an English
            translation, aligned page by page, across Latin, Greek, Hebrew, Arabic, Syriac, Tibetan,
            Chinese and the European vernaculars.
          </p>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm font-body">
              <thead>
                <tr>
                  <th className={TH}>Project</th>
                  <th className={TH}>What they train or publish</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className={TD}><a href="https://arxiv.org/pdf/2601.06400v1" className={A}>Dharmamitra (MITRA)</a></td><td className={TD}>Open translation models from Sanskrit, Tibetan and Classical Chinese into English, trained on 1.74 million mined parallel sentences</td></tr>
                <tr><td className={TD}><a href="https://www.bdrc.io/?p=12490" className={A}>Buddhist Digital Resource Center</a></td><td className={TD}>An open Tibetan OCR app, and open Buddhist datasets for AI drawn from over 30 million scanned pages</td></tr>
                <tr><td className={TD}><a href="https://www.bdrc.io/?p=10237" className={A}>Monlam AI</a></td><td className={TD}>Tibetan OCR, translation and speech models</td></tr>
                <tr><td className={TD}><a href="https://arxiv.org/pdf/2506.01732" className={A}>Pleias, Common Corpus</a></td><td className={TD}>An open corpus of public-domain text, a model that corrects bad OCR (<a href="https://huggingface.co/PleIAs/OCRonos" className={A}>OCRonos</a>) and one that flags OCR errors word by word (<a href="https://huggingface.co/PleIAs/OCRerrcr" className={A}>OCRerrcr</a>)</td></tr>
                <tr><td className={TD}><a href="https://allenai.org/blog/olmocr-2" className={A}>Allen Institute, olmOCR</a></td><td className={TD}>An open page-reading model, with its training code</td></tr>
                <tr><td className={TD}><a href="https://zenodo.org/records/10066219" className={A}>CATMuS</a></td><td className={TD}>Open Kraken models for medieval and early-modern hands</td></tr>
                <tr><td className={TD}><a href="https://www.maginative.com/article/harvard-releases-massive-public-domain-dataset-for-ai-training/" className={A}>Harvard Institutional Books</a></td><td className={TD}>983,004 public-domain volumes released as an open dataset</td></tr>
                <tr><td className={TD}><a href="https://transkribus.org/ai-text-recognition" className={A}>Transkribus</a></td><td className={TD}>A paid platform with over 500 handwriting and print models, many trained by its users</td></tr>
                <tr><td className={TD}><a href="https://en.wikipedia.org/wiki/Dicta_(organization)" className={A}>Dicta</a></td><td className={TD}>Language models for rabbinic Hebrew, trained on the Sefaria and Dicta libraries</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What we will publish</h2>
          <p className={P}>
            Whatever we train that works will be released openly with a DOI: line readers to the shared
            Zenodo and HTR-United collections, larger models and the page-aligned image, transcription and
            translation set to Hugging Face, each with a note saying where it fails. Some published
            references carry share-alike licences, and we will check each before release. If you hold a
            transcription or translation of a text we have scanned, or would like to test a model against
            our pages, we would like to hear from you.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What this cannot say</h2>
          <p className={P}>
            The OCR cells are small, and the translation audit used a model as judge, checked by our own
            reading of 20 pages but not by a second human. Whether an open model can match Gemini on
            translation is exactly what the running test is for; this note does not assume the answer.
            The savings above are estimates from measured unit prices, not money saved. We will report
            the result on <Issue n={5793} /> whichever way it goes.
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
