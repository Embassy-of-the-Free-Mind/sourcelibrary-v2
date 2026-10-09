## 2026-10-04 · Can any engine read the Mongolian Kanjur (BDRC W4CZ5370) well enough to be worth a scored reference? (#5664)

PRIOR ART: the #5664 3-page pilot (issue comment, scratchpad only, no script or prompt kept); `scripts/eval/lib/production-prompt.mjs` (used, for the live OCR prompt); #5665 Derge alignment (used, as the Tibetan parallel). No earlier eval of Mongolian script in `scripts/eval/INDEX.md` or this log.

**Answer: no.** Neither engine reads the script. Gemini 3 Flash, with the production OCR prompt, read 0 of 285 columns on 10 identified pages. It called the script **Manchu** on 7 of 10 pages and "handwritten" on 10 of 10. Its output was either "N columns not transcribed" or one phrase looped, sometimes to the 16K-token cap. Told the true language and script, it emitted Mongolian-script text, but every page was a loop of a few genre-typical Buddhist phrases: 1–17 distinct lines and 9–58 distinct words per page. None matched the Tibetan parallel of the passage. CrossLing-OCR-Mini emitted looping **Tibetan-script** text on every input, never Mongolian.

**Design.**
- **Pages:** 10 pages from 10 volumes (1, 5, 11, 47, 49, 61, 66, 77, 87, 98), covering Tantra, Prajñāpāramitā, Ratnakūṭa, Sūtra and Vinaya.
- **Identification:** BDRC has no outline for W4CZ5370. Each text and folio span was taken from Ligeti's catalogue via the rKTs handlist ("Mongolian printed Kanjur, handlist prepared from Ligeti's catalogue"), which also gives the Derge (Tōhoku) number. The printed Chinese margin of every page was read by eye: section, volume and folio agree with the Ligeti location on all 10.
- **Tibetan parallel:** all 10 Derge volumes are among the 53 that passed alignment in #5665. The Tibetan is the Esukhia e-text (commit `a582cf471b`). The passage was located proportionally: the Mongolian folio's position within the Ligeti span maps to a side within the Derge span (`derge-targets.json`). The four opening pages fall on the Derge side that opens the same text.
- **Flash, arm "production":** `gemini-3-flash-preview` with OCR prompt v19.1 (`9d8f959e`) as the orchestrator builds it (language auto-detect), temperature 0.1, thinking 0, realtime. Each read was then translated by Flash with translation prompt v13 through translate-core `buildTranslationPrompt`, with no title, neighbours or previous page.
- **Flash, arm "hinted" (beyond the brief, labelled):** the same prompt, with only its `{language_instruction}` slot filled: Classical Mongolian, Uighur-Mongol vertical script, woodblock, "NOT Manchu", columns read left to right. This was added because the pilot's Flash reads evidently had a language hint and production has none.
- **CrossLing-OCR-Mini:** `NCUTNLP/CrossLing-OCR-Mini` rev `4cd6067ab9aa`, a GOT-OCR2 architecture with ~580M params. The HF tag says apache-2.0; the README says "research and academic purposes only". Run on Hetzner CPU in float32, plain `ocr` mode, 512 new tokens. The arm was stopped, as the brief says, after 3 pages plus one rotated input, all unreadable.
- **Columns:** counted by an ink-projection profile (pitch ~48 px at 2000 px width on ordinary leaves, ~63 px on decorated openings), checked by eye on 4 pages: 31 per side on ordinary leaves, 22–23 on decorated openings.

