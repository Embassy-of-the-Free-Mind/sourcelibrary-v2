import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Benchmarking AI OCR on 232,000 Pages of Bhutanese Buddhist Manuscripts - Source Library',
  description: 'We imported 1,358 manuscripts from Bhutanese monasteries and tested whether AI can read handwritten Tibetan pecha. Claude Opus achieved 100% consistency; Gemini Flash 80%. Cross-model agreement: 89.4%.',
  openGraph: {
    title: 'Benchmarking AI OCR on 232,000 Pages of Bhutanese Manuscripts',
    description: 'Testing Claude and Gemini on handwritten Tibetan from five Bhutanese monasteries. Modal Consistency Rate, cross-model agreement, and comparison to human translation.',
    images: [{ url: 'https://images.eap.bl.uk/EAP039/EAP039_1_4_277/10.jp2/full/1200,/0/default.jpg', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.eap.bl.uk/EAP039/EAP039_1_4_277/10.jp2/full/1200,/0/default.jpg' }],
  },
  alternates: {
    canonical: '/blog/tibetan-ocr',
  },
};

export default function TibetanOcrPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Benchmarking AI OCR on 232,000 Pages of Bhutanese Buddhist Manuscripts"
          subtitle="Claude, Gemini, and the question of what &ldquo;good enough&rdquo; means for handwritten Tibetan"
          image="https://images.eap.bl.uk/EAP039/EAP039_1_4_277/10.jp2/full/600,/0/default.jpg"
          imageAlt="Ritual mandala from Gangtey Monastery, Bhutan"
        >
          <p className="text-stone-400 text-sm mt-4">23 April 2026 &middot; 12 min read</p>
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
          Last month we imported 1,358 Bhutanese manuscripts &mdash; 232,800 pages &mdash; from the British Library&rsquo;s <a href="https://eap.bl.uk" className="text-accent-rust hover:underline">Endangered Archives Programme</a>. These are handwritten pecha manuscripts spanning the 14th through 20th centuries, written in both dbu can (formal headed script) and dbu med (cursive headless script), covering Buddhist philosophy, ritual practice, astrology, history, and more.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The images are high-resolution JPEG2000 from the British Library&rsquo;s professional digitization. The question was whether current AI models could actually read them.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          General-purpose OCR cannot. The <a href="https://arxiv.org/html/2604.12978" className="text-accent-rust hover:underline">GlotOCR Bench</a> evaluation (Kargaran et al., 2026), which tested OCR across 200+ scripts, found that Tibetan falls below 10% accuracy on standard OCR models. So we ran our own experiment.
        </p>

        {/* --- Hero image --- */}
        <figure className="my-12">
          <img
            src="https://images.eap.bl.uk/EAP039/EAP039_1_4_277/10.jp2/full/1200,/0/default.jpg"
            alt="A painted ritual mandala from Gangtey Monastery, Bhutan — concentric circles with hexagram, lotus petals, and Buddhist seed syllables"
            className="w-full rounded-lg"
          />
          <figcaption className="text-sm text-muted mt-2 text-center">
            A ritual mandala from the Gongd&uuml; collection at Gangtey Monastery, Bhutan. One of 1,358 manuscripts in our corpus. <a href="/book/bla-ma-dgongs-dus-kyi-dpe-ris-skor-collection" className="text-accent-rust hover:underline">View this manuscript</a>.
          </figcaption>
        </figure>

        {/* --- The Corpus --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The Corpus</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Our 1,358 manuscripts come from four Endangered Archives Programme projects, plus a smaller set from other digital libraries:
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          <strong>EAP039: <a href="https://eap.bl.uk/project/EAP039" className="text-accent-rust hover:underline">Gangtey Monastery</a></strong> &mdash; 284 manuscripts, roughly 34,500 pages. Gangtey was founded by Tenzin Legpai Dondrup, grandson of the great treasure-revealer Pema Lingpa. The collection includes revealed texts (terma), liturgical manuals, and astrological treatises.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          <strong>EAP105: <a href="https://eap.bl.uk/project/EAP105" className="text-accent-rust hover:underline">Drametse and Ogyen Choling</a></strong> &mdash; Over 720 manuscripts, roughly 62,500 pages. Drametse Monastery was founded in 1511 and is the origin of the Drametse Nga Cham (drum dance), a UNESCO Intangible Cultural Heritage.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          <strong>EAP310: <a href="https://eap.bl.uk/project/EAP310" className="text-accent-rust hover:underline">Thadrak, Neyphug, Phurdrup, and Tshamdrak Temples</a></strong> &mdash; 316 manuscripts, roughly 119,000 pages. These temple collections represent some of the largest single deposits in our corpus.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          <strong>Additional sources</strong> &mdash; 53 texts from the <a href="https://archive.org" className="text-accent-rust hover:underline">Internet Archive</a>, the <a href="https://library.bdrc.io" className="text-accent-rust hover:underline">Buddhist Digital Resource Center</a>, and <a href="https://gallica.bnf.fr" className="text-accent-rust hover:underline">Gallica</a>, including European accounts of Bhutan and Drukpa Kagyu lineage texts.
        </p>

        {/* --- Sample manuscripts --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-12">
          <figure>
            <img src="https://images.eap.bl.uk/EAP310/EAP310_2_1_30/3.jp2/full/800,/0/default.jpg" alt="Neyphug dbu can manuscript" className="w-full rounded-lg" />
            <figcaption className="text-sm text-muted mt-2">Neyphug Monastery: formal dbu can script with red margin lines. <a href="/book/phurdrup-gonpa-dgongs-dus-dpe-ris-gonpa" className="text-accent-rust hover:underline">View</a></figcaption>
          </figure>
          <figure>
            <img src="https://images.eap.bl.uk/EAP039/EAP039_1_4_100/5.jp2/full/800,/0/default.jpg" alt="Gangtey dbu med manuscript" className="w-full rounded-lg" />
            <figcaption className="text-sm text-muted mt-2">Gangtey Monastery: cursive dbu med astrological text. <a href="/book/o-rgyan-rnamm-thar-bka-thang-collection" className="text-accent-rust hover:underline">View</a></figcaption>
          </figure>
        </div>

        {/* --- The Experiment --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The Experiment</h2>

        <p className="text-secondary leading-relaxed mb-6">
          We tested OCR consistency on the same Gangtey dbu med manuscript page &mdash; an astrological text from the 60-year element-animal cycle &mdash; across three models. Rather than measuring against ground truth (which would require Tibetan paleographers), we measured something more immediately useful for pipeline work: how consistent is each model with itself, and how much do models agree with each other?
        </p>

        {/* --- Results table --- */}
        <div className="overflow-x-auto mb-12">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-border-medium">
                <th className="py-3 pr-6 text-primary font-semibold">Model</th>
                <th className="py-3 pr-6 text-primary font-semibold text-right">Runs</th>
                <th className="py-3 pr-6 text-primary font-semibold text-right">MCR</th>
                <th className="py-3 text-primary font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6 font-medium">Claude Opus 4.6</td>
                <td className="py-3 pr-6 text-right">3</td>
                <td className="py-3 pr-6 text-right font-semibold text-green-700">100%</td>
                <td className="py-3">3/3 identical. Correct script, genre, and content ID.</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6 font-medium">Gemini 3 Flash</td>
                <td className="py-3 pr-6 text-right">5</td>
                <td className="py-3 pr-6 text-right font-semibold text-amber-700">80%</td>
                <td className="py-3">4/5 identical. 1 mode switch (24.4% char similarity to dominant).</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6 font-medium">Gemini 3.1 Flash Lite</td>
                <td className="py-3 pr-6 text-right">3</td>
                <td className="py-3 pr-6 text-right font-semibold text-red-700">N/A</td>
                <td className="py-3">Misidentified genre entirely. Hallucinated &ldquo;ritual manual for weather control.&rdquo;</td>
              </tr>
              <tr>
                <td className="py-3 pr-6 font-medium">Cross-model</td>
                <td className="py-3 pr-6 text-right">&mdash;</td>
                <td className="py-3 pr-6 text-right font-semibold">89.4%</td>
                <td className="py-3">Character similarity, Opus vs Flash dominant mode.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The mode-switching behavior in Gemini Flash is notable: at temperature=0, you would expect deterministic output, but VLMs can exhibit what amounts to bifurcated interpretation of ambiguous visual input. Within the dominant mode, consistency was perfect.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Given that the GlotOCR benchmark found sub-10% accuracy for Tibetan on general OCR models, 89% cross-model agreement on handwritten cursive manuscripts is striking. The likely explanation is that vision-language models have absorbed enough Tibetan text during pretraining to perform well on OCR even where traditional pipeline-based approaches fail.
        </p>

        {/* --- Related Work --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The Tibetan OCR Landscape</h2>

        <p className="text-secondary leading-relaxed mb-8">
          Our experiment sits within a rapidly developing ecosystem of Tibetan-language AI tools. We want to describe that landscape honestly, because the work being done by dedicated Tibetan digital humanities projects is more important than anything we are doing.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The <a href="https://www.bdrc.io" className="text-accent-rust hover:underline">Buddhist Digital Resource Center</a> has been the backbone of Tibetan digital preservation for decades. In March 2025, BDRC released the first <a href="https://github.com/buda-base/tibetan-ocr-app" className="text-accent-rust hover:underline">open-source desktop Tibetan OCR application</a>, built on Easter2 architecture trained on approximately 43,000 line samples. In February 2026, BDRC launched a major open datasets initiative with over 30 million scanned pages and 5 million etexts &mdash; an extraordinary resource for the entire field.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <a href="https://monlam.ai/model/ocr" className="text-accent-rust hover:underline">Monlam AI</a>, based in Dharamshala, claims state-of-the-art Tibetan comprehension with their Melong model, trained on approximately 24 billion Tibetan tokens. The exile Tibetan community building AI tools for their own language &mdash; on their own terms, for their own purposes &mdash; is one of the most inspiring developments in the space.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          <a href="https://openpecha.org" className="text-accent-rust hover:underline">OpenPecha</a> maintains open Tibetan etexts and collaborative annotations. The project represents the kind of community-driven infrastructure that makes everything else possible.
        </p>

        {/* --- Consistency and Trust --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Consistency, Hallucination, and Trust</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The deeper question is not &ldquo;how accurate is the OCR&rdquo; but &ldquo;how do we know when to trust it?&rdquo;
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <a href="https://arxiv.org/abs/2503.16974" className="text-accent-rust hover:underline">Wang and Wang (2025)</a> showed that simple aggregation across 3-5 LLM runs dramatically improves consistency. This echoes a foundational result from Lopresti and Zhou (1996): scanning a page three times and running consensus voting eliminates 20-50% of single-engine OCR errors. That insight is 30 years old, and it applies directly to VLM-based OCR.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          &ldquo;<a href="https://arxiv.org/abs/2506.20168" className="text-accent-rust hover:underline">Seeing is Believing?</a>&rdquo; demonstrated that VLMs over-rely on linguistic priors when visual conditions degrade. We observed this directly: Gemini 3.1 Flash Lite &ldquo;read&rdquo; an astrological text as a ritual manual for weather control. The output was coherent Tibetan Buddhist terminology &mdash; it just had nothing to do with what was on the page. The model was writing, not reading.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          <a href="https://arxiv.org/html/2603.19790v3" className="text-accent-rust hover:underline">Conformal Risk Control for OCR</a> introduces accept/abstain decisions with statistical guarantees: VLMs are overconfident on hallucinated outputs, so internal confidence scores are unreliable. Cross-view consistency &mdash; what we measured as cross-run and cross-model agreement &mdash; serves as better evidence for trustworthiness.
        </p>

        {/* --- MCR --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Modal Consistency Rate</h2>

        <p className="text-secondary leading-relaxed mb-6">
          For pipeline OCR at scale, we propose Modal Consistency Rate (MCR) as the primary quality signal. Run each page N times (we use N=3). The MCR is the fraction of runs producing the majority output.
        </p>

        <ul className="text-secondary leading-relaxed mb-8 space-y-2">
          <li><strong>MCR = 100%</strong> &mdash; High confidence. The model has a single, stable interpretation.</li>
          <li><strong>MCR = 67%</strong> &mdash; Some ambiguity, but a consensus exists. Use the majority reading.</li>
          <li><strong>MCR = 33%</strong> &mdash; Low confidence. The page is genuinely ambiguous. Flag for review.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6">
          Combined with cross-model agreement, you get a two-dimensional quality signal:
        </p>

        <div className="overflow-x-auto mb-12">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-border-medium">
                <th className="py-3 pr-6 text-primary font-semibold"></th>
                <th className="py-3 pr-6 text-primary font-semibold">High Cross-Model</th>
                <th className="py-3 text-primary font-semibold">Low Cross-Model</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6 font-medium">High MCR</td>
                <td className="py-3 pr-6">Trustworthy</td>
                <td className="py-3">Consistent but model-dependent</td>
              </tr>
              <tr>
                <td className="py-3 pr-6 font-medium">Low MCR</td>
                <td className="py-3 pr-6">Unlikely in practice</td>
                <td className="py-3">Ambiguous page, needs review</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* --- Translation --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Can You Trust Any Translation?</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Consistency tells us whether the model agrees with itself. But does it agree with human translators? We tested using our block-print of the <em>Zhi khro dgongs pa rang grol</em> (the Bardo Thodol cycle), comparing against scholarly translations from <a href="https://www.lotsawahouse.org" className="text-accent-rust hover:underline">Lotsawa House</a> (Adam Pearcey, 2016).
        </p>

        <p className="text-secondary leading-relaxed mb-6">Our OCR captured the opening:</p>

        <blockquote className="border-l-4 border-accent-rust/30 pl-6 my-8 text-secondary">
          <p className="font-tibetan text-lg leading-relaxed">༄༅། །ཟབ་ཆོས་ཞི་ཁྲོ་དགོངས་པ་རང་གྲོལ། སྔོན་འགྲོ་རང་རྒྱུད་སྦྱོང་བའི་ཞལ་ཤེས་ནི།</p>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-4">Our AI translation:</p>
        <blockquote className="border-l-4 border-stone-300 pl-6 my-4 text-secondary italic">
          &ldquo;Profound Dharma of the Peaceful and Wrathful Ones, Self-Liberated Wisdom. The oral instructions for purifying one&rsquo;s own continuum through the preliminary practices.&rdquo;
        </blockquote>

        <p className="text-secondary leading-relaxed mb-4">The standard scholarly translation:</p>
        <blockquote className="border-l-4 border-stone-300 pl-6 my-4 text-secondary italic">
          &ldquo;Profound Teaching of the Peaceful and Wrathful Ones, Self-Liberation Through Intention. Oral instructions for training one&rsquo;s own mind-stream through the preliminaries.&rdquo;
        </blockquote>

        <p className="text-secondary leading-relaxed mb-12">
          The differences are instructive. <em>dgongs pa</em> can mean &ldquo;wisdom,&rdquo; &ldquo;intention,&rdquo; or &ldquo;realization&rdquo; depending on context. <em>rgyud sbyong</em> means something between &ldquo;purifying the continuum&rdquo; and &ldquo;training the mind-stream.&rdquo; These are the kinds of disagreements you see between <em>any</em> two independent translators of Classical Tibetan. The AI gets the meaning right. It makes different terminological choices, but choices that a Tibetologist would recognize as defensible rather than wrong.
        </p>

        {/* --- Torma image --- */}
        <figure className="my-12">
          <img
            src="https://images.eap.bl.uk/EAP105/EAP105_1_3_154/6.jp2/full/1200,/0/default.jpg"
            alt="Red ink drawings of torma ritual offering cakes from a Pema Lingpa manuscript at Drametse Monastery"
            className="w-full rounded-lg"
          />
          <figcaption className="text-sm text-muted mt-2 text-center">
            Torma (ritual offering cake) designs from a Pema Lingpa manuscript at Drametse Monastery. Each shape is labeled in Tibetan. <a href="/book/pad-gling-gtor-dpe-collection" className="text-accent-rust hover:underline">View this manuscript</a>.
          </figcaption>
        </figure>

        {/* --- What Comes Next --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">What Comes Next</h2>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Routing all 232K pages through Gemini 3 Flash.</strong> Not Flash Lite. Flash Lite hallucinates on cursive Tibetan, and these manuscripts are predominantly cursive.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Benchmarking against BDRC&rsquo;s Tibetan OCR app.</strong> Their Easter2-based system is trained specifically on Tibetan manuscripts. We want to know how it compares to VLMs on our corpus, particularly on dbu med cursive.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Exploring VLM fine-tuning.</strong> <a href="https://arxiv.org/abs/2507.06761" className="text-accent-rust hover:underline">Chung and Choi</a> fine-tuned LLaMA-3.2-11B on 60,000 synthetic Manchu word images and achieved 93.1% accuracy on real handwritten documents. A similar approach for Tibetan dbu med could address our hardest cases.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          <strong>Reaching out to BDRC and OpenPecha.</strong> Our 232,000 pages of monastery manuscripts, with multi-model OCR consistency data, could serve as a shared benchmark. The Tibetan digital humanities community has been building infrastructure for this work far longer than we have.
        </p>

        {/* --- Bigger Picture --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The Bigger Picture</h2>

        <p className="text-secondary leading-relaxed mb-6">
          These manuscripts were digitized by the British Library&rsquo;s Endangered Archives Programme because they were at risk of physical loss. The monasteries and temples that hold them &mdash; Gangtey, Drametse, Ogyen Choling, Thadrak, Neyphug, Phurdrup, Tshamdrak &mdash; preserve centuries of Bhutanese Buddhist scholarship, ritual practice, astrology, and history.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The digitization saved the images. But images alone are opaque. A researcher cannot search a photograph. The manuscripts remain locked behind script, language, and the sheer volume of 232,000 pages.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          OCR and translation &mdash; even imperfect OCR and translation &mdash; begin to unlock that. When a model reads a page with 89% cross-model agreement, that is not a scholarly transcription. But it is a bridge. It makes a manuscript findable.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          The manuscripts have survived centuries. The OCR just needs to be good enough to help people find them.
        </p>

        {/* --- Browse --- */}
        <div className="bg-stone-100 rounded-lg p-8 mt-16 mb-8">
          <h3 className="text-lg font-semibold text-primary mb-4">Browse the Bhutanese manuscripts</h3>
          <div className="flex flex-wrap gap-3">
            <Link href="/book/o-rgyan-rnamm-thar-bka-thang-collection" className="text-accent-rust hover:underline text-sm">Padmasambhava Biography</Link>
            <span className="text-stone-300">|</span>
            <Link href="/book/zab-chos-zhi-khro-dgongs-pa-rang-grol-collection" className="text-accent-rust hover:underline text-sm">Bardo Thodol (Gangtey)</Link>
            <span className="text-stone-300">|</span>
            <Link href="/book/bla-ma-dgongs-dus-kyi-dpe-ris-skor-collection" className="text-accent-rust hover:underline text-sm">Gongd&uuml; Mandala Illustrations</Link>
            <span className="text-stone-300">|</span>
            <Link href="/book/pad-gling-gtor-dpe-collection" className="text-accent-rust hover:underline text-sm">Pema Lingpa Torma Designs</Link>
            <span className="text-stone-300">|</span>
            <Link href="/book/phurdrup-gonpa-dgongs-dus-dpe-ris-gonpa" className="text-accent-rust hover:underline text-sm">Phurdrup Stupa Mandala</Link>
          </div>
        </div>

      </article>


    </ContentPageLayout>
  );
}
