import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PREFIXED_LOCALES } from '@/lib/locale-path';

// Each script keeps its own list because it cannot import a TypeScript module.
// Without this pin, a new language opens reader URLs no detector watches, which
// is how ~315K requests a day went unseen until 2026-11-04.
const source = (file: string) => readFileSync(`scripts/workers/${file}`, 'utf8');

describe('edge scripts cover every translated book URL', () => {
  it.each(PREFIXED_LOCALES)('the crawl detector watches /%s/book/', (locale) => {
    expect(source('edge-crawl-alert.mjs')).toContain(`'/${locale}/book/%'`);
  });

  it.each(PREFIXED_LOCALES)('the attack canary probes /%s/book', (locale) => {
    expect(source('attack-canary.mjs')).toContain(`'/${locale}/book'`);
  });
});
