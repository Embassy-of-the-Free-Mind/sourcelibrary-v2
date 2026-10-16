---
stage: translation
measure: judged_vs_reference
languages: [fa, sa, lzh, grc, he]
scripts: [Arab, Deva, Hani, Grek, Hebr]
canons: []
n_books: 132
n_pages: 132
verdict: "Gemini 4 Argon low (CLI, $0) translates the five hardest languages better than 3.8 Flash (+0.28 Opus judge, +0.49 Gemini 3.8 judge, pooled, both CIs above 0) but worse than Opus under the Opus judge in every language (pooled −0.41 [−0.52, −0.32]); under the Gemini 3.8 judge it is within noise of Opus except in Chinese (−0.38 [−0.64, −0.12]). By the preregistered rule Opus stays in all five. In Hebrew G4L also fills verses the page abbreviates from the canonical text."
status: rejected
decision: "Opus stays the hard-language translator (Persian, Sanskrit, Chinese, Greek, Hebrew); G4L neither replaces nor joins it. Where Opus capacity is short, G4L is a better fallback than 3.8 Flash on this evidence (#6729)"
superseded_by: null
issue: [6729, 6545]
---
## 2026-10-15 · Gemini 4 Argon low vs Opus vs 3.8 Flash, translation, the #6545 panels (#6729)

PRIOR ART: `2026-10-12-pro-opus-correction-hardest-languages-6545.md` (the panels, prompt, OPUS and C38S arms, judge
prompts and plants, all reused); `2026-10-14-gemini-4-argon-low-hard-panels-6707.md` (G4L in OCR: knows rare scripts,
recites canonical text); `2026-10-13-opus-vs-flash-translation-nahuatl-6559.md` (Gemini-judge position bias ±0.6 →
both orders). Preregistration: `scripts/eval/g4-translate-6729/DESIGN.md`, pushed at `19666ca` before any G4 read.
Scripts: `scripts/eval/g4-translate-6729/`. Numbers: `scripts/eval/results/g4-translate-6729/scores.json`.

