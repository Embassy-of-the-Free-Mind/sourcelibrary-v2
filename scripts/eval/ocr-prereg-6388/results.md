### latin-print (n = 30 works) — provisional (AI-consensus key)

Stored OCR models: gemini-3-flash-preview 20, gemini-3.1-flash-lite-preview 7, gemini-3.1-flash-lite 3.

| engine | baseline | key | n | CER engine | CER baseline | gap (baseline − engine) [95% CI] | margin | verdict |
|---|---|---|---:|---:|---:|---|---:|---|
| G | L1 | {S, O} | 30 | 4.2 | 4.0 | -0.2 [-4.4, 4.0] | 1.0 | cannot be told apart |
| G | P | {S, O} | 30 | 4.2 | 2.9 | -1.3 [-5.1, 1.5] | 1.0 | cannot be told apart |
| S | L1 | {G, O} | 30 | 2.0 | 4.7 | 2.7 [0.8, 5.7] | 1.0 | cannot be told apart |
| S | P | {G, O} | 30 | 2.0 | 3.1 | 1.1 [-0.0, 2.3] | 1.0 | cannot be told apart |
| O | L1 | {G, S} | 30 | 9.1 | 5.1 | -3.9 [-7.2, -1.2] | 1.0 | no change |
| O | P | {G, S} | 30 | 9.1 | 3.4 | -5.7 [-12.0, -1.5] | 1.0 | no change |
| IA | L1 | {G, S, O} | 15 | 34.0 | 7.2 | -26.8 [-40.8, -16.1] | 1.0 | no change |
| IA | P | {G, S, O} | 15 | 34.0 | 4.6 | -29.4 [-45.2, -16.6] | 1.0 | no change |

| key | n | AA: CER(L1) − CER(L2) [95% CI] | band |
|---|---:|---|---:|
| {S, O} | 30 | -0.1 [-0.4, 0.1] | 0.4 |
| {G, O} | 30 | 0.0 [-0.0, 0.1] | 0.1 |
| {G, S} | 30 | -0.1 [-0.5, 0.1] | 0.5 |
| {G, S, O} | 30 | -0.1 [-0.4, 0.1] | 0.4 |

Outcomes: P text:30; L1 text:30; L2 text:30; G text:30; S text:30; O text:30; IA missing:15/text:15.

### zh-manuscript (n = 30 works) — provisional (AI-consensus key)

Stored OCR models: PaddleOCR-VL-1.6-0.9B 27, gemini-3-flash-preview 3.

| engine | baseline | key | n | CER engine | CER baseline | gap (baseline − engine) [95% CI] | margin | verdict |
|---|---|---|---:|---:|---:|---|---:|---|
| G | L1 | {S} | 30 | 20.3 | 39.8 | 19.5 [9.4, 30.6] | 3.3 | switch |
| G | P | {S} | 30 | 20.3 | 19.4 | -0.8 [-3.6, 1.7] | 3.3 | no change |
| S | L1 | {G} | 30 | 19.8 | 37.9 | 18.0 [7.6, 29.5] | 3.2 | switch |
| S | P | {G} | 30 | 19.8 | 14.4 | -5.4 [-9.9, -1.4] | 3.2 | no change |
| P | L1 | {G, S} | 30 | 9.3 | 33.8 | 24.5 [12.4, 37.9] | 4.5 | switch |

| key | n | AA: CER(L1) − CER(L2) [95% CI] | band |
|---|---:|---|---:|
| {S} | 30 | -1.0 [-3.3, 0.6] | 3.3 |
| {G} | 30 | -0.7 [-3.2, 1.1] | 3.2 |
| {G, S} | 30 | -1.2 [-4.5, 0.9] | 4.5 |

Outcomes: P text:30; L1 text:30; L2 text:30; G text:30; S text:30; O missing:30; IA missing:30.

### english-print (n = 30 works) — provisional (AI-consensus key)

Stored OCR models: gemini-3-flash-preview 20, ia-ocr/0.0.21 1, gemini-3.1-flash-lite 5, gemini-3.1-flash-lite-preview 2, null 1, gemini-2.5-flash 1.

| engine | baseline | key | n | CER engine | CER baseline | gap (baseline − engine) [95% CI] | margin | verdict |
|---|---|---|---:|---:|---:|---|---:|---|
| G | L1 | {S, O} | 30 | 19.4 | 5.2 | -14.2 [-28.9, 0.2] | 9.9 | no change |
| G | P | {S, O} | 30 | 19.4 | 13.2 | -6.2 [-21.2, 7.4] | 9.9 | no change |
| S | L1 | {G, O} | 30 | 13.7 | 5.3 | -8.4 [-22.3, 5.1] | 9.9 | no change |
| S | P | {G, O} | 30 | 13.7 | 13.1 | -0.6 [-17.8, 15.9] | 9.9 | cannot be told apart |
| O | L1 | {G, S} | 29 | 7.3 | 5.4 | -1.9 [-11.8, 8.2] | 10.2 | no change |
| O | P | {G, S} | 29 | 7.3 | 13.8 | 6.4 [-6.0, 19.2] | 10.2 | cannot be told apart |
| IA | L1 | {G, S, O} | 22 | 14.5 | 2.6 | -11.9 [-22.4, -4.2] | 9.8 | no change |
| IA | P | {G, S, O} | 22 | 14.5 | 17.9 | 3.4 [-12.6, 19.5] | 9.8 | cannot be told apart |

| key | n | AA: CER(L1) − CER(L2) [95% CI] | band |
|---|---:|---|---:|
| {S, O} | 30 | 3.3 [-0.1, 9.9] | 9.9 |
| {G, O} | 30 | 3.2 [-0.2, 9.9] | 9.9 |
| {G, S} | 29 | 3.3 [-0.1, 10.2] | 10.2 |
| {G, S, O} | 30 | 3.2 [-0.2, 9.8] | 9.8 |

Outcomes: P text:29/empty:1; L1 text:29/refusal:1; L2 text:30; G text:27/failed:1/refusal:2; S refusal:4/text:26; O text:30; IA text:22/missing:8.

### Adjudication lists

| stratum | pages | pages with spans | spans | median spans per page |
|---|---:|---:|---:|---:|
| latin-print | 30 | 30 | 1071 | 18 |
| zh-manuscript | 30 | 30 | 311 | 9 |
| english-print | 30 | 27 | 425 | 9 |

Paid spend (flash-lite L1 + L2, list price): $0.408.
