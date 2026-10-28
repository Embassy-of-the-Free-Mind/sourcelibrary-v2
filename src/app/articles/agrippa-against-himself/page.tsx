import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import SourceQuote from '@/components/articles/SourceQuote';
import PageFigure from '@/components/articles/PageFigure';

// Written for the recording with Alex of Agrippa's Diary (October 2026). Every quotation was read with get_quote on
// 2026-10-28 and is the library's translation as it stands on the linked page. Pictures opened by eye on 2026-10-28:
// the 1533 title page with Agrippa's portrait (p. 6) and C. G. Jung's bookplate (p. 3) in the e-rara copy; the
// Saturn and Jupiter squares with their seals (p. 169); the 1529 title page of De nobilitate (p. 2); the 1531
// "To the reader" epigram in De vanitate (p. 3); the Metz chapter (pp. 276-278).

const SLUG = 'agrippa-against-himself';
const TITLE = 'Agrippa Against Himself';
const DESCRIPTION =
  'Cornelius Agrippa wrote the textbook of Renaissance magic, then a book calling all learning vain. His books, and the woman he saved from an inquisitor.';
const HERO = 'https://images.sourcelibrary.org/archived/69bd9ca46120d54bd037001f/6.jpg';
const HERO_ALT =
  'Title page of De occulta philosophia libri tres (Cologne, 1533), with a woodcut portrait of Agrippa in a cap and fur collar and a verse from Matthew below.';

export const metadata: Metadata = withArticleMeta(SLUG, {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: { images: [{ url: HERO, alt: HERO_ALT }], title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: `/articles/${SLUG}` },
});

const BOOK = {
  occulta: '/book/henrici-cornelii-agrippae-de-occulta-philosophia-libri-tres-agrippa-von-2',
  vanitate: '/book/on-the-uncertainty-and-vanity-of-the-sciences-and-arts-agrippa',
  vanitateEnglish: '/book/69c748436a0f3d112faf8108',
  nobility: '/book/on-the-nobility-and-excellence-of-the-female-sex-agrippa',
  llull: '/book/henrici-cornelii-agrippae-armatae-militiae-equitis-aurati-agrippa-von',
  epistola: '/book/epistola-apologetica-contra-insaniam-conradi-coelin-agrippa-von',
  opera: '/book/henrici-cornelii-agrippae-ab-nettesheim-operum-pars-quorum-agrippa-von',
  weyer: '/book/de-praestigiis-daemonum-et-incantationibus-ac-veneficiis-weyer',
  bodin: '/book/de-la-demonomanie-des-sorciers-bodin',
};

const IMG = (book: string, page: number) => `https://images.sourcelibrary.org/archived/${book}/${page}.jpg`;
const OCC = '69bd9ca46120d54bd037001f';
const VAN = '69520717ab34727b1f0436db';

const p = 'text-secondary leading-relaxed mb-6 font-body';
const h2 = 'text-2xl md:text-3xl text-primary mt-16 mb-6';

export default function AgrippaAgainstHimselfPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="He wrote the textbook of Renaissance magic, then a book declaring all learning vain, magic included. Read through his own pages."
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">28 October 2026 &middot; notes for a conversation with Agrippa’s Diary</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          This week we recorded a conversation with Alex, who makes{' '}
          <a href="https://www.youtube.com/@agrippasdiary">Agrippa’s Diary</a>, the channel on the history of the
          occult that takes its name from Heinrich Cornelius Agrippa (1486–1535). Preparing for it, we read
          Agrippa’s own books in Source Library, which holds 92 editions of them. These are notes from that reading.
          The quotations are our English translations, and each is shown beside the page it comes from.
        </p>

        <p className={p}>
          Agrippa is remembered as the magician: the author of <em>Three Books of Occult Philosophy</em>, the book
          behind Marlowe’s “as cunning as Agrippa was” and young Victor Frankenstein’s reading. He also wrote a
          book attacking every science and art, magic first among them, and he printed the two within three years of
          each other. Between them sit a defence of women, a commentary on Ramon Llull, a courtroom fight with an
          inquisitor, and several furious letters to theologians. Read in order, they show one restless argument.
        </p>

        <h2 className={h2}>A book with a portrait and a promise</h2>

        <div className="max-w-md mx-auto">
          <PageFigure
            src={IMG(OCC, 6)}
            alt={HERO_ALT}
            href={`${BOOK.occulta}?page=6`}
            source={<>Agrippa, <em>De occulta philosophia libri tres</em> (Cologne, 1533), title page</>}
          />
        </div>

        <p className={p}>
          The complete <em>Occult Philosophy</em> came out at Cologne in 1533 with Agrippa’s portrait on the title
          page and, under it, a line from Matthew 10: <em>Nihil est opertum quod non reveletur, et occultum quod non
          sciatur</em>. Nothing is covered that will not be revealed, nothing hidden that will not be known. For a
          book about hidden powers, it is a statement of intent.
        </p>

        <p className={p}>
          The copy we read was digitised by e-rara for the Stiftung der Werke von C. G. Jung in Zürich, and{' '}
          <Link href={`${BOOK.occulta}?page=3`}>Jung’s own bookplate is in the front of the volume</Link>: one sign
          of who kept reading Agrippa four centuries on.
        </p>

        <h2 className={h2}>The young man’s book</h2>

        <p className={p}>
          Agrippa drafted the work in 1510, when he was about twenty-four, and sent it to the abbot Johannes
          Trithemius, the most famous scholar of hidden writing in Germany. His dedicatory letter, printed at the
          front of the 1533 edition, says why he wrote it:{' '}
          <Link href={`${BOOK.occulta}?page=9`}>
            “I wondered greatly, and was no less indignant, that no one had hitherto existed who had defended such a
            sublime and sacred discipline from the charge of impiety.”
          </Link>{' '}
          For Agrippa, a <em>magus</em> was a wise man and a priest, not a sorcerer. In the book’s second chapter
          magic is “the most perfect and supreme science”, the{' '}
          <Link href={`${BOOK.occulta}?page=17`}>“absolute completion of the whole of the most noble philosophy.”</Link>
        </p>

        <p className={p}>Trithemius approved, and added a warning that has been quoted ever since:</p>

        <SourceQuote
          book="henrici-cornelii-agrippae-de-occulta-philosophia-libri-tres-agrippa-von-2"
          page={11}
          src={IMG(OCC, 11)}
          pageAlt="The letter of Johannes Trithemius to Agrippa, dated 8 April 1510, printed at the front of De occulta philosophia."
          source={<>Trithemius to Agrippa, 8 April 1510, in <em>De occulta philosophia</em> (Cologne, 1533)</>}
        >
          One precept, however, we warn you to keep: communicate vulgar things to the vulgar, but higher and
          arcane things only to higher and secret friends. Give hay to the ox, sugar only to the parrot.
        </SourceQuote>

        <p className={p}>
          The book that grew from that draft is a ladder of three worlds: the elemental world of stones, plants and
          animals in Book I, the celestial world of number and the stars in Book II, the intellectual world of
          angels, divine names and the soul in Book III. Its most copied pages are the tables of the planets in Book
          II, each a magic square with the seals of a planet’s intelligence and its daemon. Every row, column and
          diagonal of Jupiter’s four-by-four square adds up to 34.
        </p>

        <PageFigure
          src={IMG(OCC, 169)}
          alt="A page of De occulta philosophia with the three-by-three square of Saturn and the four-by-four square of Jupiter, each in Arabic and Hebrew numerals, with the seals of their intelligences and daemons drawn below."
          href={`${BOOK.occulta}?page=169`}
          source={<>The tables of Saturn and Jupiter, <em>De occulta philosophia</em> II.22 (Cologne, 1533)</>}
        />

        <h2 className={h2}>A defence of women</h2>

        <p className={p}>
          The year before, in 1509, Agrippa lectured at Dôle on the excellence of women, hoping for the favour of
          Margaret of Austria. Printed in 1529 as <Link href={BOOK.nobility}><em>On the Nobility and Excellence of
          the Female Sex</em></Link>, it argues from Scripture and law that woman is the better sex. She was created
          last, so she is{' '}
          <Link href={`${BOOK.nobility}?page=12`}>“the end and most perfect complement of all the works of God”</Link>.
          In the Fall, <Link href={`${BOOK.nobility}?page=26`}>“man sinned out of certain knowledge, but woman erred
          through ignorance and being deceived.”</Link> Its sharpest point is social:
        </p>

        <SourceQuote
          book="on-the-nobility-and-excellence-of-the-female-sex-agrippa"
          page={46}
          src={IMG('6952018fab34727b1f04177d', 46)}
          pageAlt="A page from the closing argument of De nobilitate et praecellentia foeminei sexus (1529)."
          source={<>Agrippa, <em>On the Nobility and Excellence of the Female Sex</em> (1529)</>}
        >
          But by the excessive tyranny of men, prevailing against divine right and the laws of nature, the liberty
          once given to women is now (as you might say) interdicted by laws, abolished by custom and usage, and
          extinguished by education.
        </SourceQuote>

        <p className={p}>
          The book was translated into French, German, Italian and English and read for two centuries in the
          argument over women’s worth.
        </p>

        <div className="max-w-md mx-auto">
          <PageFigure
            src={IMG('6952018fab34727b1f04177d', 2)}
            alt="Title page of Agrippa’s De nobilitate et praecellentia foeminei sexus (1529) in a woodcut border, listing the treatises bound with it."
            href={`${BOOK.nobility}?page=2`}
            source={<>Title page, <em>De nobilitate et praecellentia foeminei sexus</em> (1529)</>}
          />
        </div>

        <h2 className={h2}>Metz, 1519: the advocate and the inquisitor</h2>

        <p className={p}>
          In 1518 Agrippa became advocate and orator to the city of Metz. There he took the case of a village woman
          whom a Dominican inquisitor wanted to put to torture as a witch. He tells the story himself, years later,
          in the chapter on the inquisitors’ art in his book on the vanity of the sciences. It begins with what he
          had seen of inquisitors in Italy:
        </p>

        <SourceQuote
          book="on-the-uncertainty-and-vanity-of-the-sciences-and-arts-agrippa"
          page={276}
          src={IMG(VAN, 276)}
          pageAlt="A page of De vanitate (Paris, 1531) on the cruelty of inquisitors, with the marginal note on peasant women."
          source={<>Agrippa, <em>On the Uncertainty and Vanity of the Sciences</em>, the chapter on the inquisitors’ art (Paris, 1531)</>}
          original={<>Et in rusticas mulierculas crudelissime saeuiunt, quas sortilegij aut maleficij accusatas … atrocibus enormibusque tormentis exponunt, donec extortis nunquam cogitatis confessionibus, habeant quod condemnent.</>}
        >
          Furthermore, they rage most cruelly against poor peasant women. When these women are denounced and accused
          of sortilege or maleficium, even without any prior legal evidence, the Inquisitors expose them to atrocious
          and enormous tortures until they have extorted confessions of things the women never even dreamed of. Only
          then do they have something to condemn.
        </SourceQuote>

        <p className={p}>Then he turns to his own case. Agrippa is the woman’s defender; the inquisitor speaks first:</p>

        <SourceQuote
          book="on-the-uncertainty-and-vanity-of-the-sciences-and-arts-agrippa"
          page={277}
          src={IMG(VAN, 277)}
          pageAlt="The page of De vanitate (1531) where Agrippa recounts his dispute with the inquisitor at Metz, with the marginal note ‘Disputatio Agrippae cum Inquisitore quodam’."
          source={<>Agrippa, <em>On the Uncertainty and Vanity of the Sciences</em> (Paris, 1531)</>}
          original={<>Fuit mihi olim cum apud Madiomatricos Reipub. à consilijs Aduocatus praeessem, grauis admodum cum Inquisitore pugna, qui rusticam mulierculam ob futiles quasdam & iniquissimas calumnias in suam carnificinam, & in locum non debitum, homo nequiter traxit, non tam inquirendam quam cruciandam.</>}
        >
          Once, while I was serving as the Advocate and legal counsel for the Republic of Metz, I had a very serious
          battle with an Inquisitor. This man, acting wickedly, had dragged a poor peasant woman to his place of
          execution (and to a venue where he had no jurisdiction) based on certain futile and most unjust slanders;
          he intended not so much to investigate her as to torture her. When I had undertaken her defense and
          demonstrated from the records themselves that nothing had been alleged that would justify interrogation,
          he resisted me to my face. “There is one thing,” he said, “that is more than sufficient: for this woman’s
          mother was once burned as a sorceress.”
        </SourceQuote>

        <p className={p}>
          The inquisitor’s reasoning came, Agrippa says, from the <em>Malleus Maleficarum</em>, the witch-hunters’
          handbook of 1486: witches sacrifice their newborn children to demons and conceive them by incubi, so the
          malice passes to the child like an inherited disease. Agrippa answered with theology, not scepticism.
          Baptism casts Satan out of every child, he said, so no one can be condemned for another’s act, and to hold
          otherwise is to deny the grace of baptism and become a heretic oneself. Then the verdict:
        </p>

        <SourceQuote
          book="on-the-uncertainty-and-vanity-of-the-sciences-and-arts-agrippa"
          page={278}
          src={IMG(VAN, 278)}
          pageAlt="The page of De vanitate (1531) that ends the Metz story and begins the chapter on theology."
          source={<>Agrippa, <em>On the Uncertainty and Vanity of the Sciences</em> (Paris, 1531)</>}
          original={<>uerum ego misellam illam defendere non destiti, ac tandem iuris potentia ab ore Leonis illius saluam eripui, restititque sanguinolentus ille monachus coram omnibus confusus, & crudelitatis nomine perpetuo infamis.</>}
        >
          The cruel hypocrite burned with rage at these words and threatened to take action against me as a
          supporter of heretics. But I did not cease to defend that poor woman, and finally, by the power of the law,
          I snatched her safely from the mouth of that Lion. That bloodthirsty monk stood confused before everyone,
          forever infamous for his cruelty.
        </SourceQuote>

        <p className={p}>
          Her accusers were fined. Agrippa did not argue that witchcraft was impossible. He argued that inquisitors
          tortured poor women on hearsay and sold their acquittals, and that the law and the sacraments forbade
          it. His pupil Johann Weyer, who studied with him as a young man, went further in{' '}
          <Link href={BOOK.weyer}><em>De praestigiis daemonum</em></Link> (1563), the major early book against the
          witch trials. Jean Bodin answered Weyer in his{' '}
          <Link href={BOOK.bodin}><em>Démonomanie</em></Link> (1580) and attacked Agrippa as his master.
        </p>

        <h2 className={h2}>The book against all books</h2>

        <p className={p}>
          In 1526, at Lyon, while serving (and chasing his salary) as physician to the Queen Mother of France, Agrippa wrote{' '}
          <Link href={BOOK.vanitate}><em>On the Uncertainty and Vanity of the Sciences and Arts</em></Link>. It is a
          declamation, a set speech in the manner of Erasmus’s <em>Praise of Folly</em>, and it goes through every
          art from grammar to theology, finding each uncertain, quarrelsome and corrupting. The 1531 Paris edition
          opens with a verse to the reader that sums up its author:
        </p>

        <SourceQuote
          book="on-the-uncertainty-and-vanity-of-the-sciences-and-arts-agrippa"
          page={3}
          src={IMG(VAN, 3)}
          pageAlt="The verse ‘Ad lectorem’ at the front of De vanitate (Paris, 1531), ending ‘Nihil scire felicissima vita’."
          source={<><em>To the Reader</em>, in Agrippa, <em>On the Uncertainty and Vanity of the Sciences</em> (Paris, 1531)</>}
          original={<>Nullis heic parcit Agrippa, contemnit: scit, nescit: flet, ridet: irascitur, insectatur: carpit omnia: ipse philosophus, daemon, heros, deus, & omnia. Nihil scire felicissima vita.</>}
        >
          Agrippa spares no one here, he despises; he knows, he knows not; he weeps, he laughs; he is angry, he
          hunts; he finds fault with everything: he himself is philosopher, demon, hero, god, and everything. To know
          nothing is the happiest life.
        </SourceQuote>

        <p className={p}>
          The preface states the thesis plainly: “nothing more ruinous, nothing more pestilential, can happen to the
          life of men and the salvation of our souls than{' '}
          <Link href={`${BOOK.vanitate}?page=15`}>these very arts and these very sciences.</Link>” Physicians{' '}
          <Link href={`${BOOK.vanitate}?page=242`}>“demand a fee after they have killed patients with their
          drugs”</Link>. Scholastic theology is a Centaur bred at the Sorbonne from Scripture and Aristotle. The
          standard against which all of it fails is the Word of God:{' '}
          <Link href={`${BOOK.vanitate}?page=296`}>“God alone is truthful, and every man is a liar.”</Link>
        </p>

        <p className={p}>
          The surprise is how hard he is on his own subjects. Astrology is{' '}
          <Link href={`${BOOK.vanitate}?page=90`}>“the mother of heretics”</Link>. The arts of divination{' '}
          <Link href={`${BOOK.vanitate}?page=91`}>“defend themselves only under the title of ‘experience’”</Link>.
          The Kabbalah he once studied “with much labor” is{' '}
          <Link href={`${BOOK.vanitate}?page=107`}>“nothing but a mere rhapsody of superstition”</Link>, though in the
          same sentence he grants that God hid real mysteries under the letter of the Law. Alchemists are{' '}
          <Link href={`${BOOK.vanitate}?page=263`}>“the most perverse of all men”</Link>, though many good crafts
          began with them. Natural magic gets off lightest:{' '}
          <Link href={`${BOOK.vanitate}?page=98`}>the wonders it works are “natural works, with only the
          acceleration of time intervening.”</Link> And then he turns on the book that made his name:
        </p>

        <SourceQuote
          book="on-the-uncertainty-and-vanity-of-the-sciences-and-arts-agrippa"
          page={111}
          src={IMG(VAN, 111)}
          pageAlt="The page of De vanitate (1531) where Agrippa recants his books on occult philosophy, with a marginal note naming them."
          source={<>Agrippa, <em>On the Uncertainty and Vanity of the Sciences</em>, chapter on magic (Paris, 1531)</>}
        >
          But concerning magical matters, I wrote three books of quite ample volume when I was still a youth, which I
          titled Of Occult Philosophy. In these books, whatever was then committed in error through the curiosity of
          my youth, I now, being more cautious, wish to recant with this palinodia. For I once wasted much time and
          effort on these vanities.
        </SourceQuote>

        <h2 className={h2}>In praise of the ass</h2>

        <p className={p}>
          The book ends in a mock encomium of the ass: patient, humble, unlettered, the animal that carried Christ
          into Jerusalem. Apuleius, Agrippa notes, would never have been admitted to the mysteries of Isis{' '}
          <Link href={`${BOOK.vanitate}?page=305`}>“had he not first been turned from a Philosopher into an
          Ass.”</Link> The joke carries the book’s whole point:
        </p>

        <SourceQuote
          book="on-the-uncertainty-and-vanity-of-the-sciences-and-arts-agrippa"
          page={306}
          src={IMG(VAN, 306)}
          pageAlt="A page from the digression in praise of the ass at the end of De vanitate (1531)."
          source={<>Agrippa, <em>On the Uncertainty and Vanity of the Sciences</em>, digression in praise of the ass (Paris, 1531)</>}
        >
          From these things which have now been said, it is clearer than the sun that no animal is so capable of
          receiving the divine as the ass; unless you are turned into one, you will not be able to carry the divine
          mysteries.
        </SourceQuote>

        <h2 className={h2}>Fighting the theologians</h2>

        <p className={p}>
          The theologians of Louvain and Paris condemned the book. Agrippa’s{' '}
          <Link href={`${BOOK.opera}?page=293`}><em>Apologia</em></Link> (1533) answers like the lawyer he was: a
          declamation is a rhetorical exercise, and “he who professes that he is writing a declamation, by this very
          fact abrogates faith from himself, nor asserts anything.” When the Cologne inquisitor moved against the
          printing of the <em>Occult Philosophy</em>, he went over the theologians’ heads to the city council,
          and{' '}
          <Link href={`${BOOK.epistola}?page=10`}>his letter</Link> names what he thought really offended them: “it is
          the suspicious name of Magic and Kabbalah that offends these delicate asses.”
        </p>

        <p className={p}>
          Even his commentary on{' '}
          <Link href={`${BOOK.llull}?page=8`}>Ramon Llull’s Short Art</Link>, which promises “the queen of all
          arts” in which “there is no knowable thing that escapes it”, gets a jab in the book of vanities, where{' '}
          <Link href={`${BOOK.vanitate}?page=17`}>“the loquacious Lullist”</Link> joins the list of the pests of
          learning.
        </p>

        <h2 className={h2}>Why print the magic after the recantation</h2>

        <p className={p}>
          The full <em>Occult Philosophy</em> came out in 1533, after the book that recanted it. Agrippa did not hide
          the contradiction. His note to the reader asks pardon for “a curious youth” and says outright:{' '}
          <Link href={`${BOOK.occulta}?page=8`}>“In our book on the Vanity and Uncertainty of the Sciences, I retracted
          this book for the most part.”</Link> The volume ends with the chapters on magic from <em>De vanitate</em>, printed as a <em>Censura</em>, so
          that{' '}
          <Link href={`${BOOK.occulta}?page=381`}>goetia is “exterminated and execrated by the decrees of all
          laws”</Link> inside the textbook of magic itself.
        </p>

        <p className={p}>
          The book’s last chapter offers another way to read it. He says he has written obscurely on purpose:
        </p>

        <SourceQuote
          book="henrici-cornelii-agrippae-de-occulta-philosophia-libri-tres-agrippa-von-2"
          page={371}
          src={IMG(OCC, 371)}
          pageAlt="The concluding chapter of Book III of De occulta philosophia (Cologne, 1533)."
          source={<>Agrippa, <em>De occulta philosophia</em> III.65, conclusion (Cologne, 1533)</>}
        >
          Therefore, let no one be angry with me if we have hidden the truth of this science, entangled in enigmas
          and dispersed in various places; for we have not hidden it from the wise, but from the depraved and
          wicked, and we have delivered it in such a discourse that it must necessarily happen to hide from the
          fool, and admit the wise to its understanding.
        </SourceQuote>

        <p className={p}>
          Readers still argue over whether the recantation was sincere, a shield against the inquisitors, or part of
          a single Christian position. On that last reading, the target of both books is the same: human learning
          that claims certainty on its own authority. Magic is holy when it climbs toward God and submits to the
          Church, and vain when it stops short. The scholastic who mistakes his syllogisms for truth is the enemy in
          the <em>Occult Philosophy</em>, in <em>De vanitate</em>, and in the courtroom at Metz, where his
          syllogisms nearly sent a woman to the fire.
        </p>

        <p className={p}>
          All of Agrippa’s books in the library are on his{' '}
          <Link href="/author/heinrich-cornelius-agrippa">author page</Link>, in Latin, French, German, Dutch, Italian
          and English, from 1529 to 1798, including an <Link href={BOOK.vanitateEnglish}>English <em>Vanity of Arts
          and Sciences</em> of 1684</Link>. The <Link href="/explore/maps/magic">Map of Magic</Link> shows where he
          sits among the authors he drew on and the ones who drew on him.
        </p>

        <p className="text-sm text-muted leading-relaxed mt-12 font-body">
          Quotations are Source Library’s translations as they stand on the linked pages (with dashes set as parentheses), from the 1533 Cologne{' '}
          <em>De occulta philosophia</em> (the C. G. Jung copy, digitised by e-rara), the 1531 Paris <em>De
          vanitate</em> (Bibliothèque nationale de France) and the 1529 <em>De nobilitate</em>. Biographical dates
          follow the standard accounts (Nauert, Perrone Compagni).
        </p>
      </article>
    </ContentPageLayout>
  );
}
