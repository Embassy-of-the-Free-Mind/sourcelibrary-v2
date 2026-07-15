import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'The Confident Hallucinator - Research Notes - Source Library',
  description: 'AI OCR evaluation across five scripts and three Gemini model tiers. A model can be perfectly consistent and completely wrong. Thinking mode fixes what model size cannot.',
  openGraph: {
    images: [{ url: 'https://images.sourcelibrary.org/archived/6956eaf4f23ebf30578dba35/221.jpg', alt: 'Comparative table of five scripts from Agrippa\'s Occult Philosophy, 1531' }],
    title: 'The Confident Hallucinator',
    description: 'AI OCR evaluation across Latin, Tibetan, Arabic, Hebrew, and Sanskrit reveals that consistency alone is a dangerous quality signal — and thinking mode is the cure.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/6956eaf4f23ebf30578dba35/221.jpg', alt: 'Comparative table of five scripts from Agrippa\'s Occult Philosophy, 1531' }],
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
          subtitle="What we learned evaluating AI OCR across five scripts and three model tiers"
          image="https://images.sourcelibrary.org/archived/6956eaf4f23ebf30578dba35/221.jpg"
          imageAlt="Comparative table of five scripts from Agrippa's Occult Philosophy, 1531"
        >
          <p className="text-stone-400 text-sm mt-4">23&ndash;24 April 2026 &middot; 18 min read</p>
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
          We built a quality evaluation framework for our OCR and translation pipeline, then ran it across five script families and three Gemini model tiers: Flash, Flash Lite, and Pro. The central finding is that consistency alone is a dangerous quality signal &mdash; a model can be perfectly consistent and completely wrong. The follow-up finding is that thinking mode fixes what model size cannot.
        </p>

        {/* --- Table of Contents --- */}
        <nav className="bg-warm/50 rounded-lg p-6 mb-12 border border-light">
          <p className="text-sm font-semibold text-primary mb-3 uppercase tracking-wide">Contents</p>
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <div>
              <p className="font-medium text-primary mt-2 mb-1">Part I: Framework &amp; Flash vs. Lite</p>
              <ol className="text-secondary space-y-0.5 list-decimal list-inside">
                <li><a href="#framework" className="text-accent-rust hover:underline">The Framework</a></li>
                <li><a href="#cross-script" className="text-accent-rust hover:underline">Cross-Script Matrix</a></li>
                <li><a href="#hebrew-hallucinator" className="text-accent-rust hover:underline">Hebrew: The Confident Hallucinator</a></li>
                <li><a href="#temperature" className="text-accent-rust hover:underline">Temperature Effects</a></li>
                <li><a href="#sanskrit" className="text-accent-rust hover:underline">Sanskrit: High Agreement, Low Consistency</a></li>
                <li><a href="#triangulation" className="text-accent-rust hover:underline">The Triangulation Principle</a></li>
                <li><a href="#embedding-survey" className="text-accent-rust hover:underline">Embedding Survey</a></li>
              </ol>
            </div>
            <div>
              <p className="font-medium text-primary mt-2 mb-1">Part II: Does Pro Fix It?</p>
              <ol className="text-secondary space-y-0.5 list-decimal list-inside" start={8}>
                <li><a href="#pro-eval" className="text-accent-rust hover:underline">Adding Gemini Pro to the Matrix</a></li>
                <li><a href="#manuscript-vs-print" className="text-accent-rust hover:underline">Manuscript vs. Print: The Real Variable</a></li>
                <li><a href="#thinking-mode" className="text-accent-rust hover:underline">Thinking Mode: The Cure</a></li>
                <li><a href="#media-resolution" className="text-accent-rust hover:underline">Media Resolution: No Effect</a></li>
                <li><a href="#thinking-hypothesis" className="text-accent-rust hover:underline">Why Flash Never Hallucinated</a></li>
                <li><a href="#implications" className="text-accent-rust hover:underline">Implications</a></li>
                <li><a href="#references" className="text-accent-rust hover:underline">References &amp; Cost</a></li>
              </ol>
            </div>
          </div>
        </nav>

        {/* ================================================================ */}
        {/* PART I */}
        {/* ================================================================ */}

        <div className="border-b border-light pb-2 mb-12">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">Part I</p>
          <p className="text-lg text-primary font-medium">Framework &amp; Flash vs. Lite</p>
        </div>

        {/* --- The Framework --- */}
        <h2 id="framework" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          1. The Framework
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
        <h2 id="cross-script" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          2. Cross-Script Matrix
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Initial evaluation: Gemini Flash 3 vs. Flash Lite 3.1 across five scripts.
        </p>

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
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Sanskrit</td><td className="py-2 pr-4">Flash</td><td className="py-2 pr-4">0</td><td className="py-2 pr-4 text-right">44%</td><td className="py-2 pr-4 text-right">98%</td><td className="py-2 pr-4 text-right">1.2x</td><td className="py-2 text-right">0.105</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Sanskrit</td><td className="py-2 pr-4">Lite</td><td className="py-2 pr-4">0</td><td className="py-2 pr-4 text-right">89%</td><td className="py-2 pr-4 text-right">100%</td><td className="py-2 pr-4 text-right">1.1x</td><td className="py-2 text-right">&mdash;</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-xl text-primary mt-12 mb-4">
          Latin: The Baseline
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Latin printed text is easy. Gemini Flash 3 achieves 83% MCR (2 of 3 pages fully consistent, one page with minor variation: 904 vs 919 chars). Character similarity is 99.4% even across inconsistent runs &mdash; the model is reading the same text with minor punctuation differences. Embedding distance is tight at 0.110 &plusmn; 0.016. This is what healthy OCR looks like.
        </p>

        <h3 className="text-xl text-primary mt-12 mb-4">
          Tibetan: Surprisingly Good
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Both Flash and Lite achieve near-perfect consistency on these particular Tibetan pages (Bardo Thodol, Life of the Buddha &mdash; formal printed editions, not the cursive manuscripts from our <a href="/blog/ocr-consistency" className="text-accent-rust hover:underline">earlier experiment</a>). Embedding distance is remarkably low at 0.054, suggesting the translations are semantically very close to the originals. Cross-model agreement is 74%.
        </p>

        <h3 className="text-xl text-primary mt-12 mb-4">
          Arabic: Unstable but Not Delusional
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Flash is remarkably inconsistent on Arabic &mdash; 44% MCR at temp=0, meaning no two of three runs agree. The Picatrix page produced three completely different readings (17% character similarity). But the output lengths are reasonable (Flash 1,284 chars, Lite 2,349 chars &mdash; a 1.8x ratio, elevated but not alarming). Flash&rsquo;s problem is instability, not hallucination.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Embedding distance for Arabic translation is 0.120 &plusmn; 0.008 &mdash; similar to Latin, suggesting the existing translations are semantically faithful despite the OCR instability.
        </p>

        {/* --- Hebrew --- */}
        <h2 id="hebrew-hallucinator" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          3. Hebrew: The Confident Hallucinator
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          This is the most important finding from Part I. Flash Lite achieves <strong>100% MCR</strong> on all three Hebrew pages at temperature=0. By the MCR metric alone, it looks perfect. But look at the output lengths:
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

        <p className="text-secondary leading-relaxed mb-8">
          And it does this with perfect consistency. Every run, the same hallucination. <strong>MCR&nbsp;=&nbsp;100%, accuracy&nbsp;&asymp;&nbsp;0%.</strong>
        </p>

        {/* --- Side-by-side comparison --- */}
        <h3 className="text-xl text-primary mt-12 mb-4">
          Side by Side: Sepher Maphteah Shelomo, Page 96
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Here is the actual OCR output from both models on the same page of the <a href="/book/sepher-maphteah-shelomo-book-of-the-key-of-solomon-anonymous" className="text-accent-rust hover:underline">Key of Solomon</a> manuscript. Flash reads a specific passage about a silver amulet inscribed with divine names. Lite starts similarly, then enters a generative loop &mdash; repeating &ldquo;this is a great and hidden secret from all the wise of heart&rdquo; for 16,000 characters.
        </p>

        {/* Source page image */}
        <div className="mb-6">
          <p className="text-xs text-muted mb-2 uppercase tracking-wide">Source manuscript page</p>
          <img
            src="https://images.sourcelibrary.org/archived/695285cdab34727b1f04c25a/96.jpg"
            alt="Page 96 of Sepher Maphteah Shelomo (Key of Solomon), a Hebrew magical manuscript"
            className="w-full max-w-lg rounded border border-light"
            loading="lazy"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Flash output */}
          <div className="border border-light rounded-lg overflow-hidden">
            <div className="bg-green-50 px-4 py-2 border-b border-light">
              <p className="text-sm font-semibold text-green-800">Gemini Flash 3 &mdash; 552 chars</p>
              <p className="text-xs text-green-600">MCR 33% &middot; 3 different outputs &middot; Unstable but plausible</p>
            </div>
            <div className="p-4 text-sm text-secondary leading-relaxed font-mono direction-rtl text-right max-h-64 overflow-y-auto" dir="rtl">
              &#1502;&#1494;<br/>
              &#1511;&#1495; &#1500;&#1498; &#1502;&#1496;&#1497;&#1500; &#1513;&#1500; &#1499;&#1505;&#1507; &#1510;&#1512;&#1493;&#1507; &#1493;&#1497;&#1492;&#1497; &#1502;&#1513;&#1511;&#1500;&#1493; &#1495;&#1502;&#1513;&#1492; &#1494;&#1492;&#1493;&#1489;&#1497;&#1501; &#1493;&#1497;&#1492;&#1497; &#1506;&#1490;&#1493;&#1500; &#1493;&#1495;&#1511;&#1493;&#1511; &#1506;&#1500;&#1497;&#1493; &#1488;&#1500;&#1493; &#1492;&#1513;&#1502;&#1493;&#1514;<br/>
              &#1493;&#1492;&#1513;&#1502;&#1493;&#1514; &#1492;&#1502;&#1492; &#1488;&#1500;&#1493;: &#1497;&#1492;&#1493;&#1492; &#1510;&#1489;&#1488;&#1493;&#1514; &#1488;&#1500;&#1492;&#1497; &#1497;&#1513;&#1512;&#1488;&#1500; : &#1493;&#1502;&#1503; &#1492;&#1510;&#1491; &#1492;&#1513;&#1504;&#1497; &#1513;&#1500; &#1492;&#1502;&#1496;&#1497;&#1500; &#1497;&#1492;&#1497;&#1492;<br/>
              &#1495;&#1511;&#1493;&#1511; &#1513;&#1501; &#1492;&#1502;&#1508;&#1493;&#1512;&#1513; &#1493;&#1492;&#1493;&#1488; &#1488;&#1490;&#1500;&#1488; &#1488;&#1490;&#1500;&#1488; &#1488;&#1490;&#1500;&#1488; : &#1493;&#1497;&#1492;&#1497; &#1492;&#1502;&#1496;&#1497;&#1500; &#1492;&#1494;&#1492; &#1514;&#1500;&#1493;&#1497; &#1489;&#1510;&#1493;&#1488;&#1512;&#1498;<br/>
              &#1493;&#1511;&#1493;&#1491;&#1501; &#1513;&#1514;&#1514;&#1500;&#1492; &#1488;&#1493;&#1514;&#1493; &#1489;&#1510;&#1493;&#1488;&#1512;&#1498; &#1514;&#1488;&#1502;&#1512; &#1488;&#1500;&#1493; &#1492;&#1513;&#1502;&#1493;&#1514; &#1513;&#1489;&#1506; &#1508;&#1506;&#1502;&#1497;&#1501; &#1489;&#1499;&#1500; &#1497;&#1493;&#1501; ~
            </div>
          </div>

          {/* Lite output */}
          <div className="border border-red-200 rounded-lg overflow-hidden">
            <div className="bg-red-50 px-4 py-2 border-b border-red-200">
              <p className="text-sm font-semibold text-red-800">Gemini Flash Lite &mdash; 15,957 chars</p>
              <p className="text-xs text-red-600">MCR 100% &middot; 3 identical outputs &middot; Deterministic hallucination</p>
            </div>
            <div className="p-4 text-sm text-secondary leading-relaxed font-mono direction-rtl text-right max-h-64 overflow-y-auto" dir="rtl">
              &#1502;&#1494;<br/>
              &#1494;&#1492; &#1513;&#1500;&#1501;. &#1493;&#1491;&#1506; &#1499;&#1497; &#1489;&#1497;&#1493;&#1501; &#1494;&#1492; &#1514;&#1506;&#1513;&#1492; &#1492;&#1496;&#1489;&#1506;&#1514; &#1492;&#1494;&#1488;&#1514; &#1493;&#1514;&#1495;&#1512;&#1493;&#1496; &#1506;&#1500;&#1497;&#1492; &#1492;&#1513;&#1502;&#1493;&#1514; &#1492;&#1488;&#1500;&#1492;<br/>
              &#1493;&#1492;&#1513;&#1502;&#1493;&#1514; &#1492;&#1501;: &#1488;&#1490;&#1500;&#1488; &#1488;&#1490;&#1500;&#1488; &#1488;&#1490;&#1500;&#1488; &#1488;&#1490;&#1500;&#1488;<br/>
              &#1493;&#1491;&#1506; &#1513;&#1494;&#1492; &#1492;&#1513;&#1501; &#1492;&#1493;&#1488; &#1490;&#1491;&#1493;&#1500; &#1493;&#1511;&#1491;&#1493;&#1513; &#1493;&#1489;&#1493; &#1514;&#1506;&#1513;&#1492; &#1499;&#1500; &#1495;&#1508;&#1510;&#1498;<br/>
              &#1493;&#1514;&#1506;&#1513;&#1492; &#1492;&#1496;&#1489;&#1506;&#1514; &#1489;&#1497;&#1493;&#1501; &#1492;&apos; &#1489;&#1513;&#1506;&#1492; &#1512;&#1488;&#1513;&#1493;&#1504;&#1492; &#1513;&#1500; &#1497;&#1493;&#1501; &#1493;&#1514;&#1495;&#1512;&#1493;&#1496; &#1506;&#1500;&#1497;&#1492; &#1492;&#1513;&#1502;&#1493;&#1514; &#1492;&#1488;&#1500;&#1492;<br/>
              &#1493;&#1514;&#1506;&#1513;&#1492; &#1492;&#1496;&#1489;&#1506;&#1514; &#1502;&#1494;&#1492;&#1489; &#1488;&#1493; &#1502;&#1499;&#1505;&#1507; &#1493;&#1514;&#1500;&#1489;&#1513; &#1488;&#1493;&#1514;&#1492; &#1493;&#1514;&#1506;&#1513;&#1492; &#1499;&#1500; &#1495;&#1508;&#1510;&#1498;<br/>
              ...<br/>
              <span className="text-red-500 italic">[continues for 15,000 more characters of repetitive generated text]</span>
            </div>
          </div>
        </div>

        <p className="text-secondary leading-relaxed mb-4">
          <strong>In translation:</strong>
        </p>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-green-50/50 rounded-lg p-4 border border-green-100">
            <p className="text-xs text-green-700 font-semibold mb-2 uppercase tracking-wide">Flash (reading)</p>
            <p className="text-sm text-secondary leading-relaxed">
              &ldquo;47. Take for yourself a disc of pure silver, and let its weight be five gold coins, and let it be round, and engrave upon it these names. And the names are these: YHVH Tzevaot, God of Israel. And on the other side of the disc shall be engraved the Explicit Name, which is AGLA AGLA AGLA. And let this disc be hung upon your neck, and before you hang it upon your neck say these names seven times each day...&rdquo;
            </p>
          </div>
          <div className="bg-red-50/50 rounded-lg p-4 border border-red-100">
            <p className="text-xs text-red-700 font-semibold mb-2 uppercase tracking-wide">Lite (generating)</p>
            <p className="text-sm text-secondary leading-relaxed">
              &ldquo;47. This is complete. And know that on this day you shall make this ring and engrave upon it these names. And the names are: AGLA AGLA AGLA AGLA. And know that this name is great and holy and with it you shall do all your desires. And make the ring on Thursday in the first hour of the day... And this is a great secret hidden from all the wise of heart. And this is a great secret hidden from all the wise of heart. And this is a great secret hidden from...&rdquo;
              <span className="text-red-500 italic"> [repeats for 16,000 characters]</span>
            </p>
          </div>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Flash reads a specific instruction &mdash; take silver, weigh it, engrave divine names on both sides, wear it as an amulet. Lite starts in the same vicinity but quickly diverges into a generative loop, producing plausible Kabbalistic language (&ldquo;great and holy,&rdquo; &ldquo;hidden secret&rdquo;) that reads like a pastiche of Jewish magical texts rather than a transcription of this particular manuscript.
        </p>

        {/* --- Temperature --- */}
        <h2 id="temperature" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          4. Temperature Effects
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
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Sanskrit</td><td className="py-2 pr-4">Flash</td><td className="py-2 pr-4 text-right">44%</td><td className="py-2 pr-4 text-right">44%</td><td className="py-2 text-right">0%</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Sanskrit</td><td className="py-2 pr-4">Lite</td><td className="py-2 pr-4 text-right">89%</td><td className="py-2 pr-4 text-right">56%</td><td className="py-2 text-right text-red-700">&minus;33%</td></tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Temperature=0.3 devastates Flash Lite&rsquo;s consistency on Arabic and Hebrew (100% &rarr; 33%), while barely touching Tibetan. This suggests Lite&rsquo;s Hebrew/Arabic &ldquo;consistency&rdquo; at temp=0 is a fragile deterministic lock-in that shatters with any noise &mdash; exactly what you&rsquo;d expect from a model that has memorized a generation pattern rather than learned to read the script.
        </p>

        {/* --- Sanskrit --- */}
        <h2 id="sanskrit" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          5. Sanskrit: High Agreement, Low Consistency
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Sanskrit produces a pattern unlike any other script in our evaluation. Cross-model agreement is <strong>98.8%</strong> at the character level &mdash; Flash and Lite are reading essentially the same text. But MCR is only 44% for Flash, meaning 3 runs produce 3 &ldquo;different&rdquo; outputs.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The answer is that MCR is too strict. With 98.3% character similarity, runs differ by only ~30 characters out of 1,700 &mdash; a handful of ambiguous glyphs in dense Devanagari. This is the opposite failure mode from Hebrew: Hebrew Lite has high MCR (100%) but low accuracy. Sanskrit Flash has low MCR (44%) but high accuracy (98.3%). <strong>MCR and character similarity tell different stories</strong> &mdash; you need both.
        </p>

        {/* --- Triangulation --- */}
        <h2 id="triangulation" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          6. The Triangulation Principle
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

        {/* --- Embedding survey --- */}
        <h2 id="embedding-survey" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          7. Manuscript vs. Print: The Embedding Survey
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Our initial embedding evaluations used 3&ndash;5 pages per language &mdash; enough to spot outliers like the Sefer ha-bahir, but too few for reliable cross-language comparison. We ran a properly powered survey: 20 pages per cell, 5 languages &times; 2 conditions (manuscript vs. print), 182 pages total, stratified across different books and skipping title pages.
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm text-secondary">
            <thead>
              <tr className="border-b border-light">
                <th className="text-left py-3 pr-4 font-semibold">Language</th>
                <th className="text-right py-3 pr-4 font-semibold">Manuscript</th>
                <th className="text-right py-3 pr-4 font-semibold">Print</th>
                <th className="text-right py-3 pr-4 font-semibold">&Delta;</th>
                <th className="text-right py-3 font-semibold">N</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Greek</td><td className="py-2 pr-4 text-right">0.118</td><td className="py-2 pr-4 text-right font-medium">0.113</td><td className="py-2 pr-4 text-right">+0.005</td><td className="py-2 text-right">40</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Arabic</td><td className="py-2 pr-4 text-right">0.140</td><td className="py-2 pr-4 text-right font-medium">0.124</td><td className="py-2 pr-4 text-right">+0.016</td><td className="py-2 text-right">40</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Hebrew</td><td className="py-2 pr-4 text-right">0.149</td><td className="py-2 pr-4 text-right font-medium">0.127</td><td className="py-2 pr-4 text-right">+0.022</td><td className="py-2 text-right">40</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Latin</td><td className="py-2 pr-4 text-right">0.164</td><td className="py-2 pr-4 text-right font-medium">0.129</td><td className="py-2 pr-4 text-right">+0.035</td><td className="py-2 text-right">40</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Sanskrit</td><td className="py-2 pr-4 text-right text-muted">0.210 <span className="text-xs">(n=2)</span></td><td className="py-2 pr-4 text-right font-medium">0.144</td><td className="py-2 pr-4 text-right">+0.066</td><td className="py-2 text-right">22</td></tr>
            </tbody>
          </table>
          <p className="text-xs text-muted mt-2">Cosine distance between OCR embedding and translation embedding (lower = better alignment). 20 pages per cell, sampled across different books. Embedding model: Gemini embedding-2-preview (768d).</p>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Three findings change the story:
        </p>

        <ol className="text-secondary leading-relaxed mb-8 space-y-4">
          <li><strong>Manuscripts always have higher embedding distance than print.</strong> Every language shows the same direction. Harder-to-read text &rarr; more OCR errors &rarr; translation built on worse input &rarr; higher semantic divergence. The gap ranges from almost nothing (Greek, +0.005) to substantial (Latin, +0.035).</li>
          <li><strong>The manuscript/print distinction matters more than language.</strong> Latin manuscripts (0.164) are worse than Hebrew print (0.127). The condition &mdash; handwritten vs. typeset &mdash; is a stronger predictor of translation quality than the script itself.</li>
          <li><strong>Hebrew is not uniquely bad.</strong> Our initial 5-page sample showed a 0.348 outlier on the Sefer ha-bahir that inflated the mean. With 20 pages per cell, Hebrew print (0.127) and manuscript (0.149) are comparable to Arabic and Latin. The earlier result was a sampling artifact, not a language-level problem.</li>
        </ol>

        <p className="text-secondary leading-relaxed mb-8">
          Greek has the best alignment overall (0.113&ndash;0.118), with manuscripts nearly as good as print. This may reflect stronger training data for Greek in the embedding model, or it may be that the Greek manuscripts in our collection (Bodleian Library) are particularly clean.
        </p>

        {/* ================================================================ */}
        {/* PART II */}
        {/* ================================================================ */}

        <div className="border-b border-light pb-2 mb-12 mt-20">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">Part II</p>
          <p className="text-lg text-primary font-medium">Does Pro Fix It?</p>
          <p className="text-xs text-muted mt-1">Added 24 April 2026, after <a href="https://x.com/shabornikov" className="text-accent-rust hover:underline">Shiv Shankar&rsquo;s</a> question: &ldquo;I wonder if flash vs pro shows similar trends&rdquo;</p>
        </div>

        {/* --- Pro eval --- */}
        <h2 id="pro-eval" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          8. Adding Gemini Pro to the Matrix
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          We ran the same evaluation with Gemini 3.1 Pro Preview added to Flash and Flash Lite. Pro is 5x more expensive than Flash and 33x more expensive than Lite. The question: does the bigger model avoid the hallucination trap?
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm text-secondary">
            <thead>
              <tr className="border-b border-light">
                <th className="text-left py-3 pr-4 font-semibold">Script</th>
                <th className="text-left py-3 pr-4 font-semibold">Book</th>
                <th className="text-right py-3 pr-4 font-semibold">Pro</th>
                <th className="text-right py-3 pr-4 font-semibold">Flash</th>
                <th className="text-right py-3 pr-4 font-semibold">Lite</th>
                <th className="text-right py-3 font-semibold">Pro/Flash</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Latin</td><td className="py-2 pr-4">De natura elementorum</td><td className="py-2 pr-4 text-right">918</td><td className="py-2 pr-4 text-right">909</td><td className="py-2 pr-4 text-right text-muted">&mdash;</td><td className="py-2 text-right">1.0x</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Latin</td><td className="py-2 pr-4">De Voluptate</td><td className="py-2 pr-4 text-right">831</td><td className="py-2 pr-4 text-right">~830</td><td className="py-2 pr-4 text-right text-muted">&mdash;</td><td className="py-2 text-right">1.0x</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Arabic</td><td className="py-2 pr-4">Picatrix</td><td className="py-2 pr-4 text-right">844</td><td className="py-2 pr-4 text-right">828</td><td className="py-2 pr-4 text-right">3,433</td><td className="py-2 text-right">1.0x</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Arabic</td><td className="py-2 pr-4">Alchemical Compendium</td><td className="py-2 pr-4 text-right">1,242</td><td className="py-2 pr-4 text-right">1,228</td><td className="py-2 pr-4 text-right">1,233</td><td className="py-2 text-right">1.0x</td></tr>
              <tr className="border-b border-light/50 bg-red-50/30"><td className="py-2 pr-4 font-medium">Hebrew</td><td className="py-2 pr-4">Asis rimonim (MS)</td><td className="py-2 pr-4 text-right font-bold text-red-700">16,400</td><td className="py-2 pr-4 text-right">660</td><td className="py-2 pr-4 text-right text-red-700">17,868</td><td className="py-2 text-right font-bold text-red-700">24.8x</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Hebrew</td><td className="py-2 pr-4">Sefer ha-bahir (print)</td><td className="py-2 pr-4 text-right">640</td><td className="py-2 pr-4 text-right">619</td><td className="py-2 pr-4 text-right text-red-700">4,502</td><td className="py-2 text-right">1.0x</td></tr>
              <tr className="border-b border-light/50 bg-red-50/30"><td className="py-2 pr-4 font-medium">Hebrew</td><td className="py-2 pr-4">Key of Solomon (MS)</td><td className="py-2 pr-4 text-right font-bold text-red-700">10,165</td><td className="py-2 pr-4 text-right">599</td><td className="py-2 pr-4 text-right text-red-700">12,050</td><td className="py-2 text-right font-bold text-red-700">17.0x</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Sanskrit</td><td className="py-2 pr-4">Gheranda Samhita</td><td className="py-2 pr-4 text-right">1,513</td><td className="py-2 pr-4 text-right">1,456</td><td className="py-2 pr-4 text-right">1,456</td><td className="py-2 text-right">1.0x</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Sanskrit</td><td className="py-2 pr-4">Shiva Samhita</td><td className="py-2 pr-4 text-right">1,793</td><td className="py-2 pr-4 text-right">1,437</td><td className="py-2 pr-4 text-right">1,772</td><td className="py-2 text-right">1.2x</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4 font-medium">Tibetan</td><td className="py-2 pr-4">Bardo Thodol</td><td className="py-2 pr-4 text-right">31</td><td className="py-2 pr-4 text-right">31</td><td className="py-2 pr-4 text-right">31</td><td className="py-2 text-right">1.0x</td></tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Pro hallucinates on the exact same pages as Lite.</strong> On the Asis rimonim manuscript, Pro generates 16,400 characters versus Flash&rsquo;s 660 &mdash; a 25x ratio. On the Key of Solomon, 10,165 versus 599 &mdash; a 17x ratio. Pro is even <em>worse</em> than Lite on the Asis rimonim page.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Cross-model agreement between Pro and Flash on Hebrew is <strong>10.0%</strong> &mdash; they are reading completely different texts. Pro and Lite agree at 45.4%, united in hallucination but diverging in content. Pro cost <strong>$0.76</strong> for these 9 pages versus Flash&rsquo;s <strong>$0.01</strong>. Fifty-five times more expensive to hallucinate.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          On every other script &mdash; Latin, Arabic, Sanskrit, Tibetan &mdash; Pro is excellent. It achieves 100% MCR on Latin (vs Flash&rsquo;s 83%) and 100% on Arabic (vs Flash&rsquo;s 44%). <strong>Model size helps where the problem is instability, not where it&rsquo;s hallucination.</strong>
        </p>

        {/* --- Manuscript vs Print --- */}
        <h2 id="manuscript-vs-print" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          9. Manuscript vs. Print: The Real Variable
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          But look at the Hebrew results more carefully. The Sefer ha-bahir &mdash; a <em>printed</em> text from 1651 &mdash; shows normal output lengths across all three models: Pro 640, Flash 619, Lite 4,502 (Lite still hallucinated, but less dramatically). The two manuscript pages are where Pro and Lite both explode.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          To test this hypothesis, we ran Pro on the <a href="/book/prague-haggadah-1526-anonymous" className="text-accent-rust hover:underline">Prague Haggadah</a> (1526), a <em>printed</em> Hebrew text with a well-known liturgical passage:
        </p>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-green-50/50 rounded-lg p-4 border border-green-100">
            <p className="text-xs text-green-700 font-semibold mb-2 uppercase tracking-wide">Pro on printed Hebrew &mdash; 177 chars</p>
            <p className="text-sm text-secondary leading-relaxed font-mono" dir="rtl">
              &#1492;&#1488;<br/>
              &#1500;&#1463;&#1495;&#1456;&#1502;&#1464;&#1488; &#1506;&#1463;&#1504;&#1456;&#1497;&#1464;&#1488; &#1491;&#1460;&#1497; &#1488;&#1458;&#1499;&#1463;&#1500;&#1468;&#1493;&#1468;<br/>
              &#1488;&#1458;&#1489;&#1464;&#1492;&#1464;&#1514;&#1464;&#1504;&#1464;&#1488; &#1489;&#1468;&#1456;<br/>
              &#1489;&#1468;&#1456;&#1488;&#1463;&#1512;&#1456;&#1506;&#1464;&#1488; &#1491;&#1456;&#1502;&#1460;&#1510;&#1456;&#1512;&#1464;&#1497;&#1460;&#1501;<br/>
              &#1499;&#1464;&#1468;&#1500; &#1491;&#1460;&#1499;&#1456;&#1508;&#1460;&#1497;&#1503; &#1497;&#1461;&#1497;&#1514;&#1461;&#1497; &#1493;&#1456;&#1497;&#1461;&#1497;&#1499;&#1493;&#1468;&#1500;<br/>
              &#1499;&#1464;&#1468;&#1500; &#1491;&#1460;&#1510;&#1456;&#1512;&#1460;&#1497;&#1498;&#1456; &#1497;&#1461;&#1497;&#1514;&#1461;&#1497; &#1493;&#1456;&#1497;&#1460;&#1508;&#1456;&#1505;&#1463;&#1495;<br/>
              &#1492;&#1464;&#1513;&#1473;&#1463;&#1514;&#1468;&#1464;&#1488; &#1492;&#1464;&#1499;&#1464;&#1488;<br/>
              &#1500;&#1456;&#1513;&#1473;&#1464;&#1504;&#1464;&#1492; &#1492;&#1463;&#1489;&#1468;&#1464;&#1488;&#1464;&#1492; &#1489;&#1468;&#1456;&#1488;&#1463;&#1512;&#1456;&#1506;&#1464;
            </p>
          </div>
          <div className="bg-green-50/50 rounded-lg p-4 border border-green-100">
            <p className="text-xs text-green-700 font-semibold mb-2 uppercase tracking-wide">Ha Lachma Anya &mdash; known text</p>
            <p className="text-sm text-secondary leading-relaxed italic">
              &ldquo;This is the bread of affliction that our ancestors ate in the land of Egypt. All who are hungry, come and eat. All who are in need, come and celebrate Passover. Now we are here; next year in the land...&rdquo;
            </p>
            <p className="text-xs text-muted mt-2">This is the opening of the Passover Haggadah, recited identically in every Jewish household for centuries. Pro reads it perfectly.</p>
          </div>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>The hallucination is not about Hebrew. It&rsquo;s about manuscripts.</strong> All three models handle printed Hebrew correctly. The confident hallucinator pattern is triggered specifically by cursive handwritten text &mdash; particularly magical manuscripts with repetitive divine names that give the model a &ldquo;seed&rdquo; for its generative loop.
        </p>

        {/* --- Thinking Mode --- */}
        <h2 id="thinking-mode" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          10. Thinking Mode: The Cure
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          After Shiv suggested testing with thinking mode, we ran an ablation study on the Key of Solomon p96 &mdash; the page where Pro generates 10,117 characters of hallucinated text:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm text-secondary">
            <thead>
              <tr className="border-b border-light">
                <th className="text-left py-3 pr-4 font-semibold">Variant</th>
                <th className="text-right py-3 pr-4 font-semibold">Output</th>
                <th className="text-right py-3 pr-4 font-semibold">Think tokens</th>
                <th className="text-right py-3 pr-4 font-semibold">Time</th>
                <th className="text-left py-3 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light/50 bg-red-50/30"><td className="py-2 pr-4">Pro baseline</td><td className="py-2 pr-4 text-right font-bold text-red-700">10,117</td><td className="py-2 pr-4 text-right">0</td><td className="py-2 pr-4 text-right">56s</td><td className="py-2 text-red-700">Hallucinating &mdash; AGLA loop</td></tr>
              <tr className="border-b border-light/50 bg-red-50/30"><td className="py-2 pr-4">Pro + high resolution</td><td className="py-2 pr-4 text-right font-bold text-red-700">10,117</td><td className="py-2 pr-4 text-right">0</td><td className="py-2 pr-4 text-right">53s</td><td className="py-2 text-red-700">Identical hallucination</td></tr>
              <tr className="border-b border-light/50 bg-green-50/30"><td className="py-2 pr-4 font-bold">Pro + thinking</td><td className="py-2 pr-4 text-right font-bold text-green-700">1,009</td><td className="py-2 pr-4 text-right">2,997</td><td className="py-2 pr-4 text-right">31s</td><td className="py-2 text-green-700">Reads actual content</td></tr>
              <tr className="border-b border-light/50 bg-green-50/30"><td className="py-2 pr-4">Pro + thinking + high res</td><td className="py-2 pr-4 text-right text-green-700">566</td><td className="py-2 pr-4 text-right">7,680</td><td className="py-2 pr-4 text-right">56s</td><td className="py-2 text-green-700">Most constrained reading</td></tr>
              <tr className="border-b border-light/50 bg-green-50/30"><td className="py-2 pr-4">Pro + low resolution</td><td className="py-2 pr-4 text-right text-green-700">1,064</td><td className="py-2 pr-4 text-right">5,663</td><td className="py-2 pr-4 text-right">55s</td><td className="py-2 text-green-700">No hallucination</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Flash baseline</td><td className="py-2 pr-4 text-right">622</td><td className="py-2 pr-4 text-right text-muted">n/a</td><td className="py-2 pr-4 text-right">33s</td><td className="py-2">Clean reading</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Flash + high resolution</td><td className="py-2 pr-4 text-right">622</td><td className="py-2 pr-4 text-right text-muted">n/a</td><td className="py-2 pr-4 text-right">33s</td><td className="py-2">Identical to baseline</td></tr>
              <tr className="border-b border-light/50 bg-amber-50/30"><td className="py-2 pr-4">Flash + low resolution</td><td className="py-2 pr-4 text-right">122</td><td className="py-2 pr-4 text-right text-muted">n/a</td><td className="py-2 pr-4 text-right">33s</td><td className="py-2 text-amber-700">Wrong script (Mandaic)</td></tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Thinking mode eliminates the hallucination.</strong> Pro + thinking produces 1,009 characters of actual manuscript content: pottery vessels, divine seals, healing instructions, lead amulets. The 2,997 thinking tokens apparently let the model reason about what&rsquo;s actually on the page before generating, breaking the repetitive loop. With thinking + high resolution, the model uses its full thinking budget (7,680 tokens) and produces the most constrained reading at 566 characters &mdash; close to Flash&rsquo;s 622.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          <strong>What Pro + thinking reads:</strong>
        </p>

        <div className="bg-green-50/50 rounded-lg p-4 border border-green-100 mb-8">
          <p className="text-sm text-secondary leading-relaxed">
            &ldquo;47. He recited over it. And make a clean pottery vessel on the sea of the west, etc., to immerse... Take a new clay vessel and dig in the earth. Take this seal and carve for it, and it shall not touch flesh, and upon all weapons they shall not touch you. And this is the form of the seal of copper, and this is: and write around it these names &mdash; Ehyeh Asher Ehyeh, Tzevaot, God of Israel, Amen, Netzach, Selah... Take a piece of lead and engrave upon it these names and bind it on the arm of the sick person, and he shall be healed immediately with the help of God, blessed be He, Amen.&rdquo;
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Compare this with Pro&rsquo;s baseline output on the same page, which reads the first few lines then collapses into &ldquo;AGLA AGLA AGLA AGLA...&rdquo; repeated hundreds of times until hitting the token limit. The thinking model reads specific instructions about seals, amulets, and healing &mdash; the actual content of a magical manuscript.
        </p>

        {/* --- Media Resolution --- */}
        <h2 id="media-resolution" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          11. Media Resolution: No Effect
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Shiv also suggested testing <code className="bg-warm px-1 py-0.5 rounded">mediaResolution</code> levels. Results: resolution changes do not affect the hallucination.
        </p>

        <ul className="text-secondary leading-relaxed mb-6 space-y-3">
          <li><strong>Pro + high resolution</strong> produces the <em>identical</em> 10,117-character hallucination as baseline. The vision encoder already has enough detail; the problem is downstream in generation.</li>
          <li><strong>Flash + high resolution</strong> produces byte-for-byte identical output to Flash baseline (622 chars). Resolution is irrelevant for a model that already reads correctly.</li>
          <li><strong>Flash + low resolution</strong> is the one surprise: it outputs 122 characters of <strong>Mandaic script</strong> instead of Hebrew. Reducing the image to 298 input tokens (vs. 1,124 at default) causes Flash to misidentify the script entirely &mdash; a different failure mode than hallucination.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-8">
          The takeaway: the confident hallucinator pattern is a <strong>generation problem, not a perception problem</strong>. The model sees the page fine; it just can&rsquo;t stop generating once it starts. Thinking mode is the intervention because it operates on the generation side.
        </p>

        {/* --- The Thinking Hypothesis --- */}
        <h2 id="thinking-hypothesis" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          12. The Thinking Hypothesis: Why Flash Never Hallucinated
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          A follow-up test revealed something we hadn&rsquo;t considered: <strong>Flash uses thinking by default.</strong> Even without any <code className="bg-warm px-1 py-0.5 rounded">thinkingConfig</code> in the API call, Flash produces ~7,700 thinking tokens on every OCR request. Flash Lite produces zero.
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm text-secondary">
            <thead>
              <tr className="border-b border-light">
                <th className="text-left py-3 pr-4 font-semibold">Model</th>
                <th className="text-left py-3 pr-4 font-semibold">Config</th>
                <th className="text-right py-3 pr-4 font-semibold">Output</th>
                <th className="text-right py-3 pr-4 font-semibold">Think tokens</th>
                <th className="text-left py-3 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Flash</td><td className="py-2 pr-4">default (no config)</td><td className="py-2 pr-4 text-right">622</td><td className="py-2 pr-4 text-right font-bold">7,681</td><td className="py-2 text-green-700">Clean &mdash; <strong>thinks by default</strong></td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Flash</td><td className="py-2 pr-4">thinkingLevel: HIGH</td><td className="py-2 pr-4 text-right">552</td><td className="py-2 pr-4 text-right">7,678</td><td className="py-2 text-green-700">Clean &mdash; same think budget</td></tr>
              <tr className="border-b border-light/50 bg-red-50/30"><td className="py-2 pr-4">Lite</td><td className="py-2 pr-4">default (no config)</td><td className="py-2 pr-4 text-right font-bold text-red-700">10,096</td><td className="py-2 pr-4 text-right font-bold text-red-700">0</td><td className="py-2 text-red-700">Hallucinating &mdash; <strong>no thinking</strong></td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Lite</td><td className="py-2 pr-4">thinkingLevel: HIGH</td><td className="py-2 pr-4 text-right text-green-700">573</td><td className="py-2 pr-4 text-right font-bold text-green-700">7,679</td><td className="py-2 text-green-700">Fixed &mdash; matches Flash</td></tr>
              <tr className="border-b border-light/50 bg-red-50/30"><td className="py-2 pr-4">Pro</td><td className="py-2 pr-4">default (no config)</td><td className="py-2 pr-4 text-right font-bold text-red-700">10,117</td><td className="py-2 pr-4 text-right font-bold text-red-700">0</td><td className="py-2 text-red-700">Hallucinating &mdash; no thinking</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Pro</td><td className="py-2 pr-4">thinkingBudget: 8192</td><td className="py-2 pr-4 text-right text-green-700">566</td><td className="py-2 pr-4 text-right font-bold text-green-700">7,680</td><td className="py-2 text-green-700">Fixed &mdash; matches Flash</td></tr>
              <tr className="border-b border-light/50 bg-red-50/30"><td className="py-2 pr-4">Pro</td><td className="py-2 pr-4">thinkingLevel: HIGH</td><td className="py-2 pr-4 text-right text-red-700">10,117</td><td className="py-2 pr-4 text-right text-red-700">0</td><td className="py-2 text-red-700">Still hallucinating &mdash; <strong>Pro ignores thinkingLevel</strong></td></tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>The confident hallucinator is simply a model without thinking turned on.</strong> Flash never hallucinated because it was thinking all along &mdash; spending ~7,700 tokens reasoning about what&rsquo;s on the page before generating output. Lite and Pro default to zero thinking tokens on these inputs, and both hallucinate identically. Enabling thinking on either model immediately fixes the problem.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This also explains a pricing puzzle from our pipeline. We route non-BPH books to Lite because it&rsquo;s &ldquo;50% cheaper.&rdquo; But Flash&rsquo;s hidden thinking tokens mean it was doing substantially more work per page &mdash; and getting substantially better results on manuscripts. The cost difference was real; so was the quality difference. We just didn&rsquo;t know why.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>An API quirk:</strong> Pro ignores <code className="bg-warm px-1 py-0.5 rounded">thinkingLevel: &quot;HIGH&quot;</code> (produces 0 thinking tokens), but responds to <code className="bg-warm px-1 py-0.5 rounded">thinkingBudget: 8192</code>. The Gemini docs say to use <code className="bg-warm px-1 py-0.5 rounded">thinkingLevel</code> for Gemini 3 models, but Pro requires the legacy <code className="bg-warm px-1 py-0.5 rounded">thinkingBudget</code> parameter. Lite accepts both.
        </p>

        {/* --- Implications --- */}
        <h2 id="implications" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          13. Implications for Our Pipeline
        </h2>

        <p className="text-secondary leading-relaxed mb-4">
          <strong>From Part I (Flash vs. Lite):</strong>
        </p>
        <ul className="text-secondary leading-relaxed mb-6 space-y-3">
          <li><strong>Embedding-based translation monitoring</strong> should be deployed pipeline-wide. Pages with OCR&rarr;translation distance &gt; 2&sigma; from their corpus mean should be flagged for review.</li>
          <li><strong>Output length ratio</strong> is the simplest hallucination detector. A page where one model produces 5x+ more text than another is almost certainly hallucinating.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-4">
          <strong>From Part II (Pro and thinking mode):</strong>
        </p>
        <ul className="text-secondary leading-relaxed mb-6 space-y-3">
          <li><strong>Flash works because it thinks by default</strong> &mdash; not because it&rsquo;s a better model. Any model with ~7,700 thinking tokens reads manuscripts correctly.</li>
          <li><strong>Lite + thinking is the cheapest fix.</strong> Enabling <code className="bg-warm px-1 py-0.5 rounded">thinkingLevel: &quot;HIGH&quot;</code> on Lite produces Flash-quality output at Lite pricing. For manuscript-heavy collections, this is the optimal config.</li>
          <li><strong>Model size does not fix hallucination.</strong> Pro is worse than Flash on manuscripts and 55x more expensive. Don&rsquo;t throw money at a generation problem.</li>
          <li><strong>The real variable is manuscript vs. print</strong>, not script. All models handle printed Hebrew perfectly. Cursive manuscripts with repetitive magical formulae trigger the confident hallucinator across all model tiers.</li>
          <li><strong>A two-pass pipeline</strong> may be cheaper than thinking everywhere: (1)&nbsp;Run Lite without thinking on everything. (2)&nbsp;Flag pages where output length &gt;&nbsp;3x the corpus median. (3)&nbsp;Re-run flagged pages with Lite + thinking. The open question is whether <code className="bg-warm px-1 py-0.5 rounded">thinkingLevel: &quot;MINIMAL&quot;</code> is sufficient &mdash; if so, the cost of thinking everywhere approaches zero.</li>
        </ul>

        {/* --- Novelty table --- */}
        <h3 className="text-xl text-primary mt-12 mb-4">
          What We&rsquo;re Measuring vs. What&rsquo;s Known
        </h3>

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
              <tr className="border-b border-light/50"><td className="py-2 pr-4">&ldquo;Confident hallucinator&rdquo; pattern</td><td className="py-2 pr-4">This work</td><td className="py-2">High MCR + high length ratio = systematic hallucination</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Thinking mode as hallucination cure</td><td className="py-2 pr-4">This work</td><td className="py-2">10x output reduction, actual content on same input</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Manuscript vs. print as trigger</td><td className="py-2 pr-4">This work</td><td className="py-2">Same script, same models &mdash; only format matters</td></tr>
              <tr className="border-b border-light/50"><td className="py-2 pr-4">Model size &times; hallucination</td><td className="py-2 pr-4">This work</td><td className="py-2">Pro is worse, not better, on hallucination-prone inputs</td></tr>
            </tbody>
          </table>
        </div>

        {/* --- References --- */}
        <h2 id="references" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          14. References &amp; Cost
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Part I (Flash vs. Lite): 143 API calls, $0.20 total across two models, five scripts, two temperatures.<br/>
          Part II (adding Pro): 27 API calls for the 3-model Hebrew eval ($0.79), plus ablation runs (~$0.40). Total for all experiments: <strong>~$2.00 USD</strong>.
        </p>

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
          <strong>Technical details:</strong> Models: Gemini 3 Flash Preview, Gemini 3.1 Flash Lite Preview, Gemini 3.1 Pro Preview. Temperatures: 0, 0.3. Embedding model: Gemini embedding-2-preview (768d). Thinking budget: 8,192 tokens. Media resolution: low/medium/high. Consistency eval: 143 API calls across 5 scripts. Embedding survey: 182 pages across 5 languages &times; 2 conditions. Pro eval + ablation: ~60 calls. Total cost: ~$2.25 USD. Evaluation framework: <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/1329" className="text-accent-rust hover:underline">qa-eval</a> (open source). Raw results in <code className="bg-warm px-1 py-0.5 rounded">scripts/eval/results/</code>.
        </p>

      </article>

    </ContentPageLayout>
  );
}
