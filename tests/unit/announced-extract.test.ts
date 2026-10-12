import { describe, it, expect } from 'vitest';
import { embeddedExtract } from '@/lib/announced-extract';

// Shapes below are the transcriptions of Taylor's 1818 Nicomachean Ethics
// (6956953e8c9559f6c2db0b6d), scan pp.44–50, abridged — the pages of #3689.
// What matters in them is kept exactly: the body line of Aristotle at the head
// of each page, the footnote rule the OCR drops on some leaves and keeps on
// others, the quotation re-opened at each paragraph, and the one closing mark.

const P44 =
  'most honourable, are also most stable, because blessed men principally live in these. But if energies are the mistresses of life, no one who is blessed will become miserable ;<sup>2</sup> since he will never\n\n' +
  '---\n\n' +
  '<sup>2</sup> That a truly good man, under the pressure of certain very great misfortunes, is not blessed nor yet miserable, but in a condi-';

const P45 =
  'do any thing that is odious and base. For we are of opinion, that the man who is truly good and wise, will\n\n' +
  'tion between felicity and misery, is an assertion which is not dissonant from the doctrine of the best of the Platonists. The truth of this is most beautifully illustrated by Plotinus in his book On Felicity, from which the following is an extract.\n\n' +
  '> “ The wise man is never oppressed with evil, through ignorance of his own concerns. For the wise man is not as one rude and unskilful, but like a strenuous wrestler vigorously repels the strokes of fortune, knowing';

const P46 =
  'bear all fortunes in a becoming manner, and from existing circumstances will always perform the most beautiful\n\n' +
  'that to such a nature as his own they are not really grievous, but are terrible only as it were to boys. Hence, he contemplates even the slaughter and destruction of cities like the scenes in a theatre.\n\n' +
  '> " But what shall we say when the wise man is no longer himself, in consequence of being overwhelmed with disease ? But an energy of this kind is not concealed from the whole itself ; but rather';

const P47 =
  'deeds ; just as a good general will use the army under his command in the most warlike manner, and a shoe.\n\n' +
  '---\n\n' +
  'does not transmigrate into the external man by means of a sentient nature.\n\n' +
  '> “ Perhaps, indeed, such an energy is concealed from us because it does not reach any sentient power ; nor that he who acts vigorous';

const P48 =
  'maker from the leather with which he is supplied will\nnake the most beautiful shoe ; and the same thing will\n\n' +
  'f other operations : so that sensible animadversions appear to ren-\ner more debile the actions which they attend.\n“ Nor are the wise man’s energies entirely prevented by the changes\nf fortune. To which we may add, that though he lives a life\nuperior to sense, he will not be unfriendly to his friends';

const P49 =
  'take place with all other artists. If this, however, be the case, the happy man will never become miserable. And thus much concerning these things.\n\n' +
  '> from its exercise, having an employment independent of the lyre, he sings without its instrumental assistance. Yet this instrument was not bestowed on the musician from the first in vain, because it has often been used by him with advantage and delight.”';

const P50 =
  'CHAPTER XI.\n\nTHAT the good or bad fortune, however, of descendants, and of all friends, should contribute nothing [to the happy man,] appears to be a thing very unfriendly, and contrary to the opinions of mankind.';

const TAYLOR = [P44, P45, P46, P47, P48, P49, P50].map((text, i) => ({ page: 44 + i, text }));
const upTo = (page: number) => TAYLOR.filter((p) => p.page <= page);

describe('embeddedExtract — the Plotinus extract in Taylor\'s Ethics (#3689)', () => {
  it('says nothing on the page before the announcement', () => {
    expect(embeddedExtract(upTo(44))).toBeNull();
  });

  it('reports the announcing page with the book\'s own sentence, verbatim', () => {
    const v = embeddedExtract(upTo(45));
    expect(v?.relation).toBe('announced_here');
    expect(v?.announcement).toBe(
      'The truth of this is most beautifully illustrated by Plotinus in his book On Felicity, from which the following is an extract.',
    );
    expect(v?.announced_on_page).toBe(45);
    expect(v?.quotation_marked).toBe(true);
  });

  // The page in the report: it opens mid-sentence with nothing to say whose
  // sentence it is, and is roughly nine-tenths Plotinus.
  it.each([46, 47, 48])('flags p.%i as still inside the extract announced on p.45', (page) => {
    const v = embeddedExtract(upTo(page));
    expect(v?.relation).toBe('continues_from_earlier_page');
    expect(v?.announced_on_page).toBe(45);
    expect(v?.announcement).toContain('Plotinus');
    expect(v?.quotation_marks_on_this_page).toBe(true);
    expect(v?.ends_on_this_page).toBeUndefined();
  });

  it('sees the extract close on p.49 and leaves Chapter XI alone', () => {
    expect(embeddedExtract(upTo(49))?.ends_on_this_page).toBe(true);
    expect(embeddedExtract(upTo(50))).toBeNull();
  });

  it('makes no claim across an untranscribed leaf', () => {
    expect(embeddedExtract([TAYLOR[1], TAYLOR[3]])).toBeNull();
    expect(embeddedExtract([TAYLOR[1], { page: 46, text: null }, TAYLOR[3]])).toBeNull();
  });
});

