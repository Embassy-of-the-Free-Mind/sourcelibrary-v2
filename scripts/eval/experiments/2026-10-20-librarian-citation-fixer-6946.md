---
stage: pipeline
measure: judged
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Registered gate not met: G4 adjacent 72.5% (8 of 40 plants sat on caption lines the rule leaves alone). Amendment 1 (a caption whose image URL names another page goes through the fixer), tested on a fresh planted draw: gate met. Sonnet with span-checked moves cuts wrong-page links 410 → 182 (−56%); 4 of 2,294 links made wrong by a move; 30 of 1,781 correct links dropped."
status: adopted
decision: "Dry-run worker on l7a writes proposed edits to librarian_citation_fixes only (scripts/workers/librarian-citation-fixer.ts); nothing applies them to embassy_messages. Applying them is a separate decision (#6946)."
superseded_by: null
issue: [6946]
---
PRIOR ART: `scripts/eval/librarian-citations-6946/` (the Opus instrument: `packet.ts`, `JUDGE-PROMPT.md`, `judge-driver.sh`, used unchanged); the three earlier #6946 entries (`2026-10-18-librarian-citation-pages-6946.md`, `2026-10-18-librarian-cite-prompt-6946.md`, `2026-10-19-librarian-cite-ids-6946.md`), whose recorded answers and labels this replays. Code: `src/lib/embassy/citation-fixer.ts`; harness `scripts/eval/librarian-fixer-6946/`.

## 2026-10-20 · An offline fixer that reads the finished answer and the whole pages (#6946, stage 1)

**Who it is for.** A reader who clicks "p.323" under a Librarian answer. On live traffic about 18% of page links land on a page that does not say the thing (gauge, 2026-10-18).

**Design.** No new Librarian turns. One fixer call per recorded answer: `claude -p --model sonnet` on the subscription, given the answer (every page link marked) and the whole text of every page read that turn. Per link it answers `keep`, `move` (to another page read) or `drop`, and for keep and move it copies a verbatim span from the page. Code then decides:
- a `keep` needs 6 consecutive words of its span on the linked page;
- a `move` needs the whole span on the target page and not on the linked page;
- anything else becomes `drop`;
- a span under 4 words is unjudgeable and leaves the link as written.

Text is folded with `foldWords` (all scripts; a script without spaces matches by its letters). A page-break spread counts, but not for a span that sits wholly on the neighbouring page. Without that rule a span on p.22 validated a link to p.23; a unit test caught it before the run.
- A dropped link becomes `(not from the library's pages)`; Spanish: `(no procede de las páginas de la biblioteca)`.
- Links to a page that was not loaded, and caption links, are left alone.
- The edits come out as `grounding_edits` (`find`/`replace`/`at`, one per paragraph).
- **Instrument.** The #6946 Opus judge, unchanged. Pre-fix labels are each run's merged judges (J1 = J2, else J3; #6904 A and the gauge had one judge). Post-fix labels come from one fresh Opus judge on every answer the fixer changed (123 non-dev answers), blind. Unchanged answers keep their labels.
- **Data.** 298 answers and 2,479 page links:
  - #6904 A 37 and B 38;
  - #6970 A 38, B 37 and A2 8;
  - #7021 A 36, B 38, C 38 and A2 8;
  - the gauge's first run, 20 live turns, labelled fresh.

  14 dev answers tuned the prompt. They are reported apart. Gate preregistered in `83483c9aa`, amendment 1 in `e5f6bee3e` (`PREREGISTRATION.md`).

**Replay** (284 non-dev answers, 2,294 links judged before and after):

| | before | after |
|---|---:|---:|
| wrong-page links (other + none) | **410 (17.9%)** | **182 (8.5% of 2,131 left)** |
| answers with a wrong-page link | 167 | 117 |
| wrong_fact links (counted apart) | 103 | 110 |

