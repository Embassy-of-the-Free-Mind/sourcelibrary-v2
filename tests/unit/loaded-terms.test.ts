/**
 * Loaded-term renderings (#7475): the predicate must fire on the evidence pages that started it
 * (pre-fix English) and stay silent on the false-positive families measured in the two by-eye
 * samples of 2026-10-27 (glossed terms, evil-qualified demons, Christian shelves, English books).
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { loadWatchlist, classesForLanguage, screenPage, foldText } from '../../scripts/lib/loaded-terms.mjs';

const classes = loadWatchlist();
const screen = (lang: string, ocr: string, translation: string, opts: { collections?: string[]; alignment?: unknown[] } = {}) =>
  (screenPage({ ocr, translation, alignment: opts.alignment }, classesForLanguage(classes, lang, opts.collections ?? []), { window: 1 }) as { class: string; mode: string }[]);
const ids = (h: { class: string }[]) => h.map((x) => x.class);

describe('fires on #7475 evidence (pre-fix English)', () => {
  it('Lassalle, Herakleitos p460: ἦθος ἀνθρώπῳ δαίμων → "a demon"', () => {
    expect(ids(screen('German', 'ἦθος ἀνθρώπῳ δαίμων', 'Character is to man a demon.'))).toContain('daimon-greek');
  });
  it('Elzevir NT p130: οἱ δαίμονες → "the devils"', () => {
    expect(ids(screen('Greek', 'καὶ παρεκάλεσαν αὐτὸν πάντες οἱ δαίμονες', 'And all the devils besought him'))).toContain('daimon-greek');
  });
  it('Zishi jinghua p139: 巫 → "sorcery"', () => {
    expect(ids(screen('Chinese', '古者巫咸作筮', 'In antiquity Wu Xian practised sorcery.'))).toContain('wu-chinese');
  });
  it('Vives p271: veneficium → "sorcery"', () => {
    expect(ids(screen('Latin', 'de veneficio et incantationibus', 'on sorcery and incantations'))).toContain('veneficium-latin');
  });
  it('Martius p24: ὁ Μάγος → "the Magician"', () => {
    expect(ids(screen('German', 'ὁ Μάγος, ein weiser Mann', 'the Magician, a wise man'))).toContain('magus');
  });
  it('Kathāsaritsāgara p167: vidyāḥ → "magic sciences"', () => {
    expect(ids(screen('Sanskrit', 'विद्याः', 'the magic sciences'))).toContain('vidya-maya-sanskrit');
  });
  it('Ficino Hermes: bonus demon → "the good demon" (sample 1, true positive)', () => {
    expect(ids(screen('Latin', 'etenim bonus demon deos quidem predicat', 'for indeed the good demon proclaims gods'))).toContain('daemon-latin');
  });
});

describe('stays silent on measured false-positive families', () => {
  it('English-language books are never screened', () => {
    expect(classesForLanguage(classes, 'English')).toEqual([]);
  });
  it('the translator kept the term: "daimon (demon)"', () => {
    expect(screen('Greek', 'ἦθος ἀνθρώπῳ δαίμων', 'Character is to man a daimon (demon).')).toEqual([]);
  });
  it('a translator note several words away keeps "daemon"', () => {
    const en = 'of a daemon <note>original: dæmonis; in neoplatonism, a "daemon" is a benevolent guiding spirit or intermediary between gods and humans, not an evil "demon" in the modern sense.</note>';
    expect(ids(screen('Latin', 'afflatu quodam dæmonis', en))).not.toContain('daemon-latin');
  });
  it('the source marks the spirit evil: mali daemones → "evil demons"', () => {
    expect(screen('Latin', 'a malis puto daemonibus repertae sunt', 'were discovered by evil demons')).toEqual([]);
  });
  it('Christian/demonology shelves skip the daemon classes', () => {
    expect(screen('Latin', 'a demonibus transportati', 'carried by demons', { collections: ['demonology'] })).toEqual([]);
  });
  it('Latin "magis" (more) is not magus', () => {
    expect(screen('Latin', 'uel si magis placet', 'or, if the magician prefers')).toEqual([]);
  });
  it('an alignment pair sending the term to neutral English overrides position', () => {
    const alignment = [{ s: 'δαίμων', t: 'guardian spirit', so: 0, to: 0 }];
    expect(screen('Greek', 'δαίμων', 'a guardian spirit; elsewhere demons', { alignment })).toEqual([]);
  });
});

describe('folding', () => {
  it('strips Greek accents and final sigma, keeps Devanagari vowel signs', () => {
    expect(foldText('Δαίμονες')).toBe('δαιμονεσ');
    expect(foldText('विद्या')).toBe('विद्या');
  });
});
