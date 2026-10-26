import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
// @ts-expect-error — .mjs lib, no types
import { modelRank, reuseKeptReads } from '../../scripts/lib/kept-read-reuse.mjs';

describe('kept-read reuse before a paid lane (#7075)', () => {
  it('ranks models so only reads at least as good as the lane are reused', () => {
    expect(modelRank('gemini-3.1-flash-lite')).toBe(1);
    expect(modelRank('gemini-3.8-flash-low')).toBe(2);
    expect(modelRank('gemini-3-pro-preview')).toBe(3);
    expect(modelRank('claude-opus-5-5')).toBe(4);
    expect(modelRank('tesseract')).toBe(0);
    expect(modelRank(null)).toBe(0);
    expect(modelRank('gemini-3.8-flash-low')).toBeGreaterThanOrEqual(modelRank('gemini-3.1-flash-lite'));
  });

  it('does nothing when switched off or given no pages, and never touches the db then', async () => {
    const db = { collection: () => { throw new Error('db touched'); } };
    process.env.KEPT_READ_REUSE = 'off';
    expect((await reuseKeptReads(db, { bookId: 'b', field: 'ocr', pageIds: ['p1'] })).applied).toBe(0);
    delete process.env.KEPT_READ_REUSE;
    expect((await reuseKeptReads(db, { bookId: 'b', field: 'ocr', pageIds: [] })).applied).toBe(0);
    expect((await reuseKeptReads(db, { bookId: 'b', field: 'summary', pageIds: ['p1'] })).applied).toBe(0);
  });

  it('never hands back a read of a page whose text was withheld (contained)', async () => {
    let asked: any = null;
    const db = { collection: () => ({ find: (q: any) => { asked = q; return { toArray: async () => [{ id: 'p1' }] }; } }) };
    const r = await reuseKeptReads(db, { bookId: 'b', field: 'translation', pageIds: ['p1'] });
    expect(asked).toMatchObject({ translation_withheld: { $exists: true } });
    expect(r.applied).toBe(0);
    expect(r.considered).toBe(0);
  });

  it('both paid lanes call it before buying, and both readers support --reuse-only', () => {
    const orch = fs.readFileSync('scripts/workers/pipeline-orchestrator.mjs', 'utf8');
    expect(orch.match(/reuseKeptReads\(db, \{ bookId: book\.id, field: 'ocr'/g)?.length).toBe(2);
    expect(fs.readFileSync('scripts/lib/translate-batch-chained.mjs', 'utf8')).toMatch(/field: 'translation'/);
    for (const f of ['scripts/batch/cli-ocr.mjs', 'scripts/batch/cli-translate.mjs']) {
      const s = fs.readFileSync(f, 'utf8');
      expect(s).toMatch(/const REUSE_ONLY = process\.argv\.includes\('--reuse-only'\)/);
      expect(s).toMatch(/if \(REUSE_ONLY\) \{ noKept\+\+;/);
    }
  });
});
