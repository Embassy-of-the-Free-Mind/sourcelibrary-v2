import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import SourceQuote from '@/components/articles/SourceQuote';
import PageFigure from '@/components/articles/PageFigure';

// Part Two of the harmony essays (#7130), after Harmonic Justice. Every quotation from a Source Library
// book was copied from the stored text of the page it links to on 2026-10-22, and the eight page images
// beside the quotations were opened and matched to the quoted words by eye the same day. English books are
// quoted in their printed English; Greek, Latin and Arabic books in the library's translation. The
// Wallace governor sentence (1858) and the cosmology are cited from outside the library; the Wallace
// sentence was checked against the transcription linked below. Wallace's Contributions (1870) and Darwin's
// Descent of Man are imported but still hidden, so they are not linked.

const SLUG = 'concords-not-unisons';
const TITLE = 'Concords, Not Unisons';
const DESCRIPTION =
  'Harmony as fitting unlike things together: a Greek armourer, a Chinese minister’s soup, Miskawayh’s silent dinar, Hume’s strings and Smith’s concords, Spinoza’s refusal of the music of the spheres, Wallace’s governor, and the sound waves of the early universe.';
const HERO = 'https://images.sourcelibrary.org/artwork/art-a-palace-concert.jpg';
const HERO_ALT =
  'Chinese painting on silk: court women sit around a long table, some drinking and some playing a lute, pipes and a flute, while a woman standing at the left keeps time with clappers and a small dog sleeps under the table.';

export const metadata: Metadata = withArticleMeta(SLUG, {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: `/articles/${SLUG}` },
});

// The books, as reader paths. A page is `/book/<slug>?page=N`, with N the scan page.
const B = {
  xenophon: '/book/xenophon-memorabilia-oeconomicus-symposium-apologia-loeb-168-xenophon',
  plato: '/book/dialogues-of-plato-vol-5-laws-epinomis-letters-plato',
  diels: '/book/die-fragmente-der-vorsokratiker-diels',
  legge: '/book/the-chinese-classics-vol-5-part-2-the-chun-tsew-with-the-tso',
  miskawayh: '/book/tahdhib-al-akhlaq-the-refinement-of-character-miskawayh',
  shaftesbury: '/book/characteristicks-of-men-manners-opinions-times-1714-shaftesbury',
  hutcheson: '/book/an-inquiry-into-the-original-of-our-ideas-of-beauty-and-hutcheson',
  hume2: '/book/a-treatise-of-human-nature-volume-2-hume',
  hume3: '/book/a-treatise-of-human-nature-volume-3-hume',
  tms: '/book/the-theory-of-moral-sentiments-smith',
  ethica: '/book/ethica-latin-original-spinoza',
  shortTreatise: '/book/short-treatise-on-god-man-and-his-wellbeing-spinoza',
  essays: '/book/essays-on-philosophical-subjects-smith',
  wealth: '/book/an-inquiry-into-the-nature-and-causes-of-the-wealth-of-smith',
  stewart: '/book/biographical-memoirs-of-adam-smith-william-robertson-and-stewart',
  wallace: '/book/the-origin-of-human-races-and-the-antiquity-of-man-deduced-wallace',
  darwin: '/book/on-the-origin-of-species-darwin',
};

const at = (book: string, page: number) => `${book}?page=${page}`;
// SourceQuote takes the bare slug.
const slug = (book: string) => book.replace('/book/', '');

const IMG = (bookId: string, page: number) => `https://images.sourcelibrary.org/archived/${bookId}/${page}.jpg`;
const PAGE_IMG = {
  xenophon269: IMG('6a08a3c48fae3d3f19b792aa', 269),
  legge284: IMG('6a087ebab2a99026ccf70177', 284),
  miskawayh56: IMG('69ef3d4272c1376fdf2aff50', 56),
  hume212: IMG('695690aaaeb4b980d9ebdbfa', 212),
  tms50: IMG('69568c79be7c607c5f03d7bb', 50),
  ethica42: IMG('6954343f1479a63c11088b5b', 42),
  essays129: IMG('6a3d29eeaf872ba37a51ac9a', 129),
  wallace4: IMG('69ac42f9d05fa71017b8f4f5', 4),
};

