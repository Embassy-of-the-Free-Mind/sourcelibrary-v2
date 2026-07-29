import { describe, it, expect } from 'vitest';
import { resolveSourceCredit, holdingLibraryName, AGGREGATOR_PROVIDERS } from '@/lib/holding-library';
import { LIBRARY_PARTNERS } from '@/lib/library-partners';
import type { ImageSource } from '@/lib/types/image-source';

// The book page credited "From the collection of Internet Archive" on volumes
// physically held by someone else — Opera Chirurgica (1628) belongs to Fisher —
// University of Toronto, and IA only scanned and hosts it. The custodian was in
// the record all along (`contributing_library`); nothing read it as such.
//
// These fixtures are real `image_source` shapes from the production corpus, so
// a resolver that starts inventing or dropping credits fails here.

const src = (o: Partial<ImageSource>) => o as ImageSource;

describe('resolveSourceCredit — aggregators name a second institution', () => {
  it('credits the holding library on the book that prompted this', () => {
    const credit = resolveSourceCredit(
      src({
        provider: 'internet_archive',
        provider_name: 'Internet Archive',
        contributing_library: 'Fisher - University of Toronto',
      }),
      'Internet Archive',
    );
    expect(credit.holder).toBe('Fisher - University of Toronto');
    expect(credit.digitizer).toBe('Internet Archive');
  });

  it('credits the Swiss library behind an e-rara scan', () => {
    const credit = resolveSourceCredit(
      src({ provider: 'e-rara', contributing_library: 'Universitätsbibliothek Basel' }),
      'e-rara',
    );
    expect(credit.holder).toBe('Universitätsbibliothek Basel');
    expect(credit.digitizer).toBe('e-rara');
  });

  it('prefers an explicit digitized_by over the provider name', () => {
    const credit = resolveSourceCredit(
      src({
        provider: 'internet_archive',
        contributing_library: 'Wellcome Library',
        digitized_by: 'Wellcome Collection',
      }),
      'Internet Archive',
    );
    expect(credit.digitizer).toBe('Wellcome Collection');
  });
});

describe('resolveSourceCredit — fails closed rather than guessing', () => {
  // Every one of these strings is a real stored value. Promoting any of them to
  // "Held by …" would state something false more confidently than the old
  // single-line wording did.
  it.each([
    'Internet Archive',
    'IIIF Source',
    'unknown library',
    'Google Books (partner libraries)',
    'Unknown',
    '',
    '   ',
    '—',
  ])('treats %j as no custodian at all', (value) => {
    expect(
      resolveSourceCredit(src({ provider: 'internet_archive', contributing_library: value }), 'Internet Archive').holder,
    ).toBeNull();
    expect(holdingLibraryName(src({ contributing_library: value }))).toBeNull();
  });

  // Found by reading every distinct name the resolver would have credited
  // across the corpus — upstream contributor fields carry imprint statements,
  // BnF agent records, and text-dump sites, none of which hold a volume.
  it.each([
    ['Sumptibus Autoris', 'a 16th-c. imprint statement'],
    ['sumptibus haeredum authoris', 'the same, lowercased'],
    ['Basileae : Johannes Froben et Johannes Petri', 'a place-and-printer imprint'],
    ['Savage, John (actif 1690-1707). Graveur', 'an engraver, not a library'],
    ['Adélard de Bath (10..-1130). Traducteur', 'a translator'],
    ['Alten, Bartholomäus. Éditeur scientifique', 'a scholarly editor'],
    ['Library Genesis', 'a file-sharing site'],
    ['Project Gutenberg', 'an etext project holding no volume'],
    ['http://www.sacred-texts.com', 'a website'],
  ])('rejects %j — %s', (value) => {
    expect(holdingLibraryName(src({ contributing_library: value }))).toBeNull();
  });

  it('still credits real institutions with commas, roles or parentheses in the name', () => {
    // The rejection patterns must not swallow legitimate custodians.
    for (const name of [
      'Queen\'s University Library, W.D. Jordan Rare Books and Special Collections',
      'Harvard University, Museum of Comparative Zoology, Ernst Mayr Library',
      'Lyon Public Library (Bibliothèque jésuite des Fontaines)',
      'Private collection of Mark E. Andrews',
      'Bibliothèque universitaire des langues et civilisations (BULAC)',
      'Stiftung der Werke von C.G. Jung (Zürich)',
    ]) {
      expect(holdingLibraryName(src({ contributing_library: name })), name).toBe(name);
    }
  });

  it('gives no second credit when the custodian restates the host', () => {
    expect(
      resolveSourceCredit(
        src({ provider: 'internet_archive', contributing_library: 'internet archive.' }),
        'Internet Archive',
      ).holder,
    ).toBeNull();
  });

  it('gives no second credit for a missing or absent field', () => {
    expect(resolveSourceCredit(src({ provider: 'internet_archive' }), 'Internet Archive').holder).toBeNull();
    expect(resolveSourceCredit(null).holder).toBeNull();
    expect(resolveSourceCredit(undefined).holder).toBeNull();
  });
});

describe('resolveSourceCredit — self-digitizing partners are unchanged', () => {
  // A library scanning its own book has one credit, not two. Splitting it would
  // read as though the Bodleian's copy lived somewhere else.
  it.each([
    ['bodleian', 'Bodleian Library, University of Oxford', 'Bodleian Library'],
    ['mdz', 'Bayerische Staatsbibliothek (Munich)', 'Bavarian State Library (MDZ)'],
    ['gallica', 'Bibliothèque nationale de France', 'Gallica (BnF)'],
    ['bph', 'Embassy of the Free Mind (Bibliotheca Philosophica Hermetica)', 'BPH'],
  ] as const)('gives %s a single credit', (provider, contributing, partnerName) => {
    const credit = resolveSourceCredit(src({ provider, contributing_library: contributing }), partnerName);
    expect(credit.holder).toBeNull();
    expect(credit.digitizer).toBe(partnerName);
  });

  it('falls back to the custodian as digitizer ONLY off an aggregator', () => {
    // A self-digitizing library scanned its own book, so the field names the
    // digitizer too. The same fallback on an aggregator is the original bug.
    expect(
      resolveSourceCredit(src({ provider: 'bodleian', contributing_library: 'Bodleian Library, University of Oxford' }))
        .digitizer,
    ).toBe('Bodleian Library, University of Oxford');
    expect(
      resolveSourceCredit(src({ provider: 'internet_archive', contributing_library: 'Fisher - University of Toronto' }))
        .digitizer,
    ).toBeNull();
  });
});

describe('holdingLibraryName — details-panel rows', () => {
  it('names the custodian even when it is the provider itself', () => {
    // "Held by Bodleian Library" is true and belongs in a metadata row, even
    // though it earns no separate headline credit.
    expect(holdingLibraryName(src({ contributing_library: 'Bodleian Library, University of Oxford' }))).toBe(
      'Bodleian Library, University of Oxford',
    );
  });

  it('normalizes whitespace and trailing separators', () => {
    expect(holdingLibraryName(src({ contributing_library: '  Getty  Research   Institute , ' }))).toBe(
      'Getty Research Institute',
    );
  });
});

describe('AGGREGATOR_PROVIDERS', () => {
  it('names providers that actually exist as partners', () => {
    // A typo'd key would silently disable the credit for that provider.
    const known = new Set(Object.values(LIBRARY_PARTNERS).map((p) => p.providerKey));
    for (const provider of AGGREGATOR_PROVIDERS) {
      expect(known, `${provider} is not a providerKey in LIBRARY_PARTNERS`).toContain(provider);
    }
  });
});
