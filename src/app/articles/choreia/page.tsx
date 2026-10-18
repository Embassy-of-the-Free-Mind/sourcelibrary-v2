import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import SourceQuote from '@/components/articles/SourceQuote';

// Every quotation from a Source Library book is copied from the stored text of the page it links to,
// fetched through get_quote on 2026-10-18. English books (Jowett's Laws, the Fowlers' Lucian,
// Archer-Hind's notes) are quoted in their printed English; the rest in the library's translation.
// Read from the page image on 2026-10-18: Plutarch p. 390 (the heading φορὰ καὶ σχῆμα καὶ δεῖξις),
// Lucian p. 241, Jowett p. 223, Archer-Hind p. 134 (χορείας in the Greek and the note), Mercuriale
// p. 136 (lationem, figuram, & indicationem), the Aldine Iliad leaf (ἐν δὲ χορὸν ποίκιλλε). The
// Plotinus manuscript (BSB Cod.graec. 449) was opened but its hand was not read word by word, so it is
// quoted briefly and the argument is given in summary. The Aldine Iliad leaf carries a ProQuest notice,
// so it is linked rather than shown.
// The hero drawing is public domain (Wikimedia Commons, "Raffaello - Bacchantin, zwischen zwei Faunen
// tanzend"), mirrored in the library's artwork collection.

const TITLE = 'Choreia: Dance in the Greek Sources';
const DESCRIPTION =
  'Choreia, the Greek choral dance, read in the sources: Homer’s dancing-floor, Plato on rhythm and on the dance of the planets, Plutarch’s three parts of a dance, Lucian, Plotinus, and the disease called chorea.';
const HERO = 'https://images.sourcelibrary.org/artwork/art-raphael-raffaello-bacchantin-zwischen-zwei-faunen-tanzend-217.jpg';
const HERO_ALT =
  'Red chalk drawing of a woman dancing in a flowing robe, a cymbal raised in each hand, between a faun blowing a curved horn and a faun playing pan-pipes.';

export const metadata: Metadata = withArticleMeta('choreia', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/articles/choreia' },
});

// Reader links, written out so scripts/maintenance/generate-article-books.mjs can find the books.
const BOOK = {
  iliad: '/book/homeri-ilias-1517-aldine-edition-homer',
  laws: '/book/dialogues-of-plato-vol-5-laws-epinomis-letters-plato',
  plutarch: '/book/plutarchi-chaeronensis-moralia-vol-1-bernardakis-teubner-bernardakis',
  mercuriale: '/book/de-arte-gymnastica-libri-sex-amsterdam-ed-mercuriale',
  timaeus: '/book/timaeus-greek-text-with-commentary-archer-hind',
  lucian: '/book/lucian-of-samosata-complete-works-vol-2-fowler-1905-fowler',
  plotinus: '/book/plotinus-enneads-i-vi-porphyry-vita-plotini-porphyry',
  agrippa: '/book/henr-cornelii-agrippae-ab-nettesheym-de-incertitudine-et-agrippa-von',
  paracelsus: '/book/erster-zehender-theil-der-bucher-und-schrifften-des-edlen-huser',
  pausanias: '/book/accurata-graeciae-descriptio-greek-latin-pausanias',
};

// Book slugs for SourceQuote.
const SLUG = Object.fromEntries(Object.entries(BOOK).map(([k, v]) => [k, v.slice('/book/'.length)])) as Record<keyof typeof BOOK, string>;

const PAGES = 'https://images.sourcelibrary.org/pages';
const IMG = {
  laws233: `${PAGES}/69ad656c75811c30866e1810/0233.jpg`,
  laws254: `${PAGES}/69ad656c75811c30866e1810/0254.jpg`,
  plutarch457: `${PAGES}/69b21dfa94025df5d290ae35/0457.jpg`,
  plutarch460: `${PAGES}/69b21dfa94025df5d290ae35/0460.jpg`,
  mercuriale156: `${PAGES}/6a09dd1e24d4d312f5c30cae/0156.jpg`,
  timaeus146: `${PAGES}/69905f1140bc3a0478efa1d3/0146.jpg`,
  lucian249: `${PAGES}/6a08a85450cb4ea746a09fb5/0249.jpg`,
  lucian258: `${PAGES}/6a08a85450cb4ea746a09fb5/0258.jpg`,
  plotinus290: `${PAGES}/699389ee74305116d72d2e0d/0290.jpg`,
  agrippa122: `${PAGES}/69b51e1c47b06ecd5818a308/0122.jpg`,
  paracelsus828: `${PAGES}/69bd9d546120d54bd0375241/0828.jpg`,
};

