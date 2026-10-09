/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS modules under test are untyped */
/**
 * #5700 A2/A3: the $0 cleanup of served translations. One pure function per class; every fixture
 * is an excerpt of a stored page from the 2026-10-03 census draw (book id and page in the name).
 *
 * What these pin is mostly what each class must LEAVE ALONE — a cleanup that deletes a real word
 * or a real quotation is worse than the leak it removes.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { notesToMeta, repairTagsDeletionOnly, fixCentreMarkers, dropAbsentOriginals, strictlyAbsent, cleanupPage, SOURCE, TERMDEF_SOURCE, runFor } from '../../scripts/maintenance/translation-cleanup-a2-5700.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { isMaintenanceSource } from '../../scripts/eval/lib/revision-source.mjs';
import { separateTermDefinitions } from '@/lib/term-definitions';

const stripTags = (s: string) => s.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*?)?\s*\/?>/g, '');

describe('a: scan/initial notes move to <meta>', () => {
  it('moves a decorative-initial note and deletes no word (69b51e9647b06ecd58193ed8 p64)', () => {
    const t = '<note>A decorative initial "D" begins the text.</note> The second article is concerning the passion.';
    const r = notesToMeta(t);
    expect(r.text).toBe('<meta>A decorative initial "D" begins the text.</meta> The second article is concerning the passion.');
    expect(r.n.initial).toBe(1);
    expect(stripTags(r.text)).toBe(stripTags(t));
  });
  it('keeps a note that reads the text, even when it names an initial', () => {
    const t = '<note>The decorative initial S was omitted by the rubricator, so the word reads "ed" for "Sed".</note>';
    expect(notesToMeta(t).text).toBe(t);
  });
  it('keeps glosses, originals and notes with markup inside', () => {
    for (const t of [
      '<note>original: "ἡσυχίαν" (hesychian)</note>',
      '<note>The Greek term for an Octave</note>',
      '<note>A decorative initial <term>A</term> begins the text.</note>',
      '<note attr="x">A decorative initial A.</note>',
    ]) expect(notesToMeta(t).text).toBe(t);
  });
  it('scan warnings are a separate switch (the class failed its by-eye gate)', () => {
    const t = '<note>Large water stain on the right side of the page, though text remains largely legible.</note>';
    expect(notesToMeta(t, ['initial']).text).toBe(t);
    expect(notesToMeta(t, ['scan']).n.scan).toBe(1);
  });
});

describe('c_tags: tag faults repaired by deletion only', () => {
  it('rejoins the premature close (69b525c56be60460830320be p10)', () => {
    const t = '<margin></margin>\nChinese anxiety regarding an eclipse.\n</margin>\nOn the 6th of August there was an eclipse.';
    const r = repairTagsDeletionOnly(t);
    expect(r.text).toBe('<margin>\nChinese anxiety regarding an eclipse.\n</margin>\nOn the 6th of August there was an eclipse.');
    expect(r.n).toBe(1);
  });
  it('does not rejoin around other tags or centre markers — the reader renders those worse (69dbcae31040d1d5e20afa1d p72)', () => {
    // Rendered through NotesRenderer: the <unclear> inside a rejoined <margin> loses its "?",
    // and centred lines fall out of a rejoined <insert>.
    for (const t of [
      '<margin></margin>\n<unclear>Comet</unclear>\n<unclear>is</unclear> <unclear>noble;</unclear>\n</margin>\n<margin>Callisto.</margin>',
      '<insert></insert>\n->NATIONAL CENTRAL LIBRARY<-\n->ALDINE COLLECTION<-\n</insert>',
    ]) {
      const r = repairTagsDeletionOnly(t);
      expect(r.text).toBe(t);
      expect(r.skipped).toBe('far-rejoin');
    }
  });
  it('does not accept a moved closer: a nested note must not spill into body text (69b2ffb05545150b61b491d9 p2)', () => {
    const t = '<margin></margin>seal</margin>\n<note>Above the shield is the word "LIGHT" <note>original: "LVX"</note>, and the motto is inscribed around the figures.</note>';
    const r = repairTagsDeletionOnly(t);
    expect(r.text).toBe(t);
    expect(r.skipped).toBe('tag-moved');
  });
  it('drops an empty pair and an orphan closer', () => {
    expect(repairTagsDeletionOnly('Body <insert></insert> text.').text).toBe('Body  text.');
    expect(repairTagsDeletionOnly('the will and direct passions.</margin>\n\n### SECT. III.').text).toBe('the will and direct passions.\n\n### SECT. III.');
  });
  it('does not rejoin across a blank line — that would wrap body text in a margin (6a4e1691aee010f8fd54f4bf p4)', () => {
    const t = '<insert></insert>\n->Collection of German Prints<-\n\n<note>The embossed logo is visible.</note>\n\n->Acquired with funds<-\n</insert>';
    const r = repairTagsDeletionOnly(t);
    expect(r.text).toBe(t);
    expect(r.skipped).toBe('far-rejoin');
  });
  it('leaves a page that needs a closer PLACED', () => {
    const t = 'He said <note>original: "λάθε βιώσας". This is the maxim of Epicurus and the text goes on\n\nNext paragraph.';
    const r = repairTagsDeletionOnly(t);
    expect(r.text).toBe(t);
    expect(r.skipped).toBe('tag-added');
  });
  it('leaves a tag that carries a number (69e80578fdad300064d9dcb5 p269)', () => {
    const t = 'force it to rotate in a circle. <verse 68> If the horse still stands';
    expect(repairTagsDeletionOnly(t).text).toBe(t);
  });
  it('leaves formatting tags outside the vocabulary — they want mapping, not deletion (698fb7806b95eeda7d2d20b9 p621)', () => {
    const t = 'Rozet, <italic>Mémoire sur les Volcans</italic> in the <margin></margin>x</margin>';
    const r = repairTagsDeletionOnly(t);
    expect(r.text).toBe(t);
    expect(r.skipped).toBe('unknown-tag');
  });
  it('never changes a word, and a well-formed page is byte-identical', () => {
    const ok = '<margin>Hebrews 13.</margin> Body <term>terma</term> <gloss>treasure</gloss>.<column-break/>';
    expect(repairTagsDeletionOnly(ok)).toEqual({ text: ok, n: 0 });
    const t = '<header>The northern figures follow.</header>\n\n<margin></margin>\nEstotiland\n</margin></note>';
    expect(stripTags(repairTagsDeletionOnly(t).text)).toBe(stripTags(t));
  });
});

describe('c_visible: centre markers the reader prints', () => {
  it('strips the closing hashes of a centred heading (697a37fae1d81a84b06d2d73 p147)', () => {
    expect(fixCentreMarkers('->#### OF THE SAGES ####<-').text).toBe('->#### OF THE SAGES<-');
    expect(fixCentreMarkers('-># CHINESE SCIENCE#<-').text).toBe('-># CHINESE SCIENCE<-');
    expect(fixCentreMarkers('-># ON PLEASURE<-').text).toBe('-># ON PLEASURE<-');
  });
  it('repairs a malformed closer (695910f5ecb01322b306854d p470)', () => {
    expect(fixCentreMarkers('->Of other useful trees, called <term>ciguas</term>.-<').text).toBe('->Of other useful trees, called <term>ciguas</term>.<-');
    expect(fixCentreMarkers('->Every *active principle* has a *passive principle*.< -').text).toBe('->Every *active principle* has a *passive principle*.<-');
  });
  it('turns a reversed pair round (69aead0b66bcc9447837c16e p107)', () => {
    expect(fixCentreMarkers('<-FROM THE BOOK->').text).toBe('->FROM THE BOOK<-');
  });
  it('keeps one opener per centred block (69af2308b5227118e60e4a69 p486)', () => {
    const t = 'Virgil:\n->taught the horse under arms, placed on its back,\n->to insult the ground and to bunch its proud steps.<-\n\nNext.';
    expect(fixCentreMarkers(t).text).toBe('Virgil:\n->taught the horse under arms, placed on its back,\nto insult the ground and to bunch its proud steps.<-\n\nNext.');
  });
  it('drops an opener nothing closes (6a4b4e936e19521562a5e5e3 p5)', () => {
    expect(fixCentreMarkers('an action.\n\n->§. II.\n\nNow to the examples.').text).toBe('an action.\n\n§. II.\n\nNow to the examples.');
  });
  it('leaves an opener whose closer is paragraphs away — removing it would strand the "<-" (69a5eaddd507939f0352d019 p494)', () => {
    const t = '->The learned admire Euclid,\n\nAristotle and Theophrastus, and Galen’s writ...<-';
    expect(fixCentreMarkers(t).text).toBe(t);
  });
  it('leaves an opener when what follows would become markdown (6a4e58d8fe517e68536cb9ee p3)', () => {
    for (const t of ['->4.\n\nText.', '->* Bear and forbear *', '-># HEAD']) expect(fixCentreMarkers(t).text).toBe(t);
  });
  it('never touches an arrow inside running text, or a well-formed block', () => {
    for (const t of ['CENTRAL NATIONAL LIBRARY OF FLORENCE -> INIC', 'A -> B and B <- C', '->Line one<-\n->Line two<-', '->two\nlines<-'])
      expect(fixCentreMarkers(t).text).toBe(t);
  });
});

describe('b: original: quotes that are not on the page', () => {
  const pad = ' Reliqua pars huius capitis de rebus aliis agit, quae ad praesens institutum nihil pertinent.'.repeat(6);
  it('drops a clause no word of which is on the page, and keeps the rest of the note (86fe639a… p97)', () => {
    const ocr = 'The quacks and their consanguineous kin were thought to profit by it.' + pad;
    const r = dropAbsentOriginals('charlatans <note>original: "mountebanks". Itinerant sellers of remedies.</note> were', [ocr]);
    expect(r.text).toBe('charlatans <note>Itinerant sellers of remedies.</note> were');
    expect(r.dropped).toEqual(['mountebanks']);
  });
  it('removes the note when nothing else is in it', () => {
    const r = dropAbsentOriginals('the white fever <note>original: "febri alba"</note> returns', ['Nihil hic de morbis dicitur.' + pad]);
    expect(r.text).toBe('the white fever returns');
  });
  it('keeps a quote the page prints across a line break, with u/v, or abbreviated (0a481175… p371, 6990522f… p62)', () => {
    const keep = (q: string, ocr: string) => expect(dropAbsentOriginals(`x <note>original: "${q}"</note>`, [ocr + pad]).n).toBe(0);
    keep('elementa', 'cus stylū per singula deducit e= lementa, memoria');
    keep('exufflavit', 'crucis se signās. dyabolū exuf, flauit. qui d');
    keep('melancholicus morbus', 'est, Atq; melãcholicus quosdã malè morbus habebit.');
    keep('saeculares', 'grauius puniendi sunt quam fæculares, arg. opti');
    keep('imperficit', 'prima breuis i<gloss>m</gloss>perficit longam');
  });
  it('a stray "<" in the OCR does not swallow the page (6a0854e849638a50931c0bdb p104)', () => {
    const ocr = 'canto < terzo' + pad + " del triompho dell'amore, et come tardi doppo il danno intendo: et nel Sonetto <note>171</note>";
    expect(strictlyAbsent('e come tardi doppo il danno intendo', [ocr])).toBe(false);
  });
  it('keeps a quote found on a neighbouring page (block translations cross the seam)', () => {
    const own = 'Nihil hic de morbis dicitur.' + pad;
    expect(dropAbsentOriginals('x <note>original: "febri alba"</note>', [own, '', 'de febri alba et nigra']).n).toBe(0);
  });
  it('never touches a page that prints another script — a romanisation is not an invention', () => {
    const ocr = 'མིག་དམར་གྱི་སྐོར། ' + pad;
    expect(dropAbsentOriginals('Mars <note>original: "Mig-dmar"</note>', [ocr]).n).toBe(0);
    expect(strictlyAbsent('ἡσυχίαν', [pad])).toBe(false);
  });
  it('does nothing without a real transcription to check against', () => {
    const t = 'x <note>original: "bildern"</note>';
    expect(dropAbsentOriginals(t, ['<image-desc>' + pad + '</image-desc>']).text).toBe(t);
    expect(dropAbsentOriginals(t, ['']).text).toBe(t);
  });
});

describe('cleanupPage', () => {
  it('runs only the named classes and reports what fired', () => {
    const t = '<note>A decorative initial A.</note>\n->### HEAD ###<-\n<margin></margin>x</margin>';
    const all = cleanupPage(t);
    expect(all.text).toBe('<meta>A decorative initial A.</meta>\n->### HEAD<-\n<margin>x</margin>');
    expect(Object.keys(all.fired).sort()).toEqual(['a_initial', 'c_tags', 'c_visible']);
    expect(cleanupPage(t, { classes: ['c_visible'] }).text).toBe('<note>A decorative initial A.</note>\n->### HEAD<-\n<margin></margin>x</margin>');
  });
  it('is idempotent', () => {
    const t = '<note>A decorative initial A.</note>\n->### HEAD ###<-\n<margin></margin>x</margin>\n->a\n->b<-';
    const once = cleanupPage(t).text;
    expect(cleanupPage(once).text).toBe(once);
  });
  it('writes revisions under a label the measurement stack reads as maintenance, not a reading', () => {
    expect(isMaintenanceSource(SOURCE)).toBe(true);
  });
});

/**
 * #5901: a model definition stored inside the chip. The rule is the reader's
 * (scripts/lib/term-definitions.mjs); these pin what the STORED rewrite does with it.
 * Excerpts as in tests/unit/term-definitions.test.ts (Geomancy: 6975158aa88d83c830d99e22 p83).
 */
