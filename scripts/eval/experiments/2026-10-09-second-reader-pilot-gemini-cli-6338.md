## 2026-10-09 · Can Gemini through the CLI do the shelf reviewer's job? A 16-page feasibility pilot (#6338): it runs, one page per call

PRIOR ART: the shelf-overview reviewer (`.claude/skills/shelf-overview/SKILL.md`, `scripts/eval/spot-check/REVIEWER.md`
+ `OVERVIEW-ADDENDUM.md`, run by Opus through `run-reviewers.sh`) and its stored review of this packet
(`scripts/eval/results/spot-check/overview-2026-10-07-eternity2/reviews/greek-latin-classics.json`). The calls go through
`scripts/eval/run-cli-arm.py` (#6345 plan mode, nudge, call log) unchanged. The calibration harness and preregistration
are #6347; this pilot does not use them.

**Question.** Can Gemini, called through the subscription CLI (`agy -p`, $0), run the frozen shelf-reviewer brief at
all: how often does a call fail, which call shape holds, and how long does a page take? This pilot does **not** compare
quality. 16 pages cannot support that; the comparison below is descriptive and carries no rate.

**Method.** 2026-10-09, 02:10–02:50Z, Hetzner. The Greek + Latin classics packet of the 2026-10-07 overview
(4 books × 4 pages): Sophocles/Euripides/Aeschylus manuscript (Laurenziana, `6993899a…`), Proclus on the Alcibiades
(`69a5e608…`), Damascius (`69a9768e…`), Vitruvius (`69b52c95…`). Images downloaded once, sha256 in
`images-manifest.json`. Three arms: `gemini-3.1-pro-high`, `gemini-3.8-flash-high`, `gemini-3.8-flash-low`.
- **Page call** (the default): the frozen brief verbatim (REVIEWER.md then OVERVIEW-ADDENDUM.md, each without its leading
  comment), then the page wrapper below, then the packet JSON holding one book and one page; the page image attached as
  `@./<uid>.jpg` by `run-cli-arm.py --parallel 2 --attempts 4`. Plan mode has no tools, so the packet travels in the
  prompt and the JSON comes back in the reply.
- **Book call** (text only, one per book): brief + book wrapper + the packet without page texts + that reader's own four
  page replies. Gives `fit_to_show`, `book_verdict` and the other book fields.
- **Four-image book call** (one per model, Vitruvius): brief + four-image wrapper + the full one-book packet, all four
  images attached. A test of the shape, not used for the comparison.
- Builders and checker: `build_requests.py`, `book4.py`, `assemble.py` in
  `scripts/eval/results/spot-check/second-reader-pilot-6338/`. Raw replies in `raw/`, assembled reviews in `reviews/`
  (REVIEWER.md's OUTPUT_FILE shape). All Gemini outputs were committed before the stored Opus review was opened.

**Result: it runs.** No empty final outputs, no filter blocks, no quota errors, no schema failures in any arm.

| arm | requests | CLI calls | nudged (denied tool, then continued) | other retry | empty | filter cut-off | schema fail | pages reviewed | s / page median (max) | book call median |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 3.1 Pro high | 16 page + 4 book | 31 | 10 / 16 pages (63%) | 1 (empty, then ok) | 0 | 0 | 0 | 16 / 16 | 93 s (217 s) | 25 s |
| 3.8 Flash high | 16 page + 4 book | 29 | 9 / 16 (56%) | 0 | 0 | 0 | 0 | 16 / 16 | 67 s (109 s) | 20 s |
| 3.8 Flash low | 16 page + 4 book | 25 | 5 / 16 (31%) | 0 | 0 | 0 | 0 | 16 / 16 | 11 s (26 s) | 7 s |

- Seconds are per request, including the nudge turn. No book-level text call needed a nudge. Probes: 3.8 Flash high asked
  for a shell tool on 2 of 3 "Reply with exactly: ok" probes.
- `overlapped_other_job` reads 0 for every row, but it is blind here: the other jobs' CLI calls on this box carry no
  `--add-dir`, which is what `run-cli-arm.py`'s gap check looks for. The pilot ran alongside `cli-queue-6293`.
- **Pro did not read the image on 3 of 16 pages** (Sophocles p40, Damascius p232, Vitruvius p30): `right_page: "unsure"`,
  `"image": "unclear"` or null scores; two of the three came after a nudge. On Vitruvius p30 it returned no OCR or English
  error at all, where Opus listed 7 serious ones. Neither Flash setting did this.
- **Four-image book call: the shape holds, the reading thins.** All three returned one valid book object with four pages
  (Pro 86 s; Flash high 81 s; Flash low 24 s after one nudge). Errors listed on the same four pages, one call per page vs
  one call per book: Pro 16 vs 5, Flash high 46 vs 26, Flash low 23 vs 14. Pro's four-image call scored Vitruvius p115
  5/5 and offered p60 as a showcase page; its per-page calls scored them 2/2 and 2/2. Use one call per page.

**Comparison with the stored Opus review: 16 pages, descriptive, no rate** (`agreement.md`).

| | Opus | 3.1 Pro high | 3.8 Flash high | 3.8 Flash low |
|---|---:|---:|---:|---:|
| pages with a serious issue | 6 / 16 | 15 / 16 | 15 / 16 | 12 / 16 |
| books `do_not_show` | 2 / 4 | 4 / 4 | 3 / 4 | 2 / 4 |

Krippendorff's α over the four readers (missing allowed): serious 0.02, right_page −0.03 (every reader said "yes"
almost everywhere), OCR score 0.55, English score 0.46, fit_to_show 0.38 (4 books). The Gemini readers grade far more
misreadings "serious" than Opus does; a page-level serious flag will not agree until that threshold is settled.

Opus's serious issues, and which Gemini reader also raised them:

| page | Opus's serious issue | Pro | Flash high | Flash low |
|---|---|---|---|---|
| [Sophocles p40](https://sourcelibrary.org/book/6993899a0f04c37dcfa61b3c?page=40) | lines garbled and duplicated as glosses; summary names the leaf as Euripides' *Orestes*, it is Sophocles' *Electra* | garbled, image "unclear" | yes, names *Electra* and the false Orestes siglum | garbled; names it Aeschylus' *Choephori* |
| [p173](https://sourcelibrary.org/book/6993899a0f04c37dcfa61b3c?page=173) | "the murderous man" read and translated as "murderous Zeus" (*Bacchae* 555) | no | no | yes |
| [p363](https://sourcelibrary.org/book/6993899a0f04c37dcfa61b3c?page=363) | column 1 lines composed, not read; column 2 not translated | yes | yes | column 2 only |
| [Proclus p270](https://sourcelibrary.org/book/69a5e60885fa13e734e42186?page=270) | οὐκοῦν read as οὐ κοινῶς, sense reversed | no (page flagged on other words) | yes | no (page flagged on other words) |
| [Vitruvius p24](https://sourcelibrary.org/book/69b52c953dd6d94230281474?page=24) | first half of the page untranslated | yes | yes | yes |
| [p30](https://sourcelibrary.org/book/69b52c953dd6d94230281474?page=30) | Socrates read as *socerem*; Ravenna passage and others invented | no (image not read) | yes, both | Socrates only |

Serious issues the Gemini readers raised on pages where Opus raised none (not adjudicated; each needs the image):

- [Vitruvius p60](https://sourcelibrary.org/book/69b52c953dd6d94230281474?page=60): *meridianamque / meridianorum* read
  as *indianaque / indianorum*, so "southern" peoples become "Indian" (Flash high, Flash low); *populus Romanus possidet
  fines* garbled to *ppt̃ r̃e possidet sinet* and translated "by the reason of things" (Pro, Flash high). The readings
  they give fit Vitruvius VI.1.11. Opus scored the page 3/3 with no serious issue.
- [Damascius p127](https://sourcelibrary.org/book/69a9768ee12635ded71c4e2f?page=127) and
  [p232](https://sourcelibrary.org/book/69a9768ee12635ded71c4e2f?page=232): the page's opening clause or sentences left
  out of the English (p127 all three; p232 Pro, Flash high); footnote apparatus untranslated
  ([p98](https://sourcelibrary.org/book/69a9768ee12635ded71c4e2f?page=98) Pro, Flash high; p232 Flash low). Opus rated
  the book `show`, with p98 and p232 as showcase pages.
- [Damascius p358](https://sourcelibrary.org/book/69a9768ee12635ded71c4e2f?page=358): "[is not]" inserted, reversing
  ἡ μὲν … ἡ δὲ (Flash high only).
- [Proclus p124](https://sourcelibrary.org/book/69a5e60885fa13e734e42186?page=124): ὀλιγότης read as ἔλλειψις (Flash
  high, Flash low); μόνον read as με and translated "turn me" (Flash low; Pro gives μὲν).
  [p47](https://sourcelibrary.org/book/69a5e60885fa13e734e42186?page=47): ἀλλ᾽ ὅμως read as ἄκοσμος and translated "The
  disorderly" (Flash high, Flash low). [p236](https://sourcelibrary.org/book/69a5e60885fa13e734e42186?page=236): 13
  serious misreadings (Flash high), 5 (Pro), none (Flash low).
- [Sophocles p524](https://sourcelibrary.org/book/6993899a0f04c37dcfa61b3c?page=524): Pro alone calls the blank page's
  markup serious (OCR 1/5); the other three readers give 5/5.
- [Vitruvius p115](https://sourcelibrary.org/book/69b52c953dd6d94230281474?page=115) (flyleaf): Flash high says the stored
  Arabic margin note and date are invented from stains; Flash low says the Arabic is real and was left out of the
  English; Pro calls the stored description invented text. The marginal writing is too faint at screen size for me to
  settle it.

**What a 100-page calibration round would take, per script** (Greek/Latin pages as here; 1.5–5 MB images):

| arm | mean s / page | CLI calls / page | 100 pages, serial | at `--parallel 2` | CLI calls |
|---|---:|---:|---:|---:|---:|
| 3.1 Pro high | 99 | 1.69 | 2.75 h | 1.4 h | ≈ 170 |
| 3.8 Flash high | 71 | 1.56 | 2.0 h | 1.0 h | ≈ 155 |
| 3.8 Flash low | 12 | 1.31 | 0.33 h | 0.17 h | ≈ 130 |

Both models (Pro + Flash high) on one script: about 4.75 h serial or 2.4 h at two at a time, about 325 CLI calls. A
book-level call adds about 25 s per book. Measured wall clock: Pro's 16 pages took 13.3 min at two at a time, which
scales to about 83 min per 100 pages. No quota error in 95 CLI calls (89 review, 6 probe) while another job ran.

**Limits.** One packet, one stratum, one draw of each model. Two scripts only (Greek, Latin). No second Gemini run, so
Gemini's own noise is unknown. The issues above are what each reader claimed; none is adjudicated against the image.
Book-level fields here come from a separate text-only call that sees only the reader's own page results, which is not
the shape Opus used.

**Next.** The calibration round (#6347's runbook) should use one call per page, flag and drop replies whose
`right_page` is "unsure" with an image field of "unclear" (Pro's tell of not reading the image), and settle the
"serious" threshold gap before reading α on the serious flag.

### Wrappers, word for word

Page call (followed by the one-book, one-page packet as JSON, then ` @./<uid>.jpg`):

```
## How this request is run (wrapper for this pilot, not part of the brief)

You cannot open files, run commands or write files here; do not try. PACKET_FILE is given inline below. It holds ONE book and only ONE of its pages; the book's other packet pages are judged in separate requests, so ignore the instruction to review every page. The page image is already downloaded: it is the file attached at the end of this message (skip the download in step 2). Do steps 3 and 4 for this page. OUTPUT_FILE is your reply: reply with ONLY one JSON object, the page entry from the schema (`page_number`, `right_page`, `ocr_score`, `ocr_errors`, `tr_score`, `tr_errors`, `other`, `confidence`), with no prose and no markdown fence.

PACKET_FILE:
```

Book call (followed by the packet without `pages`, then `YOUR_PAGE_RESULTS:` and the reader's four page replies):

```
## How this request is run (wrapper for this pilot, not part of the brief)

You cannot open files, run commands or write files here; do not try. In earlier requests you judged each of this book's 4 packet pages against its image, one request per page. PACKET_FILE is given inline below without the page texts: the book's metadata, its `structure` counts and the page numbers in `run`. YOUR_PAGE_RESULTS below are your own page entries from those requests. Now judge the book. OUTPUT_FILE is your reply: reply with ONLY one JSON object, the book object from the schema with the addendum's fields and without `pages` (`book_id`, `slot`, `title`, `tradition`, `shelf_fit`, `shelf_note`, `rights_flag`, `structure_note`, `on_sight_defect`, `fit_to_show`, `showcase_pages`, `reader_summary`, `book_verdict`), with no prose and no markdown fence.

PACKET_FILE:
```

Four-image book call (followed by the full one-book packet, then four `@./<book_id>_<page>.jpg`):

```
## How this request is run (wrapper for this pilot, not part of the brief)

You cannot open files, run commands or write files here; do not try. PACKET_FILE is given inline below and holds ONE book with its 4 pages. The 4 page images are already downloaded: they are the files attached at the end of this message, named `<book_id>_<page_number>.jpg` (skip the download in step 2). OUTPUT_FILE is your reply: reply with ONLY the JSON array from the schema (one book object, with all 4 pages and the addendum's fields), with no prose and no markdown fence.

PACKET_FILE:
```

Nudge (`run-cli-arm.py`'s `NUDGE`, sent in the same conversation when the first turn ended on a denied tool):
`Running commands is not available here. Answer directly from the attached file now, following the instructions above exactly.`
