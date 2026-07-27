import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'The Fish-Voiced Priest - Research Notes - Source Library',
  description:
    'An AI read a tenth-century Greek hand and invented a character who is not on the page. Why, for a hard script, the printed critical edition has to carry the text and the manuscript carries the facsimile.',
  openGraph: {
    title: 'The Fish-Voiced Priest',
    description:
      'Reading the Codex Marcianus with AI: the model rendered Zosimos fluently and fabricated a speaker. The fix is 140 years old — a critical edition, not a better OCR pass.',
    images: [
      {
        url: 'https://images.sourcelibrary.org/manuscripts/marciana-gr-299/208.jpg',
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/manuscripts/marciana-gr-299/208.jpg' }],
  },
  alternates: {
    canonical: '/blog/fish-voiced-priest',
  },
};

export default function FishVoicedPriestPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Fish-Voiced Priest"
          subtitle="An AI read a thousand-year-old Greek hand and invented a character. Why the edition, not the manuscript, has to carry the text."
          image="https://images.sourcelibrary.org/manuscripts/marciana-gr-299/208.jpg"
          imageAlt="Folio 93 recto of the Codex Marcianus gr. Z. 299, in tenth-century Greek minuscule"
        >
          <p className="text-stone-400 text-sm mt-4">2 July 2026 &middot; 11 min read</p>
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
          A scribe in tenth-century Constantinople copied out a dream. A priest stands on an altar shaped like a
          flask; a voice describes being torn apart with a knife and reassembled as spirit. It is one of the strangest
          passages in the Greek alchemical corpus &mdash; the visions of Zosimos of Panopolis. When we asked a modern
          AI to read the page, it rendered the scene fluently, in confident English, and introduced a character who is
          not there.
        </p>

        {/* --- Two sentences --- */}
        <h2 id="two-sentences" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Two sentences, one folio
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Below are two English translations of the same six lines of Greek, from the same page &mdash; folio 93 recto
          of the <em>Codex Marcianus graecus</em> Z. 299, the manuscript that carries the Corpus of the Greek
          Alchemists. On the left is the reading printed in the standard critical edition. On the right is what our
          own pipeline produced when it transcribed the manuscript directly and translated its own transcription.
        </p>

        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* Edition reading */}
          <div className="border border-green-100 rounded-lg overflow-hidden">
            <div className="bg-green-50/60 px-4 py-2 border-b border-green-100">
              <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">The critical edition</p>
              <p className="text-xs text-green-600">Berthelot &amp; Ruelle, transcribed from this manuscript</p>
            </div>
            <div className="p-4 text-sm text-secondary leading-relaxed italic">
              &ldquo;I am Ion, the priest of the inner sanctuaries, and I endure an unbearable force. For someone came
              at dawn, running swiftly, and mastered me, and with a blade he divided me, and tore me apart according
              to the arrangement of harmony.&rdquo;
            </div>
          </div>

          {/* Raw OCR reading */}
          <div className="border border-red-200 rounded-lg overflow-hidden">
            <div className="bg-red-50/60 px-4 py-2 border-b border-red-200">
              <p className="text-xs font-semibold text-red-800 uppercase tracking-wide">The AI reading the manuscript</p>
              <p className="text-xs text-red-600">Full-quality OCR of the minuscule hand</p>
            </div>
            <div className="p-4 text-sm text-secondary leading-relaxed italic">
              &ldquo;&hellip;the fish-voiced one answered me, saying: Leave me be, O priest, I who am the
              honey-sweetened one; and he left behind an unbearable, hated thing. For someone came running near dawn
              and tore me apart with a knife, dividing all my limbs according to the order of harmony.&rdquo;
            </div>
          </div>
        </div>

        <p className="text-xs text-muted mb-8">
          Sources, verbatim:{' '}
          <Link href="/book/collection-des-anciens-alchimistes-grecs-vols-2-3-berthelot/page/6994383a6879ff0184cb8048" className="text-accent-rust hover:underline">
            Berthelot &amp; Ruelle, <em>Collection des anciens alchimistes grecs</em> (1887), p. 14 &rarr;
          </Link>{' '}
          &middot;{' '}
          <Link href="/book/marcianus-graecus-299-greek-alchemists/page/6a45298cc6d95bc278fbc993" className="text-accent-rust hover:underline">
            <em>Marcianus gr. Z. 299</em>, folio 93r &rarr;
          </Link>
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          One of these says the speaker is a priest named Ion. The other says he is a fish-voiced one who wants to be
          left alone. They cannot both be reading the same words, and only one of them is. The name of the speaker
          &mdash; the whole point of the sentence &mdash; is simply gone from the right-hand column.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The divergence turns on a single misread word. Where the edition reads <span lang="el">&#7984;&#963;&#967;&#957;&#959;&#966;&#974;&#957;&#969;&#962;</span>{' '}
          &mdash; <em>ischnoph&#333;n&#333;s</em>, &ldquo;in a thin voice,&rdquo; describing <em>how</em> the priest
          answered &mdash; the OCR saw <span lang="el">&#7984;&#967;&#952;&#965;&#972;&#966;&#969;&#957;&#959;&#962;</span>,{' '}
          <em>ichthyoph&#333;nos</em>, &ldquo;fish-voiced.&rdquo; From that one slip the sentence unravels:{' '}
          <span lang="el">&#7952;&#947;&#974; &#949;&#7984;&#956;&#953; &#8001; &#7992;&#969;&#957;</span>{' '}
          (&ldquo;I am Ion&rdquo;) dissolves into <span lang="el">&#7940;&#966;&#949;&#962; &#956;&#949; &#8001; &#7952;&#956;&#8050;</span>{' '}
          (&ldquo;leave me be, O me&rdquo;). A proper noun becomes a plea. The English on both sides reads perfectly;
          only one side reads the page.
        </p>

        {/* --- The hand --- */}
        <h2 id="the-hand" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The hand that interpolates
        </h2>

        <div className="mb-6">
          <p className="text-xs text-muted mb-2 uppercase tracking-wide">The page in question &mdash; folio 93r</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.sourcelibrary.org/manuscripts/marciana-gr-299/208.jpg"
            alt="Folio 93 recto of the Codex Marcianus, dense tenth-century Greek minuscule with abbreviations"
            className="w-full max-w-lg rounded border border-light"
            loading="lazy"
          />
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          Look at the hand. This is tenth- or eleventh-century Greek minuscule: a fast, ligatured, heavily abbreviated
          book script where letters flow into one another and a single stroke can carry a whole syllable. And look at
          what the model has to read it from. The best public scan of this codex &mdash; from Internet Culturale, the
          digitization we and everyone else rely on &mdash; is about 892&nbsp;&times;&nbsp;1143 pixels for the{' '}
          <em>entire</em> two-column folio. That is low: perhaps a third of the linear resolution you would want for a
          hand this dense, an order of magnitude fewer pixels per character. Between the script and the pixels, this is
          exactly the kind of surface on which a modern vision model stops reading and starts guessing &mdash; and the
          guesses come out fluent. A model trained on oceans of Greek will always produce something that{' '}
          <em>looks</em> like a plausible sentence, whether or not it matches the ink.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          You can measure the guessing without any answer key. A faithful transcriber is deterministic: give it the
          same page twice, get the same letters twice. So we transcribed all 393 text pages of the Marcianus twice,
          with the same model on the same images, and compared the runs. They agreed with themselves only about{' '}
          <strong>62% of the time</strong> at the level of individual Greek words &mdash; the model disagrees with its
          own reading of roughly a third of the page every time it looks. (That figure is the Greek text alone; the
          editorial tags are stripped out before the comparison, and they in fact agree rather more &mdash; the
          instability is in the transcription, not the markup.) That is not the profile of a machine reading letters;
          it is the profile of a machine interpolating text. We have{' '}
          <Link href="/blog/ocr-consistency" className="text-accent-rust hover:underline">written before</Link>{' '}
          about why self-consistency is a floor on error and not a measure of accuracy &mdash; on clean printed pages
          it runs above 98%; here it collapses.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          One honest caveat: that number cannot tell the two causes apart. A hard script and an under-resolved image
          both push a model from reading toward guessing, and self-agreement measures the guessing without saying how
          much is the hand and how much is the pixels. It is very likely both. What matters for a reader is that the
          instability is real at the resolution we can actually obtain &mdash; and higher-resolution scans of this
          particular codex are not publicly available. That is not a limit a better model removes. It is one the
          edition removes.
        </p>

        {/* --- The tell --- */}
        <h2 id="a-footnote" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          A footnote to a fabrication
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The unsettling part is not the error. It is the poise. Beside its invented &ldquo;fish-voiced one,&rdquo;
          the model added a small, scholarly-sounding note explaining the word it had just misread:
        </p>

        <blockquote className="border-l-2 border-accent-rust/30 pl-6 my-8">
          <p className="text-secondary leading-relaxed italic font-body">
            &ldquo;<span lang="el">ichthyophonos</span>,&rdquo; likely referring to a silent or aquatic-themed initiate.
          </p>
          <p className="text-xs text-muted mt-2 not-italic">
            <Link href="/book/marcianus-graecus-299-greek-alchemists/page/6a45298cc6d95bc278fbc993" className="text-accent-rust hover:underline">
              from the pipeline&rsquo;s own annotation of folio 93r &rarr;
            </Link>
          </p>
        </blockquote>

        <p className="text-secondary leading-relaxed mb-6">
          There is no fish. The model misread one letter, produced a word that does not belong in the sentence, and
          then reasoned confidently about what its own mistake might mean &mdash; an &ldquo;aquatic-themed
          initiate.&rdquo; Fluent, footnoted, and wrong. This is the pattern we have named elsewhere the{' '}
          <Link href="/blog/confident-hallucinator" className="text-accent-rust hover:underline">confident hallucinator</Link>:
          the danger is never that the output looks broken. It is that it looks finished. The same failure mode, one
          layer down, is what turns a garbled Greek line into a{' '}
          <Link href="/blog/did-the-ai-read-this" className="text-accent-rust hover:underline">confidently mistranslated</Link>{' '}
          English one.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          To be fair to the machine: this is a dense, allegorical, narrative folio, the hardest thing in the book.
          On display script, recipe headings, and diagram labels the same model is nearly flawless &mdash; it reads
          the famous alchemical motto <span lang="el">&#7953;&#957; &#964;&#8056; &#960;&#8118;&#957;</span>,{' '}
          &ldquo;the One, the All,&rdquo; off a ringed diagram without a stumble. The problem is that you cannot know,
          from the output alone, which kind of page you are on. Every page comes back fluent.
        </p>

        {/* --- The edition --- */}
        <h2 id="the-edition" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The edition carries the text
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The fix is not a better OCR pass. It is 140 years old. In 1887&ndash;88 Marcellin Berthelot and
          Charles-&Eacute;mile Ruelle published the{' '}
          <Link href="/book/collection-des-anciens-alchimistes-grecs-vols-2-3-berthelot" className="text-accent-rust hover:underline">
            <em>Collection des anciens alchimistes grecs</em>
          </Link>
          , the critical edition of the Greek alchemical corpus &mdash; transcribed, letter by letter, from this very
          manuscript. Where our model guessed &ldquo;fish-voiced,&rdquo; Berthelot&rsquo;s editors read{' '}
          <span lang="el">&#7992;&#969;&#957;</span>, Ion, and recorded in their apparatus that the surviving witnesses
          themselves disagree &mdash; one copy reads <span lang="el">&#959;&#7990;&#969;&#957;</span>, another{' '}
          <span lang="el">&#8001; &#8038;&#957;</span> &mdash; before adjudicating between them. That is work OCR
          cannot do. It is not cleaner character recognition; it is scholarly judgment exercised across a thousand
          years of copies.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          So we invert the usual assumption. For a hard hand, the manuscript is not the source of the <em>text</em>.
          It is the source of the <em>facsimile</em>. The edition carries the words; the manuscript carries everything
          that is only true of the physical object &mdash; the ink, the layout, the marginalia, the diagrams, the fact
          of the thing. This is not a demotion of the manuscript. It is a division of labour that respects what each
          one can actually be trusted to say.
        </p>

        {/* --- The join --- */}
        <h2 id="the-join" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The join
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Berthelot&rsquo;s edition and the digitized manuscript turn out to share a coordinate system. Because
          Berthelot transcribed <em>from</em> this codex, his printed pages are studded with its folio marks &mdash;
          &ldquo;f.&nbsp;92&nbsp;v.,&rdquo; an inline &ldquo;(f.&nbsp;171&nbsp;r.),&rdquo; a headnote{' '}
          &ldquo;transcribed from M, f.&nbsp;92&nbsp;v.&rdquo; &mdash; and the digitization&rsquo;s page labels carry
          the same foliation. They lock together directly. We built that concordance and verified it against
          independent anchors; 195 folios now sit paired, page for page, with the running sequence staying monotonic
          &mdash; the signature of a correct alignment rather than a lucky one.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          On the reader, Berthelot&rsquo;s Greek and English now sit <em>above</em> the manuscript&rsquo;s own AI
          transcription as the reading text of record. The machine reading is not deleted &mdash; it is demoted to a
          clearly flagged aid, labelled for exactly what it is. Nothing in the manuscript&rsquo;s own data is
          overwritten; the pairing is an additive layer, so every folio now offers a three-way comparison: the
          facsimile, the AI&rsquo;s attempt, and the critical edition, side by side. You can{' '}
          <Link href="/book/marcianus-graecus-299-greek-alchemists/page/6a45298cc6d95bc278fbc993" className="text-accent-rust hover:underline">
            see it on folio 93r
          </Link>
          , where Ion is restored to his own sentence.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          We are deliberately careful about how confident this looks. We do not publish an accuracy percentage for the
          AI transcription, because we have no ground truth to measure it against &mdash; both the transcription and
          any second reading are machine-made. What we publish instead is honest about its own limits: a stability
          signal drawn from how much the two OCR passes agree, and a badge marking whether a critical edition is
          available for that folio. Green on the clean pages, a caution flag on the dense narrative ones. A number we
          could stand behind, not a number that flatters the machine.
        </p>

        {/* --- The rule --- */}
        <h2 id="an-old-rule" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          An old rule, newly kept
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          None of this is new. We already refuse to OCR the hardest scripts directly. When the library holds Akkadian
          or Egyptian material, the text is carried by the printed scholarly edition &mdash; King&rsquo;s{' '}
          <em>Seven Tablets of Creation</em>, Budge&rsquo;s <em>Book of the Dead</em> &mdash; whose transliteration
          and translation read cleanly, with the wedges and glyphs shown as plates. We have{' '}
          <Link href="/blog/cuneiform-ocr" className="text-accent-rust hover:underline">asked whether AI can read cuneiform</Link>{' '}
          and <Link href="/blog/hieroglyph-ocr" className="text-accent-rust hover:underline">whether it can read hieroglyphs</Link>,
          and the honest answer, for now, is that it reads the printed edition far better than it reads the artifact.
          Greek minuscule quietly joins that shelf.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The rule generalizes cleanly: <strong>where a public-domain critical edition of a work exists &mdash;
          especially one whose base manuscript you are digitizing &mdash; prefer the edition&rsquo;s text to raw OCR
          of the ancient hand.</strong> OCR the clean print; keep the manuscript for the facsimile, the images, and
          everything object-native. It is the same instinct that runs through our other work: trust the catalogued,
          adjudicated record over a model&rsquo;s unaided fluency, and be loud about uncertainty rather than papering
          over it.
        </p>

        {/* --- Close --- */}
        <h2 id="close" className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The flashlight and the witness
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The manuscript still matters more than the edition. It is the only witness to what a scribe&rsquo;s hand
          actually did in the tenth century; the edition is a reading of it, and a good reading can still be revised.
          But a witness is not a text, and an AI is not a scholar. The model is a flashlight you carry into the
          archive &mdash; useful, fast, and blind to its own mistakes. On folio 93 the flashlight found a fish.
          Berthelot found Ion. The point of pairing them is not to decide who wins. It is to put the facsimile, the
          machine, and the edition on the same page, and let the reader see the difference.
        </p>

        {/* --- References --- */}
        <h3 className="text-xl text-primary mt-16 mb-4">Sources &amp; further reading</h3>
        <ul className="text-sm text-secondary space-y-2 mb-8 list-disc list-inside">
          <li>
            <Link href="/book/marcianus-graecus-299-greek-alchemists" className="text-accent-rust hover:underline">
              <em>Marcianus graecus</em> Z. 299 (=584), Corpus of the Greek Alchemists
            </Link>{' '}
            &mdash; the tenth&ndash;eleventh-century manuscript, folio 93r quoted above.
          </li>
          <li>
            <Link href="/book/collection-des-anciens-alchimistes-grecs-vols-2-3-berthelot" className="text-accent-rust hover:underline">
              Marcellin Berthelot &amp; Charles-&Eacute;mile Ruelle, <em>Collection des anciens alchimistes grecs</em> (Paris, 1887&ndash;88)
            </Link>{' '}
            &mdash; the critical edition whose base manuscript is the Marcianus.
          </li>
          <li>
            <Link href="/blog/confident-hallucinator" className="text-accent-rust hover:underline">The Confident Hallucinator</Link>{' '}
            &mdash; why manuscript OCR fails fluently, and why consistency is not accuracy.
          </li>
          <li>
            <Link href="/blog/ocr-consistency" className="text-accent-rust hover:underline">Measuring OCR Consistency</Link>{' '}
            &mdash; the self-agreement method, and the baseline for printed text.
          </li>
          <li>
            <Link href="/blog/cuneiform-ocr" className="text-accent-rust hover:underline">Can AI Read Cuneiform?</Link>{' '}
            and{' '}
            <Link href="/blog/hieroglyph-ocr" className="text-accent-rust hover:underline">Can AI Read Hieroglyphs?</Link>{' '}
            &mdash; the ancient-script series this post extends.
          </li>
        </ul>

      </article>

    </ContentPageLayout>
  );
}
