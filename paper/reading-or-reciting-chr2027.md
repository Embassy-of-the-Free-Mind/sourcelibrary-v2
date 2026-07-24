# Reading or Reciting? Measuring the Memorization Subsidy in Vision-Language-Model OCR of Historical Documents

<!--
  DRAFT MASTER (markdown; port to ACH LaTeX template before submission).
  Target: CHR 2027 long paper, 6,000 words excl. references/tables.
  Every numeric claim is tracked in paper/VERIFICATION.md and must be re-derived
  from scripts/eval/observations/*.jsonl + results/*.{jsonl,json,md} before freeze.
  Anonymization pass (submission copy only): replace "Source Library"/repo links
  with "a digital library of historical primary sources" + anonymized mirror.
  Word counts per section are tracked in the outline in
  .claude/docs/ocr-memorization-paper.md.
-->

**Abstract.** Optical character recognition for historical documents is now
dominated by vision-language models (VLMs), and its benchmarks are built almost
entirely on canonical texts — scripture, Homer, the Vulgate — because those are
the texts with published transcriptions to score against. But published
transcriptions are also training data: the ground-truth supply and the
contamination are the same variable. We measure the resulting **memorization
subsidy** directly. On matched passages of the same works in the same scans —
edition, typeface, and scan quality held constant by construction — frontier
models score 3–9 percentage points higher on hyper-canonical passages than on
mid-text passages of the same manuscript, and three models transcribe the opening
of the Iliad from a 1555 cursive manuscript at a flat 100.0%. We then show the
subsidy can be detected *without any reference text*: when a band of the page is
masked, models silently emit letter-perfect text for pixels that do not exist on
canonical passages (up to +37 points of reference coverage beyond what is
visible) while behaving as readers on non-canonical controls, and canonical
accuracy is robust to blur that collapses non-canonical accuracy on the same
page. These behaviors ground three consequences for evaluation practice:
consensus methods fail precisely on canonical text, alignment-conditioned
accuracy inverts model rankings relative to unconditional accuracy, and a
non-generative baseline (a public archive's legacy OCR of the same scans)
provides a contamination-robust difference-in-differences frame at zero cost. We
release a 44-page, 1,700-run dataset with per-passage canonicity labels and raw
model outputs, and describe how a working digital library uses these instruments
to publish calibrated accuracy claims about its own corpus — including the
scripts for which no honest calibration is yet possible.

## 1. Introduction

In the evaluation set we describe below there is a page from a Greek manuscript,
copied by hand around 1555, holding the first lines of the *Iliad*. Three
frontier vision-language models transcribe that page at 100.0% character
accuracy. The same models, on a page of the same manuscript in the same hand
holding a passage from Book XIII, drop three to nine points. Nothing about the
optics changed: same scribe, same ink, same digitization. What changed is how
often the passage appears in training corpora. And when we cover a quarter of the
canonical page with a gray rectangle, the models transcribe straight through it —
emitting, without comment, letter-perfect text for lines that are not visible at
all.

This is not a curiosity about one manuscript. It is a structural problem with how
historical OCR is evaluated. Benchmarks in this field are built from texts with
published scholarly transcriptions, because a benchmark needs ground truth and
transcribing early print or manuscript material is expensive. But the texts with
free transcriptions are, by that very fact, the texts most likely to be in a
model's training data — often in many editions. **The ground-truth supply and the
contamination are the same variable.** A score computed on Genesis measures some
mixture of reading the page and reciting the training corpus, and the mixture is
unknown. What a digitization project needs to know — how well a model reads the
rare, untranscribed material it actually exists to serve — is precisely what such
a score cannot say.

Test-set contamination is well documented for text benchmarks, and has recently
been demonstrated for speech recognition, where verbatim test transcripts in
pretraining data measurably deflate error rates. For OCR — the modality where the
contaminated ground truth is not an artifact of careless test-set handling but a
structural property of where transcriptions come from — the quantity has not, to
our knowledge, been measured. This paper measures it, and contributes:

1. **A memorization control**: canonical and non-canonical reference passages
   pinned on pages of the same books — including four *within-work* pairs where
   both passages belong to the same work in the same physical scan — each row
   visually audited against the page image under an explicit anti-recitation
   protocol.
2. **A reference-free recitation detector**: occlusion-cloze and
   blur-degradation probes that separate reading from reciting per page, with no
   transcription required, validated against the labeled pages and yielding a
   graded per-passage retrievability score.
3. **An outcome battery** that separates failure modes conventional CER hides —
   in particular, unconditional accuracy reverses the model ranking that
   alignment-conditioned accuracy produces, and agreement-based consensus
   methods fail exactly on canonical text, because models reciting the same
   memorized passage agree with each other while both misreport the page.
4. **A released dataset** (44 pages, ~1,700 raw model runs, per-passage
   canonicity labels, license-gated reference texts) plus the practice we built
   on top of it: a public, calibrated, per-script-and-century accuracy scorecard
   for a working digital library, with uncalibratable strata reported as such.

Throughout, we frame the design as a restoration of the factor-analytic
evaluation tradition of the 1990s OCR literature for the VLM era, with passage
canonicity as the new factor the field has not yet labeled.

## 2. Related work

**Contamination and memorization.** Benchmark contamination in language models is
an established concern, with surveys calling for per-benchmark measurement rather
than blanket suspicion. Extraction studies show verbatim memorization of long
literary passages scaling with model size and duplication, and per-work analyses
show that memorized books inflate downstream task performance — the closest
existing statement of a "memorization subsidy," made for text-only tasks. On the
multimodal side, contamination detection has reached VQA benchmarks, and déjà-vu
memorization has been shown for image content; text recitation *through the
vision channel* under OCR instructions is the lane this paper occupies. The
nearest cross-modal precedent is in speech: verbatim LibriSpeech transcripts in
pretraining data measurably improving reported WER, and a recent Swiss German
case where contamination fabricated a state-of-the-art claim. We position our
contribution as: known in speech, structural in OCR, now measured.

**Historical OCR evaluation.** The UNLV-ISRI annual tests of the 1990s
established stratified, factor-analytic OCR evaluation; recent reviews indict the
current VLM-OCR literature for abandoning that tradition — historical material
underrepresented, CER-centric metrics blind to structural failure, contamination
unexamined. Flagship historical benchmarks aggregate scholarly transcriptions at
scale without canonicity labels; one prominent suite maintains a private test set
precisely because public-set contamination is assumed but unmeasured. Studies of
VLM reading behavior document language-prior interference — silent orthographic
modernization, fluent-but-wrong scene text — and the digital humanities
literature has begun to note whole-page hallucination qualitatively. Our design
turns these observations into measured quantities with controls.

**Consensus and agreement methods.** A growing line uses cross-run or cross-model
agreement to estimate OCR quality without ground truth. These methods assume
independent errors. We document their failure condition: on canonical text,
recitation makes errors *dependent* — two models reciting the same critical
edition agree perfectly while both misreport the page — and we measure the
resulting collapse of the agreement–accuracy relationship.

**The nearest neighbor.** Karamolegkou et al.'s *Reading or Guessing?* (2026)
examines VLM OCR on Ancient Greek critical editions and shows through
perturbation analysis that errors remain fluent and weakly image-conditioned. Our
title is a deliberate, acknowledged echo: guessing — the prior filling gaps —
and reciting — the prior *replacing* the page — are distinct phenomena, and the
distinction is exactly what our canonicity labels, within-work pairs, and
occlusion probes isolate. That work does not label canonicity, quantify a
memorized-versus-novel gap, or release covariates; we differentiate by measuring
the contamination itself.

## 3. Dataset and design

**Pages.** The evaluation set comprises 44 pages from editions and manuscripts
held and publicly served by a working digital library: Armenian (9), Greek (13),
Latin (7), Hebrew (4), German (5), and Chinese (6) pages spanning early print,
manuscript, and woodblock, 1500s–1900s. Every page carries visually audited
covariates — source class, layout, density, type size, typeface — plus the
measured resolution of the exact image served to the models (0.64–17.4 MP, a 27×
range), and two labels this paper introduces: `canonical_text` with a graded
`memorization_risk`, and, for eight pages, `same_work_contrast` links forming
four within-work pairs.

**The within-work pairs** are the design's core control. Pooled
canonical-versus-non-canonical comparisons confound canonicity with everything
else that varies across pages — script, layout, scan quality, era. A same-book
contrast (the canonical *Aeneid* opening versus the non-canonical *Vita
Vergilii* in the same 1580 volume) removes the binding but not the genre or
typesetting. A within-work pair removes nearly everything: Vulgate Genesis 1
versus the Genesis 5 genealogy four leaves later in the same 1566 Louvain
Vulgate; *Aeneid* I.1–4 versus X.362–382 in the same 1580 commentary edition;
*Iliad* I.1–7 versus XIII.493–517 in the same 1555 manuscript, same hand; John
1:1–14 versus 1 Chronicles 1:1–23 in the same 1805 Zohrab Bible. Within a pair,
edition, typeface, scan campaign, and (for the manuscript) scribe are held
constant by construction; what varies is how often the passage occurs in
training data.

**References.** Reference texts come from published scholarly transcriptions
(TITUS, First1KGreek, the Deutsches Textarchiv, Wikisource, ctext), several of
which preserve the print pagination of editions the library physically holds —
making page-aligned ground truth available at near-zero cost. The reflexive
point recurs here: these free transcriptions exist for exactly the texts models
have memorized, which is why the non-canonical rows (editor prefaces, mid-text
passages of rarely digitized works) required hunting. Where a source license
forbids redistribution, the released dataset ships a sha256 pointer and
retrieval instructions instead of text, so every score remains verifiable.

**Anti-recitation protocol.** Every pinned page was audited against the page
*image*, never against OCR output. The protocol exists because it caught real
fabrications: two early canonical rows — a 1450 Mishnah manuscript and a Daxue
Huowen page — were deleted after image audits showed models emitting
letter-perfect canonical text that is not printed on those pages at all. Perfect
scores on degraded or manuscript sources are treated as hallucination flags, not
achievements.

**Outcome battery.** Each run is scored on several outcomes because each
isolates a failure mode the others hide: an alignment gate (is the passage
usably present in the output at all); character accuracy conditional on
alignment; *unconditional* character accuracy over all runs; truncation rate; a
reading-order dispersion score; and two accuracy variants — a free-skip
subsequence score (upper bound, insensitive to interleaved commentary) and a
windowed fitting score (lower bound, charging interior junk) — which bracket the
truth and whose divergence is itself diagnostic. Raw model outputs are retained
and scores re-derived at build time, so the dataset can be re-scored under any
future metric.

**Models.** The battery covers the Gemini 3.x/3.5/3.6 families, Claude Sonnet, a
specialist OCR system (Mistral-OCR), open-weight models (Qwen3-VL, Gemma 3/4,
DeepSeek-OCR) across three serving providers, and the library's production
pipeline; serving provider is recorded as part of the system under test, because
identical weights behaved differently across providers.

## 4. Measuring the subsidy

**Within-work pairs (Table 1).** On the manuscript pair the gradient is large
and consistent: canonical *Iliad* I reads at 100.0% for three models (a
recitation flag by our own protocol — this is 16th-century Greek cursive) and
99.4–99.8% for a fourth, while *Iliad* XIII in the same hand drops to 90.7–97.2%
— a within-work subsidy of 3 to 9 points with page difficulty removed by
construction. On clean print the within-work gradient is small (0–2 points) for
models that read the page, and the interesting failure is behavioral rather than
character-level: on the repetitive Genesis 5 genealogy, two models that read
Genesis 1 fluently fail the alignment gate outright (one falls from 98.7% raw
coverage on Genesis 1 to 46.4% on Genesis 5) — repetitive low-canonicity text
triggers the truncation-and-scramble failure mode. The Zohrab pair *inverts*:
canonical John 1 scores worse than the Chronicles genealogy for every engine,
because 480 pages apart in a large composite volume the typography differs — a
design lesson we report rather than hide: within-work does not guarantee
within-difficulty; future pairs should come from the same quire.

**Same-book contrast.** The 1580 Virgil volume separates canonical from
non-canonical across a binding: the *Aeneid* opening beats the *Vita Vergilii*
in the same book for every model tested, by 1.0 point for the largest model and
5.4 for the cheapest — the subsidy is real for all, larger for small models.

**Why pooling fails — and why that is the point.** At 23 pages, the pooled
canonical-minus-non-canonical gap read +2.2 points for the largest model; at 40
pages, after adding cleaner non-canonical pages, the pooled statistic shrank,
vanished, or reversed depending on the model — it moved with the page mix,
exactly as a difficulty-confounded statistic must. We report this plainly
because it is the methodological core: the subsidy is only measurable under
within-work (or at minimum within-book) controls, and any pooled
canonical-versus-non-canonical number from an uncontrolled benchmark should be
presumed to be measuring page difficulty.

## 5. Detecting recitation without references

The controls above require reference texts. The probes below do not — which
matters, because the material a digitization project most needs to certify is
precisely the material with no transcription.

**Occlusion cloze.** Reading requires pixels; reciting does not. We mask a
contiguous interior portion of the reference passage (27–50% of its printed
lines, first and last lines always visible — a cloze with strong local context),
audited per page so the masked share is known, and measure *fill-in excess*: the
occluded run's reference coverage minus the visible share. A reader scores near
zero or below (occlusion also disrupts reading order); a reciter scores
positive. Across 10 pages × 2 models × 2 runs: every canonical page fills in
strongly (+9 to +37 points — the maximum on the *Aeneid* opening, and +17 on
the 1555 *manuscript*), while the two structurally unpredictable non-canonical
controls sit at −3 to −6. In 27 of 28 occluded runs the model gave no indication
whatsoever that part of the page was covered: the invented text is emitted with
the same fluency as the read text. Ranked, the excess column forms a graded
retrievability score — a first empirical canonicity *slope* rather than a binary
label.

**The confound the probe surfaced.** Two non-canonical pages also fill in
positively: the Genesis 5 begat-list and the Armenian 1 Chronicles genealogy
(+13 to +28). Both are genealogies — name chains whose *content* is
reconstructable from cross-lingual biblical knowledge even where the exact
wording is rare (the Armenian case is reconstruction in Armenian orthography of
a sequence memorized from other languages). The cloze therefore measures
retrievability = memorization + structural predictability, and the honest
control for a membership test is text that is unpredictable *and* unpublished —
which reference-bearing pages, reflexively, can never fully be.

**Blur as the geometry-free twin.** Gaussian blur degrades glyphs everywhere at
once, needing no mask placement. Under σ=4 blur at a fixed 2000px width, the
canonical *Iliad* page holds 100.0/99.8% while the non-canonical page of the
same manuscript collapses by 32–48 points: degradation robustness on the
memorized passage only. On clean print this blur level barely binds for either
class, so the blur probe requires degradation strong enough to impair *reading*
before memory's robustness becomes visible; occlusion works everywhere but
requires geometric audit. The two are complementary arms of one test.

**An honest note on instrument development.** Our first occlusion pilot used a
fixed mid-page band. A post-hoc image audit showed the band had missed the
reference passage entirely on two of five canonical pages — producing flat
deltas indistinguishable from recitation — and that eyeballed mask-overlap
estimates carried ±10–15 point uncertainty. The version reported here places
masks per page and computes the masked share from reference-text offsets; we
document the correction because score tables alone would never have revealed the
flaw, and because "audit the manipulated image, not the metric" generalizes.

## 6. Consequences for evaluation practice

**Consensus methods fail where they are most trusted.** Agreement between
independent readings is the standard reference-free quality signal. On
non-canonical anchor pages, agreement predicts reference-scored accuracy well
(r ≈ 0.75 in our calibration; r = 0.85 within Greek). On canonical pages the
relationship degrades — and mechanistically must: recitation makes model errors
dependent, so two models reciting the same critical edition agree while both
misreport the page. At corpus scale (109,953 same-page double-OCR pairs from
the library's revision history) agreement varies far more by era and script than
by model, and both failure directions are measurable: inflated agreement on
memorized text, and understated quality wherever the metric is mis-specified
(space-less scripts) or the page holds no text at all. Any
agreement-to-accuracy calibration must be fitted on non-canonical material, or
it will be most confident exactly where it is most wrong.

**Conditional accuracy inverts rankings.** The most expensive model in our
battery ranks first on alignment-conditioned accuracy and *below the cheapest
model* unconditionally, because conditioning silently excuses its 15–19%
truncation rate on dense pages. Resolution ablations show these truncation
effects, not legibility, drive most large per-page swings above ~600px — one
Hebrew page improves from 50% to 95% when *downscaled*, because shrinking stops
the truncation. Benchmarks that report conditional CER are ranking models by a
metric that forgives exactly the failure mode separating them.

**A non-generative baseline, for free.** A public archive's legacy OCR
(ABBYY/Tesseract-class) exists for most scans a library imported from it — an
independent reading by an engine that *cannot recite*. Harvested for ~200 books
per sample and page-aligned by text matching, it yields a script-by-century
agreement table that replicated across two disjoint random samples within ±9
points (87% agreement on modern English print, 82% on 19th-century French, 27%
on 16th-century Latin ligatures) — and, where the baseline is competent, an
outsider-verifiable upper bound on combined error. Where the baseline collapses
(16th-century Greek, CJK), the collapse appears as alignment failure and is
reported as *unmeasurable*, never as VLM advantage. Because the baseline has no
recitation channel, (VLM − baseline) differenced across canonicity is a subsidy
estimate that survives even contaminated references.

**The prescription** is modest and cheap: historical-OCR benchmarks should carry
per-passage canonicity labels; matched within-work contrasts cost a page hunt,
not a transcription campaign; and perfect scores on degraded sources should be
treated as flags. Our dataset demonstrates the labeling at 44-page scale.

## 7. A library certifying itself

These instruments were not built for a paper; they are how a working digital
library — some 30,000 public volumes, machine-transcribed and machine-translated
— answers the question its readers actually ask: *how accurate is this text?*
The library now publishes a calibrated scorecard: agreement→accuracy fitted on
non-canonical anchors only, applied across the revision-history corpus, yielding
per-language-and-era estimated accuracy bands (≈99.8% for 18th–20th-century
German and English print; ≈97% for early modern Latin), each with its confidence
tier — and, for Hebrew and every space-less script, the honest entry "not yet
calibrated," because no non-canonical anchor pages exist there yet. Publishing
what cannot yet be certified is, we would argue, the evaluation posture the
digitization field owes its readers, and it converts the memorization problem
from an embarrassment into a measurement program: the scripts hardest to
calibrate are precisely the ones where recitation most convincingly imitates
reading.

## 8. Limitations

Forty-four pages with unbalanced cells; four within-work pairs of one page per
side; interaction estimates are hypotheses. Our two accuracy bounds are
differentially biased across page types (interleaved commentary inflates one,
verbose output the other), so pooled subsidy numbers are unquotable even with
the bounds — only matched contrasts carry weight. The occlusion probe measures
retrievability, not memorization alone; separating the two needs unpredictable
unpublished controls, which reference-bearing text cannot supply — the library's
own unpublished transcriptions are the path. "Published transcription" is never
zero-exposure; canonicity is graded, not binary. Masked-share audits, though
computed from text offsets in v2, retain line-boundary uncertainty. Serving
provider is part of the system under test; our arms record it but do not model
it. And the corpus-scale agreement analysis inherits the revision history's
within-model-family structure: those pairs are not independent readings.

## 9. Conclusion

A model that scores perfectly on a famous page has told you nothing about what
it will do to an unpublished one — and the unpublished pages are why digitization
exists. The remedies are neither exotic nor expensive: label canonicity, match
contrasts within works, probe with occlusion and blur, calibrate consensus on
text the model cannot recite, and difference against an engine that cannot
recite at all. What a library owes its readers is not a benchmark score but a
certificate — evidence that the machine read the page in front of it. This paper
is an attempt to say what such a certificate could contain.

---

*Dataset and code: [anonymized for review; released dataset — 44 pages, 1,737
raw runs, canonicity labels, license-gated references — at a public repository;
all scores re-derivable from raw outputs].*

<!-- TABLES (word-count-free; numbers to be re-verified against JSONLs at freeze):
  T1: within-work pairs — per pair × model: canon acc, noncanon acc, delta.
  T2: occlusion v2 fill-in excess — page × model × excess × canonicity grade.
  T3: IA baseline script × century — both samples side by side.
  T4: outcome battery — aligned% / conditional / unconditional / truncation by model.
  F1: masked Aeneid I page + model output for masked lines (highlighted).
  F2: accuracy vs blur (native/σ2/σ4) — Iliad pair, both models.
-->
