import { describe, it, expect } from 'vitest';
import { gpuLoopVerdict, plainLines, repeatedLines, tailRun } from '../../scripts/lib/gpu-ocr-loop-guard.mjs';

/**
 * The guard refuses GPU engine reads before they are written (#6871), so the controls that matter are the genuine
 * repetitive pages it must let through: index pages with leader dots, tables of ditto lines, a litany, a refrain.
 */
const PROSE = 'It was in the year 1834 that the Society first met in the rooms above the old Exchange, and the minutes of '
  + 'that meeting, which are preserved in the archive, record the names of eleven members present.\n'
  + 'The chairman opened the proceedings with a short address on the state of natural philosophy in the county.\n';

describe('gpuLoopVerdict — refuses runaways', () => {
  it('refuses a read that hit the token cap', () => {
    expect(gpuLoopVerdict(PROSE, { finish: 'length' })).toMatchObject({ refuse: true, reason: 'token_cap' });
  });

  it('refuses a good read that runs away at the end on a word (under half the body)', () => {
    const t = PROSE.repeat(6) + 'and the '.repeat(40);
    const v = gpuLoopVerdict(t);
    expect(v).toMatchObject({ refuse: true, reason: 'tail_runaway' });
  });

  it('refuses a bibliography that loops on leader dots to the end (#5660 by-eye 3)', () => {
    const t = PROSE.repeat(3) + '3. Sefer ha-Yashar, Amsterdam 1707.\n4. Sefer Zedek, Venice 1590 ' + '... '.repeat(200);
    expect(gpuLoopVerdict(t)).toMatchObject({ refuse: true, reason: 'tail_runaway' });
  });

  it('refuses the same line repeated four times', () => {
    const t = PROSE + 'The chairman opened the proceedings\n'.repeat(4) + PROSE;
    expect(gpuLoopVerdict(t)).toMatchObject({ refuse: true, reason: 'repeated_lines' });
  });

  it('refuses what the #4850 guard refuses (one unit over half the body)', () => {
    expect(gpuLoopVerdict('Lorem ipsum. ' + 'abcdefg '.repeat(200) + ' end of page.').refuse).toBe(true);
  });
});

describe('gpuLoopVerdict — lets genuine repetition through', () => {
  it('passes ordinary prose', () => {
    expect(gpuLoopVerdict(PROSE.repeat(4))).toMatchObject({ refuse: false, reason: 'ok' });
  });

  it('passes an index page whose leader dots end in page numbers', () => {
    const t = ['Abbey of St. Albans', 'Acre, siege of', 'Agricola, Georgius', 'Albertus Magnus', 'Alchemy, early history of',
      'Aldrovandi', 'Ashmole, Elias', 'Bacon, Roger', 'Basil Valentine', 'Boyle, Robert']
      .map((e, i) => `${e} ${'. '.repeat(30)}${12 + i * 7}`).join('\n');
    expect(gpuLoopVerdict(t).refuse).toBe(false);
  });

  it('passes a table of ditto lines', () => {
    const t = PROSE + Array.from({ length: 12 }, (_, i) => `Do. do. ${1820 + i} | 4 | 6`).join('\n');
    expect(gpuLoopVerdict(t).refuse).toBe(false);
  });

  it('passes a litany (a refrain that varies between repeats)', () => {
    const t = ['Holy Mary', 'Holy Mother of God', 'Holy Virgin of virgins', 'Mother of Christ', 'Mother of divine grace',
      'Mother most pure', 'Mother most chaste', 'Mother inviolate'].map((n) => `${n}, pray for us.`).join('\n');
    expect(gpuLoopVerdict(t).refuse).toBe(false);
  });

  it('passes a refrain repeated three times in a row', () => {
    const t = PROSE + 'Sing heigh-ho, unto the green holly\n'.repeat(3) + PROSE;
    expect(gpuLoopVerdict(t).refuse).toBe(false);
  });
});

describe('helpers', () => {
  it('plainLines drops olmOCR front matter and markup', () => {
    expect(plainLines('---\nprimary_language: en\n---\n<p>One</p><p>Two</p>')).toEqual(['One', 'Two']);
  });
  it('plainLines keeps text after a bare --- rule (LightOnOCR opens with one)', () => {
    expect(plainLines('---\n\n62\n\n# CHAPITRE XV\n\n---\n\nmore')).toEqual(['---', '62', '# CHAPITRE XV', '---', 'more']);
  });
  it('repeatedLines finds the longest block', () => {
    expect(repeatedLines(['a long enough line here', 'a long enough line here', 'x'])?.reps).toBe(2);
  });
  it('tailRun ignores a run that does not reach the end', () => {
    expect(tailRun(['and the '.repeat(40), PROSE])).toBeNull();
  });
});
