---
stage: translation
measure: judged
languages: [bo]
scripts: [Tibt]
canons: [derge-tengyur]
n_books: null
n_pages: 20
verdict: "The verse memory failed its gate: of 20 proposed replacements read against the Tibetan, 15 were better, 2 no better and 3 worse (bar 18 and 0), all from span mapping."
status: rejected
decision: "No write; round 2 (whole blocks only) also failed its gate (#6141)"
superseded_by: null
issue: 6141
---
## 2026-10-07 · Tengyur: what does each section read like, and can one reviewed rendering per much-quoted root verse replace the scattered page-by-page ones? (#6141)
<!-- PRIOR ART: 2026-10-07-tengyur-weak-section-levers-6121.md (re-translation levers; no lever adopted, and its vol 174 p312 read proposed this verse check) and the 2026-10-07 shelf overview (`results/spot-check/overview-2026-10-07/`, the Tengyur as ONE stratum). Neither split the Tengyur by section or compared the renderings of one verse across pages. -->

**Question.**
1. What is the "before" for each Tengyur section?
2. Do the root verses that commentaries quote again and again read differently from page to page?
3. Would one reviewed rendering per verse (a "verse memory"), written over only the verse lines, make those pages better?

**Answer.**
- **The baseline:** serious-page rates are 0–13% by section; Pramāṇa and Vinaya carry the serious pages.
- **The verses do diverge,** and the detector finds them: 3,766 verses recur on 3 or more pages.
- **The verse memory did not pass its gate.** Of 20 proposed replacements read against the Tibetan, 15 were better, 2 were no better and **3 were worse** (the bar was 18 or more better, 0 worse). Nothing was written.
- All three worse cases come from **span mapping**, not from the references. The English verse block does not map line for line onto the Tibetan pādas: a prose lead-in sits inside the block, or the block reorders the verse. Replacing "lines i–j" then drops the lead-in or duplicates a line.
- The references themselves held up. The blind checker graded 46 of 50 `ok`, and in the 20 read by eye none was the cause of a worse page.

These are AI reviewers (Opus), checked by Claude, not a human review.

**Step 1: baseline by section** (`results/spot-check/overview-2026-10-07-tengyur-sections/`). Method: `shelf-overview`, 4 volumes × 4 pages per stratum, seed 2026100741, hidden books included; REVIEWER.md and OVERVIEW-ADDENDUM.md unchanged; one Opus reviewer per stratum.

| section | frame (vols) | serious pages (95% CI, by book) | EN | on-sight | show / caveat / don't |
|---|---|---|---|---|---|
| Pramāṇa | 20 | 13% (0–38%) | 3.94 | 1/4 | 0 / 4 / 0 |
| Madhyamaka | 17 | 6% (0–19%) | 4.19 | 3/4 | 1 / 3 / 0 |
| Vinaya | 18 | 13% (0–25%) | 3.88 | 4/4 | 0 / 4 / 0 |
| tantra commentary | 78 | 0% (0–0%) | 4.19 | 1/4 | 2 / 2 / 0 |
| sūtra comm. + Cittamātra + Abhidharma | 37 | 0% (0–0%) | 4.50 | 1/4 | 3 / 1 / 0 |
| Jātaka + Miscellaneous | 14 | 0% (0–0%) | 3.88 | 1/4 | 0 / 4 / 0 |

