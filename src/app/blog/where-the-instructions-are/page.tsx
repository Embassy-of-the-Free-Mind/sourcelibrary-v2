import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

const HERO = 'https://images.sourcelibrary.org/gallery/6992ce183ea667fbac8281b4/6992ce193ea667fbac8281b8-0.jpg';
const HERO_ALT =
  'Woodcut from the Sancai tuhui of 1609: a seated figure performing the exercise prescribed for the fortnight of Rain Water, with the instruction printed beside him.';

export const metadata: Metadata = {
  title: 'Where the Instructions Are - Research Notes - Source Library',
  description:
    'We asked the library how people were taught to move, breathe and sit. China and India answered immediately. The West came back empty — and the emptiness was in the question, not the shelves.',
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: 'Where the Instructions Are',
    description:
      'We asked the library how people were taught to move, breathe and sit. The West came back empty — and the emptiness was in the question, not the shelves.',
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/blog/where-the-instructions-are' },
};

const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';
const TH = 'text-left font-medium text-primary py-2 pr-4 border-b border-border-light';
const TD = 'py-2 pr-4 align-top border-b border-border-light text-secondary';
const A = 'text-accent-rust hover:underline';
const QUOTE =
  'border-l-2 border-border-light pl-5 my-6 text-secondary font-body leading-relaxed';