| vol · folio | text (Tōh · Ligeti) | cols | Flash prod | Flash hinted | CrossLing | meaning, prod / hinted |
|---|---|---:|---|---|---|---|
| 1 · 280a | D417 Hevajra · Mng1.9 | 31 | 0 ("Manchu", not transcribed) | 0 (one sentence ×25) | Tibetan loop | unreadable / unreadable |
| 5 · 150a | D442 Guhyasamāja · Mng1.80 | 31 | 0 ("Manchu", not transcribed) | 0 (loop) | — | unreadable / unreadable |
| 11 · 224a | D501 Vajrapāṇi-nīlāmbara · Mng1.133 | 31 | 0 ("Manchu" loop, cap) | 0 (Prajñāpāramitā loop) | — | unreadable / wrong text |
| 47 · 193a | D16 Vajracchedikā · Mng1.771 | 31 | 0 ("Manchu" loop, cap) | 0 (Śāriputra dialogue; the sūtra is to Subhūti) | Tibetan loop (also rotated) | unreadable / wrong text |
| 49 · 3a (label says 2a) | D50 Akṣobhyavyūha · Mng1.797 | 22 | 0 (not transcribed) | 0 ("and other Buddhas and Bodhisattvas" ×22) | — | unreadable / unreadable |
| 61 · 2a | D95 Lalitavistara · Mng1.850 | 23 | 0 ("Manchu" loop) | 0 ("I prostrate to the Buddha Teacher" ×20) | — | unreadable / unreadable |
| 66 · 2a | D113 Saddharmapuṇḍarīka · Mng1.868 | 23 | 0 (loop, cap) | 0 (bodhisattva-path loop, no names) | — | unreadable / unreadable |
| 77 · 392a | D200 Lokānusamāvatāra · Mng1.956 | 31 | 0 ("Manchu" loop) | 0 ("All became joyful" ×) | — | unreadable / unreadable |
| 87 · 393a | D300 Kalyāṇamitrasevana · Mng1.1060 | 31 | 0 ("Manchu" loop, cap) | 0 (rays-of-light litany) | — | unreadable / wrong text |
| 98 · 3a | D2 Prātimokṣa · Mng1.1130 | 31 | 0 (not transcribed) | 0 (sitting rules, which close the text, looped) | Tibetan loop | unreadable / same text, wrong passage |

**Readings.**
- **The hinted arm's English is the dangerous part.** On 4 pages it is fluent, on-genre and wrong. For example, the Diamond Sūtra page comes back as a Śāriputra dialogue on the designation "bodhisattva", and the Prātimokṣa page as śaikṣa rules. A reader without the Tibetan beside it would take these for a translation. This is the pilot's "misidentified a Tantra page as Prajñāpāramitā", generalised: Flash writes what a page of this section usually says.
- **The pilot's "26/26 columns" was a count of emitted lines.** Ordinary leaves here carry 31 columns. Emitted line counts measure nothing on this script; the hinted arm emitted 25 lines for 31 columns on vol 1 and every one was the same sentence.
- **What did read correctly:** the Chinese margins. The production arm read them exactly on 5 pages, with one character wrong on a 6th. The hinted arm misread several, and once called the book "Tanjur".
- **Side finding:** vol 49's first text leaf is printed 3a and stored as `f. 2a`. That is a one-leaf label drift at the start of a volume that is not in #5732's drift table. It is reported on #5664, not fixed here.

**Consequence.** A character-level reference (a Mongolist, or IMU's data) would score Flash at about zero, so it is not worth commissioning to *score Flash*. A reference is still the prerequisite for any *trained* recogniser (Kraken line model, or a fine-tuned VLM on the Manchu-OCR template). That is a different and larger decision, and it is Derek's.

*Replicated?* No. One read per page per arm, temperature 0.1. The failure is uniform across 10 volumes and two prompts, so a rerun is unlikely to change the verdict.

**Spend:** $0.56 computed (41 Flash calls), GPU $0 (CPU). **Nothing written to Mongo.**

Artifacts: `scripts/eval/results/mongol-ocr-probe-5664/` (`pages.json`, `flash/`, `flash-hinted/`, `crossling/`, `derge-targets.json`, `verdicts.json`, `spend.jsonl`); scripts `scripts/eval/mongol-ocr-probe-5664.mjs` and `scripts/eval/mongol-ocr-probe-5664-crossling.py`.
