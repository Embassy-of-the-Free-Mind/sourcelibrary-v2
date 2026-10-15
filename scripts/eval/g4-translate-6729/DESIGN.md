# #6729 — Gemini 4 Argon low vs Opus vs 3.8 Flash, translation, the #6545 panels: preregistration

PRIOR ART: `scripts/eval/pro-translate-6545/` (#6545: panels, prompt, arms, judge prompts, plants, item line — reused,
not rebuilt); `scripts/eval/run-cli-arm.py` (the #6523 CLI route #6707 ran G4L through); `scripts/eval/lib/agreement-stats.mjs`
(`judgeReliability` / `reliabilityLine`, PR #6730); `2026-10-13-opus-vs-flash-translation-nahuatl-6559.md` (position bias
±0.6 under a Gemini judge → both orders).

Committed and pushed **before any G4 translation was read** (job g4-translate-6729, 2026-10-15). Anything changed after
the first read is an amendment below this line, dated, with what had been read by then.

## Question and decision
Does Gemini 4 Argon low (`gemini-4-argon-low`, `agy -p`, $0) translate Persian, Sanskrit, Chinese, Greek and Hebrew
better than Opus (the #6545 pick) and than 3.8 Flash? Decides whether G4L replaces or joins Opus in hard-language
translation.

## Pages, prompt, arms
- **Pages:** the #6545 panels, one page per book (so page-clustered = book-clustered): Persian 23, Sanskrit 30,
  Chinese 25, Greek 25 (the seed-6545 subsample), Hebrew 29 — 132 pages. `pro-translate-6545/common.py panel_uids()`.
- **Prompt:** byte-identical to the #6545 OPUS and C38S requests (units prompt + `TRANSLATE_SUFFIX` with the
  `<<<BEGIN>>>/<<<END>>>` markers). `req/G4L.jsonl` is a copy of #6545's `req/C38S.jsonl`, sha256 `8378bf66…e560`; the
  OPUS request file holds the same 132 prompts.
- **Arms:**
  | id | what | source |
  |---|---|---|
  | **G4L** | `gemini-4-argon-low` via `run-cli-arm.py --kind translate --print-timeout 300`, plan mode, 1 page per call, 2 in parallel, ≤ 2 attempts (one nudge if a turn ends on a denied tool) | new |
  | **OPUS** | Opus 5.5 `claude -p`, the #6545 run (2026-10-12) | stored, reused: same pages, same prompt |
  | **C38S** | 3.8 Flash low via `agy -p`, the #6545 run (2026-10-12) | stored, reused: same pages, same prompt, same runner |
  - Route note: the runner installs the #6523 tool gate only for image requests (it needs a workspace). Translation
    requests are text-only, so G4L runs exactly as C38S did (plan mode, no workspace; C38S had 0 nudges in 132). The
    markers are in the prompt and unwrapped by `pro-translate-6545/prompts.py unwrap()`, as for every #6545 arm.
  - Failed reads (empty, timeout, filter cut, chatter guard) are **counted, not scored** (#6523). A quota stop saves
    state and resumes; it is not a failure.
  - C38S2 (the #6545 A-vs-A) is not re-judged; its floor (±0.25, #6545) is cited, not recomputed.

## Judges (one round, all three arms together; levels are compared only inside this round)
- **Opus** (fresh, sealed `claude -p --model opus`, tools Read/Write/Bash only on its in/out files), `pro-translate-6545/JUDGE-PROMPT.md`
  unchanged, 3 items per call; the two orders of one page never in the same call.
- **Gemini 3.8 Flash high** (`gemini-3.8-flash-high`, `agy -p` via `run-cli-arm.py --kind judge --print-timeout 300`,
  one item per call), `pro-translate-6545/JUDGE-PROMPT-PRO.md` unchanged (same rubric word for word).
- Blind: shuffled labels T1..T3, no arm names. The judge sees source (OCR), the published reference, and the three
  candidates.
- **Both orders:** every page is judged twice, the second time with the candidate order reversed. Over pages the first
  order rotates so each arm is first, middle and last about equally often. A page's fidelity per arm is the mean of its
  two orders. The two orders are also the test–retest pair.
- **Planted-error controls (#6545's, unchanged):** 10 pages per panel, a copy of the stored C38 with ONE planted
  meaning error (negation / number or name / dropped clause, in rotation; `plant.mjs`, #6545 seeds), beside FP and
  C38S. Judged once, by both judges. A catch must locate the error at its span. Excluded from fidelity.

## Measures
- Per language × judge × arm: mean fidelity (1–5), 95% CI by 2,000 bootstrap draws over books; reversals and
  omissions per 100 pages.
- Paired, per language × judge: **G4L − OPUS**, G4L − C38S, OPUS − C38S, on pages where both arms read, with
  book-clustered CI, W/L/T.
- Position effect per judge (fidelity by slot), and order-1 vs order-2 swings.
- **Judge agreement (eval-design.md §2):** Krippendorff alpha via `judgeReliability()` / `reliabilityLine()`, bootstrap
  by book: Opus–Gemini on fidelity (ordinal) and reversal (nominal), on page×arm units; and each judge's test–retest
  (order 1 vs order 2). A rate on a measure below 0.667 is quoted as "not settled", per judge.
- **Recitation check:** longest shared word n-gram (lower-cased word tokens, tags and markers stripped) between each
  arm's output and the published reference. Flag every page > 12 words shared, for all three arms, and read each
  flagged G4L page (and the matching OPUS page) against source and reference.

## Rule (from #6729, per language)
- **G4L replaces Opus** if G4L − OPUS > 0 with the book-clustered 95% CI excluding 0 under **both** judges, with no
  excess recitation and failed reads ≤ 10% of the panel.
- **G4L joins as an equal** if the G4L − OPUS CI includes 0 under both judges (within noise), with no excess
  recitation and failed reads ≤ 10%.
- **Else Opus stays** (G4L below Opus beyond zero under either judge, or the judges split).
- **Excess recitation** = in that language, G4L has ≥ 3 more flagged pages (> 12 words) than OPUS, **or** the by-eye
  read finds ≥ 1 flagged G4L page that reproduces the published English where the source differs or is absent (text
  the page does not carry, or the reference's wording carried over a different source reading).
- The Gemini judge is the same family as G4L and C38S; the Opus judge is the same family as OPUS. Both are reported
  separately; neither is a headline. A verdict needs both.

$0: subscriptions only (agy for Gemini, `claude -p` for Claude). No production writes. Gemini quota: ≤ 2 agy calls in
parallel, no Pro.
