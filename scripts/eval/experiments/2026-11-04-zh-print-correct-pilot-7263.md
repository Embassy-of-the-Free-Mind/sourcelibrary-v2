---
stage: ocr
measure: [judged]
languages: [zh]
scripts: [Hani]
canons: []
n_books: 60
n_pages: 60
verdict: "The Opus correction pilot on printed Chinese read by Gemini missed its bar: 51/60 accepted (bar 50) but 6 wrong-text pages (limit 4). Wrong-page controls 0/4 accepted. Four of the six are stored Gemini text the lane left in place (2 CONTAIN, 2 refused by apply's shared-words guard); on written pages alone it is 47/52 accepted and 2/52 wrong-text, a cut made after the data. One page a call and ten a call are not separable (24/30 and 27/30, 3 wrong-text each); no text slid onto a neighbouring page in either."
status: undecided
decision: "No OCR written and bulk not started. If Derek releases bulk on a changed bar it runs at one page a call: ten saves about 6% and both written wrong-text pages came from it. Three by-eye wrong-text pages had their English withheld (standing containment rule). current.json and the routing tables are untouched."
superseded_by: null
issue: [7263]
router_evidence: "none — this pilot exports no score. Job zh-print-arms-7263 re-judges these 60 pages beside its comparison arms and exports the score.json under router-table/evidence/; rules.json does not name this file."
defect_rates: "none — the pilot scored accept and wrong-text pages only, not severe errors per 1,000 characters"
---
## 2026-11-04 · Does Opus correction hold on the Gemini-read Chinese print pages at frame scale, and at how many pages a call? (#7263)

Derek, 2026-11-04: "fix those too". #8008 measured `gemini>opus` at 26/30 on print with a stricter page rule and one page a call. This pilot runs the bulk's own frame through its own reader and writer before any write.

PRIOR ART:
- `2026-11-03-zh-gemini-reocr-cell-7263.md`, `2026-11-03-zh-reocr-cheap-arms-7263.md`: the cell test and the route. The route is not re-chosen here.
- `scripts/eval/zh-gemini-reocr-7263/` and `router-confirm/confirm.mjs judge`: the plan and judge shape, run unchanged. `draw.mjs` draws one page a book only at one a call, so `scripts/batch/zh-print-correct-7263/pilot.mjs` restates the draw.
- `scripts/batch/ocr-convergence/correct.mjs`, `cli-ocr.mjs apply`: the reader and the writer, run unchanged. `apply` was run dry here.
- `scripts/batch/cli-ocr-lane.mjs correct`: the scheduled twin. It reads agy pools and needs a cron, which the brief forbids; hence `runner.mjs`.
- `scripts/lib/leaf-shift.mjs`: votes on printed numbers, which these pages mostly lack. The own-leaf test compares Han bigrams with stored texts instead.

### Frame

