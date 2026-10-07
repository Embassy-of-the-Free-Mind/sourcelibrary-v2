import { describe, it, expect } from 'vitest';
import { volumeTexts, openingTitles, fold, matchAuthor, buildAuthorIndex, parseOutline } from '../../scripts/lib/tengyur-catalogue.mjs';

const page = (n: number, data: string, tohoku: string[] = []) => ({ id: `p${n}`, page_number: n, ocr: { data, text_edition: { tohoku } } });

describe('volumeTexts', () => {
  it('ends a text on the page before the next opens at the top, and shares a page when it opens mid-page', () => {
    const t = volumeTexts([
      page(1, '{D1}༄༅། །རྒྱ་གར་སྐད་དུ། ཀ། བོད་སྐད་དུ། ཁ།'),
      page(2, 'text'),
      page(3, '{D2}༄༅། །opening at top'),
      page(4, 'end of D2 །། {D3}༄༅། །mid-page'),
      page(5, 'more'),
    ]);
    expect(t.map((x: any) => [x.toh, x.startPage, x.endPage])).toEqual([['D1', 1, 2], ['D2', 3, 4], ['D3', 4, 5]]);
  });
  it('lists the previous volume\'s last text as continued when the volume opens without a marker', () => {
    const t = volumeTexts([page(1, 'running text'), page(2, '{D9}༄༅། །x')], { carriedToh: 'D8' });
    expect(t[0]).toMatchObject({ toh: 'D8', continued: true, startPage: 1, endPage: 1 });
    expect(t[1]).toMatchObject({ toh: 'D9', startPage: 2 });
  });
  it('does NOT invent a continued text when the volume opens with a marker at the top (negative control)', () => {
    const t = volumeTexts([page(1, '{D9}༄༅། །x')], { carriedToh: 'D8' });
    expect(t.map((x: any) => x.toh)).toEqual(['D9']);
  });
  it('places a text whose marker sits on an unheld title side at the top of the next held page', () => {
    const t = volumeTexts([page(1, '{D1}x'), page(2, 'y'), page(3, '༄༅༅། །རྒྱ་གར་སྐད་དུ།')], { inject: new Map([[3, ['D2']]]) });
    expect(t.map((x: any) => [x.toh, x.startPage, x.endPage])).toEqual([['D1', 1, 2], ['D2', 3, 3]]);
    expect(t[1].opening_side_not_held).toBe(true);
  });
});

describe('openingTitles', () => {
  it('reads the Sanskrit and Tibetan titles the text gives itself', () => {
    expect(openingTitles('{D1416}༄༅༅། །རྒྱ་གར་སྐད་དུ། གུ་ཧྱ་བཛྲ་ཏནྟྲ་རཱ་ཛ་བྲྀཏྟི། བོད་སྐད་དུ། གསང་བ་རྡོ་རྗེའི་རྒྱུད་ཀྱི་རྒྱལ་པོའི་འགྲེལ་པ། དཔལ', 'D1416'))
      .toEqual({ sa_bo: 'གུ་ཧྱ་བཛྲ་ཏནྟྲ་རཱ་ཛ་བྲྀཏྟི', bo: 'གསང་བ་རྡོ་རྗེའི་རྒྱུད་ཀྱི་རྒྱལ་པོའི་འགྲེལ་པ' });
  });
  it('returns nulls where the formula is absent', () => {
    expect(openingTitles('{D2561}༄༅། །འཕགས་པ་འཇམ་དཔལ་ལ་ཕྱག་འཚལ་ལོ།', 'D2561')).toEqual({ sa_bo: null, bo: null });
  });
});

describe('author matching', () => {
  const idx = buildAuthorIndex([
    { _id: 'nagarjuna', canonical_name: 'Nagarjuna', variants: ['Nāgārjuna (ed. P. L. Vaidya)'] },
    { _id: 'a1', canonical_name: 'Same Name' }, { _id: 'a2', canonical_name: 'Same Name' },
    { _id: 'old', canonical_name: 'Merged Person', merged_into: 'x' },
  ]);
  it('matches across diacritics and drops editorial parentheses', () => {
    expect(fold('Nāgārjuna')).toBe('nagarjuna');
    expect(matchAuthor({ iast: 'Nāgārjuna' }, idx).author_id).toBe('nagarjuna');
  });
  it('refuses an ambiguous name and ignores tombstones', () => {
    expect(matchAuthor({ iast: 'Same Name' }, idx).author_id).toBeNull();
    expect(matchAuthor({ iast: 'Merged Person' }, idx).author_id).toBeNull();
  });
});

describe('parseOutline', () => {
  it('keys text parts by their KaTenSiglaD Tohoku id', () => {
    const m = parseOutline({ '@graph': [
      { '@id': 'bdr:MW23703_2199', partType: { '@id': 'bdr:PartTypeText' }, instanceOf: { '@id': 'bdr:WA0RT1042' }, 'bf:identifiedBy': { '@id': 'bdr:ID1' }, contentLocation: { '@id': 'bdr:CL1' }, 'skos:prefLabel': { '@language': 'bo-x-ewts', '@value': 'rdo rje/' } },
      { '@id': 'bdr:ID1', '@type': 'bdr:KaTenSiglaD', 'rdf:value': 'D2199' },
      { '@id': 'bdr:CL1', contentLocationVolume: { '@value': '50' }, contentLocationPage: { '@value': '161' } },
      { '@id': 'bdr:MW23703_S0002', partType: { '@id': 'bdr:PartTypeSection' } },
    ] });
    expect([...m.keys()]).toEqual(['D2199']);
    expect(m.get('D2199')).toMatchObject({ work: 'WA0RT1042', title_ewts: 'rdo rje/', location: { volume: 50, page: 161 } });
  });
});

describe('parseWork', () => {
  it('skips an EWTS string BDRC filed as sa-x-iast (WA23226)', async () => {
    const { parseWork } = await import('../../scripts/lib/tengyur-catalogue.mjs');
    const w = parseWork({ '@graph': [{ '@id': 'bdr:WA23226', 'skos:prefLabel': [{ '@language': 'sa-x-iast', '@value': 'dbu ama rtsa ba shes rab/' }, { '@language': 'sa-x-iast', '@value': 'prajñā-nāma-mūlamadhyamakakārikā' }] }] }, 'WA23226');
    expect(w.iast).toEqual(['prajñā-nāma-mūlamadhyamakakārikā']);
  });
});
