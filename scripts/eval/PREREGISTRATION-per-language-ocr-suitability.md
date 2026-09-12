# Pre-registration — per-language OCR lane suitability: which languages may run on the cheap lane?

_Written 2026-09-11, **before any paid run**. Routing issue #4729 (route-by-book,
PR #4730). Companion result: `results/vision-vs-gemini-2026-09-11.md` (the 55-page
Cloud Vision test this plan grows out of). The point of writing this first is that
the decision rule cannot be picked after seeing the numbers._

PRIOR ART: `PREREGISTRATION-prompt-ablation.md` (house format, fixed decision
rules); `build-reference-groundtruth.mjs` (reference pinning for any language);
`google-vision-baseline.mjs` (the engine runner + paired scorer this reuses);
`stats-cross-model.mjs` (paired sign test / bootstrap). None of them answers
"which LANGUAGES may run on lite" — the July 40-page set covers six languages and
was built for a memorization question, not a routing one.

## Question

The OCR router is about to send every book whose model is unnamed to
`gemini-3.1-flash-lite` on the Batch API (#4729). Derek's requirement: **the
allowlist must be measured per language, not inferred from script family.** For
each language we hold in volume, is lite (and, separately, Cloud Vision and
`gemini-2.5-flash-lite`) good enough to replace `gemini-3-flash-preview`?

"Good enough" has two parts and both are fixed below: typical accuracy (median
CER) and the catastrophic tail (pages that come out mostly wrong). The tail is
the one that matters for a library — #4523 (Sanskrit scripture fabricated on
Tibetan folios) was a tail event on a lane whose median looked fine.

## Population

Books with `pages_count > 0`, grouped by `books.language` **after** normalisation
(the field carries `lat`/`Latin`, `ger`/`German`, `und`/`Unknown`/`auto-detect`,
and duplicate multi-value strings such as `Sogdian; Sogdian (script)` — fold them
with the rules in `.claude/docs/invariants/language-fields.md` before sampling,
and record the fold table in the results file). Measured 2026-09-11, raw values,
≥20 books holding page images: **50 raw labels, ~35 real languages** after
folding. Sizes (books / pages held):

| language | books | pages | note |
|---|---:|---:|---|
| Latin | 45,173 | 10.5M | reference e-texts: Wikisource proofread pages (`ground-truth-ws` tier exists) |
| Chinese | 13,088 | 2.0M | ctext (`build-ctext-groundtruth.mjs`) |
| German | 5,754 | 1.5M | Wikisource (Fraktur is the hard case; sample must stratify print vs Fraktur) |
| Greek | 5,014 | 2.2M | TLG-derived / Wikisource; manuscripts are a separate stratum |
| English | 3,767 | 1.4M | Gutenberg/Wikisource. NOT the IA djvu text — that is OCR, not a reference |
| Sanskrit | 2,110 | 358K | GRETIL |
| Tibetan | 2,016 | 732K | Derge etext via `kanjur_align.py` on clawdbot (identity, not CER) |
| French | 1,616 | 425K | Wikisource |
| Italian | 678 | 227K | Wikisource |
| Russian | 591 | 244K | Wikisource (pre-1918 orthography — reference must match the edition) |
| Dutch | 555 | 127K | Wikisource / DBNL |
| Japanese | 401 | 52K | Aozora / Wikisource |
| Arabic | 340 | 81K | Shamela / Wikisource |
| Korean | 314 | 71K | Wikisource (hanja/hangul mix) |
| Javanese | 313 | 55K | no reference — agreement + invention count |
| Hebrew | 271 | 77K | Sefaria (pointed vs unpointed must match the edition) |
| Persian | 252 | 92K | Ganjoor |
| Spanish | 163 | 67K | Wikisource |
| Syriac | 105 | 51K | Dukhrana / partial — likely agreement-only |
| Armenian | 84 | 36K | TITUS / Wikisource |
| Pali, Ge'ez, Malay, Hindi, Middle English, Ottoman Turkish, Portuguese | 22–54 each | 6–19K each | mixed; several agreement-only |
| Parthian, Sogdian, Sumerian, Middle Persian, Old Turkic, Demotic, Egyptian hieroglyphs | 20–500 each | 62–7,469 total | inscription corpora, 1–2 pages/book; **excluded** — the OCR lane does not serve them and a 20-page sample is most of the holding |

## Sample

