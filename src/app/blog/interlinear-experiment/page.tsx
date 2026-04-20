import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'Interlinear Display for Ancient Texts - Research Notes - Source Library',
  description: 'Comparing paragraph vs interlinear layouts for Sumerian and Egyptian texts. Which format better serves readers of the oldest literature on Earth?',
  alternates: {
    canonical: '/blog/interlinear-experiment',
  },
};

// Sample data: Instructions of Shuruppag (ETCSL 5.6.1) opening lines
const SHURUPPAG_LINES = [
  {
    sumerian: 'ud re-a ud su₃-ra₂ re-a',
    transliteration: 'ud re-a ud sù-rá re-a',
    english: 'In those days, in those far remote days,',
  },
  {
    sumerian: 'ĝi₆ re-a ĝi₆ su₃-ra₂ re-a',
    transliteration: 'ĝi₆ re-a ĝi₆ sù-rá re-a',
    english: 'in those nights, in those faraway nights,',
  },
  {
    sumerian: 'mu re-a mu su₃-ra₂ re-a',
    transliteration: 'mu re-a mu sù-rá re-a',
    english: 'in those years, in those far remote years,',
  },
  {
    sumerian: 'ud ul-li₂-a-ta ud ul-li₂-a-ta',
    transliteration: 'ud ul-lí-a-ta ud ul-lí-a-ta',
    english: 'at that time, at that time —',
  },
  {
    sumerian: 'šuruppag-ke₄ dumu-ni-ra na ri-in-de₅-de₅',
    transliteration: 'šuruppag-ke₄ dumu-ni-ra na ri-in-de₅-de₅',
    english: 'Shuruppag gave instructions to his son,',
  },
  {
    sumerian: 'šuruppag dumu ubara-tutu-ke₄',
    transliteration: 'šuruppag dumu ubara-tutu-ke₄',
    english: 'Shuruppag, the son of Ubara-Tutu,',
  },
  {
    sumerian: 'dumu-ĝu₁₀ na de₅-de₅-ĝu₁₀ ḫe₂-dab₅',
    transliteration: 'dumu-ĝu₁₀ na de₅-de₅-ĝu₁₀ ḫé-dab₅',
    english: '"My son, let me give you instructions, may you pay attention!',
  },
  {
    sumerian: 'zi-ud-su₃-ra₂ na de₅-de₅-ĝu₁₀ ḫe₂-dab₅',
    transliteration: 'zi-ud-sù-rá na de₅-de₅-ĝu₁₀ ḫé-dab₅',
    english: 'Ziusudra, let me give you instructions, may you pay attention!',
  },
];

// Sample: Sinuhe opening (ORAEC) with hieroglyphic transliteration
const SINUHE_LINES = [
  {
    hieroglyphs: 'jrj.pat ḥꜣ.tj-ꜥ',
    transliteration: 'irī.pat ḥātī-ʿ',
    german: 'Der Fürst und Graf,',
    english: 'The prince and count,',
  },
  {
    hieroglyphs: 'ḫtm.tj-bjt.j smr wꜥ.tj',
    transliteration: 'ḫtm.tī-bītī smr wʿ.tī',
    german: 'der Siegler des Königs von Unterägypten, der einzige Freund,',
    english: 'the royal seal-bearer, sole companion,',
  },
  {
    hieroglyphs: 'jm.j-rʾ ḫꜣs.wt nt(.j) nb.t n.t ṯnw',
    transliteration: 'imī-rʾ ḫāswt ntī nbt nt ṯnw',
    german: 'der Vorsteher der Fremdländer des Herrn des Ostens,',
    english: 'the overseer of foreign lands of the lord of the east,',
  },
  {
    hieroglyphs: 'rḫ.j njswt mꜣꜥ mri̯=f',
    transliteration: 'rḫī nīswt māʿ mrī=f',
    german: 'der wahre Bekannte des Königs, sein Geliebter,',
    english: 'the true royal acquaintance, his beloved,',
  },
  {
    hieroglyphs: 'šms.w sꜣ-nḥ.t',
    transliteration: 'šmsw Sā-nḥt',
    german: 'der Gefolgsmann Sinuhe.',
    english: 'the follower, Sinuhe.',
  },
];

