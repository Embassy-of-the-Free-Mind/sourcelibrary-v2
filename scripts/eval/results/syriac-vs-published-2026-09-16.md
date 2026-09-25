# Our Syriac against published Syriac texts and published English translations (#4883)

PRIOR ART: scripts/eval/EXPERIMENTS.md (2026-09-15 specialist benchmark, #4746) — scored Gemini arms against each
other and against 20 sealed pages; it had no reference for Syriac and could not tell recitation from reading. This
result supplies the references (same-edition electronic texts) and the classification the benchmark lacked.

Snapshot, 2026-09-16. Decides the disposition proposed in #4883 (withdraw Syriac translations
from "readable"). Scripts: `scripts/eval/syriac-vs-published/`. Per-page artefacts: this
directory. Cost: $0 in model calls (text-vs-text only; Hetzner used for archive.org fetches).

## Headline

**The Gemini OCR of our Syriac is recitation and invention, not reading, and the failure is
worst exactly where the loop scan says the text is clean.** On the 1905 British and Foreign
Bible Society New Testament, whose printed text exists as an exact electronic edition, only
**19 %** of pages with Syriac on them carry the right passage at ≤ 10 % character error; **47 %**
carry the wrong passage, a text that is not in the Bible at all, or a right passage with more
than half its characters wrong. On three non-canonical printed editions for which the Digital
Syriac Corpus has page-exact transcriptions, the **median page is ~70 % characters wrong** and
**no page reaches 20 %**. Our English for five narrative works is **indistinguishable from
random alignment** against the public-domain published translations of the same books. The
loop score flags 0 of the 372 NT pages and 13 of 410 Isaac pages — it does not measure the
thing that is wrong.

Recommendation: **withdraw by book — every Syriac-OCR-derived text — with the per-page script
check #4883 already proposes; do not withdraw by page threshold, because no page-level signal we
have separates a recited page from a read one.** Numbers and the residual risk are at the end.

## Anchor A — Syriac against published Syriac

### References (all recorded with licence)

| our book | edition | reference | same edition? | licence |
|---|---|---|---|---|
| `69920b97…` New Testament in Syriac, BFBS 1905 (IA `newtestamentinsy00unse`) | Gwilliam/Gwynn text | ETCBC `syrnt` plain text = SEDRA 3 export of the BFBS NT (Kiraz/Bennett) | **yes** — CER floor ≈ 0 | MIT (tooling) / SEDRA data as exported |
| `69920b90…` Old Testament in Syriac, TBS 1913 (IA `oldtestamentinsy00lond`) | reprint of the Urmia 1852 edition | ETCBC `peshitta` plain text 0.2 (Leiden edition, Codex Ambrosianus base) | no — edition variance adds an unmeasured floor to CER on right-passage pages; the wrong-passage / fabricated classes do not depend on it | CC BY-NC 4.0 |
| `69943c78…` Isaac of Nineveh, *De perfectione religiosa*, Bedjan 1909 | — | Digital Syriac Corpus (Oxford-BYU) TEI 392–449, transcribed from Bedjan 1909 with `<pb n>` page breaks | **yes, page-exact** | CC BY 4.0 |
| `69943ce1…` Narsai, *Homiliae et carmina*, Mingana 1905 | — | Digital Syriac Corpus, 46 homilies transcribed from Mingana with `<pb n>` | **yes, page-exact** | CC BY 4.0 |
| `69a5ed1a…` Aphrahat, *Demonstrationes*, Parisot 1894 (Patrologia Syriaca I.1) | — | Digital Syriac Corpus TEI 1–23, from Parisot; no page breaks | yes (text), located by trigram votes | CC BY 4.0 |

Normalisation for every comparison: vowels, diacritics, syame and punctuation stripped; only
Syriac-script letters compared (Latin apparatus, digits, verse markers dropped), so CER is
over consonantal Syriac only.

### A1. Peshitta NT — the strongest possible case for recitation

A printed Bible runs monotonically, so each page's aligned span must be in sequence; a page that
aligns out of sequence is a recitation of the wrong passage, and a page with plenty of Syriac and
no anchor anywhere in the Peshitta (OT + NT + apocrypha) is invented text.
(`align.py` → `classify` in `nt-page-classes.tsv`.)

