import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { verbatimCut, removedIsChat } from '../../scripts/lib/verbatim-cut.mjs';

// #6523: a rescue of a CLI reply may only CUT. Fixtures are the shapes the 2026-10-11 control and the two Tengyur
// production pages produced.
const PAGE = 'Hoc animo scito omnes numantinos esse\nvt pro libertate mori tamen non formident\nNumantini nec deesse sibi';

describe('verbatimCut', () => {
  it('accepts a page cut out of chat on both sides', () => {
    const raw = `Here is the transcription of the page:\n\n${PAGE}\n\nWould you like me to summarise it?`;
    expect(verbatimCut(raw, PAGE)).toMatchObject({ ok: true });
  });
  it('accepts one copy of a doubled reply', () => {
    expect(verbatimCut(`${PAGE}\n\n${PAGE}`, PAGE)).toMatchObject({ ok: true });
  });
  it('accepts the span after a separate reply that ends by announcing the translation (Tengyur p261)', () => {
    const raw = 'To clarify the intended teaching in the verses cited:\n\nJust as a beggar does not obstruct generosity.\n\nHere is the translation:\n\nTo elucidate the meaning of the teaching by way of an example, the text states.';
    expect(verbatimCut(raw, 'To elucidate the meaning of the teaching by way of an example, the text states.')).toMatchObject({ ok: true });
  });
  it('refuses a stitched or reworded cut', () => {
    const raw = `${PAGE}\nI am unable to continue.\nmore text after the refusal line here`;
    expect(verbatimCut(raw, `${PAGE}\nmore text after the refusal line here`)).toMatchObject({ ok: false });
    expect(verbatimCut(raw, PAGE.replace('numantinos', 'Numantinos'))).toMatchObject({ ok: false });
  });
  it('refuses a truncation: the short first copy of a restarted read, when the second runs further', () => {
    const short = PAGE.split('\n').slice(0, 2).join('\n');
    const raw = `${short}\n\n<scan-quality>good</scan-quality>\n${PAGE}\nsed in tota Hispania gloriam quaerunt`;
    expect(verbatimCut(raw, short)).toMatchObject({ ok: false });
    expect(removedIsChat(raw, short).ok).toBe(false);
  });
  it('refuses a cut that drops page text that is not chat', () => {
    expect(verbatimCut(`${PAGE}\nsed in tota Hispania gloriam quaerunt`, PAGE)).toMatchObject({ ok: false });
  });
});
