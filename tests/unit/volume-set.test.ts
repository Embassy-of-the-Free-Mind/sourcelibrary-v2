import { describe, it, expect } from 'vitest';
import { buildVolumeSet, titleStem, volumeNumber, volumeTail, type VolumeCandidate } from '@/lib/volume-set';

// Titles below are real book titles from the corpus (2026-10-27), not invented shapes.
describe('volumeNumber', () => {
  const cases: Array<[string, string | undefined, number | null]> = [
    ['御製律呂正義後編·卷八十一~卷八十二 (vol 41)',
      'Correct Meaning of the Pitch Pipes, Later Compilation (律呂正義後編), vol. 41: chapters 81–82', 41],
    ['佛果圜悟禪師碧巖錄 卷1–2 (vol 1 of 5)', undefined, 1],
    ['Aristotelis Opera, Vol. I (Bekker 1831)', undefined, 1],
    ['Aristotelis Opera, Vol. IV (Bekker 1831)', undefined, 4],
    ['Avicennae Canon Medicinae, Vol. II (1595 Latin)', undefined, 2],
    ['Tantrik Texts Vol. XI (Hindi, 1922)', undefined, 11],
    ['Mechanica Vol. II (1736)', undefined, 2],
    ['Paracelsus Sämtliche Werke, Bd. 3', undefined, 3],
    ['Geschichte der Alchemie, Bd. IV', undefined, 4],
    ['Collection des anciens alchimistes grecs, Tome II', undefined, 2],
    ['Theatrum Chemicum, Tomus primus', undefined, 1],
    ['Die Schriften des Paracelsus, Teil 2', undefined, 2],
    ['Hieroglyphic Texts from Egyptian Stelae, Part V', undefined, 5],
    ['Письма Владимира Сергеевича Соловьёва, том 1', undefined, null], // Cyrillic marker: not read (yet)
    ['Corpus Hermeticum', undefined, null],
    ['Picatrix (Ghāyat al-Ḥakīm)', undefined, null],
    // extractVolume reads "Partim" as part "im" = 999; the title never spells 999.
    ['Consuetudines Feudorum, Partim ex editione vulgata', undefined, null],
  ];
  for (const [title, display, want] of cases) {
    it(`${title} → ${want}`, () => {
      expect(volumeNumber({ title, display_title: display })).toBe(want);
    });
  }

  it('title and display title disagreeing is not a fact', () => {
    expect(volumeNumber({ title: 'Opera, Vol. 2', display_title: 'Opera, Vol. 3' })).toBeNull();
  });
});

describe('titleStem', () => {
  it('names the set before the marker or the juan range', () => {
    expect(titleStem('Aristotelis Opera, Vol. I (Bekker 1831)')).toBe('aristotelisopera');
    expect(titleStem('Aristotelis Opera, Vol. 2 (Bekker Edition, Reimer 1831)')).toBe('aristotelisopera');
    expect(titleStem('庚子銷夏記·卷二~卷四 (vol 2)')).toBe('庚子銷夏記');
  });
  it('keeps two series under one work apart', () => {
    expect(titleStem('Seneca Epistulae Morales Vol. 3')).not.toBe(titleStem('Seneca Moral Essays Vol. 1'));
  });
});

describe('volumeTail', () => {
  it('reads what the volume holds', () => {
    expect(volumeTail({ display_title: 'Correct Meaning of the Pitch Pipes, Later Compilation (律呂正義後編), vol. 41: chapters 81–82' })).toBe('chapters 81–82');
    expect(volumeTail({ title: 'Aristotelis Opera, Vol. 3 (Bekker Edition, 1831): Aristoteles Latine' })).toBe('Aristoteles Latine');
    expect(volumeTail({ title: '御製律呂正義後編·卷八十一~卷八十二 (vol 41)' })).toBe('卷八十一~卷八十二');
    expect(volumeTail({ title: 'Mechanica Vol. II (1736)' })).toBe('');
  });
});

const kr = (vol: number, extra: Partial<VolumeCandidate> = {}): VolumeCandidate => ({
  id: `kr${vol}`,
  title: `御製律呂正義後編·卷 (vol ${vol})`,
  display_title: `Correct Meaning of the Pitch Pipes, Later Compilation (律呂正義後編), vol. ${vol}: chapters`,
  language: 'Chinese',
  edition_key: `御製律呂正義後編卷|||v${vol}`,
  image_source: { provider_name: 'Internet Archive' },
  ...extra,
});

describe('buildVolumeSet', () => {
  it('orders a 64-volume set and finds prev / next', () => {
    const all = Array.from({ length: 64 }, (_, i) => kr(i + 1));
    const cur = all[40];
    const set = buildVolumeSet(cur, all.filter((b) => b !== cur))!;
    expect(set.current).toBe(41);
    expect(set.highest).toBe(64);
    expect(set.complete).toBe(true);
    expect(set.prev?.volume).toBe(40);
    expect(set.next?.volume).toBe(42);
    expect(set.volumes.map((v) => v.volume)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
    expect(set.memberIds.size).toBe(63);
  });

  it('a two-volume set; first volume has no prev', () => {
    const a = { id: 'a', title: 'Mechanica Vol. I (1736)', language: 'Latin', year: 1736 };
    const b = { id: 'b', title: 'Mechanica Vol. II (1736)', language: 'Latin', year: 1736 };
    const set = buildVolumeSet(a, [b])!;
    expect(set.prev).toBeNull();
    expect(set.next?.book.id).toBe('b');
    expect(set.complete).toBe(true);
  });

  it('gaps: complete is false (no "of N")', () => {
    const books = [3, 6, 7].map((n) => ({ id: `o${n}`, title: `Opera Poetica omnia, Vol. ${n}`, language: 'Latin' }));
    const set = buildVolumeSet(books[1], [books[0], books[2]])!;
    expect(set.complete).toBe(false);
    expect(set.volumes.map((v) => v.volume)).toEqual([3, 6, 7]);
  });

  it('a translation of the work is not a volume of this set', () => {
    const cur = kr(1);
    const english = { id: 'en1', title: 'Correct Meaning of the Pitch Pipes, Vol. 2', language: 'English' };
    expect(buildVolumeSet(cur, [english])).toBeNull();
  });

  it('two printings each with a vol. 2 → unsure → null (keep the old rail)', () => {
    const cur = { id: 'c', title: 'Opus Majus, Vol. 1', language: 'Latin', year: 1897 };
    const p1 = { id: 'p1', title: 'Opus Majus, Vol. 2', language: 'Latin', year: 1897 };
    const p2 = { id: 'p2', title: 'Opus Majus, Vol. II', language: 'Latin', year: 1900 };
    expect(buildVolumeSet(cur, [p1, p2])).toBeNull();
  });

  it('another library\'s printing or a century apart is not this set', () => {
    const cur = { id: 'c', title: 'Aristotelis Opera, Vol. 4', language: 'Greek', year: 1831, image_source: { provider_name: 'Internet Archive' } };
    const aldine = { id: 'a', title: 'Aristotelis Opera, Vol. 6', language: 'Greek', year: 1495, image_source: { provider_name: 'Internet Archive' } };
    const bsb = { id: 'b', title: 'Aristotelis Opera, Vol. 2', language: 'Greek', year: 1831, image_source: { provider_name: 'Bayerische Staatsbibliothek' } };
    expect(buildVolumeSet(cur, [aldine, bsb])).toBeNull();
  });

  it('no volume number on the current book → null', () => {
    expect(buildVolumeSet({ id: 'x', title: 'Corpus Hermeticum', language: 'Greek' }, [kr(1)])).toBeNull();
  });
});