- **Frame-weighted serious-page rate: 3%.** The weights are volumes per frame. Quote the intervals: there are 4 books per stratum.
- **Not in the frame:** 29 volumes (Praises, Prajñāpāramitā, Letters, Grammar, Catalogue).
- **Classes on 3 or more distinct books:**
  - Esukhia `#` and `{a,b}` markup visible in the Tibetan pane, about 11 of 24 volumes (#5797).
  - An invented "line missing" note at the page foot, vols 180, 126 and 174 (#5678).
- **Vinaya Pali names:** not confirmed in this draw.

**Step 2: verse-consistency detector** (`tengyur-improve/verse-detect.mjs`, $0, reads `dump-pages.mjs`'s dump of all 128,333 pages with English).
- **What counts as a verse.**
  - A pāda is a segment in a run of 2 or more consecutive shad-delimited segments of equal length (7, 9 or 11 syllables).
  - Pāda pairs adjacent on 3 or more pages are linked into verses. A weak link is cut if w < 0.25 × the rarer pāda's page count, and components over 8 pādas are chunked into 4s.
  - Prose enumerations (half or more of the pādas end in དང) are dropped.
- **Matching the English.** Each Tibetan run is aligned to the page's English verse blocks: monotone, line count within ±1, relative position.
  - Divergence is the mean pairwise (1 − character-trigram Dice) over the verse's most-rendered span.
  - Root text: the `{D####}` text the page is in. PV D4210, MMK D3824/D3860, AK D4089/D4090 and BCA D3871 count as "Sanskrit held".
- **Result** (`summary.json`, `verses-top200.json`).
  - 3,766 verses recur on 3 or more pages; 1,011 occur inside a root text whose Sanskrit we hold.
  - The top 200 by pages (median 18 pages) are mostly tantric liturgy: 35 MMK, 2 AK, 1 PV.
  - Pramāṇa commentaries weave PV into prose, so few PV verses are seen as verse.
  - **Only 25% of quotations (6,788 of 26,818) have a matchable English verse block.** The draft often renders a quoted verse as prose.

**Step 3: verse memory, dry run** (`verse-packets.mjs`, `DRAFT-PROMPT.md`, `check-packets.mjs`, `CHECK-PROMPT.md`, `scripts/maintenance/verse-memory-6141.mjs`; $0 API, 12 Opus subagent runs on the subscription).
- **Selection:** the top 50 verses by pages × divergence, with 3 or more renderings of their primary span: 259 stored renderings in all, every one of them shown to the drafters.
- **Drafters (6):**
  - one reference per verse, one English line per pāda;
  - 18 verses located in our Sanskrit (locus and page URL only; no Sanskrit is committed);
  - 28 of 259 renderings flagged as misaligned (the line matching was wrong);
  - grades of the rest: ok 131, weak 83, wrong 17.
- **Blind checkers (6):** they graded the reference shuffled among the stored renderings under opaque ids.
  - The reference was `ok` for 46 of 50 verses and the checker's best for 39.
  - Stored renderings: ok 103, weak 73, wrong 55.
  - The two readers agree on ok/not-ok for 169 of 231.
- **Proposal rule:**
  - the reference is `ok` blind;
  - both readers graded the stored lines weak or wrong (77 pages);
  - the block has exactly one line per pāda of its run (29 skipped);
  - no `<note>` inside the lines (8 skipped);
  - not human-edited, and no open `translate_batch_runs` run.
  - **40 proposals.**
- **Gate: 20 drawn with seed 6141, read by Claude against the Tibetan** (`byeye.tsv`). 15 better, 2 no better, **3 worse**, so the gate FAILED.
  - Better examples:
    - MMK 3.2 had been turned into a counterfactual ("If seeing were its own self").
    - MMK 1.7 had dropped its verb.
    - "View the authentic as truly authentic" misparsed ཡང་དག་ཉིད་ལ་ཡང་དག་ལྟ.
    - A request had been rendered "I bow to you".
  - Worse:
    - a block that reorders the verse across lines (vol 73 p487), sliced;
    - a lead-in "The Bhagavan is said to possess six excellences:" inside the block, lost;
    - a lead-in "The teacher then says:" inside a 5-line block, lost, and a line duplicated.

**Consequences.**
1. **No write.** Step 4 was gated on 18 or more better and 0 worse. Nothing changed in `pages`, `page_revisions` or the mirrors, so there is no step 5.
2. **The fix is mechanical, and it needs a fresh gate.**
   - Replace only whole blocks whose line count equals the pāda count, never a slice.
   - Refuse a block that has a lead-in line (ending in ":").
   - Show the readers the whole block, not the sliced lines.
   - Re-draw 20 from the narrowed set, excluding the 20 already read.
   - The 50 references (`verse-memory.json`) can be reused as they are.
3. **The reach is small even when it works.** At most about 25% of quotations have a verse block to replace. Pramāṇa, where the #6121 error sits, quotes PV in prose. A verse memory for Pramāṇa would have to locate the verse inside prose, which is a translation task, not a splice.
4. **Divergence is half misalignment.** The drafters flagged 11% of matched renderings as another verse. Rank verses by divergence only after a reader has confirmed the matching.

**Replicated?** No. It is one run, and the gate is n = 20 read by one Claude session (the same model family as the drafters and checkers).

**Artifacts.**
- `results/spot-check/overview-2026-10-07-tengyur-sections/`: strata, packets, reviews, report.
- `results/tengyur-improve-6141/`:
  - `summary.json`, `verses-top200.json`;
  - `verse-memory.json` (50 references, loci, blind grades, hashes);
  - `step3-stats.json`, `proposals-dryrun.json` (40 before/after spans);
  - `byeye-draw.json`, `byeye.tsv`.
- **On the box only:** `/root/timp/` (page dump, occurrences, packets, drafts, checks; Sanskrit transcriptions in `/root/timp/sanskrit/`).
