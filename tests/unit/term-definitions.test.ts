import { describe, it, expect } from 'vitest';
import { separateTermDefinitions, splitTermDefinition, readsAsGloss } from '@/lib/term-definitions';
import { applyNotesOff } from '@/lib/notes-off';
import { prepareNotesMarkdown } from '@/components/reader/NotesRenderer';
import { markdownToHtml } from '@/lib/export-markdown-html';

/**
 * The model's definitions are commentary, not page text (#5895).
 *
 * Excerpts are from stored translations:
 *  - GEOMANCY: book 6975158aa88d83c830d99e22 p.83
 *    (https://sourcelibrary.org/book/6975158aa88d83c830d99e22?page=83)
 *  - SILVER: book 69c86fb56c6f3cc53c85713b p.15
 *    (https://sourcelibrary.org/book/69c86fb56c6f3cc53c85713b?page=15)
 */
const GEOMANCY =
  '**Geomancy** <term>Geomancy: A method of divination that interprets markings on the ground or the patterns formed by tossed handfuls of soil, rocks, or sand.</term>, an art performed through points without a natural basis;';
const HYDROMANCY =
  '**Hydromancy** <term>Hydromancy: Divination using water, such as observing ripples, colors, or reflections.</term> is an art performed through water;';
const SILVER =
  "where <term>Sulphur</term> boils mixed with perennial <term>Silver</term> <gloss>mercury or 'quicksilver'</gloss>, fleeing";

describe('separateTermDefinitions', () => {
  it('turns a definition inside <term> into a note, dropping a head that already precedes it', () => {
    expect(separateTermDefinitions(GEOMANCY)).toBe(
      '**Geomancy** <note>A method of divination that interprets markings on the ground or the patterns formed by tossed handfuls of soil, rocks, or sand.</note>, an art performed through points without a natural basis;'
    );
  });

  it('keeps the term chip when the head is not already in the sentence', () => {
    expect(separateTermDefinitions('the <term>Luna: the alchemical name for silver</term> is fixed')).toBe(
      'the <term>Luna</term> <note>the alchemical name for silver</note> is fixed'
    );
  });

  it('leaves a long term with no colon unchanged (a mantra is the text itself)', () => {
    // Constructed: a dhāraṇī as the Tibetan runs wrap it — long, no "head: definition".
    const mantra = 'he recited <term>oṃ namo bhagavate bhaiṣajyaguru vaiḍūryaprabharājāya tathāgatāya arhate samyaksaṃbuddhāya</term> three times';
    expect(separateTermDefinitions(mantra)).toBe(mantra);
  });

  it('leaves short colon titles and references alone', () => {
    for (const t of ['<term>De Vita: Liber Primus</term>', '<term>Genesis 1:3</term>', '<term>Psalm: 23</term>']) {
      expect(separateTermDefinitions(t)).toBe(t);
    }
    expect(splitTermDefinition('Luna: the alchemical name for silver')).toEqual({
      head: 'Luna',
      definition: 'the alchemical name for silver',
    });
  });

  it('splits a definition that opens in italics (random-draw miss, 2026-10-06)', () => {
    expect(separateTermDefinitions('<term>slightest negligence: *culpa levissima*, the highest legal standard of care</term>')).toBe(
      '<term>slightest negligence</term> <note>*culpa levissima*, the highest legal standard of care</note>'
    );
  });

  it('turns an "original: …" chip into a note with no term chip', () => {
    const t = 'the <term>original: 足陽明經 (zú yáng míng jīng); a major energy channel running from the face to the feet</term> runs';
    expect(separateTermDefinitions(t)).toBe(
      'the <note>original: 足陽明經 (zú yáng míng jīng); a major energy channel running from the face to the feet</note> runs'
    );
  });

  it("relabels a gloss right after a term as the model's note", () => {
    expect(separateTermDefinitions(SILVER)).toBe(
      "where <term>Sulphur</term> boils mixed with perennial <term>Silver</term> <note>mercury or 'quicksilver'</note>, fleeing"
    );
  });

  it('leaves a gloss that does not follow a term as a page mark', () => {
    const t = 'the text <gloss>id est aurum</gloss> continues';
    expect(separateTermDefinitions(t)).toBe(t);
  });

  it('is idempotent', () => {
    for (const t of [GEOMANCY, HYDROMANCY, SILVER]) {
      const once = separateTermDefinitions(t);
      expect(separateTermDefinitions(once)).toBe(once);
    }
  });
});

