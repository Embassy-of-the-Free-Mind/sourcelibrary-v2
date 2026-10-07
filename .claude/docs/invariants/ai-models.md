# AI models: which Gemini model, thinking, grounding, and metering

**Read this when** you are choosing a Gemini model for a lane, adding or touching a
`generateContent` call site (in `src/` or a script), reasoning about why OCR and
translation route differently, using grounded search, or metering what a model call cost.
**Changing, seeding, promoting or A/B testing an OCR or translation PROMPT** (or asking which
prompt wrote a page) → `../prompt-history.md` first: every version, what it was measured to do,
how many pages it wrote. **A page's `prompt_version` is a label, often a stamped constant — read
`prompt_id`, then `prompt_hash`.** (Routed from here, not CLAUDE.md: the body is over its word
budget, 5,605 words on 2026-10-03.)

PRIOR ART: CLAUDE.md "AI Models — IMPORTANT" (this text lived there until 2026-09-22,
#4943) — it is conditional by its own content, so it moved here; `language-fields.md`
owns the OCR-routing detail and `measurement-instruments.md` owns grounding.

## The rules

- **Batch API unless the caller says realtime (#5244).** Hand-run paid OCR is
  `scripts/batch/bulk-reocr-local.mjs` (page list, book list, one book; held books keep
  their status); `realtime-ocr.mjs` costs ~2× and refuses to run without `--realtime`.
- **Summary / index generation.** The enrich-worker uses `gemini-3.1-flash-lite` for
  every phase — summary+index (Phase 6), chapters (Phase 7), quality scoring (Phase 7.5),
  collection assignment (Phase 7.6). NEVER use models older than v3.
- **OCR and translation route DIFFERENTLY since #4762 — do not "fix" the divergence.**
  Translation: lite for all but BPH. OCR *as written* sends BPH, non-Latin and unknown
  language to full flash — **but `OCR_LITE_ONLY` (default ON since 2026-09-11) returns
  lite before any of that runs**, so in production that carve-out never fires; measured
  bad on manuscripts and early print, #4877. The one exception since 2026-10-02 is Greek
  (`isGreekFlashOcrBook`, #5575): visible Greek and Greek books created from that date
  read on flash; the hidden Greek backlog and every other script stay on lite. **Tell:** reading the router and assuming
  the carve-out applied. Detail → `language-fields.md`.
- **Gemini 3.x thinks by default and bills it at the output rate, invisibly.** Six
  unconfigured call sites cost ~$2K/mo for months (#4581, a 17× meter gap; August 2026
  metered $500 against $8,389 billed). Since PR #4954 / #4956 the working rule is no
  longer "every call site sets `thinkingConfig`" — it is **go through the client
  boundary, never around it**: `getGeminiClient()` in `src/lib/gemini-client.ts`
  defaults the budget to zero unless the call site asks for reasoning, and hand-run
  scripts import `scripts/lib/gemini-script-client.mjs` (thinking default, key rotation,
  `logUsage`). `thinkingBudget: 0` measured no quality loss for OCR, translation and
  extraction. When metering, count `thoughtsTokenCount` too. The static guard
  `scripts/audit/gemini-thinking-and-meter.mjs` fails on both code shapes and walks
  `src/` and `scripts/`. **Tell:** a `ChatSession`, a request-level `generationConfig`,
  or a raw REST call to `generativelanguage.googleapis.com` — each is a side door past
  the wrapper (see the lesson recorded with #4954: read the SDK dist, prove it with a
  live probe).
- **Grounded search: flash-lite does NOT ground, silently** — read
  `measurement-instruments.md` before using grounding.
- Reference: https://ai.google.dev/gemini-api/docs/models
