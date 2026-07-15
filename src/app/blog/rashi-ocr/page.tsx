import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'The Rashi Problem: When AI OCR Hallucinates in Hebrew - Research Notes - Source Library',
  description: 'Gemini reads Arabic, Sanskrit, Chinese, and Latin with measurable accuracy. But on Rashi script — the typeface used in the Zohar and Talmud for 500 years — it confidently produces text that isn\'t on the page. The scariest part: our quality metrics didn\'t catch it.',
  openGraph: {
    title: 'The Rashi Problem: When AI OCR Hallucinates in Hebrew',
    description: 'AI reads Arabic and Sanskrit fine. On Rashi script it hallucinates — and our quality metrics gave it a passing grade.',
    images: [{ url: 'https://images.sourcelibrary.org/archived/6990630be7b7642c081de08b/8.jpg', width: 1200, height: 1600 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/6990630be7b7642c081de08b/8.jpg' }],
  },
  alternates: {
    canonical: '/blog/rashi-ocr',
  },
};

function ComparisonBlock({ label, text, verdict, verdictColor }: { label: string; text: string; verdict: string; verdictColor: string }) {
  return (
    <div className="border border-border-light rounded-lg overflow-hidden mb-4">
      <div className="bg-warm px-4 py-2 border-b border-border-light flex items-center justify-between">
        <span className="text-sm font-mono text-secondary">{label}</span>
        <span className={`text-xs font-mono px-2 py-0.5 rounded font-medium ${verdictColor}`}>
          {verdict}
        </span>
      </div>
      <div className="px-4 py-3 text-sm text-secondary leading-relaxed font-mono" dir="auto">
        {text}
      </div>
    </div>
  );
}

export default function RashiOcrPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Rashi Problem"
          subtitle="When AI OCR hallucinates in Hebrew &mdash; and your quality metrics say it's fine"
          image="https://images.sourcelibrary.org/archived/6990630be7b7642c081de08b/8.jpg"
          imageAlt="Page from the Zohar, Cremona 1558 edition, showing dense Rashi script"
        >
          <p className="text-stone-400 text-sm mt-4">24 March 2026 &middot; 10 min read</p>
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
          Source Library uses Gemini Flash to OCR historical texts in dozens of languages. We&rsquo;ve measured its consistency on Latin and German (<a href="/blog/ocr-consistency" className="text-accent-rust hover:underline">1.8% disagreement rate</a>), tested it on hieroglyphs (<a href="/blog/hieroglyph-ocr" className="text-accent-rust hover:underline">it can&rsquo;t</a>) and cuneiform (<a href="/blog/cuneiform-ocr" className="text-accent-rust hover:underline">mixed results</a>). This week we found something more unsettling: a failure mode where the AI produces confident, plausible, contextually appropriate text that has almost no relationship to what&rsquo;s actually on the page &mdash; and our quality metrics gave it a passing grade.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          The script is Rashi. The book is the <a href="https://sourcelibrary.org/book/6990630be7b7642c081de08b" className="text-accent-rust hover:underline">Zohar, Cremona 1558 edition</a> &mdash; 548 pages of Kabbalistic commentary in Aramaic, printed in the semi-cursive Hebrew typeface that has been standard for rabbinic literature since the 15th century.
        </p>

        {/* --- The Discovery --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Discovery
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          We were reviewing <a href="https://sourcelibrary.org/book/6990630be7b7642c081de08b/page/6990630ce7b7642c081de094" className="text-accent-rust hover:underline">page 8 of the Zohar</a>, a body text page in dense Rashi script. The OCR looked plausible at first glance &mdash; Hebrew and Aramaic words, Kabbalistic vocabulary, structured paragraphs. The English translation read like polished Zohar commentary.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Then we compared the OCR against <a href="https://www.sefaria.org/Zohar,_Shemot" className="text-accent-rust hover:underline">Sefaria&rsquo;s reference text</a> of the same passage.
        </p>

        <div className="bg-warm border border-border-light rounded-xl p-6 mb-8">
          <p className="text-xs font-mono uppercase tracking-wider text-muted mb-4">The same passage, three ways</p>

          <ComparisonBlock
            label="Sefaria reference (known correct)"
            text="אמר רבי שמעון, מאן דרגיל למסבל צערא אף על גב דאתי לפום שעתא צערא, סביל מטלנוי, ולא חייש, אבל מאן דלא רגיל בצער..."
            verdict="Ground truth"
            verdictColor="bg-emerald-100 text-emerald-700"
          />

          <ComparisonBlock
            label="Our OCR (v3 prompt)"
            text="ישראל כד כחתו למצרים רגילן בנערה הוו דהא כל יומוי דההוא זכאה לזכוהון בנערה הוא ועל סכלו גלותא כדקא יאות..."
            verdict="Letter-level errors"
            verdictColor="bg-amber-100 text-amber-700"
          />

          <ComparisonBlock
            label="Re-OCR (v10 prompt)"
            text="הוא יתברך ויתעלה שמו לעד ולנצח נצחים... מכותיו... יתרון... מוסר... מכותיו... יתרון..."
            verdict="Complete hallucination"
            verdictColor="bg-red-100 text-red-700"
          />
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The v3 prompt produced garbled but recognizable text. You can see fragments of the real passage &mdash; &ldquo;Israel when they went down to Egypt&rdquo; is there, but <span className="font-mono text-sm">כחתו</span> should be <span className="font-mono text-sm">נחתו</span> and <span className="font-mono text-sm">בנערה</span> should be <span className="font-mono text-sm">בצערא</span>. Letter-level substitutions, the kind you&rsquo;d expect from a model struggling with an unfamiliar typeface.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The v10 prompt &mdash; our newest, most sophisticated OCR prompt, with manuscript detection and calibrated warning thresholds &mdash; produced complete gibberish. It misidentified Rashi <em>print</em> as handwriting, triggered the manuscript processing mode, and generated repetitive modern Hebrew words (<span className="font-mono text-sm">מכותיו... יתרון... מוסר...</span>) in an incoherent loop. Not a single word from the actual page.
        </p>

        {/* --- Why Rashi --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What Makes Rashi Special
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Rashi script is not a language. It&rsquo;s a <em>typeface</em> &mdash; the same 27 Hebrew letters rendered in a 15th-century Sephardic semi-cursive style. If you know square Hebrew, you know the same alphabet, but the glyphs look completely different. <span className="font-mono text-sm">א</span> (alef) in square Hebrew barely resembles its Rashi counterpart. <span className="font-mono text-sm">ד</span> (dalet) and <span className="font-mono text-sm">ר</span> (resh), already similar in square script, become nearly identical in Rashi.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This is why Arabic and Sanskrit work fine. Arabic Nastaliq and Devanagari are visually distinct scripts that Gemini has clearly seen in training data. But Rashi script occupies an uncanny valley: it maps to the same Unicode characters as square Hebrew, so the model &ldquo;knows&rdquo; Hebrew, but the visual forms are different enough to cause systematic misreadings. The model doesn&rsquo;t know that it doesn&rsquo;t know.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The only published study on Rashi OCR &mdash; <a href="https://arxiv.org/abs/1811.01290" className="text-accent-rust hover:underline">Mahpod &amp; Keller (2018)</a> from Bar-Ilan University &mdash; achieved 99.84% letter accuracy using a specialized CNN+LSTM architecture trained on 3.3 million annotated characters from 170 different books. They found that the LSTM (which learns the Aramaic dialect) transfers perfectly between books, but the CNN (which reads the glyphs) needs per-book fine-tuning because every printing house shaped the letters differently. This is a fundamentally different approach from a general-purpose vision model trying to read everything zero-shot.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          Rashi script has been used continuously in Jewish printing for over 500 years. The Talmud, Zohar, Midrash, halakhic codes, responsa literature &mdash; the core canon of rabbinic Judaism is printed in this typeface. We have 316 Hebrew and Aramaic books in Source Library. Many of them use Rashi script. The quality problem is not confined to one Zohar.
        </p>

        {/* --- The Quality Metrics Blind Spot --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Quality Metrics Blind Spot
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          This is the part that concerns us most. We ran semantic alignment scoring on the full 548-page Zohar. The system embeds the OCR and the English translation separately, then computes cosine similarity. Pages where OCR and translation diverge semantically get flagged.
        </p>

        <div className="bg-warm border border-border-light rounded-xl p-6 mb-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Pages scored</p>
              <p className="text-2xl font-serif text-primary">536</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Mean alignment</p>
              <p className="text-2xl font-serif text-primary">0.868</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Pages flagged</p>
              <p className="text-2xl font-serif text-primary">10</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Page 8 score</p>
              <p className="text-2xl font-serif text-primary">0.884</p>
            </div>
          </div>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Page 8 &mdash; the page we manually verified as significantly garbled &mdash; scored <strong>0.884</strong>. Not flagged. Comfortably above our Hebrew threshold of 0.80.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The reason is straightforward: semantic alignment measures whether the OCR and translation agree with <em>each other</em>. It does not measure whether either one agrees with <em>what&rsquo;s on the page</em>. If the model recognizes that this is the Zohar on Parashat Shemot &mdash; and it clearly does, given the correct metadata tags &mdash; it can generate plausible Zohar content for both the OCR and the translation. The two outputs align beautifully because they were confabulated from the same source knowledge.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          This is a known limitation of any internal-consistency metric. CER (Character Error Rate) requires external ground truth by definition. Our alignment scoring was designed for a different failure mode: catching cases where the OCR reads one thing and the translation says another (mistranslation, dropped paragraphs, wrong language). It was never designed to catch cases where both sides of the pipeline are wrong in the same direction. On Rashi script, that&rsquo;s exactly what happens.
        </p>

        {/* --- What Works and What Doesn't --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Audit: What Works
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          We audited OCR quality across every non-Latin script in the library. The results draw a clear line.
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light">
                <th className="text-left py-2 pr-4 text-muted font-mono text-xs uppercase tracking-wider">Script</th>
                <th className="text-left py-2 pr-4 text-muted font-mono text-xs uppercase tracking-wider">Books</th>
                <th className="text-left py-2 pr-4 text-muted font-mono text-xs uppercase tracking-wider">Pages OCR&rsquo;d</th>
                <th className="text-left py-2 pr-4 text-muted font-mono text-xs uppercase tracking-wider">Quality</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light/50">
                <td className="py-2 pr-4 font-medium">Arabic / Nastaliq</td>
                <td className="py-2 pr-4">336</td>
                <td className="py-2 pr-4">36,607</td>
                <td className="py-2 pr-4"><span className="text-emerald-600 font-medium">Good.</span> 45&ndash;73% Arabic character density. Handles faded manuscripts honestly with &lt;unclear&gt; tags.</td>
              </tr>
              <tr className="border-b border-border-light/50">
                <td className="py-2 pr-4 font-medium">Devanagari (Sanskrit)</td>
                <td className="py-2 pr-4">339</td>
                <td className="py-2 pr-4">76,965</td>
                <td className="py-2 pr-4"><span className="text-emerald-600 font-medium">Good.</span> Native Unicode output, correct script detection.</td>
              </tr>
              <tr className="border-b border-border-light/50">
                <td className="py-2 pr-4 font-medium">Chinese / CJK</td>
                <td className="py-2 pr-4">600</td>
                <td className="py-2 pr-4">63,036</td>
                <td className="py-2 pr-4"><span className="text-emerald-600 font-medium">Good.</span> CJK characters present and coherent.</td>
              </tr>
              <tr className="border-b border-border-light/50">
                <td className="py-2 pr-4 font-medium">Armenian</td>
                <td className="py-2 pr-4">48</td>
                <td className="py-2 pr-4">12,529</td>
                <td className="py-2 pr-4"><span className="text-emerald-600 font-medium">Good.</span> Native Armenian script output.</td>
              </tr>
              <tr className="border-b border-border-light/50">
                <td className="py-2 pr-4 font-medium">Square Hebrew</td>
                <td className="py-2 pr-4">~100</td>
                <td className="py-2 pr-4">~20,000</td>
                <td className="py-2 pr-4"><span className="text-amber-600 font-medium">Adequate.</span> Block Hebrew type is read correctly. Bible and prayer book pages are accurate.</td>
              </tr>
              <tr className="border-b border-border-light/50">
                <td className="py-2 pr-4 font-medium">Rashi script</td>
                <td className="py-2 pr-4">~200</td>
                <td className="py-2 pr-4">~40,000</td>
                <td className="py-2 pr-4"><span className="text-red-600 font-medium">Poor.</span> Systematic confabulation. Model generates plausible content from context rather than reading the page.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-12">
          The pattern is clear: Gemini handles genuinely foreign scripts well. Arabic looks nothing like Latin; Devanagari looks nothing like Latin; Chinese looks nothing like anything. The model either reads them or admits it can&rsquo;t. Rashi script is dangerous precisely because it&rsquo;s <em>close enough</em> to square Hebrew that the model thinks it&rsquo;s reading when it&rsquo;s actually guessing.
        </p>

        {/* --- What We Need --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Detecting the Problem Without Human Ground Truth
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Most OCR evaluation requires human-transcribed ground truth. For 40,000 pages of Aramaic Kabbalistic commentary, that&rsquo;s not realistic. But there are several automated approaches that don&rsquo;t require a human reader:
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          1. Reference text comparison
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Many of our Rashi-script books are canonical texts with existing digital transcriptions. The Zohar is on <a href="https://www.sefaria.org" className="text-accent-rust hover:underline">Sefaria</a>. The Talmud is on Sefaria. The Shulchan Aruch, Mishneh Torah, and hundreds of other works have been manually typed and proofread over decades &mdash; the <a href="https://www.biu.ac.il/jh/Responsa/" className="text-accent-rust hover:underline">Responsa Project</a> at Bar-Ilan University alone has 200 million words.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The approach: embed each page&rsquo;s OCR text and slide a window across the reference text, finding the best-matching chunk. If the cosine similarity between our OCR and the known-correct transcription falls below a threshold, the page is flagged. This is computationally cheap (one embedding per page, one per reference chunk) and gives a genuine external quality signal &mdash; unlike our current OCR-vs-translation alignment, which only measures internal consistency.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          2. Repetition detection
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          The v10 hallucination had a distinctive pattern: the same words repeated in loops (<span className="font-mono text-sm">מכותיו... יתרון... מוסר... מכותיו... יתרון...</span>). Real text &mdash; even repetitive liturgical text &mdash; has a different distribution. A simple unique-word ratio (distinct words / total words) catches the worst hallucinations. The trick is calibrating the threshold: Hebrew religious texts legitimately repeat divine names and key terms, so the bar has to be set lower than for, say, Latin philosophical prose.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          3. Multi-temperature consistency
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          We already have a probe tool that re-OCRs the same page at different temperatures (0, 0.3, 0.6) and measures how much the outputs diverge. When the model is actually reading text, low temperatures converge on the same output. When it&rsquo;s hallucinating, different temperatures produce different hallucinations. This is expensive (3 additional OCR calls per page) but catches confabulation that reference comparison misses &mdash; for the books that <em>don&rsquo;t</em> have reference texts.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          4. Character frequency analysis
        </h3>

        <p className="text-secondary leading-relaxed mb-8">
          Every language has a characteristic letter frequency distribution. Zohar Aramaic should have a different distribution from modern Hebrew. If the OCR output&rsquo;s character frequencies match modern Hebrew better than Aramaic, something is wrong. This is a lightweight heuristic &mdash; not definitive, but a useful first-pass filter over 40,000 pages.
        </p>

        {/* --- Where We Need Humans --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Where We Need Human Ground Truth
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Automated methods can flag problems. They cannot fix them. For that we need:
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Prompt calibration samples.</strong> To improve the OCR prompt for Rashi script, we need a small set of pages (50&ndash;100) with verified transcriptions. These don&rsquo;t need to be manually typed from scratch &mdash; Sefaria&rsquo;s existing digital text, aligned to specific page images, gives us the ground truth. But someone who reads Hebrew needs to verify the alignment, because our page images don&rsquo;t carry canonical reference coordinates (folio numbers, parasha markers) that would allow automatic mapping.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Script classification.</strong> We need to know which books actually use Rashi script vs. square Hebrew. Many books use both (Talmud pages have square Hebrew for the Mishnah, Rashi script for the commentary). A Hebrew reader can classify our 316 books in a few hours. Automated classification is unreliable &mdash; our v10 prompt already showed it confuses Rashi print with handwriting.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          <strong>Post-correction validation.</strong> Even after improving the prompt, we&rsquo;ll need spot-checks to verify the improvement is real. The Mahpod &amp; Keller paper showed that per-book fine-tuning is essential because every printing house shaped the letters differently. A prompt that works on the 1558 Cremona Zohar might fail on the 1560 Mantua Zohar. Human validators keep the feedback loop honest.
        </p>

        {/* --- What's Next --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What&rsquo;s Next
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          We&rsquo;re building reference text validation into the pipeline &mdash; starting with Sefaria as the reference corpus for Zohar, Talmud, and biblical commentaries. Pages that fall below a reference-match threshold will be flagged for review rather than served to readers as if they&rsquo;re reliable.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We&rsquo;re also testing explicit Rashi script instructions in the OCR prompt (&ldquo;This text uses Rashi semi-cursive Hebrew script, not standard square Hebrew&rdquo;) and evaluating whether <a href="https://dicta.org.il" className="text-accent-rust hover:underline">DICTA&rsquo;s Hebrew language models</a> can clean up systematic character substitutions in post-processing.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          In the meantime, the honest thing to do is label these pages. If the OCR on a Rashi-script page hasn&rsquo;t been validated against a reference text, the reader should know. Confident-sounding hallucinations are worse than visible uncertainty.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          The broader lesson: internal consistency metrics are necessary but not sufficient. A system that only checks whether its outputs agree with each other will miss the case where the whole pipeline is wrong in the same direction. For well-resourced languages with existing digital corpora, reference comparison is cheap and definitive. For everything else, we need humans in the loop &mdash; not to read every page, but to keep the quality signal grounded in reality.
        </p>

        {/* --- Update --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Update: 25 March 2026
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          We tested explicit Rashi script instructions with Gemini 3 Flash Preview. When the prompt tells the model &ldquo;This text is printed in Rashi script (semi-cursive Hebrew typeface), NOT standard square Hebrew &mdash; read the letterforms accordingly,&rdquo; the output improves substantially. The model produces recognizable Aramaic text with correct vocabulary, proper abbreviation markers (<span className="font-mono text-sm">&quot;ס&quot;א</span>, <span className="font-mono text-sm">קב&quot;ה</span>), and coherent paragraph structure. It&rsquo;s no longer hallucinating.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          But &ldquo;better&rdquo; is not &ldquo;good.&rdquo; Comparing the prompted output against Sefaria&rsquo;s reference text still reveals word-level substitutions and dropped phrases. The model reads the general sense correctly but gets individual letters wrong &mdash; exactly the kind of errors you&rsquo;d expect from a vision model that hasn&rsquo;t been trained on this specific typeface. This is a fundamentally harder problem than the complete confabulation we saw before, and one that may require specialized fine-tuning or future model improvements to solve.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Our conclusion: Rashi-script books now display a quality warning banner in the reader. The warning appears on both the OCR and translation tabs, telling readers that current AI models struggle with this typeface and that the output should not be trusted. We&rsquo;ve set <span className="font-mono text-sm">metadata.scriptType: &ldquo;Rashi&rdquo;</span> on the Cremona and Mantua Zohar editions, which also triggers rendering in <a href="https://fonts.google.com/noto/specimen/Noto+Rashi+Hebrew" className="text-accent-rust hover:underline">Noto Rashi Hebrew</a> &mdash; the correct display typeface.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          We are waiting for future model generations with better Rashi support before re-running OCR on these books at scale.
        </p>

        <hr className="border-border-light my-12" />

        <p className="text-secondary leading-relaxed mb-4 text-sm">
          The Zohar page discussed here is <a href="https://sourcelibrary.org/book/the-zohar-sefer-ha-zohar-attributed/page/6990630ce7b7642c081de096" className="text-accent-rust hover:underline">viewable in the reader</a> (with Rashi font rendering and quality warning). The full Hebrew OCR quality audit is tracked in <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/350" className="text-accent-rust hover:underline">GitHub issue #350</a>.
        </p>

      </article>


    </ContentPageLayout>
  );
}
