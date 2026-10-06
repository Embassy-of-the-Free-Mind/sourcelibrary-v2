import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { guardTranslationText, guardTermDefinitions, isBracketDefinition } from '@/lib/translation-write-guard';
import * as mjs from '../../scripts/lib/translation-write-guard.mjs';
import * as core from '../../scripts/lib/translate-core.mjs';

/**
 * The write-time guard (#5902): the model's definitions are stored as <note>s.
 *
 * Excerpts are real:
 *  - GEOMANCY: stored translation, book 6975158aa88d83c830d99e22 p.83 (v2 prompt).
 *  - The bracket cases are the note-free arm of #5919
 *    (scripts/eval/results/translation-notes-free-2026-10/arms.jsonl, arm v13-plain):
 *    Sidereus Nuncius 6953e46f77f38f6761bee559_40, Hebrew 699ef9f2c2bcb75dbdbaad92_102,
 *    Aramaic 6990633def12272ffdc907b0_211, Dutch 69b185e9c4be2cdd0edc464c_489,
 *    Chinese 69e72c6ba409200ea79f484e_102 (Zisang Hu), and the Zohar `[said]:` lines.
 */
const GEOMANCY =
  '**Geomancy** <term>Geomancy: A method of divination that interprets markings on the ground or the patterns formed by tossed handfuls of soil, rocks, or sand.</term>, an art performed through points without a natural basis;';

describe('shape 1 — a definition inside the chip', () => {
  it('keeps only the note when the head already stands before the chip (Geomancy)', () => {
    expect(guardTranslationText(GEOMANCY)).toBe(
      '**Geomancy** <note>A method of divination that interprets markings on the ground or the patterns formed by tossed handfuls of soil, rocks, or sand.</note>, an art performed through points without a natural basis;'
    );
  });

  it('splits a short head and an English gloss (Luna)', () => {
    expect(guardTranslationText('the <term>Luna: the alchemical name for silver</term> is fixed')).toBe(
      'the <term>Luna</term> <note>the alchemical name for silver</note> is fixed'
    );
  });

  it('leaves a mantra with no colon unchanged', () => {
    const mantra = 'he recited <term>oṃ namo bhagavate bhaiṣajyaguru vaiḍūryaprabharājāya tathāgatāya arhate samyaksaṃbuddhāya</term> three times';
    expect(guardTranslationText(mantra)).toBe(mantra);
  });

  it('never writes a <note> inside another annotation span', () => {
    const t = '<margin>see <term>Luna: the alchemical name for silver</term></margin> and so on';
    expect(guardTranslationText(t)).toBe(t);
  });
});

describe('shape 2 — a bracketed definition after a chip (#5919)', () => {
  const cases: Array<[string, string]> = [
    [
      'the stars that astronomers have called <term>NEBULOSAE</term> [nebulous] until this very day are clusters',
      'the stars that astronomers have called <term>NEBULOSAE</term> <note>nebulous</note> until this very day are clusters',
    ],
    [
      'The second contains the <term>NEBULOSAM</term> called <term>PRAESEPE</term> [the Manger], which is not just one star',
      'The second contains the <term>NEBULOSAM</term> called <term>PRAESEPE</term> <note>the Manger</note>, which is not just one star',
    ],
    [
      '-><term>NEBULOSA ORIONIS</term> [Orion Nebula].<-',
      '-><term>NEBULOSA ORIONIS</term> <note>Orion Nebula</note>.<-',
    ],
    [
      'For the term <term>Tamim</term> [perfect] is the secret of two things, and it is as if it said <term>Teumim</term> [twins], except',
      'For the term <term>Tamim</term> <note>perfect</note> is the secret of two things, and it is as if it said <term>Teumim</term> <note>twins</note>, except',
    ],
    [
      'what it said <term>Ach</term> [but] is a division',
      'what it said <term>Ach</term> <note>but</note> is a division',
    ],
    [
      '"and you shall take" <term>pederos</term> [an honor], just as the Holy One',
      '"and you shall take" <term>pederos</term> <note>an honor</note>, just as the Holy One',
    ],
    [
      'which we call <term>Krimp-schelvis</term> [shivering haddock], and for some days',
      'which we call <term>Krimp-schelvis</term> <note>shivering haddock</note>, and for some days',
    ],
  ];
  it.each(cases)('%s', (input, expected) => {
    expect(guardTranslationText(input)).toBe(expected);
  });

  it('counts what it changed', () => {
    const { n } = guardTermDefinitions(cases[3][0]);
    expect(n.bracket).toBe(2);
  });
});

describe('brackets that are the translator’s supplied words stay (#4385)', () => {
  const unchanged = [
    'what a [mere trick] performs',
    '**Rabbi Isaac** [said]: it is written:',
    // A speech verb supplied after a name is the sentence, not a gloss of the name.
    'and my followers and friends increasingly disperse. Why is this?" <term>Zisang Hu</term> [replied]\n\n',
    '<term>Rabbi Yehuda</term> [said]: all the hidden things',
    '<term>Rabbi Yehuda</term> [opened]: all the hidden things',
    'and they shall be doubled [<term>Teumim</term>] from below together',
    'according to <term>Para[celsus]</term> one must proceed',
    'the word <term>ꝑ</term> [sic] stands here',
    'the word <term>X</term> [?] stands here',
    'the word <term>X</term> [illegible] stands here',
    'see <term>Almagest</term> [fol. 12r] for this',
    'see <term>Almagest</term> [3] for this',
    'a link <term>X</term> [the manual](https://example.org) here',
    '<note>the <term>Tamim</term> [perfect] reading</note>',
  ];
  it.each(unchanged)('%s', (t) => {
    expect(guardTranslationText(t)).toBe(t);
  });

  it('a bracket too long to be a gloss is a supplied clause', () => {
    expect(isBracketDefinition('which is to say the whole of what was said before this')).toBe(false);
  });
});

describe('properties', () => {
  it('is idempotent', () => {
    for (const t of [GEOMANCY, 'For the term <term>Tamim</term> [perfect] is the secret']) {
      const once = guardTranslationText(t);
      expect(guardTranslationText(once)).toBe(once);
    }
  });

  it('passes empty and non-string input through', () => {
    expect(guardTranslationText('')).toBe('');
    expect(guardTranslationText(null as unknown as string)).toBe(null);
  });

  it('TS name, scripts module and translate-core are one function', () => {
    expect(guardTranslationText).toBe(mjs.guardTranslationText);
    expect(core.guardTranslationText).toBe(mjs.guardTranslationText);
  });
});

describe('every translation writer runs the guard', () => {
  // The writers that run the stray-script gate (#5734) are the ones that store model output;
  // each must also run this guard before translation.data is written.
  const WRITERS = [
    'scripts/lib/translate-core.mjs',
    'scripts/workers/translate-worker.mjs',
    'scripts/workers/batch-collector.mjs',
    'scripts/batch/collect-batch-results.mjs',
    'src/lib/translate-write.ts',
    'src/app/api/[tenant]/books/[id]/batch-translate-async/route.ts',
    'src/app/api/books/[id]/batch-translate-async/route.ts',
    'src/app/api/batch-save/route.ts',
    'src/app/api/contribute/process/route.ts',
    'src/app/api/process/route.ts',
    'src/workers/translation-processor-logic.ts',
  ];
  it.each(WRITERS)('%s', (file) => {
    expect(fs.readFileSync(file, 'utf8')).toMatch(/guardTranslationText\(/);
  });
});
