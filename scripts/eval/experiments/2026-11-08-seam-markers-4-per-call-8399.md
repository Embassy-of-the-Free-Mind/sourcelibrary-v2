---
stage: translation
measure: [judged]
languages: [la, de]
scripts: [Latn]
canons: []
n_books: 69
n_pages: 480
router_evidence: "none — a seam/leak term on latin-cli-agy4 and german-cli-agy4, not page-acceptance k/n for rules.json; recorded in scripts/eval/estimator/router-table/2026-11-08-seam-markers-8399.json and as evidence on both rows of scripts/lib/translation-routing-table.json"
defect_rates: scripts/eval/results/seam-markers-8399/defect-rates.json
verdict: "On 120 four-page blocks (69 Latin/German books, 3.8 Flash low via agy), sending a block as one marked text with no previous-page English did not beat production. With the 8,000-character budget (Bb), broken joins rose from 17.4 to 26.9 per 100 (Δ +9.5 [2.9, 16.4]; A-vs-A2 swing 2.8), and 51 per 100 at dense call boundaries. At a fixed 4 a call (B4) it was 19.8 (inside the noise), but the page judge accepted fewer dense pages (18/39 against A's 22.5). Adding one seam call per call boundary (C) cut joins to 8.8 (Δ −8.6 [−13.1, −4.2]). Leaks the translation call made: A 2, A2 2, B4/Bb/C 0. By the registered rule A stays and the seam pass is the follow-up."
status: rejected
decision: "A (per-call=4, page tags, previous-page English) stays on latin-cli-agy4 and german-cli-agy4. The --folio-markers / --block-chars reader flags stay opt-in (default off) in claude-translate.mjs for the follow-up. Follow-up: the seam pass (arm C) as a production stage after per-call reads, on #8399."
superseded_by: null
issue: [8399, 5026, 5103, 7118]
feeds: route
---
## 2026-11-08 · Do folio markers at 4 pages a call, with no previous-page English, stop text landing on the wrong page? (#8399)
<!-- PRIOR ART: 2026-10-29-seam-prevent-markers-7118.md (markers on page PAIRS, adopted in cli-translate.mjs; its judge
and harness are imported, not rebuilt: seam-prevent-7118/ab.mjs, seams-6742/lib.mjs, opus-reference.mjs); the per-page
judge is route-judge-6740/judge.mjs with paired-arm.mjs; the leak flag is scripts/audit/translation-page-boundaries.mjs
sharedRun. Harness: scripts/eval/seam-prevent-7118/blocks4-8399.mjs. -->

**Answer for Derek.** No. Markers at 4 a call are no better than production at the page joins, and the density budget
you asked for makes them worse. It splits dense blocks into 1- or 2-page calls, and each new call starts with no context.
What works is one extra seam call at every call boundary: it halves broken joins, 17.4 → 8.8 per 100. That pass is the
follow-up, and nothing in the translation lane changes now.

