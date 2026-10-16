/**
 * Where a book on Source Library comes from, as one honest sentence.
 *
 * Three different parties are involved and the book page used to blur them:
 * the institution that HOLDS the original (contributing_library), the party
 * that DIGITISED it (IA's `sponsor`), and the platform we took the scans FROM
 * (image_source.provider). "From the collection of Internet Archive" credited
 * the platform as owner (#6503 hid the section for platforms instead, which
 * left ~35k books with no provenance section at all).
 *
 * Rules, all from the record, nothing guessed:
 *   - a part we don't know is left out, never filled in with the platform;
 *   - we say what Source Library did (from the stamped translation rung),
 *     never what it hasn't done yet;
 *   - British spelling ("digitised").
 */
import { getPartnerByProvider, resolveHoldingLibrary, type LibraryPartner } from './library-partners';
import type { TranslationRung } from './page-counts';

/** Display names for values the importers stored. */
const NAME_ALIAS: Record<string, string> = {
  'Wellcome Library': 'Wellcome Collection', // same institution, renamed 2007
  'MSN': 'Microsoft', // Microsoft's 2006–08 book digitisation programme
  '浙江大学图书馆': 'Zhejiang University Library',
  'Robarts - University of Toronto': 'University of Toronto Libraries',
  'The Library of Congress': 'Library of Congress',
};

/** Sponsors that paid for the digitisation rather than doing it. Keyed by display name. */
const FUNDERS = new Set(['Microsoft']);

/** Platforms that aren't LIBRARY_PARTNERS entries, by provider key. Museums of
 *  India stores the museum itself in provider_name, so the portal is named here. */
const HOST_NAMES: Record<string, string> = { museumsofindia: 'Museums of India' };

/**
 * One-line descriptions, keyed by display name. Each is the institution's own
 * Wikidata description (QID noted) — checked by hand that the match is the
 * right institution; holders without a confident match get no line. BPH's is
 * shortened from its LIBRARY_PARTNERS description.
 */
const DESCRIPTIONS: Record<string, string> = {
  'Bibliotheca Philosophica Hermetica': 'Library of Hermetic, alchemical and mystical texts at the Embassy of the Free Mind, Amsterdam',
  'Zhejiang University Library': 'Chinese library system', // Q8070673
  'Bayerische Staatsbibliothek': 'State library of the Free State of Bavaria', // Q256507
  'Bavarian State Library': 'State library of the Free State of Bavaria', // Q256507
  'British Library': 'National library of the United Kingdom', // Q23308
  'National Central Library of Rome': 'Public national library in Rome, Italy', // Q6382871
  'Biblioteca Nazionale Centrale di Firenze': 'Public national library in Florence, Italy', // Q460907
  'Harvard Library': 'Library system of Harvard University', // Q3232931
  'Harvard University': 'Private university in Cambridge, Massachusetts', // Q13371
  'Staatsbibliothek zu Berlin': 'State library and heritage institution in Germany', // Q170109
  'Bibliothèque nationale de France': 'National library of France in Paris', // Q193563
  'SLUB Dresden': 'Combined state and university library in Dresden, Saxony, Germany', // Q323270
  'Wellcome Collection': 'Museum and library in London, United Kingdom', // Q7981191
  'John Carter Brown Library': 'Research library in Providence, Rhode Island, United States', // Q6225372
  'Biblioteca Medicea Laurenziana': 'Library in Florence, Italy', // Q856419
  'Metropolitan Museum of Art': 'Art museum in New York City, United States', // Q160236
  'Getty Research Institute': 'Organization with archives and databases for art history and provenance research', // Q11203476
  'Biblioteca Apostolica Vaticana': 'Library of the Holy See', // Q213678
  'Vatican Apostolic Library': 'Library of the Holy See', // Q213678
  'University of California Libraries': 'U.S. academic library system', // Q7895196
  'Boston Public Library': 'Library system in Boston, Massachusetts', // Q894583
  'Library of Congress': 'De facto national library of the United States of America', // Q131454
  'University of Michigan': 'Public research university in Ann Arbor, Michigan', // Q230492
  'Oxford University': 'Collegiate research university in Oxford, England', // Q34433
  'Bibliothèque interuniversitaire de santé (Paris)': 'Paris medical library', // Q867925
  'New York Public Library': 'Public library system in New York City', // Q219555
  'Duke University Libraries': 'Academic library system of Duke University, North Carolina', // Q5312898
  'Smithsonian Libraries': 'Smithsonian library system and institutional archives', // Q1609326
  'ETH-Bibliothek Zürich': 'University library of Zurich', // Q684773
  'Rijksmuseum': 'Museum in Amsterdam, Netherlands', // Q190804
  'Salar Jung Museum, Hyderabad': 'Art museum in Hyderabad, Telangana, India', // Q1864572
  'ETCSL (University of Oxford)': 'Digital database of Sumerian texts', // Q5358322
  'ETCSL (Oxford)': 'Digital database of Sumerian texts', // Q5358322
  'University of Oxford (ETCSL)': 'Digital database of Sumerian texts', // Q5358322
  // Platforms, shown under "From the scans on …" when the holder is unknown.
  'Internet Archive': 'U.S. non-profit organization and digital archive', // Q461
  'Wikimedia Commons': 'Online repository of free-use image, audio, and other media files', // Q565
  'e-rara': 'Swiss digital library for antique works', // Q1273325
};

