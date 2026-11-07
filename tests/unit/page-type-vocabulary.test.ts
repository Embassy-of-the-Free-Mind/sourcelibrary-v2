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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DESCRIPTION_ONLY_PAGE_TYPES, prepareNotesMarkdown } from '@/components/reader/NotesRenderer';

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

/**
 * #7263: the list above is the CODE default, and nothing in production sends it. Every OCR lane sends
 * the `prompts` row with `is_default: true` (scripts/lib/live-ocr-prompt.mjs), which is v19.1,
 * `prompts/ocr/standard-ocr-v19-1-candidate.md`. That file still offers 14 types, with no
 * `musical-score` and no `table`. So the reader's branches for them stay unreachable on every page OCR'd
 * since v19.1 went live (2026-10-02), while the tests above stay green. The #8283 spot check met
 * exactly these pages: Siku Quanshu scores and rhyme tables typed `text`.
 *
 * v19.2 is v19.1 with those two values and their `Use "…" when` lines, and nothing else, so what was
 * measured about v19.1 still describes it. It is a CANDIDATE: promoting it changes what every OCR lane
 * asks for, and that waits on a decision (#7263).
 */
describe('OCR prompt v19.2 candidate (live v19.1 + musical-score, table)', () => {
  const dir = path.join(process.cwd(), 'prompts/ocr');
  const v191 = readFileSync(path.join(dir, 'standard-ocr-v19-1-candidate.md'), 'utf8');
  const v192 = readFileSync(path.join(dir, 'standard-ocr-v19-2-candidate.md'), 'utf8');
  const oneOf = (s: string) => {
    const m = s.match(/<page-type>X<\/page-type>[^\n]*One of:([^\n]+)/);
    if (!m) throw new Error('no page-type "One of:" line');
    return m[1].split(',').map(x => x.trim()).filter(Boolean);
  };

  it('offers musical-score and table, each with its guidance line', () => {
    for (const t of ['musical-score', 'table']) {
      expect(oneOf(v192)).toContain(t);
      expect(v192.includes(`Use "${t}" when`), t).toBe(true);
    }
  });

  it('offers only values the parser accepts', () => {
    expect(oneOf(v192).filter(t => !VALID_PAGE_TYPES.has(t))).toEqual([]);
  });

  it('differs from the measured v19.1 by exactly those additions', () => {
    // Remove the two additions and v19.1 must come back byte for byte: any other edit is an unmeasured prompt.
    const back = v192
      .replace('diagram, map, musical-score, table, text', 'diagram, map, text')
      .replace(/^ {2}- Use "musical-score" when[^\n]*\n/m, '')
      .replace(/^ {2}- Use "table" when[^\n]*\n/m, '');
    expect(back).toBe(v191);
  });
});

/**
 * Offering `table` and `musical-score` must not hide a page's text. `NotesRenderer` treats both as
 * DESCRIPTION_ONLY page types, but only when no transcribed text survives outside the AI's notes (#2791).
 * A rhyme table or a score with underlaid words is real text, and it must render as text.
 */
describe('table and musical-score pages keep their transcribed text', () => {
  // The shape of an agy read of 切韻指掌圖 p.44 (#3186 test), cut to two columns.
  const RHYME_TABLE = `<language>Chinese</language>
<page-type>table</page-type>

| 心 | 斜 |
|---|---|
| 涑<gloss>東侯切澣也</gloss> 〇 〇 | 〇 〇 〇 |
| 修 吏 〇 〇 | 囚 〇 〇 〇 |
| 秀 塞 〇 〇 悉 | 岫 〇 〇 〇 〇 |`;
  const SCORE_WITH_UNDERLAY = `<page-type>musical-score</page-type>

<note>Two staves of plainchant notation.</note>

Kyrie eleison, Christe eleison, Kyrie eleison.`;
  const SCORE_ONLY = `<page-type>musical-score</page-type>

<note>An engraved page of music: three systems of two staves, no words.</note>`;

  it('a table page with its text is not description-only', () => {
    const r = prepareNotesMarkdown(RHYME_TABLE, { showNotes: true, pageType: 'table' });
    expect(r.isDescriptionOnly).toBe(false);
    expect(r.processedText).toContain('涑');
    expect(r.processedText).toContain('岫');
  });

  it('a score with underlaid words is not description-only', () => {
    const r = prepareNotesMarkdown(SCORE_WITH_UNDERLAY, { showNotes: true, pageType: 'musical-score' });
    expect(r.isDescriptionOnly).toBe(false);
    expect(r.processedText).toContain('Kyrie eleison');
  });

  it('a score with no words is still shown as a description', () => {
    expect(prepareNotesMarkdown(SCORE_ONLY, { showNotes: true, pageType: 'musical-score' }).isDescriptionOnly).toBe(true);
  });
});
