/**
 * Name-form equivalence (#3894).
 *
 * These are BEHAVIOUR tests: every case calls `sameNameForm` and asserts the
 * verdict. They exist because the first production run of
 * `scripts/audit/author-vs-ai-metadata.mjs` compared names by exact token
 * overlap and put 92 same-person pairs into a human review queue — a quarter of
 * it — on the strength of nothing but Latin declension and vernacular spelling.
 *
 * The invariant worth protecting is the BALANCE. Every rule here is a
 * generalisation, and each one is unsafe if its length floor is removed:
 *
 *   prefix rule (≥5)    Dioscorid ⊂ Dioscorides. Without a floor, "Ott" prefixes
 *                       both Otto and Ottaviano, who are not the same man.
 *   one-edit rule (≥7)  Aristotel/Aristotl and Dioscorid/Dioscurid differ by one
 *                       character in the MIDDLE, which no prefix or suffix rule
 *                       reaches. Without a floor, Otto/Otho collapse.
 *
 * So the "different people" block is the load-bearing half: loosening any rule
 * to fix a MISS above will start collapsing the pairs below, and a false merge
 * here is worse than a false split — it deletes a real attribution error from
 * the queue silently, where a false split only costs a human ten seconds.
 */
import { describe, it, expect } from 'vitest';
import { sameNameForm, withinOneEdit, nameStems } from '../../scripts/lib/name-equivalence.mjs';

describe('sameNameForm — one person, many name-forms', () => {
  const SAME: Array<[string, string, string]> = [
    ['Cicéron', 'Cicero', 'vernacular French vs Latin'],
    ['Aristoteles', 'Aristotle', 'one edit, mid-word'],
    ['Boehme, Jacob', 'Jakob Böhme', 'oe/ö and c/k, inverted order'],
    ['Claude de Saumaise', 'Claudius Salmasius', 'vernacular vs Latinised surname'],
    ['Dioscorides', 'Pedanius Dioscurides Anazarbeus', 'o/u plus added praenomen'],
    ['Ovid', 'Publius Ovidius Naso', 'short form vs tria nomina'],
    ['Bodin, Jean', 'Gio. Bodino', 'the case that started this — Italian title page'],
    ['Marlorat, Augustin', 'Augustinus Marloratus', 'both names Latinised'],
    ['Tranaeus, Johan Gottschalk', 'Johannes Gotzchalchus Tranæus', 'ae ligature'],
  ];
  for (const [a, b, why] of SAME) {
    it(`${a} ≡ ${b} (${why})`, () => {
      expect(sameNameForm(a, b)).toBe(true);
      expect(sameNameForm(b, a)).toBe(true);   // symmetric
    });
  }
});

describe('sameNameForm — genuinely different people must NOT collapse', () => {
  const DIFFERENT: Array<[string, string, string]> = [
    ['Manuzio, Aldo', 'Jean Bodin', 'printer vs author — the defect this audit hunts'],
    ['Manuzio, Paolo', 'Pliny the Elder', 'printer vs author'],
    ['Manuzio, Aldo', 'Annibal Caro', 'printer vs author'],
    ['al-Battani (Albategnius)', 'Benedictus de Spinoza', 'contaminated enrichment batch'],
    ['Ficinus, Marsilius', 'Iamblichus', 'translator vs author'],
    ['Livy', 'Marcus Tullius Cicero', 'two Romans, no shared stem'],
    ['Cotta, Giovanni', 'Actius Sincerus Sannazarius', 'unrelated Italians'],
    ['Besold, Christoph', 'Johann Valentin Andreae', 'unrelated Germans'],
    ['Otto', 'Otho', 'one edit but SHORT — must stay split'],
    ['Bembo', 'Bombo', 'one edit but short'],
  ];
  for (const [a, b, why] of DIFFERENT) {
    it(`${a} ≢ ${b} (${why})`, () => {
      expect(sameNameForm(a, b)).toBe(false);
      expect(sameNameForm(b, a)).toBe(false);
    });
  }
});

describe('sameNameForm — non-Latin scripts are NOT judged', () => {
  // foldOrtho strips these to nothing, so the function returns false. Callers
  // must treat that as "cannot judge", never as "different people" — reading it
  // the other way is what put 39 CJK and Cyrillic names in the review queue.
  it('returns false for two CJK names rather than guessing', () => {
    expect(sameNameForm('王圻, 王思義', '王圻')).toBe(false);
  });
  it('returns false across scripts rather than guessing', () => {
    expect(sameNameForm('Михаил Салтыков-Щедрин', 'Mikhail Saltykov-Shchedrin')).toBe(false);
  });
  it('yields no stems at all for a non-Latin string — the tell for callers', () => {
    expect(nameStems('王圻, 王思義').size).toBe(0);
  });
});

describe('long-s OCR repair', () => {
  // The early-modern long s (ſ) is routinely transcribed "f". `author-reconcile`
  // has handled this since May; this module shipped without it, so an OCR'd name
  // silently failed to match its clean spelling.
  it('matches a long-s transcription against the clean form', () => {
    expect(sameNameForm('Iofephus Scaliger', 'Iosephus Scaliger')).toBe(true);
  });
  it('matches a long-s toponym', () => {
    expect(sameNameForm('Brandeburgenfis', 'Brandeburgensis')).toBe(true);
  });
  it('does not let the repair merge unrelated names', () => {
    expect(sameNameForm('Fabricius', 'Sabricius')).toBe(true);   // one edit, ≥7 — same person in practice
    expect(sameNameForm('Frischlin', 'Bobali')).toBe(false);
  });
});

describe('withinOneEdit', () => {
  it('accepts a substitution', () => expect(withinOneEdit('aristotel', 'aristotal')).toBe(true));
  it('accepts an insertion', () => expect(withinOneEdit('dioscorid', 'dioscorids')).toBe(true));
  it('accepts a deletion', () => expect(withinOneEdit('dioscorids', 'dioscorid')).toBe(true));
  it('accepts equality', () => expect(withinOneEdit('cicero', 'cicero')).toBe(true));
  it('rejects two edits', () => expect(withinOneEdit('aristotel', 'aristotaal')).toBe(false));
  it('rejects a length gap over one', () => expect(withinOneEdit('cicero', 'ciceronis')).toBe(false));
});

describe('particles cannot carry a match on their own', () => {
  // Every early-modern name is full of de/von/della. If those counted, half the
  // corpus would be one person.
  it('two unrelated names sharing only "de" stay split', () => {
    expect(sameNameForm('Jean de Meung', 'Pierre de Ronsard')).toBe(false);
  });
});
