import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';
import { withArticleMeta } from '@/lib/article-metadata';

// #7983. Every Source Library quote below is the library's English as it stood on the linked
// page on 2026-11-03, compared character by character with the page's stored translation;
// editorial notes, glossed terms and the key numbers on the Pamphilian reading are left out of
// the quotation, not reworded. Each quoted page image was opened and checked against its Latin
// on the same day. Reader pages (?page=N) are scan numbers; the printed page is given beside
// them. Lingua Aegyptiaca restituta is linked but not quoted: its stored text sits on the wrong
// leaves (text for one page shown against the image of another), reported on #7987.
//
// Outside claims are cited in the text: Erman (1917) and Bourgois (2024) for the Domitian
// inscription; Budge (1910); Iversen (1961); Champollion (1822, 1824); Godwin (1979, 2009);
// Stolzenberg (2013). The first-translation paragraph follows the library's own records
// (first_translation on each volume, evidence "weak") and says only what is and is not in English.

const TITLE = 'Kircher and the Hieroglyphs';
const DESCRIPTION =
  'Athanasius Kircher believed hieroglyphs hid a theology older than Moses, and read whole obelisks as hymns to it. He was wrong about the signs and right about Coptic. The books, with his own words.';

export const metadata: Metadata = withArticleMeta('kircher-hieroglyphs', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  alternates: { canonical: '/articles/kircher-hieroglyphs' },
});

const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';

const HERO = 'https://images.sourcelibrary.org/archived/69527350ab34727b1f048c2e/78.jpg';
const IMG = (bookId: string, page: number) => `https://images.sourcelibrary.org/archived/${bookId}/${page}.jpg`;

const OA1 = 'oedipus-aegyptiacus-volume-i-1652-kircher';
const OA1_ID = '65c7583f-4866-4f74-8903-a37bd8f1de33';
const OA2 = 'oedipus-aegyptiacus-volume-ii-1653-kircher';
const OA3 = 'oedipus-aegyptiacus-tomus-iii-kircher';
const OA3_ID = '695273a7ab34727b1f04a708';
const PAMPHILIUS = 'obeliscus-pamphilius-kircher';
const PAMPHILIUS_ID = '69527350ab34727b1f048c2e';
const MINERVA = 'obeliscus-aegyptiacus-kircher';
const MINERVA_ID = '69af0a0803e79fb33525bfff';
const PRODROMUS = 'coptic-forerunner-on-the-egyptian-language-kircher';
const PRODROMUS_ID = '6952db5777f38f6761bc7519';
const LINGUA = 'lingua-aegyptiaca-restituta-kircher';
const SPHINX = 'sphinx-mystagoga-kircher';

const PAMPHILIUS_SOURCE = (
  <>
    Kircher, <em>Obeliscus Pamphilius</em> (Rome, 1650)
  </>
);
const OA3_SOURCE = (
  <>
    Kircher, <em>Oedipus Aegyptiacus</em>, vol. III (Rome, 1654)
  </>
);
const PRODROMUS_SOURCE = (
  <>
    Kircher, <em>Prodromus Coptus sive Aegyptiacus</em> (Rome, 1636)
  </>
);

