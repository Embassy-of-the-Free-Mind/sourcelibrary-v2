---
stage: ocr
measure: [judged]
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 1
n_pages: 525
verdict: "NO-GO again, on the pre-registered net bar. On a fresh gate volume (Thadrak Kanjur rGyud 'bum Ka, 525 pages, 492 changed), 40 changed pages were judged by two Opus instruments against the image. Tiled span judge: 28 better, 6 same, 6 worse. Whole-page route judge: 10 better, 25 same, 5 worse. Pooled: 27 better, 7 same, 6 worse. The bar was pooled worse <= 4 and better >= 3 x worse: better passes (27 >= 18), worse fails (6 > 4). The two judges agree at chance on which pages are worse (ordinal alpha -0.07, 40 pages; both say worse on 1 page). The whole-page judge found Flash dropping a whole line on 2 pages that the span judge scored better. The ya-btags guard held 2 of 525 pages (0.4%). Nothing was written."
status: rejected
decision: "Flash-low correction pass not applied: gate failed on pooled worse 6/40 (bar <= 4). No pages written, no re-translation queued; the pass stops at the gate (#6560)"
superseded_by: null
issue: [6560, 7263, 6740]
---
## 2026-10-27 · Flash-low correction pass into production, gated per volume (#6560)

PRIOR ART: `2026-10-15-tibetan-flash-pass-gate-6560.md` (the gate that failed: 10/40 pages worse with the tiled span
judge, bar <= 2) and `2026-10-27-tibetan-router-30-6740.md` (the router cell that switched to Yigdzin > agy Flash-low:
53/60 accepted against the image, whole-page judge, 1/30 pages worse). This entry reuses the #6758 pass machinery
(`scripts/eval/tibetan-correct-6560/pass/`) and adds the second judge to its audit.

### Pre-registration (written 2026-10-26, before any audit reply of the gate volume was read)

- **Gate volume:** `69e7aab880b52390feb197a8`, Thadrak Kanjur rGyud 'bum Ka, 525 frame pages: the first volume of
  `volume-ids.mjs order` that is not rGyud 'bum Kha (the #6758 gate volume).
- **Read and dry apply:** `run-volume.sh <book> --no-apply` (Flash-low, the #6560 CORR prompt, the ya-btags leaf
  check by sealed Opus). Nothing is written.
- **Sample:** `leafcheck.mjs audit-req --n=40 --seed=6560`: 40 pages drawn from the changed pages apply would write.
- **Judge 1, tiled span judge:** `tiles-req` + sealed Opus (`run-claude-arm.py`), scored by `audit-score`. A page is
  worse when the leaf shows the draft at more changed spans than the correction.
- **Judge 2, whole-page judge:** `page-req`: the route-judge prompt (`route-judge-6740/judge.mjs` `judgePrompt`),
  sealed Opus, one output a call, the draft and the written text judged separately and blind. A page is worse when
  fidelity drops, accept is lost, or a wrong-text defect is added (judge.mjs `made_worse`); better when fidelity
  rises and it is not worse; else same.
- **Pooled verdict per page:** the judges agree → that; worse against better → same; one says same → the other's
  verdict; a page one judge did not answer takes the other's.
- **Bar (gate):** pooled worse <= 4/40 AND pooled better >= 3 × pooled worse. Both judges are reported separately.
- **PASS:** apply the gate volume (no `--mark-stale`), then volume by volume in `volume-ids` order, each audited on
  10 changed pages with both judges. **Stop** the run if a volume's pooled worse > 2/10 or the ya-btags guard fires
  on > 1% of its pages.
- **FAIL:** nothing is written; report the numbers and the kinds of span that go wrong, and stop. The bar is not
  tuned after the data.

### Result

**Run (2026-10-26).** `run-pass.sh gate 69e7aab880b52390feb197a8`.
- **Read:** 525 pages, Flash-low through agy (527 calls, 2 re-reads), 0 reused, $0. Nothing written.
- **Dry apply:** 521 pages would be written, 492 of them changed. Refused: 1 reply cut before `<<<END>>>` and 1
  page that changed 47% of the draft's syllables. Held by the ya-btags guard: 2 pages (0.4%). Sealed Opus kept 1 of
  those 2 changes and answered unclear on the other (controls 4/4).
- **Audit:** 40 changed pages, seed 6560. Tiled span judge: 40 Opus calls, 448 changed spans plus 80 controls.
  Whole-page judge: 80 Opus calls, the draft and the written text judged separately.

