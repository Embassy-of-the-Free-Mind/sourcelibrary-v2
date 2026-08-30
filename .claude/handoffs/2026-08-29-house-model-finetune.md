# House model fine-tune: dataset → tuned Greek translator → two prototypes (2026-08-28/29)

Session arc: Derek asked "can we fine-tune a model on Plato?" → scoped (#4320, closed) →
shipped end to end in one evening. Full state also in auto-memory
(`project_house_model_finetune_state.md`).

## Shipped (merged)
- **#4322** `scripts/export/training-pairs.mjs` — page-aligned original→English pairs.
  Greek: 255,108 pairs / 1,021 books. Latin: 1,431,745 / 5,822. Private, local
  (`scripts/output/training-pairs-*`), never public R2. Per-page `<language>` tag gates
  membership (parsed as a LIST — mixed bilingual pages get their own skip bucket);
  flag-don't-drop (ratio outliers, MinHash near-dups); whole-book md5 train/val split.
- **#4328** `to-vertex-sft.mjs` — Vertex SFT format under a token budget, round-robin
  across books so the cap buys diversity.
- **#4331** eval + gloss demo server. **#4333** demo reworked into the real experience
  ("touch the Greek") after Derek's review — v1 was an engineering harness.

## Open PRs (green, awaiting Derek per review-gate rule adopted 2026-08-29)
- **#4335** Plato dialogue prototype (`scripts/eval/plato-dialogue-server.mjs`).
- **#4374** training-pairs streaming-hash fix + `--finalize-only` (the Latin build died
  at a >2 GiB `readFileSync` sha256 — the corpus snapshot's `sha256Stream` lesson,
  half-reused; recovery already run, Latin manifest verify green).

## Live artifacts
- **Tuned model** `sl-greek-translator-v1`: Vertex SFT of gemini-2.5-flash-lite,
  15,332 pairs, 1 epoch, **$42.38** (28,256,133 billable tokens @ $1.50/M — price from
  the Cloud Billing SKU catalog REST API; CLI lacks the subcommand). Endpoint
  `projects/877864597985/locations/us-central1/endpoints/6705829608584904704`.
  Serverless — no idle cost.
- **Eval**: held-out chrF 0.5624 vs base 0.5023, tuned wins 158/200. **CIRCULAR** —
  reference is our own pipeline output; measures house-style resemblance, not quality.
  Do not quote the 79% as quality. Next instrument: score tuned vs base vs pipeline
  against PD human translations (Jowett etc.) — a few hours, unblocks the production
  decision.
- **Demos (local, detached, still running)**: gloss "touch the Greek" at :7788
  (real pages, selection→popover); Plato dialogue at :7789 (gemini-3-flash-preview +
  BM25 over 21,630 Platonist leaves, own-vs-successor distinction, leaves-consulted
  links). Corpus files regenerate via each server's `--prepare`.
- **3.1 probe**: `gemini-3.1-flash-lite` IS tunable (undocumented; SKU $3/M). Probe job
  `807722278514065408` SUCCEEDED ($0.55). Its endpoint (multi-region `locations/us`)
  404'd on serving immediately after — likely propagation; recheck before v2.

## Decisions Derek owns
1. **v2 tune on gemini-3.1-flash-lite** (the pipeline's own model), same 15K pairs,
   ≈ $85 — ideally after the independent eval exists.
2. Whether the tuned model enters the production Greek translation phase (blind
   spot-read of wins AND the 42 losses first; RECITATION lesson applies to canonical
   texts).
3. Reader gloss UI — **#4332** carries the full spec + traps (service-account auth,
   exact training prompt strings, 15s cold start, strip apparatus from MODEL OUTPUT —
   the tuned model emits `<note>` because the training pairs carry it).

## Lessons (where they went)
- Model absorbing transcription apparatus → #4332 + memory. Serving layers clean model
  output, not just input.
- Circular eval → memory + this handoff; candidate one-liner for
  `measurement-instruments.md` if it recurs.
- 2 GiB hash crash → fixed in code (both export scripts now stream); no new doc.
- Gemini spend surfaces: Vertex (tuning, GCP project) vs AI Studio key (pipeline
  workers) — bill separately; `gemini_usage.cost_usd` untrustworthy (existing memory).
