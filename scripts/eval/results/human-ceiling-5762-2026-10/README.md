# Human ceiling — human-vs-human baselines (#5762, 2026-10-04)

Two tracks, one question each: where does a second human land on the scale we score ourselves on?

| track | directory | experiment entry | headline |
|---|---|---|---|
| 1 translation (Greek, Latin) | `translation/` | `scripts/eval/experiments/2026-10-04-human-ceiling-translation-5762.md` | a second published translator scores 4.21 (Greek) / 4.14 (Latin) of 5 against the first; Flash reaches 87% / 105% of that, Lite 74% / 98% |
| 2 transcription (English, Greek, Chinese) | `transcription/` | `scripts/eval/experiments/2026-10-04-human-ceiling-transcription-5762.md` | two human transcriptions of one page differ by 0.14% (English), 0.43% (Greek letters; 1.09% with diacritics), 0.28% (Chinese, glyph conventions folded; 2.87% unfolded) |

Rebuild, track 1 (the working set is at `/root/sl-eval-archive/human-ceiling-5762/work` on the Hetzner box):

```
node scripts/eval/translation-vs-reference/human-ceiling/make-align-inputs.mjs --t1 … --t2 … --out <align>
#   aligner agents follow human-ceiling/ALIGN-BRIEF.md → <align>/out-*.jsonl
node scripts/eval/translation-vs-reference/human-ceiling/build-records.mjs --t1 … --t2 … --t2-ocr … --align <align> --out <dir> --min-verbatim 0.9
node scripts/eval/translation-vs-reference/build-packet.mjs --input <dir>/records-refA.jsonl --out <packetA> --seed 57621
node scripts/eval/translation-vs-reference/build-packet.mjs --input <dir>/records-refB.jsonl --out <packetB> --seed 57620
#   judges per DISPATCH.md, gate first; score.mjs per packet
node scripts/eval/translation-vs-reference/human-ceiling/report.mjs --ref-a … --ref-b … --pairs <dir>/pairs.json --out translation/ --retest T1=…,T2=…
```

Track 2: collection agents follow `scripts/eval/transcription-human-ceiling/PAIRS-BRIEF.md`; then
`node scripts/eval/transcription-human-ceiling/score.mjs --pairs en.jsonl,grc.jsonl,zh.jsonl --out transcription/ --cjk-fold transcription/cjk-recurring-pairs.json`.
The Chinese pair texts (CBETA CC BY-NC-SA, SAT no redistribution) are not in this repo.
