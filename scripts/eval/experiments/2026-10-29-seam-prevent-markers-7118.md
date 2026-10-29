---
stage: translation
measure: [judged]
languages: [la, de, fr, grc, it, es, nl]
scripts: [latin]
canons: []
n_books: 120
n_pages: 240
verdict: "On the production CLI lane (3.8 Flash low via agy), folio markers cut broken page joins from 35.5 to 16.4 per 100 (28 vs 7 discordant, p 0.0003; A-vs-A swing 8.2) and majors from 10 to 3. Markers + catchword label scored 10.9, but the catchword label fails its spurious-label guard (10% and 18% vs ≤ 5%). By the registered rule, markers ship and the catchword label does not."
status: adopted
decision: "Folio markers ON in scripts/batch/cli-translate.mjs read, for consecutive Latin-script page pairs (TRANSLATE_FOLIO_MARKERS_CLI=0 turns them off); an unusable or unbalanced split falls back to one page per call. Catchword label not shipped; re-test MC with a stricter rule (#7118)"
superseded_by: null
issue: 7118
---
## 2026-10-29 · Do folio markers and a catchword label stop broken page joins on 3.8 Flash? (#7118)

PRIOR ART:
- `2026-10-04-seam-markers-confirm-5678.md`: markers on Lite 26 → 19 and on the old Flash 16 → 11 per 100 breaks (p 0.105 and 0.18), on the paid Batch lane.
- `2026-10-16-seam-prompt-candidate-6742.md`: one edge instruction on 3.8 Flash had no effect, and the A-vs-A swing was 6.7 per 100. Its harness (`seam-prompt-6742/ab.mjs`) is followed call for call here.

**Answer for Derek.** Yes for markers, which are now on in the CLI lane; not yet for the catchword label. On 3.8 Flash, markers more than halve broken joins (35.5 → 16.4 per 100) and cut majors from 10 to 3. The catchword label is kept on every catchword page, but it also labels words that are not catchwords too often.

**Design.**
- Preregistered in `PREREGISTRATION-seam-prevent-7118.md` (commit a5b280a7a) before any arm ran.
  - Amendment 1 came after the draw, before any arm ran: the spurious-label denominator.
  - Amendment 2 came during translation, before any judging or scoring. N+1's own foot catchword no longer counts as "doubled".
- Sample:
  - 120 true mid-sentence page breaks, one per book, on served Latin-script prose, with no book from the #6742 set.
  - The source runs on by both tests: N's body is unpunctuated or ends on a hyphen, and N+1 opens on a lowercase clause.
  - 40 have a catchword the production device detects. 165 books were scanned to find them.
  - Languages: Latin 66, German 23, French 10, 6 catalogued as Greek but with Latin-script source pages, and 15 others.
