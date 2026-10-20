// PRIOR ART: tests/unit/citation-pages.test.ts pins the deterministic quotation re-pointer (#6956). This pins
// the offline fixer's code half (#6946 stage 1): the model proposes keep/move/drop with a span, and only a span
// string-matched on the page it names changes a link. Every move has a twin that must NOT move.
import { describe, it, expect } from 'vitest';
import { applyGroundingEdits } from '@/lib/embassy/citation-fixes';
import type { GroundingPage } from '@/lib/embassy/grounding';
import { buildPageIndex } from '@/lib/embassy/citation-pages';
import { DROP_MARK, fixerEdits, fixerPacket, parseFixerReply, readablePages, spanOnPage, validateVerdicts } from '@/lib/embassy/citation-fixer';

const page = (bookSlug: string, n: number, text: string, orig = ''): GroundingPage =>
  ({ bookId: `id-${bookSlug}`, bookSlug, bookTitle: `Title of ${bookSlug}`, page: n, text: [text, orig].join('\n'), parts: [text, orig] });

const PAGES = readablePages([
  page('de-vita', 22, 'Black bile which we called natural contributes to our judgment and wisdom, but not always.'),
  page('de-vita', 23, 'Saturn is hostile to men who live an openly common life, but a friend to separated minds.'),
  page('other-book', 5, 'The salamander lives in the fire and is never consumed by it, as the ancients write.'),
  page('chinese', 3, '蜂蜜生於巖石者名石蜜色白如膏'),
]);
const L = (slug: string, n: number, label = `Page ${n}`) => `[${label}](https://sourcelibrary.org/book/${slug}/page-number/${n})`;
const TEXT = [
  `Ficino says natural black bile aids judgment — *[De Vita](https://sourcelibrary.org/book/de-vita)*, ${L('de-vita', 22)}.`,
  '',
  `Saturn befriends separated minds — *[De Vita](https://sourcelibrary.org/book/de-vita)*, ${L('de-vita', 22)}.`,
  '',
  `Ficino was born in 1433 — *[De Vita](https://sourcelibrary.org/book/de-vita)*, ${L('de-vita', 23)}.`,
].join('\n');

describe('spanOnPage', () => {
  const idx = buildPageIndex(PAGES);
  it('finds a verbatim span, folded, and refuses a paraphrase', () => {
    expect(spanOnPage('Black bile which we called NATURAL contributes', idx, 0)).toBe('on');
    expect(spanOnPage('black bile that we named natural helps judgment', idx, 0)).toBe('off');
    expect(spanOnPage('Black bile which we called natural contributes', idx, 1)).toBe('off');
  });
  it('counts a span that crosses the page break for both pages, and one wholly on the neighbour for neither', () => {
    expect(spanOnPage('and wisdom but not always Saturn is hostile to men', idx, 0)).toBe('on');
    expect(spanOnPage('and wisdom but not always Saturn is hostile to men', idx, 1)).toBe('on');
    expect(spanOnPage('a friend to separated minds', idx, 0)).toBe('off');
  });
  it('treats a span too short to prove anything as unjudgeable, not as a miss', () => {
    expect(spanOnPage('black bile', idx, 0)).toBe('short');
    expect(spanOnPage('', idx, 0)).toBe('short');
  });
  it('matches a script written without spaces by its letters', () => {
    expect(spanOnPage('生於巖石者名石蜜', idx, 3)).toBe('on');
    expect(spanOnPage('生於樹木者名木蜜', idx, 3)).toBe('off');
  });
  it('accepts a 6-word window only when asked (keep), never for a move', () => {
    const slipped = 'Black bile which we called natural contributes to our judgement and wisdom';
    expect(spanOnPage(slipped, idx, 0)).toBe('off');
    expect(spanOnPage(slipped, idx, 0, 6)).toBe('on');
  });
});

describe('validateVerdicts + fixerEdits', () => {
  const packet = fixerPacket('q', TEXT, PAGES);
  const verdicts = [
    { id: 'L1', action: 'keep', span: 'Black bile which we called natural contributes to our judgment' },
    { id: 'L2', action: 'move', page: 'P2', span: 'Saturn is hostile to men who live an openly common life' },
    { id: 'L3', action: 'keep', span: 'Ficino was born in Florence in the year 1433' },
  ];
  const outcomes = validateVerdicts(TEXT, packet, verdicts);
  it('keeps a verified keep, applies a verified move, drops an unverified keep', () => {
    expect(outcomes.map(o => o.outcome)).toEqual(['keep', 'move', 'drop_unverified']);
    expect(outcomes[1].to?.page).toBe(23);
  });
  it('does not move when the span is not on the target page', () => {
    const o = validateVerdicts(TEXT, packet, [verdicts[0], { id: 'L2', action: 'move', page: 'P3', span: 'Saturn is hostile to men who live an openly common life' }, verdicts[2]]);
    expect(o[1].outcome).toBe('drop_unverified');
  });
  it('reads as keep a move whose span is on the linked page', () => {
    const o = validateVerdicts(TEXT, packet, [{ id: 'L1', action: 'move', page: 'P2', span: 'Black bile which we called natural contributes to our judgment' }]);
    expect(o[0].outcome).toBe('keep');
  });
  it('writes edits the client applies: the moved URL and label, the dropped citation as the marker', () => {
    const fixed = applyGroundingEdits(TEXT, fixerEdits(TEXT, outcomes));
    expect(fixed).toContain(`Saturn befriends separated minds — *[De Vita](https://sourcelibrary.org/book/de-vita)*, ${L('de-vita', 23)}.`);
    expect(fixed).toContain(`Ficino was born in 1433 ${DROP_MARK.en}.`);
    expect(fixed).toContain(`aids judgment — *[De Vita](https://sourcelibrary.org/book/de-vita)*, ${L('de-vita', 22)}.`);
  });
  it('leaves a caption link alone', () => {
    const t = `![Saturn](https://images.sourcelibrary.org/x/23.jpg)\n*Saturn — ${L('de-vita', 22)}*`;
    const p = fixerPacket('q', t, PAGES);
    expect(validateVerdicts(t, p, [{ id: 'L1', action: 'drop' }])[0].outcome).toBe('caption');
  });
  it('drops one page link of a shared citation without touching the other', () => {
    const t = `Both pages say it — *[De Vita](https://sourcelibrary.org/book/de-vita)*, ${L('de-vita', 22)}, ${L('de-vita', 23)}.`;
    const p = fixerPacket('q', t, PAGES);
    const o = validateVerdicts(t, p, [{ id: 'L1', action: 'keep', span: 'Black bile which we called natural contributes' }, { id: 'L2', action: 'drop' }]);
    expect(applyGroundingEdits(t, fixerEdits(t, o))).toBe(`Both pages say it — *[De Vita](https://sourcelibrary.org/book/de-vita)*, ${L('de-vita', 22)}.`);
  });
});

describe('parseFixerReply', () => {
  it('takes the last object when the model corrects itself', () => {
    const r = '{"links":[{"id":"L1","action":"keep","span":"x"}]}\n\nWait — corrected:\n\n{"links":[{"id":"L1","action":"drop"}]}';
    expect(parseFixerReply(r)).toEqual([{ id: 'L1', action: 'drop' }]);
  });
  it('returns null on no object', () => {
    expect(parseFixerReply('I cannot do that.')).toBeNull();
  });
});
