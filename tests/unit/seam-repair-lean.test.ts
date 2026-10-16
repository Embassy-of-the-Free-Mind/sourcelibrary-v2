/**
 * The lean seam runner's write-path guards (#6742). Fixtures are stored text and model replies copied from the
 * 2026-10-16 runs (smoke run lean-20261016014746 and the pilot's join 3bd2cbc18af5), not written toward a verdict.
 *  - mapProjected: a span that crosses <term>/<gloss> or heading marks maps onto the stored page, and only the words
 *    the edit changes are rewritten — the tags around untouched words survive; an edit inside markup is refused.
 *  - lostWords: a repair that makes content vanish from the join (a title page deleted, a dedication replaced by
 *    "[This page is blank.]") is refused; removing one copy of a doubled sentence is not.
 *  - echoRepair: the doubled word is removed on the side the source does not carry it.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { mapOntoRaw, mapProjected } from '../../scripts/maintenance/seam-repair-6742/seam-repair.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { lostWords, MAX_LOST } from '../../scripts/maintenance/seam-repair-6742/lean.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { echoRepair } from '../../scripts/maintenance/seam-repair-6742/rules.mjs';

// Utriusque Cosmi Historia vol. 1, stored translation head (first 300 chars)
const DAEMONS = '<meta>continues from previous page: The</meta> spiritual creatures created on the first day in and with the spiritual heaven are divided by us into two species: these are <term>Daemons</term> <gloss>spirits</gloss> and souls. The <term>Daemons</term>, whom Theologians call angels, we further subordinate into good and evil; others name these <term>beneficent</term> and <term>maleficent</term>, and ';

describe('mapProjected', () => {
  it('maps a head span that crosses <term>/<gloss> and keeps the tags', () => {
    const r = mapOntoRaw(DAEMONS, 'head',
      'spiritual creatures created on the first day in and with the spiritual heaven are divided by us into two species: these are Daemons spirits and souls.',
      'creatures created on the first day in and with the spiritual heaven are divided by us into two species: these are Daemons spirits and souls.');
    expect(r.refuse).toBeUndefined();
    expect(r.text.startsWith('<meta>continues from previous page: The</meta> creatures created on the first day')).toBe(true);
    expect(r.text).toContain('<term>Daemons</term> <gloss>spirits</gloss> and souls.');
  });

  it('refuses an edit that would cut through markup', () => {
    const raw = 'ing greater than it might \n->allow.<-\n\n<summary>The author argues.</summary>';
    const r = mapProjected(raw, 'tail', 'than it might \n- allow.<-', '');
    expect(r.refuse).toMatch(/markup/);
  });

  it('refuses a span that is not at the stored edge', () => {
    const r = mapProjected(DAEMONS, 'head', 'The Daemons , whom Theologians call angels', 'The Daemons , whom theologians call angels');
    expect(r.refuse).toMatch(/not-at-edge/);
  });
});

describe('lostWords', () => {
  const it0 = {
    enTailA: '…the celestial or spiritual',
    enHeadB: 'SECOND TREATISE,\n ON THE APE OF NATURE\n or the Technical History of the Macrocosm,\n- divided into eleven parts.<-\n- BY THE AUTHOR<-\n ROBERT FLUDD, ALSO KNOWN AS DE\n- Fluctibus, Esquire and Doctor of Medicine <-',
  };
  it('refuses a repair that deletes a title page head (Gemini, smoke run)', () => {
    const rep = { tail_old: '', tail_new: '', head_old: it0.enHeadB, head_new: '[This page is blank.]' };
    expect(lostWords(it0, rep).length).toBeGreaterThan(MAX_LOST);
  });
  it('passes removing one copy of a doubled sentence (planted dup, #6742 set)', () => {
    const it1 = { enTailA: '…in your memory. Who would deny this duty of a Friend?', enHeadB: 'Who would deny this duty of a Friend? Provided that I live' };
    const rep = { tail_old: '', tail_new: '', head_old: 'Who would deny this duty of a Friend? ', head_new: '' };
    expect(lostWords(it1, rep)).toEqual([]);
  });
});

describe('echoRepair', () => {
  // pilot join 3bd2cbc18af5: source N ends "venas," and N+1 opens on the remnant "nas," — the split word is N's
  const join = {
    srcTailA: '…sanguis à iecore traducitur per totum corpus, non amplius indiget multo vehiculo: & ob id natura creauit venas,',
    srcHeadB: 'nas, vt huiusmodi serosam humiditatem ad se attraherent, & post ad vesicam deriuarent.…',
    enTailA: '…it no longer needs a large vehicle: and for this reason nature created veins,',
    enHeadB: 'veins, to attract this kind of serous humidity to themselves, and afterwards to derive it to the bladder.…',
  };
  it('keeps the split word on page N and removes it from N+1', () => {
    const r = echoRepair(join);
    expect(r.cause).toBe('keep-N');
    expect(r.repair.tail_old).toBe('');
    expect(join.enHeadB.startsWith(r.repair.head_old)).toBe(true);
    expect(r.repair.head_new.startsWith('to attract')).toBe(true);
  });
  it('declines when the source gives no cause for the repeat', () => {
    const r = echoRepair({ ...join, srcTailA: '…natura creauit uasa.', srcHeadB: 'Vt huiusmodi serosam humiditatem…' });
    expect(r.decline).toBe('echo-no-source-cause');
  });
});
