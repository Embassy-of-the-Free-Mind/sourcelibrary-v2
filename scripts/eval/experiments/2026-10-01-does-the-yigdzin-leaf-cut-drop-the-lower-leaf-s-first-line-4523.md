---
stage: image
measure: judged
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: null
n_pages: 12
verdict: "The Yigdzin leaf cut does not drop the lower leaf's first line (short pages are symmetric across leaves, 7/7 by eye); the dropped line comes from whole-page reads."
status: rejected
decision: "Overlapping leaf crops not built; never-leaf-read pages left to the approved tibetan-step2 job (#4523)"
superseded_by: null
issue: 4523
---
## 2026-10-01 · Does the Yigdzin per-leaf crop drop the lower leaf's first line, and should the "lines < book median" pages be re-read? (#4523)
<!-- PRIOR ART: 2026-09-29 #5250 round-2 entry (band crops) — it found the vowel-less overlap line in BAND crops; this entry asks whether the production LEAF crop has it. -->

**Headline: NO, and the premise is retracted.** The production leaf cut (`leafsplit.detect` + `partition`, the #4722 run)
sits in the gap between leaves and does not lose lines. The dropped line is real, but it comes from the WHOLE-PAGE read,
which is still what readers get on 36% of pages. Readers get it there because those pages were never leaf-read, or because
the leaf read was refused. The planned fix was overlapping leaf crops with vowel-folded de-dup. It was **not built**. It
would solve a defect the crop does not have, and it would bring back round 2's duplicate boundary line (95/118 pages,
#5250). No GPU was spent.
- **Leaf position.** If the cut dropped the lower leaf's first line, short pages would be short on the lower leaf. They
  are not. On 2-leaf pages below their book's median, the upper leaf alone is short on 3,470 and the lower alone on
  2,642. On 3-leaf pages it is upper 3,712, middle 1,294, lower 2,558.
- **By eye (READ FROM IMAGE, cut lines drawn on a 1400 px render).** Of 7 randomly drawn "short" pages, 7 have a line
  count that matches the scan. The cut lies on bare paper or background on every one. The pages are short because they
  are title leaves, ending leaves, captures with fewer leaves than the book's mode, and books whose median is inflated
  by interlinear glosses. Then the 5 short Kangyur pages from the PR #5449 re-draw:
  - 2 were never leaf-read.
  - 3 have leaf reads that v4 refused (duplication, loop, duplication), so the whole-page read is served.
  - On `69e7ab0d…_192` the scan has 7+7 lines. The served whole-page read has 13 and lacks the lower leaf's first line
    (`མཐོང་བར་གྱུར་པ་ལ…`). The refused leaf read has all 14. Its "loop" is a sutra refrain that the old read also
    repeats.
  - On `69e7ac07…_95` the scan has 7+7. The whole-page read has 11 (it skips lines in the repeated Prajñāpāramitā
    formula) and the leaf read has 18 (it over-generates the same formula). Both are wrong, and neither is the cut.
- **The proxy is not a selector.** "Served lines < book median" flags **19.6%** of the 275K served pages, not 5%.
  Accepted leaf reads gained a median **+8.6% syllables even on pages AT their book's line count** (`atmode-ext`, n =
  46,328; +15% on the short-first todo, n = 104,125). So whole-page reads lose text broadly, the book median itself
  undercounts, and pages at the median are as lossy as pages below it.
- **Where re-reading can still change the text.** 98,940 served pages were never leaf-read; 7,333 of them are below
  their book's median. That list is written to `leaf-run-logs/never-leaf-read-short-proxy-2026-10-01.jsonl` on Hetzner.
  The 26,040 refused pages re-read identically: decoding is greedy, and DRY is deterministic. The never-read pages are
  the scope of the approved `tibetan-step2` job (93,325 multi-leaf pages; RUNNING.md), so this entry spends nothing and
  leaves that read to step 2.
- **What remains, not done here (acceptance is v4 and deliberate):**
  - The v4 `loop` check is absolute. On 47 refused pages the whole-page read carries the same 20-syllable repeat.
  - `duplication` refused 2,936 leaf reads that have more lines than the served read. By eye on one, the leaf read is
    also wrong (it over-generates), so these need a judge, not a looser rule.
- **Missing-line location (fewer-syllables refusals, 3,000 drawn, 2,638 multi-leaf).** 885 whole-page lines are absent from
  the leaf read. 305 of them lie within one line of a cut (vs ~20% by position alone), 491 are interior, and 89 are
  first or last. A mild boundary excess, but those pages serve the whole-page read, so readers do not lose these lines.
- **Design.** Whole-corpus pass over the #4722 ledger (`leaf-run-logs/pages.jsonl`, 176,512 pages), the leaf
  provenance (`_provenance.jsonl`, v4 verdicts), and the served texts (`txt-yigdzin/`, 276,447 pages). Plus 12 pages
  by eye. No model calls.
- **Replicated?** The counts are exhaustive, not sampled (except the 3,000-page missing-line sample). The by-eye set is
  small (12 pages). The two findings that change decisions are leaf-position symmetry and the at-mode syllable gain;
  each rests on > 46K pages.
- **Spend.** €0 GPU, $0 model.
- **Artifact.** `scripts/eval/tibetan-leaf-cut/audit.py` (re-runnable on Hetzner; prints the summary JSON) and
  `scripts/eval/results/tibetan-leaf-cut-2026-10-01.json`.
