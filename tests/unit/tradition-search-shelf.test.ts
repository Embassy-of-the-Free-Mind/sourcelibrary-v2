import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/mongodb', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/embassy/collection-catalog', () => ({ resolveCollectionSlug: vi.fn(async () => null) }));

import { shelfVerdicts, resolveTradition } from '@/lib/search/tradition-search';

// compare_traditions with `scope` (#6077): on a review shelf only books a
// by-eye check marked SHOW may be quoted. A book that sits on the shelf so it
// can be fixed (INVENTED, MAJOR, FIX FIRST, DO NOT SHOW) must never be cited.
describe('shelfVerdicts', () => {
  it('keeps SHOW and SHOW WITH CARE, withholds every other verdict', () => {
    const v = shelfVerdicts([
      { book_id: 'a', note: 'SHOW. Sound on the checked run.' },
      { book_id: 'b', note: 'SHOW WITH CARE. Checked p.244.' },
      { book_id: 'c', note: 'SHOW p.4 (fluent, right). But p.3 dropped a clause.' },
      { book_id: 'd', note: 'DO NOT SHOW. p.60–61 OCR guesswork.' },
      { book_id: 'e', note: 'INVENTED. Title leaf.' },
      { book_id: 'f', note: 'MAJOR. p.42 is the same leaf as p.40.' },
      { book_id: 'g', note: 'FIX FIRST. p.29.' },
      { book_id: 'h', note: 'Checked p.211–212: scan matches.' },
    ]);
    expect(v).not.toBeNull();
    expect([...v!.shown].sort()).toEqual(['a', 'b', 'c']);
    expect(v!.withheld).toBe(5);
    expect(v!.notes.get('c')).toMatch(/p\.3 dropped/);
  });

  it('is null for an ordinary collection with editorial notes', () => {
    expect(shelfVerdicts([{ book_id: 'a', note: 'The finest printing of the Hermetica.' }])).toBeNull();
  });
});

describe('resolveTradition', () => {
  it('maps the words a reader types to one key', async () => {
    expect((await resolveTradition('Zen')).key).toBe('chan');
    expect((await resolveTradition('Kabbalah')).key).toBe('kabbalistic');
    expect((await resolveTradition('taoism')).key).toBe('daoist');
    expect((await resolveTradition('christian mystical')).key).toBe('christian-mystical');
  });

  it('reports an unknown tradition as unknown rather than searching nothing silently', async () => {
    const t = await resolveTradition('martian');
    expect(t.key).toBeNull();
    expect(t.collections).toEqual([]);
  });
});