- **n = 20 books per language**, one page per book (a book's pages are one
  observation; never sample many pages of one book — memory lesson
  `lesson_sample_one_page_per_book`).
- Books drawn uniformly from the folded language with a fixed seed (**seed 4729**,
  Mulberry32 over the sorted `id` list, so the draw is reproducible from the
  script alone). Page drawn uniformly from the interior 10–90% of `pages_count`
  (front matter lies about the language and the type — memory lesson
  `lesson_ocr_field_is_an_object_and_front_matter_lies`).
- Require an archived page image (`getPageSource()` non-null); redraw the book
  on a miss, log the miss.
- German and Greek are **stratified** 10/10 across the strata that matter for OCR
  (German: roman vs Fraktur; Greek: print vs manuscript), because the pooled
  median would hide the stratum that fails. Chinese: 10 movable-type / 10
  woodblock. Tibetan: 10 dbu-can / 10 dbu-med (cursive dbu-med is already known
  unsafe on every VLM, #4523 — it is in the sample to keep the instrument honest,
  not because the answer is open).

## Engines (arms)

| arm | serving | $/page (est.) | runs | why |
|---|---|---:|---:|---|
| `gemini-3-flash-preview` | realtime, thinking off | 0.0035 | 2 | the incumbent; k=2 so repeat instability is visible |
| `gemini-3.1-flash-lite` | realtime (batch is the same model at half price; realtime keeps the run to one day) | 0.0017 | 2 | the proposed default |
| `gemini-2.5-flash-lite` | realtime | ~0.0005 | 2 | never tested here; 3× cheaper than 3.1-lite. Probe with ONE call first — if the API no longer serves it, drop the arm and say so |
| `google-vision` (DOCUMENT_TEXT_DETECTION, language hint) | REST | 0.0015 | 1 | classical engine, deterministic, returns confidence; on the 55-page set it is a coverage loss, not an accuracy loss (see companion result) |

Same production OCR prompt for the Gemini arms (`lib/production-prompt.mjs`),
`thinkingBudget: 0`, temperature 0, one image per call, full-resolution inline
image — identical to the July arms so the two datasets pool.

## Scoring

1. **Reference languages** (Latin, Greek, Chinese, German, English, French,
   Italian, Spanish, Dutch, Russian, Hebrew, Armenian, Sanskrit, Persian, Arabic,
   Japanese, Korean, Portuguese): pin a reference passage to the sampled page with
   `build-reference-groundtruth.mjs` — the sampled page is kept only if a
   reference passage passes the identity guard on at least one arm's output
   (the guard is the same `scoreAgainstReference`, so pinning is not
   engine-specific: a page no engine can align is a page we cannot score, and it
   is logged as such rather than dropped silently). Metric: **CER on the aligned
   span**, quoting the free-skip / windowed bracket as the July post does.
2. **Tibetan**: Derge alignment identity via `kanjur_align.py score` on
   clawdbot (the instrument already has a positive control, `control-noise05`,
   and a chance floor, `scores-eap-chance`; quote both alongside).
3. **No-reference languages** (Javanese, Syriac, Pali, Ge'ez, Malay, Hindi,
   Ottoman Turkish, Middle English if Wikisource lacks the edition):
   - **cross-engine agreement** with `agreementPrimary()` (char-level on
     spaceless scripts, word-level otherwise), all pairs;
   - **invention count**: a page is *inventing* if its output contains ≥5
     consecutive word-tokens (≥10 characters on spaceless scripts) that appear
     in NO other arm's output for the page AND a vision judge (Claude, shown the
     page image and the disputed span) says the span is not on the page. The
     judge is the same for every arm and its verdicts are stored with the span,
     so the count is auditable. Judge cost is in the estimate below.
   Agreement without a reference cannot distinguish "all three right" from
   "all three wrong the same way", so for these languages the plan reports the
   number, does **not** allow the lane on agreement alone, and lists the language
   as *needs a reference* — that is a finding, not a gap to paper over.

Every raw output is written to `results/scorecard-outputs-<date>.jsonl` under the
arm name so `build-observations.mjs` and `stats-cross-model.mjs` pick it up
unchanged.

## Decision rule — fixed now

A cheaper arm **A** is *allowed* for language **L** only if, on L's 20 pages:

1. **Typical accuracy:** median CER(A) − median CER(flash-preview) ≤ **X = 1.0 pp**
   on pages both align.
   *Why 1.0:* above the Gemma tier every model in the July set clustered within
   ~1 pp on aligned pages, and the one systematic gap we detected there (3.1-lite
   vs 3.5-lite, +0.30 pp, p=8.6e-4) needed n=38 to reach significance. With n=20
   the paired sign test can only resolve a consistent direction (≥15/20 wins,
   p≈0.04), so X is a practical bar, not a statistical one: one wrong character
   per hundred is below what a reader notices on a page and below the
   inter-run instability of the incumbent itself.
2. **Catastrophic tail:** catastrophic-page rate(A) ≤ **Y = 10 %** (≤ 2 of 20),
   where a page is catastrophic if CER > 50 % on the aligned span, OR it fails to
   align on A while aligning on flash-preview (a coverage loss is a catastrophic
   page for the reader, who gets nothing), OR the invention judge marks it.
   *Why 10 %:* with n=20 one page is 5 %, so Y=5 % would turn a single unlucky
   scan into a verdict; Y=10 % tolerates one genuinely bad page plus one sampling
   accident while still rejecting any lane that fails a page in ten — at 7.9M
   pages a 10 % tail is 790K unreadable pages, which is already far past what
   we would ship, so the bar is generous to the lane and the *median* rule
   carries the rest.
3. **Invention veto:** ≥ 1 page where A's failure is classified as *invention*
   (fluent text not on the page — the #4523 shape) **disqualifies A for L
   regardless of 1 and 2**. Garble and omission are recoverable by re-OCR;
   invention is served to readers as if true.
4. **Coverage floor:** A must align ≥ 16 of the 20 pages that flash-preview
   aligns (80 %). Vision's 55-page result (aligned 37/55 vs lite's 52/55) is
   exactly the case this catches: parity on the pages it reads, but it reads
   fewer of them.

A language that has no reference and no Tibetan-style alignment instrument is
**not allowed on any cheaper arm by this experiment**; it is reported as
*unmeasured* with its agreement + invention numbers, and the router keeps it on
the incumbent until a reference exists.

The rule is applied per (arm, language) and the allowlist is the set of pairs
that pass. Nothing is pooled across languages, and nothing is pooled across the
German/Greek/Chinese/Tibetan strata — a stratum that fails keeps the whole
language off the lane until routing can see the stratum.

## Cost (estimate, not a ceiling — the ceiling is Derek's)

| item | calls | $ |
|---|---:|---:|
| pages: ~35 languages × 20 = **700** (50 raw labels would be 1,000; the inscription corpora are excluded) | | |
| flash-preview, k=2 | 1,400 | 4.90 |
| 3.1-flash-lite, k=2 (realtime) | 1,400 | 2.40 |
| 2.5-flash-lite, k=2 | 1,400 | 0.70 |
| Cloud Vision, k=1 | 700 | 1.05 (inside the 1,000-unit free tier → **$0** this month) |
| invention judge (Claude, vision) on no-reference languages: ~8 languages × 20 pages × 4 arms | 640 | ~6.40 at ~$0.01/page |
| reference pinning: `build-reference-groundtruth.mjs` is free; Wikisource/ctext/GRETIL fetches are free | | 0 |
| **total** | | **≈ $16, call it $20** with retries; a hard stop at $50 |

Per-page Gemini figures are the measured production numbers from #4729
($3.42/1K flash realtime, $0.85/1K lite batch → $1.70/1K lite realtime) and the
2.5-lite figure is the list-price ratio, unverified until the one-call probe.
Wall clock: ~2 h on Hetzner (rate limits, not compute). Runs on Hetzner, not the
laptop (`import-cost-and-egress.md`; IA is unreachable from the laptop anyway).

## What this does NOT decide

- It does not decide batch vs realtime — same model, same output; #4729 owns that.
- It does not re-test the prompt; the prompt is held at production.
- It does not rescue a language by tuning hints or resolution after the fact.
  Any such change is a new arm in a new pre-registration.
- It does not settle Tibetan: dbu-med is already known-bad on every VLM (#4523)
  and the BDRC Yigdzin lane (#4722) is the plan there, not this experiment.

## Artifacts

- Sampler + runner: `scripts/eval/per-language-suitability.mjs` (to be written;
  the runner half is `google-vision-baseline.mjs` generalised to N arms).
- Results: `results/per-language-suitability-<date>.json` + `.md`, one row per
  (language, stratum, arm) with the four rule outcomes and the allow/deny verdict.
- Log the conclusion in `EXPERIMENTS.md` the same day; post the allowlist on #4729.
