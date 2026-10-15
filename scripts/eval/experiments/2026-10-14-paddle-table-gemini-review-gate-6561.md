---
stage: ocr
measure: judged
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 105
n_pages: 105
verdict: "NO-GO under the gate as written: Gemini 3.8 Flash (high) called 23 of 100 Opus-corrected withheld table pages invented (23%, Wilson 95% 15.8–32.2%; gate ≤ 10), and caught 5 of 5 planted duplicated rows. Nothing was served. But the 5 invented calls opened against the image were all wrong: the span it called invented is printed on the page, most often in the rightmost column, which it reads as 'carried over from the preceding page'. The gate measures this reviewer's false alarms as much as Opus's inventions."
status: rejected
decision: "Serve nothing (#6561 gate). Whether to re-gate with a by-eye or reference check of the 23 calls is Derek's decision."
superseded_by: null
issue: [6561, 6388]
---
## 2026-10-14 · Does Gemini's review pass the Opus-corrected withheld table pages for serving? (#6561)

PRIOR ART: `2026-10-12-paddle-zh-table-opus-reread-pilot-6388.md` (same reviewer, prompt and gate on an Opus
RE-READ: 23 of 100 invented, NO-GO), `2026-10-12-paddle-zh-correct-vs-redo-6561.md` (why Opus-correct was chosen).
Scripts and results: `scripts/eval/paddle-review-6561/`.

**Question.** On the 4,379 Paddle table pages withheld under #6388, Opus 5.5 corrected Paddle's draft with the page
image (job table-correct-6561, all 4,379 pages). Before serving any of them: on a random 100, does the cross-family
reviewer find invented text on 10 or fewer?

**Design (the brief, not redesigned).** 100 pages at random (seed 6561, one per book, 100 books), plus 5 controls:
on 5 further pages one printed row was duplicated directly after itself, mixed in unmarked. Reviewer: `agy -p`,
gemini-3.8-flash-high (no Gemini Pro was listed by `agy models` on 2026-10-14), one page per call, image + the
corrected text, the pilot's prompt `review-prompt-pilot.txt` unchanged. A page is "called invented" when the verdict is
`invented`. Calls: 106 (one reply blocked by Gemini's filter, re-asked once). $0.

**Results, 2026-10-14, n = 100.**

| | |
|---|---|
| Controls caught (verdict invented AND the span is the duplicated row) | **5 of 5** |
| Called invented | **23 of 100 (23%, Wilson 95% 15.8–32.2%)** |
| clean / minor / material | 63 / 13 / 1 |
| Invented by Opus's layout | prose 20 of 64, mixed 2 of 17, table 1 of 17, diagram 0 of 1, illustration 0 of 1 |

Gate (≤ 10 of 100): **NO-GO.** Nothing served; all 4,379 pages remain withheld.

**The invented calls, read against the image (5 of 23, label: read-from-image, by Claude in the job).** All 5 wrong:

- g043 (`6a3c656139b4508b04e2e5ed` p.48): "prepends 17 characters from the preceding page". They are the page's own
  rightmost column.
- g068 (`6a3c661a39b4508b04e31e59` p.114): the same claim, and again the rightmost column is printed.
- g019 (`6a3c662439b4508b04e32465` p.106): an "unprinted 19-character sentence". It is printed under the heading 公子.
  The 賜 it says was inserted stands at the foot of a column.
- g054 (`6a3c660d39b4508b04e315d1` p.44): an "invented 19-character passage". It is printed after the heading.
- g041 (`6a3c663439b4508b04e32e5f` p.41): an "interpolated" 不以法則. It is printed at the head of the third column.

By the reviewer's own notes, the other 18 calls are:

- 6 small Manchu-dictionary phonetic glosses (清文鑑),
- 3 counts of ditto marks 丨,
- 9 single characters, short words or a repeated heading.

None of those 18 was opened.

**Reading.** The gate fails. The by-eye sample says much of the failure is the reviewer, not Opus: 5 of 5 opened calls
were false alarms, on long spans in the outer columns of Siku-style double-line commentary pages. The same reviewer
gave the same 23 of 100 on the pilot's Opus re-read. A second check of the 23 calls (by eye, or against the Kanripo
leaf as the pilot's `kcheck.mjs` did) would separate the two. This entry does not move the gate.

**Write path, built but not applied.** `serve.mjs --gate=gate-score.json` refuses `--apply` unless the gate says GO.
In a dry run over the 77 pages not called invented, all 77 passed the write guards and the provenance builder.

Cloudflare Polish re-encodes these JPEGs on the way out: the same pixel size, at q85. It names the stored size in
`cf-polished: orig_size`. Both the Opus run and the reviewer read whichever variant they were served, so stored byte
counts do not match across reads. The serve script checks the stored object's `last-modified` against the read time
instead.
