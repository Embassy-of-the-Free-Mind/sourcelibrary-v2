/**
 * PARITY — src/lib/cover-scoring.ts (ensure-cover + book page render fallback)
 * vs scripts/lib/cover-scoring.mjs (pipeline Phase 3 / 8.9, batch scripts).
 *
 * Runs BOTH implementations over the same fixtures and fails on any
 * divergence, so "keep in lock-step" is enforced rather than hoped. This is a
 * behavioral guard, not a source-shape one: it executes both scorers.
 */
import { describe, it, expect } from 'vitest';
import {
  scorePageForCover as scoreTs,
  parsePageTypeFromOcr as parseTs,
  HAND_IN_FRAME_RE as handTs,
} from '@/lib/cover-scoring';
import {
  scorePageForCover as scoreMjs,
  parsePageTypeFromOcr as parseMjs,
  HAND_IN_FRAME_RE as handMjs,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/cover-scoring.mjs';

type Fixture = { name: string; page: Record<string, unknown>; title?: string; author?: string };

// Page text COPIED FROM THE DATABASE (2026-10-12), not written by hand — a
// fixture invented after the verdict is known acquires the properties it needs
// (the detector's first control did exactly that; see sammelband-cover.mjs).
// Book "Tertullian (Loeb)": p.5 is the series title, p.9 the work's own.
const TERTULLIAN_P5_SERIES = '<language>English</language>\n<page-type>title-page</page-type>\n<sig>A</sig>\n<meta>Handwritten numeral "4" in pencil at top left.</meta>\n<warning>Page shows some foxing and light staining.</warning>\n\n# LIBRARY OF FATHERS\n\n->OF THE<-\n\n## HOLY CATHOLIC CHURCH,\n\n->ANTERIOR TO THE DIVISION OF THE EAST AND WEST.<-\n\n->TRANSLATED BY MEMBERS OF THE ENGLISH CHURCH.<-\n\n<image-desc>A woodcut illustration depicting a seated figure with a halo, likely Saint John the Baptist or Christ, resting on a rocky mound. He holds a tall, slender cross-staff in his right hand, from which a banner curls bearing the Latin phrase "vox·clamantis·in·deserto".';
const TERTULLIAN_P9_OWN = '<language>English</language>\n<page-type>title-page</page-type>\n<meta>Pencil checkmark at top left</meta>\n->## TERTULLIAN.<-\n---\n->TRANSLATED BY THE<-\n->### REV. C. DODGSON, M.A.<-\n->PERPETUAL CURATE OF DARESBURY,<-\n->EXAMINING CHAPLAIN TO THE LORD BISHOP OF RIPON,<-\n->LATE STUDENT OF CHRIST CHURCH.<-\n---\n->### VOL. I.<-\n->### APOLOGETIC AND PRACTICAL TREATISES.<-\n---\n->OXFORD,<-\n->JOHN HENRY PARKER:<-\n->J. G. F. AND J. RIVINGTON, LONDON.<-\n->1842.<-\n<vocab>Tertullian, C. Dodgson, M.A., Daresbury, Lord Bishop of Ripon, Christ Church, Apologetic, Practical Treatises, John Henry Parker, J. G. F. Rivington, J. Rivington, London, Oxford</vocab>';
// The detector's own controls (scripts/audit/sammelband-cover.mjs).
const MANMOUSE_P7 = "THE MAN-MOUSE Taken in a Trap, and tortur'd to death for gnawing the Margins of EUGENIUS PHILALETHES. Printed in LONDON, and Sold at the Castle in Corn-hill. 1650.";
const IKHWAN_P7 = '<lang>English</lang>\n<page-type>title-page</page-type>\n\n# IKHWÁNU-S SAFÁ;\n\n->OR,<-\n\n# BROTHERS OF PURITY.\n\n->*TRANSLATED FROM THE HINDUSTÁNÍ,*<-\n\n->BY<-\n\n->PROFESSOR JOHN DOWSON, M.R.A.S.,<-';

const FIXTURES: Fixture[] = [
  {
    name: 'decorated title page with imprint and title match',
    title: 'Atalanta Fugiens Emblemata Nova',
    page: {
      page_number: 3,
      page_type: 'title-page',
      ocr: { data: '# ATALANTA FUGIENS\n## Emblemata Nova\nTypis Hieronymi Galleri, decorative woodcut border, atalanta fugiens emblemata' },
    },
  },
  {
    name: 'untyped page that looks like a title page (heading density)',
    page: { page_number: 2, ocr: { data: '# TITLE\n# AUTHOR\n# CITY\nprinted by John Day' } },
  },
  {
    name: 'blank page recognized from OCR content',
    page: { page_number: 1, ocr: { data: 'This page is blank, aged paper with no printed content.' } },
  },
  {
    name: 'scanner hand in frame',
    page: { page_number: 1, ocr: { data: 'A gloved hand is visible at the bottom edge, holding the volume open.' } },
  },
  {
    name: 'digitizer insert',
    page: { page_number: 1, ocr: { data: 'Digitized by the Internet Archive in 2010 with funding from Microsoft Corporation' } },
  },
  {
    name: 'ex-libris bookplate',
    page: { page_number: 2, ocr: { data: 'Ex libris plate of the University Library, with an accession stamp.' } },
  },
  {
    name: 'frontispiece with engraving',
    page: { page_number: 1, page_type: 'frontispiece', ocr: { data: 'An allegorical engraved portrait of the author within an oval frame.' } },
  },
  {
    name: 'binding photo mislabeled as frontispiece',
    page: { page_number: 1, page_type: 'frontispiece', ocr: { data: 'Photograph of the leather cover and binding of the volume.' } },
  },
  { name: 'hidden page', page: { page_number: 1, page_type: 'title-page', hidden: true } },
  { name: 'no OCR, no type, no page number', page: {} },
  {
    name: 'page type parsed from OCR tag',
    page: { page_number: 4, ocr: { data: '<page-type>frontispiece</page-type>\nAn emblem engraving.' } },
  },
  {
    name: 'ocr_head projection instead of full ocr.data',
    page: { page_number: 3, page_type: 'title-page', ocr_head: 'DE PROVIDENTIA ET FATO, typis excudebat, ornamental border' },
  },
  {
    name: 'title page naming the work with accents the record lacks (#3584)',
    title: 'Ikhwan al-Safa (Brethren of Purity) - Dowson Translation',
    author: 'Ikhwan al-Safa; tr. John Dowson',
    page: { page_number: 7, page_type: 'title-page', ocr: { data: IKHWAN_P7 } },
  },
  {
    name: 'series title page that names another thing (#3584)',
    title: 'Tertullian (Loeb)',
    author: 'Tertullian',
    page: { page_number: 5, page_type: 'title-page', ocr: { data: TERTULLIAN_P5_SERIES } },
  },
  {
    name: 'one-word title, one hit',
    title: 'Zohar',
    page: { page_number: 3, page_type: 'title-page', ocr: { data: '# SEFER HA-ZOHAR' } },
  },
  {
    name: 'Cornell "original of this book" insert tagged title-page',
    page: { page_number: 2, page_type: 'title-page', ocr: { data: 'The original of this book is in the Cornell University Library. There are no known copyright restrictions in the United States on the use of the text.' } },
  },
  {
    name: 'library digital-surrogate cover leaf tagged title-page (#3584)',
    page: { page_number: 1, page_type: 'title-page', ocr: { data: 'Digital surrogate cover page provided by Cornell University Library' } },
  },
  { name: 'deep interior text page', page: { page_number: 40, page_type: 'text', ocr: { data: 'Caput primum. De rerum natura.' } } },
];

describe('cover scorer TS/mjs parity', () => {
  for (const f of FIXTURES) {
    it(`agrees on: ${f.name}`, () => {
      const ts = scoreTs(f.page as never, { bookTitle: f.title, bookAuthor: f.author });
      const mjs = scoreMjs(f.page, { bookTitle: f.title, bookAuthor: f.author });
      expect(ts).toEqual(mjs);
    });
  }

  it('agrees on parsePageTypeFromOcr', () => {
    for (const text of ['<page-type>title-page</page-type>', 'no tag here', '', null]) {
      expect(parseTs(text)).toEqual(parseMjs(text));
    }
  });

  it('exports an identical hand-in-frame pattern', () => {
    expect(handTs.source).toBe(handMjs.source);
    expect(handTs.flags).toBe(handMjs.flags);
  });
});

describe('scoring behavior (pins the failure classes ensure-cover shipped with)', () => {
  it('rejects the scanner-hand page outright', () => {
    expect(scoreTs({ page_number: 1, ocr_head: 'A gloved hand is visible at the edge' })).toEqual({ score: -75, reason: 'hand in frame' });
  });

  it('prefers a scored title page over an earlier plain page', () => {
    const titlePage = scoreTs({ page_number: 3, page_type: 'title-page', ocr_head: 'TITLE typis apud decorative border' });
    const firstLeaf = scoreTs({ page_number: 1, ocr_head: 'Some faint text.' });
    expect(titlePage.score).toBeGreaterThan(30);
    expect(titlePage.score).toBeGreaterThan(firstLeaf.score);
  });

  it('does not flag hand-colored / handwriting language as a hand in frame', () => {
    for (const text of [
      'A hand-colored woodcut of the zodiac',
      'Handwriting in the lower margin',
      'On the other hand, the author argues',
      'the hand of God depicted in the engraving',
    ]) {
      expect(handTs.test(text)).toBe(false);
    }
  });

  it('flags real hand-in-frame descriptions', () => {
    for (const text of [
      "The scanner's hand is visible at the corner",
      'A gloved hand holding the page flat',
      'fingers are visible at the bottom of the frame',
      'a thumb is visible on the left edge',
    ]) {
      expect(handTs.test(text)).toBe(true);
    }
  });
});

describe('a title page that names the book outranks one that does not (#3584)', () => {
  const tertullian = { bookTitle: 'Tertullian (Loeb)', bookAuthor: 'Tertullian' };

  it('picks the work\'s own title page over the earlier, woodcut-decorated series title', () => {
    const series = scoreTs({ page_number: 5, page_type: 'title-page', ocr: { data: TERTULLIAN_P5_SERIES } }, tertullian);
    const own = scoreTs({ page_number: 9, page_type: 'title-page', ocr: { data: TERTULLIAN_P9_OWN } }, tertullian);
    expect(series.reason).not.toContain('names-work');
    expect(own.reason).toContain('names-work');
    expect(own.score).toBeGreaterThan(series.score);
  });

  it('the weakest naming title page beats the strongest non-naming one', () => {
    const opts = { bookTitle: 'Magia Adamica, or The Antiquitie of Magic', bookAuthor: 'Thomas Vaughan' };
    // Everything the scorer rewards except the name: early, imprinted, ornate.
    const ornateOther = scoreTs({
      page_number: 3, page_type: 'title-page',
      ocr: { data: `${MANMOUSE_P7} Printed by T.W. within an ornamental woodcut border.` },
    }, opts);
    // Nothing but the name, and deep in the volume.
    const plainOwn = scoreTs({ page_number: 19, page_type: 'title-page', ocr: { data: 'MAGIA ADAMICA: or the Antiquitie of Magic.' } }, opts);
    expect(ornateOther.reason).not.toContain('names-work');
    expect(plainOwn.score).toBeGreaterThan(ornateOther.score);
    // …and the best a one-word title can earn on a single hit.
    const oneWord = scoreTs({
      page_number: 3, page_type: 'title-page',
      ocr: { data: '# ZOHAR printed by a press, ornamental border' },
    }, { bookTitle: 'Zohar' });
    expect(plainOwn.score).toBeGreaterThan(oneWord.score);
  });

  it('one shared word is not a name', () => {
    const opts = { bookTitle: 'Magia Adamica, or The Antiquitie of Magic', bookAuthor: 'Thomas Vaughan' };
    const withWord = scoreTs({ page_number: 3, page_type: 'title-page', ocr: { data: 'A DISCOURSE OF NATURAL MAGIC' } }, opts);
    const without = scoreTs({ page_number: 3, page_type: 'title-page', ocr: { data: 'A DISCOURSE OF NATURAL THINGS' } }, opts);
    expect(withWord).toEqual(without);
  });

  it('matches through accents and inflection', () => {
    const scored = scoreTs(
      { page_number: 7, page_type: 'title-page', ocr: { data: IKHWAN_P7 } },
      { bookTitle: 'Ikhwan al-Safa (Brethren of Purity) - Dowson Translation', bookAuthor: 'Ikhwan al-Safa; tr. John Dowson' },
    );
    expect(scored.reason).toContain('names-work');
  });

  it('rejects a library digital-surrogate leaf even when it is tagged title-page', () => {
    const scored = scoreTs({ page_number: 1, page_type: 'title-page', ocr_head: 'Digital surrogate cover page provided by Cornell University Library' });
    expect(scored).toEqual({ score: -70, reason: 'digitizer insert' });
  });
});
