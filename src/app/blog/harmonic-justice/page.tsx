import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

// Every quotation from a Source Library book is copied from the stored text of the page it links to,
// fetched through the get_quote tool on 2026-10-16. Claims from outside the library link to their source.
// The hero print is signed "Cross sculpsit" on the plate; our artwork record attributes it to Goltzius,
// which the signature contradicts, so the caption describes only what the print shows.

const TITLE = 'Harmonic Justice';
const DESCRIPTION =
  'Before economics was a science, prices and money were problems of proportion, worked out with the tools used on music and the heavens. Aristotle, Oresme, Bodin, Kepler, the alchemists and Adam Smith on what makes an exchange fair and an order hold.';
const HERO = 'https://images.sourcelibrary.org/artwork/art-goltzius-print-satirical-print.jpg';
const HERO_ALT =
  'English satirical engraving signed "Cross sculpsit": Money, a coin with wings and bird legs, runs off to the right; a spendthrift labelled Prodigality scatters coins; the scales of Justice lie on the ground; hounds named Diligence, Industry, Labour, Rapine, Hazard and Deceit are held on leashes.';

export const metadata: Metadata = {
  title: `${TITLE} - Research Notes - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/blog/harmonic-justice' },
};

const BOOK = {
  aristotle: '/book/aristotle-opera-vol-6-metaphysica-aldine-editio-princeps-aristotle',
  oresme: '/book/traictie-de-la-premiere-invention-des-monnoies-oresme',
  kepler: '/book/the-harmony-of-the-world-kepler',
  splendor: '/book/splendor-solis-the-splendour-of-the-sun-trismosin',
  becher: '/book/narrische-weiszheit-und-weise-narrheit-oder-ein-hundert-so-becher',
  smithTms: '/book/the-theory-of-moral-sentiments-smith',
  nicomachus: '/book/nicomachus-of-gerasa-introduction-to-arithmetic-d-ooge',
  fludd: '/book/the-symphonic-monochord-of-the-world-fludd',
  giorgi: '/book/de-harmonia-mundi-totius-zorzi',
};

// The reader route takes a page id, not a page number (quote-and-snippet-integrity.md).
const PAGE = {
  aristotle584: `${BOOK.aristotle}/page/69b220b356715b0e32473529`,
  oresme143: `${BOOK.oresme}/page/6991e16bb53cae6bb60240a3`,
  kepler203: `${BOOK.kepler}/page/697dd31799fd5fbfe8f83432`,
  kepler204: `${BOOK.kepler}/page/697dd31799fd5fbfe8f83433`,
  splendor129: `${BOOK.splendor}/page/695906d94953388fe7ac7595`,
  becher7: `${BOOK.becher}/page/6a42727728e9db2e39c14057`,
  smith344: `${BOOK.smithTms}/page/69569c011479a63c11090b3f`,
};

const EXT = {
  oresmeGrant: 'https://en.wikipedia.org/wiki/Nicole_Oresme',
  kaye: 'https://assets.cambridge.org/97805215/72767/toc/9780521572767_toc.pdf',
  smithAstronomy: 'https://www.adamsmithworks.org/speakings/smith-s-scientific-milestones',
  keynesNewton: 'https://mathshistory.st-andrews.ac.uk/Extras/Keynes_Newton/',
};

const linkClass = 'text-accent-rust hover:underline';
const p = 'text-secondary leading-relaxed mb-6 font-body';
const h2 = 'text-2xl md:text-3xl text-primary mt-16 mb-6';

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className={linkClass} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Quote({ href, cite, children }: { href: string; cite: React.ReactNode; children: React.ReactNode }) {
  return (
    <blockquote className="border-l-2 border-accent-rust/30 pl-6 my-8">
      <div className="text-secondary leading-relaxed italic font-body">{children}</div>
      <p className="text-xs text-muted mt-2 not-italic">
        <Link href={href} className={linkClass}>
          {cite} &rarr;
        </Link>
      </p>
    </blockquote>
  );
}

export default function HarmonicJusticePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title={TITLE}
          subtitle="Money, proportion and the harmony of the state, before economics was a science"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">16 October 2026 &middot; 12 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link href="/blog" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Economics became a separate science in the eighteenth century. Before that, the people who thought about
          prices, money and trade did it as philosophers, astronomers, music theorists and alchemists, and they used
          the tools they used on the heavens: proportion, the theory of means, and the idea that a whole holds
          together when its parts stand in the right ratios. That vocabulary has mostly left economics. This note
          follows it through six books in the library.
        </p>

        <p className={p}>
          Two earlier notes cover neighbouring ground.{' '}
          <Link href="/blog/invisible-hand" className={linkClass}>
            The Invisible Hand Has a History
          </Link>{' '}
          traces market theory from Aristotle to Bastiat, and{' '}
          <Link href="/blog/nature-of-harmony" className={linkClass}>
            The Nature of Harmony
          </Link>{' '}
          follows the measurers of musical ratio from Pythagoras to Kepler. This one is about the place where the
          two meet: the claim that a fair exchange and a well-ordered state are harmonic in the same sense a chord
          is.
        </p>

        <figure className="my-10">
          <Link href="/book/goltzius-print-satirical-print">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={HERO} alt={HERO_ALT} className="w-full rounded-lg border border-stone-200" />
          </Link>
          <figcaption className="text-sm text-muted mt-3 leading-relaxed">
            An English satirical engraving signed &ldquo;Cross sculpsit&rdquo;, seventeenth century. Money, a coin
            on bird&apos;s legs, runs away to the right. Prodigality scatters coins; Justice&apos;s scales lie on the
            ground beneath him. The hounds on the leashes are Diligence, Industry and Labour on one side, Rapine,
            Hazard and Deceit on the other.
          </figcaption>
        </figure>

        <h2 className={h2}>Aristotle: money is a mean</h2>

        <p className={p}>
          In Book V of the <em>Nicomachean Ethics</em> Aristotle treats exchange as a problem in proportion. A
          shoemaker and a farmer make things that cannot be compared directly, so something has to make them
          comparable. He sets out the chain of conditions in our copy of the Aldine Greek edition of 1495:
        </p>

        <Quote href={PAGE.aristotle584} cite="Aristotle, Nicomachean Ethics V, in the Aldine Opera vol. 6 (Venice, 1495), p. 584">
          Currency, like a mean, makes things commensurable and equalizes them. For there would be no community
          without exchange, no exchange without equality, and no equality without commensurability. In truth, it is
          impossible that things so different can become commensurable. But with respect to need, it is sufficiently
          possible.
        </Quote>

        <p className={p}>
          Two things in this passage matter for everything after it. Money is a <em>mean</em> in the mathematical
          sense: the middle term that lets two unlike extremes stand in a ratio. And the commensurability is not
          real. There must be one standard, Aristotle goes on, &ldquo;and this by assumption. Therefore, it is called{' '}
          <em>nomisma</em>,&rdquo; from <em>nomos</em>, custom or law. The measure is a convention, and it holds only
          with respect to need.
        </p>

        <h2 className={h2}>Oresme: the measure belongs to the community</h2>

        <p className={p}>
          Nicole Oresme (c. 1320&ndash;1382) worked on both ends of this problem. In a treatise on the
          commensurability of the celestial motions he argued that the planets&apos; periods are probably{' '}
          <em>incommensurable</em>, and that exact astrological prediction is therefore impossible (
          <Ext href={EXT.oresmeGrant}>edited by Edward Grant in 1971</Ext>). In his treatise on money, written in the
          1350s while the French crown was repeatedly altering the coinage, he argued that the coinage is not the
          prince&apos;s to alter. The library holds the 1864 edition that prints the medieval French version beside
          the Latin:
        </p>

        <Quote href={PAGE.oresme143} cite="Nicole Oresme, Traictie de la première invention des monnoies, ch. 22 (ed. Wolowski, Paris, 1864), p. lxv">
          Since the money belongs to the community, as was stated and demonstrated in the 6th Chapter, it seems that
          this community may ordain concerning it at its will, and thus change it and take profit from it at its
          pleasure, and treat it as its own property.
        </Quote>

        <p className={p}>
          Oresme states this as the strongest case for altering the coin, and then argues that even the community
          should not do it except in real necessity, because a measure that moves breeds &ldquo;innumerable
          perplexities, errors, and inextricable difficulties in accounts.&rdquo; The historian Joel Kaye has argued
          that the two projects are connected: that living in a monetized economy taught fourteenth-century scholars
          to see nature as a field of graded, measurable quantities (
          <Ext href={EXT.kaye}>
            <em>Economy and Nature in the Fourteenth Century</em>, 1998
          </Ext>
          ). On that reading the market did not only borrow its picture of order from cosmology. The traffic ran both
          ways.
        </p>

        <h2 className={h2}>Bodin and Kepler: harmonic justice, checked against the ear</h2>

        <p className={p}>
          Jean Bodin ended his <em>Six Books of the Commonwealth</em> (1576) with a theory of harmonic justice.
          Arithmetic justice gives everyone equal shares. Geometric justice gives shares in proportion to merit. A
          well-ordered state, Bodin argued, blends the two, the way a harmonic proportion blends an arithmetic and a
          geometric one.
        </p>

        <p className={p}>
          Forty years later Kepler read this and stopped the third book of his{' '}
          <Link href={BOOK.kepler} className={linkClass}>
            <em>Harmony of the World</em>
          </Link>{' '}
          (1619) to deal with it. The section is headed &ldquo;A Political Digression,&rdquo; and he says plainly why
          it is there:
        </p>

        <Quote
          href={PAGE.kepler203}
          cite="Kepler, Harmonices mundi III (Linz, 1619), p. 86. Copy: Bibliotheca Philosophica Hermetica, Amsterdam"
        >
          I decided to transcribe the principal points of this political discussion from Bodin himself, with the
          words and order mostly shaped by my own understanding of that passage. I do this both to bring some light to
          a place that is obscure in itself (for Bodin did not bring enough support from mathematical disciplines to
          this speculation) and to soothe the boredom of those peevish mathematical demonstrations (of which this whole
          work is composed) by interspersing pleasant, popular material, and to show a taste of its usefulness in
          understanding the Commonwealth.
        </Quote>

        <p className={p}>
          Kepler does not reject the idea that a state can be harmonic. He rejects Bodin&apos;s arithmetic. On the
          next page he shows that Bodin&apos;s definition admits mixtures of ratios that are not harmonic at all,
          excludes ratios that plainly are, and contradicts itself. Then he names the real fault:
        </p>

        <Quote href={PAGE.kepler204} cite="Kepler, Harmonices mundi III (Linz, 1619), p. 87">
          Bodin wrongly denies that these latter sets produce harmonic concords, rising up on the authority of the
          ancients against the very evidence of the sense of hearing.
        </Quote>

        <p className={p}>
          This is the useful part of the episode. A model of social order borrowed from music was held to the
          standard of the music. If you say a distribution is harmonic, the ratios have to be consonant, and the test
          is the ear, not the authority.
        </p>

        <h2 className={h2}>The alchemists: wealth that multiplies without being spent</h2>

        <p className={p}>
          Alchemy is remembered as an attempt to make gold. The texts often set the Art above gold and above trade.
          The English translation of <em>Splendor Solis</em> ends:
        </p>

        <Quote href={PAGE.splendor129} cite="Splendor Solis, English translation (London, 1920), p. 81">
          He is like one who had a flint from which he strikes fire and gives to whosoever he likes, without the stone
          getting any smaller through it. It is as good as giving superfluous fine Gold. This Art is also better than
          all commerce, Gold and Silver, and her fruits are better than the wealth of all the world.
        </Quote>

        <p className={p}>
          The flint that gives fire without wearing down is the alchemists&apos; &ldquo;multiplication&rdquo; of the
          Stone. Whatever one makes of the chemistry, it is an exact picture of what credit promises: a source that
          gives without being used up.
        </p>

        <p className={p}>
          The people who held this hope were not all recluses. Johann Joachim Becher (1635&ndash;1682) was an
          alchemist, a physician, an economic adviser to the emperor in Vienna, and a promoter of manufactories and
          trading companies. One of his books in the library is a ledger of his own projects. Its title promises{' '}
          <Link href={PAGE.becher7} className={linkClass}>
            &ldquo;one hundred political, physical, mechanical and mercantile concepts and propositions, some of which
            went well and some came to nothing&rdquo;
          </Link>{' '}
          (<em>Närrische Weißheit und weise Narrheit</em>, &ldquo;Foolish Wisdom and Wise Folly&rdquo;, 1707
          edition). A generation later Isaac Newton, who spent decades on alchemy, was running the Royal Mint.
        </p>

        <h2 className={h2}>Adam Smith: the invisible hand is a providence</h2>

        <p className={p}>
          The phrase everyone knows first appears in Smith&apos;s <em>Theory of Moral Sentiments</em> (1759), in a
          passage about the land and how its produce is shared:
        </p>

        <Quote href={PAGE.smith344} cite="Adam Smith, The Theory of Moral Sentiments (1759), p. 350">
          They are led by an invisible hand to make nearly the same distribution of the necessities of life which
          would have been made had the earth been divided into equal portions among all its inhabitants. Thus, without
          intending it and without knowing it, they advance the interest of society and provide the means for the
          multiplication of the species.
        </Quote>

        <p className={p}>
          The next sentence begins &ldquo;When providence divided the earth among a few lordly masters.&rdquo; The
          hand is the hand of providence, and the claim is a claim of hidden harmony: a division nobody intended
          comes out close to an equal one. It is Bodin&apos;s question, whether the shares are just, answered by an
          appeal to design.
        </p>

        <p className={p}>
          Smith knew how such systems work on the mind. In his essay on the history of astronomy he described a
          philosophical system as an &ldquo;imaginary machine,&rdquo; built to connect appearances and quiet the
          imagination&apos;s unease at what it cannot explain (
          <Ext href={EXT.smithAstronomy}>published after his death, in 1795</Ext>). He judged astronomical systems
          partly by how well they satisfied the imagination. The same test can be put to his own.
        </p>

        <h2 className={h2}>Keynes and the last of the magicians</h2>

        <p className={p}>
          John Maynard Keynes bought a large part of Newton&apos;s alchemical papers at auction in 1936. In a lecture
          read for him at the Royal Society&apos;s Newton tercentenary in 1946, after his death, he said that Newton
          &ldquo;was not the first of the age of reason. He was the last of the magicians&rdquo; (
          <Ext href={EXT.keynesNewton}>&ldquo;Newton, the Man&rdquo;</Ext>). Keynes&apos;s own best-known phrase for
          what drives investment, &ldquo;animal spirits,&rdquo; has a long history behind it, through Descartes back
          to the <em>spiritus animalis</em> of Galenic medicine, though which source Keynes had in mind is disputed.
          The economist who did most to break the idea that markets settle into harmony on their own named what moves
          them with a term from the old physiology.
        </p>

        <h2 className={h2}>Two uses of harmony</h2>

        <p className={p}>
          There are two ways to bring harmony into talk about markets, and these books show both.
        </p>

        <p className={p}>
          The first is apologetic. The system is already harmonious; what looks like conflict is concord at a higher
          level; the shares are fair because providence, or the market, set them. Bastiat&apos;s{' '}
          <em>Economic Harmonies</em> (1850) is the plainest case, and Smith&apos;s invisible hand can be read that
          way.
        </p>

        <p className={p}>
          The second is critical, and it is older. Aristotle says the measure is a convention that holds only with
          respect to need. Oresme says it belongs to the community and should not be moved at will. Kepler says that
          if you call a distribution harmonic, show the ratios and test them against something other than authority.
          The alchemists, read soberly, describe the thing to be wary of: wealth that seems to multiply without being
          spent.
        </p>

        <p className={p}>
          What these writers shared was the assumption that an economy is one case of a general problem: how unlike
          things can be brought into a ratio that holds. They asked it about justice, music and the heavens at once.
          Modern economics kept the mathematics of the question and set aside the part about justice. The older books
          ask which ratios are fair in the same breath as which ones are stable.
        </p>

        <p className={p}>
          A sequel,{' '}
          <Link href="/blog/ledgers-and-heavens" className={linkClass}>
            Ledgers and Heavens
          </Link>
          , follows the people who handled money for a living (the Medici, Pacioli, Copernicus at the mint, a London
          exchange dealer) and what they read.
        </p>

        <h2 className={h2}>The books</h2>

        <ul className="list-disc pl-6 space-y-2 text-secondary font-body mb-8">
          <li>
            Aristotle, <Link href={BOOK.aristotle} className={linkClass}><em>Opera</em>, vol. 6</Link> (Aldine, Venice,
            1495): <em>Nicomachean Ethics</em>, <em>Politics</em>, <em>Economics</em>
          </li>
          <li>
            Nicole Oresme, <Link href={BOOK.oresme} className={linkClass}><em>Traictie de la première invention des monnoies</em></Link>{' '}
            (ed. Wolowski, 1864)
          </li>
          <li>
            Johannes Kepler, <Link href={BOOK.kepler} className={linkClass}><em>Harmonices mundi</em></Link> (Linz, 1619)
          </li>
          <li>
            <Link href={BOOK.splendor} className={linkClass}><em>Splendor Solis</em></Link> (English translation, 1920)
          </li>
          <li>
            Johann Joachim Becher, <Link href={BOOK.becher} className={linkClass}><em>Närrische Weißheit und weise Narrheit</em></Link> (1707)
          </li>
          <li>
            Adam Smith, <Link href={BOOK.smithTms} className={linkClass}><em>The Theory of Moral Sentiments</em></Link> (1759)
          </li>
          <li>
            For the mathematics of the three means: Nicomachus,{' '}
            <Link href={BOOK.nicomachus} className={linkClass}><em>Introduction to Arithmetic</em></Link>. For harmony as
            a picture of the whole world: Francesco Giorgi,{' '}
            <Link href={BOOK.giorgi} className={linkClass}><em>De harmonia mundi totius</em></Link> (1525), and Robert
            Fludd, <Link href={BOOK.fludd} className={linkClass}><em>The Symphonic Monochord of the World</em></Link>{' '}
            (1622).
          </li>
        </ul>

        <p className="text-sm text-muted leading-relaxed">
          Quotations from the library are its English translations, copied from the pages they link to; Bodin&apos;s{' '}
          <em>République</em> itself is not yet in the library, so his theory is given here in Kepler&apos;s account
          of it.
        </p>
      </article>
    </ContentPageLayout>
  );
}
