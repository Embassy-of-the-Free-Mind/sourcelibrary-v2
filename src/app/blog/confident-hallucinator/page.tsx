import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'The Confident Hallucinator - Research Notes - Source Library',
  description: 'What we learned evaluating AI OCR across four scripts. A model can be perfectly consistent and completely wrong — 100% consistency, 0% accuracy. Output length ratios and embedding distances detect what MCR alone cannot.',
  openGraph: {
    title: 'The Confident Hallucinator',
    description: 'AI OCR evaluation across Latin, Tibetan, Arabic, and Hebrew reveals that consistency alone is a dangerous quality signal.',
  },
  alternates: {
    canonical: '/blog/confident-hallucinator',
  },
};

export default function ConfidentHallucinatorPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Confident Hallucinator"
          subtitle="What we learned evaluating AI OCR across four scripts"
        >
          <p className="text-stone-400 text-sm mt-4">23 April 2026 &middot; 10 min read</p>
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
          We built a quality evaluation framework for our OCR and translation pipeline, then ran it across four script families: Latin (printed), Tibetan (manuscript), Hebrew (mixed), and Arabic (manuscript). The central finding is that consistency alone is a dangerous quality signal &mdash; a model can be perfectly consistent and completely wrong.
        </p>

        {/* --- The Framework --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Framework
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          We measure five things, three of which require no ground truth:
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          <strong>Established metrics</strong> (from the literature):
        </p>
        <ul className="text-secondary leading-relaxed mb-6 space-y-2">
          <li><strong>CER</strong> (Character Error Rate) and <strong>BLEU-4/ROUGE-L</strong> &mdash; standard OCR and translation benchmarks. We implement them but can&rsquo;t use them at scale because we don&rsquo;t have proofread reference texts for most of our 17,000+ books.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-4">
          <strong>What we&rsquo;re measuring that&rsquo;s new:</strong>
        </p>
        <ul className="text-secondary leading-relaxed mb-8 space-y-4">
          <li><strong>Modal Consistency Rate (MCR):</strong> Run the same page through a model N times at temperature=0. MCR = fraction of runs producing the majority output. Adapted from <a href="https://arxiv.org/abs/2503.16974" className="text-accent-rust hover:underline">Wang and Wang (2025)</a>, who showed 3&ndash;5 run aggregation improves LLM consistency, and Lopresti and Zhou (1996), whose consensus voting reduced OCR errors 20&ndash;50%.</li>
          <li><strong>Output Length Ratio:</strong> Compare character counts across models on the same page. If one model produces 12x more text than another, the longer one is probably generating text that isn&rsquo;t on the page.</li>
          <li><strong>Embedding-Space Distance:</strong> Embed the original-language OCR and the English translation with the same model (Gemini <code className="bg-warm px-1 py-0.5 rounded">embedding-2-preview</code>, 768 dimensions), then measure cosine distance. High distance = the translation diverged semantically from the source. This requires no reference translation.</li>
        </ul>

        {/* --- Results --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Results: The Cross-Script Matrix
        </h2>

        <div className="overflow-x-auto mb-12">
          <table className="w-full text-sm text-secondary">
            <thead>
              <tr className="border-b border-light">
                <th className="text-left py-3 pr-4 font-semibold">Script</th>
                <th className="text-left py-3 pr-4 font-semibold">Model</th>
                <th className="text-left py-3 pr-4 font-semibold">Temp</th>
                <th className="text-right py-3 pr-4 font-semibold">MCR</th>
                <th className="text-right py-3 pr-4 font-semibold">Char Sim</th>
                <th className="text-right py-3 pr-4 font-semibold">Length Ratio</th>
                <th className="text-right py-3 font-semibold">Emb Dist</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Latin</td><td className="py-2 pr-4">Flash</td><td className="py-2 pr-4">0</td><td className="py-2 pr-4 text-right">83%</td><td className="py-2 pr-4 text-right">99%</td><td className="py-2 pr-4 text-right">1.0x</td><td className="py-2 text-right">0.110</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Tibetan</td><td className="py-2 pr-4">Flash</td><td className="py-2 pr-4">0</td><td className="py-2 pr-4 text-right">89%</td><td className="py-2 pr-4 text-right">84%</td><td className="py-2 pr-4 text-right">1.0x</td><td className="py-2 text-right">0.054</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Tibetan</td><td className="py-2 pr-4">Lite</td><td className="py-2 pr-4">0</td><td className="py-2 pr-4 text-right">100%</td><td className="py-2 pr-4 text-right">100%</td><td className="py-2 pr-4 text-right">~1x</td><td className="py-2 text-right">&mdash;</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Arabic</td><td className="py-2 pr-4">Flash</td><td className="py-2 pr-4">0</td><td className="py-2 pr-4 text-right">44%</td><td className="py-2 pr-4 text-right">45%</td><td className="py-2 pr-4 text-right">1.0x</td><td className="py-2 text-right">0.120</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Arabic</td><td className="py-2 pr-4">Lite</td><td className="py-2 pr-4">0</td><td className="py-2 pr-4 text-right">100%</td><td className="py-2 pr-4 text-right">100%</td><td className="py-2 pr-4 text-right">1.8x</td><td className="py-2 text-right">&mdash;</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Hebrew</td><td className="py-2 pr-4">Flash</td><td className="py-2 pr-4">0</td><td className="py-2 pr-4 text-right">56%</td><td className="py-2 pr-4 text-right">43%</td><td className="py-2 pr-4 text-right">1.0x</td><td className="py-2 text-right">0.148</td></tr>
              <tr className="border-b border-light/50 bg-red-50/30"><td className="py-2 pr-4 font-medium">Hebrew</td><td className="py-2 pr-4">Lite</td><td className="py-2 pr-4">0</td><td className="py-2 pr-4 text-right font-bold">100%</td><td className="py-2 pr-4 text-right">100%</td><td className="py-2 pr-4 text-right font-bold text-red-700">12.7x</td><td className="py-2 text-right">&mdash;</td></tr>
            </tbody>
          </table>
        </div>

        {/* --- Latin --- */}
        <h3 className="text-xl text-primary mt-12 mb-4">
          Latin: The Baseline
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Latin printed text is easy. Gemini Flash 3 achieves 83% MCR (2 of 3 pages fully consistent, one page with minor variation: 904 vs 919 chars). Character similarity is 99.4% even across inconsistent runs &mdash; the model is reading the same text with minor punctuation differences. Embedding distance is tight at 0.110 &plusmn; 0.016. This is what healthy OCR looks like.
        </p>

        {/* --- Tibetan --- */}
        <h3 className="text-xl text-primary mt-12 mb-4">
          Tibetan: Surprisingly Good
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Both Flash and Lite achieve near-perfect consistency on these particular Tibetan pages (Bardo Thodol, Life of the Buddha &mdash; formal printed editions, not the cursive manuscripts from our <a href="/blog/ocr-consistency" className="text-accent-rust hover:underline">earlier experiment</a>). Embedding distance is remarkably low at 0.054, suggesting the translations are semantically very close to the originals. Cross-model agreement is 74%.
        </p>

        {/* --- Arabic --- */}
        <h3 className="text-xl text-primary mt-12 mb-4">
          Arabic: Unstable but Not Delusional
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Flash is remarkably inconsistent on Arabic &mdash; 44% MCR at temp=0, meaning no two of three runs agree. The Picatrix page produced three completely different readings (17% character similarity). But the output lengths are reasonable (Flash 1,284 chars, Lite 2,349 chars &mdash; a 1.8x ratio, elevated but not alarming). Flash&rsquo;s problem is instability, not hallucination.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          At temp=0.3, Lite&rsquo;s length ratio spikes to 3.4x (max 19,439 chars on one page), indicating temperature-induced hallucination. Arabic Lite should stay at temp=0.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Embedding distance for Arabic translation is 0.120 &plusmn; 0.008 &mdash; similar to Latin, suggesting the existing translations are semantically faithful despite the OCR instability.
        </p>

        {/* --- Hebrew --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Hebrew: The Confident Hallucinator
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          This is the most important finding. Flash Lite achieves <strong>100% MCR</strong> on all three Hebrew pages at temperature=0. By the MCR metric alone, it looks perfect. But look at the output lengths:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm text-secondary">
            <thead>
              <tr className="border-b border-light">
                <th className="text-left py-3 pr-4 font-semibold">Book</th>
                <th className="text-right py-3 pr-4 font-semibold">Flash chars</th>
                <th className="text-right py-3 pr-4 font-semibold">Lite chars</th>
                <th className="text-right py-3 font-semibold">Ratio</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Asis rimonim p39</td><td className="py-2 pr-4 text-right">640</td><td className="py-2 pr-4 text-right">2,859</td><td className="py-2 text-right font-bold">4.5x</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Sefer ha-bahir p20</td><td className="py-2 pr-4 text-right">621</td><td className="py-2 pr-4 text-right">4,735</td><td className="py-2 text-right font-bold">7.6x</td></tr>
              <tr className="border-b border-light/50 bg-red-50/30"><td className="py-2 pr-4">Sepher Maphteah Shelomo p96</td><td className="py-2 pr-4 text-right">587</td><td className="py-2 pr-4 text-right">15,957</td><td className="py-2 text-right font-bold text-red-700">27.2x</td></tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Flash Lite is generating <strong>4&ndash;27x more text</strong> than Flash on the same Hebrew pages. On the Key of Solomon manuscript (p96), it produces nearly 16,000 characters from a single manuscript page that Flash reads as ~587 characters. That&rsquo;s not OCR &mdash; that&rsquo;s generation. The model is writing plausible Hebrew text that has nothing to do with what&rsquo;s on the page.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          And it does this with perfect consistency. Every run, the same hallucination. <strong>MCR&nbsp;=&nbsp;100%, accuracy&nbsp;&asymp;&nbsp;0%.</strong>
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Cross-model agreement confirms the problem: <strong>10.2% character similarity</strong> between Flash and Lite, with essentially zero syllable agreement (0.1%). They&rsquo;re reading completely different texts.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The embedding eval adds another signal: the Sefer ha-bahir (p20) has an OCR&rarr;translation embedding distance of <strong>0.348</strong>, versus a corpus mean of 0.094&ndash;0.108 for the other Hebrew pages. The translation of that page is semantically distant from its source &mdash; a signal that either the OCR or the translation (or both) went wrong.
        </p>

        {/* --- Temperature --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Temperature Effects
        </h2>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm text-secondary">
            <thead>
              <tr className="border-b border-light">
                <th className="text-left py-3 pr-4 font-semibold">Script</th>
                <th className="text-left py-3 pr-4 font-semibold">Model</th>
                <th className="text-right py-3 pr-4 font-semibold">MCR@t=0</th>
                <th className="text-right py-3 pr-4 font-semibold">MCR@t=0.3</th>
                <th className="text-right py-3 font-semibold">Change</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Tibetan</td><td className="py-2 pr-4">Flash</td><td className="py-2 pr-4 text-right">89%</td><td className="py-2 pr-4 text-right">100%</td><td className="py-2 text-right text-green-700">+11%</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Tibetan</td><td className="py-2 pr-4">Lite</td><td className="py-2 pr-4 text-right">100%</td><td className="py-2 pr-4 text-right">100%</td><td className="py-2 text-right">0%</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Arabic</td><td className="py-2 pr-4">Flash</td><td className="py-2 pr-4 text-right">44%</td><td className="py-2 pr-4 text-right">33%</td><td className="py-2 text-right text-red-700">&minus;11%</td></tr>
              <tr className="border-b border-light/50 bg-red-50/30"><td className="py-2 pr-4">Arabic</td><td className="py-2 pr-4">Lite</td><td className="py-2 pr-4 text-right">100%</td><td className="py-2 pr-4 text-right">33%</td><td className="py-2 text-right font-bold text-red-700">&minus;67%</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Hebrew</td><td className="py-2 pr-4">Flash</td><td className="py-2 pr-4 text-right">56%</td><td className="py-2 pr-4 text-right">39%</td><td className="py-2 text-right text-red-700">&minus;17%</td></tr>
              <tr className="border-b border-light/50 bg-red-50/30"><td className="py-2 pr-4">Hebrew</td><td className="py-2 pr-4">Lite</td><td className="py-2 pr-4 text-right">100%</td><td className="py-2 pr-4 text-right">33%</td><td className="py-2 text-right font-bold text-red-700">&minus;67%</td></tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Temperature=0.3 devastates Flash Lite&rsquo;s consistency on Arabic and Hebrew (100% &rarr; 33%), while barely touching Tibetan. This suggests Lite&rsquo;s Hebrew/Arabic &ldquo;consistency&rdquo; at temp=0 is a fragile deterministic lock-in that shatters with any noise &mdash; exactly what you&rsquo;d expect from a model that has memorized a generation pattern rather than learned to read the script.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The Tibetan result is counterintuitive: Flash actually gets <em>more</em> consistent at temp=0.3 (89% &rarr; 100%). One possible explanation: the temp=0 mode-switching we observed might occur at a decision boundary that slight temperature noise pushes past, stabilizing into one interpretation.
        </p>

        {/* --- Triangulation --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Triangulation Principle
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          No single metric is sufficient. You need at least three signals:
        </p>

        <ol className="text-secondary leading-relaxed mb-8 space-y-4">
          <li><strong>MCR</strong> tells you if the model is stable &mdash; but a hallucinating model can be perfectly stable (Hebrew Lite at 100%).</li>
          <li><strong>Output length ratio</strong> tells you if one model is generating far more text than another &mdash; suggesting hallucination. But similar lengths don&rsquo;t guarantee similar content.</li>
          <li><strong>Embedding distance</strong> tells you if the translation is semantically close to the source &mdash; catching cases where the OCR looks fine but the translation diverged.</li>
        </ol>

        <p className="text-secondary leading-relaxed mb-8">
          Together, they triangulate quality without requiring any ground truth. For our pipeline of 17,000+ books across dozens of scripts, this is the difference between scalable quality assurance and manual review of every page.
        </p>

        {/* --- Implications --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Implications for Our Pipeline
        </h2>

        <ul className="text-secondary leading-relaxed mb-8 space-y-3">
          <li><strong>Hebrew should not use Flash Lite.</strong> It confidently hallucinates. Use Flash only, with multi-run consensus.</li>
          <li><strong>Arabic should use multi-run voting</strong> at temp=0 (Flash MCR is only 44% &mdash; 3 runs with majority vote would improve significantly).</li>
          <li><strong>Tibetan printed text</strong> is handled well by both models. Cursive manuscripts need further evaluation.</li>
          <li><strong>Latin</strong> is reliable. Single-run Flash is sufficient.</li>
          <li><strong>Embedding-based translation monitoring</strong> should be deployed pipeline-wide. Pages with OCR&rarr;translation distance &gt; 2&sigma; from their corpus mean should be flagged for review.</li>
        </ul>

        {/* --- What's known vs novel --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What We&rsquo;re Measuring vs. What&rsquo;s Known
        </h2>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm text-secondary">
            <thead>
              <tr className="border-b border-light">
                <th className="text-left py-3 pr-4 font-semibold">Metric</th>
                <th className="text-left py-3 pr-4 font-semibold">Source</th>
                <th className="text-left py-3 font-semibold">Novel aspect</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Multi-run consistency (MCR)</td><td className="py-2 pr-4">Wang &amp; Wang 2025, Lopresti &amp; Zhou 1996</td><td className="py-2">Applied to VLM OCR on historical manuscripts</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Output length ratio</td><td className="py-2 pr-4">This work</td><td className="py-2">Simple hallucination detector, no ground truth</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Embedding distance</td><td className="py-2 pr-4">This work</td><td className="py-2">Translation quality proxy without reference</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Temperature &times; model &times; script</td><td className="py-2 pr-4">This work</td><td className="py-2">Mapped interaction effects across 4 scripts</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">&ldquo;Confident hallucinator&rdquo; pattern</td><td className="py-2 pr-4">This work</td><td className="py-2">High MCR + high length ratio = systematic hallucination</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">CER, BLEU-4, ROUGE-L</td><td className="py-2 pr-4">Standard NLP</td><td className="py-2">Implemented but limited by ground truth</td></tr>
            </tbody>
          </table>
        </div>

        {/* --- Cost --- */}
        <h3 className="text-xl text-primary mt-12 mb-4">
          Cost
        </h3>

        <p className="text-secondary leading-relaxed mb-8">
          All evaluations in this post cost a total of <strong>$0.15 USD</strong> &mdash; 107 API calls across two Gemini models, four scripts, two temperatures. The embedding evaluations added ~$0.01 each. Quality evaluation at this price point is practically free relative to the cost of running the OCR pipeline itself.
        </p>

        {/* --- References --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          References
        </h2>

        <ul className="text-secondary leading-relaxed mb-8 space-y-2 text-sm">
          <li>Wang, Y. &amp; Wang, H. (2025). &ldquo;Improving LLM Consistency via Multi-Run Aggregation.&rdquo; <a href="https://arxiv.org/abs/2503.16974" className="text-accent-rust hover:underline">arXiv:2503.16974</a></li>
          <li>Lopresti, D. &amp; Zhou, J. (1996). &ldquo;Using Consensus Sequence Voting to Correct OCR Errors.&rdquo; <em>Computer Vision and Image Understanding</em>, 67(1), 39&ndash;47.</li>
          <li>Kargaran, A. H. et al. (2026). &ldquo;GlotOCR Bench: A Cross-Script OCR Benchmark for 200+ Scripts.&rdquo;</li>
          <li>&ldquo;Seeing is Believing? A Critical Examination of VLM Hallucination in OCR.&rdquo; <a href="https://arxiv.org/abs/2506.20168" className="text-accent-rust hover:underline">arXiv:2506.20168</a></li>
          <li>&ldquo;Conformal Risk Control for VLM-based OCR.&rdquo; <a href="https://arxiv.org/abs/2603.19790" className="text-accent-rust hover:underline">arXiv:2603.19790</a></li>
          <li>&ldquo;OCR Post-Correction with LLMs: No Free Lunches.&rdquo; <a href="https://arxiv.org/abs/2502.01205" className="text-accent-rust hover:underline">arXiv:2502.01205</a></li>
        </ul>

        <hr className="border-light my-12" />

        <p className="text-muted text-sm leading-relaxed">
          <strong>Technical details:</strong> Models: Gemini 3 Flash Preview, Gemini 3.1 Flash Lite Preview. Temperatures: 0, 0.3. Embedding model: Gemini embedding-2-preview (768d). 107 API calls, $0.15 total. Evaluation framework: <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/1329" className="text-accent-rust hover:underline">qa-eval</a> (open source). Raw results in <code className="bg-warm px-1 py-0.5 rounded">scripts/eval/results/</code>.
        </p>

      </article>

      <BlogComments slug="confident-hallucinator" />
    </ContentPageLayout>
  );
}
