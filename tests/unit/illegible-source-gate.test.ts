/**
 * The illegible-page gate (#5305). Fixtures are real OCR shapes: the positive is the audit page the
 * translator wrote theology over; the negatives are the false fires the corpus hand reads found in
 * the first two cuts (blank leaves, shelfmarks, best-reading <unclear>, legible titles).
 */
import { describe, it, expect } from 'vitest';
import {
  illegibleSourceVerdict, illegibleWarning, isIllegibleWarningOnly, illegibleGateEnabled, ILLEGIBLE_SOURCE_REASON,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/illegible-source-gate.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { isTranslatablePage } from '../../scripts/lib/translate-core.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { staleTranslationReason } from '../../scripts/lib/stale-translation.mjs';

const HERCULANENSIUM = `<scan-quality>poor</scan-quality>
<language>Ancient Greek</language>
<script>printed</script>
<page-type>text</page-type>
<warning>Extremely faded and overexposed; the text of the papyrus fragment is almost entirely illegible in this scan.</warning>

[...]

<image-desc size="small" type="symbol" significance="low">A circular institutional library stamp is visible in the bottom left corner, though its details are obscured by fading.</image-desc>

<vocab>papyrus, Herculaneum</vocab>`;

const MAJORITY_ILLEGIBLE = `<scan-quality>poor</scan-quality>
<language>Latin</language>
<page-type>text</page-type>
<warning>Handwritten Latin cursive; the document is severely faded, stained, and contains significant ink bleed-through, rendering the majority of the text illegible.</warning>

<unclear>[illegible — entire page is faded and damaged beyond transcription]</unclear>`;

const BLANK_NO_LEGIBLE = `<page-type>blank</page-type>
<warning>The image is a blank page containing only minor foxing or scanning artifacts. No legible text or illustrations are present.</warning>`;

const BLANK_BRACKET = `<lang>None</lang>
<meta>Blank charcoal-colored fibrous endpaper.</meta>

[This page is blank and contains no text or illustrations.]`;

const SHELFMARK = `<scan-quality>fair</scan-quality>
<page-type>text</page-type>
<warning>Handwritten [Modern cursive library hand]. Significant bleed-through of printed text from the reverse side of the leaf.</warning>

Diss. 744, 7

Fiche`;

// Every word in <unclear> as a best reading, as the OCR prompt asks — the page WAS read.
const BEST_READING = `<language>Latin</language>
<page-type>text</page-type>
<warning>The ink is significantly faded and there is substantial bleed-through from the reverse side of the leaf, making several passages difficult to decipher.</warning>

<unclear>In</unclear> <unclear>nomine</unclear> <unclear>Patris</unclear> <unclear>et</unclear> <unclear>Filii</unclear>`;

const LEGIBLE_TITLE_MUCH_ILLEGIBLE = `<scan-quality>fair</scan-quality>
<page-type>title-page</page-type>
<warning>The page is significantly faded. Much of the text is illegible.</warning>

->Gottfried Arnolds<-
->unpartheyische<-
->Kirchen- und Ketzer-<-
->Historie<-`;

const PLATE = `<page-type>text</page-type>
<warning>The image is quite dark, potentially due to staining. The text below the illustration is partially obscured.</warning>
<image-desc size="large" type="engraving" significance="high">A woodcut of the Madonna and Child on an ornate throne.</image-desc>`;

const PARTIAL_CLAIM = `<page-type>text</page-type>
<warning>The lower margin is almost entirely illegible.</warning>

Cum em̃ sicut 7 cetera componat̄ ex sulphure 7 argento viuo est suū sulphur lucidissimū 7 mundissimū.`;

const CALLIGRAPHY = `<scan-quality>poor</scan-quality>
<page-type>text</page-type>
<warning>Handwritten. Significant ink bleed-through from the reverse side makes the background text difficult to distinguish.</warning>

# 義豐圓 義豐圓

<gloss>竹道人</gloss>

<unclear>[illegible]</unclear>`;

describe('illegibleSourceVerdict', () => {
  it('fires on the audit page with no body but a lacuna and a described stamp', () => {
    const v = illegibleSourceVerdict(HERCULANENSIUM);
    expect(v.illegible).toBe(true);
    expect(v.kind).toBe('no-legible-body');
  });
  it('fires when the OCR says the majority is illegible and writes only a lacuna', () => {
    expect(illegibleSourceVerdict(MAJORITY_ILLEGIBLE).illegible).toBe(true);
  });
  it('leaves blank leaves alone however the OCR words them', () => {
    expect(illegibleSourceVerdict(BLANK_NO_LEGIBLE).illegible).toBe(false);
    expect(illegibleSourceVerdict(BLANK_BRACKET).illegible).toBe(false);
    expect(illegibleSourceVerdict(BLANK_NO_LEGIBLE.replace('<page-type>blank</page-type>', ''), { pageType: 'blank' }).illegible).toBe(false);
  });
  it('counts digits: a legible shelfmark is not an empty page', () => {
    expect(illegibleSourceVerdict(SHELFMARK).illegible).toBe(false);
  });
  it('does not read best-reading <unclear> as loss without a page-scope warning', () => {
    expect(illegibleSourceVerdict(BEST_READING).illegible).toBe(false);
  });
  it('does not fire on a legible title under "much of the text is illegible"', () => {
    expect(illegibleSourceVerdict(LEGIBLE_TITLE_MUCH_ILLEGIBLE).illegible).toBe(false);
  });
  it('leaves a described picture to the no-body gate', () => {
    expect(illegibleSourceVerdict(PLATE).illegible).toBe(false);
  });
  it('ignores an illegibility claim about part of the page', () => {
    expect(illegibleSourceVerdict(PARTIAL_CLAIM).illegible).toBe(false);
  });
  it('weights Han characters: a short calligraphy leaf is not empty', () => {
    expect(illegibleSourceVerdict(CALLIGRAPHY).illegible).toBe(false);
  });
  it('takes an injected garble verdict as case (b)', () => {
    const v = illegibleSourceVerdict(PARTIAL_CLAIM, { garble: { garbled: true, reasons: ['oov'] } });
    expect(v.kind).toBe('garbled-source');
  });
});

describe('the contract output', () => {
  it('is exactly one Illegible warning, nothing else', () => {
    const w = illegibleWarning(illegibleSourceVerdict(HERCULANENSIUM));
    expect(w).toBe('<warning>Illegible: the transcription holds no legible text</warning>');
    expect(isIllegibleWarningOnly(w)).toBe(true);
    expect(isIllegibleWarningOnly(`${w}\n<summary>A papyrus.</summary>`)).toBe(false);
  });
});

describe('wiring: off by default', () => {
  const page = { page_number: 5, page_type: 'text', ocr: { data: HERCULANENSIUM } };
  it('reads only the literal flag', () => {
    expect(illegibleGateEnabled({})).toBe(false);
    expect(illegibleGateEnabled({ TRANSLATE_ILLEGIBLE_GATE: 'true' })).toBe(false);
    expect(illegibleGateEnabled({ TRANSLATE_ILLEGIBLE_GATE: '1' })).toBe(true);
  });
  it('isTranslatablePage refuses only with the gate on', () => {
    expect(isTranslatablePage(page, { illegibleGate: false }).ok).toBe(true);
    const r = isTranslatablePage(page, { illegibleGate: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('illegible-source');
  });
  it('the withhold arm is opt-in', () => {
    const served = { ...page, translation: { data: 'The gods are blessed and incorruptible…', updated_at: new Date() } };
    expect(staleTranslationReason(served)).toBe(null);
    expect(staleTranslationReason(served, { illegibleArm: true })).toBe(ILLEGIBLE_SOURCE_REASON);
  });
});
