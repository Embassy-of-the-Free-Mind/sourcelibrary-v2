# English OCR reference — Archive text vs flash-lite (#5124)

run en-ocr-ref-5124-2026-09 · scorer en-ocr-ref-scorer@1 · pages scored only where leaf_check = ok (122 of 182)

## Per stratum

| cell | engine | scored/pages | median CER | pooled CER [95% CI] | median WER | numbers printed | SILENT number misreads, verified [95% CI] | pages w/ a silent misread | visibly garbled numbers | numbers dropped | spurious numbers | refusals |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 pre-1880 prose | ia-djvu | 25/25 | 1.23% | 6.63% [1.47%, 15.50%] | 2.9% | 10 | 10.00% [0.00%, 33.33%] | 1 | 0 | 0.0% | 42 | – |
| S1 pre-1880 prose | gemini-lite-realtime | 23/25 | 0.11% | 1.49% [0.33%, 3.15%] | 0.5% | 10 | 0.00% [0.00%, 0.00%] | 0 | 0 | 20.0% | 18 | 6 first / 2 after retry [2%, 25%] |
| S2 pre-1880 date-dense | ia-djvu | 22/22 | 3.32% | 6.39% [3.12%, 11.04%] | 10.0% | 265 | 1.13% [0.00%, 3.18%] | 2 | 0 | 3.0% | 51 | – |
| S2 pre-1880 date-dense | gemini-lite-realtime | 19/22 | 0.45% | 3.99% [0.88%, 9.31%] | 1.0% | 194 | 0.00% [0.00%, 0.00%] | 0 | 0 | 4.1% | 37 | 8 first / 3 after retry [5%, 33%] |
| S3 1880–1930 prose | ia-djvu | 41/41 | 0.38% | 0.62% [0.41%, 0.87%] | 1.1% | 12 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 6 | – |
| S3 1880–1930 prose | gemini-lite-realtime | 36/41 | 0.11% | 0.34% [0.19%, 0.50%] | 0.5% | 12 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 4 | 8 first / 5 after retry [5%, 26%] |
| S4 1880–1930 date-dense | ia-djvu | 34/34 | 0.98% | 3.48% [1.79%, 5.77%] | 3.1% | 599 | 1.50% [0.46%, 3.09%] | 6 | 3 | 4.2% | 43 | – |
| S4 1880–1930 date-dense | gemini-lite-realtime | 27/34 | 0.64% | 4.90% [1.17%, 10.99%] | 2.1% | 534 | 0.00% [0.00%, 0.00%] | 0 | 0 | 9.9% | 80 | 12 first / 7 after retry [10%, 37%] |
| ALL | ia-djvu | 122/122 | 0.62% | 3.95% [2.33%, 6.07%] | 2.6% | 886 | 1.47% [0.60%, 2.68%] | 9 | 3 | 3.7% | 142 | – |
| ALL | gemini-lite-realtime | 105/122 | 0.24% | 2.62% [1.17%, 4.55%] | 0.8% | 750 | 0.00% [0.00%, 0.00%] | 0 | 0 | 8.4% | 139 | 34 first / 17 after retry [9%, 21%] |

## Paired (same page, both engines scorable)

| cell | pages | Archive better | lite better | tie (|ΔCER| < 0.2pp) | sign-test p | median ΔCER (lite − Archive) | silent number misreads Archive vs lite | numbers dropped Archive vs lite |
|---|---|---|---|---|---|---|---|---|
| S1 pre-1880 prose | 23 | 1 | 15 | 7 | 0.001 | -0.68% | 1 vs 0 | 0 vs 2 |
| S2 pre-1880 date-dense | 19 | 1 | 11 | 7 | 0.006 | -0.38% | 3 vs 0 | 8 vs 8 |
| S3 1880–1930 prose | 36 | 1 | 16 | 19 | 0.000 | -0.09% | 0 vs 0 | 0 vs 0 |
| S4 1880–1930 date-dense | 27 | 2 | 15 | 10 | 0.002 | -0.26% | 6 vs 0 | 20 vs 53 |
| ALL | 105 | 5 | 57 | 43 | 0.000 | -0.27% | 10 vs 0 | 28 vs 63 |

## By Archive OCR engine (the item's `ocr` metadata)

