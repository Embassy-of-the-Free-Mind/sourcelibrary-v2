import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'What Makes a Good Scan? - Research Notes - Source Library',
  description: 'Pixel statistics, AI judgment, and the moment a model rated a blank page 95/100. Designing a per-illustration quality system for 100,000 rare-book images.',
  openGraph: {
    images: [{ url: 'https://images.sourcelibrary.org/archived/695592c47bd6d2cd1d61b10b/209.jpg', alt: 'Woodcut of Ramon Llull and disciples, with the alphabetum operis consequentis table beneath. Ars Inventiva Veritatis, 1515.' }],
    title: 'What Makes a Good Scan?',
    description: 'Pixel statistics, AI judgment, and the moment a model rated a blank page 95/100. Designing a per-illustration quality system for 100,000 rare-book images.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/695592c47bd6d2cd1d61b10b/209.jpg', alt: 'Woodcut of Ramon Llull and disciples, with the alphabetum operis consequentis table beneath. Ars Inventiva Veritatis, 1515.' }],
  },
  alternates: {
    canonical: '/blog/what-makes-a-good-scan',
  },
};

export default function WhatMakesAGoodScanPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="What Makes a Good Scan?"
          subtitle="Pixel statistics, AI judgment, and the moment a model rated a blank page 95/100"
          image="https://images.sourcelibrary.org/archived/695592c47bd6d2cd1d61b10b/209.jpg"
          imageAlt="Woodcut of Ramon Llull and disciples, with the alphabetum operis consequentis table beneath. Ars Inventiva Veritatis, 1515."
        >
          <p className="text-stone-400 text-sm mt-4">17 May 2026 &middot; 9 min read</p>
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
          Source Library holds roughly 17,000 rare books and over 100,000 extracted illustrations &mdash; emblems, woodcuts, engravings, manuscript figures, maps. The text in those books is recoverable: OCR fails, we re-OCR, eventually we get it right. The pictures are not. A faded engraving, a smeared woodcut, a microfilmed map &mdash; those are permanent losses, frozen in whatever quality the digitization captured. So a question we kept dodging: <em>which of our scans are good enough, and which need to be re-sourced?</em>
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The honest answer used to be &ldquo;we don&rsquo;t really know.&rdquo; A legacy script (<code>audit-scan-quality.mjs</code>) had assigned a quality score to about 4% of the visible library &mdash; pixel statistics over two sampled pages per book, condensed into a single 0&ndash;100 number. The number was easy to query. It was also wrong, often by 30 or 40 points, in ways we only noticed when we started spot-checking it. This note is about what happens when you do.
        </p>

        {/* Table of contents */}
        <nav className="bg-warm/50 rounded-lg p-6 mb-12 border border-light">
          <p className="text-sm font-semibold text-primary mb-3 uppercase tracking-wide">Contents</p>
          <ol className="text-secondary space-y-0.5 list-decimal list-inside text-sm">
            <li><a href="#why-images" className="text-accent-rust hover:underline">Why images, not text</a></li>
            <li><a href="#what-pixels-see" className="text-accent-rust hover:underline">What pixels can see</a></li>
            <li><a href="#what-pixels-miss" className="text-accent-rust hover:underline">What pixels miss</a></li>
            <li><a href="#flash-lite" className="text-accent-rust hover:underline">The flash-lite hallucination</a></li>
            <li><a href="#design" className="text-accent-rust hover:underline">A three-layer design</a></li>
            <li><a href="#bitonal-microfilm" className="text-accent-rust hover:underline">Bitonal clean vs. microfilm</a></li>
            <li><a href="#use-cases" className="text-accent-rust hover:underline">What it unlocks</a></li>
            <li><a href="#open-questions" className="text-accent-rust hover:underline">What we&rsquo;re still unsure about</a></li>
          </ol>
        </nav>

        {/* ── 1 ── */}
        <h2 id="why-images" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          1. Why images, not text
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          A previous note on this blog (<Link href="/blog/confident-hallucinator" className="text-accent-rust hover:underline">The Confident Hallucinator</Link>) made the case that OCR confidence and OCR agreement together give us a reliable signal for text quality. If a page is unreadable today, we can run it again next year with a better model and recover the text. Text is reversible.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Pictures are not. The reason is mechanical: every digitization pipeline ends with a JPEG (or a JP2) sitting on a server somewhere, and that file is all anyone will ever see of the underlying object. If the original photographer compressed it too hard, or scanned it from microfilm instead of from the page, or thresholded it to bitonal at 200 DPI, the loss is baked in. You can&rsquo;t un-microfilm an engraving by running better software over it.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          That makes scan quality the most consequential property of an image-bearing book, and the one we&rsquo;ve been least equipped to talk about. So we started measuring.
        </p>

        {/* ── 2 ── */}
        <h2 id="what-pixels-see" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          2. What pixels can see
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The first attempt was deterministic. For each of two sampled pages in a book, compute four numbers and combine them into a score:
        </p>

        <ul className="text-secondary leading-relaxed mb-6 list-disc list-inside space-y-1">
          <li><strong>Color depth.</strong> Is the file color, grayscale, or bitonal black-and-white? Bonus points for color.</li>
          <li><strong>Resolution.</strong> Megapixels. Bonus points for sharper.</li>
          <li><strong>Dynamic range.</strong> The spread between the darkest and lightest pixel. Detects washed-out or faded scans.</li>
          <li><strong>Contrast.</strong> Mean standard deviation across channels. Detects flat or uniform images.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6">
          This is roughly the right vocabulary. A high-resolution color photograph with strong dynamic range is almost always a great scan. A 1-megapixel bitonal page with a brightness range of 80 is almost always a terrible one. In the middle of the distribution &mdash; where most books actually live &mdash; pixel statistics work fine.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          At the edges they fall apart.
        </p>

        {/* ── 3 ── */}
        <h2 id="what-pixels-miss" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          3. What pixels miss
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          We pulled a stratified sample &mdash; eighteen books, spread across the score range &mdash; and looked at each one. Three failure modes were obvious within minutes.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-3">Failure 1: a blank page scored 30/100</h3>

        <p className="text-secondary leading-relaxed mb-6">
          A book called <em>Ganita Kaumudi, Part 1</em> had a quality score of 30. Page 157, one of the two pages the formula had sampled, looked like this:
        </p>

        <div className="my-8 grid md:grid-cols-2 gap-6">
          <figure className="text-center">
            <div className="bg-warm border border-light p-4 rounded">
              <img
                src="https://images.sourcelibrary.org/archived/69906a961cf6ed5fbc8f7135/157.jpg"
                alt="A completely blank white page"
                className="w-full h-auto"
                style={{ maxHeight: '400px', objectFit: 'contain' }}
              />
            </div>
            <figcaption className="text-sm text-muted mt-2 italic">
              Ganita Kaumudi, page 157. Dynamic range: 0. Sharpness variance: 0. Score: 30/100.
            </figcaption>
          </figure>

          <figure className="text-center">
            <div className="bg-warm border border-light p-4 rounded">
              <img
                src="https://images.sourcelibrary.org/archived/694bf8d2343422769f237558/212.jpg"
                alt="A scan that is almost entirely blank with only a tiny fragment of text"
                className="w-full h-auto"
                style={{ maxHeight: '400px', objectFit: 'contain' }}
              />
            </div>
            <figcaption className="text-sm text-muted mt-2 italic">
              Agrippa, <em>De occulta philosophia</em>, page 212. Pixel score: 43/100.
            </figcaption>
          </figure>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The page is white. Not faded. Not light. <em>White.</em> But the formula handed it 25 points for being 14.8 megapixels and 5 more points for some residual scoring floor, and gave it a 30 &mdash; a score that put it in roughly the same bucket as a perfectly readable bitonal woodcut from 1515. The pixel statistics flagged that the image was degenerate (dynamic range 0, contrast 0) but the formula didn&rsquo;t know what to do with the flag.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-3">Failure 2: a beautiful map scored 74/100</h3>

        <p className="text-secondary leading-relaxed mb-6">
          A 19th-century fold-out map from the e-rara collection &mdash; <em>Die Schlacht bei Austerlitz</em> &mdash; scored 74. It is, plainly, an excellent scan: sharp color, every village name legible, the paper&rsquo;s creases preserved as natural texture.
        </p>

        <figure className="text-center my-8">
          <div className="bg-warm border border-light p-4 rounded inline-block">
            <img
              src="https://images.sourcelibrary.org/archived/6968d9624fa3b04c6de86ecd/125.jpg"
              alt="A 19th-century color topographic map of the area around Austerlitz showing rivers, villages, and terrain"
              className="w-full h-auto mx-auto"
              style={{ maxHeight: '500px', objectFit: 'contain' }}
            />
          </div>
          <figcaption className="text-sm text-muted mt-2 italic">
            Die Schlacht bei Austerlitz, 1806. Pixel score: 74/100. A reviewer&rsquo;s score would round up to about 95.
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-6">
          What dragged the number down was resolution &mdash; the map is only 1.3 megapixels. The formula penalized it 15 points for being small. But the map is also sharp enough that every line and label is crisp at native size; the resolution doesn&rsquo;t hurt the image, it just isn&rsquo;t enormous. Sharpness, not megapixel count, is what matters for a well-rendered illustration. The formula didn&rsquo;t measure sharpness.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-3">Failure 3: microfilm scored 84/100</h3>

        <p className="text-secondary leading-relaxed mb-6">
          The opposite failure: a 17-megapixel scan of George of Trebizond&rsquo;s <em>De Platonicae atque Aristotelicae Philosophiae Differentia</em> earned 84 points and looked, statistically, like a high-quality archival capture. It wasn&rsquo;t. The pixel count was real, but the underlying source was microfilm &mdash; what you see when you zoom in is the signature pepper noise and jagged character edges of a high-resolution scan of an old microfilm reel. The illustrations had been destroyed long before the JPEG existed.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Pixel statistics cannot detect this. A microfilm scan at 17 MP has the same megapixel count, the same dynamic range (the whites are still bright and the blacks are still dark), and the same contrast (high, because everything is one or the other) as a pristine archival photograph. The difference is in the texture &mdash; in what fills the spaces between the characters &mdash; and that&rsquo;s a perceptual judgment, not a numeric one.
        </p>

        {/* ── 4 ── */}
        <h2 id="flash-lite" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          4. The flash-lite hallucination
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          So we did the obvious thing: asked an AI to look at the images. The right tool here is Gemini Flash &mdash; the same vision model we already use for OCR and illustration extraction. We ran the eleven sample pages through Flash with a blind prompt asking it to rate scan quality, and the results were a clear improvement. The microfilm scan dropped from 84 to 58 (&ldquo;heavy bleed-through, low resolution, scan-of-scan artifacts&rdquo;). The Austerlitz map climbed from 74 to 95 (&ldquo;outstanding high-resolution scan with sharp detail&rdquo;). The blank page got a clean 0.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Then we tried the cheaper sibling, Flash Lite, which costs roughly half as much per call. Because we&rsquo;d be running this at corpus scale &mdash; 100,000 illustrations &mdash; a 50% cost difference matters. We expected slightly worse judgments but a similar shape of answer.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          What we got was different. The same blank page that Flash had scored 0 came back from Flash Lite as:
        </p>

        <blockquote className="border-l-4 border-accent-rust pl-6 my-8 italic text-secondary">
          <p className="mb-2"><strong>scan_score:</strong> 95</p>
          <p className="mb-2"><strong>classification:</strong> grayscale</p>
          <p className="mb-2"><strong>readable:</strong> true</p>
          <p className="mb-0"><strong>verdict:</strong> &ldquo;This is an excellent, high-resolution scan with sharp text and clear contrast, making it perfect for both reading and OCR processing.&rdquo;</p>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6">
          There is no text in the image. There is nothing in the image. It is white. Flash Lite read the file&rsquo;s metadata, decided what a high-resolution archival scan should look like, and wrote a confident description of one. The hallucination wasn&rsquo;t subtle &mdash; it was a complete fabrication, marked &ldquo;readable: true,&rdquo; of content that did not exist.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          That single failure mode is disqualifying for production use. We need this system specifically to <em>catch</em> blank pages, broken scans, scanner-bed artifacts &mdash; the cases at the bottom of the quality distribution. A model that rubber-stamps those as &ldquo;excellent&rdquo; doesn&rsquo;t reduce error, it adds an extra layer of false confidence. Flash, at twice the price, doesn&rsquo;t do that. We&rsquo;ll pay the extra.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The pattern is the same one The Confident Hallucinator surfaced for OCR: consistency alone is a dangerous signal, and the cheaper model produces a more consistent kind of wrong. Vision tasks have the same shape.
        </p>

        {/* ── 5 ── */}
        <h2 id="design" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          5. A three-layer design
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The synthesis is to use both signals together. Pixel statistics are cheap, deterministic, and reliable at the obvious cases &mdash; a dynamic range of zero <em>is</em> a blank page, every time. AI judgment is expensive, fuzzier, but able to make the perceptual distinctions that numbers can&rsquo;t &mdash; bitonal-from-microfilm versus bitonal-from-woodcut, fragment-versus-full-page, scanner-bed-versus-page-content. Neither alone is sufficient. Both together cover the failure modes of either.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          So the production design is three layers, embedded in the existing illustration-extraction pipeline:
        </p>

        <div className="bg-warm/50 border border-light rounded-lg p-6 my-8 font-mono text-sm text-secondary">
          <div className="mb-4">
            <strong className="text-primary">Layer 1 &mdash; Deterministic characteristics</strong> (free, every page)
            <p className="font-sans text-sm mt-1">
              sharp pixel-stats + Laplacian-variance sharpness + histogram entropy + bimodality + chroma spread.
              Catches blanks, low resolution, over-compression, and bitonal/photographic discrimination.
              About 5ms per page on the image-extract worker that&rsquo;s already running.
            </p>
          </div>
          <div className="mb-4">
            <strong className="text-primary">Layer 2 &mdash; Gemini scan-quality assessment</strong> (embedded in extraction)
            <p className="font-sans text-sm mt-1">
              Augments the existing illustration-extraction prompt with technical-quality fields:
              scan_score, scan_class, readable_text, illustration_fidelity, page_completeness,
              and a list of concerns drawn from a fixed vocabulary. One Gemini call per page
              (the same call we already make), ~15% longer output, ~12% more cost. Per-illustration
              data lands in <code>gallery_images.scan_quality</code>.
            </p>
          </div>
          <div>
            <strong className="text-primary">Layer 3 &mdash; ML distillation</strong> (future)
            <p className="font-sans text-sm mt-1">
              Once L1+L2 has scored ~50K illustrations, the (features &rarr; labels) corpus
              becomes training data for a small classifier &mdash; goal ~95% agreement with Gemini
              at zero per-call cost. Not part of v1; mentioned here to show the path.
            </p>
          </div>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          We picked the extraction pipeline as the host because it&rsquo;s already doing the work. The worker already downloads every page image, already calls Gemini vision, already writes one document per detected illustration. Augmenting the prompt is a 15-line change. Computing pixel statistics on the in-memory buffer is another 30 lines. We&rsquo;re capturing technical-quality signals during work that&rsquo;s already happening.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The result is two parallel signals per illustration. The existing <code>gallery_quality</code> field answers <em>&ldquo;is this image worth showing?&rdquo;</em> &mdash; an emblem with figures scores higher than a marbled endpaper. The new <code>scan_quality</code> field answers <em>&ldquo;how cleanly is this image digitized?&rdquo;</em> &mdash; orthogonal questions that we&rsquo;d been muddling together. A famous Kircher diagram has a <code>gallery_quality</code> of 0.9 whether the scan is pristine or microfilmed. Now we can say so.
        </p>

        {/* ── 6 ── */}
        <h2 id="bitonal-microfilm" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          6. Bitonal clean vs. microfilm
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The hardest distinction the system has to make is between a pristine bitonal scan of a woodcut &mdash; sharp, intentional, no information loss &mdash; and a bitonal scan from a microfilm reel, which looks superficially similar but has lost the original&rsquo;s fine detail. Both are pure black-and-white. Both can be high-resolution. Pixel statistics see them as equivalent.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Two examples from the test set. On the left, a clean 1515 woodcut of Ramon Llull and his disciples at the shore; on the right, a microfilm scan of an early printed page from Steganographia. Both are bitonal. Both score similarly on pixel statistics (bimodality 0.52 vs 0.73, histogram entropy 4.82 vs 2.68 &mdash; close, but no firm threshold). Visually, only one of them is preserved.
        </p>

        <div className="my-8 grid md:grid-cols-2 gap-6">
          <figure className="text-center">
            <div className="bg-warm border border-light p-4 rounded">
              <img
                src="https://images.sourcelibrary.org/archived/695592c47bd6d2cd1d61b10b/209.jpg"
                alt="Crisp woodcut of Ramon Llull with disciples and a city in the background. From Ars Inventiva Veritatis, 1515."
                className="w-full h-auto"
                style={{ maxHeight: '500px', objectFit: 'contain' }}
              />
            </div>
            <figcaption className="text-sm text-muted mt-2 italic">
              Ramon Llull, Ars Inventiva Veritatis, 1515. <strong>bitonal_clean.</strong>
            </figcaption>
          </figure>

          <figure className="text-center">
            <div className="bg-warm border border-light p-4 rounded">
              <img
                src="https://images.sourcelibrary.org/archived/69520773ab34727b1f043c4d/14.jpg"
                alt="Microfilm scan of a printed page with visible pepper noise and jagged character edges. From Steganographia."
                className="w-full h-auto"
                style={{ maxHeight: '500px', objectFit: 'contain' }}
              />
            </div>
            <figcaption className="text-sm text-muted mt-2 italic">
              Trithemius, Steganographia. <strong>bitonal_microfilm.</strong>
            </figcaption>
          </figure>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Gemini handles this. In the validation set it correctly tagged the Steganographia scan as <code>bitonal_microfilm</code> with concerns &ldquo;pepper_noise, scan_of_scan, low_resolution, compression_artifacts&rdquo; &mdash; the exact technical vocabulary an archivist would use. The Llull woodcut was tagged <code>bitonal_clean</code> with concerns just &ldquo;binding gutter shadow.&rdquo; The distinction the pixel formula couldn&rsquo;t make, the model made cleanly.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This is the single most useful field in the schema. A book whose illustrations are classified <code>bitonal_microfilm</code> or <code>microfiche</code> is a re-source candidate: somewhere out there is a better copy of those engravings, and we should track it down. A book whose illustrations are <code>bitonal_clean</code> at any resolution is fine. The classification cuts directly to action.
        </p>

        {/* ── 7 ── */}
        <h2 id="use-cases" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          7. What it unlocks
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Three uses immediately follow.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Best-copy duplicate picking.</strong> Source Library frequently holds two or three editions of the same work, sometimes from different providers. When dedupe runs, the question is which copy to keep canonical and which to hide. Until now the tiebreaker was OCR completeness &mdash; how much text was processed. That&rsquo;s a text-availability heuristic, not a quality one. With per-illustration scan_quality, we can compare specific images across editions: of the two copies of <em>Musaeum hermeticum</em>, which one renders the Mercurius engraving sharply? Pick that edition. The other is the duplicate.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Concern flagging.</strong> An admin queue filtered by <code>scan_quality.has_blank_pages</code>, <code>scan_quality.page_completeness_issues</code>, and the high-curatorial-value / low-scan-quality combination (the worst-case: important illustrations badly digitized). These are actionable rows &mdash; each one corresponds to a specific intervention. Re-source. Re-archive. Manual inspection.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Provider quality baselines.</strong> Aggregate <code>scan_class</code> by <code>image_source.provider</code>. Some providers will turn out to be microfilm-heavy. Others will be color-photo-heavy. We&rsquo;ll know which collections to prefer when multiple sources are available for a single work, and we&rsquo;ll be able to ground future import decisions in data rather than habit.
        </p>

        {/* ── 8 ── */}
        <h2 id="open-questions" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          8. What we&rsquo;re still unsure about
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Two things, mostly.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Granularity.</strong> The current design rates quality at the page level and inherits to each illustration on that page. But pages aren&rsquo;t uniform &mdash; you can have a beautiful color frontispiece bound facing a faded text page, and they&rsquo;ll get the same score. For high-value books we may want per-illustration Gemini calls; for everything else, page-level is fine. The right policy is probably tier-based, but we don&rsquo;t know yet where the threshold should sit.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>The microfilm threshold.</strong> Gemini occasionally classifies a clean modern bitonal scan as <code>bitonal_microfilm</code> when the source is, in fact, a sharp woodcut printed on yellowed paper. The model is being slightly conservative &mdash; treating any jagged edge as a microfilm signature. We could tune the prompt to be less aggressive, but the cost of getting it wrong in the other direction (silently labeling actual microfilm as &ldquo;clean&rdquo;) is much higher than a few false positives. For now we&rsquo;re accepting the conservative behavior and reviewing the borderline cases manually.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The longer-term question is whether any of this is necessary. If we end up with a clean labeled corpus of 50,000 illustrations &mdash; pixel characteristics on one side, Gemini judgments on the other &mdash; that corpus is itself a small ML training set. A distilled classifier that runs on the deterministic features alone, calibrated against the Gemini labels, would let us re-score the entire library in minutes at no per-call cost. We&rsquo;re not there yet. But it&rsquo;s the kind of thing that becomes easy once you have the data, and that&rsquo;s the most under-appreciated outcome of building a system like this. The schema and the corpus are the durable artifacts. The current scoring algorithm is just a placeholder.
        </p>

        {/* End */}
        <hr className="my-12 border-light" />

        <p className="text-sm text-muted">
          <em>The full design document (with schema, prompt, characteristics formulas, validation table, and the full eleven-sample spot-check) lives at <code>.claude/docs/automated-image-quality-system.md</code> in the repository. Phase 1 is tracked at GitHub issue <Link href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/1810" className="text-accent-rust hover:underline">#1810</Link>.</em>
        </p>

      </article>
    </ContentPageLayout>
  );
}
