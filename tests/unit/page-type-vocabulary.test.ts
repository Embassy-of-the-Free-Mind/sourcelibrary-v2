/**
 * The reader's page-type branches must be reachable.
 *
 * `NotesRenderer` special-cases DESCRIPTION_ONLY_PAGE_TYPES — pages whose whole
 * "translation" is an AI description, rendered as "toggle Notes to see the
 * description" rather than as empty body text. That set and the page-type
 * vocabulary offered to the OCR model drifted apart with nothing to notice:
 *
 *   cover, musical-score, table  →  in the reader, absent from the prompt
 *
 * The model can only emit a value the prompt lists, so all three sat at ZERO
 * pages corpus-wide while the other five carried 210,023 / 72,124 / 12,292 /
 * 11,760 / 4,927. Kircher's Musurgia Universalis (748 pages, much of it engraved
 * music) had every score page typed `text` — translated as prose, and rendered
 * without the branch written for it.
 *
 * A reader branch for a value the writer cannot produce is dead by
 * construction, and nothing in CI reported it. This test is that report.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROMPTS,
  PROMPT_PAGE_TYPES,
  LEGACY_PAGE_TYPES,
  VALID_PAGE_TYPES,
  SKIP_TRANSLATION_PAGE_TYPES,
  HIDDEN_PAGE_TYPES,
  extractPageType,
} from '@/lib/types/prompts/defaults';
import { DESCRIPTION_ONLY_PAGE_TYPES } from '@/components/reader/NotesRenderer';

const DEFAULT_OCR_PROMPT = DEFAULT_PROMPTS.ocr;

/** Pull the enumerated values out of the prompt's own `One of: …` line. */
function promptPageTypes(): string[] {
  const line = DEFAULT_OCR_PROMPT.match(/<page-type>X<\/page-type>[^\n]*One of:([^\n]+)/);
  if (!line) throw new Error('could not find the page-type "One of:" list in DEFAULT_OCR_PROMPT');
  return line[1].split(',').map(s => s.trim()).filter(Boolean);
}

describe('page-type vocabulary', () => {
  it('the prompt actually enumerates page types', () => {
    const types = promptPageTypes();
    expect(types.length).toBeGreaterThan(10);
    expect(types).toContain('text');
    expect(types).toContain('blank');
  });

  it('every page type the reader special-cases is offered to the OCR model', () => {
    const offered = new Set(promptPageTypes());
    const unreachable = [...DESCRIPTION_ONLY_PAGE_TYPES].filter(t => !offered.has(t));
    expect(unreachable).toEqual([]);
  });

  it('names the three that were dead, so a revert is visible', () => {
    const offered = new Set(promptPageTypes());
    for (const t of ['cover', 'musical-score', 'table']) {
      expect(offered.has(t), `"${t}" must stay in the OCR prompt vocabulary`).toBe(true);
    }
  });

  /**
   * #4455 was the inverse of the bug above, one layer down: the prompt was
   * widened, `VALID_PAGE_TYPES` — which sits between the prompt and the database
   * — was not, and `extractPageType` returned undefined for three values the
   * model had been explicitly asked to produce. Offered, rendered, dropped in
   * the middle.
   *
   * The prompt's `One of:` line is now interpolated from `PROMPT_PAGE_TYPES`, so
   * these first two assertions cannot fail by editing the prompt text — they
   * fail if someone hard-codes the list back into the prompt string, which is
   * exactly how it drifted the first two times.
   */
  it('the prompt enumerates PROMPT_PAGE_TYPES and nothing else', () => {
    expect(promptPageTypes()).toEqual([...PROMPT_PAGE_TYPES]);
  });

  it('every type the prompt offers is accepted by the parser', () => {
    const dropped = promptPageTypes().filter(t => !VALID_PAGE_TYPES.has(t));
    expect(dropped).toEqual([]);
  });

  it('every type the prompt offers round-trips through extractPageType', () => {
    // The set membership above is necessary but not sufficient — this is the
    // path the pipeline actually takes from model answer to `page_type`.
    for (const t of PROMPT_PAGE_TYPES) {
      expect(extractPageType(`<page-type>${t}</page-type>`), t).toBe(t);
    }
  });

  it('every type the reader special-cases round-trips too', () => {
    // DESCRIPTION_ONLY_PAGE_TYPES reachability, end to end: the prompt can ask
    // for it AND the parser will store it.
    for (const t of DESCRIPTION_ONLY_PAGE_TYPES) {
      expect(extractPageType(`<page-type>${t}</page-type>`), t).toBe(t);
    }
  });

  it('the accepted set is exactly the offered set plus the declared legacy ones', () => {
    // Pins that VALID_PAGE_TYPES stays *derived*. A hand-added member — the
    // #4455 shape — shows up here as an extra.
    expect([...VALID_PAGE_TYPES].sort())
      .toEqual([...PROMPT_PAGE_TYPES, ...LEGACY_PAGE_TYPES].sort());
  });

  it('every page type the pipeline BRANCHES on is a declared one', () => {
    // The other half of the #4455 audit. `SKIP_TRANSLATION_PAGE_TYPES` named
    // `digitizer-notice`, which appeared in neither the prompt nor the accepted
    // set — so it read as a typo when it is in fact written by the digitizer
    // detection path (321 pages). Any name here that isn't declared is either a
    // dead branch or an undeclared writer; both are worth failing over.
    const declared = new Set([...PROMPT_PAGE_TYPES, ...LEGACY_PAGE_TYPES]);
    const undeclared = [...SKIP_TRANSLATION_PAGE_TYPES, ...HIDDEN_PAGE_TYPES]
      .filter(t => !declared.has(t));
    expect(undeclared).toEqual([]);
  });

  it('no legacy type is also an offered type', () => {
    const overlap = LEGACY_PAGE_TYPES.filter(t => (PROMPT_PAGE_TYPES as readonly string[]).includes(t));
    expect(overlap).toEqual([]);
  });

  it('gives the model guidance for each newly added type, not just the bare word', () => {
    // A value in the enum with no instruction is nearly as dead as an absent
    // one — the model has nothing to decide on.
    for (const t of ['musical-score', 'table', 'cover']) {
      expect(
        DEFAULT_OCR_PROMPT.includes(`Use "${t}"`),
        `prompt should explain when to use "${t}"`,
      ).toBe(true);
    }
  });
});
