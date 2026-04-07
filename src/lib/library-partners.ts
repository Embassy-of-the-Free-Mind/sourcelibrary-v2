import type { ImageSourceProvider } from '@/lib/types/image-source';

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
  },
  'gallica': {
    slug: 'gallica',
    name: 'Gallica (BnF)',
    shortName: 'Gallica',
    providerKey: 'gallica',
    url: 'https://gallica.bnf.fr',
    description: 'Gallica is the digital library of the Bibliothèque nationale de France, providing free access to over 10 million documents including manuscripts, books, maps, and prints from one of the largest libraries in the world.',
    color: 'violet',
  },
  'bavarian-state-library': {
    slug: 'bavarian-state-library',
    name: 'Bavarian State Library (MDZ)',
    shortName: 'MDZ',
    providerKey: 'mdz',
    url: 'https://www.digitale-sammlungen.de',
    description: 'The Münchener DigitalisierungsZentrum (MDZ) is the digitization center of the Bayerische Staatsbibliothek, one of the most important research libraries in Europe. Their digital collections include over 3 million digitized pages of rare books and manuscripts.',
    color: 'sage',
  },
  'bodleian': {
    slug: 'bodleian',
    name: 'Bodleian Library',
    shortName: 'Bodleian',
    providerKey: 'bodleian',
    url: 'https://digital.bodleian.ox.ac.uk',
    description: 'The Bodleian Libraries at the University of Oxford form the largest university library system in the United Kingdom. Their Digital Bodleian platform provides access to rare books, manuscripts, and special collections spanning nearly a millennium.',
    color: 'rust',
  },
  'cambridge': {
    slug: 'cambridge',
    name: 'Cambridge Digital Library',
    shortName: 'CUDL',
    providerKey: 'cambridge',
    url: 'https://cudl.lib.cam.ac.uk',
    description: 'The Cambridge University Digital Library provides free online access to some of the University of Cambridge\'s most important collections, including Isaac Newton\'s papers, medieval manuscripts, and early printed books.',
    color: 'violet',
    heroImageOverride: 'https://images.sourcelibrary.org/archived/699065ad3dc2ed39a49f2387/77.jpg',
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
  },
  'e-rara': {
    slug: 'e-rara',
    name: 'e-rara',
    shortName: 'e-rara',
    providerKey: 'e-rara',
    url: 'https://www.e-rara.ch',
    description: 'e-rara.ch is the platform for digitized rare books from Swiss libraries. It provides free access to printed works from the 15th to the 20th century held by Swiss research libraries, with a focus on early printed books.',
    color: 'sage',
  },
  'wellcome-collection': {
    slug: 'wellcome-collection',
    name: 'Wellcome Collection',
    shortName: 'Wellcome',
    providerKey: 'wellcome',
    url: 'https://wellcomecollection.org',
    description: 'Wellcome Collection in London is a free museum and library exploring health, life, and our place in the world. Their digital collections include medical manuscripts, alchemical texts, and works on the history of science and medicine.',
    color: 'rust',
  },
  'hab-wolfenbuettel': {
    slug: 'hab-wolfenbuettel',
    name: 'Herzog August Bibliothek',
    shortName: 'HAB',
    providerKey: 'hab',
    url: 'https://diglib.hab.de',
    description: 'The Herzog August Bibliothek in Wolfenbüttel is one of the oldest and most important research libraries in Germany. It holds outstanding collections of medieval and early modern books and manuscripts, with extensive digital facsimiles.',
    color: 'gold',
  },
  'vatican-library': {
    slug: 'vatican-library',
    name: 'Vatican Apostolic Library',
    shortName: 'Vatican',
    providerKey: 'vatican',
    url: 'https://digi.vatlib.it',
    description: 'The Biblioteca Apostolica Vaticana is one of the oldest and most significant libraries in the world. DigiVatLib provides free access to digitized manuscripts, incunabula, and rare printed books from the Vatican\'s extraordinary collections.',
    color: 'violet',
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
  },
  'allard-pierson': {
    slug: 'allard-pierson',
    name: 'Allard Pierson',
    shortName: 'AP',
    providerKey: 'allard_pierson',
    url: 'https://allardpierson.nl',
    description: 'Allard Pierson at the University of Amsterdam houses the Bibliotheca Rosenthaliana and important collections of early printed books, manuscripts, and maps from the Dutch Golden Age and beyond.',
    color: 'gold',
  },
  'laurenziana': {
    slug: 'laurenziana',
    name: 'Biblioteca Medicea Laurenziana',
    shortName: 'Laurenziana',
    providerKey: 'laurenziana',
    url: 'https://www.bmlonline.it',
    description: 'The Biblioteca Medicea Laurenziana in Florence, designed by Michelangelo, holds the Medici family\'s manuscript collection — one of the most important repositories of Greek, Latin, and Hebrew manuscripts in the world.',
    color: 'violet',
  },
  'leiden': {
    slug: 'leiden',
    name: 'Leiden University Library',
    shortName: 'Leiden',
    providerKey: 'leiden',
    url: 'https://digitalcollections.universiteitleiden.nl',
    description: 'Leiden University Library, founded in 1575, holds the Scaliger collection of Oriental manuscripts, the Vossius collection of classical texts, and important Dutch Golden Age scientific works.',
    color: 'sage',
  },
  'e-codices': {
    slug: 'e-codices',
    name: 'e-codices',
    shortName: 'e-codices',
    providerKey: 'e-codices',
    url: 'https://www.e-codices.unifr.ch',
    description: 'e-codices is the Virtual Manuscript Library of Switzerland, providing free access to medieval and early modern manuscripts from Swiss libraries, abbeys, and private collections.',
    color: 'sage',
  },
  'chester-beatty': {
    slug: 'chester-beatty',
    name: 'Chester Beatty Library',
    shortName: 'CBL',
    providerKey: 'chester_beatty',
    url: 'https://chesterbeatty.ie',
    description: 'The Chester Beatty Library in Dublin holds one of the finest collections of Islamic manuscripts, East Asian art, and early Biblical papyri in the Western world, assembled by mining magnate Sir Alfred Chester Beatty.',
    color: 'gold',
  },
  'ndl-japan': {
    slug: 'ndl-japan',
    name: 'National Diet Library of Japan',
    shortName: 'NDL',
    providerKey: 'ndl_japan',
    url: 'https://dl.ndl.go.jp',
    description: 'The National Diet Library of Japan is the national library of Japan, providing digital access to rare Japanese books, manuscripts, maps, and prints spanning over a millennium of Japanese literary and scientific tradition.',
    color: 'rust',
  },

  // --- Other partners ---

  'kloss-collection': {
    slug: 'kloss-collection',
    name: 'Kloss Collection (CMC)',
    shortName: 'Kloss',
    providerKey: 'cmc_kloss',
    url: 'https://cmcdenhaag.nl',
    description: 'The Bibliotheca Klossiana at CMC Prins Frederik in The Hague preserves the collection of Georg Kloss (1787–1854), one of the most important Masonic, Rosicrucian, and esoteric manuscript collections in Europe.',
    color: 'gold',
  },
  'library-of-congress': {
    slug: 'library-of-congress',
    name: 'Library of Congress',
    shortName: 'LOC',
    providerKey: 'loc',
    url: 'https://www.loc.gov',
    description: 'The Library of Congress is the largest library in the world, with millions of items in its collections including books, recordings, photographs, newspapers, maps, and manuscripts spanning the history of human knowledge.',
    color: 'rust',
  },
  'british-library': {
    slug: 'british-library',
    name: 'British Library',
    shortName: 'BL',
    providerKey: 'bl',
    url: 'https://www.bl.uk',
    description: 'The British Library is the national library of the United Kingdom, holding over 150 million items. Its digitized collections include the Harley, Sloane, Cotton, and Royal manuscript collections spanning Greek, Latin, Arabic, and Hebrew traditions.',
    color: 'violet',
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
  },
  'penn-schoenberg': {
    slug: 'penn-schoenberg',
    name: 'Penn Schoenberg Collection',
    shortName: 'Penn',
    providerKey: 'penn_colenda',
    url: 'https://colenda.library.upenn.edu',
    description: 'The Lawrence J. Schoenberg Collection at the University of Pennsylvania holds important medieval scientific manuscripts. Penn also hosts OPenn, providing CC0 access to over 51,000 manuscripts from 30+ institutions.',
    color: 'sage',
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
  },
  'kyoto': {
    slug: 'kyoto',
    name: 'Kyoto University RMDA',
    shortName: 'Kyoto',
    providerKey: 'kyoto_rmda',
    url: 'https://rmda.kulib.kyoto-u.ac.jp',
    description: 'Kyoto University\'s Rare Materials Digital Archive provides access to Japanese rare books, natural history illustrations, architectural plans, and Meiji-era scientific materials from one of Japan\'s leading research universities.',
    color: 'sage',
  },
};

/** Look up a partner by its URL slug (e.g. "internet-archive") */
export function getPartnerBySlug(slug: string): LibraryPartner | undefined {
  return LIBRARY_PARTNERS[slug];
}

/** Look up a partner by its `image_source.provider` value (e.g. "internet_archive") */
export function getPartnerByProvider(provider: string): LibraryPartner | undefined {
  return Object.values(LIBRARY_PARTNERS).find(p => p.providerKey === provider);
}

/** Get all partner slugs for generateStaticParams */
export function getAllPartnerSlugs(): string[] {
  return Object.keys(LIBRARY_PARTNERS);
}