const book = (slug: string, page?: number) => (page ? `/book/${slug}?page=${page}` : `/book/${slug}`);

const p = 'text-secondary leading-relaxed mb-6 font-body';
const h2 = 'text-2xl md:text-3xl text-primary mt-16 mb-6';

// A quotation shown without its page picture, linked to the page.
function Quote({ href, cite, children }: { href: string; cite: React.ReactNode; children: React.ReactNode }) {
  return (
    <blockquote className="border-l-2 border-accent-gold/60 pl-6 my-8">
      <div className="text-secondary leading-relaxed italic font-body">{children}</div>
      <p className="text-xs text-muted mt-2 not-italic">
        <Link href={href}>{cite} &rarr;</Link>
      </p>
    </blockquote>
  );
}

function Term({ greek, latin, children }: { greek: string; latin: string; children: React.ReactNode }) {
  return (
    <div className="py-3 border-b border-stone-200 last:border-b-0">
      <dt className="font-body text-primary">
        <span className="text-lg">{greek}</span> <span className="text-muted italic">{latin}</span>
      </dt>
      <dd className="text-secondary leading-relaxed font-body mt-1">{children}</dd>
    </div>
  );
}

export default function ChoreiaPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="The Greek word for choral dance, from Homer’s dancing-floor to the planets, read in the books"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">18 October 2026 &middot; 11 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          <em>Choreia</em> is the ancient Greek word for dancing in a group while singing. Our words choreography,
          chorus and choir all come from it. The Greek writers used it for village dances and temple festivals, and
          also for the way the planets move across the sky. This article is for a dancer who has heard that the
          ancients thought the cosmos was a dance and wants to read where they said so. Every passage below links to
          the page it comes from.
        </p>

        <p className={p}>
          The idea is often credited to Aristotle. The passages are Plato&apos;s, Lucian&apos;s and Plotinus&apos;s.
          Aristotle wrote about dance in the <em>Poetics</em>, where dancers are among the artists who imitate
          character, feeling and action through rhythm, and in <em>On the Heavens</em> (book II, chapter 9) he
          rejected the Pythagorean belief that the moving stars make music. His heavens turn in perfect circles and are
          silent.
        </p>

        <h2 className={h2}>Six words</h2>

        <p className={p}>
          The sources use a small vocabulary, and most of it is still in use in dance studios in some form.
        </p>

        <dl className="my-8 border-y border-stone-200">
          <Term greek="χορός" latin="choros">
            The group of dancers, and also the place where they dance. Homer uses the same word for both.
          </Term>
          <Term greek="χορεία" latin="choreia">
            What the choros does: dancing and singing together. Latin writers spelled it <em>chorea</em>.
          </Term>
          <Term greek="ὄρχησις" latin="orchēsis">
            Dancing as such, the body&apos;s part of the art. The <em>orchestra</em> of a Greek theatre was the
            dancing-floor in front of the stage.
          </Term>
          <Term greek="φορά" latin="phora">
            Movement: the travel of the body from one position to the next.
          </Term>
          <Term greek="σχῆμα" latin="schēma">
            Figure: the position a movement arrives at and holds, a pose. The same word is used for the arrangement of
            the planets at a given moment.
          </Term>
          <Term greek="δεῖξις" latin="deixis">
            Pointing: a gesture that shows a thing directly, the sky, the ground, a person standing nearby.
          </Term>
        </dl>

        <h2 className={h2}>The dancing-floor</h2>

        <p className={p}>
          The oldest description is in the <em>Iliad</em>. In book 18 the smith-god Hephaestus makes a shield for
          Achilles and covers it with scenes of ordinary life. In the vineyard the harvesters dance as they carry the
          grapes, and at the end of the series he makes a dancing-floor. The Greek line, in the{' '}
          <Link href={book(SLUG.iliad, 542)}>Aldine edition printed in Venice in 1517</Link>, reads{' '}
          <span lang="grc">ἐν δὲ χορὸν ποίκιλλε</span>, &ldquo;and on it he worked a <em>choros</em>&rdquo;. In the
          lines that follow, the <em>choros</em> is both the floor and the young men and women who dance on it.
        </p>

        <Quote href={book(SLUG.iliad, 542)} cite="Homer, Iliad 18, Aldine edition (Venice, 1517), p. 211">
          In their midst, a boy played a sweet song on a clear-toned lyre, and sang beautifully of Linus with a
          delicate voice; they, beating the ground in time, followed with song and shouting, dancing with their feet.
          &hellip; The famous Amphigyeis wrought a dancing-floor similar to the one that once in wide Knossos the
          skillful Daedalus made for the fair-haired Ariadne.
        </Quote>

        <p className={p}>
          The dancers in this scene follow a musician, keep time with their feet, and sing while they move. That
          combination of music, voice and footwork is what the later writers mean by <em>choreia</em>. The
          dancing-floor Daedalus built for Ariadne at Knossos was a famous object in its own right. Pausanias, who
          travelled Greece in the second century AD, says the people of Knossos still had{' '}
          <Link href={book(SLUG.pausanias, 806)}>&ldquo;the dancing-floor of Ariadne, which Homer mentioned in the
          Iliad, made of white stone&rdquo;</Link>.
        </p>

        <h2 className={h2}>Dance and song as one art</h2>

        <p className={p}>
          Plato gives the fullest account of <em>choreia</em> as a practice, in the second book of the{' '}
          <em>Laws</em>, his last dialogue. An Athenian stranger is talking with a Cretan and a Spartan about how to
          educate citizens. He starts from something anyone can watch: young animals and children cannot keep still.
          What distinguishes people, he says, is that they can feel order in their movement.
        </p>

        <SourceQuote
          book={SLUG.laws}
          page={233}
          printedPage={223}
          src={IMG.laws233}
          source={<>Plato, <em>Laws</em> II, tr. Benjamin Jowett (Oxford, 1875)</>}
          pageAlt="Page 223 of Jowett's Laws, Book II: the Athenian on rhythm, harmony and the chorus."
        >
          But, whereas other animals have no perception of order or disorder in their movements, that is, of rhythm
          or harmony, as they are called, to us, the Gods, who, as we say, have been appointed to be our partners in
          the dance, have given the pleasurable sense of harmony and rhythm; and so they stir us into life, and we
          follow them and join hands with one another in dances and songs; and these they call choruses, which is a
          term naturally expressive of cheerfulness.
        </SourceQuote>

        <p className={p}>
          Plato connects <em>choros</em> with <em>chara</em>, joy. Jowett notes at the foot of the page that the
          derivation is wrong, and modern dictionaries agree, but it tells you how Plato thought of the thing. The
          dialogue continues with a definition that a dancer can use: &ldquo;the uneducated is he who has not been
          trained in the chorus, and the educated is he who has been well trained&rdquo;, and &ldquo;the chorus is made
          up of two parts, dance and song&rdquo;.
        </p>

        <p className={p}>
          Later in the same book the Athenian names what the two halves share.
        </p>

        <SourceQuote
          book={SLUG.laws}
          page={254}
          printedPage={244}
          src={IMG.laws254}
          source={<>Plato, <em>Laws</em> II, tr. Jowett (1875)</>}
          pageAlt="Page 244 of Jowett's Laws: the movement of body and voice share rhythm."
        >
          And the movement of the body and the movement of the voice have a common form which is rhythm, but they
          differ, in that the one is gesture, and the other song. &hellip; man, as we were saying, having attained the
          sense of rhythm, created and invented dancing; and melody arousing and awakening rhythm, both united formed
          the choral art.
        </SourceQuote>

        <p className={p}>
          For Plato a chorus also showed character. On the{' '}
          <Link href={book(SLUG.laws, 234)}>next page of the dialogue</Link> he says that a brave person and a coward
          in the same trouble will not use &ldquo;the same figures and gestures&rdquo;, and that the figures and
          melodies of a good soul can be told from those of a bad one. That is why he treats training in the chorus as
          the whole of early education, and why the <em>Laws</em> spends pages deciding which dances a city should
          allow.
        </p>

        <h2 className={h2}>Three parts of a dance</h2>

        <p className={p}>
          The clearest technical account comes from Plutarch, more than four centuries after Plato. His{' '}
          <em>Table Talk</em> records conversations at dinner parties, and in book IX, question 15, the guests are
          judging a dance competition. Many of the dancers are dancing &ldquo;more eagerly than musically&rdquo;, and
          someone asks what the dance teachers mean by the word <em>phora</em>. Ammonius answers by dividing a dance
          into three parts.
        </p>

        <SourceQuote
          book={SLUG.plutarch}
          page={457}
          printedPage={390}
          src={IMG.plutarch457}
          source={<>Plutarch, <em>Table Talk</em> IX.15, Teubner edition by Bernardakis</>}
          original={<span lang="grc">Ὅτι τρία μέρη τῆς ὀρχήσεως, φορὰ καὶ σχῆμα καὶ δεῖξις</span>}
          pageAlt="Page 390 of the Teubner Table Talk: the heading of Problem 15 on the three parts of dancing."
        >
          That there are three parts of dancing: movement, posture, and demonstration; what each of them is, and what
          is common to poetry and the dance.
        </SourceQuote>

        <p className={p}>
          A dance, he says on the <Link href={book(SLUG.plutarch, 458)}>next page</Link>, is made of movements and
          positions, &ldquo;just as melody is composed of notes and
          intervals; here, the pauses are the limits of the movements.&rdquo; The <em>phora</em> is the movement. The{' '}
          <em>schēma</em> is the position the movement ends in, &ldquo;when, having posed the figure of Apollo or Pan or
          some Bacchante upon the body, they remain graphically in those forms&rdquo;: the dancer arrives, holds a
          recognisable shape for a moment, and the audience sees a god or a character. The third part, <em>deixis</em>,
          does not imitate anything. It points: the dancer shows &ldquo;the earth, the heaven, the people themselves
          standing nearby&rdquo;. The red chalk drawing at the top of this page shows a dancer in the kind of held
          figure Plutarch describes, with two fauns of Pan&apos;s company.
        </p>

        <p className={p}>
          Put in a rehearsal room&apos;s terms, <em>phora</em> is the transition, <em>schēma</em> is the shape you hit
          on the count, and <em>deixis</em> is a gesture whose meaning is outside your body. Plutarch then compares the
          whole to poetry.
        </p>

        <SourceQuote
          book={SLUG.plutarch}
          page={460}
          printedPage={393}
          src={IMG.plutarch460}
          source={<>Plutarch, <em>Table Talk</em> IX.15</>}
          pageAlt="Page 393 of the Teubner Table Talk: dance as silent poetry."
        >
          In short, he said he would transfer the dictum of Simonides from painting to dance: for dance is silent
          poetry, and poetry is, in turn, speaking dance. &hellip; It would seem that, as in painting, the poems
          resemble the colors, and the dances resemble the lines by which the forms are defined.
        </SourceQuote>

        <p className={p}>
          The three parts had a long afterlife. When the physician Girolamo Mercuriale wrote his book on the ancient art
          of physical exercise, <em>De arte gymnastica</em> (first published in 1569), he took
          Plutarch&apos;s division over into Latin as <em>latio</em>, <em>figura</em> and <em>indicatio</em>, and
          added Plutarch&apos;s complaint that dance had since been corrupted.
        </p>

        <SourceQuote
          book={SLUG.mercuriale}
          page={156}
          printedPage={136}
          src={IMG.mercuriale156}
          source={<>Girolamo Mercuriale, <em>De arte gymnastica</em> (Amsterdam, 1672)</>}
          original="lationem, figuram, & indicationem"
          pageAlt="Page 136 of Mercuriale's De arte gymnastica, with lationem, figuram and indicationem in italics."
        >
          Plutarch, the most clear of all after Aristotle, expressed in book IX of his Symposiacs, where he wrote that
          dance had three parts: lation, figure, and indication; because it consisted entirely of motions, postures,
          and rest, just as harmony consists of tones and intervals.
        </SourceQuote>

        <h2 className={h2}>The planets dance</h2>

        <p className={p}>
          The cosmic side of <em>choreia</em> comes from Plato&apos;s <em>Timaeus</em>, a dialogue about how the world
          was made. At 40c, after describing the stars as living, divine beings, Timaeus turns to how they move in
          relation to one another, and the first word of the sentence is <em>choreias</em>, their dances.
        </p>

        <SourceQuote
          book={SLUG.timaeus}
          page={146}
          printedPage={134}
          src={IMG.timaeus146}
          source={<>Plato, <em>Timaeus</em> 40c, ed. R. D. Archer-Hind (London, 1888)</>}
          original={<span lang="grc">χορείας δὲ τούτων αὐτῶν καὶ παραβολὰς ἀλλήλων</span>}
          pageAlt="Page 134 of Archer-Hind's Timaeus: the Greek of 40c, with his note on the word choreias below."
        >
          And the dances of these same stars, and their approaches one to another, and the returnings of their
          circles upon themselves and their advances, and in their conjunctions which of the gods come to be
          alongside of one another and which are opposite, and behind which each one is hidden from us at certain
          times and again appearing &hellip;
        </SourceQuote>

        <p className={p}>
          Read as a dancer, the list is a description of a round dance seen from inside it: dancers draw level with
          one another, pass in front and behind, disappear behind someone and come back into view, and each returns to
          the place where it began. Archer-Hind, in his own English translation on the{' '}
          <Link href={book(SLUG.timaeus, 147)}>facing page</Link>, renders the word as &ldquo;circlings&rdquo;. His note
          under the Greek explains the choice.
        </p>

        <Quote href={book(SLUG.timaeus, 146)} cite="R. D. Archer-Hind, note on Timaeus 40c (1888), p. 134">
          This is an astronomical term signifying the revolution of the planets around a common centre, as it were in a
          round dance: see Epinomis 982 E.
        </Quote>

        <p className={p}>
          The passage he cites, from the <em>Epinomis</em>, a short sequel to the <em>Laws</em>, says the heavens
          are &ldquo;dancing the most beautiful and magnificent movement and dance of all dances&rdquo;. For Plato the stars move in a
          chorus, in formation, keeping time with each other, and the human chorus in the <em>Laws</em> is a small copy
          of it.
        </p>

        <h2 className={h2}>Dance began with the world</h2>

        <p className={p}>
          Lucian, a Syrian writer of the second century AD who wrote in Greek, took the idea further in his dialogue{' '}
          <em>On the Dance</em> (<em>Of Pantomime</em> in the Fowlers&apos; translation). Crato, a stern philosopher,
          scolds his friend Lycinus for spending his time at dance performances. Lycinus answers with a history of
          dancing, and it begins before there were people.
        </p>

        <SourceQuote
          book={SLUG.lucian}
          page={249}
          printedPage={241}
          src={IMG.lucian249}
          source={<>Lucian, <em>Of Pantomime</em> §7, tr. H. W. and F. G. Fowler (Oxford, 1905)</>}
          pageAlt="Page 241 of the Fowlers' Lucian: Lycinus traces dancing back to the creation of the universe."
        >
          The best antiquarians, let me tell you, trace dancing back to the creation of the universe; it is coeval with
          that Eros who was the beginning of all things. In the dance of the heavenly bodies, in the complex involutions
          whereby the planets are brought into harmonious intercourse with the fixed stars, you have an example of that
          art in its infancy, which, by gradual development, by continual improvements and additions, seems at length to
          have reached its climax in the subtle harmonious versatility of modern Pantomime.
        </SourceQuote>

        <p className={p}>
          This is the passage behind most modern statements that the Greeks saw the cosmos as a dance. Lucian puts it in
          the mouth of an enthusiast arguing with a sceptic, and then moves down to earth. On the{' '}
          <Link href={book(SLUG.lucian, 250)}>next page</Link> the Curetes dance in armour, beating their swords on their
          shields so that the infant Zeus&apos;s cries are not heard by his father. Homer&apos;s warrior Meriones is
          praised as a dancer because his footwork let him dodge spears.
        </p>

        <p className={p}>
          The pantomime dancer Lucian admires was a soloist who acted out a whole myth in silence while a chorus sang
          the words. Lucian&apos;s list of what such a dancer has to know is long.
        </p>

        <SourceQuote
          book={SLUG.lucian}
          page={258}
          printedPage={250}
          src={IMG.lucian258}
          source={<>Lucian, <em>Of Pantomime</em> §36&ndash;37, tr. Fowler (1905)</>}
          pageAlt="Page 250 of the Fowlers' Lucian: what the pantomime must know."
        >
          Like Calchas in Homer, the pantomime must know all &lsquo;that is, that was, that shall be&rsquo;; nothing must
          escape his ever ready memory. &hellip; the intelligibility, in the present case, depending on clearness of
          gesticulation. &hellip; He must know the history of the world, from the time when it first emerged from Chaos
          down to the days of Egyptian Cleopatra.
        </SourceQuote>

        <h2 className={h2}>The cosmos as one dancer</h2>

        <p className={p}>
          In the third century AD the philosopher Plotinus turned the image round. He was arguing about astrology:
          whether the stars cause what happens on earth. His answer, in the fourth <em>Ennead</em> (IV.4.33), is that
          the universe is a single living being moving as a whole, and that the positions of its parts follow from the
          movement of the whole, the way a dancer&apos;s limbs follow from the dance. A hand is lifted because the
          figure requires it. A reader who knows the dance can read the rest of the
          figure from the position of one limb, which is how Plotinus thought astrologers could read events from the
          stars without the stars causing them. The library holds the passage in a fifteenth-century Greek manuscript;
          a reader of that copy wrote <em>Elegans comparatio</em>, &ldquo;an elegant comparison&rdquo;, in the margin
          beside it.
        </p>

        <SourceQuote
          book={SLUG.plotinus}
          page={290}
          src={IMG.plotinus290}
          source={<>Plotinus, <em>Enneads</em> IV.4.33, Greek manuscript (Munich, BSB Cod.graec. 449)</>}
          pageAlt="A manuscript page of Plotinus in a dense Greek hand, with Latin notes in the left margin."
        >
          the order of things toward one another, being as if in a single, richly varied dance. For in actions, just as
          in dances, we see the movements of the dance according to each of the motions &hellip; If the deliberate choice
          of the dancer looks toward something else, the parts of the body are affected as a consequence of the dance.
        </SourceQuote>

        <p className={p}>
          Renaissance readers collected all of this. Cornelius Agrippa, in a book published in 1530 that attacks every art
          and science in turn, summarises the ancient story of dancing before he condemns it: it came forth, some say,
          from the movements of the stars, &ldquo;as if it were a certain harmonious choreography of the heavens&rdquo;,
          in the Latin <em>tanquam harmonica quadam cælestium choræa</em>, and was used in worship by the Curetes, the
          Brahmins, the Egyptians and the Salian priests of Rome.
        </p>

        <SourceQuote
          book={SLUG.agrippa}
          page={122}
          src={IMG.agrippa122}
          source={<>Agrippa, <em>Of the Uncertainty and Vanity of the Sciences</em> (Cologne, 1598)</>}
          original="tanquam harmonica quadam cælestium choræa, vna cum mundi generatione diuinitus prodijsse dicunt"
          pageAlt="A page of Agrippa's De incertitudine headed De saltatione et chorea."
        >
          &hellip; from the movements of the stars and constellations, and their advance and retreat, conjunction, and
          order (as if it were a certain harmonious choreography of the heavens) proceeded divinely along with the
          creation of the world.
        </SourceQuote>

        <h2 className={h2}>Chorea as a disease</h2>

        <p className={p}>
          The Latin spelling, <em>chorea</em>, has a second history. In the late Middle Ages outbreaks of compulsive
          dancing were called Saint Vitus&apos; dance or Saint John&apos;s dance, after the saints who were prayed to for
          a cure. Paracelsus, the Swiss physician, rejected the idea that saints send illnesses and gave the condition a
          Latin name instead.
        </p>

        <SourceQuote
          book={SLUG.paracelsus}
          page={828}
          printedPage={41}
          src={IMG.paracelsus828}
          source={<>Paracelsus, <em>De morbis amentium</em>, in his collected works (Basel, 1589)</>}
          original="sondern es ist billich zu nennen Chorea lasciua"
          pageAlt="A page of Paracelsus's collected works in German, chapter three: Of Saint Vitus' dance."
        >
          So we do not want to change the names because of the recognition of the saints, but it is proper to call it
          Chorea lasciua, for reasons as follows hereafter &hellip; So the cause of the sickness Chorea lasciua is solely
          an æstimatio and an assumed imaginatio.
        </SourceQuote>

        <p className={p}>
          Paracelsus thought the dancing came from imagination, or from what the sufferer had seen and heard. In 1686
          the English physician Thomas Sydenham used the name for a different condition, the jerking movements that
          follow a childhood infection, now called Sydenham&apos;s chorea. Huntington&apos;s chorea was named in 1872. In
          medicine today, chorea means involuntary, irregular movement, movement with
          no order and no intention behind it.
        </p>

        <p className="text-sm text-muted leading-relaxed">
          Jowett&apos;s Plato, the Fowlers&apos; Lucian and Archer-Hind&apos;s notes are quoted in their printed
          English. The other quotations are the library&apos;s translations, copied from the pages they link to. The
          Plotinus manuscript is hard to read and its transcription has gaps, so it is quoted briefly and the argument
          is summarised from the standard text of <em>Enneads</em> IV.4.33. Aristotle&apos;s <em>Poetics</em> and{' '}
          <em>On the Heavens</em> and the dates for Sydenham and Huntington
          are cited from outside the library.
        </p>
      </article>
    </ContentPageLayout>
  );
}
