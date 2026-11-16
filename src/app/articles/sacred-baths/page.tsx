import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';
import ContextNote from '@/components/articles/ContextNote';
import PageEditMode from '@/components/PageEditMode';

const LEAD_IMAGE = '/articles/sacred-baths/tudela-temazcal.jpg';
const LEAD_ALT =
  'Painting from the Codex Tudela (Mexico, about 1553): a temazcal, a domed sweat house with a face above its door and flames at the stoke-hole, a man feeding the fire, and three seated figures below';

export const metadata: Metadata = withArticleMeta('sacred-baths', {
  title: 'Sacred Baths - Articles - Source Library',
  description:
    'What people sought in the bath, from the Nahua sweat house and the Scythian tent to Rome, the Jordan, the hammam, the Ganges, Mount Li, Izumo and Baden, in their own books.',
  openGraph: {
    title: 'Sacred Baths',
    description:
      'The sweat house, the hot spring and the bathhouse in Nahua, Greek, Roman, Hebrew, Arabic, Sanskrit, Chinese, Japanese and European books in Source Library.',
    images: [{ url: LEAD_IMAGE, alt: LEAD_ALT }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: LEAD_IMAGE, alt: LEAD_ALT }],
  },
  alternates: {
    canonical: '/articles/sacred-baths',
  },
});

function Section({ children }: { children: React.ReactNode }) {
  return <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-secondary leading-relaxed mb-6">{children}</p>;
}

const IMG = (id: string, page: number) =>
  `https://images.sourcelibrary.org/pages/${id}/${String(page).padStart(4, '0')}.jpg`;

// The Americas
const FC1 = 'florentine-codex-vol-1-books-1-5';
const FC2 = 'florentine-codex-vol-2-books-6-9';
const FC2_ID = '69dfebaa090ad7d5c33b1211';
const FC3 = 'florentine-codex-vol-3-books-10-12';
const FC3_ID = '69dfebab090ad7d5c33b1512';
const TUDELA = 'tudela-codex-anonymous-nahua-tlacuilo';
const TUDELA_ID = '6acc3bbcc1411f8cc6290a86';
const DURAN = 'historia-de-las-indias-de-nueva-espana-e-islas-de-tierra-duran-2';
const XEREZ = 'verdadera-relacion-de-la-conquista-del-peru-francisco-de-xerez';
const XEREZ_ID = '6a9f3f6083c3b522416e15a7';
const GUAMAN = 'nueva-coronica-y-buen-gobierno-ayala';
const ACOSTA = 'historia-natural-y-moral-de-las-indias-acosta';
const CIEZA = 'la-cronica-del-peru-pedro-de-cieza-de-leon';
const PICART = 'ceremonies-et-coutumes-religieuses-des-peuples-idolatres-s-n';
// The north
const HERODOTUS = 'erodotou-logoi-ennea-oiper-epikalountai-mousai-herodoti-libr';
const HERODOTUS_ID = '6a08527915c643eb1af4d06d';
const OLAUS = 'historia-de-gentibus-septentrionalibus-magnus';
const OLAUS_ID = '699065763dc2ed39a49f155d';
const KARAMZIN = 'history-of-the-russian-state-vol-1';
const EINHORN = 'einhorn-historia-lettica-1649';
// Greece and Rome
const PLINY = 'c-plinii-secundi-naturalis-historiae-vol-3-1535-aldine-elder';
const PAUSANIAS = 'accurata-graeciae-descriptio-greek-latin-pausanias';
const ARISTOPHANES = 'aristophanis-comoediae-dindorf-greek-latin-aristophanes';
const SOLINUS = 'collectaneorum-liber-de-mirabilibus-mundi-manuscript-1455-solinus';
const SOLINUS_ID = '69f3356c876dd827cbc4e6ff';
const AUDOLLENT = 'defixionum-tabellae-quotquot-innotuerunt-tam-in-graecis-audollent';
const HIPPOCRATES = 'hippocrates-vol-i-loeb-classical-library-hippocrates';
const VITRUVIUS = 'm-vitruvii-pollionis-de-architectura-libri-decem-vitruvius';
const SENECA = 'l-annaei-senecae-opera-philosophica-vol-3-ed';
const SENECA_ID = '69b00eb1312120db3b489437';
const MARTIAL = 'martialis-manuzio-aldo-1449-or-50-1515-torresanus-andreas-de-2';
const TACITUS = 'opera-lipsius-edition-tacitus';
const ANTHOLOGY = 'greek-anthology-florilegium-epigrammatum-aldine-press-2nd-ed-poets';
// Jordan, mikveh, hammam
const HAFTAROT = 'haftarot-in-hebrew-aramaic-and-judeo-persian-anonymous';
const HAFTAROT_ID = '69c1bc728522835be8463572';
const HAFTAROT_YEMEN = 'yemenite-haftarot-with-aramaic-targum-anonymous';
const VILNA = 'rabbinic-bible-vilna-1899-various-romm-press';
const ABOAB = 'seder-berakot-orden-de-bendiciones-y-las-ocaziones-en-que-aboab';
const ABOAB_ID = '69b525ac29577f283b57a775';
const DURA = 'the-gates-of-exile-by-isaac-ben-joseph-of-corbeil-and-the-anonymous';
const YIRAH = 'sefer-ha-yir-ah-we-sod-ha-tesuvah-we-igeret-ha-tesuvah-leha-gerondi';
const SHELAH = 'hebrew-sefer-shnei-luchot-ha-brit-horowitz';
const MUQADDASI = 'ahsan-al-taqasim-bga-iii-goeje';
const YAQUBI = 'kitab-al-alaq-al-nafisa-kitab-al-buldan-bga-vii-goeje';
const GHAZALI = 'ihya-ulum-al-din-vol-1-revival-of-the-religious-sciences-al-ghazali';
const GHAZALI_ID = '69c1b7bf8522835be84491a8';
const BATTUTA = 'rihlat-ibn-battuta-battuta';
const QANUN = 'canon-of-medicine-first-arabic-printing-1593-avicenna';
const QAZWINI = 'athar-al-bilad-cosmography-and-wonders-of-creation-al-qazvini';
const RAUWOLF = 'seer-aanmerkel-ke-reysen-na-en-door-syrien-t-joodsche-land-rauwolf';
// India, China, Japan
const PADMA = 'padma-purana-thakura';
const PADMA_ID = '6992d67146b85e738a0c4e59';
const GARUDA = 'garuda-purana-pandey';
const SKANDA = 'skanda-purana-bhattacharya';
const CHARAKA = 'caraka-samhita-charaka';
const TENGYUR = 'derge-tengyur-vol-98';
const HITOPADESHA = 'hitopadesha-a-collection-of-fables-and-tales-in-sanskrit-vishnusarma';
const HITOPADESHA_ID = '69e7267ca409200ea79ef51d';
const FITCH = 'aanmerklyke-reys-van-ralph-fitch-koopman-te-londen-gedaan-hakluyt';
const CHUXUE = 'vol-4-1782364356955';
const LEIHAN = 'vol-412-2';
const LEIHAN_ID = '6a3cef764701a906f10efbe4';
const GEZHI = 'gezhi-jingyuan-mirror-of-scientific-origins-100-volumes-yuanlong';
const YANGSHENG = 'classified-compendium-on-nurturing-life-shouzhong';
const YANGSHENG_ID = '6a1d612bd274b9630ccf9870';
const YUNJI = 'yunji-qiqian-complete-122-juan';
const SISHU = 'vol-1-1782344266035';
const KOJIKI = 'kojiki-vol-1';
const KOJIKI_ID = '69dfebad090ad7d5c33b1903';
const IZUMO = 'izumo-no-kuni-fudoki-1728-edition-anonymous';
const CHOGONKA = 'chogonka-kogi-bai';
// Europe and the alchemists
const POGGIO = 'poggii-florentini-opera-bracciolini';
const POGGIO_ID = '69aeade197d553c75e9d9421';
const MUNSTER = 'cosmographey-das-ist-beschreibung-aller-laender-munster';
const PANTALEON = 'warhafftige-und-fleissige-beschreibung-der-uralten-statt-pantaleon';
const MERCURIALE = 'de-arte-gymnastica-libri-sex-mercuriale';
const VITRUVIUS_DE = 'vitruvius-teutsch-vitruvius-pollio';
const KOLWECK = 'tractat-von-de-uberau-heylsamen-weitberuhmten-selbst-warmen-kolweck';
const PARACELSUS = 'erster-zehender-theil-der-bucher-und-schrifften-des-edlen-s-n-2';
const MONTAIGNE = 'les-essais-de-michel-seigneur-de-montaigne-montaigne';
const FAUTSCH = 'schediasma-quo-duo-famosissimi-fontes-in-inferiori-fautsch';
const SCHROETER = 'tabulae-ex-quibus-quisque-facile-discet-qua-via-schroeter';
const BRUNSCHWIG = 'das-buch-zu-distillieren-brunschwig';
const AURIFERAE = 'auriferae-artis-turba-philosophorum-alchemical-compilation-grataroli';
const AURIFERAE_ID = '69b4cc34d2bf9b45ea478d30';
const OPUSCULA = 'several-small-works-on-alchemy-anonymous';
const SPLENDOR = 'aureum-vellus-splendor-solis-golden-fleece-trismosin';
const TOYSON = 'trismosin-la-toyson-d-or-golden-fleece-1612-trismosin';
const TOYSON_ID = '695593107bd6d2cd1d61bb03';
const MAIER = 'atalanta-fleeing-maier';
const MARTYR = 'de-orbe-novo-decades-octo-d-anghiera';
const COMMUNICATION = 'communication-einer-vortrefflichen-chymischen-medicin';

