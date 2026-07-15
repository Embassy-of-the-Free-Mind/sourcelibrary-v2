import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Facing Page vs Interlinear: How Should Ancient Texts Be Read? - Source Library',
  description: 'Comparing our facing-page reader (scan + translation side by side) with interlinear display (original and translation woven line by line) for Sumerian, Akkadian, and Egyptian texts.',
  alternates: {
    canonical: '/blog/interlinear-experiment',
  },
};

// Instructions of Shuruppag opening (ETCSL 5.6.1)
const SHURUPPAG_LINES = [
  { original: 'ud re-a ud su₃-ra₂ re-a', english: 'In those days, in those far remote days,' },
  { original: 'ĝi₆ re-a ĝi₆ su₃-ra₂ re-a', english: 'in those nights, in those faraway nights,' },
  { original: 'mu re-a mu su₃-ra₂ re-a', english: 'in those years, in those far remote years,' },
  { original: 'ud ul-li₂-a-ta ud ul-li₂-a-ta', english: 'at that time, at that time —' },
  { original: 'šuruppag-ke₄ dumu-ni-ra na ri-in-de₅-de₅', english: 'Shuruppag gave instructions to his son,' },
  { original: 'šuruppag dumu ubara-tutu-ke₄', english: 'Shuruppag, the son of Ubara-Tutu,' },
  { original: 'dumu-ĝu₁₀ na de₅-de₅-ĝu₁₀ ḫe₂-dab₅', english: '"My son, let me give you instructions — pay attention!' },
  { original: 'zi-ud-su₃-ra₂ na de₅-de₅-ĝu₁₀ ḫe₂-dab₅', english: 'Ziusudra, let me give you instructions — pay attention!' },
  { original: 'inim-ĝu₁₀ na-ab-de₅ na de₅-de₅-ĝu₁₀ ḫe���-dab₅', english: 'Do not neglect my instructions, pay attention to my words!' },
  { original: 'nam-ku-li na-an-ak-e', english: 'Do not commit robbery,' },
  { original: 'igi nam-ku-li na-an-bar-re', english: 'do not look with desire,' },
  { original: 'nam-ku-li lu₂ ḫul-ĝal₂-la-am₃', english: 'robbery is a devouring man.' },
];

// Gilgamesh Tablet XI (Flood) excerpt
const GILGAMESH_LINES = [
  { original: 'dGIŠ-gím-maš a-na ša-a-šu iz-za-kar-am a-na mUT-na-piš-tim ru-u-qí', english: 'Gilgamesh spoke to him, to Utnapishtim the Faraway:' },
  { original: 'a-na-tal-ka mUT-na-piš-tim', english: '"I look at you, Utnapishtim,' },
  { original: 'la-a na-ṭa-a-ta at-ta-ma ki-i ia-a-ši at-ta-ma', english: 'your form is no different — you are just like me!' },
  { original: 'ul ta-na-an-dir at-ta-ma ki-i ia-a-ši at-ta-ma', english: 'You are not different at all — you are just like me!' },
  { original: 'lib₃-bi ib-ni-ka a-na e-peš tu-qu-un-ti', english: 'My heart had imagined you doing battle,' },
  { original: 'u at-ta ta-at-ti-il-ma se-ri-iš ta-na-al', english: 'but you lie here idle on your back!' },
  { original: '[al]-ka-am-ma qí-bi-a-am lu-ud-ma-iq šu-úr-šu-ub-ta', english: 'Tell me, how did you join the Assembly of the Gods' },
  { original: 'i-na pu-uḫ-ri-šu-nu ba-la-ṭa ta-at-ta-ṣi', english: 'and find eternal life?"' },
];

// Sinuhe opening (ORAEC)
const SINUHE_LINES = [
  { original: 'jrj.pat ḥꜣ.tj-ꜥ', german: 'Der Fürst und Graf,', english: 'The prince and count,' },
  { original: 'ḫtm.tj-bjt.j smr wꜥ.tj', german: 'der Siegler des Königs, der einzige Freund,', english: 'the royal seal-bearer, sole companion,' },
  { original: 'jm.j-rʾ ḫꜣs.wt nt nb n ṯnw', german: 'der Vorsteher der Fremdländer des Herrn des Ostens,', english: 'the overseer of foreign lands of the lord of the east,' },
  { original: 'rḫ njswt mꜣꜥ mri̯=f', german: 'der wahre Bekannte des Königs, sein Geliebter,', english: 'the true royal acquaintance, his beloved,' },
  { original: 'šms.w sꜣ-nḥ.t', german: 'der Gefolgsmann Sinuhe.', english: 'the follower, Sinuhe.' },
];