| group | engine | scored/pages | median CER | pooled CER [95% CI] | median WER | numbers printed | SILENT number misreads, verified [95% CI] | pages w/ a silent misread | visibly garbled numbers | numbers dropped | spurious numbers | refusals |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| (converted: abbyy-to-hocr 1.1.37) | ia-djvu | 65/65 | 0.60% | 3.90% [2.02%, 6.27%] | 2.6% | 502 | 1.99% [0.60%, 4.29%] | 6 | 3 | 2.4% | 73 | – |
| (converted: abbyy-to-hocr 1.1.37) | gemini-lite-realtime | 56/65 | 0.24% | 4.64% [1.64%, 8.57%] | 0.8% | 452 | 0.00% [0.00%, 0.00%] | 0 | 0 | 10.4% | 108 | 16 first / 9 after retry [7%, 24%] |
| ABBYY FineReader 8.0 | ia-djvu | 23/23 | 0.52% | 1.63% [0.76%, 2.75%] | 1.7% | 109 | 0.92% [0.00%, 3.70%] | 1 | 0 | 1.8% | 16 | – |
| ABBYY FineReader 8.0 | gemini-lite-realtime | 19/23 | 0.25% | 0.94% [0.28%, 1.80%] | 0.9% | 100 | 0.00% [0.00%, 0.00%] | 0 | 0 | 3.0% | 17 | 6 first / 4 after retry [7%, 37%] |
| (converted: abbyy-to-hocr 1.1.11) | ia-djvu | 13/13 | 0.85% | 3.48% [0.81%, 7.46%] | 2.7% | 105 | 0.00% [0.00%, 0.00%] | 0 | 0 | 11.4% | 15 | – |
| (converted: abbyy-to-hocr 1.1.11) | gemini-lite-realtime | 11/13 | 0.45% | 0.92% [0.19%, 2.82%] | 1.0% | 61 | 0.00% [0.00%, 0.00%] | 0 | 0 | 11.5% | 7 | 5 first / 2 after retry [4%, 42%] |
| tesseract 5.0.0-1-g862e | ia-djvu | 4/4 | 1.01% | 1.57% [0.34%, 3.42%] | 1.9% | 8 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 2 | – |
| tesseract 5.0.0-1-g862e | gemini-lite-realtime | 4/4 | 0.40% | 0.46% [0.20%, 0.83%] | 1.1% | 8 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 2 | 2 first / 0 after retry [0%, 49%] |
| tesseract 5.3.0-3-g9920 | ia-djvu | 3/3 | 1.85% | 2.95% [0.24%, 4.29%] | 8.9% | 13 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| tesseract 5.3.0-3-g9920 | gemini-lite-realtime | 2/3 | 0.06% | 0.08% [0.00%, 0.11%] | 0.3% | 3 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 2 first / 1 after retry [6%, 79%] |
| ABBYY FineReader 11.0 | ia-djvu | 3/3 | 0.51% | 4.52% [0.15%, 21.76%] | 1.8% | 11 | 9.09% [0.00%, 50.00%] | 1 | 0 | 36.4% | 7 | – |
| ABBYY FineReader 11.0 | gemini-lite-realtime | 3/3 | 0.00% | 0.16% [0.00%, 0.32%] | 0.0% | 11 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 0 first / 0 after retry [0%, 56%] |
| tesseract 5.0.0-alpha-20201231-10-g1236 | ia-djvu | 2/2 | 1.71% | 1.66% [0.49%, 2.93%] | 3.3% | 69 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| tesseract 5.0.0-alpha-20201231-10-g1236 | gemini-lite-realtime | 2/2 | 1.25% | 1.20% [0.22%, 2.28%] | 2.3% | 69 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 0 first / 0 after retry [0%, 66%] |
| ABBYY FineReader 11.0 (Extended OCR) | ia-djvu | 2/2 | 6.87% | 6.78% [6.38%, 7.36%] | 24.7% | 18 | 5.56% [0.00%, 8.33%] | 1 | 0 | 16.7% | 2 | – |
| ABBYY FineReader 11.0 (Extended OCR) | gemini-lite-realtime | 2/2 | 1.61% | 1.71% [1.05%, 2.17%] | 4.5% | 18 | 0.00% [0.00%, 0.00%] | 0 | 0 | 33.3% | 5 | 1 first / 0 after retry [0%, 66%] |
| tesseract 5.1.0-1-ge935 | ia-djvu | 2/2 | 43.96% | 40.16% [0.71%, 87.21%] | 60.3% | 4 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 27 | – |
| tesseract 5.1.0-1-ge935 | gemini-lite-realtime | 2/2 | 0.12% | 0.11% [0.04%, 0.20%] | 0.7% | 4 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 0 first / 0 after retry [0%, 66%] |
| ABBYY FineReader 9.0 | ia-djvu | 2/2 | 1.85% | 1.78% [1.23%, 2.47%] | 3.2% | 1 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| ABBYY FineReader 9.0 | gemini-lite-realtime | 2/2 | 0.12% | 0.12% [0.11%, 0.13%] | 0.9% | 1 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 0 first / 0 after retry [0%, 66%] |
| tesseract 5.3.0-6-g76ae | ia-djvu | 2/2 | 0.49% | 0.63% [0.18%, 0.80%] | 2.0% | 40 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| tesseract 5.3.0-6-g76ae | gemini-lite-realtime | 1/2 | 0.09% | 0.09% [0.09%, 0.09%] | 0.5% | 17 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 2 first / 1 after retry [9%, 91%] |
| (converted: abbyy-to-hocr 1.1.7) | ia-djvu | 1/1 | 4.56% | 4.56% [4.56%, 4.56%] | 17.0% | 6 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| (converted: abbyy-to-hocr 1.1.7) | gemini-lite-realtime | 1/1 | 1.18% | 1.18% [1.18%, 1.18%] | 3.6% | 6 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 0 first / 0 after retry [0%, 79%] |

