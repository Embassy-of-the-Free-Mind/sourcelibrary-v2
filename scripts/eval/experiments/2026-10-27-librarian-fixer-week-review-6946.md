---
stage: pipeline
measure: judged
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Stage 2 NO-GO. One week of live dry run (212 answers, 830 links, 0 errors): by reading, 11 of 20 proposed moves and 15 of 20 drops are right (gates: 95% and 90%). Gemini agrees with the fixer on 35% of moves and 78% of drops (Flash, n=100) and on 33% and 50% (Argon, n=36). There are three systematic failures: a keep whose span fails validation is turned into a drop; links are moved off a page that already states the claim; and spans match inside our own <note> text."
status: rejected
decision: "Do not apply librarian_citation_fixes to embassy_messages. The dry-run worker keeps running. Fix the three failure shapes in src/lib/embassy/citation-fixer.ts, then re-run this review (scripts/eval/librarian-fixer-week-6946/)."
superseded_by: null
issue: [6946]
---
PRIOR ART: `2026-10-20-librarian-citation-fixer-6946.md` (stage 1: the fixer measured on the replay, which installed this dry run); `scripts/eval/librarian-fixer-6946/` (its harness). This entry is the one-week review that stage 1 deferred stage 2 to. It is the first look at the fixer on live answers rather than the replay.

## 2026-10-27 · Citation fixer, one week of dry run: is it safe to apply? (#6946)

**Who it is for.** A reader who clicks a page link under a Librarian answer. Stage 2 would rewrite stored answers with the fixer's moves and drops, so every wrong edit becomes a wrong link, or a false "(not from the library's pages)", that the reader sees.

### 1. Health of the dry run (2026-10-19 → 2026-10-27, `health.mjs`)

| message day | answers written | recorded | proposed | no change | skipped | error | links |
|---|---:|---:|---:|---:|---:|---:|---:|
| 10-19 | 2 | 2 | 0 | 2 | 0 | 0 | 10 |
| 10-20 | 25 | 25 | 7 | 14 | 4 | 0 | 93 |
| 10-21 | 34 | 34 | 14 | 18 | 2 | 0 | 149 |
| 10-22 | 10 | 10 | 4 | 4 | 2 | 0 | 27 |
| 10-23 | 52 | 52 | 18 | 14 | 20 | 0 | 160 |
| 10-24 | 29 | 29 | 13 | 10 | 6 | 0 | 153 |
| 10-25 | 25 | 25 | 9 | 8 | 8 | 0 | 71 |
| 10-26 | 20 | 20 | 8 | 9 | 3 | 0 | 92 |
| 10-27 (to 08:00) | 15 | 15 | 2 | 11 | 2 | 0 | 75 |
| **total** | **212** | **212 (100%)** | **75** | **90** | **47** | **0** | **830** |

- **Coverage.** Every AI message in `embassy_messages` up to the checkpoint has a row; none is missing. The 47 skipped are 30 with no page link, 8 greetings, 7 pings and 2 duplicates.
- **Answers it would change.** 75 of the 165 it ran on (45%).
- **Per link (830):**

  | outcome | links | share |
  |---|---:|---:|
  | keep | 618 | 74.5% |
  | **move** | **26** | **3.1%** |
  | **drop** (model said drop) | **79** | **9.5%** |
  | **drop_unverified** (keep or move whose span failed) | **10** | **1.2%** |
  | left as written: caption 78, no verdict 7, span too short 6, page not loaded 6 | 97 | 11.7% |

  115 links (13.9%) would change.
- **Latency.** Fixer call p50 8.6 s, p90 13.9 s, max 42.9 s. Lag from answer to row: p50 7.3 min, which is the 10-minute cron.
- **One outage.** There were no runs from 2026-10-21 03:30 to 10-22 22:10 UTC (42.7 h), so 31 answers waited more than 24 h. The cause is not visible from main: the run log is on l7a, and the box mesh has no verb to read it. The worker's own guards (Claude account ≥ 90% weekly / ≥ 80% session) skip a run without writing a row, so a near-limit account would look like this.
- **Subscription calls:** 165 `claude -p --model sonnet` calls that recorded a row. Calls cut by a usage-limit reply are not recorded and are not countable from Mongo.

### 2. Gemini cross-label (`build-sample.ts`, `label-gemini.mjs`, `score-gemini.mjs`)

**Sample.** 100 links, seed 6946:
- keep: 37 drawn from 618;
- move: all 26;
- drop: 37 drawn from 89 (33 drop, 4 drop_unverified).

Each item gives Gemini the answer's paragraph with the link marked and the whole linked page (plus, for a move, the whole target page), with translation and original. Gemini is not told what the fixer decided. It labels each page supported / partly / not and quotes the deciding sentence.

**Instruments.** `agy -p` on main, subscription, $0. agy lists no model named "Pro"; its top Gemini tier is **Argon** (`gemini-4-argon-medium`). Argon is capped at 40 calls a day per box (agy-guard), so Argon labelled a stratified 36 (12 per stratum) and **`gemini-3.8-flash-high` labelled all 100**. The two give identical labels on 23 of 35 shared links.

