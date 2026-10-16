import { describe, it, expect } from 'vitest';
import { parseAnswer, splitAnswers, correctInstruction } from '../../scripts/batch/ocr-convergence/correct.mjs';

// #6694 arm B: Opus corrects the stored text in place. Only a full transcription can become a write; UNCHANGED and
// CONTAIN never carry text, and a reply whose markers do not match is no answer for every page in it.
describe('ocr-convergence correct.mjs', () => {
  const page = '<language>Latin</language>\n<page-type>text</page-type>\nIn principio erat verbum, et verbum erat apud Deum.';

  it('reads the three kinds of answer', () => {
    expect(parseAnswer('UNCHANGED')).toEqual({ outcome: 'unchanged' });
    expect(parseAnswer('CONTAIN: the draft is the text of the facing page')).toEqual({ outcome: 'contain', reason: 'the draft is the text of the facing page' });
    expect(parseAnswer(page)).toEqual({ outcome: 'corrected', text: page });
  });

  it('an empty answer, or a correction without the transcription header, is no answer', () => {
    expect(parseAnswer('').outcome).toBe('no-answer');
    expect(parseAnswer('In principio erat verbum, et verbum erat apud Deum.').outcome).toBe('no-answer');
  });

  it('a long CONTAIN that is really a transcription is not taken as a containment', () => {
    expect(parseAnswer(`CONTAIN: ${page}`).outcome).not.toBe('contain');
  });

  it('drops a short lead-in before the first marker, and refuses a long one or a missing page', () => {
    const body = '===== PAGE p01 =====\nUNCHANGED\n===== PAGE p02 =====\n' + page;
    expect(splitAnswers(`Corrections follow.\n\n${body}`, 2)).toEqual({ answers: ['UNCHANGED', page], preamble: 'Corrections follow.' });
    expect(splitAnswers(`${'x'.repeat(400)}\n${body}`, 2).answers).toBeNull();
    expect(splitAnswers(`<page-type>text</page-type>\n${body}`, 2).answers).toBeNull();
    expect(splitAnswers(body, 3).answers).toBeNull();
  });

  it('names every image and draft in the call', () => {
    const t = correctInstruction(3);
    for (const f of ['p01.jpg', 'd01.txt', 'p03.jpg', 'd03.txt']) expect(t).toContain(f);
    expect(t).toMatch(/UNCHANGED/);
    expect(t).toMatch(/CONTAIN/);
  });
});
