/**
 * The lean seam runner's write-path guards (#6742). Fixtures are stored text and model replies copied from the
 * 2026-10-16 runs (smoke run lean-20261016014746 and the pilot's join 3bd2cbc18af5), not written toward a verdict.
 *  - mapProjected: a span that crosses <term>/<gloss> or heading marks maps onto the stored page, and only the words
 *    the edit changes are rewritten — the tags around untouched words survive; an edit inside markup is refused.
 *  - lostWords: a repair that makes content vanish from the join (a title page deleted, a dedication replaced by
 *    "[This page is blank.]") is refused; removing one copy of a doubled sentence is not.
 *  - echoRepair: the doubled word is removed on the side the source does not carry it.
 *  - driftOnly / placeRun: a join whose only defect is drift is skipped (invisible in the continuous view, #7118);
 *    drift together with another defect is not.
 *  - --majors-wide: a major the edge bound refuses is placed under MAJORS_WIDE (flagged `wide`); a minor never is, and
 *    edgeRefusal's default bound is unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { mapOntoRaw, mapProjected, edgeRefusal } from '../../scripts/maintenance/seam-repair-6742/seam-repair.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { lostWords, MAX_LOST, driftOnly, DRIFT_ONLY, placeRun, MAJORS_WIDE } from '../../scripts/maintenance/seam-repair-6742/lean.mjs';
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

  it('refuses an insertion that would land inside a bold heading (lean dry run, Korean ledger)', () => {
    const raw = '- **Fourth Category: Junior Second Rank**\n  ';
    const r = mapOntoRaw(raw, 'head', 'Fourth Category: Junior Second Rank', '1 seok 5 du\n- Fourth Category: Junior Second Rank');
    expect(r.refuse).toMatch(/against-markup/);
  });

  it('refuses an edit on a table row (lean dry run, "[price missing]")', () => {
    const raw = '3 boxes | price per 8 boxes: 2 [taels] |\n| Yams | 3 boxes | [price missing] |';
    const r = mapOntoRaw(raw, 'tail', '| Yams | 3 boxes | [price missing] |', '| Yams | 3 boxes | |');
    expect(r.refuse).toMatch(/table-row/);
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

describe('driftOnly (#7118)', () => {
  it('is true only when drift is the one defect label', () => {
    expect(driftOnly({ label: 'drift', labels: ['drift'], severity: 'minor' })).toBe(true);
    expect(driftOnly({ label: 'drift' })).toBe(true);
    expect(driftOnly({ label: 'drift', labels: ['drift', 'duplication'] })).toBe(false);
    expect(driftOnly({ label: 'omission', labels: ['omission', 'drift'] })).toBe(false);
    expect(driftOnly({ label: 'ok', labels: ['ok'] })).toBe(false);
    expect(driftOnly(null)).toBe(false);
  });

  it('placeRun refuses a drift-only join before placement, and places drift with another defect as before', () => {
    const out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'lean-drift-'));
    const it0 = (id: string) => ({ id, enTailA: 'He went to the city of the', enHeadB: 'king, and there he stayed.', srcTailA: 'x', srcHeadB: 'y' });
    fs.writeFileSync(path.join(out, 'candidates.jsonl'), ['a', 'b', 'c', 'd'].map(id => JSON.stringify(it0(id))).join('\n') + '\n');
    const rows = [
      { id: 'a', run: 'R', parsed: true, label: 'drift', labels: ['drift'], skipped: DRIFT_ONLY, repair: { tail_old: 'the', tail_new: 'the king,', head_old: 'king, and', head_new: 'and' } },
      { id: 'b', run: 'R', parsed: true, label: 'drift', labels: ['drift'], repair: null },   // an older row, written before the skip existed
      { id: 'c', run: 'R', parsed: true, label: 'duplication', labels: ['duplication', 'drift'], repair: null },
      { id: 'd', run: 'R', parsed: true, label: 'ok', labels: ['ok'], repair: null },
    ];
    fs.writeFileSync(path.join(out, 'repairs.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const { placedRows, refusals } = placeRun(out, 'R');
    expect(placedRows).toEqual([]);
    expect(refusals['skipped-drift-only']).toBe(2);
    expect(refusals['labelled-ok']).toBe(1);
    expect(refusals['no-repair']).toBe(1);   // c went on to placement
    fs.rmSync(out, { recursive: true, force: true });
  });
});

describe('--majors-wide (#7118)', () => {
  const it0 = (id: string) => ({ id, enTailA: 'The king rode out at dawn. He went to the city of the', enHeadB: 'west, and there he stayed.', srcTailA: 'x', srcHeadB: 'y' });
  const restored = 'He went to the city of the ' + Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ') + '. And then';
  const rep = { tail_old: 'He went to the city of the', tail_new: restored, head_old: '', head_new: '' };

  it('the default edge bound is unchanged; the wide bound admits a two-sentence restore', () => {
    expect(edgeRefusal(it0('a'), rep)).toBe('edit-too-large');
    expect(edgeRefusal(it0('a'), rep, MAJORS_WIDE)).toBeNull();
    const three = { ...rep, tail_new: 'He went to the city. One more here. Two more here. Three more here. And then' };
    expect(edgeRefusal(it0('a'), three, MAJORS_WIDE)).toBe('restores-more-than-2-sentences');
  });

  it('placeRun places a refused major as wide only with the flag, and never a minor', () => {
    const out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'lean-wide-'));
    fs.writeFileSync(path.join(out, 'candidates.jsonl'), ['M', 'm'].map(id => JSON.stringify(it0(id))).join('\n') + '\n');
    fs.writeFileSync(path.join(out, 'repairs.jsonl'), [
      { id: 'M', run: 'R', parsed: true, label: 'omission', labels: ['omission'], severity: 'major', repair: rep },
      { id: 'm', run: 'R', parsed: true, label: 'omission', labels: ['omission'], severity: 'minor', repair: rep },
    ].map(r => JSON.stringify(r)).join('\n') + '\n');
    expect(placeRun(out, 'R').placedRows).toEqual([]);
    const { placedRows, refusals } = placeRun(out, 'R', { majorsWide: true });
    expect(placedRows.map((r: { id: string; wide?: boolean; normalRefusal?: string }) => [r.id, r.wide, r.normalRefusal])).toEqual([['M', true, 'edit-too-large']]);
    expect(refusals['edit-too-large']).toBe(1);
    fs.rmSync(out, { recursive: true, force: true });
  });
});
