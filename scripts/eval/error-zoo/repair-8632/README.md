# Repair of confirmed audit findings, agy cells — #8632 decision 1

Derek, 2026-11-12, approved the #8632 defaults. Decision 1: repair the 42 pages whose serious OCR finding two model
families agree on, through each cell's live route. That means yes for the agy cells. The German pages on `lite>opus` and
`3flash>opus` (8) are held until the #7809 pilot is re-judged with Flash high.

## What ran

The repair used the standing lane: `scripts/batch/cli-ocr-lane.mjs correct --reread-per-call=4`, with
`--reread-languages=Latin` for the Latin books and plain `correct` for the one German page with unknown script. It ran
one book at a time with `--book=ID --first=<confirmed pages>` on the james pool's spare Gemini 3.8 Flash low. This is
the same path `reader-request-lane.mjs` uses for pages a reader asked for. Every guard of the re-read applied, as did
its ledger and its claims, shared with the gex45 cron lanes. No new route, prompt or writer was involved.

| step | pages |
|---|---|
| confirmed, agy cells (`manifest.jsonl`) | 34 in 28 books |
| outside the lane's frame (`eligibility-2026-11-12.json`) | 13: 8 outside the 15–95% page window where the route was validated, 4 in BPH books (their English would queue the paid translator), 1 in a quarantined book |
| already tried by the lane and refused (2026-11-03 to 11-10: shared-word floor ×2, cut reply, letters outside the script) | 4 |
| read now | 17 |
| refused by a write guard now (shared-word floor, denied image read ×2, cut reply, a correction changing 36% of words) | 5 |
| **confirmed pages written** | **12** |
| other pages of the same books written in the same 4-page calls (not neighbours: see below) | 26 |