export default function KircherHieroglyphsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          feature
          headerVariant="dark"
          image={HERO}
          imageAlt="Kircher’s folding plate of the Pamphilian obelisk: its four faces of hieroglyphs drawn side by side, with the papal arms of Innocent X and the obelisk standing in Piazza Navona in the middle."
          title={TITLE}
          subtitle="What Athanasius Kircher thought the Egyptian signs were, how he read whole obelisks, and the one thing he got right, in the books he printed in Rome between 1636 and 1676."
        >
          <p className="text-stone-400 text-sm mt-4">3 November 2026 &middot; 13 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-6 font-body">
          In the late 1640s Pope Innocent X had a broken obelisk dug out of an old circus on the Appian Way and set up in
          the middle of Piazza Navona, on top of Bernini&rsquo;s Fountain of the Four Rivers. It was covered in
          hieroglyphs, and the man asked to explain them was a German Jesuit at the Collegio Romano, Athanasius
          Kircher. The next year he published a book of more than 500 pages on it, the{' '}
          <Link href="/book/obeliscus-pamphilius-kircher">
            <em>Obeliscus Pamphilius</em>
          </Link>
          , named after the pope&rsquo;s family. Its folding plate, above, shows the four faces of the obelisk
          drawn out flat, with the monument itself standing between them.
        </p>
        <p className={P}>
          Kircher (1602&ndash;1680) wrote on magnetism, music, optics, volcanoes, China and the Tower of Babel,
          but the hieroglyphs were the work he cared about most and the one that made and later unmade his
          name. Source Library holds the whole run of it: the Coptic grammar of 1636, the Coptic dictionary of
          1643, the Pamphilian obelisk of 1650, the three volumes of <em>Oedipus Aegyptiacus</em> (1652&ndash;54),
          the little book on the obelisk carried by Bernini&rsquo;s elephant (1666), and a late book on mummies
          (1676). All of them can be read in Latin beside an English translation. This article quotes that English
          and shows the printed page each passage comes from.
        </p>

        <section className="mb-14">
          <h2 className={H2}>Signs of a hidden theology</h2>
          <p className={P}>
            Kircher did not come to the hieroglyphs cold. A long tradition, from the Greek writers of late
            antiquity to the Renaissance, held that the Egyptian signs were not writing in the ordinary sense. The
            fifth-century <em>Hieroglyphica</em> of Horapollo explained them one by one as emblems: a hawk for
            the divine, a snake biting its tail for the universe. The Neoplatonist Iamblichus wrote that the
            Egyptian priests hid their teaching in symbols. Renaissance readers added Hermes Trismegistus, the
            supposed Egyptian sage behind the Hermetic writings, whom they took to be as old as Moses or older.
          </p>
          <p className={P}>
            Kircher put these together into a single story. Hermes, in his telling, invented the hieroglyphs to
            carry a true theology about God and nature, kept it from the common people, and gave it to an order of
            priests sworn to secrecy. Then he cut it into stone so that it would last:
          </p>
          <SourceQuote
            book={PAMPHILIUS}
            page={172}
            printedPage={94}
            src={IMG(PAMPHILIUS_ID, 172)}
            source={PAMPHILIUS_SOURCE}
            pageAlt="Printed page 94 of Obeliscus Pamphilius, Latin text headed Liber II. De Institutione, with two lines of Hebrew at the foot."
          >
            And because he saw that books composed of fragile and corruptible material—such as papyrus, bark,
            and the leaves of palm trees—could by no means escape the greed of time, and those made from metal
            plates could easily be moved elsewhere to the detriment of the Kingdom or be lost; lest the doctrine
            delivered by him slip from memory, he adapted the hardest Stones, remarkably fortified against all
            injuries of time, into mysterious shapes. Thus, by a wonderful method of his own invention, he engraved
            them so that they might stand for eternity.
          </SourceQuote>
          <p className={P}>
            On this view an obelisk is a book of philosophy in stone, and the job of the interpreter is to recover
            the ideas, not the words. Kircher says so at the start of the third volume of <em>Oedipus
            Aegyptiacus</em>, the <em>Theatrum hieroglyphicum</em>, and then shows his method on a single
            ornament: two cobras carrying discs, either side of a bundle of stalks, which he had seen carved on
            stones from the Temple of Isis in Rome.
          </p>
          <SourceQuote
            book={OA3}
            page={64}
            printedPage={61}
            src={IMG(OA3_ID, 64)}
            source={OA3_SOURCE}
            pageAlt="Printed page 61 of Oedipus Aegyptiacus volume III: Latin text above and below a woodcut of two cobras with discs on their heads either side of a tall bundle of stalks."
          >
            <p className="mb-3">
              Since hieroglyphs explain symbolic and mystical concepts through certain signs discovered with the
              highest felicity of genius, they certainly cannot consist of syllables, words, or sentences. We have
              already proven this many times over against those who—persuaded by I know not what
              arguments—too simply believe that histories and the praises of Kings are contained beneath the
              hieroglyphs.
            </p>
            <p>
              &hellip; This is a hieroglyphic character; it suggests to the mind not a letter, nor a syllable, nor a
              word, but an entire ideal sense; and it is as follows: [The eternal and immortal nature of the Gods,
              bestowing life, fire, heat, motion, and the abundance of things upon all those who worship them
              rightly.]
            </p>
          </SourceQuote>
          <p className={P}>
            The sentence to hold on to is the one about kings. The people Kircher argued against expected the
            inscriptions to record &ldquo;histories and the praises of Kings&rdquo;. That is, very largely, what
            they turned out to be.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>How he read an obelisk</h2>
          <p className={P}>
            For the Pamphilian obelisk Kircher built a whole apparatus first: four books on the history of
            obelisks, on Egyptian religion, on Hermes, on the symbolism of animals and plants, on Pythagorean
            number. Only in the fifth book does he reach the stone itself. He divides each face into six parts, which
            he calls schematisms, and each of those into smaller groups of signs. For every part he gives
            &ldquo;the simple meaning of the entire ideal concept&rdquo;, and then a commentary to back it up from
            Greek, Hebrew, Arabic and Chaldean authorities. Before he begins, he promises the reader he will be
            careful:
          </p>
          <SourceQuote
            book={PAMPHILIUS}
            page={473}
            printedPage={397}
            src={IMG(PAMPHILIUS_ID, 473)}
            source={PAMPHILIUS_SOURCE}
            pageAlt="Printed page 397 of Obeliscus Pamphilius, headed Interpretatio, with the start of Chapter III on the division of the interpretation."
          >
            However, all these things will be explained by us with such caution that only those matters which a
            Christian soul ought to know will be set forth.
          </SourceQuote>
          <p className={P}>
            That caution matters for understanding him. Kircher was a Jesuit priest writing in Rome under the eye of
            the pope. He did not think the Egyptian priests had the Christian truth; he thought they had a garbled
            memory of it, handed down from Noah&rsquo;s family, mixed with idolatry and demon worship. Recovering
            it showed, to his mind, that the oldest wisdom of the pagans pointed towards the Trinity. This is the
            idea historians call the <em>prisca theologia</em>, the ancient theology, and it runs through all his
            Egyptian books.
          </p>
          <p className={P}>
            Here is how the top of the eastern face comes out. The page shows Kircher&rsquo;s drawing of the face on
            the left, a hawk-headed figure in a winged disc over a seated god with two attendants, a large hawk and
            a snake below, and his &ldquo;reading of the ideal concept&rdquo; in the column on the right:
          </p>
          <SourceQuote
            book={PAMPHILIUS}
            page={511}
            printedPage={435}
            src={IMG(PAMPHILIUS_ID, 511)}
            source={PAMPHILIUS_SOURCE}
            pageAlt="Printed page 435 of Obeliscus Pamphilius: a woodcut of the top of the obelisk's eastern face, with a triangle of figures over a hawk and a panel of signs, beside a column of Latin headed Idealis conceptus lectio haec est."
          >
            To the triform Deity Hemphta, the First Mind and mover of all things; to the Second Mind, the craftsman;
            to the all-shaping spirit; triune, eternal, lacking beginning and end; the Origin of the secondary
            Gods.
          </SourceQuote>
          <p className={P}>
            The reading runs on through an angelic world, a world of the stars governed by Osiris, and an elemental
            world where a good spirit drives generation, before the power returns to its source. It is a
            Neoplatonic hymn, with a trinity at the top. Kircher&rsquo;s &ldquo;Hemphta&rdquo; is a supreme god he
            built from names he found in Iamblichus and Eusebius.
          </p>
          <p className={P}>
            The obelisk itself says something much plainer, and much later. It is not an ancient Egyptian
            monument at all. It was quarried in Egypt but carved in Rome in the first century AD, for the emperor
            Domitian, and its inscription is a dedication naming Domitian with his father Vespasian and his
            brother Titus. Adolf Erman published a critical edition of it in <em>R&ouml;mische Obelisken</em>{' '}
            (Berlin, 1917); Elise Bourgois reviews the editions since in <em>BABELAO</em> (2024). Kircher had
            also had to work from a monument in pieces. Where signs were missing from the broken shaft, he drew in
            what he thought belonged there, as John Fletcher notes in his study of Kircher&rsquo;s life and works
            (Brill, 2011).
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>The Egyptian Oedipus</h2>
          <div className="max-w-md mx-auto">
            <PageFigure
              src={IMG(OA1_ID, 8)}
              alt="Engraved frontispiece: Oedipus with a spear points up at a winged sphinx on a rock, with pyramids and obelisks behind and two winged figures holding a book of languages above, over the title Oedipus Aegyptiacus."
              href="/book/oedipus-aegyptiacus-volume-i-1652-kircher?page=8"
              source={
                <>
                  <em>Oedipus Aegyptiacus</em>, vol. I (Rome, 1652), frontispiece
                </>
              }
            >
              Oedipus answers the sphinx. Above them, Experience and Reason hold a book listing the languages
              Kircher claimed for the work: Latin, Greek, Hebrew, Chaldean, Syriac, Arabic, Samaritan, Armenian,
              Coptic, Persian, Ethiopian and more. The &ldquo;Digitized by Google&rdquo; mark is on the scan.
            </PageFigure>
          </div>
          <p className={P}>
            The Pamphilian book was the trial run. The full answer came in{' '}
            <em>Oedipus Aegyptiacus</em>, &ldquo;the Egyptian Oedipus&rdquo;, three volumes in four parts
            published in Rome from 1652 to 1654 with money from the emperor Ferdinand III, to whom it is dedicated. The title
            casts Kircher as the hero who answers the riddle of the sphinx.
          </p>
          <p className={P}>
            <Link href="/book/oedipus-aegyptiacus-volume-i-1652-kircher">Volume I</Link> describes Egypt, its kings and its gods, and traces Egyptian
            religion through the idolatry of every other people, from the Hebrews&rsquo; neighbours to India,
            China and Mexico. <Link href="/book/oedipus-aegyptiacus-volume-ii-1653-kircher">Volume II</Link>, the <em>Gymnasium</em>, surveys
            what Kircher took to be the descendants of Egyptian wisdom: Hebrew Kabbalah, Chaldean astrology, Greek
            and Arabic magic, alchemy, medicine and Pythagorean mathematics. <Link href="/book/oedipus-aegyptiacus-tomus-iii-kircher">Volume
            III</Link>, the <em>Theatrum hieroglyphicum</em>, applies the method to every hieroglyphic object
            Kircher could find: the obelisks of Rome one by one, the bronze Isiac Table that had belonged to Cardinal
            Bembo, mummy cases, statues, scarabs and amulets.
          </p>
          <p className={P}>
            At the end of volume III Kircher sums up the case. His proof that the signs are not letters is that the
            same groups appear again and again, in the same places, on obelisk after obelisk:
          </p>
          <SourceQuote
            book={OA3}
            page={570}
            printedPage={559}
            src={IMG(OA3_ID, 570)}
            source={OA3_SOURCE}
            pageAlt="Printed page 559 of Oedipus Aegyptiacus volume III, a summary of the work, with a small woodcut of three rows of hieroglyphs: kneeling figures, hawks and crouching animals."
          >
            Many have wrongly believed that the Egyptians—just as occurs in other languages—constructed their
            hieroglyphs by some alphabetic method which renders words, distinguishes sentences, and places a kind
            of speech before the eyes of readers. That this is false has been demonstrated throughout this entire
            Work, and is sufficiently clear from the propositions placed at the beginning of this Volume.
          </SourceQuote>
          <p className={P}>
            If the signs spelled words, he goes on, a group repeated twelve times would be the same word repeated
            twelve times, which would be foolish and unworthy of the priests. Read with what we know now, the
            argument points the other way. A group that recurs on every obelisk at the head of each column is just
            what a king&rsquo;s names and titles look like.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>The elephant&rsquo;s obelisk</h2>
          <div className="max-w-sm mx-auto">
            <PageFigure
              src={IMG(MINERVA_ID, 21)}
              alt="Engraving of a small obelisk covered in hieroglyphs, with a cross on top, carried on the back of an elephant standing on a stepped pedestal, with a scale of Roman palms below."
              href="/book/obeliscus-aegyptiacus-kircher?page=21"
              source={
                <>
                  Kircher, <em>Obelisci Aegyptiaci &hellip; interpretatio hieroglyphica</em> (Rome, 1666)
                </>
              }
            >
              The obelisk found in the garden of the Dominicans at Santa Maria sopra Minerva in 1665, as Bernini
              set it up on an elephant in 1667.
            </PageFigure>
          </div>
          <p className={P}>
            In 1665 Dominican friars digging in their garden beside Santa Maria sopra Minerva found a small
            obelisk. Pope Alexander VII had it set on the back of a marble elephant designed by Bernini, where it
            still stands, and Kircher published{' '}
            <Link href="/book/obeliscus-aegyptiacus-kircher">
              <em>Obelisci Aegyptiaci &hellip; interpretatio hieroglyphica</em>
            </Link>{' '}
            the next year. It is short, about 180 pages, and shows the method at its most confident. Here is his
            reading of one small framed group, which he describes as a circle, an arm, an altar, a chain, another
            arm and a Nile vessel:
          </p>
          <SourceQuote
            book={MINERVA}
            page={85}
            printedPage={53}
            src={IMG(MINERVA_ID, 85)}
            source={
              <>
                Kircher, <em>Obelisci Aegyptiaci &hellip; interpretatio hieroglyphica</em> (Rome, 1666)
              </>
            }
            pageAlt="Printed page 53 of Kircher's book on the Minerva obelisk, headed Interpretatio, with a small panel of hieroglyphs on the left and an oval frame of signs on the right."
          >
            The benefits of the divine Osiris are to be procured through the medium of sacred rites and the chain
            of Genii, so that the benefits of the Nile may be obtained.
          </SourceQuote>
          <p className={P}>
            The Minerva obelisk is a genuine Egyptian one, made for the pharaoh Apries in the sixth century BC, and
            what is cut on it is that king&rsquo;s names and titles with formulas for the gods. Six signs cannot
            say what Kircher made them say. E. A. Wallis Budge, the British Museum Egyptologist, called his
            translations &ldquo;utter nonsense&rdquo; (<em>Egyptian Language</em>, 1910), adding that because they
            were put out in a learned tongue, many people at the time believed them.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>Why it was wrong</h2>
          <p className={P}>
            Kircher&rsquo;s mistake was not carelessness. He read more Egyptian material than anyone in Europe and
            drew it with great care, and he was working inside the best authorities of his day. The mistake was in
            those authorities. Horapollo and Iamblichus wrote when hieroglyphs were already a fading priestly
            specialty, and they described the symbolic side of the script as if it were the whole of it. Kircher
            started from the conclusion that the signs held ideas and found ideas in every one of them.
          </p>
          <p className={P}>
            Hieroglyphic writing is a mixed system. Most signs stand for sounds, one, two or three consonants each.
            Some stand for whole words. Others are put after a word to show what kind of thing it is: a man, a
            town, a god, an action. Names of kings are written in sound signs inside an oval ring, the cartouche.
            Jean-Fran&ccedil;ois Champollion worked this out from the Rosetta Stone and other inscriptions and
            set it out in his <em>Lettre &agrave; M. Dacier</em> (1822) and his <em>Pr&eacute;cis du syst&egrave;me
            hi&eacute;roglyphique</em> (1824). The key, for him as for no one before, was that the Egyptian words
            he could spell out in the sound signs were words he already knew from Coptic.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>What he got right: Coptic</h2>
          <p className={P}>
            Coptic is the last stage of the Egyptian language, written in Greek letters with a few extra signs, and
            still used in the liturgy of the Coptic Church. By the seventeenth century hardly anyone in Europe could
            read it. Kircher&rsquo;s first Egyptian book, the{' '}
            <Link href="/book/coptic-forerunner-on-the-egyptian-language-kircher">
              <em>Prodromus Coptus sive Aegyptiacus</em>
            </Link>{' '}
            (1636), was a grammar and introduction to it, the first printed in Europe. In the preface he describes
            the task he had been given:
          </p>
          <SourceQuote
            book={PRODROMUS}
            page={13}
            printedPage={3}
            src={IMG(PRODROMUS_ID, 13)}
            source={PRODROMUS_SOURCE}
            pageAlt="Printed page 3 of Prodromus Coptus, a stained page of Latin headed Prooemium."
          >
            the restoration of the ancient Egyptian language, which we call Coptic, was also entrusted to me. This
            task has provided a store of labor all the greater because the subject matter is both rarer and more
            difficult than others.
          </SourceQuote>
          <p className={P}>
            The claim at the heart of the book is in its fifth chapter, &ldquo;Whether the Coptic Language is the
            True and Ancient Language of the Egyptians&rdquo;. Kircher sets the hieroglyphs aside as a symbolic
            theosophy rather than writing proper, then asks what the Egyptians actually spoke, and is honest about
            how little he has to go on:
          </p>
          <SourceQuote
            book={PRODROMUS}
            page={133}
            printedPage={123}
            src={IMG(PRODROMUS_ID, 133)}
            source={PRODROMUS_SOURCE}
            pageAlt="Printed page 123 of Prodromus Coptus, the opening of Chapter V: Utrum Lingua Copta vera et antiqua sit Aegyptiorum Lingua."
          >
            If anyone asks me, therefore, what that ancient language of the Egyptians was, I will more easily respond
            with what I feel than what I ought to publish in writing; since I find no one to follow in this fog of
            antiquity; so much do the eyes of all writers grow dim in perceiving it; so deep is the silence of
            everyone concerning it.
          </SourceQuote>
          <p className={P}>
            His answer was that Coptic was that language, in its late form. He tested it by taking Egyptian words
            preserved in the Bible and in Greek writers, such as the name Pharaoh gave Joseph in Genesis 41, and
            finding them in Coptic. That answer was right. In 1643 he followed it with{' '}
            <Link href="/book/lingua-aegyptiaca-restituta-kircher">
              <em>Lingua Aegyptiaca restituta</em>
            </Link>
            , a Coptic&ndash;Arabic word list with a Latin translation, made from a manuscript the traveller Pietro
            della Valle had brought back from Cairo. For a long time these two books were the main printed
            sources for Coptic in Europe.
          </p>
          <p className={P}>
            Later Egyptologists have given him that much. Erik Iversen, in <em>The Myth of Egypt and its
            Hieroglyphs in European Tradition</em> (1961), counts Kircher&rsquo;s Coptic work as the start of
            Egyptology and credits him with finding the sound of one hieroglyph. Kircher could not take the next
            step because his own theory ruled it out: he had Coptic, the key to the sounds, and refused to believe
            the hieroglyphs had sounds to find.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>The last book: a mummy from Lyon</h2>
          <p className={P}>
            Kircher kept at it into old age. In 1673 a gentleman of Lyon, Monsieur de Four, asked him to decipher a mummy
            lately brought from Egypt to France. The result was{' '}
            <Link href="/book/sphinx-mystagoga-kircher">
              <em>Sphinx mystagoga</em>
            </Link>{' '}
            (Amsterdam, 1676), &ldquo;the sphinx who leads into the mysteries&rdquo;, a hundred pages reading the
            figures painted on the case as hieroglyphic teaching, in the same way as the obelisks. By then the method had
            critics, and fewer readers took it on trust. Kircher died in Rome in 1680. Champollion&rsquo;s letter
            came 142 years later.
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>What is in English</h2>
          <p className={P}>
            On the podcast, Derek said that Kircher&rsquo;s hieroglyph book had never been translated. Here is what
            we can say for certain. We have found no published English translation of the whole of{' '}
            <em>Oedipus Aegyptiacus</em>. The library&rsquo;s own first-translation records for it, and for{' '}
            <em>Obeliscus Pamphilius</em> and <em>Prodromus Coptus</em>, record no earlier complete English
            version, but they rest on catalogue and web searches and are marked as weak evidence, so we treat the
            question as open, not settled. &ldquo;Never been translated&rdquo; is too strong; &ldquo;never
            translated in full, as far as we can find&rdquo; is what the evidence supports.
          </p>
          <p className={P}>
            Parts have been in English for some time. Joscelyn Godwin&rsquo;s <em>Athanasius Kircher: A Renaissance
            Man and the Quest for Lost Knowledge</em> (Thames &amp; Hudson, 1979) and his{' '}
            <em>Athanasius Kircher&rsquo;s Theatre of the World</em> (Thames &amp; Hudson, 2009) reproduce the
            plates with English summaries and extracts. Daniel Stolzenberg&rsquo;s <em>Egyptian Oedipus: Athanasius
            Kircher and the Secrets of Antiquity</em> (University of Chicago Press, 2013) is the standard study of
            the hieroglyph books and translates many passages. What Source Library adds is the whole text, page by
            page, beside the scan.
          </p>
          <p className={P}>
            For the OCR side of the same story, how well the machine reads Kircher&rsquo;s woodcut hieroglyphs and
            Coptic type, see <Link href="/articles/hieroglyph-ocr">reading hieroglyphs with OCR</Link>.
          </p>
        </section>

        <p className="text-sm text-muted font-body">
          Quotations from Kircher are the library&rsquo;s English, machine translations made with AI from the
          Latin and labelled as such on each page; they are quoted as they stand on the linked page, without the
          editorial notes and, in the Pamphilian reading, the small key numbers that link words to the drawing.
          Page numbers are the printed ones; the links open the scan. Claims about the inscriptions and about
          later scholarship are cited to the works named in the text.
        </p>
      </article>
    </ContentPageLayout>
  );
}
