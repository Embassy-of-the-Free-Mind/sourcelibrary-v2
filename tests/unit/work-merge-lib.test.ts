import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module, no type declarations
import {
  rankFormat, pickWinner, canonGoldClusters, identicalTitleKey,
  identicalTitleClusters, containmentPair, containmentCandidates,
  editionConflictClusters, unionMergeClusters,
} from '../../scripts/lib/work-merge-lib.mjs';
import { CANON_WORKS, canonWorkForWorkId } from '@/lib/canon-works';

describe('pickWinner', () => {
  it('prefers a Wikidata QID over minted and legacy ids', () => {
    expect(pickWinner(['local:a:plato:timaeus', 'Q371884', 'plato-timaeus'])).toBe('Q371884');
  });
  it('prefers local:a over local:n over legacy slugs', () => {
    expect(pickWinner(['plato-timaeus', 'local:n:x:y', 'local:a:x:y'])).toBe('local:a:x:y');
    expect(rankFormat('seneca-epistulae-morales')).toBe(3);
  });
  it('breaks QID ties by shortest id, deterministically', () => {
    expect(pickWinner(['Q125518202', 'Q16547641'])).toBe('Q16547641');
    expect(pickWinner(['Q16547641', 'Q125518202'])).toBe('Q16547641');
  });
  it('breaks same-format ties by inbound book count when a map is given', () => {
    const inbound = new Map([['local:a:x:aaa-long-id', 5], ['local:a:x:bb', 1]]);
    expect(pickWinner(['local:a:x:bb', 'local:a:x:aaa-long-id'], inbound)).toBe('local:a:x:aaa-long-id');
    // format rank still dominates inbound count
    expect(pickWinner(['local:n:x:popular', 'local:a:x:rare'], new Map([['local:n:x:popular', 9]]))).toBe('local:a:x:rare');
  });
});

describe('edition-conflict lane (#3730 §3)', () => {
  const maps = {
    titleVariants: new Map([
      ['local:a:christian-wolff:empirical-psychology', 1],
      ['local:n:christian-wolff:empirica-psychologia', 1],
      ['local:a:many-titles:w', 3],
    ]),
    inbound: new Map([
      ['local:a:christian-wolff:empirical-psychology', 2],
      ['local:n:christian-wolff:empirica-psychologia', 1],
    ]),
  };
  const mech = {
    key: 'psychologia empirica|wolff|1732|v',
    works: ['local:a:christian-wolff:empirical-psychology', 'local:n:christian-wolff:empirica-psychologia'],
    authorIds: ['christian-wolff', 'christian-wolff'],
  };

  it('merges the mechanical gloss/original pair, a: mint wins', () => {
    const out = editionConflictClusters([mech], maps);
    expect(out).toHaveLength(1);
    expect(out[0].winner).toBe('local:a:christian-wolff:empirical-psychology');
    expect(out[0].losers).toEqual(['local:n:christian-wolff:empirica-psychologia']);
    expect(out[0].source).toBe('edition-conflict');
  });

  it('refuses a QID pair (external identity is not mechanical)', () => {
    const out = editionConflictClusters([{ ...mech, works: ['Q123', mech.works[1]] }], maps);
    expect(out).toHaveLength(0);
  });

  it('refuses 3+-way clusters (generic titles bridge distinct works)', () => {
    const out = editionConflictClusters([{ ...mech, works: [...mech.works, 'local:a:christian-wolff:third'] }], maps);
    expect(out).toHaveLength(0);
  });

  it('refuses when author_id is missing or disagrees', () => {
    expect(editionConflictClusters([{ ...mech, authorIds: ['christian-wolff', null] }], maps)).toHaveLength(0);
    expect(editionConflictClusters([{ ...mech, authorIds: ['christian-wolff', 'someone-else'] }], maps)).toHaveLength(0);
  });

  it('refuses when a work_id carries more than one title across ALL its books', () => {
    const out = editionConflictClusters(
      [{ ...mech, works: [mech.works[0], 'local:a:many-titles:w'], authorIds: ['christian-wolff', 'christian-wolff'] }],
      maps,
    );
    expect(out).toHaveLength(0);
  });
});

