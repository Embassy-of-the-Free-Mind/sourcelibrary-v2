import type { ImageSourceProvider } from '@/lib/types/image-source';
import { BPH_LOGO } from '@/lib/library-logos';

export interface LibraryPartner {
  slug: string;
  name: string;
  shortName: string;
  providerKey: ImageSourceProvider;
  url: string;
  description: string;
  color: 'rust' | 'sage' | 'violet' | 'gold';
  /** Hand-picked hero image URL — takes priority over auto-selected gallery images */
  heroImageOverride?: string;
  /** Institution logo (wordmark preferred — it carries the name). Must be on a
   *  CSP-allowed img host (archive.org, upload.wikimedia.org, images.sourcelibrary.org). */
  logo?: string;
  /** Has a BPH-style "Books | Catalogue" tab structure driven by a Supabase
   *  bibliographic export (library_catalog_records). When true, the tenant
   *  page renders <UnifiedCatalogue> instead of the plain books grid. The
   *  BPH-specific path (isBph branches) stays on its own bph_works pipeline
   *  until a follow-up migration consolidates the two. */
  hasUnifiedCatalogue?: boolean;
}

/**
 * Static metadata for each digital library partner.
 * Keyed by URL slug. Add a partner here and redeploy — no DB changes needed.
 * Partners only appear on /libraries when books exist with their providerKey.
 */
