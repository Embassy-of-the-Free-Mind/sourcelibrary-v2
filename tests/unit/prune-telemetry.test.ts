import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('prune-telemetry allowlist', () => {
  it('wall_shadow (#109) is prunable, aged on the field its writer stamps', async () => {
    // @ts-expect-error — untyped .mjs script
    const { ALLOWLIST } = await import('../../scripts/maintenance/prune-telemetry.mjs');
    expect(ALLOWLIST.wall_shadow).toBe('ts');
    // Positive control: the writer really stamps `ts` on the row it inserts.
    // A field the writer never sets would match nothing and prune nothing.
    const src = readFileSync(path.join(__dirname, '../../src/lib/wall-shadow.ts'), 'utf8');
    expect(src).toMatch(/collection\(WALL_SHADOW_COLLECTION\)\.insertOne\(\{\s*ts: new Date\(\)/);
  });

  it('never allowlists a permanent collection', async () => {
    // @ts-expect-error — untyped .mjs script
    const { ALLOWLIST } = await import('../../scripts/maintenance/prune-telemetry.mjs');
    for (const c of ['books', 'pages', 'book_events', 'sweep_log', 'deleted_books']) {
      expect(ALLOWLIST[c], c).toBeUndefined();
    }
  });
});
