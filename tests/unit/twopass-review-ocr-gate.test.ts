import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { ocrFirstGate } from '../../scripts/lib/ocr-first-gate.mjs';

// #6865: the review lane of the two-pass translation must stop on a flash-lite transcription, as the read lanes do.
// twopass-review.mjs runs at import (it connects to Mongo), so its wiring is pinned from the source: the gate is
// imported, called on the pages it loaded, and a refusal exits before the first `claude -p` call is made.
const src = fs.readFileSync(new URL('../../scripts/batch/twopass-review.mjs', import.meta.url), 'utf8');

describe('twopass-review.mjs OCR-first gate', () => {
  it('imports the shared gate and passes it --ocr-checked', () => {
    expect(src).toMatch(/import \{ ocrFirstGate \} from '\.\.\/lib\/ocr-first-gate\.mjs'/);
    expect(src).toMatch(/ocrFirstGate\(\[\.\.\.pages\.values\(\)\], arg\('ocr-checked'\)\)/);
  });

  it('exits on a refusal before the review loop starts any call', () => {
    const gateAt = src.indexOf("if (!gate.ok) process.exit(2)");
    const loopAt = src.indexOf('for (;;) {\n  const todo');
    expect(gateAt).toBeGreaterThan(0);
    expect(loopAt).toBeGreaterThan(gateAt);
  });

  it('refuses the lite Florentine shape and passes it once re-OCRed', () => {
    const lite = Array.from({ length: 10 }, () => ({ ocr: { model: 'gemini-3.1-flash-lite-preview' } }));
    const argon = Array.from({ length: 10 }, () => ({ ocr: { model: 'gemini-4-argon-high' } }));
    expect(ocrFirstGate(lite, undefined).ok).toBe(false);
    expect(ocrFirstGate(argon, undefined).ok).toBe(true);
  });
});