export const LIBRARY_PARTNERS: Record<string, LibraryPartner> = {
  'internet-archive': {
    slug: 'internet-archive',
    name: 'Internet Archive',
    shortName: 'IA',
    providerKey: 'internet_archive',
    url: 'https://archive.org',
    description: 'The Internet Archive is a non-profit digital library offering free access to millions of books, movies, and web pages. Their Open Library and book scanning initiatives have digitized millions of volumes from partner libraries worldwide.',
    color: 'rust',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69d0065c73df40dce83db54c/0006.jpg',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/8/84/Internet_Archive_logo_and_wordmark.svg',
  },
  'gallica': {
    slug: 'gallica',
    name: 'Gallica (BnF)',
    shortName: 'Gallica',
    providerKey: 'gallica',
    url: 'https://gallica.bnf.fr',
    description: 'Gallica is the digital library of the Bibliothèque nationale de France, providing free access to over 10 million documents including manuscripts, books, maps, and prints from one of the largest libraries in the world.',
    color: 'violet',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69a5ef41bfd8cafd91e44049/0022.jpg',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/c/c2/Gallica_logo.svg',
  },
  'bavarian-state-library': {
    slug: 'bavarian-state-library',
    name: 'Bavarian State Library (MDZ)',
    shortName: 'MDZ',
    providerKey: 'mdz',
    url: 'https://www.digitale-sammlungen.de',
    description: 'The Münchener DigitalisierungsZentrum (MDZ) is the digitization center of the Bayerische Staatsbibliothek, one of the most important research libraries in Europe. Their digital collections include over 3 million digitized pages of rare books and manuscripts.',
    color: 'sage',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69b51ec447b06ecd58196723/0002.jpg',
  },
  'bodleian': {
    slug: 'bodleian',
    name: 'Bodleian Library',
    shortName: 'Bodleian',
    providerKey: 'bodleian',
    url: 'https://digital.bodleian.ox.ac.uk',
    description: 'The Bodleian Libraries at the University of Oxford form the largest university library system in the United Kingdom. Their Digital Bodleian platform provides access to rare books, manuscripts, and special collections spanning nearly a millennium.',
    color: 'rust',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/8/8e/Bodleian_libraries_logo_june2015.png',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/699067d3249ce014347d422a/0014.jpg',
  },
  'cambridge': {
    slug: 'cambridge',
    name: 'Cambridge Digital Library',
    shortName: 'CUDL',
    providerKey: 'cambridge',
    url: 'https://cudl.lib.cam.ac.uk',
    description: 'The Cambridge University Digital Library provides free online access to some of the University of Cambridge\'s most important collections, including Isaac Newton\'s papers, medieval manuscripts, and early printed books.',
    color: 'violet',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69907bdc5f855ec553e7177b/0001.jpg',
  },
  'bibliotheca-philosophica-hermetica': {
    slug: 'bibliotheca-philosophica-hermetica',
    name: 'Bibliotheca Philosophica Hermetica',
    shortName: 'BPH',
    providerKey: 'bph',
    url: 'https://embassyofthefreemind.com',
    description: 'The Embassy of the Free Mind in Amsterdam houses the Bibliotheca Philosophica Hermetica, one of the world\'s foremost collections of Hermetic, alchemical, mystical, and esoteric texts from the Renaissance to the present day.',
    color: 'gold',
    heroImageOverride: 'https://images.sourcelibrary.org/archived/6867c580aadfee9e955eca92/200.jpg',
    logo: BPH_LOGO,
  },
  'e-rara': {
    slug: 'e-rara',
    name: 'e-rara',
    shortName: 'e-rara',
    providerKey: 'e-rara',
    url: 'https://www.e-rara.ch',
    description: 'e-rara.ch is the platform for digitized rare books from Swiss libraries. It provides free access to printed works from the 15th to the 20th century held by Swiss research libraries, with a focus on early printed books.',
    color: 'sage',
    heroImageOverride: 'https://images.sourcelibrary.org/archived/69b69ff8080b19f98fd128a3/2.jpg',
  },
  'wellcome-collection': {
    slug: 'wellcome-collection',
    name: 'Wellcome Collection',
    shortName: 'Wellcome',
    providerKey: 'wellcome',
    url: 'https://wellcomecollection.org',
    description: 'Wellcome Collection in London is a free museum and library exploring health, life, and our place in the world. Their digital collections include medical manuscripts, alchemical texts, and works on the history of science and medicine.',
    color: 'rust',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/6991d8978c1030b12444c035/0047.jpg',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/c/ce/Wellcome_Collection_logo.svg',
  },
  'hab-wolfenbuettel': {
    slug: 'hab-wolfenbuettel',
    name: 'Herzog August Bibliothek',
    shortName: 'HAB',
    providerKey: 'hab',
    url: 'https://diglib.hab.de',
    description: 'The Herzog August Bibliothek in Wolfenbüttel is one of the oldest and most important research libraries in Germany. It holds outstanding collections of medieval and early modern books and manuscripts, with extensive digital facsimiles.',
    color: 'gold',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69b51e0dcf111105c42961ed/0003.jpg',
  },
  'vatican-library': {
    slug: 'vatican-library',
    name: 'Vatican Apostolic Library',
    shortName: 'Vatican',
    providerKey: 'vatican',
    url: 'https://digi.vatlib.it',
    description: 'The Biblioteca Apostolica Vaticana is one of the oldest and most significant libraries in the world. DigiVatLib provides free access to digitized manuscripts, incunabula, and rare printed books from the Vatican\'s extraordinary collections.',
    color: 'violet',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/d/de/Vatican_Library_Logo.svg',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69a5e476006a4098422172b0/0443.jpg',
  },
  'google-books': {
    slug: 'google-books',
    name: 'Google Books',
    shortName: 'Google',
    providerKey: 'google_books',
    url: 'https://books.google.com',
    description: 'Google Books has digitized millions of volumes in partnership with major research libraries worldwide. Source Library imports Google Books content via Internet Archive mirrors, which host the digitized page images.',
    color: 'sage',
    heroImageOverride: 'https://images.sourcelibrary.org/archived/6991ebe2e93551dd846a79cd/4.jpg',
  },
  'hathi-trust': {
    slug: 'hathi-trust',
    name: 'HathiTrust Digital Library',
    shortName: 'HathiTrust',
    providerKey: 'hathi_trust',
    url: 'https://www.hathitrust.org',
    description: 'HathiTrust is a partnership of academic and research institutions offering a collection of millions of digitized titles from the libraries of member institutions, preserving cultural heritage through collaborative digital preservation.',
    color: 'rust',
  },
  'europeana': {
    slug: 'europeana',
    name: 'Europeana',
    shortName: 'Europeana',
    providerKey: 'europeana',
    url: 'https://www.europeana.eu',
    description: 'Europeana is the European Union\'s digital platform for cultural heritage, aggregating metadata and digital objects from thousands of European museums, libraries, archives, and galleries into a single searchable collection.',
    color: 'gold',
  },

  // --- IIIF-sourced libraries (institutional collections) ---

  'manchester': {
    slug: 'manchester',
    name: 'John Rylands Library',
    shortName: 'Manchester',
    providerKey: 'manchester',
    url: 'https://www.digitalcollections.manchester.ac.uk',
    description: 'The John Rylands Library at the University of Manchester holds exceptional collections of medieval manuscripts, early printed books, and the Gaster Collection of Hebrew and Samaritan amulets and magical texts.',
    color: 'rust',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69c1bb258522835be845d39d/0003.jpg',
  },
  'allard-pierson': {
    slug: 'allard-pierson',
    name: 'Allard Pierson',
    shortName: 'AP',
    providerKey: 'allard_pierson',
    url: 'https://allardpierson.nl',
    description: 'Allard Pierson at the University of Amsterdam houses the Bibliotheca Rosenthaliana and important collections of early printed books, manuscripts, and maps from the Dutch Golden Age and beyond.',
    color: 'gold',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69b525ce6be6046083032a57/0007.jpg',
  },
  'laurenziana': {
    slug: 'laurenziana',
    name: 'Biblioteca Medicea Laurenziana',
    shortName: 'Laurenziana',
    providerKey: 'laurenziana',
    url: 'https://www.bmlonline.it',
    description: 'The Biblioteca Medicea Laurenziana in Florence, designed by Michelangelo, holds the Medici family\'s manuscript collection — one of the most important repositories of Greek, Latin, and Hebrew manuscripts in the world.',
    color: 'violet',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69b52c393dd6d9423027eb56/0003.jpg',
  },
  'marciana': {
    slug: 'marciana',
    name: 'Biblioteca Nazionale Marciana',
    shortName: 'Marciana',
    providerKey: 'marciana',
    url: 'https://bibliotecanazionalemarciana.cultura.gov.it',
    description: 'The Biblioteca Nazionale Marciana in Venice, founded on Cardinal Bessarion\'s 1468 bequest of his Greek library, is one of the greatest surviving collections of Greek manuscripts. Among its treasures is the Codex Marcianus (Gr. Z. 299), the earliest and most important witness to the corpus of the Greek alchemists.',
    color: 'gold',
    heroImageOverride: 'https://images.sourcelibrary.org/manuscripts/marciana-gr-299/399.jpg',
  },
  'leiden': {
    slug: 'leiden',
    name: 'Leiden University Library',
    shortName: 'Leiden',
    providerKey: 'leiden',
    url: 'https://digitalcollections.universiteitleiden.nl',
    description: 'Leiden University Library, founded in 1575, holds the Scaliger collection of Oriental manuscripts, the Vossius collection of classical texts, and important Dutch Golden Age scientific works.',
    color: 'sage',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/6991c57d3074a1745a4118d2/0004.jpg',
  },
  'e-codices': {
    slug: 'e-codices',
    name: 'e-codices',
    shortName: 'e-codices',
    providerKey: 'e-codices',
    url: 'https://www.e-codices.unifr.ch',
    description: 'e-codices is the Virtual Manuscript Library of Switzerland, providing free access to medieval and early modern manuscripts from Swiss libraries, abbeys, and private collections.',
    color: 'sage',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/699066472ec9f7db57179ee2/0002.jpg',
  },
  'chester-beatty': {
    slug: 'chester-beatty',
    name: 'Chester Beatty Library',
    shortName: 'CBL',
    providerKey: 'chester_beatty',
    url: 'https://chesterbeatty.ie',
    description: 'The Chester Beatty Library in Dublin holds one of the finest collections of Islamic manuscripts, East Asian art, and early Biblical papyri in the Western world, assembled by mining magnate Sir Alfred Chester Beatty.',
    color: 'gold',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69c1b79ffe4b8f25b9200411/0008.jpg',
  },
  'ndl-japan': {
    slug: 'ndl-japan',
    name: 'National Diet Library of Japan',
    shortName: 'NDL',
    providerKey: 'ndl_japan',
    url: 'https://dl.ndl.go.jp',
    description: 'The National Diet Library of Japan is the national library of Japan, providing digital access to rare Japanese books, manuscripts, maps, and prints spanning over a millennium of Japanese literary and scientific tradition.',
    color: 'rust',
    heroImageOverride: 'https://images.sourcelibrary.org/hero/ndl_japan.jpg',
  },

  // --- Other partners ---

  // 'kloss-collection' (CMC Prins Frederik / Museum of Freemasonry) removed
  // 2026-07-08 at the museum's request, pending a partnership agreement.
  // All cmc_kloss books are hidden (hidden_reason: kloss_manuscripts_removed_2026-07-08)
  // and the kloss tenant is soft-disabled (tenants.status: 'deleted').
  'library-of-congress': {
    slug: 'library-of-congress',
    name: 'Library of Congress',
    shortName: 'LOC',
    providerKey: 'loc',
    url: 'https://www.loc.gov',
    description: 'The Library of Congress is the largest library in the world, with millions of items in its collections including books, recordings, photographs, newspapers, maps, and manuscripts spanning the history of human knowledge.',
    color: 'rust',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/b/be/Logo_of_the_United_States_Library_of_Congress.svg',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/6992f3d4dc69844b023ff228/0179.jpg',
  },
  'british-library': {
    slug: 'british-library',
    name: 'British Library',
    shortName: 'BL',
    providerKey: 'bl',
    url: 'https://www.bl.uk',
    description: 'The British Library is the national library of the United Kingdom, holding over 150 million items. Its digitized collections include the Harley, Sloane, Cotton, and Royal manuscript collections spanning Greek, Latin, Arabic, and Hebrew traditions.',
    color: 'violet',
    heroImageOverride: 'https://images.sourcelibrary.org/archived/6991bf67734f402cad489bb9/24.jpg',
  },
  'imslp': {
    slug: 'imslp',
    name: 'IMSLP / Petrucci Music Library',
    shortName: 'IMSLP',
    providerKey: 'imslp',
    url: 'https://imslp.org',
    description: 'The International Music Score Library Project (IMSLP), also known as the Petrucci Music Library, is a volunteer-run free library of public-domain musical scores and printed music. As a re-hosting digital library it preserves scans contributed from collections worldwide — the works held here come from the British Library copy of "The Apollonian Harmony" (ca. 1790), digitized through IMSLP.',
    color: 'gold',
    heroImageOverride: 'https://images.sourcelibrary.org/books/6a3cef9ba907e2ce38470f7a/pages/0000.jpg',
  },
  'sbb-berlin': {
    slug: 'sbb-berlin',
    name: 'Staatsbibliothek zu Berlin',
    shortName: 'SBB',
    providerKey: 'sbb',
    url: 'https://digital.staatsbibliothek-berlin.de',
    description: 'The Staatsbibliothek zu Berlin is one of the largest academic libraries in the German-speaking world. Its digital collections include VD16/VD17 early printed books, the Diez collection (Arabic, Persian, Turkish), and Hamilton manuscripts.',
    color: 'sage',
  },
  'austrian-national-library': {
    slug: 'austrian-national-library',
    name: 'Austrian National Library',
    shortName: 'ONB',
    providerKey: 'onb',
    url: 'https://digital.onb.ac.at',
    description: 'The Österreichische Nationalbibliothek in Vienna holds the Habsburg collections, including important Greek, Latin, and Oriental manuscripts. Its digital platform provides access to codices, maps, and early printed works.',
    color: 'gold',
  },
  'yale-beinecke': {
    slug: 'yale-beinecke',
    name: 'Yale Beinecke Library',
    shortName: 'Beinecke',
    providerKey: 'yale_beinecke',
    url: 'https://beinecke.library.yale.edu',
    description: 'The Beinecke Rare Book & Manuscript Library at Yale University houses one of the largest collections of rare books and manuscripts in the world, including the Voynich Manuscript, alchemical texts, and the Osborn Collection.',
    color: 'violet',
  },
  'harvard-houghton': {
    slug: 'harvard-houghton',
    name: 'Harvard Houghton Library',
    shortName: 'Houghton',
    providerKey: 'harvard',
    url: 'https://library.harvard.edu/libraries/houghton',
    description: 'The Houghton Library at Harvard University is the primary repository for rare books and manuscripts, housing the Islamic Heritage Project collection, medieval codices, incunabula, and extensive printing history materials.',
    color: 'rust',
    heroImageOverride: 'https://images.sourcelibrary.org/hero/harvard-houghton.jpg',
  },
  'penn-schoenberg': {
    slug: 'penn-schoenberg',
    name: 'Penn Schoenberg Collection',
    shortName: 'Penn',
    providerKey: 'penn_colenda',
    url: 'https://colenda.library.upenn.edu',
    description: 'The Lawrence J. Schoenberg Collection at the University of Pennsylvania holds important medieval scientific manuscripts. Penn also hosts OPenn, providing CC0 access to over 51,000 manuscripts from 30+ institutions.',
    color: 'sage',
    heroImageOverride: 'https://images.sourcelibrary.org/hero/penn_colenda.jpg',
  },
  'byu': {
    slug: 'byu',
    name: 'Brigham Young University, L. Tom Perry Special Collections',
    shortName: 'BYU',
    providerKey: 'byu',
    url: 'https://sc.lib.byu.edu',
    description: 'The L. Tom Perry Special Collections at Brigham Young University holds the William Gates papers (MSS 279) — the working archive of the Maya scholar and publisher William E. Gates (1863-1940), who spent decades photographing and photostatting Mesoamerican manuscripts. For several of the Books of Chilam Balam, the Yucatec Maya manuscript books of prophecy, chronicle, medicine and the calendar, the copies Gates made are the only surviving witness to originals that have since been lost.',
    color: 'violet',
  },
  'huntington': {
    slug: 'huntington',
    name: 'Huntington Library',
    shortName: 'Huntington',
    providerKey: 'huntington',
    url: 'https://www.huntington.org',
    description: 'The Huntington Library in San Marino, California holds the Ellesmere Chaucer, early English manuscripts, and the Burndy Library collection on the history of science. Its collections span medieval through early modern periods.',
    color: 'gold',
  },
  'getty': {
    slug: 'getty',
    name: 'Getty Research Institute',
    shortName: 'Getty',
    providerKey: 'getty',
    url: 'https://www.getty.edu/research',
    description: 'The Getty Research Institute in Los Angeles holds exceptional collections of alchemical manuscripts, emblem books, festival books, and art historical archives from the Renaissance through the early modern period.',
    color: 'violet',
    heroImageOverride: 'https://images.sourcelibrary.org/hero/getty-florentine.jpg',
  },
  'kyoto': {
    slug: 'kyoto',
    name: 'Kyoto University RMDA',
    shortName: 'Kyoto',
    providerKey: 'kyoto_rmda',
    url: 'https://rmda.kulib.kyoto-u.ac.jp',
    description: 'Kyoto University\'s Rare Materials Digital Archive provides access to Japanese rare books, natural history illustrations, architectural plans, and Meiji-era scientific materials from one of Japan\'s leading research universities.',
    color: 'sage',
    heroImageOverride: 'https://images.sourcelibrary.org/hero/kyoto_rmda.jpg',
  },
  'heidelberg': {
    slug: 'heidelberg',
    name: 'Heidelberg University Library',
    shortName: 'Heidelberg',
    providerKey: 'heidelberg',
    url: 'https://digi.ub.uni-heidelberg.de',
    description: 'Heidelberg University Library holds the Codex Manesse and important collections of medieval manuscripts, alchemical texts, and early printed books from one of Germany\'s oldest universities (founded 1386).',
    color: 'violet',
    heroImageOverride: 'https://images.sourcelibrary.org/hero/heidelberg.jpg',
  },
  'bdrc': {
    slug: 'bdrc',
    name: 'Buddhist Digital Resource Center',
    shortName: 'BDRC',
    providerKey: 'bdrc',
    url: 'https://www.bdrc.io',
    description: 'The Buddhist Digital Resource Center preserves and provides access to Buddhist literary heritage across Asia — Tibetan, Chinese, Sanskrit, and Pali manuscripts from monasteries, libraries, and private collections.',
    color: 'gold',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69dfee8cce6bb8619e07ff08/0003.jpg',
  },
  'met-museum': {
    slug: 'met-museum',
    name: 'Metropolitan Museum of Art',
    shortName: 'Met',
    providerKey: 'met',
    url: 'https://www.metmuseum.org',
    description: 'The Metropolitan Museum of Art in New York provides open access to its encyclopedic collection spanning 5,000 years, including Egyptian papyri, Islamic manuscripts, medieval art, and Asian calligraphy.',
    color: 'rust',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/7/73/The_Metropolitan_Museum_of_Art_Logo.svg',
    heroImageOverride: 'https://images.sourcelibrary.org/hero/met-book-of-dead.jpg',
  },
  'ndl': {
    slug: 'ndl',
    name: 'National Diet Library of Japan',
    shortName: 'NDL',
    providerKey: 'ndl',
    url: 'https://dl.ndl.go.jp',
    description: 'The National Diet Library is Japan\'s national library, providing digital access to rare Japanese books, Buddhist manuscripts, woodblock prints, and historical texts spanning over a millennium.',
    color: 'rust',
    heroImageOverride: 'https://images.sourcelibrary.org/hero/ndl-genji-monogatari.jpg',
  },
  'bsb': {
    slug: 'bsb',
    name: 'Bayerische Staatsbibliothek',
    shortName: 'BSB',
    providerKey: 'bsb',
    url: 'https://www.bsb-muenchen.de',
    description: 'The Bavarian State Library in Munich holds one of Europe\'s most important manuscript collections, with extensive holdings of medieval codices, incunabula, and East Asian manuscripts including the Turfan collection.',
    color: 'sage',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69b51e0dcf111105c42961ed/0003.jpg',
  },
  'v-and-a': {
    slug: 'v-and-a',
    name: 'Victoria & Albert Museum',
    shortName: 'V&A',
    providerKey: 'v_and_a',
    url: 'https://www.vam.ac.uk',
    description: 'The Victoria and Albert Museum in London is the world\'s leading museum of art, design, and performance. Its collections include Leonardo da Vinci\'s notebooks (Codex Forster), Islamic art, and medieval manuscripts.',
    color: 'violet',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/d/d7/Victoria_and_Albert_Museum_Logo.svg',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/6991e70cebc7adff9a0b21e6/0003.jpg',
  },
  'tu-delft': {
    slug: 'tu-delft',
    name: 'TU Delft Library',
    shortName: 'TU Delft',
    providerKey: 'tu_delft',
    url: 'https://www.tudelft.nl/library',
    description: 'TU Delft Library\'s Trésor collection holds rare atlases, maps, and illustrated works of cartography and early science, including the magnificent Civitates Orbis Terrarum city views.',
    color: 'sage',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69b337c8fe4656c3777f3a85/0003.jpg',
  },
  'qatar-digital-library': {
    slug: 'qatar-digital-library',
    name: 'Qatar Digital Library',
    shortName: 'QDL',
    providerKey: 'qdl',
    url: 'https://www.qdl.qa',
    description: 'The Qatar Digital Library, a partnership between the British Library and Qatar Foundation, provides access to Arabic scientific manuscripts, historical records of the Gulf region, and maps from British India Office archives.',
    color: 'gold',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69a5efb5bfd8cafd91e44089/0003.jpg',
  },
  'escorial': {
    slug: 'escorial',
    name: 'Real Biblioteca del Escorial',
    shortName: 'Escorial',
    providerKey: 'escorial',
    url: 'https://rbme.patrimonionacional.es',
    description: 'The Royal Library of El Escorial near Madrid, built by Philip II, houses the Libro de los Juegos of Alfonso X and important Arabic, Hebrew, and Latin manuscripts from the Spanish Golden Age.',
    color: 'gold',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69a5e9fd787d6e9b8d42ea49/0003.jpg',
  },
  'sat-daizokyo': {
    slug: 'sat-daizokyo',
    name: 'SAT Daizokyo',
    shortName: 'SAT',
    providerKey: 'sat_daizokyo',
    url: 'https://21dzk.l.u-tokyo.ac.jp/SAT/',
    description: 'The SAT Daizokyo Text Database at the University of Tokyo provides digital access to the Taishō Shinshū Daizōkyō, the standard modern edition of the Chinese Buddhist canon containing over 3,000 texts.',
    color: 'gold',
  },
  'tu-darmstadt': {
    slug: 'tu-darmstadt',
    name: 'TU Darmstadt',
    shortName: 'TU Darmstadt',
    providerKey: 'tu_darmstadt',
    url: 'https://tudigit.ulb.tu-darmstadt.de',
    description: 'The Universitäts- und Landesbibliothek Darmstadt holds important collections of incunabula and early printed books, including scholastic philosophy, natural philosophy, and medieval theological texts.',
    color: 'sage',
  },
  'oraec': {
    slug: 'oraec',
    name: 'ORAEC (Ancient Egyptian Texts)',
    shortName: 'ORAEC',
    providerKey: 'oraec',
    url: 'https://oraec.github.io',
    description: 'The Online Resource for Ancient Egyptian Coffin Texts provides digitized hieratic manuscripts from ancient Egyptian sarcophagi, including the Coffin Texts, the Book of the Dead, and the Report of Wenamun.',
    color: 'rust',
    heroImageOverride: 'https://images.sourcelibrary.org/pages/69e1582bec0a328a49d0a24c/0003.jpg',
  },
};

/**
 * Short-slug aliases mapping convenient short codes (e.g. "bph") to the
 * canonical long slug. Keeps URLs like /libraries/bph working alongside
 * the canonical /libraries/bibliotheca-philosophica-hermetica.
 */
const PARTNER_SLUG_ALIASES: Record<string, string> = {
  'bph': 'bibliotheca-philosophica-hermetica',
};

/** Look up a partner by its URL slug (e.g. "internet-archive" or "bph") */
export function getPartnerBySlug(slug: string): LibraryPartner | undefined {
  if (LIBRARY_PARTNERS[slug]) return LIBRARY_PARTNERS[slug];
  const aliasTarget = PARTNER_SLUG_ALIASES[slug];
  return aliasTarget ? LIBRARY_PARTNERS[aliasTarget] : undefined;
}

/** Look up a partner by its `image_source.provider` value (e.g. "internet_archive") */
export function getPartnerByProvider(provider: string): LibraryPartner | undefined {
  return Object.values(LIBRARY_PARTNERS).find(p => p.providerKey === provider);
}

/** Get all partner slugs for generateStaticParams */
export function getAllPartnerSlugs(): string[] {
  return Object.keys(LIBRARY_PARTNERS);
}
