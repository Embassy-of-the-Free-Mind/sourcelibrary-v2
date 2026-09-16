import { describe, it, expect } from 'vitest';
import { VALID_IMAGE_TYPES, coerceImageType } from '@/lib/gallery-image-types';
import {
  VALID_IMAGE_TYPES as VALID_IMAGE_TYPES_JS,
  coerceImageType as coerceImageTypeJs,
} from '../../scripts/lib/gallery-image-types.mjs';

// `gallery_images.type` is supposed to hold one of a small set of tokens. It held 113
// distinct values, 96 of them chunks of the extraction model's raw response — up to 4,152
// characters, including the model's visible deliberation about which value to pick
// (#3419). The guard now lives at the shared document builder; these tests pin the
// vocabulary across the two JS twins and pin the coercion behaviour that lets the guard
// reject narration without also rejecting good data.

describe('gallery image type vocabulary', () => {
  it('is identical across the TS and .mjs twins', () => {
    expect([...VALID_IMAGE_TYPES].sort()).toEqual([...VALID_IMAGE_TYPES_JS].sort());
  });

  it('accepts every value the two pre-existing validators accepted', () => {
    // These were written out verbatim in src/lib/types/prompts/defaults.ts and
    // src/app/api/gallery/image/[id]/route.ts before being consolidated here.
    for (const t of [
      'woodcut', 'diagram', 'chart', 'illustration', 'symbol', 'table', 'map',
      'decorative', 'emblem', 'engraving', 'portrait', 'frontispiece', 'musical_score',
      'exlibris', 'bookplate', 'unknown',
    ]) {
      expect(coerceImageType(t)).toBe(t);
    }
  });
});

describe('coerceImageType', () => {
  it('distinguishes "nothing asserted" from "asserted but unusable"', () => {
    // The distinction is the point: only the second case is evidence that a prompt or
    // model needs attention.
    expect(coerceImageType(undefined)).toBeNull();
    expect(coerceImageType(null)).toBeNull();
    expect(coerceImageType('')).toBeNull();
    expect(coerceImageType('   ')).toBeNull();
    expect(coerceImageType('not-a-type')).toBe('unknown');
  });

  it('repairs the trailing-punctuation near-misses seen in production', () => {
    expect(coerceImageType('diagram,')).toBe('diagram');
    expect(coerceImageType('Diagram.')).toBe('diagram');
  });

  it('rejects model narration even when it contains a valid type', () => {
    // The actual value from production, truncated. A blob that merely CONTAINS the word
    // "diagram" must not be accepted as the value "diagram" — substring matching here is
    // how narration would slip back in.
    const blob =
      "diagramBase64: diagram; bbox: [0.01, 0.03, 0.98, 0.94] (covers all three leaves) " +
      "- wait, the type must be exactly one of the list. I will use 'diagram'.";
    expect(coerceImageType(blob)).toBe('unknown');
  });

  it('rejects the malformed near-values that look almost valid', () => {
    expect(coerceImageType('diagramBase64EncodedImage:null,')).toBe('unknown');
    expect(coerceImageType('diagramBase64EncodedImageData:null,')).toBe('unknown');
  });

  it('behaves identically across the twins', () => {
    for (const input of [
      undefined, null, '', 'diagram', 'diagram,', 'Diagram.', 'musical_score',
      'not-a-type', 'woodcut_illustration_of_a_courtyard_scene', 42,
    ]) {
      expect(coerceImageType(input)).toEqual(coerceImageTypeJs(input));
    }
  });
});

// The prompt has said "skip initials" since PR #450; the write path never checked.
// 6,253 initials reached the gallery, 5,992 of them under 5% of the page (#4780).
import { isTrivialGalleryDetection, TRIVIAL_MAX_AREA } from '@/lib/gallery-image-types';
import {
  isTrivialGalleryDetection as isTrivialGalleryDetectionJs,
  TRIVIAL_MAX_AREA as TRIVIAL_MAX_AREA_JS,
} from '../../scripts/lib/gallery-image-types.mjs';

describe('isTrivialGalleryDetection', () => {
  const small = { x: 0.449, y: 0.524, width: 0.076, height: 0.052 }; // the Paracelsus 'P', 0.4% of the page
  const large = { x: 0.1, y: 0.1, width: 0.4, height: 0.3 };

  const cases: Array<[string, Parameters<typeof isTrivialGalleryDetection>[0], boolean]> = [
    ['small decorative initial (the case that slipped)', { type: 'decorative', description: 'Ornate woodcut initial P featuring a figure and foliage', bbox: small }, true],
    ['small woodcut described as an initial', { type: 'woodcut', description: 'Historiated woodcut initial letter G with a figure', bbox: small }, true],
    ['small decorative manicule (no initial word)', { type: 'decorative', description: 'A manicule (pointing hand) in the left margin', bbox: small }, true],
    ['small drop cap by description', { type: 'engraving', description: 'Drop-cap T opening the chapter', bbox: small }, true],
    ['large historiated initial stays', { type: 'decorative', description: 'Historiated woodcut initial S with two figures in a landscape', bbox: large }, false],
    ['large decorative border stays', { type: 'decorative', description: 'Full-page architectural title border', bbox: large }, false],
    ['small portrait stays', { type: 'portrait', description: 'Medallion portrait of the author', bbox: small }, false],
    ['"initially" is not "initial"', { type: 'diagram', description: 'The apparatus as initially assembled', bbox: small }, false],
    ['no bbox — nothing to judge, admit', { type: 'decorative', description: 'initial', bbox: null }, false],
    ['type asserted but unusable is not decorative', { type: 'ornamental drop', description: 'an ornament', bbox: small }, false],
  ];

  for (const [name, img, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      expect(isTrivialGalleryDetection(img)).toBe(expected);
    });
  }

  it('behaves identically across the twins', () => {
    expect(TRIVIAL_MAX_AREA_JS).toBe(TRIVIAL_MAX_AREA);
    for (const [, img, expected] of cases) {
      expect(isTrivialGalleryDetectionJs(img)).toBe(expected);
    }
  });
});
