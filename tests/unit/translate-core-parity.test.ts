/**
 * PARITY — every live copy of the "which Gemini model does this book get?"
 * routing, run over the same probes:
 *
 *   1. src/lib/types/ai-models.ts       getModelForBook          (API routes, Lambda)
 *   2. scripts/lib/translate-core.mjs   getTranslateModelForBook (.mjs translation workers)
 *   3. scripts/lib/ocr-routing.mjs      getOcrModelForBook       (batch OCR: orchestrator + backfill)
 *
 * Any divergence fails. The probe set includes every language in the .mjs
 * allowlist plus the historical divergence cases: a drifted copy in
 * translate-worker.mjs once routed Malay (Jawi manuscripts) to the lite model,
 * the exact hallucination case the allowlist exists to prevent (issue #3725).
 *
 * (3) was added 2026-09-04. It existed all along as a private allowlist inside
 * scripts/workers/pipeline-orchestrator.mjs — unimportable, because that file
 * runs `run()` on import, so no test could see it. It had drifted to include
 * `malay`/`ms`/`msa`, so Malay books were OCR'd on lite (wrong) while being
 * translated on flash (right). A second private copy in
 * scripts/migration/backfill-ocr-near-complete.mjs had drifted identically.
 * Both now import the shared module this test pins. Watching two of three
 * copies is how the drift survived: if you add a fourth call site, import the
 * shared module rather than pasting the list, and add it here.
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
import {
  getOcrModelForBook as routeOcr,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/ocr-routing.mjs';

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

describe('OCR routing parity (batch OCR vs translation vs API)', () => {
  it.each(probes)('$name', ({ book }) => {
    expect(routeOcr(book)).toBe(routeTs(book));
    expect(routeOcr(book)).toBe(routeMjs(book));
  });

  it('routes Malay (Jawi) OCR to full flash — the orchestrator drift', () => {
    for (const lang of ['malay', 'ms', 'msa']) {
      expect(routeOcr({ language: lang })).toBe(MODEL_FLASH);
    }
  });

  it('routes plain Latin-script books to lite for OCR too', () => {
    expect(routeOcr({ language: 'latin' })).toBe(MODEL_LITE);
  });

  it('sends BPH books to full flash regardless of language', () => {
    expect(routeOcr({ image_source: { provider: 'bph' }, language: 'latin' })).toBe(MODEL_FLASH);
  });
});
