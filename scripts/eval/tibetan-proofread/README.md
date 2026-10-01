# Tibetan same-edition proofread set (#4523)

<!-- PRIOR ART: scripts/eval/ground-truth/ (reference-text GT files from published e-texts) — those are another edition's text; this set is a human correction of the same leaf, which is the point. -->

**The question.** The Yigdzin read of the British Library's Bhutanese Kangyurs scores **0.947** syllable identity
against the Derge e-text (10-01 re-draw; 0.950 on 09-30), and a Derge page with 5% synthetic noise scores 0.968.
Part of the gap is edition variance: a Bhutanese manuscript is not the Derge woodblock, so a perfect read of it
still disagrees with Derge. Nobody can say how much. A human correction of the *same leaf* removes the edition from
the measurement: identity of the served text against the reader's correction is the read's true accuracy. The
answer decides whether "0.947 vs Derge" means about 0.97 or about 0.99.

## The set

`scripts/eval/results/tibetan-proofread-2026-10/manifest.jsonl` — 30 leaves from 30 books, drawn by `draw.mjs`
(seed 20261003) from the bl-kanjur pages already scored in the 09-30 and 10-01 Derge draws, keeping pages whose
Derge identity is in [0.90, 0.97] (ordinary pages, not the tails; drawn set 0.904–0.969, median 0.948) and whose
served text is byte-identical to the text that was scored (78 of 78 were). 10 leaves carry a marked leaf seam
(`<leaf-break/>`), 20 do not. **By eye, every BL Kangyur frame checked shows two leaves × 7 lines whether or not the
read carries the marker** (seq 1, 2 and 5, read from image), so `leaf_seam` records the marker, not the leaf count.
29 of 30 served reads have 14 lines; seq 5 has 13, and its lower leaf's first line is missing (read from image).

Each row freezes the served text (`served_text`, `served_text_sha256`, `served_content_hash`) and carries the page's
Derge identity, its reader link, and the image URLs. `archived_photo` is our R2 copy of the BL master at full
resolution; the BL IIIF server caps a whole-image request at 1200 px, so `full_res_url` is for citation only.
Five leaves have no R2 master; their page image is the 2000 px display copy.

## For the reader (about 90 minutes, about 3 minutes a leaf)

The correction page is a private Artifact: https://claude.ai/artifact/TsZeQEWPNVfpjksEWLqTrN (Derek shares it with
the reader, with contribute access so their saves reach the shared record).

1. Type your name in the box at the top left. It goes into the record with each leaf.
2. The leaf image is at the top, the machine transcription below it, one box per manuscript line. Use **Fit / 1.6× /
   2.4×** and drag to move around the image. "Full-resolution image" opens the original in a new tab.
3. Edit each line so it matches the leaf **exactly, syllable by syllable**. Keep the manuscript's own spellings;
   do not correct it toward Derge or any other edition. Punctuation (shad, tsheg spacing) does not affect the score.
4. If the machine **skipped a line**, press **Missing line below** on the line before it and type the missing line.
5. If you **cannot read a line** on the leaf (damage, ink loss), press **Unreadable**. That line is left out of the
   score on both sides.
6. A dashed "next leaf" rule marks where the machine thinks the second leaf begins; leave it where it is.
7. Press **Save and go to next leaf** when a leaf is finished, or **Save, not finished** to stop mid-leaf. You can
   close the page at any time and come back; finished leaves show "done" in the list.
8. When all 30 are done, press **Export corrections (JSON)** and send the file to Derek. (Saves also go to the shared
   record, so the export is a backup.)

## For whoever scores it

1. Get the corrections: the reader's export file, or the artifact's db collection `corrections` (one document per
   leaf; `ArtifactData list` with `out_dir`, then wrap the documents as `{"pages": [...]}`).
2. `node scripts/eval/tibetan-proofread/score.mjs ingest --export corrections.json --role human --reader "<name>" --date <YYYY-MM-DD>`
   writes `ground-truth/<id>.json` for each leaf marked done, with a provenance block (`edited_by`, role, date,
   reader id, tool, instructions). It refuses an export made against different served text. Nothing is written to
   `pages` or `books`.
3. `node scripts/eval/tibetan-proofread/score.mjs score --out scripts/eval/results/tibetan-proofread-2026-10/scores.json`
   prints per leaf and pooled:
   - **identity** = Needleman–Wunsch syllable matches / served syllables — the same tokeniser and alignment as
     `kanjur_align.py` (ported; parity checked on 5 pages, identical to 6 decimals), so it sits directly beside
     `derge_identity` on the same leaf;
   - **recall** = matches / corrected syllables — sees dropped lines, which identity cannot;
   - dropped lines (lines the reader added), unreadable lines, edited lines; the split by marked/unmarked seam.
4. The edition-variance estimate is `derge_identity − identity` per leaf; report it with the n and the spread, and
   log the run in the experiments ledger and on #4523.

## Dry run (model-corrected, NOT ground truth)

`dry-run/` holds three leaves (seq 1, 2, 5) corrected by Claude Opus 5.5 from image crops, to test the pipeline end to
end. Each file says `is_ground_truth: false`. The model checked only part of each leaf, so these numbers measure
nothing about the read: `results/tibetan-proofread-2026-10/dry-run-scores.NOT-GROUND-TRUTH.json` — identity 0.986,
0.996, 1.000; recall 0.988, 0.995, 0.940. Seq 5 shows why recall is there: every served syllable is right
(identity 1.000) but a whole line is missing (recall 0.940).

## Rebuild the page

`SL_NODE_ROOT=<main checkout> node scripts/eval/tibetan-proofread/build-page.mjs --out scripts/output/tibetan-proofread-page`
then publish `index.html` with its `img/` files as the same Artifact. The page's text lives in `page.template.html`.
