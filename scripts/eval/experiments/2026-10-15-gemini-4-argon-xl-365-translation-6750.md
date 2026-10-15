---
stage: translation
measure: judged_vs_reference
languages: [la, grc, de, fr, it, nl, es, he, arc, ar, fa, sa, pi, lzh]
scripts: [Latn, Grek, Hebr, Arab, Deva, Hani]
canons: []
n_books: 365
n_pages: 365
verdict: "Preregistered; no C4L page read yet."
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
