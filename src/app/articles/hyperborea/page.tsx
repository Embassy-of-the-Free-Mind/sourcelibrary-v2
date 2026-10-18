import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';
import HyperboreaTimeline from './HyperboreaTimeline';

const LEAD_IMAGE = 'https://images.sourcelibrary.org/artwork/art-phaetons-sisters-changed-into-poplars-cygnus-into-a-swan.jpg';
const LEAD_ALT =
  'Engraving after Hendrick Goltzius: the sisters of Phaethon turning into poplars beside his tomb on the river Eridanus, while Cygnus becomes a swan';

export const metadata: Metadata = withArticleMeta('hyperborea', {
  title: 'Beyond the North Wind: Hyperborea and the Amber Coast - Articles - Source Library',
  description:
    'The Greeks placed a blessed people beyond the north wind and said that amber came from the edge of the world. From Herodotus and Pindar to the Prussian and Lithuanian historians who claimed both for the Baltic, read in the books themselves.',
  openGraph: {
    title: 'Beyond the North Wind: Hyperborea and the Amber Coast',
    description:
      'Hyperborea in Herodotus, Pindar and Apollonius, and the Baltic historians who said the Greeks had been describing them.',
    images: [{ url: LEAD_IMAGE, alt: LEAD_ALT }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: LEAD_IMAGE, alt: LEAD_ALT }],
  },
  alternates: {
    canonical: '/articles/hyperborea',
  },
});

function Section({ children }: { children: React.ReactNode }) {
  return <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-secondary leading-relaxed mb-6">{children}</p>;
}

