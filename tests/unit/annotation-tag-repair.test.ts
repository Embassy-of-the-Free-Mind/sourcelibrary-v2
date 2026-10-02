/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS modules under test are untyped */
/**
 * #5644: the scripts-side sanitizeTranslationTags (translate-core.mjs) — run by every script
 * translation writer, the chained batch lane included — never repaired <note>. 78 pages of the
 * Tibetan run were written with an unclosed or malformed note, hiding running text from a reader
 * with notes off. Fixtures are excerpts of those pages.
 *
 * Pins: (1) the scripts twin of src/lib/sanitize-translation-tags.ts is byte-identical to it;
 * (2) the writer-side sanitizer now leaves notes balanced; (3) the writers call it;
 * (4) the repair script closes tightly and changes no words.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { sanitizeTranslationTags as tsSanitize } from '../../src/lib/sanitize-translation-tags';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { repairAnnotationTags } from '../../scripts/lib/annotation-tag-repair.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { sanitizeTranslationTags } from '../../scripts/lib/translate-core.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { noteTagBalance } from '../../scripts/lib/translation-text-repair.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { repairNotes } from '../../scripts/maintenance/fix-unclosed-note-tags.mjs';

const REPO = path.resolve(__dirname, '../..');

const FIXTURES: Record<string, string> = {
  malformed: 'reaching the ten stages <note>the ten bhumis of a Bodhisattva</note. The root is',
  malformedComma: 'from sadness <note>meaning becoming depressed or physically ill from sadness</note, I thought of',
  unclosedTerm: 'many Transmitted Precepts <note><term>Kama</term> and Treasures <note><term>Terma</term>. Here, it is the "Jewel Ocean" <note>original: "nor bu rgya mtsho"</note>, the final cycle',
  unclosedSentence: 'the sacred commitments <note>samaya. Offer prayers, offerings, praises, and music.\n\nThe signs of this are',
  nestedThenOrphan: 'the ten stages. <note>From the second month the channels increase. By the twelfth month <note>sic</note>, channels are perfected.</note> Thus, during',
  balanced: 'The <term>stone</term> is fixed.<note>cf. Geber</note> <note original="Title">Vinaya Volume Kha</note>',
};
const strip = (s: string) => s.replace(/<\/?note(?:\s[^>]*)?>|<\/note(?=[^>])/g, '');

describe('#5644 · annotation-tag repair', () => {
  it('the scripts twin matches src/lib/sanitize-translation-tags.ts byte for byte', () => {
    for (const t of Object.values(FIXTURES)) expect(repairAnnotationTags(t)).toBe(tsSanitize(t));
  });

  it('the writer-side sanitizer leaves every <note> balanced', () => {
    for (const [name, t] of Object.entries(FIXTURES)) {
      expect(noteTagBalance(sanitizeTranslationTags(t)).balanced, name).toBe(true);
    }
  });

  it('NEGATIVE CONTROL: balanced notes come back unchanged', () => {
    expect(sanitizeTranslationTags(FIXTURES.balanced)).toBe(FIXTURES.balanced);
    expect(repairNotes(FIXTURES.balanced)).toBe(FIXTURES.balanced);
  });

  it('the chained batch writer and writePageTranslation both run the sanitizer', () => {
    const chained = fs.readFileSync(path.join(REPO, 'scripts/lib/translate-batch-chained.mjs'), 'utf8');
    const core = fs.readFileSync(path.join(REPO, 'scripts/lib/translate-core.mjs'), 'utf8');
    expect(chained).toMatch(/sanitizeTranslationTags\(/);
    expect(core).toMatch(/tr: sanitizeTranslationTags\(text\)/);
    expect(core).toMatch(/validateTranslationTags\(repairAnnotationTags\(/);
  });

  it('the repair closes a note at the gloss, not at the next note, and changes no words', () => {
    expect(repairNotes(FIXTURES.unclosedTerm)).toBe('many Transmitted Precepts <note><term>Kama</term></note> and Treasures <note><term>Terma</term></note>. Here, it is the "Jewel Ocean" <note>original: "nor bu rgya mtsho"</note>, the final cycle');
    expect(repairNotes(FIXTURES.unclosedSentence)).toBe('the sacred commitments <note>samaya</note>. Offer prayers, offerings, praises, and music.\n\nThe signs of this are');
    expect(repairNotes(FIXTURES.malformed)).toBe('reaching the ten stages <note>the ten bhumis of a Bodhisattva</note>. The root is');
    for (const [name, t] of Object.entries(FIXTURES)) {
      const out = repairNotes(t);
      expect(noteTagBalance(out).balanced, name).toBe(true);
      expect(strip(out), name).toBe(strip(t));
    }
  });
});
