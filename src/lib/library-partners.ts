import type { ImageSourceProvider } from '@/lib/types/image-source';

export interface LibraryPartner {
  slug: string;
  name: string;
  shortName: string;
  providerKey: ImageSourceProvider;
  url: string;
  description: string;
  color: 'rust' | 'sage' | 'violet' | 'gold';
}

/**
 * Static metadata for each digital library partner.
 * Keyed by URL slug. Add a partner here and redeploy — no DB changes needed.
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
    description: 'Gallica is the digital library of the Biblioth\u00e8que nationale de France, providing free access to over 10 million documents including manuscripts, books, maps, and prints from one of the largest libraries in the world.',
    color: 'violet',
  },
  'bavarian-state-library': {
    slug: 'bavarian-state-library',
    name: 'Bavarian State Library (MDZ)',
    shortName: 'MDZ',
    providerKey: 'mdz',
    url: 'https://www.digitale-sammlungen.de',
    description: 'The M\u00fcnchener DigitalisierungsZentrum (MDZ) is the digitization center of the Bayerische Staatsbibliothek, one of the most important research libraries in Europe. Their digital collections include over 3 million digitized pages of rare books and manuscripts.',
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
  },
  'embassy-of-the-free-mind': {
    slug: 'embassy-of-the-free-mind',
    name: 'Embassy of the Free Mind',
    shortName: 'EFM',
    providerKey: 'efm',
    url: 'https://embassyofthefreemind.com',
    description: 'The Embassy of the Free Mind in Amsterdam houses the Bibliotheca Philosophica Hermetica, one of the world\'s foremost collections of Hermetic, alchemical, mystical, and esoteric texts from the Renaissance to the present day.',
    color: 'gold',
  },
  'e-rara': {
    slug: 'e-rara',
    name: 'e-rara',
    shortName: 'e-rara',
    providerKey: 'e_rara',
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
    description: 'The Herzog August Bibliothek in Wolfenb\u00fcttel is one of the oldest and most important research libraries in Germany. It holds outstanding collections of medieval and early modern books and manuscripts, with extensive digital facsimiles.',
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
