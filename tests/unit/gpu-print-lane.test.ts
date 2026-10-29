import { describe, it, expect } from 'vitest';
import { convertRead, pageVerdict, hasNoText, isEnglishBook, envelope } from '../../scripts/lib/gpu-print-lane.mjs';

const PAGE = 'It was in the year 1834 that the Society first met in the rooms above the old Exchange, and the minutes record eleven members present.';

describe('gpu-print-lane (#6871)', () => {
  it('converts LightOnOCR markdown to plain text', () => {
    expect(convertRead('---\n\n# CHAPTER IV\n\n**Bold** and $^{12}$ ![fig](a.png)\n<table><tr><td>a</td><td>b</td></tr></table>'))
      .toBe('CHAPTER IV\n\nBold and 12\na | b');
  });
  it('writes an ordinary English page', () => {
    expect(pageVerdict(PAGE)).toMatchObject({ verdict: 'write' });
  });
  it('leaves a blank or plate page unread', () => {
    expect(pageVerdict('PLATE XLII\n\nB\n\nA')).toMatchObject({ verdict: 'textless' });
  });
  it('turns away a page with a non-Latin span (garbled Devanagari / Chinese, judged 2026-10-29)', () => {
    expect(pageVerdict(`${PAGE}\nध्यायेन्नित्यं महेशं`)).toMatchObject({ verdict: 'reject', reason: 'other_script' });
    expect(pageVerdict(`${PAGE} 邢 耿 亳 偃師`)).toMatchObject({ verdict: 'reject', reason: 'other_script' });
  });
  it('keeps a page with a stray Greek letter or two', () => {
    expect(pageVerdict(`${PAGE} the angle α and β.`)).toMatchObject({ verdict: 'write' });
  });
  it('a read cut early for other-script letters (gpu-print-read.py) is the other_script reject, whatever its partial text', () => {
    const v = pageVerdict('ἡ κακὸς ἢ ἀγαθός· Ζεὺς δ’ ἔμπης πάντ’ ἰθύνει· ἡμῖν δ’ αὕτως', { finish: 'abort_other_script' });
    expect(v).toMatchObject({ verdict: 'reject', reason: 'other_script', detail: { early_stop: true } });
    expect(v.detail.letters).toBeGreaterThan(3);
    expect(pageVerdict(PAGE, { finish: 'stop' })).toMatchObject({ verdict: 'write' });
  });
  it('turns away engine commentary about the image', () => {
    expect(pageVerdict(`${PAGE}\n\nNote: The original image contains a decorative brown scroll at the foot.`)).toMatchObject({ verdict: 'reject', reason: 'engine_commentary' });
  });
  it('turns away the pilot\'s appended notes (2026-10-29, by eye)', () => {
    for (const note of ['Note: The images are placeholders since actual image URLs are not provided.',
      'Note: The page number "19" at the bottom left is preserved as it appears in the image.',
      'Note: The text ends abruptly with "and in the Holy Ghost," suggesting the original document may have been cut off.']) {
      expect(pageVerdict(`${PAGE}\n\n${note}`)).toMatchObject({ verdict: 'reject', reason: 'engine_commentary' });
    }
  });
  it('keeps a printed note that is not about the image', () => {
    expect(pageVerdict(`${PAGE}\n\nNote: Mr. Herne was present at the second sitting only.`)).toMatchObject({ verdict: 'write' });
  });
  it('drops empty HTML divs and blockquote marks, unwraps transliteration set in math mode', () => {
    expect(convertRead('<div style="text-align: center;">\n  \n</div>\n\n> “And the Holy Ghost”\n$nṛpas\\ sīdati$')).toBe('“And the Holy Ghost”\nnṛpas sīdati');
  });
  it('turns away a transliteration-dense page (Sanskrit phonetics), keeps a page naming Rāma', () => {
    expect(pageVerdict('agniṣ + dahati = agnir dahati, the fire burns. sādhuṣ + yacchati = sādhur yacchati, the good man gives. ṛṣiṣ + uvāca = ṛṣir uvāca.')).toMatchObject({ verdict: 'reject', reason: 'transliteration_dense' });
    expect(pageVerdict(`${PAGE} So said Rāma to the sage.`)).toMatchObject({ verdict: 'write' });
  });
  it('turns away a read that hit the token cap', () => {
    expect(pageVerdict(PAGE, { finish: 'length' })).toMatchObject({ verdict: 'reject', reason: 'loop_guard:token_cap' });
  });
  it('writes only pages with no text, in English books', () => {
    expect(hasNoText(undefined)).toBe(true);
    expect(hasNoText({ data: '  ' })).toBe(true);
    expect(hasNoText({ data: 'x' })).toBe(false);
    expect(isEnglishBook('English; Latin')).toBe(true);
    expect(isEnglishBook('Latin; English')).toBe(false);
    expect(envelope('body')).toBe('<language>English</language>\n<script>printed</script>\n\nbody');
  });
});
