---
stage: ocr
measure: judged
languages: [la, en, grc, zh, de, it, sa]
scripts: [Latn, Grek, Hani, Deva]
canons: []
n_books: 22
n_pages: 32
verdict: "Candidate OCR prompt v19.2-margin (#8567) FAILS its pre-declared bar on two of three clauses. Margin type right on 69/90 margin notes (77%, bar 85%), but when it typed a note it was never wrong (69/69; live v19.1 types 0/90): the 21 misses are notes it dropped, ran into the body or put in another tag, which live does on 26/90. Footnotes/apparatus in <footnote> 20/23 (87%, bar 80%; live 0/23). Body-defect pages 18 vs 15 of 32 (bar B <= A, one page of noise): the extra defects sit on footnote pages (6 vs 3 of 9). There it doubles footnote text inline and at the foot (Thibaut p.5, 2 of 4 reads), and it drew a recitation-filter refusal on Burton p.410 in 4 of 4 reads (live failed that page 2 of 4, differently). The blind Opus judge preferred it on 23 of 32 pages (live 8, same 1)."
status: rejected
decision: "v19.2-margin is not installed. A v19.3 candidate should (1) say the footnote's reference mark stays in the body and its text appears ONLY at the end, and (2) be re-tested on these 32 pages with read repeats on the footnote stratum. The --prompt-file option of scripts/batch/cli-ocr.mjs (this PR) makes that a one-command arm. No page was written: B's reads carry <footnote> and attributed <margin> tags that the production reader does not yet render (#8593 open)."
feeds: "prompt"
supersedes: []
superseded_by: null
issue: [8567]
router_evidence: "none — a prompt-version test on the live OCR route (agy gemini-3.8-flash-low), not a route comparison; the prompt is shared by every OCR lane"
defect_rates: "none — the brief's bar counts body-defect PAGES per arm on shared pages (pre-declared); defect-rate.py's per-1,000-word rule is a route-cell rule and this is not a route question"
---
PRIOR ART: `scripts/eval/experiments/` has two earlier "v19.2" OCR tests (#7263, PRs #8379, #8389, `scripts/eval/route-judge-6740/ocr-v192-7263/`, `prompts/ocr/standard-ocr-v19-2-candidate.md`). That is a DIFFERENT v19.2 (it offers musical-score and table page types), also not promoted. This one only changes the margin, footnote and note lines. To avoid the clash this file calls it **v19.2-margin**. No earlier test asked whether OCR can tell printed from handwritten margins.

## 2026-11-11 · Can the OCR prompt tell an edition's side notes from a reader's hand, and give footnotes a tag? (#8567)

**Who it is for.** A member's research assistant read Burton's printed side notes and Burnet's apparatus as a reader's annotations, because the OCR puts both in one `<margin>` tag and has no tag for footnotes (#8567). A researcher quoting a page needs to know whether a note belongs to the edition or to one copy.

**Design.** Prompt question. Arms: A = live `Standard OCR` v19.1 (`6ac02220413a82637da889bb`, md5 `9d8f959e…`); B = the candidate (`scripts/eval/route-judge-6740/results/ocr-margin-type-8567/candidate-prompt-ocr-v19.2.txt`, md5 `ed62c6854c6a0e8f078bb287882f1949`), sent with the new `cli-ocr.mjs read --prompt-file`. Same route: agy gemini-3.8-flash-low, one page a call, the same cached image bytes (`--image-cache`), `--fresh`. Cost: $0 (subscription CLI, 64 + 12 reads; 39 Opus judge calls). Judge: Opus 5.5 through `claude -p` (judge.mjs `opusCall`, Read only), one call a PAGE. Each call shows the image and both reads as X/Y in seeded order. The judge (1) lists the page's margin notes, footnotes and apparatus from the image, printed or handwritten, and says how each read tagged each one, then (2) scores each read's body text (accept, fidelity, taxonomy defects), then (3) says which it would publish. Driver: `scripts/eval/margin-type-8567/judge-pairs.mjs`. Controls: 2 wrong-page calls (both refused, fidelity 1/1/1/1) and 5 pages judged again with X/Y swapped (noise floor). Recipe check: `paired-arm.mjs check` passed, with R1 waived because the brief fixed the pages (several pages per book). **Blindness caveat:** X/Y hide the arm's name, but B's `type="…"` attributes and `<footnote>` tags show which read came from the candidate prompt. The tagging score cannot be blind. The body-defect score is the one blindness protects, and it is scored separately.

**Pass bar (stated in the brief before any read).** B types printed/handwritten right on ≥ 85% of margin notes; B puts ≥ 80% of footnotes/apparatus in `<footnote>`; B has no more body-defect pages than A (a one-page difference is noise at n = 32).

### Result

| clause | B (v19.2-margin) | A (live v19.1) | bar | |
|---|---|---|---|---|
| margin notes typed right / all margin notes | **69/90 (77%)** (printed 44/59, handwritten 25/31) | 0/90 (64 untyped `<margin>`, 26 not in a margin tag) | ≥ 85% | **FAIL** |
| typed WRONG (printed called handwritten or back) | 0/69 | n/a | — | |
| margin notes not in a margin tag (dropped / body / other tag) | 21/90 (6 / 3 / 12, the 12 all `<gloss>` on Zhuangzi) | 26/90 (15 / 3 / 8) | — | |
| footnotes + apparatus in `<footnote>` | **20/23 (87%)**; 10/10 apparatus items typed `apparatus` | 0/23 (22 in body, 1 dropped) | ≥ 80% | **PASS** |
| pages with a body-text defect (misleads or wrong_text, O12 excluded) | **18/32** | 15/32 | B ≤ A (+1) | **FAIL** |
| pages with wrong_text | 11/32 | 9/32 | — | |
| accept (body) | 26/32 | 27/32 | — | |
| judge would publish | 23 | 8 (same 1) | — | |

By stratum (body-defect pages A → B; judge prefers B / A): printed 7 → 7 (12/1), **footnote 3 → 6 (6/3)**, handwritten 4 → 3 (5/1), control 1 → 2 (0/3).

**What the misses are.** The margin clause fails on capture, not on typing. Every note v19.2-margin put in `<margin>` carried the right type (69/69), and the live prompt drops or mis-files more notes (26 against 21). The 85% bar, as written, counts a dropped note as a wrong type, so it fails. Twelve of B's 21 misses are the interlinear 旁注 of *Zhuangzi pangzhu* (scans 88–89), which B put in `<gloss>`. The prompt defines that tag as "interlinear annotations", so this is arguably the right tag and not a miss. Five are running line numbers in Clement and Bekker that were dropped. The rest are single notes. Counting `<gloss>` for interlinear notes as correct gives 69/78 (88%), but that reading was not stated before the run, so the clause is recorded as failed. The verdict does not depend on it: the body-defect clause fails either way. The judge called scan 89's interlinear notes handwritten (5) and scan 88's printed (7). Nobody checked that by eye.

**Where the body defects come from.** Three of B's extra defect pages are footnote pages:
- **Footnotes written twice.** Thibaut SBE 34 p.5: B puts each footnote's text at its reference mark AND again at the foot (judge: "prints every footnote twice"). Re-read 3 more times: 1 of 3 doubles again (2 of 4 in all); live never does (0/4). The prompt says "at the END of the page" but never says the reference mark stays in the body and the text goes ONLY at the end.
- **Recitation refusal.** Burton p.410 (scan 506): B's read was refused by the CLI's recitation filter ("unable to transcribe the full verbatim text…"). `cli-ocr.mjs` flags such a read (`chatter: refusal or summary`), so apply would never write it, but it scores as a defect page. Re-read 3×: B refused 3/3, A failed 2/3 another way (`restarted read`). So Burton is unstable under both prompts, and the refusal shape may be worse under B. n = 4 cannot separate that from chance.
- Bekker Politics p.1268: two Greek misreads in B's body (ἀπορήσειε γάρ τινες, γεωργήσιν) that A reads right.
Leaving out the three pages whose reads cli-ocr refuses to write (Burton 116 and Thibaut 4 both arms, Burton 410 B): body-defect pages 13 (A) vs 15 (B) of 29. That is still one page over the noise allowance.

**Noise floor.** The judge was given the same two reads twice with X/Y swapped, on 5 pages. Accept flipped on 1 of 10 arm-rows (Stephanus p.271, live read), the preferred read never changed (5/5), and the margin item count never changed (5/5). Read-to-read variance of the MODEL (not the judge) is large on two pages (above). This test has one read per arm per page, so a 3-page body-defect gap is about the size of that variance. The fix for the doubling is a wording change in any case.

### Three example pairs

1. **Burnet, Plato OCT, Republic VI (scan 259, `699376d2b0a84a5763961b9a`).** A runs the critical apparatus into the body and leaves line numbers as bare `<margin>5</margin>`. B: `<margin type="printed">` for the Stephanus/line numbers and `<footnote type="apparatus">c 7 φήσειν A²FDM : φησιν A</footnote>` per entry. Judge prefers B: "tags the apparatus as apparatus and types the margins".
2. **Quaestiones de tribus principiis, 1490 (scan 31, `69dc5574cb6f7429748b8c25`).** Seven red-ink annotations by a reader. A drops 4 and leaves 3 untyped. B: all seven `<margin type="handwritten">` (e.g. `Materia et forma sunt entitates truncatae :`), and fewer sense-changing misreads. Judge prefers B.
3. **Thibaut, SBE 34 Vedânta-sûtras p.5 (scan 137, `699246b7bc722ec0ee811c57`), the failure.** A: clean body, footnotes untagged at the foot. B: `…superimposed<footnote>This is the definition of the akhyâtivâdins.</footnote>. Others<footnote>…`, then the same four footnotes again at the end. Judge prefers A: "prints every footnote twice". Stable across the judge repeat.

### Per-page verdicts

`serious` = defects of severity misleads or wrong_text, not counting O12 (margin tagging, scored separately). Raw judge replies: `scripts/eval/route-judge-6740/results/ocr-margin-type-8567/judge-raw.jsonl.gz`. Tallies: `scripts/eval/route-judge-6740/results/ocr-margin-type-8567/tally.json`. Reads: `scripts/eval/route-judge-6740/results/ocr-margin-type-8567/reads/`.

| call | stratum | page id | items | judge prefers | A accept/fid/serious | B accept/fid/serious | B tagging |
|---|---|---|---|---|---|---|---|
| c01 | printed | `6990656f3dc2ed39a49f10f1` | 3 | B | False/2/4 | False/2/7 | margin_printed×3 |
| c02 | printed | `6990656f3dc2ed39a49f10f2` | 3 | B | True/5/0 | True/5/0 | margin_printed×3 |
| c03 | printed | `6990656f3dc2ed39a49f1148` | 5 | B | True/4/0 | True/5/0 | margin_printed×5 |
| c04 | printed | `6990656f3dc2ed39a49f1219` | 5 | A | True/5/0 | False/2/7 | margin_printed×4, dropped×1 |
| c05 | printed | `69b21d4addb4fa7c305b4ba5` | 2 | B | True/4/3 | True/4/2 | margin_printed×2 |
| c06 | printed | `6952c9ca77f38f6761bc3164` | 13 | B | False/2/6 | False/3/5 | margin_handwritten×7, margin_printed×5, body×1 |
| c07 | printed | `697e011d9e279b718ba6570e` | 1 | B | True/4/2 | True/5/0 | margin_printed×1 |
| c08 | printed | `69f6ecc3a26f03d5b09f74d8` | 7 | B | True/4/1 | True/5/0 | margin_printed×6, body×1 |
| c09 | printed | `69e72c60a409200ea79f474e` | 8 | B | True/4/1 | True/5/0 | other_tag×7, dropped×1 |
| c10 | printed | `69e72c60a409200ea79f474f` | 5 | B | False/2/2 | False/3/2 | other_tag×5 |
| c11 | printed | `69924f1ba1a76e4d5e5eda1e` | 1 | B | True/5/0 | True/5/0 | margin_printed×1 |
| c12 | printed | `69942a51045dfc482ad7679c` | 4 | B | True/4/0 | True/4/1 | dropped×1, margin_printed×1, footnote×1, footnote_apparatus×1 |
| c13 | printed | `69942a51045dfc482ad7679d` | 4 | B | True/4/0 | True/4/1 | dropped×1, margin_printed×1, footnote_apparatus×2 |
| c14 | footnote | `699376d2b0a84a5763961b53` | 2 | B | True/5/0 | True/4/0 | margin_printed×1, footnote_apparatus×1 |
| c15 | footnote | `699376d2b0a84a5763961b99` | 2 | B | True/5/0 | True/4/1 | margin_printed×1, footnote_apparatus×1 |
| c16 | footnote | `699376d2b0a84a5763961b9a` | 2 | B | True/5/0 | True/5/0 | margin_printed×1, footnote_apparatus×1 |
| c17 | footnote | `69af4521e9a2e38648e40136` | 4 | B | True/5/0 | True/5/1 | margin_printed×2, footnote×1, footnote_apparatus×1 |
| c18 | footnote | `69af4521e9a2e38648e40137` | 4 | B | True/4/1 | True/5/0 | margin_printed×2, footnote×1, footnote_apparatus×1 |
| c19 | footnote | `69937973b0a84a5763964f27` | 2 | A | True/4/0 | True/3/2 | dropped×1, footnote_apparatus×1 |
| c20 | footnote | `69937973b0a84a5763964f28` | 3 | B | True/4/1 | True/4/1 | dropped×1, body×1, footnote_apparatus×1 |
| c21 | footnote | `699246b7bc722ec0ee811c56` | 5 | A | False/2/4 | False/2/4 | body×1, footnote×3, dropped×1 |
| c22 | footnote | `699246b7bc722ec0ee811c57` | 5 | A | True/5/0 | False/3/1 | body×1, footnote×4 |
| c23 | handwritten | `69dc5574cb6f7429748b8c25` | 7 | B | False/3/3 | True/4/1 | margin_handwritten×7 |
| c24 | handwritten | `69dbcab51040d1d5e20ae484` | 1 | A | True/4/1 | True/4/2 | margin_handwritten×1 |
| c25 | handwritten | `6a8b76ef313cdd0126cb79b6` | 3 | B | True/5/0 | True/5/0 | margin_handwritten×3 |
| c26 | handwritten | `69f70aedb8f2207734053a50` | 5 | B | True/4/1 | True/4/0 | margin_printed×5 |
| c27 | handwritten | `6a4a84da449c2c48ca6ee012` | 1 | B | True/4/0 | True/5/0 | margin_handwritten×1 |
| c28 | handwritten | `69dbc9291040d1d5e20a0fd2` | 6 | B | True/4/1 | True/4/1 | margin_handwritten×6 |
| c29 | control | `6ab7a0fb0bd1885e1dedc2ca` | 0 | A | True/5/0 | True/4/0 | — |
| c30 | control | `6a94037ca4ad12cb35ec7821` | 0 | same | True/4/0 | True/4/0 | — |
| c31 | control | `69bda131f6d63c919748eae8` | 0 | A | True/5/0 | True/4/2 | — |
| c32 | control | `6a060d36e16c60cb2a8947e2` | 0 | A | True/4/4 | True/4/7 | — |

### Page list (fixed 2026-11-11, before either arm ran)

32 pages, 22 books. Strata and expected tags as the brief set them; the handwritten six are the first six by-eye-confirmed pages of a seeded (8567) shuffle of 693 visible-book pages whose stored OCR has `<script>mixed</script>` and a `<margin>` (one skipped: Būstān 1875 p.118, lithographed commentary, not a reader's hand). Controls: the first four of a seeded `$sample` of printed text pages with no margin/note/footnote markup, one skipped by eye (De scriptoribus ecclesiasticis p.70 has printed section letters in the margin).

| # | stratum | book | scan | page id |
|---|---|---|---|---|
| 1 | printed | Burton, Anatomy of Melancholy 1621 (`6990656f3dc2ed39a49f101f`) | 210 | `6990656f3dc2ed39a49f10f1` |
| 2 | printed | Burton, Anatomy of Melancholy 1621 (`6990656f3dc2ed39a49f101f`) | 211 | `6990656f3dc2ed39a49f10f2` |
| 3 | printed | Burton, Anatomy of Melancholy 1621 (`6990656f3dc2ed39a49f101f`) | 297 | `6990656f3dc2ed39a49f1148` |
| 4 | printed | Burton, Anatomy of Melancholy 1621 (`6990656f3dc2ed39a49f101f`) | 506 | `6990656f3dc2ed39a49f1219` |
| 5 | printed | Stephanus Plato 1578 vol 3 (`69b21d4addb4fa7c305b4a88`) | 285 | `69b21d4addb4fa7c305b4ba5` |
| 6 | printed | Plotinus, Perna 1580 (`6952c9ca77f38f6761bc3062`) | 258 | `6952c9ca77f38f6761bc3164` |
| 7 | printed | Kepler, Harmonices mundi 1619 (`697d9ca2e930671f09614566`) | 385 | `697e011d9e279b718ba6570e` |
| 8 | printed | Croll, Basilica chymica (`69c7f8b46c6f3cc53c842434`) | 472 | `69f6ecc3a26f03d5b09f74d8` |
| 9 | printed | Zhuangzi pangzhu 1699 (`69e72c60a409200ea79f46f6`) | 88 | `69e72c60a409200ea79f474e` |
| 10 | printed | Zhuangzi pangzhu 1699 (`69e72c60a409200ea79f46f6`) | 89 | `69e72c60a409200ea79f474f` |
| 11 | printed | Hesiod Loeb (`69924f1aa1a76e4d5e5ed9e2`) | 60 | `69924f1ba1a76e4d5e5eda1e` |
| 12 | printed | Clement GCS (`69942a51045dfc482ad766f4`) | 168 | `69942a51045dfc482ad7679c` |
| 13 | printed | Clement GCS (`69942a51045dfc482ad766f4`) | 169 | `69942a51045dfc482ad7679d` |
| 14 | footnote | Burnet Plato OCT 1902 (`699376d2b0a84a5763961a97`) | 188 | `699376d2b0a84a5763961b53` |
| 15 | footnote | Burnet Plato OCT 1902 (`699376d2b0a84a5763961a97`) | 258 | `699376d2b0a84a5763961b99` |
| 16 | footnote | Burnet Plato OCT 1902 (`699376d2b0a84a5763961a97`) | 259 | `699376d2b0a84a5763961b9a` |
| 17 | footnote | CSEL 56 (`69af4521e9a2e38648e400aa`) | 140 | `69af4521e9a2e38648e40136` |
| 18 | footnote | CSEL 56 (`69af4521e9a2e38648e400aa`) | 141 | `69af4521e9a2e38648e40137` |
| 19 | footnote | Bekker 1831 vol II (`69937973b0a84a5763964d43`) | 484 | `69937973b0a84a5763964f27` |
| 20 | footnote | Bekker 1831 vol II (`69937973b0a84a5763964d43`) | 485 | `69937973b0a84a5763964f28` |
| 21 | footnote | Thibaut SBE 34 (`699246b7bc722ec0ee811bcd`) | 136 | `699246b7bc722ec0ee811c56` |
| 22 | footnote | Thibaut SBE 34 (`699246b7bc722ec0ee811bcd`) | 137 | `699246b7bc722ec0ee811c57` |
| 23 | handwritten | Quaestiones de tribus principiis rerum naturalium. With addi (`69dc5574cb6f7429748b8c06`) | 31 | `69dc5574cb6f7429748b8c25` |
| 24 | handwritten | Speculum conscientiae et novissimorum (`69dbcab51040d1d5e20ae47a`) | 10 | `69dbcab51040d1d5e20ae484` |
| 25 | handwritten | Die Pilzthiere oder Schleimpilze, nach dem neuesten Standpun (`6a8b76ef313cdd0126cb79af`) | 7 | `6a8b76ef313cdd0126cb79b6` |
| 26 | handwritten | Kirchen- oder Haus-Postill, über die Sonntags- und fürnehmst (`69c853c66c6f3cc53c8536f2`) | 116 | `69f70aedb8f2207734053a50` |
| 27 | handwritten | Quaestionem Politicam Num In Extraneum Principem Committatur (`6a4a84da449c2c48ca6ee011`) | 1 | `6a4a84da449c2c48ca6ee012` |
| 28 | handwritten | Orationes. Ed: Philippus Beroaldus. Add: Janus Cardo Bononie (`69dbc9291040d1d5e20a0eef`) | 227 | `69dbc9291040d1d5e20a0fd2` |
| 29 | control | Universal Brotherhood Path, Vol. 15, No. 2 (May 1900) (`6ab7a0fb0bd1885e1dedc2bc`) | 12 | `6ab7a0fb0bd1885e1dedc2ca` |
| 30 | control | Deliciae Hortenses. Das ist: Blumen- Artzney- Kuchen- und Ba (`6a94037ca4ad12cb35ec76d4`) | 333 | `6a94037ca4ad12cb35ec7821` |
| 31 | control | Lucii Apuleii ... Opera (`69bda131f6d63c919748e9d3`) | 277 | `69bda131f6d63c919748eae8` |
| 32 | control | सुश्रुतसंहिता Suśruta Saṃhitā (Sanskrit, Acharya critical ed (`6a060d36e16c60cb2a8946c7`) | 283 | `6a060d36e16c60cb2a8947e2` |

### What happens next

- Not installed; `is_default` untouched. A v19.3 candidate needs a sentence like "Leave the footnote's reference mark (¹, *, a) where it is printed in the body; write the footnote's TEXT only once, in a <footnote> at the end." It also needs an answer on whether marginal line and Stephanus numbers belong in `<margin type="printed">` (the brief says yes) or in `<page-num>`. Re-run this page list with `--prompt-file`, with 3 reads per arm on the 9 footnote pages.
- No page was written. Twelve pages met "judge prefers B, B accepted, no serious body defect" (`scripts/eval/route-judge-6740/results/ocr-margin-type-8567/apply-ids.json`). They were not applied, because production's reader matches only an untyped `<margin>` and has no `<footnote>` (#8593, open). Those tags would reach readers as untidy markup. Once #8593 is in production, the same reads can be applied from this directory (the apply guards refuse any page whose OCR changed since 2026-11-11).

### Replicated?

No. One read per arm per page, one judge family (Opus). The footnote doubling was reproduced on re-reads (2/4), and the Burton refusal 4/4.