// Gilgamesh Tablet I opening (Standard Babylonian, transliterated)
const GILGAMESH_LINES = [
  {
    akkadian: 'ša nag-ba i-mu-ru iš-di ma-a-ti',
    english: 'He who saw the Deep, the foundation of the land,',
  },
  {
    akkadian: 'i-du-ú [...] ka-la-ma ḫa-si-is',
    english: 'who knew [...] was wise in all things:',
  },
  {
    akkadian: 'dGIŠ-gím-maš ša nag-ba i-mu-ru iš-di ma-a-ti',
    english: 'Gilgamesh, who saw the Deep, the foundation of the land,',
  },
  {
    akkadian: 'i-du-ú [...] ka-la-ma ḫa-si-is',
    english: 'who knew [...] was wise in all things:',
  },
  {
    akkadian: '[...] mit-ḫa-riš ik-šu-du nap-ḫar šim-ti',
    english: '[...] equally he reached the sum of wisdom.',
  },
  {
    akkadian: 'ni-ṣir-ta i-mu-ur-ma ka-tim-ta ip-tu-ú',
    english: 'He saw what was secret and uncovered what was hidden,',
  },
  {
    akkadian: 'ub-la ṭe₄-e-ma ša la-am a-bu-bi',
    english: 'he brought back a tale of the time before the Flood.',
  },
];

