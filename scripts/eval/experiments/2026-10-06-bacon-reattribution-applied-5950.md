---
stage: metadata
measure: accuracy
languages: []
scripts: []
canons: []
n_books: null
n_pages: 238
verdict: "Read in full, the same-book tier was right on 143 of 163 Bacon moves (88%) and the note tier on 61 of 63; with by-eye fixes 340 mentions moved to Roger or Francis."
status: adopted
decision: "340 mentions moved in production; by-eye verdicts outrank the tiers and every same-book and note proposal is read before an apply (#6024)"
superseded_by: null
issue: [5950, 6024]
---
## 2026-10-06 · Moving "Bacon" mentions to Roger and Francis: applied, and how good each evidence tier was (#5950)
<!-- PRIOR ART: 2026-10-06-shared-name-mislinks-5950.md measured how many mentions sit on the wrong person and dry-ran this plan, checking 5 moves per tier. This entry is the apply and the full read of two tiers that the 5-row check could not judge. -->

- **Question.** The dry run proposed 351 moves off the bare "Bacon" record on four kinds of evidence and checked five of each by eye. Applied to production, are the moves right?
- **Answer.** **Not all, and the 5-row check could not have shown it.** The first apply moved 351 mentions. Re-reading 20 found one wrong, in the same-book tier. Reading that tier in full: **143 of 163 right (88%), 15 wrong, 5 not decidable from the page.** The note tier in full: 61 of 63 right, 2 not decidable. The printed-cue tier was sampled only: 12 of 12. The apply was undone from its undo file and run again with the 22 by-eye verdicts entered. Now on production: **340 mentions moved (223 to Francis Bacon, 117 to Roger Bacon), 164 left on "Bacon"** (30 held on date alone, 11 left by eye, 123 with nothing that decides).
- **measure:** accuracy of the proposed person against one reader (the model that ran the job) reading the page text. One judge, no second reading. The printed tier's figure is a sample of 12.

### What was read

| Tier | Moves in the first apply | Read | Right | Wrong | Not decidable |
|---|---|---|---|---|---|
| printed cue on the page | 123 | 12 (7 here, 5 in the dry run) | 12 | 0 | 0 |
| same book names one of them in full | 165 (163 pages, 2 section entries) | 163 pages | 143 | 15 | 5 |
| translator's note or keywords | 63 | 63 pages | 61 | 0 | 2 |

- The 20-mention check is `bacon-apply-check.tsv`: 19 of 20 as read (one row repeats a page from the dry-run check, so 19 new pages).
- **The same-book errors come in whole books.** Rozanov's *O ponimanii* (1886) names Roger Bacon once in full and means Francis on seven other pages ("the logic of Bacon" against Aristotle's). A 1709 Dutch recipe book cites "the Physician Bacon", a third man, on four pages. Francis Bacon's own *Temporis partus masculus* says "qualis est Bacon" of Roger. Kittredge, Dutens and one page of *Isis Unveiled* are Francis in books that name Roger.
- The 7 undecidable: "conviction comes not through arguments but through experiments, says Bacon" (twice); Bacon on garlic and the lodestone; the powers of phantasy "according to Bacon" (two pages of Wirdig); a scholastic "Bacon" on the Intelligences in Raynaud (two pages, probably John Baconthorpe). They were put back on the bare record.

### What changed in the method

- `SURNAMES.<name>.byEye` in `scripts/audit/shared-surname-reattribution-plan.mjs`: a page read by eye outranks the tiers (#6024). **Read every same-book and note proposal before an apply.** At 163 + 63 short passages that took about twenty minutes.
- **The plan must not read its own moves as evidence.** A dry run after the first apply proposed 21 further moves, only because the apply had put those books on a person's record. Each `sweep_log` move row now records `target_had_book`; rows that say no are left out of the same-book evidence. After the second apply a dry run proposes 0.

### The writes

- Three `entities` documents, one transaction: "Bacon" 211 → 98 books, 494 → 156 page mentions; "Roger Bacon" 470 → 482 books; "Francis Bacon" 243 → 291 books. No entry the two targets held before was lost or shortened (checked against the undo file).
- `sweep_log`, sweep `shared-surname-reattribution-5950`: 147 rows from the first apply, one `entity-moves-undone` row, 144 rows from the second.
- Undo: `scripts/eval/shared-name-mislinks/undo/bacon-reattribution-2026-10-06.json` (the old `books[]` of all three), applied with `--undo`.
- The same day, the one-person claim was cleared on the bare records Montanus, Bruno, Fabricius and Agrippa (`scripts/maintenance/clear-bare-surname-claims.mjs`; undo file beside the other).

### Limits

- The printed tier is 123 moves and 12 were read. Its cues are explicit ("Rogerius", "Verulam", a title), but the same-book tier also passed its first five.
- One reader. The translation's notes were stripped from what the tiers saw, but not from what I saw.
- It decays. A re-index of a moved book writes that book's entry on "Roger Bacon" again from the book's own index, without the moved pages, and the full rebuild (`POST /api/entities`) does that for every book at once. Mentions then go missing; they do not go back to the wrong man once #6026 is merged.
- 2 section-precision entries moved with no page to read.

**Next:** #6026 (the index writers stop attaching a held surname to a person record), then the next surnames on #5950.
