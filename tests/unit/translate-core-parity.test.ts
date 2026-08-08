/**
 * PARITY — src/lib/types/ai-models.ts getModelForBook (API routes, Lambda)
 * vs scripts/lib/translate-core.mjs getTranslateModelForBook (workers, scripts).
 *
 * Runs BOTH routings over the same probes and fails on any divergence, so
 * "keep in lock-step" is enforced rather than hoped. The probe set includes
 * every language in the .mjs allowlist plus the historical divergence cases:
 * a drifted copy in translate-worker.mjs once routed Malay (Jawi manuscripts)
 * to the lite model, the exact hallucination case the allowlist exists to
 * prevent (issue #3725).
 */
import { describe, it, expect } from 'vitest';
import { getModelForBook as routeTs } from '@/lib/types/ai-models';
import {
  getTranslateModelForBook as routeMjs,
  LATIN_SCRIPT_LANGUAGES,
  MODEL_FLASH,
  MODEL_LITE,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-core.mjs';

type Probe = { name: string; book: Parameters<typeof routeTs>[0] };

const DIVERGENCE_SUSPECTS = [
  // Deliberately absent from the allowlist — must go to full flash.
  'malay', 'ms', 'msa',
  // Missing from the drifted retranslate-pages copy — must stay on lite.
  'estonian', 'et', 'est',
  // Non-Latin scripts — full flash always.
  'greek', 'tibetan', 'hebrew', 'arabic', 'chinese', 'russian', 'sanskrit',
  // Junk and edge cases.
  'klingon', '', '  latin  ', 'LATIN', 'English',
];

const probes: Probe[] = [
  { name: 'bph provider wins over language', book: { image_source: { provider: 'bph' }, language: 'latin' } },
  { name: 'null book', book: null },
  { name: 'no language', book: {} },
  { name: 'null language', book: { language: null } },
  ...[...LATIN_SCRIPT_LANGUAGES as Set<string>].map((lang) => ({
    name: `allowlist: ${lang}`,
    book: { language: lang },
  })),
  ...DIVERGENCE_SUSPECTS.map((lang) => ({
    name: `suspect: ${JSON.stringify(lang)}`,
    book: { language: lang },
  })),
];

describe('translate-core routing parity', () => {
  it.each(probes)('$name', ({ book }) => {
    expect(routeMjs(book)).toBe(routeTs(book));
  });

  it('routes Malay (Jawi) to full flash — the case the drifted copy broke', () => {
    expect(routeMjs({ language: 'malay' })).toBe(MODEL_FLASH);
    expect(routeTs({ language: 'malay' })).toBe(MODEL_FLASH);
  });

  it('routes plain Latin-script books to lite', () => {
    expect(routeMjs({ language: 'latin' })).toBe(MODEL_LITE);
  });
});
