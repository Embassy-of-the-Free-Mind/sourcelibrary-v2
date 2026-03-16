import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'What Are Demons? Five Answers from the Primary Sources - Source Library',
  description:
    'The word "demon" names two almost opposite things. The Hermetic daemon is your cosmic guardian; the Christian demon is a fallen angel trying to damn your soul. Source Library holds the texts that document this extraordinary reversal.',
  openGraph: {
    title: 'What Are Demons? Five Answers from the Primary Sources',
    description: 'The Hermetic daemon is your cosmic guardian; the Christian demon is a fallen angel. Source Library holds the texts that document this extraordinary reversal.',
    images: [{ url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6953b56577f38f6761bd979d/62.jpg', width: 1200, height: 630 }],
  },
  alternates: {
    canonical: '/blog/demonology',
  },
};

export default function DemonologyPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="What Are Demons? Five Answers from the Primary Sources"
          subtitle="The word &ldquo;demon&rdquo; names two almost opposite things — and the history of how it acquired its current meaning is one of the stranger reversals in intellectual history"
        >
          <p className="text-stone-400 text-sm mt-4">21 February 2026 &middot; 18 min read</p>
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
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Ask what a demon is and you will get five very different answers depending on which century,
          which tradition, and which text you pick up. The Greek <em>daimōn</em> is a beneficent
          intermediary between gods and mortals — a cosmic middleman who keeps the universe talking to
          itself. The Hermetic <em>daemon</em> is your personal guardian, assigned at birth, present
          at death. The Islamic <em>jinn</em> are an entire parallel civilization, made from smokeless
          fire, with their own prophets and their own final judgment. The Christian <em>daemon</em> is
          a fallen angel, malevolent by nature, deployed by Satan to corrupt human souls. And in
          ceremonial magic — in the grimoires — demons are powerful intelligences that can be bound,
          commanded, and put to work.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          These are not five versions of the same idea. They are five genuinely different ontologies.
          Source Library holds the primary texts behind each of them — not commentaries, not
          encyclopedias, but the actual manuscripts and printed books that shaped what educated people
          in each tradition believed about the invisible world.
        </p>

        <figure className="my-12">
          <Link href="/gallery/image/6953b56577f38f6761bd97db-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/api/crop-image?url=https%3A%2F%2F3kwioilsplnmnkv8.public.blob.vercel-storage.com%2Farchived%2F6953b56577f38f6761bd979d%2F62.jpg&x=0.091&y=0.078&w=0.792&h=0.835"
              alt="Horned demonic figure seated cross-legged, surrounded by smaller demons, from the Kitab al-Bulhan (Book of Wonders), 14th century"
              className="w-full max-w-md mx-auto rounded-lg shadow-md"
            />
          </Link>
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            A jinn from the <em>Kitab al-Bulhan</em> (Book of Wonders), 14th century. Bodleian Library, Oxford.{' '}
            <Link href="/gallery/image/6953b56577f38f6761bd97db-0" className="text-accent-rust hover:text-accent-rust not-italic">View in gallery &rarr;</Link>
          </figcaption>
        </figure>

        <hr className="border-border-light my-12" />

        {/* I. The Greek Daimōn */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            I. The Greek Daimōn: Intermediary Between Worlds
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The Greek word <em>daimōn</em> (δαίμων) originally carried no negative charge whatsoever.
            In Hesiod, the souls of the men of the Golden Age become <em>daimones</em> after death —
            benevolent guardians who wander the earth protecting mortals. In Plato&rsquo;s{' '}
            <em>Symposium</em>, Diotima explains to Socrates that Eros himself is a great{' '}
            <em>daimōn</em>, and that &ldquo;the whole of the daimonic is between god and
            mortal&rdquo; — a mediating power that ferries prayers upward and divine gifts downward.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Socrates famously claimed to have a personal <em>daimonion</em> — a divine sign that spoke
            to him, never commanding but always warning. This is the voice that prevented him from
            pursuing certain courses of action, and which Plato treats with complete seriousness. When
            Socrates&rsquo; accusers charged him with introducing new divinities, the <em>daimonion</em>{' '}
            was part of what they had in mind.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The philosophical framework that would influence all subsequent Western demonology came
            from the Neoplatonists. Plotinus, Porphyry, and Iamblichus built elaborate cosmologies in
            which <em>daimones</em> filled the great chain of being between the gods and humanity —
            necessary intermediaries in a universe so hierarchically ordered that divine and mortal
            could not communicate directly.
          </p>

          <div className="bg-warm rounded-xl p-6 border border-border-light my-8">
            <p className="text-secondary italic font-body leading-relaxed mb-3">
              &ldquo;The daemoniacal race indeed is subservient to the Gods, but is cooperative with
              the human race, and watches over its welfare. However, it is not simply subservient to
              every God, but is distributed according to the orders of the Gods, some daemons being
              subservient to one God, and others to another.&rdquo;
            </p>
            <p className="text-sm text-muted">
              Iamblichus, <em>De Mysteriis</em> — on the function of daimones in the divine hierarchy
            </p>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            What matters here is the topology: <em>daimones</em> are not opposed to the divine but
            continuous with it. They are part of the same hierarchical system, differentiated by
            degree not kind. This is the cosmology that the Hermetica would inherit and transform.
          </p>
        </section>

        {/* II. The Hermetic Daemon */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            II. The Hermetic Daemon: Your Personal Guardian
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The <em>Corpus Hermeticum</em> — a collection of philosophical and religious texts written
            in Greek in Egypt during the 2nd–3rd centuries CE, attributed to the legendary sage Hermes
            Trismegistus — takes the Greek daimonic framework and makes it intensely personal.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            In the <em>Poimandres</em>, the first and most cosmologically ambitious tractate, the
            Mind (Nous) descends through the planetary spheres and takes on qualities from each before
            incarnating in a human body. But the mind does not abandon the soul at incarnation: it
            remains present as a guardian, accessible to those who are pure.
          </p>

          <div className="bg-warm rounded-xl p-6 border border-border-light my-8">
            <p className="text-secondary italic font-body leading-relaxed mb-3">
              &ldquo;I, the Mind, am present to those who are holy, good, pure, religious, and
              clement, and my presence is a help to them, and straightway they know all things and
              lovingly propitiate the Father, giving Him thanks, praising Him, and singing hymns to
              Him with filial love and natural feeling.&rdquo;
            </p>
            <p className="text-sm text-muted">
              <Link
                href="/book/6952062aab34727b1f0432aa"
                className="text-accent-rust hover:underline"
              >
                Pimander (Corpus Hermeticum), 1493
              </Link>{' '}
              — the Mind as guardian presence
            </p>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Later Hermetic texts develop a more structured account of the personal daemon. At birth,
            each soul is assigned a daemon who accompanies it through life and stands beside it at the
            moment of death. This is not a metaphor: the daemon is a real entity, functionally
            indistinguishable from what later traditions would call a guardian angel.
          </p>

          <div className="bg-warm rounded-xl p-6 border border-border-light my-8">
            <p className="text-secondary italic font-body leading-relaxed mb-3">
              &ldquo;Each body is possessed by a daemon, and the soul and body are led on by the
              daemon&rsquo;s power&hellip; At the moment of birth, O Asclepius, the soul receives a
              daemon according to the degree of the hour; and that daemon guides the soul through
              life.&rdquo;
            </p>
            <p className="text-sm text-muted">
              <Link
                href="/book/6953a93977f38f6761bd58f4"
                className="text-accent-rust hover:underline"
              >
                Hermetica (Scott translation), Vol. I
              </Link>{' '}
              — from the <em>Asclepius</em>
            </p>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            This is the daemon at its most benign — your personal cosmic escort, present at birth and
            death, guiding your soul through the vicissitudes of incarnated existence. The{' '}
            <em>daimon</em> as spiritual advisor would survive the transition to Christianity in
            disguised form, but by the 15th century it had been largely demonized — assimilated into
            the Christian framework as a tempter rather than a guide.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The Hermetic texts themselves were largely unknown in the Latin West until 1462, when
            Cosimo de&rsquo; Medici commissioned Marsilio Ficino to translate the <em>Corpus
            Hermeticum</em> from a Greek manuscript just brought to Florence from Macedonia. Ficino
            interrupted his translation of Plato to work on the Hermetica first — on Cosimo&rsquo;s
            orders, because Cosimo was dying and wanted to read the work before he died. Source
            Library holds both Ficino&rsquo;s 1481 Venice edition and the 1493 printing &mdash;
            among the most influential books in Renaissance intellectual history.
          </p>
        </section>

        {/* III. The Islamic Jinn */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            III. The Islamic Jinn: A Parallel Civilization
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The Islamic cosmology of spirits is more elaborate than any Western parallel and
            considerably more democratic. The <em>jinn</em> — created from smokeless fire, as humans
            were created from clay and angels from light — constitute an entire civilization parallel
            to the human one. They have their own prophets (the Quran was sent to both jinn and
            humans), their own communities of believers and unbelievers, and their own final judgment.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The most visually spectacular source in Source Library for Islamic spirit taxonomy is the{' '}
            <em>Kitab al-Bulhan</em>, an Arabic manuscript held at the Bodleian Library in Oxford,
            dated to the 14th century but drawing on much older sources. It is an encyclopedic work
            covering astrology, divination, and the nature of the supernatural — illustrated with
            remarkable paintings of planets, signs of the zodiac, and the spirits associated with them.
          </p>

          <div className="bg-warm rounded-xl p-6 border border-border-light my-8">
            <p className="text-secondary italic font-body leading-relaxed mb-3">
              &ldquo;Know that the jinn are of various kinds. Among them are Muslims and unbelievers.
              Among them are the obedient and the rebellious. Among them are those who fly through the
              air, and those who dwell in ruins, and those who inhabit the sea. And among them are
              those who take human form, and those who appear as animals.&rdquo;
            </p>
            <p className="text-sm text-muted">
              <Link
                href="/book/6953b56577f38f6761bd979d"
                className="text-accent-rust hover:underline"
              >
                Kitab al-Bulhan
              </Link>{' '}
              — Arabic spirit taxonomy, Bodleian MS Arab d. 84
            </p>
          </div>

          <figure className="my-10">
            <Link href="/gallery/image/6953b56577f38f6761bd97de-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/api/crop-image?url=https%3A%2F%2F3kwioilsplnmnkv8.public.blob.vercel-storage.com%2Farchived%2F6953b56577f38f6761bd979d%2F65.jpg&x=0.128&y=0.235&w=0.768&h=0.672"
                alt="Three-headed demonic jinn figure from the Kitab al-Bulhan, 14th century Arabic manuscript"
                className="w-full max-w-sm mx-auto rounded-lg shadow-md"
              />
            </Link>
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              A three-headed jinn from the <em>Kitab al-Bulhan</em>, Bodleian Library, Oxford.{' '}
              <Link href="/gallery/image/6953b56577f38f6761bd97de-0" className="text-accent-rust hover:text-accent-rust not-italic">View in gallery &rarr;</Link>
            </figcaption>
          </figure>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The distinction between <em>jinn</em> and <em>shayatin</em> (satans/demons) is important
            in Islamic thought. <em>Shayatin</em> are jinn who have chosen to rebel against God and
            follow Iblis (Satan). But ordinary jinn are morally neutral — capable of good or evil,
            belief or unbelief, just like humans. This is fundamentally different from the Christian
            model in which demons are irrevocably fallen, incapable of redemption or genuine virtue.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The Islamic magical tradition built extensively on this taxonomy. The great tradition of
            Arabic <em>sihr</em> (magic) and <em>ilm al-hiyal</em> (the science of devices) involved
            elaborate systems for communicating with and commanding jinn — a tradition that fed
            directly into the grimoire literature that would flourish in Latin Europe through the
            medieval and Renaissance periods.
          </p>
        </section>

        {/* IV. The Christian Demon */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            IV. The Christian Demon: Fallen Angel, Cosmic Enemy
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The transformation of the Greek <em>daimōn</em> into the Christian <em>daemon</em> is one
            of the major intellectual operations of late antiquity. The process was not sudden: it
            took centuries, and it was contested. But by the 5th century, when Augustine wrote{' '}
            <em>The City of God</em>, the theological position was largely fixed: what the pagans
            called daimones were in fact fallen angels, ontologically evil, incapable of good,
            deployed by Satan to deceive humanity and lure souls to damnation.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The medieval theological synthesis — Aquinas, Bonaventure, Albertus Magnus — developed an
            elaborate demonology from these foundations. Demons were spiritual beings with intellect
            and will; they had real powers over matter and could perform genuine marvels; but their
            will was permanently bent toward evil, and any apparent good they did was instrumental,
            designed to trap souls through greater evil later.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The most notorious text in this tradition is the <em>Malleus Maleficarum</em>
            (&ldquo;The Hammer of Witches&rdquo;), written by the Dominican inquisitors Heinrich
            Kramer and Jacob Sprenger in 1486, with a (probably forged) papal endorsement from
            Innocent VIII. It is not a work of theology but of prosecution — a manual for identifying,
            interrogating, and executing witches. But its demonology is consistent with the mainstream
            theological tradition: demons are real, powerful, and specifically interested in corrupting
            human sexuality.
          </p>

          <div className="bg-warm rounded-xl p-6 border border-border-light my-8">
            <p className="text-secondary italic font-body leading-relaxed mb-3">
              &ldquo;In them, according to Dionysius, there is an irrational fury, a mindless lust,
              and an unceasing appetite for injury. They are the enemies of all righteousness,
              whether divine or human.&rdquo;
            </p>
            <p className="text-sm text-muted">
              <Link
                href="/book/69523495ab34727b1f044a45"
                className="text-accent-rust hover:underline"
              >
                Malleus Maleficarum
              </Link>
              , Kramer &amp; Sprenger, 1486
            </p>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The <em>Malleus</em> went through at least 14 editions before 1520 and became the
            standard reference work for witch trials across Catholic and, later, Protestant Europe.
            The Source Library copy is the 1486 first edition — the year of initial publication, one
            of the rarest and most consequential books in the history of persecution.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            A century later, the Protestant Reformation did not soften the demonology. If anything,
            it intensified it. King James VI of Scotland (later James I of England) wrote his{' '}
            <em>Daemonologie</em> in 1597, partly as a response to skeptical humanists like Reginald
            Scot who doubted that witches had any real power at all. James was a convinced believer —
            he personally supervised the torture of accused witches in the North Berwick trials, and
            he would later sponsor the translation of the Bible that bears his name.
          </p>

          <div className="bg-warm rounded-xl p-6 border border-border-light my-8">
            <p className="text-secondary italic font-body leading-relaxed mb-3">
              &ldquo;The fearefull aboundinge at this time in this countrie, of these detestable
              slaues of the Deuill, the Witches or enchaunters, hath moved me (beloued reader) to
              dispatch in post, this following treatise of mine, not in any wise (as I protest) to
              serue for a shew of my learning &amp; ingine, but onely (mooued of conscience) to
              preasse thereby, so farre as I can, to resolue the doubting harts of many.&rdquo;
            </p>
            <p className="text-sm text-muted">
              <Link
                href="/book/694fe5f9f844de8615417df6"
                className="text-accent-rust hover:underline"
              >
                Daemonologie
              </Link>
              , King James VI of Scotland, 1597 — Preface
            </p>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            James&rsquo;s <em>Daemonologie</em> is organized as a Socratic dialogue in three books:
            the first on magic and necromancy, the second on witchcraft, the third on spectres and
            apparitions. His demon theory is orthodox Calvinist: Satan operates through human agents
            (witches) who have entered into a formal pact, and the reality of this operation is
            proven by Scripture, reason, and the testimony of those who have confessed under
            examination.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            What makes these texts genuinely strange to read today is not their cruelty — we expect
            that — but their intellectual seriousness. Both Kramer and James are arguing from
            premises that their educated contemporaries shared. The question was not whether demons
            existed but what they could do and whether humans could make binding agreements with them.
            The demonological literature of the 15th–17th centuries is not superstition dressed up as
            theology. It <em>is</em> theology — systematic, argued, institutionally supported.
          </p>
        </section>

        {/* V. The Ceremonial Magic Approach */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">
            V. The Ceremonial Magician: Working With Demons
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The grimoire tradition takes a view that is technically incompatible with Christian
            demonology but practically coexisted with it for centuries: demons are real, they are
            powerful, and if you know the right procedures you can command them.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The <em>Lemegeton</em>, or <em>Lesser Key of Solomon</em>, is the most famous of the
            Solomonic grimoires — collections of magical procedures attributed (falsely but
            conventionally) to the biblical king whose power over demons was legendary. The first book
            of the <em>Lemegeton</em> is the <em>Goetia</em>, which names and describes 72 demons
            with their ranks, powers, seals, and the methods for evoking and binding them.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The <em>Goetia</em>&rsquo;s procedure begins with a ritual of self-purification and
            authorization. The magician enters a circle, invokes the authority of God and the angels,
            and then calls the demon into a triangle outside the circle. The crucial element is that
            the magician does not worship the demon — the magician commands it, in God&rsquo;s name.
            This distinction allowed grimoire practitioners to argue (with varying plausibility) that
            their practice was consistent with Christian piety.
          </p>

          <div className="bg-warm rounded-xl p-6 border border-border-light my-8">
            <p className="text-secondary italic font-body leading-relaxed mb-3">
              &ldquo;I invoke thee, the one in the void spirit, terrible, invisible, Almighty God of
              Gods, who created the earth and the firmament, who created the night and the day, thou
              who didst create the light and the darkness. I call upon thee, the holy and great
              name&hellip; Come thou forth and follow, and make all spirits subject unto me, so that
              every spirit of the firmament and of the ether, upon the earth and under the earth, on
              dry land and in the water, of whirling air and of rushing fire, and every spell and
              scourge of God, may be obedient unto me.&rdquo;
            </p>
            <p className="text-sm text-muted">
              <Link
                href="/book/695285d5ab34727b1f04c36f"
                className="text-accent-rust hover:underline"
              >
                The Lesser Key of Solomon (Goetia)
              </Link>{' '}
              — the Bornless Ritual
            </p>
          </div>

          <figure className="my-10">
            <Link href="/gallery/image/695285d5ab34727b1f04c378-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/api/crop-image?url=https%3A%2F%2F3kwioilsplnmnkv8.public.blob.vercel-storage.com%2Farchived%2F695285d5ab34727b1f04c36f%2F9.jpg&x=0.132&y=0.086&w=0.738&h=0.806"
                alt="Grid of demon seals from the Goetia (Lesser Key of Solomon), showing geometric sigils used in ceremonial evocation"
                className="w-full max-w-md mx-auto rounded-lg shadow-md"
              />
            </Link>
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              Seals of the 72 demons from the <em>Goetia</em> (Lesser Key of Solomon).{' '}
              <Link href="/gallery/image/695285d5ab34727b1f04c378-0" className="text-accent-rust hover:text-accent-rust not-italic">View in gallery &rarr;</Link>
            </figcaption>
          </figure>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The language here is liturgical, not adversarial. The magician is praying to God while
            commanding a demon — a theological contortion that church authorities found unpersuasive.
            Grimoire magic was consistently condemned by the Church. The Fourth Book of Occult
            Philosophy, attributed (probably falsely) to Heinrich Cornelius Agrippa, acknowledges
            this tension and attempts to resolve it by restricting spirit contact to angels and to
            the &ldquo;good daemons&rdquo; of the Neoplatonic tradition.
          </p>

          <div className="bg-warm rounded-xl p-6 border border-border-light my-8">
            <p className="text-secondary italic font-body leading-relaxed mb-3">
              &ldquo;Good Daemons do indeed perform their offices, not out of fear of punishment or
              for the sake of reward, but out of good will and divine love&hellip; The evil daemons
              do nothing else but hinder and obstruct the operations of good men, and make the wicked
              their instruments.&rdquo;
            </p>
            <p className="text-sm text-muted">
              <Link
                href="/book/694fe602f844de8615417e27"
                className="text-accent-rust hover:underline"
              >
                Fourth Book of Occult Philosophy
              </Link>
              , attributed to Agrippa
            </p>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The grimoire tradition was never unified. Different texts took different positions on
            whether the spirits named were fallen angels, planetary intelligences, jinn, Neoplatonic
            daimones, or something else entirely. What they shared was the operational assumption that
            these entities could be reached, and that the correct procedures would compel their
            cooperation.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* Conclusion */}
        <section className="mb-16">
          <h2 className="font-serif text-3xl text-primary mb-6">The Reversal</h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The trajectory from Greek <em>daimōn</em> to Christian <em>daemon</em> is not a story of
            growing sophistication. It is a story of increasing hostility to the category itself. The
            Greek daimōn was ontologically neutral or positive — a go-between, a helper, sometimes a
            guide. The Hermetic daemon was your guardian. The Christian demon is your enemy.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            What drove the transformation was not better evidence but institutional politics. Early
            Christian missionaries needed to discredit the religious practices of the cultures they
            were converting. The most efficient way to do this was to assimilate the indigenous spirits
            into a category of cosmic evil — not to deny their existence (which would have been
            harder to argue), but to assert that they were malevolent, that working with them was
            damnation, and that the Church had replaced them with a better offer.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The Islamic tradition avoided this demonization partly because it was not in the same
            business of wholesale displacement. The jinn were already part of Quranic cosmology,
            present from the beginning of the tradition rather than inherited from a culture being
            absorbed. They could be morally complex because they did not need to be systematically
            condemned.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            What Source Library makes visible, if you read across these traditions, is the
            extraordinary diversity of answers that human cultures have given to the same question: are
            there invisible intelligences, and if so, what are they for? The Greek philosopher, the
            Hermetic initiate, the Islamic scholar, the Christian inquisitor, and the Renaissance
            magician all say yes — and then completely disagree about everything else.
          </p>
        </section>

        {/* Primary Sources */}
        <div className="mt-16 pt-8 border-t border-border-light">
          <h3 className="font-serif text-2xl text-primary mb-6">Primary Sources in Source Library</h3>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              {
                href: '/book/6952062aab34727b1f0432aa',
                title: 'Pimander (Corpus Hermeticum)',
                detail: 'Marsilio Ficino translation, 1493 — editio princeps',
              },
              {
                href: '/book/6953a93977f38f6761bd58f4',
                title: 'Hermetica (Scott translation)',
                detail: 'Walter Scott, Vol. I — includes Asclepius',
              },
              {
                href: '/book/69523495ab34727b1f044a45',
                title: 'Malleus Maleficarum',
                detail: 'Kramer & Sprenger, 1486 first edition',
              },
              {
                href: '/book/694fe5f9f844de8615417df6',
                title: 'Daemonologie',
                detail: 'King James VI of Scotland, Edinburgh 1597',
              },
              {
                href: '/book/695285d5ab34727b1f04c36f',
                title: 'Lesser Key of Solomon (Goetia)',
                detail: 'The 72 demons — seals, ranks, and procedures',
              },
              {
                href: '/book/694fe602f844de8615417e27',
                title: 'Fourth Book of Occult Philosophy',
                detail: 'Attributed to Agrippa — spirit contact theory',
              },
              {
                href: '/book/6953b56577f38f6761bd979d',
                title: 'Kitab al-Bulhan',
                detail: 'Bodleian MS Arab d. 84 — illustrated jinn taxonomy',
              },
            ].map((source) => (
              <Link
                key={source.href}
                href={source.href}
                className="flex items-start gap-3 p-4 rounded-lg bg-warm border border-border-light hover:border-accent-gold/20 hover:shadow-sm transition-all group"
              >
                <svg
                  className="w-4 h-4 text-muted mt-0.5 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                  />
                </svg>
                <div>
                  <p className="text-sm font-medium text-primary group-hover:text-accent-gold-dark transition-colors">
                    {source.title}
                  </p>
                  <p className="text-xs text-muted mt-0.5">{source.detail}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </article>

      <BlogComments slug="demonology" />
    </ContentPageLayout>
  );
}
