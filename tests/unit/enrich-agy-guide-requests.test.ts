/**
 * #408: the reader's "Request a reading guide" button posts a feedback row; the agy enrichment lane reads those rows
 * and takes the requested books first. The message shape is the contract between the two, so it is pinned against
 * the string Reader2C actually builds.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
// @ts-expect-error — plain .mjs, no types
import { GUIDE_REQUEST_RE, chainCursors } from '../../scripts/workers/lib/enrich-agy-lane.mjs';

describe('reading-guide requests (#408)', () => {
  it('parses the message the reader button sends', () => {
    const src = fs.readFileSync('src/components/reader-v2/Reader2C.tsx', 'utf8');
    expect(src).toContain('message: `Reading guide requested for "${bookTitle}" (book ${bookId})`');
    const msg = (title: string, id: string) => `Reading guide requested for "${title}" (book ${id})`;
    expect(GUIDE_REQUEST_RE.exec(msg('The General Great Art', 'dfb9c1de-d300-4e1b-a9c1-941cdb809764'))?.[1]).toBe('dfb9c1de-d300-4e1b-a9c1-941cdb809764');
    expect(GUIDE_REQUEST_RE.exec(msg('A (b) "c"', '69d5ad0c4dc55b8478ddf60b'))?.[1]).toBe('69d5ad0c4dc55b8478ddf60b');
    expect(GUIDE_REQUEST_RE.exec('please make a guide (book 69d5ad0c4dc55b8478ddf60b)')).toBeNull();
    expect(GUIDE_REQUEST_RE.exec(msg('x', '{$ne:1}'))).toBeNull();
  });

  it('chains cursors in order and gives each book once', async () => {
    const cur = (ids: string[]) => { const q = ids.map(id => ({ id })); return { next: async () => q.shift() ?? null, close: async () => {} }; };
    const c = chainCursors([cur(['b', 'z']), cur(['a', 'b', 'c'])]);
    const out: string[] = [];
    for (let b = await c.next(); b; b = await c.next()) out.push(b.id);
    expect(out).toEqual(['b', 'z', 'a', 'c']);
  });
});
