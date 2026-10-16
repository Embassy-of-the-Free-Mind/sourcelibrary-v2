import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

const LEAD_IMAGE = 'https://images.sourcelibrary.org/artwork/art-phaetons-sisters-changed-into-poplars-cygnus-into-a-swan.jpg';
const LEAD_ALT =
  'Engraving after Hendrick Goltzius: the sisters of Phaethon turning into poplars beside his tomb on the river Eridanus, while Cygnus becomes a swan';

export const metadata: Metadata = {
  title: 'Beyond the North Wind: Hyperborea and the Amber Coast - Research Notes - Source Library',
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
    canonical: '/blog/hyperborea',
  },
};

const linkClass = 'text-accent-rust hover:text-accent-rust underline';
const captionLinkClass = 'text-accent-rust hover:text-accent-rust';

function Plate({
  src,
  alt,
  href,
  width,
  height,
  wide = false,
  children,
}: {
  src: string;
  alt: string;
  href: string;
  width: number;
  height: number;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <figure className={wide ? 'my-10' : 'my-10 max-w-md mx-auto w-full'}>
      <div className="rounded-xl overflow-hidden border border-accent-gold/10 shadow-md bg-stone-100">
        <Link href={href}>
          <Image src={src} alt={alt} width={width} height={height} className="w-full h-auto" unoptimized />
        </Link>
      </div>
      <figcaption className="text-xs text-muted mt-2 text-center">
        {children}{' '}
        <Link href={href} className={captionLinkClass}>
          View in collection →
        </Link>
      </figcaption>
    </figure>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">{children}</h2>;
}

function Quote({ children, cite, href }: { children: React.ReactNode; cite: React.ReactNode; href: string }) {
  return (
    <blockquote className="border-l-2 border-accent-gold/40 pl-5 my-8 text-secondary">
      <p className="leading-relaxed italic">{children}</p>
      <footer className="text-sm text-muted mt-2 not-italic">
        {cite}{' '}
        <Link href={href} className={captionLinkClass}>
          Read the page →
        </Link>
      </footer>
    </blockquote>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-secondary leading-relaxed mb-6">{children}</p>;
}

export default function HyperboreaPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Beyond the North Wind"
          subtitle="Hyperborea and the amber coast, from Herodotus to the historians of Prussia and Lithuania"
          image={LEAD_IMAGE}
          imageAlt={LEAD_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">16 October 2026 &middot; 16 min read</p>
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
          In the fifth century BCE the priests of Delos told Herodotus that every year a bundle arrived on their island
          from the far north, wrapped in wheat straw. It had passed from people to people across the whole of Europe.
          Nobody on Delos had met the senders. The Greeks called them the <em>Hyperboreans</em>, the people beyond
          the north wind. In another book Herodotus admits he cannot say where the north ends, only that{' '}
          <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=163" className={linkClass}>
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
          <Link href="/collections/baltic-paganism" className={linkClass}>
            Baltic Paganism
          </Link>{' '}
          collection, translated into English for the first time.
        </P>

        <Section>What the Greeks said</Section>

        <P>
          The oldest sources treat Hyperborea as a place that cannot be reached. Pindar, writing for a victor at the
          Pythian games in 498 BCE, puts it at the limit of human striving:
        </P>

        <Quote
          cite={<>Pindar, <em>Pythian</em> 10, tr. J. E. Sandys (1915).</>}
          href="/book/the-odes-of-pindar-sandys?page=346"
        >
          Neither by ships nor by land canst thou find the wondrous road to the trysting-place of the Hyperboreans.
          Yet among them, in olden days, Perseus, the leader of the people, shared the banquet on entering their homes
          and finding them sacrificing famous hecatombs of asses in honour of the god.
        </Quote>

        <P>
          The god is Apollo. The Hyperboreans are his people: he spends the winter with them, and they live long and
          free of sickness and war. Herodotus, a generation later, is the first to say plainly that he does not know
          whether they exist. Neither the Scythians nor anyone else in the north, he writes, has anything to say about
          them; the reports come from poets (Hesiod and the epic <em>Epigoni</em>) and from Delos. The Delians&apos;
          story is the strangest thing in his account:
        </P>

        <Quote
          cite={<>Herodotus, <em>Histories</em> 4.33, Loeb edition (1921), English translation by Source Library.</>}
          href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=254"
        >
          They claim that sacred offerings wrapped in wheat-straw are brought from the Hyperboreans into Scythia.
          When they have passed through Scythia, each neighboring nation receives them in turn until they are carried
          as far west as the Adriatic Sea. From there, they are brought southward, and the people of Dodona are the
          first of the Greeks to receive them.
        </Quote>

        <P>
          At first, the Delians said, the Hyperboreans sent two girls, Hyperoche and Laodice, with an escort of five
          men. None of them came home. After that the Hyperboreans carried the bundle only to their own border and
          asked their neighbours to pass it on. The girls&apos; tomb was still shown on Delos, under an olive tree to
          the left of the temple of Artemis, and Delian boys and girls cut a lock of their hair before marriage and
          laid it there. Herodotus{' '}
          <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=255" className={linkClass}>
            adds a detail he had seen himself
          </Link>
          : Thracian and Paeonian women never sacrificed to Artemis without wheat straw.
        </P>

        <P>
          Then he steps back. He will not tell the story of the Hyperborean Abaris, who{' '}
          <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=257" className={linkClass}>
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
          <Link href="/book/c-iulii-solini-polyhistor-1543-solinus?page=79" className={linkClass}>
            &ldquo;let no one fear the false. We shall, therefore, speak of the Hyperboreans.&rdquo;
          </Link>{' '}
          Diodorus of Sicily, drawing on the lost Hecataeus of Abdera, made Hyperborea an island &ldquo;no smaller
          than Sicily&rdquo; opposite the land of the Celts, with a round temple where Apollo came every nineteen
          years. The German antiquary Johann Georg Keyssler{' '}
          <Link href="/book/dissertatio-de-cultu-solis-keyssler?page=26" className={linkClass}>
            was still quoting the passage in 1728
          </Link>{' '}
          in a dissertation on sun worship.
        </P>

        <Section>Abaris and the golden arrow</Section>

        <P>
          The one Hyperborean with a name is Abaris, priest of Apollo. Herodotus gives him a single sentence and
          refuses to repeat the story. The later lives of Pythagoras, written in the third and fourth centuries CE
          by Porphyry and Iamblichus, give him a career. In Iamblichus he comes south{' '}
          <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=189" className={linkClass}>
            &ldquo;gathering gold for the temple and predicting a plague. He stayed in the temples, and he was never
            seen drinking or eating anything.&rdquo;
          </Link>{' '}
          He performs purifications at Sparta, after which, the story goes, Sparta never had the plague again;
          Pausanias, as an Italian literary historian{' '}
          <Link href="/book/istoria-de-poeti-greci-et-di-que-che-n-greca-lingua-han-crasso?page=17" className={linkClass}>
            noted in 1678
          </Link>
          , credits him with founding the Spartan temple of Kore the Saviour.
        </P>

        <P>
          Then he meets Pythagoras. Iamblichus describes him as an old man from the north,{' '}
          <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=153" className={linkClass}>
            &ldquo;inexperienced in Greek education and uninitiated&rdquo;
          </Link>
          , and says Pythagoras waived the five years of silence his other pupils served and taught him the doctrine
          of nature and of the gods in brief. Abaris takes Pythagoras for the god he serves, and is shown the proof:
        </P>

        <Quote
          cite={<>Iamblichus, <em>On the Pythagorean Life</em> 28, ed. A. Nauck (1884), English translation by Source Library.</>}
          href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=185"
        >
          For the fact that he displayed his golden thigh to Abaris the Hyperborean, who had surmised that he was the
          Apollo who is among the Hyperboreans, of whom Abaris was a priest, confirming that his assumption was true and
          not a deception, is very famous.
        </Quote>

        <P>
          Pythagoras also takes away Abaris&apos;s golden arrow,{' '}
          <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=189" className={linkClass}>
            &ldquo;without which he was unable to find his way.&rdquo;
          </Link>{' '}
          Near the end of the book the two men stand together before Phalaris, the tyrant of Acragas, and Abaris{' '}
          <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=238" className={linkClass}>
            asks &ldquo;concerning statues, the most holy forms of worship, the providence of the gods&rdquo;
          </Link>{' '}
          while Phalaris rages and blasphemes. The Hyperborean in these stories is a pious foreigner who confirms
          that Pythagoras is divine. His homeland matters only as the place Apollo goes when he leaves Greece.
        </P>

        <P>
          The arrow is what people remembered. In Porphyry and Iamblichus it is Apollo&apos;s gift, and Abaris
          rides it: as the German collector of magic lore Eberhard David Hauber quoted the Greek in 1739,{' '}
          <Link href="/book/bibliotheca-acta-et-scripta-magica-vol-ii-hauber?page=111" className={linkClass}>
            &ldquo;he crossed rivers and seas and impassable places, walking through the air, as it were.&rdquo;
          </Link>{' '}
          Hyginus made it the arrow Apollo shot the Cyclopes with and then hid under a mountain in the north. The
          pagan critic Celsus held Abaris up against Jesus as a man nobody called a god although he flew on an
          arrow, and Origen answered with a question:{' '}
          <Link href="/book/opera-omnia-xviii-contra-celsum-i-iv-lommatzsch-origen?page=302" className={linkClass}>
            &ldquo;what did he himself gain by being carried on an arrow?&rdquo;
          </Link>
        </P>

        <P>
          Christian writers kept the arrow as a figure. Gregory of Nazianzus, in his funeral oration for Basil, set
          the arrow of Abaris beside Pegasus as things whose flight mattered less than lifting the mind to God, and
          Erasmus entered it in his <em>Adages</em>:{' '}
          <Link href="/book/adagiorum-opus-erasmus-desiderius?page=1096" className={linkClass}>
            <em>Abaridos oistos</em>, &ldquo;the arrow of Abaris, is said of those who are swift&rdquo;
          </Link>
          . Nicolas Caussin&apos;s emblem book of 1623 glosses it as{' '}
          <Link
            href="/book/polyhistor-symbolicus-electorum-symbolorum-amp-parabolarum-caussin-2?page=587"
            className={linkClass}
          >
            &ldquo;a mind contemplating God, or fame.&rdquo;
          </Link>{' '}
          Later readers tried to explain it. Pierre Bayle, in a note Hauber summarised in 1738, compared it to the
          dowsers&apos; divining rod and judged that the rod, which found{' '}
          <Link
            href="/book/bibliotheca-acta-et-scripta-magica-grundliche-nachrichten-hauber?page=856"
            className={linkClass}
          >
            &ldquo;treasures, metals, the boundaries of fields, thieves, and murderers,&rdquo;
          </Link>{' '}
          was &ldquo;no less wonderful than the arrow of Abaris.&rdquo; Godfrey Higgins guessed in 1827 that{' '}
          <Link href="/book/the-celtic-druids-or-an-attempt-to-show-that-the-druids-higgins?page=341" className={linkClass}>
            &ldquo;perhaps this arrow was the magnetic needle,&rdquo;
          </Link>{' '}
          and the Welsh antiquary Edward Davies suggested it had been{' '}
          <Link
            href="/book/6977ace4235fbd25a5194779?page=293"
            className={linkClass}
          >
            an arrow of straw
          </Link>
          , like the straw the Hyperborean offerings came wrapped in.
        </P>

        <P>
          Where he came from was argued as hard as where Hyperborea was. Higgins summed up the British debate:
        </P>

        <Quote
          cite={<>Godfrey Higgins, <em>The Celtic Druids</em> (1827), p. 124.</>}
          href="/book/the-celtic-druids-or-an-attempt-to-show-that-the-druids-higgins?page=341"
        >
          Every true and loyal Scot is certain that he came from the Hebrides: Mr. Vallencey proves, as clear as the
          sun at noon, that he was an Irishman. This seems odd to the Welshmen, who are quite certain that he came
          from Wales; and Mr. Borlase does not fail to secure him for Cornwall.
        </Quote>

        <P>
          In 1706 Carl Gottfried Zapf devoted a whole academic disputation to Abaris. He collected every ancient
          witness and then declined to locate the man&apos;s homeland, because{' '}
          <Link href="/book/disp-hist-de-abaride-zapf?page=20" className={linkClass}>
            &ldquo;to designate in what region that people held a fixed seat is dangerous&rdquo;
          </Link>
          : what the authors wrote about the northern ocean was &ldquo;very unknown and uncertain.&rdquo; The
          historian of philosophy Jacob Brucker put the problem more sharply in 1742: the Pythagoreans&apos;{' '}
          <Link href="/book/historia-critica-philosophiae-brucker?page=374" className={linkClass}>
            enthusiasm for Abaris &ldquo;strangely obscured his history.&rdquo;
          </Link>{' '}
          The alchemist Johann Ludwig Hannemann went the other way. He read the Hyperborean birth of Apollo and Diana
          as a code for the red and white stones of the Great Work, and concluded that{' '}
          <Link href="/book/ovum-hermetico-paracelsico-trismegistum-hannemann?page=208" className={linkClass}>
            the art had first flourished among that people
          </Link>{' '}
          and spread from them to the rest of the world (1694).
        </P>

        <P>
          Modern scholars read Abaris with a second figure from Herodotus, Aristeas of Proconnesus, who{' '}
          <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=235" className={linkClass}>
            said in his epic verses that, while possessed by Apollo, he reached the Issedones
          </Link>
          , and that beyond them lived the one-eyed Arimaspians, the gold-guarding griffins and, last, the
          Hyperboreans by the sea. E. R. Dodds, in <em>The Greeks and the Irrational</em> (1951), grouped the two
          with Hermotimus and Epimenides as Greek &ldquo;shamans&rdquo;: holy men who fasted, travelled out of the
          body and came, or were said to come, from the Scythian north. Walter Burkert developed the argument for the
          Pythagorean tradition. On that reading the arrow is a memory of a real practice seen at second hand, and
          Abaris is less a visitor from Hyperborea than the Greeks&apos; picture of a northern holy man.
        </P>

        <Section>Apollo&apos;s tears</Section>

        <P>
          Hyperborea and the Baltic meet in a story about amber. The Greeks said that when Phaethon crashed the
          chariot of the Sun into the river Eridanus, his sisters, the Heliades, mourned on its bank until they turned
          into poplars, and their tears hardened into amber. Apollonius of Rhodes, in the <em>Argonautica</em> (third
          century BCE), sails his heroes up the Eridanus past the smoking wreck and records a second version:
        </P>

        <Quote
          cite={<>Apollonius of Rhodes, <em>Argonautica</em> 4.611–617, ed. Henri Estienne (1574), English translation by Source Library.</>}
          href="/book/apollonii-rhodii-argonautica-estienne?page=210"
        >
          The Celts have made it a tradition that these are the tears of Apollo, son of Leto, which are borne in the
          eddies, which he shed in countless numbers before, when he reached the holy race of the Hyperboreans,
          leaving the gleaming heaven because of his father&apos;s rebuke.
        </Quote>

        <Plate
          src={LEAD_IMAGE}
          alt={LEAD_ALT}
          href="/artwork/art-phaetons-sisters-changed-into-poplars-cygnus-into-a-swan"
          width={2000}
          height={1403}
          wide
        >
          The Heliades become poplars by the Eridanus. Engraving after Hendrick Goltzius, from his series on
          Ovid&apos;s <em>Metamorphoses</em> (c. 1590).
        </Plate>

        <P>
          Amber was real, and so was the trade that brought it south. Infrared analyses of Bronze Age finds, made by
          Curt Beck and his colleagues at Vassar from the 1960s onward, identified Baltic amber (succinite) in
          Mycenaean Greece. Herodotus knew that amber came from the far north and did not believe the river story
          that explained it. He{' '}
          <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=164" className={linkClass}>
            did not believe there was a river called Eridanus
          </Link>{' '}
          flowing into a northern sea; the name was Greek, he said, and some poet had made it up
          ; yet{' '}
          <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=165" className={linkClass}>
            &ldquo;it is from these furthest reaches that both tin and amber come to us.&rdquo;
          </Link>{' '}
          Five centuries later Tacitus
          named the people who gathered it. On the right-hand shore of the Baltic, he writes in the{' '}
          <em>Germania</em>, live the Aestii, who{' '}
          <Link href="/book/tacitus-dialogus-de-oratoribus-agricola-germania-hutton?page=196" className={linkClass}>
            &ldquo;worship the Mother of the Gods&rdquo; and wear the figures of wild boars
          </Link>{' '}
          as its emblem, and who alone collect amber, which they call <em>glesum</em>, on the beach and in the shallows.
        </P>

        <P>
          Nothing in Herodotus says what was inside the Hyperborean bundles. A commentator on Callimachus&apos;s{' '}
          <em>Hymn to Delos</em>, printed in a 1761 edition of the poet, notes that Pausanias described the
          first-fruits as{' '}
          <Link href="/book/hymni-epigrammata-et-fragmenta-callimachus?page=567" className={linkClass}>
            &ldquo;hidden in wheaten straw, and recognized by no one.&rdquo;
          </Link>{' '}
          What the Greek sources do record is a chain of hands running out of the north toward Delos, and amber
          arriving along the same kind of chain. Early modern readers took the overlap for an identity.
        </P>

        <Section>Everyone&apos;s Hyperborea</Section>

        <P>
          From the sixteenth century onward nearly every northern nation found a scholar to argue that it was the
          land beyond the north wind. The case was usually made from the same handful of classical passages, and it
          usually arrived at home.
        </P>

        <P>
          In Sweden, Olof Rudbeck&apos;s <em>Atlantica</em> (1679–1702) made Sweden both Plato&apos;s Atlantis and
          Hyperborea. The 1761 Callimachus commentary summarises his etymology:{' '}
          <Link href="/book/hymni-epigrammata-et-fragmenta-callimachus?page=563" className={linkClass}>
            the name came not from the Greek <em>boreas</em> but from the Swedes
          </Link>
          , whose most ancient king was called Boreus, so that <em>Oferborne</em>, &ldquo;Hyperboreans,&rdquo; meant
          the nobly born. In Britain, John Toland placed them in the Hebrides and made Abaris a Druid:{' '}
          <Link href="/book/a-critical-history-of-the-celtic-religion-and-learning-toland?page=203" className={linkClass}>
            &ldquo;if the Hebrides were the Hyperboreans of Diodorus, as I fancy it can scarce hereafter be
            doubted&rdquo;
          </Link>{' '}
          (1740). John Wood{' '}
          <Link href="/book/69ee471d6dd925d126f416a9?page=9" className={linkClass}>
            made Abaris and Bladud, the legendary founder of Bath, &ldquo;one and the same man&rdquo;
          </Link>{' '}
          (1747), William Borlase{' '}
          <Link href="/book/antiquities-historical-and-monumental-of-the-county-of-borlase?page=114" className={linkClass}>
            read Diodorus&apos;s round temple
          </Link>{' '}
          into Cornwall, and Godfrey Higgins wrote in 1827 that{' '}
          <Link href="/book/the-celtic-druids-higgins?page=346" className={linkClass}>
            by the Hyperboreans the Greeks &ldquo;generally meant the British isles.&rdquo;
          </Link>
        </P>

        <P>
          The German geographer Philipp Clüver, in his <em>Germania antiqua</em> (1616), took the amber route instead
          and followed it to the Vistula. The amber river, he argued, was the Radaune, which reaches the sea at
          Danzig. The Greeks had heard its name as Eridanus, and the name later slid onto the Po and the Rhône
          because amber was shipped through them:{' '}
          <Link href="/book/germaniae-antiquae-libri-tres-cluver?page=886" className={linkClass}>
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

        <Quote
          cite={<>Christoph Hartknoch, <em>Alt- und Neues Preussen</em> (1684), English translation by Source Library.</>}
          href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch?page=35"
        >
          Nevertheless, not all writers have gone so far astray; rather, there have also been people who believed they
          could find the Eridanus in the North, and perhaps they also found the amber-bearing river Eridanus, like the
          Electrides, in our Prussia.
        </Quote>

        <P>
          He goes on to read Diodorus&apos;s island of Basilia, where amber washes ashore, as{' '}
          <Link href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch?page=36" className={linkClass}>
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

        <P>
          The same wish shaped the Prussian origin legend, and it too ran through Hyperborean geography. The
          Dominican chronicler Simon Grunau, writing in the 1520s, gave the Prussians a migration from Scandinavia, a
          priest-king called Widewuto, and a sanctuary at Romove where three gods stood in an evergreen oak. The
          folklorist Wilhelm Mannhardt (1831–1880), whose collected study of Baltic religion was published in 1936,
          took the story apart source by source. Grunau had found in Erasmus Stella
          that{' '}
          <Link
            href="/book/latvian-prussian-mythology-the-master-source-compendium-of-mannhardt?page=220"
            className={linkClass}
          >
            &ldquo;the Borussian peoples, who according to Ptolemy had their seats at the Rhipaean mountains,&rdquo;
          </Link>{' '}
          had entered Prussia, and he placed the Rhipaean mountains in Norway. These were the mountains beyond which
          Pliny and Mela had put the Hyperboreans. So the Prussians&apos; own founding story began, by way of a
          misread geography, on the threshold of Hyperborea.
        </P>

        <Plate
          src="/blog/trees-of-life/hartknoch-romowe.jpg"
          alt="Engraving of a great oak behind a wooden screen with three idols in niches, a fire burning before it, a village around"
          href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch?page=87"
          width={1400}
          height={1198}
          wide
        >
          The oak of Romove with its three idols, as Grunau described it. Christoph Hartknoch,{' '}
          <em>Alt- und Neues Preussen</em> (1684).
        </Plate>

        <P>
          Hartknoch engraved Grunau&apos;s scenes, including the war banner of Widewuto with the three gods: Patollo,
          old and grey-bearded, god of the dead; Perkuno, the thunder god, with a face like fire; and young Potrimpo,
          crowned with ears of grain. Mannhardt&apos;s verdict was that{' '}
          <Link
            href="/book/latvian-prussian-mythology-the-master-source-compendium-of-mannhardt?page=235"
            className={linkClass}
          >
            &ldquo;like the entire triad, the image of the gods on the war flag of Widewut with the enigmatic
            inscription and the coat of arms of the first king are inventions.&rdquo;
          </Link>{' '}
          The forger gave himself away with the horses: heraldic animals holding up a shield came into use only in
          the fourteenth century. Perkūnas, at least, is real. The thunder god appears across Lithuanian, Latvian and
          Prussian sources and in Lithuanian and Latvian folk song.
        </P>

        <Plate
          src="/blog/hyperborea/hartknoch-widewuto-banner.jpg"
          alt="Engraving of a banner showing three male busts, one bearded in a cap, one with a crown of flames, one crowned with ears of grain, above a shield held by two rearing horses"
          href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch?page=143"
          width={1400}
          height={1315}
        >
          The banner of Widewuto with Patollo, Perkuno and Potrimpo. Christoph Hartknoch,{' '}
          <em>Alt- und Neues Preussen</em> (1684), after Simon Grunau.
        </Plate>

        <Section>Lithuania and the sun</Section>

        <P>
          In the nineteenth century the argument moved from Prussia to Lithuania and from amber to language. Teodor
          Narbutt began his <em>Ancient History of the Lithuanian Nation</em> (1835) with the sun. Discussing a
          Samogitian prayer to the fire god Gabie that peasants still recited in their drying barns, he writes:
        </P>

        <Quote
          cite={<>Teodor Narbutt, <em>Dzieje starożytne narodu litewskiego</em>, vol. 1 (1835), English translation by Source Library.</>}
          href="/book/ancient-history-of-the-lithuanian-nation-vol-1-lithuanian-narbutt?page=37"
        >
          The worship of fire and the sun, or Apollo, merged into one among all nations. Fire and the sun everywhere
          received worship where the pagan religion had external pomp and priests. The Greeks used to say that the
          worship of Apollo among the northern peoples was very famous, for which reason they called him
          Hyperboreans.
        </Quote>

        <P>
          Narbutt connected the Hyperborean Apollo to a sun cult &ldquo;observed by the Baltic Sea&rdquo; in Pliny,
          and later in the volume to Sanskrit. Lithuanian, he argued, came{' '}
          <Link
            href="/book/ancient-history-of-the-lithuanian-nation-vol-1-lithuanian-narbutt?page=480"
            className={linkClass}
          >
            &ldquo;directly and immediately&rdquo; from Sanskrit
          </Link>
          , as Sanskrit <em>devas</em>, god, survives in Lithuanian <em>Dievas</em>, Latvian <em>Dievs</em> and
          Prussian <em>Deiws</em>. Half of that is right. Lithuanian is one of the most conservative Indo-European
          languages, and the cognates are real; but it is a sister of Sanskrit, not a daughter. The claim gave a small
          nation inside the Russian Empire a lineage older than Greece and Rome, which is what Hartknoch had wanted
          from the amber two centuries earlier.
        </P>

        <Section>The polar homeland</Section>

        <P>
          By then Hyperborea was turning from a people into a homeland of humanity. The French astronomer Jean-Sylvain
          Bailly argued in the 1770s that the sciences had been invented by a lost northern people. William Warren&apos;s{' '}
          <em>Paradise Found</em> (1885) put Eden at the North Pole, and Bal Gangadhar Tilak&apos;s{' '}
          <em>The Arctic Home in the Vedas</em> (1903) put the Aryans there. Helena Blavatsky made the Hyperborean the
          second of her root races in <em>The Secret Doctrine</em> (1888), and she used the amber to prove it. The
          Eridanus could not be the Po, she wrote, because{' '}
          <Link
            href="/book/the-secret-doctrine-synthesis-of-science-religion-and-blavatsky?page=838"
            className={linkClass}
          >
            &ldquo;amber is found only in the northern seas, in the Baltic&rdquo;
          </Link>
          ; Phaethon&apos;s fall was an allegory of the poles changing climate.
        </P>

        <P>
          In the twentieth century the polar homeland was taken up by German racial nationalists. The Thule Society
          in Munich (1918) took its name from the northern island of Pytheas, and the Dutch-German writer Herman Wirth,
          a founder of the SS research office <em>Ahnenerbe</em>, built a prehistory of a northern master race on the
          same classical passages. That use has continued on the far right. The passages themselves say much less, as
          the earlier readers in this note show.
        </P>

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
          <Link href="/book/on-the-gods-of-the-samogitians-mannhardt" className={linkClass}>
            list of Samogitian gods
          </Link>{' '}
          that Jan Łasicki compiled in the 1580s, Matthäus Praetorius&apos;s{' '}
          <Link
            href="/book/prussian-delights-prussian-lithuanian-religion-and-customs-pierson"
            className={linkClass}
          >
            <em>Deliciae Prussicae</em>
          </Link>{' '}
          from the Lithuanian villages of East Prussia, the{' '}
          <Link href="/book/6a209d3889e8715c5947a52c" className={linkClass}>
            <em>dainos</em>
          </Link>{' '}
          or folk songs, and Mannhardt&apos;s compendium of every source he could find. They are in the{' '}
          <Link href="/collections/baltic-paganism" className={linkClass}>
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
              <Link href="/book/the-persian-wars-ii-books-3-4-loeb-l118-herodotus?page=253" className={linkClass}>
                <em>Histories</em>, Books 3–4
              </Link>{' '}
              (Loeb, 1921): 3.115 on amber and the Eridanus; 4.32–36 on the Hyperboreans.
            </li>
            <li>
              Pindar,{' '}
              <Link href="/book/the-odes-of-pindar-sandys?page=346" className={linkClass}>
                <em>Odes</em>
              </Link>
              , tr. Sandys (1915): <em>Pythian</em> 10.
            </li>
            <li>
              Apollonius of Rhodes,{' '}
              <Link href="/book/apollonii-rhodii-argonautica-estienne?page=210" className={linkClass}>
                <em>Argonautica</em>
              </Link>
              , ed. Estienne (1574): Book 4, the Eridanus and Apollo&apos;s tears.
            </li>
            <li>
              Iamblichus,{' '}
              <Link href="/book/de-vita-pythagorica-liber-codex-florentinus-nauck?page=185" className={linkClass}>
                <em>On the Pythagorean Life</em>
              </Link>
              , ed. Nauck (1884); Solinus,{' '}
              <Link href="/book/c-iulii-solini-polyhistor-1543-solinus?page=79" className={linkClass}>
                <em>Polyhistor</em>
              </Link>{' '}
              (1543), ch. 26; Tacitus,{' '}
              <Link href="/book/tacitus-dialogus-de-oratoribus-agricola-germania-hutton?page=196" className={linkClass}>
                <em>Germania</em>
              </Link>{' '}
              45 (Loeb, 1914).
            </li>
            <li>
              Carl Gottfried Zapf,{' '}
              <Link href="/book/disp-hist-de-abaride-zapf" className={linkClass}>
                <em>Disputatio historica de Abaride</em>
              </Link>{' '}
              (1706); Johann Ludwig Hannemann,{' '}
              <Link href="/book/ovum-hermetico-paracelsico-trismegistum-hannemann" className={linkClass}>
                <em>Ovum Hermetico-Paracelsico-Trismegistum</em>
              </Link>{' '}
              (1694).
            </li>
            <li>
              Callimachus,{' '}
              <Link href="/book/hymni-epigrammata-et-fragmenta-callimachus" className={linkClass}>
                <em>Hymni, Epigrammata et Fragmenta</em>
              </Link>{' '}
              (1761), commentary on the <em>Hymn to Delos</em>.
            </li>
            <li>
              Philipp Clüver,{' '}
              <Link href="/book/germaniae-antiquae-libri-tres-cluver" className={linkClass}>
                <em>Germania antiqua</em>
              </Link>{' '}
              (1616); John Toland,{' '}
              <Link href="/book/a-critical-history-of-the-celtic-religion-and-learning-toland" className={linkClass}>
                <em>A Critical History of the Celtic Religion and Learning</em>
              </Link>{' '}
              (1740); Godfrey Higgins,{' '}
              <Link href="/book/the-celtic-druids-higgins" className={linkClass}>
                <em>The Celtic Druids</em>
              </Link>{' '}
              (1827).
            </li>
            <li>
              Christoph Hartknoch,{' '}
              <Link href="/book/old-and-new-prussia-with-the-pagan-religion-of-the-old-hartknoch" className={linkClass}>
                <em>Alt- und Neues Preussen</em>
              </Link>{' '}
              (1684); Simon Grunau,{' '}
              <Link href="/book/simon-grunau-prussian-chronicle-old-prussian-pagan-religion-perlbach" className={linkClass}>
                <em>Preussische Chronik</em>
              </Link>
              , ed. Perlbach; Wilhelm Mannhardt,{' '}
              <Link
                href="/book/latvian-prussian-mythology-the-master-source-compendium-of-mannhardt"
                className={linkClass}
              >
                <em>Letto-preussische Götterlehre</em>
              </Link>{' '}
              (1936).
            </li>
            <li>
              Teodor Narbutt,{' '}
              <Link href="/book/ancient-history-of-the-lithuanian-nation-vol-1-lithuanian-narbutt" className={linkClass}>
                <em>Dzieje starożytne narodu litewskiego</em>, vol. 1
              </Link>{' '}
              (1835); Helena Blavatsky,{' '}
              <Link
                href="/book/the-secret-doctrine-synthesis-of-science-religion-and-blavatsky"
                className={linkClass}
              >
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
