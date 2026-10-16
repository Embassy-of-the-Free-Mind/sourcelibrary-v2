---
stage: ocr
measure: judged_vs_reference
languages: [mn]
scripts: [Mong]
canons: [mongolian-kanjur]
n_books: 10
n_pages: 10
verdict: "Neither Gemini 4 Argon (low, high) nor Opus reads the Mongolian Kanjur: 0 of 10 pages match the Derge parallel on any of 8 arm×prompt reads; Argon writes fluent wrong text, Opus declines every page."
status: rejected
decision: "No $0 CLI reader for the 83K Mongolian pages; the 2026-10-04 verdict stands, and a trained recogniser remains Derek's separate decision (#5664)"
superseded_by: null
issue: 5664
---
## 2026-10-16 · Can Gemini 4 Argon or Opus read the Mongolian Kanjur? Same 10 pages as the 2026-10-04 probe (#5664)

PRIOR ART: `2026-10-04-mongol-kanjur-ocr-probe-5664.md` (same pages, same hint, Flash and CrossLing; reused: `pages.json`, `derge-targets.json`, `verdicts.json`); `scripts/batch/cli-ocr.mjs` / `scripts/lib/agy-cli.mjs` (the agy call, used); `scripts/batch/claude-ocr.mjs` (the sealed `claude -p` call, copied).

**Answer: no.** Gemini 4 Argon was released on 2026-10-13, after the first probe; Opus had never been tried. Neither reads the script. Every arm, with either prompt, matched the Derge Tibetan on **0 of 10** pages. The gate was 5 of 10 with no loops.

- **Argon, production prompt:** it declines most pages, with an honest "N vertical lines … not transcribed". Low declined 7 of 10 and high 7 of 10. Where it does write, it writes the wrong text.
- **Argon, hinted prompt:** it writes Mongolian-script columns on every page it returns, about one emitted line per column on the image. The English is fluent and on-genre, and it is the wrong text on 8 of 10 pages for both low and high. This is the 2026-10-04 Flash failure again, in a stronger model. On the Diamond Sūtra page, for example, Argon-low writes the Buddha speaking to **Śāriputra** about emptiness, signlessness and wishlessness. The 2026-10-04 Flash read made the same Śāriputra substitution; the sūtra is addressed to Subhūti.
- **Opus:** it declines all 40 reads (2 prompts, then again on full-resolution strips) and invents nothing. On 7 of 10 hinted reads it also claims the image is rotated 90°. It is not: the columns are upright, which I checked by eye at full resolution. Without the hint, it calls the script Manchu on 5 of 10 pages.

**What improved since Flash.** Argon names the language correctly without a hint: Mongolian on 19 of 20 reads, where Flash said Manchu on 7 of 10. Argon-low also reads some Mongolian margin labels plausibly, for example *bilig-ün činar-tur kürügsen nigedüger boti* on the Prajñāpāramitā page. The body text, the part that matters, is not read.

**The one near-miss, and why it is not a read.** On v049 (Akṣobhyavyūha, D50, a decorated opening leaf), Argon-high with the production prompt emitted 21 lines. They are the sūtra opening and the arhat-epithet formula, which follow Derge 1b in order: "conquered the foe, outflows exhausted, … like a thoroughbred horse, like a great elephant, burden laid down…". The monk count is wrong (1,800 where the Tibetan has 1,250). The Opus judge said *partial* and the Flash judge *wrong text*. I broke the tie as **wrong text**, for three reasons:
- The formula is stock: it opens hundreds of sūtras.
- The same model, given the hinted prompt, read the same page as a *different* opening. That read has a Ratnakūṭa-2 title, 1,250 monks and no epithets.
- Both reads name the text that the Chinese margin's 大寶積經第二卷 ("Ratnakūṭa vol. 2") would suggest.

Two incompatible "reads" of one leaf are recall from the margin, not reading. Character-level confirmation would need a Mongolist.

**Design.**
- **Pages:** the 10 pages of the 2026-10-04 probe (vols 1, 5, 11, 47, 49, 61, 66, 77, 87, 98). The images are the archived scans, `images.sourcelibrary.org/pages/<book_id>/<page>.jpg`, 5031–5120 px wide. Column counts are from the 2026-10-04 ink profile.
- **Arms,** one page per call:
  - A: `gemini-4-argon-low` via `agy -p`, in plan mode with the #6523 tool gate and the image attached as `@file`.
  - B: `gemini-4-argon-high`, the same way.
  - C: `claude -p --model opus --restricted --tools Read`.
  - C′ *(beyond the brief, labelled)*: Opus again, on 4 overlapping full-resolution vertical strips of the page. The Read tool shrinks a 5,000 px leaf, and Opus's first refusals blamed resolution.
- **Prompts:** the live OCR prompt, auto-detect (`liveOcrPrompt`), and the same prompt with the 2026-10-04 hint in `{language_instruction}`: Classical Mongolian, Uighur-Mongol vertical script, NOT Manchu, columns left to right. Each read was translated by the same arm with the live translation prompt (`buildTranslationPrompt`, no context; the agy translation ran through `gatedTextCall`).
- **Argon-high timeouts:** on the hinted prompt, argon-high hit agy's 300 s print limit on most pages and returned nothing. Its timed-out pages were re-run at 900 s (recorded in each read as `ocr.print_timeout`). Two pages, v047 and v061, still timed out after 3 calls each and count as *unreadable*.
- **Reference:** the Derge Tibetan, from the Esukhia e-text, 2–4 sides around the 2026-10-04 proportional target (`derge-passages.json`).
- **Judges:** a sealed `claude -p --model opus` and `agy gemini-3.8-flash-high`. Each saw only the Tibetan and the English and gave a verdict: matches / partial / wrong text / unreadable. Under the rubric, stock formulas do not count as a match.
  - The judges agreed on 77 of 80 reads. I broke the 3 disagreements by reading both (`tiebreaks.json`).
