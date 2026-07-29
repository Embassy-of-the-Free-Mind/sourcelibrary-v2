import { describe, it, expect } from 'vitest';
import { resolveSourceCredit, holdingLibraryName, canonicalHoldingLibrary, AGGREGATOR_PROVIDERS } from '@/lib/holding-library';
import * as twin from '../../scripts/lib/holding-library.mjs';
import corpusNames from '../fixtures/holding-library-names.json';
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

  it('refuses a non-string value, and its stringified form', () => {
    // Some records store an object here. The old catalog sync shipped it into a
    // text column, so Supabase held the literal "[object Object]" for those
    // books — which is why the page's old exclude list named that string.
    expect(holdingLibraryName({ contributing_library: { name: 'X' } as unknown as string })).toBeNull();
    expect(holdingLibraryName({ contributing_library: '[object Object]' })).toBeNull();
    expect(holdingLibraryName({ contributing_library: 123 as unknown as string })).toBeNull();
  });

  it('normalizes whitespace and trailing separators', () => {
    expect(holdingLibraryName(src({ contributing_library: '  Getty  Research   Institute , ' }))).toBe(
      'Getty Research Institute',
    );
  });
});

describe('canonicalHoldingLibrary — grouping for /libraries', () => {
  it('merges hand-verified spellings of one institution', () => {
    expect(canonicalHoldingLibrary('Bayerische Staatsbibliothek, Munich')).toBe('Bayerische Staatsbibliothek (Munich)');
    expect(canonicalHoldingLibrary('The Library of Congress')).toBe('Library of Congress');
    expect(canonicalHoldingLibrary('The Wellcome Library, London')).toBe('Wellcome Collection');
    expect(canonicalHoldingLibrary('University of Toronto - Kelly Library')).toBe('Kelly - University of Toronto');
  });

  it('never merges institutions that merely share words', () => {
    // Substring containment pairs these two; they are 5,000 miles apart.
    expect(canonicalHoldingLibrary('University of British Columbia Library')).toBe(
      'University of British Columbia Library',
    );
    expect(canonicalHoldingLibrary('British Library')).toBe('British Library');
    // ASCII-folding collapses both of these to the empty string.
    expect(canonicalHoldingLibrary('北京大學圖書館')).toBe('北京大學圖書館');
    expect(canonicalHoldingLibrary('浙江大学图书馆')).toBe('浙江大学图书馆');
  });

  it('keeps branch libraries distinct from their parent university', () => {
    // The whole point of the credit is naming WHICH library holds the volume.
    for (const branch of [
      'Fisher - University of Toronto',
      'Robarts - University of Toronto',
      'Gerstein - University of Toronto',
    ]) {
      expect(canonicalHoldingLibrary(branch)).toBe(branch);
    }
  });

  it('rejects museum acquisition credit lines, which name a donor not a holder', () => {
    for (const line of [
      'Rogers Fund, 1925',
      'Gift of Theodore M. Davis, 1909',
      'Purchase, Edward S. Harkness Gift, 1926',
      'Theodore M. Davis Collection, Bequest of Theodore M. Davis, 1915',
      'Harris Brisbane Dick Fund, 1957',
      'Anonymous Gift, 1931',
      'Museum Accession',
    ]) {
      expect(canonicalHoldingLibrary(line), line).toBeNull();
    }
  });

  it('does not let the acquisition-line rule swallow real institutions', () => {
    // "Fund"/"Gift" appear in legitimate names; the rule requires the donor
    // shape (a year, or an explicit gift/bequest/exchange clause).
    for (const name of [
      'Getty Research Institute',
      'Chicago Botanic Garden, Lenhardt Library',
      'Missouri Botanical Garden',
      'John Carter Brown Library',
      'Wellcome Collection',
    ]) {
      expect(canonicalHoldingLibrary(name), name).toBe(name);
    }
  });
});

describe('the --verify sweep compares on canonical names', () => {
  // harvest-holding-libraries.mjs --verify overwrites a stored custodian when
  // it canonicalizes differently from IA's. That comparison has to be able to
  // BOTH fire and stay quiet, or the sweep is either useless or destructive.

  it('fires on two genuinely different institutions', () => {
    // The real case: bub_gb_fgFLWoILS6YC is stored as Florence; IA says Rome.
    expect(canonicalHoldingLibrary('Biblioteca Nazionale Centrale di Firenze')).not.toBe(
      canonicalHoldingLibrary('National Central Library of Rome'),
    );
  });

  it('stays quiet on a mere spelling or language variant', () => {
    // Otherwise the sweep would "correct" thousands of records to a synonym,
    // churning data and inventing a changelog of non-changes.
    const pairs: [string, string][] = [
      ['The Wellcome Library, London', 'Wellcome Library'],
      ['Bayerische Staatsbibliothek, Munich', 'Bavarian State Library'],
      ['The Library of Congress', 'Library of Congress'],
      ['University of Toronto - Kelly Library', 'Kelly - University of Toronto'],
    ];
    for (const [a, b] of pairs) {
      expect(canonicalHoldingLibrary(a), `${a} vs ${b}`).toBe(canonicalHoldingLibrary(b));
    }
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

describe('PARITY: scripts/lib/holding-library.mjs vs src/lib/holding-library.ts', () => {
  // The harvest sweep decides which books still lack a custodian using the .mjs
  // twin; the site renders with the .ts original. If they disagree, the sweep
  // re-harvests books that already show a credit, or skips books that don't.
  // Checked over EVERY distinct custodian name in the corpus, not a sample.
  const names = (corpusNames as { name: string; n: number }[]).map((r) => r.name);

  it('covers the whole corpus fixture', () => {
    expect(names.length).toBeGreaterThan(250);
  });

  it('agrees on holdingLibraryName for every name', () => {
    const drift = names.filter(
      (n) => holdingLibraryName({ contributing_library: n }) !== twin.holdingLibraryName({ contributing_library: n }),
    );
    expect(drift, `drifted: ${drift.slice(0, 5).join(' | ')}`).toEqual([]);
  });

  it('agrees on canonicalHoldingLibrary for every name', () => {
    const drift = names.filter((n) => canonicalHoldingLibrary(n) !== twin.canonicalHoldingLibrary(n));
    expect(drift, `drifted: ${drift.slice(0, 5).join(' | ')}`).toEqual([]);
  });

  it('agrees on resolveSourceCredit across providers', () => {
    const providers = ['internet_archive', 'e-rara', 'bodleian', 'mdz', 'met', 'google_books'];
    const drift: string[] = [];
    for (const n of names) {
      for (const p of providers) {
        const s = { provider: p, contributing_library: n } as never;
        if (JSON.stringify(resolveSourceCredit(s, 'X')) !== JSON.stringify(twin.resolveSourceCredit(s, 'X')))
          drift.push(`${p}/${n}`);
      }
    }
    expect(drift, `drifted: ${drift.slice(0, 5).join(' | ')}`).toEqual([]);
  });

  it('exposes the same aggregator set', () => {
    expect([...twin.AGGREGATOR_PROVIDERS].sort()).toEqual([...AGGREGATOR_PROVIDERS].sort());
  });
});
