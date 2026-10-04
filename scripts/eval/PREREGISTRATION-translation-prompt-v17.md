# Pre-registration: translation prompt v17 (typed notes, two stances) vs v13

_Written 2026-10-04, **before any paid call** for this study. Issue #5698 steps 2–3._

PRIOR ART: `PREREGISTRATION-translation-prompt-v15.md` and its Amendment 2
(`PREREGISTRATION-translation-prompt-v16-amendment.md`): the conventions followed here (a
numeric rule, both arms re-run fresh, the verifier is `parseTranslationTerms`, loops are
classified apart from length). Neither can be reused as the rule: they gate a flip on a 320-page
reference-free draw, and this study asks a different question on reference pages.

**Who reads the result:** Derek, deciding how our translations annotate themselves; then
scholars who use the notes to judge the English.

## The decision this changes

Adopt **typed notes** (prompt v17) as the design the reader and parsers are built for, or keep
v13's single untyped `<note>`. No default is flipped by this study in either case: v17 cannot
ship before the reader and parser changes it needs (a separate PR, `tier:hold`).

## What is NOT claimed or tested

Fidelity gains. v16 failed its rule (#3825, PR #5703) and no prompt-side lever beat the noise
floor for fidelity on Tibetan (#5497, PR #5713). Fidelity, omission and reversals are measured
here as **guards** (v17 must not be worse), never as a reason to adopt it. v17 is justified
only by what notes are for: an honest apparatus.

## The design under test

`scripts/maintenance/translation-prompt-v17-typed-notes.mjs` builds v17 from the v16 row by
twelve anchored edits; v16's verbatim rule for `<note>original: "…"</note>` is byte-identical.

- **Types as a prefix inside the plain `<note>` tag**: `original:`, `clarification:`,
  `context:`, `alternative:`, `image:`. `original:` is already this shape in v13–v16.
- Notes printed on the page (footnotes, interlinear commentary) go in `<margin>`/`<gloss>`.
- No silent emendation: the source's reading stays in the text; the other goes in `alternative:`.
- Image descriptions descriptive only. Scan remarks and decorative initials are not notes.
- **Stance** replaces "warm museum label": `study` and `reading`, one prompt row each
  (`Standard Translation (study)` v17 `611ebbea`, `Standard Translation (reading)` v17
  `3851b3bd`; `is_default:false`).
- Three convention lines per tradition. No term table (a glossary block raised reversals on
  Tibetan, #5497 arm D), so no glossary licence question arises.

### Why a prefix and not `<note type="…">`: the consumer inventory

`git grep -n "<note"` over `src/` and `scripts/` (archived scripts and result files excluded),
2026-10-04. An untyped `<note>` stays valid under either syntax. A prefix leaves every consumer
working today; an attribute breaks the strict ones.

| consumer | what it does with `<note>` | attribute form | prefix form |
|---|---|---|---|
| `src/components/reader/NotesRenderer.tsx` (`note:` component, `showNotes`) | renders a gold chip, or nothing with notes off | works | works; the type word shows in the chip |
| `src/lib/notes-off.ts` `preprocessTerms` | drops glossary lines of `<term>`+`<note>` pairs (strict `<note>`) | **breaks** (dangling term chips, #3811's bug) | works |
| `src/lib/notes-off.ts` `stripAiAnnotations`, `src/lib/normalize-annotation-spans.ts`, `src/lib/sanitize-translation-tags.ts`, `scripts/lib/annotation-tag-repair.mjs` | hide / repair spans | works (tested: sanitizer passes both forms through) | works |
| `scripts/lib/note-claims.mjs` `pageNotes` (the #5647 fact-check lane, stage 1) | strict `<note>(…)</note>` | **breaks: the note is invisible to the lane** (tested) | works; `context:` notes pass the cue filter as before |
| `scripts/lib/page-terms-parse.mjs`, `scripts/maintenance/build-page-terms.mjs` (`page_terms`, verified originals) | `<note …>original: "…"` | works | works, unchanged |
| `src/lib/export-markdown-html.ts` (EPUB/HTML download) | tolerant regex → note placeholder | works | works |
| `scripts/lib/scholarly-typst.mjs` (×2), `scripts/lib/scholarly-pdf.mjs` (DOI editions) | strict `<note>` → `(…)` / `[Note: …]` | **breaks: literal tags in a minted edition** | works |
| `src/lib/pdf-export.ts`, `src/lib/kdp-epub.ts`, `src/app/book/[id]/page/[pageId]/layout.tsx` | strip tags, keep or drop content | works | works |
| `src/lib/local-mode/page-text.ts` | tolerant; keys a note to the word before it | works | works |
| `src/lib/types/prompt.ts`, `src/lib/types/prompts/utilities.ts` `extractNotes` | strict | **breaks** | works |
| `src/components/pipeline/TranslationEditor.tsx`, `src/components/reader-v2/ModernizedText.tsx` | wrap `<section-intro>` as `<note>` | n/a | n/a |
| `scripts/analysis/note-quality-phase0.mjs`, `scripts/analysis/detect-caption-page-mismatch.mjs`, `scripts/eval/folio-markers-5678.mjs` | strict | **breaks** | works |
| `scripts/eval/quality-census-score.mjs`, `scripts/audit/note-tag-provenance.mjs`, `scripts/eval/translation-prompt-ab.mjs`, `scripts/eval/tengyur-pilot-qa/mechanical.mjs`, `scripts/lib/translation-text-repair.mjs`, `scripts/lib/hidden-translation.mjs`, `scripts/maintenance/fix-unclosed-note-tags.mjs` | tolerant | works | works |
| `scripts/eval/build-quality-dataset.mjs` (quality dataset) | does not parse `<note>`; ships judged rows | works | works |
| `scripts/eval/translation-vs-reference/JUDGE-PROMPT.md` | tells the judge `<note>` is house format | works | works |

Ten strict sites, among them the fact-check lane that `context` notes are meant to feed and
the Typst/PDF path that mints DOIs. The prefix needs no change before a v17 page can be written;
the attribute needs ten. What the prefix costs: the type word is visible in the reader chip
until the reader styles it, and typing depends on the model writing the prefix (measured, P3).

## Sample (pinned before the run)

`scripts/eval/results/translation-prompt-v17-2026-10/sample.jsonl`, built by
`scripts/eval/translation-prompt-v17/build-sample.py` (seed 5698) from the #5695 track records.

- **Main: 40 pages from 40 books**, public references only: Latin 8, Greek 6, German 2,
  French 2, Italian 1, Dutch 1, Hebrew 4, Aramaic 1, Arabic 4, Persian 3, Sanskrit 3, Pali 2,
  Chinese 3. Source 400–6,000 chars; reference cut not judged "wrong" in its track.
- **Gallery pool: 8 further pages**, one per language, where a #5695 judge quoted a reversal
  on a production-prompt arm. They are selected on an outcome, so they never enter a rate.
- No Tibetan: the 84000 reference is CC BY-NC-ND and stays on the box; #5497 covers it.

n = 40 is small. It can show a large effect on a per-page score and cannot show a small one;
per-language rows are descriptive only.

## Arms (4 calls per page, 192 calls)

| arm | prompt | purpose |
|---|---|---|
| `v13-a` | v13 `51651014`, the live default | baseline |
| `v13-b` | v13 again | **noise floor**: model noise and judge retest noise together |
| `v17-study` | v17 study | |
| `v17-reading` | v17 reading | |

Same door for every arm (`buildTranslationPrompt`), the model each book ships on
(`getTranslateModelForBook`), `temperature: 1`, `thinkingBudget: 0`, production safety
settings and `maxOutputTokens` rule, one page per request. **No previous-page translation in
any arm**: the served neighbour was written under v13 and its untyped notes would prime the v17
arms (and #5698 proposes dropping that context on page-exact sources). v13 is run fresh, never
read from a stored output (v13's own output drifted 76% → 88% verified in three weeks, #3825).

Runner: `scripts/eval/translation-prompt-v17/run-arms.mjs`, metered through
`gemini-script-client` on envelope `prompt-v17-5698` (lane label no worker uses, one
pseudo-book). Estimate ≈ $1; **hard cap $6**. No writes to `pages` or `books`.

## Instruments

1. **Mechanical** (`score.mjs`, $0): notes per page by type; typed share; verified-original
   rate (`parseTranslationTerms`, the #4777 tiers; `script` = cannot be checked, reported apart);
   clutter notes (`classifyNote` from `quality-census-score.mjs`: decorative-initial and
   scan-condition notes); `<note type=` attribute forms; invented tags; em-dashes; body length
   with **every** `<note>` removed; loop class.
2. **Dimension judge, one blind Opus judge** (`DIMENSIONS-PROMPT.md`): the four arms as
   shuffled T1–T4 with source and reference. Scores 1–5 for readability, register, terminology,
   ambiguity, transparency (the #5695 rubric B wording), plus a per-note audit: each `<note>` as
   `ours` / `source_printed_note` (a note of the page put in our voice) / `clutter`, and each
   alternative reading offered as `real` / `spurious` / `wrong`.
3. **Fidelity harness** (`scripts/eval/translation-vs-reference/`, two blind Opus judges, the
   three controls gate the run): fidelity, omission, reversals, on all 48 pages with the main 40
   as their own stratum. Guards only.
4. **Note facts, the #5647 lane's stage 1 + one Opus judge.** `pageNotes()` picks the candidate
   notes with the #5624 cue filter, as the lane does; `original:`, `alternative:`,
   `clarification:` and `image:` notes are not fact claims and are excluded. Stage 3's grounded
   Gemini verifier is not used: it costs $0.014 per search and its calibration set is the
   #5624 subagent verdicts, which is the method used here. Verdicts correct / wrong /
   partly-wrong / unverifiable; 8 seeded false notes; the pass is void if fewer than 6 are caught.

## Noise floor

For every paired metric, F = the larger absolute bound of the 95% paired-bootstrap CI (10,000
resamples of pages, seed `0x5eed`) of mean(v13-b − v13-a). A v17 effect is **established** when
its own paired CI against v13-a excludes 0 **and** its point estimate exceeds F.

## Hypotheses and metrics

Primary (what notes are for):
- **P1 transparency.** v17 raises the judge's transparency score over v13-a.
- **P2 verified originals.** v17's verified-original rate is not below v13-a's, and its count of
  verified original-notes per page is not lower. (v16 measured 88% → 91% on lite; a ceiling.)
- **P3 typing works.** ≥ 90% of v17 `<note>`s open with one of the five types, in each stance.
- **P4 ours vs the source's.** Notes per 100 pages audited `source_printed_note` or `clutter`
  fall under v17.
- **P5 alternatives are real.** v17 offers alternative readings on more pages than v13 (which
  has no place for them), and ≥ 70% of them are audited `real`.

Secondary, reported: ambiguity, terminology, readability, register; notes per page (the
clutter question: `reading` should carry fewer notes than v13, `study` more `original` and
`alternative`).

Guards, per stance (each "worse" means beyond F and with a CI excluding 0):
- **G1** fidelity not worse; reversal pages per 100 not worse; omission rate not worse.
- **G2** body length on non-looped pages within 0.85–1.20 of v13-a (median of per-page
  ratios); no more looped pages than v13-a. A page is **looped** when `finishReason` is
  `MAX_TOKENS`, or it has ≥ 40 sentences of which fewer than half are distinct (the Tibetan
  v13 runaway of #3825 stopped under the cap: 1,369 sentences, 18 distinct).
- **G3** note-fact error rate (wrong + partly-wrong over checked) not more than 10 points above
  v13-a's. With this n it will be a count, not a rate; it is reported as one.
- **G4** em-dashes per page not above v13-a; invented tags and `<note type=` forms not above
  v13-a.

## Decision rules

1. **v17 is established as the better apparatus** for a stance when P1 is established for it,
   P3 holds, P2 is not established as worse, and no guard fails. P4 and P5 decide what the
   gallery shows and are reported with counts.
2. **If P1 is established for neither stance and P2 is not established as better**, the typed
   notes did not measurably improve the apparatus beyond the noise floor. Say so and stop:
   keep v13, no reader work.
3. **If P1 is established but a guard fails**, report the failing guard as the result; keep v13;
   name the one edit to try next.
4. **Which stance is the default**, if both pass: `reading`, unless its readability is below
   v13-a's beyond F, in which case `study`. The other stance is a reader option, later.
5. In every case the default stays v13 until the reader and parser changes are merged.

## Deviations

Any deviation from this file is written into the experiment file under "As executed".
