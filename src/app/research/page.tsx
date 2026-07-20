import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { posts } from '@/app/blog/page';

export const revalidate = false;

const OG_TITLE = 'Research at Source Library';
const OG_DESCRIPTION =
  'A working library is also an instrument. The questions we are trying to answer with it: whether machines read historical pages or recite them, what makes a scan readable, how much has never been translated, and what a first translation actually is.';

export const metadata: Metadata = {
  title: 'Research — Source Library',
  description: OG_DESCRIPTION,
  alternates: { canonical: '/research' },
  openGraph: {
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', width: 1200, height: 630, alt: 'Source Library — Digitizing and translating ancient texts' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: ['https://sourcelibrary.org/og-image.jpg'],
  },
};

// Corpus snapshot from system_config.homepage_stats, 19 July 2026.
// Refresh from that document (written daily by prewarm-browse.mjs) when quoting again.
const CORPUS = {
  books: 19_412,
  firstTranslations: 5_841,
  languages: 113,
  illustrations: 206_400,
};

const fmt = (n: number) => n.toLocaleString('en-US');

const bySlug = new Map(posts.map(p => [p.slug, p]));

function Section({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <section className="py-12 border-b border-stone-200">
      <div className="font-body text-xs tracking-[0.16em] uppercase text-amber-700 font-semibold mb-3">{kicker}</div>
      <h2 className="font-serif text-2xl md:text-3xl text-stone-900 mb-4 tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ n, unit, label }: { n: string; unit?: string; label: string }) {
  return (
    <div className="px-5 py-6 border-stone-200 [&:not(:last-child)]:border-r max-sm:[&:nth-child(odd)]:border-r max-sm:[&:nth-child(-n+2)]:border-b">
      <div className="font-serif text-3xl md:text-4xl text-stone-900 tracking-tight">
        {n}{unit && <span className="text-amber-800 text-2xl">{unit}</span>}
      </div>
      <div className="font-body text-sm text-stone-500 mt-1.5 leading-snug">{label}</div>
    </div>
  );
}

function Open({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 bg-stone-50 border-l-2 border-amber-600 rounded-r-sm px-5 py-4 text-base text-stone-700">
      <span className="font-body text-xs tracking-[0.16em] uppercase text-amber-700 font-semibold block mb-1.5">Still open</span>
      {children}
    </div>
  );
}

/** Links to research notes by slug, pulling real titles from the blog index (single
 *  source of truth). Unknown slugs are dropped rather than rendered as dead links. */
function Notes({ slugs }: { slugs: string[] }) {
  const found = slugs.map(s => bySlug.get(s)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (!found.length) return null;
  return (
    <ul className="mt-6 space-y-2">
      {found.map(p => (
        <li key={p.slug}>
          <Link href={`/blog/${p.slug}`} className="text-amber-800 hover:underline font-body">
            {p.title}
          </Link>
          <span className="font-body text-sm text-stone-400 ml-2">{p.date}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ResearchProgrammePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Research"
          subtitle="A working library is also an instrument. These are the questions we are trying to answer with it, what we have found so far, and what is still open."
        />
      }
    >
      <div className="max-w-3xl mx-auto font-body text-stone-700 text-lg leading-relaxed">

        <div className="grid grid-cols-2 md:grid-cols-4 border border-stone-200 rounded-sm bg-stone-50 my-8">
          <Stat n={fmt(CORPUS.books)} label="readable books" />
          <Stat n={fmt(CORPUS.firstTranslations)} label="verified first English translations" />
          <Stat n={fmt(CORPUS.languages)} label="languages" />
          <Stat n={fmt(CORPUS.illustrations)} label="catalogued illustrations" />
        </div>

        <Section kicker="The programme" title="Why a library measures itself">
          <p className="mb-4">
            Source Library exists so that anyone can read and quote a primary source. Between a reader
            and a four-hundred-year-old page sits a stack of machines, and every one of them can be
            wrong. The scan can be too dark to read. The OCR can invent a word. The translation can
            smooth an unfamiliar idea into a familiar one. The claim that a text has never been
            translated before can be an artefact of a bad search.
          </p>
          <p className="mb-4">
            So the measurements below are not a research lab bolted onto a library. They are the part
            of the library that keeps its promise honest. Each question here started as an operational
            problem, and each answer changed how the pipeline runs.
          </p>
          <p>
            We publish the results whether or not they flatter the system. Several of the notes below
            are records of our own methods failing.
          </p>
        </Section>

        <Section kicker="Question 01" title="When a model transcribes a famous page, is it reading or reciting?">
          <p className="mb-4">
            Benchmarks for historical OCR are built almost entirely on canonical texts, because those
            are the texts with published transcriptions to score against. But the models have read
            those transcriptions too. A model that scores 99% on Genesis may be recalling Genesis
            rather than reading the page in front of it, and that score tells a digitisation project
            nothing about the rare, untranscribed material it actually holds.
          </p>
          <p className="mb-4">
            We measure the difference directly. Canonical and non-canonical passages are pinned on
            pages of the <em>same</em> books, in the same editions, scored identically. The extreme
            case is not subtle: two rows were deleted from our own dataset after page-scan audits
            proved the models were emitting letter-perfect canonical text that is not printed on the
            page at all.
          </p>
          <p className="mb-4">
            Across 40 pinned pages and 921 scored runs, the same-book gap is real but modest for large
            models and larger for small ones. On a single 1580 Virgil, the canonical Aeneid beats the
            non-canonical life of the poet printed in the same volume by 1.0 points for the largest
            model and 5.4 for the cheapest. Two other findings matter more than that headline. Pooling
            across unmatched pages destroys the effect, because differences in page difficulty swamp
            it. And conditional accuracy, the number benchmarks usually report, reverses the model
            ranking that unconditional accuracy produces: the most expensive model looks best until
            you count the runs where it never finished reading.
          </p>
          <p>
            The dataset, the raw model outputs, and the scoring code are public in{' '}
            <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/tree/main/scripts/eval/dataset" className="text-amber-800 hover:underline">
              the repository
            </a>, so the scores can be recomputed rather than believed.
          </p>
          <Open>
            Only two books in the set print both a memorised and a non-memorised passage. Until that
            number grows, the cleanest version of the result rests on a narrow base. We also cannot
            yet separate a model that reads badly from one that recites well on any single page.
          </Open>
          <Notes slugs={['confident-hallucinator', 'did-the-ai-read-this']} />
        </Section>

        <Section kicker="Question 02" title="What makes a page readable in the first place?">
          <p className="mb-4">
            Digitisation projects treat resolution as the master variable: scan bigger, read better.
            When we tested that by re-rendering the same pages at four widths, it did not hold in the
            range that matters. The cheapest model was flat within 0.6 points across a twenty-seven
            fold resolution range. The larger model was erratic, and its swings tracked something else
            entirely, namely whether it ran out of output budget while deliberating. One Hebrew page
            went from 50% to 95% accuracy when we made the image <em>smaller</em>, because shrinking
            it stopped the model from truncating.
          </p>
          <p>
            Legibility, in other words, is not the binding constraint above a few hundred pixels.
            Model behaviour is. That is a cheerful result for anyone holding modest scans, and an
            uncomfortable one for anyone budgeting storage on the assumption that more pixels buy
            accuracy.
          </p>
          <Open>
            We have not pushed below 600 pixels, which is where legibility should finally bind, and
            this test has only run on two models.
          </Open>
          <Notes slugs={['what-makes-a-good-scan']} />
        </Section>

        <Section kicker="Question 03" title="Where does machine reading break down by script?">
          <p className="mb-4">
            Accuracy on Latin print says nothing about accuracy on Tibetan cursive, Hebrew rabbinic
            type, or a cuneiform tablet. We benchmark script by script, and the failures are specific
            rather than general: models that handle a printed Hebrew Bible confidently produce fluent
            nonsense on Rashi script, and no current model reads a Bhutanese manuscript folio well
            enough for the result to be trusted without a second pass.
          </p>
          <p>
            These are the notes that most often change what the pipeline does. A script that fails
            gets routed to a different model, held back from publication, or flagged in the reader.
          </p>
          <Notes slugs={['tibetan-ocr', 'rashi-ocr', 'cuneiform-ocr', 'hieroglyph-ocr', 'reading-classical-chinese']} />
        </Section>

        <Section kicker="Question 04" title="Can you catch a hallucination without ground truth?">
          <p className="mb-4">
            For almost every page we hold there is no published transcription to check against. So the
            practical question is whether disagreement between independent readings can stand in for
            accuracy. Run the same page through several models, or the same model several times, and
            the places they diverge are candidate errors.
          </p>
          <p className="mb-4">
            It works, with one sharp exception that our own memorisation work uncovered. Consensus
            assumes the readings are independent. On a canonical text they are not: two models
            reciting the same memorised passage agree perfectly with each other while both misreport
            the page. Any agreement-to-accuracy calibration therefore has to be fitted on
            non-canonical text, or it will be most confident exactly where it is most wrong.
          </p>
          <Open>
            We hold hundreds of thousands of prior OCR versions from pages that were re-read as models
            improved. That is a large natural experiment in agreement and regression which we have so
            far only sampled.
          </Open>
          <Notes slugs={['ocr-consistency', 'translation-collapse']} />
        </Section>

        <Section kicker="Question 05" title="How much of the historical record has never been translated?">
          <p className="mb-4">
            This is the question the library was founded on, and it is harder to answer than it sounds,
            because proving a negative across four centuries of print requires knowing what exists as
            well as what has been translated. Measured against the Universal Short Title Catalogue,
            the share of early-modern works with any known modern translation comes out at roughly one
            in a hundred.
          </p>
          <p>
            The corollary is uncomfortable for the canon: the untranslated material is not uniformly
            minor. Major figures turn out to have been translated selectively, with the convenient
            works Englished and the rest left in Latin for four hundred years.
          </p>
          <Open>
            A catalogue is not the world. Works that never entered the USTC, and traditions outside
            European print entirely, are counted badly or not at all.
          </Open>
          <Notes slugs={['counting-the-gap', 'untranslated-renaissance', 'the-giants-werent-translated', 'translation-rate', 'how-long-to-translate']} />
        </Section>

        <Section kicker="Question 06" title="What is a first translation, and how would you know?">
          <p className="mb-4">
            Claiming that something is the first English translation of a work is a bibliographic
            assertion, and a machine that wants to make it has to search for evidence of absence. Our
            verification runs adversarially: independent agents are asked to <em>refute</em> the claim,
            and it survives only if the refutation attempts fail and leave a record of what they
            searched.
          </p>
          <p>
            {fmt(CORPUS.firstTranslations)} works currently carry a verified badge. A larger set is
            held provisionally and unbadged, because the evidence is not yet good enough to publish.
            The gap between those two numbers is the honest part.
          </p>
          <Open>
            Verification coverage stands near 60% of readable works. The remainder are unexamined
            rather than negative, and we are careful not to confuse the two.
          </Open>
          <Notes slugs={['first-translation-methodology', 'counting-first-translations', 'first-translations']} />
        </Section>

        <Section kicker="Question 07" title="Can you trust the translation you are reading?">
          <p className="mb-4">
            Every translation here is machine-produced and sits beside the original, one click away,
            which is the structural answer: you are never asked to take the translation on faith. But
            structure is not enough, so we measure where machine translation degrades, how it fails
            when it fails, and whether a reader can see through the English to the words underneath.
          </p>
          <p>
            The most common failure is not mistranslation. It is fluency: a passage that reads
            beautifully and quietly modernises an idea the author did not have.
          </p>
          <Notes slugs={['translation-collapse', 'word-alignment', 'does-ai-get-religion', 'did-an-ai-write-the-encyclical']} />
        </Section>

        <Section kicker="Question 08" title="What does the whole corpus look like from above?">
          <p className="mb-4">
            Once tens of thousands of texts are readable by machine, questions become askable that no
            individual reader could pose: when a term enters a language, how an image travels between
            printers, what shape a tradition has when you cluster it rather than shelve it.
          </p>
          <p>
            These are the least settled of our questions and the most fun. They are also where the risk
            of seeing patterns that are artefacts of the collection rather than of history is highest,
            which is why each instrument below is published with its own caveats.
          </p>
          <Notes slugs={['ngram-viewer', 'clustering', 'visualizing-classification', 'incunabula-knowledge-graph', 'history-of-classification']} />
        </Section>

        <Section kicker="Instruments" title="Tools you can use">
          <p className="mb-6">
            Several of the questions above have a live instrument behind them, open to anyone.
          </p>
          <ul className="space-y-3">
            <li>
              <Link href="/ngrams" className="text-amber-800 hover:underline">Ngram viewer</Link>
              <span className="text-stone-500"> — word frequency across five centuries, with a click through from any peak to the page itself.</span>
            </li>
            <li>
              <Link href="/research/translation-gap" className="text-amber-800 hover:underline">The translation gap</Link>
              <span className="text-stone-500"> — the census of early-modern works against their known translations, by language, with its method and robustness checks.</span>
            </li>
            <li>
              <Link href="/research/translation-registry" className="text-amber-800 hover:underline">Translation registry</Link>
              <span className="text-stone-500"> — which early-modern Latin works have been Englished, and by whom.</span>
            </li>
            <li>
              <Link href="/research/translation-lag" className="text-amber-800 hover:underline">Translation lag</Link>
              <span className="text-stone-500"> — how many years pass between a work being written and being read in English.</span>
            </li>
            <li>
              <Link href="/research/concept-diffusion" className="text-amber-800 hover:underline">Concept diffusion</Link>
              <span className="text-stone-500"> — how vocabulary spreads across languages and centuries.</span>
            </li>
            <li>
              <Link href="/research/atlas" className="text-amber-800 hover:underline">Text atlas</Link>
              <span className="text-stone-500"> — the corpus arranged by what texts are about rather than where they sit on a shelf.</span>
            </li>
            <li>
              <Link href="/research/image-atlas" className="text-amber-800 hover:underline">Image atlas</Link>
              <span className="text-stone-500"> — thousands of illustrations clustered by visual similarity.</span>
            </li>
            <li>
              <Link href="/research/sessions" className="text-amber-800 hover:underline">Curator sessions</Link>
              <span className="text-stone-500"> — transcripts of the AI curation conversations that built much of the collection.</span>
            </li>
          </ul>
        </Section>

        <Section kicker="Method" title="How to check us">
          <p className="mb-4">
            Everything here is reproducible on purpose. The site and the evaluation code are open
            source under the AGPL, the OCR evaluation dataset ships with raw model outputs so scores
            can be recomputed under different metrics, and the library exposes a{' '}
            <Link href="/developers" className="text-amber-800 hover:underline">public API</Link> and an{' '}
            <Link href="/blog/mcp-server" className="text-amber-800 hover:underline">MCP server</Link>{' '}
            so an AI assistant can read the sources directly and check a quotation against the page it
            came from.
          </p>
          <p className="mb-4">
            Where a reference text cannot be redistributed, we publish a checksum and retrieval
            instructions instead of the text. Where a number comes from a snapshot, the snapshot is
            dated in the source. Corrections are welcome, and they get published.
          </p>
          <p>
            The running write-ups live in the{' '}
            <Link href="/blog" className="text-amber-800 hover:underline">research notes</Link>, and the
            open work is tracked in{' '}
            <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues" className="text-amber-800 hover:underline">
              public issues
            </a>.
          </p>
        </Section>

        <p className="py-10 text-base text-stone-500">
          Corpus figures are a snapshot of 19 July 2026. Evaluation figures come from the OCR eval
          dataset v0.2, covering 40 pinned pages and 921 scored runs, and are preliminary.
        </p>

      </div>
    </ContentPageLayout>
  );
}
