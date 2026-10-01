import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  IMAGE_EXTRACTION_PROMPT,
  RESPONSE_SCHEMA,
  buildImageExtractionBatchRequest,
  buildImageExtractionText,
  parseImageExtractionResponse,
} from '../../scripts/lib/image-extraction-request.mjs';

// The orchestrator's Batch API path kept its own copy of the image-extraction request.
// It drifted (3.2K-char prompt, no responseSchema, 2048 output tokens), the collector
// parsed the answer as a bare array and dropped scan_quality, and pooled books advanced
// before their results (#4747, 2026-09-30). These pin the single request and the parse.

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');

describe('batch request', () => {
  const req = buildImageExtractionBatchRequest({
    text: 'T',
    image: { mimeType: 'image/jpeg', data: 'AAAA' },
  }) as any;

  it('asks for the structured object the worker asks for', () => {
    expect(req.generationConfig.responseMimeType).toBe('application/json');
    expect(req.generationConfig.responseSchema).toBe(RESPONSE_SCHEMA);
    expect(req.generationConfig.maxOutputTokens).toBe(4096);
    expect((RESPONSE_SCHEMA as any).required).toEqual(['scan_quality', 'extracted_images']);
  });

  it('uses REST-valid lowercase schema types', () => {
    expect(JSON.stringify(RESPONSE_SCHEMA)).not.toMatch(/"type":"[A-Z]/);
  });

  it('carries book context, the full prompt and page grounding in one text part', () => {
    const text = buildImageExtractionText({
      book: { title: 'Atalanta fugiens', author: 'Maier' },
      page: { page_number: 5, ocr: { data: '<image-desc type="emblem">A woman suckling the earth</image-desc>' } },
      pagesByNumber: new Map(),
      bookSummary: '',
    });
    expect(text).toContain('Book: "Atalanta fugiens"');
    expect(text).toContain(IMAGE_EXTRACTION_PROMPT);
    expect(text).toContain('A woman suckling the earth');
  });
});

describe('parseImageExtractionResponse', () => {
  it('reads scan_quality and images from the object form', () => {
    const text = JSON.stringify({
      scan_quality: {
        scan_score: 80, scan_class: 'grayscale_print', readable_text: true,
        illustration_fidelity: 'good', page_completeness: 'full_page',
        concerns: ['foxing'], reasoning: 'ok',
      },
      extracted_images: [{ description: 'emblem', type: 'emblem', bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, gallery_quality: 0.9, gallery_rationale: 'r' }],
    });
    const r = parseImageExtractionResponse(text);
    expect(r.scan_quality?.scan_class).toBe('grayscale_print');
    expect(r.extracted_images).toHaveLength(1);
    expect(r.extracted_images[0].type).toBe('emblem');
  });

  it('does not mistake scan_quality.concerns for the image list (old collector bug)', () => {
    const text = JSON.stringify({
      scan_quality: { scan_score: 50, scan_class: 'blank', readable_text: false, page_completeness: 'blank', concerns: ['x'], reasoning: '' },
      extracted_images: [],
    });
    const r = parseImageExtractionResponse(text);
    expect(r.extracted_images).toEqual([]);
    expect(r.scan_quality).not.toBeNull();
  });
});

describe('every image-extraction writer builds from the shared module', () => {
  const orchestrator = read('scripts/workers/pipeline-orchestrator.mjs');
  const worker = read('scripts/workers/image-extract-worker.mjs');
  const collector = read('scripts/workers/batch-collector.mjs');

  it('no inline copy of the prompt survives in the worker or orchestrator', () => {
    for (const src of [orchestrator, worker]) {
      expect(src).not.toMatch(/IMAGE_EXTRACTION_PROMPT\s*=\s*`/);
      expect(src).toContain("from '../lib/image-extraction-request.mjs'");
    }
  });

  it('the collector parses with the shared parser', () => {
    expect(collector).toContain("from '../lib/image-extraction-request.mjs'");
    expect(collector).not.toMatch(/function parseImageExtractionResponse/);
  });

  it('the orchestrator has no small-book path that advances on a skip', () => {
    expect(orchestrator).not.toMatch(/IMAGE_EXTRACTION_INLINE_SIZE|submitImageExtractionBatch\(/);
  });

  it("the orchestrator's image advance counts cross-book jobs by book_ids", () => {
    expect(orchestrator).toMatch(/\$or: \[\{ book_id: book\.id \}, \{ book_ids: book\.id \}\],\s*\n\s*type: 'image_extraction'/);
  });
});