`frame.mjs`, from Mongo, read-only. 211 true print books hold 29,495 Gemini-read pages (the brief's estimate was 29,506); the Siku pages are out.

| page state | pages |
|---|---:|
| owed (reading text, 30+ Han, not human-edited, not tagged handwritten) | 22,944 |
| not a page of reading text | 2,620 |
| under 30 Han | 1,992 |
| tagged handwritten or mixed | 1,875 |
| English withheld by eye | 63 |
| `ocr.unreadable` | 1 |

20,621 owed pages in 183 books can be written now; the rest are deferred by `writeGate` and re-checked each wave. 21,946 owed pages carry English. `zh-ditto-correct-5274` owns pages in books titled 佩文韻府, 駢字類編 or 韻府拾遺: none of the 211 is one, so no page has two owners.

### Design

Set before any text was judged.

- **Bar.** At least 50/60 accepted and no more than 4 wrong-text pages. Counted on all 60 judged pages, including those where the lane serves the stored text.
- **Sets.** 60 books, one judged page each. Set `one` (30 books): one page a call. Set `ten` (30 books): a call of ten consecutive owed pages, of which one is judged, at a seeded position. 330 pages read.
- **Served text.** What `cli-ocr.mjs apply --emit-written` would write. A refused page, or an UNCHANGED, CONTAIN or no answer, serves the stored text.
- **Judge.** `judgeAbsolute`, Opus, image attached, one text a call, blind. 4 wrong-page controls.
- **Own leaf.** Every correction, by Han bigrams, against its own stored text and its neighbours'.

### Result

| set | accepted | wrong-text | not this leaf | mean fidelity | served | controls | list price a page |
|---|---:|---:|---:|---:|---|---:|---:|
| one a call | 24/30 | 3 | 2 | 4.3 | written 25, unchanged 2, CONTAIN 2, refused 1 | 0/2 | $0.105 |
| ten a call | 27/30 | 3 | 0 | 4.5 | written 27, unchanged 2, refused 1 | 0/2 | $0.099 |
| **both** | **51/60** | **6** | 2 | | written 52, unchanged 4, CONTAIN 2, refused 2 | 0/4 | |

**The six wrong-text pages:**

| page | served | what |
|---|---|---|
| 列子沖虛真經 vol. 2 p.16 | CONTAIN, stored | stored text is another leaf; confirmed by eye |
| 性命雙修萬神圭旨 p.270 | CONTAIN, stored | stored text is another leaf; confirmed by eye |
| 本草綱目圖 p.2 | refused, stored | apply's 40% shared-words guard refused the correction |
| 大正新脩大藏經 vol. 8 p.261 | refused, stored | the same guard |
| 四書集注 p.64 | written, ten a call | a dense spread, its two pages in the wrong order at the seam |
| 正統道藏 vol. 5 p.22 | written, ten a call | misreads; by eye the judge is right: the leaf reads 倏欻之間 and 綿雲皎 |

The bar counted all four stored pages against the lane because it was written that way. **Written pages alone give 47/52 accepted and 2/52 wrong-text, which would pass. That cut came after the data, so it does not change the result.** Whether the bar should count only what the lane writes is Derek's call.

The third CONTAIN answer, 格致鏡原 p.344, fell outside the judged pages: by eye that side shows only an empty frame and show-through, and its stored text and English are invented.

**Own leaf (#5021).** No slide in either set. One a call: 0 of 26 corrections sit closer to a neighbour than to their own stored text. Ten a call: 1 of 279 (四書集注 p.62, own 0.095, neighbour 0.103), where the stored text is Gemini reading across the columns and the correction is coherent 大學或問 text. Under 0.5 own overlap: 1 of 26 and 19 of 279, the highest neighbour figure among the 19 being 0.215.

**One page a call.** Ten is no worse on the bar, but it saves only about 6%, apply refused more of it (21/279 against 1/26, concentrated in a few books), and both written wrong-text pages came from it. These differences do not separate at this n; with no real saving there is no reason to carry the #5021 risk.

### Cost

$32.80 list across the pilot's reads, cash $0. Bulk at one a call: 20,621 writable pages x $0.105 = about $2,165 list. At the issue's measured 0.04 to 0.054 points per list dollar that is about 87 to 117 points, 0.9 to 1.2 account-weeks, inside the brief's 3.5. The meter went from 78% to 84% across the pilot, but other jobs share the login and it reads whole points, so that bounds the rate rather than measures it.

### What reads a changed OCR text

Checked in code before any write, for whichever job runs the bulk. Apply runs with `--only=<the corrections>`, no `--mark-stale`, and lane `opus-correct-zh-print-7263`; each overwrite snapshots to `page_revisions`; human-edited pages are refused.

| reader | when | what it does to a corrected page |
|---|---|---|
| `mark-stale-translations` | 07:30, main | stamps `translation_stale` {`ocr_newer`}: a flag only |
| `withhold-stale-translations` | 08:20, gex45 | arm 1 acts on `WITHHOLD_LANES` only; this lane is not in it, so the English stays served |
| `cli-translate-lane stale` | :05, gex45 | reads `--stale-lane=agy-reread-lite-7853` only |
| `cli-translate-lane run` | main :40, gex45 :10 | untranslated pages only |
| `translate-worker` | */2, main, PAID | stale pages only inside a job, and it dispatches only `ocr_complete` and `translate_partial` books; `writeGate` writes none of those |
| Phase 4 gap-fill | PAID | books under 90% translated, OCR-newer pages included. `translationLaneReason` defers books under 92%: 6 books, 347 pages deferred, re-checked each wave |
| `translate-batch-worker --chained` | PAID | same selector; `planNextRound` drops translated pages, so Batch never re-translates a stale page |
| `realtime-translate --stale`, `stale-retranslate-6567`, `reader-request-lane` | no cron, or by hand | none, or untranslated only |
| derived metadata, `concept-abstracts` | | made from the English, which does not change; `concept-abstracts` skips stale pages |
| `embed-gemini --incremental` | 30 */4, main, PAID | re-embeds the same English at $0.20/M: about 20K x 500 tokens = about $2 |
| `sync-pages-content`, vector delta | | free |
| `lane-judge-sampler` | nightly | may sample the lane: harmless |

So corrected pages queue no paid Batch re-translation, and no global switch is needed. **One caveat:** 128 books are held `paddle-print-6101`. No lane selects them while held, but on RELEASE any under 90% or at `ocr_complete` would re-translate corrected pages on a paid lane. That release is its own priced decision.

### Containment

By eye, in the same run, under `containment-on-finding.md`. The three CONTAIN answers were not written. Their English is withheld (`withhold-stale-translations.mjs --by-eye-pages`, snapshotted, undo with `restore-withheld-translation.mjs`); all three books were already held `paddle-print-6101`. These pages still need repairing, and bulk would meet more: 3 CONTAIN answers in 330 pages read. Those three withholds are the pilot's only Mongo writes.

### Not done here

- The comparison arms Derek asked for (Paddle + Flash low and medium, Opus fresh read) need gex45's GPU and more quota than this box had, so they run as job `zh-print-arms-7263` on these 60 pages, input in `scripts/eval/zh-print-arms-7263/input/`.
- Re-translating the English.