### Question
Does `gemini-4-argon-low` (G4L, `agy -p`, $0) translate Persian, Sanskrit, Chinese, Greek and Hebrew better than Opus
(the #6545 pick) and 3.8 Flash? If yes, G4L could take load off Opus.

### Design
- **Pages:** the #6545 panels, one page per book, each with a published English translation. Persian 23,
  Sanskrit 30, Chinese 25, Greek 25, Hebrew 29: 132 pages.
- **Arms**, all with the byte-identical #6545 prompt (units prompt plus the marker suffix):
  - **G4L**, new: `run-cli-arm.py --kind translate --print-timeout 300`, plan mode, one page per call, 2 in parallel.
  - **OPUS** (`claude -p`) and **C38S** (3.8 Flash low, CLI): the stored #6545 runs of 2026-10-12.
- **Judges.** Each judge is blind, scores fidelity 1–5 against the source and the reference, and sees shuffled labels.
  - A fresh Opus (`claude -p`, the #6545 judge prompt), 3 items per call.
  - `gemini-3.8-flash-high` (agy, the same rubric word for word), one item per call.
  - **Every page was judged in both orders** (candidates reversed). A page's score is the mean of its two orders.
- **Controls:** #6545's 46 planted-error items (a copy of C38 with one meaning error), judged once by each judge.
- **Intervals:** 95%, 2,000 bootstrap draws by book.

### Result
**G4L ran cleanly.** All 132 pages read: 128 on the first attempt and 4 on the second, with no nudges and no failed
reads. The median call took 37 s (maximum 89 s). There were no quota events.

**Fidelity per panel** (mean of both orders; 95% CI by book):

| panel | n | judge | G4L | OPUS | C38S | **G4L − OPUS** | G4L − C38S |
|---|---|---|---|---|---|---|---|
| Persian | 23 | Opus | 4.09 [3.83, 4.33] | 4.52 [4.24, 4.76] | 3.74 [3.41, 4.04] | **−0.43 [−0.65, −0.20]** | +0.35 [+0.09, +0.61] |
| | | Gemini 3.8 | 4.22 [4.00, 4.43] | 4.30 [3.98, 4.59] | 3.57 [3.28, 3.87] | **−0.09 [−0.37, +0.24]** | +0.65 [+0.30, +0.98] |
| Sanskrit | 30 | Opus | 4.28 [4.05, 4.52] | 4.67 [4.42, 4.87] | 3.87 [3.67, 4.05] | **−0.38 [−0.60, −0.17]** | +0.42 [+0.20, +0.63] |
| | | Gemini 3.8 | 4.45 [4.20, 4.67] | 4.45 [4.18, 4.68] | 4.08 [3.82, 4.33] | **+0.00 [−0.28, +0.27]** | +0.37 [+0.03, +0.68] |
| Chinese | 25 | Opus | 4.14 [3.94, 4.32] | 4.80 [4.66, 4.92] | 4.10 [3.88, 4.34] | **−0.66 [−0.86, −0.46]** | +0.04 [−0.22, +0.28] |
| | | Gemini 3.8 | 4.34 [4.12, 4.56] | 4.72 [4.54, 4.88] | 3.84 [3.56, 4.14] | **−0.38 [−0.64, −0.12]** | +0.50 [+0.16, +0.82] |
| Greek | 25 | Opus | 4.44 [4.26, 4.62] | 4.70 [4.52, 4.88] | 3.96 [3.62, 4.26] | **−0.26 [−0.48, −0.04]** | +0.48 [+0.24, +0.76] |
| | | Gemini 3.8 | 4.42 [4.20, 4.62] | 4.58 [4.38, 4.76] | 3.72 [3.34, 4.08] | **−0.16 [−0.46, +0.12]** | +0.70 [+0.42, +1.02] |
| Hebrew | 29 | Opus | 4.22 [3.98, 4.45] | 4.55 [4.34, 4.72] | 4.09 [3.76, 4.38] | **−0.33 [−0.57, −0.10]** | +0.14 [−0.10, +0.41] |
| | | Gemini 3.8 | 4.34 [4.09, 4.59] | 4.40 [4.10, 4.66] | 4.03 [3.72, 4.31] | **−0.05 [−0.41, +0.31]** | +0.31 [+0.00, +0.64] |
| pooled | 132 | Opus | | | | **−0.41 [−0.52, −0.32]** (W/L/T 10/70/52) | +0.28 [+0.16, +0.40] |
| | | Gemini 3.8 | | | | **−0.13 [−0.28, +0.01]** (35/49/48) | +0.49 [+0.33, +0.64] |

**The rule** (preregistered):
- G4L replaces Opus only if it beats Opus beyond zero under both judges.
- It joins Opus as an equal only if it is within noise under both.
- Otherwise Opus stays.

| language | Opus judge | Gemini 3.8 judge | outcome |
|---|---|---|---|
| Persian | below | within noise | **Opus stays** |
| Sanskrit | below | within noise | **Opus stays** |
| Chinese | below | below | **Opus stays** |
| Greek | below | within noise | **Opus stays** |
| Hebrew | below | within noise | **Opus stays**; the recitation gate also fails (below) |

**Judges and their agreement** (Krippendorff's alpha via `judgeReliability`, bootstrap by book; below 0.667 = not
settled):
- **Opus–Gemini agreement on fidelity is not settled:** alpha 0.65 [0.58, 0.71], over 786 units.
  - Per language: Persian 0.72, Sanskrit 0.59, Chinese 0.60, Greek 0.65, Hebrew 0.67.
  - Sanskrit, Chinese and Greek are not settled; Persian and Hebrew are tentative.
  - The judges disagree on how far apart G4L and Opus are, not on the order: G4L ≤ OPUS in every panel under both.
- **Each judge agrees with itself:** test–retest (order 1 vs order 2) on fidelity is 0.80 for both Opus and Gemini 3.8.
  On reversal it is 0.89 (Opus) and 0.84 (Gemini 3.8).
- **Reversal rates are not settled across judges:** alpha 0.66 [0.48, 0.82]; Sanskrit 0.31, Hebrew 0.61.
  - Reversals per 100 pages, Opus / Gemini judge:
    - G4L: 0–7 / 0–2
    - OPUS: 0–4 / 0–5
    - C38S: 7–17 / 5–24
  - Each judge is consistent with itself; the judges do not agree on which pages carry a reversal.
- **Family gap:** the Gemini judge narrows G4L's deficit against Opus by +0.28 pooled (−0.13 against −0.41).
  - This is the self-preference direction: G4L is Gemini-made and OPUS is Claude-made.
  - The two judges agree that both G4L and Opus beat C38S.
- **Plants:** each judge located 43 of 46 planted errors at their span.
- **Position:** the first slot scores +0.07 (Opus judge) and +0.10 (Gemini judge) above the last, for the same text.
  Averaging the two orders cancels this. The two orders give different scores on 17% (Opus) and 22% (Gemini) of
  page×arm units.

**Recitation check** (longest word n-gram shared with the published English; flag at more than 12 words):

| panel | G4L flagged / median / max | OPUS | C38S |
|---|---|---|---|
| Persian | 1 / 7 / 13 | 0 / 6 / 10 | 0 / 5 / 9 |
| Sanskrit | 0 / 5 / 10 | 0 / 5 / 10 | 0 / 5 / 12 |
| Chinese | 0 / 5 / 10 | 0 / 5 / 11 | 0 / 5 / 8 |
| Greek | 6 / 9 / 16 | 4 / 8 / 16 | 2 / 8 / 15 |
| Hebrew | 16 / 14 / **80** | 15 / 13 / 44 | 14 / 12 / 27 |

By count, no language is in excess (the bar was 3 or more flags above OPUS). I read every flagged G4L page against the
OCR:
- **Greek, Persian, and 14 of the 16 Hebrew pages:** the shared run translates text that is on the page.
  - Hebrew runs are long for every arm: JPS-1917-style wording of Bible verses that the page carries.
  - The 80-word run is Isaiah 11:2–4, which is on the page. G4L follows the page where it departs from the canonical
    verse ("Sing aloud, O daughter of my people", not "of Zion").
- **Two Hebrew pages carry text the page does not have:**
  - **Seder Olam Rabbah 29.** The page cuts its proof-texts short with וגו' ("etc."). G4L completes four of them from
    the canonical verse, as the published English does:
    - "in the twelfth year of King Ahasuerus" (Est 3:7)
    - "and to cause to perish" (Est 3:13)
    - "and Mordecai the Jew … with all authority" (Est 9:29)
    - "I will remember you" (Jer 29:10)

    OPUS and C38S translate only what is printed.
  - **Psalm 90:1 in a Karaite liturgy.** G4L opens with "Lord, You have been…". The page has no אדני; the published
    English has "Lord". OPUS and C38S do not add it.
- Under the preregistered by-eye criterion, this is **excess recitation in Hebrew**. The scale is small (two pages in
  29), and it has the same shape as #6707's OCR finding: G4L supplies canonical text from memory where the leaf has
  something else or nothing.

### What it means
- **Opus stays** the hard-language translator in all five languages.
- **G4L is not equal to Opus.** The Opus judge puts it 0.26–0.66 behind in every language. The Gemini judge, the same
  family as G4L, still puts it behind or level everywhere, never ahead.
- **G4L is clearly better than 3.8 Flash** under both judges: pooled +0.28 [+0.16, +0.40] and +0.49 [+0.33, +0.64]. It
  also has fewer reversals and no failed reads. Where Opus capacity runs out, G4L is the better fallback on this
  evidence. Watch its habit of completing abbreviated citations in Hebrew (and probably in other scriptural texts).
- **Cost:** $0. 132 G4L calls, 310 Gemini 3.8 judge calls and 104 Opus judge calls, on subscriptions.

Grade: directional (n = 23–30 books per language; the judges' fidelity agreement is not settled).