export default function SacredBathsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title="Sacred Baths"
          subtitle="A goddess who spat on an emperor, a grandmother who lives in the sweat house, a philosopher lodging over a bathhouse, a dinner table afloat at Baden: what people sought in hot water, in their own words"
          image={LEAD_IMAGE}
          imageAlt={LEAD_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">12 November 2026 &middot; 24 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <PageEditMode />
      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          An old Chinese book, the <em>Record of the Three Qin</em>, says that the First Emperor once kept company
          with a divine woman at the foot of Mount Li, and offended her.
        </p>

        <SourceQuote
          book={LEIHAN}
          page={103}
          src={IMG(LEIHAN_ID, 103)}
          source={<><em>Record of the Three Qin</em>, as quoted in the Qing encyclopedia <em>Yuanjian leihan</em>, ch. 30, &ldquo;Hot springs&rdquo;; English by this article</>}
          original="秦始皇與神女遊而忤其㫖神女唾之則生瘡始皇怖謝神女為出溫泉而洗除"
          pageAlt="A page of the Yuanjian leihan in Chinese, from the section on hot springs"
        >
          She spat on him and sores broke out. The emperor in terror begged her pardon, and the divine woman
          brought forth the hot spring for him to wash them away.
        </SourceQuote>

        <P>
          Mount Li is about twenty miles east of the old capital at Chang&rsquo;an. The book itself is lost and
          survives in quotations in later encyclopedias. The same passage says what it cost to get in:{' '}
          <Link href={`/book/${LEIHAN}?page=103`}>
            <span lang="zh">以三牲祭乃得入</span>
          </Link>
          , only after sacrificing the three victims could one enter. The three victims are an ox, a sheep and a
          pig.
        </P>

        <P>
          A thousand years later the spring was a palace called Huaqing, and the emperor Xuanzong was being sent
          presents for it. One came from his general An Lushan: fish, dragons, ducks and geese carved in white
          jade, to stand in a new pool. The emperor undressed and went to get in. A Tang book of palace stories
          says the creatures all seemed to lift their scales and wings and be about to move, and that{' '}
          <Link href={`/book/${LEIHAN}?page=104`}>
            <span lang="zh">上甚恐</span>
          </Link>
          , His Majesty was badly frightened, and had them taken out. A few years on, An Lushan&rsquo;s rebellion
          drove him from the capital.
        </P>

        <P>
          People built houses over hot springs, and small rooms heated with fire or hot stones, in most parts of
          the world. This article goes through the books that describe them, from Mexico to Japan, and lets the
          people who wrote them say what the bath was for, in their own words where the books allow.
        </P>

        <Section>Our mother, the oven</Section>

        <P>
          In a house in the Valley of Mexico a girl is seven or eight months gone with her first child. Both
          families have crowded in to hear what the midwife will say. She makes a long, courteous speech,
          apologises for giving everyone a headache, and comes to the point.
        </P>

        <SourceQuote
          book={FC2}
          page={282}
          printedPage="fo. 128"
          src={IMG(FC2_ID, 282)}
          source={<>Bernardino de Sahagún and Nahua scholars, <em>Florentine Codex</em>, Book 6, ch. 27 (1577), Spanish column; English translation by Source Library</>}
          original="calientese el baño, que es la casa florida, de nuestro señor entre en el mj hija, entre en nuestra madre la que se llama ioalticitl"
          pageAlt="Folio 128 of the Florentine Codex, Book 6: two columns of handwriting, Spanish on the left and Nahuatl on the right"
        >
          let the bath be heated, which is the flowery house of Our Lord; let my daughter enter it, let her enter
          into our mother, the one called Yoalticitl.
        </SourceQuote>

        <P>
          The bath is the <em>temazcalli</em>, a low domed sweat house with a firebox built against its wall. The
          speech was written down in the 1570s in two columns, Nahuatl on the right and the Franciscan Bernardino
          de Sahagún&rsquo;s Spanish on the left, and the Nahuatl is plainer about who is inside. The kinswomen
          answer the midwife that the girl should go to{' '}
          <Link href={`/book/${FC2}?page=282`}>
            &ldquo;the grandmother of the sweat bath, Yoalticitl&rdquo;, who &ldquo;lies spread out&rdquo; there
            and &ldquo;keeps watch&rdquo;
          </Link>
          . An elder of the family, a chapter earlier, says she must{' '}
          <Link href={`/book/${FC2}?page=272`}>&ldquo;enter into our mother, the oven of the bath&rdquo;</Link>.
        </P>

        <P>
          Then the midwife lights the fire herself.{' '}
          <Link href={`/book/${FC2}?page=282`}>
            &ldquo;Then she would put the pregnant young woman into the bath and feel her belly with her
            hands.&rdquo;
          </Link>{' '}
          Other bathers were{' '}
          <Link href={`/book/${FC2}?page=283`}>
            &ldquo;struck on the back with maize leaves cooked in the very water of the bath&rdquo;
          </Link>
          . For this one she forbade the blows and had the heat kept down, so that the child would not be
          endangered. The Nahua physicians whose account of the bath is in Book 11 were just as particular about the
          heat:
        </P>

        <div className="max-w-md mx-auto">
          <PageFigure
            src={IMG(FC3_ID, 676)}
            alt="Folio 180 of the Florentine Codex, Book 11: Spanish and Nahuatl columns, with a small coloured painting of a domed sweat house, its firebox alight, and two figures in front of it"
            href={`/book/${FC3}?page=676`}
            source={<>Sahagún, <em>Florentine Codex</em>, Book 11 (1577)</>}
          >
            &ldquo;And when it is not very hot, it does not help the sick much; it only gives the sick a
            headache.&rdquo; The physicians&rsquo; paragraph on the temazcalli, with the sweat house painted
            beside it.
          </PageFigure>
        </div>

        <P>
          Householders who owned a temazcalli{' '}
          <Link href={`/book/${FC1}?page=43`}>
            &ldquo;placed the image of this goddess upon the bathhouses, and they called her Temazcalteci, which
            means the grandmother of the baths&rdquo;
          </Link>
          . The Dominican friar Diego Durán heard something more: that when a bath was built, a small stone idol
          was buried under it. He went to see.{' '}
          <Link href={`/book/${DURAN}?page=222`}>He had several old baths pulled down</Link>, he writes, partly to
          frighten people and chiefly to look for the idol. He dug, and found it: a monster&rsquo;s face in stone.
        </P>

        <PageFigure
          src={IMG(TUDELA_ID, 111)}
          alt="Leaf 62 of the Codex Tudela: a painted temazcal with a face over the door, a man stoking the fire with a long pole, three seated figures, and a Spanish note in a rapid hand above and below"
          href={`/book/${TUDELA}?page=111`}
          source={<>Codex Tudela (Mexico, about 1553)</>}
        >
          A Nahua painter&rsquo;s temazcal: the face above the door, a man feeding the fire, and a seated figure
          holding out a small vessel to two others, with speech scrolls rising from all of them. The Spanish note
          squeezed round the picture is by another hand.
        </PageFigure>

        <P>
          What the Spanish hand wrote round that painting is a complaint. It grants that the sick came to the oven
          to bathe, and goes on:{' '}
          <Link href={`/book/${TUDELA}?page=111`}>
            &ldquo;many men and women would go into this bath together, and there inside, in the heat, men with
            women, and women with men, and men with men&rdquo;
          </Link>
          . Durán gives the reason:{' '}
          <Link href={`/book/${DURAN}?page=301`}>men never bathed without women, nor women without men</Link>,
          because to bathe with only your own sex was held to bring bad luck.
        </P>

        <ContextNote title="Who wrote the American sources down">
          <p>
            Almost everything in this section passed through a friar. Sahagún (about 1499 to 1590) spent forty years
            questioning Nahua elders and had their answers written in Nahuatl by Nahua students he had trained; the
            Spanish column is his own free version, made later. Where the columns differ, as with
            &ldquo;grandmother&rdquo; in the Nahuatl and &ldquo;goddess&rdquo; in the Spanish, the Nahuatl is the
            older voice. Durán (about 1537 to 1588) grew up in Texcoco and wrote to help priests recognise the old
            religion in order to end it. The Codex Tudela is a book of paintings by a Nahua artist with notes added
            by a Spaniard. The bathers themselves are heard directly only in the speeches of Book 6.
          </p>
        </ContextNote>

        <Section>Too hot for the hand</Section>

        <P>
          On 15 November 1532 Francisco Pizarro and a hundred and sixty-eight men came down into the valley of
          Cajamarca in the northern Andes. The Inca Atahualpa, with an army of tens of thousands, was not in the
          town. He was a league away, at the hot springs. Pizarro&rsquo;s secretary describes the lodging: four
          rooms round a courtyard, and in the courtyard
        </P>

        <SourceQuote
          book={XEREZ}
          page={105}
          printedPage={101}
          src={IMG(XEREZ_ID, 105)}
          source={<>Francisco de Xerez, <em>Verdadera relación de la conquista del Perú</em> (Seville, 1534; this edition Madrid, 1891); English by this article</>}
          original="un estanque, al cual viene agua por un caño, tan caliente, que no se puede sofrir la mano en ella. Esta agua nasce hirviendo en una sierra que está cerca de allí. Otra tanta agua fria viene por otro caño, y en el camino se juntan"
          pageAlt="Page 101 of the 1891 Madrid edition of Xerez, describing Atahualpa’s lodging near Cajamarca"
        >
          a pool, to which water comes by a pipe, so hot that one cannot bear to keep a hand in it. This water
          rises boiling in a mountain range near there. As much cold water comes by another pipe, and on the way
          they join
        </SourceQuote>

        <P>
          The next day Atahualpa was a prisoner, and within a year he was dead. A Jesuit who wrote about the place
          half a century on still knew whose pool it had been:{' '}
          <Link href={`/book/${ACOSTA}?page=175`}>
            &ldquo;In the baths they call the baths of the Inga, there is a canal of water that comes out boiling,
            and next to it another of water as cold as snow. The Inga used to temper one with the other as he
            wanted.&rdquo;
          </Link>{' '}
          The Andean chronicler Guaman Poma says the Inca and his people were{' '}
          <Link href={`/book/${GUAMAN}?page=180`}>&ldquo;in the said baths of Cajamarca&rdquo;</Link> when the
          horses first frightened them, and Pedro de Cieza de León, walking the country in the 1540s, saw hot
          springs all over Peru{' '}
          <Link href={`/book/${CIEZA}?page=383`}>where the people &ldquo;bathed and bathe&rdquo;</Link>.
        </P>

        <Section>Washing, not torment</Section>

        <P>
          A man has been buried on the steppe north of the Black Sea, and the mourners have to get the death off
          them. Herodotus, in the fifth century BC, says how the Scythians did it. They lean three poles together,
          stretch woollen felt over them until no gap is left, and drop stones red from the fire into a dish
          inside. Then they crawl under the felt with a handful of hemp seed.
        </P>

        <SourceQuote
          book={HERODOTUS}
          page={161}
          src={IMG(HERODOTUS_ID, 161)}
          source={<>Herodotus, <em>Histories</em> 4.75 (Venice: Aldus, 1502), English translation by Source Library</>}
          original="οἱ δὲ σκύθαι ἀγάμενοι τῇ πυρίῃ, ὠρύονται. τοῦτο σφι ἀντὶ λουτροῦ ἐστί. οὐ γὰρ δὴ λούονται ὕδατι τὸ παράπαν τὸ σῶμα."
          pageAlt="A page of Greek from the 1502 Aldine edition of Herodotus, Book 4"
        >
          It smokes when thrown on and provides such a vapor that no Greek steam bath could surpass it. The
          Scythians, delighted by the steam bath, howl. This is their substitute for a bath. For they do not wash
          the body with water at all.
        </SourceQuote>

        <P>
          The Russian chronicle has a scene like it, written down some fifteen centuries later. As the historian
          Karamzin quotes it, it sends the Apostle Andrew up the Dnieper to where Novgorod would stand and has him report in Rome what he
          saw:{' '}
          <Link href={`/book/${KARAMZIN}?page=319`}>
            &ldquo;wooden baths, and they heat the stones red-hot, and they undress and pour themselves with an
            herbal kvass (lye), and they take young twigs, they beat themselves&rdquo;
          </Link>
          .{' '}
          <Link href={`/book/${KARAMZIN}?page=319`}>
            &ldquo;And this they do for washing, not for torture.&rdquo;
          </Link>{' '}
          In the original it is a pun, <em>movenie</em> against <em>muchenie</em>.
        </P>

        <P>
          Olaus Magnus, the last Catholic archbishop of Uppsala, wrote his history of the northern peoples in exile
          in Rome, and he begins his chapter on baths with Italy.{' '}
          <Link href={`/book/${OLAUS}?page=616`}>
            &ldquo;Although the use of baths has been discovered in most regions of the world for the sake of
            pleasure, especially in Italy,&rdquo;
          </Link>{' '}
          he begins, &ldquo;nevertheless nowhere on earth is their use so necessary as in the Northern
          kingdoms.&rdquo; He had read an Italian&rsquo;s letter about men and women bathing together beyond the
          Alps, and he names its author in his margin. In the north, he says, a board wall divides the sexes, and
          anyone who behaved as that Italian describes would be{' '}
          <Link href={`/book/${OLAUS}?page=616`}>
            &ldquo;dragged out in wintertime and cast into deep snows&rdquo;
          </Link>
          . The letter is further on in this article.
        </P>

        <div className="max-w-lg mx-auto">
          <PageFigure
            src={IMG(OLAUS_ID, 616)}
            alt="Page 527 of Olaus Magnus’s Historia (Rome, 1555): a woodcut of a northern bathhouse with bathers, a stove and tubs, above the chapter heading De balneis, et ventosis, ac phlebotomia"
            href={`/book/${OLAUS}?page=616`}
            source={<>Olaus Magnus, <em>Historia de gentibus septentrionalibus</em> (Rome, 1555)</>}
          >
            Olaus Magnus&rsquo;s northern bathhouse. The printed note in the margin halfway down the page reads
            &ldquo;Poggius&rdquo;. Overleaf he describes the bridal bath, from which the women come out wearing{' '}
            &ldquo;garlands or crowns made of rue&rdquo;.
          </PageFigure>
        </div>

        <P>
          Among the Latvians, a Lutheran pastor wrote in 1649, there had been no physicians. When people fell
          ill,{' '}
          <Link href={`/book/${EINHORN}?page=55`}>
            &ldquo;they had special women who brought them into the bath and cured them in the bathhouses&rdquo;
          </Link>
          , where, he adds, a good deal of sorcery no doubt went on. A bride there had to throw a coin into every
          room of her new home, and{' '}
          <Link href={`/book/${EINHORN}?page=60`}>the bathhouse is on his list</Link>, with the well and the
          hearth.
        </P>

        <ContextNote title="How a sweat house is built">
          <p>
            The designs in these books are close cousins: a small closed chamber, a fire or heated stones, a place
            to sit above the floor, and cold water or snow outside. The compiler of Bernard Picart&rsquo;s book on
            the world&rsquo;s religions, citing the Baron de La Hontan, says the peoples of Canada sweated in{' '}
            <Link href={`/book/${PICART}?page=128`}>
              &ldquo;a kind of oven covered with mats and skins&rdquo;
            </Link>{' '}
            and threw themselves afterwards into water or snow. The Sanskrit physician Charaka describes a{' '}
            <em>jentaka</em>, a round domed house by a pond,{' '}
            <Link href={`/book/${CHARAKA}?page=169`}>
              &ldquo;sixteen cubits in dimension, circular, well-plastered, and with many windows&rdquo;
            </Link>
            , with a clay oven of charcoal in the middle and a bench round the wall. His physician sends the oiled
            patient in with a blessing and a warning to stay on the bench even if he feels faint, because a man who
            gets down and cannot find the door may die there. The Roman architect Vitruvius hangs a bronze disc on
            chains under the hole in the dome of the sweating room, to be raised and lowered until the heat is
            right.
          </p>
        </ContextNote>

        <div className="max-w-md mx-auto">
          <PageFigure
            src="https://images.sourcelibrary.org/gallery/69c809d46c6f3cc53c84629a/69f713011c3f6a72f42ea77f-0.jpg"
            alt="Woodcut cross-section of a vaulted bath building: a furnace at floor level, tall vessels stacked above it under an opening in the vault, a large tub to the left, and two naked men attending"
            href={`/book/${VITRUVIUS_DE}?page=416`}
            source={<><em>Vitruvius Teutsch</em> (Nuremberg, 1548)</>}
          >
            The heating of a Roman bath as the first German Vitruvius pictured it: the fire below, the water
            vessels above it, and the vault overhead.
          </PageFigure>
        </div>

        <Section>Springs that make gods</Section>

        <P>
          Somebody at Bath, in Roman Britain, had a cloth stolen while he was in the water, and scratched the
          matter on a small sheet of lead, which he gave to the hot spring. It came out again on 31
          March 1880,{' '}
          <Link href={`/book/${AUDOLLENT}?page=309`}>
            with coins struck from Vespasian&rsquo;s reign to Constantine&rsquo;s
          </Link>
          . As the French scholar Auguste Audollent read
          the tablet, it asks that those named on it, one of whom took the cloth,{' '}
          <Link href={`/book/${AUDOLLENT}?page=311`}>
            &ldquo;may they melt just as that silent water melts&rdquo;
          </Link>
          . The reading is disputed and the tablet names no god. A Roman compiler supplies one:
        </P>

        <SourceQuote
          book={SOLINUS}
          page={187}
          src={IMG(SOLINUS_ID, 187)}
          source={<>Solinus, <em>Collectanea rerum memorabilium</em>, on Britain, in a manuscript of 1455; English translation by Source Library</>}
          original="fontes calidi. opiparo exsculpti apparatu ad usus mortalium. quibus fontibus praesul est minervae numen. In cuius ede perpetui ignes nunquam canescunt in favillas."
          pageAlt="A page of a fifteenth-century Italian manuscript of Solinus in a humanist hand, with a marginal note on the temple of Minerva"
        >
          hot springs, sculpted with sumptuous apparatus for the use of mortals. Over these springs presides the
          spirit of Minerva. In her temple, the fires never turn to white ash.
        </SourceQuote>

        <P>
          Pliny the Elder says that healing springs{' '}
          <Link href={`/book/${PLINY}?page=280`}>
            &ldquo;increase the number of the gods with various names, and cities are founded&rdquo;
          </Link>
          . His examples include Aix-en-Provence and Acqui Terme, which are spa towns still. At Oropos in Greece there was a spring beside the temple of the healing hero Amphiaraus that
          nobody washed in; when a sick man had been cured,{' '}
          <Link href={`/book/${PAUSANIAS}?page=49`}>
            &ldquo;it is the custom to drop silver and coined gold into the spring.&rdquo;
          </Link>{' '}
          A Greek epigram lets a spring say how the water is shared:{' '}
          <Link href={`/book/${ANTHOLOGY}?page=435`}>
            &ldquo;I pour out a bath for the nymphs, and health for mortals.&rdquo;
          </Link>
        </P>

        <P>
          The seriously ill went further and slept in the god&rsquo;s precinct, hoping he would come in a dream.
          Aristophanes put such a night on the stage in 388 BC. A slave tells how they took the blind god Wealth to
          Asclepius:{' '}
          <Link href={`/book/${ARISTOPHANES}?page=521`}>&ldquo;we first led him to the sea and washed him&rdquo;</Link>
          , then laid him down among the patients, and the attendant put out the lamps and told everyone to sleep.
          The slave stayed awake. In the dark he{' '}
          <Link href={`/book/${ARISTOPHANES}?page=521`}>
            &ldquo;saw the priest snatching the cakes and dried figs from the sacred table&rdquo;
          </Link>
          .
        </P>

        <P>
          Doctors disagreed about whether such water was good for you. The Hippocratic book on airs,
          waters and places says of ground with hot springs or ores in it that{' '}
          <Link href={`/book/${HIPPOCRATES}?page=162`}>
            &ldquo;it is impossible for good water to come from such earth&rdquo;
          </Link>
          . Four centuries later Vitruvius said the opposite:{' '}
          <Link href={`/book/${VITRUVIUS}?page=287`}>
            &ldquo;All hot water is medicinal for the reason that, having been cooked in the substances it passed
            through, it receives a different virtue for use.&rdquo;
          </Link>
        </P>

        <ContextNote title="Hot, cold, wet and dry">
          <p>
            Greek, Roman, Arabic and Renaissance physicians explained the bath with one scheme. The body is a
            mixture of four qualities, hot, cold, wet and dry, and illness is a mixture gone wrong. A bath adds or
            removes a quality. Ibn Sina (Avicenna) puts it in a sentence in his <em>Canon</em>:{' '}
            <Link href={`/book/${QANUN}?page=57`}>
              &ldquo;the natural action of the bath is to heat by means of its air, or to moisturize by means of its
              water. The first is cooling and moisturizing, the second is heating and moisturizing, and the third is
              heating and drying.&rdquo;
            </Link>{' '}
            First, second and third are the three rooms of the bathhouse. Mineral springs fitted the scheme because
            sulphur was hot and dry, alum binding, and so on. Indian medicine reasoned with three humours and
            Chinese medicine with <em>qi</em>, and both likewise treated a bath as something to prescribe, with a
            dose and a season.
          </p>
        </ContextNote>

        <Section>Above the bathhouse</Section>

        <P>
          About AD 63 the philosopher Seneca took rooms over a public bath, and wrote to his friend Lucilius about
          what came up through the floor.{' '}
          <Link href={`/book/${SENECA}?page=351`}>
            &ldquo;Behold, a varied clamor resounds around me from all sides; I live above the bath itself.&rdquo;
          </Link>{' '}
          Men grunting over lead weights. A ball player counting his catches aloud. A pickpocket being arrested.
          The man who likes the sound of his own voice in the bath. And the masseur:
        </P>

        <SourceQuote
          book={SENECA}
          page={352}
          printedPage={342}
          src={IMG(SENECA_ID, 352)}
          source={<>Seneca, <em>Epistulae morales</em> 56 (ed. Bouillet, Paris, 1827), English translation by Source Library</>}
          original="audio crepitum illisæ manus humeris; quæ, prout plana pervenit, aut concava, ita sonum mutat."
          pageAlt="Page 342 of Bouillet’s 1827 edition of Seneca’s letters, with Latin text and numbered notes below"
        >
          I hear the slap of a hand struck against shoulders; it changes its sound depending on whether it lands
          with a flat palm or a cupped one.
        </SourceQuote>

        <div className="max-w-lg mx-auto">
          <PageFigure
            src="https://images.sourcelibrary.org/gallery/6a09dd1624d4d312f5c30b35/6a09dd1624d4d312f5c30b7d-0.jpg"
            alt="Woodcut of a Roman bath: men crowded in a raised stone basin labelled LAVACRUM OCEANUM VEL LABRUM, one pouring water over another, strigils hanging on the wall, and swimmers in a pool below"
            href={`/book/${MERCURIALE}?page=72`}
            source={<>Girolamo Mercuriale, <em>De arte gymnastica</em> (Venice, 1573)</>}
          >
            A Roman public bath as a Renaissance physician rebuilt it from the ruins and the poets, with the
            strigils for scraping the skin hanging on the wall and the great basin, the <em>labrum</em>, full of
            men.
          </PageFigure>
        </div>

        <P>
          There is no god in Seneca&rsquo;s letter and no cure; this is where the city spent its afternoons. The
          poet Martial, a generation later, asked:{' '}
          <Link href={`/book/${MARTIAL}?page=184`}>
            &ldquo;What is worse than Nero? What is better than the Neronian baths?&rdquo;
          </Link>
        </P>

        <P>
          Then Seneca went to see the villa of Scipio Africanus, the man who beat Hannibal, and found the great
          man&rsquo;s bath: a narrow, dark room with slits in the wall for windows. He wrote to Lucilius again.{' '}
          <Link href={`/book/${SENECA}?page=612`}>
            &ldquo;But formerly there were few baths, and they were not adorned with any refinement: for why should
            a thing that costs a farthing be adorned, a thing found for use and not for pleasure?&rdquo;
          </Link>{' '}
          Scipio washed in cloudy water and did not mind. He came{' '}
          <Link href={`/book/${SENECA}?page=613`}>
            <em>ut sudorem illic ablueret, non ut unguentum</em>
          </Link>
          , to wash off sweat and not perfume. The historian Tacitus turned the same thought on the provinces. The
          conquered Britons, he wrote, were led by degrees to{' '}
          <Link href={`/book/${TACITUS}?page=737`}>
            &ldquo;porticoes, baths, and the elegance of banquets. Among the inexperienced, this was called
            humanitas, when it was a part of their enslavement.&rdquo;
          </Link>
        </P>

        <Section>Seven times in the Jordan</Section>

        <P>
          Naaman commanded the army of Damascus, and he had a disease of the skin. A captive Israelite girl in his
          house said the prophet in Samaria could cure it. He came to Elisha&rsquo;s door with horses, a chariot,
          silver, gold and ten changes of clothes. The prophet did not come out. He sent a servant with a message.
        </P>

        <SourceQuote
          book={HAFTAROT}
          page={237}
          src={IMG(HAFTAROT_ID, 237)}
          source={<>2 Kings 5:10, in a manuscript of the prophetic readings in Hebrew, Aramaic and Judeo-Persian (15th or 16th century); English translation by Source Library</>}
          original="הָלוֹךְ וְרָחַצְתָּ שֶׁבַע פְּעָמִים בַּיַּרְדֵּן וְיָשֹׁב בְּשָׂרְךָ לְךָ וּטְהָר"
          pageAlt="A page of a Hebrew manuscript of the haftarot, the readings from the Prophets, in square script"
        >
          Go and wash in the Jordan seven times, and your flesh shall come again to you, and you shall be clean
        </SourceQuote>

        <P>
          Naaman had expected the holy man to come out, call on his god and wave a hand over the place. He was
          being sent to a muddy foreign river by a servant.{' '}
          <Link href={`/book/${HAFTAROT_YEMEN}?page=121`}>
            &ldquo;Are not Amanah and Pharpar, the rivers of Damascus, better than all the waters of Israel? May I
            not wash in them, and be clean?&rdquo; So he turned and went away in a rage.
          </Link>{' '}
          His own servants talked him round: if the prophet had asked something hard, he would have done it. He
          went down, dipped seven times, and his flesh came back like a small boy&rsquo;s. He comes back near the
          end of this article.
        </P>

        <P>
          The Hebrew uses one word, <em>tahor</em>, for cured and for ritually clean, and the second sense became a
          body of law. Leviticus sends a man recovered from a discharge to bathe{' '}
          <Link href={`/book/${VILNA}?page=1694`}>in <em>mayim hayyim</em></Link>, living water, water that flows.
          From this the rabbis built the <em>mikveh</em> and ruled on what makes one valid. A legal manuscript
          finished in January 1346:{' '}
          <Link href={`/book/${DURA}?page=215`}>
            &ldquo;if the entire volume consists of drawn water, it is disqualified by Torah law. If it consists of
            rainwater, it is valid&rdquo;
          </Link>
          . No bucket may have carried it. It must touch all of the body at once, so a sermon for women printed in
          1627 tells the bather to take off{' '}
          <Link href={`/book/${YIRAH}?page=114`}>
            &ldquo;all jewelry on her body so that they do not interpose between her flesh and the water&rdquo;
          </Link>
          , and not to screw her eyes shut. And there must be forty <em>seah</em> of it, a measure the rabbis
          reckoned in eggs. In Amsterdam in 1687 somebody went to find out what that came to.
        </P>

        <SourceQuote
          book={ABOAB}
          page={679}
          printedPage={42}
          src={IMG(ABOAB_ID, 679)}
          source={<>Isaac Aboab, <em>Seder berakhot / Orden de bendiciones</em> (Amsterdam, 1687), appendix on the quantity of water for the bath; English translation by Source Library</>}
          original="E feita a efperiencia em medida de Amfterdam (marcada com amarca da cidade) com que fe mede a Bira nas tendas, fae a 30. ovos por cada mingela"
          pageAlt="A page in Portuguese from the appendix of the 1687 Amsterdam prayer book, headed Cantidade de agua para o Banho"
        >
          And the experiment having been performed in an Amsterdam measure (marked with the city&rsquo;s mark) with
          which beer is measured in the shops, it comes to 30 eggs for each mingela. Thus, the said 5,760 eggs of
          the bath come to 192 mingelas of water of the said measure
        </SourceQuote>

        <P>
          The kabbalists gave the measured water an inward use:
          immersion, wrote Isaiah Horowitz,{' '}
          <Link href={`/book/${SHELAH}?page=240`}>returns the soul to its place</Link>, and everyone should go
          down each Friday{' '}
          <Link href={`/book/${SHELAH}?page=240`}>
            &ldquo;to strip off the &lsquo;weekday spirit&rsquo; and clothe oneself in the &lsquo;spirit of Sabbath
            holiness&rsquo;&rdquo;
          </Link>
          . Jeremiah had said long before that washing would not do it:{' '}
          <Link href={`/book/${HAFTAROT}?page=349`}>
            wash with natron and heap up the soap, &ldquo;your iniquity is stained before Me&rdquo;
          </Link>
          .
        </P>

        <P>
          The country had hot springs too. At Tiberias on the Sea of Galilee the tenth-century geographer
          al-Muqaddasi found a boiling spring that{' '}
          <Link href={`/book/${MUQADDASI}?page=202`}>
            &ldquo;feeds most of the city&rsquo;s baths. A stream was split to each bath, so its steam heats the
            houses, and there is no need for fuel&rdquo;
          </Link>
          . The townspeople told him how it used to be. Rooms once stood round the spring, one for each disease,
          and whoever had that disease bathed in its room and was cured. Then the king of the time had the rooms
          pulled down,{' '}
          <Link href={`/book/${MUQADDASI}?page=202`}>
            <span dir="rtl" lang="ar">لئلا يستغنوا عن الاطباء</span>
          </Link>
          , so that people should not manage without physicians.
        </P>

        <ContextNote title="Clean is one thing, pure another">
          <p>
            Several traditions in this article distinguish washing off dirt from removing a state. Hebrew{' '}
            <em>tum&rsquo;ah</em>, Arabic <em>hadath</em> and <em>janaba</em>, and Japanese <em>kegare</em> are
            conditions a person enters through ordinary events, contact with the dead, sex, childbirth, illness,
            and leaves through a prescribed act with water: <em>tevilah</em> (immersion), <em>ghusl</em> (the full
            washing) and <em>wudu</em> (the lesser one before prayer), <em>misogi</em>. The act has conditions
            that make no sense as hygiene and perfect sense as law: the right kind of water, enough of it, the
            right intention, the right order. A person can be spotless and impure, or muddy and pure. English
            &ldquo;purification&rdquo; and &ldquo;ritual bath&rdquo; blur this, and so do some of the translations
            quoted here.
          </p>
        </ContextNote>

        <Section>A good house, an evil house</Section>

        <P>
          The jurist al-Ghazali, writing in the 1090s, collected what the Prophet&rsquo;s companions had said
          about the bathhouse. Some said:{' '}
          <Link href={`/book/${GHAZALI}?page=326`}>
            &ldquo;What an excellent house the bathhouse is; it purifies the body and reminds one of the Fire.&rdquo;
          </Link>{' '}
          Others said it was an evil house:{' '}
          <Link href={`/book/${GHAZALI}?page=326`}>
            &ldquo;it exposes the &lsquo;awrah and strips away modesty&rdquo;
          </Link>
          . The <em>&lsquo;awra</em> is the part of the body, for a man from navel to knee, that nobody else may
          see. Al-Ghazali rules that both parties were right and that the <em>hammam</em> is permitted to anyone
          who goes in properly. Keep your own body covered and your eyes off other people&rsquo;s. Go in for the
          cleanliness that adorns prayer.{' '}
          <Link href={`/book/${GHAZALI}?page=327`}>
            &ldquo;Then, one pays the bath attendant his fee before entering.&rdquo;
          </Link>{' '}
          Step in with the left foot, asking God&rsquo;s protection from Satan. Do not go at sunset, when the
          devils are abroad. And in the innermost room, use the heat:
        </P>

        <SourceQuote
          book={GHAZALI}
          page={328}
          src={IMG(GHAZALI_ID, 328)}
          source={<>al-Ghazali, <em>Ihya&rsquo; &lsquo;ulum al-din</em>, Book of the Mysteries of Purity, in an Arabic manuscript; English translation by Source Library</>}
          original={<span dir="rtl" lang="ar">ويقدر نفسه محبوسا في البيت الحار ساعة ويقيسه الى جهنم</span>}
          pageAlt="A page of an Arabic manuscript of al-Ghazali’s Ihya, written in naskh script"
        >
          one imagines oneself confined in the hot chamber for an hour and compares it to Jahannam. Indeed, it
          resembles the description of Hell: fire from below and darkness from above
        </SourceQuote>

        <P>
          He adds, at the opening of the same book, that all this outward washing is only{' '}
          <Link href={`/book/${GHAZALI}?page=300`}>&ldquo;the outermost husk&rdquo;</Link> of purity. The kernel is
          a clean heart.
        </P>

        <P>
          Ibn Battuta of Tangier, who travelled from 1325 to 1354, went into a bathhouse in a town on the Nile and
          found the men wearing nothing. He went straight to the
          governor, who sent for the men who leased the baths and had{' '}
          <Link href={`/book/${BATTUTA}?page=37`}>contracts drawn up against them</Link>: they would answer for any
          bather without a waist-wrapper. Baghdad pleased him better.{' '}
          <Link href={`/book/${BATTUTA}?page=170`}>
            &ldquo;The bathhouses of Baghdad are many, and they are among the most marvelous. They are paved and
            coated with bitumen, so that to the observer it appears as black marble.&rdquo;
          </Link>{' '}
          Each bather had a cubicle to himself, with hot and cold water, and was handed{' '}
          <Link href={`/book/${BATTUTA}?page=171`}>
            &ldquo;three towels: one to wrap around his waist when he enters, another to wrap around his waist when
            he leaves, and a third to dry the water from his body&rdquo;
          </Link>
          . At Bursa he found a river of very hot water running into a great pool with two buildings over it,{' '}
          <Link href={`/book/${BATTUTA}?page=236`}>
            &ldquo;one for men and one for women, and the sick seek healing in this hot spring. They come to it
            from the furthest lands.&rdquo;
          </Link>{' '}
          Four and a half centuries earlier a geographer had counted{' '}
          <Link href={`/book/${YAQUBI}?page=287`}>five thousand bathhouses</Link> on one bank of Baghdad, and the
          cosmographer al-Qazwini knew of one in Khorasan, kept up by pious endowments, where{' '}
          <Link href={`/book/${QAZWINI}?page=297`}>
            &ldquo;no bath fee is collected from those who enter&rdquo;
          </Link>
          .
        </P>

        <PageFigure
          src="https://images.sourcelibrary.org/archived/69b525c12f891867c1ae48ac/46.jpg"
          alt="Engraving of the inside of a large bathhouse with a central pool, columns and hangings; bathers in the water, and men being rubbed and stretched by attendants in the foreground"
          href={`/book/${RAUWOLF}?page=46`}
          source={<>Leonhard Rauwolf, <em>Reysen na en door Syrien</em> (Leiden, 1707)</>}
        >
          A hammam as a Dutch engraver imagined it in 1707, for an edition of the travels of the German physician
          Leonhard Rauwolf, who was in Syria in the 1570s. The massage in the foreground comes from the text; the
          architecture is the engraver&rsquo;s own.
        </PageFigure>

        <Section>Forgive my feet</Section>

        <P>
          A pilgrim has walked for weeks to reach the Ganges. He is on the bank. The <em>Padma Purana</em> tells
          him what to say before he steps in:
        </P>

        <SourceQuote
          book={PADMA}
          page={467}
          src={IMG(PADMA_ID, 467)}
          source={<><em>Padma Purana</em>, Kriyayogasara, ch. 4 (Sanskrit, printed in Bengali script, 1901), English translation by Source Library</>}
          original="দেবি জগদ্ধাত্রি পাদাজ্যং সলিলং তব। স্পৃশামীত্যপরাধং মে প্রসন্না ক্ষন্তুমর্হসি"
          pageAlt="A page of the Padma Purana in Sanskrit, printed in Bengali script"
        >
          O Goddess Ganga, Mother of the World, I touch your water with my feet; please forgive my offense, O
          Gracious One.
        </SourceQuote>

        <P>
          The <em>Garuda Purana</em> ranks the waters of the world and puts one above them all:{' '}
          <Link href={`/book/${GARUDA}?page=329`}>
            &ldquo;The water of the Ganga quickly purifies the sin [incurred] until the end of one&rsquo;s life.&rdquo;
          </Link>{' '}
          The <em>Skanda Purana</em> does sums. A month of daily baths at one ford is worth{' '}
          <Link href={`/book/${SKANDA}?page=1009`}>
            &ldquo;three months at Gangadwara, seven months of Magha at Prayaga, eight months of Kartika at
            Naimisha&rdquo;
          </Link>
          . The physician Charaka, writing about the ordinary daily bath, begins his list of what it does with the
          pilgrim&rsquo;s word, <em>pavitra</em>, cleansing, before he gets to{' '}
          <Link href={`/book/${CHARAKA}?page=114`}>
            &ldquo;removes fatigue, sweat, and impurities; it binds the strength of the body&rdquo;
          </Link>
          .
        </P>

        <PageFigure
          src="https://images.sourcelibrary.org/archived/69b525c62f891867c1ae4e36/23.jpg"
          alt="Engraving of a wide river with a temple and palms on the far bank; in the foreground men and women bathe, pour water over each other and raise their hands"
          href={`/book/${FITCH}?page=23`}
          source={<>Ralph Fitch, <em>Aanmerklyke reys</em> (Leiden, 1706)</>}
        >
          Bathing in an Indian river, engraved in Leiden in 1706 for a Dutch edition of the travels of the London
          merchant Ralph Fitch, who went down the Ganges in the 1580s. The artist had never seen it.
        </PageFigure>

        <P>
          A Buddhist treatise, preserved in Tibetan, puts the case against the bath:{' '}
          <Link href={`/book/${TENGYUR}?page=610`}>
            &ldquo;If actions of a non-meritorious nature / Were exhausted by entering the water and such, / Those
            who bathed at the fords and the like / Would never suffer, because the cause would be gone.&rdquo;
          </Link>{' '}
          The blind, the deaf and the lame, it goes on, go down to the fords and come up as they were. Then it
          quotes the brahmins&rsquo; own sage, Vyasa. The verse survives in Sanskrit too, in a book of animal
          fables for the education of princes.
        </P>

        <SourceQuote
          book={HITOPADESHA}
          page={497}
          src={IMG(HITOPADESHA_ID, 497)}
          source={<><em>Hitopadesha</em>, Book 4 (Sanskrit edition of 1830), English translation by Source Library</>}
          original="आत्मा नदी संयमपुण्यतीर्थाः सत्योदका … तत्राभिषेकं कुरु पाण्डुपुत्र न वारिणा शु द्ध्यति चान्तरात्मा"
          pageAlt="A page of the 1830 Sanskrit edition of the Hitopadesha in Devanagari type"
        >
          The soul is a river, whose holy bathing place is self-restraint, whose water is truth, and whose banks
          are moral character and waves are virtues. Perform your ritual bathing in that, O son of Pandu, for the
          inner self is not purified by water.
        </SourceQuote>

        <Section>The lucky day for a bath</Section>

        <P>
          Back at Mount Li, three centuries after the First Emperor and six before Xuanzong, the astronomer Zhang
          Heng came to see the spring. He bathed in what he calls the divine well and wrote a poem about it. There
          is no goddess in the poem. People come hurrying from far regions,{' '}
          <Link href={`/book/${CHUXUE}?page=21`}>men and women crowding like the scales of a fish</Link>, and
          the reason he gives is a medical one: when the six <em>qi</em> of the world fall out of order and there
          is pestilence,{' '}
          <Link href={`/book/${CHUXUE}?page=21`}>
            <span lang="zh">溫泉汨焉以流穢兮</span>
          </Link>
          , the hot spring comes welling up to carry the foulness away. A Ming traveller, Du Mu, found the place
          still sorted by rank. One pool was called the official pool,{' '}
          <Link href={`/book/${GEZHI}?page=166`}>
            <span lang="zh">蓋非貴人不得浴</span>
          </Link>
          , because none but persons of rank might bathe in it. To its left was a spring for everybody else.
        </P>

        <P>
          At home, a bath was a matter of ritual and long life. The <em>Record of Rites</em> rules that men and
          women <Link href={`/book/vol-655?page=61`}>do not share the bath-room</Link>, and that a son heats water
          for his parents every fifth day. A Daoist scripture quoted in the great
          anthology <em>Yunji qiqian</em> prescribes five fragrant plants for the water:
        </P>

        <SourceQuote
          book={YANGSHENG}
          page={91}
          src={IMG(YANGSHENG_ID, 91)}
          source={<><em>Scripture on Bathing Body and Mind</em>, quoted in Zhou Shouzhong, <em>Yangsheng leizuan</em> (edition of 1474), English translation by Source Library</>}
          pageAlt="A page of the Yangsheng leizuan, a Chinese handbook on nourishing life, from the section on bathing"
        >
          First is baizhi, which can expel the Three Corpses. Second is peach bark, which can ward off evil
          influences. Third is cypress leaves, which can bring down true immortals.
        </SourceQuote>

        <P>
          The Three Corpses are parasites that live in the body and report its sins to heaven. The anthology also
          lists one lucky day and hour for a bath in each month. On{' '}
          <Link href={`/book/${YUNJI}?page=896`}>the tenth of the first month, at the hour when people settle</Link>
          , a bath makes the teeth firm. On the eighteenth of the tenth month, at first cockcrow, it gives long
          life. It prints two immortal ladies{' '}
          <Link href={`/book/${YUNJI}?page=897`}>disagreeing about how often one should bathe</Link>, and does not
          say who is right. And it has this line:{' '}
          <Link href={`/book/${YUNJI}?page=895`}>
            <span lang="zh">内淨者虛心無垢外淨者身垢盡除</span>
          </Link>
          , clean within is an empty heart without stain, clean without is the body&rsquo;s dirt all gone. King
          Tang, founder of the Shang dynasty, was said to have had a motto cut into his basin: &ldquo;if one day
          new, daily new, again daily new&rdquo;. The philosopher Zhu Xi explained that it was his bathtub, and
          that{' '}
          <Link href={`/book/${SISHU}?page=109`}>
            a man washes his heart to be rid of evil as he bathes his body to be rid of dirt
          </Link>
          .
        </P>

        <Section>The sun from a washed eye</Section>

        <P>
          The god Izanagi has been down to the land of the dead to fetch his wife, has seen her rotting body, and
          has run. Back in the light he says he has been in a foul, defiled land and must wash. So the oldest book
          in Japanese, the <em>Kojiki</em> of AD 712, brings him to a river mouth, where he looks at the water:{' '}
          <Link href={`/book/${KOJIKI}?page=19`}>
            &ldquo;The upper current is too swift, the lower current is too sluggish.&rdquo;
          </Link>{' '}
          He wades into the middle. The filth of the underworld comes off him and turns into two gods of
          misfortune. He washes his face.
        </P>

        <SourceQuote
          book={KOJIKI}
          page={20}
          src={IMG(KOJIKI_ID, 20)}
          source={<><em>Kojiki</em>, first book (compiled 712), English translation by Source Library</>}
          original="於是洗左御目時所成神名天照大御神。次洗右御目時所成神名月讀命。次洗御鼻時所成神名建速須佐之男命。"
          pageAlt="A page of the Kojiki printed in Chinese characters with small reading marks"
        >
          Then, when he washed his left eye, the deity born was Amaterasu-oo-mi-kami. Next, when he washed his
          right eye, the deity born was Tsukuyomi-no-mikoto. Next, when he washed his nose, the deity born was
          Takehaya-susanoo-no-mikoto.
        </SourceQuote>

        <P>
          Amaterasu is the sun, and the ancestress of the emperors. Tsukuyomi is the moon, Susanoo the storm. The
          washing is called <em>misogi</em>, and it is still done, in rivers, in the sea and under waterfalls.
        </P>

        <P>
          Twenty-one years after the <em>Kojiki</em>, the officials of Izumo province sent the court a description
          of their country, and in it is the first report of a Japanese hot spring. By a river, hot water comes
          out of the ground. Men and women, old and young, gather there every day,{' '}
          <Link href={`/book/${IZUMO}?page=13`}>
            <span lang="ja">日集成市繽紛燕樂</span>
          </Link>
          , thick as a market, and feast. Wash once and your looks improve. Wash again and every illness goes. It
          has never been known to fail, the officials write,{' '}
          <Link href={`/book/${IZUMO}?page=13`}>
            <span lang="ja">故俗人曰神湯也</span>
          </Link>
          , and so the common people call it the gods&rsquo; hot water.
        </P>

        <P>
          A Chinese poem about Mount Li, the <em>Song of Everlasting Sorrow</em>, in which Xuanzong grants his
          consort Yang Guifei a bath in the Huaqing pool, was much read in Japan. A Japanese lecturer explaining
          the poem in 1734 came
          to the line about the water washing her skin and turned it round:{' '}
          <Link href={`/book/${CHOGONKA}?page=10`}>
            &ldquo;While ordinary people wash with water to remove dirt, the Consort&rsquo;s skin was so beautiful
            that the water itself seemed to become soft and lovely upon touching her.&rdquo;
          </Link>
        </P>

        <Section>A table floating on the water</Section>

        <P>
          This is the letter Olaus Magnus had read. In the spring of 1416 Poggio Bracciolini, a papal
          secretary with no pope to work for while the Council of Constance argued, rode to the baths at Baden near
          Zurich to treat the joints of his hand, and wrote home to Florence about what he found. In the public
          pools, men and women, old and young, walked naked into the water with only a fence between them, and
          nobody stared. In the better houses the sexes shared a bath divided by a board partition{' '}
          <Link href={`/book/${POGGIO}?page=313`}>
            with &ldquo;many small windows, through which they are able to drink together, and to converse&rdquo;
          </Link>
          , and a gallery ran above where people stood to watch.
        </P>

        <SourceQuote
          book={POGGIO}
          page={314}
          printedPage={299}
          src={IMG(POGGIO_ID, 314)}
          source={<>Poggio Bracciolini, letter to Niccolò Niccoli from Baden, 1416, in his <em>Opera</em> (Basel, 1538); English translation by Source Library</>}
          original="In ipſis aquis ſæpe de ſymbolis edūt, cōpoſita meſa deſuper aqua natante … Ego uero ſymbolū cōtuli, intereſſe nolui licet etiā atq; etiā rogatus"
          pageAlt="Page 299 of the 1538 Basel edition of Poggio’s works, in roman type with many abbreviations"
        >
          In the waters themselves, they often dine from shared contributions, with a table arranged floating on
          top of the water, at which they are accustomed to have men sit with them. We, in that house where we
          were bathing, were once invited to that custom. I, for my part, contributed my share, but I did not wish
          to attend, although I was asked again and again
        </SourceQuote>

        <P>
          It was not shame that kept him out, he explains. He had no German, and an Italian sitting dumb in the
          water among women would look a fool. What astonished him was the husbands, who watched strangers touch
          their wives and thought nothing of it.{' '}
          <Link href={`/book/${POGGIO}?page=314`}>
            &ldquo;They would clearly have fit into Plato&rsquo;s Republic&rdquo;
          </Link>
          , he wrote. He thought no baths in the world better for women who wanted children, and saw that most of
          the crowd had come{' '}
          <Link href={`/book/${POGGIO}?page=315`}>
            &ldquo;not so much for the sake of health as for pleasure&rdquo;
          </Link>
          . He ends envying them, people who lived for the day while his own countrymen{' '}
          <Link href={`/book/${POGGIO}?page=316`}>
            &ldquo;turn heaven and earth and sea upside down to extract money&rdquo;
          </Link>
          .
        </P>

        <PageFigure
          src="https://images.sourcelibrary.org/gallery/6a42585e860bea81c9456111/6a42585e860bea81c945611f-0.jpg"
          alt="Woodcut bird’s-eye view of a walled town on a river among wooded hills, labelled Ober Baden, with two angels holding a shield in the sky"
          href={`/book/${PANTALEON}?page=14`}
          source={<>Heinrich Pantaleon, <em>Beschreibung der uralten Statt und Graveschafft Baden</em> (Basel, 1578)</>}
        >
          Baden on the Limmat, a hundred and sixty years after Poggio&rsquo;s visit.
        </PageFigure>

        <div className="max-w-lg mx-auto">
          <PageFigure
            src="https://images.sourcelibrary.org/cropped/69c8716b6c6f3cc53c857589/69f771796028036f8e23930d.jpg"
            alt="A page of Sebastian Münster’s Cosmographey in German blackletter with a large woodcut of men and women bathing together in a pool under a fountain"
            href={`/book/${MUNSTER}?page=145`}
            source={<>Sebastian Münster, <em>Cosmographey</em> (Basel, 1598)</>}
          >
            Men and women in one pool, from the chapter &ldquo;On the hot baths that spring from the earth&rdquo;
            in the most widely read German book of its century.
          </PageFigure>
        </div>

        <P>
          Higher in the Alps the water had to be earned. The hot spring of Pfäfers rises at the bottom of a gorge,
          and before a bridge was built, a local writer recalled in 1631, there was no way down{' '}
          <Link href={`/book/${KOLWECK}?page=71`}>except by a very long rope or a hanging ladder</Link>. Many who
          had travelled for the cure looked over the edge and went home. Others{' '}
          <Link href={`/book/${KOLWECK}?page=72`}>
            had themselves tied into chairs, with their eyes covered, and lowered by their servants
          </Link>
          . Paracelsus, who was there in 1535, said the water behaved like a living thing:{' '}
          <Link href={`/book/${PARACELSUS}?page=351`}>
            &ldquo;its rejuvenation begins in the spring and terminates in the winter, growing with the herbs and
            dying with them.&rdquo;
          </Link>
        </P>

        <P>
          Montaigne had kidney stones and tried nearly every famous bath in Europe. He saw no miracles and
          believed none of the stories. He had also seen almost nobody made worse, and he wrote:{' '}
          <Link href={`/book/${MONTAIGNE}?page=817`}>
            &ldquo;He who does not bring enough cheer there to be able to enjoy the pleasure of the companies who
            are found there, and of the walks and exercises to which we are invited by the beauty of the places
            where these waters are commonly situated, loses without doubt the best and most assured part of their
            effect.&rdquo;
          </Link>{' '}
          A Latin poem printed in 1618 warns the visitor who comes to a German
          spring only to drink and chase women that{' '}
          <Link href={`/book/${FAUTSCH}?page=7`}>the Genius of the spring is against him</Link>.
        </P>

        <Section>The bath in the flask</Section>

        <P>
          The alchemists took the bath indoors. Their commonest piece of equipment was a bath.
          Hieronymus Brunschwig, a Strasbourg surgeon, shows how to build one in 1512: take a wooden bathing tub,
          run a copper pipe up through its floor for the charcoal, fill the tub with water, and stand your flasks
          in it. He calls it by its usual name,{' '}
          <Link href={`/book/${BRUNSCHWIG}?page=117`}>
            <em>balneum Mariae</em>
          </Link>
          , Mary&rsquo;s bath. Cooks still use the word.
        </P>

        <ContextNote title="Mary’s bath">
          <p>
            A water bath heats gently and evenly, because water cannot get hotter than its boiling point. That made
            it the tool for the slow processes alchemists called digestion and putrefaction, in which a sealed
            flask was kept warm for weeks. It was named after the legendary alchemist Maria the Jewess; their
            dictionaries define it as <em>Balneum Mariae, or maris as many would have it called</em>, the bath of
            Mary or of the sea. Because what went on in the flask was described as a death and a new birth, the
            comparison with a body in a bath, or a child in the womb, was made early and often. Not everyone
            approved. The <em>Rosarium philosophorum</em> itself says that rotting dung does the work better than{' '}
            <Link href={`/book/${AURIFERAE}?page=984`}>the fire of Mary&rsquo;s bath</Link>.
          </p>
        </ContextNote>

        <P>
          What they put in the bath, on paper, was a king and a queen. The <em>Rosarium philosophorum</em>, the
          Rose Garden of the Philosophers, printed at Frankfurt in 1550, tells the making of the
          philosophers&rsquo; stone in woodcuts as the story of a royal couple. They meet clothed. They undress.
          Then this:
        </P>

        <div className="max-w-md mx-auto">
          <PageFigure
            src="https://images.sourcelibrary.org/cropped/6970e3619b09d309d780a26a/69745e66e5dbf61639314406.jpg"
            alt="Woodcut from the 1550 Rosarium philosophorum: a crowned king and queen sit naked in a hexagonal stone bath, holding crossed flowering branches, with a dove descending between them"
            href={`/book/${OPUSCULA}?page=386`}
            source={<><em>Rosarium philosophorum</em>, in <em>De alchimia opuscula</em> (Frankfurt, 1550)</>}
          >
            The king and queen in the bath. The text beside them is about metals: what is perfect cannot be
            changed, only destroyed, and what is imperfect can be changed.
          </PageFigure>
        </div>

        <P>
          Later in the series they lie dead in a tomb, and the caption, in German verse, is a washing:{' '}
          <Link href={`/book/${AURIFERAE}?page=1035`}>
            &ldquo;Here the dew falls down from heaven, and washes the black body in the grave.&rdquo;
          </Link>{' '}
          One treatise in the same collection names the bather it has in mind.
        </P>

        <SourceQuote
          book={AURIFERAE}
          page={559}
          printedPage={537}
          src={IMG(AURIFERAE_ID, 559)}
          source={<><em>Clangor buccinae</em>, in <em>Auriferae artis</em> (Basel, 1572), English translation by Source Library</>}
          original="Æs nostrum corpus habet hydropicum, vt Naaman Syrus leprosum, propter quod quærit lauacrum regenerationis septies in Iordane, vt ab innatis passionibus & corruptionib. emundetur."
          pageAlt="Page 537 of the 1572 Basel collection Auriferae artis, in italic type"
        >
          Our copper has a dropsical body, as Naaman the Syrian had a leprous one, on account of which it seeks the
          bath of regeneration seven times in the Jordan, so that it may be cleansed from inborn passions and
          corruptions.
        </SourceQuote>

        <P>
          The illustrated treatise <em>Splendor solis</em> goes
          further, citing Ovid for an old man who wanted his youth back and was told to have himself{' '}
          <Link href={`/book/${SPLENDOR}?page=263`}>
            &ldquo;divided and cooked until his perfect cooking, and no further&rdquo;
          </Link>
          , after which his limbs would join again and be young.
        </P>

        <div className="max-w-md mx-auto">
          <PageFigure
            src={IMG(TOYSON_ID, 102)}
            alt="Hand-coloured woodcut from La Toyson d’or (1612): a bearded old man sits in a round tub with a bird on his head, a fire burning under the tub, and a man in red working a bellows"
            href={`/book/${TOYSON}?page=102`}
            source={<>Salomon Trismosin, <em>La Toyson d&rsquo;or</em> (Paris, 1612)</>}
          >
            The old man in the bath, from the French edition of <em>Splendor solis</em>, coloured by hand. He looks
            comfortable. The text below begins: first, such a heat must be applied as can soften and melt.
          </PageFigure>
        </div>

        <P>
          Michael Maier&rsquo;s emblem book of 1618 puts a king in the Roman sweating room that Vitruvius had
          described,{' '}
          <Link href={`/book/${MAIER}?page=141`}>
            <em>Rex balneatur in Laconico sedens</em>
          </Link>
          , the king is bathed sitting in the laconicum, and is freed of his black bile. And the hope behind all
          these pictures had by then been given a place on the map. In 1516 the Italian humanist Peter Martyr,
          writing up the Spanish voyages for the pope, reported an island north of Hispaniola{' '}
          <Link href={`/book/${MARTYR}?page=113`}>
            &ldquo;so noble for its perennial fountain that the water of that spring, when drunk, makes the elderly
            grow young again&rdquo;
          </Link>
          . The whole court believed it, he says. Asked what he thought himself, Peter Martyr said he did not grant nature
          so much power, and that God had kept that one for himself. Two centuries later a German alchemical
          pamphlet cited him as its authority that the fountain was real:{' '}
          <Link href={`/book/${COMMUNICATION}?page=47`}>
            &ldquo;Petrus Martyr Augerius, a Milanese, assures in his Decadibus&rdquo;
          </Link>{' '}
          that the old who drink there grow young and strong, though their hair, it adds, stays grey.
        </P>

        <P>
          There was a right time for all of it. A book of astrological tables printed in 1551 has one headed{' '}
          <Link href={`/book/${SCHROETER}?page=15`}>
            <em>Quo tempore conveniens balneum eligi debeat</em>
          </Link>
          , at what time a fitting bath should be chosen: the Moon well placed with Jupiter or Venus, and clear of
          Saturn and Mars.
        </P>

        <Section>The spring in Izumo</Section>

        <P>
          The spring in Izumo is called Tamatsukuri now, and people still go. The officials who described it in
          733 were not priests or doctors. They were filling in a report for the capital, district by district,
          listing rivers and products. When they came to the hot water by the river they wrote down what happened
          there each day, the crowd and the feasting, and what the people who used it had told them: one wash for
          your looks, a second for everything that ails you, and it has never been known to fail.
        </P>

        <Section>A note on the sources</Section>

        <P>
          Every book quoted is in Source Library in the language it was written in, and each link opens the page
          beside its scan. The English is Source Library&rsquo;s own translation of that page, made with AI and
          quoted as it stands, except where the source line says &ldquo;English by this article&rdquo; or the
          original is given without quotation marks: those pages (Xerez, Durán, Kolweck, Brunschwig, and several
          of the Chinese and Japanese compilations) have no published translation in the library yet, and the
          paraphrases are ours. Three editions are themselves translations or reports and are named as such: the
          Spanish column of the Florentine Codex beside its Nahuatl, the Russian chronicle as Karamzin quotes it,
          and the Chinese works that survive as quotations in later encyclopedias. The Buddhist treatise is read
          in the Derge edition of the Tibetan Tengyur, whose pages do not name the work. Dates and identifications
          the pages do not give (the day the Spaniards reached Cajamarca, Bath for Solinus&rsquo;s springs,
          Tamatsukuri for the Izumo spring, the lives of the authors) are the standard ones. The pictures by Dutch
          and German engravers of places they never saw are captioned as such.
        </P>

        <P>
          The claims this essay draws on, each tied to the page it quotes, are gathered with more pictures from
          the books in <Link href="/explore/histories/bath">a conceptual history of the bath</Link>.
        </P>
      </article>
    </ContentPageLayout>
  );
}
