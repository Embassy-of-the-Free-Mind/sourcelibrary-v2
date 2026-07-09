# Quality control on four million machine-translated pages

*Draft blog post. Detecting and repairing translation collapse. ~7 min read. Suggested tag: Research / blue. Lead image: the Dicaearchus 1589 page scan.*

---

**Lead.** [*The Extant Fragments of Dicaearchus*](https://sourcelibrary.org/book/69b2f434f9f1ad2b3b15154a), printed by Henri Estienne in 1589, contains a page of Latin commentary on the monuments of ancient Athens — the theatre, the temple of Athena, the Parthenon. On [our copy of that page](https://sourcelibrary.org/book/69b2f434f9f1ad2b3b15154a/page/69b2f434f9f1ad2b3b15156c) the source scan is clean, but the English translation read, in full: a note saying *"continued from previous page,"* and one word, *"structure."* About twenty lines of Latin and Greek were not translated at all.

This is a known failure class. Neural translation systems sometimes produce fluent output detached from the source, including omission, where part of the input is silently dropped ([Guerreiro, Voita & Martins, 2023](https://aclanthology.org/2023.eacl-main.75/)). We call the severe form, where a page reduces to a fragment, *collapse*. We hold about **4.25 million** machine-translated pages and cannot read them all, so the question is not whether the system translates well on average, but how to find the pages it failed on — and how to keep the detection method from generating errors of its own.

## Detecting collapse, and two measurement errors

Collapse has a simple correlate: the translation is far shorter than its source. Length-based signals are standard in reference-free translation quality estimation precisely because they are cheap and need no gold reference ([Guerreiro et al., 2023](https://aclanthology.org/2023.eacl-main.75/)). A first pass flagged **51,227 pages (1.2%)**. That figure was inflated twice over, in instructive ways.

**The metric's hidden assumption.** We had also flagged translations much *longer* than their source as runaway repetition — a real decoding pathology ([Holtzman et al., 2020](https://arxiv.org/abs/1904.09751)). Almost none were. The flag assumed translation length ≈ source length, which fails on the highest-expansion material: one Chinese character maps to several English words, so a faithful translation runs roughly three times the source's character count. Of 1,258 such flags in our published books, 32 were genuine; the rest were correct translations.

**A noisy denominator.** Some flagged short pages had good translations; the defect was in the *OCR*. One page carried an OCR artifact — a single combining mark repeated thousands of times — that inflated the measured source length until the real translation looked tiny beside it. Because OCR error propagates into every measurement built on it ([van Strien et al., 2020](https://www.turing.ac.uk/news/publications/assessing-impact-ocr-quality-downstream-nlp-tasks)), a ratio of two noisy quantities compounds rather than cancels their errors.

Requiring the translation to be short in *absolute* terms, not just relative, removed both classes. The corrected estimate is about **25,000 pages (0.59%)**, of which roughly **3,100 are empty**. Half the original alarm was dense pages and OCR noise.

## What predicts a collapse

We expected the cause to be structural — the Dicaearchus page begins mid-sentence and ends on a catchword, so the model read the whole page as a continuation fragment and translated only the catchword. That story describes that page, but it does not generalize. Against healthy control pages from the same books, collapsed pages were no more likely to start mid-sentence (27% vs 26%), carry a catchword (5.6% vs 5.8%), or contain Greek (0.05 vs 0.06). Content and structure do not predict collapse.

One thing does: **length.** Collapsed pages have a median OCR body of **11,374 characters against 1,751 for healthy pages** — roughly six times longer. On a long, dense page the weaker model is most likely to abandon translation and fall back to summarizing. Two further patterns fit this. Collapses **cluster**: 41% sit within two pages of another collapse, far above their <1% base rate, so they arrive in runs rather than scattered. And they are partly **stochastic** — the Dicaearchus passage was scanned twice in this volume, and the [second copy](https://sourcelibrary.org/book/69b2f434f9f1ad2b3b15154a/page/69b2f434f9f1ad2b3b15155e) translated in full. Same input, different output. Which long page tips over is, at the margin, chance.

## The worst cases are not translation failures

The largest single block of collapses — about 11,800 pages — is Tibetan, and on inspection it is mostly not a translation problem at all. In a sample of Tibetan collapsed pages, **87% had OCR that was itself a repetition loop**: the OCR step, also a neural model, loops on repetitive liturgical script (mantras, Dzogchen texts) and emits twenty thousand characters of a single repeated syllable instead of the page. The translator receives that and correctly produces nothing. The empty translation is then flagged as collapse.

So the chain is: repetitive low-resource script → OCR loop → unusable input → empty translation. The fix is upstream OCR, not re-translation, and re-translating these pages cannot help. It also means the corpus collapse count is still inflated — the true *translation*-collapse problem is smaller and more concentrated in Latin-script text than the raw number suggests.

## A controlled comparison

Which model collapses is confounded by routing — we send Latin-script text to a cheaper "lite" model and harder scripts to a stronger "flash" one. Holding the language fixed removes the confound. For Latin, where the OCR is clean and the comparison is genuinely about translation:

| Latin, by model | Pages | Collapse rate |
|---|---|---|
| lite (legacy) | 704,900 | 0.378% |
| lite (current) | 309,086 | 0.208% |
| flash | 319,435 | 0.035% |

On the same language, flash collapses about eleven times less often than the legacy model that produced most of the backlog, and the ordering holds across every language tested. Two effects separate: the model (flash is steadier) and, independently, the script — on a fixed model, collapse rises from 0.38% on Latin to 1.7% on Hebrew to 5.6% on Tibetan. For non-Latin scripts the comparison is muddier, because much of what looks like collapse is the OCR problem above; the clean translation-model result is the Latin one.

## What checking a generative system requires

Four constraints came out of this, none specific to translation.

- **A cheap signal triages; a read calibrates.** Both retractions came from reading the flagged pages, not from a better formula. The workable pattern is a cheap filter to reduce millions to thousands, then sampled review to estimate the filter's precision before trusting its count.
- **The right threshold depends on the goal.** High recall with modest precision is fine for *estimating* a defect rate and wrong for *repair*, where each false positive is wasted compute or an overwritten good page. We ran the detector at two settings on purpose.
- **Make remediation non-destructive.** The repair re-translates with the stronger model but writes only when the result is measurably healthier, retains the prior version, and is safe to re-run. An imperfect detector is usable when the fix cannot make things worse.
- **Keep the checker independent of the checked.** Automated evaluation risks shared blind spots; LLM judges, for instance, favor outputs from their own model family ([Panickssery, Bowman & Feng, 2024](https://arxiv.org/abs/2404.13076)). Length and human reading are independent of the translation model in a way a sibling model is not.

A corollary is to catch the error at generation time rather than in a later sweep: the worker now retries a page that returns as a fragment before saving it, so the error never reaches search, embeddings, or a published edition.

## Outcome

Where the model choice is reliable — Latin and Greek — we re-translated under those constraints. **556 collapsed pages in published books were repaired**, the Dicaearchus page among them, with prior versions retained. (You can still find unrepaired collapses elsewhere — [this page of Aelian's *On the Nature of Animals*](https://sourcelibrary.org/book/69b52c133dd6d9423027d89c/page/69b52c133dd6d9423027d995), held back by a separate content filter.) The remaining backlog is mostly in unpublished books, and its hardest part — the non-Latin tail — needs OCR work before any translation model can help.

The general point is practical: with millions of machine-generated artifacts, the detection method is itself an instrument that has to be validated, and the first three estimates here were wrong before any was right. The defect rate matters less than knowing how reliably you can measure it.

## Methods

The diagnosis, the detection and repair tooling, the measurements, and a first draft of this note were produced by an agentic Claude Opus (Anthropic) session directed by Derek Lomas, as with these research notes generally. This is worth stating given the subject: the system under audit is Google's Gemini, which produced the translations and the OCR, and the auditor was a different model family — the kind of checker–checked independence the self-preference result above argues for, and more than a model evaluating its own outputs. It is not full independence; both are large language models and may share failure tendencies. And it does not exempt the auditor — the two measurement errors here were its own, caught only by reading the pages.

## References

- Guerreiro, N. M., Voita, E., & Martins, A. F. T. (2023). *Looking for a Needle in a Haystack: A Comprehensive Study of Hallucinations in Neural Machine Translation.* EACL. https://aclanthology.org/2023.eacl-main.75/
- Holtzman, A., Buys, J., Du, L., Forbes, M., & Choi, Y. (2020). *The Curious Case of Neural Text Degeneration.* ICLR. https://arxiv.org/abs/1904.09751
- van Strien, D., Beelen, K., Coll Ardanuy, M., Hosseini, K., McGillivray, B., & Colavizza, G. (2020). *Assessing the Impact of OCR Quality on Downstream NLP Tasks.* ICAART. https://www.turing.ac.uk/news/publications/assessing-impact-ocr-quality-downstream-nlp-tasks
- Panickssery, A., Bowman, S. R., & Feng, S. (2024). *LLM Evaluators Recognize and Favor Their Own Generations.* NeurIPS. https://arxiv.org/abs/2404.13076
