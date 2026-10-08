# Reader diversity (#6184): results

63 slots (36 disputed, 27 control) on 30 pages; 390 new reads, metered $2.13 at list price; 128 of 1008 slot-reads scored by the page-wide fallback.

## 1. Accuracy vs print (reads right / reads)

| arm | all | disputed | control |
|---|---|---|---|
| F0 | 46/63 = 73% [60–83] | 21/36 = 58% [41–74] | 25/27 = 93% [76–99] |
| Fs | 39/63 = 62% [49–74] | 14/36 = 39% [23–57] | 25/27 = 93% [76–99] |
| F1 | 212/315 = 67% [62–72] | 89/180 = 49% [42–57] | 123/135 = 91% [85–95] |
| L1 | 215/315 = 68% [63–73] | 96/180 = 53% [46–61] | 119/135 = 88% [81–93] |
| Ls | 47/63 = 75% [62–85] | 22/36 = 61% [43–77] | 25/27 = 93% [76–99] |
| P | 171/189 = 90% [85–94] | 90/108 = 83% [75–90] | 81/81 = 100% [96–100] |

F1 per sample (all slots): 42/63, 37/63, 42/63, 44/63, 47/63

L1 per sample (all slots): 43/63, 42/63, 45/63, 43/63, 42/63

P per sample (all slots): 56/63, 57/63, 58/63

## 2. Within-arm disagreement (slot varies across samples)

| arm | all | disputed | control |
|---|---|---|---|
| F1 | 30/63 = 48% [35–61] | 24/36 = 67% [49–81] | 6/27 = 22% [9–42] |
| L1 | 27/63 = 43% [30–56] | 22/36 = 61% [43–77] | 5/27 = 19% [6–38] |
| P | 12/63 = 19% [10–31] | 12/36 = 33% [19–51] | 0/27 = 0% [0–13] |

A-vs-A at served config (fresh F0 vs stored Batch Flash read): 16/63 slots differ

## 3. (a) Confident vs uncertain errors

- F0 (served config) wrong → F1 samples: n=17; confident (all samples the same wrong token) 3/17 = 18% [4–43]; uncertain (samples vary) 10/17 = 59% [33–82]; all samples right 4
- stored served Flash wrong → F1 samples: n=24; confident (all samples the same wrong token) 3/24 = 13% [3–32]; uncertain (samples vary) 18/24 = 75% [53–90]; all samples right 3
- L1 majority wrong → L1 samples: n=19; confident (all samples the same wrong token) 3/19 = 16% [3–40]; uncertain (samples vary) 16/19 = 84% [60–97]; all samples right 0
- Pro majority wrong → Pro reads: n=4; confident (all samples the same wrong token) 1/4 = 25% [1–81]; uncertain (samples vary) 3/4 = 75% [19–99]; all samples right 0

## 4. Does "any sample differs" flag the error?

- F1 disagreement → F0 wrong [all]: errors 17/63; recall 10/17 = 59% [33–82]; precision 10/30 = 33% [17–53]; AUC 0.57
- F1 disagreement → F0 wrong [control]: errors 2/27; recall 2/2 = 100% [16–100]; precision 2/6 = 33% [4–78]; AUC 0.92
- F1 disagreement → stored served Flash wrong [all]: errors 24/63; recall 18/24 = 75% [53–90]; precision 18/30 = 60% [41–77]; AUC 0.74
- F1 disagreement → stored served Flash wrong [control]: errors 2/27; recall 2/2 = 100% [16–100]; precision 2/6 = 33% [4–78]; AUC 0.92
- F1 disagreement → F1 majority wrong [all]: errors 22/63; recall 18/22 = 82% [60–95]; precision 18/30 = 60% [41–77]; AUC 0.83
- F1 disagreement → F1 majority wrong [control]: errors 2/27; recall 2/2 = 100% [16–100]; precision 2/6 = 33% [4–78]; AUC 0.92
- L1 disagreement → L1 majority wrong [all]: errors 19/63; recall 16/19 = 84% [60–97]; precision 16/27 = 59% [39–78]; AUC 0.86
- L1 disagreement → L1 majority wrong [control]: errors 2/27; recall 1/2 = 50% [1–99]; precision 1/5 = 20% [1–72]; AUC 0.71
- Pro (3 reads) disagreement → stored served Flash wrong [all]: errors 24/63; recall 6/24 = 25% [10–47]; precision 6/12 = 50% [21–79]; AUC 0.55
- Pro (3 reads) disagreement → stored served Flash wrong [control]: errors 2/27; recall 0/2 = 0% [0–84]; precision 0/0; AUC 0.50

## 5. (b) Pairwise error correlation (phi on per-slot wrong/right; P(B wrong | A wrong))

| pair | all: phi | all: P(B✗|A✗) | control: phi | control: P(B✗|A✗) |
|---|---|---|---|---|
| Flash T1 sample i vs j | 0.55 | 0.64 | 0.42 | 0.47 |
| lite T1 sample i vs j | 0.61 | 0.74 | 0.55 | 0.68 |
| Pro read i vs j | 0.26 | 0.29 | NaN | — |
| Flash vs lite (T1, sample i vs i) | 0.23 | 0.47 | 0.32 | 0.38 |
| Flash vs Pro | 0.09 | 0.13 | NaN | 0.00 |
| lite vs Pro | 0.23 | 0.20 | NaN | 0.00 |

