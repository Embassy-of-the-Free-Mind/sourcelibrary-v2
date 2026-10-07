import { describe, it, expect } from 'vitest';
import { rereadVerdict, storedLoops, decide, allowedScripts, bodyScript } from '../../scripts/lib/reread-verdict.mjs';
import { loopVerdict } from '../../scripts/lib/ocr-loop-guard.mjs';

/**
 * The verdict a RE-READ of a looping page must pass before it replaces the stored OCR (#3878).
 * Every fixture below is real model output from the #3878 pilot (30 looping pages × 3 arms),
 * checked by eye against the page image where the test says so.
 */

const wrap = (body: string, language = 'Latin') =>
  `<scan-quality>good</scan-quality>\n<language>${language}</language>\n<page-type>text</page-type>\n\n${body}`;

// Year Books 1346–48 p63, lite at temp 0.7. By eye: dense Law French court hand; the model read
// none of it and wrote one invented Occitan sentence, varying "e el" / "et el" between repeats.
const SENT = 'el rey en Jaume de mallorques se fo uengut a la ciutat de Valenç ab luy el rey en Pere de Cathelunya';
const NEAR_LOOP = wrap('Antho.\nAn dous ans deuant que fos mort lo rey en Jaume de mallorques ' +
  ['', ' e ', ' et ', ' et ', ' e ', ' e ', ' e ', ' e ', ' e ', ' et ', ' e ', ' e ', ' et '].map(j => j + SENT).join('') +
  '\n\nDriu pho\npration\nom muna\ntago de dreyn pres', 'Old Occitan');

// Daihannya Haramittakyō vol. 17 p17, lite at temp 0.7. The sutra's own formula, one term changing
// per repeat (無常 / 樂 / 苦 / 我 / 無我 / 淨 / 不淨 / 空 / 無相 / 有相 / 有願 …). Genuine text.
const SUTRA = wrap('尊卑增語是菩薩摩訶薩。不下也世\n尊即聲香味觸法家無常增語是菩薩摩訶薩。\n不下也世尊即聲香味觸法家無常增語\n是菩薩摩訶薩。不下也世尊即聲香味觸法\n家樂增語是菩薩摩訶薩。不下也世尊即聲\n香味觸法家苦增語是菩薩摩訶薩。不下也\n世尊即聲香味觸法家我增語是菩薩摩訶\n薩。不下也世尊即聲香味觸法家無我增語\n是菩薩摩訶薩。不下也世尊即聲香味觸法\n家是菩薩摩訶薩。不下也世尊即聲香味觸\n法家是菩薩摩訶薩。不下也世尊即聲香味觸\n法家淨增語是菩薩摩訶薩。不下也世尊\n即聲香味觸法家不淨增語是菩薩摩訶薩。\n不下也世尊即聲香味觸法家空增語是菩薩\n摩訶薩。不下也世尊即聲香味觸法家空增語是菩\n薩摩訶薩。不下也世尊即聲香味觸法家無相增語是菩薩\n摩訶薩。不下也世尊即聲香味觸法家有相增語是菩薩摩訶薩。不下也世尊\n聲香味觸法家有相增語是菩薩摩訶薩。不\n下也世尊即聲元相增語是菩薩摩訶薩。\n不下也世尊即聲香味觸法家元相增語是\n菩薩摩訶薩。不下也世尊即聲有願增語\n是菩薩摩訶薩。不下也世尊即聲香味觸法\n家元願增語是菩薩摩訶薩。不下也世尊即', 'Chinese');

// Cicero, Pro Marcello (incunable) p8, lite at temp 0.7. By eye: a correct reading with slips.
const LATIN = wrap('qua potuisse peragrare tuis non dico cursibus sed victorijs illustrate sunt. Que quidem ego nisi tam magna esse fatear ut ea vix cuiusque mens aut cogitatio cape possit amens sim. Sed tamen sunt alia bis maiora. Nam bellicas laudes solet quodammodo extenuare vobis easque detrahere ducibus: communicare multis ne proprie sint Imperatorum. Et certe in armis militum virtus, locorum opportunitas auxilia sociorum classes commeatus multum iuvant, maximam vero partem quasi suo iure fortuna sibi vendicat.');

// Gedicht op de vissen (Bugis, Lontara script) p26, lite at temp 0.7: returned in JAVANESE script.
const JAVANESE_SCRIPT = wrap('ꦲꦏꦸꦠꦼꦩ꧀ꦥꦤ꧀ꦄꦤꦢꦶꦥꦸꦤ꧀ꦏꦸꦭꦏꦼꦤ꧀ꦢꦺꦤꦺꦏꦥꦶꦭꦶꦃꦲꦤꦶꦥꦸꦤ꧀ꦮꦶꦠꦼꦤ꧀ꦠꦼꦤ꧀ꦱꦿꦺꦲꦺꦴꦱ꧀ꦮꦶꦠꦼꦤ꧀ꦠꦼꦤ꧀ꦏꦶꦠꦥꦸꦤ꧀ꦢꦶꦏꦠꦼꦩ꧀ꦥꦤ꧀ꦢꦶꦥꦸꦤ꧀ꦏꦼꦏꦁꦢꦼꦤꦺꦩꦶꦫꦺꦴꦪꦺꦴꦤ꧀ꦥꦤꦤ꧀ꦢꦶꦥꦸꦤ꧀ꦏꦼꦤꦁꦢꦺꦤꦺꦲꦺꦴꦫꦗꦺꦴꦏꦸꦮꦠ꧀ꦏꦸꦩꦸꦤꦶꦠꦱ꧀ꦏꦼꦩ꧀ꦥꦤ꧀', 'Javanese');