**Design.** Preregistered in `scripts/eval/PREREGISTRATION-seam-markers-8399.md` (commit 12a411cd4) before any arm
ran. Amendment 1 (01156ce74, from Derek's inbox note, before any output was read) added the 8,000-character budget,
the dense stratum and arm B4. Amendment 2 was **post hoc**: it was written after the leak flags were read, before any
seam or page verdict. It classes each leak flag as source repeat, stored page or translation (see Leaks).
- **Sample:** 120 blocks in 69 books. 60 are the #5103 seams, 30 are page-boundary LEAK seams and 30 are dense
  mid-flow breaks. By density: 39 dense blocks (≥ 3,000 OCR characters a page), 81 ordinary. 97 blocks are Latin
  (55 books) and 23 German (14 books).
- **Arms**, all `gemini-3.8-flash-low` through the agy `.agy-james` pool, $0, reading the same stored OCR:
  - A, A2: production `claude-translate.mjs --cli=agy --per-call=4`, run twice.
  - B4: markers, no previous English, a fixed 4 a call.
  - Bb: B4 with the 8,000-character budget. Bb is the B of the rule.
  - C: Bb plus one seam call (`seam-repair-6742` gemini-repair) on each join that crosses a call boundary.
- **Measures:**
  - Seam defects: the #7118 Opus seam judge, blind, both orders, with an identical copy of A and a planted break.
    It judges two joins per block: T inside the block, and S at the block start (the stored English of the page
    before). The rate is 0.75·T + 0.25·S, with a by-row bootstrap.
  - Leaks: `sharedRun` ≥ 200 characters on every consecutive pair.
  - Usable pages: route-judge Opus with the page image, one page per book.
- **Smallest detectable gap:** 10–13 per 100 joins on one join type with n = 120. On the dense stratum alone it is
  16–22, so the per-stratum rates are descriptive.

**Instrument.** The copy of A agreed with A on 240/240 joins. Planted breaks were caught on 232/234 (99.1%).
Wrong-page controls were accepted 0/20. Repeat flips were 1/6. One C row's seam call failed to parse twice, so C
equals Bb there.

### Seam defects per 100 joins (120 blocks; A vs A2 first)

| arm | lane rate [95%] | T (in block) [95%] | S (block start) [95%] | Δ vs mean(A, A2) [95%] |
|---|---|---|---|---|
| A | 18.8 [14.0, 23.8] | 12.5 [7.7, 19.6] | 37.5 [29.4, 46.4] | — |
| A2 | 16.0 [12.1, 20.4] | 9.2 [5.2, 15.7] | 36.7 [28.6, 45.6] | swing 2.8 (T 3.3, S 0.8) |
| B4 | 19.8 [15.0, 25.0] | 11.7 [7.1, 18.6] | 44.2 [35.6, 53.1] | +2.4 [−2.2, 7.3] |
| **Bb** | **26.9** [21.0, 33.3] | 21.7 [15.2, 29.9] | 42.5 [34.0, 51.4] | **+9.5 [2.9, 16.4]** |
| C | 8.8 [5.2, 12.9] | 6.7 [3.4, 12.6] | 15.0 [9.7, 22.5] | −8.6 [−13.1, −4.2] |

Paired at T: Bb is better than A on 11 joins and worse on 22 (p 0.98). Bb against B4: 9 better, 21 worse. C against
Bb: 18 better, 0 worse. At S, B4 is better than A on 3 and worse on 11. Removing the previous English costs
something at the block start, as #8399 expected.

**Per stratum** (lane rate; T / S):

| stratum | n | A | A2 | B4 | Bb | C |
|---|---|---|---|---|---|---|
| dense | 39 | 17.3 (12.8/30.8) | 12.8 (5.1/35.9) | 12.8 (5.1/35.9) | **47.4 (51.3/35.9)** | 10.9 (10.3/12.8) |
| ordinary | 81 | 19.4 (12.3/40.7) | 17.6 (11.1/37.0) | 23.1 (14.8/48.1) | 17.0 (7.4/45.7) | 7.7 (4.9/16.0) |

On ordinary pages the budget leaves blocks at 4 a call, and Bb's in-block T is the lowest of the read arms (7.4). On
dense pages the budget cuts the T join across calls with no context, and Bb breaks there half the time. Under
Amendment 1's rule the budget is not kept (dense Bb 47.4 against B4 12.8, more than the swing). B4 is then held to
the rule and fails it on usable pages (below).

**Per cell** (lane rate): Latin, 97 blocks: A 16.5, A2 15.7, B4 18.6, Bb 26.3, C 9.0. German, 23 blocks: A 28.3,
A2 17.4, B4 25.0, Bb 29.3, C 7.6.

### Leaks (consecutive pairs, 480 per arm)

| arm | detector flags | source repeat | stored page | **made by the translation** |
|---|---|---|---|---|
| A | 10 | 8 | 0 | **2** |
| A2 | 10 | 7 | 1 | **2** |
| B4 | 4 | 4 | 0 | **0** |
| Bb | 4 | 3 | 1 | **0** |
| C | 4 | 3 | 1 | **0** |
| stored (served text) | 44 | 8 | — | 36 |

The detector's source check compares raw OCR, so it misses repeats spelled with ſ or abbreviation marks. Examples
are a duplicated scan (`69b630dc…` p.25 and p.26 both print leaf 13), two editions of one licence on facing pages
(`69b21d9e…` p.9/10), and a reprinted table header. Amendment 2 classes every flag in every arm by the same rule:
folded OCR, shared word 4-grams. "Stored page": the flag is on Bb's block-start join, where the stored English of
p.70 already carries p.71's last paragraph (the Latin is only on p.71). On raw counts every arm fails the "0 leaks"
clause, A included.

### Usable pages (Opus route judge, image open, one page per book)

| arm | accepted [95%] | Latin | German | fidelity | misleads / 1k words |
|---|---|---|---|---|---|
| A | 34/69 (49.3%) [37.8, 60.8] | 26/55 | 8/14 | 3.51 | 2.33 / 2.32 |
| A2 | 35/69 (50.7%) [39.2, 62.2] | 25/55 | 10/14 | 3.58 | 2.63 / 1.55 |
| Bb | 36/69 (52.2%) [40.6, 63.5] | 25/55 | 11/14 | 3.38 | 2.97 / 3.43 |
| B4 (dense books) | 18/39 against A 22, A2 23 | 12/30 | 6/9 | — | 2.79 / 2.04 |

Bb clears the page floor (47.1 = mean − noise). B4 does not on the dense books (46.2% against a floor of 52.6%).

### The rule

| | seam ≤ A (17.4) | translation leaks 0 | usable not lower | passes |
|---|---|---|---|---|
| Bb | no (26.9) | yes | yes | **no** |
| B4 (budget dropped) | no (19.8) | yes | no | **no** |
| C | yes (8.8) | yes | yes (= Bb) | yes |

The preregistration says: "If only C passes, nothing ships in this PR and the seam pass becomes the follow-up." Two
caveats for that follow-up. C's S-join gain partly comes from editing the stored English of the page before the
block, which no other arm can touch. C costs one more agy call per call boundary (158 calls on 120 blocks here).

### Three breaks, quoted from the judge

1. **Production's own leak (A and A2, `69b4c085…` p.216|217, block start).** A's p.217 repeats 861 characters of the
   previous page's English, which it was given as context: "…those things benefit the body which either restore or
   preserve life, health, strength, form, and its own proper nature. To the soul, however, …". No marker arm repeats it.
2. **The budget's call boundary (Bb only, `69b630c3…` p.73).** "'ut sententia tua n̅ negligeres. prospiceresqʒ tibi i
   futurum' is untranslated; 'I have warned you,' runs straight into 'You, however, have treated this with neglect'."
   A, A2, B4 and C are clean here.
3. **The block start that every reader gets wrong (`69b6304e…` p.34, S).** "N ends 'to break out, even though it was
   covered and concealed by him'; N+1 repeats 'covered and concealed by him, to break out'." A, A2, B4 and Bb all
   duplicate it (major). C's seam call repairs it.

**Quota.** agy calls: A 132, A2 135, B4 144, Bb 223 (the budget's single-page calls), C +158 seam calls, for 792 in
total. Claude, on this box's subscription: 480 seam-judge calls ($43.72 at list) and 272 page-judge calls ($24.45 at
list). No paid API calls and no page writes.

**Results:** `scripts/eval/results/seam-markers-8399/`. It holds `report.json` (with every row's verdicts),
`judge.jsonl.gz`, `leaks.json`, `seam-c.jsonl.gz`, `build.json`, and `pages/` (key, sample, recipe,
`verdicts-opus.jsonl.gz`, `packet.json.gz`, `paired-score.json`).