describe('notes off hides the model definitions (#5895)', () => {
  it('reads the Geomancy sentence without the definition or a doubled head', () => {
    expect(applyNotesOff(GEOMANCY)).toBe('**Geomancy**, an art performed through points without a natural basis;');
    expect(applyNotesOff(HYDROMANCY)).toBe('**Hydromancy** is an art performed through water;');
  });

  it('keeps the term and drops the gloss-definition', () => {
    expect(applyNotesOff(SILVER)).toBe('where Sulphur boils mixed with perennial Silver, fleeing');
  });

  it('reader pipeline: notes on shows the definition as an editorial note, notes off hides it', () => {
    const on = prepareNotesMarkdown(GEOMANCY, { showNotes: true }).processedText;
    expect(on).toContain('<note>A method of divination');
    expect(on).not.toMatch(/<term>Geomancy:/);
    const off = prepareNotesMarkdown(GEOMANCY, { showNotes: false }).processedText;
    expect(off).not.toContain('A method of divination');
    expect(off).not.toMatch(/Geomancy\**\s+Geomancy/);
  });

  it('EPUB/HTML export follows the same rule', () => {
    expect(markdownToHtml(GEOMANCY, { stripNotes: true })).not.toContain('A method of divination');
    expect(markdownToHtml(SILVER, { stripNotes: false })).not.toMatch(/gloss/i);
  });
});

describe('a head the sentence already carries is not printed twice (#5901)', () => {
  // Excerpts: 6902ed49583dd7d2641408a5 p444 (God’s field), 59e68f94-49d0-4ed7-a610-b1f53e55b2f8 p652
  // (drachms), 6952727dab34727b1f0485f2 p44 (formal number), 695234baab34727b1f044b50 p34 (Cassia).
  it.each([
    ['he stands in God’s field <term>God\'s field: a metaphor for the world or the community of believers</term> and bears',
      'he stands in God’s field <note>a metaphor for the world or the community of believers</note> and bears'],
    ['[take] 4 drachms <term>drachm: a unit of weight, approximately 3.9 grams</term> weight',
      '[take] 4 drachms <note>a unit of weight, approximately 3.9 grams</note> weight'],
    ['so that your "formal number" <term>Formal number: A number that acts as a shaping principle.</term> may agree',
      'so that your "formal number" <note>A number that acts as a shaping principle.</note> may agree'],
    ['as harmless as Cassia or Manna <term>Cassia and Manna: Natural substances used as mild laxatives.</term>. The',
      'as harmless as Cassia or Manna <note>Natural substances used as mild laxatives.</note>. The'],
    ['the **melancholic humor** <term>humor: one of the four bodily fluids</term> is',
      'the **melancholic humor** <note>one of the four bodily fluids</note> is'],
  ])('%s', (before, after) => {
    expect(separateTermDefinitions(before)).toBe(after);
  });

  it('keeps the chip when the head is a different word (the source-language term)', () => {
    expect(separateTermDefinitions('the tempering agent of **black bile** <term>atra bilis: another name for the melancholic humor</term>, the fuel'))
      .toBe('the tempering agent of **black bile** <term>atra bilis</term> <note>another name for the melancholic humor</note>, the fuel');
    expect(separateTermDefinitions('the state <term>statue: a carved figure of stone</term> stood'))
      .toBe('the state <term>statue</term> <note>a carved figure of stone</note> stood');
    expect(separateTermDefinitions('<term>Luna: the alchemical name for silver</term>')).toBe('<term>Luna</term> <note>the alchemical name for silver</note>');
  });
});

/**
 * #5901: chips that carry a colon and are still the BOOK's words. Found on the corpus scan
 * (212K pages) before any stored text was rewritten; each excerpt is a stored page.
 * Splitting one would move page text into a note, and notes-off would then hide it.
 */