## By scanner

| group | engine | scored/pages | median CER | pooled CER [95% CI] | median WER | numbers printed | SILENT number misreads, verified [95% CI] | pages w/ a silent misread | visibly garbled numbers | numbers dropped | spurious numbers | refusals |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ia-native | ia-djvu | 110/110 | 0.60% | 4.11% [2.32%, 6.57%] | 2.4% | 828 | 1.57% [0.64%, 2.91%] | 9 | 3 | 3.4% | 139 | – |
| ia-native | gemini-lite-realtime | 98/110 | 0.23% | 2.72% [1.17%, 4.76%] | 0.8% | 731 | 0.00% [0.00%, 0.00%] | 0 | 0 | 8.5% | 139 | 27 first / 12 after retry [6%, 18%] |
| google | ia-djvu | 8/8 | 1.49% | 2.78% [0.68%, 4.94%] | 3.0% | 23 | 0.00% [0.00%, 0.00%] | 0 | 0 | 21.7% | 3 | – |
| google | gemini-lite-realtime | 5/8 | 0.42% | 0.99% [0.13%, 2.34%] | 0.7% | 17 | 0.00% [0.00%, 0.00%] | 0 | 0 | 5.9% | 0 | 4 first / 3 after retry [14%, 69%] |
| unknown | ia-djvu | 4/4 | 2.09% | 2.36% [0.67%, 4.04%] | 5.1% | 35 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| unknown | gemini-lite-realtime | 2/4 | 1.29% | 1.24% [0.30%, 2.28%] | 2.1% | 2 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 3 first / 2 after retry [15%, 85%] |

## By Archive OCR date (djvu.xml mtime year)

