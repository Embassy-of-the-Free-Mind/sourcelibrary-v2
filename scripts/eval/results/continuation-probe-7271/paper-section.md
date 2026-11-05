<!-- For .claude/docs/ocr-memorization-paper.md, after "### IA-OCR corpus baseline — pilot". The headless job's
     permission mode refuses edits under .claude/, so this waits for a session that can paste it (#7271). -->
### Continuation probe — image-free test of what the models know (2026-10-24, #7271)

`scripts/eval/continuation-probe-7271/` → `experiments/2026-10-24-continuation-probe-7271.md`.
A direct instrument, with no image: the first 60 words of a page, "continue this text exactly", and
the reply scored against the true next 200 words (longest shared run; share of 8-word shingles).
55 sealed pages, one per book; Opus (`claude -p`) and Gemini 3.8 Flash low (`agy -p`), $0
marginal. **Both control gates passed:** famous passages are continued near-verbatim (median run
200 words for both engines), and our own post-July text is not (median run 3–4).
**Result: a RECITATION refusal is not a memorisation signal.** Of the 20 pages lite refused, neither
engine continues one for 20 words (max 14, a shared patent preamble). Opus continues 4 of 20
matched never-refused pages near-verbatim (Locke, Burton's *Kama Sutra*, Wirth; R − M mean shingle
share −0.115 [−0.245, −0.014]); Gemini continues none. Refusal tracks *online presence* in Google's
citation index, not what a model can produce. For this paper, the census of refusals (#6740)
cannot stand in for the canonical/non-canonical split; use the probe itself, page by page.
**Contamination note:** Opus continued 151 words of *our own* July-2026 English translation of an
obscure 1600s disputation, but could not continue its Latin. So some Source Library translations
are probably in Opus 5.5's training data. Cite this with that hedge; the first-publication date of
that translation is not recorded. "Published after the cutoff" negative controls need a date well
after release.
