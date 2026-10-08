import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// #6175: embed-gemini.mjs had its own composer that prepended the page's AI `translation_summary`
// and keywords. The row's `translation` column is the composed text, so the AI description was
// stored as the page's quotable snippet (58 of 148 summary-bearing pages sampled) — the #2232
// misquote class. The worker runs on import, so this pins the source: the composer goes through
// the shared pageEmbeddingInput and the worker does not even read the summary fields.
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts/workers/embed-gemini.mjs'), 'utf8');

describe('embed-gemini composes page text through the shared composer', () => {
  const body = src.slice(src.indexOf('function composeEmbedText('), src.indexOf('// Book metadata cache'));
  it('calls pageEmbeddingInput', () => {
    expect(body).toContain('pageEmbeddingInput(page)');
  });
  it('never reads the AI summary or keywords', () => {
    expect(src).not.toMatch(/translation_summary\s*:\s*1|translation_keywords\s*:\s*1|page\.translation_summary|page\.translation_keywords/);
  });
});