export default function InterlinearExperimentPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Interlinear Display for Ancient Texts"
          subtitle="Comparing layouts for Sumerian, Akkadian, and Egyptian"
        >
          <p className="text-stone-400 text-sm mt-4">20 April 2026 &middot; 8 min read</p>
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

        <p>
          Source Library holds 373 Sumerian literary texts from ETCSL and hundreds of Egyptian texts from ORAEC.
          Both corpora include word-by-word data that could support interlinear display &mdash; showing the original,
          transliteration, and translation aligned line-by-line. This is how scholars actually read these texts.
        </p>

        <p>
          But is interlinear better for general readers? This page compares three layouts using the same source material.
        </p>

        <hr className="my-12 border-stone-200" />

        {/* ===== SECTION 1: Instructions of Shuruppag ===== */}
        <h2>1. Instructions of Shuruppag (Sumerian, c. 2600 BCE)</h2>
        <p className="text-muted text-sm">
          The oldest surviving wisdom text. A father&apos;s advice to his son &mdash; who happens to be Ziusudra, the Sumerian Noah.
        </p>

        <h3>Layout A: Paragraph (current)</h3>
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-6 my-6">
          <p className="italic text-stone-600 text-sm mb-4 font-mono">
            {SHURUPPAG_LINES.map(l => l.transliteration).join(' / ')}
          </p>
          <p className="text-stone-800">
            {SHURUPPAG_LINES.map(l => l.english).join(' ')}
          </p>
        </div>

        <h3>Layout B: Interlinear (line-by-line)</h3>
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-6 my-6 space-y-4">
          {SHURUPPAG_LINES.map((line, i) => (
            <div key={i} className="grid grid-cols-1 gap-0.5 pb-3 border-b border-stone-100 last:border-0 last:pb-0">
              <span className="font-mono text-xs text-amber-700 tracking-wide">{line.transliteration}</span>
              <span className="text-stone-800 text-sm">{line.english}</span>
            </div>
          ))}
        </div>

        <h3>Layout C: Three-tier interlinear</h3>
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-6 my-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <tbody>
                {SHURUPPAG_LINES.map((line, i) => (
                  <tr key={i} className="border-b border-stone-100 last:border-0">
                    <td className="pr-3 py-2 text-xs text-stone-400 font-mono w-8 align-top">{i + 1}</td>
                    <td className="py-2 align-top">
                      <div className="font-mono text-xs text-amber-800 tracking-wide">{line.sumerian}</div>
                      <div className="text-stone-800 text-sm mt-0.5">{line.english}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <hr className="my-12 border-stone-200" />

        {/* ===== SECTION 2: Sinuhe ===== */}
        <h2>2. The Tale of Sinuhe (Egyptian, c. 1875 BCE)</h2>
        <p className="text-muted text-sm">
          The masterpiece of Middle Egyptian literature. Here showing the opening with transliteration from ORAEC,
          German (original academic translation), and English.
        </p>

        <h3>Layout A: Paragraph</h3>
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-6 my-6">
          <p className="italic text-stone-600 text-sm mb-4 font-mono">
            {SINUHE_LINES.map(l => l.transliteration).join(' ')}
          </p>
          <p className="text-stone-800">
            {SINUHE_LINES.map(l => l.english).join(' ')}
          </p>
        </div>

        <h3>Layout B: Four-tier interlinear (with German intermediary)</h3>
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-6 my-6 space-y-3">
          {SINUHE_LINES.map((line, i) => (
            <div key={i} className="pb-3 border-b border-stone-100 last:border-0 last:pb-0">
              <div className="font-mono text-xs text-emerald-800 tracking-wide">{line.hieroglyphs}</div>
              <div className="text-xs text-stone-400 italic mt-0.5">{line.german}</div>
              <div className="text-stone-800 text-sm mt-0.5">{line.english}</div>
            </div>
          ))}
        </div>

        <hr className="my-12 border-stone-200" />

        {/* ===== SECTION 3: Gilgamesh ===== */}
        <h2>3. Epic of Gilgamesh, Tablet I (Akkadian, c. 1200 BCE)</h2>
        <p className="text-muted text-sm">
          The opening of the Standard Babylonian version. The famous &ldquo;He who saw the Deep&rdquo; prologue.
        </p>

        <h3>Layout A: Paragraph</h3>
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-6 my-6">
          <p className="text-stone-800">
            {GILGAMESH_LINES.map(l => l.english).join(' ')}
          </p>
        </div>

        <h3>Layout B: Bilingual interlinear</h3>
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-6 my-6 space-y-3">
          {GILGAMESH_LINES.map((line, i) => (
            <div key={i} className="pb-3 border-b border-stone-100 last:border-0 last:pb-0">
              <div className="font-mono text-xs text-purple-800 tracking-wide">{line.akkadian}</div>
              <div className="text-stone-800 text-sm mt-0.5">{line.english}</div>
            </div>
          ))}
        </div>

        <hr className="my-12 border-stone-200" />

        {/* ===== Discussion ===== */}
        <h2>Observations</h2>

        <p><strong>Interlinear wins for poetry.</strong> Ancient Mesopotamian and Egyptian literature is overwhelmingly poetry &mdash; parallelism, repetition, line-level wordplay. The paragraph layout collapses this structure. Interlinear preserves it.</p>

        <p><strong>The transliteration layer matters.</strong> Even readers who don&apos;t know Sumerian or Akkadian can notice patterns in the transliteration &mdash; repeated words, parallel constructions, phonetic echoes. This is invisible in paragraph mode.</p>

        <p><strong>Three tiers may be too much for casual reading.</strong> The four-tier Egyptian layout (hieroglyphs + German + English) is information-dense. Two tiers (original + English) may be the sweet spot, with the third available on hover/expand.</p>

        <p><strong>Mobile is the challenge.</strong> Interlinear works beautifully on desktop but can feel cramped on narrow screens. Possible solutions: collapse to bilingual toggle, or show only the translation with &ldquo;show original&rdquo; tap targets.</p>

        <h3>Next steps</h3>
        <ul>
          <li>Build an interactive toggle (paragraph / interlinear) into the reader for ETCSL and ORAEC texts</li>
          <li>Explore word-level alignment: hover a Sumerian word to highlight its English equivalent</li>
          <li>Test with actual users: scholars vs general readers vs language learners</li>
          <li>Consider Unicode hieroglyphic rendering (U+13000 block) for the Egyptian tier</li>
        </ul>

        <hr className="my-12 border-stone-200" />

        <p className="text-sm text-muted">
          Texts: <Link href="/book/the-instructions-of-shuruppag" className="text-secondary hover:underline">Instructions of Shuruppag</Link> (ETCSL 5.6.1),{' '}
          <Link href="/book/the-eloquent-peasant" className="text-secondary hover:underline">The Eloquent Peasant</Link> (ORAEC),{' '}
          <Link href="/book/an-old-babylonian-version-of-the-gilgamesh-epic-mesopotamian" className="text-secondary hover:underline">Epic of Gilgamesh</Link>.
          All source data from <a href="https://etcsl.orinst.ox.ac.uk/" className="text-secondary hover:underline" target="_blank" rel="noopener">ETCSL</a> and{' '}
          <a href="https://github.com/oraec/corpus_raw_data" className="text-secondary hover:underline" target="_blank" rel="noopener">ORAEC</a>.
        </p>

      </article>

      <BlogComments slug="interlinear-experiment" />
    </ContentPageLayout>
  );
}
