---
stage: metadata
measure: agreement
languages: []
scripts: []
canons: []
n_books: null
n_pages: 292
verdict: "Jev with the judge-rubric question screens body-instruction pages at AUC 0.94 vs Sonnet labels (0.99 on confident pages), kappa 0.75, for $0.019"
status: informational
decision: null
superseded_by: null
issue: 5006
---
## 2026-09-24 — Can Jev (TypeSafe's typed-decision model) screen pages for "this tells a body what to do"? — RESULT

**Headline: yes, as a first-pass filter.** One Noul question worded from the instruction-page judge rubric
(`~/sourcelibrary-atlas/scripts/graph/instruction-pages-JUDGE-PROMPT.md`) over the 292 pages Sonnet judges labelled
on 2026-09-13 (144 instruction / 148 not): **AUC 0.94; 0.99 on the 194 pages the judges marked ≥ 0.85 confident.**
At threshold 0.3: accuracy 0.87, precision 0.93, recall 0.81, κ 0.75 (the two blind judges on H7 agreed at κ 0.86).
A naive one-line question does worse (AUC 0.89): the rubric wording matters. Cost for all 507 calls: **$0.019**
(~900 input tokens/page), 8 concurrent, 0 failures, ~0.2 s/call.

**Controls.** Negative: 133 random translated pages from the local mirror — 1 scored ≥ 0.5 (a Vajravārāhī sādhana,
plausibly a true find). Positive: the 82 quoted translations on /blog/techniques-of-the-body — 67 ≥ 0.5. The misses
are read by eye and are mostly *reports*, not instructions (Santorio weighing himself, Guarinoni watching handball,
Iamblichus' signs of possession, Marinus on Proclus' day, a bare list of the eight kumbhakas) — the rubric excludes
reports, so Jev is applying it more strictly than the page's curation did. Disagreements with the judges are mostly
ethnographic dance descriptions the judges themselves were unsure of (conf 0.55–0.7).

**Not shown.** Labels are Sonnet judges, not people. No test on untranslated OCR text (the state was English
translations). One prompt wording beyond the naive one. Recall on a fresh pool is unmeasured — the next step is a
wide candidate pool, human-read at the top.

*Replicated?* No. **Artifact:** `scripts/eval/jev/instruction-page-pilot.py` (gateway endpoint
`https://ai-gateway.vercel.sh/typesafe/v1/systemone`, model `typesafe-ai/jev`; a Vercel OIDC token from
`vercel env pull` works for 12 h). Results were written to the session scratchpad, not committed.
