import { describe, it, expect } from 'vitest';
import { extractVolume, editionYear, checkDuplicate } from '@/lib/dedup';

describe('extractVolume', () => {
  it('reads arabic volume markers', () => {
    expect(extractVolume('Harmonia Macrocosmica Vol. 2')).toBe(2);
    expect(extractVolume('Rig-Veda-Sanhita (Vol. 2)')).toBe(2);
    expect(extractVolume('Some Work, Tome 3')).toBe(3);
    expect(extractVolume('Werk Band 4')).toBe(4);
  });

  it('reads roman and Latin-ordinal volume markers', () => {
    expect(extractVolume('Utriusque Cosmi Historia Tomus II')).toBe(2);
    expect(extractVolume('Summa Astensis Tomus primus')).toBe(1);
    expect(extractVolume('Opera Tom. III')).toBe(3);
  });

  it('returns null when no volume marker is present', () => {
    expect(extractVolume('Theatrum Politicum')).toBeNull();
    expect(extractVolume('')).toBeNull();
    expect(extractVolume(undefined)).toBeNull();
  });
});

describe('editionYear', () => {
  it('prefers a numeric year', () => {
    expect(editionYear({ year: 1730, published: '1728' })).toBe(1730);
  });
  it('parses a year out of published', () => {
    expect(editionYear({ published: 'Venetiis, 1728' })).toBe(1728);
    expect(editionYear({ published: '1660' })).toBe(1660);
  });
  it('returns null when there is no usable year', () => {
    expect(editionYear({ published: 'Unknown' })).toBeNull();
    expect(editionYear({})).toBeNull();
  });

  // A `> 0` guard used to reject BCE years and fall through to digit-scraping
  // `published`, so an ancient object's prose date ("…c. 2100–1600 BCE") came
  // back as the year 2100 CE — off by four millennia and the wrong sign.
  it('keeps BCE years instead of scraping a positive year out of prose', () => {
    expect(editionYear({ year: -1550, published: 'Stela (Dynasty 18)' })).toBe(-1550);
    expect(editionYear({ year: -2100, published: 'Ur III / Old Babylonian (c. 2100–1600 BCE)' })).toBe(-2100);
  });

  it('ignores a zero year, which encodes "no date" rather than 1 BCE', () => {
    expect(editionYear({ year: 0, published: '1544' })).toBe(1544);
    expect(editionYear({ year: 0 })).toBeNull();
  });
});

// Minimal fake Mongo Db. Tier 1 (fingerprint) and Tier 3 (iiif) findOne return
// null; find() returns the canned existing edition(s) for `books` REGARDLESS
// of the query — so tier 2's server-side edition_key prefix filter does not
// apply here, and only the client-side year/volume vetoes are exercised.
// Canned docs therefore carry explicit `edition_key` values (the flipped tier
// skips docs without a parseable key). The shadow-log insert has no insertOne
// on this fake and is swallowed by checkDuplicate's fence — itself a useful
// pin: shadow failures must never affect the verdict.
function makeDb(titleMatches: Record<string, unknown>[]) {
  const collection = (name: string) => ({
    findOne: async () => null,
    find: () => ({ limit: () => ({ toArray: async () => (name === 'books' ? titleMatches : []) }) }),
  });
  return { collection } as unknown as Parameters<typeof checkDuplicate>[0];
}

describe('checkDuplicate edition-awareness (edition-key tier, flipped 2026-08-08)', () => {
  const existing1730 = { id: 'b1730', title: 'Summa Astensis', edition_key: 'summa astensis|ast|1730|v' };

  it('does NOT flag a different-year edition as a duplicate', async () => {
    const db = makeDb([existing1730]);
    const res = await checkDuplicate(db, {
      title: 'Summa Astensis', author: 'Astesanus de Ast', year: 1728,
    });
    expect(res.isDuplicate).toBe(false);
  });

  it('DOES flag the same-year edition as a duplicate', async () => {
    const db = makeDb([existing1730]);
    const res = await checkDuplicate(db, {
      title: 'Summa Astensis', author: 'Astesanus de Ast', year: 1730,
    });
    expect(res.isDuplicate).toBe(true);
    expect(res.matches[0].matchType).toBe('edition_key');
  });

  it('does NOT flag a different-volume set as a duplicate', async () => {
    const db = makeDb([{ id: 'v1', title: 'Utriusque Cosmi Historia Tomus I', edition_key: 'utriusque cosmi historia tomus i|fludd|1617|v1' }]);
    const res = await checkDuplicate(db, {
      title: 'Utriusque Cosmi Historia Tomus II', author: 'Robert Fludd', year: 1617,
    });
    expect(res.isDuplicate).toBe(false);
  });

  it('falls back to flagging when the year is unknown on either side (safe default)', async () => {
    const db = makeDb([{ id: 'bNoYear', title: 'Summa Astensis', edition_key: 'summa astensis|ast||v' }]);
    const res = await checkDuplicate(db, {
      title: 'Summa Astensis', author: 'Astesanus de Ast', year: 1728,
    });
    expect(res.isDuplicate).toBe(true);
  });

  it('skips stored docs without a parseable edition_key (unstamped rows cannot match)', async () => {
    const db = makeDb([{ id: 'unstamped', title: 'Summa Astensis' }]);
    const res = await checkDuplicate(db, {
      title: 'Summa Astensis', author: 'Astesanus de Ast', year: 1730,
    });
    expect(res.isDuplicate).toBe(false);
  });
});
