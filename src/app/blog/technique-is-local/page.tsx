import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Technique Is Local, Crisis Is Universal - Research Notes - Source Library',
  description:
    'Reading meditation manuals as research artifacts: what the primary sources on contemplative practice say that contemporary meditation science has not yet tested.',
  openGraph: {
    title: 'Technique Is Local, Crisis Is Universal',
    description:
      'Reading meditation manuals as research artifacts: protocol specifications, dose warnings, staging models, and testable hypotheses from a thousand years of contemplative literature.',
    images: [
      {
        url: 'https://images.sourcelibrary.org/pages/6a1d81af5afc14a085e6d7e6/spdxcs-0138.jpg',
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['https://images.sourcelibrary.org/pages/6a1d81af5afc14a085e6d7e6/spdxcs-0138.jpg'],
  },
  alternates: {
    canonical: '/blog/technique-is-local',
  },
};

export default function TechniqueIsLocalPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Technique Is Local, Crisis Is Universal"
          subtitle="Reading a Thousand Years of Meditation Manuals as Research Artifacts"
          image="https://images.sourcelibrary.org/pages/6a1d81af5afc14a085e6d7e6/spdxcs-0138.jpg"
          imageAlt="Woodcut from the 1615 Xingming guizhi: a Daoist practitioner in seated meditation with an internal-alchemy diagram inscribed on his abdomen."
        >
          <p className="text-stone-400 text-sm mt-4">27 August 2026 &middot; 11 min read</p>
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
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Spend a few days reading across the meditation literature in this library &mdash; Buddhaghosa
          beside the hesychasts, the Daoist alchemists beside the Sufis, Iamblichus beside the
          quietists &mdash; and something unexpected comes into focus. These texts are not devotional
          mood pieces. They contain protocol specifications, dose warnings, staging models, and
          individual-differences prescriptions. Comparative scholars have long read the traditions
          against each other; what nobody has quite done is read these texts as a pre-registration
          archive &mdash; dated, priority-stamped, falsifiable claims, waiting for their trials.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Here is the fifth-century <em>Visuddhimagga</em> &mdash; the great Theravada practice manual,
          which we hold in a{' '}
          <Link href="/book/visuddhimagga-path-of-purification-in-thai" className="text-accent-rust hover:text-accent-rust underline">
            1,282-page edition, translated nearly in full
          </Link>{' '}
          &mdash; specifying the middle stages of breath meditation. It does not say &ldquo;watch your
          breath.&rdquo; It prescribes a sequence that deliberately generates rapture, then regulates it:
        </p>

        <div className="border-l-4 border-accent-gold/30 pl-6 mb-8">
          <p className="text-secondary italic mb-2">
            &ldquo;He trains, &lsquo;I will breathe out, gladdening the mind,&rsquo; he trains, &lsquo;I
            will breathe in, gladdening the mind.&rsquo; &hellip; He trains, &lsquo;I will breathe out,
            concentrating the mind&rsquo; &hellip; He trains, &lsquo;I will breathe out, liberating the
            mind.&rsquo;&rdquo;
          </p>
          <p className="text-muted text-sm">
            &mdash; Buddhaghosa, <em>Visuddhimagga</em>, ch. 8,{' '}
            <Link href="/q/BiX2Rr6BNVhkPqpCVWX" className="text-accent-rust hover:text-accent-rust underline">
              p. 493
            </Link>
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          The same manual prescribes practices by temperament &mdash;{' '}
          <Link href="/q/BiX2Rr6BNVhkPqpCVST" className="text-accent-rust hover:text-accent-rust underline">
            breath for the deluded and the discursive, the divine abidings for the angry, foulness for
            the lustful
          </Link>{' '}
          &mdash; a personalized-medicine claim from the fifth century that modern meditation research,
          which mostly treats meditation as one intervention, has never directly tested. That is the
          spirit of this note: not &ldquo;ancient wisdom anticipated science,&rdquo; but that these
          sources state specific, falsifiable claims, and someone should falsify them.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Three Places the Sources Contradict the Modern Picture
        </h2>

        <h3 className="text-xl text-stone-800 mb-3 mt-10">
          1. The West was meditating all along
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          The common story &mdash; meditation arrived from Asia in the twentieth century &mdash; mistakes
          a vocabulary change for an import. The Stoics and the Byzantine hesychasts use the <em>same
          Greek word</em>, <em>prosoch&#275;</em>, for vigilant attention, a millennium apart. Medieval
          Latin used &ldquo;meditation&rdquo; for the <em>active, discursive</em> stage of practice and
          &ldquo;contemplation&rdquo; for received stillness &mdash; nearly the reverse of current English
          usage, which is why reading Teresa of &Aacute;vila or the{' '}
          <Link href="/book/philokalia-greek-eds" className="text-accent-rust hover:text-accent-rust underline">
            Philokalia
          </Link>{' '}
          with today&apos;s definitions systematically misleads. And when Indian practice did reach the
          Victorian West, it was assimilated not to &ldquo;mindfulness&rdquo; but to mesmerism. Henry Steel
          Olcott &mdash; co-founder of the Theosophical Society &mdash; introducing the 1885
          Theosophical edition of{' '}
          <Link href="/book/the-yoga-philosophy-tookaram-tatya" className="text-accent-rust hover:text-accent-rust underline">
            <em>The Yoga Philosophy</em>
          </Link>{' '}
          (edited by Tookaram Tatya), explains samadhi through animal magnetism:
        </p>

        <div className="border-l-4 border-accent-gold/30 pl-6 mb-8">
          <p className="text-secondary italic mb-2">
            &ldquo;It has also been affirmed that the cataleptic similitude to death, which in India is
            called Samadhi, may be produced in the mesmerised, or magnetized, subject by the
            magnetizer.&rdquo;
          </p>
          <p className="text-muted text-sm">
            &mdash; H. S. Olcott, introduction to <em>The Yoga Philosophy</em>, ed. Tookaram Tatya (1885),{' '}
            <Link href="/q/Bjlwb2my5PmR60J0Y9p" className="text-accent-rust hover:text-accent-rust underline">
              p. xxi
            </Link>
          </p>
        </div>

        <h3 className="text-xl text-stone-800 mb-3 mt-10">
          2. The rainbow is younger than your grandmother
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          We wrote in February about{' '}
          <Link href="/blog/chakra-tradition" className="text-accent-rust hover:text-accent-rust underline">
            recovering the chakra tradition
          </Link>{' '}
          from its primary sources. A quantitative pass over the corpus sharpens the point. Across ten
          subtle-body systems in 432 books &mdash; Hindu tantric, Buddhist tantric, Daoist, Sufi,
          Kabbalistic, and others &mdash; the systems align on almost nothing except body
          <em> location</em>: heart and throat centres appear in ten out of ten. The modal chakra count
          in period Hindu tantric sources is six (the crown usually sits above the count, not in it).
          And only about 12% of pre-modern colour assignments match the familiar rainbow scheme &mdash; a
          rate that is roughly the same on either side of 1875, because the red-to-violet mapping does not come
          from the Sanskrit sources, nor even from Leadbeater&apos;s 1927 Theosophical colours, but from
          Christopher Hills&apos;s <em>Nuclear Evolution</em> (1977). The chakra chart in every yoga
          studio is younger than the transistor radio.
        </p>

        <h3 className="text-xl text-stone-800 mb-3 mt-10">
          3. The safety documentation we threw away
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Every tradition that uses imagery independently wrote the same warning list. The 1615 Daoist
          compendium{' '}
          <Link href="/book/xingming-guizhi-principles-of-joint-cultivation-of-nature-and-life" className="text-accent-rust hover:text-accent-rust underline">
            <em>Xingming guizhi</em>
          </Link>{' '}
          tells the adept that deep stillness will conjure{' '}
          <Link href="/q/BkB9QcpJHEtIiMDHYc2" className="text-accent-rust hover:text-accent-rust underline">
            &ldquo;towers, pavilions, jewels, pearls, female musicians&rdquo;
          </Link>{' '}
          &mdash; and that none of it is attainment. Zen calls such productions <em>maky&#333;</em>. The
          Sufi master al-Hujw&#299;r&#299; condemns taking any mental image for God as{' '}
          <Link href="/q/BgTWdRJx7ToS4GSHuU8" className="text-accent-rust hover:text-accent-rust underline">
            &ldquo;utter anthropomorphism and manifest error&rdquo;
          </Link>
          ; Teresa subjects visions to discernment; the{' '}
          <Link href="/q/BgTYRRbnqInviUqjgj6" className="text-accent-rust hover:text-accent-rust underline">
            Persian Kashf al-Ma&#7717;j&#363;b keeps beginners away from ecstatic music sessions
          </Link>{' '}
          &ldquo;for there are great dangers in it.&rdquo; The traditions disagree about whether to use
          images, but they agree about the failure mode: being used by them. Modern secular mindfulness
          shipped the techniques without the teacher, the map, or the warning lists &mdash; and the
          adverse-effects research programme (the &ldquo;Varieties of Contemplative Experience&rdquo;
          project &mdash; Lindahl, Britton and colleagues&apos; 2017 mixed-methods study of
          meditation-related challenges in Western Buddhists) is now empirically rediscovering the
          territory those lists covered.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          A Measurement, and the Hypothesis It Suggests
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          This summer we ran a probe-based survey of first-person experience across the corpus &mdash;
          retrieval by experiential probe sentences, classification, a verbatim-quote gate, and
          embedding of the surviving passages. It is a draft working paper: single-model
          classification of AI-translated text, no human-validated subset yet. The same caveat covers
          the subtle-body numbers above, which come from the same survey. Treat everything in this
          section as provisional &mdash; including the phrase this post takes as its title, which is
          offered as the hypothesis we would most like someone to falsify, not as a finding.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Method travels in manuals; vision travels in reports.</strong> Contemplative-emptiness
          material arrives as 57% instruction and 6% first-person testimony. Visionary body-dissolution
          material inverts it: 7% instruction, 63% testimony. This is a fact about the record, and it
          has a sharp consequence for contemporary research: a phenomenology questionnaire can only
          collect testimony, so the traditions modern science studies most are precisely the ones whose
          literature is structurally worst at supplying first-person reports.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong>Technique looks local; crisis looks universal.</strong> We extracted the
          <em> Visuddhimagga</em>&apos;s stage descriptions from our own copy, in its own vocabulary, and
          matched them across the whole corpus. Inside the Buddhist tradition, matches are dominated by
          concentration attainments (roughly half, against a third for the crisis stages). Outside it,
          the proportions flip: the knowledges of fear, misery, and disgust &mdash; the deliberately
          mapped stretch modern practitioners call the <em>dukkha &ntilde;&#257;&#7751;as</em> &mdash;
          take about two-thirds of the matches, a
          three-fold shift in the odds. Two honesty notes before any interpretation. First, the same
          survey&apos;s own negative result: in embedding space, which book and which language a passage
          comes from predict its neighbours far better than what experience it describes &mdash; text
          organizes the space more than phenomenology does, which is why no claim here rests on raw
          embedding similarity. Second, a confound we have not ruled out: concentration vocabulary
          (jh&#257;na, rapture, one-pointedness) is lexically Buddhist almost by construction, while
          crisis vocabulary (fear, darkness, dissolution) is generic across translated devotional
          prose &mdash; so part of the asymmetry could be about words, not experiences. With those on
          the table: if the pattern survives better instruments, the cross-cultural &ldquo;common
          core&rdquo; of deep practice is not bliss or union, as the popular perennialist picture has
          assumed &mdash; it is the crisis. Every staged map we hold, from the vipassan&#257;
          knowledges to John of the Cross&apos;s nights to the Sufi contraction (<em>qab&#7693;</em>),
          budgets for it.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Seven Hypotheses the Sources Hand Us
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Each of these is stated in, or directly implied by, a primary source we hold. Roughly ranked
          by feasibility:
        </p>

        <ol className="list-decimal pl-6 space-y-4 text-secondary mb-8">
          <li>
            <strong>Temperament matching.</strong> Buddhaghosa&apos;s trait-by-technique prescription
            table predicts a measurable interaction: practitioners matched to their temperament should
            outperform mismatched ones. Nobody has run this as a moderator study.
          </li>
          <li>
            <strong>Staged versus flat breath practice.</strong> The sixteen-step protocol (induce
            rapture, then gladden, concentrate, liberate) against undifferentiated breath focus, on
            affect and absorption outcomes.
          </li>
          <li>
            <strong>Breath cessation.</strong> Daoist{' '}
            <Link href="/q/BkB9QcpJHEtIiMDHYZf" className="text-accent-rust hover:text-accent-rust underline">
              &ldquo;embryonic breathing&rdquo;
            </Link>{' '}
            and the fourth jh&#257;na independently claim respiration becomes imperceptible in deep
            absorption. Jh&#257;na respirometry already exists &mdash; a 2024 case series (Chowdhury
            and colleagues) measured significantly slowed breathing in absorption &mdash; but nobody
            has run the same measurement against the Daoist claim in one design. Two unconnected
            traditions, one protocol.
          </li>
          <li>
            <strong>Constructive practice trains imagery.</strong> Kozhevnikov and colleagues reported
            in 2009 that Tibetan deity-yoga practitioners get a large (if temporary) boost in mental
            rotation and visual memory after practice &mdash; fifteen self-selected practitioners, so a
            lead, not a result. The untested extension: Ignatian exercitants &mdash; the West&apos;s
            deity-yoga analogue &mdash; should show convergent gains despite zero shared lineage.
          </li>
          <li>
            <strong>Warning-list validity.</strong> The Varieties of Contemplative Experience project
            already grounds its adverse-events taxonomy in Buddhist maps. The open questions are
            cross-tradition &mdash; do the Daoist and Sufi warning lists carve the same joints? &mdash;
            and predictive: does the traditional category an event falls into predict whether it
            resolves benignly or escalates? The lists are specific enough to code against existing
            case data.
          </li>
          <li>
            <strong>The heart-locus prior.</strong> Ten-of-ten convergence on a heart centre could be
            deep structure &mdash; or just interoceptive salience, since hearts are feelable. The test
            is a null model: is cross-tradition convergence greater than interoception alone predicts?
          </li>
          <li>
            <strong>Dose-response of repetitive invocation.</strong> Iamblichus, defending theurgy
            around 300 CE, states a training-curve model of ritual prayer:{' '}
            <Link href="/q/Bi8O43qZaSO7e3kW0JW" className="text-accent-rust hover:text-accent-rust underline">
              &ldquo;prayer, when frequented for a long time, nourishes our intellect &hellip; little by
              little, it perfects our infirmities &hellip; until it leads us to the summit&rdquo;
            </Link>
            . Strip the polytheist frame and this is a duration-dependent plasticity claim about
            repetitive invocation &mdash; the same claim the hesychasts make for the Jesus Prayer and
            Buddhaghosa for the breath &mdash; and it is measurable.
          </li>
        </ol>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Caveats, Because This Is the Whole Point
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The corpus translations quoted here are AI working translations with the originals preserved
          alongside, with two exceptions worth naming exactly: the &ldquo;anthropomorphism&rdquo;
          quotation is Nicholson&apos;s 1911 English, while the sam&#257;&#703; warning is our own AI
          translation of Zhukovsky&apos;s 1926 Persian critical edition. The experience
          survey is a single-model draft. The corpus itself is a biased sample &mdash; what was written,
          kept, scanned, and imported. None of these numbers should be quoted without those
          qualifications, and the hypotheses above are offered precisely so that people with
          laboratories can do what we cannot.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          What the library adds is the thing laboratories have lacked: the primary record, at scale, in
          the original languages with working translations, linkable to the page. Every quotation in
          this note resolves to the leaf of the edition it came from. The manuals are open. The
          protocols are written down. They have been waiting, some of them, since late antiquity.
        </p>
      </article>
    </ContentPageLayout>
  );
}
