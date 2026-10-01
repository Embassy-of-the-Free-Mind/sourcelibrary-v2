## 2026-09-26 — by-eye reference for the free IA text lane (pilot, 9 books)

**Question.** Held books have no model pages, so `ia-ocr-ingest.mjs` cannot calibrate them without
the paid 25-page preview. Can a READ stand in — two leaves per book compared by eye with the
Archive's text, plus contact sheets of every page to find non-text leaves? (Derek: "or, you could
look at them manually"; "dont use tesseract".)

**Tool.** `scripts/import/ia-ocr-by-eye-pack.mjs` (pack: first text leaf + interior leaf at 60 %,
image + IA text, optional `--sheets` contact grids labelled by leaf) → verdicts JSONL →
`ia-ocr-ingest.mjs --by-eye <file>`. Pages written carry `ocr.agreement_ref.method: 'by_eye'`,
reader, date, leaves, `skip_leaves`, `min_agreement: null`.

**Result (Keely/Tesla cohort, read by Claude Opus 5.5 on the subscription, $0).**
Accepted 3: Colville *Dashed Against the Rock* 1894 (309 pp), Bloomfield-Moore *Social Ethics*
1892 (314 pp), Tesla US 381,970 (3 pp). Rejected 6: a camera-photographed pamphlet (curved pages →
gibberish), a Google reprint of patents in worn type, MacVicar 1868 (systematic R misreads, lost
chemical notation), two Electrical Experimenter items (captions spliced mid-sentence), and a German
edition scanned as two-page spreads. The split follows the SCAN, not the date: flatbed letterpress
passes, magazines / camera photos / worn Google scans / spreads do not.

**What the pilot changed.**
1. *Skip, not reject.* Non-text leaves (covers, patent drawing sheets, Keely's vibration diagrams in
   Colville, scanner targets) emit hundreds of junk tokens. The existing word-share guard caught 0 of
   them on the German cover; the read skip list caught all. Contact sheets (48 pages per image) made
   that list a one-look-per-50-pages job.
2. *Digits are not judged by two leaves.* The accepted patent's prose is near-exact but its header
   reads "1889" for 1888 and "188%" for 1887 — the #5186 failure. A by-eye accept says nothing about
   year accuracy; the numeric gate #5186 proposes is still needed on top.
3. The item filed as "Electrical Experimenter, November 1916" contains a February 1918 issue.

**Not measured.** Delivered CER of the 626 written pages; whether a two-leaf read agrees with the
paid gate on the same books (the paired comparison `eval-design.md` requires before this replaces
anything). This is a pilot of a reference method, not a quality claim.

**Full cohort (same day, 175 remaining books, Claude Opus 5.5 on the subscription, $0 Gemini).**
Patents (146): contact sheets for all 144 with an XML (6 per montage, each leaf labelled with the
Archive's word count and function-word share); 12 text leaves opened against high-resolution crops.
Accepted 125, rejected 18, 3 unread (IA serves HTTP 500 for their `_djvu.xml`). Rejected: all 7
Canadian patent-office typescripts (garbled: image "a main and a shunt magnet, an armature lever to
draw the arc", IA "32 main Ind lever to driv the tre"); 1 UK patent with no IA words; 3 opened US
patents (a 'best available copy' with interleaved columns and dropped lines; a worn 1928 print with
dropped words; a 1916 print whose line fragments are displaced around the centre line numbers); and
7 more US patents in the same **low function-word band (< 33 % on a body leaf)**, where all 3 opened
ones failed and none of the 7 opened ones above it did. Books (28): 14 accepted (flatbed letterpress:
novels, poems, Theosophical Siftings 1–2, MacVicar *Philosophy of the Beautiful*, Tesla's 1892
lecture, the 1900 Century article), 12 rejected (magazines, camera photos, photocopied or microfilm
spreads, worn Google scans of MacVicar's *Elements*, typed letters), 2 unread (XML HTTP 500). 3,372
pages written (424 patent, 2,948 book); skipped leaves (drawing sheets, a destroyed numeric table,
covers, plates, publisher's catalogues) verified empty in Mongo; all 184 books still held.
Findings: (1) **the pack's reading text was not the ingest's text** — IA tags patent headers and
running heads `<LINE x-struct="header">`, the pack's `<LINE>` regex dropped them while the ingest
writes them; judged against the ingest's own parse and fixed in the pack. (2) The function-word share
printed on each contact-sheet cell is a usable screen for which leaves to open. (3) A readable page
can still hold a destroyed table: skip that leaf, don't reject the book. Still not measured: CER of
the written pages and the paired comparison with the paid gate.
