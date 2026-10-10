/**
 * The Tengyur section note (#6120): the reader's draft line says how good a book's section measured,
 * from src/data/tengyur-section-quality.json. These pin the two ways that copy could go wrong without
 * anyone seeing it — numbers typed into the data file by hand (or left stale after a re-measure), and a
 * book mapped to the wrong section — plus the untrusted correction a reader can send.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import counts from '../../scripts/eval/results/tengyur-characterize-5829/counts.json';
import { READER_UI_STRINGS } from '@/lib/reader-strings';
import { TENGYUR_QUALITY, tengyurSection, tengyurNoteSentences } from '@/lib/tengyur-quality';
import { parsePageReport, pageReportMessage, MAX_CORRECTION_FIELD } from '@/lib/page-report';

const t = READER_UI_STRINGS.en.tengyurNote;

describe('tengyur-section-quality.json', () => {
  it('is exactly what the generator makes from the committed #5829 / #5797 results', () => {
    expect(() =>
      execFileSync('node', ['scripts/eval/tengyur-characterize/build-disclosure.mjs', '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('covers every section the sampler assigned a volume to', () => {
    for (const v of counts.by_volume) expect(TENGYUR_QUALITY.sections).toHaveProperty(v.section);
  });
});

describe('tengyurSection', () => {
  it('reads the section from a Derge Tengyur title', () => {
    expect(tengyurSection({ title: 'བསྟན་འགྱུར། སྡེ་དགེ། ཚད་མ། ཅེ (Derge Tengyur, vol. 174)' })).toBe('Pramāṇa');
    expect(tengyurSection({ title: 'བསྟན་འགྱུར། སྡེ་དགེ། འདུལ་བ། ལུ (Derge Tengyur, vol. 165)' })).toBe('Vinaya');
  });

  it('ignores the Kangyur, whose Vinaya has the same section word', () => {
    expect(tengyurSection({ title: 'བཀའ་འགྱུར། སྡེ་དགེ། འདུལ་བ། ཀ (Derge Kangyur, vol. 1)' })).toBeNull();
    expect(tengyurSection({ title: 'De occulta philosophia' })).toBeNull();
    expect(tengyurSection(null)).toBeNull();
  });
});

describe('tengyurNoteSentences', () => {
  it('gives a rated section its own figures and names what goes wrong', () => {
    const q = TENGYUR_QUALITY.sections['Pramāṇa'];
    const s = tengyurNoteSentences({ title: 'བསྟན་འགྱུར། སྡེ་དགེ། ཚད་མ། ཅེ' }, t, 'en')!;
    expect(s).toHaveLength(2);
    expect(s[0]).toContain(`${q.n} random Pramāṇa pages`);
    expect(s[0]).toContain(`${Math.round(q.light!)}% needed only light edits`);
    expect(s[1]).toContain(`${Math.round(q.rev_agent_per100!)} statements per 100 pages`);
  });

  it('gives no rate for a section below the threshold', () => {
    const small = Object.entries(TENGYUR_QUALITY.sections).find(([, q]) => q.n > 0 && q.n < TENGYUR_QUALITY.min_pages);
    expect(small).toBeTruthy();
    const word = Object.entries(TENGYUR_QUALITY.section_words).find(([, sec]) => sec === small![0])![0];
    const s = tengyurNoteSentences({ title: `བསྟན་འགྱུར། སྡེ་དགེ། ${word}། ཀ` }, t, 'en')!;
    expect(s.join(' ')).toContain("too few pages reviewed for a section figure");
  });
});

describe('translation_error page report', () => {
  const base = { book_id: 'abc123', page_id: 'p1', page_number: 40 };

  it('keeps the passage, the correction and the original, capped', () => {
    const r = parsePageReport({
      ...base,
      kind: 'translation_error',
      correction: { passage: ' he holds ', correction: 'the opponent holds', source_text: 'x'.repeat(MAX_CORRECTION_FIELD + 50) },
    })!;
    expect(r.correction).toEqual({ passage: 'he holds', correction: 'the opponent holds', source_text: 'x'.repeat(MAX_CORRECTION_FIELD) });
    const msg = pageReportMessage(r, '');
    expect(msg).toContain('Reads now: he holds');
    expect(msg).toContain('Should say: the opponent holds');
  });

  it('drops a correction riding on any other kind', () => {
    const r = parsePageReport({ ...base, kind: 'wrong_image', correction: { correction: 'anything' } })!;
    expect(r.correction).toBeUndefined();
  });
});