| group | engine | scored/pages | median CER | pooled CER [95% CI] | median WER | numbers printed | SILENT number misreads, verified [95% CI] | pages w/ a silent misread | visibly garbled numbers | numbers dropped | spurious numbers | refusals |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2023 | ia-djvu | 63/63 | 0.60% | 3.72% [1.88%, 6.08%] | 2.6% | 502 | 1.99% [0.65%, 4.20%] | 6 | 2 | 2.4% | 73 | – |
| 2023 | gemini-lite-realtime | 54/63 | 0.20% | 4.38% [1.38%, 8.54%] | 0.6% | 450 | 0.00% [0.00%, 0.00%] | 0 | 0 | 10.0% | 106 | 16 first / 9 after retry [8%, 25%] |
| 2024 | ia-djvu | 29/29 | 0.38% | 2.53% [1.10%, 4.47%] | 1.7% | 216 | 0.46% [0.00%, 1.74%] | 1 | 0 | 6.0% | 30 | – |
| 2024 | gemini-lite-realtime | 26/29 | 0.27% | 0.98% [0.34%, 1.87%] | 0.9% | 163 | 0.00% [0.00%, 0.00%] | 0 | 0 | 5.5% | 24 | 9 first / 3 after retry [4%, 26%] |
| 2009 | ia-djvu | 10/10 | 0.59% | 0.95% [0.36%, 1.85%] | 1.7% | 23 | 0.00% [0.00%, 0.00%] | 0 | 0 | 4.3% | 1 | – |
| 2009 | gemini-lite-realtime | 7/10 | 0.42% | 0.69% [0.09%, 1.85%] | 1.1% | 23 | 0.00% [0.00%, 0.00%] | 0 | 0 | 4.3% | 0 | 4 first / 3 after retry [11%, 60%] |
| 2022 | ia-djvu | 8/8 | 1.46% | 13.87% [1.05%, 38.42%] | 3.0% | 12 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 29 | – |
| 2022 | gemini-lite-realtime | 8/8 | 0.25% | 0.41% [0.16%, 0.73%] | 1.1% | 12 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 2 | 2 first / 0 after retry [0%, 32%] |
| 2021 | ia-djvu | 7/7 | 2.93% | 5.19% [2.28%, 8.71%] | 5.7% | 99 | 2.02% [0.00%, 13.04%] | 2 | 0 | 7.1% | 9 | – |
| 2021 | gemini-lite-realtime | 7/7 | 0.22% | 1.11% [0.30%, 1.74%] | 0.7% | 99 | 0.00% [0.00%, 0.00%] | 0 | 0 | 6.1% | 5 | 1 first / 0 after retry [0%, 35%] |
| 2026 | ia-djvu | 3/3 | 0.61% | 0.64% [0.00%, 0.80%] | 2.6% | 31 | 0.00% [0.00%, 0.00%] | 0 | 1 | 0.0% | 0 | – |
| 2026 | gemini-lite-realtime | 1/3 | 0.00% | 0.00% [0.00%, 0.00%] | 0.0% | 0 | –  | 0 | 0 | – | 0 | 2 first / 2 after retry [21%, 94%] |
| 2025 | ia-djvu | 1/1 | 12.32% | 12.32% [12.32%, 12.32%] | 33.3% | 3 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| 2025 | gemini-lite-realtime | 1/1 | 10.90% | 10.90% [10.90%, 10.90%] | 27.0% | 3 | 0.00% [0.00%, 0.00%] | 0 | 0 | 66.7% | 2 | 0 first / 0 after retry [0%, 79%] |
| 2017 | ia-djvu | 1/1 | 0.51% | 0.51% [0.51%, 0.51%] | 1.8% | 0 | –  | 0 | 0 | – | 0 | – |
| 2017 | gemini-lite-realtime | 1/1 | 0.32% | 0.32% [0.32%, 0.32%] | 0.8% | 0 | –  | 0 | 0 | – | 0 | 0 first / 0 after retry [0%, 79%] |

## By reference source

| group | engine | scored/pages | median CER | pooled CER [95% CI] | median WER | numbers printed | SILENT number misreads, verified [95% CI] | pages w/ a silent misread | visibly garbled numbers | numbers dropped | spurious numbers | refusals |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wikisource | ia-djvu | 87/87 | 0.59% | 4.20% [1.99%, 7.29%] | 1.9% | 416 | 2.16% [0.73%, 4.17%] | 6 | 2 | 1.4% | 127 | – |
| wikisource | gemini-lite-realtime | 78/87 | 0.23% | 1.94% [0.82%, 3.60%] | 0.8% | 381 | 0.00% [0.00%, 0.00%] | 0 | 0 | 1.0% | 84 | 18 first / 9 after retry [6%, 19%] |
| gutenberg | ia-djvu | 35/35 | 1.23% | 3.38% [1.99%, 4.99%] | 3.2% | 470 | 0.85% [0.00%, 2.41%] | 3 | 1 | 5.7% | 15 | – |
| gutenberg | gemini-lite-realtime | 27/35 | 0.30% | 4.48% [0.82%, 10.31%] | 0.9% | 369 | 0.00% [0.00%, 0.00%] | 0 | 0 | 16.0% | 55 | 16 first / 8 after retry [12%, 39%] |

## By decade of edition

