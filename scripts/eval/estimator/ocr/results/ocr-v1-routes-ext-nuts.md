| chart | page kind | fame | pages measured | cheapest measured route clearing the bar | cost per call | P(read) | E[CER] | number errors per number | P(clears bar) | cost per usable page (fallback) | P(best) | best quality (P(best)) | choice at margin x0.5 / x2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| arabic-manuscript | prose | no web transcription; alchemy | 26 | **none clears the bar** | | | | | | | | claude -p Opus 5.5 (0.88) | none / none |
| arabic-manuscript | prose | no web transcription | 24 | **none clears the bar** | | | | | | | | claude -p Opus 5.5 (0.89) | none / none |
| arabic-print | prose | no web transcription; alchemy | 4 | **none clears the bar** | | | | | | | | Gemini 3 Flash, realtime API (0.78) | none / none |
| arabic-print | prose | no web transcription | 11 | **HOLD**: no route passes the floors (nearest Gemini 3.1 Flash-Lite, Batch API, P(floors) 0.39) | | | | | | | | Gemini 3 Flash, realtime API (0.82) | none / none |
| armenian | prose | no web transcription | 9 | **none clears the bar** | | | | | | | | Gemini 3.1 Flash-Lite, Batch API (0.50) | none / none |
| chinese-manuscript | prose | no web transcription | 499 | **PaddleOCR-VL 1.6 (GPU)** | $0 | 1.00 | 0.2134 | — | 1.00 | $0 (then Qwen3-VL 8B (GPU)) | 0.18 | agy Gemini 4 Argon low (CLI) (0.50) | PaddleOCR-VL 1.6 (GPU) / PaddleOCR-VL 1.6 (GPU) |
| chinese-print | prose | no web transcription | 19 | **HOLD**: no route passes the floors (nearest agy Gemini 4 Argon low (CLI), P(floors) 0.01) | | | | | | | | agy Gemini 4 Argon low (CLI) (0.34) | none / none |
| english | prose | no web transcription | 58 | **Chandra OCR 2 (GPU)** | $0 | 1.00 | 0.0517 | — | 0.93 | $0 (then agy Gemini 3.8 Flash high (CLI)) | 0.10 | claude -p Sonnet 5.5 (0.39) | none / Chandra OCR 2 (GPU) |
| english | prose | web transcription | 0 | **Chandra OCR 2 (GPU)** | $0 | 1.00 | 0.0517 | — | 0.93 | $0 (then agy Gemini 3.8 Flash high (CLI)) | 0.10 | claude -p Sonnet 5.5 (0.39) | none / Chandra OCR 2 (GPU) |
| english-1880-1930-dense | number-dense | no web transcription | 0 | **none clears the bar** | | | | | | | | MinerU (GPU) (0.72) | none / none |
| english-1880-1930-dense | number-dense | web transcription | 34 | **none clears the bar** | | | | | | | | MinerU (GPU) (0.72) | none / none |
| english-1880-1930-prose | prose | no web transcription | 0 | **olmOCR 2 (GPU)** | $0 | 1.00 | 0.0040 | — | 1.00 | $0 (then Internet Archive text (djvu)) | 0.51 | olmOCR 2 (GPU) (0.51) | olmOCR 2 (GPU) / olmOCR 2 (GPU) |
| english-1880-1930-prose | prose | web transcription | 41 | **olmOCR 2 (GPU)** | $0 | 1.00 | 0.0040 | — | 1.00 | $0 (then Internet Archive text (djvu)) | 0.51 | olmOCR 2 (GPU) (0.51) | olmOCR 2 (GPU) / olmOCR 2 (GPU) |
| english-pre1880-dense | number-dense | no web transcription | 0 | **none clears the bar** | | | | | | | | olmOCR 2 (GPU) (0.38) | none / none |
| english-pre1880-dense | number-dense | web transcription | 22 | **none clears the bar** | | | | | | | | olmOCR 2 (GPU) (0.38) | none / none |
| english-pre1880-prose | prose | no web transcription | 0 | **olmOCR 2 (GPU)** | $0 | 1.00 | 0.0178 | — | 0.96 | $0.00001 (then Gemini 3.1 Flash-Lite, Batch API) | 0.28 | Gemini 3.1 Flash-Lite, Batch API (0.69) | Gemini 3.1 Flash-Lite, Batch API / olmOCR 2 (GPU) |
| english-pre1880-prose | prose | web transcription | 25 | **olmOCR 2 (GPU)** | $0 | 1.00 | 0.0178 | — | 0.96 | $0 (then Gemini 3.1 Flash-Lite, Batch API) | 0.28 | Gemini 3.1 Flash-Lite, Batch API (0.69) | Gemini 3.1 Flash-Lite, Batch API / olmOCR 2 (GPU) |
| greek | prose | no web transcription | 146 | **agy Gemini 4 Argon low (CLI)** | 4.36e-06 agy | 0.99 | 0.0838 | — | 1.00 | 4.45e-06 agy (then agy Gemini 4 Argon low (CLI)) | 0.42 | agy Gemini 4 Argon low (CLI) (0.42) | agy Gemini 4 Argon low (CLI) / agy Gemini 4 Argon low (CLI) |
| greek-manuscript | prose | no web transcription | 64 | **agy Gemini 4 Argon low (CLI)** | 4.36e-06 agy | 1.00 | 0.2251 | — | 0.97 | 4.42e-06 agy (then agy Gemini 4 Argon low (CLI)) | 1.00 | agy Gemini 4 Argon low (CLI) (1.00) | agy Gemini 4 Argon low (CLI) / agy Gemini 4 Argon low (CLI) |
| hebrew | prose | no web transcription | 10 | **HOLD**: no route passes the floors (nearest claude -p Opus 5.5, P(floors) 0.38) | | | | | | | | claude -p Opus 5.5 (0.90) | none / none |
| latin | prose | no web transcription | 106 | **none clears the bar** | | | | | | | | agy Gemini 3.8 Flash high (CLI) (0.39) | none / none |
| latin-script-other | prose | web transcription | 30 | **none clears the bar** | | | | | | | | claude -p Sonnet 5.5 (0.34) | none / none |
| rashi | prose | no web transcription | 58 | **HOLD**: no route passes the floors (nearest agy Gemini 4 Argon low (CLI), P(floors) 0.00) | | | | | | | | agy Gemini 4 Argon low (CLI) (1.00) | none / none |
| syriac | prose | no web transcription | 40 | **HOLD**: no route passes the floors (nearest Sophro (GPU/CPU), P(floors) 0.08) | | | | | | | | Sophro (GPU/CPU) (1.00) | none / none |
| syriac-print | prose | no web transcription | 20 | **HOLD**: no route passes the floors (nearest Kraken OmniSyr (GPU/CPU), P(floors) 0.23) | | | | | | | | Kraken OmniSyr (GPU/CPU) (1.00) | none / none |