describe('d: definitions inside <term> move to a <note> (#5901)', () => {
  const d = (t: string) => cleanupPage(t, { classes: ['d_termdef'] });
  it('splits head and definition, keeping the chip on the head', () => {
    const r = d('the <term>Luna: the alchemical name for silver</term> is fixed');
    expect(r.text).toBe('the <term>Luna</term> <note>the alchemical name for silver</note> is fixed');
    expect(r.fired.d_termdef).toEqual({ split: 1 });
  });
  it('keeps only the note when the head already stands before the chip', () => {
    const r = d('**Geomancy** <term>Geomancy: A method of divination that interprets markings on the ground or the patterns formed by tossed handfuls of soil, rocks, or sand.</term>, an art performed through points without a natural basis;');
    expect(r.text).toBe('**Geomancy** <note>A method of divination that interprets markings on the ground or the patterns formed by tossed handfuls of soil, rocks, or sand.</note>, an art performed through points without a natural basis;');
    expect(r.fired.d_termdef).toEqual({ head_dropped: 1 });
  });
  it('turns an "original: …" chip into a note with no chip', () => {
    const r = d('the <term>original: 足陽明經 (zú yáng míng jīng); a major energy channel running from the face to the feet</term> runs');
    expect(r.text).toBe('the <note>original: 足陽明經 (zú yáng míng jīng); a major energy channel running from the face to the feet</note> runs');
    expect(r.fired.d_termdef).toEqual({ apparatus: 1 });
  });
  it('leaves genuine terms: a mantra, a title, a reference', () => {
    for (const t of [
      'he recited <term>oṃ namo bhagavate bhaiṣajyaguru vaiḍūryaprabharājāya tathāgatāya arhate samyaksaṃbuddhāya</term> three times',
      '<term>De Vita: Liber Primus</term>', '<term>Genesis 1:3</term>', '<term>Psalm: 23</term>',
    ]) {
      const r = d(t);
      expect(r.text).toBe(t);
      expect(r.fired).toEqual({});
    }
  });
  it('does not touch a <gloss> after a term — page_terms (#4695) indexes those pairs', () => {
    const t = "where <term>Sulphur</term> boils mixed with perennial <term>Silver</term> <gloss>mercury or 'quicksilver'</gloss>, fleeing";
    expect(d(t).text).toBe(t);
  });
  it('leaves a chip inside another annotation span: a note written there would be nested', () => {
    const t = '<note>The author means <term>Luna: the alchemical name for silver</term> here.</note> and <margin><term>Sol: the alchemical name for gold</term></margin>';
    const r = d(t);
    expect(r.text).toBe(t);
    expect(r.fired).toEqual({});
    expect(r.skipped.d_termdef).toBe('in-span');
  });
  it('still splits a chip after a span has closed', () => {
    expect(d('<note>A note.</note> the <term>Luna: the alchemical name for silver</term>').text)
      .toBe('<note>A note.</note> the <term>Luna</term> <note>the alchemical name for silver</note>');
  });
  it('is idempotent, and is not part of a default (#5700) run', () => {
    const once = d('the <term>Luna: the alchemical name for silver</term> is fixed').text;
    expect(d(once).text).toBe(once);
    const t = 'the <term>Luna: the alchemical name for silver</term> is fixed';
    expect(cleanupPage(t).text).toBe(t);
  });
  it('writes under its own maintenance label, and never in a mixed run', () => {
    expect(runFor(['d_termdef'])).toEqual({ source: 'cleanup-termdef-5901', issue: '#5901', jobId: 'term-defs-5901' });
    expect(runFor(['a_initial', 'c_tags']).source).toBe(SOURCE);
    expect(() => runFor(['d_termdef', 'c_tags'])).toThrow(/alone/);
    expect(isMaintenanceSource(TERMDEF_SOURCE)).toBe(true);
  });
  it('stores what the reader already shows: display rule over the rewritten text changes nothing more', () => {
    for (const t of ['the <term>Luna: the alchemical name for silver</term> is fixed', '**Geomancy** <term>Geomancy: A method of divination by points.</term>, an art']) {
      expect(d(t).text).toBe(separateTermDefinitions(t));
      expect(separateTermDefinitions(d(t).text)).toBe(d(t).text);
    }
  });
});
