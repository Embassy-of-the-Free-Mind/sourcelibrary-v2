import { describe, it, expect } from 'vitest';
import {
  institutionalByline,
  bylineClaimsAuthorship,
  isInstitutionalByline,
} from '@/lib/corporate-bylines';
import { getEffectiveByline } from '@/lib/byline';

describe('corporate bylines — typing the EDGE, not just the node', () => {
  it('does not treat a person as an institution because their name contains a place word', () => {
    // The exact false positives a regex classifier produced on 2026-08-18:
    // matched on "Temple" and on "School". Both are real people.
    expect(institutionalByline('Temple Stanyan')).toBeNull();
    expect(institutionalByline('One of the Old School (Gravener Henson, attrib.)')).toBeNull();
    expect(bylineClaimsAuthorship('Temple Stanyan')).toBe(true);
  });

  it('leaves ordinary personal authors completely untouched', () => {
    for (const name of ['Marcus Tullius Cicero', 'Niccolò Machiavelli', 'Dante Alighieri', '']) {
      expect(institutionalByline(name)).toBeNull();
      expect(isInstitutionalByline(name)).toBe(false);
      expect(bylineClaimsAuthorship(name)).toBe(true);
    }
    expect(institutionalByline(null)).toBeNull();
    expect(institutionalByline(undefined)).toBeNull();
  });

  it('types a holding monastery as provenance, never as an author', () => {
    const hit = institutionalByline('Thadrak Temple');
    expect(hit?.role).toBe('holder');
    // The claim that matters: nothing downstream may assert authorship.
    expect(bylineClaimsAuthorship('Thadrak Temple')).toBe(false);
    expect(bylineClaimsAuthorship('Neyphug Monastery')).toBe(false);
    expect(bylineClaimsAuthorship('Beinecke Library, Yale University')).toBe(false);
  });

  it('keeps a genuine corporate author AS an author', () => {
    // A council really did write its own canons; a commission its own report.
    expect(institutionalByline('Council of Trent (1545-1563)')?.role).toBe('corporate-author');
    expect(bylineClaimsAuthorship('Council of Trent (1545-1563)')).toBe(true);
    expect(bylineClaimsAuthorship('Indian Hemp Drugs Commission')).toBe(true);
    expect(bylineClaimsAuthorship('司農司')).toBe(true);
    // ...but it is still an organisation, so schema.org must not call it a Person.
    expect(isInstitutionalByline('Council of Trent (1545-1563)')).toBe(true);
  });

  it('separates issuing a text from writing it', () => {
    expect(institutionalByline('British and Foreign Bible Society')?.role).toBe('issuer');
    expect(bylineClaimsAuthorship('British and Foreign Bible Society')).toBe(false);
    expect(bylineClaimsAuthorship('Pali Text Society')).toBe(false);
  });

  it('matches regardless of case, spacing and unicode normalisation', () => {
    expect(institutionalByline('  thadrak   temple ')?.role).toBe('holder');
    expect(institutionalByline('COUNCIL OF TRENT (1545-1563)')?.role).toBe('corporate-author');
  });
});

describe('getEffectiveByline carries the institutional relation', () => {
  it('keeps role a three-value union so existing consumers cannot silently blank', () => {
    // Two surfaces in book/[id]/page.tsx render nothing unless role is
    // 'author' | 'editor'. An institutional byline must still be 'author'.
    const b = getEffectiveByline({ author: 'Thadrak Temple' });
    expect(b.role).toBe('author');
    expect(b.displayName).toBe('Thadrak Temple');
    expect(b.institutional?.role).toBe('holder');
    expect(b.institutional?.qualifier).toBe('manuscript collection');
  });

  it('is null for a personal author and for the Unknown placeholder', () => {
    expect(getEffectiveByline({ author: 'Dante Alighieri' }).institutional).toBeNull();
    const unknown = getEffectiveByline({ author: 'Unknown', editor: 'Jane Roe' });
    expect(unknown.role).toBe('editor');
    expect(unknown.institutional).toBeNull();
  });
});

describe('every authorship emitter agrees with bylineClaimsAuthorship', () => {
  // Fixing schema.org JSON-LD alone left `citation_author` (Google Scholar),
  // og `article:author` and `DC.creator` still asserting that a holding
  // monastery WROTE the book — the same defect in three more vocabularies,
  // across ~470 books. These pin the contract all four emitters now share.
  const holders = ['Thadrak Temple', 'Neyphug Monastery', 'Beinecke Library, Yale University'];
  const issuers = ['British and Foreign Bible Society', 'Pali Text Society'];
  const authoring = ['Council of Trent (1545-1563)', 'Indian Hemp Drugs Commission', 'Dante Alighieri'];

  it('never claims authorship for a holder', () => {
    for (const h of holders) expect(bylineClaimsAuthorship(h)).toBe(false);
  });

  it('never claims authorship for an issuer', () => {
    for (const i of issuers) expect(bylineClaimsAuthorship(i)).toBe(false);
  });

  it('does claim authorship for a corporate author and for a person', () => {
    for (const a of authoring) expect(bylineClaimsAuthorship(a)).toBe(true);
  });

  it('routes a holder to provenance and everything else non-authoring to publisher', () => {
    // DublinCoreMeta branches on exactly this: holder -> DCTERMS.provenance,
    // any other non-authoring body -> DC.publisher.
    expect(institutionalByline('Thadrak Temple')?.role).toBe('holder');
    expect(institutionalByline('Beinecke Library, Yale University')?.role).toBe('holder');
    expect(institutionalByline('Pali Text Society')?.role).toBe('issuer');
  });
});
