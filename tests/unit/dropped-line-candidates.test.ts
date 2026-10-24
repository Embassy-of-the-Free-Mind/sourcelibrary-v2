/**
 * The dropped-line detector (#6326): a line present in one read and absent from the other is flagged with
 * the side that lacks it; spelling differences, a moved line and a retagged line are not; text it cannot
 * tokenise is reported as unjudged, never as clean.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — scripts-side module, no types
import { compareReads, engineOf, gaps, pickPrevious, words } from '../../scripts/audit/dropped-line-candidates.mjs';

const LINES = [
  'Phyſici veteres ſolem cor cæli nominauerunt, Heraclitus luminis fontem dixit.',
  'In ſole mundi animam collocarunt, quæ totum globum implens radios vndique effundit.',
  'Sed redeamus ad priſcos, qui ſolem tanquam regem in medio conſtituerunt planetarum.',
  'Luna vero terræ proxima humores omnes mouet & generationem rerum inferiorum iuuat.',
  'Saturnus autem frigidus et ſiccus contemplationis altiſſimæ auctor a multis habetur.',
  'Iupiter temperatus ac benignus vitam hominum fouet et ciuilem ſocietatem conſeruat.',
  'Mars calidus et ſiccus bella mouet, Venus amorem et concordiam inter mortales ſerit.',
];
const full = LINES.join('\n');
const modern = (t: string) => t.replace(/ſ/g, 's').replace(/æ/g, 'ae').replace(/&/g, 'et').replace(/\bv(?=n)/g, 'u').replace(/iuu/g, 'juv');

describe('dropped-line-candidates', () => {
  it('folds the spellings two engines disagree on', () => {
    expect(words('Phyſici cæli & vndique con-\nſtituerunt')).toEqual(words('Physici caeli et undique constituerunt'));
    expect(words('a&nbsp;b &amp; c &#160; d')).toEqual(['a', 'b', 'et', 'c', 'd']);
    expect(words('<page-num>12</page-num> ->TITVLVS<- <b>textus</b>')).toEqual(['tituluſ'.replace('ſ', 's'), 'textus']);
  });

  it('aligns arrays and reports each gap once', () => {
    expect(gaps(['a', 'b', 'c', 'd'], ['a', 'd'])).toEqual([{ a: 1, an: 2, b: 1, bn: 0 }]);
    expect(gaps(['a', 'b'], ['a', 'b'])).toEqual([]);
    expect(gaps(['a', 'x', 'c'], ['a', 'y', 'c'])).toEqual([{ a: 1, an: 1, b: 1, bn: 1 }]);
  });

  it('flags a line the previous read dropped, and says which read lacks it', () => {
    const lite = modern(LINES.filter((_, i) => i !== 3).join('\n'));
    const r = compareReads(full, lite);
    expect(r.verdict).toBe('flagged');
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0]).toMatchObject({ missing_from: 'previous', kind: 'run' });
    expect(r.runs[0].text).toContain('luna uero terrae proxima');
    expect(compareReads(lite, full).runs[0].missing_from).toBe('current');
  });

  it('does not flag spelling-only differences', () => {
    expect(compareReads(full, modern(full)).verdict).toBe('clean');
  });

  it('does not flag a line the other read holds elsewhere or inside a metadata tag', () => {
    const moved = modern([...LINES.filter((_, i) => i !== 3), LINES[3], LINES[6]].join('\n'));
    expect(compareReads(full, moved).verdict).not.toBe('flagged');
    const retagged = modern(LINES.map((l, i) => (i === 3 ? `<margin>${l}</margin>` : l)).join('\n'));
    const r = compareReads(full, retagged);
    expect(r.verdict).toBe('clean');
    expect(r.runs[0].kind).toBe('elsewhere');
  });

  it('does not flag letter-spaced type read as single letters', () => {
    const spaced = LINES.map((l, i) => (i === 3 ? `${l}\nA D M O N I T I V N C V L A` : l)).join('\n');
    const r = compareReads(spaced, modern(full));
    expect(r.verdict).toBe('clean');
    expect(r.runs[0].kind).toBe('spaced_letters');
  });

  it('sets a missing first or last line aside as an edge, not a dropped line', () => {
    expect(compareReads(full, modern(LINES.slice(0, -1).join('\n'))).verdict).toBe('edge_only');
  });

  it('reports what it cannot judge instead of calling it clean', () => {
    const han = '天地玄黃宇宙洪荒日月盈昃辰宿列張寒來暑往秋收冬藏閏餘成歲律呂調陽'.repeat(4);
    expect(compareReads(han, han.slice(0, 60)).verdict).toBe('unspaced_script');
    expect(compareReads('pauca verba', 'pauca verba').verdict).toBe('too_short');
    expect(compareReads(`<page-num>12</page-num>\n${full}`, `<page-num>13</page-num>\n${full}`).verdict).toBe('leaf_mismatch');
    expect(compareReads(full, [...LINES].reverse().join(' ').replace(/[aeiou]/g, 'x')).verdict).toBe('not_same_text');
  });

  it('pairs only pipeline reads by a different engine', () => {
    const page = { ocr: { model: 'gemini-3-flash-preview', source: 'batch_api' } };
    const lite = { model: 'gemini-3.1-flash-lite', source: 'batch_api', created_at: '2026-10-08' };
    expect(engineOf('gemini-3-flash-preview')).toBe(engineOf('gemini-3-flash'));
    expect(engineOf('ia-ocr/0.0.14')).toBe(engineOf('ia-ocr/0.0.21'));
    expect(pickPrevious(page, [{ ...lite, source: 'loop-guard-refused-2026-09' }]).skip).toBe('revision_not_a_read');
    expect(pickPrevious(page, [lite]).previous).toBe(lite);
    expect(pickPrevious(page, [{ ...lite, model: 'gemini-3-flash' }]).skip).toBe('same_engine');
    expect(pickPrevious(page, [{ ...lite, source: 'shift-repair-erara-2026-07' }]).skip).toBe('revision_not_a_read');
    expect(pickPrevious({ ocr: { ...page.ocr, source: 'volunteer-correction' } }, [lite]).skip).toBe('current_not_a_read');
    expect(pickPrevious(page, []).skip).toBe('single_read');
  });
});
