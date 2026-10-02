/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * #5647 note fact-check lane, stages 1–2 (scripts/lib/note-claims.mjs).
 *
 * Fixtures are REAL: the notes are verbatim from the #5624 candidates (PR #5640, ids given), the
 * OCR excerpts are cut from those pages, and the table rows are copied from the built table
 * (84000 / Mahāvyutpatti single equivalences, quoted as facts). The rules pinned here are the
 * ones a negative control was run against: delete the rule, the named case goes red.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import * as nc from '../../scripts/lib/note-claims.mjs';

const T = (wylie: string, skt: string, type: string, src = '84000-tei') => ({ wylie, skt, type, src, ref: 'fixture' });
const table = nc.indexTable([
  T("'jig rten 'dzin", 'Lokadhara', 'person'),
  T('me skyes', 'jyotiṣka', 'person'),
  T("'tsho byed", 'jīvaka', 'person'),
  T('blo gros brtan pa', 'sthiramati', 'person'),
  T('blo gros brtan pa', 'dṛḍhamati', 'person'),
  T('rang bzhin stong pa nyid', 'prakṛtiśūnyatā', 'term', 'mahavyutpatti-dila'),
  T('snying rje chen po', 'mahākaruṇā', 'term'),
  T("dga' ba'i sde", 'Priyasena', 'person', 'rangjung-yeshe-3'),
]);

// OCR excerpts (N193: 69e7abb55f1a22ab19a9cb7e p76; N221: 69e7ab285f1a22ab19a93de3 p26)
const OCR_N193 = 'ོན་གྱི་རྗེས་སུ་རྟེན་ཅིང་འབྲེལ་ཏེ་བྱུང་བ་བཅུ་གཉིས་རྟོགས་སོ། །འཇིག་རྟེན་འཛིན་དེ་ནི་བྱང་ཆུབ་སེམས་དཔའ་སེམས་དཔའ་ཆེན་པོ་རྣམས་རྟེན་ཅིང་འབྲེལ་ཏེ་འབྱ';
const OCR_N221 = 'དི་སྐད་ཅེས་\nརྒྱལ་པོ་ཆེན་པོ་ཁྱིམ་བདག་ཤིན་ཏུ་བཟང་པོ་ལ་གཞོན་ནུ་མེ་སྐྱེས་བྱིན་ཅིག །གལ་ཏེ་ཁྱིམ་བདག་ཤིན་ཏུ་བཟངས་པོ་གཞོན་ནུ་མེ་སྐྱེས་མཐོ་བ་ན་ཁྲག་ཚ་';

const run = (note: string, ocr = '') => {
  const t = nc.typeNote(note);
  return nc.matchRow({ source_tag: 'note', claim_kind: t.claim_kind, note, claim: { sanskrit: t.sanskrit, sanskrit_groups: t.sanskrit_groups, wylie: t.wylie } }, table, ocr, '');
};

describe('stage 1: the #5624 cue filter', () => {
  it('keeps a judged candidate and drops original:, short and cue-less notes', () => {
    const text = 'x <note>Tibetan: \'Jig rten \'dzin; Sanskrit: Lokeshvara or Jagaddhara</note> y <note>original: "འཇིག་རྟེན་འཛིན" known as Lokadhara the king</note> <note>Sanskrit: bodhi</note>';
    const notes = nc.pageNotes(text);
    expect(notes.map((n: any) => n.candidate)).toEqual([true, false, false]);
    expect(notes.map((n: any) => n.index)).toEqual([0, 1, 2]);
  });
  it('re-keys rows to the translation hash', () => {
    const page = { id: 'p1', book_id: 'b1', page_number: 3, translation: { data: 'a <note>Tibetan: Blo gros brtan pa; Sanskrit: Sthiramati</note>' } };
    const [a] = nc.claimRowsForPage(page);
    const [b] = nc.claimRowsForPage({ ...page, translation: { data: page.translation.data + ' more' } });
    expect(a._id).toBe('p1:note:0');
    expect(a.translation_hash).not.toBe(b.translation_hash);
    expect(a.claim.wylie).toBe('Blo gros brtan pa');
  });
});

describe('stage 1: claim parsing', () => {
  it('"or" offers alternatives, "and" lists separate claims (N193, N034)', () => {
    expect(nc.parseSanskritGroups("Tibetan: 'Jig rten 'dzin; Sanskrit: Lokeshvara or Jagaddhara")).toEqual([['Lokeshvara', 'Jagaddhara']]);
    expect(nc.parseSanskritGroups('Sanskrit: "Sautrantika" and "Vaibhashika"')).toEqual([['Sautrantika'], ['Vaibhashika']]);
  });
  it('a note describing a dharani asserts no Sanskrit form (N003)', () => {
    expect(nc.parseSanskrit('Sanskrit dharani for summoning Indra/Shakra')).toEqual([]);
  });
  it('reads the quoted Tibetan in all three note shapes', () => {
    expect(nc.parseWylie('term: soul (Tibetan: shed-bdag, equivalent to Sanskrit: puruṣa or ātman)')).toBe('shed-bdag');
    expect(nc.parseWylie('term: "Me-skyes" gloss: Fire-born, referring to Jivaka Kumarabhritya')).toBe('Me-skyes');
    expect(nc.parseWylie('Tibetan: *bras bu gsum*; Sanskrit: *triphala*')).toBe('bras bu gsum');
  });
});