- Arms, all `gemini-3.8-flash-low` via agy (the second account, `AGY_HOME=/root/.agy-james`):
  - **A**: production (v13 + `PAGE_BREAK_SCOPED`, one page per call, N seeded with the stored N−1, N+1 with the arm's N).
  - **A2**: A again.
  - **M**: one marked call for (N, N+1) with the stored N−1 as continuity.
  - **C**: A + a catchword rule (`<catchword>word</catchword>` once at N's foot, the word translated on N+1).
  - **MC**: M + C.
- Judge: one blind Opus call per break. It sees the source edges and six versions (A, A2, M, C, MC, plus an identical copy of A), with labels, `<summary>`, `<meta>` and `<catchword>` removed, as the continuous view reads them. Each version gets an `opus-reference` label and severity. A second call shows the versions in reverse order. A version is defective or major only when both calls say so.
- 110 breaks are compared. 10 were dropped because Gemini's filter or a cut reply left one arm unread ("This request was blocked by Gemini's filters", on alchemical and chemical pages, in every arm alike). A marked reply that did not parse counts as a defect.

**Result (110 breaks; per 100 joins, defective in both orders).**

| | A | A2 | M | C | MC |
|---|---:|---:|---:|---:|---:|
| defective | **35.5** | 27.3 | **16.4** | 26.4 | **10.9** |
| major | 9.1 (10) | 3.6 (4) | 2.7 (3) | 5.5 (6) | 3.6 (4) |
| broken syntax / forced closure | 19 | 15 | 4 | 15 | 2 |
| duplication | 10 | 8 | 0 | 6 | 1 |
| catchword label (mishandled) | 12 | 9 | 2 | 9 | 1 |
| omission | 8 | 4 | 4 | 7 | 3 |
| drift (≥ 6 words on the wrong side) | 0 | 0 | 5 | 0 | 4 |
| marked reply unparsed (counted defective) | — | — | 1 | — | 2 |
| catchword stratum (n = 36), defective | 27.8 | 19.4 | 16.7 | 22.2 | 8.3 |

- **Paired against A (discordant breaks, one-sided sign test):**
  - M: 28 better, 7 worse, p 0.0003.
  - MC: 32 vs 5, p < 0.0001.
  - C: 17 vs 7, p 0.032.
  - A2: 12 vs 3, p 0.018.
- **The A/A swing is 8.2 per 100**, and A2 itself beats A at p 0.018. Two draws of the same request differ a lot: A was an unlucky draw. M also beats A2: 24 vs 12, p 0.033.
- **Judge floor:** the copy of A got A's verdict on 110 of 110 breaks.
- **Catchword label** (36 catchword breaks):
  - C kept the label on 36 of 36; MC kept it on 33 of 36 and dropped 3. Neither ever doubled one.
  - Spurious labels on the 53 breaks whose OCR records no catchword: C 9 (18%), MC 5 (10%). The guard was ≤ 5%.
  - Read by eye, about half of these spurious labels are real printed catchwords the OCR never tagged: `in sua`, `Be-|sol`, `Sed ni|hil`, `reli-`. The rest are invented: `Per tanto`, `aux`, `licet`, an Arabic `من`.
- **Rule output:**
  - M: Δ 19.1 > swing 8.2, p < 0.10, majors 3 ≤ 10. **Ships.**
  - MC passes the arm rule as well. C passes it on noise of the same size as A2's.
  - The catchword rule fails for C and for MC, on spurious labels only: catchword and duplication labels fall, and omissions do not rise.
  - Registered tie-break: M and MC both pass but the catchword rule does not, so **M ships**.

**What markers change.**
- They remove forced closures and duplications at the turn (broken syntax 19 → 4, duplication 10 → 0), as on the old models in #5678.
- What is left is drift: a marker set a clause or more early or late (0 → 5). That costs nothing in the continuous view, but the page view shows words on the wrong page.
- Example, `69b51e35…:71` ("Sed ni|hil ad hunc locum"): A renders `ni` as "unless" and the join does not parse (major in both draws). M gives "But this is noth|ing to the present discussion".
- Example, `69af423a…:112`: A drops `consociaret`, leaving a verbless clause; M reads "namely to connect Propertius with ancient | myths".

**Post hoc, not registered: a balance guard in the shipped code.**
- One of M's majors, `69b52594…:8`, is a marker set half a page early: page N+1's span opens with page N's second half. MC's one drift major (`69b51de5…:14`) is the same shape.
- For every one-page read in this run, a page's English-per-source length divided by its neighbour's fell between 0.6 and 1.48. These two fell at 0.33 and 0.5.
- The shipped split refuses a pair outside [0.6, 1.67] and reads the two pages one by one, which is production's behaviour before this change.
- Replayed on M's 116 reads, it refuses 4: the major, one ok join, and 2 breaks dropped from the comparison.
- Unparsed replies take the same fallback. So in the lane, 2 of M's 3 majors would have been one-page reads.

**What shipped** (same PR):
- `cli-translate.mjs read` translates two consecutive Latin-script pages that both need a read in one marked call (`buildBlockTranslationPrompt` with `folioMarkers`).
- Each page gets its own span, with the block's summary and keywords. The meta records `prompt_variant: sentinels-6523+folio-markers-7118` and `folio_block`.
- The fallback, or any instruction-file line, gives the old one-page read.
- Default ON; `TRANSLATE_FOLIO_MARKERS_CLI=0` turns it off.
- Not touched:
  - the chained Batch lane's `TRANSLATE_FOLIO_MARKERS` (flash-lite, still off);
  - non-Latin scripts, never measured here;
  - `stale-retranslate-6567.mjs` (Chinese).
- Only every other join sits inside a pair. The joins between pairs stay page-bounded, as A, so the expected lane-wide drop is about half the measured one.

**What this cannot say.**
- The judge reads a window at the turn, not whole-page accuracy.
- The run used two-page blocks only.
- Latin script only.
- The A/A difference is large, so a single run's ranking of C against A means little.

**Next.** Re-test MC (best measured, 10.9) with the spurious guard scored against catchwords read off the page image, not the OCR tag. Also test longer marked blocks (3–4 pages), so that more joins fall inside a call.

**Spend.** $0.
- agy (subscription, second account): 963 translation calls, including the failures. The box's default agy login had no token (8 calls failed on an auth prompt), so the run used the second account.
- Claude CLI (subscription): 220 Opus judge calls, $19.16 list-equivalent, not billed. Weekly meter at 0% at the start.

**Artifact.** `scripts/eval/results/seam-prevent-7118/markers-catchword/` holds `report.json` (the rule output and every break's verdict per arm), `reads.jsonl.gz`, `judge.jsonl.gz`, `key.jsonl` and `build.json`. Harness: `scripts/eval/seam-prevent-7118/ab.mjs build|translate|judge|score`. The OCR context (`ctx.jsonl`) is rebuilt from Mongo by `build` and not committed.
