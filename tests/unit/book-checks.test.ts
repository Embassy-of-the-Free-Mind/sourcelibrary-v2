/**
 * recordBookCheck: one book_checks row per book per QA read (#6174).
 *
 * What these pin: a verdict is never recorded without its instrument (method_id + the registry's version), the pages
 * read, the reader and whether it opened the image, the evidence path, and the text it read (model ids per page, or
 * an explicit reason they are unknown). A refused row throws and writes nothing. A rerun of the same run for the same
 * book is a no-op, not a second row and not an overwrite.
 *
 * No live DB: a spy stands in for Mongo. The registry is the real scripts/eval/methods/, so a version bump there
 * without a matching writer change fails here.
 */
import { describe, it, expect, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { buildBookCheck, recordBookCheck, attachPageFindings, readMethod, provenanceFromPage } from '../../scripts/lib/book-checks.mjs';

const good = () => ({
  book_id: '69f325ae52a77bb28fdb58e9',
  checked_at: '2026-10-07T10:00:00Z',
  method_id: 'shelf-overview',
  method_version: readMethod('shelf-overview').version,
  run_id: 'overview-2026-10-07-eternity2',
  pages_read: [7, 18],
  reader: { kind: 'model', model: 'opus', image_opened: true },
  verdict: 'fix',
  evidence_path: 'scripts/eval/results/spot-check/overview-2026-10-07-eternity2/reviews/korean.json',
  text_provenance: [
    { page_number: 7, ocr_model: 'gemini-3.1-flash-lite', translation_model: 'gemini-3-flash-preview' },
    { page_number: 18, ocr_model: 'source:esukhia-derge-tengyur', translation_model: null, unknown_reason: 'not translated' },
  ],
});

describe('buildBookCheck', () => {
  it('accepts a complete row and stamps recorded_at / recorded_by', () => {
    const row = buildBookCheck(good());
    expect(row.checked_at).toBeInstanceOf(Date);
    expect(row.method_version).toBe(readMethod('shelf-overview').version);
    expect(row.recorded_at).toBeInstanceOf(Date);
    expect(row.recorded_by).not.toContain('/');
  });

  it.each([
    ['method_id', { method_id: undefined }],
    ['method_version', { method_version: undefined }],
    ['run_id', { run_id: undefined }],
    ['pages_read', { pages_read: [] }],
    ['reader', { reader: undefined }],
    ['reader.image_opened', { reader: { kind: 'model', model: 'opus' } }],
    ['reader.model or reader.role', { reader: { kind: 'model', image_opened: true } }],
    ['reader.kind', { reader: { kind: 'robot', model: 'x', image_opened: true } }],
    ['verdict', { verdict: 'do_not_show' }],
    ['evidence_path', { evidence_path: '' }],
    ['text_provenance', { text_provenance: [] }],
  ])('refuses a row missing %s', (what, patch) => {
    expect(() => buildBookCheck({ ...good(), ...patch })).toThrow(new RegExp(what.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('refuses a version the registry does not hold, and an unregistered method', () => {
    expect(() => buildBookCheck({ ...good(), method_version: '999' })).toThrow(/registry version/);
    expect(() => buildBookCheck({ ...good(), method_id: 'vibes-check' })).toThrow(/not in the registry/);
  });

  it('refuses provenance that misses a page read, or a null model id with no reason', () => {
    expect(() => buildBookCheck({ ...good(), pages_read: [7, 18, 30] })).toThrow(/text_provenance for page 30/);
    const tp = good().text_provenance;
    tp[0] = { page_number: 7, ocr_model: null, translation_model: 'gemini-3-flash-preview' };
    expect(() => buildBookCheck({ ...good(), text_provenance: tp })).toThrow(/ocr_model is null without unknown_reason/);
  });

  it("allows image_opened 'unrecorded' — explicit, never a silent default", () => {
    expect(buildBookCheck({ ...good(), reader: { kind: 'model', role: 'earlier session', image_opened: 'unrecorded' } }).reader.image_opened).toBe('unrecorded');
  });
});

describe('recordBookCheck', () => {
  it('inserts into book_checks and nothing else', async () => {
    const insertOne = vi.fn(async () => ({}));
    const collection = vi.fn(() => ({ insertOne }));
    const r = await recordBookCheck({ collection }, good());
    expect(collection).toHaveBeenCalledExactlyOnceWith('book_checks');
    expect(r.inserted).toBe(true);
  });

  it('reports a duplicate run row as not inserted instead of throwing or overwriting', async () => {
    const insertOne = vi.fn(async () => { throw Object.assign(new Error('E11000'), { code: 11000 }); });
    const r = await recordBookCheck({ collection: () => ({ insertOne }) }, good());
    expect(r.inserted).toBe(false);
  });

  it('writes nothing when the row is refused', async () => {
    const insertOne = vi.fn();
    await expect(recordBookCheck({ collection: () => ({ insertOne }) }, { ...good(), verdict: undefined })).rejects.toThrow(/verdict/);
    expect(insertOne).not.toHaveBeenCalled();
  });
});

describe('provenanceFromPage', () => {
  it('labels text no model made as source:<label>, and says why a model id is missing', () => {
    const e = provenanceFromPage({ page_number: 3, id: 'p3', ocr: { source: 'esukhia-derge-tengyur' }, translation: {} }, 'live');
    expect(e.ocr_model).toBe('source:esukhia-derge-tengyur');
    expect(e.translation_model).toBeNull();
    expect(e.unknown_reason).toMatch(/translation\.model/);
  });
});

// page_findings (#6199): what a reader's page-level warning is built from. A finding on a page the check did not read,
// or an entry with nothing serious in it, would put a warning on a page nobody found wrong.
describe('page_findings', () => {
  const finding = { page_number: 7, errors: [{ stage: 'translation', class: 'T8', problem: 'negation dropped' }] };

  it('keeps valid findings on the row, and an empty list (every page read was clean)', () => {
    expect(buildBookCheck({ ...good(), page_findings: [finding] }).page_findings).toEqual([finding]);
    expect(buildBookCheck({ ...good(), page_findings: [] }).page_findings).toEqual([]);
    expect('page_findings' in buildBookCheck(good())).toBe(false);
  });

  it('refuses a finding on a page not read, an entry with nothing serious, and an unknown stage', () => {
    expect(() => buildBookCheck({ ...good(), page_findings: [{ ...finding, page_number: 99 }] })).toThrow(/not in pages_read/);
    expect(() => buildBookCheck({ ...good(), page_findings: [{ page_number: 7, errors: [] }] })).toThrow(/serious error or wrong_page/);
    expect(() => buildBookCheck({ ...good(), page_findings: [{ page_number: 7, errors: [{ stage: 'image' }] }] })).toThrow(/stage/);
    expect(buildBookCheck({ ...good(), page_findings: [{ page_number: 7, wrong_page: true, errors: [] }] }).page_findings).toHaveLength(1);
  });

  it('attachPageFindings only ever fills a row that has none', async () => {
    const updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
    const r = await attachPageFindings({ collection: () => ({ updateOne }) }, { ...good(), page_findings: [finding] });
    expect(r.attached).toBe(true);
    const [filter, update] = updateOne.mock.calls[0] as unknown as [Record<string, unknown>, { $set: Record<string, unknown> }];
    expect(filter.page_findings).toEqual({ $exists: false });
    expect(Object.keys(update.$set).sort()).toEqual(['page_findings', 'page_findings_attached_at', 'page_findings_attached_by']);
    await expect(attachPageFindings({ collection: () => ({ updateOne }) }, { ...good(), page_findings: [{ ...finding, page_number: 99 }] })).rejects.toThrow(/not in pages_read/);
    expect(updateOne).toHaveBeenCalledTimes(1);
  });
});