describe('stage 2a: Tibetan↔Sanskrit table', () => {
  it('conflict when the quoted Tibetan has a different equivalent (N193, judged wrong)', () => {
    expect(run("Tibetan: 'Jig rten 'dzin; Sanskrit: Lokeshvara or Jagaddhara").status).toBe('conflict');
  });
  it('match on a standard equivalence, through romanisation (N041, judged correct)', () => {
    expect(run('Tibetan: snying rje chen po; Sanskrit: mahākaruṇā').status).toBe('match');
    expect(nc.sktSame('Shariputra', 'śāriputra')).toBe(true);
    expect(nc.sktSame('Harisena', 'Nandasena')).toBe(false);
  });
  it('a name with two referents in the table is no-entry, not match (N186, judged wrong)', () => {
    const r = run('Tibetan: Blo gros brtan pa; Sanskrit: Sthiramati');
    expect(r.status).toBe('no-entry');
    expect(r.reason).toBe('ambiguous-name');
  });
  it('Rangjung Yeshe alone can confirm but never refute (N232, judged wrong)', () => {
    expect(run("Tibetan: dGa' ba'i sde; Sanskrit: Harisena").status).toBe('no-entry');
  });
  it('an implicit name next to a quoted term can conflict (N221, judged wrong) — but not after "not"', () => {
    expect(run('term: "Me-skyes" gloss: Fire-born, referring to Jivaka Kumarabhritya', OCR_N221).status).toBe('conflict');
    // the same note as corrected by fix-note-facts-5624.mjs
    expect(run('term: "Me-skyes" gloss: Fire-born; Sanskrit: Jyotiṣka (not Jīvaka)', OCR_N221).status).toBe('match');
  });
  it('a group anchored only through the page cannot refute its other alternative', () => {
    const claim = { sanskrit_groups: [['Lokadhara', 'Lokeshvara']], wylie: null };
    const r = nc.matchSanskritClaim(claim, table, OCR_N193);
    expect(r.groups[0].anchor.how).toBe('page-tibetan');
    expect(r.status).toBe('no-entry');
    expect(nc.matchSanskritClaim({ sanskrit_groups: [['Lokadhara']], wylie: null }, table, OCR_N193).status).toBe('match');
  });
  it('implicit names are ignored when the note quotes no Tibetan', () => {
    expect(run('referring to Jivaka the physician', OCR_N221).status).toBe('no-entry');
  });
});

describe('stage 2b: page apparatus against the OCR', () => {
  it('a heading number absent from a Chinese page is a conflict (#5632 A09: 卷一百四十九)', () => {
    expect([...nc.pageNumbers('武備志卷一百四十九')]).toContain(149);
    const ocr = '武備志卷一百四十九 占度載 日 '.repeat(8);
    expect(nc.matchPageClaim({ kind: 'page-number', name: '139' }, ocr, '').status).toBe('conflict');
    expect(nc.matchPageClaim({ kind: 'page-number', name: '149' }, ocr, '').status).toBe('match');
  });
  it('a name absent from a Latin page is a conflict; absent from a Tibetan page it is no-entry', () => {
    const latin = 'demonstrationem est nullam habere videtur atque videtur et in historiam est probabilis certitudo cognitionis suae '.repeat(2);
    expect(nc.matchPageClaim({ kind: 'page-name', name: 'Nicostratus' }, latin, 'the thought was the goddess').status).toBe('conflict');
    expect(nc.matchPageClaim({ kind: 'page-name', name: 'Padmasambhava' }, OCR_N193.repeat(2), 'the bodhisattva').status).toBe('no-entry');
  });
  it('an English <image-desc> in the OCR is not page text, and a diagram page is not checked', () => {
    const desc = `<image-desc>${'A circular diagram naming Tara and Avalokiteshvara in English prose about the page and its rings. '.repeat(4)}</image-desc>${OCR_N193}`;
    expect(nc.nameBearingScript(desc.replace(/<[^>]+>/g, ' '))).toBe(true); // the English alone would pass as page text
    expect(nc.nameBearingScript(nc.ocrPageText(desc))).toBe(false);
    expect(nc.matchPageClaim({ kind: 'page-name', name: 'Tara' }, `<page-type>diagram</page-type>${desc}`, '').reason).toBe('diagram-page');
  });
});
