import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';
import { HowItSank, SourcesTable, SourcesTimeline } from './BoatFigures';

// Shown after Beeckman's 1620 entry: every early report of the boat that the
// library holds, in date order, so a reader can see how little rests on
// Drebbel's own time. Borelli's 1680 plate is the earliest printed picture of
// a rowed submarine that we found, and Papin's two plates follow (Derek asked
// for "the first drawing of it after Beeckman", 2026-10-29). Borelli's figure
// is cropped from the Library of Congress copy of Tab. XIV (cph.3b09148,
// public domain). Mersenne and Wilkins are served
// from the library's own page images; Papin's pages and plate are copied from
// the Bayerische Staatsbibliothek scan (bsb10843010), since the library's copy
// has no archived images yet. Harsdörffer 1651 (no figure) is copied from the
// Internet Archive scan bub_gb_r1U_AAAAcAAJ; the library holds only a hidden 1677
// reprint with no text. Monconys 1666 is the library's own translated copy.
// "How the story grew" traces the later accretions by eye: Hautefeuille 1681
// (e-rara 4563800; the library's copy is hidden), Fyfe 1902 relabelling
// Borelli's picture, and Burgoyne 1903 crediting Monconys's depth to Boyle
// (both from Internet Archive scans; the library's copies are hidden).

const MERSENNE = '69af0dab9f13b61d0a6c6105';
const MONCONYS = '6a44359d0235c9147000dd12';
const WILKINS = '69aebe60c0472fef6455a8f3';
const PAPIN = '6adfd7cf16aaa80a976bbf45';

