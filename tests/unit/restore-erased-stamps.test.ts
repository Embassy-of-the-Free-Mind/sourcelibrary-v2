import { describe, it, expect } from 'vitest';
import {
  planBook,
  buildRestoreUpdate,
  stampedValue,
  cleanIaContributor,
  RUN,
} from '../../scripts/maintenance/restore-erased-stamps-8024.mjs';

// #8024. A cover write replaced the whole field_provenance map (fixed in v2#8025); the history kept every entry.
// These pin the one rule of the restore: a stamp goes back only when we know the value it stamped AND the book
// still holds that value. Shapes are copied from production history entries (2026-11-13).

const recon = (prev: string) => ({
  source: 'source_catalogue', script: 'scripts/maintenance/reconstruct-title-provenance-7673.mjs',
  method: 'reconstructed_match', match: 'exact', reconstructed: true, date: '2026-10-29T00:37:50.304Z', previous_value: prev,
});
const agyDisplay = { source: 'ai_generated', method: 'agy_title_translation', script: 'scripts/maintenance/fill-display-title-agy-4390.mjs', run: 'display-title-agy-4390-20261028b', sweep: 'display-title-agy-4390', previous_value: null, date: '2026-10-28T13:01:51.441Z' };
const thumb = { thumbnail: { source: 'pipeline', method: 'ensure-cover-scored', date: '2026-11-02T06:40:14.201Z' } };

describe('restore-erased-stamps-8024 planner', () => {
  it('restores a reconstructed stamp when the value is unchanged', () => {
    const book = { _id: 'x', id: 'x', title: 'Poème philosophic', field_provenance: thumb, field_provenance_history: { title: [recon('Poème philosophic')] } };
    const plan = planBook(book, { prov: [], sweeps: [] });
    expect(plan).toMatchObject([{ field: 'title', status: 'restorable', via: 'reconstructed' }]);
    const u = buildRestoreUpdate(book, plan)!;
    expect(u.filter).toEqual({ _id: 'x', 'field_provenance.title': { $exists: false }, title: 'Poème philosophic' });
    expect(u.update.$set['field_provenance.title']).toMatchObject({ ...recon('Poème philosophic'), restored_from_history: { run: RUN } });
    expect(u.update).not.toHaveProperty('$push');
  });

  it('reports, never restores, a stamp whose value has since changed', () => {
    const book = { _id: 'x', title: 'Edited later', field_provenance: thumb, field_provenance_history: { title: [recon('Poème philosophic')] } };
    const plan = planBook(book, { prov: [], sweeps: [] });
    expect(plan[0].status).toBe('value_changed');
    expect(buildRestoreUpdate(book, plan)).toBeNull();
  });

  it('leaves a field alone when it still carries a stamp', () => {
    const book = { _id: 'x', title: 'T', field_provenance: { ...thumb, title: { source: 'other' } }, field_provenance_history: { title: [recon('T')] } };
    expect(planBook(book, { prov: [], sweeps: [] })).toEqual([]);
  });

  it('takes a written value from the sweep_log row of the same run, near in time', () => {
    const sweeps = [{ book_id: 'x', sweep: 'display-title-agy-4390', timestamp: '2026-10-28T13:01:52Z', detail: { value: 'Philosophical poem' } }];
    expect(stampedValue(agyDisplay, 'display_title', { prov: [], sweeps })).toEqual({ value: 'Philosophical poem', via: 'sweep_log.detail.value' });
    // A row from a different run, or days away, vouches for nothing.
    expect(stampedValue(agyDisplay, 'display_title', { prov: [], sweeps: [{ ...sweeps[0], sweep: 'other' }] })).toBeUndefined();
    expect(stampedValue(agyDisplay, 'display_title', { prov: [], sweeps: [{ ...sweeps[0], timestamp: '2026-10-31T00:00:00Z' }] })).toBeUndefined();
  });

  it('matches an entry with no run to a sweep row from the same script', () => {
    const entry = { source: 'published_era', script: 'scripts/maintenance/fix-era-year.mjs', date: '2026-10-20T10:00:00Z', previous_value: -1500 };
    const sweeps = [{ book_id: 'x', sweep: 'era-year-6866', script: 'fix-era-year.mjs', timestamp: '2026-10-20T10:00:01Z', detail: { from: -1500, to: 1500 } }];
    expect(stampedValue(entry, 'year', { prov: [], sweeps })).toEqual({ value: 1500, via: 'sweep_log.detail.to (by script)' });
  });

  it('reads contributing_library from image_source and the harvest raw_upstream', () => {
    const entry = { source: 'ia_metadata_harvest', script: 'scripts/maintenance/harvest-holding-libraries.mjs', raw_upstream: '<a href="x">Wellcome Library</a>', previous_value: 'Internet Archive', date: '2026-07-30T16:38:43Z' };
    const book = { _id: 'x', image_source: { contributing_library: 'Wellcome Collection' }, field_provenance: thumb, field_provenance_history: { contributing_library: [entry] } };
    expect(cleanIaContributor(entry.raw_upstream)).toBe('Wellcome Library');
    expect(planBook(book, { prov: [], sweeps: [] })[0]).toMatchObject({ status: 'value_changed', stamped: 'Wellcome Library', current: 'Wellcome Collection' });
    const kept = { ...book, image_source: { contributing_library: 'Wellcome Library' } };
    const u = buildRestoreUpdate(kept, planBook(kept, { prov: [], sweeps: [] }))!;
    expect(u.filter['image_source.contributing_library']).toBe('Wellcome Library');
  });

  it('reports a stamp with no record of its value (chapters)', () => {
    const entry = { source: 'agy-enrich-7628', script: 'scripts/workers/lib/enrich-agy-lane.mjs', run: 'r1', previous_value: { count: 3 }, date: '2026-11-01T00:00:00Z' };
    const book = { _id: 'x', chapters: [{ title: 'a' }], field_provenance: thumb, field_provenance_history: { chapters: [entry] } };
    expect(planBook(book, { prov: [], sweeps: [] })[0].status).toBe('no_value_record');
  });
});
