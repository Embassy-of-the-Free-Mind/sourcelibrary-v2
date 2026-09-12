# Music notation in the library — what we hold, what reads it, how to score it

PRIOR ART: .claude/docs/shaker-letteral-notation.md — the transcription spec for ONE
notation system (Shaker letteral); this doc is the layer above it: the inventory of
every system we hold, the recogniser landscape, and the evaluation contract any
future model must meet before its output is stored.

Read this when: adding a music transcriber (AI or human), evaluating an optical
music recognition (OMR) model, touching `music_transcriptions`, or asked "can the
library play its music?"

## The situation (measured 2026-09-10)

**The OCR does not read notation. It describes it.** On a Morley page the stored
text is `<image-desc>Musical notation on a five-line stave with a C-clef on the
third line, diamond-shaped notes</image-desc>` followed by the solmization syllables
printed under the staff. Pitch and rhythm are gone. That is the right behaviour
for a text OCR (a vision LLM asked to read pitches from staff position invents them
— see the Atalanta note on #3161) but it means **no page of music in the library is
machine-readable as music** except the 79 Shaker pieces in `music_transcriptions`.

**Inventory:** `scripts/music/inventory/by-book.json` (per book) and
`score-pages.jsonl` (per page), built by `scripts/music/inventory-score-pages.mjs`
from those `<image-desc>` mentions over the local corpus mirror. 13,647 pages in 852
books (776 visible), by system:

| system          | pages | what it is                                         | exemplars                                  |
|-----------------|------:|----------------------------------------------------|--------------------------------------------|
| common-practice | 5,282 | engraved modern staff notation, c.1650+            | Fux 1725, Rameau 1722, Mattheson 1739, C.P.E. Bach 1780, Densmore 1918 |
| mensural        | 4,068 | void/diamond noteheads, ligatures, pre-1650 prints | Gaffurius 1502, Zarlino 1558, Salinas 1577, Morley 1597, Maier 1618, Kircher 1650 |
| neumes          | 3,760 | square notation on 4-line staves; ekphonetic       | Gradual c.1360 (682 pp), Antiphonals 1200–1400, Codex Macedoniensis c.850 |
| tablature       |   386 | lute/keyboard finger positions                     | scattered                                   |
| letteral        |    26 | pitch printed as a letter a–g (Shaker)             | Sacred Repository 1852                      |

Caveats that change what a number means:
- The mirror covers mirrored books only (~18K of 47K visible); re-run when it grows.
- A page is found only if it was OCR'd — the Sacred Repository shows 26 because
  only 25 of its 248 pages have OCR, not because it holds 26 pages of music.
- `notation_system` is a GUESS from the description's vocabulary and the book's
  date; Kircher's four copies split between mensural and common-practice because
  1650 is the seam. Treat it as a routing hint, not a fact.
- `<page-type>musical-score` only reached the database on 2026-09-07 (#4455): zero
  pages carry it today. When it accumulates, add it as a second signal, don't
  replace the description detector — inline examples in treatises (most of Morley)
  are never full-page scores.

## Which recogniser can read which system (state of the art, 2026-09)

- **Vision LLMs cannot read staff notation note-for-note.** Gemini 3.1 Pro scores
  59% on a chorale-reading benchmark; on scanned IMSLP piano pages GPT-5 and Gemini
  2.5 Pro sit at 0.94 normalised error. Pitch-as-position defeats them. **Measured
  on our own page 2026-09-11:** gemini-3-flash-preview on Morley's twelve-note
  plainsong example 1 (one voice, one clef, all semibreves) scores pitch NER 0.42 —
  it returned the printed solmization mapped through the natural hexachord, i.e. it
  read the syllables, not the staff
  (`scripts/music/eval-results/2026-09-11-mensural-gemini-3-flash-preview/`). Do not
  batch a frontier VLM over score pages and store the result.
- **Specialist small models beat them 2× on engraved modern notation.**
  rokot-omr-2b (2.1B Qwen3-VL fine-tune, runs locally in ~2 GB, CC BY-NC) scores
  0.44 on the same pages and emits ABC that converts losslessly to MusicXML. Scope:
  single engraved systems cropped to ~1400 px; no manuscripts, tablature or nested
  tuplets. → the **common-practice** slice (Fux, Rameau, Mattheson, C.P.E. Bach).
- **Mensural and neumes need the musicology tools**, all semi-automatic with a
  human correcting: MuRET (Alicante; the only one for handwritten mensural),
  Aruspix (printed mensural; Pugin, now Verovio), OMMR4all (plainchant on 4-line
  staves). Output is MEI, which Verovio renders and abcjs can be bypassed for.
- **Letteral is OCR for pitch, not yet for rhythm** — measured 2026-09-11 on seven
  verified references (`scripts/music/eval-results/2026-09-11-letteral-gemini-3-flash-preview/`):
  gemini-3-flash-preview reads the letters at interval NER 0–0.08 on the five pages
  it read the right span of (0.19 mean over all seven), but rhythm NER is 0.49 —
  long group underlines come back as quarters and half-note bars are dropped. The
  July pilot's "~85–90% rhythm" was eyeballed, never scored, and is withdrawn. The
  79 Shaker drafts are pitch-reliable, rhythm-unreliable.
- **Performance ("play it beautifully") is not solved by anyone.** RenCon 2025
  (ISMIR) benchmarked nine expressive-rendering systems on piano; humans still won
  and a steady tempo beat bad rubato. Nothing handles historically informed
  practice — temperament, ficta, tactus, ornamentation, text underlay. The
  beautiful version of this feature is transcription + real early-music
  performers (Furnace and Fugue commissioned singers for the 50 Atalanta fugues).

## The contract for any transcriber

1. **Storage is ABC in `music_transcriptions`**, one row per piece
   (`src/lib/music-transcriptions.ts`). MEI from the musicology tools is converted
   to ABC for storage; keep the MEI in R2 under the book id if you have it.
2. **Every automated row carries `provenance`** (`method`, `version`, `date`,
   `inputs`) and `notation_system`. The `page_revisions` lesson applies: a store
   that mixes mechanisms without a label cannot be measured afterwards.
3. **Every automated row is `status: "draft"`** and the reader labels it so.
   `verified` is a human (or documented letter-for-letter) check of pitch AND
   rhythm against the scan. Only verified rows are references.
4. **Score before you store at scale.** `scripts/music/eval-transcription.mjs`
   compares a candidate ABC to a verified reference on the music abcjs would play:
   `pitch_ner`, `interval_ner` (transposition-invariant; the metric for unpitched
   sources like Shaker notation), `rhythm_ner`, `note_ner`, `lyric_wer`. Pitch and
   rhythm are reported separately because they fail separately (letteral: pitch
   0–0.08, rhythm 0.49; staff: the model reads the printed syllables, not the
   positions — both measured 2026-09-11). A model earns a batch run by clearing
   a bar on the references in `scripts/music/ground-truth/` for that notation
   system — and there is no bar yet for most systems because there is no
   reference: write the reference first.
5. **Never transcribe what has a modern scholarly edition** (Atalanta → Furnace and
   Fugue, CC BY-NC-ND: play their recordings with credit, compare against their
   MEI, do not redistribute a conversion; #3164).
6. **Text metrics are the wrong instrument.** CER/chrF on ABC strings rewards
   character agreement, not musical agreement. Use the eval script.

## Pilot order (cheapest evidence first)

1. ~~Verify five more Shaker drafts → five letteral references~~ **done 2026-09-11**
   (seven references, first scored run above). Next on this lane: re-run with each
   music line cropped to its own image — the rhythm marks are 2 px high on a
   3000 px page — and re-score the same seven.
2. ~~Write one mensural reference from Morley p.14~~ **done 2026-09-11** (example 1;
   the VLM baseline above). Still open: run Aruspix or MuRET on the same page and
   score it against that reference.
3. Run rokot-omr-2b locally on one Fux and one Rameau example; score against a
   hand transcription; if `note_ner` < 0.1, propose the common-practice batch.
4. Atalanta: embed Brown's recordings on the emblem pages (#3164). No OMR needed.

Sources for the numbers above: rokot-omr-2b model card (huggingface.co/rokotmidi/rokot-omr-2b);
"Music I Care About" LLM music-perception benchmark (arXiv 2607.06015); RenCon 2025 report
(arXiv 2605.02059); IJDAR 2026 full-page historical music recognition (10.1007/s10032-026-00574-w);
MuRET (10.1145/3273024.3273029); Furnace and Fugue (furnaceandfugue.org).
