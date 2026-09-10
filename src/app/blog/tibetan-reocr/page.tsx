import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

// ─────────────────────────────────────────────────────────────────────────────
// DRAFT. Every value in DATA marked `pending` is a placeholder for a number the
// #4523 quality pass has not produced yet. The page renders a draft banner and
// `[pending]` markers while any remain. Do NOT add this post to the /blog index
// (src/app/blog/page.tsx) or flip DRAFT to false until every field is filled
// from /root/tibetan-reocr/quality-report-*.md and issue #4523.
// ─────────────────────────────────────────────────────────────────────────────
const DRAFT = true;

const pending = '[pending]';
const DATA = {
  // Settled (issue #4523, comments of 2026-09-01 → 2026-09-10)
  cohortBooks: '735',
  cohortPages: '181,277',
  lowresBooks: '704',
  lowresPages: '95,177',
  tibetanOcrPages: '293,490',
  tibetanTranslatedPages: '277,680',
  glotocrAcc5: '19%',
  glotocrScriptAcc: '100%',
  crossScriptRate: '68.4%',
  pilotTitle: 'Neyphug Kanjur rGyud Kha',
  pilotId: '69e7abd05f1a22ab19a9e929',
  pilotServe: '511',
  pilotCanon: '71',
  pilotMark: '64',
  perturbHold: '33 to 37 of 38',
  sampleBimodalLow: '36%',
  sampleBimodalHigh: '43%',
  // Pending: filled by the quality pass
  finalServe: pending,
  finalMark: pending,
  finalTextless: pending,
  finalBooks: pending,
  oldIdentityMedian: pending,
  newIdentityMedian: pending,
  oldAbove07: pending,
  newAbove07: pending,
  alignedPages: pending,
  distinctToh: pending,
  pagesWith84000: pending,
  controlNoise05: pending,
  computeEur: pending,
  computeCoreHours: pending,
  retransCostUsd: pending,
  judgeFidelityOld: pending,
  judgeFidelityNew: pending,
  judgeFabricationOld: pending,
  judgeFabricationNew: pending,
};

const OG_IMAGE = `https://images.sourcelibrary.org/archived/${DATA.pilotId}/3.jpg`;
const OG_ALT = 'A folio of the Neyphug Kanjur, a seventeenth-century Bhutanese manuscript canon, photographed by the Endangered Archives Programme. Black dbu-can script on brown paper, red rubrics at the margin.';
const DESCRIPTION = 'Our transcriptions of 180,000 pages of Bhutanese manuscripts were fluent, consistent, and largely invented. We replaced them with a specialist model, checked the result against the Derge canon, and withheld every page we could not verify.';

export const metadata: Metadata = {
  title: 'Marked Unreadable - Research Notes - Source Library',
  description: DESCRIPTION,
  robots: DRAFT ? { index: false, follow: false } : undefined,
  openGraph: {
    images: [{ url: OG_IMAGE, alt: OG_ALT }],
    title: 'Marked Unreadable',
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: OG_IMAGE, alt: OG_ALT }],
  },
  alternates: {
    canonical: '/blog/tibetan-reocr',
  },
};

function Pending({ v }: { v: string }) {
  if (v !== pending) return <>{v}</>;
  return <span className="bg-amber-100 text-amber-800 px-1 rounded font-mono text-sm">[pending]</span>;
}

