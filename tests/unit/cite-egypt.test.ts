/**
 * Egyptological citation resolver: parser table, concordance integrity, route.
 *
 * The expected reader pages are pinned to what was READ off the leaves
 * (src/data/cite/*.json), not to an offset: Sethe's offset steps 10→12→14→16
 * across four plate insertions and Breasted's is a constant 50. If a rebuild of
 * the concordance moves one of these, the OCR of that leaf changed — look at it.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { parseCite, resolveCite, resolveCitation, heldEditions } from '@/lib/cite-egypt';
import urkI from '@/data/cite/urk-i.json';
import areI from '@/data/cite/are-i.json';

const URK_I = '6a9afa09441bca6a13ac2510';
const ARE_I = '6a989f98ba191f96aa9bab9c';

vi.mock('@/lib/api-auth', () => ({
  withApiAuth: (handler: (req: NextRequest, ctx: unknown) => Promise<Response>) => handler,
}));

describe('parseCite + resolveCite — the citation table', () => {
  const table: Array<[string, { book: string; page: number; basis: string } | 'not-held' | 'not-found']> = [
    // Sethe, Urk. I — page, range, page+line, first and last printed leaf, a frame leaf
    ['Urk. I, 124', { book: URK_I, page: 136, basis: 'printed' }],
    ['Urk. I 120–131', { book: URK_I, page: 132, basis: 'printed' }],
    ['Urk I 124,3', { book: URK_I, page: 136, basis: 'printed' }],
    ['Urk. I, 1', { book: URK_I, page: 11, basis: 'printed' }],
    ['urk i 308', { book: URK_I, page: 324, basis: 'printed' }],
    ['Urk. I, 131', { book: URK_I, page: 143, basis: 'frame' }],
    // Breasted, ARE I — section, section range, page, BAR abbreviation, §1
    ['ARE I §335', { book: ARE_I, page: 203, basis: 'printed' }],
    ['Breasted I §333–336', { book: ARE_I, page: 202, basis: 'nearest' }],
    ['ARE 1, 153', { book: ARE_I, page: 203, basis: 'printed' }],
    ['BAR I, § 336', { book: ARE_I, page: 204, basis: 'printed' }],
    ['ARE I §1', { book: ARE_I, page: 53, basis: 'printed' }],
    // Parses, but we do not hold the volume
    ['Wb 1, 81.8', 'not-held'],
    ['Urk. IV, 124', 'not-held'],
    // Parses, held, but outside what was read
    ['Urk. I, 999', 'not-found'],
    ['ARE I §9999', 'not-found'],
  ];

  for (const [input, expected] of table) {
    it(`${input} → ${typeof expected === 'string' ? expected : `${expected.book.slice(0, 6)}… p.${expected.page} (${expected.basis})`}`, () => {
      const res = resolveCitation(input);
      expect(res, 'must parse').not.toBeNull();
      if (typeof expected === 'string') {
        expect(res!.status).toBe(expected);
      } else {
        expect(res!.status).toBe('ok');
        if (res!.status !== 'ok') return;
        expect(res.book_id).toBe(expected.book);
        expect(res.page).toBe(expected.page);
        expect(res.basis).toBe(expected.basis);
        expect(res.url).toBe(`https://sourcelibrary.org/book/${expected.book}?page=${expected.page}`);
      }
    });
  }

  const malformed = ['Bekker 1094a', 'Urk. I', 'ARE §', 'Urk. I, 131–120', '', 'Wb'];
  for (const input of malformed) {
    it(`malformed: ${JSON.stringify(input)} → null (400)`, () => {
      expect(parseCite(input)).toBeNull();
    });
  }

  it('keeps the line / entry / range end on the parse, and labels normalise', () => {
    expect(parseCite('Urk I 124,3')).toMatchObject({ edition: 'urk', volume: 1, kind: 'page', value: 124, sub: 3, label: 'Urk. I, 124,3' });
    expect(parseCite('Wb 1, 81.8')).toMatchObject({ edition: 'wb', volume: 1, value: 81, sub: 8, label: 'Wb 1, 81.8' });
    expect(parseCite('Breasted I §333–336')).toMatchObject({ edition: 'are', kind: 'section', value: 333, end: 336, label: 'ARE I §§333–336' });
    expect(parseCite('ARE 2, 40')).toMatchObject({ edition: 'are', volume: 2, kind: 'page', value: 40 });
  });

  it('reports the held editions with their book ids', () => {
    const held = heldEditions();
    expect(held.map((h) => h.book_id).sort()).toEqual([URK_I, ARE_I].sort());
  });
});

describe('concordance integrity (src/data/cite)', () => {
  const editions = [
    { name: 'urk-i', data: urkI, book: URK_I },
    { name: 'are-i', data: areI, book: ARE_I },
  ];

  for (const { name, data, book } of editions) {
    describe(name, () => {
      it('points at the handoff book', () => {
        expect(data.book_id).toBe(book);
      });

      it('printed page → reader page is strictly increasing on both axes', () => {
        const entries = Object.entries(data.pages).map(([k, v]) => [Number(k), v as number] as const).sort((a, b) => a[0] - b[0]);
        expect(entries.length).toBeGreaterThan(200);
        for (let i = 1; i < entries.length; i++) {
          expect(entries[i][0], `printed ${entries[i][0]}`).toBeGreaterThan(entries[i - 1][0]);
          expect(entries[i][1], `reader for printed ${entries[i][0]}`).toBeGreaterThan(entries[i - 1][1]);
        }
      });

      it('frame leaves never overlap printed ones and keep the same order', () => {
        for (const k of Object.keys(data.frame)) expect(data.pages).not.toHaveProperty(k);
        const all = Object.entries({ ...data.pages, ...data.frame })
          .map(([k, v]) => [Number(k), v as number] as const)
          .sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < all.length; i++) expect(all[i][1]).toBeGreaterThan(all[i - 1][1]);
      });

      it('every 20th reader page carries a strictly increasing printed number (recomputed, not trusted)', () => {
        const byReader = new Map<number, number>();
        for (const [k, v] of Object.entries({ ...data.pages, ...data.frame })) byReader.set(v as number, Number(k));
        let last = -1;
        let sampled = 0;
        for (let r = 20; r <= data.leaves; r += 20) {
          const printed = byReader.get(r);
          if (printed == null) continue;
          sampled++;
          expect(printed, `reader ${r}`).toBeGreaterThan(last);
          last = printed;
        }
        expect(sampled).toBeGreaterThanOrEqual(10);
        expect(data.checks.monotonic).toBe(true);
        expect(data.checks.anomalies).toEqual([]);
      });
    });
  }

  it('Breasted sections are monotone in reader order and start at §1', () => {
    const entries = Object.entries(areI.sections).map(([k, v]) => [Number(k), v] as const).sort((a, b) => a[0] - b[0]);
    expect(entries[0][0]).toBe(1);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i][1], `§${entries[i][0]}`).toBeGreaterThanOrEqual(entries[i - 1][1]);
    }
    expect(entries.length).toBeGreaterThan(600);
  });

  it('Sethe offset is NOT constant — the plates shift it four times', () => {
    const offsets = new Set(Object.entries(urkI.pages).map(([k, v]) => (v as number) - Number(k)));
    expect([...offsets].sort((a, b) => a - b)).toEqual([10, 12, 14, 16]);
  });
});

describe('GET /api/cite', () => {
  async function get(qs: string, headers: Record<string, string> = {}) {
    const { GET } = await import('@/app/api/cite/route');
    const req = new NextRequest(`https://sourcelibrary.org/api/cite${qs}`, { headers });
    return GET(req, {});
  }

  it('302s to the reader with the basis in a header', async () => {
    const res = await get('?ref=' + encodeURIComponent('Urk. I, 124'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://sourcelibrary.org/book/${URK_I}?page=136`);
    expect(res.headers.get('x-cite-basis')).toBe('printed');
  });

  it('400s a ref it cannot read, and a missing ref', async () => {
    expect((await get('?ref=' + encodeURIComponent('Bekker 1094a'))).status).toBe(400);
    expect((await get('')).status).toBe(400);
  });

  it('404s a volume we do not hold, naming what is held', async () => {
    const res = await get('?ref=' + encodeURIComponent('Wb 1, 81.8'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not held/);
    expect(body.held.map((h: { book_id: string }) => h.book_id)).toContain(URK_I);
  });

  it('answers JSON on format=json', async () => {
    const res = await get('?ref=' + encodeURIComponent('ARE I §335') + '&format=json');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ book_id: ARE_I, page: 203, basis: 'printed', citation: 'ARE I §335' });
  });

  it('a section the OCR lost lands on the nearest leaf before it and says so', async () => {
    const res = await get('?ref=' + encodeURIComponent('ARE I §333') + '&format=json');
    const body = await res.json();
    expect(body.page).toBe(202);
    expect(body.basis).toBe('nearest');
    expect(resolveCite(parseCite('ARE I §333')!)).toMatchObject({ basis: 'nearest' });
  });
});
