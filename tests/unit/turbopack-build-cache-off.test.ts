/**
 * Turbopack's build cache must stay OFF (#5887).
 *
 * With it on, the cache grows inside Vercel's build cache until it passes the
 * 1.5 GB limit; Vercel then discards it and the cold compile that follows is
 * SIGKILLed on the 8 GB builder about half the time. Off, a cold compile peaks
 * ~25% lower and nothing accumulates. See the comment in next.config.ts.
 *
 * Two ways this silently comes back, one test each:
 *  - someone deletes or flips the line in next.config.ts;
 *  - a Next.js upgrade renames the option, so our `false` sets a key Next no
 *    longer reads and the default (on) returns with no error.
 */
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';
import { defaultConfig } from 'next/dist/server/config-shared';

const KEY = 'turbopackFileSystemCacheForBuild';

describe('Turbopack build cache (#5887)', () => {
  it('is turned off in the resolved next.config', () => {
    const experimental = (nextConfig.experimental ?? {}) as Record<string, unknown>;
    expect(experimental[KEY]).toBe(false);
  });

  it('is still an option this Next.js version reads', () => {
    // If Next renamed or dropped it, the key is gone from its defaults and our
    // `false` above is dead config. Find the new name before upgrading.
    const defaults = (defaultConfig.experimental ?? {}) as Record<string, unknown>;
    expect(defaults).toHaveProperty(KEY);
  });
});