## 6. Direction of wrong reads (aligned span vs print length)

| arm | omission (shorter) | insertion (longer) | substitution |
|---|---|---|---|
| F0 | 10 | 6 | 1 |
| Fs | 13 | 10 | 1 |
| F1 | 56 | 28 | 19 |
| L1 | 64 | 20 | 16 |
| Ls | 9 | 6 | 1 |
| P | 15 | 3 | 0 |

## 7. Majority vote = print (strict majority; tie or wrong plurality = not right)

| voters | all | disputed | control |
|---|---|---|---|
| served Flash alone (F0) | 46/63 = 73% [60–83] | 21/36 = 58% [41–74] | 25/27 = 93% [76–99] |
| 5× Flash T1 | 41/63 = 65% [52–77] | 16/36 = 44% [28–62] | 25/27 = 93% [76–99] |
| 5× lite T1 | 44/63 = 70% [57–81] | 19/36 = 53% [35–70] | 25/27 = 93% [76–99] |
| Flash F0 + lite L1[0] + Pro P0 (one per family) | 52/63 = 83% [71–91] | 26/36 = 72% [55–86] | 26/27 = 96% [81–100] |
| stored Flash + stored lite + Pro P0 (the tie-break) | 54/63 = 86% [75–93] | 29/36 = 81% [64–92] | 25/27 = 93% [76–99] |
| 3× Flash T1 + Pro P0 (needs ≥3 of 4) | 40/63 = 63% [50–75] | 15/36 = 42% [26–59] | 25/27 = 93% [76–99] |
| 3× Pro | 59/63 = 94% [85–98] | 32/36 = 89% [74–97] | 27/27 = 100% [87–100] |

## Per slot (1 = right; F0 | Fs | F1×5 | L1×5 | Ls | P0 P1 P1)