| run | links | wrong-page before → after | moves (made wrong) | correct links dropped |
|---|---:|---|---:|---:|
| #6904 B | 204 | 23 → 13 | 4 (0) | 4/157 |
| #6904 A (non-dev) | 172 | 23 → 18 | 7 (1) | 2/132 |
| #6970 A | 177 | 26 → 14 | 4 (0) | 1/130 |
| #6970 B (non-dev) | 184 | 29 → 16 | 13 (1) | 1/136 |
| #6970 A2 | 36 | 4 → 3 | 1 (0) | 1/31 |
| #7021 A | 223 | 25 → 16 | 12 (1) | 3/175 |
| #7021 B (non-dev) | 523 | 108 → 42 | 25 (0) | 6/396 |
| #7021 C | 672 | 150 → 46 | 46 (1) | 9/501 |
| #7021 A2 | 51 | 3 → 1 | 2 (0) | 1/43 |
| gauge (live, 2026-10-18) | 105 | 19 → 13 | 3 (0) | 2/80 |
| dev set (14 answers, apart) | 130 | 28 → 18 | 10 (0) | 0/97 |

- **Moves (117).**
  - 71 went from `other` to `cited` and 2 from `none` to `cited`.
  - 18 were already right and stayed right.
  - 4 went from `cited` to `other`: these are the made-wrong moves (6904:A:q23 L6, 6970:B:q38 L2, 7021:A:q19 L9, 7021:C:q15 L3).
  - 6 went from `other` to `wrong_fact`: the page is now the right one and the claim misstates it.
- **Drops (163).**
  - 131 were wrong-page, 30 were `cited` and 2 were `wrong_fact`.
  - 20 of the 30 correct links lost were the model saying `keep` with a span the code could not find. That is the cost of the verbatim rule.
- **What it leaves.** 146 wrong-page links got a `keep` with a span that is on the linked page (56 `other`, 90 `none`). Several of the 9 read in the dev sample carry two claims on two pages (7021:B:q04 L8: the page says honey stands for the pleasure of generation, not the offerings to the gods below). The judge labels by the weaker claim, and moving one link cannot fix that. Not counted beyond the dev sample. A real quotation does not prove the claim; this is where the model's support judgement is too kind. 37 more are captions.
- **Noise floor.** Links left as written inside re-judged answers flipped 48 of 1,065 times: 13 into wrong-page, 35 out of it. So the fresh judge leans lenient, by about 22 links. Adding those 22 back, after = 204, still −50%.

**Gate** (non-dev, pooled):

| | registered (`83483c9aa`) | amendment 1 (`e5f6bee3e`) |
|---|---|---|
| G1 wrong-page ≥ 40% fewer, beyond noise | 410 → 182, −55.6% **pass** | same **pass** |
| G2 made wrong by a move ≤ 1% | 4 / 2,294 = 0.2% **pass** | same **pass** |
| G3 correct dropped ≤ 5% | 30 / 1,781 = 1.7% **pass** | same **pass** |
| G4 planted caught ≥ 80% adj., ≥ 90% other | draw 1: adjacent **29/40 = 72.5% fail**, other 18/20 = 90% | draw 2 (fresh): adjacent **35/40 = 87.5%**, other **18/20 = 90%** **pass** |
| | **not met** | **met** |

- **Why G4 failed as registered.** 8 of draw 1's 40 adjacent plants (and 1 other-book) were on image-caption lines. The caption rule leaves those alone by construction. On the links the fixer judged, it caught 29 of 32.
- **Amendment 1.** The caption rule exists because a caption links the image's own page. When the image URL names a page itself (`archived|enhanced/<id>/<n>.jpg`, `pages/<id>/<n>-full.jpg`), and that page is not the linked one, the link goes through the fixer.
  - On the replay, 194 of 195 caption links under those URL shapes name the URL's page.
  - The one that does not was judged `cited`, and the fixer kept it.
  - G1–G3 are unchanged (stored verdicts re-validated, no new calls).
  - Tested on a FRESH draw (new seed, no answer shared with draw 1 or the dev set).
  - Draw 1 under the amendment is exploratory only: Sonnet 31/40, Opus 32/40.