describe('rereadVerdict — what a re-read must pass', () => {
  it('refuses the varied near-loop that the write gate lets through', () => {
    expect(loopVerdict(NEAR_LOOP).refuse).toBe(false); // why the gate alone is not the bar
    const v = rereadVerdict(NEAR_LOOP, { language: 'Law French' });
    expect(v.accept).toBe(false);
    expect(v.reasons).toContain('near-loop');
  });

  it('accepts a sutra whose formula repeats with one term changing (must NOT refuse)', () => {
    const v = rereadVerdict(SUTRA, { language: 'Chinese' });
    expect(v.reasons).toEqual([]);
    expect(v.accept).toBe(true);
  });

  it('accepts an ordinary reading', () => {
    expect(rereadVerdict(LATIN, { language: 'Latin' }).accept).toBe(true);
  });

  it('refuses a script the language is not written in, and only for a known language', () => {
    expect(rereadVerdict(JAVANESE_SCRIPT, { language: 'Bugis' }).reasons).toContain('script-mismatch');
    expect(rereadVerdict(JAVANESE_SCRIPT, { language: 'Javanese' }).reasons).not.toContain('script-mismatch');
    expect(rereadVerdict(JAVANESE_SCRIPT, { language: 'Sogdian' }).reasons).not.toContain('script-mismatch');
    expect(rereadVerdict(JAVANESE_SCRIPT, { language: null }).reasons).not.toContain('script-mismatch');
  });

  it('always allows Latin script (apparatus, transliteration)', () => {
    expect(allowedScripts('Japanese Japanese')).toContain('Latin');
    expect(rereadVerdict(LATIN, { language: 'Greek' }).reasons).not.toContain('script-mismatch');
  });

  it('reads the dominant script by Unicode property', () => {
    expect(bodyScript('ꦲꦏꦸꦠꦼꦩ꧀ꦥꦤ꧀')).toBe('Javanese');
    expect(bodyScript('ᨅᨘᨁᨗ ᨒᨚᨈᨑ')).toBe('Buginese');
    expect(bodyScript('בראשית ברא')).toBe('Hebrew');
  });

  it('refuses a decline, a run to the output cap, and a runaway', () => {
    expect(rereadVerdict(wrap('<unclear>illegible</unclear>')).reasons).toContain('declined');
    expect(rereadVerdict(wrap(`<unclear>${'x '.repeat(200)}</unclear> a b`)).reasons).toContain('declined');
    expect(rereadVerdict(LATIN, { finishReason: 'MAX_TOKENS' }).reasons).toContain('max-tokens');
    const long = wrap(Array.from({ length: 4000 }, (_, i) => `verbum${i}`).join(' '));
    expect(rereadVerdict(long).reasons).toContain('runaway');
  });
});

describe('storedLoops — which stored pages the lane re-reads', () => {
  it('selects an exact loop and a near-loop, not a sutra or prose', () => {
    expect(storedLoops(wrap('ἁγ’ '.repeat(400)))).toBe('loop');
    expect(storedLoops(NEAR_LOOP)).toBe('near-loop');
    expect(storedLoops(SUTRA)).toBeNull();
    expect(storedLoops(LATIN)).toBeNull();
  });
});

describe('decide — SERVE / MARK / REVIEW / PENDING', () => {
  const ok = { accept: true, reasons: [] };
  const bad = (...reasons: string[]) => ({ accept: false, reasons });
  it('serves the first pass that passed', () => {
    expect(decide({ 1: ok })).toEqual({ action: 'SERVE', pass: 1 });
    expect(decide({ 1: bad('loop'), 2: ok })).toEqual({ action: 'SERVE', pass: 2 });
  });
  it('waits until both passes have a result', () => {
    expect(decide({ 1: bad('loop') }).action).toBe('PENDING');
    expect(decide({ 1: bad('image-fetch-failed'), 2: bad('loop') }).action).toBe('PENDING');
  });
  it('marks unreadable only when both failed on an unreadable reason', () => {
    expect(decide({ 1: bad('declined'), 2: bad('loop', 'max-tokens') })).toEqual({ action: 'MARK', reasons: ['declined', 'loop', 'max-tokens'] });
  });
  it('never marks a page whose only fault was the script check', () => {
    expect(decide({ 1: bad('script-mismatch'), 2: bad('script-mismatch') }).action).toBe('REVIEW');
    expect(decide({ 1: bad('script-mismatch'), 2: bad('loop') }).action).toBe('REVIEW');
  });
  it('never marks a page selected only as a near-loop (a formula can be genuine)', () => {
    expect(decide({ 1: bad('near-loop'), 2: bad('near-loop') }, 'near-loop').action).toBe('REVIEW');
    expect(decide({ 1: bad('near-loop'), 2: bad('near-loop') }, 'loop').action).toBe('MARK');
  });
});
