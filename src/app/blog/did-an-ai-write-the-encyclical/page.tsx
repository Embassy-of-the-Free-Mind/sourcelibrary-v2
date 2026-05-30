import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: "Did an AI Write the Pope's AI Encyclical? - Research Notes - Source Library",
  description:
    "Detectors flagged Magnifica Humanitas as 46% AI-written; the headline was 127 em-dashes vs zero in a comparison encyclical. We re-ran the test locally against eight human encyclicals. The smoking gun is a baseline-selection artifact.",
  openGraph: {
    title: "Did an AI Write the Pope's AI Encyclical?",
    description:
      'Detectors flagged Magnifica Humanitas as 46% AI-written. We re-ran the test against eight human encyclicals — and the evidence dissolves. A note on why baselines decide everything.',
  },
  alternates: {
    canonical: '/blog/did-an-ai-write-the-encyclical',
  },
};

export default function DidAnAiWriteTheEncyclicalPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Did an AI Write the Pope's AI Encyclical?"
          subtitle="Magnifica Humanitas was flagged 46% AI-written. We re-ran the test against eight human encyclicals — and the smoking gun turned out to be a baseline."
        >
          <p className="text-stone-400 text-sm mt-4">30 May 2026 &middot; 11 min read</p>
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

        {/* Lead */}
        <p className="text-xl text-secondary leading-relaxed mb-8">
          On 25 May 2026, Pope Leo XIV released his first encyclical, <em>Magnifica Humanitas</em> &mdash; a 42,000-word letter on safeguarding the human person in the age of artificial intelligence, presented, fittingly, alongside a co-founder of an AI lab. Within days, analysts had run it through AI-text detectors and concluded that large parts of it were machine-written. <Link href="https://www.lesswrong.com/posts/GbWwesBnetyiomxEH/many-portions-of-magnifica-humanitas-appear-to-be-ai-written" className="text-accent-rust hover:underline">One widely-shared analysis</Link> put it at <strong>46% AI</strong>; the story spread through the <Link href="https://slate.com/technology/2026/05/artificial-intelligence-pope-leo-encyclical.html" className="text-accent-rust hover:underline">tech</Link> <Link href="https://ground.news/article/ai-detection-tool-flags-parts-of-pope-leos-encyclical-as-ai-written" className="text-accent-rust hover:underline">press</Link>. The most quotable piece of evidence: the document contains <strong>127 em-dashes</strong>, against <strong>zero</strong> in a recent encyclical of comparable length. The claim was also <Link href="https://www.greaterwrong.com/posts/oXCb4vW7doNQEdt4k/no-magnifica-humanitas-is-not-ai-written" className="text-accent-rust hover:underline">contested almost as quickly as it spread</Link> &mdash; which is where we come in.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          We build a library that uses AI to read four million pages of historical text, so &ldquo;can you tell whether a machine wrote this?&rdquo; is not an idle question for us &mdash; it is the same question we ask of our own OCR and translations. So we re-ran the analysis ourselves, locally, for free, and added the one ingredient the viral version was missing: a fair baseline. The short version is that the evidence does not survive contact with eight other encyclicals.
        </p>

        {/* TOC */}
        <nav className="bg-warm/50 rounded-lg p-6 mb-12 border border-light">
          <p className="text-sm font-semibold text-primary mb-3 uppercase tracking-wide">Contents</p>
          <ol className="text-secondary space-y-0.5 list-decimal list-inside text-sm">
            <li><a href="#why-we-care" className="text-accent-rust hover:underline">Why a library cares</a></li>
            <li><a href="#detectors" className="text-accent-rust hover:underline">How AI detectors work (and fail)</a></li>
            <li><a href="#method" className="text-accent-rust hover:underline">What we did</a></li>
            <li><a href="#binoculars" className="text-accent-rust hover:underline">Indistinguishable from a human encyclical</a></li>
            <li><a href="#emdash" className="text-accent-rust hover:underline">The em-dash collapse</a></li>
            <li><a href="#lesson" className="text-accent-rust hover:underline">Baselines decide everything</a></li>
            <li><a href="#unsure" className="text-accent-rust hover:underline">What we&rsquo;re still unsure about</a></li>
          </ol>
        </nav>

        {/* 1 */}
        <h2 id="why-we-care" className="text-2xl md:text-3xl text-primary mt-16 mb-6">1. Why a library cares</h2>
        <p className="text-secondary leading-relaxed mb-6">
          A companion note on this blog (<Link href="/blog/did-the-ai-read-this" className="text-accent-rust hover:underline">Did the AI Read This?</Link>) asked which of our books a frontier model has already memorized. This is the mirror-image question: not <em>did a machine read this text</em>, but <em>did a machine write it</em>. Both matter to a library whose stock-in-trade is textual trust. We run AI over our corpus constantly &mdash; OCR, translation, summaries &mdash; and we need defensible ways to tell machine output from human, to catch a hallucinated passage or an over-edited summary before a reader does.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          The encyclical itself makes the stakes explicit. &ldquo;Truth,&rdquo; it argues, &ldquo;is not a territory to be defended, but a good to be shared.&rdquo; A claim that the Pope&rsquo;s own letter was secretly machine-authored is exactly the kind of viral, hard-to-check assertion that erodes that good. So it deserves to be checked properly.
        </p>

        {/* 2 */}
        <h2 id="detectors" className="text-2xl md:text-3xl text-primary mt-16 mb-6">2. How AI detectors work (and fail)</h2>
        <p className="text-secondary leading-relaxed mb-6">
          Most detectors exploit one fact: a language model writes text that <em>it</em> finds highly probable. Run a passage back through a model and machine-written text tends to sit in a low-&ldquo;perplexity,&rdquo; low-surprise zone that spontaneous human writing rarely occupies. The open-source <strong>Binoculars</strong> method sharpens this by taking the ratio of two models&rsquo; perplexities; it catches a large share of machine text at a very low false-positive rate &mdash; <em>on benchmarks</em>.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          The trouble starts off-benchmark. Detectors quietly learn dataset-specific style, not a stable signature of machine authorship. They flag non-native English and formal, templated prose at alarming rates. And the failure mode that matters most here: any text built from <em>predictable</em> material &mdash; canonical quotations, liturgical formulae, doctrinal boilerplate &mdash; reads as low-perplexity to a model, because the model has seen that phrasing a thousand times. A human compiler quoting scripture produces &ldquo;machine-like&rdquo; text by this measure. That is not a bug we can prompt away; it is what the instrument measures.
        </p>

        {/* 3 */}
        <h2 id="method" className="text-2xl md:text-3xl text-primary mt-16 mb-6">3. What we did</h2>
        <p className="text-secondary leading-relaxed mb-6">
          Three independent passes, all on a laptop, no paid API, nothing leaving the machine:
        </p>
        <ul className="text-secondary leading-relaxed mb-6 list-disc list-inside space-y-2">
          <li><strong>Binoculars</strong> on every numbered paragraph, using a small open base/instruct model pair. Lower score = more machine-like.</li>
          <li><strong>A cross-language control.</strong> We scored both the English and the Italian of the same paragraphs. If a passage only looks machine-like in English, the translator is a likely cause; if it looks machine-like in <em>both</em>, the signal is intrinsic to the content.</li>
          <li><strong>Stylometry against a baseline.</strong> We counted the &ldquo;tells&rdquo; &mdash; em-dashes, the &ldquo;not&nbsp;X&nbsp;but&nbsp;Y&rdquo; construction, AI-favored vocabulary &mdash; not just in <em>Magnifica Humanitas</em>, but in eight encyclicals spanning Leo XIII (1891) to Francis (2024).</li>
        </ul>
        <p className="text-secondary leading-relaxed mb-6">
          The whole experiment is browsable, paragraph by paragraph, in both languages, as a small interactive site: <Link href="https://magnifica-ai-analysis.vercel.app" className="text-accent-rust hover:underline">magnifica-ai-analysis.vercel.app</Link>.
        </p>

        {/* 4 */}
        <h2 id="binoculars" className="text-2xl md:text-3xl text-primary mt-16 mb-6">4. Indistinguishable from a human encyclical</h2>
        <p className="text-secondary leading-relaxed mb-6">
          The detector did flag paragraphs &mdash; but reading them is instructive. The most &ldquo;machine-like&rdquo; passages are the quotation-stitched doctrinal ones: chains of John Paul II, Vatican II, and Francis joined by &ldquo;Consequently&hellip;&rdquo; and &ldquo;For this reason&hellip;&rdquo; The most &ldquo;human&rdquo; ones are the original, image-rich passages &mdash; the Tower of Babel, rebuilding Jerusalem &ldquo;piece by piece.&rdquo; In other words, the detector is largely measuring quotation density, exactly the confound above.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          The clean test is to score a <em>known-human</em> encyclical through the identical pipeline and ask whether <em>Magnifica Humanitas</em> is measurably more machine-like. Against Francis&rsquo;s <em>Dilexit Nos</em> (2024), the probability that a random <em>Magnifica</em> paragraph scores more machine-like than a random human-encyclical paragraph was <strong>0.51 in English</strong> (0.50 would be a coin flip; a permutation test gave p&nbsp;=&nbsp;0.45). In Italian it was 0.55, and still not statistically significant. By this detector, the encyclical is <strong>indistinguishable from human-written magisterial prose</strong>.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          To anchor both ends of the scale, we added two more reference points. For an <em>AI-positive</em> control we had Claude &mdash; the model the viral claim accused &mdash; write sixteen encyclical-style paragraphs on the same themes, and scored them identically. For a same-author <em>human</em> control we scored Leo XIV&rsquo;s own speeches, including his spoken presentation of this very encyclical. Ranked by machine-likeness, the Claude paragraphs are the most machine-like (mean&nbsp;0.947), then <em>Magnifica</em> (0.975), then <em>Dilexit Nos</em> (0.979), then Leo&rsquo;s speeches (0.987). On that human&rarr;AI ruler, <em>Magnifica</em> sits just <strong>12% of the way</strong> toward the Claude anchor &mdash; squarely with the human texts &mdash; and a random <em>Magnifica</em> paragraph is <em>less</em> machine-like than a Claude one about two-thirds of the time. The document does not land where AI-generated text lands.
        </p>

        {/* 5 */}
        <h2 id="emdash" className="text-2xl md:text-3xl text-primary mt-16 mb-6">5. The em-dash collapse</h2>
        <p className="text-secondary leading-relaxed mb-6">
          That leaves the stylometric tells &mdash; the strongest-feeling evidence, and the one most worth taking seriously, because a habit like em-dash overuse is a known model fingerprint. <em>Magnifica Humanitas</em> really does use a lot of them: 127, about 3.1 per thousand words. And against <em>Dilexit Nos</em>, which has zero, that looks damning.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          But a fingerprint is only evidence against a fair lineup. Here is the dash rate across eight encyclicals:
        </p>

        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-light text-left text-muted">
                <th className="py-2 pr-4 font-semibold">Encyclical</th>
                <th className="py-2 pr-4 font-semibold">Author</th>
                <th className="py-2 pr-4 font-semibold text-right">Year</th>
                <th className="py-2 pr-4 font-semibold text-right">Dashes / 1k words</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-light bg-accent-rust/5 font-semibold">
                <td className="py-2 pr-4">Magnifica Humanitas</td><td className="py-2 pr-4">Leo XIV</td><td className="py-2 pr-4 text-right">2026</td><td className="py-2 pr-4 text-right">3.14</td>
              </tr>
              <tr className="border-b border-light"><td className="py-2 pr-4">Spe Salvi</td><td className="py-2 pr-4">Benedict XVI</td><td className="py-2 pr-4 text-right">2007</td><td className="py-2 pr-4 text-right font-semibold">8.03</td></tr>
              <tr className="border-b border-light"><td className="py-2 pr-4">Caritas in Veritate</td><td className="py-2 pr-4">Benedict XVI</td><td className="py-2 pr-4 text-right">2009</td><td className="py-2 pr-4 text-right">2.71</td></tr>
              <tr className="border-b border-light"><td className="py-2 pr-4">Fides et Ratio</td><td className="py-2 pr-4">John Paul II</td><td className="py-2 pr-4 text-right">1998</td><td className="py-2 pr-4 text-right">2.42</td></tr>
              <tr className="border-b border-light"><td className="py-2 pr-4">Fratelli Tutti</td><td className="py-2 pr-4">Francis</td><td className="py-2 pr-4 text-right">2020</td><td className="py-2 pr-4 text-right">1.07</td></tr>
              <tr className="border-b border-light"><td className="py-2 pr-4">Dilexit Nos</td><td className="py-2 pr-4">Francis</td><td className="py-2 pr-4 text-right">2024</td><td className="py-2 pr-4 text-right">0.83</td></tr>
              <tr className="border-b border-light"><td className="py-2 pr-4">Laudato Si&rsquo;</td><td className="py-2 pr-4">Francis</td><td className="py-2 pr-4 text-right">2015</td><td className="py-2 pr-4 text-right">0.61</td></tr>
              <tr className="border-b border-light"><td className="py-2 pr-4">Rerum Novarum</td><td className="py-2 pr-4">Leo XIII</td><td className="py-2 pr-4 text-right">1891</td><td className="py-2 pr-4 text-right">0.00</td></tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Benedict XVI&rsquo;s <em>Spe Salvi</em> &mdash; written in 2007, indisputably human &mdash; uses em-dashes at <strong>two and a half times</strong> Magnifica&rsquo;s rate. The &ldquo;127 vs zero&rdquo; headline only worked because the comparison was drawn against Francis, who happens to avoid the dash almost entirely. Set against the actual range of papal style, Magnifica&rsquo;s dash habit is unremarkable. The other tells tell the same story: on &ldquo;not&nbsp;X&nbsp;but&nbsp;Y&rdquo; the closest neighbor is Leo XIII&rsquo;s <em>Rerum Novarum</em> from 1891; on AI-vocabulary it is John Paul II&rsquo;s <em>Fides et Ratio</em>. Every tell lands inside the human range.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          One detail did survive translation: the dash habit shows up in the Italian too (as the en-dash Italian prefers), at roughly three times the human-baseline rate. And it shows up in Leo XIV&rsquo;s <em>own speeches</em> &mdash; addresses and homilies with no encyclical drafting involved &mdash; at the same elevated rate. So Leo, or his circle, simply favors the dash. That is a fact about an author&rsquo;s style, not a confession of authorship.
        </p>

        {/* 6 */}
        <h2 id="lesson" className="text-2xl md:text-3xl text-primary mt-16 mb-6">6. Baselines decide everything</h2>
        <p className="text-secondary leading-relaxed mb-6">
          The instructive thing about this exercise is that the <em>same numbers</em> support opposite conclusions depending on the comparison set. Against one carefully-chosen encyclical, <em>Magnifica Humanitas</em> looks machine-written. Against eight, it looks like an encyclical. Nothing about the document changed between those two sentences &mdash; only the lineup did.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          This is the same discipline we try to hold ourselves to when we score our own corpus. A quality number, a hallucination flag, an &ldquo;AI-likeness&rdquo; score &mdash; none of them mean anything without a same-genre baseline scored the identical way. A detector that reports &ldquo;46% AI&rdquo; with no human control is not measuring AI; it is measuring distance from whatever it happened to be trained on. The honest output of this whole investigation is not a verdict on the Pope. It is a method: never trust a detector without its lineup.
        </p>

        {/* 7 */}
        <h2 id="unsure" className="text-2xl md:text-3xl text-primary mt-16 mb-6">7. What we&rsquo;re still unsure about</h2>
        <p className="text-secondary leading-relaxed mb-6">
          <strong>This does not prove no AI was involved.</strong> An AI-assisted draft, an AI-polished edit, and unaided human writing can be statistically indistinguishable &mdash; that is the well-established limit of text detection, not a gap in our effort. We can say the viral evidence does not hold up; we cannot certify the drafting process. Vatican documents are also collaborative by tradition, which muddies &ldquo;authorship&rdquo; long before any machine enters the room.
        </p>
        <p className="text-secondary leading-relaxed mb-6">
          <strong>Our instrument is modest.</strong> We used a small model pair, not the large one the Binoculars paper validated; treat the paragraph rankings as relative, not absolute. One consequence is visible in the ruler above: the gap between the Claude anchor and the human texts is narrow, because a 0.5B detector separates the two only weakly. That MH still lands with the humans on a short ruler &mdash; rather than at the AI end &mdash; is the result, but a larger model would draw the anchors farther apart and sharpen it. The honest reading is convergent, not decisive: three different methods all point the same way, and none finds the AI signature the headlines claimed.
        </p>

        {/* End */}
        <hr className="my-12 border-light" />

        <p className="text-sm text-muted">
          <em>Full interactive data &mdash; every paragraph, both languages, all three methods &mdash; at <Link href="https://magnifica-ai-analysis.vercel.app" className="text-accent-rust hover:underline">magnifica-ai-analysis.vercel.app</Link>. The encyclical itself is on <Link href="https://www.vatican.va/content/leo-xiv/en/encyclicals/documents/20260515-magnifica-humanitas.html" className="text-accent-rust hover:underline">vatican.va</Link>. Detector: the <Link href="https://arxiv.org/abs/2401.12070" className="text-accent-rust hover:underline">Binoculars</Link> method (Hans et al., 2024).</em>
        </p>

        <BlogComments slug="did-an-ai-write-the-encyclical" />
      </article>
    </ContentPageLayout>
  );
}