describe('canonGoldClusters', () => {
  // The registry AS IT STOOD before the 2026-08-08 merge run — frozen here so
  // the extraction rules stay pinned even though the live registry has since
  // shrunk to single ids (the merge's whole point).
  const PRE_MERGE_REGISTRY = [
    { slug: 'iliad', workIds: ['Q125518202', 'Q16547641', 'homer-homer-iliad-odyssey', 'Q19090449'] },
    { slug: 'odyssey', workIds: ['local:a:homer:dolinghe-odyssea-ulysse-van', 'Q19090449', 'homer-homer-iliad-odyssey'] },
    { slug: 'republic', workIds: ['plato-republic'], collectedWorkIds: ['Q139619812', 'plato-opera-ficino'] },
    { slug: 'timaeus', workIds: ['Q371884', 'plato-timaeus'] },
  ];
  const clusters = canonGoldClusters(PRE_MERGE_REGISTRY);

  it('never includes an id shared between two canon entries (combined volumes)', () => {
    // Q19090449 and homer-homer-iliad-odyssey are Iliad+Odyssey combined
    // volumes, listed in BOTH entries — merging them into either work would
    // silently pull it off the other's page.
    for (const c of clusters) {
      expect(c.ids).not.toContain('Q19090449');
      expect(c.ids).not.toContain('homer-homer-iliad-odyssey');
    }
  });

  it('produces a merge set for the Iliad from its unshared ids only', () => {
    const iliad = clusters.find((c) => c.slug === 'iliad');
    expect(iliad).toBeDefined();
    expect(iliad!.ids.sort()).toEqual(['Q125518202', 'Q16547641']);
    expect(iliad!.winner).toBe('Q16547641');
  });

  it('skips entries left with fewer than two unshared ids', () => {
    expect(clusters.find((c) => c.slug === 'republic')).toBeUndefined();
    expect(clusters.find((c) => c.slug === 'odyssey')).toBeUndefined();
  });

  it('prefers the QID winner (timaeus)', () => {
    expect(clusters.find((c) => c.slug === 'timaeus')!.winner).toBe('Q371884');
  });

  it('LIVE registry steady state: no mergeable fragmentation remains', () => {
    // Post-merge every entry holds one id (plus genuinely-shared combined
    // volumes). If this fails, someone added a multi-id entry — run
    // merge-work-clusters.mjs instead of growing the array.
    expect(canonGoldClusters(CANON_WORKS)).toEqual([]);
  });

  it('LIVE registry never lists a collected id inside workIds', () => {
    const collected = new Set(CANON_WORKS.flatMap((w) => w.collectedWorkIds || []));
    for (const w of CANON_WORKS) for (const id of w.workIds) expect(collected.has(id)).toBe(false);
  });
});

