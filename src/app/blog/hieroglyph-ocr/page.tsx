import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Can AI Read Hieroglyphs? (No.) - Research Notes - Source Library',
  description: 'We tested four approaches to hieroglyphic OCR with Gemini 3 Flash — direct Unicode, Gardiner codes, self-correction, and glyph-by-glyph description. All four failed. Here is what we learned.',
  openGraph: {
    title: 'Can AI Read Hieroglyphs? (No.)',
    description: 'Four approaches to AI hieroglyphic OCR. Four failures. What the results reveal about the limits of visual language models.',
    images: [{ url: 'https://iiif.archive.org/iiif/egyptianreadingb00budguoft$80/full/1000,/0/default.jpg', width: 1000, height: 1400 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://iiif.archive.org/iiif/egyptianreadingb00budguoft$80/full/1000,/0/default.jpg' }],
  },
  alternates: {
    canonical: '/blog/hieroglyph-ocr',
  },
};

function HieroBlock({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="bg-white border border-border-light rounded-lg p-4 my-4">
      {label && (
        <p className="text-xs font-mono uppercase tracking-wider text-muted mb-2">{label}</p>
      )}
      <div
        className="text-lg leading-loose tracking-wide"
        style={{ fontFamily: '"Noto Sans Egyptian Hieroglyphs", "Segoe UI Historic", serif' }}
      >
        {children}
      </div>
    </div>
  );
}

function ApproachCard({
  number,
  title,
  description,
  verdict,
  verdictColor,
  children,
}: {
  number: number;
  title: string;
  description: string;
  verdict: string;
  verdictColor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border-light rounded-xl overflow-hidden bg-white mb-10">
      <div className="bg-warm px-6 py-4 border-b border-border-light">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-stone-200 text-stone-600">
            Approach {number}
          </span>
          <span className={`text-xs font-mono px-2 py-0.5 rounded font-medium ${verdictColor}`}>
            {verdict}
          </span>
        </div>
        <h3 className="font-serif text-xl text-primary mt-2">{title}</h3>
        <p className="text-sm text-secondary mt-1">{description}</p>
      </div>
      <div className="px-6 py-5">
        {children}
      </div>
    </div>
  );
}

export default function HieroglyphOcrPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Can AI Read Hieroglyphs?"
          subtitle="Four approaches, four failures, and what we learned"
          image="https://iiif.archive.org/iiif/egyptianreadingb00budguoft$80/full/1000,/0/default.jpg"
          imageAlt="Page from Budge's Egyptian Reading Book showing hieroglyphic text, 1896"
        >
          <p className="text-stone-400 text-sm mt-4">14 March 2026 &middot; 12 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Noto+Sans+Egyptian+Hieroglyphs&display=swap"
        rel="stylesheet"
      />

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

        {/* --- Hero: page scans --- */}
        <div className="grid grid-cols-3 gap-4 mb-12">
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://iiif.archive.org/iiif/egyptianreadingb00budguoft$80/full/600,/0/default.jpg"
              alt="Page 18 of Budge's Egyptian Reading Book: The Tale of the Two Brothers"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Tale of the Two Brothers, p. 18
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://iiif.archive.org/iiif/egyptianreadingb00budguoft$200/full/600,/0/default.jpg"
              alt="Page 138 of Budge's Egyptian Reading Book: The Battle of Kadesh"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Battle of Kadesh, p. 138
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://iiif.archive.org/iiif/egyptianreadingb00budguoft$270/full/600,/0/default.jpg"
              alt="Page 208 of Budge's Egyptian Reading Book: The Stele of Pi-Ankhi"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Stele of Pi-Ankhi-Meri-Amen, p. 208
            </figcaption>
          </figure>
        </div>

        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library can read printed Latin, German, Arabic, Hebrew, and Sanskrit with
          Gemini 3 Flash. We&rsquo;ve OCR&rsquo;d over 300,000 pages. After <Link href="/blog/cuneiform-ocr" className="text-accent-rust hover:underline">testing cuneiform</Link>,
          the natural next question was: what about Egyptian hieroglyphs?
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          We selected three pages from E.A. Wallis Budge&rsquo;s <em>Egyptian Reading Book for Beginners</em> (1896),
          a standard text where hieroglyphic passages are printed alongside Latin-character transliteration &mdash;
          a built-in answer key. Each page has 5&ndash;8 lines of hieroglyphs in the upper portion, with
          the corresponding transliteration below.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          We tried four different approaches. All four failed. But they failed in different ways, and
          the pattern of failures tells us something useful about where visual language models
          actually break down on non-Latin scripts.
        </p>

        {/* --- The challenge --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Why hieroglyphs are hard
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Egyptian hieroglyphs present a fundamentally different challenge than cuneiform, printed Latin, or even Chinese characters:
        </p>

        <ul className="list-disc pl-6 mb-8 space-y-2 text-secondary leading-relaxed">
          <li><strong>~1,071 distinct signs</strong> in the Unicode Egyptian Hieroglyphs block (U+13000&ndash;U+1342F), far more than any alphabet</li>
          <li><strong>Dense visual similarity</strong> &mdash; many signs differ by tiny details (the owl 𓅓 vs. the vulture 𓄿, the mouth 𓂋 vs. the forearm 𓂝)</li>
          <li><strong>No word boundaries</strong> &mdash; hieroglyphs are arranged in visual groups, read right-to-left or left-to-right depending on which way the animals face</li>
          <li><strong>Stacking</strong> &mdash; signs can be arranged vertically within a single group, not just sequentially</li>
          <li><strong>Determinatives</strong> &mdash; some signs are semantic classifiers that aren&rsquo;t pronounced, making the mapping from text to transliteration non-obvious</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-12">
          The test pages are from a 1896 printed book, not hand-carved stone, so the signs are
          clear and consistent. This is about as easy as hieroglyph OCR can get. If the model
          can&rsquo;t read clean typeset hieroglyphs, it certainly can&rsquo;t read weathered temple inscriptions.
        </p>

        {/* --- Approach 1: Direct Unicode --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The four approaches
        </h2>

        <ApproachCard
          number={1}
          title="Direct Unicode OCR"
          description="Ask Gemini to look at the page and output Unicode hieroglyphs directly, the same way it reads Latin or Arabic."
          verdict="Bad"
          verdictColor="bg-red-50 text-red-700"
        >
          <p className="text-secondary leading-relaxed mb-4">
            The simplest possible approach: give the model the image and ask it to transcribe each
            line of hieroglyphs using Unicode characters. This is exactly what works for our Latin,
            German, and Arabic OCR pipeline.
          </p>

          <p className="text-secondary leading-relaxed mb-4">
            The model <em>does</em> produce Unicode hieroglyphs. But comparing the output to the
            original page, the signs are mostly wrong. The model generates plausible-looking
            sequences of hieroglyphic characters, but they don&rsquo;t match what&rsquo;s actually on the page.
          </p>

          <div className="grid md:grid-cols-2 gap-4 my-6">
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-muted mb-2">What Gemini produced (line 1, Tale of the Two Brothers)</p>
              <HieroBlock>
                𓂋 𓆓 𓏏 𓃹 𓈖 𓈖 𓎡 𓏏 𓂋 𓀀 𓅓 𓏏 𓅱 𓏏 𓅱 𓁶 𓆓 𓏏 𓈖 𓎡 𓏤 𓈖 𓍿 𓃀 𓅱 𓈖 𓎛 𓈎 𓏏
              </HieroBlock>
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-muted mb-2">What the transliteration says line 1 should contain</p>
              <p className="text-sm text-secondary italic leading-relaxed p-4 bg-warm rounded-lg">
                er tet unu neket er-a emtutu her tat-nek u&#257; en &#x1E6F;ebu en heqt her tet-k
              </p>
            </div>
          </div>

          <p className="text-secondary leading-relaxed mb-4">
            The problem is that the model appears to be pattern-matching visual features to
            <em> plausible</em> hieroglyphic sequences rather than carefully identifying each
            sign. It&rsquo;s the hieroglyphic equivalent of a student who can write Chinese-looking
            characters but doesn&rsquo;t actually know Chinese.
          </p>

          <p className="text-sm text-muted italic">
            Verdict: produces hieroglyphs, but the wrong ones. The model doesn&rsquo;t have enough
            training data on hieroglyphic Unicode to map visual signs to correct codepoints.
          </p>
        </ApproachCard>

        <ApproachCard
          number={2}
          title="Gardiner Sign List codes"
          description="Instead of Unicode, ask for Gardiner codes (A1, M17, N35...) — the standard Egyptological catalog — then convert to Unicode with a lookup table."
          verdict="Much worse"
          verdictColor="bg-red-100 text-red-800"
        >
          <p className="text-secondary leading-relaxed mb-4">
            The hypothesis: maybe the model knows the <a href="https://en.wikipedia.org/wiki/Gardiner%27s_sign_list" className="text-accent-rust hover:underline">Gardiner Sign List</a> better
            than Unicode codepoints. The Gardiner list assigns memorable codes to each hieroglyph &mdash;
            A1 is &ldquo;seated man,&rdquo; M17 is &ldquo;reed,&rdquo; N35 is &ldquo;water ripple.&rdquo; Egyptology textbooks use
            these codes extensively, so they should be well-represented in training data.
          </p>

          <p className="text-secondary leading-relaxed mb-4">
            We built a comprehensive Gardiner-to-Unicode mapping table (750+ signs, A1 through Aa32)
            and asked Gemini to OCR in Gardiner codes instead of Unicode. The conversion step worked
            perfectly &mdash; 100% of the Gardiner codes the model produced mapped to valid Unicode
            codepoints.
          </p>

          <p className="text-secondary leading-relaxed mb-4">
            But the Gardiner codes themselves were <strong>fantastically wrong</strong>. Adding an
            intermediate abstraction layer gave the model two chances to fail instead of one:
            it had to both correctly identify the visual sign <em>and</em> recall the correct catalog number.
            It turns out Gemini is better at pattern-matching images to Unicode than at recalling
            catalog metadata.
          </p>

          <p className="text-sm text-muted italic">
            Verdict: adding a symbolic intermediate layer made everything worse. The model can
            visually recognize hieroglyphic shapes better than it can recall Gardiner catalog numbers.
          </p>
        </ApproachCard>

        <ApproachCard
          number={3}
          title="Two-pass self-correction"
          description="Run direct OCR, then show the model its own output alongside the original image and ask it to correct errors."
          verdict="No improvement"
          verdictColor="bg-amber-50 text-amber-800"
        >
          <p className="text-secondary leading-relaxed mb-4">
            Self-correction works well for text generation &mdash; show a model its own output and
            ask it to fix mistakes. We tried a two-pass pipeline: Pass 1 does direct Unicode OCR,
            Pass 2 gets the image plus the Pass 1 output and is asked to carefully re-examine each
            sign and correct errors.
          </p>

          <p className="text-secondary leading-relaxed mb-4">
            The prompt specifically called out common error types: confused similar-looking signs,
            wrong sign order, missing small signs, duplicated signs. The model dutifully produced
            a &ldquo;corrected&rdquo; version with a log of changes.
          </p>

          <p className="text-secondary leading-relaxed mb-4">
            The corrected version was virtually identical to the original. The model made the same
            mistakes both times, because it lacks the underlying knowledge to distinguish correct
            from incorrect readings. Self-correction only works when the model knows what
            &ldquo;correct&rdquo; looks like &mdash; and for hieroglyphic Unicode, it doesn&rsquo;t.
          </p>

          <div className="bg-warm rounded-lg p-4 my-6">
            <p className="text-xs font-mono uppercase tracking-wider text-muted mb-3">Correction log from pass 2 (typical)</p>
            <p className="text-sm text-secondary italic">
              &ldquo;Line 1: Minor corrections to sign order. Line 2: Replaced 𓁶 with 𓁷 (face
              orientation). Line 3: No changes needed.&rdquo;
            </p>
            <p className="text-sm text-muted mt-2">
              The model performed cosmetic edits while leaving the fundamental errors untouched.
            </p>
          </div>

          <p className="text-sm text-muted italic">
            Verdict: self-correction requires knowing what correct looks like.
            The model makes cosmetic adjustments but the same structural errors persist.
          </p>
        </ApproachCard>

        <ApproachCard
          number={4}
          title="Describe each glyph individually"
          description="Force the model to slow down: describe each sign visually (&ldquo;seated man,&rdquo; &ldquo;owl,&rdquo; &ldquo;water ripple&rdquo;) before mapping it to Unicode."
          verdict="Most interesting failure"
          verdictColor="bg-blue-50 text-blue-700"
        >
          <p className="text-secondary leading-relaxed mb-4">
            The most promising hypothesis: maybe the model fails because it tries to read entire
            lines at once, the way it reads Latin text. What if we force it to examine each glyph
            individually, describing what it sees before committing to a Unicode character?
          </p>

          <p className="text-secondary leading-relaxed mb-4">
            This is chain-of-thought reasoning applied to visual recognition. Instead of
            &ldquo;read this line of hieroglyphs,&rdquo; we asked: &ldquo;for each sign, describe
            what you see, then identify it.&rdquo;
          </p>

          <div className="bg-white border border-border-light rounded-lg p-4 my-6 overflow-x-auto">
            <p className="text-xs font-mono uppercase tracking-wider text-muted mb-3">
              Glyph-by-glyph output (Tale of the Two Brothers, line 1)
            </p>
            <table className="text-sm w-full">
              <thead>
                <tr className="border-b border-border-light">
                  <th className="text-left py-1 pr-4 text-muted font-mono text-xs">Description</th>
                  <th className="text-left py-1 text-muted font-mono text-xs">Unicode</th>
                </tr>
              </thead>
              <tbody className="text-secondary">
                <tr className="border-b border-border-light/50"><td className="py-1 pr-4">mouth</td><td style={{ fontFamily: '"Noto Sans Egyptian Hieroglyphs", serif' }}>𓂋</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-1 pr-4">cobra</td><td style={{ fontFamily: '"Noto Sans Egyptian Hieroglyphs", serif' }}>𓆓</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-1 pr-4">loaf</td><td style={{ fontFamily: '"Noto Sans Egyptian Hieroglyphs", serif' }}>𓏏</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-1 pr-4">hare</td><td style={{ fontFamily: '"Noto Sans Egyptian Hieroglyphs", serif' }}>𓃹</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-1 pr-4">water ripple</td><td style={{ fontFamily: '"Noto Sans Egyptian Hieroglyphs", serif' }}>𓈖</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-1 pr-4">quail chick</td><td style={{ fontFamily: '"Noto Sans Egyptian Hieroglyphs", serif' }}>𓅱</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-1 pr-4">vulture</td><td style={{ fontFamily: '"Noto Sans Egyptian Hieroglyphs", serif' }}>𓄿</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-1 pr-4">loaf</td><td style={{ fontFamily: '"Noto Sans Egyptian Hieroglyphs", serif' }}>𓏏</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-1 pr-4">seated man</td><td style={{ fontFamily: '"Noto Sans Egyptian Hieroglyphs", serif' }}>𓀀</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-1 pr-4">owl</td><td style={{ fontFamily: '"Noto Sans Egyptian Hieroglyphs", serif' }}>𓅓</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-1 pr-4">face</td><td style={{ fontFamily: '"Noto Sans Egyptian Hieroglyphs", serif' }}>𓁷</td></tr>
                <tr><td className="py-1 pr-4">basket</td><td style={{ fontFamily: '"Noto Sans Egyptian Hieroglyphs", serif' }}>𓎡</td></tr>
              </tbody>
            </table>
            <p className="text-xs text-muted mt-3 italic">12 of ~35 signs shown. Full reasoning chain available on the <Link href="/hieroglyphs" className="text-accent-rust hover:underline">eval page</Link>.</p>
          </div>

          <p className="text-secondary leading-relaxed mb-4">
            This produced the most interesting results. The visual descriptions are often correct &mdash;
            the model really can see &ldquo;a seated man,&rdquo; &ldquo;an owl,&rdquo; &ldquo;a water ripple.&rdquo;
            The breakdown happens at the mapping step: knowing you&rsquo;re looking at an owl
            doesn&rsquo;t always produce the correct Unicode codepoint for &ldquo;owl&rdquo; (𓅓, Gardiner G17).
          </p>

          <p className="text-secondary leading-relaxed mb-4">
            It also revealed an inconsistency problem: the model sometimes described 35 glyphs for
            a line that actually contains 20, inserting signs that aren&rsquo;t there. The visual
            grounding is better than the other approaches, but the model still hallucinates signs
            between the ones it correctly identifies.
          </p>

          <p className="text-sm text-muted italic">
            Verdict: the most informative failure. Vision works; the bottleneck is the
            Unicode mapping and sign-counting, not the visual recognition itself.
          </p>
        </ApproachCard>

        {/* --- Summary table --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Summary
        </h2>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-border-medium">
                <th className="text-left py-3 pr-4 text-primary">Approach</th>
                <th className="text-left py-3 pr-4 text-primary">Hypothesis</th>
                <th className="text-left py-3 pr-4 text-primary">Result</th>
                <th className="text-left py-3 text-primary">What it revealed</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light">
                <td className="py-3 pr-4 font-medium">Direct Unicode</td>
                <td className="py-3 pr-4">Same pipeline as Latin OCR</td>
                <td className="py-3 pr-4 text-red-700">Wrong signs</td>
                <td className="py-3">Insufficient hieroglyphic Unicode in training data</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-4 font-medium">Gardiner codes</td>
                <td className="py-3 pr-4">Catalog numbers better than Unicode</td>
                <td className="py-3 pr-4 text-red-800">Much worse</td>
                <td className="py-3">Visual recognition &gt; catalog recall</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-4 font-medium">Self-correction</td>
                <td className="py-3 pr-4">Second pass catches errors</td>
                <td className="py-3 pr-4 text-amber-700">No change</td>
                <td className="py-3">Can&rsquo;t correct what you can&rsquo;t evaluate</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="py-3 pr-4 font-medium">Describe-each</td>
                <td className="py-3 pr-4">Slow down, examine one at a time</td>
                <td className="py-3 pr-4 text-blue-700">Best failure</td>
                <td className="py-3">Vision works; Unicode mapping doesn&rsquo;t</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* --- What we learned --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What we learned
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The four failures point to a consistent diagnosis. The bottleneck is not vision &mdash;
          the model <em>can</em> see hieroglyphic signs and describe them correctly. The bottleneck
          is the mapping from visual recognition to the correct Unicode codepoint. This is a training
          data problem, not an architecture problem.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Consider the contrast with Latin script OCR. When Gemini sees the letter &ldquo;A,&rdquo;
          it has seen millions of examples of that letter mapped to Unicode codepoint U+0041. When
          it sees the hieroglyph 𓅓 (an owl), it has seen perhaps a handful of examples mapping that
          visual shape to U+13153. The Noto Sans Egyptian Hieroglyphs font only has about 1,000 users.
          Hieroglyphic Unicode text barely exists on the internet.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This means the problem is likely solvable, but not with prompting alone. It would require either:
        </p>

        <ol className="list-decimal pl-6 mb-8 space-y-3 text-secondary leading-relaxed">
          <li>
            <strong>Fine-tuning on a hieroglyphic dataset</strong> &mdash; a few hundred pages of
            aligned image/Unicode pairs would probably be enough, given that the vision component
            already works.
          </li>
          <li>
            <strong>A sign-level classifier</strong> &mdash; crop individual signs from the page,
            classify each one against the ~750 Gardiner signs using a dedicated image classifier,
            then assemble into text. This sidesteps the Unicode mapping problem entirely.
          </li>
          <li>
            <strong>Few-shot prompting with a sign chart</strong> &mdash; include a reference sheet
            of all ~100 common signs with their Unicode codepoints in the prompt, so the model can
            look up signs rather than recall them from memory.
          </li>
        </ol>

        <p className="text-secondary leading-relaxed mb-8">
          For now, Source Library will hold the hieroglyphic books in their original scanned form
          without AI transcription. The six Egyptian texts we imported &mdash; Budge&rsquo;s
          Reading Book, Book of the Dead, and four others &mdash; are accessible as page images
          through the Internet Archive scans. When the Unicode mapping problem is solved, either
          through model improvements or a dedicated classifier, we&rsquo;ll run the pipeline again.
        </p>

        {/* --- Comparison with cuneiform --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          How this compares to cuneiform
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Our <Link href="/blog/cuneiform-ocr" className="text-accent-rust hover:underline">cuneiform experiments</Link> hit
          a ~15% F1 accuracy ceiling across most models, with Claude Opus reaching ~23%. Hieroglyphs
          are qualitatively different: we can&rsquo;t even compute a meaningful accuracy score because
          the output sequences don&rsquo;t align well enough with the ground truth for character-level
          comparison.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          But the failure mode is also different. Cuneiform failed because the 3D wedge shapes are
          hard to see in 2D photographs &mdash; a genuine vision problem. Hieroglyphs fail because the
          model can&rsquo;t map what it sees to the right Unicode codepoints &mdash; a knowledge problem.
          The cuneiform bottleneck is upstream (seeing); the hieroglyph bottleneck is downstream (naming).
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This means hieroglyphs are likely to be solved first. Vision improvements won&rsquo;t help
          cuneiform until cameras can capture the three-dimensional impression of a stylus in clay.
          But the hieroglyph Unicode mapping problem is purely a training data gap that could be
          closed with a relatively small labeled dataset.
        </p>

        <hr className="my-16 border-border-light" />

        <div className="bg-warm rounded-lg p-6 mb-8">
          <p className="text-xs font-mono uppercase tracking-wider text-muted mb-3">Technical details</p>
          <ul className="text-sm text-secondary space-y-1 leading-relaxed">
            <li><strong>Model:</strong> Gemini 3 Flash Preview (gemini-3-flash-preview)</li>
            <li><strong>Source:</strong> <a href="https://archive.org/details/egyptianreadingb00budguoft" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Budge, <em>Egyptian Reading Book for Beginners</em></a> (1896), Internet Archive</li>
            <li><strong>Test pages:</strong> 80 (Tale of the Two Brothers), 200 (Battle of Kadesh), 270 (Stele of Pi-Ankhi-Meri-Amen)</li>
            <li><strong>Image resolution:</strong> 1500px wide IIIF crops</li>
            <li><strong>Interactive eval:</strong> <Link href="/hieroglyphs" className="text-accent-rust hover:underline">Full side-by-side comparison page</Link></li>
          </ul>
        </div>

      </article>

    </ContentPageLayout>
  );
}