- d00 disputed eddd:760 तदेतदस्मरणमकारणमनुभूताभावसिद्धये — 0 | 0 | 10000 | 11111 | 1 | 101
- d01 disputed f107:300 तदयुक्तम् — 1 | 1 | 11111 | 00000 | 0 | 111
- d02 disputed f107:300 कारणभेदप्रतिनियमोऽस्ति — 1 | 1 | 00000 | 00000 | 0 | 111
- d03 disputed eddd:206 अतश्चानुपलम्भादाकरे — 0 | 0 | 00000 | 10110 | 1 | 111
- d04 disputed eddd:432 प्रासादमालादिषु — 1 | 0 | 01111 | 11100 | 1 | 111
- d05 disputed eddd:432 महदादिप्रत्ययप्रसूतिरनुभूयते — 0 | 1 | 00000 | 11011 | 0 | 111
- d06 disputed eddd:601 हेतोरभिव्यनक्ति — 1 | 1 | 01001 | 01111 | 0 | 111
- d08 disputed f107:91 सकल्पनत्वाच्च — 1 | 1 | 00000 | 00000 | 0 | 111
- d09 disputed f107:194 प्रमाणान्तरापेक्षायामनवस्था — 0 | 0 | 00011 | 11111 | 1 | 111
- d10 disputed f107:194 प्रतिषिद्धत्वादयथाभूतसाधनम् — 1 | 1 | 11111 | 00100 | 0 | 111
- d11 disputed f107:259 ज्ञानमप्रतिघं — 1 | 1 | 11111 | 00000 | 0 | 111
- d12 disputed eddd:155 निरोधसत्यस्यास्मिन्नसंस्कृते — 1 | 1 | 11100 | 00000 | 0 | 011
- d13 disputed f107:154 अवस्थातुरव्यतिरेकात् — 0 | 0 | 00001 | 10010 | 1 | 111
- d14 disputed f107:166 सत्यार्थं — 1 | 1 | 10111 | 00000 | 0 | 011
- d15 disputed eddd:724 नचैवमिह — 0 | 0 | 00010 | 11111 | 1 | 111
- d16 disputed f107:446 कार्यत्वान्यत्वलेशे — 0 | 0 | 00000 | 01000 | 1 | 101
- d17 disputed eddd:193 पूर्वस्वभावात्यागेन — 0 | 1 | 11111 | 00101 | 0 | 001
- d18 disputed f107:430 ज्ञातरि — 0 | 0 | 00101 | 11111 | 1 | 111
- d19 disputed eddd:766 भावाभावाविपर्ययस्तत्तस्य — 1 | 1 | 11111 | 00000 | 0 | 010
- d20 disputed f107:133 शक्तिरवस्थिता — 1 | 0 | 01010 | 10011 | 1 | 111
- d21 disputed eddd:648 लिङ्गमिष्टं — 0 | 0 | 11111 | 11111 | 1 | 101
- d22 disputed f107:259 घतोच्यते — 1 | 0 | 10111 | 11111 | 1 | 111
- d23 disputed eddd:234 सक्रियमनेकमाश्रितं — 0 | 0 | 00000 | 00101 | 1 | 110
- d24 disputed f107:344 नाथानां — 1 | 0 | 10111 | 11111 | 1 | 111
- d25 disputed eddd:243 व्यापकानुपलब्धिः — 0 | 0 | 01010 | 11111 | 1 | 110
- d26 disputed f107:391 तानुपाश्रित्य — 1 | 0 | 00010 | 11001 | 1 | 111
- d27 disputed f107:204 दाहपाकनिर्भासि — 1 | 1 | 00001 | 00111 | 0 | 010
- d28 disputed eddd:403 नोचेदणूत्पादकमिष्यते — 0 | 0 | 00000 | 01000 | 1 | 101
- d29 disputed eddd:167 नानाकारावभासा — 1 | 0 | 10001 | 11111 | 1 | 111
- d31 disputed eddd:174 ब्रह्मानेकं — 1 | 0 | 00010 | 00000 | 1 | 111
- d32 disputed eddd:284 नाशोत्पादासमालीढं — 1 | 0 | 10101 | 11111 | 1 | 111
- d33 disputed eddd:521 भवन्मतेन — 1 | 1 | 00111 | 00000 | 0 | 000
- d34 disputed eddd:752 नियोगाभावप्रसङ्गाच्च — 1 | 1 | 11101 | 00101 | 0 | 011
- d35 disputed f107:284 सन्दिग्धासिद्धतेति — 0 | 0 | 11111 | 11111 | 1 | 111
- d36 disputed f107:284 संभाव्यमानत्वात्संदिग्धासिद्धत्वमभावप्रमाणविषयीकृतत्वादित्यस्य — 0 | 0 | 11111 | 11111 | 1 | 111
- c37 control f107:154 यदेकयोगक्षेमं — 0 | 1 | 00001 | 11010 | 1 | 111
- c38 control f107:166 स्यादन्योऽप्यागमोऽकृतः — 1 | 1 | 11111 | 00100 | 1 | 111
- c40 control f107:430 चैत्रज्ञानं — 1 | 1 | 11111 | 11111 | 1 | 111
- c41 control f107:133 एकस्यैव — 1 | 1 | 11111 | 11111 | 1 | 111
- c42 control f107:259 तत्सर्वार्थगोचरम् — 1 | 1 | 11111 | 11111 | 1 | 111
- c43 control f107:344 बुद्धानामुपदेशनम् — 1 | 1 | 11111 | 11111 | 1 | 111
- c44 control f107:391 तादृगेव — 1 | 1 | 11111 | 11111 | 1 | 111
- c46 control f107:300 मार्गदोषयोः — 1 | 1 | 11111 | 11111 | 1 | 111
- c47 control f107:91 मिथ्यात्वहेतुरज्ञात — 1 | 1 | 11111 | 11110 | 1 | 111
- c48 control f107:194 प्रमाणमिथ्यात्वं — 1 | 1 | 11111 | 11111 | 1 | 111
- c49 control f107:284 हेतुर्नापि — 1 | 1 | 11111 | 11111 | 1 | 111
- c50 control eddd:724 मन्तव्यमध्वभेदः — 1 | 1 | 11110 | 11111 | 1 | 111
- c51 control eddd:193 कारित्रस्येव — 0 | 0 | 00001 | 00000 | 0 | 111
- c53 control eddd:648 तल्लौकिकाभ्यनुज्ञाते — 1 | 1 | 10111 | 11111 | 1 | 111
- c54 control eddd:234 महदादयः — 1 | 1 | 11111 | 01110 | 1 | 111
- c55 control eddd:243 नास्तीति — 1 | 1 | 11111 | 11111 | 1 | 111
- c56 control eddd:403 गुणावयवभेदवान् — 1 | 0 | 11011 | 11111 | 0 | 111
- c57 control eddd:167 माध्यमिकवादिन — 1 | 1 | 11111 | 11111 | 1 | 111
- c59 control eddd:760 सत्यप्यनुभवे — 1 | 1 | 11111 | 11111 | 1 | 111
- c60 control eddd:206 कुमारिलस्यैव — 1 | 1 | 11111 | 11111 | 1 | 111
- c61 control eddd:432 नोपचारस्य — 1 | 1 | 11111 | 11111 | 1 | 111
- c62 control eddd:601 बुद्ध्या — 1 | 1 | 11111 | 11111 | 1 | 111
- c63 control eddd:155 यद्यप्यय — 1 | 1 | 11111 | 10101 | 1 | 111
- c64 control eddd:174 यदीष्यते — 1 | 1 | 11111 | 11111 | 1 | 111
- c65 control eddd:284 प्रतीयते — 1 | 1 | 11111 | 11111 | 1 | 111
- c66 control eddd:521 तस्याभावस्यासिद्धौ — 1 | 1 | 10111 | 11111 | 1 | 111
- c67 control eddd:752 प्रतीतिप्रसङ्गात् — 1 | 1 | 11111 | 11111 | 1 | 111
- d68 disputed f107:300 कारणभेदाप्रतिनियमान्न — 1 | 0 | 10100 | 10010 | 1 | 111