export default function WhereTheInstructionsArePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Where the Instructions Are"
          subtitle="We asked the library how people were taught to move, breathe and sit. China and India answered at once. The West came back empty — and the emptiness turned out to be in our question."
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">15 September 2026 &middot; 11 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link href="/blog" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Almost every tradition in this library tells someone how to hold their body. Where to put
          the heel, how long to keep the breath in, which knee touches the ground first, how many
          times to repeat it. We went looking for those passages — not descriptions of what people
          did, but the instructions themselves, in the language they were printed in.
        </p>
        <p className={P}>
          Two traditions answered immediately. One appeared to have nothing at all. The interesting
          part of this note is that third result, because it was wrong, and it was wrong in a way
          that is easy to repeat: we had searched with one tradition&apos;s vocabulary and concluded
          something about another tradition&apos;s shelves.
        </p>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>A posture for every fortnight</h2>
          <p className={P}>
            The clearest case is Chinese. The{' '}
            <Link href="/book/6992ce183ea667fbac8281b4" className={A}>
              Sancai tuhui
            </Link>
            , the illustrated encyclopedia printed in 1609, devotes a chapter to{' '}
            <em>daoyin</em> — guiding and pulling. It runs through the twenty-four solar terms of
            the year, and gives each fortnight its own exercise: a woodcut of the posture, then the
            instruction, then what it is for. Sit facing a direction, raise one arm, hold, turn the
            head, repeat a stated number of times, swallow the saliva three times, and the illness
            this treats is named.
          </p>
          <p className={P}>
            The same chapter then gives the Eight Brocades, and elsewhere in the library the Five
            Animal Frolics survive in their oldest form, attributed to the surgeon Hua Tuo in the
            second century and preserved in a Daoist collection: the tiger on all fours throwing
            itself forward three times and back twice, the bear lying on its back and pulling the
            knees in, the bird standing on one leg with the arms spread, each with its count.
          </p>
          <p className={P}>
            And the counted breath, from the <em>Baopuzi</em> of about 320:
          </p>
          <blockquote className={QUOTE}>
            &ldquo;In first learning to circulate the breath, draw it in through the nose and hold
            it; count silently in the mind to a hundred and twenty, then let it out gently through
            the mouth&hellip; Lay a goose feather on the nose and mouth: when you breathe out and the
            feather does not stir, that is the sign. Increase the count little by little; in time it
            may reach a thousand.&rdquo;
          </blockquote>
          <p className={P}>
            That is a test with a pass condition. It is the kind of writing we were looking for.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>Four fingers from chin to chest</h2>
          <p className={P}>
            Sanskrit answered too, but in a different genre — not the root text, the{' '}
            <em>commentary</em>. The{' '}
            <Link href="/book/6991d89a8c1030b12444c076" className={A}>
              Haṭhayogapradīpikā printed with its commentaries
            </Link>{' '}
            names eighty-four postures and describes four. The verse on the adept&apos;s seat says
            to press the heel to the perineum, put the other foot above the genitals, fix the chin
            at the heart and look between the eyebrows. It is the commentary that says which heel
            (the left), which foot goes on top (the right), and how far the chin sits from the
            chest: four fingers. The secret, the commentator says, is the gap.
          </p>
          <p className={P}>
            Counted breath appears here too, and in a form a stopwatch would recognise. A Sanskrit
            leaf preserved at Gangtey in Bhutan gives prāṇāyāma as thirty-two measures in,
            sixty-four held, thirty-two out.
          </p>
          <p className={P}>
            Then there is a third Indian genre we had not expected to find: the{' '}
            <Link href="/gallery?q=sritattvanidhi" className={A}>
              drawn plate
            </Link>
            . The <em>Śrītattvanidhi</em>, compiled at the Mysore court around 1800, is the earliest
            large illustrated series of āsanas, and it is the ancestor of the modern photographed
            sequence. We hold fourteen of its plates as artworks — the crow, the serpent, the dove,
            the elephant, the plough, the drawn bow — each on its own page. Alongside them sits a
            Tibetan manuscript leaf showing six figures{' '}
            <Link href="/book/69e761bdcc48e59ad74f15ce?page=276" className={A}>
              in sequence
            </Link>
            : ’khrul ’khor, the magical movement, drawn as a series because it is performed as one.
            A score, not a portrait.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>The West comes back empty</h2>
          <p className={P}>
            Then we asked the same question of European books, and got almost nothing. We searched
            for the words a posture manual uses — posture, position, stand, sit, hold, repeat,
            times, breath — across Latin, Greek, French and German, and the results were either
            medical or devotional generalities. It was tempting to write the obvious sentence:{' '}
            <em>the West did not produce this genre.</em>
          </p>
          <p className={P}>
            Some of what we found is genuinely close, and worth naming. Girolamo Mercuriale&apos;s{' '}
            <Link href="/book/6a09dd1624d4d312f5c30b35" className={A}>
              De arte gymnastica
            </Link>{' '}
            of 1573 gives a graded weight progression, quoting Caelius Aurelianus: first wax for the
            hands to soften, then handles the wrestlers call <em>halteres</em>, first of wax or of
            wood with a little lead shut inside, then heavier ones in proportion to progress. But
            every exercise in Mercuriale is prescribed for a condition; it is a therapy, not a
            practice.{' '}
            <Link href="/book/69af106e266659b71a32212f" className={A}>
              Santorio&apos;s De statica medicina
            </Link>{' '}
            is a regimen of measurement — weigh yourself before and after — and the man sat in his
            weighing chair for thirty years. The closest thing to the Chinese year is a fencing
            book:{' '}
            <Link href="/book/6a6be1c4b7e35edd8ad0421f" className={A}>
              Girard Thibault&apos;s Académie de l&apos;espée
            </Link>{' '}
            of 1628, which draws a circle on the floor scaled to the fencer&apos;s own height and
            then names the letter each foot lands on, eight ordinary steps around.
          </p>
          <p className={P}>
            That is a real asymmetry, and it holds for the medical and athletic shelves. But the
            general conclusion was wrong, and the person who said so was our own director, who asked
            the obvious question: <em>really, no Western rituals?</em>
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>It was in the rites</h2>
          <p className={P}>
            The West did not stop writing the body down. It wrote it inside ritual, where the
            instruction has to be exact because the rite fails if the movement is wrong. Once we
            searched with <em>that</em> vocabulary — kneel, turn, face east, three times, sign,
            prostrate, circle — the shelves filled up, and mostly with books this library was
            already built around.
          </p>
          <p className={P}>
            From a Latin{' '}
            <Link href="/book/69d66608bf5afe33937f8c15" className={A}>
              Key of Solomon
            </Link>
            , on conjuring the spirits into the circle:
          </p>
          <blockquote className={QUOTE}>
            &ldquo;Let the Master re-form the Circle with the sword of art, then raise that sword to
            Heaven as though he would strike the air, and lay his right hand with the sword upon the
            pentacles; and on bended knees let him say before the Most High, with great humility,
            the Confession that follows — which the Disciples must also make, in a lowered voice, so
            that it is not understood.&rdquo;
          </blockquote>
          <p className={P}>
            The{' '}
            <Link href="/book/6955d9568407b7c9ae21298e?page=76" className={A}>
              English Key
            </Link>{' '}
            is more specific still, for the operation that asks to be told a hidden thing: cover head
            and body with the carpet, set the censer with new fire beneath it, lie face down before
            the incense begins to smoke, hold the wand upright and rest your chin against it, and
            hold the strip of parchment to your forehead with your right hand. That is as precise as
            any āsana.
          </p>
          <p className={P}>
            And the counted breath — the thing we thought was Chinese and Indian — turns out to be in
            the Roman ritual, in the{' '}
            <Link href="/book/69925499d5d1c6dbb2bce1cd?page=21" className={A}>
              1615 editio princeps
            </Link>{' '}
            of the <em>Rituale Romanum</em>, at the baptism of an infant:
          </p>
          <blockquote className={QUOTE}>
            <span lang="la">Deinde ter exsufflet leniter in faciem infantis</span> — &ldquo;Then let
            him breathe gently three times upon the face of the infant&rdquo; — and say once: go out
            from her, unclean spirit. &ldquo;Afterward let him make the sign of the Cross with his
            thumb on the forehead and on the breast.&rdquo;
          </blockquote>
          <p className={P}>
            Breath used as an instrument, counted, printed in italic because the italic is the
            rubric: the book distinguishes what is said from what is done. The{' '}
            <Link href="/book/699253ff59cdabeb78f1aa9a?page=64" className={A}>
              Missal
            </Link>{' '}
            does the same for the celebrant&apos;s hands — palm facing palm, fingertips no higher
            than the shoulders and no wider, held so at every extension before the breast.
          </p>
          <p className={P}>
            Two more. A German{' '}
            <Link href="/book/69c26825b82ba5d5beda0f80?page=54" className={A}>
              lodge ritual of the first degree
            </Link>
            , written after 1771: three knocks at the door, answered by the Master with the hammer;
            as the candidate is brought in, all the brothers draw their swords; later he is turned to
            face the Orient to be shown the yoke. A lodge ritual is a movement score for a room full
            of people. And the English{' '}
            <Link href="/book/69592ee9a41e40e9146a4289?page=143" className={A}>
              Ars Notoria
            </Link>{' '}
            of 1657, for an answer that comes in sleep: write Alpha and Omega on your right hand with
            the sign of the cross, put that hand under your right ear, fast the day before, and at
            the second or third hour of the night you will see what you asked for.
          </p>
          <p className={P}>
            Cassian is older than all of them and gives the reason as well as the rule. His account
            of the Egyptian monks, in an{' '}
            <Link href="/book/6953a92e77f38f6761bd5646?page=53" className={A}>
              1872 French edition
            </Link>
            , says they stand through the psalm, prostrate for an instant, then rise promptly and
            stand again with hands outstretched — and they do not stay down, because a body left on
            the floor is more open to distraction, and falls asleep.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>The same grammar, four genres</h2>
          <p className={P}>
            Put beside each other, the instructions are recognisably the same kind of writing. What
            differs is the genre each tradition kept it in — and that is what defeats a search.
          </p>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm font-body">
              <thead>
                <tr>
                  <th className={TH}>Tradition</th>
                  <th className={TH}>Genre that carries the instruction</th>
                  <th className={TH}>A counted example</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className={TD}>Chinese</td><td className={TD}>Illustrated encyclopedia, medical compendium</td><td className={TD}>Hold the breath to a silent count of 120; the feather must not stir</td></tr>
                <tr><td className={TD}>Sanskrit</td><td className={TD}>Verse treatise plus commentary; the painted plate</td><td className={TD}>Chin four fingers from the chest; breath 32 in, 64 held, 32 out</td></tr>
                <tr><td className={TD}>Islamic</td><td className={TD}>Jurisprudence of prayer</td><td className={TD}>Knees, then hands, then forehead and nose; the takbīr drawn out across the rise</td></tr>
                <tr><td className={TD}>Latin Christian</td><td className={TD}>Rubric — the italic beside the words</td><td className={TD}>Breathe three times on the child&apos;s face; hands no higher than the shoulders</td></tr>
                <tr><td className={TD}>Ceremonial magic</td><td className={TD}>Grimoire, book of the art</td><td className={TD}>On bended knees toward the east; the hand under the right ear at the third hour</td></tr>
                <tr><td className={TD}>European martial</td><td className={TD}>Fencing treatise</td><td className={TD}>Eight ordinary steps around a circle scaled to your own height</td></tr>
              </tbody>
            </table>
          </div>
          <p className={P}>
            The Islamic line comes from al-Ghazālī&apos;s <em>Iḥyāʾ ʿulūm al-dīn</em>, in the book on
            the secrets of prayer, which sets out the order in which the body reaches the ground and
            then maps the three syllables of <em>Allāhu akbar</em> onto three points of the rise from
            sitting to standing — sound locked to movement the way the Chinese year locks a posture to
            a fortnight. We hold three printings; the one that carries that volume is a 1937 Cairo
            printing which is not public on the site, and the copy that is public is a modern Beirut
            edition we are now screening for rights. That is a real gap, and naming it is more useful
            than a link that misleads.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>What we bought to answer the question</h2>
          <p className={P}>
            Several of the books above were in the library but not readable. A book here is usually
            transcribed twenty-five pages deep — enough to catalogue and search it — and the rest
            stays a picture until someone has a reason to pay for the whole thing. Answering this
            question was that reason.
          </p>
          <p className={P}>
            Twenty-three books went into one metered budget: fifteen already held and read only to
            page twenty-five, and eight newly imported. Between them, <strong>7,080 pages</strong>{' '}
            were transcribed and <strong>6,507</strong> translated, for about{' '}
            <strong>twenty-seven dollars</strong> of model time. What that bought:
          </p>
          <ul className="list-disc pl-6 mb-6 space-y-2 text-secondary font-body leading-relaxed">
            <li>
              Chao Yuanfang&apos;s <em>Zhubing yuanhou lun</em> of 610 — all nine volumes, the oldest
              body of <em>daoyin</em> prescriptions we hold, now readable in full rather than in its
              first leaves.
            </li>
            <li>
              Sun Simiao&apos;s chapters on nourishing life; the one untranscribed volume of Gao
              Lian&apos;s <em>Zunsheng bajian</em>, which is its exercise chapter; the 1922 Marathi{' '}
              <Link href="/book/6a0e5628b8ad266ebed2350f" className={A}>
                Mallakhamb manual
              </Link>
              , the pole-gymnastics book that still counts repetitions.
            </li>
            <li>
              Thoinot Arbeau&apos;s{' '}
              <Link href="/book/6aa7cf64fd6dd3b07d31d3e7" className={A}>
                Orchésographie
              </Link>{' '}
              of 1589, the first dance manual to tabulate steps against the music bar by bar; and
              three fencing books —{' '}
              <Link href="/book/6aa7cf6bfd6dd3b07d31d4bd" className={A}>
                Marozzo 1550
              </Link>
              ,{' '}
              <Link href="/book/6aa7cf74fd6dd3b07d31d602" className={A}>
                Fabris
              </Link>
              , and the{' '}
              <Link href="/book/6aa7cf7efd6dd3b07d31d70f" className={A}>
                Talhoffer facsimile
              </Link>
              .
            </li>
            <li>
              A manuscript of Abraham Abulafia&apos;s{' '}
              <Link href="/book/6aa7cf86fd6dd3b07d31d96c" className={A}>
                Ḥayyei ha-ʿOlam ha-Ba
              </Link>
              , the letter-and-breath technique, with its circle diagrams.
            </li>
            <li>
              Three accounts of Hopi ceremony —{' '}
              <Link href="/book/6aa7cf92fd6dd3b07d31d9bf" className={A}>
                Fewkes
              </Link>{' '}
              and Voth&apos;s{' '}
              <Link href="/book/6aa7cf9bfd6dd3b07d31dbde" className={A}>
                Powamu
              </Link>{' '}
              and{' '}
              <Link href="/book/6aa7cfa5fd6dd3b07d31dce1" className={A}>
                Soyal
              </Link>{' '}
              — which are the other kind of document: movement written down by a witness rather than
              by a teacher.
            </li>
          </ul>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>What we got wrong</h2>
          <p className={P}>
            <strong>The empty result was our query.</strong> A whole tradition coming back with
            nothing should be the first thing you distrust, not the last. We had searched the West
            with the vocabulary of a posture manual, and the West keeps its body instructions in
            rubrics and grimoires. The rule we wrote down afterwards: when an entire tradition
            returns empty, suspect the question before the shelves.
          </p>
          <p className={P}>
            <strong>A cheap model reading a hard hand.</strong> We transcribe most books with a small
            fast model and reserve the larger one for difficult scripts. Two Hebrew books here went
            through the small one, and when we read the Abulafia manuscript against its transcription
            by eye, the errors were the dangerous kind: not gibberish, but plausible words.{' '}
            <em>Rav</em>, a teacher, had become <em>ra</em>, an evil one — one letter, opposite
            sense. Eight hundred and sixty-six pages have been re-read with the larger model; the
            lesson is that a confident transcription of a cursive hand needs a human eye on a sample
            before anyone quotes from it.
          </p>
          <p className={P}>
            <strong>An identifier we never checked.</strong> Our own gap list recorded three Internet
            Archive items as prints of the <em>Yijin jing</em>, the sinew-transformation classic that
            stands behind most later qigong sets. They are not: they are issues of an 1855 Hong Kong
            missionary serial that a search had matched on a fragment of the characters. Nobody had
            opened them. An identifier that arrives from a search is a candidate; only the item&apos;s
            own metadata makes it a source.
          </p>
          <p className={P}>
            <strong>A book that blocked itself.</strong> When several volumes of one work share an
            identity, our pipeline skips a volume if a sibling is marked complete — and a volume read
            only twenty-five pages deep is marked complete. All nine Chao Yuanfang volumes were
            therefore skipping each other. They were transcribed by a direct route instead, and the
            defect is filed.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>Still closed</h2>
          <p className={P}>
            The <em>Yijin jing</em> is not held, and we no longer have a scan located for it. Ignatius
            of Loyola&apos;s <em>Exercitia spiritualia</em>, which adds posture and a breath-paced
            method of prayer to the retreat, is held but unreadable: only fifteen of its 296 page
            images can be fetched from their source. The Hesychast breath-prayer — the chin on the
            chest, the gaze at the navel, attributed to Nikephoros and to a Symeon — should be in our
            Greek{' '}
            <Link href="/book/6953a54c77f38f6761bcf531" className={A}>
              Philokalia of 1893
            </Link>
            , and we could not find it on a transcribed page; searching the Greek for nostril, navel
            and beard returns nothing. What we did find there is the earliest version of the idea, one
            sentence from Hesychios: join watchfulness and the name of Jesus to your breath and your
            nostrils.
          </p>
          <p className={P}>
            Arbeau aside, the Renaissance dance manuals — Caroso, Negri — have no usable scan we can
            find, and neither do the German fencing books before the nineteenth-century facsimiles.
            If you know of one, the feedback button on any page reaches us.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>Pages to read</h2>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm font-body">
              <thead>
                <tr>
                  <th className={TH}>Page</th>
                  <th className={TH}>What is on it</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className={TD}><Link href="/book/6992ce183ea667fbac8281b4?page=8" className={A}>Sancai tuhui, juan 74 (1609)</Link></td><td className={TD}>The exercise for a named fortnight, woodcut and instruction together</td></tr>
                <tr><td className={TD}><Link href="/book/6991d89a8c1030b12444c076?page=34" className={A}>Haṭhayogapradīpikā with commentaries</Link></td><td className={TD}>Siddhāsana, and the commentary&apos;s four fingers</td></tr>
                <tr><td className={TD}><Link href="/book/6a05f07e6a888f57ebd77205?page=23" className={A}>Baopuzi, inner chapters (c. 320)</Link></td><td className={TD}>Hold to a count of 120; the goose feather test</td></tr>
                <tr><td className={TD}><Link href="/book/69925499d5d1c6dbb2bce1cd?page=21" className={A}>Rituale Romanum (1615)</Link></td><td className={TD}>Three breaths on the infant&apos;s face; the thumb on forehead and breast</td></tr>
                <tr><td className={TD}><Link href="/book/69d66608bf5afe33937f8c15?page=26" className={A}>Clavicula Salomonis</Link></td><td className={TD}>The circle re-formed, the sword raised, bended knees toward the east</td></tr>
                <tr><td className={TD}><Link href="/book/6a6be1c4b7e35edd8ad0421f?page=42" className={A}>Thibault, Académie de l&apos;espée (1628)</Link></td><td className={TD}>Eight steps around the circle, foot by lettered foot</td></tr>
                <tr><td className={TD}><Link href="/book/69e80578fdad300064d9dcb5?page=284" className={A}>Mānasollāsa (c. 1130)</Link></td><td className={TD}>The wrestlers&apos; pillar exercise, ancestor of mallakhamb</td></tr>
                <tr><td className={TD}><Link href="/book/6aa7cf64fd6dd3b07d31d3e7?page=158" className={A}>Arbeau, Orchésographie (1589)</Link></td><td className={TD}>Steps tabulated against the notes of the tourdion</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted font-body">
            All figures were measured on 15 September 2026 and will drift. The transcription run, the
            import list and the defects named above are in the public repository; the plates are in
            the gallery under Śrītattvanidhi.
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
