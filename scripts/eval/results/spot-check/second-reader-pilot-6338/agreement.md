# Agreement, 16 pages, descriptive, no rate (#6338)

Command: `python3 scripts/eval/spot-check/review-agreement.py opus=<dir holding scripts/eval/results/spot-check/overview-2026-10-07-eternity2/reviews/greek-latin-classics.json> pro=scripts/eval/results/spot-check/second-reader-pilot-6338/reviews/pro f38h=scripts/eval/results/spot-check/second-reader-pilot-6338/reviews/f38h f38l=scripts/eval/results/spot-check/second-reader-pilot-6338/reviews/f38l`

runs: opus: 16 pages / 4 books, serious rate 38%, pro: 16 pages / 4 books, serious rate 94%, f38h: 16 pages / 4 books, serious rate 94%, f38l: 16 pages / 4 books, serious rate 75%

| pair | pages | serious agree | serious κ [95% CI by book] | wrong-leaf κ | OCR score ρ | EN score ρ | class Jaccard (both serious) | books | verdict agree | verdict weighted κ |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| opus–pro | 16 | 0.31 | -0.13 [-0.39, 0.00] | — | 0.48 | 0.22 | 0.17 (n=5) | 4 | 0.50 | 0.00 |
| opus–f38h | 16 | 0.44 | 0.08 [0.00, 0.56] | — | 0.77 | 0.89 | 0.16 (n=6) | 4 | 0.50 | 0.33 |
| opus–f38l | 16 | 0.62 | 0.33 [0.10, 0.71] | — | 0.65 | 0.68 | 0.20 (n=6) | 4 | 0.75 | 0.67 |
| pro–f38h | 16 | 0.88 | -0.07 [-0.14, 0.00] | — | 0.59 | 0.19 | 0.00 (n=14) | 4 | 0.75 | 0.00 |
| pro–f38l | 16 | 0.69 | -0.11 [-0.20, 0.00] | — | 0.27 | 0.40 | 0.14 (n=11) | 4 | 0.50 | 0.00 |
| f38h–f38l | 16 | 0.81 | 0.33 [0.00, 1.00] | — | 0.71 | 0.43 | 0.22 (n=12) | 4 | 0.75 | 0.50 |

Fleiss κ across all 4 runs, serious flag, 16 pages: 0.00

Krippendorff α across 4 runs, 16 pages (missing allowed): serious (nominal) 0.02, right_page (nominal) -0.03, OCR score (ordinal) 0.55, English score (ordinal) 0.46; 4 books: fit_to_show (ordinal) 0.38

serious-page rate by book-tradition prefix is in each run's overview-score report.
