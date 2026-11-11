# Containment on finding: invented or wrong-leaf text comes off the page in the same run

PRIOR ART: `.claude/skills/shelf-overview/SKILL.md` §5 (hide + hold a whole `do_not_show` book) and
`pipeline-status-truth.md` (holds). Neither says what a reviewer does with a few bad PAGES in a book
that is otherwise fine, or that the act needs no sign-off; this does.

**Read this when** you (a session, a job, a reviewer subagent) have opened a page image and the stored
transcription or English is not what is on the leaf: invented text, another page's text, a model's
reply. If you are designing a detector, read `../page-error-taxonomy.md` instead.

## The rule (Derek, 2026-10-08, standing default)

A finding made **by eye** is contained in the run that made it. No decision row, no "fixes before X
looks" checklist. Three steps, in this order:

1. **Hold the book** (`scripts/maintenance/hold-pipeline-books.mjs`, or `holdBook()` in
   `scripts/lib/pipeline-hold.mjs`) with a release sentence. The hold comes first because the
   translate lanes read a withheld page as an untranslated one and will pay to translate the same
   bad transcription again.
2. **Withhold the confirmed pages only**:
   `withhold-stale-translations.mjs --book=<id> --by-eye-pages=100,101,102 --evidence="…" --issue=N`
   (dry run by default; `--apply` to write; `all` only when you have read enough of the book to say
   the read is wrong throughout). The tool refuses a book that is not held, snapshots the text to
   `page_revisions`, and logs the pages and your evidence to `sweep_log`. Undo:
   `restore-withheld-translation.mjs`. (`--by-eye-pages` arrives with the #6048 PR; until that merges,
   run it from that branch.)
3. **Say so on the issue and add the `contained` label.** One line: pages, evidence, the hold's
   release condition. `contained` means readers no longer see the bad text and the repair is still
   owed. An issue list of "readers are served wrong text today" excludes `contained` issues.

The page stays public with its image; the reader sees that the English is withheld. The book is not
hidden. Derek, 2026-10-07: warnings that link to evidence, not blocked access. Hiding a whole book
is for a book with nothing sound to read (shelf-overview §5), or for rights, which is his call.

## Then fix it (Derek, 2026-11-04: "when things like that happen, it should just get fixed")

Containment is the first half. When the repair is a handful of pages and runs on the subscription CLIs, finish it in
the same run: re-read (`scripts/batch/cli-ocr.mjs`), open each new read against its image and pass the by-eye check to
`apply --by-eye`, translate (`scripts/batch/cli-translate.mjs`), read the English before applying it, then release the
hold. `contained` is for a repair that really is blocked or priced, not a resting place. A by-eye row may name
`scripts_seen` when a Latin book's Greek or Hebrew quotations trip the foreign-script guard.

Do not skip reading the English. On #8189 the first translations of correct reads still reversed a negative and built a
gloss on a misread Greek word; `--instructions-file` names the point and the page is read again.

## What this does not license

- **No paid work without the usual rules.** A repair on the subscription CLIs needs no ask; paid re-reads follow the spend floor.
- **No deletion.** Nothing is unset without a snapshot; no book or page is removed.
- **Not for a detector's output.** A predicate over thousands of pages has a false-positive rate and
  goes through the normal dry run, sample by eye, and approval (#6117 was 550 pages and was asked).
  This rule covers pages a reader of the image has named, a handful to one book at a time.
- **Not for a judgment of quality.** A weak, stiff or partly wrong translation is a finding, not a
  containment. The bar is: the text is not this leaf's text.
- **Human-edited translations are never withheld by this path.**

## Why

On 2026-10-06 three reviewers confirmed five invented pages on a funder-facing shelf with the images
open and filed a checklist (#6048). Nothing was withheld for two days, because withholding had been
asked each time before (#5645, #6117) and nobody asked. The act is free and reversible; the wait was
the only cost, and readers paid it.