| group | engine | scored/pages | median CER | pooled CER [95% CI] | median WER | numbers printed | SILENT number misreads, verified [95% CI] | pages w/ a silent misread | visibly garbled numbers | numbers dropped | spurious numbers | refusals |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1900s | ia-djvu | 18/18 | 0.84% | 1.61% [0.67%, 3.12%] | 2.7% | 118 | 0.00% [0.00%, 0.00%] | 0 | 1 | 0.8% | 14 | – |
| 1900s | gemini-lite-realtime | 15/18 | 0.24% | 1.48% [0.33%, 3.37%] | 1.1% | 118 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.8% | 13 | 5 first / 3 after retry [6%, 39%] |
| 1910s | ia-djvu | 17/17 | 0.34% | 4.10% [0.80%, 8.71%] | 1.6% | 174 | 3.45% [1.37%, 8.64%] | 4 | 1 | 5.2% | 9 | – |
| 1910s | gemini-lite-realtime | 17/17 | 0.43% | 1.95% [0.24%, 5.20%] | 0.8% | 174 | 0.00% [0.00%, 0.00%] | 0 | 0 | 1.7% | 3 | 0 first / 0 after retry [0%, 18%] |
| 1890s | ia-djvu | 16/16 | 0.55% | 2.08% [0.64%, 3.91%] | 1.7% | 80 | 1.25% [0.00%, 4.55%] | 1 | 0 | 17.5% | 3 | – |
| 1890s | gemini-lite-realtime | 13/16 | 0.20% | 1.29% [0.21%, 3.25%] | 0.7% | 59 | 0.00% [0.00%, 0.00%] | 0 | 0 | 16.9% | 1 | 5 first / 3 after retry [7%, 43%] |
| 1880s | ia-djvu | 14/14 | 0.33% | 0.72% [0.26%, 1.36%] | 2.0% | 178 | 1.12% [0.00%, 9.52%] | 1 | 1 | 0.6% | 0 | – |
| 1880s | gemini-lite-realtime | 8/14 | 0.05% | 11.68% [0.04%, 33.04%] | 0.3% | 134 | 0.00% [0.00%, 0.00%] | 0 | 0 | 29.1% | 46 | 7 first / 6 after retry [21%, 67%] |
| 1870s | ia-djvu | 11/11 | 0.54% | 3.62% [0.52%, 8.06%] | 2.0% | 89 | 2.25% [0.00%, 8.45%] | 1 | 0 | 0.0% | 16 | – |
| 1870s | gemini-lite-realtime | 10/11 | 0.27% | 1.57% [0.21%, 4.15%] | 0.5% | 51 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 4 | 4 first / 1 after retry [2%, 38%] |
| 1920s | ia-djvu | 9/9 | 0.85% | 1.13% [0.45%, 1.81%] | 2.5% | 61 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 18 | – |
| 1920s | gemini-lite-realtime | 9/9 | 0.51% | 0.56% [0.21%, 1.02%] | 0.8% | 61 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 17 | 3 first / 0 after retry [0%, 30%] |
| 1850s | ia-djvu | 6/6 | 0.20% | 9.91% [0.14%, 31.38%] | 1.5% | 33 | 3.03% [0.00%, 40.00%] | 1 | 0 | 0.0% | 24 | – |
| 1850s | gemini-lite-realtime | 5/6 | 0.00% | 10.39% [0.00%, 33.53%] | 0.0% | 33 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 25 | 2 first / 1 after retry [3%, 56%] |
| 1790s | ia-djvu | 4/4 | 5.22% | 7.58% [2.27%, 16.26%] | 21.6% | 16 | 0.00% [0.00%, 0.00%] | 0 | 0 | 25.0% | 7 | – |
| 1790s | gemini-lite-realtime | 4/4 | 0.59% | 1.35% [0.00%, 2.61%] | 1.8% | 16 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 0 first / 0 after retry [0%, 49%] |
| 1680s | ia-djvu | 4/4 | 6.87% | 6.28% [4.90%, 7.63%] | 24.7% | 28 | 3.57% [0.00%, 8.33%] | 1 | 0 | 10.7% | 2 | – |
| 1680s | gemini-lite-realtime | 3/4 | 1.19% | 1.58% [1.05%, 2.17%] | 3.6% | 18 | 0.00% [0.00%, 0.00%] | 0 | 0 | 33.3% | 5 | 2 first / 1 after retry [5%, 70%] |
| 1860s | ia-djvu | 3/3 | 0.23% | 0.50% [0.00%, 0.80%] | 1.5% | 23 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| 1860s | gemini-lite-realtime | 2/3 | 0.35% | 0.37% [0.00%, 0.70%] | 1.8% | 0 | –  | 0 | 0 | – | 0 | 2 first / 1 after retry [6%, 79%] |
| 1830s | ia-djvu | 3/3 | 1.26% | 2.20% [0.10%, 4.73%] | 5.7% | 7 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| 1830s | gemini-lite-realtime | 3/3 | 0.05% | 0.09% [0.00%, 0.20%] | 0.3% | 7 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 1 first / 0 after retry [0%, 56%] |
| 1820s | ia-djvu | 2/2 | 43.60% | 72.48% [0.00%, 87.21%] | 59.4% | 0 | –  | 0 | 0 | – | 27 | – |
| 1820s | gemini-lite-realtime | 2/2 | 0.10% | 0.17% [0.00%, 0.20%] | 0.6% | 0 | –  | 0 | 0 | – | 0 | 0 first / 0 after retry [0%, 66%] |
| 1660s | ia-djvu | 2/2 | 8.62% | 10.58% [4.91%, 12.32%] | 28.5% | 3 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 1 | – |
| 1660s | gemini-lite-realtime | 2/2 | 6.00% | 8.60% [1.10%, 10.90%] | 15.3% | 3 | 0.00% [0.00%, 0.00%] | 0 | 0 | 66.7% | 3 | 0 first / 0 after retry [0%, 66%] |
| 1840s | ia-djvu | 2/2 | 0.48% | 0.48% [0.34%, 0.63%] | 2.3% | 8 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| 1840s | gemini-lite-realtime | 1/2 | 0.00% | 0.00% [0.00%, 0.00%] | 0.0% | 8 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 1 first / 1 after retry [9%, 91%] |
| 300s | ia-djvu | 1/1 | 2.35% | 2.35% [2.35%, 2.35%] | 8.8% | 6 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| 300s | gemini-lite-realtime | 1/1 | 0.42% | 0.42% [0.42%, 0.42%] | 1.8% | 6 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 0 first / 0 after retry [0%, 79%] |
| 1650s | ia-djvu | 1/1 | 8.10% | 8.10% [8.10%, 8.10%] | 20.0% | 7 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| 1650s | gemini-lite-realtime | 1/1 | 5.30% | 5.30% [5.30%, 5.30%] | 6.0% | 7 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 0 first / 0 after retry [0%, 79%] |
| 1760s | ia-djvu | 1/1 | 0.06% | 0.06% [0.06%, 0.06%] | 0.3% | 39 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| 1760s | gemini-lite-realtime | 1/1 | 0.00% | 0.00% [0.00%, 0.00%] | 0.0% | 39 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 1 first / 0 after retry [0%, 79%] |
| 1770s | ia-djvu | 1/1 | 4.71% | 4.71% [4.71%, 4.71%] | 21.6% | 0 | –  | 0 | 0 | – | 0 | – |
| 1770s | gemini-lite-realtime | 1/1 | 0.00% | 0.00% [0.00%, 0.00%] | 0.0% | 0 | –  | 0 | 0 | – | 0 | 0 first / 0 after retry [0%, 79%] |
| 1800s | ia-djvu | 1/1 | 2.47% | 2.47% [2.47%, 2.47%] | 2.9% | 1 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| 1800s | gemini-lite-realtime | 1/1 | 0.13% | 0.13% [0.13%, 0.13%] | 0.7% | 1 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 0 first / 0 after retry [0%, 79%] |
| 1720s | ia-djvu | 1/1 | 5.61% | 5.61% [5.61%, 5.61%] | 16.0% | 0 | –  | 0 | 0 | – | 13 | – |
| 1720s | gemini-lite-realtime | 1/1 | 3.03% | 3.03% [3.03%, 3.03%] | 5.1% | 0 | –  | 0 | 0 | – | 15 | 0 first / 0 after retry [0%, 79%] |
| 1780s | ia-djvu | 1/1 | 0.36% | 0.36% [0.36%, 0.36%] | 0.8% | 6 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 1 | – |
| 1780s | gemini-lite-realtime | 1/1 | 0.45% | 0.45% [0.45%, 0.45%] | 1.0% | 6 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 1 | 0 first / 0 after retry [0%, 79%] |
| 1930s | ia-djvu | 1/1 | 2.23% | 2.23% [2.23%, 2.23%] | 6.4% | 0 | –  | 0 | 0 | – | 5 | – |
| 1930s | gemini-lite-realtime | 1/1 | 1.12% | 1.12% [1.12%, 1.12%] | 2.1% | 0 | –  | 0 | 0 | – | 4 | 0 first / 0 after retry [0%, 79%] |
| 1580s | ia-djvu | 1/1 | 7.16% | 7.16% [7.16%, 7.16%] | 11.2% | 7 | 0.00% [0.00%, 0.00%] | 0 | 0 | 14.3% | 2 | – |
| 1580s | gemini-lite-realtime | 1/1 | 7.00% | 7.00% [7.00%, 7.00%] | 7.2% | 7 | 0.00% [0.00%, 0.00%] | 0 | 0 | 28.6% | 2 | 0 first / 0 after retry [0%, 79%] |
| 1810s | ia-djvu | 1/1 | 1.23% | 1.23% [1.23%, 1.23%] | 3.5% | 0 | –  | 0 | 0 | – | 0 | – |
| 1810s | gemini-lite-realtime | 1/1 | 0.11% | 0.11% [0.11%, 0.11%] | 1.2% | 0 | –  | 0 | 0 | – | 0 | 0 first / 0 after retry [0%, 79%] |
| 1750s | ia-djvu | 1/1 | 1.85% | 1.85% [1.85%, 1.85%] | 8.9% | 2 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | – |
| 1750s | gemini-lite-realtime | 1/1 | 0.11% | 0.11% [0.11%, 0.11%] | 0.5% | 2 | 0.00% [0.00%, 0.00%] | 0 | 0 | 0.0% | 0 | 1 first / 0 after retry [0%, 79%] |

