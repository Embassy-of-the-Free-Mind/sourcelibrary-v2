import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'Can AI Read Cuneiform? - Blog - Source Library',
  description: 'We tested Gemini 3 Flash on cuneiform tablets from the oldest writing system on Earth. It correctly identified Law 196 of the Code of Hammurabi, detected a 2,500-year-old forgery, and produced scholarly ATF transliterations — but also hallucinated an entire document.',
  openGraph: {
    title: 'Can AI Read Cuneiform?',
    description: 'We tested Gemini 3 Flash on cuneiform tablets — the oldest writing system on Earth. The results were surprising.',
    images: [{ url: 'https://cdli.earth/dl/photo/P464358_d.jpg', width: 1200, height: 630 }],
  },
  alternates: {
    canonical: '/blog/cuneiform-ocr',
  },
};

export default function CuneiformOcrPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Can AI Read Cuneiform?"
          subtitle="Testing Gemini on the oldest writing system on Earth"
        >
          <p className="text-stone-400 text-sm mt-4">6 March 2026 &middot; 12 min read</p>
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
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library processes 16th&ndash;18th century printed manuscripts: Latin, German, Arabic, Hebrew, Sanskrit. Our AI pipeline reads page images with Gemini, transcribes the text, and translates it into English. But printed books are only 600 years old. Writing itself is 5,000 years old. What happens if we point the same pipeline at cuneiform?
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Cuneiform is the oldest known writing system, invented in southern Mesopotamia around 3200 BCE. For over three millennia, scribes pressed wedge-shaped marks into wet clay to record everything from grain receipts to epic poetry to legal codes. The script was used for Sumerian, Akkadian, Elamite, Hittite, and at least a dozen other languages before it finally died out around 75 CE. Today, hundreds of thousands of tablets sit in museums worldwide, many still unread.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          We ran a proof of concept: import cuneiform tablet photographs into Source Library, write a custom OCR prompt that asks Gemini to produce{' '}
          <a href="https://cdli.mpiwg-berlin.mpg.de/info/ATF" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">ATF</a>{' '}
          (ASCII Transliteration Format, the standard encoding used by Assyriologists), and compare the output against published transliterations from the{' '}
          <a href="https://cdli.earth" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Cuneiform Digital Library Initiative</a>{' '}
          (CDLI). We tested four tablets spanning 1,500 years of Mesopotamian history.
        </p>

        {/* --- The Tablets --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The test tablets
        </h2>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Tablet</th>
                <th className="text-left py-3 pr-4 font-semibold">Period</th>
                <th className="text-left py-3 pr-4 font-semibold">Language</th>
                <th className="text-left py-3 pr-4 font-semibold">Difficulty</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">
                  <a href="https://cdli.earth/artifacts/102318" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Ur III Administrative Tablet</a>
                </td>
                <td className="py-3 pr-4">ca. 2100 BCE</td>
                <td className="py-3 pr-4">Sumerian</td>
                <td className="py-3 pr-4">Easy</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">
                  <a href="https://cdli.earth/artifacts/213189" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Cruciform Monument of Manishtushu</a>
                </td>
                <td className="py-3 pr-4">ca. 2270 BCE (claimed)</td>
                <td className="py-3 pr-4">Akkadian</td>
                <td className="py-3 pr-4">Medium&ndash;Hard</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">
                  <a href="https://cdli.earth/artifacts/464358" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Code of Hammurabi</a>
                </td>
                <td className="py-3 pr-4">ca. 1792&ndash;1750 BCE</td>
                <td className="py-3 pr-4">Akkadian</td>
                <td className="py-3 pr-4">Hard</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">
                  <a href="https://cdli.earth/artifacts/394421" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Neo-Assyrian Tablet (K.2421+)</a>
                </td>
                <td className="py-3 pr-4">ca. 668&ndash;631 BCE</td>
                <td className="py-3 pr-4">Akkadian</td>
                <td className="py-3 pr-4">Hard</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Each tablet was imported as a &ldquo;book&rdquo; in Source Library with one page per photograph. We stored the CDLI&apos;s published ATF transliteration as ground truth metadata on each book, then ran our cuneiform OCR prompt using <strong>Gemini 3 Flash Preview</strong>.
        </p>

        {/* --- Result 1: Hammurabi --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Result 1: The Code of Hammurabi
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The photo shows the famous diorite stele with a detail of the cuneiform text. Gemini identified it immediately and produced this transliteration:
        </p>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`1. šum-ma a-wi-lum
2. i-in
3. DUMU a-wi-lim
4. uh
5. tap-pí-id
6. i-in-šu
7. ú-ha-⸢ap-pa-du⸣`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          This is <strong>Law 196</strong> &mdash; the &ldquo;eye for an eye&rdquo; law, one of the most famous legal provisions in human history:
        </p>

        <blockquote className="border-l-4 border-accent-rust/30 bg-accent-rust/5 pl-6 py-4 mb-8 rounded-r-lg">
          <p className="text-secondary leading-relaxed italic text-lg">
            &ldquo;If a citizen destroys the eye of a fellow citizen, they shall destroy his eye.&rdquo;
          </p>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6">
          Gemini correctly identified the text, the period (Old Babylonian, reign of Hammurabi, ca. 1792&ndash;1750 BCE), the genre (royal-inscription/legal), and even the specific column location on the stele (Column XXV, reverse, lines 40&ndash;44). It correctly read the Akkadian vocabulary: <em>šumma</em> (&ldquo;if&rdquo;), <em>awīlum</em> (&ldquo;citizen&rdquo;), <em>īnum</em> (&ldquo;eye&rdquo;), <em>DUMU</em> (Sumerian logogram for &ldquo;son/fellow&rdquo;), <em>uhtappid</em> (&ldquo;destroyed&rdquo;), <em>uhappadū</em> (&ldquo;they shall destroy&rdquo;). Confidence: 1.0.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The translation was equally impressive, noting the social class distinctions in the law: this &ldquo;eye for an eye&rdquo; principle applied only between members of the <em>awīlum</em> (upper) class. Injuring a commoner or slave resulted in a financial fine, not physical retaliation. Gemini even described the relief sculpture above the text &mdash; King Hammurabi receiving the rod and ring (symbols of divine justice) from the sun god Shamash.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>Verdict:</strong> Accurate reading of one of the best-known cuneiform texts. But this is also the easiest test &mdash; Law 196 is in every introductory textbook.
        </p>

        {/* --- Result 2: Manishtusu --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Result 2: Detecting a 2,500-year-old forgery
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The most surprising result came from the Cruciform Monument of Manishtushu (BM 91022). This black diorite monument claims to be an inscription of King Manishtushu of Akkad (ca. 2270 BCE), recording his purchase of vast tracts of land. But scholars have long suspected it&apos;s actually a &ldquo;pious fraud&rdquo; &mdash; a forgery created by Neo-Babylonian temple priests around 550 BCE to &ldquo;discover&rdquo; ancient royal grants justifying their tax exemptions.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Gemini identified this independently. From the main view, it correctly read the king&apos;s name:
        </p>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`1. ⸢{m}ma-ni-isz⸣-tu-su
2. LUGAL
3. KIŠ`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          &ldquo;Manishtushu, King of Kish&rdquo; &mdash; correct. From the detail view, it went further:
        </p>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`<script>other (Archaizing Neo-Babylonian mimicking Old Akkadian)</script>
<period>ca. 550 BC (imitating ca. 2270-2255 BC)</period>
<genre>royal-inscription (Pseudo-Old Akkadian "Pious Fraud")</genre>`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          The model classified the script as &ldquo;archaizing Neo-Babylonian mimicking Old Akkadian&rdquo; and the genre as a &ldquo;Pious Fraud.&rdquo; It then explained its reasoning: the sign forms are &ldquo;extremely regular&rdquo; for an ostensibly archaic text, and it noted grammatical features (like the <em>-ni</em> verb suffix) that Neo-Babylonian scribes <em>believed</em> were characteristic of ancient Akkadian.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          It went on to transliterate the daily offerings the &ldquo;ancient&rdquo; king supposedly established for the god Shamash at Sippar:
        </p>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`column x (Side D)
1. 2(u) GUR GIG           → 20 GUR of wheat
2. 2(u) GUR ŠE.GIŠ.I3    → 20 GUR of sesame
...
11. 2(u) MA.NA LAL3       → 20 mina of honey
12. 2(u) MA.NA I3.NUN     → 20 mina of ghee
13. 2(u) MA.NA I3.DUG3.GA → 20 mina of fine oil`}</code></pre>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>Verdict:</strong> This is the standout result. The model didn&apos;t just read signs &mdash; it performed <em>paleographic analysis</em>, dating the script style independently of the claimed date, and arrived at the same conclusion as modern Assyriologists. Whether it&apos;s truly reasoning from visual features or pattern-matching from its training data is an open question, but the output is scholarly-grade.
        </p>

        {/* --- Result 3: Ur III --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Result 3: A confident hallucination
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The Ur III administrative tablet (P102318) was supposed to be the easy test &mdash; a small, well-preserved clay tablet from Drehem, ca. 2100 BCE. The CDLI&apos;s published transliteration reads:
        </p>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`@obverse
1. 2(disz) udu niga       → 2 fattened sheep
2. u4 7(disz)-kam          → day 7
3. ki ab-ba-sa6-ga-ta      → from Abbasaga
4. a-hu-we-er              → (personal name) Ahuwer
@reverse
1. i3-dab5                 → received
2. iti ezem-{d}nin-a-zu    → month: Festival of Ninazu
3. mu en-mah-gal-an-na ... → year: Enmahgalanna was installed...`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          It&apos;s a sheep receipt. Two fattened sheep, received by Ahuwer from Abbasaga on the 7th day of the Festival of Ninazu. Seven lines, clear and well-studied.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Gemini produced this:
        </p>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`@obverse
1. 1(barig) 1(ban2) {gesz}haszhur duru5  → fresh apples
2. ki-szum2-ma-ta                          → from the onion field
3. 1(barig) 3(ban2) {gesz}haszhur duru5  → fresh apples
4. e2-gal-sze3                             → to the palace
@reverse
1. de6-a                                   → delivered
2. giri3 lu2-{d}nin-szubur                → via Lu-Ninshubur
3. iti szu-numun                           → month: Sowing
4. mu {d}szu-{d}suen lugal                → year: Shu-Suen (became) king`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          The structure is right &mdash; obverse, reverse, month name, year name, the right number of lines. The vocabulary is impeccable Sumerian administrative terminology. But the content is <em>completely fabricated</em>. The real tablet records sheep; the AI invented a delivery of fresh apples from an onion garden. It even offered a plausible scholarly note: &ldquo;In Umma, apples were frequently intercropped in onion gardens.&rdquo;
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>Verdict:</strong> This is a textbook hallucination. The model has excellent knowledge of what Ur III administrative tablets <em>look like</em> &mdash; the format, the vocabulary, the typical transaction types &mdash; but it&apos;s generating from that knowledge rather than reading the specific wedge impressions in this photograph. Confidence: 0.95.
        </p>

        {/* --- Result 4: Medical tablet --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Result 4: Wrong identification, right library
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The Neo-Assyrian tablet (P394421) is catalogued as a medical prescription text (BAM 6, 555). Gemini identified it as the final section of <strong>Tablet VII of Enūma Eliš</strong>, the Babylonian Creation Epic &mdash; a different text entirely. However, it correctly identified the fragment numbers (K.2421, K.2511, K.16765), the provenance (Library of Ashurbanipal, Nineveh), and the period (ca. 668&ndash;631 BCE).
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>Verdict:</strong> Wrong text, right context. The model correctly &ldquo;reads&rdquo; the museum labels and fragment numbers visible in the photograph, and its period identification is accurate. But the actual sign readings may be influenced by its strong prior about what K-numbered Nineveh fragments typically contain (Enūma Eliš is one of the most famous texts from that library).
        </p>

        {/* --- Analysis --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What we learned
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The honest summary: <strong>Gemini 3 Flash can read cuneiform in some cases, but it cannot be trusted as a general-purpose cuneiform OCR tool.</strong> The results are a mix of genuine reading, knowledge retrieval, and confident fabrication.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          What works
        </h3>

        <ul className="list-disc pl-6 mb-8 space-y-2 text-secondary leading-relaxed">
          <li><strong>Famous texts:</strong> The Hammurabi reading is sign-accurate. For well-known inscriptions that appear in training data, Gemini can produce correct transliterations and translations.</li>
          <li><strong>Metadata and context:</strong> Period identification (3/4 correct), genre classification, and physical condition assessment are reliable. The &ldquo;pious fraud&rdquo; detection on the Manishtusu monument is genuinely impressive.</li>
          <li><strong>ATF format:</strong> The output follows proper ATF conventions &mdash; line numbering, surface markers, determinatives, damage notation. Whatever the model learned about cuneiform scholarship, it learned the formatting well.</li>
          <li><strong>Scholarly apparatus:</strong> The notes, vocabulary lists, and translation annotations are rich and usually accurate. The model is an excellent cuneiform <em>commentator</em>, even when it&apos;s a poor cuneiform <em>reader</em>.</li>
        </ul>

        <h3 className="text-xl text-primary mt-10 mb-4">
          What doesn&apos;t work
        </h3>

        <ul className="list-disc pl-6 mb-8 space-y-2 text-secondary leading-relaxed">
          <li><strong>Novel tablets:</strong> The Ur III sheep receipt is well-photographed, well-preserved, and has only 7 lines of text. The model hallucinated an entirely different document. If it can&apos;t read this, it can&apos;t read the hundreds of thousands of unpublished tablets that would benefit most from AI assistance.</li>
          <li><strong>Confidence calibration:</strong> 0.95 confidence on a completely fabricated reading. The model has no self-knowledge about when it&apos;s actually reading signs versus generating plausible text from its training distribution.</li>
          <li><strong>Sign-level vision:</strong> Cuneiform signs are fundamentally different from alphabetic or even logographic scripts. Each sign is a pattern of wedge impressions (vertical, horizontal, diagonal, Winkelhaken) whose arrangement determines the reading. The model doesn&apos;t appear to have reliable sign-level visual discrimination.</li>
        </ul>

        <h3 className="text-xl text-primary mt-10 mb-4">
          The knowledge vs. vision distinction
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          The most important pattern in these results is the gap between <em>knowledge</em> and <em>vision</em>. Gemini has extensive knowledge about cuneiform &mdash; it knows ATF format, Sumerian and Akkadian vocabulary, administrative tablet conventions, royal inscription formulae, and even the paleographic debate about the Cruciform Monument. But its ability to visually discriminate individual cuneiform signs from a photograph appears limited.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          For the Hammurabi stele, knowledge and vision converge: the text is famous enough that recognizing the context may be sufficient to produce the correct reading. For the Ur III tablet, there&apos;s no famous text to fall back on, and the model generates a plausible but incorrect document from its distributional knowledge of what Ur III tablets contain.
        </p>

        {/* --- Comparison with 2.5 Flash --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Model comparison: 2.5 Flash vs. 3 Flash
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          We initially ran this experiment with <strong>Gemini 2.5 Flash</strong> before switching to <strong>Gemini 3 Flash Preview</strong>. The difference was stark:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Metric</th>
                <th className="text-left py-3 pr-4 font-semibold">2.5 Flash</th>
                <th className="text-left py-3 pr-4 font-semibold">3 Flash Preview</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Period identification</td>
                <td className="py-3 pr-4">1/4 correct</td>
                <td className="py-3 pr-4">3/4 correct</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Hammurabi reading</td>
                <td className="py-3 pr-4">6 lines of wrong Sumerian</td>
                <td className="py-3 pr-4">Correctly reads Law 196</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Manishtusu</td>
                <td className="py-3 pr-4">Misidentified as Sargon II</td>
                <td className="py-3 pr-4">Correctly identified; detected forgery</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Ur III tablet</td>
                <td className="py-3 pr-4">28-line barley ledger (fabricated)</td>
                <td className="py-3 pr-4">Apple delivery (fabricated, but closer structure)</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Scholarly notes</td>
                <td className="py-3 pr-4">Generic</td>
                <td className="py-3 pr-4">Detailed, with paleographic analysis</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Gemini 2.5 Flash produced more text (34 lines for the Ur III tablet vs. 11) but with lower accuracy, suggesting it was generating more freely from its training distribution. The 3 Flash model was more constrained and closer to the right structure, even when the sign readings were wrong.
        </p>

        {/* --- Infrastructure --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The infrastructure works
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The most practically useful outcome of this experiment is that <strong>Source Library&apos;s existing pipeline handles cuneiform with zero code changes</strong>. The two-step architecture &mdash; OCR produces transliteration stored in <code className="bg-warm px-1.5 py-0.5 rounded text-sm">ocr.data</code>, translation produces English stored in <code className="bg-warm px-1.5 py-0.5 rounded text-sm">translation.data</code> &mdash; maps naturally to cuneiform:
        </p>

        <ul className="list-disc pl-6 mb-8 space-y-2 text-secondary leading-relaxed">
          <li><strong>OCR step</strong> = ATF transliteration (cuneiform signs &rarr; ASCII text)</li>
          <li><strong>Translation step</strong> = Sumerian/Akkadian &rarr; English</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6">
          Custom prompts are stored as named families in the <code className="bg-warm px-1.5 py-0.5 rounded text-sm">prompts</code> collection (&ldquo;Cuneiform OCR&rdquo; and &ldquo;Cuneiform Translation&rdquo;), and the reader, search, and translation percentage tracking all work without modification. The four test tablets are browsable in Source Library right now:
        </p>

        <ul className="list-disc pl-6 mb-8 space-y-2 text-secondary leading-relaxed">
          <li><a href="https://sourcelibrary.org/book/ur-iii-administrative-tablet-drehem-p102318" className="text-accent-rust hover:underline">Ur III Administrative Tablet</a></li>
          <li><a href="https://sourcelibrary.org/book/manishtusu-obelisk-cruciform-monument-p213189" className="text-accent-rust hover:underline">Cruciform Monument of Manishtushu</a></li>
          <li><a href="https://sourcelibrary.org/book/code-of-hammurabi-p464358" className="text-accent-rust hover:underline">Code of Hammurabi</a></li>
          <li><a href="https://sourcelibrary.org/book/neo-assyrian-medical-prescriptions-bam-6-555-p394421" className="text-accent-rust hover:underline">Neo-Assyrian Tablet (K.2421+)</a></li>
        </ul>

        {/* --- Future --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What would make this work
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          This PoC suggests cuneiform AI OCR is close but not yet reliable. Here&apos;s what would move it forward:
        </p>

        <ul className="list-disc pl-6 mb-8 space-y-2 text-secondary leading-relaxed">
          <li><strong>Fine-tuned models:</strong> A vision model trained on cuneiform sign forms with ATF labels would dramatically improve sign-level accuracy. The{' '}
            <a href="https://cdli.earth" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">CDLI</a>{' '}
            has over 300,000 tablet photographs with published transliterations &mdash; an enormous training dataset waiting to be used.</li>
          <li><strong>Sign-level grounding:</strong> Current results suggest the model processes cuneiform at the &ldquo;document&rdquo; level (recognizing tablet types) rather than the &ldquo;sign&rdquo; level (reading individual wedge patterns). Future prompts or fine-tuning could encourage per-sign analysis.</li>
          <li><strong>Multi-angle photographs:</strong> Clay tablets are three-dimensional objects. Many signs are only readable from specific angles or under raking light. A pipeline that combines multiple photographs of the same tablet could improve coverage.</li>
          <li><strong>Hybrid approach:</strong> Use AI for initial sign proposals, then present them to human epigraphers for verification. Even an imperfect first pass saves significant expert time. Source Library&apos;s existing manual editing tools (OCR editor, revision history) support this workflow already.</li>
        </ul>

        {/* --- Conclusion --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Conclusion
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Can AI read cuneiform? Sometimes. Gemini 3 Flash correctly reads the Code of Hammurabi, detects a Neo-Babylonian forgery from its script style, and produces excellent scholarly commentary. But it also fabricates an entire Sumerian document with 0.95 confidence. The model has cuneiform <em>knowledge</em> without reliable cuneiform <em>vision</em>.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          For Source Library, this means cuneiform support is infrastructure-ready but model-limited. The prompts, import pipeline, and evaluation framework are built. When a model can reliably read wedge impressions &mdash; whether through fine-tuning, improved vision capabilities, or the next generation of foundation models &mdash; Source Library can process cuneiform tablets with the same pipeline it uses for Renaissance printed books.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The oldest writing system in the world is waiting.
        </p>

        <hr className="border-light my-12" />

        <p className="text-muted text-sm leading-relaxed">
          <strong>Technical details:</strong> Model: Gemini 3 Flash Preview. Prompts stored as &ldquo;Cuneiform OCR&rdquo; and &ldquo;Cuneiform Translation&rdquo; in the Source Library prompts collection. Tablet photographs sourced from CDLI. Ground truth ATF from CDLI published transliterations. Full evaluation report and import scripts available on request. All four test tablets are hidden from the public library but accessible via direct link.
        </p>
      </article>

      <BlogComments slug="cuneiform-ocr" />
    </ContentPageLayout>
  );
}