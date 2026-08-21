import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import PassageComparison from '@/components/comparison/PassageComparison';

export const metadata: Metadata = {
  title: 'What Ficino Heard — Translations Across Civilizations | Source Library',
  description:
    'The same Hermetic vision, rendered by a Renaissance philosopher in 1481, a 17th-century English scribe, and an AI in 2026. Three translations, three centuries, one text.',
  openGraph: {
    title: 'What Ficino Heard',
    description:
      'Three translations of the Corpus Hermeticum — Ficino (1481), an anonymous English scribe (1650), and AI (2026) — reveal what each era sought in the same ancient text.',
    images: [
      {
        url: 'https://images.sourcelibrary.org/archived/69938e765d28b693146d0f99/19.jpg',
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/69938e765d28b693146d0f99/19.jpg' }],
  },
  alternates: {
    canonical: '/blog/translations-across-civilizations',
  },
};

export default function TranslationsAcrossCivilizationsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="What Ficino Heard"
          subtitle="Three translations of the Poimandres &mdash; 1481, 1650, 2026"
        >
          <p className="text-stone-400 text-sm mt-4">
            19 April 2026 &middot; 10 min read
          </p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Something new is possible now that has never been possible before.
          Source Library holds thousands of pre-modern texts in their original
          languages &mdash; Greek, Latin, Sanskrit, Arabic, Chinese &mdash;
          alongside AI translations generated directly from those originals.
          For hundreds of these works, we also hold historical human
          translations: the versions that shaped civilizations. Place them
          side by side, and you can see something no single translation
          reveals: what each translator <em>chose</em> to hear in the
          original.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          This is the first in a series of experiments with that
          three-way comparison. We start with the <em>Corpus Hermeticum</em>.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          In 1463, a Greek manuscript arrived at the court of Cosimo
          de&rsquo; Medici in Florence. Cosimo ordered his best scholar,
          Marsilio Ficino, to drop everything &mdash; including Plato &mdash;
          and translate it immediately. The text was the{' '}
          <em>Corpus Hermeticum</em>, attributed to the legendary sage Hermes
          Trismegistus. Ficino believed it was older than Moses.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Ficino&rsquo;s 1481 Latin translation shaped five centuries of
          Western esotericism. But Ficino was not a neutral channel. He was a
          Neoplatonist, a priest, and a man writing for a patron. Every
          word he chose was an interpretation. Now, for the first time, we can
          place his rendering next to two others: a 1650 English manuscript
          translation, and a direct AI translation from the 1554 Greek editio
          princeps. The AI has no patron, no theology, no agenda. It is a
          mirror &mdash; and what it reflects is what the human translators
          chose to add.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          What follows are three passages from the <em>Poimandres</em>, the
          first and most famous tractate of the <em>Corpus Hermeticum</em>.
          In it, Hermes describes a mystical vision: a divine being called
          Poimandres appears, reveals the creation of the cosmos, and
          explains the origin and destiny of the human soul.
        </p>

        {/* ──────── PASSAGE 1: THE OPENING VISION ──────── */}

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          I. &ldquo;What Do You Wish to Hear and See?&rdquo;
        </h2>

        <p className="text-sm text-muted uppercase tracking-wider mb-4">
          Poimandres I.1&ndash;2 &mdash; The Opening Vision
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The text opens with Hermes in a state of meditation. His bodily
          senses are &ldquo;put to sleep,&rdquo; and a being of immense size
          appears. Watch how each translator handles the moment of encounter
          &mdash; what Ficino makes formal and theological, the English scribe
          makes intimate, and the AI keeps literal.
        </p>

        <PassageComparison
          title="The Appearance of Poimandres"
          showOriginal={false}
          passages={[
            {
              label: 'Greek (1554 Turnebus)',
              language: 'Greek',
              original:
                'ΕΝΝΟΙΑΣ μοι ποτέ γενομένης περὶ τῶν ὄντων, καὶ μετεωρισθείσης μοι τῆς Διανοίας, σφόδρα κατασχεθῶν μου τῶν σωματικῶν αἰσθήσεων, ὥσπερ οἱ ἐν ὕπνῳ βεβαρημένοι ἐκ κόρου τροφῆς, ἢ ἐκ κόπου σώματος, ἔδοξά τινα ὑπερμεγέθη μέτρῳ ἀπεριορίστῳ τυγχάνοντα, καλεῖν τὸ ὄνομα, καὶ λέγοντά μοι, τί βούλῃ ἀκοῦσαι καὶ θεάσασθαι, καὶ νοήσας μαθεῖν καὶ γνῶναι.',
              translation:
                'Once, when I was contemplating the things that exist and my understanding had been lifted high, while my bodily senses were strongly restrained — as if by those who are heavy with sleep from overeating or physical labor — I thought I saw a being of immeasurable size calling my name and saying to me, "What do you wish to hear and see, and having understood, what do you wish to learn and know?"',
              citation: 'p. 19',
              bookUrl:
                '/book/poimandres-greek-editio-princeps-turnebus-trismegistus?page=19',
            },
            {
              label: 'Ficino (Latin, 1481)',
              language: 'Latin',
              original:
                'CVM de rerum natura cogitarē: ac mētis aciem ad superna erigerem: sopitis iam corporis sēsibus: quemadmodū accidere solet iis: qui ob saturitatem: uel defatigationē somno grauati sunt. subito mihi uisus sum cernere quēdam: immensa magnitudine corporis: qui me nomine uocans: in hūc modum clamaret. Quid est o Mercuri: quod & audire: & intueri desideras? Quid est: quod discere atq; inteligere cupis?',
              translation:
                'When I was meditating on the nature of things and raising the sharp point of my mind toward the heavens, the senses of my body were now put to sleep — just as it usually happens to those who are heavy with sleep due to fullness or exhaustion. Suddenly, I seemed to see someone of immense bodily size, who, calling me by name, shouted in this manner: "What is it, O Mercury, that you desire to hear and behold? What is it that you wish to learn and understand?"',
              citation: 'p. 15',
              bookUrl:
                '/book/corpus-hermeticum-pimander-1481-venice-edition-hermes-trismegistus?page=15',
            },
            {
              label: 'English MS (c. 1650)',
              language: 'English',
              original:
                'I know what thou wouldest have, & I am allwayes present with thee. Then sayd I; I would learne the things that are, & understand the nature of them, & know God. How? sayd he; I answered that I would gladly heare. Then he, Have me againe in thy minde, & whatsoever thou wouldest learne I will teach thee.',
              translation:
                '"I know what thou wouldest have, and I am always present with thee." Then said I: "I would learn the things that are, and understand the nature of them, and know God." "How?" said he. I answered that I would gladly hear. Then he: "Have me again in thy mind, and whatsoever thou wouldest learn I will teach thee."',
              citation: 'p. 54',
              bookUrl:
                '/book/corpus-hermeticum-17th-century-english-translation-ms-imming?page=54',
            },
          ]}
          commentary='Notice how Ficino adds "raising the sharp point of my mind toward the heavens" — the Greek says only that his understanding "was lifted high." Ficino makes the ascent active and intellectual, reflecting his Neoplatonic commitment to the mind as the instrument of divine contact. The English scribe, working from a different tradition, drops the elaborate scene-setting entirely and plunges straight into dialogue. The AI preserves the passive construction of the Greek: understanding was lifted, senses were restrained. Something happens to Hermes. He does not make it happen.'
        />

        {/* ──────── PASSAGE 2: THE COSMOGONIC VISION ──────── */}

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          II. &ldquo;From the Light, the Holy Logos Stepped Upon the
          Nature&rdquo;
        </h2>

        <p className="text-sm text-muted uppercase tracking-wider mb-4">
          Poimandres I.5&ndash;9 &mdash; The Creation of the Elements
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          After the initial vision of light and darkness, Poimandres reveals
          the cosmogony: how fire, air, earth, and water separated, and how
          the divine Word (Logos) organized chaos into cosmos. This is the
          passage that most closely parallels Genesis &mdash; and where
          Ficino&rsquo;s Christian theology leaves its deepest mark.
        </p>

        <PassageComparison
          title="The Logos and the Elements"
          showOriginal={false}
          passages={[
            {
              label: 'Greek (1554 Turnebus)',
              language: 'Greek',
              original:
                'ἐκ δὲ φωτὸς Ὁ λόγος ἅγιος ἐπέβη τῇ φύσει, καὶ πῦρ ἄκρατον ἐξεπήδησεν ἐκ τῆς ὑγρᾶς φύσεως ἄνω εἰς ὕψος· κοῦφον δὲ ἦν καὶ ὀξὺ, δραστικόν τε ἅμα· καὶ ὁ ἀὴρ ἐλαφρὸς ὢν, ἠκολούθησε τῷ πνεύματι.',
              translation:
                'From the light, the holy Logos stepped upon the nature, and unmixed fire leaped out from the moist nature up into the height. It was light and sharp and at the same time active. The air, being light, followed the spirit as it ascended from the earth and water up to the fire, so that it seemed to hang from it.',
              citation: 'p. 20',
              bookUrl:
                '/book/poimandres-greek-editio-princeps-turnebus-trismegistus?page=20',
            },
            {
              label: 'Ficino (Latin, 1481)',
              language: 'Latin',
              original:
                'ex hac luminis uoce: uerbũ factũ prodiit: Verũ hoc naturæ humidã adstãs eam fouebat. Ex humidæ autem naturæ uisceribus: sincerus ac leuis ignis emicuit.',
              translation:
                'From this voice of light, the Word came forth. Indeed, this Word stood near the moist nature and cherished it. From the depths of that moist nature, a pure and light fire immediately flew out and sought the heights. The air, also being light and following the spirit, took its place in the middle region between the fire and the water.',
              citation: 'p. 16',
              bookUrl:
                '/book/corpus-hermeticum-pimander-1481-venice-edition-hermes-trismegistus?page=16',
            },
            {
              label: 'English MS (c. 1650)',
              language: 'English',
              original:
                'And the ayre, which was also light, followed the spirit, & mounted up even to the fire (frõ the earth & the water) in so much that it seemed to hang & depend upon it; And the earth & the water stayed by themselves so mingled together that the Earth could not be seen for the water; but they were moved because of the spirituall word that was caryed upon them.',
              translation:
                'And the air, which was also light, followed the spirit, and mounted up even to the fire — from the earth and the water — insomuch that it seemed to hang and depend upon it. And the earth and the water stayed by themselves so mingled together that the earth could not be seen for the water; but they were moved because of the spiritual word that was carried upon them.',
              citation: 'p. 55',
              bookUrl:
                '/book/corpus-hermeticum-17th-century-english-translation-ms-imming?page=55',
            },
          ]}
          commentary='The Greek says the Logos "stepped upon" (ἐπέβη) the nature — a verb of physical contact, almost violent. Ficino softens this dramatically: his Word "stood near the moist nature and cherished it" (adstans eam fovebat). This is not a translation choice; it is a theological intervention. Ficino&rsquo;s Word is gentle, nurturing, Christological. The Greek Logos is imperious — it treads on chaos. The English scribe preserves the dynamic quality: the spiritual word is "carried upon" the elements, echoing Genesis 1:2 ("the Spirit of God moved upon the face of the waters"). Three translators, three cosmologies.'
        />

        {/* ──────── PASSAGE 3: THE CREATION OF MAN ──────── */}

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          III. &ldquo;The Father Brought Forth a Human Equal to
          Himself&rdquo;
        </h2>

        <p className="text-sm text-muted uppercase tracking-wider mb-4">
          Poimandres I.12&ndash;14 &mdash; The Creation of the Archetypal
          Human
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The climax of the cosmogony: the divine Mind creates a human being
          in its own image, who then gazes down through the celestial spheres,
          sees Nature, and falls in love with his own reflection. This passage
          is simultaneously a creation myth, a Narcissus story, and the
          Hermetic answer to the question of why the divine soul is trapped in
          matter.
        </p>

        <PassageComparison
          title="The Archetypal Human"
          showOriginal={false}
          passages={[
            {
              label: 'Greek (1554 Turnebus)',
              language: 'Greek',
              original:
                'ὁ δὲ πάντων πατήρ, ὁ νοῦς ὢν ζωὴ καὶ φῶς, ἀπεκύησεν ἄνθρωπον αὑτῷ ἴσον, οὗ ἠράσθη ὡς ἰδίου τόκου. περικαλλὴς γὰρ, τὴν τοῦ πατρὸς εἰκόνα ἔχων· ὄντως γὰρ καὶ ὁ θεὸς ἠράσθη τῆς ἰδίας μορφῆς.',
              translation:
                'The Father of all, the Nous, being life and light, gave birth to a human equal to himself, whom he loved as his own offspring. For he was all-beautiful, having the image of the Father; truly, God also loved his own form. And he delivered to him all his own creations.',
              citation: 'p. 22',
              bookUrl:
                '/book/poimandres-greek-editio-princeps-turnebus-trismegistus?page=22',
            },
            {
              label: 'Ficino (Latin, 1481)',
              language: 'Latin',
              original:
                'hominem sibi similem procreauit: atque ei tanquā filio suo congratulatus est. Pulcher.n.erat: patrisq; sui ferebat imaginem. Deus.n.re uera propria forma nimirum delectatus: opera eius omnia usui concessit humano.',
              translation:
                'He produced a human being similar to himself, and he rejoiced in him as if in his own son. For he was beautiful, and he bore the image of his father. For God, truly delighted with his own form, granted all his works for human use.',
              citation: 'p. 18',
              bookUrl:
                '/book/corpus-hermeticum-pimander-1481-venice-edition-hermes-trismegistus?page=18',
            },
            {
              label: 'English MS (c. 1650)',
              language: 'English',
              original:
                'But the father of all things, the minde, being, life, & light, brought forth Man like unto himself, who he loved as his proper birth, for he was all beauteous, having the image of his father.',
              translation:
                'But the father of all things, the mind, being life and light, brought forth Man like unto himself, whom he loved as his proper birth. For he was all beauteous, having the image of his father.',
              citation: 'p. 58',
              bookUrl:
                '/book/corpus-hermeticum-17th-century-english-translation-ms-imming?page=58',
            },
          ]}
          commentary='The Greek says God "gave birth" (ἀπεκύησεν) to a human "equal" (ἴσον) to himself and "loved" (ἠράσθη) him with erotic love — the same verb used for romantic desire. Ficino cannot say this. His God "produced" (procreauit) a human merely "similar" (similem) to himself and "rejoiced" (congratulatus est) rather than loved with eros. The theological distance between "equal" and "similar," between "loved" and "rejoiced," is the distance between Hermeticism and Christianity. The AI preserves the radical equality of the Greek. The English scribe splits the difference: "like unto himself" (similar, not equal), but "loved as his proper birth" (the intimacy is preserved, the equality is not).'
        />

        {/* ──────── CODA ──────── */}

        <div className="mt-16 pt-8 border-t border-stone-200">
          <h2 className="text-2xl md:text-3xl text-primary mb-6">
            Every Translation Is an Interpretation
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The point of this exercise is not &ldquo;AI vs. human &mdash; who
            wins?&rdquo; No one wins. Every translation is an interpretation,
            and every interpretation reveals something the others miss.
            Ficino&rsquo;s Logos &ldquo;cherishes&rdquo; nature because Ficino
            is a Christian Neoplatonist writing for the Medici. The English
            scribe&rsquo;s Word is &ldquo;carried upon&rdquo; the waters
            because the scribe is steeped in the King James Bible. The
            AI&rsquo;s Logos &ldquo;steps upon&rdquo; nature because the AI
            has no theology &mdash; only the Greek.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            What the AI gives us is not a better translation. It is a{' '}
            <em>baseline</em> &mdash; a rendering with no cultural agenda, no
            patron to please, no Romantic sensibility to project. Against this
            baseline, the human translations become legible as the creative
            acts they always were. We can see what Ficino <em>added</em>. We
            can see what the English scribe <em>heard</em>. We can see, in
            the gaps between all three, the dimensions of the original that no
            single translation can capture.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Source Library holds{' '}
            <Link
              href="/work/corpus-hermeticum"
              className="text-amber-700 hover:underline"
            >
              23 editions of the Corpus Hermeticum
            </Link>{' '}
            across five languages and five centuries. Every page is
            OCR&rsquo;d, translated, and searchable. This is what a digital
            library makes possible: not just access to texts, but access to
            the history of reading them.
          </p>

          <h3 className="text-xl text-primary mt-10 mb-4">
            Try it yourself
          </h3>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The Corpus Hermeticum is just the beginning. Source Library holds
            multi-edition, multi-language data for Plotinus, the Bible,
            Aristotle, the Panchatantra, Shakuntala, and hundreds of other
            works. Any work with a{' '}
            <Link
              href="/work/corpus-hermeticum/compare"
              className="text-amber-700 hover:underline"
            >
              Compare translations
            </Link>{' '}
            button can be explored this way.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Pick a work you know. Find two editions in different languages.
            Open them side by side and read the same passage through different
            centuries, different cultures, different agendas. You will notice
            things that no single translation could show you &mdash; because
            every translation is a theory about what the original means, and
            theories are most visible when you can compare them.
          </p>

          <p className="text-secondary leading-relaxed mb-8 font-body">
            If you find a comparison that reveals something surprising,{' '}
            <Link
              href="https://x.com/SourceLibrary_"
              className="text-amber-700 hover:underline"
              target="_blank"
              rel="noopener"
            >
              we&rsquo;d love to hear about it
            </Link>
            .
          </p>
        </div>

      </article>
    </ContentPageLayout>
  );
}
