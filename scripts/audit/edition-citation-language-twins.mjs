#!/usr/bin/env node
/**
 * Do the two `citationLanguageFields()` implementations agree? (#3959)
 *
 * `scripts/lib/edition-citation-language.mjs` and the `citationLanguageFields()`
 * in `src/lib/edition-language.ts` write the SAME persisted field into
 * `books.editions[].citation`, from two runtimes that cannot import each other.
 * Twin files drift silently, and this pair drifts into a minted DOI payload —
 * so the agreement is worth a runnable check rather than a comment asking for it.
 *
 * The TS side is loaded through `tsx`, so this needs no build step:
 *   node --import tsx scripts/audit/edition-citation-language-twins.mjs
 *
 * Exits non-zero on the first disagreement, naming the input.
 */
import { citationLanguageFields as fromScripts } from '../lib/edition-citation-language.mjs';

// The package is CommonJS, so tsx transpiles the .ts module to CJS and a static
// named import from an .mjs file fails ("does not provide an export named").
// Dynamic import + interop unwrap works under both shapes.
const srcModule = await import('../../src/lib/edition-language.ts');
const fromSrc = (srcModule.citationLanguageFields ?? srcModule.default?.citationLanguageFields);
if (typeof fromSrc !== 'function') {
  console.error('Could not load citationLanguageFields from src/lib/edition-language.ts');
  console.error(`exports seen: ${JSON.stringify(Object.keys(srcModule))}`);
  process.exit(1);
}

/**
 * Cases are the shapes that actually occur on `books`, not a fuzz sweep: raw
 * codes from IIIF/IA, historical registers, placeholders, the de Slane
 * translation-of-a-translation, and the equal-language case that must stay silent.
 */
const CASES = [
  { label: 'plain original', language: 'Latin' },
  { label: 'de Slane Muqaddimah', language: 'French', original_language: 'Arabic' },
  { label: 'raw 3-letter codes', language: 'fre', original_language: 'ara' },
  { label: 'raw 2-letter codes', language: 'de', original_language: 'la' },
  { label: 'register prefix on work', language: 'German', original_language: 'Ancient Greek' },
  { label: 'register prefix both sides', language: 'Medieval Latin', original_language: 'Classical Latin' },
  { label: 'work equals edition', language: 'Latin', original_language: 'Latin' },
  { label: 'work equals edition via code', language: 'Latin', original_language: 'lat' },
  { label: 'placeholder work', language: 'French', original_language: 'unknown' },
  { label: 'placeholder work (n/a)', language: 'French', original_language: 'n/a' },
  { label: 'missing edition language', original_language: 'Arabic' },
  { label: 'empty book', },
  { label: 'unmapped language', language: 'Occitan', original_language: 'Gascon' },
  { label: 'translated flag only', language: 'English', is_translation: true },
  { label: 'text_role only', language: 'English', text_role: 'modern-translation' },
];

let failures = 0;
for (const { label, ...book } of CASES) {
  const a = fromScripts(book);
  const b = fromSrc(book);
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) {
    failures++;
    console.error(`✗ ${label}`);
    console.error(`    scripts: ${JSON.stringify(a)}`);
    console.error(`    src:     ${JSON.stringify(b)}`);
  } else {
    console.log(`✓ ${label} → ${JSON.stringify(a)}`);
  }
}

if (failures) {
  console.error(`\n${failures}/${CASES.length} disagree — the twins have drifted.`);
  process.exit(1);
}
console.log(`\nAll ${CASES.length} cases agree.`);
