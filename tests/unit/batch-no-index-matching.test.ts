import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Gemini Batch does not keep request order, so matching a response to a page by
// its position (`job.page_ids[idx]`) writes one page's text onto another, across
// books (2026-03-24 contamination; collect-batch-results.mjs kept the fallback
// until #4685). Responses are matched by metadata.key only.
const INDEX_MATCH = /page_ids\s*(\?\.)?\[\s*(idx|i|index|n)\s*\]/;

describe('batch collectors never match a response to a page by position (#4685)', () => {
  it('the pattern catches the old fallback (positive control)', () => {
    expect(INDEX_MATCH.test('const pageId = result.metadata?.key || (job.page_ids && job.page_ids[idx]);')).toBe(true);
  });

  it('no tracked script or src file uses it outside a comment', () => {
    const files = execFileSync('git', ['ls-files', 'scripts', 'src'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').filter((f) => /\.(m?js|ts|tsx)$/.test(f) && !f.includes('/_archived/'));
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (INDEX_MATCH.test(line)) hits.push(`${f}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
