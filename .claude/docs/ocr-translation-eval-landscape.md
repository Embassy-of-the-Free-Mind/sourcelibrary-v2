# OCR & Translation Quality Evaluation — Landscape & Source Library's Stance

_Researched 2026-06-16 (4 parallel web-research passes). Prompted by the Eternity Foundation / Nalanda
comparison (they budget to "distill GEMBA into smaller deployable models"). Citations are real papers;
where evidence was thin or vendor-blog it's flagged inline._

## The one distinction that organizes everything

**OCR and translation are different evaluation problems and must not share an eval design.**

- **OCR has a determinate ground truth** — there's a fact of the matter about the glyphs on the page.
  "Is this transcription correct?" has a yes/no answer per character. So accuracy *can* be objectively
  measured (CER against a gold set), and a spot-check is **conclusive** on legible material.
- **Translation has no single right answer** — adequacy/fluency tradeoffs, no unique correct output.
  That is the *only* reason the elaborate machinery (GEMBA, reference-free LLM-judge, MQM rubrics) exists.
  Don't import it into OCR.

## OCR evaluation — what's validated (this is what we actually do)

- Derek's habit — "ask a strong model to re-OCR a page and compare" — **is the field-validated method**,
  not an amateur shortcut. It's an ad-hoc instance of **Consensus Entropy** (run several VLMs; correct
  outputs converge, errors diverge), which **beat single-VLM-as-judge by +42% F1** for detecting bad OCR.
  (Consensus Entropy, arXiv:2504.11101, Apr 2025.)
- **The judge must be able to read the script itself.** A strong judge (Opus, vision) is a reliable OCR
  oracle on clean Latin/Greek/English print — there, an Opus-vs-image spot-check is ~as good as a human.
  On degraded scans, microfilm, handwriting, and exotic scripts (Tibetan, Javanese, aksara) the judge is
  often *no better than the producer* and will confidently certify a wrong character — sharing the blind
  spot. This is why model-*agreement* beat single-judge, and it's exactly our Javanese 100%-MCR lie
  (two models agreeing on the same hallucination). [[lesson_javanese_ocr_recitation_loop]]
- **Consistency ≠ accuracy.** MCR / re-run agreement measures *stability*, not *correctness*. High
  agreement can be confidently, identically wrong. Only ground truth (or a human who reads the script)
  breaks that tie.
- New OCR-specific failure metrics worth knowing: **HCPR / AIR** (Historical Character Preservation Rate /
  Archaic Insertion Rate) catch LLM "over-historicization" — inserting period-wrong characters — that CER
  misses. (LM4DH 2025, arXiv:2510.06743.) **CER > WER** for multi-script/CJK material.
- Multimodal **post-correction** (noisy OCR + page image + prompt) is SOTA (~0.84% CER, arXiv:2504.00414)
  but **language/script-dependent and can degrade** on some languages (Finnish) and over-historicize —
  gate per script, don't apply blanket. (arXiv:2502.01205 "No Free Lunches".)
- Benchmark to test our scripts against if we ever want an external yardstick: **CHURRO-DS** (Stanford,
  EMNLP 2025, arXiv:2509.19768) — ~150 historical OCR datasets unified.

### Practical OCR eval design for SL
- **Well-behaved scripts (the bulk):** stratified Opus-vision spot-check against the page image →
  objective CER estimate → certify Flash-Lite, no human needed. Sample the **hard tail**, not convenient
  clean pages (catastrophic failures cluster in the tail).
- **Hard tail (few exotic/handwritten scripts):** don't trust any single model's self-report; use
  cross-model *disagreement* to route doubtful pages to a human who reads that script. Anchor with a small
  human gold set per hard script.

## Translation evaluation — what's validated (the part we don't yet have)

- **GEMBA (2023) is the origin, not SOTA.** Modern lineage: **GEMBA V2** (score 10×, drop outliers,
  rank-weighted avg — WMT25), **EAPrompt** (error-analysis CoT, beats GEMBA at system level, ACL Findings
  2024), **MQM-APE** (post-edits each flagged error, keeps it only if quality improves — kills GEMBA's
  over-flagging, +5.8 pts, COLING 2025). Learned metrics: **xCOMET, MetricX-25, CometKiwi**.
- **The finding that matters for us: learned metrics DON'T transfer to classical/low-resource languages.**
  xCOMET/MetricX/CometKiwi ride on XLM-R / mT5 encoders trained on modern high-resource pairs; they never
  saw Classical Tibetan / Sanskrit / Buddhist Chinese as distinct registers. Field practitioners simply
  **don't use COMET** for these. (SSA-COMET arXiv:2506.04557; AfriCOMET; WMT24 "Pitfalls in Using COMET".)
- **For a first-translation library with no reference, reference-free LLM-as-judge is THE validated
  method** — confirmed on exactly our kind of corpus: **MITRA-zh-eval** (Buddhist Classical Chinese,
  NLP4DH 2025) and **Mitrasaṃgraha** (Classical Sanskrit, 2026) both found GEMBA-style LLM scoring tracks
  expert raters far better than BLEU/chrF/BLEURT. Drop BLEU/ROUGE for translation; keep CER for OCR.
- **Hard cautions:** (1) **terminology rarity predicts catastrophic failure** (Ancient Greek, 2026) — a
  single scalar score hides hallucinated terms / repetition loops; track catastrophic-failure detection
  *separately*. (2) **Judge ≠ generator** (self-preference bias is quantified) — judging Gemini output
  with Opus is the correct cross-family design. (3) Calibrate the judge against a small expert-rated set
  per language (Cohen's κ ≥ 0.6).
- **Reasoning-model judges (o1/o3/thinking) are NOT proven better** for MT judging — mixed/negative
  evidence; they over-interpret terminology-dense domains. Don't assume thinking-mode = better judge.

## What `qa-eval` actually does today (for the record)
MCR (modal consistency), cross-model agreement, char/syllable pairwise similarity, embedding-space
hallucination detection, CER (OCR vs ground truth), BLEU-4 / ROUGE-L (translation vs ground truth),
readiness rollup. **It does NOT do GEMBA.** Don't claim GEMBA in any external/funder-facing material.
The genuinely missing layer is reference-free GEMBA-MQM for translation — build only if/when translation
eval becomes a real need (note: the translation backlog is mostly *done* — [[project_confirmed_first_is_mostly_done]]).

## Strategic notes for the Eternity / Nalanda conversation
- Their "distill GEMBA into smaller deployable models" is building a thing that either **already exists
  open-weight** (xCOMET/MetricX/CometKiwi) **or doesn't apply** to the classical languages Nalanda targets.
- **84000** (the institutional translator of the Tibetan Buddhist canon) has a **published position
  rejecting AI for producing canonical translations** — allows it only as a support tool, expert human
  review as standard of record. Nalanda's flagship is exactly that canon. Know this before positioning
  AI translation to their Tibetan-Buddhist partners.
- Our defensible posture: reference-free LLM-judge spot-checking is the method the classical-language
  field actually validated in 2025–26 — we already operate the OCR side of it; we are not behind.
