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
          subtitle="Testing Gemini on the oldest writing system on Earth"
        >
          <p className="text-stone-400 text-sm mt-4">6 March 2026 &middot; 15 min read</p>
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
          This post explains what cuneiform is, how scholars read it, what we asked the AI to do, and what happened when we compared the output against published scholarship. It ends with a formal experimental design for a larger-scale evaluation.
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

        {/* --- The Experiment --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The experiment
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

        <p className="text-secondary leading-relaxed mb-6">
          Each tablet was imported into Source Library as a &ldquo;book&rdquo; with one page per photograph. We wrote a custom &ldquo;Cuneiform OCR&rdquo; prompt instructing Gemini to produce ATF transliteration with structured metadata (script type, period, genre, condition, confidence score). We ran the prompt using <strong>Gemini 3 Flash Preview</strong>, then compared each output line-by-line against CDLI&apos;s published ATF.
        </p>

        {/* --- Detailed Walkthrough: Ur III tablet --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Walkthrough: the sheep receipt
        </h2>

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
          The four results reveal a consistent pattern. Gemini has extensive <em>knowledge</em> about cuneiform &mdash; it knows ATF format, Sumerian and Akkadian vocabulary, administrative tablet conventions, royal inscription formulae, and the scholarly literature on the Cruciform Monument. But its ability to visually discriminate individual cuneiform signs from a photograph appears limited.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          When knowledge and vision align (Hammurabi), the output is correct. When the model can reason from context without needing sign-level vision (Manishtushu forgery detection), the output is impressive. But when the task requires reading unfamiliar signs in an unfamiliar text (Ur III sheep receipt), the model generates from its distributional knowledge rather than reading what&apos;s in front of it.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>The honest summary: Gemini 3 Flash is a cuneiform <em>commentator</em>, not a cuneiform <em>reader</em>.</strong> It can discuss cuneiform tablets with scholarly precision. It cannot reliably read them.
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
          This design separates four capabilities that our PoC tangled together: (1) visual sign discrimination, (2) knowledge of cuneiform conventions, (3) document-level pattern matching, and (4) training data memorization. A model that scores high on &ldquo;unknown&rdquo; tablets with no context hints has genuine cuneiform vision. A model that only scores high on &ldquo;known&rdquo; tablets with genre hints is doing sophisticated retrieval. Both are useful, but for different purposes &mdash; and only the first would transform the field.
        </p>

        {/* --- Conclusion --- */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Conclusion
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Can AI read cuneiform? Sometimes. Gemini 3 Flash correctly reads the Code of Hammurabi, detects a Neo-Babylonian forgery from its script style, and produces excellent scholarly commentary. But it also fabricates an entire Sumerian document with 0.95 confidence. The model has cuneiform <em>knowledge</em> without reliable cuneiform <em>vision</em>.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          For Source Library, this means cuneiform support is infrastructure-ready but model-limited. The prompts, import pipeline, and evaluation framework are built. When a model can reliably read wedge impressions &mdash; whether through fine-tuning on CDLI&apos;s 300,000 tablet photographs, improved vision capabilities, or the next generation of foundation models &mdash; Source Library can process cuneiform tablets with the same pipeline it uses for Renaissance printed books.
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
