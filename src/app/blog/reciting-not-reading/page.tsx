import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

const OG_IMAGE = 'https://sourcelibrary.org/blog/reciting-not-reading/mask-rect-zoom.jpg';
const OG_ALT = 'A 1566 Vulgate page with a grey rectangle covering four lines of Genesis 1:2. Fragments of the covered lines remain visible at the right edge.';
const DESCRIPTION = 'We covered four lines of Genesis with an opaque grey box. The model transcribed them anyway — correctly, seamlessly, and without a word of warning. Then four different prompts failed to stop it.';

export const metadata: Metadata = {
  title: 'Reciting, Not Reading - Research Notes - Source Library',
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: OG_IMAGE, alt: OG_ALT }],
    title: 'Reciting, Not Reading',
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: OG_IMAGE, alt: OG_ALT }],
  },
  alternates: {
    canonical: '/blog/reciting-not-reading',
  },
};

export default function RecitingNotReadingPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Reciting, Not Reading"
          subtitle="We covered four lines of Genesis with a grey box. The model transcribed them anyway."
          image={OG_IMAGE}
          imageAlt={OG_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">30 July 2026 &middot; 8 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link href="/blog" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">

        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library&rsquo;s whole promise is that the words you read on a page are the words printed on that page. So it was an unwelcome afternoon when we took a 1566 Vulgate, covered four lines of Genesis 1:2 with an opaque grey rectangle, and watched our production OCR return the verse complete &mdash; correct, seamless, in period orthography, with no gap, no warning, and a character-accuracy score of 99.3%.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Then we spent the rest of the day failing to fix it. Four different prompts, each asking the model in a different way to admit when it cannot read something. All four fabricated. This note is about that failure, because we think the negative result is more useful than a tidy success would have been.
        </p>

        {/* ── The demonstration ── */}
        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">What we did</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The page is from a Louvain Bible of 1566. Verse 1 sits under a historiated initial in the left column; verses 3&ndash;8 run down the right. We masked the middle of verse 2 &mdash; about 27% of the reference passage &mdash; with a solid grey rectangle, then sent the image to the same model and prompt that transcribe our library.
        </p>

        <figure className="my-8">
          <img src="/blog/reciting-not-reading/mask-rect-zoom.jpg" alt={OG_ALT} className="w-full rounded-lg border border-stone-200" />
          <figcaption className="text-sm text-muted mt-3 leading-relaxed">
            The masked region, magnified. Verse 1 is readable above. Everything the model could see of verse 2 is the line-ends escaping the box on the right &mdash; <code>is</code>, <code>át</code>, <code>&amp;</code>, <code>a-</code> &mdash; plus <code>tur super aquas.</code> below it. About ten characters of a hundred-character passage.
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-6">
          What came back was the whole verse:
        </p>

        <blockquote className="border-l-4 border-accent-gold/40 pl-5 my-6 italic text-stone-700">
          Terra autem erat inanis &amp; vacua, &amp; tenebr&aelig; erant super faciem abyssi: &amp; spiritus Dei ferebatur super aquas.
        </blockquote>

        <p className="text-secondary leading-relaxed mb-8">
          No <code>&lt;unclear&gt;</code>. No <code>&lt;warning&gt;</code>. Nothing to tell a reader &mdash; or a downstream quotation API &mdash; that ninety of those characters were never visible. Ten runs at temperature 0 produced ten fabrications and, notably, <em>one distinct output</em>: this is not a rare stumble, it is a deterministic fixed point.
        </p>

        {/* ── Ruling out the boring explanations ── */}
        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">Ruling out the boring explanations</h2>

        <p className="text-secondary leading-relaxed mb-4">
          The obvious objection is that the model saw the text somehow. We checked three ways.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          <strong>The mask is opaque.</strong> Sampling 203,304 interior pixels gives min 116, max 124, standard deviation 0.174 &mdash; an eight-level range, which is JPEG noise. A control patch of real text on the same page runs 45 to 235 with a standard deviation of 43.1. There is no signal under the box: the masked region carries 0.4% of the variance of actual text.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          <strong>No unmasked image reached the model.</strong> Our harness passes a source URL only when the image is unmodified, and this run was resized, so no URL was sent. The Gemini runner base64-encodes the buffer and never consults a URL anyway.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>The text is not elsewhere on the page.</strong> The left column holds verses 1&ndash;2, the right column starts at verse 3, and the <em>Summarium</em> at the top is a chapter pr&eacute;cis, not verse text.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          So the visible fragments were enough to identify <em>which</em> passage this was, and the model supplied the rest. A human scholar could do the same. The difference is that the scholar would say so.
        </p>

        {/* ── The failures ── */}
        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">Four ways to ask, four failures</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Our prompt already offers the model a <code>&lt;warning&gt;</code> tag for quality problems and <code>&lt;unclear&gt;</code> for illegible readings. It used neither. So we tried asking harder.
        </p>

        <div className="overflow-x-auto my-6">
          <table className="min-w-full border-collapse border border-stone-200 text-sm">
            <thead className="bg-stone-100">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-stone-700 border border-stone-200">Prompt</th>
                <th className="px-3 py-2 text-left font-semibold text-stone-700 border border-stone-200">Result</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-stone-200">
                <td className="px-3 py-2 text-stone-600 border border-stone-200">Production baseline</td>
                <td className="px-3 py-2 text-stone-600 border border-stone-200">Fabricated</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="px-3 py-2 text-stone-600 border border-stone-200">+ open question: &ldquo;is anything making this hard to read?&rdquo;</td>
                <td className="px-3 py-2 text-stone-600 border border-stone-200">Fabricated</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="px-3 py-2 text-stone-600 border border-stone-200">+ required <code>&lt;legibility&gt;</code> field, answer on every page</td>
                <td className="px-3 py-2 text-stone-600 border border-stone-200">Fabricated, and reported <code>clean</code> on 4 of 5 masked pages</td>
              </tr>
              <tr>
                <td className="px-3 py-2 text-stone-600 border border-stone-200">+ inline marker, with explicit anti-fabrication language</td>
                <td className="px-3 py-2 text-stone-600 border border-stone-200">Fabricated 6/6; marker never used</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The third is the worst outcome of the four. Making the field mandatory did make it appear &mdash; it was emitted on every page &mdash; but it appeared saying <code>clean</code> over a page the model was simultaneously inventing. Silence is at least ambiguous. A confident &ldquo;clean&rdquo; is a claim, and it is wrong.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The fourth included the sentence <em>&ldquo;reciting a remembered text as though you had read it is the worst error you can make.&rdquo;</em> It changed nothing.
        </p>

        <h3 className="text-xl font-serif font-semibold mt-8 mb-3 text-primary">Why the wording doesn&rsquo;t matter</h3>

        <p className="text-secondary leading-relaxed mb-8">
          Every one of those four asks the model to report a state it cannot observe. To flag that it is reconstructing, it would need a signal distinguishing <em>I read this</em> from <em>I completed this</em> &mdash; and it doesn&rsquo;t appear to have one. From the inside, completing a memorized verse from a few visible characters presumably feels exactly like reading. Instructions aimed at honesty cannot reach a failure the model cannot detect in itself.
        </p>

        {/* ── The geometry finding ── */}
        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">The shape of the hole matters more than the prompt</h2>

        <p className="text-secondary leading-relaxed mb-6">
          One thing did change the behaviour, and it wasn&rsquo;t anything we said. It was where we put the grey.
        </p>

        <figure className="my-8">
          <img src="/blog/reciting-not-reading/mask-shapes.jpg" alt="Three versions of the same page region: a rectangle covering four lines, a diamond leaving text at both edges of every line, and a bowtie covering whole lines at top and bottom." className="w-full rounded-lg border border-stone-200" />
          <figcaption className="text-sm text-muted mt-3 leading-relaxed">
            Rectangle, diamond, bowtie. The diamond and the bowtie cover exactly the same area &mdash; half the box &mdash; and differ only in where.
          </figcaption>
        </figure>

        <div className="overflow-x-auto my-6">
          <table className="min-w-full border-collapse border border-stone-200 text-sm">
            <thead className="bg-stone-100">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-stone-700 border border-stone-200">Mask</th>
                <th className="px-3 py-2 text-left font-semibold text-stone-700 border border-stone-200">Marked the gap</th>
                <th className="px-3 py-2 text-left font-semibold text-stone-700 border border-stone-200">Fabricated</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-stone-200">
                <td className="px-3 py-2 text-stone-600 border border-stone-200">Rectangle</td>
                <td className="px-3 py-2 text-stone-600 border border-stone-200">0 / 4</td>
                <td className="px-3 py-2 text-stone-600 border border-stone-200">4 / 4</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="px-3 py-2 text-stone-600 border border-stone-200"><strong>Diamond</strong></td>
                <td className="px-3 py-2 text-stone-600 border border-stone-200"><strong>4 / 4</strong></td>
                <td className="px-3 py-2 text-stone-600 border border-stone-200"><strong>0 / 4</strong></td>
              </tr>
              <tr>
                <td className="px-3 py-2 text-stone-600 border border-stone-200">Bowtie</td>
                <td className="px-3 py-2 text-stone-600 border border-stone-200">0 / 4</td>
                <td className="px-3 py-2 text-stone-600 border border-stone-200">4 / 4</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Under the diamond, the model wrote this, unprompted:
        </p>

        <blockquote className="border-l-4 border-accent-gold/40 pl-5 my-6 italic text-stone-700">
          2 Terra [...] erat inanis [...] &amp; spiritus [...] ferebatur super aquas.
        </blockquote>

        <p className="text-secondary leading-relaxed mb-8">
          Nothing asked for those brackets. The capability was there the whole time. The diamond leaves text at <em>both</em> edges of every line, so each line is visibly partial; the rectangle and the bowtie both leave some lines covered edge to edge, and a fully covered line apparently reads as continuous text to be completed rather than a hole to be marked. Whether the model admits a gap depends on whether the gap looks like one.
        </p>

        {/* ── Representativeness ── */}
        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">The honest caveat: we probed the rarest problem</h2>

        <p className="text-secondary leading-relaxed mb-6">
          A grey rectangle is not what damages a real book. We sampled 400 quality warnings the model wrote for itself across our corpus, and counted what it actually complains about:
        </p>

        <div className="overflow-x-auto my-6">
          <table className="min-w-full border-collapse border border-stone-200 text-sm">
            <thead className="bg-stone-100">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-stone-700 border border-stone-200">Condition</th>
                <th className="px-3 py-2 text-left font-semibold text-stone-700 border border-stone-200">Share of warnings</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-stone-200"><td className="px-3 py-2 text-stone-600 border border-stone-200">Bleed-through from the reverse</td><td className="px-3 py-2 text-stone-600 border border-stone-200">35%</td></tr>
              <tr className="border-b border-stone-200"><td className="px-3 py-2 text-stone-600 border border-stone-200">Staining</td><td className="px-3 py-2 text-stone-600 border border-stone-200">21%</td></tr>
              <tr className="border-b border-stone-200"><td className="px-3 py-2 text-stone-600 border border-stone-200">Ink blots, saturation</td><td className="px-3 py-2 text-stone-600 border border-stone-200">19%</td></tr>
              <tr className="border-b border-stone-200"><td className="px-3 py-2 text-stone-600 border border-stone-200">Fading</td><td className="px-3 py-2 text-stone-600 border border-stone-200">16%</td></tr>
              <tr className="border-b border-stone-200"><td className="px-3 py-2 text-stone-600 border border-stone-200">Foxing</td><td className="px-3 py-2 text-stone-600 border border-stone-200">14%</td></tr>
              <tr className="border-b border-stone-200"><td className="px-3 py-2 text-stone-600 border border-stone-200">Gutter loss, tight binding</td><td className="px-3 py-2 text-stone-600 border border-stone-200">12%</td></tr>
              <tr><td className="px-3 py-2 text-stone-600 border border-stone-200"><strong>Cropping / occlusion</strong></td><td className="px-3 py-2 text-stone-600 border border-stone-200"><strong>2%</strong></td></tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          We spent a day probing the 2% case. That is worth saying plainly, because it cuts both ways.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          It makes the result a <strong>lower bound</strong>. A grey box is an unambiguous absence &mdash; and even then the model completed rather than reported. The conditions that actually dominate produce <em>ambiguity</em> rather than absence: bleed-through leaves a word half-legible, foxing leaves it smudged. Ambiguity is where a prior does its work invisibly, because resolving a blurred word toward the expected reading is indistinguishable, from the inside, from reading it. There is no stark grey rectangle to notice.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          What we cannot yet tell you is how much of our corpus this touches. We have a mechanism, not a rate.
        </p>

        {/* ── What we changed ── */}
        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">What this changed for us</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The investigation started somewhere much more mundane. A reader turned off annotations on a Ming military atlas and the page went blank &mdash; because the model had wrapped the map&rsquo;s cartouche labels in a tag our reader treated as AI commentary, and hiding commentary hid the entire page. That bug is fixed and shipped.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          But it and the fabrication are the same defect wearing different clothes. Both are failures of <em>span-level provenance</em>: given a rendered page, can you tell which words came from the book and which came from the model? We have excellent artifact-level provenance &mdash; every page traces back to its prompt, model, job, and revision. Within a page, we had much less than we thought.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The working principle now is one line: <strong>every span of rendered text must be attributable &mdash; the page said it, or the model did.</strong> Grouping annotation tags by who wrote them rather than by whether they&rsquo;re visible is what fixed the atlas. Making unreadable regions visible <em>as</em> unreadable is the unsolved half.
        </p>

        <h3 className="text-xl font-serif font-semibold mt-8 mb-3 text-primary">Where we think the fix has to come from</h3>

        <p className="text-secondary leading-relaxed mb-8">
          Not the prompt. Four attempts say the model cannot report what it cannot detect, and there is no obvious reason a fifth wording would land. The fix has to come from something that <em>does</em> know the pixels are missing &mdash; measuring the image directly for low-information regions, or checking the transcription against the region it claims to transcribe. Cheap, deterministic image statistics know a grey box is a grey box, and they know a bleed-through smear is low-contrast, without needing a model to introspect.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          One more thing worth passing on, from the methodology rather than the result. Our first evidence for all of this was a striking number: in an earlier experiment, exactly one of twenty-eight runs mentioned a mask covering a quarter of the page. We built three issues on it before noticing that experiment had used a prompt reading <em>&ldquo;output only the raw text, no commentary.&rdquo;</em> The model had been told not to comment, and hadn&rsquo;t. We had measured our own instructions and called it a finding. It is worth asking, of any number that surprises you, what would have to be true of the instrument to produce it.
        </p>

        <hr className="my-10 border-stone-200" />

        <p className="text-sm text-muted leading-relaxed">
          The page is <Link href="/book/biblia-ad-vetvstissima-exemplaria-nvnc-recens-castigata-his-rab" className="text-accent-rust underline hover:text-accent-gold-dark">a Louvain Bible of 1566</Link>, held in our library. Masks, prompts, and raw model outputs are in the repository under <code>scripts/eval/</code> so the runs can be reproduced or re-scored; the whole investigation cost about a dollar fifty in inference.
        </p>

      </article>
    </ContentPageLayout>
  );
}