export default function TibetanReocrPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Marked Unreadable"
          subtitle="We replaced the transcription of 180,000 manuscript pages, and took down the ones we could not verify."
          image={OG_IMAGE}
          imageAlt={OG_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">September 2026 &middot; 10 min read</p>
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

      {DRAFT && (
        <div className="mb-8 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Draft.</strong> Numbers marked <span className="font-mono">[pending]</span> are waiting on the quality pass in issue #4523. Not listed on the blog index; not indexed by search engines.
        </div>
      )}

      <article className="prose-content max-w-none">

        <p className="text-xl text-secondary leading-relaxed mb-8">
          For most of this year, Source Library served transcriptions of about {DATA.tibetanOcrPages} pages of Tibetan manuscripts, and English translations of {DATA.tibetanTranslatedPages} of them. The text read well. It was consistent from run to run. On the pages where we can now check it against the canon the manuscripts copy, most of it was not what the page says.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          This note is about how we found that out, what we replaced the text with, how we decided which pages we could not vouch for, and what a reader now sees on those pages: nothing but the scan. We think the last part is the most important thing we have shipped for this collection.
        </p>

        {/* ── The collection ── */}
        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">The manuscripts</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The British Library&rsquo;s Endangered Archives Programme photographed the manuscript libraries of several Bhutanese temples and monasteries: Thadrak, Neyphug, Tshamdrak, Phurdrup Gonpa, Gangtey, Drametse, and others. Most of what they hold is the Kanjur, the Tibetan Buddhist canon, copied by hand in the seventeenth and eighteenth centuries. A Kanjur is a hundred-odd volumes; a volume is several hundred long, narrow folios; each temple has its own copy. We imported the scans and ran them through the same pipeline as everything else in the library.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          That pipeline uses a general-purpose vision model. It reads Latin, Greek, German, Hebrew and Chinese well enough that we have built a library on it. In <Link href="/blog/tibetan-ocr" className="text-accent-rust underline hover:text-accent-gold-dark">April</Link> we benchmarked it on these manuscripts and reported that it was consistent across runs. We took consistency as a proxy for accuracy. That was the mistake this note is about.
        </p>

        {/* ── The finding ── */}
        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">Consistent, and wrong</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The first sign was a script. Reviewing pages by hand, we found folios where the transcription was in Devanagari, the script of Sanskrit and Hindi, when the page in front of us was plainly Tibetan. Not a stray character: whole pages. The model had looked at a Tibetan manuscript and produced a plausible Sanskrit one.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          A published benchmark had already measured this. GlotOCR Bench, which tests OCR across a hundred-odd scripts, scores our production model at {DATA.glotocrScriptAcc} on identifying Tibetan as Tibetan and {DATA.glotocrAcc5} on actually reading it, on clean printed text. Handwriting is harder than print. It also measured a cross-script substitution rate of {DATA.crossScriptRate} across low-resource scripts, with Devanagari the most common substitute. We had the substitution on our pages and the paper had the rate; we just had not put them together.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Telling the model the language fixed the script. It did not fix the reading. When we named the language in the prompt, every page came back in Tibetan characters, and two runs of the same page agreed with each other about a third of the time. On printed Tibetan the same test gives close to ninety percent. The model was producing Tibetan-shaped text, fluently, from a page it could not read. Our April consistency metric had not caught this because a model that fabricates fluently does so consistently. The metric measures garbling. It does not measure invention. We have written about this failure mode before, for <Link href="/blog/reciting-not-reading" className="text-accent-rust underline hover:text-accent-gold-dark">Latin</Link>; here it was the whole collection.
        </p>

        {/* ── Ground truth ── */}
        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">The canon as an answer key</h2>

        <p className="text-secondary leading-relaxed mb-6">
          What makes this collection unusual is that most of it is a copy of a known text. The Derge Kangyur, the eighteenth-century woodblock edition that scholars treat as the reference, exists as a corrected digital text, published openly by Esukhia. A Bhutanese manuscript Kanjur is a different witness of the same canon, with its own variants, but a real transcription of a folio should align to the corresponding Derge passage at high identity, and an invented one should align at chance. That gives us something the rest of the library rarely has: an answer key.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We built an index over the Derge text and, for each transcribed page, retrieved the best-matching window and scored syllable identity with a standard sequence alignment. On <Pending v={DATA.alignedPages} /> pages of the new transcription that reach a Derge passage, median identity is <Pending v={DATA.newIdentityMedian} />. The old transcription of the same pages scores <Pending v={DATA.oldIdentityMedian} />. Above the 0.7 line that we treat as a confirmed reading, the new text has <Pending v={DATA.newAbove07} /> pages and the old text has <Pending v={DATA.oldAbove07} />. A five-percent-noised copy of the true Derge page, our positive control, scores <Pending v={DATA.controlNoise05} />, so the instrument can tell a good read from a perfect one.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The ceiling matters. A Bhutanese witness against Derge tops out near 0.9 even for a flawless read, because the witnesses genuinely differ. So we report bands, not a single error rate, and we say &ldquo;confirmed against canon&rdquo; rather than &ldquo;correct.&rdquo;
        </p>

        {/* ── The replacement ── */}
        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">A specialist, not a bigger generalist</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The fix was not a better prompt or a more expensive frontier model. The Buddhist Digital Resource Center publishes an open-source OCR stack built for exactly this material: line segmentation and recognition models trained on Tibetan woodblock prints and on handwritten dbu-can, the formal &ldquo;headed&rdquo; script most of these Kanjurs are written in. The models are small, run on ordinary CPUs, and report line-level character error rates under one percent on their own test sets.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We ran two of those models, the woodblock one and the dbu-can one, over every page independently. Where the two agree at or above 0.70 syllable identity, or where either read aligns to the Derge canon at 0.60 or better, we serve the transcription. Where they disagree, we do not. The disagreement rate is not noise: it is bimodal. In an early sample of fourteen thousand pages, {DATA.sampleBimodalLow} of text pages agreed below 0.2 and {DATA.sampleBimodalHigh} above 0.8, with almost nothing between. The low mode is dbu-med, the cursive script, which neither model was trained for and which our previous model had been transcribing with the same fluent confidence as everything else.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We checked that the verdicts are stable. Forty random pages, re-read from the master image under three perturbations, a JPEG recompression, a pixel shift, and a downscale to 2400 pixels wide: {DATA.perturbHold} verdicts held. Re-running the same page through the same model gives identical text on 39 of 40. The decision to serve or withhold a page does not hinge on a coin flip.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The whole re-read cost about <Pending v={DATA.computeEur} /> in rented compute, roughly <Pending v={DATA.computeCoreHours} /> core-hours across four servers over a few days. Re-running the same pages through our previous model would have cost around $230 and bought nothing.
        </p>

        {/* ── The pilot ── */}
        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">One book, start to finish</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The first volume through the full lane was the <Link href={`/book/${DATA.pilotId}`} className="text-accent-rust underline hover:text-accent-gold-dark">{DATA.pilotTitle}</Link>, a tantra volume of 576 folios. Of those, {DATA.pilotServe} pages were served, {DATA.pilotCanon} of them confirmed by alignment to the Derge text, {DATA.pilotMark} were marked unreadable, and one was blank. Its {DATA.pilotServe} served pages were then retranslated from the new transcription. If you open a marked page, you get the scan and a sentence saying we could not read it reliably. There is no transcription pane and no translation pane, because a translation of text we do not trust is not a translation.
        </p>

        <figure className="my-8">
          <img src={`https://images.sourcelibrary.org/archived/${DATA.pilotId}/3.jpg`} alt={OG_ALT} className="w-full rounded-lg border border-stone-200" />
          <figcaption className="text-sm text-muted mt-3 leading-relaxed">
            Folio 3 of the {DATA.pilotTitle}. The manuscript is in dbu-can, the script the specialist models were built for. Photograph: Endangered Archives Programme, EAP310.
          </figcaption>
        </figure>

        {/* ── Totals ── */}
        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">What changed on the site</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Across the {DATA.cohortBooks} volumes with full-resolution masters, {DATA.cohortPages} pages: <Pending v={DATA.finalServe} /> pages now carry a transcription that two independent models agree on or the canon confirms; <Pending v={DATA.finalMark} /> pages are marked unreadable and show only the scan; <Pending v={DATA.finalTextless} /> are blank leaves. The old transcription and translation of every page is retained as a revision, so nothing is destroyed, but nothing we could not verify is served.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          A second cohort of {DATA.lowresBooks} volumes, {DATA.lowresPages} pages, exists online only as 1536-pixel derivatives. The perturbation test says about two thirds of serve-quality pages still clear the bar at that resolution, so we ran them too, and we are asking the British Library whether the deposited masters can be made available. Those pages carry the same verdict machinery and a lower serve rate.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The pages that aligned to Derge map onto <Pending v={DATA.distinctToh} /> distinct canonical texts. For <Pending v={DATA.pagesWith84000} /> of those pages, 84000, the project translating the Kanjur into English, has published a scholarly translation. That gives us something we have never had for a translation at this scale: a human reference.
        </p>

        {/* ── Translation ── */}
        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">Translating the real text</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Every served page is being retranslated from the new transcription, at a cost of about <Pending v={DATA.retransCostUsd} /> for the cohort. To measure whether the new translations are better, and not just different, we took one page per book from the set with an 84000 reference and had a blind judge score the old and new translations for fidelity against the human one, without knowing which was which. On a five-point fidelity scale the old translations score <Pending v={DATA.judgeFidelityOld} /> and the new ones <Pending v={DATA.judgeFidelityNew} />. The judge flagged invented content, passages with no counterpart in the reference, on <Pending v={DATA.judgeFabricationOld} /> of old pages and <Pending v={DATA.judgeFabricationNew} /> of new ones.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The same texts appear in two, three or four of the temple Kanjurs. Two scans, two independent reads, two translations of one sutra: where they disagree, the disagreement points at a page, and that is where we look next.
        </p>

        {/* ── What we learned ── */}
        <h2 className="text-2xl font-serif font-bold mt-12 mb-4 text-primary">What we would tell another library</h2>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Consistency is not accuracy.</strong> A model that invents fluently invents the same thing twice. Agreement between runs of one model measures garbling. Agreement between two models trained on different data measures something closer to reading, and alignment to an independent text measures reading itself. Use the strongest instrument the material allows, and for canonical material the canon is the instrument.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>The script benchmarks were right and we did not look.</strong> Every number we needed was in a published paper before we imported the first volume. A model that scores 19% on a script should not be the default for that script, and &ldquo;it looks fine&rdquo; from someone who cannot read the script is not a review.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Withholding is a feature.</strong> The honest state of a page we cannot read is the scan alone, with a sentence saying so. We had no such state before this work. Every page had a transcription pane, and the pane was full. Building the empty state, and the verdict that fills it, was more valuable than any single improvement in the text.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong>Specialists beat generalists on their own ground, by a lot, for almost nothing.</strong> The models that fixed this are free, open, and run on a laptop. The frontier model was the expensive wrong tool. We expect this to be true for other low-resource scripts in the library, and we are checking.
        </p>

        <hr className="my-10 border-stone-200" />

        <p className="text-sm text-muted leading-relaxed">
          The manuscripts are held by the temples and photographed by the British Library&rsquo;s <a href="https://eap.bl.uk/project/EAP310" className="text-accent-rust underline hover:text-accent-gold-dark">Endangered Archives Programme</a>. OCR models are the <a href="https://github.com/buda-base/tibetan-ocr-app" className="text-accent-rust underline hover:text-accent-gold-dark">Buddhist Digital Resource Center&rsquo;s</a>. The Derge reference text is <a href="https://github.com/Esukhia/derge-kangyur" className="text-accent-rust underline hover:text-accent-gold-dark">Esukhia&rsquo;s</a>; the English references are <a href="https://84000.co" className="text-accent-rust underline hover:text-accent-gold-dark">84000&rsquo;s</a>, used here for evaluation only under their non-commercial licence. Verdict files, the adjudication script, and the alignment index are described in issue #4523 of our public repository so the runs can be re-scored.
        </p>

      </article>
    </ContentPageLayout>
  );
}
