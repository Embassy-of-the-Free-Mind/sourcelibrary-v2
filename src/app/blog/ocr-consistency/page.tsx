import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'How Consistent Is AI OCR? - Blog - Source Library',
  description: 'A library\'s digitization error gave us 1,448 natural experiments. Two photographs of the same page, OCR\'d independently by Gemini — character-level comparison reveals a 1.8% median disagreement rate across six languages and four centuries of printed text.',
  openGraph: {
    title: 'How Consistent Is AI OCR?',
    description: '1,448 duplicate scans of the same physical pages, OCR\'d independently. The results quantify something nobody has measured before.',
    images: [{ url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/uploads/697b079ac66889d6835b576a/697b09f386b3d3c458a4c04c.jpg', width: 1200, height: 630 }],
  },
  alternates: {
    canonical: '/blog/ocr-consistency',
  },
};

export default function OcrConsistencyPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="How Consistent Is AI OCR?"
          subtitle="1,448 duplicate scans reveal what happens when the same page is read twice"
        >
          <p className="text-stone-400 text-sm mt-4">7 March 2026 &middot; 12 min read</p>
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
          All posts
        </Link>
      </div>

      <article className="prose-content max-w-none">

        {/* --- Lead --- */}
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library uses Gemini to read 400-year-old printed books &mdash; Latin, German, Dutch, French, Hebrew, Greek. We process over 300,000 pages. But how consistent is the OCR? If you photograph the same physical page twice and run both images through the same model, do you get the same text?
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          A digitization error gave us a natural experiment. The <a href="https://www.earlymodernfiche.com/" className="text-accent-rust hover:underline">Early Modern Fiche</a> collection &mdash; one of our largest sources &mdash; accidentally photographed the same page spreads multiple times during scanning. After our split-detection pipeline divided spreads into individual pages, the duplicates produced separate page records: same physical text, different source photographs. Before cleaning them up, we compared the OCR output character by character.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          The result: 1,448 duplicate pairs across 201 books and six languages. To our knowledge, no published study has compared OCR outputs from different photographs of the same physical document. The standard approach in the literature compares OCR against human-transcribed ground truth, or compares multiple OCR engines on the same scan. Our dataset does something different: it measures how much variation the <em>photograph itself</em> introduces into the pipeline.
        </p>

        {/* --- The Experiment --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Experiment
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          For each duplicate pair, both pages had been OCR&rsquo;d by the same model (Gemini 3 Flash) with the same prompt. The only difference was the source image &mdash; two separate photographs of the same physical page, taken at different moments during the BPH digitization process.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We computed three metrics for each pair:
        </p>

        <ul className="text-secondary leading-relaxed mb-8 space-y-2">
          <li><strong>Character-level similarity</strong> &mdash; Levenshtein edit distance on the stripped text (XML tags removed, whitespace normalized), expressed as 1 &minus; (edits / max_length). This is equivalent to 1 &minus; CER, where CER is the standard Character Error Rate used in OCR evaluation.</li>
          <li><strong>Word-level Jaccard index</strong> &mdash; intersection over union of word sets, measuring vocabulary overlap regardless of word order.</li>
          <li><strong>Raw similarity</strong> &mdash; edit distance on the full OCR output including XML markup tags, to detect structural differences in how the model formatted its response.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-12">
          Neither output is &ldquo;ground truth&rdquo; &mdash; both are AI-generated. So our metric is <em>inter-scan disagreement rate</em>, not error rate. Where the two outputs agree, we can&rsquo;t tell whether they&rsquo;re both right or both wrong in the same way. Where they disagree, at least one is wrong. This makes our disagreement rate a <strong>lower bound</strong> on the actual error rate: the true CER is at least as high as what we measure, and likely higher.
        </p>

        {/* --- Results --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Results
        </h2>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-border-medium">
                <th className="py-3 pr-6 text-primary font-semibold">Metric</th>
                <th className="py-3 pr-6 text-primary font-semibold text-right">Mean</th>
                <th className="py-3 pr-6 text-primary font-semibold text-right">Median</th>
                <th className="py-3 pr-6 text-primary font-semibold text-right">P5</th>
                <th className="py-3 text-primary font-semibold text-right">P95</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Character similarity (stripped)</td>
                <td className="py-3 pr-6 text-right font-mono">91.9%</td>
                <td className="py-3 pr-6 text-right font-mono">98.2%</td>
                <td className="py-3 pr-6 text-right font-mono">28.7%</td>
                <td className="py-3 text-right font-mono">100.0%</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Raw similarity (with XML)</td>
                <td className="py-3 pr-6 text-right font-mono">92.9%</td>
                <td className="py-3 pr-6 text-right font-mono">98.2%</td>
                <td className="py-3 pr-6 text-right font-mono">&mdash;</td>
                <td className="py-3 text-right font-mono">&mdash;</td>
              </tr>
              <tr>
                <td className="py-3 pr-6">Word Jaccard index</td>
                <td className="py-3 pr-6 text-right font-mono">88.3%</td>
                <td className="py-3 pr-6 text-right font-mono">96.3%</td>
                <td className="py-3 pr-6 text-right font-mono">&mdash;</td>
                <td className="py-3 text-right font-mono">&mdash;</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The gap between mean (91.9%) and median (98.2%) tells the story: most pages are highly consistent, but a long tail of outliers pulls the average down. The P5 value of 28.7% reflects pages where the model classified the content differently between scans &mdash; one scan producing &ldquo;blank&rdquo; and the other a description of the physical page.
        </p>

        <h3 className="text-xl text-primary mt-12 mb-4">
          Distribution
        </h3>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-border-medium">
                <th className="py-3 pr-6 text-primary font-semibold">Similarity band</th>
                <th className="py-3 pr-6 text-primary font-semibold text-right">Pairs</th>
                <th className="py-3 text-primary font-semibold text-right">Share</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Exact match (100%)</td>
                <td className="py-3 pr-6 text-right font-mono">286</td>
                <td className="py-3 text-right font-mono">19.8%</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Near match (&gt;99%)</td>
                <td className="py-3 pr-6 text-right font-mono">235</td>
                <td className="py-3 text-right font-mono">16.2%</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">High similarity (&gt;95%)</td>
                <td className="py-3 pr-6 text-right font-mono">615</td>
                <td className="py-3 text-right font-mono">42.5%</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Moderate (&gt;80%)</td>
                <td className="py-3 pr-6 text-right font-mono">180</td>
                <td className="py-3 text-right font-mono">12.4%</td>
              </tr>
              <tr>
                <td className="py-3 pr-6">Low (&le;80%)</td>
                <td className="py-3 pr-6 text-right font-mono">132</td>
                <td className="py-3 text-right font-mono">9.1%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-12">
          78.5% of pairs are above 95% character similarity. One in five pairs are exact character-for-character matches. The low-similarity tail (&le;80%) consists almost entirely of blank pages, endpapers, and binding photographs where the model&rsquo;s page-type classification varied between scans &mdash; one producing a terse &ldquo;blank&rdquo; tag, the other a physical description of the paper.
        </p>

        {/* --- By Language --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          By Language
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The dataset spans six major languages of early modern European print. Sample sizes vary because the EFM collection skews toward Latin, German, and Dutch theology.
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-border-medium">
                <th className="py-3 pr-6 text-primary font-semibold">Language</th>
                <th className="py-3 pr-6 text-primary font-semibold text-right">Pairs</th>
                <th className="py-3 pr-6 text-primary font-semibold text-right">Mean</th>
                <th className="py-3 text-primary font-semibold text-right">Median</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Latin</td>
                <td className="py-3 pr-6 text-right font-mono">461</td>
                <td className="py-3 pr-6 text-right font-mono">91.7%</td>
                <td className="py-3 text-right font-mono">97.9%</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">German</td>
                <td className="py-3 pr-6 text-right font-mono">265</td>
                <td className="py-3 pr-6 text-right font-mono">93.8%</td>
                <td className="py-3 text-right font-mono">98.2%</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Dutch</td>
                <td className="py-3 pr-6 text-right font-mono">246</td>
                <td className="py-3 pr-6 text-right font-mono">91.8%</td>
                <td className="py-3 text-right font-mono">98.1%</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">French</td>
                <td className="py-3 pr-6 text-right font-mono">244</td>
                <td className="py-3 pr-6 text-right font-mono">92.6%</td>
                <td className="py-3 text-right font-mono">98.8%</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">English</td>
                <td className="py-3 pr-6 text-right font-mono">127</td>
                <td className="py-3 pr-6 text-right font-mono">92.0%</td>
                <td className="py-3 text-right font-mono">97.9%</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Italian</td>
                <td className="py-3 pr-6 text-right font-mono">48</td>
                <td className="py-3 pr-6 text-right font-mono">88.1%</td>
                <td className="py-3 text-right font-mono">98.6%</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-6">Greek</td>
                <td className="py-3 pr-6 text-right font-mono">15</td>
                <td className="py-3 pr-6 text-right font-mono">65.7%</td>
                <td className="py-3 text-right font-mono">91.2%</td>
              </tr>
              <tr>
                <td className="py-3 pr-6">Hebrew</td>
                <td className="py-3 pr-6 text-right font-mono">4</td>
                <td className="py-3 pr-6 text-right font-mono">52.3%</td>
                <td className="py-3 text-right font-mono">52.3%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The Western European languages cluster tightly: median similarity between 97.9% and 98.8%, with no statistically meaningful differences between Latin, German, Dutch, French, English, and Italian. This is notable because the texts span four centuries (1500s&ndash;1800s) and include blackletter/Fraktur (German), italic type (Latin), and early Roman type (French/Dutch).
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Greek and Hebrew show lower consistency, though both have very small sample sizes (15 and 4 pairs). Greek early modern typography uses extensive ligatures and abbreviations that may amplify photographic variation. The Hebrew result should not be generalized from four data points.
        </p>

        {/* --- Comparison with Published Work --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Comparison with Published Work
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The standard metric in OCR evaluation is the <strong>Character Error Rate</strong> (CER): the Levenshtein edit distance between OCR output and a human-transcribed ground truth, divided by the length of the ground truth. Our experiment doesn&rsquo;t measure CER in this sense &mdash; we have no ground truth, only two AI-generated outputs. What we measure is inter-scan character disagreement, which sets a lower bound on the true CER.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The most directly comparable published result is Stoyanov et al. (2025), &ldquo;Evaluating LLMs for Historical Document OCR&rdquo; (<a href="https://arxiv.org/abs/2510.06743" className="text-accent-rust hover:underline">arXiv:2510.06743</a>), which tested Gemini 2.5 Pro on 18th-century Russian printed text and measured a CER of 3.36% with a coefficient of variation of 0.037 &mdash; the most stable of all LLMs tested. Our median inter-scan disagreement of 1.8% is <em>lower</em> than Stoyanov&rsquo;s CER, which makes sense: inter-scan disagreement is a lower bound on error, not the full error.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Hiippala et al. (2025) found that LLMs consistently outperform traditional OCR engines (Tesseract, Kraken) on historical documents, with GPT-4o and Gemini achieving the lowest error rates (<a href="https://arxiv.org/abs/2501.11623" className="text-accent-rust hover:underline">arXiv:2501.11623</a>). Typical CER for neural OCR on historical text ranges from 3&ndash;10%; for incunabula and pre-1600 printing, 15%+ is common with older engines.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          What appears to be novel about our dataset is the experimental design. Published OCR evaluations compare output against ground truth (accuracy), or compare multiple engines on the same image (inter-engine agreement). The closest methodological precedent is multiple-system voting, where several OCR engines process the same scan and disagreements are flagged for review. Our experiment varies the <em>input</em> instead of the <em>engine</em>: same model, same prompt, different photographs of the same physical page. This isolates the contribution of photographic variation to OCR inconsistency.
        </p>

        {/* --- What the Outliers Tell Us --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What the Outliers Tell Us
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The most interesting findings are in the tails. The 132 low-similarity pairs (&le;80%) break down into a few categories:
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Blank page classification.</strong> The largest category. When two scans of a blank or near-blank page (endpaper, binding, flyleaf) are OCR&rsquo;d, one scan might produce a minimal &ldquo;blank&rdquo; tag while the other produces a paragraph describing the physical characteristics of the paper. Both responses are arguably correct &mdash; but they have very low character overlap. This is a classification instability, not a reading error.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Marginal annotations.</strong> When a page has handwritten marginalia, slight differences in the photograph can cause the model to include or exclude them. The primary printed text matches, but the overall similarity drops because one output contains margin text the other doesn&rsquo;t.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          <strong>True reading differences.</strong> A small number of pairs show genuine disagreement on printed characters &mdash; typically in damaged or faded sections where the type is barely legible. These are the most informative outliers: they mark the boundary of the model&rsquo;s visual capability on degraded historical printing.
        </p>

        {/* --- What We Did About It --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What We Did About It
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The duplicate pages were a data quality problem as well as an experiment. Duplicate source scans meant duplicate page records &mdash; readers saw the same text twice, page counts were inflated, and wasted API cost on redundant OCR and translation.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We built a detection pipeline using server-side MongoDB aggregation: fingerprint the first 400 characters of each page&rsquo;s OCR text, group by fingerprint within each book, flag groups with two or more pages. This identified 1,568 duplicate pages across 205 books. Before removing them, we archived every duplicate to a <code className="bg-warm px-1.5 py-0.5 rounded text-sm">duplicate_pages</code> collection preserving the full page record, original page ID, and archive timestamp. Then we deleted the duplicates from the main collection, renumbered the remaining pages sequentially, and updated book-level page counts.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          The archived duplicates are what made this experiment possible. By comparing each archived page&rsquo;s OCR against the corresponding kept page, we got 1,448 natural A/B comparisons without needing to re-run any OCR.
        </p>

        {/* --- Limitations --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Limitations
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>No ground truth.</strong> We measure disagreement, not error. When two outputs agree, they could both be wrong identically &mdash; for instance, both misreading the same damaged character the same way. Our 1.8% median disagreement is a floor, not a ceiling, for actual OCR error.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Single source collection.</strong> All duplicates come from the EFM/BPH digitization. This means all photographs were taken with the same equipment, under similar conditions. Comparing scans from different institutions (e.g., BPH vs. Bayerische Staatsbibliothek) would likely show higher variation.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Non-random sample.</strong> The duplicates are an accident of the scanning process, not a designed experiment. The distribution of page types, damage levels, and languages reflects whatever BPH happened to scan twice, not a controlled sample.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          <strong>Small samples for some languages.</strong> Hebrew (4 pairs) and Greek (15 pairs) are too small for reliable language-level conclusions. The Western European languages (120+ pairs each) are more robust.
        </p>

        {/* --- Conclusion --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Conclusion
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          For the core task &mdash; reading 16th&ndash;18th century Latin, German, Dutch, French, English, and Italian printed text &mdash; Gemini 3 Flash is highly consistent across different photographs of the same page. The median inter-scan disagreement of 1.8% means that if you photograph the same printed page twice under similar conditions, 98.2% of characters will be identical in the OCR output. One in five pages produces an exact character-for-character match.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The main source of inconsistency is not character-level reading errors but <em>page-level classification</em>: whether the model treats a blank page as worth describing or not, whether it includes marginalia, whether it classifies an endpaper as a text page. These are judgment calls, not mistakes, and they account for most of the long tail below 80% similarity.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          For a library processing hundreds of thousands of pages of historical text, this level of consistency is sufficient. The pipeline produces stable, reproducible transcriptions. And the duplicate scans &mdash; an accident of digitization &mdash; gave us a way to verify that claim at scale.
        </p>

        <hr className="border-light my-12" />

        <p className="text-muted text-sm leading-relaxed">
          <strong>Technical details:</strong> Model: Gemini 3 Flash Preview, Standard OCR prompt v5.2026-02. 1,448 pairs across 201 books from the Early Modern Fiche collection. Metrics: Levenshtein edit distance (character-level), Jaccard index (word-level). All duplicate pages archived to <code className="bg-warm px-1 py-0.5 rounded">duplicate_pages</code> collection with full provenance. Detection and comparison scripts available on request.
        </p>

      </article>

      <BlogComments slug="ocr-consistency" />
    </ContentPageLayout>
  );
}