Agreement means:
- keep: the linked page is "supported";
- move: the target is "supported" and the linked page is not;
- drop: the linked page is "not".

| stratum | Flash n | **Flash agrees** | Flash: linked page | Flash: target | Argon n | **Argon agrees** | Argon: linked | Argon: target |
|---|---:|---:|---|---|---:|---:|---|---|
| keep | 36 | **27 (75%)** | supported 27, partly 9 | | 12 | **10 (83%)** | supported 10, partly 2 | |
| move | 26 | **9 (35%)** | not 14, partly 7, supported 5 | supported 10, partly 9, not 7 | 12 | **4 (33%)** | not 2, partly 7, supported 3 | supported 6, partly 5, not 1 |
| drop | 37 | **29 (78%)** | not 29, partly 6, supported 2 | | 12 | **6 (50%)** | not 6, partly 3, supported 3 | |

One Flash keep reply did not parse. The full disagreement lists are in `results/flash-score.md` (34) and `results/argon-score.md` (16).

**Systematic, not noise:**
- **drop_unverified.** In all 4 sampled, Flash rates the linked page supported (3) or partly (1).
- **Moves.** Flash rates the linked page "supported" or "partly" in 12 of 26 moves, so the fixer moved a link off a page that already stated the claim. On 7 of 26 the target does not state it at all.

### 3. By reading (`results/reading.tsv`, every deciding sentence quoted)

I read 20 moves and 20 drops myself against the whole pages: the first 20 of each stratum in the sample, which include all 12 of each that Argon labelled. Each is labelled right or wrong with the reason. A move is **right** if the target states the claim and the move does not leave a page that states it at least as well. A drop is **right** if the linked page does not state the claim.

| | read | right | wrong | of the wrong: borderline (a partly-stating page) | gate |
|---|---:|---:|---:|---:|---|
| **moves** | 20 | **11 (55%)** | 9 | 3 lateral | ≥ 95%: **fail** |
| **drops** | 20 | **15 (75%)** | 5 | 2 | ≥ 90%: **fail** |

Both gates fail however the borderlines are counted:
- moves: 11–14 of 20;
- drops: 15–17 of 20.

Even the stage-1 sense of a wrong move (the new page does not state the claim at all) gives 2 of 20 (#0, #9), which is 90%, under 95%.

My labels agree with Argon's on 18 of the 24 links both read. The 6 differences are all cases where I was more lenient to the fixer: three neutral moves, two index or summary pages, and one title page.

### The three failure shapes

1. **A keep whose span fails validation becomes a drop.** `validateVerdicts` turns `keep` with an unmatched span into `drop_unverified`, which removes the link and adds the marker. Two of 2 read are wrong, and Gemini rates 4 of 4 sampled as stated on the page.
   - Rosetta p.173 says "Ptolemy, ever-living, beloved of Ptah"; the span added "the".
   - Kircher p.968 says "the spirits, which, being rendered thinner, swifter, and warmer, dissipate … those humors"; the span was copied from elsewhere.

   **Fix:** a failed keep span should leave the link as written, not drop it.
2. **Moves off a page that already states the claim.** The prompt says "Prefer keep", but the model moves to whichever page has the more verbatim run. Read cases:
   - Waite p.257 → 264;
   - Mersenne p.551 → 550 (p.551: "the strings of the other instruments that happen to be at the unison … will respond to them");
   - Visscher p.177 → the Arabic Bible ("on Elisha his Spirit has rested doubly");
   - Montelius p.12 → 13;
   - Godelmann p.153 → 152.

   Two related sub-cases:
   - **Stitched or range citations** get half-fixed: Allen p.185/188, and Cooke "Página 328-330", whose label `moveIn` rewrites to "Página 330-330".
   - **Cross-book moves** leave the prose naming the old book: "In the *Rasa Jala Nidhi* …" now links Rasaratnasamuccaya.

   **Fix:** move only when the linked page is judged not to state the claim (a separate keep check on the linked page alone), and never on a range label.
3. **Our own translator `<note>`s count as page text.** `readablePages` keeps `<note>` bodies, so a span can match an editorial note:
   - Poimandres → Patrizi p.219, whose only words "a vision of the creation of the universe" are our note;
   - AGLA on Key of Solomon p.75, and Pushpaka on Ramayana p.44, where the linked page states the claim only in a note.

   **Fix:** strip `<note>`/`<gloss>` bodies before span matching.

### Recommendation

**Stage 2: NO-GO.** Neither by-reading gate is met, and Gemini shows systematic failures, not scatter. So `apply-librarian-citation-fixes.mjs` was not written; the brief asks for it only on a go. The dry run should keep running unchanged. After the three fixes above, re-run `build-sample.ts` → `label-gemini.mjs` → read, on rows written by the new prompt version (`promptVersion` changes with the prompt).

**Spend.** $0:
- Gemini: 136 `agy -p` calls on the subscription (36 Argon, 100 Flash-high); no Gemini API.
- Claude: the reading was done in this job's own session.
- No writes to `embassy_messages`, the threads, the replay cache or the l7a cron.
