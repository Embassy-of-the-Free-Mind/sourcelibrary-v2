/**
 * #7060: scripts/lib/revalidate.mjs evicted only /book/<slug|id>, so every metadata
 * fix stayed stale on /la /es /nl /zh. The script cannot import TS, so it carries a
 * copy of PREFIXED_LOCALES; this pins the copy to the source of truth.
 */
import { describe, it, expect } from 'vitest';
import { PREFIXED_LOCALES } from '@/lib/locale-path';
// @ts-expect-error plain .mjs script helper
import { PREFIXED_LOCALES as SCRIPT_LOCALES } from '../../scripts/lib/revalidate.mjs';

describe('scripts/lib/revalidate.mjs locale twins', () => {
  it('lists exactly the prefixed locales of locale-path.ts', () => {
    expect([...SCRIPT_LOCALES].sort()).toEqual([...PREFIXED_LOCALES].sort());
  });
});
