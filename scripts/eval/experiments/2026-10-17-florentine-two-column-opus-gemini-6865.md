---
stage: translation
measure: judged
languages: [nah, es]
scripts: [Latn]
canons: []
n_books: 3
n_pages: 20
verdict: "On 20 two-column leaves of the Florentine Codex, with the same column instruction for every arm, Gemini 4 Argon Low beats Opus on the Nahuatl column under both judges, order-averaged: +1.18 under a Gemini 3.8 Flash High judge (CI +0.93, +1.43) and +0.20 under an Opus judge (CI −0.07, +0.50). Only the Gemini judge's margin is clear. Opus beats Gemini 3.8 Flash Low under the Opus judge (+0.57) and loses to it under the Gemini judge (−0.42, CI crosses 0). The Spanish column is near 5 for all three, with Argon slightly ahead. The stored flash-lite English scores 1.8/5 on the Nahuatl and summarises it on 7–8 of 40 judgements; none of the new arms summarised."
status: undecided
decision: "None taken here; Derek decides. The running Opus re-translation (job florentine-nahuatl, #6865) was not changed."
superseded_by: null
issue: [6865]
---
PRIOR ART: `2026-10-14-opus-vs-flash-translation-maya-6559.md` (design, judge runners, packet builder and scorer, copied here and changed to score each column); `2026-10-13-opus-vs-flash-translation-nahuatl-6559.md` (Nahuatl, printed books: Opus and 3.8 Flash tie); `2026-10-15-gemini-4-argon-low-translation-hardest-6729.md` (Argon trails Opus in five other languages under the Opus judge).

## 2026-10-17 · Opus, Gemini 4 Argon and Gemini 3.8 Flash on the Florentine Codex's two-column leaves

**Why.** #6865 found that the stored `gemini-3.1-flash-lite-preview` English often summarises the right-hand Nahuatl column of the Florentine Codex instead of translating it (Vol. 1 p. 251: "Nahuatl text describing the chaotic race…"). An Opus re-translation is running in job `florentine-nahuatl`. Derek, 2026-10-17: "redo with opus.. test gemini too for comparison." This entry is that comparison. It wrote nothing to any page.

