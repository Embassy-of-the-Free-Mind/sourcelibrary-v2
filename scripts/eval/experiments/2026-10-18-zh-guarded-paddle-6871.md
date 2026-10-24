---
stage: ocr
measure: agreement
languages: [zh]
scripts: [Hant]
canons: []
n_books: 50
n_pages: 50
verdict: "Guarded Paddle passes the preregistered bar in both classes on a fresh draw of 25 table + 25 mixed held pages, from books not in the first set. Paired against agy Gemini 3.8 Flash: table median Δ 0.0 (95% CI −3.9 to +0.7 pp, noise floor 1.9); mixed 0.0 (CI −0.9 to 0.0, floor 1.8). The frozen guard caught 8 of 8 collapsed or looped Paddle outputs and passed 34 of 35 good pages. Not preregistered: two works have no reader in either engine. Those are 欽定西域同文志 (polyglot glossary: Flash refuses or misreads, Paddle mis-orders the registers) and 琴譜合璧 (qin tablature: both fail)."
status: undecided
decision: "Apply guarded Paddle to the held table + mixed pages, except 欽定西域同文志, 琴譜合璧 and the 清文鑑 titles, which stay held. That is about 27,000 pages, ≈ 0.33 GPU-days plus ≈ 3,300 Flash calls. Awaiting Derek (DECISION on #6871). The writer, the provenance standard and a routing row come first"
superseded_by: null
issue: [6871]
---
PRIOR ART: `2026-10-18-zh-guarded-paddle-prereg-6871.md` (the preregistration this scores, committed in 282f64b54 before the draw ran); `2026-10-18-zh-residue-bakeoff-6871.md` (the bake-off the guard was designed on); `scripts/eval/zh-residue-refs-6871/` (the reference recipe, reused unchanged).

## 2026-10-18 · Does guarded Paddle read held Chinese tables and mixed prose as well as agy Flash, on fresh pages? (#6871 row 3)

**Yes, by the preregistered bar, in both classes.** Production Paddle, behind an output guard frozen before the draw,
is no worse than agy Gemini 3.8 Flash on 50 fresh pages. The guard sent every collapsed or looped Paddle output to
Flash. Two works are the exception, though the preregistration did not ask about them: neither engine reads them,
and they should stay held (below).

**Design.** As preregistered.
- **Draw.** `zh-confirm-6871/draw.json`, seed 68712: 25 table + 25 mixed pages, one page per book.
  - The books came from 85 table and 94 mixed held books. None was in the first draw, and no 清文鑑 titles were
    included.
  - All 50 pages were body pages, so nothing was replaced and the blank set is empty.
- **References.** Opus A and B read every page; C resolved the 35 pages where they differed, blinded.
  - Han disagreement, order-insensitive: table 0.6%, mixed 3.7%. Order-sensitive: 9.8% and 12.5%, which comes from
    ephemeris table direction and the register order of 西域同文志. `reliability.json`.
  - A single read sits 0.6% (table) and 6.3% (mixed) from the final. The first set's figures were 2.0% and 5.5%.
  - 3 places where both readers agreed were corrected by the resolver.
- **Arms.**
  - **P0**: `paddle-zh-box.sh arm`, layout off, one 2½-minute lock hold on gex45. It read 120 pages, drawn pages and
    alternates, in 90 s. The card was at 2 MiB afterwards.
  - **B2 and B2r**: `agy -p gemini-3.8-flash-low`, run twice, at $0.
  - **GP**: guarded Paddle, routed by `guard.py` + `ink.py`.
- **Paid spend: $0.** No gemini-3.1-flash-lite was run.

**The guard** (`guard.py`, designed on the 100 bake-off pages only). It flags a page on any of four rules, all
computed from Paddle's output and the image, with no reference needed:
- **LOOP**: zlib ratio < 0.25, or a 6-gram repeated ≥ 20 times;
- **OVERRUN**: more than 1.2 Han characters per unit of page ink;
- **COLLAPSE**: fewer than 0.06 Han characters per unit of ink on an inked page;
- **NUMERIC**: a dense numeral table, by numeral share or by glyph-blob count.

A flagged page goes to Flash, or is held if the page is near-blank.

**Result: primary metric per class, median (95% bootstrap CI); lower is better.** Table uses bag CER, mixed uses CER.

| arm | table (n=25) | table mean | table pages > 50% | mixed (n=25) | mixed mean | mixed pages > 50% |
|---|---|---|---|---|---|---|
| P0 Paddle as production runs it | 2.4 (1.6–8.3) | 16.0 | 3 | 6.3 (3.5–62.5) | 141 | 8 |
| B2 Flash | 4.4 (1.5–8.3) | 9.8 | 1 | 14.9 (3.1–31.0) | 33.4 | 7 |
| B2r Flash again | 2.4 (1.2–3.9) | 9.1 | 1 | 8.2 (3.1–48.6) | 33.4 | 7 |
| **GP guarded Paddle** | **2.0** (1.6–5.2) | **5.1** | **0** | 16.4 (3.5–50.0) | 31.4 | 7 |

**The bar** (each criterion as preregistered; all pass):

| | table | mixed |
|---|---|---|
| 1. median Δ GP − B2 (95% CI) | 0.0 (−3.9, **+0.7**) | 0.0 (−0.9, **0.0**) |
| noise floor = max(median \|B2 − B2r\| here, bake-off floor) | 1.9 (fresh) | 1.8 (bake-off; fresh 0.8) |
| CI upper end ≤ floor | **yes** | **yes** |
| 2. failures caught (pooled) | **8 / 8** (Wilson 68–100%) | |
| 3. good pages passed (pooled) | **34 / 35 = 97%** (Wilson 85–99%) | |