export default function InterlinearExperimentPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Facing Page vs Interlinear"
          subtitle="How should the oldest literature on Earth be read?"
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
          Source Library uses a <strong>facing-page reader</strong>: the original manuscript scan on the left,
          AI translation on the right. This mirrors how scholars have read texts for centuries &mdash;
          the Loeb Classical Library, Bud&eacute; editions, and every bilingual critical edition since Erasmus.
        </p>

        <p>
          But for ancient Near Eastern texts &mdash; Sumerian, Akkadian, Egyptian &mdash; there&apos;s a problem.
          These languages are written in scripts most readers can&apos;t parse visually.
          The scan of a cuneiform tablet or hieratic papyrus doesn&apos;t help you follow along the way
          a Latin or German page does. The visual parallel breaks down.
        </p>

        <p>
          <strong>Interlinear display</strong> solves this differently: instead of image vs text side by side,
          it weaves the original and translation together line by line. You see the transliteration
          (the scholarly romanization) directly above or below the English, aligned to the same poetic structure.
        </p>

        <p>The question: <em>which is better for these texts?</em></p>

        <hr className="my-12 border-stone-200" />

        {/* ===== SECTION 1: Facing Page ===== */}
        <h2>The Facing-Page Approach (current)</h2>

        <p className="text-sm text-stone-500 mb-4">
          How our reader currently displays an ETCSL text. Left panel: scan or placeholder. Right panel: continuous translation.
        </p>

        <div className="border border-stone-200 rounded-lg overflow-hidden my-6">
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-stone-200">
            {/* Left: simulated scan panel */}
            <div className="bg-stone-800 p-6 flex items-center justify-center min-h-[320px]">
              <div className="text-center">
                <div className="text-stone-500 text-xs uppercase tracking-wider mb-2">Source Image</div>
                <div className="bg-stone-700 rounded p-4 max-w-[200px] mx-auto">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="https://cdli.earth/dl/photo/P394444.jpg"
                    alt="Cuneiform tablet K.3514 (Gilgamesh Tablet IX)"
                    className="w-full rounded opacity-90"
                  />
                </div>
                <p className="text-stone-500 text-xs mt-2">K.3514 — Tablet IX</p>
              </div>
            </div>
            {/* Right: translation panel */}
            <div className="bg-white p-6">
              <div className="text-stone-400 text-xs uppercase tracking-wider mb-3">Translation</div>
              <div className="space-y-2 text-sm text-stone-700 leading-relaxed">
                {GILGAMESH_LINES.map((line, i) => (
                  <p key={i}>{line.english}</p>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="text-sm text-stone-500">
          <strong>Strengths:</strong> You see the actual artifact. The translation reads as continuous prose.
          Works for any text with scans. Universal layout.<br />
          <strong>Weakness:</strong> For cuneiform/hieratic, most readers can&apos;t follow along in the scan.
          The poetic structure (parallelism, repetition) is invisible in paragraph form.
        </p>

        <hr className="my-12 border-stone-200" />

        {/* ===== SECTION 2: Interlinear ===== */}
        <h2>The Interlinear Approach</h2>

        <p className="text-sm text-stone-500 mb-4">
          Same text, displayed with transliteration and translation aligned line by line.
          No scan image &mdash; the structure itself becomes the artifact.
        </p>

        {/* Gilgamesh interlinear */}
        <h3>Epic of Gilgamesh, Tablet XI (Akkadian)</h3>
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-6 my-6 space-y-3">
          {GILGAMESH_LINES.map((line, i) => (
            <div key={i} className="pb-3 border-b border-stone-100 last:border-0 last:pb-0">
              <div className="font-mono text-xs text-purple-800 tracking-wide">{line.original}</div>
              <div className="text-stone-800 text-sm mt-0.5">{line.english}</div>
            </div>
          ))}
        </div>

        {/* Shuruppag interlinear */}
        <h3>Instructions of Shuruppag (Sumerian, c. 2600 BCE)</h3>
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-6 my-6 space-y-3">
          {SHURUPPAG_LINES.map((line, i) => (
            <div key={i} className="pb-3 border-b border-stone-100 last:border-0 last:pb-0">
              <div className="font-mono text-xs text-amber-800 tracking-wide">{line.original}</div>
              <div className="text-stone-800 text-sm mt-0.5">{line.english}</div>
            </div>
          ))}
        </div>

        {/* Sinuhe — three-tier */}
        <h3>Tale of Sinuhe (Egyptian, c. 1875 BCE)</h3>
        <p className="text-xs text-stone-500 mb-3">
          Three tiers: transliteration, German (source translation from ORAEC), English.
        </p>
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-6 my-6 space-y-3">
          {SINUHE_LINES.map((line, i) => (
            <div key={i} className="pb-3 border-b border-stone-100 last:border-0 last:pb-0">
              <div className="font-mono text-xs text-emerald-800 tracking-wide">{line.original}</div>
              <div className="text-xs text-stone-400 italic mt-0.5">{line.german}</div>
              <div className="text-stone-800 text-sm mt-0.5">{line.english}</div>
            </div>
          ))}
        </div>

        <p className="text-sm text-stone-500">
          <strong>Strengths:</strong> Poetic structure visible immediately (parallelism in Shuruppag, the anaphora in Gilgamesh).
          Readers can notice patterns in the original even without knowing the language.
          Takes less screen space than facing page. Better on mobile.<br />
          <strong>Weakness:</strong> No connection to the physical artifact. Loses the materiality of clay/papyrus.
          Transliteration may overwhelm casual readers who just want the story.
        </p>

        <hr className="my-12 border-stone-200" />

        {/* ===== SECTION 3: Hybrid ===== */}
        <h2>The Hybrid: Tablet + Interlinear</h2>

        <p className="text-sm text-stone-500 mb-4">
          What if we combine both? Tablet photo on top (or left), interlinear below.
          This is roughly what <Link href="/read/gilgamesh" className="text-secondary hover:underline">/read/gilgamesh</Link> does.
        </p>

        <div className="border border-stone-200 rounded-lg overflow-hidden my-6">
          {/* Tablet photo strip */}
          <div className="bg-stone-800 p-4 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://cdli.earth/dl/photo/P273210.jpg"
              alt="K.3375 — The Flood Tablet (Gilgamesh XI)"
              className="max-h-[200px] rounded shadow-lg"
            />
          </div>
          {/* Interlinear below */}
          <div className="bg-stone-50 p-6 space-y-3">
            <div className="text-[10px] text-stone-400 uppercase tracking-wider mb-2">
              K.3375 &mdash; Tablet XI &mdash; &ldquo;The Flood&rdquo;
            </div>
            {GILGAMESH_LINES.slice(0, 4).map((line, i) => (
              <div key={i} className="pb-2 border-b border-stone-100 last:border-0 last:pb-0">
                <div className="font-mono text-xs text-purple-800 tracking-wide">{line.original}</div>
                <div className="text-stone-800 text-sm mt-0.5">{line.english}</div>
              </div>
            ))}
          </div>
        </div>

        <hr className="my-12 border-stone-200" />

        {/* ===== Observations ===== */}
        <h2>Observations</h2>

        <p>
          <strong>For poetry (most ancient Near Eastern lit), interlinear wins.</strong> The
          parallelism in Shuruppag, the repetition in Gilgamesh &mdash; these are structural features
          that facing-page prose translation erases. Interlinear preserves them naturally.
        </p>

        <p>
          <strong>Facing page still wins for scanned books.</strong> For our 15,000+ books with actual
          manuscript scans (Latin, German, Greek, Arabic), the facing-page layout is ideal.
          The reader CAN follow along in the original. The image carries real information.
        </p>

        <p>
          <strong>The hybrid is best for tablet literature.</strong> Show the artifact (it&apos;s beautiful,
          it&apos;s material, it grounds the text in physical reality), but don&apos;t ask the reader to
          &ldquo;read along&rdquo; in cuneiform. Give them the interlinear below or beside it.
        </p>

        <p>
          <strong>This suggests a rule:</strong> If the original script is readable by the likely audience
          (Latin, Greek, German, Arabic, Hebrew), use facing page. If it&apos;s not (cuneiform, hieratic,
          demotic), use interlinear + artifact photo.
        </p>

        <h3>Next steps</h3>
        <ul>
          <li>Add an interlinear toggle to the reader for ETCSL and ORAEC texts</li>
          <li>Build the <Link href="/read/gilgamesh" className="text-secondary hover:underline">tablet reader</Link> as the hybrid model for Gilgamesh, Enuma Elish, etc.</li>
          <li>Explore word-level alignment: hover a Sumerian word to highlight its English gloss</li>
          <li>Test: does the three-tier (original + German + English) add value, or should we collapse to two?</li>
        </ul>

        <hr className="my-12 border-stone-200" />

        <p className="text-sm text-muted">
          Source texts: <Link href="/book/the-instructions-of-shuruppag" className="text-secondary hover:underline">Instructions of Shuruppag</Link> (ETCSL 5.6.1),{' '}
          <Link href="/book/the-epic-of-gilgamish-thompson" className="text-secondary hover:underline">Epic of Gilgamesh</Link> (Thompson 1930),{' '}
          <Link href="/book/the-eloquent-peasant" className="text-secondary hover:underline">Tale of Sinuhe</Link> (ORAEC).
          Tablet photo: <a href="https://cdli.earth/artifacts/273210" className="text-secondary hover:underline" target="_blank" rel="noopener">CDLI P273210</a> (K.3375, British Museum).
        </p>

      </article>

    </ContentPageLayout>
  );
}
