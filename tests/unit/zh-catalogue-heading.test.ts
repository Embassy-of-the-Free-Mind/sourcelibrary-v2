import { describe, expect, it } from 'vitest';
import { displayPublished } from '@/lib/publication-date';
import { asksForOneVolume, bylineDynasty, sibuClass, sibuRowForWork } from '@/lib/sibu-catalogue';

describe('displayPublished: an absent date prints nothing (#8035)', () => {
  it.each(['Unknown', 'unknown', ' UNKNOWN ', '[Unknown]', 'undated', 'n.d.', 'nd', '?', '???', '-', '—', '', '  ', null, undefined])(
    'treats %j as absent',
    (raw) => expect(displayPublished(raw)).toBeNull(),
  );

  it.each([['1597', '1597'], ['c. 1600', 'c. 1600'], ['乾隆四十六年', '乾隆四十六年'], [' 1750 ', '1750'], ['Unknown Press, 1750', 'Unknown Press, 1750']])(
    'keeps %j',
    (raw, want) => expect(displayPublished(raw)).toBe(want),
  );
});

describe('sibuRowForWork: the catalogue row behind a Kanripo work id', () => {
  it('joins a known work to its row and class', () => {
    const row = sibuRowForWork('kr:KR3k0059');
    expect(row?.title).toContain('韻府');
    expect(row?.first).toBe('vol-1-51');
    const cls = sibuClass(row!.cls!);
    expect(cls?.code).toBe(row!.cls);
    expect(cls?.part.zh).toBe('子部');
  });

  it.each([[undefined], [null], [''], ['ol:OL123W'], ['kr:KR9z9999'], [42]])(
    'finds nothing for %j rather than guessing',
    (id) => expect(sibuRowForWork(id)).toBeNull(),
  );
});

describe('asksForOneVolume: a reader who names a volume keeps it', () => {
  it.each(['佩文韻府 卷三', '第二册', '史記冊二', 'vol 2', 'Juan 3', '佩文韻府 12'])(
    'reads %j as naming a volume',
    (q) => expect(asksForOneVolume(q)).toBe(true),
  );

  it.each(['佩文韻府', '史记', 'Peiwen yunfu', 'revolution'])(
    'reads %j as naming the work',
    (q) => expect(asksForOneVolume(q)).toBe(false),
  );
});

describe('bylineDynasty: a dynasty prints only beside the author it belongs to', () => {
  const row = { dynasty: '唐', author: '佛陀多羅' } as Parameters<typeof bylineDynasty>[0];

  it('prints it for the catalogue author, also inside a longer credit', () => {
    expect(bylineDynasty(row, '佛陀多羅')).toBe('唐');
    expect(bylineDynasty(row, '佛陀多羅 譯')).toBe('唐');
  });

  it.each([['月溪法師'], ['James Legge'], [''], [null], [undefined]])('prints nothing for %j', (author) => {
    expect(bylineDynasty(row, author)).toBeNull();
  });

  it('prints nothing with no row or no dynasty', () => {
    expect(bylineDynasty(null, '佛陀多羅')).toBeNull();
    expect(bylineDynasty({ dynasty: null, author: '佛陀多羅' } as Parameters<typeof bylineDynasty>[0], '佛陀多羅')).toBeNull();
  });
});