There were 8 failures on the fresh pages, so the partly-in-sample fallback was not needed. They were:
- table: 2 loops (4,080 and 6,823 characters for tables of 682 and 533) and 1 collapse (5 characters for 773). All
  three are 御製歷象考成·表 ephemeris tables, the same failure as in the bake-off.
- mixed: 4 collapses (1, 1, 1 and 16 characters) and 1 loop (1,375 characters on a 49-character tablature page).

The one good page flagged is a sparse 律呂正義後編 page: 32 characters on a heavily inked score page.

**Routes on the fresh pages** (Wilson 95%):

| | PADDLE | FLASH | HOLD | flags |
|---|---|---|---|---|
| table | 22/25 (70–96%) | 3/25 = 12% (4–30%) | 0 | NUMERIC 3, LOOP 2, OVERRUN 2, COLLAPSE 1 |
| mixed | 19/25 (57–89%) | 6/25 = 24% (12–43%) | 0 | COLLAPSE 5, LOOP 1, OVERRUN 1 |

On the three ephemeris tables the guard sent to Flash, Flash read 1.3–8.5%. **But on the second run Flash's safety
filter cut its reply on one of them** (B2 8.5%, B2r 97.7%). A FLASH route needs its own output check. The fix is to run the same guard on
Flash's reply, retry once, then hold. This was not preregistered.

**Not preregistered: two works have no reader.** The medians pass; the tails do not.
- **欽定西域同文志** (polyglot glossary; 2,667 unread pages, 21 vols). 5 fresh pages and 3 in the bake-off.
  - Flash's safety filter blocks or truncates these pages: 6 of the 10 filter hits in B2 + B2r are on this work.
    Where it does answer, Flash scored 93–100% on 3 of the 5 fresh pages.
  - Paddle passes the guard on 4 of 5, at 49–65% order CER. Its characters are mostly right (bag 7–18% on 3 of
    them), but the Chinese, Manchu, Mongolian, Tibetan and Todo registers come out in the wrong order. On a glossary
    that order is the content.
  - On the fifth page Paddle collapsed. The guard sent it to Flash, which scored 25%.
- **琴譜合璧** (qin tablature; 941 pages, 13 vols). 4 fresh pages.
  - Paddle collapses or loops on 3 of them; the guard catches all three.
  - Flash then scores 85–100% on them. Tablature glyphs have no Unicode character, and both engines invent
    characters for them.
  - The fourth page is lyrics only, and Paddle reads it at 3%.

Without these two works, the fresh mixed pages are 16. Of those, 2 go to Flash. One is the false positive. On the
other, a 律呂正義後編 page, both engines score 79%.

**Pricing the full run.** In-scope pages come from Mongo at 2026-10-18 06:12Z (`scope.json`):
- table: 15,280;
- mixed: 15,376, after leaving out 2,408 清文鑑 pages.

| scope | pages | P0 GPU time (3,399 pp/h, bake-off rate) | to Flash (point; Wilson range) | agy time at ≈ 150 pp/h (2 parallel, measured here) | held |
|---|---:|---:|---:|---:|---:|
| table + mixed, as preregistered | 30,656 | 9.0 h = **0.38 GPU-days** | ≈ 5,520 (2,410–11,260) | ≈ 37 h (16–75 h) | ≈ 0 on body pages (0/50, < 7%) |
| **recommended**: without 西域同文志 and 琴譜合璧 | **27,048** | 8.0 h = **0.33 GPU-days** | ≈ 3,300 (1,050–8,820) | ≈ 22 h (7–59 h) | same, plus the 3,608 pages of the two works and the 2,408 清文鑑 pages stay held |

- Paddle ran faster here: 120 pages in 90 s wall, about 4,800 pp/h. The table uses the slower bake-off rate.
- The Flash calls run on the agy subscription at $0, but they share the account's quota with every other agy job.
- At ≈ $8.18 a box-day, the GPU part costs about $3.
- HOLD will fire on the covers and blank leaves outside the body window, which this draw did not sample.

**What this does not show.**
- n = 25 per class. The catch rate is 8/8, and its Wilson lower bound is 68%. The bar was met as written, but a
  catch rate near 70% is not ruled out.
- The reference is Opus (two reads + resolver), not a human.
- The 21 other mixed works and 27 table works were sampled at one page per book. Works such as 欽定同文韻統 (501
  pages) had no page in either draw.
- Medians hide the tails above. The mixed mean is about 31–33% for every arm except raw P0 (141%, from loops).
- Order CER for tables (reported, not deciding): P0 3.1%, B2 6.1%, GP 3.1%.

*Replicated?* This is the replication of the bake-off's P0 ≈ Flash finding, on new books. The guard was frozen
first.

*Artifacts:* `scripts/eval/zh-confirm-6871/`:
- `draw.mjs` → `draw.json`;
- `fetch.py` (images, run on gex45);
- `ink.py` → `ink-fresh.jsonl` / `ink-bakeoff.jsonl`;
- `guard.py`;
- `insample.py` (the design-set check);
- `reads/{A,B,C}.jsonl` + `assemble.py` → `refs.jsonl`, `reliability.json`, `agreement-AB.json`;
- `out/{P0,B2,B2r}.jsonl.gz`;
- `score_confirm.py` → `results.json`;
- `scope.mjs` → `scope.json`.

Nothing was written to `pages` or to any production store.
