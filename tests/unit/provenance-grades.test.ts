import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gradeField, corroborate, monthOf, GRADES } from '../../scripts/audit/provenance-grades.mjs';

/**
 * The provenance grader (sourcelibrary-v3 #201). Every fixture is a real page subdocument copied
 * from bookstore.pages on 2026-11-13 (text bodies and volunteer account ids redacted), plus the
 * batch_jobs and gemini_usage rows that name them — nothing here is hand-written
 * (.claude/docs/invariants/tests-that-are-not-guards.md).
 */
type Fx = { pages: { _id: string; id: string; book_id: string; field: 'ocr' | 'translation'; sub: Record<string, unknown> | null }[]; batch_jobs: Record<string, unknown>[]; gemini_usage: Record<string, unknown>[] };
const fx: Fx = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/provenance-grades-201.json'), 'utf8'));
const page = (id: string, field: 'ocr' | 'translation') => {
  const p = fx.pages.find((x) => x._id === id && x.field === field);
  if (!p) throw new Error(`fixture ${id} ${field} missing`);
  return p;
};
const grade = (id: string, field: 'ocr' | 'translation') => gradeField(field, page(id, field).sub);

describe('gradeField on real page shapes', () => {
  it.each([
    ['69e7aaf45f1a22ab19a90519', 'ocr', 'recorded', 'BDRC Yigdzin specialist engine block (the 2026-11-05 census counted these as not recorded)'],
    ['6a3c64a739b4508b04e28dc2', 'translation', 'recorded', 'gemini-engine/1 translation'],
    ['69f675653b8d959cfe92dfa7', 'ocr', 'recorded', 'agy CLI engine whose generation slot is a not_recorded marker'],
    ['6953e49577f38f6761beeb01', 'translation', 'recorded', 'same-language copy engine'],
    ['68415b58f49b0bc64f2e1275', 'ocr', 'human', 'source manual, edited_by'],
    ['68415b58f49b0bc64f2e1275', 'translation', 'human', 'source manual, edited_by'],
    ['69b418b72b0edf3eaa2ddbc7', 'ocr', 'recorded_on_page', 'volunteer-correction drafted by the assistant: not a person\'s text'],
    ['69ea0f4613a685002bb8dbe1', 'ocr', 'recorded_on_page', 'batch_api: model + prompt_version + batch_job_id'],
    ['6a4a1f80fd99a02b936ff3c9', 'ocr', 'recorded_on_page', 'ia_djvu: Archive OCR engine version'],
    ['695289c1ab34727b1f04dd75', 'ocr', 'recorded_on_page', 'mineru: engine named as a string'],
    ['6abeb8ee896ea18127c86797', 'ocr', 'imported', 'Esukhia Derge Tengyur'],
    ['6ac0c3eef427c9bb0692e5f6', 'ocr', 'imported', 'Esukhia Derge Kangyur'],
    ['69dfe2f02e48086c70d8a27d', 'translation', 'inferred', 'ai translation, April'],
    ['6a4ae435f16f8258b8ade075', 'ocr', 'inferred', 'ai OCR without code_version, July'],
    ['69dbc7ff1040d1d5e20964e4', 'ocr', 'inferred', 'pipeline_preview without a batch job id'],
    ['69dd5629c762bec37d193f6c', 'ocr', 'not_recorded', 'ai OCR before 2026-06-01: writer ambiguous'],
    ['6993794ab0a84a576396464d', 'translation', 'not_recorded', 'ai translation before the first dated rule'],
    ['69d37ac706d3fb3af895363a', 'ocr', 'not_recorded', 'text with no source'],
    ['69d38442823383edd6e6dd73', 'translation', 'not_recorded', 'system blank-page placeholder'],
  ] as const)('%s %s → %s (%s)', (id, field, want) => {
    expect(grade(id, field)?.grade).toBe(want);
  });

  it('a field with no text gets no row', () => {
    expect(grade('69d5ac824dc55b8478dddc18', 'translation')).toBeNull();
  });

  it('a person\'s text is never graded inferred, even when its source would match a dated rule', () => {
    const sub = { ...page('69dfe2f02e48086c70d8a27d', 'translation').sub, edited_by: 'Unknown' };
    expect(gradeField('translation', sub)?.grade).toBe('human');
  });

  it('the evidence names the rule and the fields it used', () => {
    const inf = grade('6a4ae435f16f8258b8ade075', 'ocr');
    expect(inf?.evidence).toMatchObject({ rule: 'realtime-ocr-script', fields: ['source', 'updated_at'] });
    const rop = grade('69ea0f4613a685002bb8dbe1', 'ocr');
    expect(rop?.evidence).toMatchObject({ rule: 'model+prompt_version+batch_job_id', settings_rule: 'batch-ocr' });
    const nr = grade('69dd5629c762bec37d193f6c', 'ocr');
    expect(String(nr?.evidence.reason)).toMatch(/^ocr-ai-ambiguous/);
    const rec = grade('69f675653b8d959cfe92dfa7', 'ocr');
    expect(rec?.evidence.markers).toContain('ocr.engine.generation');
  });

  it('dropping the engine block demotes a recorded page (the grade reads the block, not the date)', () => {
    const sub = { ...page('6a3c64a739b4508b04e28dc2', 'translation').sub };
    delete sub.engine;
    expect(gradeField('translation', sub)?.grade).not.toBe('recorded');
  });

  it('the month is the month the text was written', () => {
    expect(monthOf(page('69ea0f4613a685002bb8dbe1', 'ocr').sub)).toBe(String(page('69ea0f4613a685002bb8dbe1', 'ocr').sub?.updated_at).slice(0, 7));
    expect(grade('69d37ac706d3fb3af895363a', 'ocr')?.month).toBe('none');
  });

  it('every grade the function returns is one of the listed grades', () => {
    for (const p of fx.pages) { const g = gradeField(p.field, p.sub); if (g) expect(GRADES).toContain(g.grade); }
  });
});