export default function WhatWeKnow() {
  return (
    <section id="what-we-know" className="mb-16 scroll-mt-24 bg-warm rounded-xl p-6 md:p-8 border border-border-light">
      <h2 className="font-serif text-2xl md:text-3xl text-primary mb-4">What we actually know about the boat</h2>
      <p className="text-secondary leading-relaxed mb-4 font-body">
        Drebbel left no plan, no drawing and no description of his boat. Beeckman&rsquo;s tank and
        tap are his own guess, made from one line in a letter. Everything else comes from people
        who wrote about the boat years later, and most of them had it at second hand.
      </p>

      <SourcesTimeline />

      <SourceQuote
        book={MERSENNE}
        page={309}
        printedPage={207}
        src={`https://images.sourcelibrary.org/archived/${MERSENNE}/309.jpg`}
        source={<>Marin Mersenne, <em>Cogitata physico-mathematica</em> (Paris, 1644)</>}
        original={<span lang="la">Notum est naviculam &agrave; Cornelio Drebellio in Anglia constructam, qu&aelig; sub aquis depressa natabat</span>}
      >
        It is well known that a small ship was built by Cornelius Drebbel in England, which
        swam while pressed down under the waters.
      </SourceQuote>
      <p className="text-secondary leading-relaxed mb-4 font-body">
        Mersenne then sets out how such a ship <em>could</em> be made: weighted to the weight of
        the water, closed tight, with oars worked through pitched leather. These are his
        suggestions. He does not say that Drebbel did any of them.
      </p>

      <SourceQuote
        book={WILKINS}
        page={207}
        printedPage={179}
        src={`https://images.sourcelibrary.org/archived/${WILKINS}/207.jpg`}
        source={<>John Wilkins, <em>Mathematicall Magick</em> (London, 1648)</>}
      >
        [&hellip;] already experimented here in England by Cornelius Dreble, but how to improve it
        unto publike use and advantage, so as to be serviceable for remote voyages [&hellip;] would
        be of such excellent use as may deserve some further inquiry.
      </SourceQuote>
      <p className="text-secondary leading-relaxed mb-4 font-body">
        Wilkins&rsquo;s chapter on the &ldquo;Ark for submarine Navigations&rdquo; is about how one
        might be built. He cites Drebbel only to show that it can be done.
      </p>

      <figure className="not-prose my-10 grid gap-6 md:grid-cols-[1fr_minmax(0,16rem)] items-center">
        <blockquote className="border-l-2 border-accent-gold/60 pl-5 font-body text-lg leading-relaxed text-primary">
          <p lang="de" className="mb-3 text-secondary italic">
            Einer von seinen Befreunden hat mich glaubw&uuml;rdig berichtet / da&szlig; besagter
            K&uuml;nstler an der Teims in Engeland spatzieret / und etliche Fischer daher fahren
            sehen / mit durchl&ouml;cherten K&auml;sten [&hellip;]
          </p>
          <p>
            One of his kinsmen has told me, and he is to be believed, that the said artist was
            walking by the Thames in England and saw some fishermen going by with boxes full of
            holes, in which they keep the fish and which they hang on their boats; and when they
            cut these off, the boat floated higher. From this he is said to have taken the idea of
            sinking a whole ship under the water in a river by such water-boxes, and driving it
            forward with oars or a pole, since the ship and the boxes can be weighed out by art.
            [&hellip;] The air they must have fetched with a long tube above the water; and two
            such ships, of different sizes, were made, with walls and a deck of greased leather,
            in which the late King in England went on the Thames itself.
          </p>
          <figcaption className="mt-3 text-sm text-muted not-italic">
            Georg Philipp Harsd&ouml;rffer, <em>Deliciae physico-mathematicae</em>, vol. 2
            (Nuremberg, 1651), part 13, problem 8, p. 493,{' '}
            <a href="https://archive.org/details/bub_gb_r1U_AAAAcAAJ/page/n504/mode/1up" className="underline">
              scan at the Internet Archive
            </a>
          </figcaption>
        </blockquote>
        <div className="max-w-[16rem] mx-auto w-full">
          <PageFigure
            src="/articles/beeckman-on-drebbel/harsdoerffer-1651-p493.jpg"
            alt="A page of German blackletter print headed Die VIII Aufgabe, Vnter dem Wasser schiffen."
          />
        </div>
      </figure>
      <p className="text-secondary leading-relaxed mb-4 font-body">
        This is the only early report of how Drebbel&rsquo;s own boat was made to sink, and it is
        close to Beeckman&rsquo;s guess: boxes that let the water in, weighed against the
        ship. It is also the source of the greased leather and of the King on board, and it
        adds that one of the boats went to the Grand Prince in Moscow. Harsd&ouml;rffer gives
        no picture, and he sends the reader on to Mersenne, &ldquo;f. 207 &amp; 208&rdquo;:
        the page quoted above.
      </p>

      <HowItSank />

      <blockquote className="border-l-2 border-accent-gold/60 pl-5 my-10 font-body text-lg leading-relaxed text-primary">
        <p>
          [&hellip;] a Vessel to go under Water; of which, tryal was made in the Thames, with
          admired successe, the Vessel carrying twelve Rowers, besides Passengers; one of which is
          yet alive [&hellip;]
        </p>
        <p className="mt-3 text-sm text-muted">
          Robert Boyle, <em>New Experiments Physico-Mechanicall</em> (Oxford, 1660), pp. 363&ndash;365,{' '}
          <a href="https://archive.org/details/bim_early-english-books-1641-1700_new-experiments-physico-_boyle-robert_1660" className="underline">
            scan at the Internet Archive
          </a>
        </p>
      </blockquote>
      <p className="text-secondary leading-relaxed mb-4 font-body">
        Boyle&rsquo;s is the only account that counts the crew. He had it from
        Drebbel&rsquo;s family and from &ldquo;an Ingenious Physitian that marry&rsquo;d his
        daughter&rdquo;. They told him that besides &ldquo;the Mechanicall contrivance of his
        vessell&rdquo; Drebbel had a &ldquo;Chymicall liquor&rdquo; which restored the used air,
        and which he counted the chief secret of the boat.
      </p>

      <SourceQuote
        book={MONCONYS}
        page={50}
        printedPage={40}
        src={`https://images.sourcelibrary.org/archived/${MONCONYS}/50.jpg`}
        source={<>Balthasar de Monconys, <em>Journal des voyages</em>, part 2 (Lyon, 1666), &ldquo;Voyage d&rsquo;Angleterre&rdquo;, 2 June 1663</>}
        original={<span lang="fr">Il auoit fait aussi vn vaisseau qui se plongeoit dans l&rsquo;eau quand on vouloit, &amp; par le moyen des rames qu&rsquo;il y auoit attach&eacute;es par dehors auec des m&acirc;ches aussi qu&rsquo;on vestissoit, pour manier ces rames, il alloit entre deux eaux; mais il ne pouuoit pas descendre plus bas que douze ou quinze pieds</span>}
      >
        He had also made a vessel that went down into the water when one wished, and by means of
        oars fixed to the outside, with sleeves as well that one put on to work the oars, it went
        along between two waters; but it could not go down lower than twelve or fifteen feet,
        or the weight of the water would have kept it from coming up again, and he would have
        drowned.
      </SourceQuote>
      <p className="text-secondary leading-relaxed mb-4 font-body">
        Monconys went out to Stratford-le-Bow with Henry Oldenburg to see &ldquo;Doctor
        Keiffer, son-in-law of M. Drebel&rdquo;, and had these things &ldquo;confirmed&rdquo; by
        him. It is the only early account that gives a depth, and the only one that says how the
        oars were worked from inside: through sleeves the rowers put on. It comes thirty years
        after Drebbel&rsquo;s death, from a son-in-law who, Monconys adds, had found &ldquo;nothing
        new&rdquo; of his own.
      </p>

      <SourceQuote
        book={PAPIN}
        page={182}
        printedPage={126}
        src="/articles/beeckman-on-drebbel/papin-1695-p126.jpg"
        source={<>Denis Papin, <em>Fasciculus dissertationum de novis quibusdam machinis</em> (Marburg, 1695)</>}
        original={<span lang="la">Ver&ugrave;m admod&ugrave;m probabile est istam aeris quintam essentiam arte parabilem in votis potius quam actu exstitisse</span>}
      >
        But it is very likely that this quintessence of air, to be made by art, existed in wishes
        rather than in fact.
      </SourceQuote>
      <p className="text-secondary leading-relaxed mb-4 font-body">
        Papin goes on: without a way to supply fresh air, Drebbel could try his boat &ldquo;only
        for the sake of curiosity&rdquo;. Papin&rsquo;s own answer was a pump and a leather hose
        to the surface. A few pages later he also gives the earliest report we have found of
        one detail of Drebbel&rsquo;s boat:
      </p>

      <SourceQuote
        book={PAPIN}
        page={193}
        printedPage={135}
        src="/articles/beeckman-on-drebbel/papin-1695-p135.jpg"
        source={<>Papin, <em>Fasciculus</em> (1695)</>}
        original={<span lang="la">Debent autem remi transmitti per foramina lateralia qu&aelig; deinde ope corii circumligati exactissim&egrave; obturantur, prout etiam in navi Drebelliana factum fuisse referunt</span>}
      >
        The oars must be passed through holes in the sides, which are then sealed very tightly
        with leather bound round them, as they report was also done in Drebbel&rsquo;s boat.
      </SourceQuote>

      <h3 className="font-serif text-xl text-primary mt-10 mb-3">The first pictures after Beeckman&rsquo;s</h3>
      <p className="text-secondary leading-relaxed mb-4 font-body">
        No picture of Drebbel&rsquo;s own boat was ever made from life, as far as we can find.
        The first printed picture of a submarine with rowers is Giovanni Alfonso
        Borelli&rsquo;s, in his book on how animals move (1680), sixty years after
        Beeckman&rsquo;s sketch. Borelli does not name Drebbel, and his boat is a design, not a
        record. But it works as the reports say Drebbel&rsquo;s did. Goatskin bottles, open to
        the river through holes in the bottom, fill with water to sink the boat, as
        Harsd&ouml;rffer&rsquo;s water-boxes do. A man squeezes them with a lever to send the
        water out and rise. The oars pass through holes in the sides sealed with doubled goat
        leather, the detail Papin later reports of Drebbel&rsquo;s boat.
      </p>
      <PageFigure src="/articles/beeckman-on-drebbel/borelli-1680-fig-9.jpg" alt="Engraving of a boat with its side cut away: inside, a row of tall leather bottles N stands on the floor and a man works a lever P against them; two oars V pass through the hull and end in webbed blades.">
        Borelli&rsquo;s <span lang="la"><em>navis urinatoria</em></span>, a &ldquo;diving
        ship&rdquo;: the bottles N, the lever P, the oars V with webbed blades Z &ldquo;like the
        feet of geese and frogs&rdquo;. <em>De motu animalium</em>, part 1 (Rome, 1680),
        proposition 224, Tab. XIV, Fig. 9.{' '}
        <a href="https://www.loc.gov/pictures/item/2007675509/" className="underline">Library of Congress</a>.
        The <em>Gentleman&rsquo;s Magazine</em> reprinted it in English in June 1749.
      </PageFigure>
      <p className="text-secondary leading-relaxed mb-4 mt-8 font-body">
        Papin&rsquo;s pictures came fifteen years later. They show
        Papin&rsquo;s own two boats, built for Charles, Landgrave of Hesse, which he
        offers as the remedy for Drebbel&rsquo;s want of air. They are not pictures of
        Drebbel&rsquo;s boat. The first, a box of tinned iron plates, was wrecked when the crane
        lowering it into the water broke. In the second, Papin and another man went down about two
        feet and came up again several times in front of the Landgrave.
      </p>
      <div className="flex flex-wrap justify-center gap-8">
        <div className="w-full max-w-sm">
          <PageFigure src="/articles/beeckman-on-drebbel/papin-1695-fig-25.jpg" alt="Engraving of a box-shaped vessel lettered A to L, with a round hatch E on top, three small oar ports f in the bottom and a pump cylinder G inside one corner.">
            Fig. 25: the first boat, an iron box 5&frac34; feet high, with the hatch E, the oar
            ports f and the air pump G.
          </PageFigure>
        </div>
        <div className="w-full max-w-sm">
          <PageFigure src="/articles/beeckman-on-drebbel/papin-1695-fig-26.jpg" alt="Engraving of an upright oval cask with a door D on top, two curved air pipes, a wheel-shaped blower B and a long cylinder E projecting from its side.">
            Fig. 26: the second boat, an oval wooden cask about six feet high, with the rotary
            blower B and the copper cylinder E from which a man could reach enemy ships.
          </PageFigure>
        </div>
      </div>
      <p className="text-sm text-muted leading-relaxed mt-2">
        Papin, <em>Fasciculus</em> (1695), folding plate. Bayerische Staatsbibliothek, Munich,{' '}
        <a href="https://www.digitale-sammlungen.de/en/view/bsb10843010" className="underline">bsb10843010</a>.
      </p>

      <SourcesTable />

      <h3 className="font-serif text-xl text-primary mt-10 mb-3">How the story grew</h3>
      <p className="text-secondary leading-relaxed mb-4 font-body">
        Later writers joined these accounts together, added to them, and lost track of which
        piece came from where. Jean de Hautefeuille, in a pamphlet on breathing under water
        (1681), was the first we have found to give the boat a shape:
      </p>
      <figure className="not-prose my-10 grid gap-6 md:grid-cols-[1fr_minmax(0,16rem)] items-center">
        <blockquote className="border-l-2 border-accent-gold/60 pl-5 font-body text-lg leading-relaxed text-primary">
          <p lang="fr" className="mb-3 text-secondary italic">
            Ce Navire n&rsquo;estoit autre chose qu&rsquo;un B&acirc;teau, qui avoit &agrave; peu pr&eacute;s
            la figure d&rsquo;un &oelig;uf [&hellip;]
          </p>
          <p>
            This ship was nothing other than a boat almost the shape of an egg, so heavy that it
            sank of itself in the water, and so exactly closed on all sides that the water could
            not get in, which held a certain number of men who steered it up and down, right and
            left and wherever they wished, with oars arranged in a particular way.
          </p>
          <figcaption className="mt-3 text-sm text-muted not-italic">
            Jean de Hautefeuille, <em>L&rsquo;art de respirer sous l&rsquo;eau</em> (1681), p. 7,{' '}
            <a href="https://www.e-rara.ch/content/titleinfo/4563800" className="underline">
              scan at e-rara
            </a>
          </figcaption>
        </blockquote>
        <div className="max-w-[16rem] mx-auto w-full">
          <PageFigure
            src="/articles/beeckman-on-drebbel/hautefeuille-1681-p7.jpg"
            alt="A printed French page numbered 7, beginning with two lines of Latin italic, then Ce Navire n'estoit autre chose qu'un Bâteau."
          />
        </div>
      </figure>
      <p className="text-secondary leading-relaxed mb-4 font-body">
        Hautefeuille is working from Mersenne, whose Latin he quotes just before, and he
        does not believe a word of it: &ldquo;this invention cannot be put into practice&rdquo;.
        He does not say where the egg came from. On pp. 20&ndash;21 he copies out Monconys&rsquo;s
        passage, twelve or fifteen feet and all.
      </p>

      <PageFigure
        src="/articles/beeckman-on-drebbel/fyfe-1902-p159.jpg"
        alt="A halftone picture of a long wooden boat cut open in the middle to show a row of large bags and a man working a lever, with two oars hanging from the side. Caption: The earliest known picture of an under-water vessel."
      >
        Borelli&rsquo;s boat of 1680, redrawn and reversed, in Herbert C. Fyfe,{' '}
        <em>Submarine Warfare, Past, Present and Future</em> (London, 1902), p. 159,{' '}
        <a href="https://archive.org/details/submarinewarfare00fyfe/page/n190/mode/1up" className="underline">
          scan at the Internet Archive
        </a>
        .
      </PageFigure>
      <p className="text-secondary leading-relaxed mb-4 font-body">
        By 1902 Borelli&rsquo;s picture had come loose from Borelli. Fyfe prints it with no name
        and no date, as &ldquo;the earliest known picture of an under-water vessel&rdquo;, in the
        middle of his quotation of Boyle on Drebbel. He does not say it is Drebbel&rsquo;s boat,
        but a reader turning the page would take it so.
      </p>

      <blockquote className="border-l-2 border-accent-gold/60 pl-5 my-10 font-body text-lg leading-relaxed text-primary">
        <p>
          She carried twelve rowers besides passengers, and made a journey of several hours at a
          depth of from 12 to 15 feet. The holes of the oars were made to hold the water by
          leather joints.
        </p>
        <p className="mt-3 text-sm text-muted">
          Alan H. Burgoyne, <em>Submarine Navigation Past and Present</em>, vol. 1 (London, 1903),
          p. 7, footnoted to Boyle 1660,{' '}
          <a href="https://archive.org/details/submarinenavigat0001burg/page/n26/mode/1up" className="underline">
            scan at the Internet Archive
          </a>
        </p>
      </blockquote>
      <p className="text-secondary leading-relaxed mb-4 font-body">
        A year later Burgoyne put the pieces into one sentence and gave it to Boyle. The twelve
        rowers and the passengers are Boyle&rsquo;s. The depth is Monconys&rsquo;s, which Burgoyne
        could have read in Hautefeuille, whose pamphlet he cites four lines further down. The
        leather is Mersenne&rsquo;s proposal and Papin&rsquo;s report. Boyle mentions neither.
      </p>
      <p className="text-secondary leading-relaxed mt-8 font-body">
        Another part of the familiar story, a run from Westminster to Greenwich, is in none of
        these sources, and we have not yet found where it begins. The picture at the top of this
        page, and the replica built for the BBC in 2002, are reconstructions from the same few
        lines.
      </p>
    </section>
  );
}
