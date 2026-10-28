import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';

// Shown after Beeckman's 1620 entry: every early report of the boat that the
// library holds, in date order, so a reader can see how little rests on
// Drebbel's own time. Papin's two plates are the earliest printed pictures of
// a submarine in Drebbel's line that we found (Derek asked for "the first
// drawing of it after Beeckman", 2026-10-29). Mersenne and Wilkins are served
// from the library's own page images; Papin's pages and plate are copied from
// the Bayerische Staatsbibliothek scan (bsb10843010), since the library's copy
// has no archived images yet.

const MERSENNE = '69af0dab9f13b61d0a6c6105';
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
        Boyle&rsquo;s is the fullest account, and the only one with numbers. He had it from
        Drebbel&rsquo;s family and from &ldquo;an Ingenious Physitian that marry&rsquo;d his
        daughter&rdquo;. They told him that besides &ldquo;the Mechanicall contrivance of his
        vessell&rdquo; Drebbel had a &ldquo;Chymicall liquor&rdquo; which restored the used air,
        and which he counted the chief secret of the boat.
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
        The earliest printed pictures of a submarine in Drebbel&rsquo;s line that we have found
        are Papin&rsquo;s, seventy-five years after Beeckman&rsquo;s sketch. They show
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

      <p className="text-secondary leading-relaxed mt-8 font-body">
        The rest of the familiar story is later still: the greased-leather hull, a dive of twelve
        to fifteen feet, the run from Westminster to Greenwich, King James aboard. None of it is in
        these sources. The picture at the top of this page, and the replica built for the BBC in
        2002, are reconstructions from the same few lines.
      </p>
    </section>
  );
}
