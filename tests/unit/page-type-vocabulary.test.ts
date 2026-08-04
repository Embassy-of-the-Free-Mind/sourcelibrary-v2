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
import { DEFAULT_PROMPTS } from '@/lib/types/prompts/defaults';
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