## Worst five pages per engine (read these by eye before quoting a cell)

- **ia-djvu**: en-69ad74-ws199 (CER 87.2%, digits ∅→172 ∅→15 ∅→5886 ∅→15); en-695434-ws146 (CER 55.1%, digits 2→70 2→74 2→78 2→82); en-6aa1d5-ws52 (CER 28.6%, digits 1804→k ם→1804 ∅→10 ∅→11); en-6aa734-pg72452p172 (CER 21.8%, digits 34→breadth 17→within 8→34 3→17); en-69bd9b-pg48225p119 (CER 20.0%, digits 94→∅ 95→∅ 118→∅)
- **gemini-lite-realtime**: en-699079-pg41110p268 (CER 62.1%, digits ∅→161 ∅→24 ∅→167 ∅→52); en-695434-ws146 (CER 55.1%, digits 2→70 2→74 2→78 2→82); en-69bd9b-pg48225p119 (CER 19.9%, digits 94→∅ 95→∅ 118→∅); en-69a552-pg38870p391 (CER 14.7%, digits 74→∅ 1898→∅ 75→∅ 1856→∅); en-699063-ws324 (CER 12.4%, digits ∅→10 ∅→100 ∅→1000 ∅→6113)

## Number-misread candidates and what the page prints (read off the image)

