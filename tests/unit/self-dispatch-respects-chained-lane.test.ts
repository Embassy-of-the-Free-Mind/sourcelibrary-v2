/**
 * translate-worker's selfDispatch() is the second dispatcher of realtime translation (#4681). When
 * Phase 4 routes books below the realtime priority floor to the chained Batch lane, selfDispatch
 * must take reader requests only, or it claims the same backlog realtime at 4× the price
 * (2 books at 22:36Z on 2026-09-30). The worker runs main() on import, so this pins the source.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(__dirname, '../../scripts/workers/translate-worker.mjs'), 'utf8');
const body = src.slice(src.indexOf('async function selfDispatch('), src.indexOf('const dispatched = [];', src.indexOf('async function selfDispatch(')));

describe('selfDispatch leaves the chained lane its books', () => {
  it('builds a lane filter from phase4Lane and REALTIME_PRIORITY_FLOOR', () => {
    expect(src).toMatch(/import \{ phase4Lane, REALTIME_PRIORITY_FLOOR \} from '\.\.\/lib\/translate-batch-chained\.mjs'/);
    expect(body).toMatch(/phase4Lane\(\{ processing_priority: 0 \}\) === 'chained'\s*\n\s*\? \{ processing_priority: \{ \$gte: REALTIME_PRIORITY_FLOOR \} \}/);
  });
  it('applies it to both candidate queries (fresh ocr_complete and translate_partial)', () => {
    expect(body.match(/\.\.\.LANE_FILTER,/g)?.length).toBe(2);
  });
});
