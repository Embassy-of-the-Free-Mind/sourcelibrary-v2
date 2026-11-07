---
stage: ocr
measure: [judged]
languages: [la, grc, de]
scripts: [Latn, Grek]
canons: []
n_books: null
n_pages: null
verdict: "Pre-registration, written before any read: three cells, same random pages for every arm, the stop rule of 2026-11-04-route-free-analyses-7263 section 6. Results go in their own record."
status: informational
decision: "Nothing wired. Proposals per cell go on #7263."
feeds: route
superseded_by: null
issue: [7263]
router_evidence: "none — pre-registration, no verdict yet"
defect_rates: "none — nothing judged yet"
---
## 2026-11-04 · First route panel: pre-registration (#7263)

PRIOR ART:
- `scripts/eval/experiments/2026-11-04-route-free-analyses-7263.md`: the design source, the stop rule and its simulation.
- `scripts/eval/queue-routes-7853/` and `scripts/eval/router-confirm/confirm.mjs`: the arms, the page rule, the books-weighted draw; restated in `scripts/eval/route-panel-7263/` because each fixes its OUT and frames at module level.
- `.claude/skills/paired-arm-judge/SKILL.md` and `scripts/eval/route-judge-6740/paired-arm.mjs`: the recipe and its checks.

**Who it is for.** Derek deciding three routes, and later rounds that join the same pages. Derek approved this panel on 2026-11-04.

**Cells and arms** (agy is `gemini-3.8-flash-low`).

