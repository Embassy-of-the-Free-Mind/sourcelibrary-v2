/**
 * Phase 1.5 preview OCR runs through the Batch API, and must stay a *preview*.
 *
 * Moved off inline realtime 2026-08-30. Batch is half the token price for
 * identical output and is not slower here — measured over the 2026-08-27..30
 * window, batch jobs completed p50 0.2h / p90 0.4h.
 *
 * Three properties are load-bearing, and each fails silently rather than
 * loudly, which is why they are pinned:
 *
 * 1. A preview must NOT advance `pipeline_auto.status`. The cross-book pooler's
 *    default is to flip books to `ocr_submitted`; the collector then transitions
 *    `ocr_submitted -> ocr_complete` once no OCR batches are outstanding. A
 *    25-page sample would therefore be recorded as a finished OCR pass and the
 *    book's remaining pages would never be transcribed. The book reads as
 *    "done" — nothing errors.
 *
 * 2. A preview must cap pages per book. The pooler otherwise lets one book take
 *    the whole 250-page pool, which is not a preview and starves every other
 *    candidate in the run.
 *
 * 3. The collector must honour the submitter's `ocr_source`. Both previews and
 *    full passes now arrive through the Batch API, so a hardcoded `batch_api`
 *    would erase the `pipeline_preview` provenance label that the measurement
 *    stack segments on (.claude/docs/data-provenance.md — "always segment by
 *    source before quoting a number").
 *
 * Source-level assertions: the orchestrator is a single ~5.5k-line .mjs whose
 * every path wants Mongo, Gemini keys and the File API. What is checked here is
 * how the phase CALLS the pooler, which is visible without any of that.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const orch = readFileSync(path.join(root, 'scripts/workers/pipeline-orchestrator.mjs'), 'utf8');
const collector = readFileSync(path.join(root, 'scripts/workers/batch-collector.mjs'), 'utf8');

/** The single `submitCrossBookOcrBatches(...)` call inside Phase 1.5. */
function phase15Call(): string {
  const phase = orch.slice(orch.indexOf('Phase 1.5: Preview OCR'));
  // Delimit on the section HEADER, not a bare "Phase 1.6" — the phase's own
  // prose mentions the next phase by name, which truncated this to nothing.
  const end = phase.indexOf('── Phase 1.6:');
  expect(end, 'could not delimit Phase 1.5').toBeGreaterThan(0);
  const body = phase.slice(0, end);
  const call = body.match(/submitCrossBookOcrBatches\(db,[\s\S]*?\}\);/);
  expect(call, 'Phase 1.5 no longer calls submitCrossBookOcrBatches').not.toBeNull();
  return call![0];
}

describe('Phase 1.5 preview OCR submits a batch', () => {
  it('goes through the cross-book pooler rather than inline generateContent', () => {
    const call = phase15Call();
    expect(call).toContain('submitCrossBookOcrBatches');
  });

  it('does not advance pipeline status', () => {
    expect(phase15Call()).toMatch(/advanceStatus:\s*false/);
  });

  it('caps pages per book to the preview count', () => {
    expect(phase15Call()).toMatch(/maxPagesPerBook:\s*PREVIEW_PAGE_COUNT/);
  });

  it('keeps the pipeline_preview provenance label', () => {
    expect(phase15Call()).toMatch(/ocrSource:\s*'pipeline_preview'/);
  });
});

describe('preview honours the script routing rule', () => {
  it('partitions candidates by getOcrModelForBook before pooling', () => {
    // A batch job carries ONE model. Pooling mixed scripts under the pooler's
    // flash-lite default would send Chinese/Sanskrit/Tibetan books to the model
    // that invents plausible text on low-resource scripts rather than failing.
    // Measured 2026-08-30: the preview queue's 17,717 candidates are headed by
    // Chinese, so this is the common case, not an edge one.
    const phase = orch.slice(orch.indexOf('Phase 1.5: Preview OCR'));
    const body = phase.slice(0, phase.indexOf('── Phase 1.6:'));
    expect(body).toContain('getOcrModelForBook');
    expect(body).toMatch(/model,/);
  });

  it('carries image_source.provider so the BPH branch can fire', () => {
    // getOcrModelForBook reads book.image_source.provider first; a projection
    // that omits it silently downgrades every BPH book to the language branch.
    const phase = orch.slice(orch.indexOf('Phase 1.5: Preview OCR'));
    const body = phase.slice(0, phase.indexOf('── Phase 1.6:'));
    expect(body).toContain("'image_source.provider': 1");
  });
});

describe('the pooler honours those options', () => {
  it('accepts them, defaulting to the full-pass behaviour', () => {
    const fn = orch.slice(orch.indexOf('async function submitCrossBookOcrBatches'));
    const head = fn.slice(0, 900);
    expect(head).toMatch(/maxPagesPerBook\s*=\s*null/);
    expect(head).toMatch(/advanceStatus\s*=\s*true/);
    expect(head).toMatch(/ocrSource\s*=\s*null/);
    expect(head).toMatch(/model\s*=\s*OCR_MODEL_LITE/);
  });

  it('only sets pipeline_auto.status when advanceStatus is on', () => {
    // The status write must be conditional, not unconditional — this is the
    // exact line that would turn a preview into a false "OCR complete".
    expect(orch).toMatch(/advanceStatus\s*\?\s*\{\s*'pipeline_auto\.status':\s*'ocr_submitted'\s*\}/);
  });
});

describe('the collector reads the submitter label', () => {
  it('does not hardcode batch_api', () => {
    expect(collector).toContain("'ocr.source': job.ocr_source || 'batch_api'");
  });

  it('still applies the blank-page guard on the batch write path', () => {
    // Moving preview off the inline path removed its own guard call; the
    // protection has to exist here or previews lose it entirely (#4149).
    expect(collector).toContain('shouldRefuseOcrWrite');
  });
});
