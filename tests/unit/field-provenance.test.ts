import { describe, it, expect } from 'vitest';
import { provenanceUpdate, normalizeProvenance, ProvenanceError, isStampContradicted } from '@/lib/field-provenance';
import * as twin from '../../scripts/lib/field-provenance.mjs';

// The bibliographic provenance layer had 81 hand-rolling writers, 164 distinct
// key-shapes, and no shared path tying a VALUE write to a STAMP write. The
// consequence was measurable: 1,124 books asserted `method:'ia_metadata'` over a
// value of "Internet Archive", and the 2026-07-29 harvest replaced 833 values
// while leaving stamps that named a March pass.
//
// These tests pin the guarantees that make that harder, so a future writer
// cannot quietly reintroduce the shape.

describe('provenanceUpdate — required fields', () => {
  it('writes the stamp and an append-only history entry together', () => {
    const u = provenanceUpdate('contributing_library', {
      source: 'ia_metadata_harvest',
      script: 'x.mjs',
      previous_value: 'Internet Archive',
    });
    expect(Object.keys(u.$set)).toEqual(['field_provenance.contributing_library']);
    expect(Object.keys(u.$push)).toEqual(['field_provenance_history.contributing_library']);
    // Both sides must carry the SAME entry — a history that can drift from the
    // current stamp is not a chain of custody.
    expect(u.$push['field_provenance_history.contributing_library']).toEqual(
      u.$set['field_provenance.contributing_library'],
    );
  });

  it('demands previous_value so an overwrite cannot masquerade as a first write', () => {
    // The single most common defect in the existing corpus: only 16.1% of
    // stamps record what they replaced, so most overwrites are unrecoverable.
    expect(() =>
      provenanceUpdate('title', { source: 's' } as never),
    ).toThrow(ProvenanceError);
    // null is fine — it means "there was nothing here", which is a real claim.
    expect(() => provenanceUpdate('title', { source: 's', previous_value: null })).not.toThrow();
  });

  it('demands a non-empty source', () => {
    // 1,901 entries in the corpus have no source at all.
    expect(() => provenanceUpdate('title', { source: '', previous_value: null })).toThrow(ProvenanceError);
    expect(() => provenanceUpdate('title', { source: '   ', previous_value: null })).toThrow(ProvenanceError);
  });

  it('rejects a malformed field name rather than orphaning the stamp', () => {
    for (const bad of ['bad field', '', '$set', 'a b', '1title']) {
      expect(() => provenanceUpdate(bad, { source: 's', previous_value: null }), bad).toThrow(ProvenanceError);
    }
  });

  it('fills a date when omitted and rejects an unparseable one', () => {
    const e = normalizeProvenance({ source: 's', previous_value: null });
    expect(e.date).toBeInstanceOf(Date);
    expect(() => normalizeProvenance({ source: 's', previous_value: null, date: 'not-a-date' })).toThrow(ProvenanceError);
  });

  it('preserves caller-supplied context (the audit trail lives in these keys)', () => {
    const e = normalizeProvenance({
      source: 'ia_metadata_harvest',
      script: 'harvest.mjs',
      method: 'archive.org/metadata contributor',
      ia_identifier: 'operachirurgica00fabr',
      raw_upstream: '<a href="x">Fisher - University of Toronto</a>',
      previous_value: 'Internet Archive',
    } as never);
    // raw_upstream is what makes an HTML-stripped credit auditable back to source.
    expect((e as Record<string, unknown>).raw_upstream).toContain('Fisher');
    expect((e as Record<string, unknown>).ia_identifier).toBe('operachirurgica00fabr');
  });
});

describe('isStampContradicted', () => {
  const isPlaceholder = (v: string) => /^internet archive$|^unknown library$/i.test(v.trim());

  it('flags a stamp claiming upstream metadata over a placeholder value', () => {
    expect(
      isStampContradicted({ source: 'provider_mapping', method: 'ia_metadata' }, 'Internet Archive', isPlaceholder),
    ).toBe(true);
  });

  it('does not flag a real custodian, nor a stamp making no upstream claim', () => {
    expect(
      isStampContradicted({ source: 'provider_mapping', method: 'ia_metadata' }, 'Fisher - University of Toronto', isPlaceholder),
    ).toBe(false);
    // An admin edit claims no upstream method — it may legitimately hold anything.
    expect(isStampContradicted({ source: 'admin_edit' }, 'Internet Archive', isPlaceholder)).toBe(false);
  });
});

describe('PARITY: scripts/lib/field-provenance.mjs vs src/lib/field-provenance.ts', () => {
  // The .mjs sweeps are the heaviest writers of this layer. If the twin drifts,
  // they write a shape the app does not expect.
  it('produces identical updates', () => {
    const input = { source: 'ia_metadata_harvest', script: 'x.mjs', previous_value: 'Internet Archive', date: '2026-07-30T00:00:00.000Z' };
    expect(JSON.stringify(twin.provenanceUpdate('contributing_library', input))).toEqual(
      JSON.stringify(provenanceUpdate('contributing_library', input as never)),
    );
  });

  it('enforces the same rejections', () => {
    for (const bad of [{ source: 's' }, { source: '', previous_value: null }] as never[]) {
      expect(() => twin.provenanceUpdate('title', bad), JSON.stringify(bad)).toThrow();
      expect(() => provenanceUpdate('title', bad), JSON.stringify(bad)).toThrow();
    }
    expect(() => twin.provenanceUpdate('bad field', { source: 's', previous_value: null })).toThrow();
  });
});