| page | reference | engine read | engines | printed | note |
|---|---|---|---|---|---|
| en-69ae66-ws159 | 70 | 1 | gemini-lite-realtime | ref | heading reads 70 This necessarily brings |
| en-69ae90-ws101 | 56 | 5g | ia-djvu | ref | footnote v 18 47 56 Aristophanes |
| en-695434-ws122 | 11 | ii | ia-djvu | ref | Corol 11 pt 2 printed |
| en-695434-ws122 | 16 | 6 | ia-djvu | ref | Prop 16 pt 2 printed |
| en-695434-ws122 | 11 | 1 | ia-djvu | ref | Prop 11 pt 2 printed |
| en-6991eb-ws75 | 105 | io | ia-djvu | ref | section heading 105 clearly printed |
| en-6aa1d5-ws52 | 438 | 488 | ia-djvu | ref | footnote HUb p 438 Salomon |
| en-69b9a2-ws132 | 31 | i | ia-djvu | ref | footnote On July 31 1879 thirteenth incarnation |
| en-69b9a2-ws132 | 1879 | 1s79 | ia-djvu | ref | footnote On July 31 1879 printed clearly |
| en-6ab233-ws84 | 18 | 8 | ia-djvu | ref | Matthew 18 15-17 printed twice on page |
| en-699069-pg31511p363 | 11 | ii | ia-djvu | ref | true and exact Relation 10 11 13-15 27 |
| en-699069-pg31511p363 | 13 | i3 | ia-djvu | ref | same list 10 11 13-15 27 printed |
| en-699069-pg31511p363 | 15 | is | ia-djvu | ref | same list 10 11 13-15 27 printed |
| en-6a0b25-pg77434p155 | 50 | 0 | ia-djvu | ref | every where in the Leaf Tab 50 continued |
| en-6ab245-pg35895p272 | 219 | 119 | ia-djvu | ref | throne of Magadha 110-112 219 printed |
| en-6ab245-pg35895p272 | 227 | 127 | ia-djvu | ref | not disrespectable 227 228 231 232 printed |
| en-699079-pg74335p860 | 36 | 30 | ia-djvu | ref | (G. D., 36; War, 8.) prints 36 |
| en-6a09ff-pg43519p227 | 538 | 268 | ia-djvu+gemini-lite-realtime | ref | 1,538,342 IV Ik prints 538 |
| en-6a09ff-pg43519p227 | 342 | 540 | ia-djvu+gemini-lite-realtime | ref | 1,538,342 prints 342 |
| en-6a09ff-pg43519p227 | 535 | 234 | ia-djvu+gemini-lite-realtime | ref | 1,535,004 VII Kan prints 535 |
| en-6a09ff-pg43519p227 | 004 | 220 | ia-djvu+gemini-lite-realtime | ref | 1,535,004 prints 004 |
| en-6a09ff-pg43519p227 | 538 | 272 | ia-djvu+gemini-lite-realtime | ref | same line 1,538,342 prints 538 |
| en-6a09ff-pg43519p227 | 342 | 544 | ia-djvu+gemini-lite-realtime | ref | same line prints 342 |
| en-6a09ff-pg43519p227 | 535 | 272 | ia-djvu+gemini-lite-realtime | ref | 1,535,004 prints 535 |
| en-6a09ff-pg43519p227 | 004 | 921 | ia-djvu+gemini-lite-realtime | ref | 1,535,004 prints 004 |
| en-699249-ws289 | 119 | 18 | ia-djvu | other | index actually prints 118 for Magni entry, neither candidate |
| en-699249-ws289 | 1100 | 100 | ia-djvu | ref | an Icelandic skald c 1100 prints 1100 |
| en-699249-ws289 | 21 | 2 | ia-djvu | ref | Midgard habitation 21 prints 21 |
| en-699249-ws289 | 80 | 81 | ia-djvu+gemini-lite-realtime | engine | prints 81 (68 81 107), not 80 |
| en-699249-ws289 | 101 | loi | ia-djvu | ref | Mimir well 27 79 80 101 prints 101 |
| en-699249-ws289 | 119 | 118 | gemini-lite-realtime | engine | Magni entry prints 118, matches B |
| en-699249-ws289 | 49 | 48 | gemini-lite-realtime | engine | Mist a Valkyr 48 prints 48 not 49 |
| en-6aa1d2-ws352 | 2000 | 000 | ia-djvu | ref | within the first 2000 years prints 2000 |
| en-699063-ws324 | 5180 | 6180 | ia-djvu+ia-djvu | ref | others as 5180 years prints 5180 |
| en-69e63b-ws487 | 243 | 245 | ia-djvu+gemini-lite-realtime | engine | footnote reads pp 245-247, prints 245 not 243 |
| en-695926-pg60766p151 | 12 | 5 | ia-djvu | ref | Ezech 12 margin note prints 12 |
| en-699079-pg41110p268 | 161 | 118 | gemini-lite-realtime | ref | Barkook plum 161 n prints 161 |
| en-699079-pg41110p268 | 115 | 186 | gemini-lite-realtime | other | Barmekees Barmecides has no number printed on this page |
| en-699079-pg41110p268 | 158 | 45 | gemini-lite-realtime | ref | Batiyeh jar 158 prints 158 |
| en-699079-pg41110p268 | 142 | 139 | gemini-lite-realtime | ref | Beverages 142 prints 142 |
| en-699079-pg41110p268 | 258 | 50 | gemini-lite-realtime | ref | Biers 258 n prints 258 |
| en-699079-pg41110p268 | 160 | 19 | gemini-lite-realtime | ref | Bitteekh water-melon 160 prints 160 |
| en-699079-pg41110p268 | 102 | 266 | gemini-lite-realtime | ref | Blacks country of the 102 prints 102 |
| en-699079-pg41110p268 | 19 | 35 | gemini-lite-realtime | ref | Blood-revenge 19 prints 19 |
| en-699079-pg41110p268 | 35 | 87 | gemini-lite-realtime | ref | Blood-wit 18 35 prints 35 |
| en-69920a-pg70338p112 | 91 | 9 | ia-djvu | other | page prints 9 1/4 d fraction, neither 91 nor 9 exactly |

Reference errors found this way: 4 (the page prints the ENGINE's number): en-699249-ws289|80|81; en-699249-ws289|119|118; en-699249-ws289|49|48; en-69e63b-ws487|243|245
