# Preregistration — #5568: Kanripo instead of OCR, OCR quality through translation, Paddle output vs the production writer

PRIOR ART: `PREREGISTRATION-chinese-cohort-5547.md` (the parent eval, on its own branch; this one reads its sealed set and engine outputs and changes nothing in them); `.claude/docs/eval-design.md` §8 (translation judging: same-arm control, pinned text hashes, a judge that can say TIE).

Committed before any alignment score, translation or judge call. Issue #5568, parent #5547. Cap $5 Gemini (via `scripts/lib/gemini-script-client.mjs`, thinking 0). Nothing is written to `pages`, `books` or `page_translations`.

## Sample (shared by tests 1 and 2)

From the #5547 sealed set (`benchmark/chinese-cohort-5547.json`, 540 pages, one per book): pages whose book is in the **held** cohort, eye-classified `manuscript-regular`, with a Kanripo `work_id`, and whose PaddleOCR-VL read has ≥ 50 Han characters. Slug-sorted, drawn without replacement with `makeRng(5568)` (mulberry32): **40 books, one page each** (`zh-skqs-5568-kanripo.mjs sample` prints the list; drawn before any scoring). The draw is not conditioned on Kanripo having found a reference, so the alignment share is not inflated by #5547's reference step.

## Test 1 — Kanripo text instead of OCR

Measures:
1. **Coverage (census, all 7,894 held books):** the share whose work has a Kanripo `WYG` branch (else `master`, else none), and of those, whether juan files exist for the title's juan range. GitHub reads only.
2. **Page alignment (the 40):** Kanripo's WYG files mark every half-leaf (`<pb:KRxxxx_WYG_jjj-NNa>`), the same unit as one scan image. Paddle's read is compared (char-bigram Dice, Han only, a short variant fold applied to both sides) with every `<pb>` page of the work's juan files within ±5 of the title's juan range. **Aligned = best Dice ≥ 0.6.** Reported: aligned share with Wilson CI, margin over the runner-up, CER of Paddle and lite against the aligned Kanripo page.
3. **Drift (the #5547 Paddle pilot volumes, every page read):** each page aligned; the page → `<pb>` offset tracked across the volume; with ONE anchor per juan, the share of later aligned pages whose Kanripo page is predicted exactly.
4. **Licence per text**, from the repositories themselves (repo licence field, LICENSE file, Readme.org), plus the organisation's own statement; compatibility with how we publish (CC BY-SA 4.0 translations, `src/lib/license-info.ts`).
5. **A provenance-complete write**, shown as a dry-run `$set` (source, licence, repository + branch + commit, file, `<pb>`, content_hash, alignment score).

**Rule T1 (fixed now):** a Kanripo-text lane is **viable** if aligned share ≥ 0.80 with Wilson lower bound ≥ 0.65 on the 40 **and** anchor-per-juan prediction ≥ 0.90 on the pilot volumes. Viable → recommend "Kanripo text for the WYG-covered books, Paddle for the rest", conditional on licence sign-off. Not viable → "Paddle for all; Kanripo as reference and QA only". Licence is reported, not decided here.

## Test 2 — does OCR quality survive translation?

Sources per page (the same 40): **L** = lite OCR (#5547 bench arm), **P** = PaddleOCR-VL, **K** = the aligned Kanripo page (only where test 1 aligned it, Dice ≥ 0.6), **PP** = P after a 句讀 pass (lite adds punctuation; a pass whose Han characters differ from P's beyond punctuation is rejected and reported, not used), **P′** = P translated a second time (sampling control).

Translation: production prompt (`loadTranslationPrompts` → `buildTranslationPrompt`, the worker's single-page path; book title/author/date from Mongo; no continuity, since only one page per book is read), `getTranslateModelForBook` (lite), `thinkingBudget: 0`, the worker's `maxOutputTokens`, temperature 1 (the effective production value — the worker sends none and the model default is 1).

Judge: `gemini-3-flash-preview`, thinking 0, temperature 0, sees **the page image** and two English translations as A/B (order randomised per pair with a per-pair seed); never sees source text or arm names. Returns `material` (yes/no: would a reader take away something different — a name, number, title, claim, a sentence present in one only, a reversed meaning; wording/style/romanisation are not material) and `better` (A / B / TIE, by faithfulness to the page). Pairs: L–P, P–K, L–K, P–PP, P–P′ (sampling floor) on every eligible page; **byte-identical control** P–P on 10 pages; **test-retest** on 12 pairs drawn from L–P / P–K / P–PP, re-judged in a separate call with A/B swapped. Text hashes of what the judge saw are pinned in the packet.

**Primary outcome:** share of pages where the source changes the English materially = material rate(L–P), reported beside the sampling floor rate(P–P′).

**Rules (fixed now):**
- **Judge validity first.** Byte-identical control must come back TIE and not-material on ≥ 9/10. Test-retest agreement (same `material` and same `better` after the swap) is reported; if `material` agreement < 0.75, no rule below fires and the result is labelled judge-noise-limited.
- **T2a — the OCR engine changes the English** if material rate(L–P) exceeds rate(P–P′) by ≥ 0.15, with a McNemar exact p < 0.05 on the paired pages.
- **T2b — Kanripo text improves the English over Paddle** if K beats P on `better` (sign test on untied pairs, p < 0.05) and material rate(P–K) exceeds the floor by ≥ 0.15.
- **T2c — a 句讀 pass is worth adding to a Paddle lane** if PP beats P on `better` with sign-test p < 0.05 and wins ≥ 2× losses.

## Test 3 — Paddle output vs the production writer and translation input

Dry-run only, on the #5547 pilot's Paddle pages (`/root/zh-ocr-eval-5547/pilot/out/`, every page of the complete volumes): length cap (25,000), `loopVerdict` (OCR write gate), `extractPageType` / `extractColumns` / `parseDetectedImages` (what the writer derives from the text), `missingProvenance` on the `$set` a Paddle lane would write, and the translation lane's gates (`isTranslatablePage`, `hasTranslatableSource`, `isBlankFromOcr`, `isDegenerateSource`, `unverifiedScriptShare`), plus `buildTranslationPrompt` on a Paddle page. Output: pass counts per check and the conversion list. No rule; it is a checklist.

## Cost

Estimate ≈ $1.2 (160 lite translations + 40 punctuation passes + ~220 flash-preview judge calls with one image each). Hard stop at $5.
