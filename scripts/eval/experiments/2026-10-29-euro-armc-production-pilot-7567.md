---
stage: ocr
measure: [judged]
languages: [la, it]
scripts: [Latn]
canons: []
n_books: 20
n_pages: 300
verdict: "The arm-c production lane (GPU draft → agy Flash low with the image, written over the stored Flash-Lite draft, E3 diff guard putting flagged changes back to the stored reading) was piloted on 10 books × 15 pages per language with --apply. As run it FAILED the bar fixed in the brief (misleading ≤ E5 arm c + 5 points: la ≤ 7.5%, it ≤ 6.3%): blind Opus did not accept 8/40 Latin (20%) and 5/36 Italian (14%) pages. The failures sit on the pages where the guard spliced a stored span back: by eye, 4 of 5 such pages were damaged by the splice (tags crossed, a printed heading deleted, a phrase doubled). With the splice limited to like-for-like, tag-free substitutions (a page needing any other put-back is not written; rule fixed before the verdicts were read), the pages the lane still writes were accepted 28/30 Latin (2 = 6.7%) and 22/22 Italian (0): under the bar, on small n. The 64 pages the fixed rule refuses were reverted. No cron line was installed."
status: undecided
decision: "Recommended default: enable the lane on the fixed rule (cron line below + the filler route), with the nightly lane-judge sampler watching it; or re-pilot 10×15 per language first. Pending Derek."
superseded_by: null
issue: [7567, 6871]
router_evidence: "none — not yet; the verdicts are in lane_judge_verdicts (lane gpu-agy-correct-lite-7567, routes pero>agy-flash-low / lighton>agy-flash-low, cells latin-lite / italian-lite); rules.json has no route row for them until the lane is enabled"
---
## 2026-10-29 · Arm-c production pilot, Latin + Italian (#7567)
<!-- PRIOR ART: 2026-10-28-euro-print-gpu-correct-e3-e5-7567.md (E5: arm c passed la and it; its E3 guards, image-checked there, put back here without an image check); 2026-10-28-gpu-latin-route-pilot-7263.md (the unread-page GPU lane's pilot, the same judge in book-depth mode). -->

**As run, the pilot failed; the failure is the put-back splice, not the reads.** Fixed and partly undone the same session; the cron is not installed.

### Lane (scripts/batch/cli-ocr-lane.mjs `armc*`, scripts/gpu/euro-draft-task.sh, cli-ocr.mjs `read --over-stored`)
- **Frame.** The correct lane's frame (stored Flash-Lite draft ≥ 300 chars, visible idle unheld book, interior, not edited, withheld or handwritten), plus E5's `year` 1450–1800, plus: no page whose stored read says illustration, plate, map, blank or script none. (The first plan drew a tarot deck whose 300+ chars were an image description.)
- **Draft.** la PERO-OCR on the GPU (`pero-draft.py --device=gpu`, new venv `/root/pero-ocr/venv-gpu`, 1.3 s/page; the CPU config ran ~15 s/page on the loaded box and hung on one page). it LightOnOCR-3-1B through vLLM at 0.45 of the card, beside the SigLIP chunk and another tenant (1,283 pages/h). 300/300 drafted, 5 under 30 word characters.
- **Correct + write.** agy 3.8 Flash low, template 0601ef30, one page a call; 306 calls on the second pool (jamesdereklomas@).
- **Ledger.** 300 tried:
  - 269 written;
  - 12 foreign-script guard;
  - 8 reply cut before `<<<END>>>`;
  - 7 left the frame since the plan;
  - 3 under the 40% shared-words floor;
  - 1 with no draft.
- **No human-edited page was touched** (269/269 prior texts were Flash-Lite drafts, none edited). 268 pages with English were flagged `translation_stale` (a flag; nothing re-translates on it).

### Quota (a choice made here)
- Both pools were under their pace lines all night (main 26.9% vs 27.1%; second 76.7% vs 84.2%), drawn by tib-wave3-7263 (1,567 calls an hour) and the de/fr correction lane, which spends each pool to its line.
- The pilot ran on the second pool with a fixed floor (`--weekly-floor=0.5`, as E2/E5 ran at 0.40), about 0.6% of that pool's week. The cron line keeps the pace-line floor.
- **This means the lane, once on, runs only when a pool rises above its line.** Every lane on the pools spends to the line, so it gets slices. Whether la/it arm c (E5: stored lite misleading on 68/160 la pages) should go ahead of de/fr correction is a priority call for Derek.

### Guard: put-back without an image check (E3 rule, production form)
- **The rule as built.** Every flag (number, negation, expansion) is put back to the stored reading. Put-back is the safe direction for the reading: E5's image check gave the stored reading back on 78 of 198 changed numbers, so a put-back keeps a wrong stored number about as often as it saves a right one.
- **What it did.** 84/269 written pages flagged, 126 changes put back.
- **By eye, 4 of the 5 put-back pages checked were damaged by the SPLICE itself:**
  - running heads and signatures crossed (`<header>DEL THEAT. 97</header>` / `<sig>E.</header>`); the tag structure changed on 30 of the 84;
  - "CAP. XIII." deleted: a number flag on a heading the stored text lacked, put back to nothing;
  - "structione z ipedimētū et impedimentum" doubled: an uneven hunk whose neighbours the corrector had re-aligned.
- **Fixed** (`cli-ocr.mjs`). A put-back is spliced only when every flag is a like-for-like substitution: the same number of words a side, no tag in either span, and the tag structure unchanged after. Otherwise the page is not written and the stored text stands.
  - Re-run on the 269 written pages, the fixed rule refuses 64 (31 tag, 33 uneven) and writes the other 205 byte for byte as before.
  - The 64 were reverted (`revert-run.mjs --run-id … --page-ids-file`, 17 runs, 64/64 restored) and their stale flags cleared.
  - This rule was fixed before any verdict was read: the judge was at 19/84 calls.

### Judge (scripts/eval/lane-judge-sampler.mjs, book-depth 4 a book, Opus blind with the image; draft-share 0)
| | la accepted | it accepted |
|---|---|---|
| all judged (the pilot as written) | 32/40 | 31/36 |
| pages the fixed rule writes | **28/30** | **22/22** |
| pages the fixed rule refuses (reverted) | 4/10 | 9/14 |
| bar: misleading ≤ | 7.5% (≤ 2/30) | 6.3% (≤ 1/22) |

- **Controls.** All 4 wrong-page controls were rejected: they caught the swap.
- **Not measured.** "Worse than stored": the stored drafts were not judged beside the output (draft-share 0, to fit the meter).
- **Meter.** The job's Claude login (milolomas) went 95% → 98% weekly and the run stopped itself at its raised limit after 80 of 84 calls.
- **"Misleading" here** means the judge did not accept the page (a wrong_text or misleads defect). That is the router judge's accept, the nearest to E5's "not usable".

### By eye (10 written pages, image opened; 5 la, 5 it, seeded)
- **Clean, as good as or better than stored:**
  - Steganographia p.330: line breaks now kept;
  - Clavis absconditorum p.74: show-through header dropped, rightly;
  - Ficino *Sopra l'amore* p.60;
  - Aretino *Lettere* III p.279: markdown `###`/`---` carried in from the LightOnOCR draft;
  - *Rosarium* p.177: marginal notes added that the stored text lacked.
- **Ramelli p.550 (by eye):** a French page in a book catalogued Italian. Accurate, with one misread (maniuella for maniuelle).
- **Put-back damage (by eye):**
  - Steuco *De perenni philosophia* p.362: CAP. XIII heading deleted;
  - *Flores astrologiae* p.18: phrase doubled;
  - Camillo p.97: tags crossed;
  - Scappi p.409: tags crossed.
  - All four are among the 64 reverted.

### What this does not show
- The fixed rule is judged on the subset of the same draw that it would write (30 + 22 pages, 10 books a language). That is a post-hoc split of one pilot, not a fresh pilot.
- With n = 30, 2 misleading pages sit at the bar's edge.

### Cron (not installed; for when the lane is enabled)
```
35 */2 * * * export PATH=/usr/local/bin:/root/.local/bin:/usr/bin:/bin; f=/root/sourcelibrary/scripts/batch/cli-ocr-lane.mjs; [ -f $f ] && grep -q -- 'armc-plan' $f && cd /root/sourcelibrary && flock -n /tmp/cli-ocr-armc.lock timeout 110m sh -c "node --no-warnings --env-file=.env.production.local $f armc-plan --lane-dir=/root/jobs/euro-armc-7567 && node --no-warnings --env-file=.env.production.local $f armc --lane-dir=/root/jobs/euro-armc-7567 --out=/root/jobs/euro-armc-7567/correct/\$(date +\%F) --max-pages=1200 --concurrency=4 --deadline-min=95 --agy-home=auto --apply" >> /var/log/sourcelibrary/cli-ocr-armc.log 2>&1  # #7567
```
Plus `on` for `euro-armc-7567` in `scripts/gpu/ocr-filler-routes.tsv`, and a reinstall of `/root/bin/ocr-filler.sh`.

Undo the 205 pilot writes that stand: `revert-run.mjs --run-id <run>`, for the 20 runs listed in `/root/jobs/euro-armc-7567/armc-ledger.jsonl`.
