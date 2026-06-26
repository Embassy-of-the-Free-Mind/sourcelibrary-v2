# Spanish editions (corpus translation → ES)

Translating the existing **English** corpus into **Spanish** to open the library to
~500M Spanish speakers. This is *content* translation (the books), distinct from
*UI* localization (chrome) — tracked separately in #2763 / #2701. Umbrella: **#2770**.

## Data model
- Spanish lives on `pages.translation_es` — same shape as `pages.translation`
  (`{ data, language:'Spanish', model, source, prompt_version, updated_at }`).
- Book-level counter `books.pages_translated_es` drives popular-first selection
  and progress (synced by the worker after each book).
- It is a **pivot from English** (`source:'ai-pivot-en'`): the worker translates
  `pages.translation.data`, not the original-language OCR. Pro: EN→ES is the
  best-supported direction, reuses cleaned text, cheap. Con: it's a translation
  of a translation. For scholarly fidelity, high-value / first-translation works
  should be (re)translated **original→ES** directly and labelled accordingly.

## Pipeline
- `scripts/workers/es-translate-worker.mjs` — runs on the Hetzner scheduler
  (`es-translate`, every 10 min, `--books=4 --max-pages=300`), submitting to
  Gemini `gemini-3.1-flash-lite` **directly** (no Vercel/Cloudflare edge timeout,
  the reason ad-hoc route loops failed on large books).
- **Most-popular-first** (`read_count` desc) so spend tracks reader demand.
- **Guards** (why a dedicated worker, not a script):
  - *collapse guard* — a substantial page (>800 EN chars) whose ES body is
    near-empty (<300 chars) is retried.
  - *length-sanity band* — ES body must be **0.5–2.0×** the English body; out of
    band ⇒ retry; still out of band after 3 tries ⇒ **skip** (don't store). This
    prevents both collapses (header-only output) and runaway loops (10–30×
    bloat) — both observed when translating without guards.
- **Cost** ≈ $0.0007/page (flash-lite batch-equiv); full corpus ≈ **$3K** Gemini
  / ~$1.5K if ever moved to DeepSeek-V4-Flash. Bounded per run; ramps gradually.
- **Pause:** `system_config._id:'processing_control'` → `paused:true` (worker
  checks on each run and exits).

## Reader UI
- `PageEditorClient` shows an **English / Español** toggle when a page has
  `translation_es`; selecting Español overlays it through the existing
  `stripEditorialWrappers` + `NotesRenderer` pipeline (PR #2776). No API changes
  — SSR and the pages get/batch routes already project the full doc.
- Toggle is hidden where no ES exists and disabled while version-pinned (`?v=`).

## Quality (measured)
- Pilot + spot checks (French/German/Latin originals): faithful, structure-
  preserving Spanish even on flash-lite; proper nouns Hispanized, Spanish
  typography, markdown/tags preserved. ES/EN length ≈ **1.05×** (median).
- Defects are confined to the failure modes the guards above catch (~0.5%
  collapse, rare runaway). Native-speaker QA should sample-check + review all
  flagged high-value works (per the CLAUDE.md quote-integrity rules).

## Open follow-ups (#2770)
- original→ES tier for high-value / first-translation works (fidelity).
- chunking for oversized merged/spread pages (>~40K chars) that exceed the
  output token cap.
- sitewide language preference + `hreflang`/SEO for ES pages.
- move bulk to DeepSeek if cost ever matters at corpus scale.
