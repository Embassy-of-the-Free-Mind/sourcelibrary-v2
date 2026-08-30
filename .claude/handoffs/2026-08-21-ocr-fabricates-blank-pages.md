# OCR fabricates a full invented page for blank leaves — 2026-08-21

Started as "should `books.language` be a list?" (#4089) and ended in a corpus-wide
OCR integrity finding. The path matters, because the language detector is what
surfaced it: **fabricated content arrives in the wrong language**, since it comes
from the prompt rather than the page.

## The finding

Shown a blank or unreadable leaf, the OCR model does not decline. It emits fluent
period-appropriate prose with a complete invented apparatus — `<page-type>text</page-type>`,
a running header, a signature mark, a decorative initial, and **a `<page-num>`**. A
fabricated page number is a fabricated citation, on published pages served to readers,
exports, MCP and embeddings.

**409 confirmed pages across 264 books**, from 20,384 screened. Not obscure books:
Agrippa *De occulta philosophia*, Marcus Aurelius, Pascal, Kant *Kritik der Urteilskraft*,
the Mabinogion, John Dee, Böhme, Galen. Mostly one page per book, which is why nobody
noticed.

## Root cause — the prompt, not the model

Two defects in `prompts/ocr/standard-ocr-v5.md` / `v10.md` (the versions every confirmed
fabrication ran under) and still live in v14/v15:

1. **`<page-type>` is defined with nothing.** Its enum — `blank` included — was appended
   to the `<columns>` bullet, a tag about counting text columns. It is the only metadata
   tag in that block with no definition of its own. All 50 initially-quarantined pages
   carried `<page-type>text</page-type>`; none carried `blank`.
2. **The prompt supplies a complete specimen page.** Rule 2's example is
   `"DISCURSUS IV." → <header>DISCURSUS IV.</header>` — and that is the running header in
   **every** fabrication across eleven unrelated books. Line 38 gives `A2, B1` for
   signatures (fabrications carried `<sig>B</sig>`); rule 3 covers drop-caps (every
   fabrication had a decorative 'Q' and body text opening *Quod* / *Qvandoquidem*).

The model is not drawing on its training prior. It fills the template with the template's
own examples.

`getOcrPromptFromDb()` passes `prompt.content` verbatim apart from two language
placeholders, so the model receives these lines as written.

## Shipped

| commit | what |
|---|---|
| `1cb8f19a` | language detector + shared vocabulary + `.mjs` twin + parity tests (#4117) |
| `a5586b5c` | `.claude/docs/invariants/language-fields.md` (#4118) |
| `bd47519c` | fabrication detector, quarantine tool, language-detector fixes, "fifth class" doctrine (#4169) |
| `a75ef382` | quarantine aligned with #2449's guards (#4175) |
| `0bab5e41` | **write-time blank-page guard, both OCR write paths** (#4184) |

**49 pages quarantined** across 11 books, all recoverable from `page_revisions`
(`source: 'quarantine-fabricated-2026-08'`) plus `scripts/output/quarantine-backup-4149.jsonl`.

The guard is **default ON** (`BLANK_PAGE_GUARD=off` disables) and **fails open on every
doubt** — fetch/decode/measure failure lets the write through, because an unreadable image
is not evidence of fabrication.

## Open — in priority order

1. **#4195 — OCR prompt v16.** The upstream fix. Six changes, each tied to the issue it
   solves: restore the `<page-type>` enum, define `blank` narrowly, state the blank output
   contract, replace the DISCURSUS specimen, add a lacuna marker for unreadable *regions*
   (#3591 fix 1), reinforce the unusable-image path (#3110).
2. **Backfill the 409.** `scripts/output/fabricated-ocr-corpus-2026-08-21.jsonl` (28MB,
   gitignored) is directly consumable by `quarantine-fabricated-ocr.mjs`, which re-measures
   every image at apply time. Run dry-run first, apply in batches. **Not done deliberately**
   — 409 pages across 264 books is a considered write, not an end-of-session one.
3. **16,805 flagged pages unmeasured** — the corpus run hit its `--max-images` cap.
4. **Same-language fabrication is unmeasured.** No detector sees it; every number here is a
   floor for one detectable subclass.
5. **#4117** — the bilingual threshold still needs a human. Sample at
   `The Bilingual Threshold` artifact; three bands, 45 books.
6. **#4145** — blog post PR still open for review.

## The constraint that would have made the fix harmful

**#3591 is the parent issue** — it established this class on 2026-08-04 and explicitly
deferred the frequency measurement, which is what this session supplied. It also documents
the **inverse** failure: Kitāb al-Bulhān pages 266/197/4 carry real text (a legible basmala,
a Latin cataloguer's note), were classified `blank`, and translation replaced them with
`[Blank page — no translatable content]`.

So v16 must define `blank` **narrowly** — no ink at all, explicitly not faint or damaged —
rather than making it easier to reach. Under-use fabricates; over-use suppresses. Writing
the prompt fix without reading #3591 would have traded one live defect for the other.

## Method notes worth keeping

**Nine times this session the largest or cleanest number in a result came from the
instrument, not the corpus.** Every one was caught by the same two habits:

- **Hand-check the biggest cluster before quoting a rate.** An artifact is systematic, so it
  clumps; real defects scatter. Examples: 2,387 "bilingual" books that were Chinese +
  Classical Chinese (one text, two labels); 82 "repeated" Tibetan pages that were my dedup
  key stripping non-Latin characters; 5 "mislabels" that were compound catalogue strings.
- **Run a positive control before believing a negative.** A signature-free sweep over 400
  books found "nothing" — then missed 2 of 3 known-positive cases when tested against them.
  The negative result was worthless.

Also: `gemini_usage` timestamps on **`timestamp`**, not `created_at`. Querying the wrong one
returns $0.00 and reads as a dead pipeline. The line is **live** (~1,700 pages/day, $1.96
computed against a $15 dial) — the private memory note claiming it was paused after #3826
was stale and has been corrected.

## Files

- `scripts/lib/blank-page-guard.mjs` — the guard (+ `tests/unit/blank-page-guard.test.ts`, 16 tests)
- `scripts/audit/detect-fabricated-ocr.mjs` — detector, writes nothing
- `scripts/maintenance/quarantine-fabricated-ocr.mjs` — re-measures at apply time, refuses unreadable-or-inked
- `scripts/audit/detect-book-languages.mjs` — language detector
- `src/lib/language-normalize.ts` + `scripts/lib/language-normalize.mjs` — shared vocabulary
- `.claude/docs/invariants/language-fields.md`, `quote-and-snippet-integrity.md` (fifth class)
