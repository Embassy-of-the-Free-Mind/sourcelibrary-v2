---
stage: ocr
measure: [judged]
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 1
n_pages: 525
verdict: "PENDING: pre-registration, written before the gate volume's audit was run."
status: undecided
decision: "pending"
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

(pending)