| cell | arm | what it is |
|---|---|---|
| latin-flash3/print | read4 | fresh read, 4 pages a call, the reread lane's argv under this panel's lane name |
| | pero4 | PERO draft (GPU) of all 4 block pages, corrected by agy 4 a call, template `agy-0601ef30e816f7a7`, `--over-stored` |
| | corr | the stored Flash 3 draft corrected by agy, 1 a call, fc template (the table's best agy route, 47/60) |
| | stored | the stored Flash 3 text; judged last, needed to decide a write, first thing cut if the budget binds |
| greek-flash3/print | read4 | as above. Measure only: Greek is held (Derek 2026-10-14, #6694), nothing written |
| | stored | the stored Flash 3 text |
| german-tr-lite/print | tr1 | `cli-translate.mjs read`, 1 a call, production's previous-page context |
| | tr4 | `claude-translate.mjs read --cli=agy --per-call=4` |
| | stored | the stored Flash-Lite English. "The Flash-Lite lane" in the brief is this stored text, because the brief forbids paid API and Flash-Lite is paid |

**Pairs under the stop rule (candidate vs reference).** Latin: read4 vs corr; pero4 vs corr; pero4 vs read4 (the missing same-page GPU + correction against a fresh read). Greek: read4 vs stored. German: tr1 vs stored; tr4 vs stored; tr4 vs tr1. The other direction is reported, not gated.

**Stop rule, as simulated.** d = accept(candidate) - accept(reference), paired, exact posterior (`stop_sim.py` p_within, Dirichlet over the four cells). First look at 20 pages, then every 10. PASS at P(d >= -0.08) >= 0.99. WORSE at P(d < -0.08) >= 0.90. Cap 100 books a cell. "Can't tell" at the cap is a result. An arm stops being read only when every pair touching it is decided. A decided pair stays decided. `look.py` applies it.

**Frame.** The cell's waiting queue. Book: visible, pages_count > 0, language `^Latin`, `^Greek`, or `^German` with year 1500-1800 for translation (`drawGerman`'s frame); not held (`pipeline_auto.hold` absent, status not `held`; for translation a hold of `translate-cli-7075` stays in, because those books wait for exactly this read). Books in the cell's `rules.json` evidence are left out. Page (OCR): `ocr.model` `^gemini-3-flash`, no `ocr.edited_by`, source not manual, not withheld, page type translatable, 300+ characters, not tagged handwritten, interior (15-95% by last page number), `scriptClass` print, image fetchable and 2 KB or more. Page (translation): `translation.model` flash-lite, not stale, not edited, not withheld, English newer than the OCR, OCR 300+ characters, same interior and print rule.

**Draw.** Seed 72631. Books by sequential Poisson PPS on the pages the census counts by stored model (`-ln(U)/w`, U from a hash of seed + book), one page a book, page uniform within the book's eligible interior pages, 130 a cell in a fixed order. Later arms take the first N. The list is frozen by sha256 before the first read. Derek, 2026-11-04: page-level evidence stays out of the public repo, so the list is kept privately (see the results record) with these hashes: latin 76d8eaf6d06cb027..., greek c239242535c1461d..., german 6c0c44373628456e....

**Blocks.** 4 consecutive page numbers holding the drawn page at a seeded position 0-3 (a window that leaves the book or skips a number slides to the nearest that fits; both positions are recorded). Only the drawn page is judged. A page re-read alone after a refused block is recorded by `call_pages`.

**Failures.** A failed, refused or filter-cut read counts as not accepted, costs no judge call, and is reported apart from misreads. This differs from earlier tests, which fell back to the stored text. A correction that answers UNCHANGED serves the stored text and is judged as such. Every text goes through the lane's dry apply with `--emit-written`, so what is judged is what the lane would write. Reads stay on the keep-read path; only repeats use `--fresh`.

**Judge.** Blind Opus, `judgePrompt` unchanged, image attached, one text a call, the same text on a page judged once. No Gemini judging of transcriptions. Ids are opaque.

**Noise floor.** In each cell the repeat arm (Latin read4, Greek read4, German tr4) is read a second time with `--fresh` on the first 30 pages and judged; and 30 same texts are judged again, so judge noise and route noise are separate. Two wrong-page controls per arm per cell (pass: accept false and fidelity <= 2).

**Second reader.** A random 20% of serious spans (misleads, wrong_text), severity not shown. Whole page, no crops (#8136's crops are not merged).

**Reported per arm.** Accept k/n with Wilson and book intervals; sense errors (misleads + wrong_text) per 1,000 words of the stored text, with book intervals; the bands of `regrade.mjs bandOf` (some / many); cost per usable page in tokens with GPU seconds; accept by position in the block; failed reads by kind. If the accept result and the per-1,000 result point different ways, the record says so and does not pick.

**Limits.** 1,300 Opus calls counted from the verdict files; pace guard at weekly 85, session 95. No paid API. agy accounts: james for Latin, milo for Greek and German.

**Writes.** Latin only as far as OCR: each page's best judged read through `cli-ocr.mjs apply` with its guards, lane `route-panel-1-7263`, only where that read is accepted and at least as good as the stored text, after the readers are stated on #7263. Greek: nothing. German: `cli-translate.mjs apply` only where the judged best read beats the stored English or none exists. No `rules.json`, `current.json` or routing-table change: proposals on #7263.

Verdicts go to `lane_judge_verdicts` as `origin: 'test'`, `selection: 'random'`.

### Amendment 1 (2026-11-04 16:35 UTC, before any look at Latin or Greek; German had 28 verdicts and no look)

The first batch ran 9 agy processes a cell beside another job's 26 GB in the 44 GB slice, and reads came back `cli exit -9` (`memory.events`: max 2,036, oom 58). A read the box killed is not a route outcome, so it is re-opened once (#7835 Amendment 1's rule), and a second kill counts as failed, kind `killed`, reported apart. agy now runs one at a time per arm. Other refusals stand as registered. Category `guard` names the lane's own diff and overlap guards ("only 30% of its words are in the stored read", "correction changes 50% of the draft's words", "a diff-guard flag spans a tag"): these count against the arm.

### Amendment 2 (same time)

Because a re-read whose words differ from a bad stored read is refused by the overlap guard, the guard can count against a good read. If budget remains after every pair, each guard-refused text is judged once, as read, descriptively. It does not enter the stop rule or any k/n.