/** Names that read with "the" inside a sentence ("belongs to the Wellcome Collection"). */
const TAKES_THE = /^(National|British|Smithsonian|Getty|Wellcome|Bibliotheca|Bibliothèque|Rijksmuseum|Salar|Vatican|Metropolitan|Bayerische|Bavarian|Biblioteca|John Carter|John Rylands|Library of Congress|New York Public|Koninklijke|University of|Staatsbibliothek|Bodleian|Herzog|Huntington|Morgan|Allard|Chester)/;

const displayName = (s: string | null | undefined) => {
  const t = (s || '').trim();
  return t ? (NAME_ALIAS[t] || t) : undefined;
};
const sameOrg = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const withThe = (name: string) => (TAKES_THE.test(name) ? `the ${name}` : name);

export interface ProvenanceSource {
  provider?: string | null;
  provider_name?: string | null;
  contributing_library?: string | null;
  sponsor?: string | null;
  source_url?: string | null;
}

export interface BookProvenance {
  /** Display name of the holding institution, if recorded. */
  holder?: string;
  /** The raw stored contributing_library behind `holder`, for catalogue queries. */
  holderKey?: string;
  /** The provider's partner entry, when it holds its own books (BPH, BSB…). */
  holdingPartner?: LibraryPartner;
  digitiser?: string;
  digitiserIsFunder: boolean;
  /** The platform the scans came from (Internet Archive, e-rara…), if not the holder. */
  host?: string;
  hostPartner?: LibraryPartner;
  sourceUrl?: string;
  description?: string;
}

export function resolveBookProvenance(src: ProvenanceSource | null | undefined): BookProvenance {
  const partner = src?.provider ? getPartnerByProvider(src.provider) : undefined;
  const holderRaw = resolveHoldingLibrary(src);
  const holder = displayName(holderRaw);
  const holdingPartner = partner && partner.kind !== 'platform' ? partner : undefined;
  const contributing = (src?.contributing_library || '').trim();
  const hostName = holdingPartner ? undefined : (partner?.name || HOST_NAMES[src?.provider || ''] || displayName(src?.provider_name));
  const host = hostName && !sameOrg(hostName, holder) ? hostName : undefined;
  const digitiser = displayName(src?.sponsor);
  return {
    holder,
    holderKey: holderRaw && holderRaw === contributing ? contributing : undefined,
    holdingPartner,
    digitiser,
    digitiserIsFunder: !!digitiser && FUNDERS.has(digitiser),
    host,
    hostPartner: host ? partner : undefined,
    sourceUrl: src?.source_url?.trim() || undefined,
    description: DESCRIPTIONS[holder || ''] || (!holder && host ? DESCRIPTIONS[host] : undefined),
  };
}

export interface ProvenanceWork {
  rung: TranslationRung | null;
  englishOriginal: boolean;
  translated: number;
  translatable: number;
  transcribed: number;
}

/** What Source Library has done, never what it hasn't. */
function workClause(w: ProvenanceWork): string {
  switch (w.rung) {
    case 'complete':
      return w.englishOriginal ? 'Source Library transcribed it.' : 'Source Library transcribed and translated it.';
    case 'readable':
    case 'translating':
      return w.englishOriginal || !w.translated || !w.translatable
        ? 'Source Library transcribed it.'
        : `Source Library transcribed it and has translated ${w.translated.toLocaleString('en')} of ${w.translatable.toLocaleString('en')} pages so far.`;
    case 'transcribed':
      return 'Source Library transcribed it.';
    case 'transcribing':
      return w.transcribed && w.translatable
        ? `Source Library is transcribing it (${w.transcribed.toLocaleString('en')} of ${w.translatable.toLocaleString('en')} pages so far).`
        : '';
    default:
      return '';
  }
}

export type ProvenanceKind = 'book' | 'object' | 'item';

/**
 * The sentence under the heading. `hasScans: false` is a text edition (ETCSL):
 * there is nothing digitised, and the work clause would credit us for text and
 * translations that are the edition's own.
 */
export function provenanceSentence(
  p: BookProvenance,
  opts: { kind: ProvenanceKind; hasScans: boolean; provider?: string | null; work: ProvenanceWork },
): string {
  if (!opts.hasScans) {
    return opts.provider === 'etcsl'
      ? 'A text edition with no page images. The Sumerian text and its English translation are both theirs.'
      : 'A text edition with no page images.';
  }
  const noun = opts.kind === 'book' ? 'This copy' : opts.kind === 'object' ? 'This object' : 'This item';
  let s = '';
  if (p.holder) {
    s = `${noun} ${opts.kind === 'book' ? 'belongs to' : 'is in the collection of'} ${withThe(p.holder)}`;
    if (!p.host || sameOrg(p.digitiser, p.holder)) s += ', who digitised it';
    else if (p.digitiser) s += p.digitiserIsFunder ? ` and was digitised with funding from ${p.digitiser}` : ` and was digitised by ${p.digitiser}`;
    s += '.';
  } else if (p.digitiser) {
    s = p.digitiserIsFunder ? `Digitised with funding from ${p.digitiser}.` : `Digitised by ${p.digitiser}.`;
  }
  const work = workClause(opts.work);
  return [s, work].filter(Boolean).join(' ');
}
