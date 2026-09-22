# Spread-splitting audit: RTL reading order, detector rebuild, crash + gate fixes — 2026-09-13

Issue **#4796** (audit + running log). PRs **#4802, #4803, #4804, #4805** — all merged 2026-09-13
evening. Production data changed once: the reading-order repair (below). Written for whoever picks
up the open items; every claim here was checked by opening an image, not only by querying fields.

## What was wrong

| defect | evidence | fix |
|---|---|---|
| RTL and vertical-CJK books split **backwards** — `split-book.mjs` always emitted `[left, right]` | Sun Tzu 兵法孫子 (`69e0151327a1381d255995b4`) pages 39–42 carried printed folios 31, 30, 33, 32; Pardes Rimmonim (`69c7b18425ec2ba5ccd7f44e`) p.101 = ch. 17–18, p.100 = ch. 18–19 | #4804: order from `books.language` (`--page-order=ltr\|rtl` override), recorded as `books.split_page_order`; repair script |
| Gutter detector cut at the **least-inked column**, confirmed by ink within 8% | 14 Japanese books cut at 350–420‰ inside the LEFT page's blank margin (right halves carry a strip of the facing page); tan Chinese paper read as ink → 69/79 abstain → park; curvature shadow read as ink → gap ends 4% early; fired on 1/3 maps | #4803: text-likeness = dark/light **transitions** per column (per-column threshold), gap between text blocks, cut at binding shadow or gap centre, never within the 3% overlap of text. `tests/unit/gutter-detect.test.ts` |
| Pre-OCR split **crashed** on 19 Harvard-Yenching books (`SyntaxError: Unexpected end of JSON input`) | page records at `/pages/{id}/0001.jpg` were read LAST, after guessed `/archived/` paths and a manifest that answers 429 with an empty body | #4802: page records first (book-scoped URLs), manifest tolerant |
| Phase 1.25 **fails open**: Gemini throw → "assume spread"; non-OK HTTP → "not a spread"; both wrote `split_checked:true` | code read | #4802: leave unchecked, park after 3 failures (`split_confirm_failures`) |
| Gemini gutter-sample errors swallowed by an empty `catch` | `gemini-only 0` read as agreement for months; laptop key is geo-blocked | #4802: counted + first message printed |
| Review gate with no exit (#4792) | al-Maqrīzī parked since June, re-parked on every reset | #4805: `--approve-center` / `--approve-split=N` + `--by=`, persisted as `pipeline_auto.split_approved`; parks record `split_consensus` |

Validation set for the detector: 33 real spreads (Japanese NDL/IA, Chinese Harvard, Hebrew BPH,
Arabic Gallica, German + Latin BPH) rendered with old/new cut lines and inspected at zoom, plus 6
landscape single pages (3 maps refused). Method and contact sheets were scratchpad-only; the
harness is easy to rebuild from `scripts/lib/gutter-detect.mjs` + `spread_source` URLs on split pages.

## What was DONE to production (do not redo)

`scripts/maintenance/reorder-rtl-split-pages.mjs --apply` ran 2026-09-13 ~22:00 UTC:
**44 books, 4,590 pairs, 0 unpaired, 33 `cover_page` fixes, 44 `sweep_log` rows**
(`sweep: 'reorder-rtl-split-pages-4796'`). Metadata only (page_number swap within each adjacent
left/right pair). Shape-checked on all 44 (unique page numbers, count = `pages_count`, pairs now
right→left, `split_page_order:'rtl'`). Spot-checked by printed folio: Sun Tzu 39–42 → 30, 31, 32,
33; Pardes p.99 = folio מח, p.100 = right leaf (פרק יז יח), p.101 = folio מט. The script skips
books already `split_page_order:'rtl'`, so re-running it is a no-op — **any other second swap
reverses them again.**

The four merges touched only `scripts/`, `tests/`, `.claude/` → Vercel build Canceled after 14s
(ignored-build step, expected). Hetzner pulls `main` hourly at :17.

## Open, in priority order (each needs a human decision — all are recorded on #4796)

1. **19 Harvard Chinese books** still `needs_attention` (`Pre-OCR split failed 3 times`). Requeue:
   `pipeline_auto.status: 'archive_complete'`, unset `pre_split_retry_count` / `error`. Phase 1.3
   then splits them (dry run on 寒山子詩集 with the new code: 79 spreads × 2, median 501, MAD 2)
   and OCR follows at the normal per-page rate (~80 spreads each) — that spend is why it waits.
2. **75 June parks** (`pipeline_auto.split_review_needed:true`). Most were the OLD detector's
   abstentions. Re-run `node scripts/split-book.mjs <id> --gutter-only --dry-run` per book on
   Hetzner (laptop Gemini is geo-blocked); approve by hand only what still parks
   (`--approve-center --by="<name>"`). Al-Maqrīzī-class (`6a9fb1ff732b9e75e96ba39d`) went from
   13/201 to 197/201 confident with the new detector.
3. **14 Japanese books still SERVE the old margin cuts** (NDL Kojiki/Sun Tzu/Sōseki, IA Kanze
   utaibon). Repair = re-split from the archived spreads (`page_type:'archived-spread'`, negative
   page numbers hold the originals): restore, `--gutter-only`, re-OCR. Size the class first with
   `scripts/maintenance/split-audit-visual.mjs` — other wide-margin books may share it.
4. `src/lib/spread-guard.ts` (manual `auto-split-ml` path) is a TS copy of the old min-column logic;
   the 91% refusal in the #3593 rehearsal is probably this defect. Port gap+shadow.
5. Manual admin split path still 1% overlap (`src/lib/page-split/split-processing.ts`) vs 3%.
6. **Pecha geometry B** (`scripts/split-pecha.mjs`, June design) is wired to nothing; the 127 EAP
   Bhutan composites are now `needs_splitting:false`, and the #4523 Tibetan re-OCR lane reads
   2–3-leaf composites unsplit. Belongs with #4523/#4722, not here.

## Files

`scripts/split-book.mjs`, `scripts/lib/gutter-detect.mjs`, `scripts/workers/pipeline-orchestrator.mjs`
(Phase 1.25), `scripts/maintenance/reorder-rtl-split-pages.mjs`, `scripts/lib/books-known-fields.json`
(+`split_page_order`), `tests/unit/gutter-detect.test.ts`, `.claude/docs/spread-splitting.md` (status
banner — the body describes the pre-#2454 post-OCR flow), `.claude/docs/invariants/image-classifiers-and-splits.md`
(new paragraph: measure text structure, not darkness; a silent cross-check reads as agreement).

## CLAUDE.md check

Up: the invariant paragraph landed in `image-classifiers-and-splits.md` via #4803 — subsystem-scoped,
no `CLAUDE.md` change. The check that replaces prose: `tests/unit/gutter-detect.test.ts` (nine
fixtures from measured geometry, inverted controls). Down: nothing in `CLAUDE.md` was found stale by
this session; `spread-splitting.md` was, and now carries a banner rather than a rewrite.
