/**
 * Title-page attribution extraction (#3894 item 5).
 *
 * BEHAVIOUR tests against real title transcriptions from the corpus — every
 * string below is a `books.title` value, not an invention.
 *
 * The invariant worth protecting is the AUTHOR/EDITOR distinction. A Latin
 * title page names its corrector as prominently as its author, in a different
 * grammatical case:
 *
 *   Auli Gellii Noctium Atticarum libri              genitive  -> Gellius WROTE it
 *   P. Terentius Afer a M. Antonio Mureto emendatus  ablative  -> Muretus FIXED it
 *
 * Collapsing those two — treating any capitalised name on the page as the
 * author — replaces one wrong attribution with a different wrong attribution,
 * which is worse than leaving the printer in place, because it looks correct.
 *
 * The "must not extract" block is the load-bearing half. Every entry in it was
 * a real false positive on a production run: Latin work-nouns that decline like
 * names ("Concordantiae Testamenti"), nobility possessives ("duca di Nemurs"),
 * councils ("Concilio di Trento") and books of the Bible ("Esdra"). Loosening a
 * rule to catch a miss will start re-admitting these.
 */
import { describe, it, expect } from 'vitest';
import { namesOnTitlePage, cleanName } from '../../scripts/lib/title-page-attribution.mjs';

const authorsOf = (t: string) => namesOnTitlePage(t).filter((n) => n.role === 'author').map((n) => n.name);
const editorsOf = (t: string) => namesOnTitlePage(t).filter((n) => n.role === 'editor').map((n) => n.name);

describe('author position — the name is proposed', () => {
  it('Italian "del" + honorific', () => {
    expect(authorsOf('Rime del commendatore Annibal Caro. Col priuilegio di n.s. PP. Pio 5.'))
      .toContain('Annibal Caro');
  });
  it('Italian "di" + honorific', () => {
    expect(authorsOf('Rime del sig. Torquato Tasso. Parte prima.')).toContain('Torquato Tasso');
  });
  it('Italian "di" with no honorific', () => {
    expect(authorsOf('Discorso di Rinaldo Odoni, per uia peripatetica, oue si dimostra, se l\'anima é mortale'))
      .toContain('Rinaldo Odoni');
  });
  it('keeps a particle INSIDE a surname', () => {
    // Cutting on "De" here truncated this to "Sauino" on the first run.
    expect(authorsOf('Rime amorose, e pastorali, et satire, del Mag. Sauino De Bobali Sordo, gentil\'huomo Raguseo.'))
      .toContain('Sauino De Bobali Sordo');
  });
  it('Latin genitive head', () => {
    expect(authorsOf('Auli Gellii Noctium Atticarum libri vndeuiginti')).toContain('Auli Gellii');
  });
  it('Latin genitive head with praenomen initial', () => {
    expect(authorsOf('Matthaei Curtii Papiensis De prandii ac caenae modo libellus.').length).toBeGreaterThan(0);
  });
});

describe('editor position — detected but never proposed as author', () => {
  it('ablative + emendatus is an editor, not an author', () => {
    const t = 'P. Terentius Afer a. M. Antonio Mureto emendatus eiusdem Mureti argumenta et scholia.';
    expect(editorsOf(t).length).toBeGreaterThan(0);
    expect(authorsOf(t)).not.toContain('M. Antonio Mureto');
  });
  it('Italian "tradotto ... per" is a translator', () => {
    const t = 'La vicissitudine delle cose, di Luigi Regio Francese: tradotta dal sig. caualier Hercole Cato.';
    expect(authorsOf(t)).toContain('Luigi Regio Francese');
    expect(authorsOf(t)).not.toContain('Hercole Cato');
  });
});

describe('must NOT extract — every one a real false positive', () => {
  const NONE: Array<[string, string]> = [
    ['Concordantiae Testamenti novi, graecolatinae. Nunc primum plenae editae', 'Latin work-noun'],
    ['Commentarii Linguae Graecae', 'Latin work-noun'],
    ['Comicorum Graecorum Sententiae', 'Latin work-noun'],
    ['Iuris Orientalis Libri III', 'Latin work-noun'],
    ['Varii Historiae Romanae Scriptores', 'Latin work-noun'],
    ['Institutionum Grammaticarum Libri Quatuor', 'Latin work-noun'],
    ['Catechismo, cioe istruttione secondo il decreto del Concilio di Trento, a\' parochi', 'a council is not a person'],
  ];
  for (const [title, why] of NONE) {
    it(`${title.slice(0, 46)}… (${why})`, () => {
      expect(authorsOf(title)).toEqual([]);
    });
  }

  it('a nobility possessive is a place, not an author', () => {
    // "duca di Nemurs" and "duca di Boglion" were both captured as authors.
    const t = 'Agnella comedia nuoua, del S. Carlo Turco asolano: recitata in Asola nella venuta '
      + 'de gli ill.mi sig.ri il duca di Nemurs, il duca di Boglion, e altri illustri.';
    const found = authorsOf(t);
    expect(found).not.toContain('Nemurs');
    expect(found).not.toContain('Boglion');
    expect(found.some((n) => n.startsWith('Carlo Turco'))).toBe(true);
  });

  it('a book of the Bible is not an author', () => {
    const t = 'La Biblia quale contiene i sacri libri del Vecchio Testamento, tradotti da la '
      + 'hebraica uerita in lingua toscana. Esdra.';
    expect(authorsOf(t)).not.toContain('Esdra');
  });

  it('a bare title with no name yields nothing', () => {
    expect(namesOnTitlePage('Psalterium Graecum')).toEqual([]);
  });

  it('a too-short string yields nothing rather than guessing', () => {
    expect(namesOnTitlePage('Opera')).toEqual([]);
    expect(namesOnTitlePage('')).toEqual([]);
  });
});

describe('cleanName', () => {
  it('rejects bare initials', () => expect(cleanName('M. T.')).toBeNull());
  it('rejects a place', () => expect(cleanName('Venetia')).toBeNull());
  it('rejects an over-long run', () => expect(cleanName('A'.repeat(80))).toBeNull());
  it('trims a trailing particle', () => expect(cleanName('Annibal Caro di')).toBe('Annibal Caro'));
  it('strips a leading honorific', () => expect(cleanName('sig. Torquato Tasso')).toBe('Torquato Tasso'));
});