- **Planted links kept.** In draw 2, 5 adjacent plants and 1 other-book plant were kept. Each has a span found on the planted page and not on the original. In those cases the claim plausibly runs onto that page too (the Tao Te Ching ch. 1 quotation continues on p.55). They count as misses anyway.
- **Restored.** Of the 35 adjacent plants caught in draw 2, 28 were moved back to the original page and 5 were dropped.

**Sonnet vs Opus as fixer** (draw 1, the same 40 answers):

| | Sonnet | Opus |
|---|---:|---:|
| planted adjacent caught (amended rule; exploratory) | 31/40 | 32/40 |
| planted other-book caught | 18/20 | 18/20 |
| natural `cited` links dropped | 4/153 | **0/153** |
| natural wrong-page links acted on | 16/28 | 17/28 |
| same outcome per natural link | 183/199 (92%) | |
| fixer time p50 | 8.9 s | 12.7 s |

Opus drops fewer correct links. Otherwise the two arms are within a link or two of each other, at n = 40. Sonnet clears every threshold, so the worker uses Sonnet. Opus is the arm to try if the correct-dropped rate rises on live traffic.

**Cross-family labeller: not run.** `agy` is not signed in on l7a (`Please sign in`; it is signed in only on main, and the box mesh cannot run it there). The 100-link Gemini Pro check is still owed. Run the post-fix packets (`results/judge/links-fa.json` and the packets `label-packets.ts --mode=after` rebuilds) through `agy -p` on main.

**Spend.** $0 Gemini API. Claude subscription (`claude -p`), about 587 calls in total:
- Sonnet fixer: 27 dev, 288 replay, 40 + 40 planted;
- Opus fixer: 40;
- Opus judge: 20 gauge pre-fix + 131 post-fix;
- 1 worker smoke test.

This box's account (derek@sourcelibrary.org) went from 49% to 93% of its 5-hour window and from 65% to 73% of its week. Most of that was the Opus judging.

**Replicated?** The planted controls were replicated on two independent draws (catch 29/40 and 35/40, the difference being the caption rule). The replay spans ten recorded runs with 2,294 links, and its direction is the same in every run: wrong-page links fell in all ten.

**Worker** (dry-run, the gate met under amendment 1).
- `scripts/workers/librarian-citation-fixer.ts`, cron every 10 min on l7a under `flock -n` (`infrastructure/l7a-crontab`).
- It reads new AI turns from `embassy_messages`, runs the fixer, and upserts one document per answer into the NEW collection `librarian_citation_fixes`. Each document holds the proposed edits, the per-link outcomes, the model, the prompt hash and the status.
- It writes nothing to `embassy_messages`, the threads or the replay cache. Nothing reads `librarian_citation_fixes` yet. Applying the edits to what readers see is a separate decision.
- Guards: at most 8 calls a run and 200 answers a day, and no run when the box's account is at ≥ 80% of its 5-hour window or ≥ 90% of its week. The first live try was skipped by exactly this guard (93%).

**Artifacts.** `scripts/eval/librarian-fixer-6946/`:
- `build-items.ts`, `run-fixer.ts`, `plant.ts`, `label-packets.ts`, `score.mjs`, `PREREGISTRATION.md`;
- `results/`:
  - `fixed-replay.jsonl.gz`: per answer, the outcome, span, claim and edits for every link, plus the fixed text;
  - `fixed-planted1-{sonnet,opus}.jsonl.gz`, `fixed-planted2-sonnet.jsonl.gz`, `planted1.json`, `planted2.json`;
  - `judge/`: the gauge pre-fix labels `gb` and the post-fix labels `fa`;
  - `scored-nondev.json.gz`.

To re-score, rebuild the items with `build-items.ts` (support pages from each run's `support.json.gz`), then run `score.mjs --exclude=<dev regex>`.
