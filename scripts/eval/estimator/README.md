<!-- PRIOR ART: none — no README in scripts/eval/estimator/; scripts/eval/INDEX.md lists experiments, not this folder's layers. The ownership map lives on #7263. -->
# Estimator: which file is current

The router's evidence and models live here. Old versions stay beside new ones so that every published number can be reproduced. **Each version number belongs to one track.** "v2" in `model_v2.py` is not the same as "estimator v2" in `chain/`.

How the pieces connect, and who owns each, is on #7263 (top of the issue).

| track | current | kept for reproducibility | what it answers |
|---|---|---|---|
| **Router table, the decision-maker** | `router-table/` (`rules.json`, `build.py`; PR #7417; the prior's weight from `fit_prior.py`, #7263) | — | per cell: switch / keep / HOLD / test next, from acceptance against the page image (route-judge, #7376), with the models below as a weak prior (worth 7 pages, learned 2026-10-28) |
| Chained routes + capacity ("estimator v2", #7393) | `chain/` (`chain_v2.py`, `allocate_v2.py`, `capacity.json`, `cells.json`) | — | correction as a stage (draft → corrector), pages made better/worse, each channel's free week allocated across cells. A **prior** to the router table |
| OCR estimator | `ocr/` `*_v1.py` (+ `fit_ocr_v1_arabic.py`, #7372) | `ocr/` `*_v0.py` | accuracy, did-not-read, number errors, cost per usable page per engine × language (#7320) |
| OCR production rows | `ocr/route-census*.mjs`, `ocr/route-costs.json`, `ocr/quality-bars.json` | — | production's own record as estimator rows (#7375); prices per route |
| Translation fidelity model | `model_v2.py`, `build-table-v2.py`, `loo_v2.py`, `report_v2.py` (judge-family term, #6740) | `model.py` (v0), `model_v1.py`, and their `build-table` / `loo` / `report` | judged fidelity (1–5) per engine × language. The judge-family term is **not** used for routing (Derek, 2026-10-25) |
| Planner / route proposals | `planner/planner_v0.py`, `routing/derive_routes.py` | — | the older per-language KEEP/SWITCH proposals. Superseded for decisions by the router table |
| Row provenance | `provenance.mjs`, `provenance.py`, `provenance-schema.json` (#7389) | `provenance-legacy.json`, `label-legacy-rows.mjs` | every row names engine × prompt × read mode; the validator throws |
| Preregistered predictions | `predictions/`, `predict-6545*.py`, `score-6545.py` | — | the #6545 predictions of record |

**Nothing here writes data or routes pages.** A decision reaches production only by a PR to `scripts/lib/ocr-routing-table.json` (owner #6688) or `scripts/lib/translation-routing-table.json` (CLI rows, owner #7075), citing the router-table cell. That PR is on the hold list.

**A judged route test is not done until its evidence entry is in `router-table/rules.json` and the table is rebuilt** (a new dated `.md`/`.json` from `build.py --before <the last table>`). A result kept only in an experiment file or an issue comment does not move a posterior (#7263: the 10-27/28 tests sat outside the table until `router-table/evidence/derive_backfill.py`, the earlier ones until `derive_backfill_all.py`; which tests enter is `rules.json evidence_rules`). After a backfill, refit the prior's weight: `python3 router-table/fit_prior.py <the new table>.json`.

When you add a version, put it beside the old one, give it a `PRIOR ART:` line naming what it replaces, and update this table in the same PR.
