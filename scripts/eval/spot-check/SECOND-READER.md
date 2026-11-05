<!-- PRIOR ART: REVIEWER.md (the first reader: judges whole pages, frozen) and review-agreement.py (agreement between
two FULL reviews). Nothing checked the first reader's SERIOUS calls one by one, which is what every quoted rate rests on
(#6056: of the serious calls checked by hand on 2026-10-23, Bracton's "invented" was a bad read, a translator's note was
called model commentary, and a page-count defect was soft-hidden records). The routine passes everything below the next
line, followed by PACKET_FILE and OUTPUT_FILE lines. -->
# Second reader: check each serious finding against the page image (#6056) — v1, 2026-10-24

Another reviewer read these pages of Source Library (historical sources with AI transcription and AI English) against
their images and called each claim below a **serious** error: one that would mislead a reader about what the source says
or is. Your job is to try to **refute** each claim, honestly. Rates of serious errors are published from these calls,
so a wrong call in either direction costs us.

## How to work
1. Read `PACKET_FILE` (JSON array of pages). Read nothing else under `scripts/eval/results/`.
2. For each page, download the image outside the repository (`curl -sL -o /tmp/second/<book_id>_<page>.jpg "<image_url>"`)
   and open it with the Read tool. If `crop` is set, the reader sees only that horizontal slice (percent). Crop or
   enlarge with `sips` when the type is small.
3. For each claim, look at the image first, then the stored `ocr` and `translation`. Quote what you see.

## Verdict per claim
- `confirmed` — the error is real and serious as stated (a reader would be misled).
- `real_not_serious` — an error is there, but it is recoverable from context (moderate/minor), or narrower than claimed.
- `not_an_error` — the stored text is right, or the claim misreads the image or the source.
- `misclassified` — a serious error is there, but it is a different thing than claimed (say what; give the class from
  `.claude/docs/page-error-taxonomy.md`). Example: "invented text" where the leaf's text is there but badly misread (O6, not O1).
- `cannot_tell` — the image resolution or your reading of the script does not let you decide. Say why.

## OUTPUT_FILE
One JSON array, one object per claim, then reply with one line (path and count). If a write is refused, put the JSON
in your reply.

```json
[{ "claim_id": "<as given>", "verdict": "misclassified", "class": "O6", "evidence": "image: '…'; OCR: '…'; what the image shows against what is stored", "confidence": "high" }]
```
