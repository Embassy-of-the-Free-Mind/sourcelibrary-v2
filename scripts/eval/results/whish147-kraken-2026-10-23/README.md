# Whish 147 Kraken line model (#7119, research experiment 3)

Write-up: `scripts/eval/experiments/2026-10-23-whish147-kraken-line-model.md`. Code, ids and scores only. Leaf crops,
line images, datasets and model weights stay on gex45 under `/root/jobs/whish147-kraken/` (labels and weights derive
from CC BY-NC-SA GRETIL text; see the licence note in the write-up).

PRIOR ART: ../whish147-best-attempt-2026-10-22/ (boxes.json, mlym.py, the edition-anchored page texts) and
../whish147-stability-recall-2026-10-23/ (#7203; `score_lib.py`, `locate-A.json`, `locate-C.json` are copied from it
unchanged, so this directory scores without that PR).

Pipeline (Python from the whish147-best venv locally; gex45 runs use /root/bench/kraken):
1. `leaves.py` — full-resolution greyscale leaf crops from the scan images and `boxes.json`.
2. `labels.py` — one label per physical row of an edition-anchored hand-A leaf page (Mongo dump of the book's pages),
   Malayalam via `mlym.py`; doubt-marked rows dropped; fresh-read CER recorded (the brief's 0.15 rule). Stats:
   `labels-stats.json` (no label text here).
3. `segment.py` — deskew + projection row segmentation (`blla` fragmented the leaf); `overlay.py` draws it for the
   by-eye check. Logs: `seg-train-test.log` (training leaves, cut to the label's row count), `seg-heldout.log`,
   `seg-handB-stretch.log`.
4. `splits.py` — `splits-ids.tsv` (split, line id, fresh-read CER; label text stays on gex45).
5. `normalize.py`, `build-datasets.sh` — contrast-normalised strips, `ketos compile --force-type baseline`.
6. `gpu-task.sh` — the gpu-queue task (three arms: 881, 300, 100 lines). `val-accuracy-by-epoch.json`.
7. `predict.sh` + `kraken_nonorm.py` — read the held-out lines with the centre-line normaliser off (as in training).
8. `score.py` — `scores-{all,n300,n100}.json`; `scores-v1-n100.json` is the collapsed first run (one string for all).
9. `voter.py` — `voter-{all,n300}.json`: Kraken picks among the stored Opus/Fable/Sonnet draws of #7203.
10. `place.py` — `place-tk.json`: the 91 leaves of pp. 131–221 placed in the Tattvakaumudī print from Kraken reads.
