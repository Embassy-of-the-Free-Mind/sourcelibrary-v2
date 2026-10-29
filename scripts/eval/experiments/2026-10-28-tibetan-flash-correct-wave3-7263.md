---
stage: ocr
measure: [judged]
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 21
n_pages: 18
verdict: "Wave 3 of the Yigdzin -> agy Flash-low correction wrote 7,890 pages in 21 Thadrak Kanjur volumes on 2026-10-28/29 (gex45 4,356 and a detached cloudlayer driver 3,534), under the wave-2 rule. The second rolling audit STOPPED it: severe errors were introduced on 3 of 8 judged pages and controls were 11/16. The first audit had passed narrowly: 8/10 pages passing the re-score, 1 severe page, and controls 18/20 only after an empty slot was refilled."
status: stopped
decision: "STOP rule fired (brief, Derek 2026-10-28 11:29Z): writing stopped and what was written is left; the 4 audited pages with a severe introduction were put back on Yigdzin. 38,405 RISKY spans on 6,903 pages are queued for the #6740 judge loop (tranches w3a/w3b/w3c), not accepted. Whether to keep, re-judge or revert wave 3 is Derek's."
superseded_by: null
issue: [7263, 6740, 6560]
---
# Tibetan Flash-low correction, wave 3 (#7263, #6740)

PRIOR ART: `2026-10-26-tibetan-flash-correct-wave2-6740.md` (the rule, the guards, the Derge check, the rolling audit and
diff-QA, all reused unchanged). Code: `scripts/eval/tibetan-correct-6560/pass/` (`run-volume.sh` read stage,
`apply-volume.sh` + `derge-guard.mjs` = the wave-2 apply, `diffqa.mjs`, `leafcheck.mjs`, `rescore.mjs`).
Results: `results/tibetan-correct-6560/pass-wave3-7263/`, tranche files `results/tibetan-correct-6560/diffqa-6740/w3*`.

## What ran
- **Frame:** the next Kangyur volumes in `volume-ids.mjs order`, skipping every volume already corrected. All are visible and held only by the #4523 translation hold.
  - That is Thadrak rGyud 'bum Ga … Tsa and rNying rgyud Ka/Kha/Ga: 21 volumes, about 8.6K Yigdzin pages.
- **Reads:** agy `gemini-3.8-flash-low` on the second pool (`AGY_HOME=/root/.agy-james`, `AGY_POOL_SHARED=1`), with the #6560 CORR request.
  - gex45 made 7,027 calls: 4,161 on 10-28 (4% over the 4,000 a day cap) and 2,866 on 10-29.
  - The pool went from 89% to 70% of its week. That drop includes cloudlayer, the correction lane and Siku.
- **Apply:** the wave-2 rule.
  - Every `cli-ocr.mjs apply` guard; ya-btags changes kept only where Opus saw them.
  - The Derge rule: no page whose Derge identity falls by more than 0.01 where the draft has a parallel (identity ≥ 0.85).
  - `--mark-stale=tib-correct-6560`, with one run id per volume (`runs.json`).
- **Two hosts.** The first run of the job (cloudlayer) hit its Claude weekly cap, but its detached driver kept reading and applying. It walked the same order forward, one volume at a time.
  - The job moved to gex45 (`-mv`), which read four volumes at a time and, after the overlap was found, took the far end of the order.
  - Both hosts read rGyud 'bum Ca, Cha and Ja: about 1,400 wasted calls.
  - Kept-read reuse did not dedupe across boxes (3 of 416 pages), because the image bytes differ across boxes (Cloudflare Polish, `import-kept-reads.mjs` header).
  - No page was written twice by two reads of the same draft. The apply refuses a page whose draft is no longer stored. Pages one host's guards refused were sometimes written by the other host's fresh read (about 170 pages: 130 written by cloudlayer on gex45 volumes, 42 the other way).

## Written
| | gex45 | cloudlayer |
|---|---|---|
| pages written | 4,356 | 3,534 |
| refused: line count / 25% cap / Latin | 120 / 29 / 3 | not visible from gex45 |
| kept for Derge | 179 | not visible |
| reply unusable (cut before `<<<END>>>`, refusal) | 481 | not visible |
| put back after the audits | 3 | 1 |

Per volume: `pass-wave3-7263/written-by-volume.md`.

## Diff-QA (`diffqa.mjs spans`)
- 7,626 pages changed, carrying 55,824 spans:
  - **LOW: 17,419**, auto-accepted;
  - **RISKY: 38,405**, queued and not accepted.
- **Tranches for the #6740 judge loop**, in the tranche-2 request format (`leafcheck.mjs audit-req --pages --spans`, judge B with tiles, 2 controls a page):

  | tranche | pages | RISKY spans |
  |---|---|---|
  | `w3a` | 3,291 | 17,531 |
  | `w3b` | 2,951 | 16,623 |
  | `w3c` | 661 | 4,258 |

- Request images are on gex45 scratch. Each request's page id resolves to its archived image.
- **List rows for `merge`:** `diffqa.mjs list --run=<run id>` (drafts from `page_revisions`).
- No tranche was judged here: this box's Claude account was at 78% and then 86% of its week.

## Rolling audits (10 seeded written pages per ~4K, judge B with tiles, Opus, controls)
| audit | written so far | pages judged | pass (re-score) | fixed / introduced (severe) | pages with severe introduced | controls | rule |
|---|---|---|---|---|---|---|---|
| 1 (10-28 16:45Z) | 3,847 | 10 | 8 | 51 (1) / 14 (3) | 1 | 18/20 | continue |
| 2 (10-29 03:00Z, pages written after audit 1) | 7,890 | 8 | 3 | 24 (8) / 8 (3) | 3 | 11/16 | **STOP** |

**Audit 1.** The seeded draw's 10th page differed from its draft in whitespace only, so it had nothing to judge.
- That slot was filled with the next page of the same seeded sequence that has a span (`audit-1/replacement.json`).
- On the 9 pages first judged, controls were 16/18 (88.9%), which by itself would have stopped writing.

**Audit 2.** Two drawn pages had no syllable change and were not refilled: the rule had already fired at 8.
- The severe introductions:
  - རྨག→ཉི་མ. Counted as a "negation" because ཉི་མ contains the syllable མ, a classifier artifact; but the leaf shows the draft.
  - ནྲི→ནྲྀ and ཧ→ཧཱ: mantra respellings.
- All 5 control misses were "unclear". On rNying rgyud Ka p.363 the judge reported neither reading's phrase on the leaf. I checked it by eye: the text is the right leaf, so there is nothing to contain.

## Undo
- Each run: `node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id <run> [--apply]`. Run ids are in `pass-wave3-7263/runs.json`.
- The restores are runs `diffqa-6740-w3-audit1-restore` and `diffqa-6740-w3-audit2-restore` (`restores.json`).