describe('identical-title lane', () => {
  const rep = (work_id: string, title: string, author = 'Luca Pacioli', language = 'Latin') =>
    ({ work_id, title, author, language });

  it('clusters two ids with the same author and identical normalized title', () => {
    const out = identicalTitleClusters([
      rep('local:a:pacioli:summa-arithmetica', 'Summa de arithmetica geometria proportioni'),
      rep('local:n:pacioli:summa-arithmetic', 'Summa de Arithmetica, Geometria, Proportioni'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].winner).toBe('local:a:pacioli:summa-arithmetica');
  });

  it('refuses Tibetan and volume-marked titles (grain hazards)', () => {
    expect(identicalTitleKey(rep('x', 'gsung thor bu spellings here', 'Anon', 'Tibetan'))).toBeNull();
    expect(identicalTitleKey(rep('x', 'Opera omnia tomus II something'))).toBeNull();
  });

  it('keeps series siblings apart via the series key', () => {
    const out = identicalTitleClusters([
      rep('w1', 'Proverbs collection number 10', 'Anon x'),
      rep('w2', 'Proverbs collection number 11', 'Anon x'),
    ]);
    expect(out).toHaveLength(0);
  });

  it('refuses a rep standing for a polluted id (multiple distinct titles)', () => {
    // production case: ellis-tshispeaking-peoples-gold-coast held the Yoruba,
    // Tshi AND Ewe volumes; its rep matched the Yoruba id and the whole
    // polluted id would have been moved onto the wrong work.
    const polluted = { ...rep('ellis-tshi', 'The Yoruba-Speaking Peoples of the Slave Coast', 'A. B. Ellis', 'English'), titleVariants: 3 };
    const clean = { ...rep('local:a:ellis:yoruba', 'The Yoruba-Speaking Peoples of the Slave Coast', 'A. B. Ellis', 'English'), titleVariants: 1 };
    expect(identicalTitleClusters([polluted, clean])).toHaveLength(0);
    expect(identicalTitleClusters([{ ...polluted, titleVariants: 1 }, clean])).toHaveLength(1);
  });

  it('never clusters across authors', () => {
    const out = identicalTitleClusters([
      rep('w1', 'De occulta philosophia libri tres', 'Agrippa'),
      rep('w2', 'De occulta philosophia libri tres', 'Paracelsus'),
    ]);
    expect(out).toHaveLength(0);
  });
});

describe('containment lane (MEDIUM queue)', () => {
  const rep = (work_id: string, title: string, extra: Record<string, unknown> = {}) =>
    ({ work_id, title, author: 'Homer', author_id: 'a1', language: 'Greek', ...extra });

  it('flags a fit-rule containment pair as a candidate, never a merge', () => {
    const pairs = containmentCandidates([
      rep('Q1', 'The Iliad of Homer with notes and a life of the author'),
      rep('local:a:homer:iliad', 'Iliad Homer'),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].source).toBe('containment');
    expect(pairs[0].cont).toBeGreaterThanOrEqual(0.8);
  });

  it('rejects an all-generic anchor ("Works", "Fragments")', () => {
    expect(containmentPair(
      rep('a', 'Fragments works'),
      rep('b', 'Collected works and fragments of early poets'),
    )).toBeNull();
  });

  it('rejects series-key mismatches', () => {
    expect(containmentPair(
      rep('a', 'Histories book 3 of the Persian wars'),
      rep('b', 'Histories book 4 of the Persian wars'),
    )).toBeNull();
  });

  it('requires at least two shared significant tokens', () => {
    expect(containmentPair(rep('a', 'Odyssey translated'), rep('b', 'Odyssey'))).toBeNull();
  });

  it('never compares across author blocks', () => {
    const pairs = containmentCandidates([
      rep('Q1', 'Iliad of Homer complete text', { author_id: 'a1' }),
      rep('Q2', 'Iliad of Homer complete text', { author_id: 'a2' }),
    ]);
    expect(pairs).toHaveLength(0);
  });
});

describe('unionMergeClusters', () => {
  it('unions overlapping clusters and picks one winner', () => {
    const { merges } = unionMergeClusters([
      { source: 'canon-registry', ids: ['Q1', 'local:a:x:y'], winner: 'Q1', losers: ['local:a:x:y'] },
      { source: 'identical-title', ids: ['local:a:x:y', 'x-legacy'], winner: 'local:a:x:y', losers: ['x-legacy'] },
    ]);
    expect(merges).toHaveLength(1);
    expect(merges[0].winner).toBe('Q1');
    expect(merges[0].losers.sort()).toEqual(['local:a:x:y', 'x-legacy']);
    expect(merges[0].sources).toEqual(['canon-registry', 'identical-title']);
  });

  it('demotes any union spanning two canon entries instead of merging', () => {
    const canonMap = new Map([['Q1', 'iliad'], ['Q2', 'odyssey']]);
    const { merges, demoted } = unionMergeClusters(
      [{ source: 'identical-title', ids: ['Q1', 'Q2'], winner: 'Q2', losers: ['Q1'] }],
      canonMap,
    );
    expect(merges).toHaveLength(0);
    expect(demoted).toHaveLength(1);
    expect(demoted[0].reason).toContain('iliad');
  });
});

describe('alias redirect target', () => {
  it('a surviving canon work_id resolves to its canon slug', () => {
    // mirrors workAliasTarget()'s canon preference without a DB
    expect(canonWorkForWorkId('Q16547641')?.slug).toBe('iliad');
    expect(canonWorkForWorkId('Q371884')?.slug).toBe('timaeus');
    expect(canonWorkForWorkId('some-random-work')).toBeUndefined();
  });
});
