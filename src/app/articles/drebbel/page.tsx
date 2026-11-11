import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import DrebbelNetwork from '@/components/blog/DrebbelNetwork';
import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';
import { withArticleMeta } from '@/lib/article-metadata';

// Sources: the research dossier for #5898 (sourcelibrary-ops research/drebbel-blog:
// associates.md, primary-sources.md, our-holdings.md). Every Source Library quote below was
// checked against the page's stored translation on 2026-10-06. Claims the dossier could not
// document are listed in "What we could not confirm", not asserted. Catalogue problems found
// along the way are #6025.
//
// Page images are the library's archived scans, each checked by eye on 2026-10-18. Reader
// pages (?page=N) are scan numbers; the printed page number is given where it differs.
// The Tractatus duo we hold is the Geneva printing of 1628 (title page, scan 1), not the
// Hamburg edition of 1621.

const TITLE = 'The Engraver Who Went Under the Thames';
const DESCRIPTION =
  'Cornelis Drebbel built a perpetual-motion clock, a submarine, early microscopes and the first thermostat, and wrote almost nothing. What we know comes from the people around him. A map of his circle, with every tie marked by how well it is attested, and the passages in his own book.';

export const metadata: Metadata = withArticleMeta('drebbel', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  alternates: { canonical: '/articles/drebbel' },
});

const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';
const Q = 'border-l-2 border-accent-gold/60 pl-5 my-6 font-body text-primary leading-relaxed';
const CITE = 'block mt-2 text-sm text-muted not-italic';

const IMG = (bookId: string, page: number) => `https://images.sourcelibrary.org/archived/${bookId}/${page}.jpg`;

const TREATISES = 'drebbel-tractatus-duo-1628-latin-laurembergius';
const TREATISES_ID = '9cafe1ee-dd5a-4dcf-ac9a-803ca75f5bb4';
const TRACTAT = 'ein-kurtzer-tractat-von-der-natur-der-elementen-drebbel';
const TRACTAT_ID = '6a9058b07f6818cc17cd5a93';
const ALKMAAR = 'kaart-van-alkmaar-cornelius-drebbel-sculptor-drebbel';
const TYMME = 'a-dialogue-philosophicall-wherein-natures-secret-closet-is-opened-tymm';
const WILKINS = 'mathematicall-magick-wilkins';
const MERSENNE = 'cogitata-physico-mathematica-mersenne';
const HUYGENS = 'christiani-hugenii-zelemii-dum-viveret-toparchae-opuscula-huygens';
const BOYLE_AIR = 'the-general-history-of-the-air-boyle-robert';
const SORBIERE = 'relation-dun-voyage-en-angleterre-ou-sont-touchees-plusieurs-choses-qu';

const TREATISES_SOURCE = (
  <>
    Drebbel, <em>Tractatus duo</em> (Geneva, 1628)
  </>
);
const LETTER_SOURCE = (
  <>
    Drebbel, letter to James I, in <em>Tractatus duo</em> (Geneva, 1628)
  </>
);

function Quote({ children, cite }: { children: React.ReactNode; cite: React.ReactNode }) {
  return (
    <blockquote className={Q}>
      <p className="italic">{children}</p>
      <cite className={CITE}>{cite}</cite>
    </blockquote>
  );
}

