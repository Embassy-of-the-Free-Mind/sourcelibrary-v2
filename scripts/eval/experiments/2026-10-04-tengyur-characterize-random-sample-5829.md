---
stage: translation
measure: judged
languages: [bo]
scripts: [Tibt]
canons: [derge-tengyur]
n_books: null
n_pages: 150
verdict: "On 150 random Tengyur draft pages, 75% need only light edits; reversal or wrong-agent errors run about 38 per 100 pages (spot-check adjusted), worst in Pramana and verse."
status: informational
decision: "Recommended label sentence not applied; #5788 and #5806 decide; 180 reviewer fixes listed, not applied"
superseded_by: null
issue: 5829
---
## 2026-10-04 · Tengyur draft on an unbiased random sample: two blind reviewers, three kinds of control, corpus detectors and a by-eye check (#5829)
<!-- PRIOR ART: 2026-10-04-tengyur-stored-draft-vs-84000-5797.md (#5797: reference-based judges, 354 sides of 8 texts, no Madhyamaka or Pramāṇa); the #5800 simulated specialist review (25 hand-picked pages, one reviewer, no controls). This run uses #5800's rubric on a uniform draw over the whole drafted canon, with two reviewers, blind controls and a spot check. -->

**Question.** How good is the stored English of the Derge Tengyur draft (#5497) across the whole canon, on pages nobody picked?

**Answer.**
- **Usability.** Per review: three pages in four are **light**, one in four needs **work**, about 1 in 100 needs a **specialist**.
  - Light 75 % [69–82], work 23 % [17–30], specialist 1.3 % [0–3].
- **Reversed statements and wrong speaker/agent.** 47 per 100 pages flagged by either reviewer, 22 per 100 flagged by both at the same spot.
  - Adjusted by the spot check: **38 per 100 pages [23–50]**. Precision on reversal/agent findings was 8/10, with 2 debatable and none rejected.
  - About **1 page in 3** (38 % [31–46], either reviewer) or **1 in 5** (20 % [14–27], both) has at least one.
- **Reversals alone** are rarer: 12.7 per 100 (either) and 6.7 (both). That is close to #5797's reference-based 6.2 and 3.4. The larger class is **wrong agent or referent**: 35 per 100 (either) and 14 (both). A reference judge mostly did not count these.
- **Pramāṇa is the weak section.** Reviewers rated 40 % of its pages light, and it has 74 reversal/agent findings per 100 pages. **Verse is worse than prose.**

These are AI reviewers (Opus acting as a Tibetologist), checked by Claude. They are not a human review.

**Design.**
- **Sample (step 1).** Counted exactly: **116,703** Tengyur pages have `translation.data` (counts per volume in `counts.json`).
  - 150 pages were drawn by seeded (5829) uniform global index, never `$sample`, with no filters. All 150 are `gemini-3-flash-preview`, prompt v13.
  - By section: tantra commentary 59, Pramāṇa 19, Cittamātra 13, Madhyamaka 12, Vinaya 11, Prajñāpāramitā 10, Abhidharma 7, Jātaka 7, grammar and sciences 7, sūtra commentary 5.
  - Recorded per page: section, folio, the text in force (last `{D####}`, carried across volumes), whether the page opens a text (3), colophon (5) and verse share.
- **Controls (step 2), 60 items mixed in blind.** Shuffled with seed 5829 and given opaque ids. Every English was rendered the same way: `<note>` → `[note: …]`, `<term>` → `(…)`, summaries removed, curly quotes straightened.
  - **HUMAN, 20:** 84000's published English for whole sides (tengyur-ref-5497 alignment: full coverage, no root verses stripped). From 84000's style, `{12}`, `[B3]` and `[F.x.y]` were stripped and editorial `[they]` unbracketed. 84000 sides carry no `[note:]`; 19 of the 150 sample pages carry none either.
  - **PLANT, 20:** real pages outside the sample, each with one error inserted by script (`controls-log.json`): 7 negation flips, 7 speaker/agent swaps ("If you ask" → "If I ask"; "you are the nature of all the Tathāgatas" → "I am…"), and 6 wrong terms (mandala → stupa, monk → novice, conventional → ultimate, wisdom → faith).
  - **J5797, 20:** stored sides #5797's two judges scored against 84000. 10 were drawn from the 22 sides either judge marked reversed and 10 from the clean rest (stratified, so that agreement can be measured; a uniform 20 would hold about one reversal).
- **Review (step 3).** Each of the 210 items was read by **two independent Opus subagents**. They were blind to each other and to item type, and did not know controls existed. 42 runs of 10 items, two independent partitions, at most 5 at a time.
  - The prompt (`tengyur-characterize/REVIEW-PROMPT.md`) restates #5800's rubric: score 1–5; light/work/specialist; errors typed reversal/agent/term/omission/addition/structure/gloss; confidence high/medium; the Tibetan quoted; an exact find/replace for high-confidence errors.
  - It tells them a faithful page should get no errors and that sentences crossing a side boundary are not omissions.
  - All 445 sample findings' fixes match the English exactly.
- **Detectors (step 4, $0, all 116,703 pages).**
  - (a) **Opponent voice.** Tibetan objection marks (ཞེ་ན, ཟེར་ན, ཞེས་ཟེར་བ, སྙམ་ན …) with no English objection signal within 15 % of the page at the same relative position. Two variants: "?" counted as a signal, or not.
  - (b) **Terms.** Hand lists (Dharmakīrti reason types, Vinaya offence classes) plus Mahāvyutpatti entries of 3+ syllables that 84000's glossary also lists. A flag means no accepted English or Sanskrit rendering appears in the English. The lookup tables stay on the box (84000 is CC BY-NC-ND).
  - (c) **Pali forms** in this Sanskrit-tradition canon.
- **Spot check (step 5).** 30 sample findings drawn by seed and read by eye with the Tibetan beside the English (*read from text*), plus 10 pages that both reviewers passed clean.
- **Spend:** $0 in API, Gemini or Mongo writes; 42 subagent runs on the subscription. No page or book was written.

**Result 1: the sample** (150 pages, 300 reviews).

| | per review | worse of the two |
|---|---|---|
| light | **75.3 %** [69.0–81.7] | 103 (69 %) |
| work | 23.3 % [17.3–29.7] | 44 |
| specialist | 1.3 % [0–3.3] | 3 |
| mean score | 3.9 / 5 | |

| per 100 pages | either reviewer | both, same spot |
|---|---|---|
| reversal + agent findings | **47.3** [37.3–59.3] | **22.0** [15.3–30.7] |
| … adjusted by spot-check precision (8/10) | **37.9** [23.0–50.3] | — |
| pages with ≥ 1 reversal or agent finding | 38.0 % [30.6–46.0] | 20.0 % [14.4–27.1] |
| reversal only | 12.7 | 6.7 |
| agent / referent only | 34.7 | 14.0 |
| term | 78.0 | 34.7 |
| all findings | 189.3 | — |

- **Adjustment.** Each bootstrap draw (2,000, over pages) multiplies the either-reviewer count by a precision drawn from Beta(8.5, 2.5), the 8 confirmed of the 10 reversal/agent findings in the spot check.
  - The interval carries both the sampling and the precision uncertainty.
  - Counting the 2 debatable findings as half gives 42.6 [27.7–53.9].
  - "Both" is not adjusted: a spot two reviewers flag independently is already filtered.
- **Covariates** (reversal/agent per 100, either):
  - prose, under 10 % verse (105 pages): 37;
  - 10–50 % verse (32): 59;
  - **50 % verse or more (13): 100**;
  - colophon (5): 60;
  - opening of a text (3): 2 of 3 pages.

**Result 2: by section** (sample pages; the intervals are wide below about 15 pages).

| section | pages | light / work / specialist (per review) | reversal + agent per 100, either [95 % CI] | pages with one | term per 100, either |
|---|---|---|---|---|---|
| Tantra commentary | 59 | 82 / 18 / 0 | 39 [25–54] | 19 | 81 |
| **Pramāṇa** | 19 | **39 / 55 / 5** | **74** [47–105] | 12 | 105 |
| Cittamātra | 13 | 77 / 23 / 0 | 31 [0–69] | 3 | 46 |
| Madhyamaka | 12 | 83 / 17 / 0 | 67 [25–125] | 6 | 58 |
| Vinaya | 11 | 64 / 36 / 0 | 36 [9–64] | 4 | **145** |
| Prajñāpāramitā | 10 | 100 / 0 / 0 | 30 [0–60] | 3 | 10 |
| Grammar & sciences | 7 | 57 / 29 / 14 | 29 [0–86] | 1 | 114 |
| Jātaka | 7 | 64 / 36 / 0 | 129 [57–200] | 5 | 57 |
| Abhidharma | 7 | 100 / 0 / 0 | 43 [14–86] | 3 | 43 |
| Sūtra commentary | 5 | 90 / 10 / 0 | 20 [0–60] | 1 | 80 |

**Result 3: controls.**
- **Recall on planted errors: 39 of 40 reviews found the plant (97.5 % [87–100]); either reviewer found 20/20.**
  - Negation 14/14, agent swap 13/14, wrong term 12/12. The type was labelled right on 19/20.
  - Plants are blunter than real errors, so this is an upper bound on recall.
- **84000 human sides (false alarms).**
  - The reviewers raised **195 findings per 100 sides**, as many as on the draft (189). Most were term (70), addition (45) and omission (40); part of the last two is the alignment's side boundaries.
  - Verdicts: 80 % light, 20 % work. Mean score 4.05 against the draft's 3.9.
  - Reversal/agent: **20 per 100 (4 of 20 sides) by either reviewer, 10 by both (2 sides)**, against 47 and 22 on the draft.
  - Read by eye, the two both-reviewer flags look like real disagreements with 84000's rendering, not noise:
    - དགྲ་བོ་དབྱེ་བར་འགྱུར is the rite of setting enemies against each other (vidveṣaṇa), where 84000 has "one will be separated from that enemy";
    - a pariniṣpanna gloss turned into a denial.
  - So this control **bounds** the false-alarm rate from above rather than measuring it.
  - **What it settles:** the verdict shares and the term and omission counts do **not** separate the draft from 84000 at n = 20. Only the reversal/agent class clearly does, at about 2.4×.
- **Agreement with #5797's reference-based judges** (20 stored sides).
  - On the 10 the judges marked reversed: reviewer A flagged reversal/agent on 8, B on 6; one of them at the judges' spot on 7 of the 10.
  - On the 10 the judges passed: A flagged 0, B flagged 1.
  - The reference-free reviewer and the reference-based judges agree.
  - This also means the reviewers' high rate on the sample does not come from flagging everything: on judge-clean 84000-text sides they flag almost nothing. The sample's rate is driven by sections 84000 does not cover (Pramāṇa, Madhyamaka, Jātaka verse) and by the agent/referent class.

**Result 4: the reviewers.**
- **Verdict agreement** 85 %, Cohen's κ = **0.61** (150 sample pages; 0.62 on all 210).
- **Findings.** 72 % of each reviewer's findings were matched by the other at the same spot (same Tibetan or English quote).
- **Reversal/agent pages:** A 52, B 43, both 35.

**Result 5: the spot check, by eye** (`spotcheck-findings.tsv`, `spotcheck-clean.tsv`).
- **30 findings:**
  - **21 confirmed, 6 debatable, 3 rejected.** Precision 70 % [52–83], or 80 % counting debatable findings as half.
  - **Reversal and agent: 8 confirmed, 2 debatable, 0 rejected.** Structure 4/4 and omission 2/2 confirmed.
  - **Terms are the weak class:** 6 confirmed, 4 debatable, 2 rejected. The rejected ones are a correct reading of སྔོན as "blue" in a Pramāṇa passage, and "clarity" for prasāda, which is an accepted rendering.
  - Confirmed examples:
    - ཟབ་པར་འདུ་ཤེས་ཤིང་རྣམ་པར་རྟོག་པ་མེད་ན ("if one has no perception of profundity and does not conceptualize") as "if one perceives them as profound without conceptualizing";
    - གཙོ་བོ་མ་ཡིན་པ ("the non-principal sense") as "his primary qualities";
    - an objection put *against* the proponent of non-conceptual perception made into *his* argument (the opponent-voice error #5800 predicted);
    - vipakṣa as "the counter-argument";
    - the honorific གསུངས (the Blessed One speaking) as "the practitioner spoke";
    - Buddhalocanā as "the Buddha-Eye";
    - ucchvāsa ("chapter") as "six types of relief".
- **10 pages both reviewers passed clean:** no clear miss, and one possible minor one. In v100 41a the opponent's "form does no grasping" is blurred into "no perception of it" and then restored in the next paragraph. Passing a page clean is reliable.

**Result 6: detectors** (corpus flag rates by section in `analysis.json`; precision/recall against the either-reviewer findings on the 150 sample pages).

| detector | corpus pages flagged | against the reviewers |
|---|---|---|
| (a) objection mark with no English signal, "?" counts | 1.9 % | 0 of 150 sample pages flagged; recall 0 on agent errors |
| (a) same, "?" not counted | 18.3 % | precision 20 % against a 28 % base rate for agent errors; recall 12 %; **0 of the 6 voice errors** |
| (b) hand lists (reason types, Vinaya offences) | 3.9 % | 2 sample pages, 0 true; ལྡོག་པ (vyatireka) is too common a word and drives the flags |
| (b) Mahāvyutpatti ∩ 84000 glossary | 49.6 % | precision 52 % at a 53 % base rate: chance |
| **(c) Pali forms** | **1.3 % (1,477 pages)**, **11.2 % of Vinaya (1,148 pages)** | precision 1/2, recall 1/5 of the reviewers' Pali findings; as an inventory it is exact |

- **What the detectors can catch:** **Pali forms**, and that check is decisive.
  - *Saṅghādisesa* (639 pages in spellings), *uposatha* 189, *dukkaṭa* 174, *pācittiya* 124, *pavāraṇā* 62, *thullaccaya* 53, *nissaggiya* 17.
  - These are Pali names for Mūlasarvāstivāda offence classes, concentrated in the Vinaya. Each is a lexical swap to the Sanskrit (saṅghāvaśeṣa, poṣadha, duṣkṛta, pātayantika …).
  - Page list: `pali-forms-pages.jsonl`. Some hits (a "Theravāda" in a note, *dukkha* in a gloss) are legitimate, so look before replacing.
- **What they cannot catch:** the voice and agent errors. The draft almost always keeps the objection marker ("If someone says…"). What goes wrong is *whose* view follows, a dative made into the agent, an honorific speaker lost. A marker count cannot see that. Term errors are mostly context errors (lemma glossed as a different word, a name translated, a polysemous word read in the wrong sense), not missing dictionary equivalents. A glossary lookup is at chance.

**Consequences.**
1. **The draft is a usable starting point on most pages, and a misleading one on a minority of passages.**
   - Three pages in four are light by a Tibetologist's standard (per AI review).
   - About a third of pages carry at least one wrong speaker, agent, referent or reversed statement (one in five when both reviewers must agree).
   - The 84000 control says the usability verdict alone does not distinguish the draft from a published human translation at this sample size. The reversal/agent rate does, at about 2.4×.
2. **The label's "about 3–6 reversed statements per 100 pages" (#5797) is right for strict reversals.** Here: 12.7 either, 6.7 both. But it **undercounts what a reader is misled by.** Wrong-agent/referent errors are about three times as common.
   - Recommended label sentence (not applied; #5788 and #5806 decide): *"Unreviewed machine draft. In a blind check of 150 random pages against the Tibetan, about three pages in four needed only light edits, but roughly one page in four had a reversed statement or a wrong speaker or agent, most often in logic (Pramāṇa) and verse. Check any passage you quote against the Tibetan."*
3. **Priorities for repair:**
   - **Pramāṇa** (worst section by both measures);
   - **verse pages**;
   - the **Vinaya Pali terms**, a $0 lexical fix over 1,148 pages, as its own job with a look at each form.
4. **The real scholar review (#5800)** should weight Pramāṇa, verse and Vinaya. It can now be read against a measured reviewer: 70 % precision, 97 % recall on plants and κ 0.61, which a human panel can be compared with.
5. **The 180 high-confidence fixes** proposed by the reviewers (`proposed-fixes.jsonl`) are listed, not applied.
   - 161 are at a spot the other reviewer also flagged.
   - Their `find` strings are against the rendered English (`[note: …]`), so map them back before any write.

**Replicated?** In part.
- Two reviewers, κ 0.61. The reversal/agent rate holds within the CI for each reviewer alone: A 40, B 34 per 100.
- Agreement with #5797's reference judges on 20 shared sides.
- Not yet replicated by a human. The reviewers and the spot-checker are the same model family, so the precision figure is not independent of the reviewers. A human scholar's reading (#5800) is the check that remains.

**Artifacts** (`scripts/eval/results/tengyur-characterize-5829/`; code in `scripts/eval/tengyur-characterize/`):
- **Sample:** `counts.json`, `sample.json`.
- **Packet:** `controls-log.json` and `key.json` (id → item type, plant, #5797 verdict).
- **Reviews:** `reviews/{A,B}-NN.json`, 42 files.
- **Spot check:** `spotcheck-draw.json`, `spotcheck-findings.tsv`, `spotcheck-clean.tsv`.
- **Analysis and lists:** `analysis.json` (every number above), `proposed-fixes.jsonl`, `pali-forms-pages.jsonl`.
- **Kept on the box, not committed:** the reviewed packet (`/root/tchar/items.jsonl`; it holds 84000 text, CC BY-NC-ND; regenerate with `build-packet.mjs`), the per-page detector output (`/root/tchar/detect.jsonl`, 31 MB; regenerate with `detect.mjs`), and the Mahāvyutpatti/84000 lookup (`build-terms.py`).