**Design.**
- **Pages.** 20 two-column leaves (`<column-break/>` in the OCR, ≥ 300 characters in each column) from the three volumes:
  - one leaf drawn at random from each of the twelve Books, plus a second leaf from 8 Books drawn at random (seed 6865);
  - Vol. 1 p. 251 fixed as Book 2's first leaf.

  The Book of each page is read from the running `<header>` ("Libro 2", "libro decimo", or a Book's subject words) and carried forward (`select.mjs`). The list is in `selection.json`. One leaf (Vol. 1 p. 94) has three OCR columns.
- **Instruction.** One line, the same for every arm (`instruction.txt`): translate EACH column in full, sentence by sentence; keep `<column-break/>`; never summarise or describe a column in a note; mark doubtful Nahuatl `<unclear>`. Appended to the production prompt before the reply rules.
- **Arms.**
  - **Opus:** `claude-translate.mjs read --model=opus --per-call=5`, `claude -p` on the subscription, translate-core's block prompt. Each sampled leaf was read in a block of 5 consecutive pages (p−2 to p+2), as the production job reads. 4 pages were read again alone after the block guards. This PR adds `--instructions-file` to `claude-translate.mjs`, with the same format as `cli-translate.mjs` has.
  - **Gemini 4 Argon Low** and **Gemini 3.8 Flash Low:** `cli-translate.mjs read` through `agy -p`, one page per call, each page seeded with the page before it.
  - **flash-lite (reference):** the stored English (`gemini-3.1-flash-lite-preview`, the pipeline's read).
- **Judges.** Four pairs: Opus–Argon, Opus–Flash, Argon–Flash and Opus–lite. Each pair was judged on every page in both A/B orders by two judges, and the two orders were averaged.
  - `agy gemini-3.8-flash-high` (`run-cli-arm.py --kind judge`).
  - A sealed `claude -p --model opus --restricted --tools Read` (`claude-judge.py`).

  Each call had the page image (scaled to 2,400 px on the long side), the OCR, and both translations with `<summary>`/`<keywords>` stripped (`judge-prompt.md`). The judge scored the **Nahuatl and Spanish columns separately**: fidelity 1–5, omitted, added and mistranslated passages listed, and "summarised instead of translated" yes/no. That is 320 judge calls. Three Gemini replies that would not parse were run again; the originals are kept as `unparsed-*.jsonl`.

**Result: the Nahuatl column.** Each cell is the difference between the two arms, order-averaged, with a 95% bootstrap CI over pages.

| pair | Gemini 3.8 Flash High judge | Opus judge | pages won by the first arm / tied / won by the second (Gemini judge; Opus judge) |
|---|---|---|---|
| **Argon − Opus** | **+1.18** (+0.93, +1.43) | **+0.20** (−0.07, +0.50) | 18/1/1; 8/8/4 |
| Flash − Opus | +0.42 (−0.10, +0.93) | −0.57 (−0.97, −0.15) | 12/3/5; 6/2/12 |
| Argon − Flash | +0.78 (+0.20, +1.32) | +0.80 (+0.53, +1.05) | 13/2/5; 15/4/1 |
| lite − Opus | −2.55 (−2.83, −2.27) | −2.20 (−2.48, −1.88) | 0/0/20; 0/1/19 |

**Result: one row per arm.**
- Fidelity is the arm's mean over every judgement it took part in, across pairs.
- The error counts are per page per judgement, averaged over both judges.
- Time is the wall time of the read calls.
- Cost is what the same tokens would cost on the API; all three new arms cost $0 on the subscriptions.
  - Opus: `list_cost_usd` from `calls.jsonl`, all 104 page-reads with retries, divided by the 100 pages read.
  - 3.8 Flash: prompt and reply characters ÷ 3.5 at $0.75 / $3.75 per million tokens. Thinking tokens are not counted, because agy does not report them.
  - Argon: no API price exists.
  - lite: the measured Nahuatl figure from 2026-10-14.

| arm | $/page (API-equivalent) · s/page | Nahuatl fidelity, Gemini judge · Opus judge | Nahuatl omitted · added · mistranslated | Nahuatl "summarised" | Spanish fidelity, Gemini · Opus judge |
|---|---|---|---|---|---|
| Gemini 4 Argon Low | not priced · 27 s | 3.94 · 3.90 | 0.3 · 0.6 · 1.7 | 0/160 | 4.81 · 4.83 |
| Opus | $0.057 · 18 s | 3.40 · 3.83 | 0.9 · 0.4 · 2.2 | 0/240 | 4.63 · 4.67 |
| Gemini 3.8 Flash Low | ~$0.006 · 15 s | 3.27 · 3.24 | 0.7 · 0.7 · 3.0 | 0/160 | 4.56 · 4.59 |
| flash-lite (stored) | ~$0.002 · 3 s | 1.82 · 1.85 | 2.7 · 1.8 · 5.5 | 15/80 | 3.75 · 4.05 |

**The Spanish column** is not where the arms differ. All three new arms score 4.6–4.8. Argon leads Opus by +0.33 (Gemini judge) and +0.23 (Opus judge), both CIs just above 0. Opus and Flash tie.

**Length screen** (`length-ratios.json`, English characters ÷ OCR characters per column, tags and notes stripped):
- All three new arms keep the column split on all 20 leaves. One Flash read adds an extra break (Vol. 2 p. 270).
- The stored lite English has 0.00 for the right column on Vol. 1 pp. 251 and 456 (a `<note>` description in place of a translation) and loses the split on p. 631.
- Argon runs longest on the Nahuatl (1.1–1.9× the OCR), Opus shortest (0.9–1.35×).

**What the judges list.**
- **Opus compresses the Nahuatl.** It merges couplets and runs of near-synonyms into one phrase: the kinship and honorific terms on Vol. 3 p. 21, *ompilcatoque, ompipilcatoque* on Vol. 2 p. 479, the "reed-dweller" sense of *tullan tlacatl* on Vol. 3 p. 438. It also drops short clauses: the serpents (*cocoa*) on Vol. 1 p. 271, *teixpan* "in public" on Vol. 3 p. 147. Both judges list these as omissions on the same pages.
- **Opus can fill a hard line with plausible text.** Vol. 2 p. 114, checked by eye on the text: where the Nahuatl says *otiemocnelili in matzin, in motepetzin* ("you have done a favour to your water, your mountain", i.e. the city), Opus writes "<unclear>Now your hands and your feet may rest.</unclear>", and it drops *no tlaquauh* ("my rod") from the first line. Argon renders both.
- **Argon adds small glosses**, 0.6 a page: "wooden", "onto their oars", "here in Mexico". Two of its `<note>`/`<meta>` asides are false: on Vol. 3 p. 147 it says the columns are reversed on that leaf, and on Vol. 1 p. 271 it calls a numeral a scribal error.
- **flash-lite** summarises the Nahuatl on 15 of 80 judgements. Where it does translate, it still omits or mistranslates about 8 items a page.

**Position bias** was small for the Opus judge. The Gemini judge favours whichever arm is shown as A: Argon − Opus is +1.45 with Argon as A and +0.90 with Argon as B. Both orders still put Argon ahead.

**Limits.**
- n = 20 leaves. The Opus judge's Argon − Opus CI includes 0.
- Each judge leans toward its own family by an amount not measured here. The Gemini judge rates Opus's Nahuatl 3.40, the Opus judge 3.83. Read the pair differences, not the absolute scores.
- Opus read in 5-page blocks and the Gemini arms one page per call. That is how each would run in production, but it is not the same context for both.
- The OCR comes from the pipeline and has its own errors (one judge notes a word "on the page but missing from the OCR"). All arms translated the same OCR.
- The Book of a page comes from running headers, not a concordance. The draw only needs to spread the leaves, and it does.

**Verdict.** On the Nahuatl column, Gemini 4 Argon Low is ahead of Opus under both judges. The margin is clear under the Gemini judge (+1.18, 18 of 20 pages) and small and uncertain under the Opus judge (+0.20, CI −0.07 to +0.50). So Argon does not *clearly* beat Opus under BOTH judges, but neither judge puts Opus ahead of it. Opus does beat Gemini 3.8 Flash under the Opus judge. Any of the three new arms, given the column instruction, fixes the summarising: 0 summaries in 560 judgements, against 15 of 80 for the stored English. The running Opus job was left as it is.

**Artifacts.** `scripts/eval/results/florentine-compare-6865/` holds:
- `selection.json`, `page-ids.json`, `select.mjs`, `instruction.txt`;
- `judge-prompt.md`, `judge-build.mjs`, `claude-judge.py`, `run-judges.sh`;
- per pair: `key.json`, `key-swap.json`, the judge outputs and `requests.jsonl.gz`;
- `score.py`, `score-all.txt`, `summary.json`;
- the reads (`reads/*.tar.gz`, Opus with its prompts, raw replies and `calls.jsonl`), and `length-ratios.mjs` / `length-ratios.json`.

*Replicated?* No.
