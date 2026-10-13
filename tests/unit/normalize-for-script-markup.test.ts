/**
 * OCR markup is not page text (#5522).
 *
 * Pins normalizeForScript v3 (v2 plus the centring-marker fix, #6388): image/figure descriptions, tag attributes and entities never reach the
 * scored words, while real page text inside <header>, <margin>, <note> and unknown inline tags is kept.
 * Measured under v1 on 72 EEBO-TCP references: `imagedesc`, `nbsp`, `typedecoratiue`, `uuoodcut` and
 * `langenglishlang` were among the engine's top "insertions".
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module without type declarations
import { normalizeForScript, digitsOf, digitChannel, scoreAgainstReference, NORMALIZE_FOR_SCRIPT_VERSION } from '../../scripts/eval/lib/metrics.mjs';

const n = (s: string) => normalizeForScript(s, 'latin');

describe('normalizeForScript markup (v4)', () => {
  it('is version 4', () => expect(NORMALIZE_FOR_SCRIPT_VERSION).toBe(4));

  // #6203: through v3 the Latin-script normaliser kept [a-z] only, so a table of numbers scored as nothing.
  it('keeps digits in Latin-script text', () => {
    expect(n('p. 239 n. 25; | 2.54,3 |')).toBe('p 239 n 25 2543');
    expect(n('Anno 1650, <page-num>12</page-num> fol. 3v')).toBe('anno 1650 12 fol 3u');
  });
  it('other scripts are unchanged: their own letters only', () => {
    expect(normalizeForScript('λόγος 12 καὶ', 'greek')).toBe('λογοσ και');
  });
  it('a reference keyed without numbers does not charge the page for printing them', () => {
    const passage = 'in principio creavit deus caelum et terram terra autem erat inanis et vacua et tenebrae erant super faciem abyssi';
    const page = passage.split(' ').map((w, i) => (i % 4 === 0 ? `${i + 1} ${w}` : w)).join(' ');
    const r = scoreAgainstReference(passage, page, 'latin');
    expect(r.digitsScored).toBe(false);
    expect(r.charAccuracyWindowed).toBe(1);
    const withNumbers = scoreAgainstReference(`${passage} anno 1592`, `${passage} anno 1502`, 'latin');
    expect(withNumbers.digitsScored).toBe(true);
    expect(withNumbers.charAccuracyWindowed).toBeLessThan(1);
  });
  it('digitsOf reads digits in order, markup and entities out', () => {
    expect(digitsOf('<image-desc>plate 9</image-desc> 1,650 &#160; and <margin>12</margin>')).toBe('165012');
  });
  it('digitChannel: errors over the reference digits; null when the reference has none', () => {
    expect(digitChannel('1836 and 25', '1886 and 25')).toMatchObject({ errors: 1, refDigits: 6, rate: 1 / 6 });
    expect(digitChannel('no numbers here', 'page 12').rate).toBeNull();
    expect(digitChannel('1 2 3', '').rate).toBe(1);
  });

  // #6388: `<- … ->` between two centred lines read as one tag, and every line in between was deleted.
  it('keeps the lines between two centred lines', () => {
    expect(n('->CAPUT PRIMUM<-\nDe natura rerum dicturi\nprimum de principiis\n->CAPUT SECUNDUM<-\nSequitur de motu')).toBe(
      'caput primum de natura rerum dicturi primum de principiis caput secundum sequitur de motu',
    );
  });

  it('a centred line beside a real tag loses only its markers', () => {
    expect(n('->Titulus<- <margin>nota</margin> textus ->Finis<-')).toBe('titulus nota textus finis');
    expect(n('<header>->Liber I<-</header> corpus')).toBe('liber i corpus');
  });

  it('negative control: text inside a real tag pair is still treated as before', () => {
    expect(n('ante <image-desc>->a centred caption<-</image-desc> post')).toBe('ante post');
  });

  it('drops image and figure descriptions with their attributes', () => {
    expect(n('Of trade <image-desc type="decorative" size="small">A woodcut of a ship</image-desc> and money')).toBe('of trade and money');
    expect(n('before <figure kind="woodcut">Arms of the king</figure> after')).toBe('before after');
  });

  it('strips unknown tags but keeps their text', () => {
    expect(n('the <lang code="el">logos</lang> of it')).toBe('the logos of it');
    expect(n('a<br/>b')).toBe('a b');
  });

  it('decodes entities: nbsp is layout, &amp; is the et-ligature', () => {
    expect(n('unus&nbsp;&nbsp;duo')).toBe('unus duo');
    expect(n('Pater &amp; filius')).toBe('pater et filius');
  });

  it('positive control: real page text in header, margin and note is still scored', () => {
    expect(n('<header>Of Treasure</header> body <margin>Note well</margin> <note>gloss</note>')).toBe('of treasure body note uuell gloss');
  });
});
