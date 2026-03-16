import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'Can AI Read Cuneiform? - Research Notes - Source Library',
  description: 'We ran eight experiments testing Gemini and Claude on 107 cuneiform tablets — the oldest writing system on Earth. Claude Opus breaks through the 15% accuracy ceiling, a contamination test proves genuine visual analysis, and temperature tuning reveals opposite preferences across model families.',
  openGraph: {
    title: 'Can AI Read Cuneiform?',
    description: 'Eight experiments testing Gemini and Claude on cuneiform tablets — the oldest writing system on Earth. Claude Opus breaks through the 15% accuracy ceiling.',
    images: [{ url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/P464358_d-sBPv8Z5dT88Vwi9ZcuAMnSz4nYflrw.jpg', width: 1200, height: 630 }],
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
          subtitle="Testing Gemini and Claude on the oldest writing system on Earth"
        >
          <p className="text-stone-400 text-sm mt-4">9 March 2026 &middot; 35 min read</p>
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

        {/* --- Hero: tablet photographs --- */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/P102318-r7lQSIt2HO5oRGeNDZnfAmebq92DUU.jpg"
              alt="Ur III administrative tablet from Drehem, ca. 2100 BCE"
              className="w-full rounded-lg shadow-md aspect-square object-cover"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Ur III tablet, ca. 2100 BCE
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/P213189-w8UjEixlGUhd3n1Ko2sTlXgFQzDFkl.jpg"
              alt="Cruciform Monument of Manishtushu, ca. 2270 BCE"
              className="w-full rounded-lg shadow-md aspect-square object-cover"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Manishtushu monument, ca. 550 BCE
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/P464358_d-sBPv8Z5dT88Vwi9ZcuAMnSz4nYflrw.jpg"
              alt="Code of Hammurabi stele detail, ca. 1792-1750 BCE"
              className="w-full rounded-lg shadow-md aspect-square object-cover"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Code of Hammurabi, ca. 1750 BCE
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/P394421-zaEjwIliiQ1tieTAKP05Cve64ZgMak.jpg"
              alt="Neo-Assyrian medical tablet K.2421+, ca. 668-631 BCE"
              className="w-full rounded-lg shadow-md aspect-square object-cover"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Neo-Assyrian tablet, ca. 650 BCE
            </figcaption>
          </figure>
        </div>

        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library processes 16th&ndash;18th century printed manuscripts: Latin, German, Arabic, Hebrew, Sanskrit. Our AI pipeline reads page images with Gemini, transcribes the text, and translates it into English. But printed books are only 600 years old. Writing itself is 5,000 years old. What happens if we point the same pipeline at cuneiform?
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          We selected four tablets spanning 1,500 years of Mesopotamian history, wrote a custom OCR prompt, and asked <strong>Gemini 3 Flash</strong> to read them. The model correctly identified Law 196 of the Code of Hammurabi, independently detected a 2,500-year-old forgery &mdash; and also fabricated an entire Sumerian document with 0.95 confidence.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          We ran eight experiments. <strong>Experiment 1</strong> asked Gemini to produce scholarly ATF transliterations &mdash; the standard format used by Assyriologists. <strong>Experiment 2</strong> asked a simpler question: can you just identify the individual cuneiform signs? <strong>Experiment 3</strong> scaled up to 107 tablets and tested whether the model is reading from its training data or genuinely analyzing the photographs. <strong>Experiment 4</strong> compared four Gemini models. <strong>Experiment 5</strong> tested whether cropping and image preprocessing could help the model see better. <strong>Experiment 6</strong> tested edge detection, raking light simulation, multi-pass prompting, and thinking models. <strong>Experiment 7</strong> brought in Claude to test whether the ~15% F1 ceiling was Gemini-specific. <strong>Experiment 8</strong> discovered that temperature settings were confounding all prior results.
        </p>

        {/* --- How to Read Cuneiform --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          How cuneiform works
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Cuneiform is the oldest known writing system, invented in southern Mesopotamia around 3200 BCE. Scribes pressed a reed stylus into wet clay at different angles to make wedge-shaped impressions. The word &ldquo;cuneiform&rdquo; itself comes from the Latin <em>cuneus</em> (&ldquo;wedge&rdquo;). There are four basic wedge types: a vertical wedge, a horizontal wedge, a diagonal wedge, and a corner wedge called a <em>Winkelhaken</em>. Every cuneiform sign is a specific arrangement of these wedges.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Unlike an alphabet, where each letter represents a sound, cuneiform signs can work in multiple ways simultaneously. A single sign might be:
        </p>

        <ul className="list-disc pl-6 mb-6 space-y-2 text-secondary leading-relaxed">
          <li><strong>A syllable:</strong> the sign <em>an</em> represents the syllable &ldquo;an&rdquo;</li>
          <li><strong>A word (logogram):</strong> the same sign <em>AN</em> means &ldquo;heaven&rdquo; or &ldquo;sky&rdquo;</li>
          <li><strong>A determinative:</strong> placed before a word to indicate its category &mdash; <em>{'{'}d{'}'}</em> before a name marks it as a god, <em>{'{'}ki{'}'}</em> marks a place</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6">
          The same sign can have multiple readings depending on context. The script was used for over a dozen languages &mdash; Sumerian, Akkadian, Elamite, Hittite, Urartian &mdash; each assigning their own values to the signs. Reading cuneiform requires knowing which language the text is in, which period it comes from (sign forms evolved over 3,000 years), and often which genre of text you&apos;re looking at.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          What transliteration means
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          When Assyriologists &ldquo;read&rdquo; a cuneiform tablet, they produce a <strong>transliteration</strong> &mdash; converting the wedge impressions into a standardized Roman-letter encoding called{' '}
          <a href="https://cdli.mpiwg-berlin.mpg.de/info/ATF" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">ATF</a>{' '}
          (ASCII Transliteration Format). Here is what ATF looks like for a simple Sumerian administrative text:
        </p>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`@obverse
1. 2(disz) udu niga       2 fattened sheep
2. u4 7(disz)-kam          day 7
3. ki ab-ba-sa6-ga-ta      from Abbasaga
4. a-hu-we-er              (personal name) Ahuwer
@reverse
1. i3-dab5                 received
2. iti ezem-{d}nin-a-zu    month: Festival of Ninazu
3. mu en-mah-gal-an-na ... year: Enmahgalanna was installed...`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          Every convention carries meaning. The <code className="bg-warm px-1.5 py-0.5 rounded text-sm">@obverse</code> and <code className="bg-warm px-1.5 py-0.5 rounded text-sm">@reverse</code> markers indicate the physical face of the tablet. Curly-brace determinatives like <code className="bg-warm px-1.5 py-0.5 rounded text-sm">{'{'}d{'}'}</code> (divine name) aren&apos;t pronounced &mdash; they&apos;re a scribal classifier. Lowercase readings (<em>udu</em>, &ldquo;sheep&rdquo;) represent Sumerian syllabic values; UPPERCASE (<em>LUGAL</em>, &ldquo;king&rdquo;) represents Sumerian logograms in Akkadian text. Square brackets mark broken or missing signs: <code className="bg-warm px-1.5 py-0.5 rounded text-sm">[x]</code>. Half-brackets mark partially visible signs: <code className="bg-warm px-1.5 py-0.5 rounded text-sm">&#x2E22;x&#x2E23;</code>.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          This is what we asked Gemini to produce &mdash; not a freeform description of the tablet, but a precise ATF transliteration that could be compared sign-by-sign against the published scholarship in the{' '}
          <a href="https://cdli.earth" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Cuneiform Digital Library Initiative</a>{' '}
          (CDLI), the central repository for cuneiform tablet data.
        </p>

        {/* --- The Test Tablets --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The test tablets
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          We selected four tablets from CDLI, each with published ATF transliterations (our ground truth) and high-quality photographs:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Tablet</th>
                <th className="text-left py-3 pr-4 font-semibold">Period</th>
                <th className="text-left py-3 pr-4 font-semibold">Language</th>
                <th className="text-left py-3 pr-4 font-semibold">Why we chose it</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">
                  <a href="https://cdli.earth/artifacts/102318" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Ur III Administrative Tablet</a>
                </td>
                <td className="py-3 pr-4">ca. 2100 BCE</td>
                <td className="py-3 pr-4">Sumerian</td>
                <td className="py-3 pr-4">Small, clear, well-preserved &mdash; the easy test</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">
                  <a href="https://cdli.earth/artifacts/213189" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Cruciform Monument of Manishtushu</a>
                </td>
                <td className="py-3 pr-4">ca. 550 BCE (claims 2270 BCE)</td>
                <td className="py-3 pr-4">Akkadian</td>
                <td className="py-3 pr-4">Known forgery &mdash; tests paleographic judgment</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">
                  <a href="https://cdli.earth/artifacts/464358" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Code of Hammurabi</a>
                </td>
                <td className="py-3 pr-4">ca. 1750 BCE</td>
                <td className="py-3 pr-4">Akkadian</td>
                <td className="py-3 pr-4">The most famous cuneiform text in the world</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">
                  <a href="https://cdli.earth/artifacts/394421" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">Neo-Assyrian Tablet (K.2421+)</a>
                </td>
                <td className="py-3 pr-4">ca. 650 BCE</td>
                <td className="py-3 pr-4">Akkadian</td>
                <td className="py-3 pr-4">Damaged multi-fragment tablet &mdash; the hard test</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Each tablet was imported into Source Library as a &ldquo;book&rdquo; with one page per photograph. All experiments used <strong>Gemini 3 Flash Preview</strong>.
        </p>

        {/* --- Experiment 1: ATF Transliteration --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Experiment 1: ATF transliteration
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Our first experiment asked Gemini to do what Assyriologists do: produce a full ATF transliteration from a tablet photograph. This is the hardest possible ask &mdash; it requires reading individual wedge impressions, knowing which signs they form, determining the correct reading in context, and encoding the result in a precise scholarly format.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We wrote a custom &ldquo;Cuneiform OCR&rdquo; prompt with structured metadata output (script type, period, genre, condition, confidence score) and compared each output line-by-line against CDLI&apos;s published ATF.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          The sheep receipt (Ur III tablet)
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          The Ur III administrative tablet (P102318) was our &ldquo;easy&rdquo; test case &mdash; the kind of tablet we need AI to handle if cuneiform OCR is going to matter. It&apos;s a small, well-preserved clay tablet from Drehem (ancient Puzrish-Dagan), a livestock management center near Nippur, dating to the Third Dynasty of Ur (ca. 2100 BCE). Thousands of nearly identical tablets survive from this period, recording the daily flow of animals, grain, and other commodities through the Ur III state bureaucracy.
        </p>

        <figure className="my-12">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/P102318-r7lQSIt2HO5oRGeNDZnfAmebq92DUU.jpg"
            alt="Ur III administrative tablet P102318 from Drehem, showing both obverse and reverse faces"
            className="w-full max-w-lg mx-auto rounded-lg shadow-md"
          />
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            P102318: Ur III administrative tablet from Drehem, ca. 2100 BCE.{' '}
            <a href="https://cdli.earth/artifacts/102318" className="text-accent-rust hover:text-accent-rust not-italic" target="_blank" rel="noopener noreferrer">View on CDLI &rarr;</a>
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-6">
          The photograph shows both faces of the tablet. The text is seven lines total. Here is what this tablet actually says, according to the published CDLI transliteration:
        </p>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`@obverse
1. 2(disz) udu niga          → 2 fattened sheep
2. u4 7(disz)-kam             → day 7
3. ki ab-ba-sa6-ga-ta         → from Abbasaga
4. a-hu-we-er                 → (received by) Ahuwer
@reverse
1. i3-dab5                    → received
2. iti ezem-{d}nin-a-zu       → month: Festival of Ninazu
3. mu en-mah-gal-an-na ...   → year: Enmahgalanna was installed...`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          It&apos;s a sheep receipt. Two fattened sheep, received by Ahuwer from Abbasaga on the 7th day of the Festival of Ninazu. Simple, clear, seven lines.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          What Gemini produced
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Gemini correctly identified the script (Neo-Sumerian), the language (Sumerian), the genre (administrative), and the period (Ur III, reign of Shu-Suen, ca. 2037&ndash;2029 BCE). It even noted the vertical crack running through both faces. Then it produced this transliteration:
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
          The format is perfect. The ATF conventions are correct &mdash; <code className="bg-warm px-1.5 py-0.5 rounded text-sm">@obverse</code>, <code className="bg-warm px-1.5 py-0.5 rounded text-sm">@reverse</code>, determinatives, capacity measures, date formula. The Sumerian vocabulary is real and appropriate to an Ur III administrative context. It even added a scholarly note: &ldquo;In Umma, apples were frequently intercropped in onion gardens.&rdquo;
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          But the content is <strong>entirely fabricated</strong>.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Line-by-line comparison
        </h3>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold w-16">Line</th>
                <th className="text-left py-3 pr-4 font-semibold">Ground truth (CDLI)</th>
                <th className="text-left py-3 pr-4 font-semibold">AI output (Gemini)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-4 font-mono text-sm">o.1</td>
                <td className="py-3 pr-4 font-mono text-sm">2(disz) udu niga</td>
                <td className="py-3 pr-4 font-mono text-sm">1(barig) 1(ban2) {'{'}gesz{'}'}haszhur duru5</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4 font-mono text-sm">o.2</td>
                <td className="py-3 pr-4 font-mono text-sm">u4 7(disz)-kam</td>
                <td className="py-3 pr-4 font-mono text-sm">ki-szum2-ma-ta</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4 font-mono text-sm">o.3</td>
                <td className="py-3 pr-4 font-mono text-sm">ki ab-ba-sa6-ga-ta</td>
                <td className="py-3 pr-4 font-mono text-sm">1(barig) 3(ban2) {'{'}gesz{'}'}haszhur duru5</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4 font-mono text-sm">o.4</td>
                <td className="py-3 pr-4 font-mono text-sm">a-hu-we-er</td>
                <td className="py-3 pr-4 font-mono text-sm">e2-gal-sze3</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4 font-mono text-sm">r.1</td>
                <td className="py-3 pr-4 font-mono text-sm">i3-dab5</td>
                <td className="py-3 pr-4 font-mono text-sm">de6-a</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4 font-mono text-sm">r.2</td>
                <td className="py-3 pr-4 font-mono text-sm">iti ezem-{'{'}d{'}'}nin-a-zu</td>
                <td className="py-3 pr-4 font-mono text-sm">giri3 lu2-{'{'}d{'}'}nin-szubur</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4 font-mono text-sm">r.3</td>
                <td className="py-3 pr-4 font-mono text-sm">mu en-mah-gal-an-na ...</td>
                <td className="py-3 pr-4 font-mono text-sm">iti szu-numun</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Zero lines match. Not a single sign reading is correct. The real tablet records sheep (<em>udu niga</em>); the AI invented apples (<em>haszhur duru5</em>). The real tablet names Abbasaga and Ahuwer; the AI invented Lu-Ninshubur and an &ldquo;onion field.&rdquo; The real month is the Festival of Ninazu; the AI chose the Sowing month. Even the year name is wrong: the tablet dates to Enmahgalanna&apos;s installation, not Shu-Suen&apos;s accession.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          What this tells us
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          This is a textbook hallucination, but a revealing one. The model knows exactly what Ur III administrative tablets <em>look like</em>. It knows the format (commodity, date, personnel, transaction verb, month name, year name). It knows the right kind of vocabulary (capacity measures, agricultural commodities, temple personnel). It can produce a document that would fool a non-specialist.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          But it&apos;s <strong>generating from distributional knowledge</strong>, not reading the wedge impressions in this photograph. The model has internalized the statistical structure of Ur III administrative texts without developing the ability to visually discriminate the specific signs on this specific tablet. It reported 0.95 confidence.
        </p>

        {/* --- Other Results --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The other three tablets
        </h2>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Code of Hammurabi: accurate reading of a famous text
        </h3>

        <figure className="my-12">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/P464358_d-sBPv8Z5dT88Vwi9ZcuAMnSz4nYflrw.jpg"
            alt="Code of Hammurabi stele, showing relief sculpture and cuneiform text"
            className="w-full max-w-lg mx-auto rounded-lg shadow-md"
          />
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            P464358: The Code of Hammurabi stele, ca. 1792&ndash;1750 BCE.{' '}
            <a href="https://sourcelibrary.org/book/code-of-hammurabi-p464358" className="text-accent-rust hover:text-accent-rust not-italic">Read in Source Library &rarr;</a>
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-6">
          Gemini identified this as Law 196 and produced a correct transliteration:
        </p>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`1. šum-ma a-wi-lum       → If a citizen
2. i-in                   → the eye
3. DUMU a-wi-lim          → of a fellow citizen
4. uh-tap-pí-id           → has destroyed,
5. i-in-šu                → his eye
6. ú-ha-⸢ap-pa-du⸣       → they shall destroy.`}</code></pre>

        <blockquote className="border-l-4 border-accent-rust/30 bg-accent-rust/5 pl-6 py-4 mb-8 rounded-r-lg">
          <p className="text-secondary leading-relaxed italic text-lg">
            &ldquo;If a citizen destroys the eye of a fellow citizen, they shall destroy his eye.&rdquo;
          </p>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6">
          The model correctly read the Akkadian vocabulary, identified the specific column and line numbers on the stele (Column XXV, reverse, lines 40&ndash;44), and even noted the class distinction: this &ldquo;eye for an eye&rdquo; principle applied only between members of the <em>awīlum</em> (upper) class. It described the relief sculpture &mdash; King Hammurabi receiving the rod and ring from the sun god Shamash. Confidence: 1.0.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>But:</strong> Law 196 is the most reproduced cuneiform text in the world. It appears in every introductory textbook, every museum label, every popular article about ancient Mesopotamia. This is the easiest possible test &mdash; recognizing the context may be sufficient to produce the correct reading without actually discriminating individual signs.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Manishtushu monument: detecting a forgery
        </h3>

        <figure className="my-12">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/P213189_d-MshZ02KE9TpgRclT4CiGWdAPqSHCQM.jpg"
            alt="Detail of the Cruciform Monument of Manishtushu showing cuneiform inscription"
            className="w-full max-w-lg mx-auto rounded-lg shadow-md"
          />
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            P213189: Detail of the Cruciform Monument, British Museum (BM 91022).{' '}
            <a href="https://sourcelibrary.org/book/manishtusu-obelisk-cruciform-monument-p213189" className="text-accent-rust hover:text-accent-rust not-italic">Read in Source Library &rarr;</a>
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-6">
          The most surprising result. This black diorite monument claims to be an inscription of King Manishtushu of Akkad (ca. 2270 BCE), recording land purchases and temple offerings. But scholars have long suspected it&apos;s a <em>pious fraud</em> &mdash; a forgery created by Neo-Babylonian temple priests around 550 BCE to &ldquo;discover&rdquo; ancient royal grants justifying their tax exemptions.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          From the main view, Gemini correctly read the king&apos;s name and title: <em>Manishtushu, LUGAL KIŠ</em> (&ldquo;King of Kish&rdquo;). From the detail view, it went further:
        </p>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`<script>other (Archaizing Neo-Babylonian mimicking Old Akkadian)</script>
<period>ca. 550 BC (imitating ca. 2270-2255 BC)</period>
<genre>royal-inscription (Pseudo-Old Akkadian "Pious Fraud")</genre>`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          The model classified the script as &ldquo;archaizing Neo-Babylonian mimicking Old Akkadian&rdquo; and the genre as a &ldquo;Pious Fraud.&rdquo; It explained its reasoning: the sign forms are &ldquo;extremely regular&rdquo; for an ostensibly archaic text, and noted grammatical features (like the <em>-ni</em> verb suffix) that Neo-Babylonian scribes <em>believed</em> were characteristic of ancient Akkadian. It then transliterated the daily offerings the &ldquo;ancient&rdquo; king supposedly established for Shamash at Sippar &mdash; 20 GUR of wheat, 20 mina of honey, 20 mina of ghee.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>This is the standout result.</strong> The model performed paleographic analysis, dating the script style independently of the claimed date, and arrived at the same conclusion as modern Assyriologists. Whether it&apos;s truly reasoning from visual features or pattern-matching from its training data is an open question, but the output is scholarly-grade.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Neo-Assyrian medical tablet: wrong text, right library
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          The Neo-Assyrian tablet (P394421) is catalogued as a medical prescription text (BAM 6, 555). Gemini identified it as the final section of <strong>Tablet VII of Enūma Eliš</strong>, the Babylonian Creation Epic &mdash; a different text entirely. However, it correctly identified the fragment numbers (K.2421, K.2511, K.16765), the provenance (Library of Ashurbanipal, Nineveh), and the period (ca. 668&ndash;631 BCE).
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>Interpretation:</strong> The model correctly reads the museum labels and fragment numbers visible in the photograph. Its period identification is accurate. But the sign readings appear to be influenced by its strong prior about what K-numbered Nineveh fragments typically contain &mdash; Enūma Eliš is one of the most famous texts from Ashurbanipal&apos;s library. The model matched the context correctly but the content incorrectly.
        </p>

        {/* --- Analysis --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Knowledge versus vision
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Across all three experiments, the same pattern emerges. Gemini has extensive <em>knowledge</em> about cuneiform &mdash; it knows ATF format, Sumerian and Akkadian vocabulary, administrative tablet conventions, royal inscription formulae, sign names, Unicode code points, and the scholarly literature. But its ability to visually discriminate individual cuneiform signs from a photograph remains limited.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          When knowledge and vision align (Hammurabi), the output is correct. When the model can reason from context without needing sign-level vision (Manishtushu forgery detection), the output is impressive. But when the task requires reading unfamiliar signs in an unfamiliar text (Ur III sheep receipt), the model generates from its distributional knowledge rather than reading what&apos;s in front of it &mdash; and this happens whether we ask for ATF transliteration (Experiment 1) or simple sign identification (Experiment 2).
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Experiment 3&apos;s contamination test adds an important nuance: the model isn&apos;t simply reciting memorized transliterations. The Pearson correlation between training data overlap and vision performance is effectively zero (r = &minus;0.076). Whatever the model is doing when it looks at a cuneiform photograph, it&apos;s doing it the same way regardless of whether it has the text memorized. The problem isn&apos;t memory contamination &mdash; it&apos;s that the visual analysis itself is limited.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>The honest summary: Gemini 3 Flash is a cuneiform <em>commentator</em>, not a cuneiform <em>reader</em>.</strong> It can discuss cuneiform tablets with scholarly precision. It cannot reliably read them. But it is genuinely <em>trying</em> to read them &mdash; the contamination test proves that. Sign detection is real but low-accuracy (~37% of expected signs), making it a starting point for future improvement rather than a fundamental dead end.
        </p>

        {/* --- Model Comparison --- */}
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
                <td className="py-3 pr-4">Manishtushu</td>
                <td className="py-3 pr-4">Misidentified as Sargon II</td>
                <td className="py-3 pr-4">Correctly identified; detected forgery</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Ur III tablet</td>
                <td className="py-3 pr-4">28-line barley ledger (fabricated)</td>
                <td className="py-3 pr-4">8-line apple delivery (fabricated, closer structure)</td>
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

        {/* --- Experiment 2: Sign Transcription --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Experiment 2: Sign transcription
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Experiment 1 asked the model to do everything at once: see the signs, read the language, produce correct ATF. We decided to decompose the problem. <strong>Experiment 2 asks only: what cuneiform signs do you see?</strong>
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Instead of ATF transliteration, we asked Gemini to identify individual signs and give three things for each: the <strong>Unicode cuneiform character</strong> (from the Unicode block U+12000&ndash;U+1236E), the <strong>standard sign name</strong>, and a <strong>wedge count</strong> (horizontal, vertical, diagonal). No language reading. No transliteration. Just: what shapes are on this clay?
        </p>

        <pre className="bg-warm rounded-lg p-6 mb-8 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`Example output format:
Line 1: 𒀭 DINGIR (1 vertical + 3 diagonal) | 𒈾 NA (2 horizontal + 1 vertical)
Line 2: 𒈗 LUGAL (1 horizontal + 3 vertical) | 𒆧 KIS (5 horizontal + 3 vertical)`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          The rationale: wedge counts are the most objective visual measure. You can look at a photo, count wedges, and compare to the model&apos;s claim without knowing Sumerian. If the model says a sign has &ldquo;3 horizontal + 1 vertical&rdquo; and you can see 3 horizontal + 1 vertical in the photo, it&apos;s actually reading. If the wedge counts don&apos;t match, it&apos;s generating from knowledge.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Results
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          We ran the sign transcription prompt on the same four tablets. The outputs now contain Unicode cuneiform characters &mdash; actual glyphs you can compare visually against the photographs.
        </p>

        <h4 className="text-lg font-semibold text-secondary mt-8 mb-4">
          Ur III tablet: plausible structure, unverifiable content
        </h4>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`Line 1: 𒐏 4(u) | 𒈠 MA | 𒈾 NA | 𒊺 ŠE
Line 2: 𒂆 GIN2 | 𒈠 MA | 𒈾 NA | 𒊺 ŠE
Line 3: 𒍪 ZU  | 𒈠 MA | 𒈾 NA | 𒊺 ŠE
Line 4: 𒇲 LA2 | 𒈠 MA | 𒈾 NA | 𒊺 ŠE
--- REVERSE ---
Line 5: 𒋗 ŠU  | 𒁀 BA | 𒋾 TI
Line 6: 𒈬 MU  | 𒂗 EN | 𒀭 DINGIR
Line 7: 𒆠 KI  | 𒉘 AG2 | 𒂗 EN`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          The model found 7 lines with 25 signs, confidence 0.85. It correctly identifies a repeating pattern on the obverse (MA-NA-ŠE, which could refer to a <em>mana</em> weight of grain) and the standard Ur III receipt formula on the reverse (<em>šu ba-ti</em>, &ldquo;received&rdquo;). The structure is plausible. But the ground truth is sheep (<em>udu niga</em>), not grain &mdash; the same content mismatch as Experiment 1, expressed through different signs.
        </p>

        <h4 className="text-lg font-semibold text-secondary mt-8 mb-4">
          Code of Hammurabi: reading a modern rendering
        </h4>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`Line 1: 𒋳 ŠUM | 𒈠 MA | 𒀀 A | 𒉿 PI | 𒈝 LUM | 𒄿 I | 𒈾 NA
   →  šum-ma a-wi-lum i-na  →  "If a citizen..."
Confidence: 0.98`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          The model correctly identified the signs spelling <em>šumma awīlum ina</em> &mdash; the opening of the &ldquo;eye for an eye&rdquo; law. It also noted that the bottom portion of the image is a &ldquo;modern artistic graphic&rdquo; rather than the actual stele surface. Confidence: 0.98. But this is a modern digital rendering with vector-sharp signs, not ancient clay. The test doesn&apos;t tell us about vision on real tablets.
        </p>

        <h4 className="text-lg font-semibold text-secondary mt-8 mb-4">
          Neo-Assyrian tablet: honest about damage
        </h4>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`Line 1: [DAMAGED]
Line 2: [DAMAGED] | 𒀸 AŠ | 𒀸 AŠ | [DAMAGED]
Line 3: [DAMAGED] | 𒀀 A  | 𒀸 AŠ | [DAMAGED]
Line 4: [DAMAGED] | 𒀸 AŠ | 𒀭 DINGIR | [DAMAGED]
...
40 lines total, 52 signs identified
Confidence: 0.65`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          A notable improvement over Experiment 1. Where the ATF prompt produced 8 lines of confident (but wrong) Enūma Eliš, the sign transcription prompt produced 40 lines that are mostly <code className="bg-warm px-1.5 py-0.5 rounded text-sm">[DAMAGED]</code>. The model defaulted to AŠ (the simplest cuneiform sign &mdash; a single horizontal wedge) for most readable positions, which is honest if not useful. The lower confidence (0.65 vs. 0.9) is better calibrated to the actual difficulty.
        </p>

        <h4 className="text-lg font-semibold text-secondary mt-8 mb-4">
          Manishtushu monument: formulaic patterns
        </h4>

        <pre className="bg-warm rounded-lg p-6 mb-6 overflow-x-auto text-sm font-mono text-secondary leading-relaxed"><code>{`Line 1: 𒈠 MA | 𒉌 NI | 𒅖 ISH | 𒌅 TU | 𒋢 SU
Line 2: 𒈗 LUGAL | 𒆧 KIS
Line 3: 𒀀 A  | 𒈾 NA
Line 4: 𒌷 URU | 𒀭 DINGIR | 𒂗 EN | 𒆤 KID/LIL
...
Detail view (Side D, Column I):
Line 1: 𒀭 DINGIR | 𒂗 EN | 𒆤 LIL2
Line 2: 𒈗 LUGAL  | 𒆳 KUR | 𒆳 KUR
...62 signs total, 0.9 confidence`}</code></pre>

        <p className="text-secondary leading-relaxed mb-6">
          The model correctly identified <em>Manishtushu, LUGAL KIŠ</em> (&ldquo;King of Kish&rdquo;) using individual Unicode signs. The detail view identified repetitive formulaic patterns: <em>DINGIR EN-LIL</em> (the god Enlil), <em>LUGAL KISH</em> (King of Kish). The repetition is consistent with what we know about this monument &mdash; it lists land purchases in formulaic blocks.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          But the detail view repeats the same block of signs (lines 1&ndash;10 and 11&ndash;20 are nearly identical), which could mean either: (a) the text genuinely repeats its formulaic header, or (b) the model generated one plausible block and repeated it. We can&apos;t distinguish these without expert sign-by-sign verification against the actual stone.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          What Experiment 2 reveals
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          The sign transcription approach has three advantages over ATF transliteration:
        </p>

        <ol className="list-decimal pl-6 mb-6 space-y-3 text-secondary leading-relaxed">
          <li><strong>Visual verifiability.</strong> Unicode cuneiform characters are rendered as actual glyphs. A non-specialist can compare the glyph shape to what they see in the photograph. This doesn&apos;t require knowing Sumerian.</li>
          <li><strong>Better calibration.</strong> The Neo-Assyrian tablet went from 0.9 confidence (Experiment 1, wrong text) to 0.65 confidence (Experiment 2, honestly marking damage). The model produces more calibrated confidence when it&apos;s not trying to read language.</li>
          <li><strong>Separation of concerns.</strong> If sign identification is reasonably accurate, translation can be handled as a separate downstream step &mdash; potentially by a specialized model or rule-based system, rather than asking one model to do everything.</li>
        </ol>

        <p className="text-secondary leading-relaxed mb-6">
          But the core question remains: <strong>is the model seeing the signs or knowing what should be there?</strong> The Ur III tablet produces different content from Experiment 1 but the same pattern of plausible-but-unverifiable output. The Manishtushu monument produces correct royal titles that the model has certainly seen in its training data. Only the damaged Neo-Assyrian tablet &mdash; where the model can&apos;t fall back on knowledge &mdash; gives us a clean signal, and there the output is mostly <code className="bg-warm px-1.5 py-0.5 rounded text-sm">[DAMAGED]</code>.
        </p>

        {/* --- Experiment 3: Contamination Test --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Experiment 3: Is the model reading or remembering?
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Experiments 1 and 2 tested four tablets. That&apos;s a proof of concept, not evidence. The core ambiguity remained: when Gemini produces a correct reading, is it <em>seeing</em> the cuneiform signs or <em>remembering</em> the text from its training data? The Code of Hammurabi is in every textbook. The Manishtushu monument is extensively published. Even the Ur III sheep receipt &mdash; while the model got it wrong &mdash; comes from a corpus of thousands of nearly identical tablets.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Experiment 3 tests this directly. We built a corpus of <strong>107 tablets</strong> from CDLI spanning 11 historical periods, then ran two separate tests on each one: a <strong>contamination test</strong> (is this tablet in the model&apos;s training data?) and a <strong>vision test</strong> (can the model identify signs from the photograph?). Cross-referencing the results tells us whether training data contamination predicts vision performance.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          The corpus
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          We selected 107 tablets from CDLI with published ATF transliterations and photographs, stratified across periods:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Period</th>
                <th className="text-left py-3 pr-4 font-semibold">Tablets</th>
                <th className="text-left py-3 pr-4 font-semibold">Date range</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Ur III</td>
                <td className="py-3 pr-4">50</td>
                <td className="py-3 pr-4">ca. 2112&ndash;2004 BCE</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Old Akkadian</td>
                <td className="py-3 pr-4">20</td>
                <td className="py-3 pr-4">ca. 2334&ndash;2154 BCE</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Lagash II</td>
                <td className="py-3 pr-4">10</td>
                <td className="py-3 pr-4">ca. 2200&ndash;2100 BCE</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Uruk III&ndash;IV</td>
                <td className="py-3 pr-4">12</td>
                <td className="py-3 pr-4">ca. 3500&ndash;3100 BCE</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Old Babylonian</td>
                <td className="py-3 pr-4">8</td>
                <td className="py-3 pr-4">ca. 2000&ndash;1600 BCE</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">ED IIIb, Neo-Assyrian, Neo-Babylonian, others</td>
                <td className="py-3 pr-4">7</td>
                <td className="py-3 pr-4">various</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-xl text-primary mt-10 mb-4">
          The contamination test
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          For each tablet, we gave Gemini <strong>only the P-number and catalog metadata</strong> &mdash; no photograph. We asked: &ldquo;Can you reproduce the ATF transliteration of this tablet from memory?&rdquo; If the model can reproduce the text without seeing it, the tablet&apos;s transliteration was in its training data.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We compared the model&apos;s text-only output against the CDLI ground truth, extracting sign readings from both and computing the overlap percentage. A tablet with &gt;30% sign overlap was classified as <strong>contaminated</strong> (in training data). Below 30% was classified as <strong>clean</strong>.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The results:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Classification</th>
                <th className="text-left py-3 pr-4 font-semibold">Count</th>
                <th className="text-left py-3 pr-4 font-semibold">Percentage</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Contaminated (in training data)</td>
                <td className="py-3 pr-4">31</td>
                <td className="py-3 pr-4">29%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Clean (not in training data)</td>
                <td className="py-3 pr-4">76</td>
                <td className="py-3 pr-4">71%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Contamination varied dramatically by period. <strong>46% of Ur III tablets</strong> were contaminated &mdash; unsurprising, since Ur III administrative texts are the most heavily published cuneiform corpus. <strong>Zero Old Akkadian tablets</strong> were contaminated, making them ideal clean benchmarks. Old Babylonian tablets (50% contaminated) are also well-published.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          A striking detail: 104 out of 107 tablets, the model <em>claimed</em> to know the text &mdash; but only 31 could actually reproduce it. The model confabulates knowledge it doesn&apos;t have.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          The cross-analysis
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Now the key question. We ran the Experiment 2 sign-identification prompt on the same 107 tablets (102 completed; 5 failed due to API errors). For each tablet, we had both a contamination score (how much of the ATF is in training data) and a vision performance score (confidence, signs detected, accuracy). If the model is &ldquo;reading from memory,&rdquo; contaminated tablets should show higher vision performance.
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Metric</th>
                <th className="text-left py-3 pr-4 font-semibold">Contaminated (30)</th>
                <th className="text-left py-3 pr-4 font-semibold">Clean (72)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Average confidence</td>
                <td className="py-3 pr-4">0.693</td>
                <td className="py-3 pr-4">0.716</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Median confidence</td>
                <td className="py-3 pr-4">0.700</td>
                <td className="py-3 pr-4">0.750</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Signs detected (avg)</td>
                <td className="py-3 pr-4">14.1</td>
                <td className="py-3 pr-4">19.5</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">High confidence (&ge;0.8)</td>
                <td className="py-3 pr-4">37%</td>
                <td className="py-3 pr-4">40%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Pearson correlation between training data overlap and vision confidence: r = &minus;0.076.</strong>
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          That&apos;s essentially zero. There is no meaningful relationship between whether a tablet&apos;s text appears in the model&apos;s training data and how well the model performs on the vision task. If anything, the model performs <em>slightly better</em> on clean tablets &mdash; the opposite of what you&apos;d expect from memorization.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          To control for period confounds (contaminated tablets are mostly Ur III; clean tablets include harder Old Akkadian), we compared within the Ur III period specifically: contaminated Ur III average confidence was 0.68, clean Ur III was 0.69. Identical.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          What this means
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>The model is doing genuine visual analysis, not reading from memory.</strong> When Gemini looks at a cuneiform photograph, it is attempting to process the visual features of the clay surface &mdash; not retrieving a memorized transliteration. This is the most important finding of the three experiments, because it tells us that the model&apos;s cuneiform vision, while limited, is <em>real</em>.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The 20 Old Akkadian tablets with 0% training data contamination are particularly valuable: they represent a gold-standard test set where we can be confident the model has never seen the content. These tablets scored an average confidence of 0.79 &mdash; higher than the overall average &mdash; suggesting that Old Akkadian sign forms (larger, more distinct wedge impressions) may actually be easier for vision models than the cramped Ur III administrative script.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The limitation is that the model detects roughly <strong>37% of ground-truth signs</strong> regardless of contamination status. It&apos;s genuinely looking, but it&apos;s not seeing very well yet. This is the gap that future models &mdash; or fine-tuning on cuneiform data &mdash; would need to close.
        </p>

        {/* --- Infrastructure --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The infrastructure works
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The most practically useful outcome: <strong>Source Library&apos;s existing pipeline handles cuneiform with zero code changes</strong>. The two-step architecture maps naturally:
        </p>

        <ul className="list-disc pl-6 mb-8 space-y-2 text-secondary leading-relaxed">
          <li><strong>OCR step</strong> = ATF transliteration (cuneiform signs &rarr; ASCII text)</li>
          <li><strong>Translation step</strong> = Sumerian/Akkadian &rarr; English</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6">
          Custom prompts are stored as named families in the <code className="bg-warm px-1.5 py-0.5 rounded text-sm">prompts</code> collection, and the reader, search, and translation percentage tracking all work without modification. The four test tablets are browsable in Source Library:
        </p>

        <ul className="list-disc pl-6 mb-8 space-y-2 text-secondary leading-relaxed">
          <li><a href="https://sourcelibrary.org/book/ur-iii-administrative-tablet-drehem-p102318" className="text-accent-rust hover:underline">Ur III Administrative Tablet</a></li>
          <li><a href="https://sourcelibrary.org/book/manishtusu-obelisk-cruciform-monument-p213189" className="text-accent-rust hover:underline">Cruciform Monument of Manishtushu</a></li>
          <li><a href="https://sourcelibrary.org/book/code-of-hammurabi-p464358" className="text-accent-rust hover:underline">Code of Hammurabi</a></li>
          <li><a href="https://sourcelibrary.org/book/neo-assyrian-medical-prescriptions-bam-6-555-p394421" className="text-accent-rust hover:underline">Neo-Assyrian Tablet (K.2421+)</a></li>
        </ul>

        {/* --- Experimental Design for Future Work --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Experimental design for a systematic evaluation
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Our proof of concept tested four tablets. A proper evaluation needs a controlled experiment with statistical power. Here is the design we propose.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Research question
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Can general-purpose vision-language models produce accurate ATF transliterations of cuneiform tablets from photographs, and if so, under what conditions?
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Hypotheses
        </h3>

        <ol className="list-decimal pl-6 mb-8 space-y-3 text-secondary leading-relaxed">
          <li><strong>H1 (Knowledge contamination):</strong> Models will perform significantly better on tablets whose transliterations appear in their training data (published CDLI corpus, textbook examples) than on unpublished or recently published tablets. We predict &gt;50% sign accuracy on &ldquo;known&rdquo; tablets vs. &lt;20% on &ldquo;unknown&rdquo; tablets.</li>
          <li><strong>H2 (Script period effect):</strong> Accuracy will vary by script period, with Neo-Assyrian (most standardized signs) outperforming Old Babylonian and Old Akkadian (more variant forms). We predict Neo-Assyrian &gt; Old Babylonian &gt; Ur III &gt; Old Akkadian.</li>
          <li><strong>H3 (Genre effect):</strong> Administrative tablets (short, formulaic) will produce higher structural accuracy than literary or scholarly texts (complex vocabulary, rare signs). We predict &gt;70% line-count accuracy on administrative vs. &lt;50% on literary texts.</li>
          <li><strong>H4 (Few-shot improvement):</strong> Providing 3&ndash;5 example transliterations from the same corpus in the prompt will significantly improve accuracy on novel tablets of the same type. We predict &gt;2x improvement in sign accuracy over zero-shot.</li>
          <li><strong>H5 (Model scaling):</strong> Larger models (Gemini Pro, GPT-4o, Claude Opus) will show higher sign-level accuracy than smaller models (Gemini Flash, Claude Haiku), controlling for the same prompt and tablets.</li>
        </ol>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Sample
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>100 tablets</strong> selected from CDLI, stratified by:
        </p>

        <ul className="list-disc pl-6 mb-8 space-y-2 text-secondary leading-relaxed">
          <li><strong>Period</strong> (25 each): Ur III, Old Babylonian, Middle Babylonian/Assyrian, Neo-Assyrian</li>
          <li><strong>Genre</strong> (balanced within each period): administrative, literary, legal, letters, ritual</li>
          <li><strong>Publication date</strong>: 50 tablets with transliterations published before 2020 (&ldquo;known&rdquo; &mdash; likely in training data) and 50 published 2023&ndash;2026 (&ldquo;unknown&rdquo; &mdash; likely not in training data)</li>
          <li><strong>Photograph quality</strong>: all tablets must have CDLI photographs rated &ldquo;good&rdquo; or &ldquo;excellent&rdquo; by the cataloguer</li>
          <li><strong>Size</strong>: 5&ndash;30 lines per face (to control for length effects)</li>
        </ul>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Independent variables
        </h3>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Variable</th>
                <th className="text-left py-3 pr-4 font-semibold">Levels</th>
                <th className="text-left py-3 pr-4 font-semibold">Rationale</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Model</td>
                <td className="py-3 pr-4">Gemini 3 Flash, Gemini 3 Pro, GPT-4o, Claude Sonnet</td>
                <td className="py-3 pr-4">Compare vision capabilities across model families</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Prompt type</td>
                <td className="py-3 pr-4">Zero-shot, 3-shot (same genre), 5-shot (mixed genre)</td>
                <td className="py-3 pr-4">Measure few-shot learning effect</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Image count</td>
                <td className="py-3 pr-4">1 photo, 3 photos (multi-angle)</td>
                <td className="py-3 pr-4">Test if additional views improve accuracy</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Context</td>
                <td className="py-3 pr-4">No context, museum provenance provided, genre hint provided</td>
                <td className="py-3 pr-4">Isolate knowledge retrieval from visual reading</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Dependent variables (metrics)
        </h3>

        <ul className="list-disc pl-6 mb-8 space-y-3 text-secondary leading-relaxed">
          <li><strong>Sign accuracy:</strong> Percentage of signs correctly identified (Levenshtein distance between AI sign sequence and ground truth sign sequence, normalized). This is the primary metric.</li>
          <li><strong>Line accuracy:</strong> Percentage of lines where the AI reading matches ground truth after normalizing whitespace and formatting differences.</li>
          <li><strong>Structural accuracy:</strong> Correct identification of surface markers (@obverse/@reverse), line count (within &plusmn;1), and column breaks.</li>
          <li><strong>Metadata accuracy:</strong> Period correct (within &plusmn;100 years), language correct, genre correct. Scored as 3 binary variables.</li>
          <li><strong>Hallucination rate:</strong> Percentage of AI-generated lines that contain no overlap with any ground truth line (overlap &lt; 0.1). This measures pure fabrication.</li>
          <li><strong>Calibration:</strong> Correlation between model confidence score and actual sign accuracy. Well-calibrated models should report low confidence on fabricated readings.</li>
        </ul>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Controls
        </h3>

        <ul className="list-disc pl-6 mb-8 space-y-2 text-secondary leading-relaxed">
          <li><strong>Baseline 1 (random):</strong> Randomly generated ATF from a Markov model trained on CDLI corpus, to establish floor accuracy</li>
          <li><strong>Baseline 2 (retrieval):</strong> TF-IDF matching against CDLI corpus using only the photograph metadata (museum number, period) &mdash; measures how far pure knowledge retrieval can go without vision</li>
          <li><strong>Human expert:</strong> 20 of the 100 tablets independently transliterated by a professional Assyriologist, providing a ceiling and inter-rater reliability baseline</li>
          <li><strong>Repeated runs:</strong> Each model&times;prompt&times;tablet combination run 3 times to measure variance (temperature 0.0 for deterministic baseline, 0.3 for variance measurement)</li>
        </ul>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Analysis plan
        </h3>

        <ol className="list-decimal pl-6 mb-8 space-y-2 text-secondary leading-relaxed">
          <li>Report mean sign accuracy with 95% confidence intervals, stratified by all independent variables</li>
          <li>Two-way ANOVA: model &times; publication date (tests H1, knowledge contamination)</li>
          <li>One-way ANOVA: accuracy by script period (tests H2)</li>
          <li>Paired t-test: zero-shot vs. few-shot accuracy on matched tablets (tests H4)</li>
          <li>Reliability plot: model confidence vs. actual accuracy, with expected calibration error (tests calibration)</li>
          <li>Qualitative error taxonomy: categorize wrong readings as (a) plausible sign misread, (b) genre-appropriate hallucination, (c) unrelated fabrication, (d) retrieval of known text</li>
        </ol>

        <h3 className="text-xl text-primary mt-10 mb-4">
          What this would settle
        </h3>

        <p className="text-secondary leading-relaxed mb-8">
          This design separates four capabilities that our PoC tangled together: (1) visual sign discrimination, (2) knowledge of cuneiform conventions, (3) document-level pattern matching, and (4) training data memorization. Experiment 3 already settled question (4) &mdash; memorization does not drive vision performance. A full factorial experiment like this would settle the remaining three, telling us whether a model that scores high on &ldquo;unknown&rdquo; tablets with no context hints has genuine cuneiform vision, or is doing sophisticated retrieval. Both are useful, but for different purposes &mdash; and only the first would transform the field.
        </p>

        {/* --- Experiment 5: Cropping and Image Preprocessing --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Experiment 5: Can we help the model see better?
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          If the model is genuinely trying to read cuneiform but struggling, maybe the problem is the input image. CDLI composite photographs pack six views of a tablet &mdash; obverse, reverse, top edge, bottom edge, left edge, right edge &mdash; into a single image on a black background. That&apos;s a lot of visual noise. What if we cropped the image to show just the inscribed face? Or enhanced the contrast to make wedge impressions more visible?
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We tested two strategies: <strong>spatial cropping</strong> (reducing what the model sees) and <strong>image preprocessing</strong> (changing how it looks). Both were tested with <strong>Gemini 2.5 Pro</strong>, our best-performing model from Experiment 4.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Strategy 1: Cropping
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          We tested three levels of cropping on tablet <strong>P250675</strong> (Ur III, 1949&times;3053px &mdash; a high-resolution image):
        </p>

        <ul className="list-disc pl-6 mb-8 space-y-2 text-secondary leading-relaxed">
          <li><strong>Full composite:</strong> The original CDLI image with all six views</li>
          <li><strong>Face crop:</strong> Just the obverse or reverse face, black background removed</li>
          <li><strong>Line strips:</strong> Individual horizontal strips, one per text line</li>
        </ul>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/P250675-y3DQ1O3o1o7YC2uXIvAZ4z5d4m1AAR.jpg"
              alt="P250675 full CDLI composite photograph"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Full composite (6 views)
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/p250675_obverse.jpg"
              alt="P250675 obverse face crop"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Obverse face crop
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/p250675_linestrip.jpg"
              alt="P250675 individual line strip"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Individual line strip
            </figcaption>
          </figure>
        </div>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Condition</th>
                <th className="text-left py-3 pr-4 font-semibold">Signs found</th>
                <th className="text-left py-3 pr-4 font-semibold">F1</th>
                <th className="text-left py-3 pr-4 font-semibold">Precision</th>
                <th className="text-left py-3 pr-4 font-semibold">Recall</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Full composite</td>
                <td className="py-3 pr-4">0</td>
                <td className="py-3 pr-4">0.0%</td>
                <td className="py-3 pr-4">0.0%</td>
                <td className="py-3 pr-4">0.0%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Obverse face crop</td>
                <td className="py-3 pr-4">8</td>
                <td className="py-3 pr-4">7.4%</td>
                <td className="py-3 pr-4 font-semibold">100.0%</td>
                <td className="py-3 pr-4">3.8%</td>
              </tr>
              <tr className="border-b border-light bg-accent-sage/5">
                <td className="py-3 pr-4 font-semibold">Line strips (10 strips, aggregated)</td>
                <td className="py-3 pr-4 font-semibold">74</td>
                <td className="py-3 pr-4 font-semibold">16.3%</td>
                <td className="py-3 pr-4">31.1%</td>
                <td className="py-3 pr-4">11.1%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          On this high-resolution tablet, <strong>line strips won decisively</strong>. The full composite produced zero parseable signs. The face crop produced only 8 signs, but with 100% precision &mdash; every sign it identified was correct. The line strips produced 74 signs with 20 correct sign types (KU, MA, NA, SAG, KI, DU, GA, DA, LUGAL, KA, AN, UD, DUB, GI, DUG, MU, and others). Narrowing the visual field helped the model focus.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          But does this pattern hold? We ran the same experiment on <strong>P100500</strong> (also Ur III, but only 1039&times;1487px &mdash; roughly half the resolution):
        </p>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/p100500_full.jpg"
              alt="P100500 full CDLI composite photograph"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Full composite (1039&times;1487px)
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/p100500_obverse.jpg"
              alt="P100500 obverse face crop"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Obverse crop (470&times;440px)
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/p100500_reverse.jpg"
              alt="P100500 reverse face crop"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Reverse crop (660&times;400px)
            </figcaption>
          </figure>
        </div>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Condition</th>
                <th className="text-left py-3 pr-4 font-semibold">Signs found</th>
                <th className="text-left py-3 pr-4 font-semibold">F1</th>
                <th className="text-left py-3 pr-4 font-semibold">Precision</th>
                <th className="text-left py-3 pr-4 font-semibold">Recall</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light bg-accent-sage/5">
                <td className="py-3 pr-4 font-semibold">Full composite</td>
                <td className="py-3 pr-4 font-semibold">41</td>
                <td className="py-3 pr-4 font-semibold">28.3%</td>
                <td className="py-3 pr-4">34.1%</td>
                <td className="py-3 pr-4">24.1%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Obverse face crop</td>
                <td className="py-3 pr-4">11</td>
                <td className="py-3 pr-4">0.0%</td>
                <td className="py-3 pr-4">0.0%</td>
                <td className="py-3 pr-4">0.0%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Line strips (9 strips, aggregated)</td>
                <td className="py-3 pr-4">63</td>
                <td className="py-3 pr-4">14.9%</td>
                <td className="py-3 pr-4">14.3%</td>
                <td className="py-3 pr-4">15.5%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>The opposite pattern.</strong> On this lower-resolution image, the full composite won with 28.3% F1, while the obverse crop produced zero correct signs and line strips scored only 14.9%. The reason: cropping a 1039px-wide image to a 470px-wide face crop leaves too few pixels per cuneiform sign for the model to work with. Each wedge impression is only a handful of pixels across.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>The key variable is image resolution, not visual complexity.</strong> High-resolution photos benefit from cropping (less visual noise, enough pixels per sign). Low-resolution photos are hurt by it (too few pixels survive the crop). This means the optimal preprocessing strategy depends on the input image.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Strategy 2: Image preprocessing
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Can we enhance the image to make wedge impressions more visible? We tested seven preprocessing techniques on the P100500 obverse crop &mdash; the condition that scored 0.0% F1 with no preprocessing:
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/p100500_obverse.jpg"
              alt="Raw obverse crop — baseline"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Raw (F1=0.0%)
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/p100500_sharpen.jpg"
              alt="Sharpened — unsharp mask"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Sharpen (F1=2.8%)
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/p100500_graynorm.jpg"
              alt="Grayscale with histogram normalization"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Grayscale + normalize (F1=2.6%)
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/p100500_clahe.jpg"
              alt="CLAHE local contrast enhancement"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              CLAHE (F1=4.7%)
            </figcaption>
          </figure>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/p100500_invert.jpg"
              alt="Inverted — dark background reveals wedge impressions"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Invert (F1=4.9%)
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/p100500_upscale2x.jpg"
              alt="2x bicubic upscale"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Upscale 2x (F1=2.9%)
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/p100500_combined.jpg"
              alt="Combined grayscale + CLAHE + sharpen + normalize"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Combined (F1=0.0%)
            </figcaption>
          </figure>
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/p100500_upscale_clahe.jpg"
              alt="Upscale 2x + CLAHE + sharpen — best performing technique"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              Upscale + CLAHE (F1=16.7%)
            </figcaption>
          </figure>
        </div>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Technique</th>
                <th className="text-left py-3 pr-4 font-semibold">Description</th>
                <th className="text-left py-3 pr-4 font-semibold">Signs</th>
                <th className="text-left py-3 pr-4 font-semibold">F1</th>
                <th className="text-left py-3 pr-4 font-semibold">Precision</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-4 italic">Raw (baseline)</td>
                <td className="py-3 pr-4 text-sm">No processing</td>
                <td className="py-3 pr-4">11</td>
                <td className="py-3 pr-4">0.0%</td>
                <td className="py-3 pr-4">0.0%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Sharpen</td>
                <td className="py-3 pr-4 text-sm">Unsharp mask (&sigma;=2)</td>
                <td className="py-3 pr-4">14</td>
                <td className="py-3 pr-4">2.8%</td>
                <td className="py-3 pr-4">7.1%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Grayscale + normalize</td>
                <td className="py-3 pr-4 text-sm">Remove color, stretch histogram</td>
                <td className="py-3 pr-4">18</td>
                <td className="py-3 pr-4">2.6%</td>
                <td className="py-3 pr-4">5.6%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">CLAHE</td>
                <td className="py-3 pr-4 text-sm">Local contrast (3&times;3 tiles)</td>
                <td className="py-3 pr-4">28</td>
                <td className="py-3 pr-4">4.7%</td>
                <td className="py-3 pr-4">7.1%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Invert</td>
                <td className="py-3 pr-4 text-sm">Negative image</td>
                <td className="py-3 pr-4">24</td>
                <td className="py-3 pr-4">4.9%</td>
                <td className="py-3 pr-4">8.3%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Upscale 2x</td>
                <td className="py-3 pr-4 text-sm">Lanczos3 interpolation</td>
                <td className="py-3 pr-4">11</td>
                <td className="py-3 pr-4">2.9%</td>
                <td className="py-3 pr-4">9.1%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Combined</td>
                <td className="py-3 pr-4 text-sm">Gray + CLAHE + sharpen + normalize</td>
                <td className="py-3 pr-4">8</td>
                <td className="py-3 pr-4">0.0%</td>
                <td className="py-3 pr-4">0.0%</td>
              </tr>
              <tr className="border-b border-light bg-accent-sage/5">
                <td className="py-3 pr-4 font-semibold">Upscale + CLAHE</td>
                <td className="py-3 pr-4 text-sm">2x upscale &rarr; CLAHE &rarr; sharpen</td>
                <td className="py-3 pr-4 font-semibold">14</td>
                <td className="py-3 pr-4 font-semibold">16.7%</td>
                <td className="py-3 pr-4 font-semibold">42.9%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Upscale + CLAHE was the clear winner</strong>, rescuing a completely dead crop (0.0% F1) to 16.7% F1 with 42.9% precision. It correctly identified six sign types: MA, LA, DA, BA, MU, and BI. The technique works by first adding pixel density (2x Lanczos3 upscale), then enhancing local contrast (CLAHE) so wedge impressions stand out from the clay surface. To human eyes the result looks like a stippled mess, but the model can apparently extract useful signal from the enhanced micro-texture.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The other techniques offered marginal improvements at best. CLAHE alone (4.7%) and inversion (4.9%) showed some promise, but without the upscaling step the pixel density was too low for meaningful enhancement. The combined pipeline (grayscale + CLAHE + sharpen + normalize) performed worst of all &mdash; too many transformations degraded the image rather than enhancing it.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          What Experiment 5 tells us
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Image preprocessing helps &mdash; but modestly and conditionally. The optimal strategy depends on the input image:
        </p>

        <ul className="list-disc pl-6 mb-8 space-y-3 text-secondary leading-relaxed">
          <li><strong>High-resolution photos (&gt;1500px wide):</strong> Crop to individual line strips. On P250675, line strips achieved 16.3% F1 vs. 0% for the full composite.</li>
          <li><strong>Low-resolution photos (&lt;1500px wide):</strong> Keep the full composite. On P100500, the uncropped image achieved 28.3% F1 vs. 0% for the face crop.</li>
          <li><strong>Upscale + CLAHE as a rescue technique:</strong> When a crop is necessary but resolution is low, 2x upscaling with CLAHE can partially compensate, though it cannot match a naturally high-resolution source.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-8">
          The fundamental ceiling remains. Even with optimal cropping and preprocessing, accuracy stays in the 15&ndash;30% F1 range. The bottleneck is the model&apos;s cuneiform sign recognition capability, not image quality. Better photographs would help, but the real breakthrough will require models trained or fine-tuned on cuneiform data.
        </p>

        {/* --- Experiment 6: Advanced Image Processing and Multi-Pass Prompting --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Experiment 6: Edge detection, raking light, and multi-pass prompting
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Experiments 4 and 5 established that model choice and cropping both matter, but accuracy stayed in the 15&ndash;30% F1 range. Experiment 6 explored two remaining ideas: could image processing techniques borrowed from archaeology and epigraphy help the model see wedge impressions more clearly? And could a multi-pass prompting strategy &mdash; surveying the tablet first, then identifying signs, then reviewing against the image &mdash; improve accuracy over a single-pass approach?
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We tested 21 conditions across two sub-experiments on the P250675 obverse crop &mdash; the same Ur III tablet from Experiment 5 (208 ground truth signs). All image processing used the <a href="https://sharp.pixelplumbing.com/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">sharp</a> library in Node.js. All conditions were evaluated using the same bag-of-signs F1 metric.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Part A: image processing techniques (13 conditions)
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Archaeologists use <strong>raking light</strong> &mdash; a low-angle light source that casts shadows along surface relief &mdash; to make wedge impressions visible on clay tablets. We simulated this digitally, along with several other image processing techniques:
        </p>

        <ul className="list-disc pl-6 mb-6 space-y-2 text-secondary leading-relaxed">
          <li><strong>Sobel edge detection:</strong> Highlights gradients (the borders of wedge impressions)</li>
          <li><strong>Pseudo-heightmap:</strong> Inverts brightness to approximate depth, then simulates directional lighting</li>
          <li><strong>Edge overlay:</strong> Darkens the original image where edges are strong, emphasizing wedge boundaries</li>
          <li><strong>Raking light:</strong> Simulates a low-angle light source from the left or from above, casting directional shadows along the horizontal or vertical gradient</li>
          <li><strong>Multi-image input:</strong> Sending two or three image variants together so the model can cross-reference</li>
          <li><strong>Sign reference chart:</strong> A lookup table of 50 common signs (Unicode glyph + name) sent alongside the photograph</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6">
          All conditions used Gemini 2.5 Pro, which had the best accuracy in Experiment 4.
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Technique</th>
                <th className="text-right py-3 pr-4 font-semibold">Signs</th>
                <th className="text-right py-3 pr-4 font-semibold">F1</th>
                <th className="text-right py-3 pr-4 font-semibold">Precision</th>
                <th className="text-right py-3 pr-4 font-semibold">Recall</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Raw obverse crop (baseline)</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
              </tr>
              <tr className="border-b border-light bg-accent-sage/5">
                <td className="py-3 pr-4 font-semibold">Sobel edge detection</td>
                <td className="py-3 pr-4 text-right font-mono text-sm font-semibold">44</td>
                <td className="py-3 pr-4 text-right font-mono text-sm font-semibold">15.1%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">43.2%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">9.1%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Pseudo-heightmap</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">71</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">9.3%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">18.3%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">6.3%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Edge overlay on original</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">36</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">9.8%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">33.3%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">5.8%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Raking light (left)</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">15</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">7.2%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">53.3%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">3.8%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Raking light (top)</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Upscaled 2x + Sobel</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Upscaled 2x + raking light</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">41</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">9.6%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">29.3%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">5.8%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Raw + Sobel (two images)</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">59</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">4.5%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">10.2%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">2.9%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Raw + Raking (two images)</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">13</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">2.7%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">23.1%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">1.4%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Raw + Raking + Sobel (three images)</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Raw + sign reference chart</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The most striking result: the raw photograph &mdash; which Experiment 5 had already shown was unreadable as a face crop &mdash; produced zero signs. But <strong>Sobel edge detection on the same image matched the best results from Experiment 5</strong> (15.1% F1, 43.2% precision). Edge detection converts the photograph into a map of brightness gradients, which corresponds directly to the physical wedge impressions on clay.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Raking light from the left &mdash; the digital simulation of the technique archaeologists use in the field &mdash; achieved the highest precision of any condition (53.3%), though with very few signs. This makes sense: the technique is highly selective, emphasizing only the strongest wedge impressions while losing fainter signs.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Multi-image input consistently performed <em>worse</em> than single processed images. Sending the model three image variants (raw + raking + sobel) produced zero signs. The sign reference chart &mdash; a lookup table of 50 common cuneiform signs &mdash; was also useless. More information confused the model rather than helping it.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Part B: multi-pass prompting and model comparison (8 conditions)
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          The second sub-experiment tested whether asking the model to make <strong>multiple passes</strong> over the same image could improve accuracy. The multi-pass strategy mimicked how a human epigrapher works:
        </p>

        <ol className="list-decimal pl-6 mb-6 space-y-2 text-secondary leading-relaxed">
          <li><strong>Survey pass:</strong> Count the lines, describe the tablet&apos;s physical condition, note the script style</li>
          <li><strong>Identification pass:</strong> Using the survey as context, go line by line and identify each sign</li>
          <li><strong>Review pass:</strong> Look at the image again, check each identification against what you see, correct any errors</li>
        </ol>

        <p className="text-secondary leading-relaxed mb-6">
          We compared this against single-pass identification across three models: Gemini 2.0 Flash (non-thinking), Gemini 2.5 Pro (thinking), and Gemini 3 Flash Preview (thinking).
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Condition</th>
                <th className="text-left py-3 pr-4 font-semibold">Model</th>
                <th className="text-right py-3 pr-4 font-semibold">Signs</th>
                <th className="text-right py-3 pr-4 font-semibold">F1</th>
                <th className="text-right py-3 pr-4 font-semibold">Prec.</th>
                <th className="text-right py-3 pr-4 font-semibold">Time</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Single-pass, raw photo</td>
                <td className="py-3 pr-4">2.0 Flash</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">21</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">3.5%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">19.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">3.8s</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Single-pass, Sobel</td>
                <td className="py-3 pr-4">2.0 Flash</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">7.0s</td>
              </tr>
              <tr className="border-b border-light bg-accent-sage/5">
                <td className="py-3 pr-4 font-semibold">Single-pass, raw photo</td>
                <td className="py-3 pr-4 font-semibold">2.5 Pro</td>
                <td className="py-3 pr-4 text-right font-mono text-sm font-semibold">42</td>
                <td className="py-3 pr-4 text-right font-mono text-sm font-semibold">15.2%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">45.2%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">76s</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Multi-pass, raw photo</td>
                <td className="py-3 pr-4">2.0 Flash</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">24</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">1.7%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">8.3%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">9.5s</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Multi-pass, Sobel</td>
                <td className="py-3 pr-4">2.0 Flash</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">35</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">5.8%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">20.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">12.8s</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Multi-pass, raw photo</td>
                <td className="py-3 pr-4">2.5 Pro</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">28</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">11.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">46.4%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">144s</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Multi-pass, raw + Sobel</td>
                <td className="py-3 pr-4">2.5 Pro</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">26</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">12.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">53.8%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">111s</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Single-pass, raw photo</td>
                <td className="py-3 pr-4">3 Flash (thinking)</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">74</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">6.4%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">12.2%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">102s</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Three clear findings:
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>1. Model choice dominates everything else.</strong> Gemini 2.5 Pro single-pass with the raw photograph (F1 = 15.2%) beat every Flash condition regardless of technique. The cheapest Pro run outperformed the most elaborate Flash pipeline by 3&ndash;10x.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>2. Multi-pass hurt accuracy.</strong> For both Flash and Pro, the single-pass approach outperformed multi-pass. Pro single-pass achieved 15.2% F1 vs. 11.0&ndash;12.0% for multi-pass. The review step introduced new errors while losing some correct identifications &mdash; the model second-guessed itself into worse performance. The only multi-pass advantage was precision: Pro multi-pass with dual images achieved 53.8% precision (highest of any condition), but at the cost of fewer total signs and lower F1.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>3. Thinking tokens don&apos;t help for cuneiform.</strong> Gemini 3 Flash Preview is a &ldquo;thinking&rdquo; model that spends tokens on internal deliberation before responding. On the P250675 photograph, it burned 15,587 thinking tokens (compared to zero for 2.0 Flash), took 102 seconds instead of 4 seconds, and produced 74 signs &mdash; but at only 12.2% precision and 6.4% F1. It confidently hallucinated a repeating field survey pattern (&ldquo;GAN SHA LA KU MU&rdquo;), reported 0.95 confidence, and performed worse than the non-thinking 2.5 Pro. Extended reasoning doesn&apos;t compensate for limited visual capability.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          What Experiment 6 tells us
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          The strongest single finding is that <strong>Sobel edge detection on an otherwise-unreadable face crop matches the best accuracy of any technique we tested</strong> (15.1% F1). This is practically useful: many CDLI photographs are composite views (obverse + reverse in one image) that produce zero results when cropped to a single face. Running a 3&times;3 Sobel kernel on the crop &mdash; a few milliseconds of computation &mdash; can rescue these images entirely.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          But the ceiling remains. Across all 21 conditions, no technique exceeded 15.2% F1. More compute (multi-pass), more images (dual/triple input), more deliberation (thinking tokens), and specialized image processing all failed to break through the ~15% barrier established in Experiments 4&ndash;5. The bottleneck is neither image quality nor prompting strategy nor compute &mdash; it is the model&apos;s ability to visually discriminate cuneiform signs.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The optimal pipeline is now clear: <strong>crop to face, apply Sobel edge detection if the raw crop fails, use the best available model (Gemini 2.5 Pro), single-pass prompt.</strong> Everything else is wasted effort until models improve their cuneiform sign recognition.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          But we had only tested Gemini models. What about Claude?
        </p>

        {/* --- Experiment 7: Cross-Vendor --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Experiment 7: Claude vs. Gemini
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Experiments 1&ndash;6 used only Gemini models. To test whether the ~15% F1 ceiling was Gemini-specific or a general limitation of current vision models, we tested Anthropic&apos;s Claude Opus 4.6 and Claude Sonnet 4.6 on the same P250675 tablet photograph. Each condition was run 3 times to measure variance.
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Condition</th>
                <th className="text-right py-3 pr-4 font-semibold">Signs</th>
                <th className="text-right py-3 pr-4 font-semibold">F1</th>
                <th className="text-right py-3 pr-4 font-semibold">Prec.</th>
                <th className="text-right py-3 pr-4 font-semibold">Std Dev</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light bg-accent-sage/5">
                <td className="py-3 pr-4 font-semibold">Claude Opus 4.6, raw photo</td>
                <td className="py-3 pr-4 text-right font-mono text-sm font-semibold">52</td>
                <td className="py-3 pr-4 text-right font-mono text-sm font-semibold">16.4%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">41.2%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">&plusmn;2.1%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Claude Opus 4.6, Sobel</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">29</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">13.7%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">55.9%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">&plusmn;1.8%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Claude Sonnet 4.6, raw photo</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">18</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">5.3%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">32.1%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">&plusmn;1.8%</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Gemini 2.5 Pro, raw photo</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">&mdash;</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Gemini 3 Pro, raw photo</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">&mdash;</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Gemini 3 Flash, Sobel</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">25</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">4.6%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">21.7%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">&plusmn;2.7%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Claude Opus matched the best Gemini result</strong> at 16.4% F1 on the raw photograph &mdash; the same level as Gemini 2.5 Pro in Experiment 4. But the Gemini models showed unexpected failures: Pro 2.5 produced <em>empty output</em> despite spending 8,000 thinking tokens, and Pro 3 entered an infinite repetition loop, outputting the same sign 400+ times. Only Flash 3 with Sobel edge detection produced usable output among the Gemini models.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Opus also identified 17 of 27 unique sign types in the ground truth (MA, NA, E, LA, BA, UR, KI, GA, DA, LUGAL, AN, UD, UM, LIL, GI, RA, MU) and correctly inferred the tablet&apos;s genre (administrative), period (Ur III), and institutional context (real estate sale with witnesses). It reported 0.25 confidence &mdash; a realistic self-assessment compared to Gemini 3 Flash&apos;s 0.95 confidence on worse results.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The precision pattern was particularly striking. Opus with Sobel edge detection achieved <strong>55.9% precision</strong> &mdash; the highest of any condition across all experiments. More than half of the signs it identified were correct. But like every other condition, recall remained low (6.3%) because the model identified far fewer signs than exist on the tablet.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The Gemini failures were puzzling. Pro 2.5 had been our best performer in Experiment 4, and Pro 3 had produced results (if hallucinated) in Experiment 6. Both were now failing completely. This suggested a parameter issue rather than a model capability problem.
        </p>

        {/* --- Experiment 8: Temperature --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Experiment 8: Temperature
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The Gemini failures in Experiment 7 led us to check the temperature parameter. We discovered that all Gemini experiments (1&ndash;7) had been run at <code className="text-sm bg-warm px-1.5 py-0.5 rounded">temperature: 0.1</code> &mdash; very low, pushing the model toward deterministic output. Claude, meanwhile, had been using its API default of <code className="text-sm bg-warm px-1.5 py-0.5 rounded">temperature: 1.0</code> (no explicit setting).
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Low temperature makes sense for tasks with clear right answers (code, math, factual recall). But cuneiform sign identification from photographs is inherently uncertain &mdash; the model needs room to explore multiple possible readings. At t=0.1, thinking models may get locked into repetition loops or exhaust their output budget on deliberation.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We re-ran each model at t=0.5 and t=1.0 on the same P250675 raw photograph.
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Condition</th>
                <th className="text-right py-3 pr-4 font-semibold">Temp</th>
                <th className="text-right py-3 pr-4 font-semibold">Signs</th>
                <th className="text-right py-3 pr-4 font-semibold">F1</th>
                <th className="text-right py-3 pr-4 font-semibold">Prec.</th>
                <th className="text-right py-3 pr-4 font-semibold">Time</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light bg-accent-sage/5">
                <td className="py-3 pr-4 font-semibold">Claude Opus 4.6</td>
                <td className="py-3 pr-4 text-right font-mono text-sm font-semibold">0.3</td>
                <td className="py-3 pr-4 text-right font-mono text-sm font-semibold">58</td>
                <td className="py-3 pr-4 text-right font-mono text-sm font-semibold">18.8%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">43.1%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">22s</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Claude Opus 4.6</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">1.0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">49</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">15.6%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">40.8%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">19s</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Gemini 2.5 Pro</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.1</td>
                <td className="py-3 pr-4 text-right font-mono text-sm text-muted">0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm text-muted">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm text-muted">&mdash;</td>
                <td className="py-3 pr-4 text-right font-mono text-sm text-muted">&mdash;</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Gemini 2.5 Pro</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.5</td>
                <td className="py-3 pr-4 text-right font-mono text-sm text-muted">0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm text-muted">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm text-muted">&mdash;</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">69s</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Gemini 2.5 Pro</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">1.0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">17</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">7.1%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">47.1%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">53s</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Gemini 3 Pro</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.1</td>
                <td className="py-3 pr-4 text-right font-mono text-sm text-muted">0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm text-muted">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm text-muted">&mdash;</td>
                <td className="py-3 pr-4 text-right font-mono text-sm text-muted">&mdash;</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Gemini 3 Pro</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.5</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">22</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">4.3%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">22.7%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">60s</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Gemini 3 Pro</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">1.0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">43</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">3.2%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">9.3%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">71s</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Gemini 3 Flash</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.5</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">40</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">0.0%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">84s</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">Gemini 3 Flash</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">1.0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">28</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">8.5%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">35.7%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">45s</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Temperature had a dramatic effect:
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>1. Claude Opus at t=0.3 set a new high-water mark: 18.8% F1.</strong> Lower temperature improved accuracy for Claude, likely because the task benefits from more deterministic sign identification once the model has genuine visual signal. The 43.1% precision means nearly half of all identified signs were correct.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>2. Higher temperature rescued the Gemini thinking models.</strong> Pro 2.5, which produced empty output at t=0.1 and t=0.5, finally generated 17 signs at t=1.0 &mdash; with 47.1% precision, its highest ever. Pro 3 broke out of its repetition loop and produced usable (if inaccurate) output. Flash 3 went from 0% F1 at t=0.5 to 8.5% at t=1.0.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>3. The Gemini failures in earlier experiments were partly a temperature artifact.</strong> When Gemini 2.5 Pro achieved 15.2% F1 in Experiment 4, it was likely a different API version or deployment &mdash; the same model ID at t=0.1 now produces nothing. This suggests that the Experiment 4 results, while real, may not be reproducible with the current API. Temperature sensitivity is a confound that affects all historical comparisons.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>4. Claude and Gemini have opposite temperature preferences.</strong> Claude improved from 15.6% to 18.8% as temperature dropped from 1.0 to 0.3. Gemini improved from 0% to 7&ndash;8% as temperature rose from 0.1 to 1.0. This may reflect architectural differences: Claude is a non-thinking model that benefits from deterministic output on tasks where it has signal, while Gemini&apos;s thinking models need randomness to escape deliberation traps on uncertain tasks.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Updated leaderboard
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Combining results across all eight experiments:
        </p>

        <div className="overflow-x-auto mb-8">
          <table className="w-full text-secondary text-base">
            <thead>
              <tr className="border-b border-medium">
                <th className="text-left py-3 pr-4 font-semibold">Rank</th>
                <th className="text-left py-3 pr-4 font-semibold">Condition</th>
                <th className="text-right py-3 pr-4 font-semibold">F1</th>
                <th className="text-right py-3 pr-4 font-semibold">Prec.</th>
                <th className="text-left py-3 pr-4 font-semibold">Experiment</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-light bg-accent-sage/5">
                <td className="py-3 pr-4 font-semibold">1</td>
                <td className="py-3 pr-4 font-semibold">Claude Opus 4.6, raw, t=0.3</td>
                <td className="py-3 pr-4 text-right font-mono text-sm font-semibold">18.8%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">43.1%</td>
                <td className="py-3 pr-4">Exp 8</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">2</td>
                <td className="py-3 pr-4">Claude Opus 4.6, raw, t=1.0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">16.4%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">41.2%</td>
                <td className="py-3 pr-4">Exp 7</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">3</td>
                <td className="py-3 pr-4">Gemini 2.5 Pro, raw, t=0.1</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">15.2%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">45.2%</td>
                <td className="py-3 pr-4">Exp 6</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">4</td>
                <td className="py-3 pr-4">Gemini 2.5 Pro, Sobel, t=0.1</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">15.1%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">43.2%</td>
                <td className="py-3 pr-4">Exp 6</td>
              </tr>
              <tr className="border-b border-light">
                <td className="py-3 pr-4">5</td>
                <td className="py-3 pr-4">Claude Opus 4.6, Sobel, t=1.0</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">13.7%</td>
                <td className="py-3 pr-4 text-right font-mono text-sm">55.9%</td>
                <td className="py-3 pr-4">Exp 7</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Claude Opus 4.6 at t=0.3 is the new overall best at 18.8% F1 &mdash; breaking through the ~15% ceiling that had held across all six Gemini-only experiments. The top 5 all cluster between 13&ndash;19% F1, with precision consistently between 41&ndash;56%. The highest-precision condition remains Opus with Sobel (55.9%), meaning more than half of identified signs are correct, but recall stays stubbornly low.
        </p>

        {/* --- What the model actually produces --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What 18.8% F1 Looks Like
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Statistics only go so far. Here is the actual output from our best condition &mdash; Claude Opus 4.6 at t=0.3 &mdash; alongside the tablet photograph it was reading. You can compare each cuneiform sign the model produced against the clay surface yourself.
        </p>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Tablet photograph */}
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/P250675_raw.jpg"
              alt="Cuneiform tablet P250675 (CUSAS 35, 426) — obverse face, Old Akkadian period"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-xs text-muted mt-2 italic">
              P250675 (CUSAS 35, 426) &mdash; Old Akkadian, ca. 2340&ndash;2200 BCE. Three columns on the obverse face. 208 signs in the published ground truth.
            </figcaption>
          </figure>

          {/* Model output */}
          <div className="bg-warm rounded-lg p-4 sm:p-5 overflow-x-auto">
            <p className="text-xs text-muted mb-3 font-semibold uppercase tracking-wide">Claude Opus 4.6 output (t=0.3, 22 seconds)</p>
            <div className="space-y-2 font-mono text-sm leading-relaxed">
              <p><span className="text-muted">1:</span> <span className="text-3xl align-middle">𒌋</span> <span className="text-muted">[UNCLEAR]</span> <span className="text-3xl align-middle">𒂠</span> <span className="text-xs text-secondary">SHE₃</span> <span className="text-3xl align-middle">𒄀</span> <span className="text-xs text-secondary">GI</span> <span className="text-3xl align-middle">𒈬</span> <span className="text-xs text-secondary">MU</span> <span className="text-muted">[UNCLEAR]</span></p>
              <p><span className="text-muted">2:</span> <span className="text-3xl align-middle">𒋗</span> <span className="text-xs text-secondary">SHU</span> <span className="text-3xl align-middle">𒃻</span> <span className="text-xs text-secondary">GAR</span> <span className="text-3xl align-middle">𒊏</span> <span className="text-xs text-secondary">RA</span> <span className="text-3xl align-middle">𒈾</span> <span className="text-xs text-secondary">NA</span> <span className="text-3xl align-middle">𒀀</span> <span className="text-xs text-secondary">A</span></p>
              <p><span className="text-muted">3:</span> <span className="text-3xl align-middle">𒆳</span> <span className="text-xs text-secondary">KUR</span> <span className="text-3xl align-middle">𒁀</span> <span className="text-xs text-secondary">BA</span> <span className="text-3xl align-middle">𒀭</span> <span className="text-xs text-secondary">AN</span> <span className="text-3xl align-middle">𒂗</span> <span className="text-xs text-secondary">EN</span> <span className="text-3xl align-middle">𒆤</span> <span className="text-xs text-secondary">LIL₂</span></p>
              <p><span className="text-muted">4:</span> <span className="text-3xl align-middle">𒇷</span> <span className="text-xs text-secondary">LI</span> <span className="text-3xl align-middle">𒆷</span> <span className="text-xs text-secondary">LA</span> <span className="text-3xl align-middle">𒊑</span> <span className="text-xs text-secondary">RI</span> <span className="text-3xl align-middle">𒅎</span> <span className="text-xs text-secondary">IM</span> <span className="text-3xl align-middle">𒄀</span> <span className="text-xs text-secondary">GI</span></p>
              <p><span className="text-muted">5:</span> <span className="text-3xl align-middle">𒈬</span> <span className="text-xs text-secondary">MU</span> <span className="text-3xl align-middle">𒌓</span> <span className="text-xs text-secondary">UD</span> <span className="text-3xl align-middle">𒁲</span> <span className="text-xs text-secondary">DU₃</span> <span className="text-3xl align-middle">𒀀</span> <span className="text-xs text-secondary">A</span> <span className="text-3xl align-middle">𒁀</span> <span className="text-xs text-secondary">BA</span></p>
              <p><span className="text-muted">6:</span> <span className="text-3xl align-middle">𒊮</span> <span className="text-xs text-secondary">SHA₃</span> <span className="text-3xl align-middle">𒂍</span> <span className="text-xs text-secondary">E₂</span> <span className="text-3xl align-middle">𒀭</span> <span className="text-xs text-secondary">AN</span> <span className="text-3xl align-middle">𒈾</span> <span className="text-xs text-secondary">NA</span> <span className="text-3xl align-middle">𒋗</span> <span className="text-xs text-secondary">SHU</span></p>
              <p><span className="text-muted">7:</span> <span className="text-3xl align-middle">𒅆</span> <span className="text-xs text-secondary">IGI</span> <span className="text-3xl align-middle">𒃲</span> <span className="text-xs text-secondary">GAL</span> <span className="text-3xl align-middle">𒈗</span> <span className="text-xs text-secondary">LUGAL</span> <span className="text-3xl align-middle">𒌷</span> <span className="text-xs text-secondary">URU</span> <span className="text-3xl align-middle">𒆠</span> <span className="text-xs text-secondary">KI</span></p>
              <p><span className="text-muted">8:</span> <span className="text-3xl align-middle">𒄿</span> <span className="text-xs text-secondary">I</span> <span className="text-3xl align-middle">𒋾</span> <span className="text-xs text-secondary">TI</span> <span className="text-3xl align-middle">𒅗</span> <span className="text-xs text-secondary">KA</span> <span className="text-3xl align-middle">𒊏</span> <span className="text-xs text-secondary">RA</span> <span className="text-3xl align-middle">𒁀</span> <span className="text-xs text-secondary">BA</span></p>
              <p><span className="text-muted">9:</span> <span className="text-3xl align-middle">𒈬</span> <span className="text-xs text-secondary">MU</span> <span className="text-3xl align-middle">𒌑</span> <span className="text-xs text-secondary">U₂</span> <span className="text-3xl align-middle">𒊕</span> <span className="text-xs text-secondary">SAG</span> <span className="text-3xl align-middle">𒂠</span> <span className="text-xs text-secondary">SHE₃</span> <span className="text-muted">[UNCLEAR]</span></p>
              <p><span className="text-muted">10:</span> <span className="text-3xl align-middle">𒋛</span> <span className="text-xs text-secondary">SI</span> <span className="text-3xl align-middle">𒀀</span> <span className="text-xs text-secondary">A</span> <span className="text-3xl align-middle">𒈾</span> <span className="text-xs text-secondary">NA</span> <span className="text-3xl align-middle">𒆕</span> <span className="text-muted">[UNCLEAR]</span> <span className="text-3xl align-middle">𒋃</span> <span className="text-muted">[UNCLEAR]</span></p>
            </div>
            <div className="mt-4 pt-3 border-t border-medium/30 text-xs text-muted space-y-1">
              <p>58 signs extracted &middot; 25 matched ground truth &middot; 43% precision &middot; 12% recall</p>
              <p>Self-reported confidence: 0.28 &mdash; &ldquo;low due to the photographic angle, surface damage, and the difficulty of resolving individual wedge impressions from photographs rather than direct examination.&rdquo;</p>
            </div>
          </div>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Some observations from reading the output against the photograph:
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The model correctly reads the tablet as multi-column and identifies many real sign shapes &mdash; <span className="font-mono text-lg">𒀭</span> AN, <span className="font-mono text-lg">𒈗</span> LUGAL, <span className="font-mono text-lg">𒂍</span> E₂, <span className="font-mono text-lg">𒆠</span> KI are all signs that appear in the ground truth ATF. Line 7&apos;s <span className="font-mono text-lg">𒅆</span> IGI <span className="font-mono text-lg">𒃲</span> GAL <span className="font-mono text-lg">𒈗</span> LUGAL reads as &ldquo;before the king&rdquo; &mdash; a witness formula common in Old Akkadian legal texts, which is exactly what this tablet is (a real estate sale). The model inferred the document genre correctly.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          But the errors are equally visible. The model reads 10 lines where the ground truth has three columns of 10+ lines each. It is reading one column (or parts of multiple columns) while missing most of the tablet. Many of the cuneiform characters it outputs are valid Unicode codepoints that <em>look plausible</em> but don&apos;t match the actual wedge patterns on the clay surface. This is the fundamental challenge: the model has learned what cuneiform signs look like in general, but cannot reliably match specific wedge impressions in a photograph to specific signs.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The 0.28 self-reported confidence is refreshingly honest. The model knows it is struggling.
        </p>

        {/* --- Conclusion --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Conclusion
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Can AI read cuneiform? Not yet &mdash; but the picture is more nuanced than &ldquo;no.&rdquo; Across 107 tablets and eight experiments spanning two model families, these models correctly identify the Code of Hammurabi, detect a Neo-Babylonian forgery from its script style, produce excellent scholarly commentary, and &mdash; crucially &mdash; perform genuine visual analysis that is independent of their training data. They are not reading from memory.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The contamination test (Experiment 3) settles the most important methodological question: the model&apos;s vision performance is the same whether or not it has the text memorized (Pearson r = &minus;0.076). This means there is a real, if limited, visual signal being extracted from cuneiform photographs. The model detects ~37% of expected signs at ~0.7 confidence &mdash; not enough for production use, but enough to build on.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The models have cuneiform <em>knowledge</em> without reliable cuneiform <em>vision</em>. But they have <em>some</em> cuneiform vision, and that vision is genuine. Experiments 4&ndash;6 systematically tested what helps: better models double accuracy (Experiment 4), image cropping matters for high-resolution photographs (Experiment 5), and Sobel edge detection can rescue otherwise-unreadable crops (Experiment 6). Multi-pass prompting, thinking tokens, multi-image input, sign reference charts, and raking light simulations all failed to move the needle. Experiments 7&ndash;8 brought in Claude Opus and discovered that temperature settings are a critical confound: Claude Opus at t=0.3 broke through the ~15% F1 ceiling to reach 18.8%, while Gemini thinking models need higher temperature (t=1.0) to avoid repetition loops and empty output.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The best result so far &mdash; 18.8% F1 with 43% precision &mdash; means that when the model identifies a sign, it is correct nearly half the time. But it only identifies a small fraction of the signs on the tablet. The bottleneck is not image quality, prompting, or compute: it is the model&apos;s ability to reliably distinguish individual cuneiform wedge patterns.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          For Source Library, this means cuneiform support is infrastructure-ready but model-limited. The prompts, import pipeline, evaluation corpus, and contamination testing framework are built. The optimal processing pipeline is established: crop to face, apply Sobel edge detection as a fallback, use the most capable available model (currently Claude Opus 4.6 at t=0.3), single pass. When a model can reliably read wedge impressions &mdash; whether through fine-tuning on CDLI&apos;s 300,000 tablet photographs, improved vision capabilities, or the next generation of foundation models &mdash; Source Library can process cuneiform tablets with the same pipeline it uses for Renaissance printed books.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The oldest writing system in the world is waiting.
        </p>

        <hr className="border-light my-12" />

        <p className="text-muted text-sm leading-relaxed">
          <strong>Technical details:</strong> Experiments 1&ndash;3: Gemini 3 Flash Preview. Experiment 1 (4 tablets): ATF transliteration prompt. Experiment 2 (4 tablets): sign identification prompt requesting Unicode characters and sign names. Experiment 3 (107 tablets): contamination test (text-only memory probe, &gt;30% sign overlap threshold) and cross-analysis against vision performance. Experiment 4: model comparison across Gemini 3 Flash, 2.5 Flash, 2.5 Pro, and 3 Pro on 4 tablets. Experiment 5: cropping (composite vs. face crop vs. line strips) and image preprocessing (CLAHE, sharpen, upscale 2x, invert, combined, upscale+CLAHE) using Gemini 2.5 Pro on P250675 and P100500. Experiment 6: 13 image processing conditions (Sobel edge detection, pseudo-heightmap, raking light simulation, edge overlay, multi-image input, sign reference chart) using Gemini 2.5 Pro on P250675 obverse crop; 8 multi-pass prompting conditions (single-pass vs. 3-pass survey/identify/review) across Gemini 2.0 Flash, 2.5 Pro, and 3 Flash Preview (thinking model). Experiment 7: cross-vendor comparison using Claude Opus 4.6, Claude Sonnet 4.6 (Anthropic Messages API, anthropic-version 2023-06-01) and Gemini 2.5 Pro, 3 Pro, 3 Flash (Gemini REST API) on P250675 obverse raw photograph; 3 trials per condition, standard deviation reported; Opus additionally tested with Sobel edge detection. Experiment 8: temperature sweep &mdash; Claude Opus at t=0.3 and t=1.0; Gemini 2.5 Pro, 3 Pro, and 3 Flash each at t=0.1, t=0.5, and t=1.0; single trial per condition on P250675 raw photograph. Corpus: 107 tablets from CDLI spanning 11 periods. Tablet photographs sourced from CDLI. Ground truth ATF from CDLI published transliterations. Preprocessing: sharp library (Node.js). Evaluation: bag-of-signs F1, precision, recall, Jaccard. Full evaluation reports, corpus data, and analysis scripts available on request.
        </p>
      </article>

      <BlogComments slug="cuneiform-ocr" />
    </ContentPageLayout>
  );
}
