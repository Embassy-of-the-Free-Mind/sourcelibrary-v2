---
stage: translation
measure: judged_vs_reference
languages: [fa, sa, lzh, grc, he]
scripts: [Arab, Deva, Hani, Grek, Hebr]
canons: []
n_books: 5
n_pages: 50
verdict: "On the same 50 pages, in one round, Opus at 10 pages per call beats 3.8 Flash by +0.56 under an Opus judge (book-clustered CI [+0.15, +0.96]) and by +0.33 under a 3.8 Flash-high judge (CI [−0.17, +0.80]). It does not clear the bar under both judges. Opus at 1 page per call beats Flash by +0.71 and +0.78, and both intervals exclude 0. The two judges agree only at α 0.61 on fidelity, so this is not settled."
status: adopted
decision: "Opus translation stays at 1 page per call where capacity allows (#6545). Ten per call is not used to stretch Opus capacity: the brief's rule (O10 beats Flash under both judges, CI excludes 0) fails under the Gemini judge (#6690)."
superseded_by: null
issue: [6690, 6545]
---
PRIOR ART: `2026-10-13-opus-translation-10-pages-per-call-6690.md` (PR #6700: the 50 pages, the O1 and O10 outputs, the references and the planted controls; this round adds the Flash arm and a second judge, and supersedes its routing line). `2026-10-12-pro-opus-correction-hardest-languages-6545.md` (the one-page Flash request and the rubric). Scripts: `scripts/eval/opus10-flash-6690/`. Numbers: `scripts/eval/results/opus10-flash-6690/scores.json`.

## 2026-10-15 · Opus at 10 pages per call against 3.8 Flash, same pages, same round (#6690)

**Decision it changes:** whether to stretch Opus translation capacity with 10 pages per call. #6690's first round found that 10 per call (O10) costs 0.30 against 1 per call (O1) for about 2.7× less usage. It left one question open: is O10 still clearly better than the 3.8 Flash route the pages would otherwise get? Derek, 2026-10-14: run the Flash arm and judge all three together.

### Design

- **Pages:** #6690's 50 pages, unchanged. That is five runs of 10 consecutive pages, one book per language: Golestān (Persian), Arthaśāstra (Sanskrit), Sanguo yanyi (Chinese), Republic IX (Greek) and Sefer ha-Yirah (Hebrew). Each page keeps its #6690 reference.
- **Arms.**
  - **O1** and **O10** are #6690's outputs, reused.
  - **F** is `gemini-3.8-flash-low` via `agy -p` (`run-cli-arm.py`, plan mode, $0), one page per call. It gets the O1 request byte for byte: the pinned v13 translate-core prompt plus #6545's marker suffix. On the 5 anchor pages, that request is also identical to #6545's Flash request.
  - All 50 Flash reads returned. None needed a nudge, and none failed the chatter guard.
- **Judges.** Two families, both blind, with #6545's `JUDGE-PROMPT-PRO.md` unchanged. One item per call.
  - Opus 5.5 via a sealed `claude -p` (`claude-arm.py --sealed`: no MCP, no file, web or agent tools, no session file, API-key variables stripped).
  - `gemini-3.8-flash-high` via `agy -p`.
- **Two orders.** Each page is judged twice, with three shuffled labels in order A and the same labels rotated by one in order B, so every arm changes position. A page's score is the mean of its two orders.
- **Controls:** #6690's 10 planted O1 copies, byte for byte (negations, dropped clauses, a number, a name). Each sits beside O10 and F and is judged in both orders, so there are 20 plant items. A catch must be located at the planted span.
- **Intervals.** 95%, 2,000 bootstrap draws.
  - By page.
  - By book then page: books are resampled, then pages within each drawn book.
  - Per language there is one book, so the per-language intervals are by page only.
- **Judge agreement** (eval-design §2). Krippendorff's α between the two judges, from `judgeReliability()`, bootstrapped by book. Measures: fidelity (ordinal), omission (nominal), best arm (nominal), and the sign of O10 − F per page (ordinal).
- **Returns.**
  - Opus judged 120 of 120 items.
  - Gemini judged 118 of 120. Two replies held malformed JSON: one ARMS item (Chinese) and one PLANT item (Greek). Both pages still have their other order.

### Result

**Mean fidelity, 1–5** (page = mean of two orders; n = 50 pages per arm; the CI is by book then page):

| judge | O1 | O10 | F |
|---|---|---|---|
| Opus | 4.68 [4.52, 4.82] | 4.53 [4.32, 4.75] | 3.97 [3.50, 4.37] |
| 3.8 Flash-high | 4.77 [4.61, 4.92] | 4.32 [4.07, 4.55] | 3.99 [3.50, 4.46] |

**Paired differences** (mean [CI by page] [CI by book then page], better / worse / tie):

| judge | O10 − F | O1 − F | O10 − O1 |
|---|---|---|---|
| Opus | **+0.56** [+0.37, +0.75] [**+0.15, +0.96**], 33 / 6 / 11 | +0.71 [+0.54, +0.88] [+0.37, +1.16], 36 / 1 / 13 | −0.15 [−0.31, +0.02] [−0.39, +0.07], 9 / 19 / 22 |
| 3.8 Flash-high | **+0.33** [+0.07, +0.59] [**−0.17, +0.80**], 28 / 13 / 9 | +0.78 [+0.56, +1.00] [+0.37, +1.23], 35 / 6 / 9 | −0.45 [−0.66, −0.24] [−0.77, −0.18], 9 / 30 / 11 |

**By language** (one book each; O1 / O10 / F, then O10 − F with its CI by page):

| | Opus judge | O10 − F | Flash-high judge | O10 − F |
|---|---|---|---|---|
| Persian | 4.75 / 4.85 / 4.30 | +0.55 [+0.25, +0.85] | 4.75 / 4.65 / 4.25 | +0.40 [−0.05, +0.80] |
| Sanskrit | 4.65 / 4.35 / 3.05 | +1.30 [+1.00, +1.55] | 4.75 / 4.30 / 3.25 | +1.05 [+0.60, +1.50] |
| Chinese | 4.45 / 4.40 / 3.80 | +0.60 [+0.35, +0.90] | 4.55 / 4.10 / 3.45 | +0.65 [+0.10, +1.10] |
| Greek | 4.75 / 4.70 / 4.25 | +0.45 [+0.00, +0.90] | 4.80 / 4.45 / 4.45 | +0.00 [−0.40, +0.45] |
| Hebrew | 4.80 / 4.35 / 4.45 | −0.10 [−0.40, +0.20] | 5.00 / 4.10 / 4.55 | −0.45 [−1.05, +0.15] |

- **The rule fails.** The brief allows O10 only if it beats Flash under both judges with the CI excluding 0. Under the Opus judge it does. Under the Flash-high judge, the by-book interval runs from −0.17 to +0.80; the by-page interval alone would exclude 0. With five books, the by-book interval decides.
- **Where O10 clearly beats Flash:** Sanskrit and Chinese, under both judges. Persian too under the Opus judge.
- **Where it does not:** Greek, which ties under Flash-high, and Hebrew, where O10 is below Flash under both judges. Hebrew is #6690's two-column print, where O10 already lost most against O1.
- **O1 beats Flash** by +0.7 to +0.8 under both judges, with both intervals excluding 0. This repeats #6545's +0.47 to +0.52 in size and direction, on different pages and with two judges.
- **O10 − O1** is −0.15 under the Opus judge and −0.45 under Flash-high. #6690's Flash-high judge, seeing two arms, gave −0.30.
- **Omission flagged:**
  - Opus judge: O1 5%, O10 30%, F 24%.
  - Flash-high judge: O1 4%, O10 26%, F 16%.

  O10's extra omissions show up under both judges.

**Judge agreement (α between the two judges):**
- fidelity (ordinal): α 0.61 [0.49, 0.72], 297 item×arm ratings — **not settled**
- omission (nominal): α 0.43 [0.31, 0.56], 297 item×arm ratings — **not settled**
- best arm (nominal): α 0.32 [0.18, 0.42], 99 items — **not settled**
- O10 vs F, sign per page (ordinal): α 0.46 [0.10, 0.57], 50 pages — **not settled**

Every rate above is therefore "not settled" for each judge. The judges disagree on the size of O10's edge over Flash, and on which arm is best on a page about as often as not. They agree on the ordering O1 > O10 > F and on the O1 − F gap.

**The judges' controls held.**
- Plants: the Opus judge located 19 of 20 and scored 18 of 20 below the same page's unplanted O1. Flash-high located 18 of 19 and scored 17 of 19 lower.
- Order:
  - Opus gave the same score in both orders on 122 of 150 page×arm pairs (mean absolute difference 0.19). Its position effect is ≤ 0.02.
  - Flash-high gave the same score on 111 of 147 pairs (difference 0.25). It favours position T1 by +0.09 against the page-arm mean. The two orders cancel that within a page.

### Threats and limits

- **Each judge is from one arm's family.** The Opus judge rates two Opus arms and one Gemini arm; Flash-high rates one Gemini arm and two Opus arms. The two judges together bracket self-preference, and O10's edge over F is +0.56 versus +0.33. The rule asked for both, and the weaker side fails.
- **Five books.** The by-book interval is wide, and Hebrew alone pulls O10 − F down. Without Hebrew, O10 − F under Flash-high would be about +0.5. The rule is pre-stated, though, and is applied as written.
- **References** for 45 of the 50 pages were cut by script, or by hand from another recension (Hebrew), as in #6690. The same reference serves all three arms on each page.
- **Not tested:** 5 pages per call; O10 with a previous-page context; a language-by-language routing (O10 for Sanskrit and Chinese only), which these data would support but did not pre-state.

### Routing

- **Opus translation stays at 1 page per call where capacity allows** (#6545). It beats Flash under both judges.
- **Ten per call is not used to stretch Opus capacity.** It beats Flash under the Opus judge but not clearly under the Flash-high judge, and the judges' agreement is not settled. Where Opus capacity runs out, pages fall to 3.8 Flash as now.
- A follow-up that pre-states a per-language rule (O10 for Sanskrit and Chinese, where it beats Flash by +0.6 to +1.3 under both judges) would need its own pages.

*Measure:* judged against a published translation by two cross-family AI judges, whose agreement is not settled (α 0.61 on fidelity). It is not accuracy in the sense of eval-design §2. *Grade:* moderate-to-low. 50 pages in 5 books; script-cut references; both judges passed their plant and order controls. *Replicated?* O1 > F replicates #6545. O10 vs F is new.

*Cost:* $0. Flash and the Flash-high judge through `agy -p`; the Opus judge through `claude -p` on the subscription. While the Opus judge's 120 calls ran, the account's session meter went from 32 to 57 and the weekly meter from 4 to 7. Both meters are shared with other jobs, so these are upper bounds. No API key, no database write.

*Files:* `scripts/eval/opus10-flash-6690/` (build-packet.py, score.py), `scripts/eval/pro-translate-6545/claude-arm.py --sealed`, `scripts/eval/results/opus10-flash-6690/{scores.json, key.json}`. The arm outputs, references and judge packets quote published translations and stay on the box (`$JOB_SCRATCH/w/`).