describe('a colon inside a chip is not always a definition (#5901)', () => {
  it.each([
    // 69f339bc876dd827cbc5625e p42, 69f339a3876dd827cbc55802 p797 — legal citations
    'and Bartolus in law 1, "It pleases," <term>Code: Concerning the most holy churches</term>, and by Balbus',
    'and the following laws <term>law: Eum ad quem</term>, <term>Code: De usufructu</term>',
    // 69e7aad05f1a22ab19a8dce9 p228 — a mantra (Tibetan)
    'these are the words of the secret mantra: <term>Tadyatha: Hume hume, humela, humila, batiye swaha.</term> Venerable One',
    // 69e787024a6785cfd60c9bec p227 — a mantra whose label stands just before it
    'join the <term>upati go dhara ya karma guhya manthra</term>. <term>Karma guhya manthra: Om Lam Dhibhi dhara ya, Hum Lam Vajra Maring Jha, Stambhanan</term>. There is no doubt',
    // 69e788a74a6785cfd60d17bf p221, 6a14e14b311a9edd4621ea48 p112 — titles
    'The <term>Mother: Perfection of Wisdom in One Letter</term> is complete.',
    '<term>In the language of India: Yama Tsila Damta Kala Nama Tantra. In the language of Tibet: The Tantra called Black Yama Charka</term>. Homage',
    'in the <term>Book of Jin: Treatise on Astronomy</term>',
    // 69b51e6d9a81ef7feb3d4a83 p245 — a proportion
    'then <term>AB² + ab² = EG²</term>, and <term>EG² : AB² = AC + ac : AC</term>. But also',
    // 6a08549049638a50931c00fb p71 — the source's own phrases
    '*I will preserve my rank.* <term>tenebo statum meum: locum meum tuebor: dignitatis famam seruabo.</term>',
    // 69920bbfe0a548a13d885514 p105 — the colon is inside the bracket
    'of the kingdom of <term>God (original: ΘΥ — a *nomen sacrum* for *Theou*)</term>, and the twelve',
    'all away; so shall also the coming be," <term>Matthew 24: verses 38, 39</term>',
  ])('leaves %s', (t) => {
    expect(separateTermDefinitions(t)).toBe(t);
    expect(applyNotesOff(t)).toBe(t.replace(/<\/?term>/g, ''));
  });

  it("turns the model's language label into a note, however short (69a9578965ddd05bbcd3ecd0 p261, 69907cfe5f855ec553e78562 p300)", () => {
    expect(separateTermDefinitions('the service of the **Master of the Horse** <term>Latin: *magister equitum*; a high-ranking military commander</term>—are'))
      .toBe('the service of the **Master of the Horse** <note>Latin: *magister equitum*; a high-ranking military commander</note>—are');
    expect(separateTermDefinitions('**Saturn** <term>original: "Shani"</term>, **Mars** <term>original: "Bhauma"</term>, and'))
      .toBe('**Saturn** <note>original: "Shani"</note>, **Mars** <note>original: "Bhauma"</note>, and');
  });

  it('keeps the half of an "English (source)" head the sentence lacks (69906309e7b7642c081dddf5 p23, 6992ce273ea667fbac8284fd p11)', () => {
    expect(separateTermDefinitions('led to a perception of **utility** <term>utility (utilitas): the practical advantage or common benefit that serves as the basis for Epicurean justice</term>—namely'))
      .toBe('led to a perception of **utility** <term>utilitas</term> <note>the practical advantage or common benefit that serves as the basis for Epicurean justice</note>—namely');
    expect(separateTermDefinitions('Durations for the five mourning grades <term>Five Mourning Grades (Wufu): A system of ritual dress and mourning periods.</term> |'))
      .toBe('Durations for the five mourning grades <term>Wufu</term> <note>A system of ritual dress and mourning periods.</note> |');
  });

  it('still splits a definition whose head is new to the sentence, when the definition is English prose', () => {
    expect(separateTermDefinitions('free from all unlawful <term>concupiscence: concupiscentia; a strong or disordered desire, often used by Augustine</term>.'))
      .toBe('free from all unlawful <term>concupiscence</term> <note>concupiscentia; a strong or disordered desire, often used by Augustine</note>.');
    expect(readsAsGloss('syrinx', 'a panpipe made of multiple reeds joined together with wax')).toBe(true);
    expect(readsAsGloss('Gretter vid Þorbiorn Anugul', 'Er þat vel þo vid deilum kallt')).toBe(false);
  });
});

