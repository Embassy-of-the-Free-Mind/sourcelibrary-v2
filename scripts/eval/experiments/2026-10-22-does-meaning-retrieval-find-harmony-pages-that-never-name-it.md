---
stage: pipeline
measure: none
languages: []
scripts: []
canons: []
n_books: null
n_pages: 19487
verdict: "48 probe sentences for eight kinds of harmony retrieved 19,487 translated pages; 58% of the 28,287 matches name neither harmony, sympathy, concord nor consonance (ratio 37%, balance 74%)."
status: informational
decision: "Semantic map and theme river views on /explore/maps/harmony (#7129)"
superseded_by: null
issue: 7129
---
PRIOR ART: scripts/analysis/experience-map/retrieve/retrieve-probeset.mjs (#6652), the same probe → match_semantic design.
## 2026-10-22 · Does retrieval by meaning find pages about harmony that never use the word?

**Design.** 48 plain descriptive sentences, six for each of eight kinds of harmony and resonance
(`scripts/eval/harmony-semantic/probes.json`), embedded with gemini-embedding-2 (768 dims, the page vectors' model;
metered through `embedTexts`, under $0.01) and matched against `page_translations` with `match_semantic`
(threshold 0.45, 50 rows) once globally and once per language for 15 languages. A page "names" harmony if its
translation matches `harmon|sympath|concord|consonan|accord|resonan|attune|symphon`.

**Result.** 28,287 matches on 19,487 distinct pages; 16,520 (58%) never name the word. By kind: ratio 37%,
music of the spheres 48%, resonance 57%, feeling of consonance 60%, unlike things in one whole 61%, order 63%,
concord 63%, balance and temperament 74%. Top hits are on target (the answering-string probe returns Schott 1674,
Ens 1636 and Mersenne's Galileo first). The top 120 pages per probe (4,805) were embedded locally with
nomic-embed-text and laid out with UMAP for the map's semantic view.

**Limits.** Counts are capped (50 per slice), so "hits" is a ceiling per probe, not a census. Only translated pages
have vectors: untranslated books are invisible. Years are edition years. The "names" test is on the English
translation, so a translator's choice of word decides it.

*Replicated?* No. **Artifact:** `$JOB_SCRATCH/semantic/run1` (hits.jsonl, report.json); published
`public/data/maps/harmony-semantic/`.
