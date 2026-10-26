# Tibetan: can Opus or Gemini Pro correct the Yigdzin OCR? (#6560)

<!-- PRIOR ART: scripts/eval/tibetan-proofread/ (the 30-folio set and the ported kanjur_align scorer, against a human correction) and scripts/eval/replicate-6547/ (branch job-replicate-6547: correction + anchoring on Greif's print set). This applies that method to the Yigdzin-read Kangyur and scores against Derge. -->

**Decision it changes:** whether the Yigdzin-read Derge pages get a correction pass (and by which model, correct or
redo), or whether no general model is trustworthy on Tibetan script yet.

**Set:** the 30 `kangyur` folios of `scripts/eval/results/tibetan-proofread-2026-10/manifest.jsonl` (PR #5456), one
folio per book, served Yigdzin vs Derge identity 0.904–0.969.

**Arms** (all $0, one page per call, at most 2 calls in flight):

| arm | input | route |
|---|---|---|
| baseline | the served Yigdzin read | — |
| opus-corr / pro-corr | image + Yigdzin draft, "correct only where the image differs; the draft may contain errors" | `claude -p --model opus` / `agy -p --model gemini-3.1-pro-high` |
| opus-redo / pro-redo | image only | same |
| opus-corr-anchor / pro-corr-anchor | image + draft with 3 planted syllable errors, 10 folios | same |

The prompts are in `prep.py` (`REDO`, `CORR`): the same wording for both families, Uchen Unicode, the folio's line
breaks, `<<<BEGIN>>>/<<<END>>>` sentinels. No prompt mentions planted errors or a count. Runners: Gemini via
`scripts/eval/run-cli-arm.py` + `scripts/lib/agy-tool-gate.py` from branch `job-cli-ocr-fix-6523c` (@5fa9ae0b,
sentinels + tool gate, #6523); Claude via `scripts/eval/replicate-6547/run-claude-arm.py` from branch
`job-replicate-6547` (@6a5227f5, `--restricted`, Read only). Neither had merged when this ran; `run.sh` uses copies in
`$JOB_SCRATCH/runner`.

## Run

```
python3 scripts/eval/tibetan-correct-6560/prep.py --root $JOB_SCRATCH      # Derge windows, images, requests, plants
scripts/eval/tibetan-correct-6560/run.sh [LIMIT]                            # 5 arms (pilot: LIMIT=5); resumable
python3 scripts/eval/tibetan-correct-6560/score.py readoff-prep --settler pro-settles    # after the Opus arms
python3 scripts/eval/tibetan-correct-6560/score.py readoff-prep --settler opus-settles   # after the Pro arms
#   then run each readoff-*.jsonl with the OTHER family's runner (Pro settles Opus's changes, Opus settles Pro's)
python3 scripts/eval/tibetan-correct-6560/score.py score --out scripts/eval/results/tibetan-correct-6560/scores.json.gz
#   with no $JOB_SCRATCH it re-scores from the gzipped outputs committed under results/tibetan-correct-6560/out/
```

## Measures

- **identity**: Needleman–Wunsch syllable matches against the folio's Derge window / syllables of the read. The
  tokeniser and NW are `kanjur_align.py`'s (ported in `alignpairs.py`). The window is fixed per folio: the Derge e-text
  pages (vol, imgnum ± 2) the served read was scored against. `prep.py` reproduces the manifest's `derge_identity`
  for all 30 folios (the 10 marked-seam folios come out ≤ 0.002 higher because the `<leaf-break/>` tag is dropped).
- **recall**: the read's matches that land on Derge positions the served read covers, divided by those positions.
  It sees dropped or invented lines, which identity cannot. A frame holds two leaves that need not be contiguous in
  Derge, so the cover is built from runs of served-read matches, not one first-to-last span.
- **did not read**: an empty reply, timeout, refusal, a reply with no Tibetan, or nothing between the sentinels.
  These are counted, not scored.
- **intervals**: 95% bootstrap over books (one folio per book), 4,000 draws. The change against baseline is paired
  on the same folios.
- **anchoring**: 3 syllables planted per folio on 10 folios, in syllables the draft had right (they agree with
  Derge): a look-alike root letter, an i/e or u/o vowel, and a swap for another common syllable of the folio. A plant
  **survives** if the corrector's output has the planted syllable at the aligned position. Key:
  `results/tibetan-correct-6560/plants.json`.
- **recitation**: a span **moves toward Derge** where the served read differs from Derge and the arm agrees with it.
  Each span goes to the other family's model with the image. It gets the two readings in random order, with no
  word of which one is Derge, and is asked which the leaf shows. A span is **"toward Derge, not supported by the
  image"** if the settler sees the draft's reading or something else. Each read-off call also carries 2
  known-answer controls: a syllable where the served read and Derge agree, against a one-letter change. The
  controls measure the settler.

Result and decision: `scripts/eval/experiments/2026-10-12-tibetan-yigdzin-correct-vs-redo-6560.md`.

## Sonnet and Haiku arms (#6667)

`prep.py --root <scratch> --reuse-plants` rebuilds the requests from the committed Derge windows and `plants.json`
(no `kanjur_align`, no e-text index). The arms ran through `scripts/eval/replicate-6547/run-claude-arm.py --model
sonnet | haiku` into `out/sonnet-corr*.jsonl` and `out/haiku-corr*.jsonl`. `score.py` scores them beside the committed
arms and adds `_<arm>_minus_opus_corr` (paired, with folios better / worse). No image read-off was run for them.
Scores with all arms: `results/tibetan-correct-6560/scores-6667.json.gz`. Write-up:
`scripts/eval/experiments/2026-10-13-sonnet-haiku-correct-vs-opus-6667.md`.

## Gemini 3.8 Flash arms (#6560, 2026-10-13)

`prep.py --root <scratch> --reuse-plants`, then `scripts/eval/run-cli-arm.py --model gemini-3.8-flash-low | -high
--kind ocr --parallel 2` on `req/corr.jsonl` and `req/corr-anchor.jsonl`, into `out/flash-{low,high}-corr*.jsonl`.
`score.py readoff-prep --settler opus-settles-flash` builds a separate read-off key for both Flash arms, so the
committed `opus-settles` key (Pro's arms) is not rebuilt. Opus ran it through `replicate-6547/run-claude-arm.py
--model opus`. Scores with all arms: `results/tibetan-correct-6560/scores-flash.json.gz`. Write-up:
`scripts/eval/experiments/2026-10-13-tibetan-flash38-correct-6560.md`.

## The volume pass (#6560, 2026-10-15): Flash low correction of the served Yigdzin read

Derek, 2026-10-14: a $0 Gemini 3.8 Flash LOW correction pass over the Yigdzin-read Tibetan, every ya-btags change held
for an Opus check. Frame and order: `pass/volume-ids.mjs` (Yigdzin SERVE pages in visible or held books; Kangyur
volumes first, oldest book first, because the 30-folio evidence and the prompt are Kangyur's). One volume:

```
scripts/eval/tibetan-correct-6560/pass/run-volume.sh <book_id> [--no-apply]
```

1. **read**: `scripts/batch/cli-ocr.mjs read --correct-prompt=corr-prompt.txt --lane=tib-correct-6560`. The request is
   the arm's exactly: `prep.py` `CORR` (written to `corr-prompt.txt`) with the stored read as the draft, then
   ` @./<page>.jpg`. Two agy calls in flight.
2. **ya-btags guard** (`scripts/lib/tibetan-yatags-guard.mjs`): a syllable change that only adds or drops ྱ under མ
   (མི/མེད ↔ མྱི/མྱེད, also དམིགས ↔ དམྱིགས) holds its page. `pass/leafcheck.mjs yatags-req` builds `score.py`'s READOFF
   request for it (the two spellings as A/B in random order, context from the draft, 2 known-answer controls). A
   sealed Opus (`replicate-6547/run-claude-arm.py`) answers, and `yatags-verdicts` keeps a change only where Opus saw
   the correction's spelling on the leaf. `apply` puts every other change back to the draft's syllable.
3. **apply**: `cli-ocr.mjs apply --yatags-verdicts=… --mark-stale=tib-correct-6560`. It refuses a correction that
   changes over 25% of the draft's syllables, and a page whose draft changed after the read. The prior read goes to
   `page_revisions`. The page is stamped `ocr.pipeline = tib-correct-6560`, a lane outside `WITHHOLD_LANES`, so the
   hourly sweep does not withhold its English. `translation_stale` queues the English for re-translation.
4. **gate** (first volume only): `leafcheck.mjs audit-req` samples 40 pages that apply would write. A fresh Opus
   judges every changed span (draft vs written, A/B blind). A page is worse when the leaf shows the draft at more
   spans than the correction. GO if at most 2 of 40 are worse.
Another corrector through the same gate: `MODEL=<agy model> JOB=<job> run-volume.sh <book_id> --no-apply`. Gemini 4
Argon low ran it on 2026-10-16 (NO-GO: `experiments/2026-10-15-tibetan-g4l-pass-gate-6560.md`).

## The production pass (#6560, 2026-10-26): two judges, a net bar, volume by volume

After the router cell switched to Yigdzin > agy Flash-low (#6740), `pass/run-pass.sh` wraps `run-volume.sh`:
`gate <book>` (read, dry apply, 40-page audit), `apply-gate <book>` (only after a pass) and `run [max]` (the order
file's volumes, each audited on 10 changed pages, then applied with `MARK_STALE=`, so no re-translation is queued and
each volume's changed page ids go to `$JOB_SCRATCH/vol/<book>.changed.json`). The audit has two judges on the same
pages. The first is the tiled span judge (`tiles-req`, `audit-score`). The second is the route-judge whole-page judge
(`leafcheck.mjs page-req`, the #6740 prompt, draft and written judged separately). `leafcheck.mjs gate` pools their
verdicts and applies the bar pre-registered in `experiments/2026-10-27-tibetan-flash-pass-production-6560.md`. agy is
paced at `AGY_DAY_MAX` (4,000) calls a UTC day, and `$STATE` (`pass-state.jsonl`) is the done/stopped checkpoint.
First gate, 2026-10-26, rGyud 'bum Ka: NO-GO (pooled worse 6/40, bar 4), and nothing was applied.

## Gemini 4 Argon low arm (#6560, 2026-10-15)

`prep.py --root <scratch> --reuse-plants`, then `scripts/eval/run-cli-arm.py --model gemini-4-argon-low --kind ocr
--parallel 2 --print-timeout 300` on `req/corr.jsonl` and `req/corr-anchor.jsonl`, into `out/g4l-corr*.jsonl`.
`score.py readoff-prep --settler opus-settles-g4l` builds its own read-off key. Opus ran that key through
`replicate-6547/run-claude-arm.py --model opus --parallel 2`. Scores: `results/tibetan-correct-6560/scores-g4l.json.gz`.
Write-up: `scripts/eval/experiments/2026-10-15-tibetan-gemini4-argon-correct-6560.md`.

## gemini-3.1-flash-lite arms (#7263)

`prep.py --root <scratch> --reuse-plants`, then `scripts/eval/lite-correct-gpu-7263/run-lite.mjs` (paid API, production
lite OCR settings) on `req/corr.jsonl` and `req/corr-anchor.jsonl` into `out/lite-corr*.jsonl` (image), `out/lite-noimg-corr*`
(no image), `out/lite-corr-r2` (repeat, 10 folios) and, from `mkreq-p2.mjs` + `p2-post.mjs`, `out/lite-p2-corr*`
(production-shaped prompt). `score.py` adds them and a `wreck` list (folios with lines > draft + 2, syllables > 115%,
or identity < 0.85). Scores: `results/tibetan-correct-6560/scores-7263.json.gz`. No image read-off was run. Write-up:
`scripts/eval/experiments/2026-10-24-lite-corrects-gpu-drafts-7263.md`.
