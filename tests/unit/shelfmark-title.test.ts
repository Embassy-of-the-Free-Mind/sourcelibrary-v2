import { describe, it, expect } from 'vitest';
import { workFirstTitle, decodeEntities } from '../../scripts/lib/shelfmark-title.mjs';

// #7270: 1,056 live Heidelberg manuscripts were titled "Heidelberg, Universitätsbibliothek Heidelberg,
// Cod. Pal. germ. 311: …", so a card cut at ~60 characters showed the library and never the work.
describe('workFirstTitle', () => {
  it('puts the work first and the shelfmark in parentheses, tidying " ; " to "; "', () => {
    expect(workFirstTitle(
      'Heidelberg, Universitätsbibliothek Heidelberg, Cod. Pal. germ. 311: Konrad von Megenberg: Buch der Natur ; Johannes Hartlieb: Kräuterbuch',
    )).toBe('Konrad von Megenberg: Buch der Natur; Johannes Hartlieb: Kräuterbuch (Cod. Pal. germ. 311)');
  });

  it('keeps a shelfmark that contains a comma whole', () => {
    expect(workFirstTitle('Heidelberg, Universitätsbibliothek Heidelberg, Cod. Sal. XII,55 Nr. 3: Text zur Passion, dt.'))
      .toBe('Text zur Passion, dt. (Cod. Sal. XII,55 Nr. 3)');
  });

  it('does not split on a colon inside the shelfmark\'s brackets', () => {
    expect(workFirstTitle('Heidelberg, Universitätsbibliothek Heidelberg, Heid. Hs. 631 (alte Signatur: Batt 515): Lateinisches Exerzitienheft'))
      .toBe('Lateinisches Exerzitienheft (Heid. Hs. 631 (alte Signatur: Batt 515))');
  });

  it('drops a repeated shelfmark or a repeated work', () => {
    expect(workFirstTitle('Heidelberg, Universitätsbibliothek Heidelberg, Cod. Pal. germ. 624: Andachtsbuch (Psalmbetrachtungen) - Cod. Pal. germ. 624'))
      .toBe('Andachtsbuch (Psalmbetrachtungen) (Cod. Pal. germ. 624)');
    expect(workFirstTitle('Heidelberg, Universitätsbibliothek Heidelberg, Cod. Heid. Orient. 286: Sīrat ʿAntar: Sīrat ʿAntar'))
      .toBe('Sīrat ʿAntar (Cod. Heid. Orient. 286)');
  });

  it('keeps the shelfmark only when there is no work', () => {
    expect(workFirstTitle('Heidelberg, Universitätsbibliothek Heidelberg, Cod. Pal. germ. 5')).toBe('Cod. Pal. germ. 5');
    expect(workFirstTitle('Heidelberg, Universitätsbibliothek Heidelberg, Cod. Pal. germ. 5: ')).toBe('Cod. Pal. germ. 5');
  });

  it('decodes the XML entities a harvested title still carries', () => {
    expect(workFirstTitle('Heidelberg, Universitätsbibliothek Heidelberg, Cod. Pal. germ. 390: &apos;König Rother&apos;'))
      .toBe("'König Rother' (Cod. Pal. germ. 390)");
    expect(decodeEntities('A &amp; B &lt;C&gt; &#228;')).toBe('A & B <C> ä');
  });

  it('keeps a repository other than the host inside the parentheses', () => {
    expect(workFirstTitle('Oxford, Bodleian Library, MS. Laud Or. 12: Divan'))
      .toBe('Divan (Oxford, Bodleian Library, MS. Laud Or. 12)');
  });

  it('leaves a title that does not start with a listed repository alone', () => {
    const printed = 'Von Gottes Gnaden Wir Carl Philipp, Pfaltz-Graff bey Rhein: Unseren gnädigsten Gruß zuvor';
    expect(workFirstTitle(printed)).toBe(printed);
    expect(workFirstTitle('Heidelberg, Universitätsbibliothek Heidelberg: Nachlass Max von Waldberg: Brief'))
      .toBe('Heidelberg, Universitätsbibliothek Heidelberg: Nachlass Max von Waldberg: Brief');
    expect(workFirstTitle('Buch der Natur')).toBe('Buch der Natur');
  });
});
