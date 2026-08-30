/**
 * An import route must not enqueue paid AI work.
 *
 * INCIDENT (2026-08-27..30). Every import route called `queuePreviewOcr`, which
 * queued 25 pages of OCR onto the SQS/Lambda realtime path. That path consults
 * neither `system_config.processing_control.paused` nor the daily dial, so it
 * kept spending straight through a pause whose stated reason was "Derek: pause
 * Gemini spend until prioritized". Four days of an acquisition push — 5,504
 * books — billed ~$392 across 114,344 calls, on books the paused pipeline never
 * archived, enrolled, or published. 866 more jobs were still queued, the oldest
 * from 2026-07-05.
 *
 * The defect was visible three weeks earlier at 1/143 the scale: a 2026-08-08
 * handoff recorded "Preview OCR is not free... ~1,000 pages, ~$2.73 computed"
 * and moved on, because at forty books it did not look like a leak. Scale is
 * what turned a rounding error into the month's biggest line.
 *
 * THE RULE. Importing a book is a metadata-and-pages operation; it must cost
 * nothing. Anything that spends belongs behind the orchestrator, which is
 * dial-gated and pause-aware. A pause that some paths honour and others ignore
 * is not a pause — it is a suggestion, and the ungated path is the one that
 * runs during the incident the pause was declared for.
 *
 * This asserts on source text because the property is structural: which modules
 * an import route may reach. Executing the routes would need Mongo, SQS and a
 * live Gemini key, and would prove less.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const importDir = path.join(root, 'src/app/api/import');

/** Modules that enqueue or perform paid AI work. */
const SPEND_MARKERS = [
  'queuePreviewOcr',
  'queuePreviewTranslation',
  'preview-ocr',
  'preview-translate',
  'enqueuePagesForJob',
  'performOCRWithBuffer',
];

function routeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === 'route.ts') out.push(full);
    }
  };
  walk(importDir);
  return out;
}

describe('import routes spend nothing', () => {
  const files = routeFiles();

  it('finds the import routes it means to guard', () => {
    // Guard the guard: a rename that empties this list must fail loudly rather
    // than silently pass over nothing.
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files.map((f) => [path.relative(root, f), f]))(
    '%s enqueues no paid AI work',
    (_rel, full) => {
      const src = readFileSync(full, 'utf8');
      for (const marker of SPEND_MARKERS) {
        expect(src, `${_rel} reaches for ${marker}`).not.toContain(marker);
      }
    },
  );

  it('the shared import helper spends nothing either', () => {
    const src = readFileSync(path.join(root, 'src/lib/import-utils.ts'), 'utf8');
    for (const marker of SPEND_MARKERS) {
      expect(src, `import-utils.ts reaches for ${marker}`).not.toContain(marker);
    }
  });

  it('the removed preview modules stay removed', () => {
    // They were deleted rather than gated: their whole purpose was to beat the
    // pipeline, and the pipeline is where the spend controls live.
    expect(existsSync(path.join(root, 'src/lib/preview-ocr.ts'))).toBe(false);
    expect(existsSync(path.join(root, 'src/lib/preview-translate.ts'))).toBe(false);
  });
});
