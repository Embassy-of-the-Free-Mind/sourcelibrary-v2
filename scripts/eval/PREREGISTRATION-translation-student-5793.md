<!-- PRIOR ART: scripts/eval/PREREGISTRATION-open-engine-print-5660.md (the RunPod open-engine prereg this follows in shape); scripts/eval/experiments/2026-10-03-xlref-t1-latin-vs-reference-5695.md (the test set, the judge and the noise floor reused here unchanged). -->
# Preregistration — can an open model trained on our Latin translations match flash-lite? (#5793)

Written and pushed **before any training or model call**, 2026-10-04. Job `translation-student-5793` (Hetzner).

**Who reads the result:** Derek, deciding whether the hidden Latin backlog (6.3M pages, 24.5K books) could be
translated on our own GPU instead of by Gemini. One gated test, not a lane change. No routing change follows from
this run whatever it finds.

## Question

Does a LoRA-tuned open model (≤ 12B), trained on ~18.6K of our own served Latin→English page pairs, translate Latin
as faithfully as `gemini-3.1-flash-lite`, judged against published human translations — and what would it cost per
1,000 pages on the GEX45 (RTX PRO 4000 Blackwell, 24 GB)?

## Data (built by `translation-student-5793/build-data.mjs`, counts in `results/translation-student-5793/counts.json`)

- **Source:** the laptop pre-sample `latin-presample-5793.jsonl.gz` of `scripts/output/training-pairs-latin-v1`
  (train split; near-dup/ratio-flagged pairs dropped; source 400–4000 chars; translation ≥ 300; ratio 0.8–2.5;
  alpha ≥ 0.72; no repeated-span loops; ≤ 6 pages/book; ~9% sample): **20,315 pairs, 4,540 books, 3,240 works.**
- **Excluded:** every book in any translation reference set (`results/xlref-*`, `results/human-ceiling-5762-2026-10`;
  435 book ids incl. both id forms) and every `work_id` they carry (346): −308 pairs by book, −917 by work.
  #3884 (Suda) is Greek and cannot overlap a Latin sample.
- **Targets cleaned** by `cleanTranslation()` (`translation-student-5793/prompt.mjs`): `<note>`, `<gloss>`, `<meta>`
  removed with their content; every other tag unwrapped. Re-screened after cleaning (≥ 300 chars, ratio 0.8–2.5):
  −37 short, −382 ratio.
- **Dev 20:** one page from each of 20 books (first 20 in the seeded round-robin order), those books removed from
  train. Used only for the base choice.
- **Train: 18,587 pairs, 4,249 books, 3,139 works**, ordered round-robin across books (seed 5793). If GPU
  throughput forces a cut to stay in budget, the cut is a prefix of this order (still spread across books) and the
  number trained on is reported.
- **Test: the 71 Latin pages of #5695 T1** (`results/xlref-t1-2026-10/records.jsonl`), one page per book, each
  span-aligned to a public-domain human translation (Waite, EEBO-TCP, Gutenberg, Wikisource …). 0 test books in
  train. Source = the exact OCR T1's arms translated. n = 71.

## Arms (all on the same 71 source texts)

| arm | what | provenance |
|---|---|---|
| **lite** (a) | `gemini-3.1-flash-lite`, production call shape (prompt v13, previous-page context) | T1's `prod-A` outputs, reused, $0. Chosen over the T1 `served` arm because served is mixed (35 of 71 pages were translated by `gemini-3-flash-preview`); prod-A is lite on 71/71. |
| **base** (b) | the chosen open base, zero-shot, the student prompt below | vLLM, temperature 0 |
| **student** (c) | the base + LoRA, same prompt | vLLM, temperature 0 |

The **same apparatus stripper** (`cleanTranslation`) is applied to all three arms' outputs before judging, so no
arm is judged with notes the others lack. Known asymmetry, stated in advance: lite had the previous page as context
(T1 measured that dropping it is within the noise floor, +0.11 [−0.05, +0.28]) and lite's prompt asks for notes.

**Prompt (fixed, `student-5793-v1`), one user turn, no system turn:**
`Translate this page of a historical Latin book into English. Translate all of it, faithfully, in plain modern English. Do not add notes, glosses or commentary.\n\n<source>`.
Qwen3 is run with `enable_thinking=False`.

## Base choice (step 2a, before training)