**The 4-page calls were not consecutive pages. This corrects an earlier version of this file.** `--first` puts the
confirmed page at the front of the book's queue, and the lane then fills the call from the start of the book's frame.
For example, one call read pp. 62, 63, 64 and 250, where p. 250 was the confirmed page. The route was validated on 4
consecutive pages a call (#7853). That is also how the cron lane reads, because it never uses `--first`. So the 26
other pages were written by calls in a configuration the route was not validated on. Every page passed every write
guard: the 40% shared-word floor against its own stored text catches a page read from another leaf. The blind audit
below checks each write against its image. `reader-request-lane.mjs` uses `--first` the same way. A fix in the lane
would have it take the confirmed page's own block of 4.

The German page (`german-lite/unknown`) went through plain `correct` (the `lite>agy-flash-low` route) and was refused.
Every page written came from the re-read.

## Checks

- **Before:** `before-2026-11-12.jsonl` (the 34 confirmed pages) and `before-writes-2026-11-12.jsonl` (all 38 pages
  written). Both were committed and pushed before the apply (fc6f852b0, 8bac76981).
- **After** (`verify.mjs` → `written.jsonl`): all 38 pages hold new text and are stamped `ocr.pipeline =
  agy-reread-lite-7853`. Each has a `page_revisions` row under one of 11 `cli-ocr-*` run ids. Every page has its
  English marked `translation_stale`.
- **The findings** (`finding-check-2026-11-12.json`, no model, the pilot's checker): the 12 confirmed pages written
  carry 41 serious OCR findings, 24 of them checkable as quoted text.
  - 4 now hold exactly the reading the audit gave.
  - 16 changed to a reading other than the audit's exact quote. I checked 10 of them by eye: each holds the same words
    under the live prompt's convention. The audit quoted the print diplomatically (`q2 potẽtia`, `aĩe`), and the
    re-read expands abbreviations (`quia potentia`, `anime`). The other 6 are unchecked.
  - 4 could not be checked: they quote no misread.
  - Of the 20 findings with a quoted misread, that misread is no longer in the text. That is all this check shows.

## Blind audit after the write, and two reverts

The writes were checked after the fact with the #6694 instrument. `driver.mjs audit-packets`, `audit-opus` and
`audit-score` ran on all 38 pages, each judged blind against its image: stored text versus new text, order drawn per
page. The judges were a fresh sealed Opus and Gemini 3.8 Flash low on the james pool (Flash high is out of quota, as
for the pilot). The set is at `/root/jobs/repair-8632/audit-run/w38`.

| | better | same | worse |
|---|---|---|---|
| Opus | 30 | 6 | 2 |
| Gemini Flash low | 29 | 3 | 6 |

The #6694 rule allows at most 2 writes judged worse per judge. Opus passes it; Gemini Flash low does not. The rule
was set for Flash high, and on the pilot Flash low called known misreads correct.

**Reverted, 2026-11-12:** the two pages BOTH judges call worse. Both are among the 26 other pages, not the confirmed
pages.
- `69dbc8e91040d1d5e209d619` (p. 20): the re-read called a printed two-column index page "blank, show-through only"
  and wrote 0 characters over 1,591.
- `69dbcb371040d1d5e20b3c5a` (p. 111): new misreads (`cd` for `ccl`, `cisipados` for `cisipadum`).

They were reverted with `revert-run.mjs --page-ids-file`. Each page now holds exactly its before-snapshot text, its
English was never touched, and `mark-stale-translations.mjs --book` cleared its stale flag (OCR restored).

The 4 pages only Gemini Flash low calls worse are kept: Opus calls 3 of them better and 1 the same. They are listed in
the audit result.

**What the blank write shows.** A re-read that declares a page blank passes every guard, because a real blank page has
no words to share with its stored text. On this box's re-read ledger, 1,471 written re-reads are typed blank. 144 of
them, in 81 books, replaced 300 or more characters of earlier text. Some of that earlier text may itself be invention:
a Flash-Lite read of show-through. The measurement is `blank-scan.py` (disk) followed by `blank-writes.mjs`
(page_revisions).

**Sample**, one page per book: 24 of the 144, judged blind by Opus against the image (`blank-audit-set.mjs`,
`blank-audit-result-2026-11-12.json`).
- 18: the blank verdict is right. The earlier text was show-through or invention.
- **6: the blank write erased a real printed page.** Among them: a two-column *Tractatus II* page, the *De piscibus*
  woodcut page, the leaf ending *Explicit liber Geber*, a *Magnetismus* page, a two-column *De lacte* page, and
  *Vindicta Salvatoris* p. 456.

That is 25% (Wilson 95%: 12–45%), so about 36 of the 144 pages (17 to 65), on this box's ledger alone.

The cause: cli-ocr.mjs applies the 40% shared-word floor only when the stored text has at least 40 distinct words of
5 or more letters. An index, a short page or a heavily abbreviated page falls below that, and a blank read then
replaces it unchecked. A guard that refuses a blank read over stored words is proposed separately. No page outside
this repair has been reverted: that is a DECISION on #8632.

## Actuation

The stale English on the Latin pages is drained by `cli-translate-lane.mjs stale`, on agy subscription quota, in
reader order. Only books routed to `latin-cli-agy4` are re-read here, so nothing queues the paid translator.

On the French pages (8 written) the stale flag is a flag only: no lane re-translates them. Their English was made from
the old text and stays until someone re-translates it. This is a DECISION on #8632.

## Revert

`written.jsonl` lists each page with its run id and its before and after hashes. To undo one run (dry run first,
then `--apply`):

```
node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id <run_id>
```

It restores only pages that still hold exactly what the run wrote. The before snapshots are an independent copy.

**A revert restores the OCR, not the English.** If the stale lane has already re-translated a Latin page from the new
text, that English stays after the revert. It then matches neither the restored OCR nor the image. Before reverting a
page, check `translation.updated_at` against the write time. Mark the English stale again, or restore it from the
before snapshot, which holds each page's English as it was.
