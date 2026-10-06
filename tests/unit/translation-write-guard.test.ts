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

describe('shape 2 — a bracketed definition after a chip the sentence names (#5919)', () => {
  const cases: Array<[string, string]> = [
    [
      'The second contains the <term>NEBULOSAM</term> called <term>PRAESEPE</term> [the Manger], which is not just one star',
      'The second contains the <term>NEBULOSAM</term> called <term>PRAESEPE</term> <note>the Manger</note>, which is not just one star',
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
      'engraved the great Name <term>Jehovah Shammah</term> [The Lord is There]. The second',
      'engraved the great Name <term>Jehovah Shammah</term> <note>The Lord is There</note>. The second',
    ],
    [
      'more exactly than through the word <term>Geselle</term> [journeyman]. – The responsibility',
      'more exactly than through the word <term>Geselle</term> <note>journeyman</note>. – The responsibility',
    ],
    [
      'Therefore he said <term>Yotzer</term> [Former]. Darkness, for there was',
      'Therefore he said <term>Yotzer</term> <note>Former</note>. Darkness, for there was',
    ],
    [
      'goes out from things, which is vulgarly called <term>lotii</term> [urine], because by it',
      'goes out from things, which is vulgarly called <term>lotii</term> <note>urine</note>, because by it',
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
    const { n } = guardTermDefinitions(cases.find(([i]) => i.includes('Tamim'))![0]);
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
    // Stored v10–v13 pages (random draw, 2026-10-06): the noun or verb the sentence needs.
    'and passions of the anus, <term>iliac</term> [disorders], and passions',
    'a plaster is made with them for hot <term>apathetic</term> [conditions], and it is mixed with honey',
    'If the head is entirely opened, <term>cephalic</term> [vein]. If the stomach and heart',
    'whose number is 6, <term>Tiphereth</term> [is denoted], which are her ornaments.',
    '[Ye] have said that <term>Batu</term> [should judge it].',
    'In Jerusalem, after the wonderful <term>John</term>, <term>Praylius</term> [took] the',
    'Giovanni in the aforementioned chapter <term>Sunt quidam</term> [states] that he can well dispense',
    'in the <term>monoculus</term> [it] completes that which was not',
    'Udāna</term> [aggravated] by suppressing swelling',
    // A respelling of the term is the translator's correction of the word (long s read as f).
    '<term>Fufina</term> [fusina] <gloss>a foundry</gloss> 358',
    'was a bright <term>Saphir</term> [Sapphire], upon which',
    // Ambiguous with no naming cue and no capital: left as the translator's bracket.
    '"and you shall take" <term>pederos</term> [an honor], just as the Holy One',
    // An English cognate is indistinguishable from a respelling: left bracketed.
    'the stars that astronomers have called <term>NEBULOSAE</term> [nebulous] until this very day are clusters',
    // With no naming cue, a gloss is not told apart from the rest of a name: both stay bracketed.
    '-><term>NEBULOSA ORIONIS</term> [Orion Nebula].<-',
    'When his will is in the <term>Ee</term> [Law] of the Lord',
    'He argues from the notes in the <term>Clementine</term> [Constitutions] "On Rescripts,"',
    'according to <term>Vincentius</term> [Hispanus] in the chapter',
    'and through <term>Innocentius</term> [IV], <term>Hostiensis</term>',
    // A supplied clause after a naming cue.
    'M.T. [Cicero] says <term>bustum</term> [is what] the Greeks call',
    // The `term` in a preceding tag is not a naming cue (stored v13 grammar, p305).
    'Before <term>DO</term>: <term>dulcedo</term> [sweetness], <term>libido</term> [lust]',
    'from "to suffer" <term>petho</term>, <term>petho</term> [fut.] <term>peros</term>',
    // Legal idiom on stored v11/v13 pages: "the said" is "the aforesaid"; a title is a citation.
    'he refers himself to the said <term>Clementine</term> [Constitutions] "On Simony,"',
    '§ <term>abbatissa</term> and title <term>de pa. in. fir.</term> [concerning] those on little paths',
    'Hence some wish it to be called <term>Atherfatha</term> [c], as if',
    'They also call <term>germanum</term> [one] who has the same father',
    'his essence called <term>Strengthening the Joy Near to Passion</term> [emerged] from the expanse',
    'with a double allusion to the name <term>Reitmohren</term> [Bav.] (a)',
    'But they are called <term>προσλαμβανόμενα</term> [when] they are taken',
    'Through *Er* he says <term>satyria</term> [comes from] satiety',
    'and he said <term>Yotzer HaMe\'orot</term> [see *Y.N.H.*], and he said it',
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
    expect(isBracketDefinition('Which is to say the whole of what was said before this')).toBe(false);
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
