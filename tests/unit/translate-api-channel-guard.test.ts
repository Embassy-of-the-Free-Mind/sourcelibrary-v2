import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The paid Batch API translates with Flash-Lite only (Derek, 2026-10-08). The OCR route got its
 * refusal in #8525; the translation routes had none, and on 2026-11-06 sent 810 pages to
 * gemini-3-flash-preview. This pins the refusal in both routes, ahead of the Gemini submission.
 */
const ROUTES = [
  'src/app/api/books/[id]/batch-translate-async/route.ts',
  'src/app/api/[tenant]/books/[id]/batch-translate-async/route.ts',
];

describe('batch-translate-async refuses non-Flash-Lite models on the paid API', () => {
  for (const rel of ROUTES) {
    it(rel, () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
      const refusal = src.indexOf('if (model !== API_TRANSLATE_MODEL)');
      const submit = src.search(/batches\.create\(/);
      expect(src).toMatch(/import \{ LITE_MODEL as API_TRANSLATE_MODEL \} from '[./]+scripts\/lib\/ocr-lite-gate\.mjs'/);
      expect(refusal).toBeGreaterThan(0);
      expect(src.slice(refusal, refusal + 400)).toContain('status: 409');
      if (submit > 0) expect(refusal).toBeLessThan(submit);
    });
  }
});
