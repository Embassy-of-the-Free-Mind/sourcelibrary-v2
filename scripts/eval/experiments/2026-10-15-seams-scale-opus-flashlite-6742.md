---
stage: translation
measure: [judged_vs_reference, judged]
languages: []
scripts: []
canons: []
n_books: 2000
n_pages: 4000
verdict: "31% (25-38%) of served prose page joins are defective by an Opus reference, 11% (6-16%) majorly; flash-lite with thinking detects them at AUC 0.73, but no flash-lite repair is good enough to run unattended."
status: undecided
decision: null
superseded_by: null
issue: 6742
---
## 2026-10-15 · How often does a translated page join read broken, can Opus label it, and can flash-lite detect and repair it at corpus scale? (#6742)

PRIOR ART: `2026-10-02-translation-page-boundary-3918.md` (#3918) measured 2.44% of pages carrying text across a
boundary. That was one defect, and a page-level rate. `2026-10-04-seam-markers-confirm-5678.md` and
`2026-10-03-translation-seam-confirm-5305.md` tested prompt fixes on re-translations. The Jev pilot (#4681) scored
English-only continuity. This entry measures every kind of join defect on **stored** text, per break, against the
source. Its census reuses `translation-page-boundary.mjs`'s signals unchanged, and its judge reuses #5678's
page-turn definitions.

**Who this is for.** A reader paging through an English translation. Derek reported the Chrysoloras letters
(2026-10-13) and the Arrian Periplus (2026-09-27, page 17 stopping two sentences short).

### Design

**Frame.**
- Counted exactly, not from `$sample`, by `break-frame.mjs`, on 2026-10-15.
- Books: live (`visible`, `pages_count > 0`, `pages_translated > 1`) and not held. 3,482 of 23,016 books are held and excluded.
- A break is (N, N+1) with both pages machine-translated. A page is excluded when it is:
  - written or corrected by a person, or imported from a published corpus: 5.9K pages;
  - a placeholder: 85.6K;
  - withheld: 75.8K;
  - a same-language copy: 10.5K.
- Result: **4,777,862 breaks on 19,105 books.** Non-prose joins (index, table, plate…) are 8% of draws, so the frame has **4.40M prose breaks**.

**Census ($0, `census.mjs`).**
- Draw: one break per book, uniform within the book; books in a `makeRng(6742)` shuffle of the frame; 2,000 books.
- Signals per join:
  - the source runs on across the break (cased scripts only);
  - the English closes on N and reopens N+1 fresh;
  - the English hangs on N and N+1 restarts with a capital;
  - a duplicated ≥5-word run at the facing edges;
  - a word doubled across the join (catchword echo);
  - a bracketed bridge;
  - the last or first paragraph's English/source ratio at <0.5× or >2× the page's own;
  - #3918's `dup8`, `carried`, `ocrNext` and anchors.
- The signals were tuned by eye on a 150-break pilot before the full draw. The pilot caught running heads in the English, `<-` centring marks, and caseless sources with no closing punctuation.

**Opus reference (`opus-reference.mjs`).**
- Claude CLI on the subscription, `claude-opus-5-5`, one sealed call per junction, 6 concurrent; 300 of 300 parsed.
- Input: four excerpts of at most 1,500 characters each (both sources, both Englishes, at the join).
- Output: a label (taxonomy T9/T1 omission, T5 duplication, T4 drift, T6 broken syntax or catchword, other), a severity, and a minimal repair (`tail_old → tail_new`, `head_old → head_new`).
- Strata:
  - **random**: 120, uniform over census prose joins;
  - **flagged**: 120, uniform over census `strong` flags;
  - **good**: 30 presumed-good joins (a cased source closes at the break, the English closes and reopens, no signal);
  - **plant**: 30 more such joins broken on purpose. 15 drop page N's last English sentence and 15 copy it to the head of N+1.

**flash-lite (`flashlite.mjs`).**
- Model: `gemini-3.1-flash-lite` only, through `gemini-script-client.mjs`, temperature 0. Every arm sees both sources and both Englishes.
- Detect arms:
  - D1: yes/no + p;
  - D2: typed label;
  - D3: a checklist;
  - D4: D1 with a 2,048-token thinking budget;
  - D5: D1 on 500-character windows.
- Repair arms (rewrite only the boundary sentences):
  - R1: minimal;
  - R2: align source words to pages, then repair;
  - R3: R1 with thinking.
- Verify gate: D4 is run again on each repaired join.

**Repair judge (`judge-repairs.mjs`).**
- Blind Opus pairwise judge: current vs repaired, both orders, 5 pairs per call, 189 calls.
- Run on every Opus-defective item (131) and 30 Opus-ok items.
- A/A floor: 40 items with current vs current, both orders.

### Result

**1. The Opus reference is good enough to measure against.**
- Planted breaks: **30 / 30** caught (Wilson 89–100%), each with the right label: 15 omission, 15 duplication.
- Presumed-good joins: Opus flagged 2 / 30 (7%). These were chosen by rule, not read, so both may be real.
- Five random-stratum defects read by eye against the excerpts were all real:
  - a Greek clause moved onto N;
  - a stray `French \n text \n...` opening N+1;
  - `truc-|cken` rendered "dry— …bring";
  - a Latin clause closed early on N;
  - a bracketed bridge "[SERVANT WELL]" plus a duplicate.

**2. Scale on what readers see (prose joins).**

| | any defect at the join | major (content lost or misleading) |
|---|---:|---:|
| uniform random stratum, n=120 | 29.2% (21.8–37.8) | 7.5% (4.0–13.6) |
| stratified by census flag, bootstrap 95% | **31.4% (24.7–38.4)** | **10.9% (6.3–16.0)** |
| corpus prose breaks (4.40M) | **≈1.38M (1.09–1.69M)** | **≈480K (280–700K)** |

- Random-stratum labels: broken syntax 9, duplication 7, catchword 6, omission 5, other 5, drift 3. 26 were minor and 9 major.
- By lane: realtime-unattributed 28% (n=92), chained Batch 29% (n=21), batch route 3/7.
- By model: flash-lite 24% (n=79), flash 39% (n=41). The CIs overlap.
- By source state: the source runs on, 34% (n=77); the source closes, 21% (n=43). A join is not safe because the source closes there.

**3. The deterministic signals cannot measure this defect. A few are precise.**

| census signal | precision vs Opus | recall on random stratum |
|---|---:|---:|
| catchword echo | 13/13 | 4/35 |
| `dup8` (#3918) / `carried` / `ocrNext` | 5/5 · 3/3 · 3/3 | 0/35 each |
| bracketed bridge | 5/6 | 1/35 |
| closure tell (source runs on, English closes and reopens) | 21/38 | 4/35 |
| English hangs, N+1 restarts fresh | 38/78 | 7/35 |
| `strong` (any of the above) | 80/156 (51%) | 16/35 |

- Census per-book rates (Wilson), on the 2,000-book draw:
  - `strong` 31.2% (29.2–33.2);
  - closure tell 9.1%;
  - edge duplicate 6.3%;
  - catchword echo 2.1%;
  - bracketed bridge 1.1%.
- Full strata: `census-summary.json`.
- Greek has the most closure flags: 26% of Greek joins. Han, Arabic, Hebrew and Devanagari are flagged at 8–15%, but caseless scripts make no source-side claim, so they are under-flagged by construction.

**4. Detect: flash-lite with thinking (D4) is a usable screen. Without thinking it is not.**

| arm | AUC vs Opus (real items, n=240) | AUC, major only | own call: precision / recall | plants caught | good flagged | flags on random | batch $ / 100K joins |
|---|---:|---:|---:|---:|---:|---:|---:|
| D1 yes/no | 0.60 | 0.70 | 0.64 / 0.32 | 19/30 | 1/30 | 14% | 24.82 |
| D2 typed | 0.57 | 0.69 | 0.77 / 0.17 | 16/30 | 1/30 | 8% | 26.15 |
| D3 checklist | 0.52 | 0.55 | 0.83 / 0.05 | 14/30 | 0/30 | 3% | 27.44 |
| **D4 yes/no + thinking 2,048** | **0.73** | **0.79** | **0.79 / 0.56** | **30/30** | 2/30 | 21% | **78.72** |
| D5 yes/no, 500-char windows | 0.63 | 0.76 | 0.62 / 0.44 | 22/30 | 3/30 | 23% | 13.30 |

- `p_defect` is nearly binary on every arm, so a threshold sweep adds nothing to the arm's own call.
- On the random stratum alone, D4 has precision 0.76 and recall 0.54.
- D4 AUC by language: Latin 0.71 (n=112), German 0.71 (24), English 0.82 (31), Greek 0.74 (28), French 0.75 (12).
- D4 AUC by script: Latin script 0.73, Greek 0.81, other scripts 0.68 (n=16, too few to trust).

**5. Repair: no flash-lite arm is good enough to run unattended.**

These are real Opus-defective joins (random and flagged strata). The net verdict for each item is summed over both orders.

| arm | repair applies at the edge | judged better / worse / tie vs current | repaired join still defective | on Opus-ok joins: changed, better / worse |
|---|---:|---:|---:|---:|
| Opus (self-judged ceiling) | 121/131 | 88 / 0 / 1 | 4/89 | 0 of 30 changed |
| R1 minimal | 92/131 | 52 / 15 / 2 | 32/69 | 18 of 30: 7 / 8 |
| R2 align, then repair | 96/131 | 41 / 21 / 7 | 42/69 | 18 of 30: 6 / 9 |
| R3 minimal + thinking | 72/131 | 36 / 9 / 2 | 23/47 | 9 of 30: 7 / 1 |
| R1 **passing the D4 verify gate** | 46 of 69 | **41 / 4 / 1** | 13/46 | 15: 6 / 6 / 3 tie |
| R3 passing the D4 verify gate | 38 of 47 | 31 / 5 / 2 | 15/38 | 9: 7 / 1 / 1 tie |

- **A/A floor: 0 of 80 identical pairs received a preference.** The judge has no position lean and does not invent differences.
- The Opus arm is judged by Opus. It is a ceiling, not a fair comparison.
- Why flash-lite fails to repair:
  - It calls almost every join it is asked to repair defective. R1 said "defect" on 160 of 161, including all 30 joins Opus called ok.
  - **28–41% of its repairs cannot be placed.** `tail_old` names a sentence that is not the end of page N, and whitespace-tolerant matching recovers only 1–13 per arm.
  - Half the repairs that do apply still leave a defect.
- End to end on the uniform random stratum, using the best detector and repairer (D4 detect → R1 repair → D4 verify → apply), only **2 of 35 defects** are fixed, with no harm done. R3 in the same chain fixes 3, and changes 1 Opus-ok join to a judged win.
  - D4 catches 19 of the 35.
  - R1's repair places correctly on only 8 of those 19.
  - The verify gate passes 2 of the 8.

**Spend:**
- Gemini: **$1.99** for 2,247 flash-lite calls, at list price on the real-time API (`spend.jsonl`).
- Claude: 489 Opus CLI calls on the subscription, $0 billed. They would have cost $12.28 at list price for the 300 label calls.
- Census and frame: Mongo reads only.

### Read

- **The defect is common, real, and mostly invisible to string tests.**
  - About one prose join in three reads broken against the source, and about one in nine loses or misstates content.
  - It is about as common in every lane and on both models.
  - #3918's 2.4% measured one narrow kind (text carried from a neighbour). Most defects here are broken syntax, catchwords and small omissions, which leave no string trace.
- **Flash-lite can screen but cannot fix.**
  - With thinking on it finds 56% of defects at 79% precision. Without thinking it is near chance on real joins.
  - Its repairs need an Opus-grade writer.
- **The cheap deterministic signals are a free first tranche, not a measure.** Catchword echo, `dup8`, `carried`, `ocrNext` and bracketed bridges are about 97% precise (29/30 pooled) and fire on 5.9% of drawn books' joins (7.0% break-weighted).

### Recommended apply plan (follow-up issue; no writes in #6742)

1. **Tranche 0, $0.**
   - Census the high-precision deterministic signals over the whole frame (7.0% break-weighted of 4.78M joins, ≈330K).
   - Repair those joins with **Opus**, using this job's reference prompt and format.
   - Accept only repairs that `validRepair` places at the edge.
2. **Screen with D4** (flash-lite, thinking 2,048, Batch: **$78.72 per 100K joins**).
   - Order by readership (`read_count`, featured and collection books first), not corpus-wide in one pass.
   - The whole 4.40M prose frame is ≈$3.5K: a priced row for Derek, not a default.
   - D4 flags about 21% of joins.
3. **Repair the flagged joins with Opus, not flash-lite.**
   - Opus repairs placed 93% of the time and were judged better on 88 of 89 real defects (self-judged).
   - Gate each repair on a second, blind Opus check (the judge here) before writing.
   - Subscription throughput is the limit. Here it ran about 3,000 single-join calls an hour at 6 concurrent, with no rate limit hit in 489 calls. That suits a readership-ordered queue of tens of thousands of joins, not D4's ≈900K corpus flags.
4. **Write through translate-core's `writePageTranslation`.**
   - It snapshots every change to `page_revisions` and refuses human-edited pages.
   - It changes the two boundary sentences only, with the repair recorded as provenance (`source: seam-repair-6742`, prompt hash).
5. **Not recommended:** any flash-lite repair arm, or D1–D3/D5 as the screen.

### Caveats

- Excerpts are at most 1,500 characters per side. A defect further from the edge is out of scope, and Opus was told to judge only the turn.
- The "good" controls were selected by rule, not read.
- The lane and model strata in the random set are small (21 chained Batch joins).
- Opus is the reference, not ground truth: the 5 defects read by eye were all real, but its false negatives are unmeasured beyond the plants.
- Flash-lite's 429 quota errors were retried, so 3 calls are missing (D3 1, D5 1, R2 1).
- The rarity of the `<Language> text ...` opening artifact (2 of 2,000, both March 2026, `gemini-3-flash-preview`) puts it below an issue of its own.

**Artifacts.**
- Scripts: `scripts/eval/seams-6742/` (`break-frame`, `census`, `opus-reference`, `flashlite`, `judge-repairs`, `score`).
- Results: `scripts/eval/results/seams-6742/` (README there).
