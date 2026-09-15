import { describe, it, expect, afterEach } from 'vitest';
import {
  loopVerdict,
  periodicRuns,
  coveredChars,
} from '../../scripts/lib/ocr-loop-guard.mjs';
import { loopVerdict as loopVerdictTs } from '../../src/lib/ocr-loop-guard';

/**
 * This guard sits on the OCR write path and it REFUSES pages, so the cases that
 * matter are the ones it must let through. We hold genuinely repetitive text —
 * litanies, mantra and dhāraṇī folios, refrains, index leader dots, tabular
 * layout padded with `&nbsp;` — and a gate tuned only on the degeneration would
 * withhold exactly the material the library exists to serve.
 *
 * Every "must pass" case below was a real false positive during calibration
 * against the corpus mirror, except where marked.
 */

/** A page that stopped transcribing and repeated one unit — the #4850 exhibit shape. */
const LONTAR_LOOP =
  '<scan-quality>good</scan-quality>\n<language>Balinese</language>\n<script>handwritten</script>\n' +
  '<page-type>text</page-type>\n<warning>Handwritten Balinese script on palm-leaf.</warning>\n\n' +
  'ᬧᬸᬦᬧᬦᭂᬫ᭄ᬧᬸᬳᬶᬗ᭄ᬓᬸᬯᬮᬦ᭄ᬢ᭄ᬭ '.repeat(60) +
  '\n<vocab>Lontar, Balinese script</vocab>';

/** A Tibetan page that ran to the output cap on a five-character unit. */
const TIBETAN_LOOP =
  '༄༅། །དེ་ནས་ཡང་དག་པར་རྫོགས་པའི་སངས་རྒྱས་ཐམས་ཅད་ཀྱི་ཡེ་ཤེས་ཀྱི་སྐུ་གཅིག་པུ་སྟེ། ' +
  '་ཧཱུྃ'.repeat(900);

describe('loopVerdict — refuses degeneration', () => {
  it('refuses a lontar page that repeats one unit for most of the body', () => {
    const v = loopVerdict(LONTAR_LOOP);
    expect(v.refuse).toBe(true);
    expect(v.reason).toBe('repetition_loop');
    expect(v.share).toBeGreaterThan(0.5);
  });

  it('refuses a Tibetan page looping on a syllable to the output cap', () => {
    const v = loopVerdict(TIBETAN_LOOP);
    expect(v.refuse).toBe(true);
    expect(v.reps).toBeGreaterThan(100);
  });

  it('counts every run, not just the longest — a two-column page loops per column', () => {
    // Neither unit covers half the page on its own; together they cover all of it.
    const twoColumns = 'ꦱꦩꦶꦔꦸꦁꦱꦶ'.repeat(40) + ' --- ' + 'ᬫᬗ᭄ᬤᬾᬢᬶᬢᬶᬬᬗ᭄'.repeat(40);
    const v = loopVerdict(twoColumns);
    expect(v.refuse).toBe(true);
    expect(v.runs).toBeGreaterThan(1);
  });
});