const EXT = {
  palaceConcert: 'https://commons.wikimedia.org/wiki/File:A_palace_concert.jpg',
  wallaceTernate: 'https://people.wku.edu/charles.smith/wallace/S043.htm',
  peeblesYu: 'https://doi.org/10.1086/150713',
  sunyaevZeldovich: 'https://doi.org/10.1007/BF00653471',
  huDodelson: 'https://doi.org/10.1146/annurev.astro.40.060401.093926',
  planck2018: 'https://doi.org/10.1051/0004-6361/201833910',
  eisenstein: 'https://doi.org/10.1086/466512',
};

const p = 'text-secondary leading-relaxed mb-6 font-body';
const h2 = 'text-2xl md:text-3xl text-primary mt-16 mb-6';

// A quotation shown without its page picture, linked to the page.
function Quote({ href, cite, children }: { href: string; cite: React.ReactNode; children: React.ReactNode }) {
  return (
    <blockquote className="border-l-2 border-accent-gold/60 pl-6 my-8">
      <div className="text-secondary leading-relaxed italic font-body">{children}</div>
      <p className="text-xs text-muted mt-2 not-italic">
        <Link href={href}>
          {cite} &rarr;
        </Link>
      </p>
    </blockquote>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export default function ConcordsNotUnisonsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="Harmony as the fitting together of unlike things, from a Greek armourer to the early universe"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">22 October 2026 &middot; 15 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          The Greek verb <em>harmozein</em> is a carpenter&apos;s word before it is a musician&apos;s: to join, to fit
          one piece to another. A harmony in the oldest sense is a joint between things that are not the same. This
          note follows that sense through the library: an armourer who charges for fit, a minister who explains
          government by a fish soup, a Persian philosopher who calls money a silent judge, the Scottish moralists who
          described sympathy as the tuning of strings, Spinoza and Adam Smith refusing the music of the heavens, and
          the naturalists who found harmony again as something that has to be kept up.
        </p>

        <p className={p}>
          It follows on from{' '}
          <Link href="/articles/harmonic-justice">Harmonic Justice</Link>, which traced money and fair exchange as
          problems of proportion from Xenophon to the nineteenth-century harmony economists, and from{' '}
          <Link href="/articles/nature-of-harmony">The Nature of Harmony</Link>, on the measurers of musical ratio.
          The earlier note ended with harmony split in two. Fourier designed it: his phalanx would be tuned like an
          orchestra. Bastiat expected it to arise by itself: interests left free would combine harmoniously. Both
          claimed the word, and neither could say what would count as evidence against him. The books below suggest
          a way to tell the difference.
        </p>

        <PageFigure
          src={HERO}
          alt={HERO_ALT}
          href="/book/a-palace-concert"
          credit={
            <>
              Anonymous, <em>A Palace Concert</em>, Tang dynasty style, ink and colour on silk. National Palace
              Museum, Taipei. Public domain, via <Ext href={EXT.palaceConcert}>Wikimedia Commons</Ext>.
            </>
          }
        >
          Music and drink at one table: a lute, pipes and a flute, a woman keeping time with clappers, cups and
          bowls passed between the players.
        </PageFigure>

        <h2 className={h2}>Made to fit</h2>

        <p className={p}>
          In Xenophon&apos;s <em>Memorabilia</em> Socrates visits Pistias, an armourer, and asks a merchant&apos;s
          question: why are his breastplates dearer than anyone else&apos;s, when they are no stronger and cost no
          more to make? In E. C. Marchant&apos;s Loeb translation:
        </p>

        <SourceQuote
          book={slug(B.xenophon)}
          page={269}
          printedPage="237"
          src={PAGE_IMG.xenophon269}
          pageAlt="Loeb page 237, the English of Memorabilia III.x, the conversation with Pistias the armourer"
          source={<>Xenophon, <em>Memorabilia</em> III.x.9&ndash;12, tr. E. C. Marchant (Loeb, 1923)</>}
        >
          &ldquo;Because the proportions of mine are better, Socrates.&rdquo; &hellip; &ldquo;For I presume you
          don&apos;t make them all of the same weight or the same size, that is, if you make them to fit.&rdquo;
          &ldquo;Fit? Why, of course! a breastplate is of no use without that!&rdquo;
        </SourceQuote>

        <p className={p}>
          The{' '}
          <Link href={at(B.xenophon, 268)}>Greek on the facing page</Link> has two words where the English has
          one family. Pistias says his breastplates are <em>eurhythmoteroi</em>, better rhythmed, and Socrates&apos;
          condition is that they be <em>harmottontes</em>, fitting. A good breastplate is not the same for every
          body; its proportion is a relation between the plate and one particular man, and the price follows the fit,
          not the weight of bronze. Asked how he can make a well-proportioned plate for an ill-proportioned body,
          Pistias answers: &ldquo;By making it fit; for if it is a good fit it is well-proportioned.&rdquo;
        </p>

        <p className={p}>
          Plato carried the same thought into politics. In the <em>Laws</em> the Athenian Stranger explains why a
          council should be elected by a method halfway between monarchy and democracy. In Jowett&apos;s translation:
        </p>

        <Quote href={at(B.plato, 337)} cite="Plato, Laws VI, 757, tr. B. Jowett (1875), p. 327">
          For to unequals equals become unequal, if they are not harmonised by measure; and both by reason of
          equality, and by reason of inequality, cities are filled with seditions. &hellip; For there are two
          equalities which are called by the same name, but are in reality in many ways almost the opposite of one
          another; one of them may be introduced without difficulty, by any state or any legislator in the
          distribution of honours: this is the rule of measure, weight, and number, which regulates and apportions
          them. But there is another equality, of a better and higher kind, which is not at once recognised. This is
          the judgment of Zeus&hellip;
        </Quote>

        <p className={p}>
          The higher equality, Plato goes on, &ldquo;gives to the greater more, and to the inferior less&rdquo;. It is
          Pistias&apos;s breastplate again: equal treatment means a different plate for each body. Plato&apos;s
          friend Archytas of Tarentum, the Pythagorean who worked out ratios for the musical scales, said what makes
          the fitting possible. In a fragment preserved by Stobaeus, in the library&apos;s translation from Diels:
        </p>

        <Quote href={at(B.diels, 357)} cite="Archytas, fragment B3, in Diels, Die Fragmente der Vorsokratiker (1912), p. 336">
          When <em>logismos</em> (calculation or accounting) is discovered, it stops <em>stasis</em> (civil strife)
          and increases <em>homonoia</em> (concord); for where it exists, there is no unfair advantage and there is
          equality. Through this, we reach agreements regarding our contracts. Because of this, the poor receive from
          the powerful, and the rich give to those in need, both trusting that through this they will have what is
          equal.
        </Quote>

        <p className={p}>
          Calculation, for Archytas, is a ruler held against the unjust. Concord between rich and poor is not a
          feeling. It comes from an account both sides can check.
        </p>

        <h2 className={h2}>A soup, not water</h2>

        <p className={p}>
          The clearest statement of the idea is Chinese. The <em>Zuo zhuan</em>, a chronicle of the states of the
          Spring and Autumn period, records a conversation at the court of Qi in 522 BC. The marquis comes back from
          hunting and says that only Ju (Keu, in Legge&apos;s spelling) is in harmony with him. His minister Yan Ying
          (Gan-tsze) disagrees. James Legge&apos;s translation of 1872:
        </p>

        <SourceQuote
          book={slug(B.legge)}
          page={284}
          printedPage="684"
          src={PAGE_IMG.legge284}
          pageAlt="Page 684 of Legge's Ch'un Ts'ew with the Tso Chuen, two columns of English, with Gan-tsze's speech on harmony and assent"
          source={<><em>Zuo zhuan</em>, Duke Zhao year 20, tr. James Legge, <em>The Chinese Classics</em> V.ii (1872)</>}
        >
          &ldquo;Keu is an assenter merely; how can he be considered in harmony with you?&rdquo; &ldquo;Are they
          different,&rdquo; asked the marquis, &ldquo;harmony and assent?&rdquo; Gan-tsze said, &ldquo;They are
          different. Harmony may be illustrated by soup. You have the water and fire, vinegar, pickle, salt, and
          plums, with which to cook fish. It is made to boil by the firewood, and then the cook mixes the
          ingredients, harmoniously equalizing the several flavours, so as to supply whatever is deficient and carry
          off whatever is in excess.&rdquo;
        </SourceQuote>

        <p className={p}>
          A good minister, Yan Ying goes on, is the vinegar: when the ruler approves of something improper, he points
          it out; when the ruler rejects something right, he brings it forward. The ancient kings &ldquo;made the
          harmony of the five notes&rdquo; on the same principle as the five flavours, and a piece of music is made of
          clear and thick, fast and slow, high and low, &ldquo;by which the parts are all blended together.&rdquo; Then
          the point about Ju:
        </p>

        <Quote href={at(B.legge, 284)} cite="Zuo zhuan, Duke Zhao year 20, tr. Legge (1872), p. 684">
          Whatever you say &lsquo;Yes&rsquo; to, he also says &lsquo;Yes.&rsquo; Whatever you say &lsquo;No&rsquo;
          to, he also says &lsquo;No.&rsquo; If you were to try to give water a flavour with water, who would care to
          partake of the result? If lutes were to be confined to one note, who would be able to listen to them? Such
          is the insufficiency of mere assent.
        </Quote>

        <p className={p}>
          The Chinese words are <em>he</em> 和, harmony, and <em>tong</em> 同, sameness. Legge renders <em>tong</em>{' '}
          as &ldquo;assent&rdquo;, and the distinction is the one this whole note turns on. Sameness is easy and
          useless. Harmony needs difference, and someone to keep adjusting it: the cook tastes, adds, takes away. The
          same page closes with Confucius on government: &ldquo;Mildness serves to temper severity, and severity to
          regulate mildness&rdquo;, and that is how government is brought to harmony.
        </p>

        <p className={p}>
          Fifteen centuries later, at the courts of Rayy and Isfahan, the philosopher Miskawayh (d. 1030) set Aristotle&apos;s
          account of money into an Arabic book on character, the <em>Tahdh&#299;b al-akhl&#257;q</em>. His example is
          close to Aristotle&apos;s, two craftsmen exchanging their work, and his conclusion goes further:
        </p>

        <SourceQuote
          book={slug(B.miskawayh)}
          page={56}
          printedPage="94–95"
          src={PAGE_IMG.miskawayh56}
          pageAlt="An opening of an Arabic printed book, pages 94 and 95, with the section heading on the need for law in transactions"
          source={<>Miskawayh, <em>Tahdh&#299;b al-akhl&#257;q</em> (The Refinement of Character)</>}
        >
          If the cobbler takes the work of the carpenter and gives him his own work, it is an exchange when the two
          works are equal. However, there is no impediment to one person&apos;s work being better than another&apos;s,
          so the dinar serves as the evaluator and equalizer between them. The dinar is justice and a mean, yet it is
          silent, and the rational human being is the one who employs it&hellip; Therefore, one seeks the aid of a
          ruler, who is a speaking justice, if the matter between two disputants is not resolved by the dinar, which
          is a silent justice.
        </SourceQuote>

        <p className={p}>
          The coin is Archytas&apos;s calculation made portable: a measure both parties trust. But it cannot speak, and
          when it fails someone has to. A few pages on, Miskawayh finds the same justice holding the world together.
          The elements resist one another, &ldquo;their forces are equal and balanced to the ultimate degree of
          stability and equilibrium. Through this type of justice, the heavens and the earth are sustained&rdquo; (
          <Link href={at(B.miskawayh, 63)}>pp. 108&ndash;109</Link>). If one outweighed the other even slightly,
          &ldquo;the world would cease to exist.&rdquo; His cosmic harmony is a balance of opposed forces, not a tune.
        </p>

        <h2 className={h2}>Strings equally wound up</h2>

        <p className={p}>
          In eighteenth-century Britain the word moved inward, into the passions. The Earl of Shaftesbury, in his{' '}
          <em>Characteristicks</em> of 1711, wrote that the honest man is struck not by outward forms but by
          &ldquo;that of <em>inward Character</em>, the Harmony and Numbers of the Heart, and Beauty of the
          Affections&rdquo; (<Link href={at(B.shaftesbury, 45)}>1714 edition, p. 34</Link>). Francis Hutcheson made
          this into a theory of perception. In his <em>Inquiry</em> of 1725 he called &ldquo;our Power of perceiving
          the Beauty of Regularity, Order, Harmony, an INTERNAL SENSE&rdquo;, and the matching power to approve of
          good character &ldquo;a MORAL SENSE&rdquo; (<Link href={at(B.hutcheson, 6)}>p. vi</Link>). The model was
          hearing: &ldquo;Harmony also denotes our pleasant Ideas arising from composition of Sounds, and a good Ear (as
          it is generally taken) a Power of perceiving this Pleasure&rdquo; (
          <Link href={at(B.hutcheson, 21)}>p. 7</Link>). Morality, on this view, is a kind of ear.
        </p>

        <p className={p}>
          David Hume took the comparison from the listener to the instrument. In the third volume of his{' '}
          <em>Treatise of Human Nature</em> (1740), introducing sympathy as the origin of moral feeling:
        </p>

        <SourceQuote
          book={slug(B.hume3)}
          page={212}
          printedPage="204"
          src={PAGE_IMG.hume212}
          pageAlt="Page 204 of Hume's Treatise, volume 3, with the passage on sympathy and strings equally wound up"
          source={<>David Hume, <em>A Treatise of Human Nature</em>, vol. 3 (London, 1740)</>}
        >
          The minds of all men are similar in their feelings and operations; nor can any one be actuated by any
          affection, of which all others are not, in some degree, susceptible. As in strings equally wound up, the
          motion of one communicates itself to the rest; so all the affections readily pass from one person to
          another, and beget correspondent movements in every human creature.
        </SourceQuote>

        <p className={p}>
          This is sympathetic resonance, the effect any lute player knows: pluck one string and another tuned to it
          begins to sound. Hume needs the strings to be &ldquo;equally wound up&rdquo;, and in the second volume he
          adds that &ldquo;the minds of men are mirrors to one another&rdquo;, their passions &ldquo;reverberated&rdquo;
          back and forth until they &ldquo;decay away by insensible degrees&rdquo; (
          <Link href={at(B.hume2, 163)}>p. 157</Link>).
        </p>

        <p className={p}>
          Adam Smith, Hume&apos;s friend, saw the difficulty with the image. Strings are never wound up exactly equally.
          The spectator of someone else&apos;s grief feels something, but less, and of a different kind, because he
          knows the misfortune is not his. So in <em>The Theory of Moral Sentiments</em> (1759) the sufferer has to
          retune himself: &ldquo;He must flatten, if I may be allowed to say so, the sharpness of its natural tone, in
          order to reduce it to harmony and concord with the emotions of those who are about him&rdquo; (
          <Link href={at(B.tms, 49)}>p. 37</Link>). On the next page Smith says what this tuning can and cannot
          achieve:
        </p>

        <SourceQuote
          book={slug(B.tms)}
          page={50}
          printedPage="38"
          src={PAGE_IMG.tms50}
          pageAlt="Page 38 of the first edition of The Theory of Moral Sentiments, headed Of Mutual Sympathy, Part I"
          source={<>Adam Smith, <em>The Theory of Moral Sentiments</em> (London, 1759)</>}
        >
          These two sentiments, however, may, it is evident, have such a correspondence with one another, as is
          sufficient for the harmony of society. Though they will never be unisons, they may be concords, and this is
          all that is wanted or required.
        </SourceQuote>

        <p className={p}>
          A unison is two voices on the same note; a concord is two different notes that sound well together. Smith
          is making Yan Ying&apos;s point in the vocabulary of a music lesson. Society does not need its members to feel
          the same thing, and could not get it if it did. It needs them to feel things that fit, and it gets that only
          by work on both sides: the sufferer flattens his tone, and the spectators imagine themselves into his
          place.
        </p>

        <h2 className={h2}>The refusal: Spinoza and the music of the spheres</h2>

        <p className={p}>
          Smith kept harmony for people and for music. For the heavens he kept something else, and on that point he
          stood with Spinoza, who had refused the cosmic harmony a century earlier. In the appendix to the first part
          of the <em>Ethics</em> (published 1677), Spinoza lists the words people use for how things affect their
          senses, and comes to the ear:
        </p>

        <SourceQuote
          book={slug(B.ethica)}
          page={42}
          printedPage="27"
          src={PAGE_IMG.ethica42}
          pageAlt="Page 27 of Spinoza's Ethica in Latin, from the appendix to Part I, De Deo"
          source={<>Spinoza, <em>Ethica</em> I, Appendix (Latin text, ed. 1915)</>}
          original={
            <>
              quorum postremum homines adeo dementavit, ut Deum etiam harmonia delectari crederent. Nec desunt
              Philosophi, qui sibi persuaserint, motus coelestes harmoniam componere.
            </>
          }
        >
          And finally, those which move the ears are said to give off noise, sound, or harmony, the last of which has
          so maddened men that they believed God also is delighted by harmony. Nor are there lacking Philosophers who
          have persuaded themselves that the celestial motions compose a harmony.
        </SourceQuote>

        <p className={p}>
          Everyone, he concludes, &ldquo;has judged things according to the disposition of their brain&rdquo;, taking
          the affections of the imagination for the things themselves. Harmony is a report about our ears, not about
          the planets. But Spinoza did not throw the word away. In the <em>Short Treatise</em>, writing about how the
          body is affected by other bodies, he keeps it as a physical relation: &ldquo;those by which we are affected
          most harmoniously (as regards the proportion of motion and rest, of which they consist) are most agreeable
          to us&rdquo; (<Link href={at(B.shortTreatise, 265)}>tr. A. Wolf, 1910, p. 123</Link>). Harmony survives as
          a proportion between real things. What goes is the listener in the sky.
        </p>

        <h2 className={h2}>Smith&apos;s two vocabularies</h2>

        <p className={p}>
          Smith&apos;s executors published his <em>Essays on Philosophical Subjects</em> in 1795, five years after his
          death. Their note says he had &ldquo;immediately before his death destroyed many other manuscripts which he
          thought unfit for being made public&rdquo; (<Link href={at(B.essays, 11)}>Advertisement</Link>); Dugald
          Stewart regretted that the lectures on rhetoric were among them (
          <Link href={at(B.stewart, 27)}>
            <em>Biographical Memoirs</em>, 1811, p. 13
          </Link>
          ). What survived includes a history of astronomy, written early, in which the phrase &ldquo;invisible
          hand&rdquo; makes its first appearance in his work. It belongs to a god:
        </p>

        <SourceQuote
          book={slug(B.essays)}
          page={129}
          printedPage="25"
          src={PAGE_IMG.essays129}
          pageAlt="Page 25 of Smith's History of Astronomy in the 1795 Essays, with a reader's pencil marks beside the passage on the invisible hand of Jupiter"
          source={<>Adam Smith, &ldquo;History of Astronomy&rdquo;, in <em>Essays on Philosophical Subjects</em> (London, 1795)</>}
        >
          Fire burns, and water refreshes; heavy bodies descend, and lighter substances fly upwards, by the necessity
          of their own nature; nor was the invisible hand of Jupiter ever apprehended to be employed in those matters.
          But thunder and lightning, storms and sunshine, those more irregular events, were ascribed to his favour, or
          his anger.
        </SourceQuote>

        <p className={p}>
          The hand of Jupiter is what people invoke for the events they cannot explain. The regular ones need no
          god. Smith then describes how philosophy replaced the god with systems, and he is cool about them: &ldquo;A
          system is an imaginary machine invented to connect together in the fancy those different movements and
          effects which are already in reality performed&rdquo; (<Link href={at(B.essays, 148)}>p. 44</Link>). When he
          reaches Plato and the Pythagoreans, he puts the old harmony in its place. The beauty of the system of
          crystalline spheres gave Plato &ldquo;the notion of something like an harmonic proportion, to be discovered
          in the motions and distances of the heavenly bodies; and which suggested to the earlier Pythagoreans, the
          celebrated fancy of the Musick of the Spheres: a wild and romantic idea&rdquo; (
          <Link href={at(B.essays, 137)}>p. 33</Link>).
        </p>

        <p className={p}>
          In the same volume, writing on music itself, Smith is warm. A listener is brought &ldquo;into a sort of
          harmony or concord with the Music&rdquo; (<Link href={at(B.essays, 275)}>p. 163</Link>), and a full concerto,
          with its sounds &ldquo;arranged and digested, both in their coincidence and in their succession, into so
          complete and regular a system&rdquo;, gives a pleasure &ldquo;not unlike that which it derives from the
          contemplation of a great system in any other science&rdquo; (<Link href={at(B.essays, 284)}>p. 172</Link>).
          The concerto is like a scientific system because both are made by people to satisfy the mind.
        </p>

        <p className={p}>
          When Smith came to prices in the <em>Wealth of Nations</em> (1776), he did not reach for harmony at all. He
          reached for Newton. The natural price &ldquo;is, as it were, the central price, to which the prices of all
          commodities are continually gravitating&rdquo;, and whatever keeps them from &ldquo;settling in this center
          of repose and continuance, they are constantly tending towards it&rdquo; (
          <Link href={at(B.wealth, 86)}>vol. I, p. 70</Link>). So Smith has two vocabularies. Concord is for people,
          who must tune themselves to each other. Gravitation is for markets, which settle by mechanism. The
          heavenly harmony he calls romantic. Bastiat, in 1850, would fold the two back together and call
          the market harmonious, and{' '}
          <Link href="/articles/harmonic-justice">Harmonic Justice</Link> follows what happened when he did.
        </p>

        <h2 className={h2}>Harmony as regulation: Wallace and Darwin</h2>

        <p className={p}>
          The word came back in the natural sciences with a new meaning. Alfred Russel Wallace, in his paper on the
          origin of human races read to the Anthropological Society in 1864, explained natural selection as the
          keeping of a harmony that is always being lost:
        </p>

        <SourceQuote
          book={slug(B.wallace)}
          page={4}
          printedPage="clx"
          src={PAGE_IMG.wallace4}
          pageAlt="Page clx of the Journal of the Anthropological Society, Wallace's explanation of natural selection"
          source={<>A. R. Wallace, &ldquo;The Origin of Human Races&rdquo;, <em>Journal of the Anthropological Society</em> (1864)</>}
        >
          Now, health, strength, and long life are the results of a harmony between the individual and the universe
          that surrounds it. Let us suppose that at any given moment this harmony is perfect. A certain animal is
          exactly fitted to secure its prey, to escape from its enemies, to resist the inclemencies of the seasons,
          and to rear a numerous and healthy offspring. But a change now takes place.
        </SourceQuote>

        <p className={p}>
          The cold winters come, the food fails, a faster competitor arrives, and the animal &ldquo;is no longer in
          harmony with its universe.&rdquo; Its offspring vary; the ones that fit survive. Over the ages every form of
          life has been &ldquo;moulded into such new shapes as would preserve their harmony with the ever changing
          universe&rdquo; (<Link href={at(B.wallace, 11)}>p. clxvii</Link>). This is Pistias&apos;s fit again, a
          breastplate for one body, except that the body keeps changing shape and the armourer is death. Wallace then
          makes his own turn: humans, once they had minds, would be &ldquo;kept in harmony with the slowly changing
          universe around him, by an advance in mind, rather than by a change in body&rdquo; (
          <Link href={at(B.wallace, 10)}>p. clxvi</Link>).
        </p>

        <p className={p}>
          Six years earlier, in the essay he sent to Darwin from the island of Ternate in 1858, Wallace had already
          named the mechanism. It was a machine for keeping a harmony, the regulator on a steam engine:
        </p>

        <blockquote className="border-l-2 border-accent-gold/60 pl-6 my-8">
          <div className="text-secondary leading-relaxed italic font-body">
            The action of this principle is exactly like that of the centrifugal governor of the steam engine, which
            checks and corrects any irregularities almost before they become evident; and in like manner no
            unbalanced deficiency in the animal kingdom can ever reach any conspicuous magnitude, because it would
            make itself felt at the very first step, by rendering existence difficult and extinction almost sure
            soon to follow.
          </div>
          <p className="text-xs text-muted mt-2 not-italic">
            A. R. Wallace, &ldquo;On the Tendency of Varieties to Depart Indefinitely from the Original Type&rdquo;,{' '}
            <em>Journal of the Proceedings of the Linnean Society, Zoology</em> 3 (1858), in the{' '}
            <Ext href={EXT.wallaceTernate}>transcription by Charles H. Smith</Ext>
          </p>
        </blockquote>

        <p className={p}>
          A governor does not produce harmony once and leave. It corrects, all the time, and it can only correct
          because something keeps going wrong. Yan Ying&apos;s cook does the same with his soup. Darwin, in the{' '}
          <em>Origin</em> (1859), described the result from the outside. Looking at the plants and bushes clothing an
          entangled bank, &ldquo;we are tempted to attribute their proportional numbers and kinds to what we call
          chance. But how false a view is this!&rdquo; (<Link href={at(B.darwin, 93)}>p. 74</Link>). The proportions
          are kept by checks, competitors and seasons acting together, and on trees growing over long-abandoned
          mounds the same &ldquo;beautiful diversity and proportion of kinds&rdquo; returns. Variation, he wrote at the
          end of his chapter on its laws, adds &ldquo;to the beautiful and harmonious diversity of nature&rdquo; (
          <Link href={at(B.darwin, 194)}>p. 169</Link>). Nobody designed the bank, and it is not a unison either. It is
          many different things held in proportion by their pressure on one another.
        </p>

        <h2 className={h2}>The ringing universe</h2>

        <p className={p}>
          Physics found harmony too, in the place Smith had called romantic. For its first 380,000 years the
          universe was a hot plasma in which light and matter moved as one fluid. Gravity pulled the fluid into
          denser regions; the pressure of the light pushed it back out. The result was sound: the whole universe rang
          with pressure waves. When it cooled enough to become transparent, the waves froze in place, and their
          pattern is still visible as tiny differences in the temperature of the cosmic microwave background.
        </p>

        <p className={p}>
          The pattern is a fundamental and its overtones. One wavelength had just completed its first compression at
          the moment of freezing; the waves at twice and three times its frequency had completed two and three
          half-cycles. Measured across the sky, the temperature differences peak at a series of evenly spaced angular
          scales, as the harmonics of a string sit at evenly spaced frequencies (
          <Ext href={EXT.huDodelson}>Hu and Dodelson, 2002</Ext>). The heights of the peaks carry information. Ordinary
          matter loads the fluid, deepens its compressions and makes the odd-numbered peaks taller than the
          even-numbered ones, so the lowered second peak is a measurement of how much ordinary matter there is.
        </p>

        <p className={p}>
          What separates this from the music of the spheres is the order of events. Andrei Sakharov described the
          oscillations in a paper of 1965, and{' '}
          <Ext href={EXT.peeblesYu}>P. J. E. Peebles and J. T. Yu</Ext> and{' '}
          <Ext href={EXT.sunyaevZeldovich}>R. A. Sunyaev and Ya. B. Zel&apos;dovich</Ext> worked out their imprint in
          1970. The first peak was located by balloon experiments in 2000, the second and third by 2003, and the
          Planck satellite has since measured the series in detail (
          <Ext href={EXT.planck2018}>Planck Collaboration, 2020</Ext>). The amount of ordinary matter read from the peak
          heights agrees with the amount calculated, by an entirely separate route, from the abundance of the light
          elements made in the first minutes. The same sound waves left a ruler in the distribution of galaxies, a
          preferred separation of about 150 megaparsecs, and that was found in galaxy surveys in 2005 (
          <Ext href={EXT.eisenstein}>Eisenstein and others, 2005</Ext>).
        </p>

        <p className={p}>
          Kepler&apos;s planetary harmonies were ratios fitted to orbits that had already been measured. The cosmic overtones
          were predicted decades before anyone could look, and they could have failed to appear. That is the
          difference between a projected harmony and a found one. The older writers in this note had no such test,
          but most of them knew what they were describing was fragile: Yan Ying&apos;s soup has to be tasted,
          Miskawayh&apos;s coin needs a judge when it falls silent, Smith&apos;s sufferer has to flatten his tone, and
          Wallace&apos;s governor works only because the engine keeps running too fast or too slow. In each case the
          harmony is a state that is kept, by someone or something correcting the parts, and never a state that is
          simply there.
        </p>

        <p className={p}>
          That leaves the oldest question unanswered: why particular ratios sound together at all, in a string, a
          bell or a planet&apos;s orbit. It belongs to the physics of vibrating things, and to a later note.
        </p>

        <p className="text-sm text-muted leading-relaxed">
          Quotations from English books (Marchant&apos;s Xenophon, Jowett&apos;s Plato, Legge&apos;s <em>Zuo zhuan</em>,
          Shaftesbury, Hutcheson, Hume, Smith, Stewart, Wallace, Darwin, Wolf&apos;s Spinoza) are the printed English,
          copied from the pages they link to. Archytas, Miskawayh and the Latin <em>Ethics</em> are the library&apos;s
          English translations; the glosses in round brackets in the Archytas fragment are the translation&apos;s.
          Page numbers are the printed ones. Wallace&apos;s Ternate essay and the cosmology are cited from outside the
          library.
        </p>
      </article>
    </ContentPageLayout>
  );
}
