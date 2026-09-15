/**
 * ROUTING PARITY AND THE DELIBERATE SPLIT — every live copy of "which Gemini
 * model does this book get?", run over the same probes:
 *
 *   OCR (image-in):
 *   1. src/lib/types/ai-models.ts       getModelForBook            (API routes, OCR Lambda)
 *   2. scripts/lib/ocr-routing.mjs      getOcrModelForBook         (batch OCR: orchestrator + backfill)
 *   TRANSLATION (text-in):
 *   3. src/lib/types/ai-models.ts       getTranslateModelForBook   (translation Lambda, queue-books)
 *   4. scripts/lib/translate-core.mjs   getTranslateModelForBook   (.mjs translation workers + producers)
 *
 * Within each pair any divergence fails. BETWEEN the pairs, divergence on
 * non-Latin scripts is REQUIRED (issue #4759): OCR keeps the allowlist because
 * flash-lite hallucinates when visual decoding is hard (#1726 — a Bhutanese
 * astrological text read as a "ritual manual for weather control"; Jawi Malay
 * garbled into confident nonsense, #3725). Translation reads text, #1726
 * offered no translation evidence when it swept translation along, the only
 * translation A/B on record (#467) favoured lite, and the observational read
 * over the Mar 27 – May 12 2026 lite era found no faithfulness gap
 * (scripts/eval/results/translation-model-obs-report.md). The split is worth
 * ~$12K over 5.4M untranslated pages. The "policies differ" block below is the
 * negative control: re-syncing translation with OCR in either direction turns
 * it red.
 *
 * History of this file: (2) was added 2026-09-04 after two private copies of
 * the allowlist drifted to include `malay` (see git log). If you add a fifth
 * call site, import one of the four shared functions rather than pasting the
 * list, and add it here.
 */