export default function DrebbelPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature image="https://images.sourcelibrary.org/artwork/art-drebbel-clock.jpg" imageAlt={"Drebbel’s clock: a globe in armillary rings, held up by two sphinxes, in a coloured drawing."} headerVariant="dark"
          title={TITLE}
          subtitle="Cornelis Drebbel (1572–1633) in his own words and in the words of the people who knew him."
        >
          <p className="text-stone-400 text-sm mt-4">October 2026 &middot; 12 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-6 font-body">
          In the spring of 1620 a candle maker in Middelburg wrote to his son with news from England. The
          son, Isaac Beeckman, copied it into his journal on 15 March:
        </p>
        <Quote
          cite={
            <>
              Isaac Beeckman, <em>Journal</em>, ed. de Waard, vol. 2 (
              <a href="https://www.dbnl.org/tekst/beec002jour02_01/">DBNL</a>). &ldquo;That Drebbel in England has
              made a boat with which he can travel under and above the water as he likes.&rdquo;
            </>
          }
        >
          dat DREBBEL in Engelandt een schuyte gepractiseert heeft, daermede hy onder ende boven water varen kan als hy wilt
        </Quote>
        <p className={P}>
          It is the earliest dated report of the submarine. Beeckman then worked out how such a boat might
          work, with a sealed ballast tank and a tap.
        </p>

        <div className="max-w-sm mx-auto">
          <PageFigure
            src={IMG(TRACTAT_ID, 4)}
            alt="Engraved oval portrait of a bearded man in a fur-trimmed coat, inscribed Cornelis Drebbel Alcmariensis, on an otherwise blank page with a library stamp"
            href={`/book/${TRACTAT}?page=4`}
            source={
              <>
                <em>Ein kurtzer Tractat von der Natur der Elementen</em> (Leiden, 1608)
              </>
            }
          >
            &ldquo;Cornelis Drebbel Alcmariensis&rdquo;: the portrait in the German translation of his treatise.
            The stamp is the Bayerische Staatsbibliothek&rsquo;s, Munich.
          </PageFigure>
        </div>

        <p className={P}>
          Cornelis Drebbel is remembered for the submarine, a perpetual-motion clock, an early microscope and
          a self-regulating oven that counts as the first thermostat. He wrote very little. Most of what we
          know comes from the people around him, who bought his instruments, paid his salary, translated his
          one book and repeated stories about him for a century after his death. Here they are, 57 of them.
          Solid lines are ties with a document behind them, dashed lines are reports at second hand, and dotted
          lines are claims we could not confirm. Press Play to watch the circle form year by year, or click a
          name for the evidence.
        </p>

        <DrebbelNetwork />

        <section className="mb-14">
          <h2 className={H2}>Alkmaar and Haarlem</h2>
          <p className={P}>
            Drebbel was born in Alkmaar and trained as an engraver under Hendrick Goltzius in Haarlem. In 1595
            he married Goltzius&rsquo;s younger sister, Sophia. Two years later he engraved a large plan of his
            home town, and we hold it:{' '}
            <Link href={`/book/${ALKMAAR}`}>the 1597 map of Alkmaar</Link>, signed
            &ldquo;Cornelius Drebbel sculptor&rdquo;.
          </p>
          <PageFigure
            wide
            src="https://images.sourcelibrary.org/pages/69b525de2f891867c1ae5d21/0001.jpg"
            alt="Engraved bird’s-eye plan of Alkmaar inside its star-shaped ramparts, with fields and canals around it, a coat of arms held by two lions top left and an ornamental cartouche bottom right"
            href={`/book/${ALKMAAR}`}
            source={<>Drebbel, map of Alkmaar (1597)</>}
            credit="Allard Pierson, University of Amsterdam; free of known copyright restrictions."
          >
            The whole sheet: the walled town seen from above, its streets drawn house by house.
          </PageFigure>
          <PageFigure
            src="/articles/drebbel/alkmaar-cartouche.jpg"
            alt="Detail of the map: a strapwork cartouche framing Latin verses in praise of Alkmaar, with a small tablet below reading Cornelius Drebbel Sculptor"
            href={`/book/${ALKMAAR}`}
            source={<>Map of Alkmaar (1597), detail</>}
            credit="Allard Pierson, University of Amsterdam; free of known copyright restrictions."
          >
            The cartouche in the lower right corner, with Latin verses on the town signed I.T., and the
            engraver&rsquo;s signature on the tablet beneath: &ldquo;Cornelius Drebbel Sculptor&rdquo;.
          </PageFigure>
          <p className={P}>
            By 1598 he had turned to machines. That year the States General of the Dutch Republic granted him a
            patent for an engine to raise fresh water &ldquo;like a fountain &hellip; to a height of twenty,
            thirty, forty, fifty and more feet through pipes&rdquo;, and for &ldquo;a clock or time-pointer that
            one may use for fifty, sixty, yes a hundred or more years in a row, without winding&rdquo;. In 1602
            they gave &ldquo;Cornelis Jacobsz Drebbel, burgher of Alkmaar&rdquo; another, for making smoking
            chimneys draw.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>The perpetual motion</h2>
          <p className={P}>
            The clock that never needed winding made his name. He took it to England around 1605, where James I
            and Prince Henry lodged him at Eltham. In 1612 the clergyman Thomas Tymme published the first picture
            of it, describing &ldquo;a most strange and wittie inuention of another Archimedes &hellip; as it was
            presented to the Kings most royall hands, by Cornelius Drebble of Alchmar in Holland&rdquo; (
            <Link href={`/book/${TYMME}?page=7`}>Tymme, <em>A Dialogue Philosophicall</em>, To the Reader</Link>).
            Tymme used it as an argument that the earth stands still. Thirty-six years later John Wilkins found
            that absurd.
          </p>
          <div className="max-w-md mx-auto">
            <PageFigure
              src={IMG('6ac3ade2864e04424c043050', 69)}
              alt="Woodcut of a domed pavilion on four columns sheltering a globe inside a glass ring, held up by a small figure between two sphinxes, with the letters B and C marking the parts"
              href={`/book/${TYMME}?page=69`}
              source={
                <>
                  Thomas Tymme, <em>A Dialogue Philosophicall</em> (1612)
                </>
              }
            >
              Tymme&rsquo;s woodcut of the instrument. In his dialogue the globe stands for the earth, the hollow
              ring C is &ldquo;a ring of Cristall Glasse&rdquo; with water in it that rises and falls twice a day
              like the tide, and the little globe B is the moon.
            </PageFigure>
          </div>
          <p className={P}>
            What drove it? Drebbel&rsquo;s answer, in a letter to King James printed with his treatise, is that
            he found the cause by watching fire:
          </p>
          <SourceQuote
            book={TREATISES}
            page={65}
            printedPage={66}
            src={IMG(TREATISES_ID, 65)}
            pageAlt="Page 66 of Drebbel’s Latin letter to James I, headed Epistola"
            source={<>{LETTER_SOURCE}, Source Library translation</>}
          >
            Seeking with skillful inquiry that hidden cause which always forced water downward, I finally
            discovered it through the observation of the wonderful nature of fire. &hellip; I understood how the
            earth is carried in the middle of the air, how the water encircles the earth like a ring, and how all
            things seek the center, except for fire.
          </SourceQuote>
          <p className={P}>
            Others guessed at the mechanism. Beeckman heard in 1622 that it was two glass half-rings holding a
            liquid that went up and down with the tide. The Jesuit Gaspar Schott wrote in 1657 that Drebbel
            &ldquo;is said to have enclosed two opposing and highly antipathetic liquids in a glass ring, which
            fought against each other in a perpetual struggle&rdquo; (
            <Link href="/book/p-gasparis-schotti-mechanica-hydraulico-pneumatica-qua-schott?page=474">Schott, <em>Mechanica hydraulico-pneumatica</em>, p. 377</Link>). The
            likeliest explanation today is that the liquid rose and fell with changes in air temperature and
            pressure: a thermometer and barometer made into a clock.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>Prague, and prison</h2>
          <p className={P}>
            In 1610 Drebbel went to Prague to work for the Emperor Rudolf II, promising Prince Henry he would be
            back within six months. Instead Rudolf&rsquo;s brother Matthias seized power and in 1611 imprisoned
            Rudolf&rsquo;s council, &ldquo;amongst others, Drebbel&rdquo;. His ovens and instruments were
            destroyed. Matthias later freed him and paid for his journey home.
          </p>
          <p className={P}>
            Many accounts add a second imprisonment in 1619&ndash;20, under Ferdinand II. We found no document
            for it, and Drebbel&rsquo;s signature in the album of Joachim Morsius puts him in London in November
            1619.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>The book</h2>
          <p className={P}>
            Drebbel&rsquo;s one treatise, on the elements, came out in Dutch in 1604 and in Latin at Hamburg in
            1621, translated by Petrus Lauremberg; Morsius edited its companion treatise on the Fifth Essence.
            We hold the Latin in a <Link href={`/book/${TREATISES}`}>Geneva printing of 1628, with an English translation</Link>,
            and the <Link href={`/book/${TRACTAT}`}>German translation printed at Leiden in 1608</Link>.
            Its voice is not what one expects from a court engineer. He claims nothing from the authorities:
          </p>
          <SourceQuote
            book={TREATISES}
            page={11}
            printedPage={12}
            src={IMG(TREATISES_ID, 11)}
            pageAlt="Page 12 of the Latin treatise on the elements, beginning “communico, quae ipse a Natura hausi atque accepi”"
            source={TREATISES_SOURCE}
            original="… communico, quæ ipse à Naturâ hausi atque accepi."
          >
            I share those things which I myself have drawn and received from Nature.
          </SourceQuote>
          <SourceQuote
            book={TREATISES}
            page={67}
            printedPage={68}
            src={IMG(TREATISES_ID, 67)}
            pageAlt="Page 68 of Drebbel’s letter to James I, ending “Nam (Deum testor) neque veterum scriptis, neque cuiusquam auxilio hic usus sum”"
            source={LETTER_SOURCE}
          >
            For (I call God to witness) I have used here neither the writings of the ancients nor the help of any
            man&hellip;
          </SourceQuote>
          <p className={P}>And he describes the elements as something he can arrange by hand:</p>
          <SourceQuote
            book={TREATISES}
            page={66}
            printedPage={67}
            src={IMG(TREATISES_ID, 66)}
            pageAlt="Page 67 of Drebbel’s letter to James I, headed Epistola"
            source={LETTER_SOURCE}
          >
            I can suspend earth in the middle of water, water in the middle of air, and air in the middle of fire
            within a closed glass vessel &hellip; And in this way, I make the high low, the low high, the light
            heavy, and the heavy light.
          </SourceQuote>
          <p className={P}>
            Athanasius Kircher took that glass &ldquo;sphere of elements&rdquo; seriously enough to argue about
            how it could be made (
            <Link href="/book/magnes-sive-de-arte-magnetica-kircher?page=727">Kircher, <em>Magnes</em>, p. 309</Link>).
          </p>
          <div className="max-w-md mx-auto">
            <PageFigure
              src={IMG('69527376ab34727b1f04948a', 727)}
              alt="Printed Latin page headed Magnetismus elementorum with a diagram of nested circles lettered A to Z over a half circle"
              href="/book/magnes-sive-de-arte-magnetica-kircher?page=727"
              source={
                <>
                  Athanasius Kircher, <em>Magnes</em> (1641), p. 309
                </>
              }
            >
              Kircher&rsquo;s page on the sphere of elements &ldquo;a Drebbelio adornata&rdquo;, arranged by
              Drebbel, with his diagram of the elements in nested spheres.
            </PageFigure>
          </div>
          <div className="max-w-md mx-auto">
            <PageFigure
              src={IMG(TRACTAT_ID, 17)}
              alt="Page of German black-letter text above a woodcut of a glass retort hanging from a branch, its neck dipped into a vat of water, with a fire beneath it"
              href={`/book/${TRACTAT}?page=17`}
              source={
                <>
                  <em>Ein kurtzer Tractat von der Natur der Elementen</em> (Leiden, 1608)
                </>
              }
            >
              One of the treatise&rsquo;s experiments, from the German edition: an empty glass retort hung with
              its mouth in a vat of water and a warm fire laid under its belly, to show how heat and cold move
              air and water, as in wind and rain.
            </PageFigure>
          </div>
        </section>

        <section className="mb-14">
          <h2 className={H2}>Under the Thames</h2>
          <p className={P}>
            Back in London, around 1620, Drebbel built the boat Beeckman heard about. Robert Boyle, forty years
            later, had the story from Drebbel&rsquo;s own family:
          </p>
          <Quote
            cite={
              <>
                Boyle, <em>New Experiments Physico-Mechanicall</em> (1660) (
                <a href="https://archive.org/details/bim_early-english-books-1641-1700_new-experiments-physico-_boyle-robert_1660">Internet Archive</a>).
              </>
            }
          >
            &hellip;a Vessel to go under Water; of which, tryal was made in the Thames, with admired successe, the
            Vessel carrying twelve Rowers, besides Passengers; one of which is yet alive.
          </Quote>
          <p className={P}>
            How did the rowers breathe? Boyle&rsquo;s informant, &ldquo;an Ingenious Physitian that marry&rsquo;d
            his daughter&rdquo;, said Drebbel held that it was not the whole air but &ldquo;a certain Quintessence
            (as Chymists speake) or spirituous part of it, that makes it fit for respiration&rdquo;, and that he
            restored it from &ldquo;a Chymicall liquor&rdquo; carried in the boat. The French traveller Balthasar
            de Monconys heard much the same in London in 1663: Drebbel &ldquo;knew how to extract a subtle spirit
            from the air&rdquo; (
            <Link href="/book/journal-des-voyages-de-m-de-monconys-publie-par-le-sieur-de-monconys?page=43">Monconys, <em>Journal des voyages</em>, p. 33</Link>).
          </p>
          <p className={P}>
            By 1648 John Wilkins could write in{' '}
            <Link href={`/book/${WILKINS}`}><em>Mathematicall Magick</em></Link> that a submarine was possible:
          </p>
          <SourceQuote
            book={WILKINS}
            page={206}
            printedPage={178}
            src={IMG('69aebe60c0472fef6455a8f3', 206)}
            pageAlt="Page 178 of Mathematicall Magick, with the start of chapter 5, Concerning the possibility of framing an Ark for submarine Navigations"
            source={
              <>
                John Wilkins, <em>Mathematicall Magick</em> (1648), book 2, chapter 5
              </>
            }
          >
            &hellip;beyond all question, because it hath been already experimented here in England by Cornelius
            Dreble&hellip;
          </SourceQuote>
          <p className={P}>In Paris, Marin Mersenne had called it</p>
          <SourceQuote
            book={MERSENNE}
            page={309}
            printedPage={207}
            src={IMG('69af0dab9f13b61d0a6c6105', 309)}
            pageAlt="Page 207 of Mersenne’s Cogitata physico-mathematica, with the corollary De nauibus sub aqua natantibus"
            source={
              <>
                Marin Mersenne, <em>Cogitata physico-mathematica</em> (1644), &ldquo;De nauibus sub aqua natantibus&rdquo;
              </>
            }
            original="Notum est nauiculam à Cornelio Drebellio in Anglia constructam, quæ sub aquis depressa natabat"
          >
            well known that a small ship was constructed by Cornelius Drebbel in England, which swam while
            submerged under the waters
          </SourceQuote>
        </section>

        <section className="mb-14">
          <h2 className={H2}>The young Huygens</h2>
          <p className={P}>
            In 1621 a young Dutch diplomat, Constantijn Huygens, met Drebbel in London. In appearance, he wrote,
            Drebbel was a Dutch farmer, but his learned talk recalled the sages of Samos and Sicily. Huygens came
            back that December and saw him constantly for a year: &ldquo;We possessed Drebbel for a whole year,
            and he possessed me too.&rdquo; He bought a camera obscura from him, showed it to the painters Jacques
            de Gheyn and Torrentius in The Hague, and wrote to his worried parents that Drebbel was no sorcerer.
          </p>
          <p className={P}>
            His son Christiaan, born four years before Drebbel died, later credited him with the compound
            microscope:
          </p>
          <SourceQuote
            book={HUYGENS}
            page={245}
            printedPage={221}
            src={IMG('69b6c2618566c838146599f0', 245)}
            pageAlt="Page 221 of Christiaan Huygens’s Opuscula postuma, headed Dioptrica, with the section De microscopiis"
            source={
              <>
                Christiaan Huygens, <em>Opuscula postuma</em> (1703), &ldquo;De microscopiis&rdquo;
              </>
            }
            original="Anno autem 1621 apud Drebelium nostratem conspecta fuisse Microscopia hujusmodi Londini in Britannia, ipsi qui adfuerant sæpe mihi narraverunt, ipsumque primum auctorem eorum tunc habitum."
          >
            As for the year 1621, those who were present have often told me that such microscopes were seen in
            London, England, at the home of our countryman, Drebelius, and that he was then considered the first
            inventor of them.
          </SourceQuote>
          <p className={P}>
            The microscopes travelled fast. In 1622 Drebbel sent Jacob Kuffler, brother of his future
            sons-in-law, to sell them abroad. Kuffler demonstrated one in Paris before Marie de&rsquo; Medici,
            and the collector Peiresc bought one. Peiresc&rsquo;s instruments went on to Rome, where they would
            not work until Galileo got them going in 1624 and began making his own.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>Home, and war</h2>
          <p className={P}>
            The Dutch had not forgotten him. On 5 January 1624 two members of the States General were asked to
            consult Prince Maurice on whether to invite &ldquo;Mr Cornelis Drebbel &hellip; to come over from
            England, to speak with him&rdquo;. He stayed in England. Under Charles I he worked for the Navy and
            the Duke of Buckingham, building fireships and &ldquo;water-petards&rdquo; for the expeditions to La
            Rochelle in 1627 and 1628, reportedly at &pound;150 a month. The expeditions failed. Drebbel died in
            London in 1633.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>The heirs</h2>
          <p className={P}>
            His inventions outlived him because his family kept them. Two of his daughters married the brothers
            Abraham and Johannes Sibertus Kuffler. Johannes Sibertus, a physician trained at Padua, ran a dye
            works in Leiden with a new tin-based scarlet, and carried the self-regulating oven into Samuel
            Hartlib&rsquo;s circle in the 1630s. In 1662 Jonathan Goddard suggested to the new Royal Society
            &ldquo;Drebbel&rsquo;s method of governing a furnace by a thermometer of quicksilver&rdquo;.
            Christopher Wren built a furnace &ldquo;like Mr Kuffler&rsquo;s&rdquo;, and a grandson&rsquo;s recipe
            book preserved the oven&rsquo;s design.
          </p>
          <div className="grid gap-x-8 sm:grid-cols-2 items-start max-w-2xl mx-auto">
            <PageFigure
              src={IMG('6ac2798f02c7f994f8506b1e', 68)}
              alt="Page 56 of Sorbière’s Relation d’un voyage en Angleterre, a narrow page of French text describing a furnace of M. Kuffler"
              href={`/book/${SORBIERE}?page=68`}
              source={
                <>
                  Samuel Sorbière, <em>Relation d&rsquo;un voyage en Angleterre</em> (1666), p. 56
                </>
              }
            >
              In his account of England, Samuel Sorbière lists &ldquo;un fourneau de M. Kuffler, gendre de Drebbel&rdquo;, which he
              had seen at The Hague, that opens and shuts its own registers as it needs more or less heat.
            </PageFigure>
            <PageFigure
              src={IMG('6ac3af023b2f03f7e59cba4e', 101)}
              alt="Page 81 of Boyle’s General History of the Air, printed English text beginning I shall not digress so far"
              href={`/book/${BOYLE_AIR}?page=101`}
              source={
                <>
                  Robert Boyle, <em>The General History of the Air</em> (1692), p. 81
                </>
              }
            >
              A letter Boyle printed in <em>The General History of the Air</em> calls &ldquo;Drebble, that great,
              singular, learned Mechanick&rdquo; the maker of &ldquo;a Furnace which he could govern to any Degree
              of Heat&rdquo;.
            </PageFigure>
          </div>
          <p className={P}>
            One secret did not survive. Kuffler told Beeckman in 1634 that on his deathbed Drebbel said he could
            make perfect telescopes, with which his children could all become rich, but he died before he wrote
            it down.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>What we could not confirm</h2>
          <ul className="list-disc pl-6 space-y-2 text-secondary font-body mb-6">
            <li><strong>Ferdinand II.</strong> The 1619&ndash;20 tutoring and imprisonment have no document behind them.</li>
            <li><strong>Francis Bacon.</strong> Often linked to Drebbel; we found no passage in which Bacon names him.</li>
            <li><strong>Michael Maier, Simon Stevin, the Rosicrucians.</strong> No documented tie. Morsius is the only bridge to Rosicrucian circles.</li>
            <li><strong>James I in the submarine.</strong> The one source is Georg Philipp Harsd&ouml;rffer (1651), who had it from one of Drebbel&rsquo;s kinsmen; no English record of it has been found (<Link href="/articles/beeckman-on-drebbel#what-we-know">what the early reports say</Link>).</li>
            <li><strong>Jacob Kuffler</strong> was the brother of the two sons-in-law, not a son-in-law himself.</li>
          </ul>
        </section>

        <p className="text-sm text-muted font-body">
          Translations quoted from Source Library editions are machine translations made with AI, and each page
          says so. Passages from books printed in English (Tymme, Wilkins, Boyle) are given as printed, with the
          long s made round. Beeckman&rsquo;s journal and Boyle&rsquo;s <em>New Experiments</em> of 1660 are quoted
          from outside the library.
        </p>
      </article>
    </ContentPageLayout>
  );
}
