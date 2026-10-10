# Preregistration — Latin OCR backlog through the Gemini CLI, 300-page pilot (#6375)

PRIOR ART: scripts/eval/PREREGISTRATION-open-engine-print-5660.md (#5924 round 4: Latin by book, CER against references; this pilot has no references and measures failure shapes on backlog pages) — none other found for CLI-vs-lite on the queue (looked in scripts/eval/PREREGISTRATION-*, experiments/, #6331, #6293).

Committed 2026-10-09, before any engine call. Job `latin-cli-pilot-6375`, Hetzner. Read stage only: **no production writes**.

## Question
On pages the Latin OCR backlog would actually read (gothic, blank leaves, edge strips included), how does Gemini 3.7 Flash through the subscription CLI behave compared with production flash-lite? Feeds the Latin backlog route: (a) lite + a long-s post-pass for everything, (b) Flash CLI for gothic and dense pages, or (c) neither yet.

## Population and sample (drawn 2026-10-09, before this file was committed)
- **Queue:** `books` with `pipeline_next.step = 'ocr'` and `language ∈ {Latin, lat}`, visible and hidden: **28,807 books** (7.5M `pages_count`).
- **Strata:** century of the first 14xx–19xx year in `published`: 1400s 922 books, 1500s 7,341, 1600s 11,944, 1700s 3,821, 1800s+ 255, undated 4,524.
- **Draw:** 50 books per stratum (equal allocation — "uniformly by book across centuries"), books in Mulberry32(6375 + stratum index) order. Per book, one page drawn uniformly (Mulberry32(6375 + fnv(book id))) from the **interior** pages (index between ceil(5%) and floor(95%) of the book's pages by `page_number`) that have an image and **no `ocr.data`**. Blank leaves and edge strips are kept wherever the draw lands on them.
- **Result:** 300 pages, 0 books skipped. Sample uid-list hash `e597307036374e91` (sha256 of the uids joined by newline, first 16 hex). The list is `scripts/eval/results/latin-cli-pilot-6375/sample.json`.
- **One page excluded before any engine call:** `69de1de1cf4ce17f68524df4-p45` (1490, TU Darmstadt) — the image URL production would read returns HTTP 404. **n = 299.**
- The "all" column is **not** queue-weighted (1800s+ is 0.9% of the queue but 1/6 of the sample). The decision axis is roman vs gothic.

## Arms (same JPEG bytes)
| arm | model | route | prompt | settings |
|---|---|---|---|---|
| **cli** | `gemini-3.7-flash-low` | `agy -p --mode plan --print-timeout 120s --output-format json`, one page per call, ≤ 4 parallel, image attached as `@./<uid>.jpg` — `scripts/eval/run-cli-arm.py` | live default OCR prompt "Standard OCR" v19.1 (hash 9d8f959e…), language-detect instruction as `cli-ocr.mjs`, + cli-ocr.mjs's "Output only the transcription…" sentence. Sent prompt sha256 `004adfb9…` | CLI defaults. **Nudge** (#6331 2026-10-08 22:19Z): if attempt 1 is empty with `denied_actions`, continue that conversation once with the fixed nudge; row marked `nudged`. Never `--dangerously-skip-permissions` (#6345). |
| **lite** | `gemini-3.1-flash-lite` | Gemini API, realtime, via `scripts/lib/gemini-script-client.mjs` (metered to `gemini_usage`, endpoint `scripts/eval/latin-cli-pilot-6375.mjs`) | same template, no extra sentence (exactly `realtime-ocr.mjs`). sha256 `34f12611…` | temperature 0.1, thinkingBudget 0, maxOutputTokens 16384 (realtime-ocr.mjs) |

**Budget:** CLI ≤ ~330 calls (300 pages + nudges; the agy account is shared with job #6361). On a 429, sleep until the "resets in" time, then resume; no retry loops. Lite: OCR + type pass; hard stop at **$2.00** cumulative (computed at $0.25/$1.50 per M tokens).

## Type label
`gemini-3.1-flash-lite`, one-word prompt → `roman | gothic | other | blank` (temperature 0). The by-eye readers also label type on their 40 pages; where they label, **their label wins**, and agreement with the lite label is reported (≥ 20 pages checked).

## Measures (per arm, split roman / gothic / other; counts with Wilson 95% CIs)
Automatic, all 299 pages:
- **empty** — no output text at all (CLI: after the nudge, if any).
- **refusal** — prose refusal or safety block (cli-ocr.mjs REFUSAL regex; "blocked by Gemini's filters"; finishReason SAFETY/RECITATION/PROHIBITED_CONTENT/BLOCKLIST).
- **nudged** — CLI only.
- **plan-note** — the agent narrates or plans instead of / before transcribing: an opener like "Sure/Okay/Here is/I will/Let me", a "Plan" heading, or a mention of a tool (`view_file`, `run_command`, "I'll crop…").
- **loop** — `scripts/lib/ocr-loop-guard.mjs` `loopVerdict().refuse`. Also reported: output hit the token cap (lite).
- **ſ count** — ſ characters emitted per arm; and **ſ/f pair words**: words one arm writes with ſ where the other arm has f in that position and is otherwise identical (the lite ſ→f candidates).

By eye, 40 pages:
- **Set (rule fixed now):** first every blank/edge candidate (type pass `blank`, or one arm's body < 80 chars while the other's ≥ 300, or either arm tags the page blank), up to 10; then gothic pages to 30 in all; then any pages to 40; order Mulberry32(6375 + 40). One page per book by construction.
- **Readers:** Opus subagents (subscription), ≤ 8, each reads the page IMAGE against both outputs (arm names hidden as A/B with a per-page seeded swap), labelled `read-from-image`. Per page: type; leaf = `text | blank | edge | plate`; which output is closer to the image (A/B/tie); per output: invented text (yes/no + quote), dropped lines (count), ſ read as f (count, from a 10-line window if the page is long; window stated).
- **Invented text on blank/edge leaves** = by-eye invention on pages the reader labels blank or edge.
- **Dropped lines** = by-eye count per output.

## Decision rule (stated now)
- **Flash CLI for gothic (+ dense)** if, on gothic pages, the by-eye reader prefers cli on more pages than lite with a Wilson lower bound > 0.5 of the decided (non-tie) pages, AND cli's empty+refusal+plan-note+loop rate after the nudge is ≤ 5% on gothic.
- **Lite + long-s pass for everything** if, on roman pages, ſ→f is lite's dominant by-eye defect (more ſ→f than dropped lines + invention combined) and lite does not lose on gothic by the rule above; or if CLI failures exceed 5%.
- **Not yet** otherwise (state which measure is short of n).
- A 40-page by-eye set cannot separate small differences; any recommendation is reported with its n and CI and as a pilot result, not a routing change. Routing changes go through `scripts/eval/DECISIONS.md` in their own PR.

## Not measured
Throughput (settled in #6331 test 3). CER (no references). Translation impact.