import { describe, it, expect } from 'vitest';
import { getModelForBook as ocrTs, getTranslateModelForBook as translateTs } from '@/lib/types/ai-models';
import {
  getTranslateModelForBook as translateMjs,
  LATIN_SCRIPT_LANGUAGES,
  MODEL_FLASH,
  MODEL_LITE,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-core.mjs';
import {
  getOcrModelForBook as ocrMjs,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/ocr-routing.mjs';

type Probe = { name: string; book: Parameters<typeof ocrTs>[0] };

const NON_LATIN = ['greek', 'tibetan', 'hebrew', 'arabic', 'chinese', 'russian', 'sanskrit', 'syriac', 'armenian', 'japanese'];

const DIVERGENCE_SUSPECTS = [
  // Deliberately absent from the allowlist — OCR must go to full flash.
  'malay', 'ms', 'msa',
  // Missing from a drifted retranslate-pages copy once — must stay on lite.
  'estonian', 'et', 'est',
  ...NON_LATIN,
  // Junk and edge cases.
  'klingon', '', '  latin  ', 'LATIN', 'English',
];

const probes: Probe[] = [
  { name: 'bph provider wins over language', book: { image_source: { provider: 'bph' }, language: 'latin' } },
  { name: 'bph provider, non-Latin language', book: { image_source: { provider: 'bph' }, language: 'tibetan' } },
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

// The script-aware OCR rule is pinned with the OCR_LITE_ONLY switch held OFF, so the
// parity guarantee survives the "flash-lite only, in the meantime" period
// (2026-09-11) and is what returns the day the switch is lifted.
const scriptAware = { liteOnly: false };

describe('OCR routing parity (TS router vs batch OCR router)', () => {
  it.each(probes)('$name', ({ book }) => {
    expect(ocrMjs(book, scriptAware)).toBe(ocrTs(book));
  });

  it('routes Malay (Jawi) OCR to full flash — the drift the allowlist exists to prevent', () => {
    for (const lang of ['malay', 'ms', 'msa']) {
      expect(ocrTs({ language: lang })).toBe(MODEL_FLASH);
      expect(ocrMjs({ language: lang }, scriptAware)).toBe(MODEL_FLASH);
    }
  });

  it('routes non-Latin scripts and unknown language to full flash for OCR', () => {
    for (const language of [...NON_LATIN, null, '']) {
      expect(ocrTs({ language })).toBe(MODEL_FLASH);
    }
  });

  it('routes plain Latin-script books to lite for OCR', () => {
    expect(ocrTs({ language: 'latin' })).toBe(MODEL_LITE);
    expect(ocrMjs({ language: 'latin' }, scriptAware)).toBe(MODEL_LITE);
  });
});

describe('translation routing parity (TS router vs .mjs router)', () => {
  it.each(probes)('$name', ({ book }) => {
    expect(translateMjs(book)).toBe(translateTs(book));
  });

  it('routes BPH books to full flash regardless of language', () => {
    for (const language of ['latin', 'tibetan', null]) {
      expect(translateMjs({ image_source: { provider: 'bph' }, language })).toBe(MODEL_FLASH);
      expect(translateTs({ image_source: { provider: 'bph' }, language })).toBe(MODEL_FLASH);
    }
  });

  it('routes every non-BPH book to lite — Latin, non-Latin, unknown (#4759)', () => {
    for (const language of ['latin', 'english', 'malay', ...NON_LATIN, null, '', 'klingon']) {
      expect(translateMjs({ language })).toBe(MODEL_LITE);
      expect(translateTs({ language })).toBe(MODEL_LITE);
    }
    expect(translateMjs(null)).toBe(MODEL_LITE);
    expect(translateTs(null)).toBe(MODEL_LITE);
  });
});

// Negative control for the split itself. If someone "fixes" the divergence —
// moves translation back onto the allowlist, or drops the allowlist from OCR —
// this block goes red, and the comment at the top says why it must not.
describe('OCR and translation routing DIFFER on purpose (#4759)', () => {
  it('a Tibetan book: OCR on flash, translation on lite', () => {
    const book = { language: 'tibetan' };
    expect(ocrTs(book)).toBe(MODEL_FLASH);
    expect(ocrMjs(book, scriptAware)).toBe(MODEL_FLASH);
    expect(translateTs(book)).toBe(MODEL_LITE);
    expect(translateMjs(book)).toBe(MODEL_LITE);
  });

  it('a BPH book: flash for both', () => {
    const book = { image_source: { provider: 'bph' }, language: 'latin' };
    expect(ocrTs(book)).toBe(MODEL_FLASH);
    expect(translateTs(book)).toBe(MODEL_FLASH);
    expect(translateMjs(book)).toBe(MODEL_FLASH);
  });

  it('a Latin book: lite for both', () => {
    const book = { language: 'latin' };
    expect(ocrTs(book)).toBe(MODEL_LITE);
    expect(translateTs(book)).toBe(MODEL_LITE);
    expect(translateMjs(book)).toBe(MODEL_LITE);
  });

  it('every non-Latin or unknown language splits; every allowlisted language and BPH agree', () => {
    for (const language of [...NON_LATIN, 'malay', null, '']) {
      expect(translateTs({ language })).not.toBe(ocrTs({ language }));
    }
    for (const language of LATIN_SCRIPT_LANGUAGES as Set<string>) {
      expect(translateTs({ language })).toBe(ocrTs({ language }));
    }
    expect(translateTs({ image_source: { provider: 'bph' } })).toBe(ocrTs({ image_source: { provider: 'bph' } }));
  });
});

describe('OCR_LITE_ONLY (2026-09-11): every batch OCR submission is flash-lite', () => {
  const liteOnly = { liteOnly: true };

  it('overrides the BPH branch', () => {
    expect(ocrMjs({ image_source: { provider: 'bph' }, language: 'latin' }, liteOnly)).toBe(MODEL_LITE);
  });

  it('overrides the non-Latin and unknown-language branches', () => {
    for (const language of ['malay', 'tibetan', 'chinese', 'arabic', null, '']) {
      expect(ocrMjs({ language }, liteOnly)).toBe(MODEL_LITE);
    }
  });

  it('is the default unless OCR_LITE_ONLY=0 is set in the environment', () => {
    // The module reads the env once at import; this pins the default of that read.
    expect(process.env.OCR_LITE_ONLY === '0' ? MODEL_FLASH : MODEL_LITE)
      .toBe(ocrMjs({ image_source: { provider: 'bph' } }));
  });

  it('does not touch translation routing (BPH translation stays on flash)', () => {
    expect(translateMjs({ image_source: { provider: 'bph' }, language: 'latin' })).toBe(MODEL_FLASH);
  });
});