describe('corroborate against the records that name the page or its job', () => {
  const jobsMap = () => { const m = new Map(); for (const j of fx.batch_jobs) for (const k of [j.id, j.job_name, j.gemini_job_name]) if (k) m.set(k, j); return m; };

  it('a gemini_usage row naming the page, same type and model, in the window, corroborates', () => {
    const p = page('6a4ae435f16f8258b8ade075', 'ocr');
    const c = corroborate('ocr', p.sub, [p.id, p._id], { jobs: new Map(), usage: fx.gemini_usage, usageByJob: new Map() });
    expect(c.corroborated).toBe(true);
    expect(c.by?.record).toBe('gemini_usage(mongo)');
  });

  it('the same row does not corroborate the other field, another model, or a write a week later', () => {
    const p = page('6a4ae435f16f8258b8ade075', 'ocr');
    const recs = { jobs: new Map(), usage: fx.gemini_usage, usageByJob: new Map() };
    expect(corroborate('translation', p.sub, [p.id, p._id], recs).corroborated).toBe(false);
    const other = corroborate('ocr', { ...p.sub, model: 'gemini-3.1-flash-lite' }, [p.id, p._id], recs);
    expect(other.corroborated).toBe(false);
    expect(other.contradictions.join(' ')).toMatch(/≠ page model/);
    const later = new Date(+new Date(String(p.sub?.updated_at)) + 7 * 86400e3);
    expect(corroborate('ocr', { ...p.sub, updated_at: later }, [p.id, p._id], recs).corroborated).toBe(false);
  });

  it('a batch_jobs row found by the page\'s batch_job_id corroborates; a page written before the job does not', () => {
    const p = page('69ea0f4613a685002bb8dbe1', 'ocr');
    const recs = { jobs: jobsMap(), usage: [], usageByJob: new Map() };
    const c = corroborate('ocr', p.sub, [p.id, p._id], recs);
    expect(c.corroborated).toBe(true);
    expect(c.by?.record).toBe('batch_jobs');
    const early = corroborate('ocr', { ...p.sub, updated_at: new Date('2026-01-01') }, [p.id, p._id], recs);
    expect(early.corroborated).toBe(false);
    expect(early.contradictions).toContain('page written outside its batch job window');
  });

  it('with no records at all, nothing is corroborated', () => {
    const p = page('69dfe2f02e48086c70d8a27d', 'translation');
    expect(corroborate('translation', p.sub, [p.id, p._id], { jobs: new Map(), usage: [], usageByJob: new Map() }).corroborated).toBe(false);
  });
});
