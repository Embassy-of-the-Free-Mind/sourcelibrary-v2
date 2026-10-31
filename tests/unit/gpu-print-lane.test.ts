import { describe, it, expect } from 'vitest';
import { convertRead, pageVerdict, hasNoText, isEnglishBook, envelope, detectScript, isTransientReadError, doneKeys } from '../../scripts/lib/gpu-print-lane.mjs';

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
    expect(pageVerdict(`${PAGE} which is a class of the United States`, { finish: 'abort_loop' })).toMatchObject({ verdict: 'reject', reason: 'loop_guard:early_loop' });
  });
  it('cuts a trailing engine note and writes the read above it (1,346 of the 1,385 commentary rejects, 2026-10-31)', () => {
    // the notes as LightOnOCR wrote them on rejected pages (rejected.jsonl, gex45, 2026-10-31) and in the pilot
    for (const note of ['Note: The original image contains a decorative brown scroll at the foot.',
      'Note: The images are placeholders since actual image URLs are not provided.',
      'Note: The page number "19" at the bottom left is preserved as it appears in the image.',
      'Note: The text ends abruptly with "and in the Holy Ghost," suggesting the original document may have been cut off.',
      'Note: The asterisked footnote is placed at the bottom of the page as per the original document layout. The page number "369" is aligned to the right as in the original.']) {
      const v = pageVerdict(`${PAGE}\n\n${note}`);
      expect(v).toMatchObject({ verdict: 'write', reason: 'ok_notes_stripped', body: PAGE, detail: { stripped_notes: 1 } });
    }
    expect(pageVerdict(`Note: The page number "121" appears in the top right corner of the document and is preserved.\n\n${PAGE}`)).toMatchObject({ verdict: 'write', body: PAGE });
    expect(pageVerdict(`${PAGE}\nNote: The image contains a decorative symbol at the bottom center.\n\nNote: The page number "225" is preserved as per the original.`)).toMatchObject({ verdict: 'write', body: PAGE, detail: { stripped_notes: 2 } });
  });
  it('still rejects a note interleaved with the read', () => {
    expect(pageVerdict(`${PAGE}\nNote: The page number "121" appears in the top right corner and is preserved as part of the document structure.\n${PAGE}`)).toMatchObject({ verdict: 'reject', reason: 'engine_commentary' });
  });
  it('negative control: a page that describes the image instead of reading it still rejects, note or no note', () => {
    // LightOnOCR on an ornament plate (6ab22f6d4ac37d55a2130fc0 p.27, rejected 2026-10-31)
    const described = 'This image depicts an ornate illustration of an altar with three distinct sections. The top section features a draped altar with a cross.\nThe illustration includes decorative elements such as a scroll and a bird, which are positioned on either side of the altar.';
    expect(pageVerdict(described)).toMatchObject({ verdict: 'reject', reason: 'engine_commentary' });
    expect(pageVerdict(`${described}\n\nNote: The image is represented as a placeholder since Markdown does not support image embedding.`)).toMatchObject({ verdict: 'reject', reason: 'engine_commentary' });
    expect(pageVerdict(`The image shows three ornate doors with intricate designs and decorative elements.\n${PAGE}`)).toMatchObject({ verdict: 'reject', reason: 'engine_commentary' });
  });
  it('a page that is only a note is left unread', () => {
    expect(pageVerdict('CHRISTIAN UNITY\nNote: The image contains a central oval photograph of two individuals, one seated and one standing.')).toMatchObject({ verdict: 'textless' });
  });
  it('the remainder after a cut note must pass every other test', () => {
    expect(pageVerdict('agniṣ + dahati = agnir dahati, the fire burns. sādhuṣ + yacchati = sādhur yacchati, the good man gives. ṛṣiṣ + uvāca = ṛṣir uvāca.\nNote: The diacritics are preserved as they appear in the original document.'))
      .toMatchObject({ verdict: 'reject', reason: 'transliteration_dense' });
    expect(pageVerdict(`${PAGE}\nध्यायेन्नित्यं महेशं\nNote: The Devanagari is preserved as it appears.`)).toMatchObject({ verdict: 'reject', reason: 'other_script' });
  });
  it('records the script of an other_script page so a language route can take it', () => {
    expect(pageVerdict(`${PAGE}\nध्यायेन्नित्यं महेशं`).detail).toMatchObject({ script: 'Devanagari' });
    expect(pageVerdict('ἡ κακὸς ἢ ἀγαθός· Ζεὺς δ’ ἔμπης πάντ’ ἰθύνει', { finish: 'abort_other_script' }).detail).toMatchObject({ script: 'Greek', early_stop: true });
    expect(detectScript('ひらがな カタカナ abc')).toMatchObject({ script: 'Japanese', latin: 3 });
    expect(detectScript(PAGE).script).toBe(null);
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
  it('re-reads a page once after a transient fetch error, never after a broken image path', () => {
    // the .err texts gpu-print-read.py wrote (rejected.jsonl, gex45, 2026-10-31)
    expect(isTransientReadError('HTTPError: HTTP Error 403: Forbidden')).toBe(true);
    expect(isTransientReadError('HTTPError: HTTP Error 504: Gateway Time-out')).toBe(true);
    expect(isTransientReadError('HTTPError: HTTP Error 400: Bad Request')).toBe(false);
    expect(isTransientReadError('HTTPError: HTTP Error 404: Not Found')).toBe(false);
    const err = { bid: 'b', pn: 7, reason: 'read_error' };
    expect(doneKeys({ rejected: [err] }).has('b/7')).toBe(true);
    expect(doneKeys({ rejected: [err], requeued: [{ bid: 'b', pn: 7 }] }).has('b/7')).toBe(false);
    expect(doneKeys({ rejected: [err, err], requeued: [{ bid: 'b', pn: 7 }] }).has('b/7')).toBe(true);
    expect(doneKeys({ rejected: [err], requeued: [{ bid: 'b', pn: 7 }], applied: [{ bid: 'b', pn: 7 }] }).has('b/7')).toBe(true);
    expect(doneKeys({ rejected: [{ bid: 'b', pn: 8, reason: 'other_script' }] }).has('b/8')).toBe(true);
  });
});