describe('embeddedExtract — what must stay silent', () => {
  // The heuristic rejected on the issue: Aristotle discusses other philosophers
  // constantly, so "mentions Plotinus" is not "is an extract from Plotinus".
  it('is not triggered by naming or discussing another author', () => {
    const text = 'Plato, therefore, rightly doubted this. As Plotinus says in his book On Felicity, the wise man is never oppressed with evil. “ Know thyself,” says the oracle.';
    expect(embeddedExtract([{ page: 10, text }])).toBeNull();
  });

  it('is not triggered by an extract that is a preparation, or by "the following day"', () => {
    for (const text of [
      'Take of the following extract of gentian two drachms, and of the tincture one ounce.',
      'What all the tears of Heraclius had not been able to extract from him the day before, now on the following day occurred to him.',
      'The above extract shows how far the practice had spread.',
    ]) {
      expect(embeddedExtract([{ page: 10, text }]), text).toBeNull();
    }
  });

  // Pepys (Wheatley), measured: a one-line quotation whose closing mark the OCR
  // dropped flagged the eight leaves after it before the same-page rule.
  it('does not carry a short inline quotation past the paragraph where the author resumes', () => {
    const announcing =
      'In the Bodleian is the following extract from Thomas Rawlinson\'s Note Book R.: "Of Daniel Rawlinson, my grandfather, who kept the Mitre tavern\n\n' +
      'Pepys was a constant visitor at the Mitre, and mentions the house repeatedly in the Diary.';
    const next = 'The house was destroyed in the Great Fire, and rebuilt by Rawlinson at his own charge.';
    expect(embeddedExtract([{ page: 266, text: announcing }])?.relation).toBe('announced_here');
    expect(embeddedExtract([{ page: 266, text: announcing }, { page: 267, text: next }])).toBeNull();
  });
});

describe('embeddedExtract — other shapes measured in the corpus', () => {
  it('follows a quotation that opens on the announcing line and closes there', () => {
    const text = 'Farther on (page 28) Bertelli gives the following extract from Thévenot : “ L’on voit encore que la pluspart des choses que l\'on attribue à Gilbert.”';
    const v = embeddedExtract([{ page: 224, text }]);
    expect(v?.quotation_marked).toBe(true);
    expect(v?.ends_on_this_page).toBe(true);
    expect(embeddedExtract([{ page: 224, text }, { page: 225, text: 'Gilbert, however, had already shown the contrary.' }])).toBeNull();
  });

  it('does not stop the sentence at "Dr." or "Vol."', () => {
    const text = 'The following extract from the learned treatise of Dr. Jamieson called Hermes Scythicus, Vol. II. will show this. He observes that the names are the same.';
    expect(embeddedExtract([{ page: 278, text }])?.announcement).toBe(
      'The following extract from the learned treatise of Dr. Jamieson called Hermes Scythicus, Vol. II. will show this.',
    );
  });

  // An announcement set as ordinary prose: flagged where it is printed, but
  // with no marks to follow, nothing is claimed about the pages after it.
  it('flags an unmarked announcement on its own page only', () => {
    const text = 'The following is an extract from the first volume of the Asiatic Researches. I dare not undertake to say that Carnac is derived from it.';
    const v = embeddedExtract([{ page: 208, text }]);
    expect(v?.relation).toBe('announced_here');
    expect(v?.quotation_marked).toBe(false);
    expect(embeddedExtract([{ page: 208, text }, { page: 209, text: 'more prose, “ with a quotation ” in it.' }])).toBeNull();
  });

  it('ends a block quote with no marks where the indentation ends', () => {
    const announcing = 'A few additional particulars will be found in the following extract from the Vishnu Purāna:—\n\n> Hari having been entreated to help, assumed the form of a boar.\n\nSuch is the account given of this incarnation.';
    expect(embeddedExtract([{ page: 139, text: announcing }, { page: 140, text: '> a stray block quote' }])).toBeNull();
  });
});
