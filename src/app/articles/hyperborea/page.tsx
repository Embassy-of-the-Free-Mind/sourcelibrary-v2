import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';
import ContextNote from '@/components/articles/ContextNote';
import HyperboreaTimeline from './HyperboreaTimeline';

const LEAD_IMAGE = 'https://images.sourcelibrary.org/artwork/art-phaetons-sisters-changed-into-poplars-cygnus-into-a-swan.jpg';
const LEAD_ALT =
  'Engraving after Hendrick Goltzius: the sisters of Phaethon turning into poplars beside his tomb on the river Eridanus, while Cygnus becomes a swan';

export const metadata: Metadata = withArticleMeta('hyperborea', {
  title: 'Beyond the North Wind: Hyperborea and the Amber Coast - Articles - Source Library',
  description:
    'A bundle in wheat straw reached Delos every year from a people no Greek had met. Herodotus, Pindar, Pausanias and Diodorus in their own Greek, and the Prussian and Lithuanian historians who claimed the north wind for the Baltic.',
  openGraph: {
    title: 'Beyond the North Wind: Hyperborea and the Amber Coast',
    description:
      'Hyperborea in Herodotus, Pindar and Diodorus, read in Greek, and the Baltic historians who said the Greeks had been describing them.',
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
          <p className="text-stone-400 text-sm mt-4">16 October 2026, revised 12 November 2026 &middot; 24 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Every year a small parcel wrapped in wheat straw arrived on the island of Delos. The priests there told
          Herodotus where it had come from. It started among a people far to the north, who handed it to their
          neighbours, who handed it on again, and so it crossed the whole of Europe from hand to hand until a boat
          from Tenos brought it the last few miles. The Greeks called the senders the Hyperboreans, the people beyond
          the north wind.
        </p>

        <SourceQuote
          book="erodotou-logoi-ennea-oiper-epikalountai-mousai-herodoti-libr"
          page={167}
          printedPage={116}
          src="https://images.sourcelibrary.org/pages/6a08527915c643eb1af4d06d/0167.jpg"
          source={<>Herodotus, <em>Histories</em> 4.33, Aldine edition (Venice, 1502), English translation by Source Library</>}
          pageAlt="Page 116 of the 1502 Aldine Herodotus, Greek text of Book 4 with printed marginal headings naming Dodona, Carystus, Tenos, Delos, Hyperoche and Laodice"
        >
          the Dodonaeans are the first of the Greeks to receive them; from them, they descend to the Meliac Gulf
          and travel into Euboea; and they send them from city to city until Carystus; after that, they pass by
          Andros, for the Carystians are the ones who carry them to Tenos, and the Tenians to Delos; thus, they
          say, these sacred offerings arrive in Delos.
        </SourceQuote>

        <P>
          The first time, the Delians said, the Hyperboreans had sent two girls, Hyperoche and Laodice, with five
          men to guard them. None of them came home. After that the Hyperboreans carried the parcel only as far as
          their own border, wrapped it in straw and asked the next people to pass it on. The girls were buried on
          Delos, inside the precinct of Artemis, on the left as you go in, and an olive tree had grown over the
          grave. Before a Delian girl married she cut off a lock of her hair, wound it round a spindle and laid it
          there; the boys wound theirs round a stalk of grass. Herodotus had seen one thing like it with his own
          eyes: Thracian and Paeonian women, he says, never sacrificed to Artemis without wheat straw.
        </P>

        <P>
          Then he stops. He will not repeat the story of Abaris the Hyperborean,{' '}
          <Link href="/book/erodotou-logoi-ennea-oiper-epikalountai-mousai-herodoti-libr?page=167">
            &ldquo;who is said to have carried the arrow around the whole world without eating anything.&rdquo;
          </Link>{' '}
          If there are people beyond the north wind, he adds, there must be people beyond the south wind too, and
          he laughs at the mapmakers who draw the earth as a circle turned on a lathe. Who the Hyperboreans were, he
          does not say.
        </P>

        <P>
          This article follows the parcel: the Greeks who wrote about the people at the far end of the chain, the
          one northern thing a Greek could hold in his hand, and the scholars of Sweden, Britain, Prussia and
          Lithuania who read the same pages and found Hyperborea at home. Many of the Baltic books are in the{' '}
          <Link href="/collections/baltic-paganism">Baltic Paganism</Link> collection.
        </P>

        <Section>No road to the Hyperboreans</Section>

        <P>
          A generation before Herodotus, Pindar wrote an ode for a Thessalian boy who had won the double foot-race
          at Delphi. It was sung in 498 BCE:
        </P>

        <SourceQuote
          book="pindari-olympia-pythia-nemea-isthmia-estienne"
          page={322}
          src="https://images.sourcelibrary.org/pages/69b2f4140e2f024dfbfbadd2/0322.jpg"
          source={<>Pindar, <em>Pythian</em> 10, ed. Henri Estienne (Geneva, 1566), English translation by Source Library</>}
          pageAlt="Page 322 of Estienne's Greek Pindar, Pythian Ode 10, with the lines on the road to the Hyperboreans"
        >
          The brazen heaven is never approachable for those. But the mortal race attains whatever glories we touch,
          finishing toward the furthest voyage. But neither by ships, nor by traveling on foot, would you find the
          wondrous road to the gathering of the Hyperboreans; among whom once Perseus the leader of the people
          feasted, having entered their homes, the glorious hecatombs of asses.
        </SourceQuote>

        <P>
          Perseus got there, led by Athena, and found the Hyperboreans sacrificing a hundred donkeys to Apollo. The
          god spends his winters among them. They do not fall sick or grow old, and the Muse is never away from
          their feasts. In another ode Pindar sends Heracles there to fetch the wild olive from{' '}
          <Link href="/book/pindari-olympia-pythia-nemea-isthmia-estienne?page=48">
            &ldquo;the shady springs of the Ister,&rdquo;
          </Link>{' '}
          having persuaded &ldquo;the people of the Hyperboreans, servants of Apollo&rdquo; to part with it; he
          planted it at Olympia, and its leaves crowned the victors. Pausanias, six centuries later, still repeated
          that the olive had come from the north, and put it plainly:{' '}
          <Link href="/book/accurata-graeciae-descriptio-greek-latin-pausanias?page=170">
            &ldquo;There are people who live beyond the North Wind.&rdquo;
          </Link>
        </P>

        <P>
          Later writers followed the poets. Pliny set the Hyperboreans behind the Rhipaean mountains,
          past a country he calls{' '}
          <Link href="/book/historia-naturalis-ed-johannes-andreas-bishop-of-aleria-plinius-secundus?page=108">
            Pterophoros, &ldquo;feather-bearing,&rdquo; because of the constant fall of snow in the likeness of
            feathers
          </Link>
          , a part of the world cursed by nature; beyond it, he says, the sun rises once a year and the people, tired
          of living, feast and jump into the sea. Solinus, copying him two centuries later, decided that so many
          authors could not all be wrong:{' '}
          <Link href="/book/c-iulii-solini-polyhistor-1543-solinus?page=79">
            &ldquo;let no one fear the false. We shall, therefore, speak of the Hyperboreans.&rdquo;
          </Link>
        </P>

        <ContextNote title="Why Delos">
          <p>
            Delos is a rock three miles long in the middle of the Cyclades. Greeks believed Apollo and Artemis had
            been born there, and from the eighth century BCE the Ionian cities sent choirs and ships to its festival.
            Herodotus names the sanctuary of Artemis, the tomb inside it and the hymns of Olen the Lycian as things
            a visitor could still see and hear in his day.
          </p>
          <p>
            A parcel arriving by relay was not strange to a Greek. Cities sent first-fruits to Delphi and Delos by
            sacred embassies, and the Delians kept a list of them. What was strange about this one was that it came
            from outside the Greek world, from senders nobody could name, and that it kept coming.
          </p>
        </ContextNote>

        <Section>A golden thigh</Section>

        <P>
          The one Hyperborean with a name is the man Herodotus refused to talk about. Abaris, priest of Apollo, got
          a whole career from the biographers of Pythagoras who wrote in the third and fourth centuries CE. In
          Iamblichus he comes south{' '}
          <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=189">
            &ldquo;gathering gold for the temple and predicting a plague. He stayed in the temples, and he was
            never seen drinking or eating anything.&rdquo;
          </Link>{' '}
          He purifies Sparta, which the story says never had the plague again, and the Spartans showed a temple of
          Kore the Saviour that{' '}
          <Link href="/book/accurata-graeciae-descriptio-greek-latin-pausanias?page=110">
            some said Orpheus had built and others &ldquo;Abaris when he came from the Hyperboreans.&rdquo;
          </Link>{' '}
          Then he meets Pythagoras, an old man from the north,{' '}
          <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=153">
            &ldquo;inexperienced in Greek education and uninitiated,&rdquo;
          </Link>{' '}
          and takes the philosopher for the god he serves. Pythagoras does not correct him:
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
          Pythagoras waives the five years of silence his other pupils served, teaches the old man the doctrine of
          the gods in brief, and takes his golden arrow,{' '}
          <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=189">
            &ldquo;without which he was unable to find his way.&rdquo;
          </Link>{' '}
          Later writers remembered the arrow. In the later versions Abaris rides it over rivers and seas. The pagan
          critic Celsus set him beside Jesus as a man who flew on an arrow and whom nobody called a god, and Origen
          answered:{' '}
          <Link href="/book/opera-omnia-xviii-contra-celsum-i-iv-lommatzsch-origen?page=302">
            &ldquo;what did he himself gain by being carried on an arrow?&rdquo;
          </Link>{' '}
          Erasmus entered it among his <em>Adages</em>:{' '}
          <Link href="/book/adagiorum-opus-erasmus-desiderius?page=1096">
            <em>Abaridos oistos</em>, &ldquo;the arrow of Abaris, is said of those who are swift.&rdquo;
          </Link>
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
          Where he came from was argued as hard as where Hyperborea was. In 1706 Carl Gottfried Zapf devoted a whole
          disputation to Abaris and then declined to say, because{' '}
          <Link href="/book/disp-hist-de-abaride-zapf?page=20">
            &ldquo;to designate in what region that people held a fixed seat is dangerous.&rdquo;
          </Link>{' '}
          British writers were readier to say. Godfrey Higgins, in 1827:
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
          Higgins himself guessed that the arrow had been the magnetic needle. Modern scholars read Abaris beside a
          second man in Herodotus, Aristeas of Proconnesus, who{' '}
          <Link href="/book/erodotou-logoi-ennea-oiper-epikalountai-mousai-herodoti-libr?page=170">
            said in his poem that he had travelled to the Issedones &ldquo;while inspired by Apollo,&rdquo;
          </Link>{' '}
          died in a fuller&apos;s shop, was seen the same day on the road to Cyzicus, and turned up again three
          hundred and forty years later in southern Italy, saying he had followed the god in the shape of a raven.
          E. R. Dodds grouped the two with Epimenides and Hermotimus as Greek shamans, holy men who fasted and left
          their bodies and came, or were said to come, from the Scythian north. On that reading Abaris is less a
          visitor from Hyperborea than the Greeks&apos; picture of what a northern holy man was like.
        </P>

        <ContextNote title="Pythagoras and his biographers">
          <p>
            Pythagoras of Samos settled at Croton in southern Italy around 530 BCE and founded a community that
            kept its teachings secret and its members silent for years. He wrote nothing. Almost everything told
            about him, including the golden thigh, comes from lives written eight centuries later by the
            Neoplatonists Porphyry and Iamblichus, who wanted a pagan holy man to set against the Christian saints.
          </p>
          <p>
            The Abaris episode does a particular job in those lives: a priest of Apollo from the ends of the earth
            recognises Pythagoras as the god himself. Herodotus, who settled at Thurii a few days&apos; walk from
            Croton while the Pythagorean communities were still active, knew Abaris only as a man with an arrow.
          </p>
        </ContextNote>

        <Section>What else came from the north</Section>

        <P>
          Pausanias, walking through Greece in the second century CE, kept finding things the locals said had
          come from the Hyperboreans. At Delphi the oracle itself:
        </P>

        <SourceQuote
          book="accurata-graeciae-descriptio-greek-latin-pausanias"
          page={337}
          printedPage={321}
          src="https://images.sourcelibrary.org/pages/69938e26d5a98fd66f4307b0/0337.jpg"
          source={<>Pausanias, <em>Description of Greece</em> 10.5, Greek and Latin edition (Frankfurt, 1583), English translation by Source Library</>}
          pageAlt="Page 321 of the 1583 Greek-Latin Pausanias, Book 10, with the hexameters of Boeo on the Hyperborean founders of Delphi"
        >
          Here indeed a well-remembered oracle was established / By the children of the Hyperboreans, Pagasus and
          divine Agyieus. And Boeo, a native woman, in a hymn she composed for the Delphians, named Olen at the end
          of the poem: And Olen, who became the first prophet of Phoebus, / And first fashioned a song of ancient
          hexameters.
        </SourceQuote>

        <P>
          On the same page the Delphians say their second temple was made by bees out of wax and feathers and{' '}
          <Link href="/book/accurata-graeciae-descriptio-greek-latin-pausanias?page=337">
            &ldquo;sent to the Hyperboreans by Apollo.&rdquo;
          </Link>{' '}
          When the Gauls attacked Delphi in 279 BCE, thunderbolts and falling rocks drove them off, and among the
          armed phantoms that stood against them{' '}
          <Link href="/book/accurata-graeciae-descriptio-greek-latin-pausanias?page=20">
            &ldquo;some came from the Hyperboreans, namely Hyperochus and Amadocus.&rdquo;
          </Link>{' '}
          In Attica, Eileithyia, goddess of childbirth,{' '}
          <Link href="/book/accurata-graeciae-descriptio-greek-latin-pausanias?page=32">
            &ldquo;came from the Hyperboreans to Delos to assist Leto in her labor pains.&rdquo;
          </Link>{' '}
          And at Prasiae on the Attic coast Pausanias found the parcel again, six hundred years after Herodotus,
          arriving by a different road:
        </P>

        <SourceQuote
          book="accurata-graeciae-descriptio-greek-latin-pausanias"
          page={46}
          printedPage={30}
          src="https://images.sourcelibrary.org/pages/69938e26d5a98fd66f4307b0/0046.jpg"
          source={<>Pausanias, <em>Description of Greece</em> 1.31, Greek and Latin edition (Frankfurt, 1583), English translation by Source Library</>}
          pageAlt="Page 30 of the 1583 Greek-Latin Pausanias, Book 1, on the first-fruits of the Hyperboreans at Prasiae"
        >
          They say the Hyperboreans pass them to the Arimaspians, the Arimaspians to the Issedonians, and from these
          the Scythians carry them to Sinope, whence they are carried through the Greeks to Prasiae; it is the
          Athenians who take them to Delos. These first-fruits are hidden in wheat-stalks, and are known by no one.
        </SourceQuote>

        <P>
          Herodotus&apos;s route came down to the head of the Adriatic and across northern Greece. Pausanias&apos;s
          comes through the Black Sea, by way of the one-eyed Arimaspians and the griffins who guard the gold of the
          steppe. Six centuries apart, neither writer knows what is in the straw.
        </P>

        <Section>Apollo&apos;s tears</Section>

        <P>
          There was one northern thing a Greek could hold in his hand, and it had a story of its own. When Phaethon
          took his father&apos;s chariot and fell burning into the river Eridanus, his sisters wept on the bank until
          they turned into poplars, and their tears hardened into amber. Pliny lists the poets who told it,{' '}
          <Link href="/book/c-plinii-secundi-naturalis-historiae-vol-3-1535-aldine-elder?page=555">
            &ldquo;first as I think, Aeschylus, Philoxenus, Nicander, Euripides, and Satyrus,&rdquo;
          </Link>{' '}
          and then spends two pages on the Greek accounts of where amber came from, none of which he believes.
          Apollonius of
          Rhodes, sailing the Argonauts up the Eridanus past the still-smoking wreck, records a second version:
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
          The Heliades become poplars by the Eridanus while their cousin Cygnus becomes a swan. Engraving after
          Hendrick Goltzius, from his series on Ovid&apos;s <em>Metamorphoses</em> (c. 1590).
        </PageFigure>

        <P>
          Herodotus did not believe in the river. He had never found anyone who had seen a sea beyond
          Europe, and the name Eridanus was Greek, made up by some poet. But he knew the goods were real:
        </P>

        <SourceQuote
          book="erodotou-logoi-ennea-oiper-epikalountai-mousai-herodoti-libr"
          page={181}
          printedPage={102}
          src="https://images.sourcelibrary.org/pages/6a08527915c643eb1af4d06d/0181.jpg"
          source={<>Herodotus, <em>Histories</em> 3.115, Aldine edition (Venice, 1502), English translation by Source Library</>}
          pageAlt="Page 102 of the 1502 Aldine Herodotus, Greek text of Book 3 with marginal headings for Eridanus, amber, the Tin Islands and the griffins"
        >
          I do not believe in the existence of a river called by the barbarians the Eridanus, which flows into the
          northern sea, from which it is said that amber comes, nor do I know of any Tin Islands from which our tin
          comes. The very name Eridanus reveals that it is Greek, not barbaric, having been invented by some poet.
          Though I have investigated, I have never been able to hear from an eyewitness how there is a sea beyond
          Europe. Yet it is from the furthest reaches that tin and amber come to us.
        </SourceQuote>

        <P>
          A century after him a Greek did see that sea. Pliny reports what Pytheas of Marseille found there:{' '}
          <Link href="/book/c-plinii-secundi-naturalis-historiae-vol-3-1535-aldine-elder?page=556">
            amber &ldquo;reaches the Guttones, a people of Germany,&rdquo; at an estuary of the ocean, and an island
            called Abalus a day&apos;s sail off, where &ldquo;it is carried by the waves in the spring, and it is the
            refuse of the congealed sea. The inhabitants use it as wood for fire&rdquo;
          </Link>{' '}
          and sell the rest to their neighbours. Diodorus, who had the same facts from somewhere, drops the
          poplars altogether:{' '}
          <Link href="/book/bibliotheca-historica-siculus?page=242">
            &ldquo;amber is actually gathered on the island called Basilia and is washed up by the waves against the
            opposite mainland; through this mainland, it is carried to our regions.&rdquo;
          </Link>{' '}
          Tacitus, in the <em>Germania</em>, finally names the gatherers: the Aestii on the right-hand shore of the
          Baltic, who wear the figure of a boar as the emblem of the Mother of the Gods and alone of all peoples
          collect amber, which they call <em>glesum</em>, from the shallows and the beach, and are astonished at
          the price it fetches.
        </P>

        <P>
          So by the first century CE the Greeks and Romans had two chains running out of the north. One carried a
          parcel nobody opened to Delos. The other carried a substance everyone could see, from a cold sea past
          the Guttones and the Celts to the peasant women beyond the Po, who, Pliny says, wore it as necklaces, for ornament
          and as medicine. Early modern readers on the Baltic coast would put the two chains together and take them for
          one.
        </P>

        <ContextNote title="What the ground says about amber">
          <p>
            Amber is fossil tree resin. The largest deposits in the world lie on the south-eastern shore of the
            Baltic, around the Samland peninsula, where storms still throw it up on the beach. Baltic amber
            (succinite) has a chemical signature that other European ambers lack, and from the 1960s Curt Beck&apos;s
            laboratory at Vassar used infrared spectroscopy to show that the amber in Mycenaean graves, and later
            in the great Greek sanctuaries, was Baltic.
          </p>
          <p>
            Alessandro Naso&apos;s report on the sanctuary of Artemis at Ephesos found all thirty samples tested to be
            Baltic, some of them raw lumps carved on the spot, and traced their likely route down the Adriatic by
            way of Etruscan Verucchio and the Hallstatt workshops of Slovenia, the same corner of the sea where
            Herodotus&apos;s parcel turned south. Amber also came to Sparta, Perachora, Lindos and Delos. Whether a
            single &ldquo;amber route&rdquo; ever existed, rather than many short exchanges, archaeologists still
            argue; and nothing says the parcel in straw held amber.
          </p>
        </ContextNote>

        <Section>Thule</Section>

        <P>
          The man who first sailed that northern sea was not looking for Hyperborea. Around 325 BCE Pytheas, an
          astronomer from the Greek colony at Marseille, went north past Britain and came back with a report of an
          island where the midsummer sun did not set. Pliny gives the distance:{' '}
          <Link href="/book/historia-naturalis-ed-johannes-andreas-bishop-of-aleria-plinius-secundus?page=69">
            &ldquo;That this happens in the island of Thule, Pytheas of Massilia wrote, which is distant by a
            six-day journey to the North from Britain,&rdquo;
          </Link>{' '}
          and adds that{' '}
          <Link href="/book/historia-naturalis-ed-johannes-andreas-bishop-of-aleria-plinius-secundus?page=111">
            &ldquo;a one-day voyage from Tyle is the frozen sea, which some call the Cronium.&rdquo;
          </Link>{' '}
          Beyond Thule, Pytheas said, there was no longer land or sea or air but a mixture of all three that could
          not be walked or sailed, something like a jellyfish. Strabo, who thought the whole voyage a lie, kept
          the comparison in order to mock it, and Gerardus Vossius was still listing the charge in 1624: Strabo
          called him{' '}
          <Link href="/book/de-historicis-graecis-vossius?page=563">
            <em>andra pseudestaton</em>, &ldquo;a most lying man.&rdquo;
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
          Clüver&apos;s map of the north drawn, as its cartouche says, &ldquo;to the false notion of the ancient
          writers.&rdquo; Thule lies north of Britain beside the Mare Cronium; the <em>Hyperborei</em> sit along the
          Rhipaean mountains at the top of the world. The two halves of the folding plate are joined here.
        </PageFigure>

        <P>
          Later writers put Thule in different places. Procopius in the sixth century made it Scandinavia, where the
          people, after a{' '}
          <Link href="/book/procopii-caesariensis-opera-omnia-caesarea?page=489">
            &ldquo;great and perpetual night of thirty-five days,&rdquo;
          </Link>{' '}
          sent watchers up the mountains to look for the sun. Adam of Bremen around 1075 settled it on Iceland:{' '}
          <Link href="/book/gesta-hammaburgensis-ecclesiae-pontificum-bremen?page=212">
            &ldquo;This Thyle is now called Island, from the ice which binds the ocean.&rdquo;
          </Link>{' '}
          Olaus Magnus, the exiled Swedish archbishop, agreed in 1555 and drew the map.
        </P>

        <div className="max-w-lg mx-auto">
          <PageFigure
            src="https://images.sourcelibrary.org/pages/699065763dc2ed39a49f155d/0098.jpg"
            alt="Woodcut map of Scandinavia, Finland and the northern seas, with Iceland labelled Islandia at top left"
            href="/book/historia-de-gentibus-septentrionalibus-magnus?page=98"
            source={<>Olaus Magnus, <em>Historia de gentibus septentrionalibus</em> (1555)</>}
          >
            Olaus Magnus&apos;s woodcut map of the northern kingdoms. Iceland, his{' '}
            <Link href="/book/historia-de-gentibus-septentrionalibus-magnus?page=152">&ldquo;ultimate Thule,&rdquo;</Link>{' '}
            is at top left as <em>Islandia</em>.
          </PageFigure>
        </div>

        <P>
          Learned writers kept the two places apart. Thule was somewhere a man said he had sailed to; Hyperborea
          was somewhere no road reached. John Toland in 1740 was careful to say that by Thule he meant{' '}
          <Link href="/book/a-critical-history-of-the-celtic-religion-and-learning-toland?page=198">
            &ldquo;only that of Pytheas, or Iceland,&rdquo;
          </Link>{' '}
          and by the island of the Hyperboreans something else. The Thule Society, founded in Munich in 1918, merged
          them into a lost Aryan homeland, which is where the name picked up the associations it has now.
        </P>

        <ContextNote title="Pytheas of Marseille">
          <p>
            Massalia, now Marseille, was founded by Greeks from Asia Minor around 600 BCE and was the Greek
            world&apos;s window on the Celtic west. Pytheas, a citizen there in the generation of Alexander, measured
            the latitude of his city with a gnomon, worked out that the tides follow the moon, and sailed, or
            says he sailed, round Britain and on to Thule, perhaps Iceland, perhaps the Norwegian coast. His book,
            <em> On the Ocean</em>, is lost; we have it only in the quotations of people who mostly disbelieved
            him.
          </p>
          <p>
            He is also the first Greek who seems to have reached the amber coast, or met people who had: Pliny
            cites him for the Guttones and the island of Abalus. In 1641 Pierre Gassendi, defending a fellow
            Provençal, called him{' '}
            <Link href="/book/viri-illustris-nicolai-claudii-fabricii-de-peiresc-vita-gassendi?page=322">
              &ldquo;the oldest scholar the entire West possesses.&rdquo;
            </Link>
          </p>
        </ContextNote>

        <Section>A round temple opposite the Celts</Section>

        <P>
          The most detailed Hyperborea in Greek was written by Hecataeus of Abdera around 300 BCE, a generation
          after Pytheas came home. Diodorus of Sicily preserved it:
        </P>

        <SourceQuote
          book="bibliotheca-historica-siculus"
          page={123}
          printedPage={91}
          src="https://images.sourcelibrary.org/pages/69a956dc65ddd05bbcd3d160/0123.jpg"
          source={<>Diodorus of Sicily, <em>Library of History</em> 2.47, ed. Henri Estienne (Geneva, 1559), English translation by Source Library</>}
          pageAlt="Page 91 of Estienne's Greek Diodorus, Book 2, on the island of the Hyperboreans opposite the land of the Celts"
        >
          Hecataeus and certain others say that in the regions opposite the land of the Celts, there is an island in
          the ocean no smaller than Sicily. This island lies toward the north and is inhabited by those called
          Hyperboreans, because they are situated further away from the northern blast. The land is fertile and
          produces all kinds of crops; moreover, excelling in temperate climate, it yields fruit twice each year.
        </SourceQuote>

        <P>
          Leto was born there, which is why Apollo is honoured above all gods; there is &ldquo;a notable temple
          adorned with many offerings, which is spherical in shape,&rdquo; a city of harpers who sing to the god all
          day, and{' '}
          <Link href="/book/bibliotheca-historica-siculus?page=124">
            the moon &ldquo;appears from this island to be only a very short distance from the earth&rdquo;
          </Link>
          ; the god visits every nineteen years, when the stars return to their places, and dances through the
          nights from the spring equinox to the rising of the Pleiades. The same page sends Abaris south to renew
          the Hyperboreans&apos; old friendship with the Delians.
        </P>

        <P>
          Readers in Britain thought of Stonehenge. William Stukeley wrote in 1740 that Diodorus{' '}
          <Link href="/book/stonehenge-stukeley?page=161">
            &ldquo;gives an odd account from thence mix&apos;d with fable, and seemingly some reports of Stonehenge
            itself.&rdquo;
          </Link>{' '}
          William Borlase quoted the moon passage as if the islanders{' '}
          <Link href="/book/antiquities-historical-and-monumental-of-the-county-of-borlase?page=114">
            &ldquo;had the use of telescopes,&rdquo;
          </Link>{' '}
          John Smith counted{' '}
          <Link href="/book/choir-gaur-the-grand-orrery-of-the-ancient-druids-commonly-smith?page=42">
            nineteen stones in the inner oval
          </Link>{' '}
          of Stonehenge, and Richard Payne Knight concluded that{' '}
          <Link href="/book/an-account-of-the-remains-of-the-worship-of-priapus?page=140">
            &ldquo;the Island I think can be no other than Britain.&rdquo;
          </Link>
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
          Some of it fits. Britain lies opposite Gaul and is larger than Sicily. The moon&apos;s rising and setting
          points swing to their extremes and back over 18.6 years, and the four Station Stones at Stonehenge form a
          rectangle that many archaeoastronomers read as aligned on those extremes. Pytheas had just sailed round
          the island, so news of its stone circles could have reached Hecataeus. Some of it does not. Stonehenge was
          already more than a thousand years old and whatever Hecataeus heard described a ruin or a living cult somewhere
          else; the nineteen years are a Greek number, the cycle Meton announced at Athens in 432 BCE; and two
          harvests a year and a city of harpers sound more like a wished-for country than a report. A story about
          British stone circles may lie behind the passage. Nothing in it proves which circle, or that it was a
          circle at all.
        </P>

        <P>
          There is a bolder version of the British case: that the parcels reaching Delos were sent by druids, and
          that the druids were Pythagoreans. Caesar did write that the druids&apos; discipline{' '}
          <Link href="/book/c-iulii-caesaris-commentariorum-de-bello-gallico-libri-8-ciu-2?page=189">
            &ldquo;is thought to have been invented in Britain and transferred from there into Gaul,&rdquo;
          </Link>{' '}
          that they teach above all{' '}
          <Link href="/book/c-iulii-caesaris-commentariorum-de-bello-gallico-libri-8-ciu-2?page=190">
            &ldquo;that souls do not perish, but after death pass to others,&rdquo;
          </Link>{' '}
          and that their Apollo{' '}
          <Link href="/book/c-iulii-caesaris-commentariorum-de-bello-gallico-libri-8-ciu-2?page=191">
            &ldquo;drives away diseases,&rdquo;
          </Link>{' '}
          which is what Abaris did at Sparta. Greeks of the fourth century did call the Celts Hyperboreans:
          Hellanicus put them{' '}
          <Link href="/book/argonautica-editio-princeps-lascaris-rhodius?page=159">
            &ldquo;beyond the Alps of Italy,&rdquo;
          </Link>{' '}
          and Heraclides of Pontus called the Gauls who sacked Rome{' '}
          <Link href="/book/histoire-des-celtes-pelloutier?page=68">
            &ldquo;an Army, coming from the country of the Hyperboreans.&rdquo;
          </Link>{' '}
          But no source says Celts sent the parcels, the druids are first named in Greek two and a half centuries
          after Herodotus, and the Pythagorean druid goes back to one Greek ethnographer, Posidonius, explaining a
          foreign belief in his own terms. Henri d&apos;Arbois de Jubainville called it, in 1895, a hypothesis{' '}
          <Link href="/book/studies-on-celtic-law-jubainville?page=30">
            &ldquo;flattering to the self-esteem of the Greeks.&rdquo;
          </Link>
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

        <ContextNote title="The twelve-sided bronzes">
          <p>
            One class of object keeps being drawn into the druid argument: the hollow bronze dodecahedra of Roman
            Gaul, about 130 of them, four to eleven centimetres across, with a round hole of a different size in
            each face and a knob at each corner. They date from the second to fourth centuries CE and turn up in
            France, the Low Countries, Germany, Britain and the Danube provinces, never in Italy. No ancient text
            mentions them and none carries a mark. More than fifty uses have been proposed; the museum at Tongeren,
            which holds a complete one found in 1939, leans toward ritual or divination.
          </p>
          <p>
            The dodecahedron was the Pythagoreans&apos; secret figure, the one Iamblichus says Hippasus{' '}
            <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=152">
              &ldquo;was the first to divulge and write down&rdquo;
            </Link>{' '}
            and drowned for it, and Plato gave it to the cosmos in the <em>Timaeus</em>. So someone in the Celtic
            provinces under Rome was casting the Pythagorean shape of the universe. But these objects are six to
            eight centuries later than the parcels, and gold ones with the same holes and knobs have been found at
            Óc Eo in the Mekong delta, which makes a purely druidic explanation hard to hold.
          </p>
        </ContextNote>

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

        <Section>Everyone&apos;s Hyperborea</Section>

        <P>
          From the sixteenth century on, nearly every northern nation found a scholar to prove that it was the land
          beyond the north wind, usually from the same dozen classical pages, and usually arriving at home. The
          timeline below puts them side by side.
        </P>

        <HyperboreaTimeline />

        <P>
          In Sweden, Olof Rudbeck&apos;s <em>Atlantica</em> (1679–1702) made his country both Plato&apos;s Atlantis
          and Hyperborea. The name, he argued, came not from the Greek <em>boreas</em> but from the Swedes&apos; most
          ancient king Boreus, so that{' '}
          <Link href="/book/hymni-epigrammata-et-fragmenta-callimachus?page=563">
            <em>Oferborne</em>, &ldquo;Hyperboreans,&rdquo; meant the nobly born
          </Link>
          . In Britain Toland placed them in the Hebrides,{' '}
          <Link href="/book/a-critical-history-of-the-celtic-religion-and-learning-toland?page=203">
            &ldquo;as I fancy it can scarce hereafter be doubted,&rdquo;
          </Link>{' '}
          John Wood made Abaris and Bladud, the legendary founder of Bath,{' '}
          <Link href="/book/choir-gaure-vulgarly-called-stonehenge-on-salisbury-plain-wood?page=9">
            &ldquo;one and the same man,&rdquo;
          </Link>{' '}
          Borlase found the round temple in Cornwall, and Higgins wrote that by the Hyperboreans the Greeks{' '}
          <Link href="/book/the-celtic-druids-higgins?page=346">
            &ldquo;generally meant the British isles.&rdquo;
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
          Russians were called Hyperboreans before they claimed to be. In a dialogue Alexander Herzen wrote at Nice
          in 1869 a French doctor greets the Russian narrator as &ldquo;my dear Hyperborean,&rdquo; and he answers,{' '}
          <Link href="/book/2-herzen?page=239">
            &ldquo;do not call me a Hyperborean. Firstly, the word makes me cold every time,&rdquo;
          </Link>{' '}
          and it recalls the Paris of Montesquieu, which had called Peter the Great <em>le Grand Tzar
          hyperbor&eacute;en</em>. In 1922 Alexander Barchenko led an expedition to the Kola Peninsula in search of an
          ancient northern civilisation, and since the 1990s Russian esoteric and nationalist writers, Aleksandr
          Dugin among them, have placed Hyperborea in the Russian Arctic. The oldest Greek route did run that way:
          Aristeas went north-east past the Scythians, and Pausanias&apos;s parcel came by Sinope.
        </P>

        <P>
          Others moved it off the map of nations altogether. The astronomer Jean-Sylvain Bailly argued in the 1770s
          that the sciences had been invented by a lost northern people. William Warren&apos;s{' '}
          <em>Paradise Found</em> (1885) put Eden at the North Pole and Bal Gangadhar Tilak&apos;s <em>Arctic Home in
          the Vedas</em> (1903) put the Aryans there. Helena Blavatsky made the Hyperboreans the second of her root
          races, and she used the amber to prove it: the Eridanus could not be the Po, because{' '}
          <Link href="/book/the-secret-doctrine-synthesis-of-science-religion-and-blavatsky?page=838">
            &ldquo;amber is found only in the northern seas, in the Baltic.&rdquo;
          </Link>{' '}
          From there the polar homeland passed to Herman Wirth and the <em>Ahnenerbe</em>, and it has not left the
          far right since.
        </P>

        <P>
          The German geographer Philipp Clüver, in 1616, took the amber rather than the Hyperboreans and followed
          it to the Vistula. The amber river, he argued, was the Radaune, which reaches the sea at Danzig; the Greeks
          had heard its name as Eridanus, and the name later slid onto the Po and the Rh&ocirc;ne because amber was
          shipped through them:{' '}
          <Link href="/book/germaniae-antiquae-libri-tres-cluver?page=886">
            &ldquo;This confusion of the three rivers, Rhone, Po, and Vistula, is truly strange.&rdquo;
          </Link>{' '}
          That argument, made by a German about a river in Prussia, is where the Baltic historians picked up the
          thread.
        </P>

        <Section>The amber coast answers</Section>

        <P>
          Christoph Hartknoch taught at the gymnasium in Thorn, now Toru&nacute;, and in 1684 published{' '}
          <em>Alt- und Neues Preussen</em>, Old and New Prussia, a history of the land and its pagan religion with
          engraved plates. He surveys the places scholars had looked for the Eridanus, in Italy, on the
          Rh&ocirc;ne, in Africa, Britain, even India, and then turns Herodotus&apos;s doubt about the amber river
          to his own country&apos;s account:
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
          Diodorus&apos;s Basilia, where amber washes ashore, he reads as{' '}
          <Link href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch?page=36">
            Samland, the amber peninsula north of K&ouml;nigsberg
          </Link>
          . Diodorus had called it an island; Hartknoch answers that the sea, the two lagoons and the rivers enclose
          Samland on every side, and that Adam of Bremen also counted it among the islands. He states his purpose
          plainly: to prove that &ldquo;even before the birth of Christ, and also long before the times of
          Herodotus, people lived in these places who gathered amber and sold it to other lands.&rdquo; He does not
          claim the Hyperboreans for Prussia; he allows that Diodorus may have meant Zealand or Sweden. What he
          wants from the Greeks is a place in the oldest histories there are.
        </P>

        <div className="max-w-md mx-auto">
          <PageFigure
            src="/articles/hyperborea/hartknoch-samland-amber.jpg"
            alt="Engraved bird's-eye view of the Samland coast with ships on the sea and people in the shallows, and below it a large lump of amber on a draped table"
            href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch?page=134"
            source={<>Christoph Hartknoch, <em>Alt- und Neues Preussen</em> (1684)</>}
          >
            Hartknoch&apos;s view of Samland (<em>Samlandt</em>), between the Baltic (<em>Oost See</em>) and the
            Frisches Haff, with people working the shallows; below it, a lump of amber, from his chapter on the
            nature of amber.
          </PageFigure>
        </div>

        <P>
          The Prussian origin legend ran through the same geography. The Dominican chronicler Simon Grunau, writing
          in the 1520s, gave the Prussians a migration from Scandinavia, a priest-king called Widewuto, and a
          sanctuary at Romove where three gods stood in an evergreen oak. He had found in Erasmus Stella that{' '}
          &ldquo;the Borussian peoples, who according to Ptolemy had their seats at the Rhipaean mountains,&rdquo;
          had entered Prussia, and he put the Rhipaean mountains in Norway. These were the mountains behind which
          Pliny had put the Hyperboreans. So the Prussians&apos; own founding story began, by way of a misread
          geography, on the threshold of Hyperborea.
        </P>

        <PageFigure
          src="/articles/trees-of-life/hartknoch-romowe.jpg"
          alt="Engraving of a great oak behind a wooden screen with three idols in niches, a fire burning before it, a village around"
          href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch?page=87"
          source={<>Christoph Hartknoch, <em>Alt- und Neues Preussen</em> (1684)</>}
          wide
        >
          The oak of Romove with its three idols, as Grunau described it and Hartknoch engraved it.
        </PageFigure>

        <P>
          Hartknoch engraved the whole legend, including the war banner of Widewuto with the three gods: Patollo,
          old and grey-bearded, god of the dead; Perkuno the thunderer, with a face like fire; and young Potrimpo,
          crowned with ears of grain. The folklorist Wilhelm Mannhardt, whose study of Baltic religion was
          published in 1936, half a century after his death, went through Grunau source by source. His verdict was that
          &ldquo;like the entire triad, the image of the gods on the war flag of Widewut with the enigmatic
          inscription and the coat of arms of the first king are inventions.&rdquo; His clue was the horses: heraldic beasts holding
          up a shield came in only in the fourteenth century. Perk&umacr;nas, at least, is real. The thunder god is in Lithuanian, Latvian and
          Prussian sources and still in the folk songs.
        </P>

        <PageFigure
          src="/articles/hyperborea/hartknoch-widewuto-banner.jpg"
          alt="Engraving of a banner showing three male busts, one bearded in a cap, one with a crown of flames, one crowned with ears of grain, above a shield held by two rearing horses"
          href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch?page=143"
          source={<>Christoph Hartknoch, <em>Alt- und Neues Preussen</em> (1684), after Simon Grunau</>}
        >
          The banner of Widewuto with Patollo, Perkuno and Potrimpo. The rearing horses were Mannhardt&apos;s
          clue that it was a later invention.
        </PageFigure>

        <P>
          A century and a half later the argument moved from Prussia to Lithuania and from amber to language. Teodor
          Narbutt opened his <em>Ancient History of the Lithuanian Nation</em> (1835) with the sun. He is discussing a
          Samogitian prayer to the fire god Gabie that peasants still said in their drying barns:
        </P>

        <SourceQuote
          book="ancient-history-of-the-lithuanian-nation-vol-1-lithuanian-narbutt"
          page={37}
          src="https://images.sourcelibrary.org/pages/6a209d3389e8715c5947a32b/0037.jpg"
          source={<>Teodor Narbutt, <em>Dzieje staro&#380;ytne narodu litewskiego</em>, vol. 1 (1835), English translation by Source Library</>}
          pageAlt="Page 18 of Narbutt's Polish text, on the Samogitian prayer to Gabie and the Hyperborean Apollo"
        >
          The worship of fire and the sun, or Apollo, merged into one among all nations. Fire and the sun everywhere
          received worship where the pagan religion had external pomp and priests. The Greeks used to say that the
          worship of Apollo among the northern peoples was very famous, for which reason they called him
          Hyperboreans.
        </SourceQuote>

        <P>
          Later in the volume Narbutt derived Lithuanian{' '}
          <Link href="/book/ancient-history-of-the-lithuanian-nation-vol-1-lithuanian-narbutt?page=480">
            &ldquo;directly and immediately&rdquo; from Sanskrit
          </Link>
          , as Sanskrit <em>devas</em>, god, survives in Lithuanian <em>Dievas</em>, Latvian <em>Dievs</em> and
          Prussian <em>Deiws</em>. Half of that is right: Lithuanian is among the most conservative of the
          Indo-European languages and the cognates are real, but it is a sister of Sanskrit, not a daughter. The
          claim gave a small nation inside the Russian Empire a lineage older than Greece and Rome, which is what
          Hartknoch had wanted from the amber a hundred and fifty years before.
        </P>

        <ContextNote title="Why Prussia and Lithuania wanted the Greeks">
          <p>
            The Old Prussians, a Baltic people related to the Lithuanians and Latvians, were conquered by the
            Teutonic Knights in the thirteenth century and had lost their language by about 1700. The Prussia of
            Hartknoch&apos;s day was German-speaking country on their land, divided between the Polish crown and the
            Elector in Berlin, with no classical past of its own and a pagan one that its chroniclers had partly invented. A mention in Herodotus or Diodorus
            was the only antiquity on offer.
          </p>
          <p>
            Lithuania in 1835 had been part of the Russian Empire for forty years and had just lost an uprising. Its
            university at Vilnius was closed in 1832. Narbutt, a retired army engineer writing in Polish, was
            building a national history for a nation that had no state, and the newly discovered kinship of
            Lithuanian with Sanskrit was the best evidence anyone had yet offered that the Balts were older than
            their rulers.
          </p>
        </ContextNote>

        <Section>What the chain carried</Section>

        <P>
          Set the Greek texts side by side and they describe two things. One is a people of Apollo at the edge of
          the world, whom Herodotus already doubted and whom later writers furnished with their own ideals. The
          other is a chain of hands that brought amber and tin south out of northern Europe to people who did not
          know where it started.
        </P>

        <P>
          If a real cult stood behind the stories, Thrace is the nearest candidate. The one
          Hyperborean rite Herodotus saw with his own eyes was Thracian, and Thrace had Zalmoxis, the teacher of
          immortality whom Herodotus makes a former slave of Pythagoras. In Plato&apos;s <em>Charmides</em> Socrates
          names the two northern kinds of healing in one breath:{' '}
          <Link href="/book/cologny-fondation-martin-bodmer-cod-bodmer-136-plato?page=304">
            &ldquo;the charms of Zalmoxis&rdquo; and &ldquo;those of Abaris the Hyperborean.&rdquo;
          </Link>{' '}
          Beyond Thrace lay the steppe, whose holy men fasted and travelled out of the body, and beyond the steppe
          the Celts, whom the Greeks of the fourth century called Hyperboreans outright. The Baltic is the far end.
          Its religion fits Apollo badly: the sun there is a goddess, Saul&#279;, the chief god is the thunderer, and
          the amber gatherers of Tacitus worship a Mother of the Gods. The Baltic peoples were very likely on the
          chain; nothing says they were at the end of it.
        </P>

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

        <P>
          The historians of Prussia and Lithuania lived on the amber coast and knew the Greeks had valued what
          washed up on their beaches. What they wanted from the classical pages was a national past, and those
          pages hold very little of one. The older religion of the Baltic
          peoples survives in thinner but better records: the treaty of 1249 between the Teutonic Order and the
          Prussians, the{' '}
          <Link href="/book/on-the-gods-of-the-samogitians-mannhardt">list of Samogitian gods</Link> that Jan
          &#321;asicki compiled in the 1580s, Matth&auml;us Praetorius&apos;s{' '}
          <Link href="/book/prussian-delights-prussian-lithuanian-religion-and-customs-pierson">
            <em>Deliciae Prussicae</em>
          </Link>{' '}
          from the Lithuanian villages of East Prussia, the{' '}
          <Link href="/book/dainos-lithuanian-folk-songs-reza"><em>dainos</em></Link> or folk songs, and
          Mannhardt&apos;s compendium of everything he could find. They sit in the{' '}
          <Link href="/collections/baltic-paganism">Baltic Paganism collection</Link> next to the Greeks they were
          measured against.
        </P>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h3 className="text-lg text-primary mb-4">A note on the texts</h3>
          <p className="text-secondary text-sm leading-relaxed mb-4">
            The Greek and Latin authors are quoted from original-language editions in the library, in Source
            Library&apos;s translations: the Aldine Herodotus of 1502, Estienne&apos;s Pindar (1566), Diodorus (1559)
            and Apollonius (1574), the Wechel Greek-Latin Pausanias of 1583, the 1470 Rome and 1535 Aldine Pliny,
            and Nauck&apos;s Iamblichus. Tacitus (<em>Germania</em> 45) and Strabo (2.4.1) are paraphrased, not
            quoted. The early modern and modern authors are quoted from the editions linked. Herodotus&apos;s
            chapters 4.32 to 36 run across pages 115 and 116 of the Aldine; the quotation above begins where page
            116 does.
          </p>
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
              Dodds, E. R. <em>The Greeks and the Irrational.</em> University of California Press, 1951.
            </li>
            <li>
              Naso, Alessandro. &ldquo;Amber for Artemis: Preliminary Report on the Amber Finds from the Sanctuary
              of Artemis at Ephesos.&rdquo; Austrian Academy of Sciences.
            </li>
            <li>
              Beck, Curt W., et al. &ldquo;Analysis and Provenience of Minoan and Mycenaean Amber.&rdquo;{' '}
              <em>Greek, Roman and Byzantine Studies</em>, from 1966.
            </li>
            <li>
              Guggenberger, Michael, and Stephen Leach. &ldquo;The Gallo-Roman Dodecahedron and the Receptacle of
              All Becoming.&rdquo; <em>The Antiquaries Journal</em> 105 (2025).
            </li>
            <li>
              Godwin, Joscelyn. <em>Arktos: The Polar Myth in Science, Symbolism, and Nazi Survival.</em> Phanes
              Press, 1993.
            </li>
            <li>
              V&#279;lius, Norbertas, ed. <em>Balt&#371; religijos ir mitologijos &scaron;altiniai.</em> 4 vols. Vilnius,
              1996–2005.
            </li>
          </ul>
        </section>
      </article>
    </ContentPageLayout>
  );
}
