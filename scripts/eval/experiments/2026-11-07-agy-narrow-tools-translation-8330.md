---
stage: translation
measure: [judged]
languages: [lzh]
scripts: [Hani]
canons: [chinese-classics]
n_books: 15
n_pages: 60
verdict: "Offering agy no tools for translation cut tokens per page from 10.4K to 5.5K, with judged usable rates equal: 200/240 production, 200/240 narrowed, over two runs of the blind judge on two reads per arm. Net saving by the #7503 index is 6% to 23%, because production's long prefix hits the cache and narrowed calls think at length more often (11 of 120 calls vs 4 of 120). The harness status is probe_broken in both judge runs: the judge missed the same 1 of 5 planted controls, a dropped sentence on a page that repeats itself. Chinese only."
status: adopted
decision: "gatedTextCall offers no tools for task translate; AGY_ALL_TOOLS=1 restores them. Adopted against the harness's all-controls rule, as a cost-only and reversible change, with the miss stated here."
superseded_by: null
issue: [8330, 7503]
feeds: cost
landed: scripts/lib/agy-cli.mjs
router_evidence: "none — same model, prompt and route in every arm; this tests the tool list a call is offered, not a route"
defect_rates: "none — the #7503 judge reports usable and fault counts by page, not misleads per 1,000 words; the comparison is against the live setup on those counts"
---

PRIOR ART: `2026-11-07-agy-narrow-tools-8330.md` (the same change for OCR, and its correction on cached tokens) and
`2026-10-27-agy-pages-per-call-siku-7503.md` (the draw, judge, controls and token index, unchanged).

## 2026-11-07 · Does agy translation need any tools? (#8330)

**Method.** The #7503 draw: 60 pages, 15 Siku books. Its four arm slots held production twice (A1, A1b, the noise floor)
and narrowed twice (B2, C4), all `cli-translate.mjs read` at 1 page a call, `--fresh`, `CANDIDATE_READS=off`,
gemini-3.8-flash-low on the main box. The harness's B2 and C4 meant block arms in #7503; here they are not. The judge is
#7503's, blind Opus with the image and neighbouring OCR. It ran twice over the same reads, because the first run failed
its controls. Results: `agy-read-file-7558/results/narrow-8330/translation-run{1,2}.json`.

| arm | usable, run 1 | usable, run 2 | tokens / page (input + cached) | output + thinking / page | calls with thinking | calls over 5K |
|---|---|---|---|---|---|---|
| production, A1 | 48/60 | 48/60 | 7,706 + 2,708 | 736 | 2 of 60 | 1 |
| production, A1b | 53/60 | 51/60 | 7,979 + 2,437 | 680 | 2 of 60 | 0 |
| narrowed, B2 | 51/60 | 47/60 | 5,504 + 0 | 976 | 4 of 60 | 3 |
| narrowed, C4 | 51/60 | 51/60 | 5,498 + 0 | 986 | 7 of 60 | 2 |

Totals over both judge runs: production 200 of 240, narrowed 200 of 240. Production disagreed with itself on 11 and 15
pages, and with the narrowed arms on 8 to 15, so the arms differ from each other no more than production differs from
itself. Paired difference from A1, by book: B2 +5 points [−3, +13] in run 1, −2 [−10, +7] in run 2; C4 +5 [−7, +15] and
+5 [−3, +13]. Production's own A1b was +8 and +5.

**The controls failed the harness's rule.** It requires all 5, and calls anything less `probe_broken`, not a result.
Both runs caught 4 of 5 and missed the same one: a drop on `6a3c618c879008ba7e15ef34`, a sentence removed from a page
that restates one idea several times, so the gap is easy to overlook. The judge caught the other two drops and both
bleeds, twice. The miss falls on every arm alike, because the judge is blind, so it does not favour either. It does
mean this judge can miss a dropped sentence on a repetitive page, and the omission counts are a floor. This entry is
adopted despite the rule because the change is reversible and affects cost only; the rule itself is unchanged.

**Net saving.** By the #7503 index (input + 6 × output and thinking, the 6× an assumption): production 14,665 with
cached tokens counted and 12,091 with them free; narrowed 11,390. That is 22% to 6%. Tokens fall by 47%, but production's
long prefix hits the cache on about two calls in three, and narrowed calls never do. Calls with any thinking rose from 4
of 120 to 11 of 120, the pattern seen in OCR (see that entry's correction). The cause was not investigated.

**Not tested.** Any language but Chinese, block mode (4 pages a call, which goes through the same `gatedTextCall` and so
is narrowed too), and real pool quota.
