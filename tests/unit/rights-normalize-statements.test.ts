import { describe, it, expect } from 'vitest';
// @ts-expect-error untyped .mjs helper
import { classifyToken, classifyStored, readManifestRights } from '../../scripts/lib/rights-normalize.mjs';

// #7771, 2026-10-30: two statements read backwards by the copyright-only fallback.
describe('No Known Copyright prose is public domain, not in copyright', () => {
  const nkc = [
    'The Library of Congress is unaware of any copyright restrictions for this item.',
    'The Library of Congress is unaware of any copyright restrictions on this item.',
    'The Library of Congress is unaware of any copyright or other restrictions in the Islamic Manuscripts from Mali collection.',
    'The National Institutes of Health are unaware of any possible copyright restrictions for this item.',
    'Not in copyright. The Library knows of no copyright restrictions on this item.',
    'Copyright status reviewed by UF staff - Out of copyright',
  ];
  for (const s of nkc) it(s.slice(0, 60), () => expect(classifyToken(s)?.class).toBe('public-domain'));

  it('an IA item whose rights field carries the LoC statement classifies as public domain', () => {
    const r = classifyStored({ license: 'publicdomain', rights: nkc[0], provider: 'internet_archive' });
    expect(r.class).toBe('public-domain');
    expect(r.status).toBe('stated');
  });

  it('real copyright statements still read as in copyright', () => {
    expect(classifyToken('All rights reserved by the Newberry Library.')?.class).toBe('in-copyright');
    expect(classifyToken('It is possible this Item is protected by copyright and/or related rights.')?.class).toBe('in-copyright');
    expect(classifyToken('© 2004 Brill')?.class).toBe('in-copyright');
  });
});

describe("BL's reuse notice is terms of use, not in copyright", () => {
  const BL = 'Except as otherwise permitted under your national copyright law this material may not be copied or distributed further';
  it('a manifest whose only statement is the notice', () => {
    const r = readManifestRights({ '@context': 'http://iiif.io/api/presentation/3/context.json', requiredStatement: { label: { en: ['Attribution'] }, value: { en: [BL] } } });
    expect(r.class).toBe('terms-of-use');
    expect(r.terms_text).toContain('national copyright law');
  });
  it('a stated licence beside the notice still wins', () => {
    const r = readManifestRights({ rights: 'https://creativecommons.org/publicdomain/mark/1.0/', requiredStatement: { label: { en: ['Attribution'] }, value: { en: [BL] } } });
    expect(r.class).toBe('public-domain');
  });
});
