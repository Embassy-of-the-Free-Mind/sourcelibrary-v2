<!-- PRIOR ART: scripts/eval/tibetan-mt-ab/ (Tibetan vs 84000, #4742; reused for Sanskrit/Pali/Chinese in #5606) and scripts/eval/translation-corpus-audit/ (#5274, source-grounded, no reference). This directory generalises both into the one reference judge every #5695 track uses. -->
# translation-vs-reference — one judge for "how good is the English, against a published human translation?"

**Who reads the result:** Derek deciding what to change in the translation lane, language by language, and scholars
and partners asking how good the English is (#5695). Every track (Latin, Greek, vernaculars, Hebrew/Arabic/Persian,
Sanskrit/Pali/Chinese) uses this harness; none builds its own.

**What it measures.** `measure: judged against a human reference`. Two blind Opus judges read the source page, a
published English translation of the same passage (a guide to *meaning*, never to wording), and the candidate
Englishes. They score fidelity 1–5, omission, invention by #5622's four kinds, quoted reversals of meaning, and span
alignment, and rank the candidates with ties. Results come with bootstrap CIs (`lib/paired-stats.mjs`, mulberry32
since #5373). It is not "accuracy" in the eval-design §2 sense: the judge's own error is bounded only by the controls.

## Pipeline

```
records.jsonl ──fetch-served.mjs──▶ + served arm ──build-packet.mjs──▶ packet/ ──judges (gate)──▶ score.mjs --gate-only
                                                                                 └─judges (main)──▶ score.mjs ──▶ results.json ──gallery.mjs──▶ gallery.md
```

1. **Build records** (one per page, below). `from-ab-sample.mjs` converts a #5606-style sample (SuttaCentral, Legge,
   SBE references already cut) so the tracks need not re-cut them.
2. **Add the served English**, read-only: `node --env-file=/root/sourcelibrary/.env.production.local
   scripts/eval/translation-vs-reference/fetch-served.mjs --input r.jsonl --out r2.jsonl [--fill-source] [--neighbours]`.
   `--neighbours` adds the previous page's tail and the next page's head, which the judge needs to type a
   page-boundary invention. Pages with nothing served are listed in `<out>.skips.json`.
3. **Build the packet:** `build-packet.mjs --input r2.jsonl --out <dir> [--controls-per-type 3] [--seed 5695]`.
   Each judge gets its own label shuffle and item order. Controls go on GATE pages, whose real candidates also count.
4. **Gate first.** Dispatch the `gate-*` chunks listed in `<dir>/DISPATCH.md` (one Opus subagent per chunk, ≤ 6 items,
   ≤ 8 subagents per job), then `score.mjs --packet <dir> --gate-only`. Exit 2 = FAIL: stop and read why.
5. **Main:** dispatch the `main-*` chunks, then `score.mjs --packet <dir> --out results.json`. It refuses to write
   results while the gate fails (`--force` records the override in the output).
6. **Gallery:** `gallery.mjs --results results.json --input r2.jsonl --out gallery.md [--arm served]`. Shows 5 best,
   5 median and 5 worst pages per arm, with source, reference and ours side by side, the page link and the defect
   class.

## Input record (JSONL, one page per line)

```json
{"track": "T5", "lang": "Pali", "book_id": "69b99e681f30176bf4d3798a", "page_number": 155,
 "source_text": "…the page's OCR, exactly what the arms translated…",
 "reference_text": "…the published English cut to this page; lines starting [context] lie outside the page…",
 "reference_meta": {"title": "Aṅguttara-Nikāya", "translator": "Bhikkhu Sujato", "year": 2018,
   "licence": "CC0 1.0", "private": false, "style": "literal",
   "canonical": true, "located": "an10.73:2.1 – an10.73:3.3", "url": "…", "coverage_note": "…"},
 "candidates": [{"arm": "served", "text": "…"}, {"arm": "flash", "text": "…"}],
 "source_prev_tail": "(optional) last ~300 chars of the previous page", "source_next_head": "(optional) first ~300 chars of the next page"}
```

| field | required | notes |
|---|---|---|
| `track`, `lang`, `book_id`, `page_number` | yes | `book_id` is `books.id`; the page link is `https://sourcelibrary.org/book/<id>?page=N` |
| `source_text` | yes | the OCR the candidates were made from. If the served translation was made from a different OCR, say so; `fetch-served` records `ocr_sha` |
| `reference_text` | yes | cut to the page; the judge rates the cut (`reference_fit`) |
| `reference_meta.title/translator/licence` | yes | the licence is a field, not a footnote (eval-design §4.1) |
| `reference_meta.private` | yes | `true` for in-copyright references (#5488). The packet must then live outside the repo (the builder refuses otherwise); results and galleries clip every reference quote to ≤ 15 words |
| `reference_meta.style` | yes | `literal` \| `free` \| `early-modern`. The judge is told how loose the reference is; results are split by style |
| `reference_meta.canonical` | no | `true` for famous, memorised texts (Vulgate, Loeb, Pali canon). Reported as a separate stratum because of recitation (#5523) |
| `candidates[]` | yes | `{arm, text}` plus any provenance you like; arm names are unique and contain no `#` |

## The three controls (they gate the run)

| control | made how | pass |
|---|---|---|
| `wrong_page` | another record's translation, same language where possible | fidelity ≤ 2, each judge |
| `planted` | one real candidate with one meaning change: a negation dropped or added, `never`→`always`, or a number changed, away from the page edges and outside tags. The exact change is in `key.json` | the judge flags a reversal, or scores it below the unplanted original, each judge |
| `duplicate` | one real candidate shown twice under two labels | same fidelity, same rank tier and same omission; tie rate ≥ 0.8 per judge (`--dup-tie-min`) |

`score.mjs --gate-only` also reports whether the judge *located* the planted word in its quote.

## Output (`results.json`)

- `gate`: per judge, each control's verdict.
- `arms.<arm>`: `fidelity` {mean, CI, median, cant_tell, by_judge}; `omission`, `reversal` and
  `invention_any_but_added_fact` as rates with CIs (the unit is the page, averaged over judges); `invention_by_kind`
  {boundary, unreadable_fill, added_fact, gloss}; `span` counts; `defect_classes` (page-error-taxonomy ids);
  `reversals` (quoted).
- `strata`: the same per `canonical:`, `style:`, `lang:`, `track:`, and `fit:usable` / `fit:reference-wrong`.
  Quote the headline beside `fit:usable`: a wrong reference cut is a reference failure, not a translation failure.
- `pairs.<a>:<b>`: page-level wins, ties and losses from the judges' rank tiers, a two-sided sign test on the untied
  pages, and the paired fidelity Δ with a CI.
- `agreement`: exact and within-1 fidelity agreement, quadratic weighted κ.
- `per_page`: the input for `gallery.mjs`. Reasons have T-labels decoded to arm names.

**Invention kinds (#5622).** Only `unreadable_fill` is fabrication. `boundary` is a citation defect (the English for
page N carries page N±1). `added_fact` is by design (prompt v13 asks for notes) and is a defect only when the fact is
wrong (#5624). `gloss` is a bracketed explanation. Report them separately, never as one "invention rate".

## Smoke run (2026-10-03)

`scripts/eval/results/xlref-harness-smoke-2026-10/`: 6 Pali pages, references by Sujato (SuttaCentral, CC0) reused
from #5606, three arms (served from Mongo; the #5606 flash and lite outputs). The gate passed for both judges: wrong
page scored 1 by both, the planted negation drop was caught and quoted by both, and the duplicate tied for both.
Judges agreed exactly on 16 of 18 fidelity cells. The run is a test of the instrument, not a result (n = 6). Its
gallery shows what the tracks will produce. It also caught a reference cut from a parallel sutta (p. 306), which is
what `fit:usable` is for.
