import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module, no types
import { normalizeLongS, detectLongSArtefacts, isCorrectionAcceptable } from '../../scripts/lib/early-modern-text.mjs';

describe('normalizeLongS', () => {
  it('normalises the long s and its ligatures', () => {
    expect(normalizeLongS('ſtands inveſted')).toBe('stands invested');
    expect(normalizeLongS('Triſmegiſtus')).toBe('Trismegistus');
    expect(normalizeLongS('ﬅate')).toBe('state');
  });

  it('leaves modern text untouched', () => {
    expect(normalizeLongS('stands invested')).toBe('stands invested');
    expect(normalizeLongS('')).toBe('');
  });
});

describe('detectLongSArtefacts', () => {
  // The real MinerU output that shipped to a visible page (Bacon 1763, p119).
  const MANGLED = 'The Confecration of this work untothe mot learned of PRINces. ' +
    'That the afpiring unto knowledge was the firft finne. ' +
    'That knowledgeinclines the Mind to Herefy and Atheifme.';

  it('flags f-for-long-s substitutions', () => {
    const r = detectLongSArtefacts(MANGLED);
    expect(r.count).toBeGreaterThan(3);
    expect(r.samples).toEqual(expect.arrayContaining(['confecration', 'afpiring', 'firft']));
  });

  it('flags residual literal long-s characters', () => {
    // The model emitted raw ſ instead of normalising on 1 of 3 pilot pages.
    const r = detectLongSArtefacts('ſtands inveſted with that triplicity');
    expect(r.rawLongS).toBe(2);
    expect(r.count).toBe(2);
  });

  it('does not fire on clean corrected text', () => {
    const clean = 'The Consecration of this work unto the most learned of PRINCES. ' +
      'That the aspiring unto knowledge was the first sinne.';
    expect(detectLongSArtefacts(clean).count).toBe(0);
  });

  it('does not fire on legitimate period spellings', () => {
    // These must survive: they are how the page is actually printed.
    const period = 'businesse individuall Vertue Atheisme shewed Originall Guilt';
    expect(detectLongSArtefacts(period).count).toBe(0);
  });

  // Regression: the first artefact list wrongly contained ordinary English words,
  // which rejected two correctly-corrected Bacon pages in the pilot dry-run.
  it('does not fire on ordinary English words', () => {
    const ordinary = 'That Learning is a thing infinite, and full of anxiety. ' +
      'The fire was lit. Nothing was reft from him.';
    expect(detectLongSArtefacts(ordinary).count).toBe(0);
  });
});

describe('isCorrectionAcceptable', () => {
  const MANGLED = 'the firft finne, Herefy and Atheifme, the Confecration, moft juft, thefe philofophers';

  it('accepts a clean correction', () => {
    const fixed = 'the first sinne, Heresy and Atheisme, the Consecration, most just, these philosophers';
    expect(isCorrectionAcceptable(fixed, MANGLED).ok).toBe(true);
  });

  // The load-bearing case: a pass that writes unimproved text is worse than no pass.
  it('REJECTS output that still carries the artefact', () => {
    const notFixed = 'the firft finne, Herefy and Atheifme, the Confecration';
    const v = isCorrectionAcceptable(notFixed, MANGLED);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/long-s artefacts remain/);
  });

  it('REJECTS output that merely swapped f for a literal long s', () => {
    const v = isCorrectionAcceptable('the firſt ſinne, Hereſy and Atheiſme, the Conſecration', MANGLED);
    expect(v.ok).toBe(false);
  });

  it('rejects empty output', () => {
    expect(isCorrectionAcceptable('', MANGLED).ok).toBe(false);
    expect(isCorrectionAcceptable('   ', MANGLED).ok).toBe(false);
  });

  it('tolerates a tiny residue on a large improvement', () => {
    const many = Array(40).fill('firft moft juft thefe').join(' ');
    const almost = Array(40).fill('first most just these').join(' ') + ' firft';
    expect(isCorrectionAcceptable(almost, many).ok).toBe(true);
  });
});
