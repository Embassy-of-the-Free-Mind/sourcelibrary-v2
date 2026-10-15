---
stage: translation
measure: judged_vs_reference
languages: [la, grc, de, fr, it, nl, es, he, arc, ar, fa, sa, pi, lzh]
scripts: [Latn, Grek, Hebr, Arab, Deva, Hani]
canons: []
n_books: 361
n_pages: 361
verdict: "Gemini 4 Argon low (CLI) scores better than 3.8 Flash CLI (+0.23 [+0.16, +0.29]) and production (+0.51) on 361 reference pages, with 11 reversal pages against 32 and 46; better than 3.8 in Latin, Greek, Persian, Sanskrit, T4 and T5, the same in German, Hebrew, Arabic, Chinese, Pali and T3. It adds about 3.5× as many unsourced editorial facts."
status: undecided
decision: null
superseded_by: null
issue: [6750, 6182]
---
## 2026-10-15 · Does Gemini 4 Argon (low, through the CLI) translate the 365 xl reference pages better than 3.8 Flash and than production? (#6750)

PRIOR ART: `2026-10-08-cli-arm-xl-365-6331.md` (C38 on the same 365 pages, the same judges, prompt, plants and
duplicates; this run is that one with a new arm), `pareto-6182/RUNBOOK-cli38-xl.md` (its recipe),
`pareto-6182/build-xl-packet.py` (packet; gains `--g4l`), `pareto-6182/score-xl.py` (judge schema, strata, judge gate,
by-book bootstrap; `run_cli` gains arm and pair arguments), `tengyur-levers/score-ref.py` (gains `--round g4xl6750`),
`2026-10-14-gemini-4-argon-low-hard-panels-6707.md` (Gemini 4 Argon's CLI behaviour on OCR),
`g4-translate-6729/DESIGN.md` on `job-g4-translate-6729` (the same model on #6545's five hard-language panels: same
runner, `--kind translate`, plan mode). Nothing redrawn.

### Preregistration (committed and pushed before any C4L page was read)

**Question.** Arm **C4L** = `gemini-4-argon-low` through `agy -p` (Google subscription sign-in, no API key, $0), run
by `scripts/eval/run-cli-arm.py --kind translate --print-timeout 300` (plan mode: no tools; text-only requests, so no
workspace and no tool gate, as C38 ran). The prompt is each page's `prompt` from `/root/pareto-6182/units.jsonl`
**byte for byte**, the string C38 was sent; no markers are added (C38 had none). One page per call, at most 2 calls in
flight, at most 2 attempts per page. On the 365 `xl` pages of #6182 (Latin 71, Greek 69, Sanskrit 30, Pali 30,
Hebrew 29, Chinese 25, Arabic 24, Persian 23, German 22, French 14, Italian 10, Dutch 7, Spanish 6, Aramaic 5; one
page per book), each against its published English: is C4L better, the same, or worse than **C38**
(`gemini-3.8-flash-low` via `agy -p`, stored, `/root/cli38-6182/C38-full.jsonl`) and than **PROD** (the page's
stored production English: L31 `gemini-3.1-flash-lite` on 112 pages, FP `gemini-3-flash-preview` on 253)?