describe('the head in another form, or a few words back (#5901 gate, second sample)', () => {
  it('drops the chip when the sentence has the same English word in another form (6953ab7477f38f6761bd729d p717)', () => {
    expect(separateTermDefinitions('or mixed in order to be calcined <term>calcination: heating a substance to high temperatures to reduce it to a powder</term> or dissolved'))
      .toBe('or mixed in order to be calcined <note>heating a substance to high temperatures to reduce it to a powder</note> or dissolved');
  });
  it('drops the chip when the head stands a few words back (6985ca74e3007574295ea81b p279)', () => {
    expect(separateTermDefinitions('just as little as at the reception of brothers <term>Reception: The formal initiation ceremony for a new member into the Order</term>. To those'))
      .toBe('just as little as at the reception of brothers <note>The formal initiation ceremony for a new member into the Order</note>. To those');
  });
  it('keeps a chip the sentence leads into: its head is the book\'s own word (6991eaa82f801130a473d90a p42)', () => {
    expect(separateTermDefinitions('### VERUTUM. — The <term>verutum: a short javelin used by Roman light infantry</term>, according to what I'))
      .toBe('### VERUTUM. — The <term>verutum</term> <note>a short javelin used by Roman light infantry</note>, according to what I');
    expect(applyNotesOff('### VERUTUM. — The <term>verutum: a short javelin used by Roman light infantry</term>, according to what I'))
      .toBe('### VERUTUM. — The verutum, according to what I');
  });
  it('keeps a source-language cognate as the chip', () => {
    expect(separateTermDefinitions('an entirely metallic **substance** <term>substantia: the underlying material essence or physical reality of a thing.</term> which'))
      .toBe('an entirely metallic **substance** <term>substantia</term> <note>the underlying material essence or physical reality of a thing.</note> which');
  });
  it('does not read a note between the sentence and the chip as the sentence', () => {
    expect(separateTermDefinitions('**striated particles**. <note>original: "ibid."</note> <term>striated particles: These are grooved, screw-like particles of matter.</term> 91.'))
      .toBe('**striated particles**. <note>original: "ibid."</note> <note>These are grooved, screw-like particles of matter.</note> 91.');
  });
});

describe('#5901 gate, third sample', () => {
  it('leaves a chip whose colon belongs to a label after a semicolon (699439b66879ff0184cb8dac p443)', () => {
    const t = 'But the stars called **fixed** <term>aplaneis; original: "ἀπλανεῖς"; literally "unwandering"</term> move with three motions';
    expect(separateTermDefinitions(t)).toBe(t);
  });
});

describe('#5901 re-scan: one head with three different texts is a run of labels the page prints', () => {
  // 69dc55becb6f7429748b92f5 p13 — captions round a urine wheel
  const wheel = '-><term>Urine color: yellow like pure and intense gold</term><-\n\n-><term>Urine color: almost yellow like orpiment-like crocus</term><-\n\n-><term>Urine color: almost pale, such that a flame of fire does not remit it</term><-';
  it('leaves them, and notes-off still prints them', () => {
    expect(separateTermDefinitions(wheel)).toBe(wheel);
    expect(applyNotesOff(wheel)).toContain('almost pale, such that a flame of fire does not remit it');
  });
  it('still splits one definition a model repeats (695575b157e3b773024f206d p459), and a word that is also a label elsewhere', () => {
    const d = 'a <term>diapason: the interval of an octave</term>, the <term>diapason: the interval of an octave</term> and the <term>diapason: the interval of an octave</term>';
    expect(separateTermDefinitions(d)).toBe(d.replace(/<term>diapason: ([^<]+)<\/term>/g, '<term>diapason</term> <note>$1</note>'));
    expect(separateTermDefinitions('each planet in its terms <term>terms: specific sections of each zodiac sign ruled by a particular planet</term> is'))
      .toBe('each planet in its terms <note>specific sections of each zodiac sign ruled by a particular planet</note> is');
  });
  it('still splits a head defined once or twice', () => {
    const t = 'the <term>Luna: the alchemical name for silver</term> and again <term>Luna: the alchemical name for silver</term>';
    expect(separateTermDefinitions(t)).toBe('the <term>Luna</term> <note>the alchemical name for silver</note> and again <term>Luna</term> <note>the alchemical name for silver</note>');
  });
});