- **False-alarm control:** three fluent reads, the v049 near-miss among them, each paired with the wrong page's Derge passage. Both judges called all 3 *wrong text*.
- **Loops:** one line or 6-word run repeated more than 3 times, in the read or in its English.
- **Script:** characters in U+1820–1842 (Mongolian), U+1843–18AA (Todo/Sibe/Manchu letters), and Tibetan. No arm emitted Tibetan as its body text. Argon-high emitted Manchu-block letters on 1 read.

Each cell gives Mongolian-script lines emitted · script · loop / T/O = timeout · Opus judge / Flash judge (M matches, P partial, W wrong text, U unreadable):

| page (cols) | argon-low prod | argon-low hint | argon-high prod | argon-high hint | opus prod | opus hint | opus-tiles prod | opus-tiles hint |
|---|---|---|---|---|---|---|---|---|
| v001_f280a (31) | 0 · — loop · W/W | 33 · Mong · U/W | 0 · — · U/U | 26 · Mong · W/W | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U |
| v005_f150a (31) | 0 · — · U/U | 30 · Mong loop · U/W | 0 · — · U/U | 32 · Mong · W/W | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U | 1 · — · U/U |
| v011_f224a (31) | 2 · Mong · U/U | 29 · Mong loop · W/W | 2 · Mong+Manchu · U/U | 30 · Mong · W/W | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U |
| v047_f193a (31) | 2 · Mong · U/U | 30 · Mong loop · W/W | 0 · — · U/U | 0 · — T/O · U/U | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U |
| v049_f2a (22) | 2 · Mong loop · U/U | 18 · Mong+Tib · W/W | 21 · Mong · P/W | 19 · Mong · W/W | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U |
| v061_f2a (23) | 0 · — · U/U | 22 · Mong · W/W | 24 · Mong loop · W/W | 0 · — T/O · U/U | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U |
| v066_f2a (23) | 24 · Mong · W/W | 23 · Mong · W/W | 1 · Mong · U/U | 23 · Mong · W/W | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U |
| v077_f392a (31) | 0 · — · U/U | 29 · Mong · W/W | 1 · Mong · U/U | 27 · Mong · W/W | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U | 3 · Mong · U/U |
| v087_f393a (31) | 0 · — loop · W/W | 25 · Mong · W/W | 26 · Mong · W/W | 27 · Mong loop · W/W | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U |
| v098_f3a (31) | 0 · — · U/U | 28 · Mong loop · W/W | 0 · — · U/U | 29 · Mong · W/W | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U | 0 · — · U/U |
| **final, after tie-breaks** | 0 M · 3 W · 7 U | 0 M · 8 W · 2 U | 0 M · 3 W · 7 U | 0 M · 8 W · 2 U | 0 M · 10 U | 0 M · 10 U | 0 M · 10 U | 0 M · 10 U |
| loops | 3 | 4 | 1 | 1 | 0 | 0 | 0 | 0 |

"Lines emitted" is not "columns read". No emitted line was confirmed to correspond to its column on any page, so every arm reads 0 columns.

**Positive control: the Chinese margin.** Within one character of the by-eye reading, Argon got it on 10, 10, 10 and 8 of 10 pages (low prod, low hint, high prod, high hint), exact on 5–7. Opus got it on 5–9 of 10, exact on 4–6. On v049, both Argon-high reads and the scan at overview size give 上二. The 2026-10-04 by-eye note says 上三, so that page's "exact" may be undercounted. In short, the models see the leaf and read its Chinese; what they cannot read is the Mongolian.

**Consequence.** There is no $0 CLI reader for the 83K Mongolian pages. Argon's hinted English is the dangerous output: it is fluent, it is on-genre, and a reader would take it for a translation of the page. The 2026-10-04 conclusion stands. A trained recogniser needs a character-level reference first. That is Derek's separate decision, unchanged by this run.

*Replicated?* No: one read per page per arm and prompt. The failure is uniform across 3 models, 2 prompts and 10 volumes, so a rerun is unlikely to change it.

**Spend:** $0. The Argon reads and the Flash judge ran on the agy subscription, logged to `/var/log/sourcelibrary/agy-calls.jsonl` under job `mongol-argon-5664`; the Opus reads and judge ran on the Claude subscription. About 350 calls in total. **Nothing was written to Mongo.**

**Artifacts:** `scripts/eval/results/mongol-argon-probe-5664/`, which holds:
- one JSON per page per arm×prompt, with the read, its English and the prompt refs;
- `derge-passages.json`, `judge-opus.json`, `judge-flash.json` (including the `control:` rows), `tiebreaks.json`, `scores.json`.

Script: `scripts/eval/mongol-argon-probe-5664.mjs` (`read` / `judge` / `score`).
