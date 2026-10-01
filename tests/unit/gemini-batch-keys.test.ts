/**
 * Phase 2 OCR throughput (#5544). Pass 2 stopped after 1–3 books per run, and
 * the limit was our own accounting, not Google's:
 *   - two env keys in one GCP project were counted as two projects;
 *   - an upload 429 on the File API storage quota set that key's load to the
 *     cap, and that fake load counted toward the global total;
 *   - one book per job meant a 2-page remainder used up a whole job slot.
 * The pure accounting is tested directly. The orchestrator wiring is checked
 * at source level, because the orchestrator cannot be imported without Mongo,
 * Gemini keys and the File API (same approach as preview-ocr-batch.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  projectCanonicals, projectTotal, projectMembers, keysWithRoom, isFileQuotaError,
} from '../../scripts/lib/gemini-batch-keys.mjs';

// The 2026-10-01 shape: keys 1/4 and 2/3 are one project each.
const FP = ['a', 'b', 'c', 'c', 'b'];

describe('projectCanonicals', () => {
  it('maps alias keys to the first key of their project', () => {
    expect(projectCanonicals(FP)).toEqual([0, 1, 2, 2, 1]);
  });
  it('never merges keys on an empty fingerprint', () => {
    expect(projectCanonicals([null, null, '', undefined])).toEqual([0, 1, 2, 3]);
  });
});

describe('projectTotal', () => {
  it('counts each project once', () => {
    // perKey as logged: [46, 0, 2, 2, 0] — three projects, 48 jobs, not 50.
    expect(projectTotal([46, 0, 2, 2, 0], projectCanonicals(FP))).toBe(48);
  });
});

describe('projectMembers', () => {
  it('returns every key sharing the project', () => {
    expect(projectMembers(4, projectCanonicals(FP))).toEqual([1, 4]);
    expect(projectMembers(0, projectCanonicals(FP))).toEqual([0]);
  });
});

describe('keysWithRoom', () => {
  const canonicals = projectCanonicals(FP);
  it('offers canonical keys only, least loaded first', () => {
    expect(keysWithRoom([46, 0, 2, 2, 0], { canonicals, cap: 80 })).toEqual([1, 2, 0]);
  });
  it('drops keys at the cap and excluded keys', () => {
    expect(keysWithRoom([80, 0, 2, 2, 0], { canonicals, cap: 80, excluded: new Set([1, 4]) })).toEqual([2]);
  });
  it('returns nothing when every project is full', () => {
    expect(keysWithRoom([80, 80, 80, 80, 80], { canonicals, cap: 80 })).toEqual([]);
  });
});

describe('isFileQuotaError', () => {
  it('recognises the File API storage 429', () => {
    expect(isFileQuotaError('{"error":{"code":429,"message":"Quota exceeded for metric: generativelanguage.googleapis.com/file_storage_bytes, limit: 21474836480","status":"RESOURCE_EXHAUSTED"}}')).toBe(true);
  });
  it('does not treat other failures as quota', () => {
    expect(isFileQuotaError('fetch failed: ECONNRESET')).toBe(false);
  });
});

const orch = readFileSync(path.join(__dirname, '..', '..', 'scripts/workers/pipeline-orchestrator.mjs'), 'utf8');

describe('orchestrator key accounting (#5544)', () => {
  it('never turns a File API upload 429 into fake load', () => {
    // Every upload catch marks the project upload-full; none writes the cap into _geminiKeyLoads.
    expect(orch.match(/markUploadFull\(uki\)/g)?.length).toBe(3);
    expect(orch).not.toMatch(/_geminiKeyLoads\[uki\]\s*=\s*MAX_ACTIVE_PER_KEY/);
  });
  it('file-based submitters pick keys through uploadKeyOrder()', () => {
    expect(orch.match(/for \(const uki of uploadKeyOrder\(\)\)/g)?.length).toBe(3);
  });
  it('the global cap is summed over projects, not keys', () => {
    const fn = orch.slice(orch.indexOf('async function canSubmitMore'), orch.indexOf('// getPageImageUrl is imported'));
    expect(fn).toContain('projectTotal(_geminiKeyLoads, _keyCanonicals)');
  });
});

describe('Phase 2 Pass 2 packs whole books (#5544)', () => {
  const pass2 = orch.slice(orch.indexOf('// Pack Pass 2 (#5544)'), orch.indexOf('// ── Phase 3: Check OCR completion'));

  it('calls the cross-book pooler with whole books and no direct status write', () => {
    const call = pass2.match(/submitCrossBookOcrBatches\(db, queue, \{[\s\S]*?\}\);/);
    expect(call).not.toBeNull();
    expect(call![0]).toMatch(/wholeBooksOnly:\s*true/);
    expect(call![0]).toMatch(/advanceStatus:\s*false/);
    expect(call![0]).toMatch(/model:\s*m\b/);
  });

  it('writes ocr_submitted through setPipelineStatus, as the per-book path does', () => {
    expect(pass2).toMatch(/setPipelineStatus\(db, id, 'ocr_submitted', \{ ocr_job_name: r\.jobName, retry_count: 0 \}\)/);
  });

  it('keeps spread books and RECITATION retries on the per-book path', () => {
    expect(pass2).toMatch(/!b\.needs_splitting/);
    expect(pass2).toMatch(/recitation_retry !== true/);
    expect(pass2).toMatch(/recitation_retry_lite !== true/);
  });

  it('the pooler refuses to cut a book at the pool edge', () => {
    const fn = orch.slice(orch.indexOf('async function submitCrossBookOcrBatches'), orch.indexOf('Submit image extraction via Gemini Batch API'));
    expect(fn).toMatch(/if \(wholeBooksOnly && pages\.length > poolRoom\)/);
  });

  it('per-book duplicate guard sees books packed into a cross-book job (#5498)', () => {
    const fn = orch.slice(orch.indexOf('async function submitOcrDirectly'), orch.indexOf('// Generation guard (#2449): stamp'));
    expect(fn).toMatch(/\$or: \[\{ book_id: book\.id \}, \{ book_ids: book\.id \}\]/);
  });
});