- Candidates: **Qwen3-8B** (`Qwen/Qwen3-8B`) and **Gemma-3-12B-it** (`unsloth/gemma-3-12b-it`, the ungated bf16
  mirror of Google's weights). TranslateGemma-12B is not a candidate: the Google weights are gated and the box has
  no Hugging Face token, and only third-party quantised mirrors exist.
- Both translate the 20 dev pages zero-shot with the prompt above. One blind Opus subagent (subscription) scores
  each against the source only (no reference exists for dev pages): fidelity 1–5, omission, untranslated Latin.
- **Rule:** pick Gemma-3-12B only if its mean dev fidelity beats Qwen3-8B by ≥ 0.3; otherwise Qwen3-8B (fits the
  24 GB GEX45 in bf16; Gemma-12B in bf16 does not). The test pages are never used for this choice.

## Training (step 2b)

- One RunPod SECURE GPU (H100 or L40S), pod named `sl-5600-student5793-until-<UTC>` so the Hetzner watchdog
  (`runpod-pod-watchdog.mjs`) enforces its deadline and idleness; progress mirrored into its progress dir;
  terminated and confirmed gone at the end.
- LoRA SFT (Unsloth or TRL+PEFT), bf16 base, r 16, alpha 32, dropout 0, all linear projections, lr 2e-4 cosine,
  warm-up 3%, effective batch 16, max length 4096 tokens, loss on the assistant turn only, **1 epoch**, seed 5793.
- Adapter saved to R2 under a private prefix (not git, not this box's root disk).
- Throughput: the student served by vLLM at batch on an **RTX PRO 4000 Blackwell 24 GB** (RunPod, the GEX45's
  GPU), the 71 test pages plus dev pages; tokens/s and pages/hour → $ per 1,000 pages at the GEX45's €214/month
  (fully used) and at the pod's hourly rate. If the model does not fit in 24 GB in bf16, a quantised figure is
  given and labelled.

## Scoring (step 3) — the #5702 harness unchanged

- `translation-vs-reference/build-packet.mjs` (seed 5793, 3 controls per type) → two blind Opus subagents
  (subscription) with `JUDGE-PROMPT.md` unchanged → `score.mjs --gate-only` (must pass) → `score.mjs`.
- **Primary metric:** paired fidelity Δ (student − lite), 1–5, mean of the two judges per page, bootstrap 95% CI
  (`pairs.student:lite.fidelity_delta`).
- **Invention:** share of pages where either an `unreadable_fill` or an `added_fact` invention is flagged (mean over
  judges). With apparatus stripped from all arms, an added fact is a real addition. `boundary` is reported
  separately (only lite sees neighbour pages); `gloss` is ignored. The harness's `invention_any_but_added_fact`
  is also reported.
- Also: n, mean/median fidelity per arm, W/L/T and sign test, omission rate, reversal rate, the canonical stratum,
  and 3 pages read side by side with the human reference.

## Gate (from #5793)

**PASS** = the 95% CI lower bound of Δ(student − lite) ≥ −0.25 **AND** the student's invention rate is not higher
than lite's (point estimate ≤ lite + 5 percentage points, and the paired 95% CI of the difference includes 0 or
lies below it). PASS → the next step is a throughput/cost run on the GEX45. Anything else = FAIL → stop and write
it up.

## Noise floor and threats, stated in advance

- **Noise floor:** T1's X1 (production lite run twice): A − B = −0.02 [−0.16, +0.13] on these 71 pages. A Δ inside
  ±0.15 is not a difference.
- **Recitation (#5523):** 22 of 71 test pages are canonical texts (Vulgate, Cicero, Boethius …) a base model may have
  memorised in English; the canonical stratum is reported separately and a base/student score that rises there
  alone is read as recitation, not translation.
- **The student learns from Gemini** (the targets are served Gemini output, mostly flash-lite and flash): it is
  bounded by its teacher, and the judge comparing it to lite is a teacher-vs-student test. Gemini API terms
  restrict using outputs to develop competing models (#4320, 2026-08-28); this is Derek's decision to make, and
  is raised again in the result.
- **Judges read the transcription, not the image.** Fidelity is to the OCR; incunable OCR errors hurt all arms.
- **Long pages:** one test page is 19K characters (beyond the 4K training ceiling); it is kept, not dropped.

## Budget

≤ $10 total (RunPod GPU + any Gemini; no Gemini call is planned). Judges on subscription subagents.
