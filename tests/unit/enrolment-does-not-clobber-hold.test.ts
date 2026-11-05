/**
 * Phase 0 enrolment must not overwrite a `pipeline_auto` that appeared after its read.
 *
 * INCIDENT (2026-11-04, #8053). 17,907 hidden Siku Quanshu volumes were imported
 * by ia-manifest-direct.mjs, each held (`holdBook`, `pipeline_auto.hold`) seconds
 * after insert. Five lost the hold: the orchestrator's Phase 0 had read them while
 * they had no `pipeline_auto`, the importer then held them, and Phase 0's write —
 * which replaces the WHOLE `pipeline_auto` object and was filtered on `{ id }`
 * alone — erased the marker. One was routed to OCR (`pipeline_next.step: ocr`)
 * before an audit caught it. Nothing failed loudly: the book simply read as
 * queued.
 *
 * THE RULE. A write that sets `pipeline_auto` as a whole object is a
 * create-if-absent, so its update filter repeats `pipeline_auto: { $exists: false }`
 * — the same condition its candidate query used. Asserted on source text, as in
 * enrolment-is-not-spend-confined.test.ts: the property is which filter guards
 * which call site.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ORCHESTRATOR = path.join(__dirname, '..', '..', 'scripts/workers/pipeline-orchestrator.mjs');

describe('Phase 0 enrolment does not clobber a hold placed after its read', () => {
  const src = readFileSync(ORCHESTRATOR, 'utf8');
  const start = src.indexOf('--- Phase 0: Auto-enroll ---');
  const end = src.indexOf('ARTWORK_TYPES', start);
  const block = src.slice(start, end);

  it('finds the Phase 0 block', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('every whole-object pipeline_auto write is filtered on pipeline_auto absent', () => {
    const writes = [...block.matchAll(/updateOne\(\s*(\{[^}]*\})/g)].map(m => m[1]);
    expect(writes.length, 'expected the window enrol and the convergence tail').toBeGreaterThanOrEqual(2);
    for (const filter of writes) {
      expect(filter, `unguarded enrol filter: ${filter}`).toMatch(/pipeline_auto:\s*\{\s*\$exists:\s*false\s*\}/);
    }
  });
});
