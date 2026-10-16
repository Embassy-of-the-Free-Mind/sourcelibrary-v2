/**
 * date-works.mjs (#6721): what makes a date's `basis` trustworthy.
 *
 * What these pin: a title_page basis survives ONLY with a verbatim span of the leaves the model was shown; the reply
 * template's year 0 is "not given"; the edition rule reads a printed imprint (Arabic or Roman) on the first two
 * leaves, refuses describing prose and the #3307 1700 placeholder, and sends conflicting or pre-1450 catalogue years
 * to the model. The stored layers keep the SourceWorkDateLayer shape the reader already renders.
 */
import { describe, it, expect } from 'vitest';
import {
  cleanDate, parseReply, parseBatchReply, ruleEdition, findImprint, catalogueYears, toStoredLayers, buildLead,
  parseWhyReply, buildWhyPrompt,
} from '../../scripts/lib/date-works.mjs';

const lead = '[page 1] HARMONICES MUNDI LIBRI V. Lincii Austriae, Anno M. DC. XIX.\n[page 2] Dedicatio ad regem';

describe('cleanDate', () => {
  it('keeps title_page when the evidence is a verbatim span of the leaves', () => {
    const d = cleanDate({ year: 1619, basis: 'title_page', evidence: 'Anno M. DC. XIX.' }, lead);
    expect(d.basis).toBe('title_page');
  });
  it('downgrades title_page whose evidence is not on the leaves, and keeps the claim', () => {
    const d = cleanDate({ year: 1619, basis: 'title_page', evidence: 'Anno 1619' }, lead);
    expect(d.basis).toBe('model_knowledge');
    expect(d.basis_claimed).toBe('title_page');
    expect(d.evidence).toBe('');
  });
  it('reads the template placeholder 0 as not given, and fills year from the window', () => {
    const d = cleanDate({ year: 0, from: 1610, to: 1614, basis: 'model_knowledge' }, lead);
    expect(d.year).toBe(1612);
  });
});

describe('parseReply / parseBatchReply', () => {
  it('never lets the catalogue be the basis of a WORK date', () => {
    const r = parseReply(JSON.stringify({ work: { year: 1619, basis: 'catalogue' }, edition: { year: 1619, basis: 'catalogue' }, confidence: 'high' }), { lead });
    expect(r?.work.basis).toBe('model_knowledge');
    expect(r?.edition?.basis).toBe('catalogue');
  });
  it('checks batched evidence against the slice of leaves the model was SHOWN', () => {
    const books = [{ lead: 'x'.repeat(1300) + ' Anno 1612 ' }];
    const reply = JSON.stringify([{ n: 1, work: { year: 1600, basis: 'model_knowledge' }, edition: { year: 1612, basis: 'title_page', evidence: 'Anno 1612' }, confidence: 'high' }]);
    expect(parseBatchReply(reply, books, { leadChars: 1200 }).get(0)?.edition?.basis).toBe('model_knowledge');
    expect(parseBatchReply(reply, books, { leadChars: 2000 }).get(0)?.edition?.basis).toBe('title_page');
  });
});

describe('edition rule', () => {
  it('finds a Roman imprint with dots and spaces', () => {
    expect(findImprint(lead, 1619)?.form).toBe('roman');
  });
  it('dates by title_page when the catalogue year is printed on the leaves', () => {
    const e = ruleEdition({ published: '1619', lead, language: 'Latin' });
    expect(e).toMatchObject({ year: 1619, basis: 'title_page', rule: 'imprint_roman' });
    expect(lead).toContain(e!.evidence);
  });
  it('refuses a year inside describing prose', () => {
    const e = ruleEdition({ published: '1771', lead: '[page 1] mirroring the layout of the original 1771 edition', language: 'Latin' });
    expect(e?.basis).toBe('catalogue');
  });
  it('takes a library label or shelfmark slip for the catalogue, not the title page', () => {
    expect(ruleEdition({ published: '1662', lead: '[page 1] R-B B1299.M6 1662 BOSTON PUBLIC LIBRARY', language: 'Latin' })?.basis).toBe('catalogue');
    expect(ruleEdition({ published: '1489', lead: '[page 1] MARSI FICINI DE VITA 1489 INCUNABULI C 6', language: 'Latin' })?.basis).toBe('catalogue');
  });
  it('sends the 1700 Tibetan placeholder (#3307) and conflicting sources to the model', () => {
    expect(ruleEdition({ published: '1700', lead: '', language: 'Tibetan' })).toBeNull();
    expect(ruleEdition({ published: '1612', catalogue_years: [1613], lead: '', language: 'Latin' })).toBeNull();
    expect(ruleEdition({ published: '1290', lead: '', language: 'Latin' })).toBeNull();
  });
  it('reads source-record years, never scrape dates', () => {
    expect(catalogueYears(JSON.stringify({ date_iso: '1904', public_date: '2015-12-09 10:21:47', scraped_at: '2026-05-16T17:28:23Z', metadata_pairs: [{ label: 'Date', value: '[1612]' }] })).sort()).toEqual([1612, 1904]);
  });
});

describe('stored shape', () => {
  it('maps layers onto SourceWorkDateLayer with basis + evidence', () => {
    const r = { work: { year: -360, display: 'c. 360 BCE', basis: 'model_knowledge', evidence: '' }, edition: { year: 1619, display: '1619', basis: 'title_page', evidence: 'Anno M. DC. XIX.' },
      layers: [{ type: 'composition', year: -360, date_display: 'c. 360 BCE', precision: 'century', author: 'Plato', language: 'Greek' }, { type: 'edition', date_display: '1619' }, { type: 'bogus', year: 1 }] };
    const L = toStoredLayers(r);
    expect(L).toHaveLength(2);
    expect(L[0]).toMatchObject({ type: 'composition', date: '-360', date_precision: 'century', basis: 'model_knowledge', evidence: '' });
    expect(L[1]).toMatchObject({ type: 'edition', date: '1619', basis: 'title_page', evidence: 'Anno M. DC. XIX.' });
  });
  it('builds leaves without the editorial wrappers the OCR model wrote', () => {
    const l = buildLead([{ page_number: 1, text: '<meta>The title page reads Anno 1612.</meta>\nAMSTELODAMI, Apud Joannem Janssonium, 1650, cum privilegio.' }]);
    expect(l).toContain('1650');
    expect(l).not.toContain('1612');
  });
});

describe('reasons for estimated work dates (date-why-1)', () => {
  it('shows the model the stored date it is explaining', () => {
    const p = buildWhyPrompt([{ title: 'Ars medica', author: 'Galen', work: { year: 175, from: 150, to: 200, display: 'c. 150–200' } }]);
    expect(p).toContain('STORED DATE: c. 150–200');
  });
  it('keeps one reason per record, the year only when given, and drops out-of-range or repeated indices', () => {
    const m = parseWhyReply('{"i":1,"why":"Galen, fl. 2nd c. CE; standard dating"}\n{"i":2,"why":"no evidence","y":-300}\n{"i":2,"why":"dup"}\n{"i":9,"why":"x"}\n{"i":3,"why":"  "}', 3);
    expect([...m.keys()]).toEqual([0, 1]);
    expect(m.get(0)).toEqual({ why: 'Galen, fl. 2nd c. CE; standard dating', year: null });
    expect(m.get(1)?.year).toBe(-300);
  });
  it('cuts a runaway reason', () => {
    const m = parseWhyReply(`{"i":1,"why":"${'word '.repeat(60)}"}`, 1);
    expect(m.get(0)!.why.split(' ').length).toBeLessThanOrEqual(24);
  });
});