export default function HyperboreaPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title="Beyond the North Wind"
          subtitle="Hyperborea and the amber coast, from Herodotus to the historians of Prussia and Lithuania"
          image={LEAD_IMAGE}
          imageAlt={LEAD_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">16 October 2026 &middot; 33 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          In the fifth century BCE the priests of Delos told Herodotus that every year a bundle arrived on their island
          from the far north, wrapped in wheat straw. It had passed from people to people across the whole of Europe.
          Nobody on Delos had met the senders. The Greeks called them the <em>Hyperboreans</em>, the people beyond
          the north wind. In another book Herodotus admits he cannot say where the north ends, only that{' '}
          <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=163">
            amber reaches Greece from there
          </Link>
          . Two thousand years later, historians on the Baltic coast put those two passages together and concluded
          that the Greeks had been writing about them.
        </p>

        <P>
          This note follows Hyperborea through the books Source Library holds: the Greek poets and historians who
          described it, the scholars of the sixteenth to eighteenth centuries who each found it in their own country,
          and the historians of Prussia, Latvia and Lithuania who joined it to the one northern thing a Greek could
          hold in his hand. Many of these books are in the library&apos;s{' '}
          <Link href="/collections/baltic-paganism">
            Baltic Paganism
          </Link>{' '}
          collection, translated into English for the first time.
        </P>

        <Section>What the Greeks said</Section>

        <P>
          The oldest sources treat Hyperborea as a place that cannot be reached. Pindar, writing for a victor at the
          Pythian games in 498 BCE, puts it at the limit of human striving:
        </P>

        <SourceQuote
          book="the-odes-of-pindar-sandys"
          page={347}
          src="https://images.sourcelibrary.org/pages/69924f3f09c5da0cf50d7b8d/0347.jpg"
          source={<>Pindar, <em>Pythian</em> 10, tr. J. E. Sandys (1915)</>}
          pageAlt="Page of Sandys's English translation of Pythian 10, with the passage on the road to the Hyperboreans"
        >
          Neither by ships nor by land canst thou find the wondrous road to the trysting-place of the Hyperboreans.
          Yet among them, in olden days, Perseus, the leader of the people, shared the banquet on entering their homes
          and finding them sacrificing famous hecatombs of asses in honour of the god.
        </SourceQuote>

        <P>
          The god is Apollo. The Hyperboreans are his people: he spends the winter with them, and they live long and
          free of sickness and war. Herodotus, a generation later, is the first to say plainly that he does not know
          whether they exist. Neither the Scythians nor anyone else in the north, he writes, has anything to say about
          them; the reports come from poets (Hesiod and the epic <em>Epigoni</em>) and from Delos. The Delians&apos;
          story is the strangest thing in his account:
        </P>

        <SourceQuote
          book="the-persian-wars-ii-books-3-4-loeb-l118-herodotus"
          page={254}
          src="https://images.sourcelibrary.org/pages/69937cdac970b9f8351dd273/0254.jpg"
          source={<>Herodotus, <em>Histories</em> 4.33, Loeb edition (1921), English translation by Source Library</>}
          pageAlt="Page of the Loeb Herodotus, Book IV chapters 31 to 33, on the Hyperboreans and the offerings wrapped in wheat-straw"
        >
          They claim that sacred offerings wrapped in wheat-straw are brought from the Hyperboreans into Scythia.
          When they have passed through Scythia, each neighboring nation receives them in turn until they are carried
          as far west as the Adriatic Sea. From there, they are brought southward, and the people of Dodona are the
          first of the Greeks to receive them.
        </SourceQuote>

        <P>
          At first, the Delians said, the Hyperboreans sent two girls, Hyperoche and Laodice, with an escort of five
          men. None of them came home. After that the Hyperboreans carried the bundle only to their own border and
          asked their neighbours to pass it on. The girls&apos; tomb was still shown on Delos, under an olive tree to
          the left of the temple of Artemis, and Delian boys and girls cut a lock of their hair before marriage and
          laid it there. Herodotus{' '}
          <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=255">
            adds a detail he had seen himself
          </Link>
          : Thracian and Paeonian women never sacrificed to Artemis without wheat straw.
        </P>

        <P>
          Then he steps back. He will not tell the story of the Hyperborean Abaris, who{' '}
          <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=257">
            carried an arrow all around the world without eating
          </Link>
          , and he points out the symmetry the idea depends on: if there are people beyond the north wind, there must
          be people beyond the south wind too. He laughs at the mapmakers who draw the earth as a perfect circle.
        </P>

        <P>
          Later writers repeated the poets rather than the doubter. Pliny the Elder, in the first century CE, set the
          Hyperboreans behind the Rhipaean mountains, the range the Greeks imagined along the top of the world, where
          the sun rises once a year and sets once a year and the old, tired of living, feast and then leap into the
          sea. Solinus, copying Pliny two centuries later, decided that so many authors could not be wrong:{' '}
          <Link href="/book/c-iulii-solini-polyhistor-1543-solinus?page=79">
            &ldquo;let no one fear the false. We shall, therefore, speak of the Hyperboreans.&rdquo;
          </Link>{' '}
          Diodorus of Sicily, drawing on the lost Hecataeus of Abdera, made Hyperborea an island &ldquo;no smaller
          than Sicily&rdquo; opposite the land of the Celts, with a round temple where Apollo came every nineteen
          years. The German antiquary Johann Georg Keyssler{' '}
          <Link href="/book/dissertatio-de-cultu-solis-keyssler?page=26">
            was still quoting the passage in 1728
          </Link>{' '}
          in a dissertation on sun worship.
        </P>

        <Section>Abaris and the golden arrow</Section>

        <P>
          The one Hyperborean with a name is Abaris, priest of Apollo. Herodotus gives him a single sentence and
          refuses to repeat the story. The later lives of Pythagoras, written in the third and fourth centuries CE
          by Porphyry and Iamblichus, give him a career. In Iamblichus he comes south{' '}
          <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=189">
            &ldquo;gathering gold for the temple and predicting a plague. He stayed in the temples, and he was never
            seen drinking or eating anything.&rdquo;
          </Link>{' '}
          He performs purifications at Sparta, after which, the story goes, Sparta never had the plague again;
          Pausanias, as an Italian literary historian{' '}
          <Link href="/book/istoria-de-poeti-greci-et-di-que-che-n-greca-lingua-han-crasso?page=17">
            noted in 1678
          </Link>
          , credits him with founding the Spartan temple of Kore the Saviour.
        </P>

        <P>
          Then he meets Pythagoras. Iamblichus describes him as an old man from the north,{' '}
          <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=153">
            &ldquo;inexperienced in Greek education and uninitiated&rdquo;
          </Link>
          , and says Pythagoras waived the five years of silence his other pupils served and taught him the doctrine
          of nature and of the gods in brief. Abaris takes Pythagoras for the god he serves, and is shown the proof:
        </P>

        <SourceQuote
          book="de-vita-pythagorica-liber-codex-florentinus-nauck"
          page={185}
          src="https://images.sourcelibrary.org/pages/69d144c11c2a66dc094b1de5/0185.jpg"
          source={<>Iamblichus, <em>On the Pythagorean Life</em> 28, ed. A. Nauck (1884), English translation by Source Library</>}
          pageAlt="Page of Nauck's Greek text of Iamblichus, chapter 28, with the golden thigh shown to Abaris"
        >
          For the fact that he displayed his golden thigh to Abaris the Hyperborean, who had surmised that he was the
          Apollo who is among the Hyperboreans, of whom Abaris was a priest, confirming that his assumption was true and
          not a deception, is very famous.
        </SourceQuote>

        <P>
          Pythagoras also takes away Abaris&apos;s golden arrow,{' '}
          <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=189">
            &ldquo;without which he was unable to find his way.&rdquo;
          </Link>{' '}
          Near the end of the book the two men stand together before Phalaris, the tyrant of Acragas, and Abaris{' '}
          <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=238">
            asks &ldquo;concerning statues, the most holy forms of worship, the providence of the gods&rdquo;
          </Link>{' '}
          while Phalaris rages and blasphemes. The Hyperborean in these stories is a pious foreigner who confirms
          that Pythagoras is divine. His homeland matters only as the place Apollo goes when he leaves Greece.
        </P>

        <P>
          The arrow is what people remembered. In Porphyry and Iamblichus it is Apollo&apos;s gift, and Abaris
          rides it: as the German collector of magic lore Eberhard David Hauber quoted the Greek in 1739,{' '}
          <Link href="/book/bibliotheca-acta-et-scripta-magica-vol-ii-hauber?page=111">
            &ldquo;he crossed rivers and seas and impassable places, walking through the air, as it were.&rdquo;
          </Link>{' '}
          Hyginus made it the arrow Apollo shot the Cyclopes with and then hid under a mountain in the north. The
          pagan critic Celsus held Abaris up against Jesus as a man nobody called a god although he flew on an
          arrow, and Origen answered with a question:{' '}
          <Link href="/book/opera-omnia-xviii-contra-celsum-i-iv-lommatzsch-origen?page=302">
            &ldquo;what did he himself gain by being carried on an arrow?&rdquo;
          </Link>
        </P>

        <P>
          Christian writers kept the arrow as a figure. Gregory of Nazianzus, in his funeral oration for Basil, set
          the arrow of Abaris beside Pegasus as things whose flight mattered less than lifting the mind to God, and
          Erasmus entered it in his <em>Adages</em>:{' '}
          <Link href="/book/adagiorum-opus-erasmus-desiderius?page=1096">
            <em>Abaridos oistos</em>, &ldquo;the arrow of Abaris, is said of those who are swift&rdquo;
          </Link>
          . Nicolas Caussin&apos;s emblem book of 1623 glosses it as{' '}
          <Link href="/book/polyhistor-symbolicus-electorum-symbolorum-amp-parabolarum-caussin-2?page=587">
            &ldquo;a mind contemplating God, or fame.&rdquo;
          </Link>{' '}
          Later readers tried to explain it. Pierre Bayle, in a note Hauber summarised in 1738, compared it to the
          dowsers&apos; divining rod and judged that the rod, which found{' '}
          <Link href="/book/bibliotheca-acta-et-scripta-magica-grundliche-nachrichten-hauber?page=856">
            &ldquo;treasures, metals, the boundaries of fields, thieves, and murderers,&rdquo;
          </Link>{' '}
          was &ldquo;no less wonderful than the arrow of Abaris.&rdquo; Godfrey Higgins guessed in 1827 that{' '}
          <Link href="/book/the-celtic-druids-or-an-attempt-to-show-that-the-druids-higgins?page=340">
            &ldquo;perhaps this arrow was the magnetic needle,&rdquo;
          </Link>{' '}
          and the Welsh antiquary Edward Davies suggested it had been{' '}
          <Link href="/book/celtic-researches-on-the-origin-traditions-language-of-the-davies?page=293">
            an arrow of straw
          </Link>
          , like the straw the Hyperborean offerings came wrapped in.
        </P>

        <div className="max-w-md mx-auto">
          <PageFigure
            src="https://images.sourcelibrary.org/pages/6a09ece3b4da373307f15cf4/1096.jpg"
            alt="Two-column page of Latin and Greek from Erasmus's Adages, with the entry Abaridis sagitta in the left column"
            href="/book/adagiorum-opus-erasmus-desiderius?page=1096"
            source={<>Erasmus, <em>Adagiorum opus</em> (1578)</>}
          >
            <em>Abaridis sagitta</em>, the arrow of Abaris, in the left column of Erasmus&apos;s <em>Adages</em>.
          </PageFigure>
        </div>

        <P>
          Where he came from was argued as hard as where Hyperborea was. Higgins summed up the British debate:
        </P>

        <SourceQuote
          book="the-celtic-druids-or-an-attempt-to-show-that-the-druids-higgins"
          page={340}
          src="https://images.sourcelibrary.org/pages/69ee4f106dd925d126f42acd/0340.jpg"
          source={<>Godfrey Higgins, <em>The Celtic Druids</em> (1827)</>}
          pageAlt="Page 124 of Higgins's Celtic Druids, headed Abaris probably a native of Ireland"
        >
          Every true and loyal Scot is certain that he came from the Hebrides: Mr. Vallencey proves, as clear as the
          sun at noon, that he was an Irishman. This seems odd to the Welshmen, who are quite certain that he came
          from Wales; and Mr. Borlase does not fail to secure him for Cornwall.
        </SourceQuote>

        <P>
          In 1706 Carl Gottfried Zapf devoted a whole academic disputation to Abaris. He collected every ancient
          witness and then declined to locate the man&apos;s homeland, because{' '}
          <Link href="/book/disp-hist-de-abaride-zapf?page=20">
            &ldquo;to designate in what region that people held a fixed seat is dangerous&rdquo;
          </Link>
          : what the authors wrote about the northern ocean was &ldquo;very unknown and uncertain.&rdquo; The
          historian of philosophy Jacob Brucker put the problem more sharply in 1742: the Pythagoreans&apos;{' '}
          <Link href="/book/historia-critica-philosophiae-brucker?page=374">
            enthusiasm for Abaris &ldquo;strangely obscured his history.&rdquo;
          </Link>{' '}
          The alchemist Johann Ludwig Hannemann went the other way. He read the Hyperborean birth of Apollo and Diana
          as a code for the red and white stones of the Great Work, and concluded that{' '}
          <Link href="/book/ovum-hermetico-paracelsico-trismegistum-hannemann?page=208">
            the art had first flourished among that people
          </Link>{' '}
          and spread from them to the rest of the world (1694).
        </P>

        <P>
          Modern scholars read Abaris with a second figure from Herodotus, Aristeas of Proconnesus, who{' '}
          <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=235">
            said in his epic verses that, while possessed by Apollo, he reached the Issedones
          </Link>
          , and that beyond them lived the one-eyed Arimaspians, the gold-guarding griffins and, last, the
          Hyperboreans by the sea. E. R. Dodds, in <em>The Greeks and the Irrational</em> (1951), grouped the two
          with Hermotimus and Epimenides as Greek &ldquo;shamans&rdquo;: holy men who fasted, travelled out of the
          body and came, or were said to come, from the Scythian north. Walter Burkert developed the argument for the
          Pythagorean tradition. On that reading the arrow is a memory of a real practice seen at second hand, and
          Abaris is less a visitor from Hyperborea than the Greeks&apos; picture of a northern holy man.
        </P>

        <Section>Other travellers from the north</Section>

        <P>
          Abaris was not alone. Greek cult stories kept bringing people, gods and things south from Hyperborea,
          almost always to Delos or Delphi. Pausanias, in the second century CE, collected many of them.
        </P>

        <ul className="list-disc pl-6 space-y-3 text-secondary leading-relaxed mb-6">
          <li>
            <strong>The Delian maidens.</strong> Herodotus names two pairs: Hyperoche and Laodice with their five
            escorts, and before them Arge and Opis, who came &ldquo;at the same time as the gods themselves.&rdquo;
            Later poets added Opis and Hecaerge, and Olen&apos;s hymn brought a third, Achaeia,{' '}
            <Link href="/book/pausanias-description-of-greece-vol-1-frazer?page=346">
              &ldquo;to Delos from these Hyperboreans.&rdquo;
            </Link>
          </li>
          <li>
            <strong>Eileithyia,</strong> goddess of childbirth, who in the Athenian story{' '}
            <Link href="/book/pausanias-description-of-greece-vol-1-frazer?page=125">
              &ldquo;is said to have come from the Hyperboreans to Delos to help Latona in her pangs.&rdquo;
            </Link>{' '}
            Diodorus said Leto herself was born among the Hyperboreans, which is why Apollo was honoured there above
            all gods.
          </li>
          <li>
            <strong>The founders of Delphi.</strong> The Delphian poetess Boeo wrote that the oracle was set up by
            Hyperboreans, Pagasus and Agyieus, and that{' '}
            <Link href="/book/pausanias-description-of-greece-vol-1-frazer?page=605">
              Olen, who came with them, &ldquo;was the first to give oracles and sing in hexameters.&rdquo;
            </Link>{' '}
            Herodotus calls Olen a Lycian; Boeo made him a northerner. The Delphians also said their second temple,
            made by bees{' '}
            <Link href="/book/pausanias-description-of-greece-vol-1-frazer?page=606">
              &ldquo;out of wax and feathers,&rdquo; was &ldquo;sent to the Hyperboreans by Apollo.&rdquo;
            </Link>
          </li>
          <li>
            <strong>Two ghost warriors.</strong> When the Gauls attacked Delphi in 279 BCE, thunderbolts and
            falling rocks drove them off, and{' '}
            <Link href="/book/pausanias-description-of-greece-vol-1-frazer?page=106">
              &ldquo;two of these phantom warriors, Hyperochus and Amadocus, came from the Hyperboreans.&rdquo;
            </Link>
          </li>
          <li>
            <strong>The olive of Olympia.</strong> Pindar tells how Heracles persuaded{' '}
            <Link href="/book/the-odes-of-pindar-sandys?page=91">
              &ldquo;the servants of Apollo, the people of the Hyperboreans&rdquo;
            </Link>{' '}
            to give him the wild olive from the springs of the Danube, and planted it at Olympia, where it crowned
            the victors.
          </li>
          <li>
            <strong>Aristeas of Proconnesus,</strong> the poet who said he had travelled north possessed by Apollo,
            reappeared at Metapontum in Italy long after his supposed death. The Metapontines set up a{' '}
            <Link href="/book/historiae-commentitiae-dyscolus?page=116">
              bronze laurel &ldquo;when he said he had arrived from the Hyperboreans.&rdquo;
            </Link>
          </li>
        </ul>

        <P>
          The pattern is consistent. What comes from Hyperborea is old and holy: the first prophet, the first
          temple, the first offerings, the olive of the games, help in a sacred war. Hyperborea worked as the source
          Apollo&apos;s worship was believed to have come from, at a distance that kept it pure.
        </P>

        <Section>Apollo&apos;s tears</Section>

        <P>
          Hyperborea and the Baltic meet in a story about amber. The Greeks said that when Phaethon crashed the
          chariot of the Sun into the river Eridanus, his sisters, the Heliades, mourned on its bank until they turned
          into poplars, and their tears hardened into amber. Apollonius of Rhodes, in the <em>Argonautica</em> (third
          century BCE), sails his heroes up the Eridanus past the smoking wreck and records a second version:
        </P>

        <SourceQuote
          book="apollonii-rhodii-argonautica-estienne"
          page={210}
          src="https://images.sourcelibrary.org/pages/69b2f33221208ea9dc277d1f/0210.jpg"
          source={<>Apollonius of Rhodes, <em>Argonautica</em> 4.611–617, ed. Henri Estienne (1574), English translation by Source Library</>}
          pageAlt="Page of Estienne's Greek Argonautica, Book 4 lines 597 to 626, with marginal scholia"
        >
          The Celts have made it a tradition that these are the tears of Apollo, son of Leto, which are borne in the
          eddies, which he shed in countless numbers before, when he reached the holy race of the Hyperboreans,
          leaving the gleaming heaven because of his father&apos;s rebuke.
        </SourceQuote>

        <PageFigure src={LEAD_IMAGE} alt={LEAD_ALT} href="/artwork/art-phaetons-sisters-changed-into-poplars-cygnus-into-a-swan" wide>
          The Heliades become poplars by the Eridanus. Engraving after Hendrick Goltzius, from his series on
          Ovid&apos;s <em>Metamorphoses</em> (c. 1590).
        </PageFigure>

        <P>
          Amber was real, and so was the trade that brought it south. Infrared analyses of Bronze Age finds, made by
          Curt Beck and his colleagues at Vassar from the 1960s onward, identified Baltic amber (succinite) in
          Mycenaean Greece. Herodotus knew that amber came from the far north and did not believe the river story
          that explained it. He{' '}
          <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=164">
            did not believe there was a river called Eridanus
          </Link>{' '}
          flowing into a northern sea; the name was Greek, he said, and some poet had made it up
          ; yet{' '}
          <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=165">
            &ldquo;it is from these furthest reaches that both tin and amber come to us.&rdquo;
          </Link>{' '}
          Five centuries later Tacitus
          named the people who gathered it. On the right-hand shore of the Baltic, he writes in the{' '}
          <em>Germania</em>, live the Aestii, who{' '}
          <Link href="/book/tacitus-dialogus-de-oratoribus-agricola-germania-hutton?page=196">
            &ldquo;worship the Mother of the Gods&rdquo; and wear the figures of wild boars
          </Link>{' '}
          as its emblem, and who alone collect amber, which they call <em>glesum</em>, on the beach and in the shallows.
        </P>

        <P>
          Nothing in Herodotus says what was inside the Hyperborean bundles. A commentator on Callimachus&apos;s{' '}
          <em>Hymn to Delos</em>, printed in a 1761 edition of the poet, notes that Pausanias described the
          first-fruits as{' '}
          <Link href="/book/hymni-epigrammata-et-fragmenta-callimachus?page=567">
            &ldquo;hidden in wheaten straw, and recognized by no one.&rdquo;
          </Link>{' '}
          What the Greek sources do record is a chain of hands running out of the north toward Delos, and amber
          arriving along the same kind of chain. Early modern readers took the overlap for an identity.
        </P>

        <Section>Thule and the other edges of the north</Section>

        <P>
          Hyperborea was not the only northern edge, and the others are easy to confuse with it. The difference is
          that Hyperborea came from poets and cult, while Thule came from a traveller. Around 325 BCE Pytheas of
          Massalia (Marseille) sailed north past Britain and reported an island where at midsummer the sun did not
          set. Pliny preserves the distance: Thule is{' '}
          <Link href="/book/the-natural-history-of-pliny-vol-1-elder?page=138">
            &ldquo;six days&apos; sail from the north of Britain.&rdquo;
          </Link>{' '}
          Beyond it, Pytheas said, there was no longer land or sea or air but{' '}
          <Link href="/book/the-geography-of-strabo-vol-1-strabo?page=451">
            &ldquo;a kind of substance concreted from all these elements, resembling a sea-lung.&rdquo;
          </Link>{' '}
          Pliny adds that{' '}
          <Link href="/book/the-natural-history-of-pliny-vol-1-elder?page=374">
            &ldquo;at one day&apos;s sail from Thule is the frozen ocean, which by some is called the Cronian
            Sea.&rdquo;
          </Link>
        </P>

        <PageFigure
          src="/articles/hyperborea/cluver-northern-lands-map.jpg"
          alt="Engraved map of Europe and western Asia: Thule north of Britain under the Mare Cronium, and the word Hyperborei above the Ryphaei montes north of Sarmatia"
          href="/book/germaniae-antiquae-libri-tres-cluver?page=65"
          source={<>Philipp Clüver, <em>Germania antiqua</em> (1616)</>}
          credit="Scan: Early European Books, © 2012 ProQuest LLC, reproduced by courtesy of the Wellcome Trust, London."
          wide
        >
          Clüver&apos;s map of the northern lands of Europe and Asia, drawn, as its cartouche says, &ldquo;to the
          false notion of the ancient writers&rdquo; (<em>ad falsam veterum scriptorum mentem accommodata</em>).
          Thule lies north of Britain beside the Mare Cronium; the <em>Hyperborei</em> live along the Rhipaean
          mountains (<em>Ryphaei montes</em>) at the top of the map. The two halves of the folding plate are joined
          here.
        </PageFigure>

        <P>
          Strabo did not believe a word of it. Gerardus Vossius, listing the charges in 1624, noted that Strabo
          had called Pytheas{' '}
          <Link href="/book/de-historicis-graecis-vossius?page=563">
            <em>andra pseudestaton</em>, &ldquo;a most lying man.&rdquo;
          </Link>{' '}
          The same page shows why Pytheas matters for the amber story. Pliny cites him for an estuary of the
          Guttones, a Germanic people, and an island called Abalus a day&apos;s sail off, where amber washes up in
          spring as &ldquo;a refuse of the congealed sea,&rdquo; which the islanders burn as fuel and sell to the
          Teutons. Pliny also reports that Pytheas called a huge northern island{' '}
          <Link href="/book/the-natural-history-of-pliny-vol-1-elder?page=363">
            Basilia
          </Link>
          , the name Diodorus used for the amber island that Hartknoch would claim as Samland. Pytheas is the
          first Greek who seems to have reached the amber coast, or met people who had. In 1641 Pierre Gassendi, at
          the urging of his friend Peiresc, set out to defend his fellow Provençal:{' '}
          <Link href="/book/viri-illustris-nicolai-claudii-fabricii-de-peiresc-vita-gassendi?page=322">
            &ldquo;Pytheas is the oldest scholar the entire West possesses.&rdquo;
          </Link>
        </P>

        <P>
          Rome kept Thule as the end of the world. Virgil called it <em>ultima Thule</em>, &ldquo;farthest
          Thule,&rdquo; and Tacitus says Agricola&apos;s fleet, rounding Scotland in 83 CE, saw it:{' '}
          <Link href="/book/tacitus-dialogus-de-oratoribus-agricola-germania-hutton?page=121">
            &ldquo;The shores of Thule were even descried.&rdquo;
          </Link>{' '}
          Later writers moved it to wherever the edge of knowledge then lay. Procopius, in the sixth century, made
          Thule Scandinavia, where the Heruli sent{' '}
          <Link href="/book/procopii-caesariensis-opera-omnia-caesarea?page=488">
            to fetch a king of royal blood
          </Link>{' '}
          and where the people, after a{' '}
          <Link href="/book/procopii-caesariensis-opera-omnia-caesarea?page=489">
            &ldquo;great and perpetual night of thirty-five days,&rdquo;
          </Link>{' '}
          sent watchers up the mountains to look for the sun. Adam of Bremen, around 1075, settled it on Iceland:{' '}
          <Link href="/book/gesta-hammaburgensis-ecclesiae-pontificum-bremen?page=212">
            &ldquo;This Thyle is now called Island, from the ice which binds the ocean.&rdquo;
          </Link>{' '}
          Olaus Magnus, the exiled Swedish archbishop, agreed in 1555, calling Iceland{' '}
          <Link href="/book/historia-de-gentibus-septentrionalibus-magnus?page=152">
            &ldquo;the glacial land, or the ultimate Thule.&rdquo;
          </Link>{' '}
          A Greek-Latin edition of Cleomedes printed in 1605{' '}
          <Link href="/book/cleomedis-meteora-graece-et-latine-balfour-1605-cleomedes?page=244">
            lists the rival answers
          </Link>
          : Mercator&apos;s Iceland, Ortelius&apos;s Telemark in Norway, Camden&apos;s Shetland.
        </P>

        <div className="max-w-lg mx-auto">
          <PageFigure
            src="https://images.sourcelibrary.org/pages/699065763dc2ed39a49f155d/0098.jpg"
            alt="Woodcut map of Scandinavia, Finland and the northern seas, with Iceland labelled Islandia at top left"
            href="/book/historia-de-gentibus-septentrionalibus-magnus?page=98"
            source={<>Olaus Magnus, <em>Historia de gentibus septentrionalibus</em> (1555)</>}
          >
            Olaus Magnus&apos;s woodcut map of the northern kingdoms, printed near the start of his history. Iceland,
            his &ldquo;ultimate Thule,&rdquo; is at top left as <em>Islandia</em>.
          </PageFigure>
        </div>

        <P>
          The other names belong to the same map. The Rhipaean mountains were the imagined range along the top of
          the world, behind which lay Hyperborea. Pterophoros, &ldquo;feather-bearing,&rdquo; was the land of
          falling snow that Herodotus explained as a figure of speech. The one-eyed Arimaspians and the griffins
          guarded northern gold. For the Goths the north was a beginning, not an edge: Jordanes, in the sixth
          century, called the island of Scandza{' '}
          <Link href="/book/iordanis-romana-et-getica-jordanes?page=141">
            &ldquo;a workshop of nations or indeed a womb of peoples,&rdquo;
          </Link>{' '}
          and placed it opposite the mouth of the Vistula, close to the amber coast.
        </P>

        <P>
          Learned writers kept Thule and Hyperborea apart for a long time. Toland in 1740 was careful to say that
          by Thule he meant{' '}
          <Link href="/book/a-critical-history-of-the-celtic-religion-and-learning-toland?page=198">
            &ldquo;only that of Pytheas, or Iceland,&rdquo;
          </Link>{' '}
          and by the island of the Hyperboreans the one Diodorus described. The modern occult and racial writers
          merged them. The Thule Society, founded in Munich in 1918, gave Pytheas&apos;s island the qualities of
          Hyperborea and made it a lost homeland of the Aryans. The ancient sources do not support the merger:
          Thule was a place a man said he had sailed to, and Hyperborea was a place no road reached.
        </P>

        <Section>A round temple: Stonehenge?</Section>

        <P>
          The most specific Hyperborean landscape in Greek is the one Diodorus took from Hecataeus of Abdera, who
          wrote around 300 BCE. An island in the ocean opposite the land of the Celts, at least as large as Sicily,
          fertile, with a sacred precinct and a famous round temple, where the god comes
          every nineteen years and the moon looks very close to the earth. Readers in Britain drew the obvious
          conclusion. William Stukeley, in his <em>Stonehenge</em> of 1740, wrote that Diodorus{' '}
          <Link href="/book/stonehenge-stukeley?page=161">
            &ldquo;gives an odd account from thence mix&apos;d with fable, and seemingly some reports of Stonehenge
            itself.&rdquo;
          </Link>{' '}
          William Borlase quoted the moon passage in 1769 as if the islanders{' '}
          <Link href="/book/antiquities-historical-and-monumental-of-the-county-of-borlase?page=114">
            &ldquo;had the use of telescopes&rdquo;
          </Link>
          . John Smith, whose <em>Choir Gaur</em> (1771) called Stonehenge &ldquo;the Grand Orrery of the Ancient
          Druids,&rdquo; counted{' '}
          <Link href="/book/choir-gaur-the-grand-orrery-of-the-ancient-druids-commonly-smith?page=42">
            nineteen stones in the inner oval
          </Link>
          . Richard Payne Knight concluded in 1786 that{' '}
          <Link href="/book/an-account-of-the-remains-of-the-worship-of-priapus?page=140">
            &ldquo;the Island I think can be no other than Britain.&rdquo;
          </Link>
        </P>

        <P>
          Several details fit. Britain lies opposite Gaul and is far larger than Sicily. The moon&apos;s rising
          and setting points swing to their extremes and back over 18.6 years, and the four Station Stones at
          Stonehenge form a rectangle that many archaeoastronomers read as aligned on those lunar extremes as well as
          on the midsummer sunrise. Hecataeus wrote a generation after Pytheas had sailed round Britain, so news of
          its stone circles could have reached him.
        </P>

        <div className="max-w-md mx-auto">
          <PageFigure
            src="https://images.sourcelibrary.org/cropped/699ef9f4b0a976d32fd37467/699f2dc1ff964210e766d487.jpg"
            alt="Engraved plan of Stonehenge: the stones in rings at the centre of a round banked enclosure, with the Avenue running out of it and scales in cubits and feet"
            href="/book/stonehenge-stukeley?page=176"
            source={<>William Stukeley, <em>Stonehenge</em> (1740)</>}
          >
            &ldquo;The Area of Stonehenge&rdquo;: Stukeley&apos;s plan of the round enclosure with the stones at its
            centre and the Avenue leading away, measured in cubits and feet.
          </PageFigure>
        </div>

        <P>
          Other details do not fit. Stonehenge was built between about 3000 and 1500 BCE and was an old monument by
          the time of Hecataeus; whatever he heard described a ruin, or a living cult somewhere else. The nineteen
          years are a Greek number: Meton had announced the nineteen-year cycle that reconciles the sun and the moon
          at Athens in 432 BCE, and Hecataeus may simply have given his ideal temple the best calendar he knew. His
          Hyperborea has two harvests a year and citizens who play the harp to Apollo all day, which belongs to the
          genre of the ideal commonwealth, not to a report. The great stone circle at Callanish, on Lewis in
          Toland&apos;s Hebrides, is the other usual candidate. The cautious reading is that a report of British
          stone circles may lie behind the passage. Nothing in it proves which circle, or that it was any circle at
          all.
        </P>

        <Section>Pythagorean druids?</Section>

        <P>
          There is a bolder version of the British case: that the Hyperborean offerings reaching Delos in
          Herodotus&apos;s lifetime were sent by Pythagorean druids. Roman and Greek writers did describe the druids
          in Pythagorean terms. Caesar, in the 50s BCE, says that the druids&apos; discipline{' '}
          <Link href="/book/c-iulii-caesaris-commentariorum-de-bello-gallico-libri-8-ciu-2?page=189">
            &ldquo;is thought to have been invented in Britain and transferred from there into Gaul,&rdquo;
          </Link>{' '}
          that they keep their teaching out of writing although they use Greek letters for accounts, and that they
          teach above all{' '}
          <Link href="/book/c-iulii-caesaris-commentariorum-de-bello-gallico-libri-8-ciu-2?page=190">
            &ldquo;that souls do not perish, but after death pass to others.&rdquo;
          </Link>{' '}
          Their Apollo, he adds,{' '}
          <Link href="/book/c-iulii-caesaris-commentariorum-de-bello-gallico-libri-8-ciu-2?page=191">
            &ldquo;drives away diseases&rdquo;
          </Link>
          , which is what Abaris did at Sparta. Diodorus says outright that among the Gauls{' '}
          <Link href="/book/studies-on-celtic-law-jubainville?page=30">
            &ldquo;the word of Pythagoras prevails&rdquo;
          </Link>
          : souls are immortal and live again in another body after a fixed number of years. Ammianus Marcellinus,
          in the fourth century CE, describes the druids as bound in fellowships{' '}
          <Link href="/book/ammiani-marcellini-rerum-gestarum-libri-xviii-valesius-1693-marcellinus?page=197">
            &ldquo;as the authority of Pythagoras decreed.&rdquo;
          </Link>{' '}
          Alexander Polyhistor claimed that Pythagoras himself had studied with the Galatians and the Brahmans.
        </P>

        <div className="max-w-md mx-auto">
          <PageFigure
            src="/articles/hyperborea/caesar-1561-druids.jpg"
            alt="Page of Latin italic type from a 1561 edition of Caesar's Commentaries, on the druids"
            href="/book/c-iulii-caesaris-commentariorum-de-bello-gallico-libri-8-ciu-2?page=189"
            source={<>Caesar, <em>Commentarii</em>, with corrections by Paolo Manuzio (1561)</>}
            credit="Scan: Early European Books, © 2010 ProQuest LLC, reproduced by courtesy of the Biblioteca Nazionale Centrale di Firenze."
          >
            Caesar on the druids: <em>Disciplina in Britannia reperta, atque inde in Galliam translata esse
            existimatur</em>, the discipline &ldquo;is thought to have been invented in Britain and transferred from
            there into Gaul.&rdquo;
          </PageFigure>
        </div>

        <P>
          The dates allow the hypothesis. Pythagoras died around 495 BCE. His communities in southern Italy were
          still active when Herodotus settled at Thurii, a few days from Croton, in the 440s. Herodotus speaks of the
          Hyperborean offerings as arriving in his own time, and Greeks and Celts were already in contact through
          the Greek colony at Massalia, founded around 600 BCE. Herodotus knew that the Danube rose{' '}
          <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=276">
            &ldquo;among the Celts&rdquo;
          </Link>
          , and the Hyperborean bundles came down to the head of the Adriatic, which can be reached from the upper
          Danube and the Alps. Two old witnesses point the same way. Hellanicus, a contemporary of Herodotus, put
          the Hyperboreans{' '}
          <Link href="/book/argonautica-editio-princeps-lascaris-rhodius?page=159">
            &ldquo;beyond the Alps of Italy,&rdquo;
          </Link>{' '}
          and in the next century Heraclides of Pontus called the Gauls who sacked Rome in 390 BCE{' '}
          <Link href="/book/histoire-des-celtes-pelloutier?page=68">
            &ldquo;an Army, coming from the country of the Hyperboreans&rdquo;
          </Link>
          ; Plutarch adds that Aristotle called the same people Celts. Apollonius, finally, attributes the story of
          Apollo&apos;s amber tears among the Hyperboreans to the Celts themselves.
        </P>

        <P>
          The evidence stops short of the claim in three places. First, no source says that Celts or druids sent the
          offerings; Herodotus names Scythians as the first carriers, and Pausanias&apos;s later route runs through
          the Black Sea. Second, the druids are first named in Greek around 200 BCE, by Sotion and a work on magic
          attributed to Aristotle, which Diogenes Laertius cites at the start of his{' '}
          <Link href="/book/diogenes-laertius-lives-and-opinions-of-eminent-philosophers-yonge?page=25">
            <em>Lives of the Philosophers</em>
          </Link>
          , two and a half centuries after Herodotus. Third, the Pythagorean description of the druids goes back to
          one Greek ethnographer, Posidonius, around 100 BCE, whom Caesar, Diodorus and Alexander all seem to follow.
          The French Celticist Henri d&apos;Arbois de Jubainville called it, in 1895, a hypothesis{' '}
          <Link href="/book/studies-on-celtic-law-jubainville?page=30">
            &ldquo;flattering to the self-esteem of the Greeks&rdquo;
          </Link>
          : a Greek explaining a foreign belief in the terms of his own philosophy. Jacob Brucker had made the same
          objection in 1742, that{' '}
          <Link href="/book/historia-critica-philosophiae-brucker?page=338">
            &ldquo;some slight harmony and similarity of this or that doctrine&rdquo;
          </Link>{' '}
          does not prove descent. On the present evidence, Celtic participation in the chain is possible and the
          later Greek writers clearly thought the Celts were Hyperboreans. That the senders were druids, or
          Pythagoreans, is a hypothesis the sources do not yet support.
        </P>

        <Section>The twelve-sided objects</Section>

        <P>
          One class of object keeps being drawn into this argument: the bronze dodecahedra of Roman Gaul. They are
          hollow, cast in copper alloy, four to eleven centimetres across, with twelve pentagonal faces, a round
          hole of a different diameter in each face and a small knob at each of the twenty corners. The first was
          shown to the Society of Antiquaries of London in 1739; about 130 are now known. Amateur archaeologists at
          Norton Disney in Lincolnshire added the thirty-third from Britain in 2023. They date from the second to
          the fourth centuries CE and were mostly made in Gaul. They have been found in France, Belgium, the
          Netherlands, Luxembourg, Germany, Switzerland, Austria, Hungary and Britain, but not in Italy, the Roman
          heartland. Where the find context is known it is usually military or funerary, and several came from coin
          hoards. No ancient text or picture mentions them, and none carries letters or numbers. The one exception
          is a different object: a solid silver dodecahedron found at Geneva in 1982 has the name of a zodiac sign
          on each face.
        </P>

        <div className="max-w-md mx-auto">
          <PageFigure
            src="/articles/hyperborea/tongeren-dodecahedron.jpg"
            alt="A hollow bronze dodecahedron with a round hole in each pentagonal face and a knob at each corner"
            credit={
              <>
                Gallo-Romeins Museum Tongeren, inv. 4002. Photo: Gallo-Romeins Museum Tongeren, CC0, via{' '}
                <a
                  href="https://commons.wikimedia.org/wiki/File:Pentagon-dodeca%C3%ABder_in_brons,_150_tot_400_NC,_vindplaats-_Tongeren,_Leopoldwal,_1939,_collectie_Gallo-Romeins_Museum_Tongeren,_4002.jpg"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Wikimedia Commons
                </a>
                .
              </>
            }
          >
            The bronze dodecahedron found at Tongeren in 1939, dated 150 to 400 CE.
          </PageFigure>
        </div>

        <P>
          The Pythagorean connection is real on the Greek side. The dodecahedron was the figure the Pythagoreans
          kept secret. Iamblichus says that Hippasus, one of the school,{' '}
          <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=152">
            &ldquo;was the first to divulge and write down the sphere made of the twelve pentagons&rdquo;
          </Link>{' '}
          and drowned at sea for the impiety. Plato gave it to the cosmos. In the <em>Timaeus</em>, after assigning
          four regular solids to the four elements,{' '}
          <Link href="/book/de-aeternitate-mundi-contra-proclum-rabe?page=550">
            &ldquo;God used this one for the whole&rdquo;
          </Link>
          ; in the <em>Phaedo</em> the true earth seen from above looks{' '}
          <Link href="/book/phaedo-plato?page=287">
            &ldquo;like balls made of twelve pieces of leather.&rdquo;
          </Link>{' '}
          Plutarch, in his <em>Platonic Questions</em>, read the twelve faces as the zodiac: the figure, he wrote,{' '}
          <Link href="/book/timaeus-greek-text-with-commentary-archer-hind?page=209">
            seems to imitate the zodiac and the year
          </Link>
          . The Geneva object spells out the same idea.
        </P>

        <P>
          The Celtic side is less certain. More than fifty uses have been proposed, among them candle holders,
          surveying instruments, coin gauges, glove-knitting tools and metalsmiths&apos; test pieces. The surveying
          and gauge ideas founder on the absence of any markings and on sizes that do not match; spool knitting is
          not recorded before 1535. The curators at Tongeren, which holds a complete one found in 1939, lean toward
          unofficial religious use, divination or magic. A 2025 paper in <em>The Antiquaries Journal</em> by Michael
          Guggenberger and Stephen Leach reads them through Plato: its title, &ldquo;The Gallo-Roman Dodecahedron
          and the Receptacle of All Becoming,&rdquo; borrows the <em>Timaeus</em>&apos;s name for the matrix in which
          the cosmos takes shape. A ritual use would fit the Gallic distribution. It would not
          reach back to Herodotus. The dodecahedra are six to eight centuries later than his Hyperborean offerings,
          and they postdate the Roman suppression of the druids in the first century CE. An older stone dodecahedron
          was reported in 1885 from Monte Loffa near Verona, an Alpine site of the fifth to second centuries BCE
          that also produced Etruscan and Gallic objects, but its own date has never been fixed. The most the
          objects show is that in the Celtic provinces of the Roman empire someone was making and treasuring the
          Pythagorean figure of the cosmos. Whether that was druid learning surviving under Rome, or Greek
          geometry arriving with Roman rule, they do not say.
        </P>

        <P>
          The form also travelled east. Much smaller dodecahedra of gold, with the same holes and knobs, have been
          found at Óc Eo in the Mekong delta of Vietnam, a port of the kingdom of Funan where Roman gold medallions
          of Antoninus Pius also turned up, and in Burma, Thailand, India and China. Louis Malleret, who excavated
          Óc Eo, published them in 1961 and read them as a sign of Mediterranean influence carried by trade. If he
          was right, the twelve-sided figure moved along Roman trade routes in both directions, to the Celtic
          provinces in bronze and to the Indian Ocean in gold, which makes a purely druidic explanation harder to
          hold.
        </P>

        <Section>What the ground shows</Section>

        <P>
          Texts cannot settle whether real people sent real things down Herodotus&apos;s chain. Finds can, and on
          one point they now say something definite. Amber became a common offering in Greek sanctuaries in the
          later eighth and seventh centuries BCE, the generations before Herodotus. The fullest study is Alessandro
          Naso&apos;s report on the amber from the sanctuary of Artemis at Ephesos. Infrared analysis of thirty
          samples there, made at the Vassar laboratory Curt Beck founded, showed that{' '}
          <a
            href="https://austriaca.at/0xc1aa5572%200x003f6cca.pdf"
            target="_blank"
            rel="noopener noreferrer"
          >
            &ldquo;the amber objects found in Ephesos are of Baltic origin&rdquo;
          </a>
          . Some arrived raw and were carved on the spot. Comparing the pieces with finds from Verucchio on the
          Adriatic coast of Italy and from Basilicata, Naso concludes that &ldquo;Baltic amber reached Ephesos via a
          trade route along the Adriatic Sea.&rdquo; He also lists amber from the sanctuaries of Artemis Orthia at
          Sparta, Hera at Perachora, Apollo at Eretria, more than two hundred pieces from Lindos, and half-worked
          amber, ivory and bone from the sanctuary of Apollo at Delos.
        </P>

        <P>
          The Adriatic leg is where Herodotus&apos;s offerings turn south, and where the amber went. In the early
          Iron Age the main amber-working centres on that sea were Etruscan Verucchio on the Italian side and Novo
          Mesto in Slovenia on the other, a site of the Hallstatt culture of the eastern Alps. A 2018 University of
          Birmingham thesis on the dedications at Dodona goes as far as to propose{' '}
          <a
            href="https://etheses.bham.ac.uk/8375/1/Fotiadi18MARes.pdf"
            target="_blank"
            rel="noopener noreferrer"
          >
            &ldquo;one main ideological and religious pathway&rdquo; running &ldquo;from the Baltic to the Adriatic,
            through Dodona, Pindos and Thessaly to its final destination, the island of Delos&rdquo;
          </a>
          , charted by the myth of the Hyperborean gifts.
        </P>

        <P>
          Three cautions. The same thesis, surveying what was dedicated at Dodona, does not list amber among it. Some
          archaeologists doubt that a single &ldquo;amber route&rdquo; ever existed, rather than many short
          exchanges; Aleksandar Palavestra titled a 2007 paper &ldquo;Was there an amber route?&rdquo; And nothing
          says the Hyperborean bundles held amber. What the ground does show is a real flow of a northern material
          into the sanctuaries of Apollo and Artemis, by way of the Adriatic, in the centuries when the Delians were
          telling their story. For the druid hypothesis, it points away from Britain: the hands on the Adriatic leg
          were Etruscan, Picene and eastern Alpine.
        </P>

        <Section>Everyone&apos;s Hyperborea</Section>

        <P>
          From the sixteenth century onward nearly every northern nation found a scholar to argue that it was the
          land beyond the north wind. The case was usually made from the same handful of classical passages, and it
          usually arrived at home.
        </P>

        <HyperboreaTimeline />

        <P>
          In Sweden, Olof Rudbeck&apos;s <em>Atlantica</em> (1679–1702) made Sweden both Plato&apos;s Atlantis and
          Hyperborea. The 1761 Callimachus commentary summarises his etymology:{' '}
          <Link href="/book/hymni-epigrammata-et-fragmenta-callimachus?page=563">
            the name came not from the Greek <em>boreas</em> but from the Swedes
          </Link>
          , whose most ancient king was called Boreus, so that <em>Oferborne</em>, &ldquo;Hyperboreans,&rdquo; meant
          the nobly born. In Britain, John Toland placed them in the Hebrides and made Abaris a Druid:{' '}
          <Link href="/book/a-critical-history-of-the-celtic-religion-and-learning-toland?page=203">
            &ldquo;if the Hebrides were the Hyperboreans of Diodorus, as I fancy it can scarce hereafter be
            doubted&rdquo;
          </Link>{' '}
          (1740). John Wood{' '}
          <Link href="/book/choir-gaure-vulgarly-called-stonehenge-on-salisbury-plain-wood?page=9">
            made Abaris and Bladud, the legendary founder of Bath, &ldquo;one and the same man&rdquo;
          </Link>{' '}
          (1747), William Borlase{' '}
          <Link href="/book/antiquities-historical-and-monumental-of-the-county-of-borlase?page=114">
            read Diodorus&apos;s round temple
          </Link>{' '}
          into Cornwall, and Godfrey Higgins wrote in 1827 that{' '}
          <Link href="/book/the-celtic-druids-higgins?page=346">
            by the Hyperboreans the Greeks &ldquo;generally meant the British isles.&rdquo;
          </Link>
        </P>

        <div className="max-w-sm mx-auto">
          <PageFigure
            src="https://images.sourcelibrary.org/pages/69ee47436dd925d126f41aba/0235.jpg"
            alt="Engraved plate of four Cornish stone circles drawn one above the other, with a scale of yards and a dedication with a coat of arms"
            href="/book/antiquities-historical-and-monumental-of-the-county-of-borlase?page=235"
            source={<>William Borlase, <em>Antiquities of the County of Cornwall</em> (1769)</>}
          >
            Borlase&apos;s Cornish circles: Tredinek, Boskednan in Gulval, Boscawen-un in Beryan, and Senor.
          </PageFigure>
        </div>

        <P>
          The German geographer Philipp Clüver, in his <em>Germania antiqua</em> (1616), took the amber route instead
          and followed it to the Vistula. The amber river, he argued, was the Radaune, which reaches the sea at
          Danzig. The Greeks had heard its name as Eridanus, and the name later slid onto the Po and the Rhône
          because amber was shipped through them:{' '}
          <Link href="/book/germaniae-antiquae-libri-tres-cluver?page=886">
            &ldquo;This confusion of the three rivers, Rhone, Po, and Vistula, is truly strange.&rdquo;
          </Link>
        </P>

        <Section>The Prussian claim</Section>

        <P>
          The fullest version of the Baltic argument is in Christoph Hartknoch&apos;s{' '}
          <em>Alt- und Neues Preussen</em> (Old and New Prussia, 1684), a history of the land and its pagan religion
          by a teacher at the gymnasium in Thorn (Toruń). Hartknoch surveys the places scholars had looked for the Eridanus (Italy, the Rhône,
          Africa, Britain, even India) and then quotes Herodotus&apos;s doubt about the amber river as evidence for
          his own country:
        </P>

        <SourceQuote
          book="old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch"
          page={35}
          src="https://images.sourcelibrary.org/pages/6a209d5c89e8715c5947a6ac/0035.jpg"
          source={<>Christoph Hartknoch, <em>Alt- und Neues Preussen</em> (1684), English translation by Source Library</>}
          pageAlt="Opening of Hartknoch's Alt- und Neues Preussen, pages 82 and 83, in German blackletter with Latin notes"
        >
          Nevertheless, not all writers have gone so far astray; rather, there have also been people who believed they
          could find the Eridanus in the North, and perhaps they also found the amber-bearing river Eridanus, like the
          Electrides, in our Prussia.
        </SourceQuote>

        <P>
          He goes on to read Diodorus&apos;s island of Basilia, where amber washes ashore, as{' '}
          <Link href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch?page=36">
            Samland, the amber peninsula north of Königsberg
          </Link>
          . Diodorus had called Basilia an island. Hartknoch answers that Diodorus could not have known whether it
          was island or mainland, and that Adam of Bremen also counted Sambia among the Baltic islands, since the
          sea, the two lagoons and the rivers enclose it on every side. He states his
          purpose plainly: to prove that &ldquo;even before the birth of Christ, and also long before the times of
          Herodotus, people lived in these places who gathered amber and sold it to other lands.&rdquo; He is more
          cautious than Rudbeck. In these pages he does not claim the Hyperboreans for Prussia, and he allows that
          Diodorus may have meant Zealand or Sweden. What he wants from the Greeks is antiquity: a place for his country in the
          oldest histories there are.
        </P>

        <div className="max-w-md mx-auto">
          <PageFigure
            src="/articles/hyperborea/hartknoch-samland-amber.jpg"
            alt="Engraved bird's-eye view of the Samland coast with ships on the sea and people in the shallows, and below it a large lump of amber on a draped table"
            href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch?page=134"
            source={<>Christoph Hartknoch, <em>Alt- und Neues Preussen</em> (1684)</>}
          >
            Hartknoch&apos;s view of Samland (<em>Samlandt</em>), between the Baltic (<em>Oost See</em>) and the
            Frisches Haff, with people working in the shallows; below it, a lump of amber, from the chapter on the
            nature of amber.
          </PageFigure>
        </div>

        <P>
          The same wish shaped the Prussian origin legend, and it too ran through Hyperborean geography. The
          Dominican chronicler Simon Grunau, writing in the 1520s, gave the Prussians a migration from Scandinavia, a
          priest-king called Widewuto, and a sanctuary at Romove where three gods stood in an evergreen oak. The
          folklorist Wilhelm Mannhardt (1831–1880), whose collected study of Baltic religion was published in 1936,
          took the story apart source by source. Grunau had found in Erasmus Stella
          that{' '}
          <Link href="/book/latvian-prussian-mythology-the-master-source-compendium-of-mannhardt?page=220">
            &ldquo;the Borussian peoples, who according to Ptolemy had their seats at the Rhipaean mountains,&rdquo;
          </Link>{' '}
          had entered Prussia, and he placed the Rhipaean mountains in Norway. These were the mountains beyond which
          Pliny and Mela had put the Hyperboreans. So the Prussians&apos; own founding story began, by way of a
          misread geography, on the threshold of Hyperborea.
        </P>

        <PageFigure
          src="/articles/trees-of-life/hartknoch-romowe.jpg"
          alt="Engraving of a great oak behind a wooden screen with three idols in niches, a fire burning before it, a village around"
          href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch?page=87"
          source={<>Christoph Hartknoch, <em>Alt- und Neues Preussen</em> (1684)</>}
          wide
        >
          The oak of Romove with its three idols, as Grunau described it.
        </PageFigure>

        <P>
          Hartknoch engraved Grunau&apos;s scenes, including the war banner of Widewuto with the three gods: Patollo,
          old and grey-bearded, god of the dead; Perkuno, the thunder god, with a face like fire; and young Potrimpo,
          crowned with ears of grain. Mannhardt&apos;s verdict was that{' '}
          <Link href="/book/latvian-prussian-mythology-the-master-source-compendium-of-mannhardt?page=235">
            &ldquo;like the entire triad, the image of the gods on the war flag of Widewut with the enigmatic
            inscription and the coat of arms of the first king are inventions.&rdquo;
          </Link>{' '}
          The forger gave himself away with the horses: heraldic animals holding up a shield came into use only in
          the fourteenth century. Perkūnas, at least, is real. The thunder god appears across Lithuanian, Latvian and
          Prussian sources and in Lithuanian and Latvian folk song.
        </P>

        <PageFigure
          src="/articles/hyperborea/hartknoch-widewuto-banner.jpg"
          alt="Engraving of a banner showing three male busts, one bearded in a cap, one with a crown of flames, one crowned with ears of grain, above a shield held by two rearing horses"
          href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch?page=143"
          source={<>Christoph Hartknoch, <em>Alt- und Neues Preussen</em> (1684), after Simon Grunau</>}
        >
          The banner of Widewuto with Patollo, Perkuno and Potrimpo.
        </PageFigure>

        <Section>Lithuania and the sun</Section>

        <P>
          In the nineteenth century the argument moved from Prussia to Lithuania and from amber to language. Teodor
          Narbutt began his <em>Ancient History of the Lithuanian Nation</em> (1835) with the sun. Discussing a
          Samogitian prayer to the fire god Gabie that peasants still recited in their drying barns, he writes:
        </P>

        <SourceQuote
          book="ancient-history-of-the-lithuanian-nation-vol-1-lithuanian-narbutt"
          page={37}
          src="https://images.sourcelibrary.org/pages/6a209d3389e8715c5947a32b/0037.jpg"
          source={<>Teodor Narbutt, <em>Dzieje starożytne narodu litewskiego</em>, vol. 1 (1835), English translation by Source Library</>}
          pageAlt="Page 18 of Narbutt's Polish text, on the Samogitian prayer to Gabie and the Hyperborean Apollo"
        >
          The worship of fire and the sun, or Apollo, merged into one among all nations. Fire and the sun everywhere
          received worship where the pagan religion had external pomp and priests. The Greeks used to say that the
          worship of Apollo among the northern peoples was very famous, for which reason they called him
          Hyperboreans.
        </SourceQuote>

        <P>
          Narbutt connected the Hyperborean Apollo to a sun cult &ldquo;observed by the Baltic Sea&rdquo; in Pliny,
          and later in the volume to Sanskrit. Lithuanian, he argued, came{' '}
          <Link href="/book/ancient-history-of-the-lithuanian-nation-vol-1-lithuanian-narbutt?page=480">
            &ldquo;directly and immediately&rdquo; from Sanskrit
          </Link>
          , as Sanskrit <em>devas</em>, god, survives in Lithuanian <em>Dievas</em>, Latvian <em>Dievs</em> and
          Prussian <em>Deiws</em>. Half of that is right. Lithuanian is one of the most conservative Indo-European
          languages, and the cognates are real; but it is a sister of Sanskrit, not a daughter. The claim gave a small
          nation inside the Russian Empire a lineage older than Greece and Rome, which is what Hartknoch had wanted
          from the amber two centuries earlier.
        </P>

        <Section>Was it Russia?</Section>

        <P>
          The oldest Greek route to Hyperborea runs north-east. Aristeas, in Herodotus, travels past the Scythians of
          the Ukrainian steppe to the Issedones, and beyond them come the one-eyed Arimaspians, the gold-guarding
          griffins and finally the Hyperboreans. Pausanias&apos;s route for the offerings comes the same way:
        </P>

        <SourceQuote
          book="pausanias-description-of-greece-vol-1-frazer"
          page={148}
          src="https://images.sourcelibrary.org/pages/69924f3a5976b55115ffd500/0148.jpg"
          source={<>Pausanias, <em>Description of Greece</em>, Book 1, tr. J. G. Frazer (1898)</>}
          pageAlt="Page of Frazer's Pausanias, Book 1 chapter 31, on the first-fruits of the Hyperboreans"
        >
          the Hyperboreans, they say, hand them over to the Arimaspians, the Arimaspians to the Issedonians, and from
          the Issedonians the Scythians convey them to Sinope.
        </SourceQuote>

        <P>
          That points up the steppe toward the Urals and the Altai, whose gold the Scythians traded. In that sense the
          earliest Hyperborea lay in what is now Russia and Kazakhstan.
        </P>

        <P>
          Western Europeans later used the word for Russians. In a dialogue Alexander Herzen wrote at Nice in 1869,
          a French doctor greets the Russian narrator as &ldquo;my dear Hyperborean,&rdquo; and he answers:{' '}
          <Link href="/book/2-herzen?page=239">
            &ldquo;do not call me a Hyperborean. Firstly, the word makes me cold every time,&rdquo;
          </Link>{' '}
          and it recalls the age of Montesquieu, when Paris called Peter the Great{' '}
          <em>le Grand Tzar hyperboréen</em>. In the twentieth century the claim became Russian. In 1922 Alexander
          Barchenko led an expedition to the Kola Peninsula in search of an ancient northern civilisation, and since
          the 1990s Russian esoteric and nationalist writers, Aleksandr Dugin among them, have placed Hyperborea in
          the Russian Arctic. It is the same move Rudbeck made for Sweden and Hartknoch, more cautiously, for
          Prussia.
        </P>

        <P>
          Other ancient writers pointed elsewhere: Hellanicus to the Alps, Hecataeus to an island off the Celts,
          Herodotus&apos;s offering route to the head of the Adriatic. The north-east was one direction among
          several. Hyperborea was wherever the known peoples ran out, and the Greeks knew the steppe earlier than
          they knew the Atlantic.
        </P>

        <Section>The polar homeland</Section>

        <P>
          By then Hyperborea was turning from a people into a homeland of humanity. The French astronomer Jean-Sylvain
          Bailly argued in the 1770s that the sciences had been invented by a lost northern people. William Warren&apos;s{' '}
          <em>Paradise Found</em> (1885) put Eden at the North Pole, and Bal Gangadhar Tilak&apos;s{' '}
          <em>The Arctic Home in the Vedas</em> (1903) put the Aryans there. Helena Blavatsky made the Hyperborean the
          second of her root races in <em>The Secret Doctrine</em> (1888), and she used the amber to prove it. The
          Eridanus could not be the Po, she wrote, because{' '}
          <Link href="/book/the-secret-doctrine-synthesis-of-science-religion-and-blavatsky?page=838">
            &ldquo;amber is found only in the northern seas, in the Baltic&rdquo;
          </Link>
          ; Phaethon&apos;s fall was an allegory of the poles changing climate.
        </P>

        <P>
          In the twentieth century the polar homeland was taken up by German racial nationalists. Besides the Thule
          Society (see the section on Thule above), the Dutch-German writer Herman Wirth,
          a founder of the SS research office <em>Ahnenerbe</em>, built a prehistory of a northern master race on the
          same classical passages. That use has continued on the far right. The passages themselves say much less, as
          the earlier readers in this note show.
        </P>

        <Section>What was the Hyperborean Apollo?</Section>

        <P>
          Everything the Greeks said came from Hyperborea is old and holy: the first prophet, the first temples,
          first-fruit offerings, the olive of the games, purification, healing and survival after death. If there
          was a real &ldquo;Apollo of the north&rdquo; behind the stories, the candidates are these, in order of the
          evidence.
        </P>

        <ul className="list-disc pl-6 space-y-3 text-secondary leading-relaxed mb-6">
          <li>
            <strong>The near north.</strong> The one Hyperborean rite Herodotus saw for himself was local: Thracian
            and Paeonian women who never sacrificed to Artemis without wheat straw. Thrace also had Zalmoxis, the
            Getic teacher of immortality whom Herodotus makes a former slave of Pythagoras. In Plato&apos;s{' '}
            <em>Charmides</em>, Socrates names the two northern kinds of healing together:{' '}
            <Link href="/book/cologny-fondation-martin-bodmer-cod-bodmer-136-plato?page=304">
              &ldquo;the charms of Zalmoxis&rdquo; and &ldquo;those of Abaris the Hyperborean.&rdquo;
            </Link>
          </li>
          <li>
            <strong>Beyond the Scythians.</strong> The Hyperborean holy men fast, purify cities, avert plague,
            travel out of the body and ride an arrow. Dodds and Burkert read them as Greek reflections of steppe
            shamanism, met at second hand through Scythian contacts and attached to Apollo as healer and prophet.
          </li>
          <li>
            <strong>The Celts and their druids.</strong> A real but later layer. Greeks of the fourth and third
            centuries BCE identified the Celts as Hyperboreans and described the druids in Pythagorean terms, as the
            section above sets out. The myth itself is older than any Greek knowledge of the Celts.
          </li>
          <li>
            <strong>The Baltic.</strong> The amber link is real; a cult link is not attested. Baltic religion fits
            Apollo poorly: the sun is a goddess, Saulė, the chief god is the thunderer Perkūnas, and the amber
            gatherers of Tacitus worship a Mother of the Gods. The Baltic peoples were probably an unseen far end of
            the chain rather than the source of the cult.
          </li>
          <li>
            <strong>Not northern at all.</strong> Many historians think Apollo himself came into Greek religion from
            Anatolia: a Hittite treaty of about 1280 BCE with Wilusa, probably Troy, names a god Apaliunas, and
            Herodotus makes the first Delian hymn-poet, Olen, a Lycian. On that view the north is where the Greeks
            put the purity of a god who had reached them from the east.
          </li>
        </ul>

        <div className="max-w-md mx-auto">
          <PageFigure
            src="https://images.sourcelibrary.org/pages/699389510f04c37dcfa609ca/0304.jpg"
            alt="Manuscript page of Greek text in a single column, with the name Abaris written in the left margin"
            href="/book/cologny-fondation-martin-bodmer-cod-bodmer-136-plato?page=304"
            source={<>Plato, <em>Dialogues</em>, Greek manuscript, Cologny, Fondation Martin Bodmer, Cod. Bodmer 136</>}
          >
            Socrates names the charms of Zalmoxis and of Abaris the Hyperborean in the <em>Charmides</em>; a reader
            has written Abaris&apos;s name in the margin.
          </PageFigure>
        </div>

        <Section>What the sources support</Section>

        <P>
          Read together, the Greek texts describe two things. One is a mythical people of Apollo at the edge of the
          world, whom Herodotus already doubted. The other is a real chain of exchange that brought amber and tin
          south out of northern Europe, through many hands, to people who did not know where it started. Hyperborea is
          what the Greeks called the far end of a chain they could not see. Baltic amber did reach Greece. Whether the
          Delian bundles were part of that trade, nothing in the sources says.
        </P>

        <P>
          The historians of Prussia, Latvia and Lithuania who read these passages were not inventing a connection out
          of nothing. They lived on the amber coast, and they knew the Greeks had valued what washed up on their
          beaches. Their mistake was to ask the classical sources for a national past that the sources could not
          give. The older religion of the Baltic peoples survives in thinner but more reliable records: the treaty of
          1249 between the Teutonic Order and the Prussians, the{' '}
          <Link href="/book/on-the-gods-of-the-samogitians-mannhardt">
            list of Samogitian gods
          </Link>{' '}
          that Jan Łasicki compiled in the 1580s, Matthäus Praetorius&apos;s{' '}
          <Link href="/book/prussian-delights-prussian-lithuanian-religion-and-customs-pierson">
            <em>Deliciae Prussicae</em>
          </Link>{' '}
          from the Lithuanian villages of East Prussia, the{' '}
          <Link href="/book/dainos-lithuanian-folk-songs-reza">
            <em>dainos</em>
          </Link>{' '}
          or folk songs, and Mannhardt&apos;s compendium of every source he could find. They are in the{' '}
          <Link href="/collections/baltic-paganism">
            Baltic Paganism collection
          </Link>
          , with English translations, next to the Greek authors they were measured against.
        </P>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="text-2xl text-primary mb-6">Sources</h2>

          <h3 className="text-lg text-primary mb-4 mt-8">In Source Library</h3>
          <ul className="list-disc list-inside space-y-2 text-secondary text-sm">
            <li>
              Herodotus,{' '}
              <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=253">
                <em>Histories</em>, Books 3–4
              </Link>{' '}
              (Loeb, 1921): 3.115 on amber and the Eridanus; 4.32–36 on the Hyperboreans.
            </li>
            <li>
              Pindar,{' '}
              <Link href="/book/the-odes-of-pindar-sandys?page=346">
                <em>Odes</em>
              </Link>
              , tr. Sandys (1915): <em>Pythian</em> 10.
            </li>
            <li>
              Apollonius of Rhodes,{' '}
              <Link href="/book/apollonii-rhodii-argonautica-estienne?page=210">
                <em>Argonautica</em>
              </Link>
              , ed. Estienne (1574): Book 4, the Eridanus and Apollo&apos;s tears.
            </li>
            <li>
              Iamblichus,{' '}
              <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=185">
                <em>On the Pythagorean Life</em>
              </Link>
              , ed. Nauck (1884); Solinus,{' '}
              <Link href="/book/c-iulii-solini-polyhistor-1543-solinus?page=79">
                <em>Polyhistor</em>
              </Link>{' '}
              (1543), ch. 26; Tacitus,{' '}
              <Link href="/book/tacitus-dialogus-de-oratoribus-agricola-germania-hutton?page=196">
                <em>Germania</em>
              </Link>{' '}
              45 (Loeb, 1914).
            </li>
            <li>
              Carl Gottfried Zapf,{' '}
              <Link href="/book/disp-hist-de-abaride-zapf">
                <em>Disputatio historica de Abaride</em>
              </Link>{' '}
              (1706); Johann Ludwig Hannemann,{' '}
              <Link href="/book/ovum-hermetico-paracelsico-trismegistum-hannemann">
                <em>Ovum Hermetico-Paracelsico-Trismegistum</em>
              </Link>{' '}
              (1694).
            </li>
            <li>
              Callimachus,{' '}
              <Link href="/book/hymni-epigrammata-et-fragmenta-callimachus">
                <em>Hymni, Epigrammata et Fragmenta</em>
              </Link>{' '}
              (1761), commentary on the <em>Hymn to Delos</em>.
            </li>
            <li>
              Philipp Clüver,{' '}
              <Link href="/book/germaniae-antiquae-libri-tres-cluver">
                <em>Germania antiqua</em>
              </Link>{' '}
              (1616); John Toland,{' '}
              <Link href="/book/a-critical-history-of-the-celtic-religion-and-learning-toland">
                <em>A Critical History of the Celtic Religion and Learning</em>
              </Link>{' '}
              (1740); Godfrey Higgins,{' '}
              <Link href="/book/the-celtic-druids-higgins">
                <em>The Celtic Druids</em>
              </Link>{' '}
              (1827).
            </li>
            <li>
              Christoph Hartknoch,{' '}
              <Link href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch">
                <em>Alt- und Neues Preussen</em>
              </Link>{' '}
              (1684); Simon Grunau,{' '}
              <Link href="/book/simon-grunau-prussian-chronicle-old-prussian-pagan-religion-perlbach">
                <em>Preussische Chronik</em>
              </Link>
              , ed. Perlbach; Wilhelm Mannhardt,{' '}
              <Link href="/book/latvian-prussian-mythology-the-master-source-compendium-of-mannhardt">
                <em>Letto-preussische Götterlehre</em>
              </Link>{' '}
              (1936).
            </li>
            <li>
              Teodor Narbutt,{' '}
              <Link href="/book/ancient-history-of-the-lithuanian-nation-vol-1-lithuanian-narbutt">
                <em>Dzieje starożytne narodu litewskiego</em>, vol. 1
              </Link>{' '}
              (1835); Helena Blavatsky,{' '}
              <Link href="/book/the-secret-doctrine-synthesis-of-science-religion-and-blavatsky">
                <em>The Secret Doctrine</em>, vol. 2
              </Link>{' '}
              (1888).
            </li>
          </ul>

          <h3 className="text-lg text-primary mb-4 mt-8">Further reading</h3>
          <ul className="list-disc list-inside space-y-2 text-secondary text-sm">
            <li>
              Bridgman, Timothy P. <em>Hyperboreans: Myth and History in Celtic-Hellenic Contacts.</em> Routledge,
              2005.
            </li>
            <li>
              Romm, James S. <em>The Edges of the Earth in Ancient Thought.</em> Princeton University Press, 1992.
            </li>
            <li>
              Beck, Curt W., et al. &ldquo;Analysis and Provenience of Minoan and Mycenaean Amber.&rdquo;{' '}
              <em>Greek, Roman and Byzantine Studies</em>, series of articles from 1966.
            </li>
            <li>
              Naso, Alessandro. &ldquo;Amber for Artemis: Preliminary Report on the Amber Finds from the Sanctuary of
              Artemis at Ephesos.&rdquo; Austrian Academy of Sciences.
            </li>
            <li>
              Fotiadi, Maria. <em>Dedications at Ancient Dodona.</em> MA by Research thesis, University of
              Birmingham, 2018.
            </li>
            <li>
              Guggenberger, Michael, and Stephen Leach. &ldquo;The Gallo-Roman Dodecahedron and the Receptacle of All
              Becoming.&rdquo; <em>The Antiquaries Journal</em> 105 (2025): 31–54.
            </li>
            <li>
              Malleret, Louis. &ldquo;Les dodécaèdres d&apos;or du site d&apos;Oc-èo.&rdquo; <em>Artibus Asiae</em> 24
              (1961).
            </li>
            <li>
              Dodds, E. R. <em>The Greeks and the Irrational.</em> University of California Press, 1951.
            </li>
            <li>
              Godwin, Joscelyn. <em>Arktos: The Polar Myth in Science, Symbolism, and Nazi Survival.</em> Phanes Press,
              1993.
            </li>
            <li>
              Vėlius, Norbertas, ed. <em>Baltų religijos ir mitologijos šaltiniai</em> (Sources of Baltic Religion and
              Mythology). 4 vols. Vilnius, 1996–2005.
            </li>
          </ul>
        </section>
      </article>
    </ContentPageLayout>
  );
}