| class | pages | share of 372 |
|---|---|---|
| A right passage, CER ≤ 10 % | 72 | 19 % |
| B right passage, CER 10–50 % | 112 | 30 % |
| C right passage, CER > 50 % | 48 | 13 % |
| D **wrong passage** (out of sequence, or Old Testament / apocrypha) | 53 | 14 % |
| E **not in the Bible at all** (≥ 15 Syriac words, no anchor) | 65 | 17 % |
| F too few Syriac words (front matter) | 22 | 6 % |

Of the 350 pages with Syriac text, **166 (47 %) are wrong-passage, invented, or > 50 % wrong.**
The whole book was OCR'd by `gemini-3-flash-preview`; the loop scan flags **0** of its pages.

Hand-checked against the page image (six pages; the classifier was right on all six):

| our page | printed page | our OCR | verdict |
|---|---|---|---|
| [pn 19](https://sourcelibrary.org/book/69920b97e0a548a13d8840d5?page=19) | 7 — header ܡܬܝ ܘ, Matthew 6:9–33 (the Lord's Prayer) | a Christological treatise on hypostasis and the body of Mary, with verse numbers 9–12 | **invented** |
| [pn 21](https://sourcelibrary.org/book/69920b97e0a548a13d8840d5?page=21) | 9 — header ܡܬܝ ܚ, Matthew 7:27–8:23, "Cap. viii" in the margin | 2 Kings 14:27–29, header rewritten to ܡܠܟܐ ܝܕ, verse numbers 27–29 kept, page number "9" read correctly | **wrong passage**, keyed on the printed verse numerals |
| [pn 57](https://sourcelibrary.org/book/69920b97e0a548a13d8840d5?page=57) | Mark 1:1–24, gospel title in Estrangela, "Cap. i" | Matthew 1 | **wrong passage** ("Cap. i" → Matthew) |
| [pn 85](https://sourcelibrary.org/book/69920b97e0a548a13d8840d5?page=85) | Luke 1:1–22, "Cap. i" | Genesis 1 | **wrong passage** ("Cap. i" → Genesis) |
| [pn 44](https://sourcelibrary.org/book/69920b97e0a548a13d8840d5?page=44) | Matthew 22:41–23:29 | Matthew 22–23, CER 2.5 % | right passage |
| [pn 73](https://sourcelibrary.org/book/69920b97e0a548a13d8840d5?page=73) | 17 — Mark 9:30–10:5 | Mark 9–10, CER 14.8 % | right passage |

The 2026-09-16 hand-read that called "2 Kings 14:27–15:6" right was checking the recitation
against the Bible, not against the page: the page prints Matthew 7–8.

**Kind of error on the right-passage pages (A + B, 184 pages, 58,402 reference words).** An OCR
engine makes letter-shape errors; a reciter substitutes words. Equal 77.8 %, near-miss
substitutions (≤ 2 characters) 7.1 %, **whole-word substitutions 10.2 %**, deleted 4.9 %, inserted
5.4 %. **59 % of substitutions are whole words** — e.g. Matt 23:4 ܕܢܩܪܒܘܢ ܠܗܝܢ → ܕܢܙܝܥܘܢ ܐܢܘܢ,
Matt 23:17 ܥܘܝܪܐ → ܣܡܝܐ (a synonym for "blind"), Luke 7 ܒܝܫܬܐ → ܛܢܦܬܐ. These are readings from
memory, not misread glyphs.

### A2. Peshitta OT (`ot-page-classes.tsv`)

548 pages, 533 with Syriac text. A 1 · B 140 · C 64 · **D wrong passage 135 (25 %)** ·
**E invented 193 (35 %)** · F 15. **74 % of text pages** are wrong-passage, invented, or > 50 %
wrong. Right-passage CER is inflated by the Urmia-vs-Leiden edition difference and is not quoted
as a reading rate; the D and E classes do not depend on the edition. Wrong-passage recitations
include Mark, Acts, Hebrews, Revelation, 1 Peter and 2 Maccabees on pages of the Pentateuch.

### A3. Non-canonical editions, page-exact (`isaac-bypage.jsonl`, `narsai-bypage.jsonl`)

The Digital Syriac Corpus transcriptions carry the printed page numbers of the very volumes we
scanned, so every page — including the ones our OCR invented — has a reference, and the page
mapping is one constant offset the script solves for (positive control: the offset comes out of
the data as a single mode, 76 votes for Isaac, 97 for Narsai).

| book | pages compared | CER median | ≤ 20 % | ≤ 30 % | > 50 % | WER median | loop flags |
|---|---|---|---|---|---|---|---|
| Isaac, Bedjan 1909 (offset 23) | 410 | **0.74** | 0 % | 2 % | 75 % | 1.00 | 13 |
| Narsai, Mingana 1905 (offset 67) | 368 | **0.69** | 0 % | 0 % | 99 % | 0.93 | 1 |
| Aphrahat, Parisot 1894 (trigram-located; 495 text pages) | 49 aligned at all | 0.72 | 0 % | — | 78 % | 0.98 | 1 |

Hand check, [Isaac pn 123](https://sourcelibrary.org/book/69943c7813c9a0dce2757b20?page=123)
= printed page 100: header (ܦܠܓܘܬܐ ܓ ܕܡܪܝ ܐܝܣܚܩ ܕܢܝܢܘܐ) and page number read correctly; the
opening ܥܠ ܐܠܗܐ ܡܛܠ ܕܦܠܝܚ ܗܘ is on the page (reference ܢܬܬܟܠ ܥܠ ܐܠܗܐ ܡܛܠ ܕܦܠܚܗ ܗܘ), then the
text drifts into sentences that are not there and returns to the page a line later; 62 of the
page's 183 word bigrams occur on the printed page. The model is *looking at* the page and
anchoring on roughly a third of it; the rest is infill. The served English translates the infill
("Lightly upon God, because He is a worker. And the perceiver of hidden knowledge…" for Bedjan's
"Let him trust in God, because he is His servant and carries His care…").

## Anchor B — our English against published English translations

Public-domain translations from archive.org (djvu text): Budge, *Chronography of Bar Hebraeus*
(Wellcome `b31365334`); Budge, *Book of Governors* vol. 2 (`bookofgovernors02thom`);
Keith-Falconer, *Kalilah and Dimnah* 1885 (`kalilahdimnahorf00bdpkuoft`); Budge, *Book of the
Bee* 1886 (`bookofbee00solo`, same volume as our Syriac); Budge, *Monks of Kublai Khan* 1928
(`monksofkublaikha0000eawa`, for Bedjan's *Mar Jabalaha*).

Method (`english-vs-published.py`): for each of our translated pages whose OCR is Syriac, the
window of the published text sharing the most distinct content words; the same max-over-windows
statistic against a *different* work is the null (a best window always finds something). Both
books are sequential, so pages that read the right passage form a monotone chain; a random order
gives a chain of ≈ 2√n.

| our book (pages scored) | monotone chain | random expectation | score vs control (median) | recognisable / partly / unrelated (automatic) |
|---|---|---|---|---|
| Chronicon Syriacum, Bedjan 1890 (490) | 8 % | 9 % | 0.33 vs 0.35 | 2 / 19 / 79 % |
| Liber Superiorum, Bedjan 1901 (552) | 7 % | 9 % | 0.39 vs 0.33 | 2 / 26 / 72 % |
| Kalilah and Dimnah, Wright 1884 (349) | 10 % | 11 % | 0.39 vs 0.35 | 5 / 41 / 54 % |
| Book of the Bee, Syriac-majority pages (95) | 20 % | 21 % | 0.47 vs 0.35 | 5 / 33 / 62 % |
| Mar Jabalaha, Bedjan 1895, pp. ≤ 230 (212) | 17 % | 14 % | 0.41 vs 0.33 | 7 / 32 / 61 % |

**Hand-read, 24 page pairs** (three per book spaced across the score range, plus the top
"recognisable" pages of each book): **one** is about the same events as the published
translation — [Mar Jabalaha pn 80](https://sourcelibrary.org/book/69a5edab96d6dd816a56b1c6?page=80),
Rabban Sawma's dispute with the cardinals on the procession of the Spirit. Every other
"recognisable" page is a loop ("for two years and a half, all the partisans departed" ×n; "if you
are my companion" ×n; "for the sake of" ×n) or a printed glossary / corrections page that matches
its own apparatus. The automatic classes overcount; the honest recognisable rate for narrative
Syriac is **≈ 0–2 % of pages**. The English for a Book-of-the-Bee page
([pn 363](https://sourcelibrary.org/book/69943c5c13c9a0dce275771a?page=363)) is Matthew 21:21–23 —
a Gospel recitation on a page of Solomon of Basra.

## Recitation vs reading — the discriminating evidence

1. **Triggers.** The wrong-passage recitations key on printed apparatus: verse numerals 27–29 on
   a Matthew page produce 2 Kings 14:27–29 with the same numerals; "Cap. i" produces Matthew 1
   (on Mark 1) and Genesis 1 (on Luke 1).
2. **Cleaner than the scan.** On NT pn 21 the running header is rewritten from ܡܬܝ ܚ to
   ܡܠܟܐ ܝܕ to agree with the recitation while the Arabic page number "9" is read correctly; the
   recited 2 Kings arrives fully vocalised in West-Syriac vowels the reference OT does not carry.
3. **Whole-word substitutions** dominate on the right-passage pages (59 % of substitutions), with
   synonyms and alternative readings rather than glyph confusions.
4. **Where nothing can be recited** (Isaac, Narsai, Aphrahat) the page anchors on ~1/3 of its
   words and infills; CER never drops below 20 %.
5. **The loop score is orthogonal to all of this.** Corpus-wide it is a *model* signature:
   `gemini-3-flash-preview` 2.2 % looped over 30,579 pages, `gemini-3.1-flash-lite-preview`
   12.4 % over 11,801; inside one book Isaac is 3.1 % (flash) vs 32.6 % (lite), Narsai 0.6 % vs
   23.9 %, Chronicon 4.5 % (n = 22) vs 41.1 %. The "damage concentrated by text type" pattern in
   the 2026-09-16 scan is mostly which books were routed to lite. Flash loops less and invents
   just as much: the NT above is 100 % flash and 0 % looped.

## Disposition for #4883

**Withdraw all Syriac-OCR-derived text from "readable", by book, with the per-page script check
for mixed volumes** (Targum Onkelos, the Mandaic Johannesbuch, the Hebrew-script kabbalistic
manuscripts and Reyna Cohen's autobiography carry `language = Syriac` but are not Syriac pages).

- A page threshold is not available. The loop score (5 % of pages) misses 47–74 % wrong on the
  Bibles and ~100 % wrong on the non-canonical editions. CER needs a reference, which exists for
  ~10 of the 103 books, and even there the right-passage pages of the NT are recitations of the
  1905 text, not readings of the scan.
- Withdrawal by book loses ~184 NT pages and ~140 OT pages that carry the right passage at
  < 50 % CER. Those readers are better served by the published editions (SEDRA / ETCBC) the
  recitation came from; nothing on them is a reading of *this* copy.
- Keep every OCR and translation row (`preservation-policy.md`); the non-canonical OCR anchors on
  a third of the page and may seed a future aligner.
- Re-OCR with `gemini-3-flash-preview` is not a fix: it removes loops, not invention.
- Residual risk under withdrawal: the ≈ 1–2 % of narrative pages that are genuinely about the
  right events (one of 24 hand-read) go dark with the rest; and the flag is per book, so a
  mixed volume needs the script check or its non-Syriac pages go dark too.

## Replication

Everything here is text-vs-text and reruns in minutes: `pip install rapidfuzz`, clone
`ETCBC/syrnt`, `ETCBC/peshitta`, `srophe/syriac-corpus` (data/tei), fetch the five archive.org
djvu texts on Hetzner, dump pages as described in `scripts/eval/syriac-vs-published/README.md`.
Not yet replicated by a second run or a second pair of hands; the hand checks above are one
reader's.
