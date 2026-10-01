## 2026-09-24 — What is the efficient pattern for finding "body instruction" pages across 4.5M pages? (Jev, $8.57 total) — RESULT

**Headline: distil Jev into a linear probe on the page embeddings we already hold, then spend Jev only on the probe's top.**
Fresh check: of the probe's top 1,343 never-labelled pages (≤ 3 per book, 926 books), **44.5 % are Jev-positive**
(≥ 0.5), against **0.9 %** at random and **15.6 %** for the best Jev-only cascade. Scoring the whole corpus with the probe
is free and takes seconds; the verification pass cost **$0.08**.

**The steps and what each measured** (scripts in `scripts/eval/jev/`, rubric = the instruction-page judge prompt):
1. *Random base rate* — one random translated page from each of 21,018 books: 0.89 % ≥ 0.5, 0.07 % ≥ 0.9 ($1.08).
2. *Book screen* — Jev on each book's catalogue title+summary+categories (21,107 books, $0.42): at ≥ 0.5 keeps 32 % of
   pages, recall 91 % of the random-sample positives.
3. *Page `<summary>` only* — AUC 0.98 vs the full-page verdict, but only ~2.7× cheaper (question text dominates) and
   only 58 % of pages carry a summary ($0.23).
4. *Chapter summary* (the chapter's page summaries joined; chapters = `books.chapters`, 16,431 books, titles only) —
   AUC 0.96; at ≥ 0.2 keeps 11.6 % of pages, recall 92 %, ~57 tokens per page covered — ~20× cheaper than full pages.
   **Gap:** ~40 % of pages have no summary and they held about half the positives.
5. *Cascade at scale* — books ≥ 0.7 → 40,446 chapters → full pages of chapters ≥ 0.5 (stopped at the $8.50 cap after
   87,566 pages): 15.6 % ≥ 0.5, 1,375 pages ≥ 0.9 from 151 books.
6. *Embedding probe* — logistic regression on the 768-d `gemini-embedding-2-preview` page vectors (`~/sl-corpus/emb`,
   snapshot 2026-09-10) trained on 67,109 Jev-labelled pages: **AUC 0.949 on held-out BOOKS** (GroupKFold by book; the
   embeddings cluster by book, so a page split would flatter it), 0.977 on the random sample; top-50 of the random
   sample 34 % positive vs 0.3 % base. Then the fresh check above.

**Read by eye (18 of the fresh ≥ 0.8):** real finds no keyword search had reached — computus finger-counting, a Tamil
*Sara Nul* (science of breath), Sarum liturgy movements, the Shīʿa takbīr, Avicenna on exercise, Mersenne on the lute
hand, the Ars Notoria bed rite. Edge class: surgical/bloodletting procedures (body instructions, not practices) — the
companion Choice question files most of them as `none`, so filter on it.

**Not shown.** Labels are Jev's, not people's (Jev itself was AUC 0.94 vs Sonnet judges, #5006 pilot). Pages newer than
the 2026-09-10 embedding snapshot are invisible to the probe. One probe, one C; no per-kind probes; untranslated
pages untested.

*Replicated?* No. **Artifact:** `scripts/eval/jev/` (stage1–6, `probe.py`); results in the session scratchpad.