**Failed reads.** A C4L reply that is empty, timed out, filter-blocked, or that `cliChatterReason`
(`scripts/lib/cli-chatter.mjs`, the #6412 guard) flags (plan note, opener, tool output, refusal, code fence) is
re-read once from scratch; if the second read also fails, the page is a **failed read: counted and reported, not
scored**. A quota stop is not a failure: the run waits for the quoted reset and resumes (at most 3 times). C38 has
text on all 365 pages and none is flagged by the guard.

**Strata** (`score-xl.py`'s `STRATA`): Latin (71), Greek (69), T3 pool (German, French, Italian, Dutch, Spanish: 59),
T4 pool (Hebrew, Aramaic, Arabic, Persian: 81), T5 pool (Sanskrit, Pali, Chinese: 85), and all pages pooled.

**Design.** Each item: C4L, C38 and PROD in random order (seed 6750), labels T1–T3 only. Controls: 8 PLANT
(production English beside a copy with one reversal from #5829's planter) and 4 DUP (production, an identical copy and
C38): 377 items if C4L reads every page, 24 parts per judge; J2 reads every item in another order. Prompt:
`/root/pareto-6182/xljudge/PROMPT.md` (#5695's judge prompt, the one C38's round used; sha256 b0b98c17…). Two blind
Opus judges, `claude -p --model opus` on the Claude subscription (never through agy), one process per part, 3 at a
time; the driver is `/root/cli38-6182/judge-driver-xl.sh` with paths changed. Judge packets quote the published
references and stay on the box.

**Measures** (`score-xl.run_cli`'s, unchanged). Fidelity 1–5 per page per arm = mean of the scoring judges' non-null
scores; a reversal page = either judge lists a reversal (both judges reported beside it). Arms are compared on pages
where all three have a fidelity. By-book bootstrap 95% CI (books, then pages within; one page per book here), 2,000
draws, seed 6182. Per stratum and pooled: each arm's mean fidelity with CI; reversal pages and reversal pages per 100;
**C4L − C38**, **C4L − PROD** and C38 − PROD with CI, pages higher / lower.

**Verdict rule, per stratum and pooled, for X = C38 and X = PROD:**
- **better:** the CI of C4L − X lies wholly above 0 **and** C4L reversal pages ≤ X's + 2;
- **worse:** the CI lies wholly below 0, **or** C4L reversal pages > X's + 2 (the runbook's reversal rule; the
  verdict then says "more reversals");
- **same:** otherwise.
- Beside it, the runbook's non-inferiority gate (lower bound > −0.15 and reversals ≤ X's + 2), pass / fail.

**Per language** ("Gemini 4 Argon translates <language> better / same / worse than 3.8 Flash and than production"):
the same rule on each language with ≥ 20 pages (Latin, Greek, Sanskrit, Pali, Hebrew, Chinese, Arabic, Persian,
German). Languages with fewer pages (French, Italian, Dutch, Spanish, Aramaic) take their pool's verdict, and the
report says so.

**Judge gate** (`score-xl.judge_gate`): a plant is caught when the judge lists a reversal on the planted copy (and not
its twin) or gives it a lower fidelity, ≥ 6 of 8; duplicates tie (same fidelity, same rank tier) ≥ 3 of 4. Scored only
with the judge(s) that pass; if neither passes, the result is an instrument failure and no verdict is given.

**#6304 sensitivity.** `results/pareto-sample-audit-6304/drops.json`'s 20 translation pages in this set (Latin 1,
Greek 7, T4 4, T5 8). Primary on all pages; again without them, same rule.

**Reported beside the rule, not part of it:** omission, invention and span-off pages; length ratio C4L / C38; C4L
seconds per call, attempts, guard re-reads; the 3 pages where C4L and C38 differ most in fidelity, read against the
reference.

**Comparability note.** C38 was judged before (#6331) beside G38; here it is judged again, beside C4L. Levels are
compared only inside this round; the #6331 numbers are not mixed in.

Budget: $0. ≤ 500 agy calls per UTC day for this job; Gemini only through agy, Claude only through `claude -p`. No
database write.

### Amendment 1 (2026-10-15 22:45Z, after judging, before any result was read except the screen)

Two C4L replies passed `screen.mjs` though the prereg calls them failed reads ("filter-blocked"): Gemini's own block
messages, which `cliChatterReason` does not know. Found while reading the largest C4L − C38 pages, after both judges
had scored them:
- **L321 (Arabic, a *Kalīla wa-Dimna* page):** the whole reply was "The prompt could not be submitted.
  The prompt contains sensitive words that violate Google's Generative AI Prohibited Use policy …". It was never
  re-read (the screen did not flag it).
- **L345 (Latin, Swedenborg, *Vera Christiana Religio* §§828–833):** the first read was flagged (recitation filter) and
  re-read; the re-read was cut again mid-§832, with a `<warning>` that the translation "cannot be provided because …
  recitation filters".

**Change:** both pages are failed reads, counted and not scored. The pattern is now in `screen.mjs` (`FILTER`), and
`score-ref.py --round g4xl6750` drops C4L on every page in `failed.jsonl`. The run as judged (both stubs scored as
C4L's English) is reported too, as `--as-judged` (`scores-as-judged.json`). No other C4L, C38 or production text on
the 365 pages matches the pattern.

### Result (scored 2026-10-15, `score-ref.py --round g4xl6750`)

**Verdict: Gemini 4 Argon low through the CLI translates these pages better than 3.8 Flash through the CLI, and better
than production.** Pooled over 361 pages: fidelity 4.57 against 4.34 (C38) and 4.05 (production), C4L − C38 = +0.23
[+0.16, +0.29], C4L − production = +0.51 [+0.44, +0.58]. It reversed the sense of a statement on 11 pages, against 32
for C38 and 46 for production (2 / 23 / 32 where both judges agreed). By the preregistered rule it is **better than
C38** in Latin, Greek, T4, T5 and pooled, **the same** in T3 (German, French, Italian, Dutch, Spanish: 4.84 and 4.84,
where both are near the ceiling), and **better than production** in every stratum. Among single languages with ≥ 20
pages, better than C38 in Greek, Latin, Persian and Sanskrit (Sanskrit +0.68 [+0.38, +0.98]: C38 reversed 6 of 30
Sanskrit pages, C4L 1). The same as C38 in Arabic, Chinese, German, Hebrew and Pali. It is never worse than either.
The #6304 cut changes no verdict.

**Judge gate: PASS.** J1 and J2 each caught 7 of 8 planted reversals and tied 4 of 4 duplicates. Their fidelity scores
agree within 1 point on 99.6% of page × arm pairs. Judging 21:39–22:39Z, 48 parts, no failures or limit waits, $0.

**n = 361 pages, 361 books** (one page per book). Off the 365: C4L failed 3 reads (Italian: timed out twice at 300 s;
Arabic and Latin: the filter stubs above), and production has no English on one Pali page. Fidelity 1–5 is the mean
of both judges. Intervals are by-book bootstrap 95%. "Reversal pages" means either judge listed a reversal; the
both-judge count is in brackets.


**All pages (primary).**

| stratum | n | C4L | C38 | prod | C4L − C38 | C4L − prod | C38 − prod | reversal pages C4L / C38 / prod (both judges) | per 100 | vs C38 | vs prod |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Latin | 70 | 4.71 | 4.55 | 4.16 | +0.16 [+0.01, +0.32] | +0.55 [+0.37, +0.73] | +0.39 [+0.22, +0.55] | 1 / 6 / 12 (0 / 4 / 9) | 1.4 / 8.6 / 17.1 | better | better |
| Greek | 69 | 4.40 | 4.02 | 3.77 | +0.38 [+0.23, +0.53] | +0.63 [+0.46, +0.80] | +0.25 [+0.11, +0.40] | 4 / 9 / 9 (1 / 7 / 7) | 5.8 / 13.0 / 13.0 | better | better |
| T3 pool | 58 | 4.84 | 4.84 | 4.53 | +0.01 [-0.09, +0.10] | +0.31 [+0.15, +0.48] | +0.30 [+0.16, +0.46] | 0 / 0 / 5 (0 / 0 / 3) | 0.0 / 0.0 / 8.6 | same | better |
| T4 pool | 80 | 4.40 | 4.17 | 3.95 | +0.23 [+0.07, +0.38] | +0.45 [+0.29, +0.60] | +0.23 [+0.11, +0.34] | 3 / 7 / 11 (1 / 4 / 8) | 3.8 / 8.8 / 13.8 | better | better |
| T5 pool | 84 | 4.55 | 4.23 | 3.96 | +0.32 [+0.15, +0.49] | +0.59 [+0.43, +0.73] | +0.27 [+0.12, +0.40] | 3 / 10 / 9 (0 / 8 / 5) | 3.6 / 11.9 / 10.7 | better | better |
| **Pooled** | 361 | 4.57 | 4.34 | 4.05 | +0.23 [+0.16, +0.29] | +0.51 [+0.44, +0.58] | +0.28 [+0.22, +0.35] | 11 / 32 / 46 (2 / 23 / 32) | 3.0 / 8.9 / 12.7 | better | better |

**Languages with ≥ 20 pages, all pages.**

| language | n | C4L | C38 | prod | C4L − C38 | C4L − prod | C38 − prod | reversal pages C4L / C38 / prod (both judges) | per 100 | vs C38 | vs prod |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Arabic | 23 | 4.48 | 4.24 | 3.94 | +0.24 [-0.11, +0.56] | +0.54 [+0.22, +0.89] | +0.30 [+0.13, +0.48] | 1 / 1 / 2 (1 / 0 / 0) | 4.3 / 4.3 / 8.7 | same | better |
| Chinese | 25 | 4.36 | 4.16 | 4.02 | +0.20 [-0.02, +0.44] | +0.34 [+0.04, +0.66] | +0.14 [-0.08, +0.36] | 2 / 3 / 4 (0 / 2 / 1) | 8.0 / 12.0 / 16.0 | same | better |
| German | 22 | 4.86 | 4.93 | 4.64 | -0.07 [-0.20, +0.09] | +0.23 [+0.00, +0.46] | +0.29 [+0.09, +0.55] | 0 / 0 / 1 (0 / 0 / 0) | 0.0 / 0.0 / 4.5 | same | same |
| Greek | 69 | 4.40 | 4.02 | 3.77 | +0.38 [+0.23, +0.53] | +0.63 [+0.46, +0.80] | +0.25 [+0.11, +0.40] | 4 / 9 / 9 (1 / 7 / 7) | 5.8 / 13.0 / 13.0 | better | better |
| Hebrew | 29 | 4.47 | 4.47 | 4.24 | +0.00 [-0.19, +0.21] | +0.22 [-0.02, +0.48] | +0.22 [+0.09, +0.40] | 1 / 2 / 3 (0 / 2 / 2) | 3.4 / 6.9 / 10.3 | same | same |
| Latin | 70 | 4.71 | 4.55 | 4.16 | +0.16 [+0.01, +0.32] | +0.55 [+0.37, +0.73] | +0.39 [+0.22, +0.55] | 1 / 6 / 12 (0 / 4 / 9) | 1.4 / 8.6 / 17.1 | better | better |
| Pali | 29 | 4.66 | 4.60 | 4.12 | +0.05 [-0.19, +0.28] | +0.53 [+0.34, +0.72] | +0.48 [+0.28, +0.69] | 0 / 1 / 1 (0 / 1 / 1) | 0.0 / 3.4 / 3.4 | same | better |
| Persian | 23 | 4.33 | 3.96 | 3.76 | +0.37 [+0.15, +0.59] | +0.56 [+0.37, +0.78] | +0.20 [-0.07, +0.48] | 1 / 4 / 4 (0 / 2 / 4) | 4.3 / 17.4 / 17.4 | better | better |
| Sanskrit | 30 | 4.62 | 3.93 | 3.77 | +0.68 [+0.38, +0.98] | +0.85 [+0.60, +1.08] | +0.17 [-0.10, +0.42] | 1 / 6 / 4 (0 / 5 / 3) | 3.3 / 20.0 / 13.3 | better | better |

**Without #6304's 20 drops.**

| stratum | n | C4L | C38 | prod | C4L − C38 | C4L − prod | C38 − prod | reversal pages C4L / C38 / prod (both judges) | per 100 | vs C38 | vs prod |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Latin | 69 | 4.72 | 4.56 | 4.16 | +0.17 [+0.01, +0.32] | +0.56 [+0.38, +0.75] | +0.40 [+0.23, +0.56] | 1 / 6 / 12 (0 / 4 / 9) | 1.4 / 8.7 / 17.4 | better | better |
| Greek | 62 | 4.43 | 4.10 | 3.80 | +0.33 [+0.16, +0.50] | +0.63 [+0.44, +0.81] | +0.30 [+0.14, +0.46] | 4 / 9 / 9 (1 / 7 / 7) | 6.5 / 14.5 / 14.5 | better | better |
| T3 pool | 58 | 4.84 | 4.84 | 4.53 | +0.01 [-0.09, +0.10] | +0.31 [+0.15, +0.48] | +0.30 [+0.16, +0.46] | 0 / 0 / 5 (0 / 0 / 3) | 0.0 / 0.0 / 8.6 | same | better |
| T4 pool | 76 | 4.39 | 4.16 | 3.95 | +0.23 [+0.08, +0.38] | +0.44 [+0.28, +0.61] | +0.21 [+0.10, +0.32] | 3 / 7 / 11 (1 / 4 / 8) | 3.9 / 9.2 / 14.5 | better | better |
| T5 pool | 76 | 4.56 | 4.21 | 3.95 | +0.35 [+0.17, +0.53] | +0.60 [+0.45, +0.75] | +0.26 [+0.10, +0.42] | 3 / 10 / 9 (0 / 8 / 5) | 3.9 / 13.2 / 11.8 | better | better |
| **Pooled** | 341 | 4.58 | 4.36 | 4.07 | +0.22 [+0.16, +0.29] | +0.52 [+0.44, +0.59] | +0.29 [+0.22, +0.36] | 11 / 32 / 46 (2 / 23 / 32) | 3.2 / 9.4 / 13.5 | better | better |


**As judged (the two filter stubs scored as C4L's English), all pages:** the pooled verdicts are unchanged (+0.21
[+0.14, +0.28] against C38). Latin moves from better to the same (+0.12 [−0.05, +0.28]), T4 from better to the same
(lower bound +0.00), and Arabic against production from better to the same.
| stratum | n | C4L | C38 | prod | C4L − C38 | C4L − prod | C38 − prod | reversal pages C4L / C38 / prod (both judges) | per 100 | vs C38 | vs prod |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Latin | 71 | 4.68 | 4.56 | 4.18 | +0.12 [-0.05, +0.28] | +0.50 [+0.28, +0.70] | +0.38 [+0.20, +0.54] | 1 / 6 / 12 (0 / 4 / 9) | 1.4 / 8.5 / 16.9 | same | better |
| Greek | 69 | 4.40 | 4.02 | 3.77 | +0.38 [+0.23, +0.53] | +0.63 [+0.46, +0.80] | +0.25 [+0.11, +0.40] | 4 / 9 / 9 (1 / 7 / 7) | 5.8 / 13.0 / 13.0 | better | better |
| T3 pool | 58 | 4.84 | 4.84 | 4.53 | +0.01 [-0.09, +0.10] | +0.31 [+0.15, +0.48] | +0.30 [+0.16, +0.46] | 0 / 0 / 5 (0 / 0 / 3) | 0.0 / 0.0 / 8.6 | same | better |
| T4 pool | 81 | 4.36 | 4.18 | 3.95 | +0.18 [+0.00, +0.33] | +0.41 [+0.23, +0.57] | +0.23 [+0.11, +0.33] | 3 / 7 / 11 (1 / 4 / 8) | 3.7 / 8.6 / 13.6 | same | better |
| T5 pool | 84 | 4.55 | 4.23 | 3.96 | +0.32 [+0.15, +0.49] | +0.59 [+0.43, +0.73] | +0.27 [+0.12, +0.40] | 3 / 10 / 9 (0 / 8 / 5) | 3.6 / 11.9 / 10.7 | better | better |
| **Pooled** | 363 | 4.55 | 4.34 | 4.06 | +0.21 [+0.14, +0.28] | +0.49 [+0.42, +0.57] | +0.28 [+0.22, +0.35] | 11 / 32 / 46 (2 / 23 / 32) | 3.0 / 8.8 / 12.7 | better | better |

**Beside the rule** (pooled, all pages):
- **Omission pages:** C4L 4, C38 49, production 98.
- **Span off:** C4L 11, C38 8, production 31.
- **Invention** (gloss, unreadable fill or boundary, `score-xl.norm`'s measure): C4L 164, C38 128, production 145.
- **Added facts.** The judges list added facts separately, and `norm` does not count them as invention: editorial
  context the source does not state, such as dates, identifications, "This page from a 1495 Hebrew manuscript". C4L
  drew them on 323 page × judge readings, C38 on 92 and production on 107. The prompt asks for notes and a summary, so
  this is partly asked for. No judge checked whether these facts are TRUE. This is the main open risk, given #6420's
  failure mode (fluent, wrong).
- **Length:** C4L's English is 1.43× as long as C38's on the same pages.
- **Page by page,** C4L − C38: 135 higher, 54 lower, 172 tied.

**The three pages where C4L and C38 differ most** (failed reads aside), read against the source and the reference:
- **Sanskrit, the 1492 palm-leaf Bhagavad Gītā, f. 45 (L067): C4L 4.5, C38 2.0, production 3.5.** The verso OCR is
  mostly loops (a repeated nonsense string). C38 turned the loops into a devotee "Sudhama, devoted servant" who is not
  in the text. C4L said in a `<meta>` that the verso OCR is corrupt and supplied Gītā 11.25–28 from the known text; the
  judges found it consistent with Telang's English. That is reconstruction, not reading: it is labelled as such, but a reader still gets
  verses the scan's OCR does not carry.
- **Sanskrit, Kumārasambhava VII.28–30 with Mallinātha (L064): C4L 5.0, C38 3.0, production 3.0.** All three
  translate the verses correctly (Griffith covers only the verses). C38 and production cut the commentary's grammar
  (the Pāṇini rules, the variant footnotes). C4L translates all of it.
- **Arabic, al-Bīrūnī's *India* (L007): C4L 3.0, C38 5.0, production 4.0.** C4L reverses who honours whom. The Arabic
  (and Sachau) says the people favour their astronomers and the astronomers repay them with assent. C4L has the
  astronomers courting the masses. Both judges listed it. One of C4L's 11 reversal pages; C38 is right here.

**Calls.** 385 agy calls in all (1 probe, 384 translation calls) on 2026-10-15, 20:00–21:40Z, 2 in flight. No quota
event. Median 26 s per call, 90th percentile 42 s, maximum 88 s. The screen re-read 6 replies: 3 conversational
openers, 2 plan notes, 1 filter cut. 3 turns ended on a denied tool and were nudged. 1 call hit a 503 service error and
was read again. 1 page timed out twice.

**Limits.**
- AI judges (Opus), not a scholar. The three pages above were checked by this job against the source and the reference.
  Nothing else was checked by eye.
- Levels are this round's own. C38 scores 4.34 here and 4.47 in #6331's round on the same pages, because the scale
  shifts with the other candidates. Compare arms only inside one round.
- One read per page; there is no C4L A-vs-A repeat. C38's A-vs-A floor (±0.25 per language, #6545) has not been
  measured for C4L.
- C4L runs on the Google subscription and has no API list price. Whether it could carry production volume (the
  account is shared, and there are daily caps) is not measured here.
- Added facts were not checked for truth (see above).

**Chart.** In `build-translation-pareto.mjs`, every language chart with ≥ 10 pages left after #6304's drops gets a
panel "Gemini 4 Argon through the CLI, 15 Oct 2026 (#6750)": C4L (no price), C38 (at G38's billed dollars, as in
#6331) and production. That is Latin, Greek, German, French, Hebrew, Arabic, Persian, Sanskrit, Pali and Chinese.
Italian has 9 scored pages and gets none. `--check` passes. No existing panel changed.

Files: `scripts/eval/results/g4-xl-6750/xljudge/{key.json,scores.json,scores-as-judged.json}` (numbers only),
`scripts/eval/g4-xl-6750/` (runner, screen, judge driver). The judge packets, the outputs and the C4L English quote
published translations and the sources, so they stay on the box (`/mnt/HC_Volume_105839809/jobs/g4-xl-6750`).
