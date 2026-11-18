import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';
import PageEditMode from '@/components/PageEditMode';
import {
  Gloss,
  H3,
  Orig,
  P,
  Section,
  SharingPlans,
  SoaksChart,
  SourceNote,
  VoiceHead,
} from '@/components/articles/bath/BathParts';

// "What the Bath Does": what the books in Source Library say about bathing.
// Every quotation was checked against the current page on 16 November 2026.

const LEAD_IMAGE = '/articles/what-the-bath-does-doctors-of-water/sudatorium.jpg';
const LEAD_ALT =
  "Manuscript painting of naked bathers crowded in a vaulted sweating chamber beside a stream, one filling a jug from the stream, while two haloed figures sit in a cave in the rock above.";
const TITLE = "What the Bath Does: Bathing in Historical Sources";
const DESCRIPTION =
  "Holy springs, cures at hot springs, shared baths, physicians’ rules and ideas that came in the bath, from Pausanias and Caraka to Paracelsus and Descartes.";

export const metadata: Metadata = withArticleMeta('what-the-bath-does', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: LEAD_IMAGE, alt: LEAD_ALT }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: LEAD_IMAGE, alt: LEAD_ALT }],
  },
  alternates: {
    canonical: '/articles/what-the-bath-does',
  },
});

export default function WhatTheBathDoes() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="Holy springs, cures, shared baths, physicians' rules and ideas that came in the bath, in the words of the sources."
          image={LEAD_IMAGE}
          imageAlt={LEAD_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">16 November 2026 &middot; 13 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <PageEditMode />
      <article className="prose-content max-w-none">
        <p className="font-sans text-sm text-muted leading-relaxed mb-10">Picture at the top: the sweating room, from Peter of Eboli&apos;s poem on the baths of Pozzuoli, <em>De balneis Puteolanis</em>. Biblioteca Angelica, Rome, Ms. 1474. Public domain · via <a href="https://commons.wikimedia.org/wiki/File:Petrus_de_Ebulo_-_Balneum_Sudatorium.jpg">Wikimedia Commons</a>.</p>

        <p className="text-xl text-secondary leading-relaxed mb-8">
          Writers from Pausanias to Descartes describe holy springs, cures at hot springs, baths shared with
          strangers, physicians&apos; rules for bathing, and ideas that came to people in the bath. The passages here
          are from books in Source Library.
        </p>

        <Section>Holy springs and water spirits</Section>

        <PageFigure
          src="/articles/what-the-bath-does-water-is-someone/forum-vulcani.jpg"
          alt="Pen drawing of a wide volcanic crater with steam rising from vents along its far wall and two small figures crossing the pale floor."
          credit={<>National Gallery of Art, Washington · CC0 · via <a href="https://commons.wikimedia.org/wiki/File:Joris_Hoefnagel,_Forum_Vulcani_-_The_Hot_Springs_at_Pozzuoli,_c._1577-1578,_NGA_54196.jpg">Wikimedia Commons</a></>}
        >
          Joris Hoefnagel, <em>Forum Vulcani</em>, the hot springs at Pozzuoli, c. 1577–78. Pen and ink.
        </PageFigure>


        <P>
          Many springs in these books were said to belong to a hero, a goddess or a spirit. People prayed or made
          an offering before they went in, and left gifts when they were cured.
        </P>

        <H3>Oropus</H3>

        <P>
          Pausanias describes the sanctuary of Amphiaraus at Oropus, where people came to put a question to the
          hero. In J. G. Frazer&apos;s English: <Link href="/book/pausanias-description-of-greece-vol-1-frazer?page=153">&ldquo;Those who come to inquire of Amphiaraus are wont to purify themselves first of all. Purification consists in sacrificing to the god.&rdquo;</Link> Then:
        </P>

        <SourceQuote
          book="pausanias-description-of-greece-vol-1-frazer"
          page={153} printedPage="53"
          src="https://images.sourcelibrary.org/pages/69924f3a5976b55115ffd500/0153.jpg"
          source={<>Pausanias, <em>Description of Greece</em> I.34, trans. J. G. Frazer</>}
          pageAlt="The page of Pausanias: Description of Greece, Vol. 1 that this quotation is from (scan 153, printed page 53)"
        >
          <div className="space-y-3">
            <p>&ldquo;they sacrifice a ram, and spreading the skin under them go to sleep, awaiting a revelation in a dream.&rdquo;</p>
          </div>
        </SourceQuote>

        <PageFigure
          src="/articles/what-the-bath-does-water-is-someone/oropos-stoa.jpg"
          alt="Photograph of a long low line of stone foundations and column bases among pine trees at an archaeological site."
          credit={<>Photograph by George E. Koronaios, 24 July 2020 · CC0 · via <a href="https://commons.wikimedia.org/wiki/File:Remains_of_the_Stoa_(4th_cent._B.C.)_at_the_Amphiareion_of_Oropos_on_July_24,_2020.jpg">Wikimedia Commons</a></>}
        >
          The remains of the 4th-century BC stoa at the Amphiareion of Oropos. The information board at the site says it housed visitors to the sanctuary and the sick.
        </PageFigure>

        <P>Near the temple is a spring.</P>

        <SourceQuote
          book="accurata-graeciae-descriptio-greek-latin-pausanias"
          page={49} printedPage="33"
          src="https://images.sourcelibrary.org/pages/69938e26d5a98fd66f4307b0/0049.jpg"
          source={<>Pausanias, <em>Description of Greece</em> 1.34.4, Greek–Latin edition</>}
          pageAlt="The page of Description of Greece that this quotation is from (scan 49, printed page 33)"
        >
          <div className="space-y-3">
            <Orig lang="grc">πηγή πλησίον τοῦ ναοῦ, ἣν Ἀμφιαράου καλοῦσιν ... κατέστηκεν ἄργυρον ἀφεῖναι καὶ χρυσὸν ἐπίσημον ἐς τὴν πηγήν.</Orig>
            <p>&ldquo;a spring near the temple which they call the spring of Amphiaraus ... it is the custom to drop silver and coined gold into the spring.&rdquo;</p>
          </div>
        </SourceQuote>

        <P>
          Nothing else is done with it: <Link href="/book/pausanias-description-of-greece-vol-1-frazer?page=152">&ldquo;They neither sacrifice into it, nor do they use its water for purification or for washing the hands&rdquo;</Link>.
          The coins come from people who have been healed after consulting the oracle, <Link href="/book/pausanias-description-of-greece-vol-1-frazer?page=153">&ldquo;for it was here, they say, that Amphiaraus rose as a god.&rdquo;</Link>
        </P>

        <SourceNote>Pausanias, <em>Description of Greece</em> I.34, trans. J. G. Frazer, pp. 52–53 · <Link href="/book/pausanias-description-of-greece-vol-1-frazer?page=153">open the page</Link></SourceNote>

        <PageFigure
          src="/articles/what-the-bath-does-water-is-someone/kings-bath.jpg"
          alt="Process print after a pen drawing by J. Fayram of the King's Bath at Bath: a square pool among buildings, a canopied structure in its centre."
          credit={<>Wellcome Collection · Public Domain Mark · <a href="https://wellcomecollection.org/works/tqzt9kbr">museum record</a></>}
        >
          The King&apos;s Bath at Bath &quot;as it appeared in 1738, with the thank offerings, the gifts of the recovered patients&quot;, after a drawing by J. Fayram.
        </PageFigure>

        <H3>Other springs</H3>

        <VoiceHead level="h4">Clitumnus</VoiceHead>
        <SourceQuote
          book="c-plinii-secundi-nouocomensis-epistolarum-libri-decem-in-qui"
          page={264} printedPage="227"
          src="https://images.sourcelibrary.org/pages/6a08535149638a50931bc8b3/0264.jpg"
          source={<>Pliny the Younger, <em>Letters</em> VIII.8</>}
          pageAlt="The page of Pliny the Younger: Ten Books of Letters that this quotation is from (scan 264, printed page 227)"
        >
          <div className="space-y-3">
            <Orig lang="la">Is terminus sacri, profanique. In superiore parte nauigare tantum, infra etiam natare concessum.</Orig>
            <p>A bridge stands over the stream. &ldquo;This is the boundary between the sacred and the profane. In the upper part, it is permitted only to sail; in the lower, also to swim.&rdquo; Nearby, &ldquo;The Hispellates, to whom the deified Augustus gave that place as a gift, publicly provide a bath, and a hostel.&rdquo;</p>
            <p>The spring itself is <Link href="/book/c-plinii-secundi-nouocomensis-epistolarum-libri-decem-in-qui?page=263">&ldquo;pure and glassy, so that you can count the coins thrown in and the shining pebbles.&rdquo;</Link></p>
          </div>
        </SourceQuote>

        <PageFigure
          src="/articles/what-the-bath-does-water-is-someone/clitumnus-piranesi.jpg"
          alt="Etching of a small classical temple with a columned front, overgrown with plants, standing on arched substructures among ruins."
          credit={<>The Metropolitan Museum of Art · CC0 · via <a href="https://commons.wikimedia.org/wiki/File:Plate_26-_Temple_of_Clitumnus_between_Foligno_and_Spoleto_._._._(Tempio_di_Clitumno_tra_Fuligno_e_Spoletti_._._.)_MET_DP827958.jpg">Wikimedia Commons</a></>}
        >
          Giovanni Battista Piranesi, <em>Temple of Clitumnus between Foligno and Spoleto</em>, plate 26, about 1748. Etching.
        </PageFigure>

        <VoiceHead level="h4">Tibet</VoiceHead>
        <SourceQuote
          book="rtsa-rgyud-gsang-ba-snying-po-zhes-bya-ba-ma-la-ya-i-dka-collection"
          page={61}
          src="https://images.sourcelibrary.org/pages/69e78a5b4a6785cfd60d3304/lf6af9036ca8876d52a9c092fc.jpg"
          source={<>Commentary on the medical Root Tantra, on hot springs (<em>chu tshan</em>), Bhutanese manuscript</>}
          pageAlt="The page of Rtsa rgyud gsang ba snying po zhes bya ba ma la ya'i dka' 'grel 'dod pa 'jo ba that this quotation is from (scan 61)"
        >
          <div className="space-y-3">
            <Orig lang="bo">འཇུག་དུས་ཆུ་བདག་མེ་ལྷ་དང་། །སྙུག་ མར་གནས་པའི་གཞི་བདག་ལ། །རང་རང་ལུགས་ལྟར་གཏོར་མ་འབུལ།</Orig>
            <p>&ldquo;at the time of entry, offer torma to the Water-Lord, the Fire-God, and the local spirits of the place according to their respective traditions. Furthermore, give appropriate offerings to the spirits behind the disease. Perform the declaration of truth.&rdquo;</p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">Puna, Hawaiʻi</VoiceHead>
        <SourceQuote
          book="unwritten-literature-of-hawaii-sacred-songs-of-the-hula-bilingual"
          page={260} printedPage="214"
          src="https://images.sourcelibrary.org/pages/69e00fdcc47b5c9f8821241b/0260.jpg"
          source={<>A hula chant to Pele, in N. B. Emerson, <em>Unwritten Literature of Hawaii</em>, p. 214, trans. Emerson</>}
          pageAlt="The page of Unwritten Literature of Hawaii: Sacred Songs of the Hula that this quotation is from (scan 260, printed page 214)"
        >
          <div className="space-y-3">
            <Orig lang="haw">Auau mehana i ka wai o ke Akua.</Orig>
            <p>&ldquo;Bathe in waters warmed by the goddess.&rdquo;</p>
            <p>Emerson&apos;s note on the grove named in the chant: &ldquo;A grove of milo trees that stood, as some affirm, about that natural basin of warm water in Puna, which the Hawaiians called Wai-wela-wela.&rdquo;</p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">The Ganga</VoiceHead>
        <SourceQuote
          book="padma-purana-thakura"
          page={467} printedPage="476"
          src="https://images.sourcelibrary.org/pages/6992d67146b85e738a0c4e59/0467.jpg"
          source={<><em>Padma Purāṇa</em>, Kriyāyogasāra ch. 4</>}
          pageAlt="The page of Padma Purana that this quotation is from (scan 467, printed page 476)"
        >
          <div className="space-y-3">
            <Orig lang="sa">দেবি জগদ্ধাত্রি পাদাজ্যং সলিলং তব। স্পৃশামীত্যপরাধং মে প্রসন্না ক্ষন্তুমর্হসি</Orig>
            <p>A pilgrim at the edge of the river: &ldquo;O Goddess Ganga, Mother of the World, I touch your water with my feet; please forgive my offense, O Gracious One.&rdquo;</p>
          </div>
        </SourceQuote>

        <PageFigure
          src="https://images.sourcelibrary.org/artwork/6af783274074f9777b9e80b4.jpg"
          alt="Painting on mica of a crowd of women in coloured saris at the edge of a river, some carrying baskets of offerings, with men and women bathing in the water below them."
          href="/book/people-bathing-and-praying-in-the-holy-river-ganga-gouache-painting-on"
          source={<>People bathing and praying in the holy river Ganga</>}
          credit={<>Wellcome Collection · Public Domain Mark</>}
        >
          Bathing and praying in the Ganga. Gouache painting on mica by an Indian artist, 19th century.
        </PageFigure>

        <div className="max-w-md mx-auto">
        <PageFigure
          src="/articles/what-the-bath-does-water-is-someone/roben-waterfall.jpg"
          alt="Woodblock print of a tall waterfall falling into a rocky pool, with nearly naked pilgrims standing in the water beneath it and inns along the bank."
          credit={<>Rijksmuseum, Amsterdam · CC0 · <a href="https://www.rijksmuseum.nl/en/collection/RP-P-1963-24">museum record</a></>}
        >
          Pilgrims purifying themselves under the Rōben waterfall at Ōyama, in Sagami. Hokusai, c. 1830. Colour woodblock print.
        </PageFigure>
        </div>

        <VoiceHead level="h4">Egypt</VoiceHead>
        <SourceQuote
          book="an-account-of-the-manners-and-customs-of-the-modern-lane"
          page={376} printedPage="350"
          src="https://images.sourcelibrary.org/pages/69907936b621b177c1af59d3/0376.jpg"
          source={<>E. W. Lane, <em>Modern Egyptians</em>, p. 350</>}
          pageAlt="The page of An Account of the Manners and Customs of the Modern Egyptians that this quotation is from (scan 376, printed page 350)"
        >
          <div className="space-y-3">
            <p>&ldquo;The bath is believed to be a favourite resort of ginn (or genii), and therefore when a person is about to enter it, he should offer up an ejaculatory prayer for protection against evil spirits, and should put his left foot first over the threshold. For the same reason he should not pray nor recite the Kur-án in it.&rdquo;</p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">Andrea Bacci</VoiceHead>
        <SourceQuote
          book="de-thermis-andreae-bacii-elipidani-libri-septem-opus-locupletissimum-n"
          page={276} printedPage="236"
          src="/articles/what-the-bath-does-water-is-someone/pages/6adedf3cbf12d2ef2054684b-276.jpg"
          source={<>Andrea Bacci, <em>De thermis</em> VI (ed. 1711), p. 236</>}
          pageAlt="The page of De thermis Andreae Bacii Elipidani ... libri septem : opus locupletissimum non solùm... that this quotation is from (scan 276, printed page 236)"
        >
          <div className="space-y-3">
            <Orig lang="la">Quo ritu multa observavi particularium fontium monumenta in antiquis, quum aut muneris vice, aut voto suscepto, sacraria, aras, tabulasque apud fontes consecrabant, quales hodie tabellæ, &amp; signa votiva in templis.</Orig>
            <p>The physician on the gifts left at springs: &ldquo;Following this custom, I have observed many monuments of particular springs among the ancients: whether as a gift or in fulfilment of a vow, they would dedicate shrines, altars and tablets at the springs, like the votive tablets and images found in churches today.&rdquo;</p>
          </div>
        </SourceQuote>

        <Section>Healing springs and the cure</Section>

        <PageFigure
          src="/articles/what-the-bath-does-spring-that-heals/bursa-yeni-kaplica.jpg"
          alt="Photograph of a domed bath hall at Bursa: a circular hot-spring pool under a masonry dome, men sitting around its rim and one bather in the water."
          credit={<>Wellcome Collection · Public Domain Mark · <a href="https://wellcomecollection.org/works/fst9tygy">museum record</a></>}
        >
          The bath of Suleiman the Magnificent (Yeni Kaplıca) at Bursa, a hall built over a hot spring, with men sitting around the circular pool. Photograph.
        </PageFigure>


        <H3>Iamblichus at Gadara</H3>

        <P>
          Eunapius, in his <em>Lives of the Philosophers</em>, tells this story of the philosopher Iamblichus on
          the word of Iamblichus&apos;s pupils. The pupils wanted him to show them some sign of his powers, and he told them to <Link href="/book/lives-of-the-sophists-philostratus-and-eunapius-eunapius?page=419">&ldquo;wait for the appointed hour.&rdquo;</Link> One
          summer they went with him to Gadara, <Link href="/book/lives-of-the-sophists-philostratus-and-eunapius-eunapius?page=419">&ldquo;a place which has warm baths in Syria, inferior only to those at Baiae in Italy&rdquo;</Link>.
          They were bathing together when they asked again. He smiled and said:
        </P>

        <SourceQuote
          book="lives-of-the-sophists-philostratus-and-eunapius-eunapius"
          page={419} printedPage="369"
          src="https://images.sourcelibrary.org/pages/69ad65cc75811c30866e1f80/0419.jpg"
          source={<>Eunapius, <em>Lives of the Philosophers</em>, trans. W. C. Wright (Loeb, 1922)</>}
          pageAlt="The page of Lives of the Sophists (Philostratus and Eunapius) that this quotation is from (scan 419, printed page 369)"
        >
          <div className="space-y-3">
            <p>&ldquo;It is irreverent to the gods to give you this demonstration, but for your sakes it shall be done.&rdquo;</p>
          </div>
        </SourceQuote>

        <P>
          He sent them to ask the local people what two of the smaller springs had been called in former times.
          They came back with the answer:
        </P>

        <SourceQuote
          book="lives-of-the-sophists-philostratus-and-eunapius-eunapius"
          page={418} printedPage="368"
          src="https://images.sourcelibrary.org/pages/69ad65cc75811c30866e1f80/0418.jpg"
          source={<>Eunapius, <em>Lives of the Philosophers</em>, trans. W. C. Wright (Loeb, 1922)</>}
          pageAlt="The page of Lives of the Sophists (Philostratus and Eunapius) that this quotation is from (scan 418, printed page 368)"
        >
          <div className="space-y-3">
            <Orig lang="grc">αὕτη μὲν Ἔρως καλεῖται, τῇ παρακειμένῃ δὲ Ἀντέρως ὄνομα.</Orig>
            <p><Link href="/book/lives-of-the-sophists-philostratus-and-eunapius-eunapius?page=419">&ldquo;There is no pretence about it, this spring is called Eros, and the name of the one next to it is Anteros.&rdquo;</Link></p>
          </div>
        </SourceQuote>

        <P>
          Sitting <Link href="/book/lives-of-the-sophists-philostratus-and-eunapius-eunapius?page=421">&ldquo;on the ledge of the spring where the overflow runs off&rdquo;</Link>, he
          touched the water and <Link href="/book/lives-of-the-sophists-philostratus-and-eunapius-eunapius?page=421">&ldquo;called forth a boy from the depth of the spring.&rdquo;</Link> At
          the next spring he called up a second.
        </P>

        <SourceQuote
          book="lives-of-the-sophists-philostratus-and-eunapius-eunapius"
          page={421} printedPage="371"
          src="https://images.sourcelibrary.org/pages/69ad65cc75811c30866e1f80/0421.jpg"
          source={<>Eunapius, <em>Lives of the Philosophers</em>, trans. W. C. Wright (Loeb, 1922)</>}
          pageAlt="The page of Lives of the Sophists (Philostratus and Eunapius) that this quotation is from (scan 421, printed page 371)"
        >
          <div className="space-y-3">
            <p>&ldquo;Both the boys embraced Iamblichus and clung to him as though he were genuinely their father. He restored them to their proper places and went away after his bath, reverenced by his pupils.&rdquo;</p>
          </div>
        </SourceQuote>

        <P>
          Eunapius adds: <Link href="/book/lives-of-the-sophists-philostratus-and-eunapius-eunapius?page=421">&ldquo;Nay even this I record not without hesitation, as being mere hearsay, except that I follow the lead of men who, though they distrusted other signs, were converted by the experience of the actual revelation.&rdquo;</Link>
        </P>

        <SourceNote>Eunapius, <em>Lives of the Philosophers</em>, trans. W. C. Wright (Loeb, 1922), pp. 367–371 · <Link href="/book/lives-of-the-sophists-philostratus-and-eunapius-eunapius?page=419">open the page</Link></SourceNote>

        <H3>Other healing springs</H3>

        <VoiceHead level="h4">Atami</VoiceHead>
        <SourceQuote
          book="atami-onsen-zuko"
          page={22}
          src="https://images.sourcelibrary.org/pages/6a1ed94509c2a0509ef9ebb6/0022.jpg"
          source={<>Stele of the Yuzen shrine, copied in Shirai, <em>Atami onsen zukō</em></>}
          pageAlt="The page of Atami Onsen zukō that this quotation is from (scan 22)"
        >
          <div className="space-y-3">
            <Orig lang="ja">相伝天平勝宝元年己丑正月 少彦名命神憑童曰浴於此者沈必愈果如其言後人建祠</Orig>
            <Gloss>It is handed down that in the first month of the first year of Tenpyō-shōhō the god Sukunahikona took possession of a child and said: whoever bathes here will surely be healed of lingering illness. It was as he said, and later people built a shrine.</Gloss>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">Tibet</VoiceHead>
        <SourceQuote
          book="rtsa-rgyud-gsang-ba-snying-po-zhes-bya-ba-ma-la-ya-i-dka-collection"
          page={49}
          src="https://images.sourcelibrary.org/pages/69e78a5b4a6785cfd60d3304/lf6af90369a8876d52a9c092f0.jpg"
          source={<>Commentary on the medical Root Tantra, on medicinal waters (<em>sman chu</em>), Bhutanese manuscript</>}
          pageAlt="The page of Rtsa rgyud gsang ba snying po zhes bya ba ma la ya'i dka' 'grel 'dod pa 'jo ba that this quotation is from (scan 49)"
        >
          <div className="space-y-3">
            <Orig lang="bo">སྙིང་རྗེ་ལྡན་བའི་འཚོ་བྱེད་ཀྱིས། ། སྨན་ཆུ་རྟགས་ལ་ཁ་བྱང་རྟེན་། །རྟེན་ཐབས་རྣམས་ཀྱང་ལེགས་པར་སྟོན་།</Orig>
            <p>&ldquo;A compassionate healer should mark the medicinal waters and provide labels for reliance, and also clearly show the methods of reliance.&rdquo;</p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">Andrea Bacci</VoiceHead>
        <SourceQuote
          book="de-thermis-andreae-bacii-elipidani-libri-septem-opus-locupletissimum-n"
          page={276} printedPage="236"
          src="/articles/what-the-bath-does-spring-that-heals/pages/6adedf3cbf12d2ef2054684b-276.jpg"
          source={<>Andrea Bacci, <em>De thermis</em> (ed. 1711), p. 236</>}
          pageAlt="The page of De thermis Andreae Bacii Elipidani ... libri septem : opus locupletissimum non solùm... that this quotation is from (scan 276, printed page 236)"
        >
          <div className="space-y-3">
            <Orig lang="la">balnea perinde sacram quandam Medicinam consulenda, ac ineunda esse</Orig>
            <p>To physicians and patients: &ldquo;baths are to be consulted and entered as a kind of sacred medicine. And we must piously believe that the wonderful and sometimes unhoped-for help that mortals feel in them is obtained not so much from the bath and the physician&apos;s skill as from divine grace.&rdquo;</p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">Holywell, Wales</VoiceHead>
        <SourceQuote
          book="a-tour-in-wales-mdcclxx-vol-1-pennant"
          page={56} printedPage="36"
          src="https://images.sourcelibrary.org/pages/69ee4efd6dd925d126f42665/0056.jpg"
          source={<>Thomas Pennant, <em>A Tour in Wales</em>, 1778, <Link href="/book/a-tour-in-wales-mdcclxx-vol-1-pennant?page=56">pp. 35–37</Link></>}
          pageAlt="The page of A Tour in Wales, MDCCLXX, Vol. 1 that this quotation is from (scan 56, printed page 36)"
        >
          <div className="space-y-3">
            <p>&ldquo;In the summer, still a few are to be seen in the water in deep devotion up to their chins for hours, sending up their prayers&rdquo;; over the well hang <Link href="/book/a-tour-in-wales-mdcclxx-vol-1-pennant?page=55">&ldquo;the votive crutches, the barrows, and other proofs of cures&rdquo;</Link>.</p>
            <p>Pennant&apos;s own view: <Link href="/book/a-tour-in-wales-mdcclxx-vol-1-pennant?page=57">&ldquo;The waters are indisputably endowed with every good quality attendant on cold baths&rdquo;</Link>.</p>
          </div>
        </SourceQuote>

        <div className="max-w-lg mx-auto">
        <PageFigure
          src="/articles/what-the-bath-does-spring-that-heals/holywell-interior.jpg"
          alt="Engraving of the vaulted well chamber at Holywell: a pool of water under a fan-vaulted canopy, with visitors in nineteenth-century dress standing around it."
          credit={<>Public domain · via <a href="https://commons.wikimedia.org/wiki/File:Interior_of_St._Winifred%27s_Well,_Holywell.jpeg">Wikimedia Commons</a></>}
        >
          <em>Interior of St. Winifred&apos;s Well, Holywell</em>. Engraving by J. Newman &amp; Co., published by P. M. Evans, Holywell, 1850s.
        </PageFigure>
        </div>

        <VoiceHead level="h4">Dawraq, Khuzistan</VoiceHead>
        <SourceQuote
          book="athar-al-bilad-cosmography-and-wonders-of-creation-al-qazvini"
          page={224}
          src="https://images.sourcelibrary.org/pages/69c1b7bd8522835be844902a/0224.jpg"
          source={<>Al-Qazwini, <em>Āthār al-bilād</em>, citing Umar al-Nasafi, manuscript</>}
          pageAlt="The page of Āthār al-bilād wa akhbār al-`ibād, by Zakariyya al-Qazvīnī (d. 1283) that this quotation is from (scan 224)"
        >
          <div className="space-y-3">
            <Orig lang="ar" dir="rtl">وتجتمع في حوضين احدهما للرجال والاخر للنساء</Orig>
            <p>The springs gather in two basins, one for men and one for women. &ldquo;If one sudden movement enters it briefly, they benefit from it. However, whoever lingers or swims in it will have their body burned and blistered.&rdquo;</p>
          </div>
        </SourceQuote>

        <H3>The cure at Atami</H3>

        <div className="max-w-md mx-auto">
        <PageFigure
          src="/articles/what-the-bath-does-spring-that-heals/sukayu.jpg"
          alt="Black and white photograph of a crowded hot-spring bath hall at Sukayu: men and women wash and soak together, one pouring water over another's shoulders."
          credit={<>J. Paul Getty Museum · Getty Open Content · <a href="https://www.getty.edu/art/collection/object/109E19">museum record</a></>}
        >
          Sukayu hot spring, Aomori Prefecture, 1957. Photograph.
        </PageFigure>
        </div>

        <P>Shirai&apos;s guide to the Atami spring sets the number of soaks a day by the bather&apos;s strength.</P>

        <SoaksChart />

        <SourceQuote
          book="atami-onsen-zuko"
          page={10}
          src="https://images.sourcelibrary.org/pages/6a1ed94509c2a0509ef9ebb6/0010.jpg"
          source={<>Shirai, <em>Atami onsen zukō</em></>}
          pageAlt="The page of Atami Onsen zukō that this quotation is from (scan 10)"
        >
          <div className="space-y-3">
            <Orig lang="ja">一凡入湯の法十人並の気力の人は一昼夜に四五度 強き生れの人は五六度虚弱の人又は病人は両三度いるへし惣して度にすぐれは却て害あり</Orig>
            <Gloss>As a rule for bathing: a person of ordinary strength should go in four or five times in a day and a night, one born strong five or six times, the weak or the sick two or three times. In general, more than this does harm.</Gloss>
          </div>
        </SourceQuote>

        <P>On the first soak, the guide has the bather warm the rim, sit with the feet in and scoop water onto the face before getting in. Then:</P>

        <SourceQuote
          book="atami-onsen-zuko"
          page={11}
          src="https://images.sourcelibrary.org/pages/6a1ed94509c2a0509ef9ebb6/0011.jpg"
          source={<>Shirai, <em>Atami onsen zukō</em></>}
          pageAlt="The page of Atami Onsen zukō that this quotation is from (scan 11)"
        >
          <div className="space-y-3">
            <Orig lang="ja">湯壺の中にて思慮する事なかれ気を和し心を平らかにして惣身に湯の気能微りたりとおもふ頃湯壺より上るべし</Orig>
            <Gloss>In the tub, do not brood. Keep the breath gentle and the heart level, and come out of the tub when you feel the heat of the water has gone well into the whole body.</Gloss>
          </div>
        </SourceQuote>

        <Section>Bathing together</Section>

        <PageFigure
          src="/articles/what-the-bath-does-held-by-others/public-bath-japan.jpg"
          alt="A Japanese woodblock triptych of a busy public bath: bathers wash with wooden buckets on a wooden floor, others soak beyond, and women in kimono sit at the attendant's raised desk on the right."
          credit={<>The Metropolitan Museum of Art, bequest of William S. Lieberman, 2005 · CC0 · <a href="https://www.metmuseum.org/art/collection/search/73578">museum record</a></>}
        >
          Interior of a public bath. Japanese triptych print, 19th century.
        </PageFigure>


        <H3>Hadrian and the veteran</H3>

        <P>The Life of Hadrian in the <em>Historia Augusta</em> says the emperor bathed in the public baths:</P>

        <SourceQuote
          book="scriptores-historiae-augustae-vol-i-loeb-augustae"
          page={94} printedPage="52"
          src="https://images.sourcelibrary.org/pages/69af4164b0838bf65cdffe93/0094.jpg"
          source={<><em>Historia Augusta</em>, <em>Hadrian</em> 17 (Loeb, 1921)</>}
          pageAlt="The page of Scriptores Historiae Augustae Vol. I (Loeb) that this quotation is from (scan 94, printed page 52)"
        >
          <div className="space-y-3">
            <Orig lang="la">publice frequenter et cum omnibus lavit. ex quo ille iocus balnearis innotuit</Orig>
            <p><Link href="/book/scriptores-historiae-augustae-vol-i-loeb-augustae?page=95">&ldquo;He often bathed in the public baths, even with the common crowd. And a jest of his made in the bath became famous.&rdquo;</Link></p>
          </div>
        </SourceQuote>

        <P>
          There he saw a veteran he had known in the service, rubbing his back and the rest of his body against the
          marble wall. Hadrian asked him why he had the marble rub him, and the man said it was because he did not own
          a slave. Hadrian <Link href="/book/scriptores-historiae-augustae-vol-i-loeb-augustae?page=95">&ldquo;presented him with some slaves and the cost of their maintenance.&rdquo;</Link>
        </P>

        <P><Link href="/book/scriptores-historiae-augustae-vol-i-loeb-augustae?page=95">&ldquo;But another time, when he saw a number of old men rubbing themselves against the wall for the purpose of arousing the generosity of the Emperor, he ordered them to be called out and then to rub one another in turn.&rdquo;</Link></P>

        <SourceNote><em>Historia Augusta</em>, <em>Hadrian</em> 17 (Loeb, 1921), pp. 52–53 · <Link href="/book/scriptores-historiae-augustae-vol-i-loeb-augustae?page=95">open the page</Link></SourceNote>

        <H3>Other shared baths</H3>

        <VoiceHead level="h4">Mandan villages</VoiceHead>
        <SourceQuote
          book="letters-and-notes-on-the-manners-customs-and-condition-of-the-north-am"
          page={163} printedPage="97"
          src="/articles/what-the-bath-does-held-by-others/pages/6af7a23c7619d28c2362a519-163.jpg"
          source={<>George Catlin, <em>Letters and Notes</em>, 1841, p. 97</>}
          pageAlt="The page of Letters and notes on the manners, customs, and condition of the North American... that this quotation is from (scan 163, printed page 97)"
        >
          <div className="space-y-3">
            <p>Their vapour baths, &ldquo;of which each village has several, and which seem to be a kind of public property—accessible to all, and resorted to by all, male and female, old and young, sick and well.&rdquo;</p>
          </div>
        </SourceQuote>

        <PageFigure
          src="https://images.sourcelibrary.org/artwork/6af789204074f9777b9e8230.jpg"
          alt="Painting of a hide lodge beside a stream: a man sits wrapped inside a wicker frame over hot stones while another lifts the cover, and a woman tends stones in a fire; earth lodges stand in the distance."
          href="/book/vapor-bath-minatarree"
          source={<>Source Library record</>}
          credit={<>National Gallery of Art, Washington · CC0</>}
        >
          George Catlin, <em>Vapor Bath, Minatarree</em>, 1861/1869. Oil on card mounted on paperboard.
        </PageFigure>

        <VoiceHead level="h4">Wendat (Huron) country</VoiceHead>
        <SourceQuote
          book="le-grand-voyage-du-pays-des-hurons"
          page={295} printedPage="271"
          src="https://images.sourcelibrary.org/pages/6adf00f6bf12d2ef205600f9/0295.jpg"
          source={<>Gabriel Sagard, <em>Le grand voyage du Pays des Hurons</em>, pp. 271–272</>}
          pageAlt="The page of Le grand voyage du Pays des Hurons that this quotation is from (scan 295, printed page 271)"
        >
          <div className="space-y-3">
            <Orig lang="fr">qui eſt le remede le plus propre &amp; le plus co[m]mun qu&apos;ils ayent</Orig>
            <p>For a sweat, &ldquo;he calls several of his friends to sweat with him, for he could not easily do it alone.&rdquo; Inside, <Link href="/book/le-grand-voyage-du-pays-des-hurons?page=296">&ldquo;one of them sings, and the others continually utter and repeat with force and vehemence, as in their dances, &quot;Het, het, het!&quot;&rdquo;</Link></p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">A women&apos;s bath</VoiceHead>
        <SourceQuote
          book="letters-of-the-right-honourable-lady-m-y-w-y-m-e-written-during-her-tr-2"
          page={183} printedPage="160"
          src="/articles/what-the-bath-does-held-by-others/pages/6af7813efab7e42f9a3085dc-183.jpg"
          source={<>Lady Mary Wortley Montagu, <em>Letters</em>, 1763, pp. 160, 163</>}
          pageAlt="The page of Letters of the Right Honourable Lady M--y W----y M----e: written during her travels in... that this quotation is from (scan 183, printed page 160)"
        >
          <div className="space-y-3">
            <p>She came in her &ldquo;travelling habit, which is a riding dress&rdquo;, among, she believed, &ldquo;two hundred women&rdquo;: &ldquo;Yet there was not one of them that shewed the least surprize or impertinent curiosity, but received me with all the obliging civility possible.&rdquo;</p>
            <p><Link href="/book/letters-of-the-right-honourable-lady-m-y-w-y-m-e-written-during-her-tr-2?page=186">&ldquo;In ſhort, &apos;tis the women&apos;s coffee-houſe, where all the news of the town is told, ſcandal invented, &amp;c.&rdquo;</Link></p>
          </div>
        </SourceQuote>

        <div className="max-w-md mx-auto">
        <PageFigure
          src="https://images.sourcelibrary.org/artwork/6af785764074f9777b9e8129.jpg"
          alt="Etching of a domed bath hall: a woman in a riding coat and hat stands at the left among seated and reclining bathers, one of whom plays a lyre."
          href="/book/lady-montagu-in-het-badhuis"
          source={<><em>Lady Montagu in het badhuis</em></>}
          credit={<>Rijksmuseum, Amsterdam · CC0</>}
        >
          Lady Mary Wortley Montagu in the bath-house, in her riding dress. Print, 1781.
        </PageFigure>
        </div>

        <VoiceHead level="h4">A Sufi lodge</VoiceHead>
        <SourceQuote
          book="kashf-al-mahjub-persian-critical-edition-zhukovsky"
          page={455}
          src="https://images.sourcelibrary.org/pages/69935b208e28d8f4c5d3c445/0455.jpg"
          source={<>Al-Hujwiri, <em>Kashf al-mahjub</em>, <Link href="/book/kashf-al-mahjub-persian-critical-edition-zhukovsky?page=455">pp. 425–426</Link></>}
          pageAlt="The page of Kashf al-Mahjub that this quotation is from (scan 455)"
        >
          <div className="space-y-3">
            <p>On receiving a travelling dervish: &ldquo;The next day, he should offer him a bath, take him to the cleanest bathhouse, guard his clothes from the grime of the bathhouse&rdquo;</p>
            <Orig lang="fa" dir="rtl"><Link href="/book/kashf-al-mahjub-persian-critical-edition-zhukovsky?page=456">وی بخارد و زانوها و کف پای و دستش بمالد و بیشتر ازین شرط نیست</Link></Orig>
            <p><Link href="/book/kashf-al-mahjub-persian-critical-edition-zhukovsky?page=456">&ldquo;It is necessary that he scrubs his back and rubs his knees, the soles of his feet, and his hands. There is no condition beyond this.&rdquo;</Link></p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">Rome</VoiceHead>
        <SourceQuote
          book="plutarchi-vitae-parallelae-plutarch"
          page={429} printedPage="416"
          src="https://images.sourcelibrary.org/pages/6993777cb0a84a5763963d92/0429.jpg"
          source={<>Plutarch, <em>Cato the Elder</em> 20</>}
          pageAlt="The page of Parallel Lives that this quotation is from (scan 429, printed page 416)"
        >
          <div className="space-y-3">
            <Orig lang="grc">συλλούσασθαι δὲ μηδέποτε.</Orig>
            <p>Of Cato: &ldquo;He never bathed with his son. (9) This seems to have been a common Roman custom. Sons-in-law were careful not to bathe with their fathers-in-law. They felt shame at the exposure and nakedness of the body.&rdquo;</p>
          </div>
        </SourceQuote>

        <H3>How a shared bath was divided</H3>

        <div className="max-w-md mx-auto">
        <PageFigure
          src="/articles/what-the-bath-does-held-by-others/persian-bath.jpg"
          alt="Persian manuscript painting of a bathhouse shown room by room: an entrance with an attendant, a changing area, and a hot room where bathers sit on a patterned floor while attendants wash them."
          credit={<>Wellcome Collection · CC BY 4.0 · <a href="https://wellcomecollection.org/works/n8hbercr">museum record</a></>}
        >
          Interior of a Persian bathing establishment: entrance, changing room and hot room, with attendants at work. Manuscript painting.
        </PageFigure>
        </div>

        <SharingPlans />

        <VoiceHead level="h4">Cairo</VoiceHead>
        <SourceQuote
          book="al-mawaiz-wa-al-itibar-bi-dhikr-al-khitat-wa-al-athar-khitat-ahmad-ibn"
          page={86}
          src="https://images.sourcelibrary.org/pages/6a477ce51874da9b1a9a5552/0086.jpg"
          source={<>Al-Maqrizi, <em>Khitat</em>, quoting Ibn ʿAbd al-Ẓāhir</>}
          pageAlt="The page of المواعظ والاعتبار بذكر الخطط والآثار that this quotation is from (scan 86)"
        >
          <div className="space-y-3">
            <Orig lang="ar" dir="rtl">وكانت إحداهما برسم الرجال والأخرى برسم النساء</Orig>
            <p>Of a pair of baths: &ldquo;One was for men and the other for women.&rdquo; Of another, it was <Link href="/book/al-mawaiz-wa-al-itibar-bi-dhikr-al-khitat-wa-al-athar-khitat-ahmad-ibn?page=87">&ldquo;a bathhouse that the general public of men enter in the early part of the day, then women follow them after that&rdquo;</Link>.</p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">Astrakhan</VoiceHead>
        <SourceQuote
          book="vermehrte-newe-beschreibung-der-muscowitischen-und-persischen-reyse-ad"
          page={282} printedPage="208"
          src="/articles/what-the-bath-does-held-by-others/pages/6af784e922f1cd27a32c1c85-282.jpg"
          source={<>Adam Olearius, <em>Travels</em>, 1656, p. 208</>}
          pageAlt="The page of Vermehrte Newe Beschreibung der Muscowitischen und Persischen Reyse that this quotation is from (scan 282, printed page 208)"
        >
          <div className="space-y-3">
            <p>&ldquo;The bath-house was indeed partitioned with wooden boards so that men and women could sit separately. Yet they went in and out through one door, and that without aprons.&rdquo;</p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">Laimnau</VoiceHead>
        <SourceQuote
          book="beschreibung-von-gelegenheit-mineralien-aigenschafft-krafft-grubenmann"
          page={17} printedPage="5"
          src="https://images.sourcelibrary.org/pages/6a49294bf7e0eb87cd01a8fe/0017.jpg"
          source={<>Laurentius Grubenmann, bath ordinance, 1656, p. 5</>}
          pageAlt="The page of Grubenmann, Laurentius: Beschreibung ... des ... Laimenauer Badwassers that this quotation is from (scan 17, printed page 5)"
        >
          <div className="space-y-3">
            <Orig lang="de">VII. Es solle auch kein Badgast den Andern / auß seinem eingegebnen Gemach / Zuber vnd Platz / so er badens halber bestelt / vertreiben.</Orig>
            <p>&ldquo;VII. Likewise, no bath guest shall drive another out of their assigned room, tub, and place that they ordered for the purpose of bathing.&rdquo;</p>
          </div>
        </SourceQuote>

        <Section>Physicians on hot springs</Section>



        <H3>Testing the springs</H3>

        <P>
          The <em>Taixi shuifa</em> (&ldquo;Western Hydraulics&rdquo;), by Sabatino de Ursis and Xu Guangqi, printed in
          1612, tells this story without naming the country, the place or the ruler.
        </P>

        <P>
          In a great province of the West there were dozens of hot springs, and a ruler wanted to know what each was
          good for. He had famous physicians try the springs again and again on convicted prisoners who had the
          matching illnesses, and then fix a regimen for each: which illnesses it served, whether it was for steaming,
          bathing or drinking, and which herbs to add. Steam-rooms, basins and pools were built.
        </P>

        <SourceQuote
          book="western-hydraulics-vols-4-6"
          page={12}
          src="https://images.sourcelibrary.org/pages/69c6611f01a26ccff09f4e17/0012.jpg"
          source={<><em>Taixi shuifa</em>, vols. 4–6, on hot springs</>}
          pageAlt="The page of Western Hydraulics (泰西水法) Vols. 4-6 that this quotation is from (scan 12)"
        >
          <div className="space-y-3">
            <Orig lang="lzh">刊刻石碑詳著方法樹之本所</Orig>
            <p>&ldquo;They carved stone stelae detailing the methods and erected them at the springs.&rdquo;</p>
          </div>
        </SourceQuote>

        <P>The authors add that if the springs of China were tested in the same way, many of the sick would be saved.</P>

        <SourceNote><em>Taixi shuifa</em>, vols. 4–6, p. 12 · <Link href="/book/western-hydraulics-vols-4-6?page=12">open the page</Link></SourceNote>

        <H3>What heats a spring</H3>

        <VoiceHead level="h4">Seneca</VoiceHead>
        <SourceQuote
          book="physical-science-in-the-time-of-nero-naturales-quaestiones-clarke"
          page={196} printedPage="136"
          src="https://images.sourcelibrary.org/pages/69afec7b5b98061872aba010/0196.jpg"
          source={<>Seneca, <em>Natural Questions</em> III, trans. John Clarke, p. 136</>}
          pageAlt="The page of Physical Science in the Time of Nero: Naturales Quaestiones that this quotation is from (scan 196, printed page 136)"
        >
          <div className="space-y-3">
            <p>&ldquo;Empedocles is of opinion that as there are fires concealed in many places beneath the earth, water is heated when they happen to lie beneath the ground through which it has to flow.&rdquo; Like water run through coiled pipes over a fire, &ldquo;so, entering as cold it comes out hot.&rdquo;</p>
            <p>&ldquo;Others, again, suppose that the water contracts heat by issuing from or passing through ground charged with sulphur&rdquo;.</p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">A Song encyclopedia</VoiceHead>
        <SourceQuote
          book="vol-3-39"
          page={97}
          src="https://images.sourcelibrary.org/pages/6a3c61e940c88a541d8f0e76/0097.jpg"
          source={<>A Song encyclopedia, quoting the <em>Liu tie</em>, the <em>Bowu zhi</em> and Tang Zixi, pp. 96–97</>}
          pageAlt="The page of Combined Collection of Categorized Essentials from Ancient and Modern Times, Former... that this quotation is from (scan 97)"
        >
          <div className="space-y-3">
            <Orig lang="lzh">合水火之德澤浸萬人陪藥石之功蠲除六疾</Orig>
            <p>The <em>Liu tie</em>: &ldquo;It combines the virtues of water and fire to benefit ten thousand people. Assisting the power of medicinal minerals, it eliminates the six types of illnesses.&rdquo;</p>
            <Orig lang="lzh">石硫黃其泉則溫或云神人所暖</Orig>
            <p>The <em>Bowu zhi</em>: &ldquo;Sulfur makes the spring warm, or it is said that divine beings heat it.&rdquo;</p>
            <Orig lang="lzh">湯泉在天地間自為一類受性本然不必有待然後溫也</Orig>
            <p>Tang Zixi, on the hot springs of Huizhou: &ldquo;Hot springs form their own unique category between heaven and earth. Their nature is inherently warm and does not rely on external factors to become so.&rdquo; Hot and cold can rise a few feet apart; &ldquo;This is proven by the fact that the same mouth can blow breath that is cold and exhale breath that is warm.&rdquo;</p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">Li Shizhen</VoiceHead>
        <SourceQuote
          book="compendium-of-materia-medica-volumes-5-6"
          page={44}
          src="https://images.sourcelibrary.org/pages/6992cd8143713c66ea636f0c/0044.jpg"
          source={<>Li Shizhen, <em>Bencao gangmu</em>, under &quot;warm water&quot; (溫湯), 1596, pp. 44–45 (而不熱 as read from the scan)</>}
          pageAlt="The page of Compendium of Materia Medica, Volumes 5-6 that this quotation is from (scan 44)"
        >
          <div className="space-y-3">
            <Orig lang="lzh">下有硫黃即令水熱</Orig>
            <p>Quoting Chen Cangqi: &ldquo;When there is sulfur underneath, it makes the water hot, and it still carries a sulfurous odor. Sulfur treats various sores, so this water is also suited to that purpose.&rdquo;</p>
            <p>Citing Hu Zai (the page does not mark where Hu Zai stops and Li begins): Mount Huang alone has a red &quot;cinnabar spring&quot;, good for brewing tea; and</p>
            <Orig lang="lzh"><Link href="/book/compendium-of-materia-medica-volumes-5-6?page=45">硃砂泉雖紅而不熱</Link></Orig>
            <Gloss>The cinnabar spring, though red, is not hot.</Gloss>
            <Orig lang="lzh"><Link href="/book/compendium-of-materia-medica-volumes-5-6?page=45">有砒石處亦有湯泉浴之有毒</Link></Orig>
            <p><Link href="/book/compendium-of-materia-medica-volumes-5-6?page=45">&ldquo;Where arsenic stone is found, there are also hot springs; bathing in them is poisonous.&rdquo;</Link></p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">Qin Guan</VoiceHead>
        <P>
          A Ming encyclopedia quotes the poet Qin Guan&apos;s rhapsody on a hot spring. By a river, an old countryman told
          him the spring was warm without fire, and that was why it was called a warm spring. Qin Guan asks what
          heats it.
        </P>
        <SourceQuote
          book="vol-10-18"
          page={100}
          src="https://images.sourcelibrary.org/pages/6a3c67ffaf3c49b59c5d5658/0100.jpg"
          source={<>Qin Guan, rhapsody on the hot spring, quoted in the <em>Shantang sikao</em>, pp. 100–101</>}
          pageAlt="The page of Fourfold Examinations of the Mountain Hall, juan 22–23 (vol 10) that this quotation is from (scan 100)"
        >
          <div className="space-y-3">
            <Orig lang="lzh">不火而燠其名溫泉</Orig>
            <Gloss>Warm without fire: its name is the warm spring.</Gloss>
            <Orig lang="lzh">豈非熒惑蒞於上耶燭龍隱於中耶</Orig>
            <Gloss>Is it not Mars presiding above? The Candle Dragon hidden within?</Gloss>
            <p>Or a channel to the pool the sun&apos;s chariot passes, or hidden spirits rewarding it, or</p>
            <Orig lang="lzh">丹砂黃硫金石之氣</Orig>
            <Gloss>the vapours of cinnabar, sulphur, metal and stone</Gloss>
          </div>
        </SourceQuote>
        <P>The encyclopedia&apos;s excerpt ends there, without an answer.</P>


        <H3>How to bathe</H3>

        <VoiceHead level="h4">Maimonides</VoiceHead>
        <SourceQuote
          book="tractatus-rabbi-moysi-de-regimine-sanitatis-ad-soldanum-maimonides"
          page={25}
          src="https://images.sourcelibrary.org/pages/6a425f91744db9e3105a6559/0025.jpg"
          source={<>Maimonides, regimen of health for the sultan, Latin translation</>}
          pageAlt="The page of Treatise on the Regimen of Health for the Sultan that this quotation is from (scan 25)"
        >
          <div className="space-y-3">
            <Orig lang="la">Postea minuat de caliditate aque paulatim, ita quod ultimo abluat cum aqua</Orig>
            <p>Sweat first. &ldquo;Afterwards he should diminish the heat of the water little by little, so that finally he washes with lukewarm water.&rdquo; &ldquo;he should enter and not linger, but bathe and exit&rdquo;. &ldquo;To sleep, however, after exiting the bath is very useful.&rdquo; But, after Galen, &ldquo;but sleep in the bath is the worst&rdquo;.</p>
          </div>
        </SourceQuote>

        <div className="max-w-md mx-auto">
        <PageFigure
          src="/articles/what-the-bath-does-doctors-of-water/pfaefers-merian.jpg"
          alt="Engraving of a deep wooded gorge with steep rock walls, bath-houses built at the bottom beside the stream and steam rising from the spring chamber."
          href="/book/topographia-helvetiae-rhaetiae-et-valesiae-das-ist-merian?page=133"
          source={<>Matthäus Merian, <em>Topographia Helvetiae</em> (1654)</>}
        >
          The bath at Pfäfers in its gorge. Matthäus Merian, <em>Topographia Helvetiae</em>, 1654. Engraving.
        </PageFigure>
        </div>

        <VoiceHead level="h4">Paracelsus</VoiceHead>
        <SourceQuote
          book="erster-zehender-theil-der-bucher-und-schrifften-des-edlen-huser"
          page={2491} printedPage="340"
          src="https://images.sourcelibrary.org/pages/69bd9d546120d54bd0375241/2491.jpg"
          source={<>Paracelsus, <em>Vom Bad Pfeffers</em> and <em>Von natürlichen Bädern</em>, collected works, 1589, pp. 301–340</>}
          pageAlt="The page of Books and Writings of Philippus Theophrastus Bombast von Hohenheim, Parts 1–10 that this quotation is from (scan 2491, printed page 340)"
        >
          <div className="space-y-3">
            <Orig lang="de">Das Bad regiert nach seinem willen.</Orig>
            <p>No fixed hours can be set: &ldquo;The bath governs according to its own will.&rdquo; For the rest, ask those who run the bath, &ldquo;for daily experience surpasses the advice found in books&rdquo;.</p>
            <p>The course follows the illness: <Link href="/book/erster-zehender-theil-der-bucher-und-schrifften-des-edlen-huser?page=2487">&ldquo;Some diseases end in nine or ten days, some in twelve or fifteen days&rdquo;</Link>. Many springs are heated by a hidden watercourse running through minerals inside the mountains, and <Link href="/book/erster-zehender-theil-der-bucher-und-schrifften-des-edlen-huser?page=2452">&ldquo;the waters do not come as hot as they are born&rdquo;</Link>.</p>
          </div>
        </SourceQuote>

        <div className="max-w-md mx-auto">
        <PageFigure
          src="https://images.sourcelibrary.org/artwork/6af7a8f05cc7d6f335669dd5.jpg"
          alt="Print of a narrow rock gorge with steam rising, a wooden walkway along the rock and small figures walking on it towards the spring."
          href="/book/pfeffers-bad-quelle"
          source={<><em>Pfeffers Bad Quelle</em></>}
          credit={<>Rijksmuseum, Amsterdam · CC0</>}
        >
          The way to the spring of the Pfäfers bath. Print, dated by the Rijksmuseum between 1824 and 1889.
        </PageFigure>
        </div>

        <VoiceHead level="h4">Paracelsus on St. Moritz</VoiceHead>
        <SourceQuote
          book="aureoli-philippi-theophrasti-bombasts-von-hohenheim-paracelsus-3"
          page={367}
          src="https://images.sourcelibrary.org/pages/69b51db6efd8df28f2da96e3/0367.jpg"
          source={<>Paracelsus, on tartaric diseases, <em>Opera</em> (1616), p. 209</>}
          pageAlt="The page of The Collected Books and Writings of the Noble and Highly Learned Philosopher and... that this quotation is from (scan 367)"
        >
          <div className="space-y-3">
            <Orig lang="de">Aber ein acetosum fontale, daß ich für alle/ so in Europa erfahren hab/ preiß/ ist in Egendin zu Sanct Mauriz</Orig>
            <p>Of all the acid springs he had tried in Europe, the one at St. Moritz, which runs sourest in August. Whoever drinks it as a medicine &ldquo;he knows no gout, no arthritis&rdquo;: it strengthens the stomach to digest the tartar &ldquo;as an ostrich digests iron&rdquo;.</p>
          </div>
        </SourceQuote>

        <div className="max-w-md mx-auto">
        <PageFigure
          src="/articles/what-the-bath-does-doctors-of-water/st-moritz.jpg"
          alt="Sepia photograph of long spa buildings on a valley floor at St. Moritz, below a dark forested slope and a bare mountain."
          credit={<>J. Paul Getty Museum · Getty Open Content (no copyright) · <a href="https://www.getty.edu/art/collection/object/106Y4F">museum record</a></>}
        >
          The baths of St. Moritz in the Engadin. One half of a stereograph by Aimé Civiale, 1870s (albumen silver print).
        </PageFigure>
        </div>

        <VoiceHead level="h4">Caraka</VoiceHead>
        <SourceQuote
          book="caraka-samhita-charaka"
          page={114}
          src="https://images.sourcelibrary.org/pages/69e80670fdad300064d9ef9d/0114.jpg"
          source={<>Caraka, <em>Caraka Saṃhitā</em>, Sūtrasthāna 5 and 14</>}
          pageAlt="The page of Charaka Samhita that this quotation is from (scan 114)"
        >
          <div className="space-y-3">
            <Orig lang="sa">पवित्रं वृष्यमायुष्यं श्रमस्वेदमलापहम् । शरीरबलसन्धानं स्नानमोजस्करं परम्</Orig>
            <p>&ldquo;Bathing is purifying, virilizing, promotes longevity, removes fatigue, sweat, and impurities; it binds the strength of the body and is an excellent enhancer of vitality.&rdquo;</p>
            <p>The sweat-house (<em>jentāka</em>) beside a pond: <Link href="/book/caraka-samhita-charaka?page=169">&ldquo;It should face east or north, be sixteen cubits in dimension, circular, well-plastered, and with many windows.&rdquo;</Link> <Link href="/book/caraka-samhita-charaka?page=169">&ldquo;In the center of this house, a clay furnace, shaped like a bell with many small holes, should be built to hold charcoal.&rdquo;</Link> At the door the physician says, <Link href="/book/caraka-samhita-charaka?page=169">&ldquo;Enter with peace for your health.&rdquo;</Link></p>
          </div>
        </SourceQuote>

        <Section>Baths and inspiration</Section>

        <PageFigure
          src="/articles/what-the-bath-does-where-insight-comes/archimedes-tub.jpg"
          alt="Woodcut of a man sitting in a large wooden tub in a vaulted room, with vessels and balls on the floor labelled with letters, under a heading about Archimedes' discovery."
          href="/book/di-lucio-vitruvio-pollione-de-architectura-libri-dece-1521-cesariano?page=310"
          source={<><em>Di Lucio Vitruvio Pollione De architectura</em> (Como, 1521)</>}
        >
          Archimedes in his tub, with the vessels of his test. Woodcut in an Italian edition of Vitruvius, 1521.
        </PageFigure>


        <H3>Archimedes in the tub</H3>

        <P>
          Vitruvius tells the story in the preface to the ninth of his books on architecture. King Hiero had given a
          goldsmith gold for a crown, and suspected him of keeping some of it back. He asked Archimedes to find out.
          Archimedes was thinking about it when he went to a bath.
        </P>

        <SourceQuote
          book="vitruvius-on-architecture-third-copy-vitruvius"
          page={282}
          src="https://images.sourcelibrary.org/pages/69b52c9f3dd6d94230281710/0282.jpg"
          source={<>Vitruvius, <em>De architectura</em> IX, preface</>}
          pageAlt="The page of Vitruvius, On Architecture (third copy) that this quotation is from (scan 282)"
        >
          <div className="space-y-3">
            <Orig lang="la">casu uenit in balneum ibiqz cum in solium descenderet animaduertit quantu corporis sui in eo insideret tantum aquę extra solium effluere.</Orig>
            <p>&ldquo;he happened to go to a bath, and there, as he was descending into the tub, he observed that just as much of his body sat in it, so much water flowed out of the tub.&rdquo;</p>
          </div>
        </SourceQuote>

        <P>
          He <Link href="/book/vitruvius-on-architecture-third-copy-vitruvius?page=282">&ldquo;leaped from the tub and, going home naked, signified with a loud voice that he had found what he was seeking.&rdquo;</Link> Vitruvius
          adds that he shouted it in Greek.
        </P>

        <SourceNote>Vitruvius, <em>De architectura</em> IX, preface · <Link href="/book/vitruvius-on-architecture-third-copy-vitruvius?page=282">open the page</Link></SourceNote>

        <H3>Other baths</H3>

        <VoiceHead level="h4">Ibn Sina in a bathhouse</VoiceHead>
        <SourceQuote
          book="aja-ib-al-makhluqat-ms-nn-3-74-al-qazwini"
          page={105} printedPage="52r"
          src="https://images.sourcelibrary.org/pages/69907bdc5f855ec553e7177b/0105.jpg"
          source={<>Al-Qazwini, <em>Wonders of Creation</em> (Persian), on the rainbow, fol. 52r</>}
          pageAlt="The page of ʻAjāʼib al-makhlūqāt (MS Nn.3.74) that this quotation is from (scan 105, printed page 52r)"
        >
          <div className="space-y-3">
            <Orig lang="fa" dir="rtl">در حمام قوس و قزح دیدم نه بر سبیل خیال بلکه بر طریق حقیقت</Orig>
            <p>Ibn Sina: &ldquo;I saw a rainbow in a bathhouse, not as a hallucination, but by way of reality&rdquo;</p>
            <Orig lang="fa" dir="rtl">بسبب این وقوع ضوء شمع بود چون بر زجاج حمام افتاده بود</Orig>
            <p>Qāḍī ʿUmar ibn Sahlān explained it: &ldquo;this was because of the falling of a candle&apos;s light when it fell upon the glass of the bathhouse&rdquo;, and its reflection falling within the bathhouse.</p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">The river Nairañjanā</VoiceHead>
        <SourceQuote
          book="neyphug-kanjur-mdo-sde-kha-monastery"
          page={212}
          src="https://images.sourcelibrary.org/pages/69e7ab9a5f1a22ab19a9ab63/0212.jpg"
          source={<>The <em>Lalitavistara</em>, Tibetan Kanjur</>}
          pageAlt="The page of Neyphug Kanjur mDo sde Kha that this quotation is from (scan 212)"
        >
          <div className="space-y-3">
            <Orig lang="bo">དགེ་སློང་དག་དེ་ལྟར་བྱང་ཆུབ་སེམས་དཔའ་ཀླུང་ནཻ་རཉྫ་ནར་ཁྲུས་བྱས་ཏེ་ཟས་ཟོས་ནས།</Orig>
            <p>Before the night of his awakening: &ldquo;O Monks, thus the Bodhisattva, having bathed in the river Nairanjana and eaten the food, increased his physical strength.&rdquo; Then he set out for the Bodhi tree.</p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">Descartes, in Germany</VoiceHead>
        <SourceQuote
          book="discourse-on-the-method-and-metaphysical-meditations-descartes"
          page={17} printedPage="9"
          src="https://images.sourcelibrary.org/pages/6953e51c77f38f6761befc93/0017.jpg"
          source={<>René Descartes, <em>Discours de la méthode</em>, part II, p. 9</>}
          pageAlt="The page of Discourse on the Method and Metaphysical Meditations that this quotation is from (scan 17, printed page 9)"
        >
          <div className="space-y-3">
            <Orig lang="fr">je demeurais tout le jour enfermé seul dans un poêle où j’avais tout loisir de m’entretenir de mes pensées</Orig>
            <p>With no conversation and no cares to trouble him, &ldquo;I remained all day long shut up alone in a stove-heated room where I had full leisure to converse with my own thoughts&rdquo;. One of the first of those thoughts was that work made by one master is often more perfect than work pieced together by many.</p>
          </div>
        </SourceQuote>

        <VoiceHead level="h4">Navajo country</VoiceHead>
        <SourceQuote
          book="the-mountain-chant-a-navajo-ceremony-matthews"
          page={18} printedPage="390"
          src="https://images.sourcelibrary.org/pages/699249a2a2d53df4853bdc70/0018.jpg"
          source={<>The Mountain Chant myth, recorded by Washington Matthews, pp. 389–390</>}
          pageAlt="The page of The Mountain Chant that this quotation is from (scan 18, printed page 390)"
        >
          <div className="space-y-3">
            <p>An old man has his sons build a sweat-house. &ldquo;In this way they sweated themselves four times, keeping all the time a perfect silence&rdquo;. They wash, set their traps and sleep with their heads to the east. In the morning: &ldquo;Younger brother, I had a dream in the night; I dreamt I killed a buck deer.&rdquo; The younger brother dreamt of a doe; that day each kills the deer he dreamt of.</p>
          </div>
        </SourceQuote>

        <PageFigure
          src="/articles/what-the-bath-does-where-insight-comes/sweat-lodge.jpg"
          alt="Drawing of a dome-shaped sweat lodge covered with hides on open ground, the bare willow frame of another lodge beside it, tipis and a standing figure behind."
          href="/book/the-ghost-dance-religion-and-the-sioux-outbreak-of-1890-mooney?page=428"
          source={<>James Mooney, <em>The Ghost-Dance Religion</em> (1896)</>}
        >
          A Kiowa sweat lodge on the Washita, with the bare frame of another beside it. Drawing by Mary Irvin Wright, pl. CXXI in James Mooney, <em>The Ghost-Dance Religion</em>, 1896.
        </PageFigure>

        <VoiceHead level="h4">Delphi</VoiceHead>
        <SourceQuote
          book="bodleian-library-ms-barocci-74-magister"
          page={304}
          src="https://images.sourcelibrary.org/pages/69938a93e07f979c72ac681b/0304.jpg"
          source={<>A Byzantine commentary on Euripides&apos; <em>Phoenissae</em> (the Greek is damaged here)</>}
          pageAlt="The page of Commentaries on Euripides, Aeschylus, and Aristophanes that this quotation is from (scan 304)"
        >
          <div className="space-y-3">
            <Orig lang="grc">αἵ τινες ἔλεγον θεοπρόποι ἤτοι μαντικὰ ᾄδειν περὶ τῆς κασταλίας ὕδωρ λαβοῦσαι</Orig>
            <p>Of the temple&apos;s women servants: &ldquo;These women were called messengers of the gods, who sang prophetic songs after taking water from the Castalian spring, or before receiving the water—having tasted the drink&rdquo;.</p>
          </div>
        </SourceQuote>

        <PageFigure
          src="https://images.sourcelibrary.org/artwork/art-kastalian-spring.jpg"
          alt="Coloured print of a rocky gorge with water running from a stone-cut basin into a stream, votive niches in the cliff, a small stone building and two seated figures."
          href="/book/kastalian-spring"
          source={<>Kastalian Spring (1821)</>}
          credit={<>Wikimedia Commons · CC0</>}
        >
          The Castalian spring at Delphi. Coloured print, 1821.
        </PageFigure>

        <VoiceHead level="h4">The alchemists</VoiceHead>
        <SourceQuote
          book="viridarium-chymicum-figuris-cupro-incisis-adornatum-et-stoltzius-von-2"
          page={24}
          src="https://images.sourcelibrary.org/pages/69bd9e78f6d63c919747b0a7/0024.jpg"
          source={<>Stoltzius, <em>Viridarium chymicum</em>, on the Second Key of Basil Valentine; Rainsford&apos;s dictionary, 1798, p. 172</>}
          pageAlt="The page of The Chemical Garden, Adorned with Copperplate Figures and Illustrated with Poetic Pictures that this quotation is from (scan 24)"
        >
          <div className="space-y-3">
            <Orig lang="la">Sponsæ ex athletis pretiosa sit unda duobus, Pro Sponso proprium corpus ut illa lavet.</Orig>
            <p>&ldquo;Let there be precious water from the two athletes for the bride, So that she may wash her own body for the sake of the groom.&rdquo;</p>
            <p>Rainsford&apos;s dictionary explains the image, citing Synesius: <Link href="/book/a-mytho-hermetic-dictionary-1798-rainsford?page=200">&ldquo;Observe that Calcining, Tinging, Washing, Whitening &amp; bathing are One &amp; the same Thing, &amp; mean only Digesting the Matter to Perfection.&rdquo;</Link></p>
          </div>
        </SourceQuote>
      </article>
    </ContentPageLayout>
  );
}
