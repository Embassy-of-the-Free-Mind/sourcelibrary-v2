import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A partner iframe is sized to fit its page (EmbedResizeReporter -> embed/v1.js),
// so inside it `vh` is a share of a height the page itself sets. A hero with a
// raw 75vh minimum settled at 4x the rest of the page and showed a blown-up crop
// on every book page on the Embassy's site. The real guard is the browser audit,
// scripts/audit/embed-frame-height.mjs; this catches the same mistake at PR time.
const hero = readFileSync('src/components/book/HeroVariants.tsx', 'utf8');
const css = readFileSync('src/app/globals.css', 'utf8');

describe('book hero inside a self-sizing frame', () => {
  it('uses no raw viewport-height units', () => {
    expect(hero.match(/\[[^\]]*\d+(?:s|d|l)?vh[^\]]*\]/g) ?? []).toEqual([]);
  });

  it('sizes from --hero-vh, which is a fixed length in embed mode', () => {
    expect(hero).toContain('var(--hero-vh)');
    expect(css).toMatch(/:root\s*{\s*--hero-vh:\s*1vh;/);
    expect(css).toMatch(/\.embed-mode\s*{\s*--hero-vh:\s*[\d.]+px;/);
  });
});