describe('loopVerdict — must NOT refuse', () => {
  it('passes a litany, where each repetition carries a different name', () => {
    const names = ['Sancta Maria', 'Sancta Dei Genitrix', 'Sancta Virgo virginum', 'Mater Christi',
      'Mater divinae gratiae', 'Mater purissima', 'Mater castissima', 'Mater inviolata',
      'Mater intemerata', 'Mater amabilis', 'Mater admirabilis', 'Mater boni consilii',
      'Virgo prudentissima', 'Virgo veneranda', 'Virgo praedicanda', 'Virgo potens',
      'Virgo clemens', 'Virgo fidelis', 'Speculum iustitiae', 'Sedes sapientiae'];
    const text = names.map(n => `${n}, ora pro nobis.`).join(' ');
    expect(loopVerdict(text).refuse).toBe(false);
  });

  it('passes an index page whose entries are joined to page numbers by leader dots', () => {
    const entries = ['Zarodnie kuliste, barwy skórzanéj', 'Badhamia verna', 'Physarum vernum',
      'Fuligo septica', 'Lycogala epidendrum', 'Arcyria denudata', 'Trichia varia',
      'Stemonitis fusca', 'Cribraria argillacea', 'Diderma floriforme'];
    const text = entries.map((e, i) => `${e} ${'. '.repeat(40)}${100 + i}`).join('\n');
    expect(loopVerdict(text).refuse).toBe(false);
  });

  it('passes a table laid out with &nbsp; padding', () => {
    const row = (a: string, b: string) => `*${a}*${'&nbsp;'.repeat(12)}${b}`;
    const text = '# Divisio animae quoad sua accidentia\n' +
      [['Vegetatiua', 'nutritiua'], ['Sensitiua', 'appetitiua'], ['Rationalis', 'intellectiua'],
       ['Motiua', 'progressiua'], ['Memoratiua', 'reminiscitiua'], ['Estimatiua', 'cogitatiua']]
        .map(([a, b]) => row(a, b)).join('\n');
    expect(loopVerdict(text).refuse).toBe(false);
  });

  it('passes a page the model marked as illegible line by line', () => {
    const text = '[illegible — 2 lines] ' + '[illegible — 1 line] '.repeat(14);
    expect(loopVerdict(text).refuse).toBe(false);
  });

  it('passes a short page: a repeated colophon formula is not a runaway', () => {
    const text = 'ᬫᬗ᭄ᬤᬾᬢᬶᬢᬶᬬᬗ᭄'.repeat(12);
    const v = loopVerdict(text);
    expect(v.refuse).toBe(false);
    expect(v.reason).toBe('body_too_short');
  });

  it('passes a page whose repetition leaves half the page still readable', () => {
    const prose = 'Quod autem in hoc negotio de quo agimus non solum iuris sed etiam facti ' +
      'difficultas occurrat nemo est qui ambigat nam etsi iuris ratio in promptu sit tamen ' +
      'facti veritas quae ex circumstantiis pendet saepissime in dubium vocatur ut et in ' +
      'praesenti casu apparet ubi de testamenti validitate quaeritur inter partes litigantes. ';
    const v = loopVerdict(prose + 'yan hana wong amangan, '.repeat(14));
    expect(v.refuse).toBe(false);
    expect(v.share).toBeLessThan(0.5);
  });

  it('passes ordinary prose in a spaceless script (no word tokens to count)', () => {
    const text = '子曰學而時習之不亦說乎有朋自遠方來不亦樂乎人不知而不慍不亦君子乎' +
      '其為人也孝弟而好犯上者鮮矣不好犯上而好作亂者未之有也君子務本本立而道生' +
      '孝弟也者其為仁之本與子曰巧言令色鮮矣仁曾子曰吾日三省吾身為人謀而不忠乎' +
      '與朋友交而不信乎傳不習乎子曰道千乘之國敬事而信節用而愛人使民以時';
    expect(loopVerdict(text).refuse).toBe(false);
  });

  it('never refuses the page metadata alone — a description is not a transcription', () => {
    const text = '<language>None</language> <page-type>blank</page-type> ' +
      '<image-desc>The leaf is blank apart from foxing.</image-desc>';
    expect(loopVerdict(text).refuse).toBe(false);
  });
});

describe('loopVerdict — controls', () => {
  afterEach(() => { delete process.env.OCR_LOOP_GUARD; });

  it('OCR_LOOP_GUARD=off lets everything through', () => {
    process.env.OCR_LOOP_GUARD = 'off';
    const v = loopVerdict(LONTAR_LOOP);
    expect(v.refuse).toBe(false);
    expect(v.reason).toBe('guard_disabled');
  });

  it('the TS twin agrees with the .mjs twin on every case above', () => {
    for (const text of [LONTAR_LOOP, TIBETAN_LOOP, 'plain prose that repeats nothing at all.']) {
      const a = loopVerdict(text);
      const b = loopVerdictTs(text);
      expect({ refuse: b.refuse, reason: b.reason, share: b.share })
        .toEqual({ refuse: a.refuse, reason: a.reason, share: a.share });
    }
  });
});

describe('periodicRuns', () => {
  it('finds the run and reports the repeating unit', () => {
    const runs = periodicRuns([...('abcde'.repeat(40))]);
    expect(runs[0].period).toBe(5);
    expect(runs[0].unit).toBe('abcde');
    expect(coveredChars(runs)).toBe(200);
  });

  it('ignores a unit made only of punctuation — that is typography', () => {
    expect(periodicRuns([...('. '.repeat(100))])).toHaveLength(0);
  });
});