| judge | better / same / worse (of 40) | other measures |
|---|---|---|
| tiled span judge (`audit-score`) | 28 / 6 / **6** | the leaf shows the correction at 310 of 424 decided spans (73% [69, 77]); controls 72/80 right |
| whole-page judge (`page-req`, route-judge prompt) | 10 / 25 / **5** | accepted: draft 27/40, written 30/40; wrong-text defects: draft 15, written 9 |
| **pooled** (the pre-registered rule) | **27 / 7 / 6** | bar: worse <= 4 and better >= 3 × worse → **FAIL** (better passes, worse does not) |

- **The judges agree at chance on which pages are worse.** Ordinal α −0.07 over 40 pages, **not settled**. Both say
  worse on 1 page (523). The span judge's 6 worse pages are better or same to the whole-page judge, and the reverse
  holds for 4 of the page judge's 5.

| span judge \ page judge | better | same | worse |
|---|---|---|---|
| better | 7 | 18 | 3 |
| same | 2 | 3 | 1 |
| worse | 1 | 4 | 1 |

- **What goes wrong, by the span judge** (114 spans where the leaf shows the draft):
  - 48 substituted words (O6): ནི→ཡང, དབང→དགྲ, ཡང→བརྒྱད, པ→རྐྱེན, གཅོད→ཆད, འཛུག→འཛུད, and mantra syllables
    re-spelled (ཧྲཱིཾ→ཧྲཱིཿ, ཨོཾ་ཏྲི→ཨོ་ཌི).
  - 30 tshegs inserted or removed (O8). 26 of them are on one mantra page (p. 350), splitting དྷཱཿསརྦ into དྷཱཿ་སརྦ
    where the leaf writes it joined. Also ཡི་ས→ཡིས.
  - 25 mantra vowel length or anusvara normalised (O8): ཧུྃ→ཧཱུྃ ten times on p. 433, ྃ→ཾ, དྲུཾ→དྲཱུཾ.
  - 8 syllables dropped or added (O5), and 3 particles or final -s normalised (O8).
- **What goes wrong, by the whole-page judge** (its 5 worse pages):
  - 2 pages lose a whole line on one leaf: p. 488 and p. 78 (O5, wrong text added). The span judge scored both
    pages better, because it judges the spans it is shown and not what a page lacks.
  - 1 page has a verse doubled (p. 218, O4).
  - 1 page has its verse numbers put out of step (p. 523, O7).
  - 1 page has seed syllables misread (p. 359, O6).
- **The same classes as #6758.** Normalising toward the expected spelling (O8) and substituted words (O6) are both
  back. Dropped lines are new, and only the whole-page judge sees them.

**Served draft, checked by eye (containment).** The whole-page judge tagged the served Yigdzin draft O1 on 2 pages.
- p. 418: the lower leaf's first line is served as a loop (ག་པ་དང་། །ག་པ་དང་། །ག་པ་དཱ་པ་དཱ་པ…). The leaf reads
  གྲི་གུག་… ཕྲེང་… སྣ་ཚོགས་ཕྱག་མཚན་… (full-resolution tile, by eye). Confirmed: the served text is not on the leaf.
  The book is already held (`tibetan-retranslation-awaits-derek`, #4523), and the page has no English. So there is
  nothing to withhold. The repair is owed, and is logged on #6560.
- p. 174: the extra line is a near-duplicate (O4). I could not confirm it by eye at this resolution, so it is left.

**Decision.** The gate failed on worse pages (6/40, bar 4). As pre-registered, nothing is applied and the run stops
at the gate. The routing row records the router's pick and this gate (`scripts/lib/ocr-routing-table.json`, row
`tibetan`). Pages changed: 0. Re-translation load: 0.

**What this does and does not say.** On whole pages Flash-low helps: accepted pages go from 27 to 30 of 40, and
wrong-text defects from 15 to 9. That agrees with the router cell. It also writes errors the leaf contradicts into
most pages it changes, and 6 of 40 pages come out net worse by one judge or the other. Two options would change this:
- a correction whose apply keeps only the spans a leaf check confirms (the ya-btags guard, extended to every span);
- a prompt that forbids normalising mantra and tshegs, and forbids dropping a line, measured through this same gate on
  a new volume.

Either one is a new pre-registration, not a re-cut of this bar.

**Cost.** $0 paid. 527 agy Flash-low calls. 122 sealed Opus calls on this box's subscription (2 ya-btags, 40 tiled,
80 whole-page).

Artifacts: `scripts/eval/results/tibetan-correct-6560/pass-prod-gate-69e7aab880b52390feb197a8/`. That holds the reads,
the dry apply, the ya-btags files, both judges' requests and replies, the audit key, and `audit40-gate.json.gz` (per
page: both verdicts and the pooled one).
