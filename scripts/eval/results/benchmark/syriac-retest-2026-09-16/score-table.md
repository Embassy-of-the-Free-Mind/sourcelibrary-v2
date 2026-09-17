
## syriac-gt (n=40)
| engine | run | empty | loops | aligned | median page CER (N1 / N2) | median LINE CER (order-free) | ≤0.20 | >0.5 | median Dice | vs lite W/L/T (p, line CER) |
|---|---|---|---|---|---|---|---|---|---|---|
| gemini-3-flash-preview | 40 | 0 | 3 | 40 | 0.854 / 0.767 | 0.736 | 1 | 37 | 0.174 | 25/12/3 (p=0.047) |
| gemini-3.1-flash-lite | 40 | 1 | 16 | 39 | 1.027 / 0.982 | 0.791 | 0 | 39 | 0.077 | — |
| omnisyr | 40 | 0 | 0 | 40 | 0.732 / 0.718 | 0.601 | 0 | 40 | 0.041 | 35/5/0 (p=0.0) |
| qoruyo-eastern | 40 | 0 | 0 | 40 | 0.755 / 0.746 | 0.631 | 0 | 40 | 0.037 | 34/6/0 (p=0.0) |
| qoruyo-estrangela | 40 | 0 | 0 | 40 | 0.702 / 0.688 | 0.601 | 0 | 40 | 0.056 | 37/3/0 (p=0.0) |
| sophro-defaultseg | 40 | 0 | 0 | 40 | 0.4 / 0.376 | 0.188 | 9 | 17 | 0.633 | 40/0/0 (p=0.0) |
  jerusalem36 (line CER): gemini-3-flash-preview 0.877; gemini-3.1-flash-lite 0.823; omnisyr 0.573; qoruyo-eastern 0.617; qoruyo-estrangela 0.556; sophro-defaultseg 0.173
  onb-syr1 (line CER): gemini-3-flash-preview 0.625; gemini-3.1-flash-lite 0.739; omnisyr 0.648; qoruyo-eastern 0.67; qoruyo-estrangela 0.646; sophro-defaultseg 0.232

## syriac (n=28)
| engine | run | empty | loops | median loop score | median Dice vs served |
|---|---|---|---|---|---|
| gemini-3-flash-preview | 28 | 0 | 1 | 0.027 | — |
| gemini-3.1-flash-lite | 28 | 0 | 3 | 0.034 | — |
| kraken-sophro-mhiro-defaultseg | 28 | 0 | 0 | 0.017 | — |
| omnisyr | 28 | 2 | 0 | 0.018 | — |
| qoruyo-eastern | 28 | 0 | 0 | 0.024 | — |
| qoruyo-estrangela | 28 | 0 | 0 | 0.017 | — |
| sophro-defaultseg | 28 | 0 | 0 | 0.017 | — |
| tesseract-syr | 28 | 1 | 0 | 0.018 | — |

  syriac-146d10-p81: gemini-3-flash loop=0.017 chars=934 | gemini-3.1-fla loop=0.02 chars=1119 | kraken-sophro- loop=0.018 chars=900 | omnisyr loop=0.017 chars=1308 | qoruyo-eastern loop=0.018 chars=1302 | qoruyo-estrang loop=0.018 chars=1214 | sophro-default loop=0.018 chars=900 | tesseract-syr loop=0.015 chars=1374

  syriac-4134ce-p91: gemini-3-flash loop=0.012 chars=2873 | gemini-3.1-fla loop=0.043 chars=2763 | kraken-sophro- loop=0.011 chars=2938 | omnisyr loop=0.006 chars=3034 | qoruyo-eastern loop=0.006 chars=3022 | qoruyo-estrang loop=0.006 chars=2977 | sophro-default loop=0.011 chars=2938 | tesseract-syr loop=0.006 chars=2905

  syriac-4138c1-p623: gemini-3-flash loop=0.024 chars=2611 | gemini-3.1-fla loop=0.015 chars=1334 | kraken-sophro- loop=0.008 chars=1981 | omnisyr loop=0.016 chars=1269 | qoruyo-eastern loop=0.016 chars=1212 | qoruyo-estrang loop=0.016 chars=1115 | sophro-default loop=0.016 chars=1981 | tesseract-syr loop=0.005 chars=2648

  syriac-42e92d-p15: gemini-3-flash loop=0.017 chars=2339 | gemini-3.1-fla loop=0.03 chars=1882 | kraken-sophro- loop=0.015 chars=2101 | omnisyr loop=0.011 chars=1686 | qoruyo-eastern loop=0.017 chars=1296 | qoruyo-estrang loop=0.012 chars=1571 | sophro-default loop=0.015 chars=2101 | tesseract-syr loop=0.012 chars=2163

  syriac-42e95b-p84: gemini-3-flash loop=0.016 chars=1083 | gemini-3.1-fla loop=0.034 chars=956 | kraken-sophro- loop=0.017 chars=1040 | omnisyr loop=0.016 chars=1096 | qoruyo-eastern loop=0.018 chars=943 | qoruyo-estrang loop=0.016 chars=1065 | sophro-default loop=0.017 chars=1040 | tesseract-syr loop=0.016 chars=1099

  syriac-46821a-p128: gemini-3-flash loop=0.195 chars=19740 | gemini-3.1-fla loop=0.05 chars=876 | kraken-sophro- loop=0.014 chars=1236 | omnisyr loop=0.014 chars=1438 | qoruyo-eastern loop=0.018 chars=974 | qoruyo-estrang loop=0.014 chars=1432 | sophro-default loop=0.014 chars=1236 | tesseract-syr loop=0.013 chars=1398

  syriac-4683f6-p352: gemini-3-flash loop=0.044 chars=991 | gemini-3.1-fla loop=0.513 chars=821 | kraken-sophro- loop=0.018 chars=840 | omnisyr loop=0.024 chars=791 | qoruyo-eastern loop=0.029 chars=773 | qoruyo-estrang loop=0.029 chars=751 | sophro-default loop=0.018 chars=840 | tesseract-syr loop=0.018 chars=731

  syriac-468b5e-p183: gemini-3-flash loop=0.018 chars=909 | gemini-3.1-fla loop=0.034 chars=870 | kraken-sophro- loop=0.017 chars=869 | omnisyr loop=0.018 chars=931 | qoruyo-eastern loop=0.018 chars=921 | qoruyo-estrang loop=0.017 chars=911 | sophro-default loop=0.017 chars=869 | tesseract-syr loop=0.017 chars=872

  syriac-56aae6-p595: gemini-3-flash loop=0.013 chars=2606 | gemini-3.1-fla loop=0.013 chars=2616 | kraken-sophro- loop=0.007 chars=2060 | omnisyr loop=0.034 chars=327 | qoruyo-eastern loop=0.04 chars=481 | qoruyo-estrang loop=0.026 chars=454 | sophro-default loop=0.007 chars=2060 | tesseract-syr loop=0.005 chars=2888

  syriac-6a7c29-p220: gemini-3-flash loop=0.034 chars=942 | gemini-3.1-fla loop=2.97 chars=12012 | kraken-sophro- loop=0.033 chars=907 | omnisyr loop=0.034 chars=1320 | qoruyo-eastern loop=0.034 chars=1309 | qoruyo-estrang loop=0.034 chars=1226 | sophro-default loop=0.033 chars=907 | tesseract-syr loop=0.034 chars=1316

  syriac-75771a-p235: gemini-3-flash loop=0.026 chars=1144 | gemini-3.1-fla loop=0.043 chars=972 | kraken-sophro- loop=0.032 chars=1081 | omnisyr loop=0.016 chars=1138 | qoruyo-eastern loop=0.016 chars=1127 | qoruyo-estrang loop=0.033 chars=1114 | sophro-default loop=0.032 chars=1081 | tesseract-syr loop=0.027 chars=1224

  syriac-883e43-p413: gemini-3-flash loop=0.019 chars=3544 | gemini-3.1-fla loop=0.124 chars=5777 | kraken-sophro- loop=0.01 chars=3455 | omnisyr loop=0.009 chars=4937 | qoruyo-eastern loop=0.01 chars=4768 | qoruyo-estrang loop=0.005 chars=4616 | sophro-default loop=0.01 chars=3455 | tesseract-syr loop=0.005 chars=4725

  syriac-8879b3-p49: gemini-3-flash loop=0.021 chars=761 | gemini-3.1-fla loop=0.039 chars=648 | kraken-sophro- loop=0.025 chars=674 | omnisyr loop=0.023 chars=622 | qoruyo-eastern loop=0.038 chars=382 | qoruyo-estrang loop=0.029 chars=570 | sophro-default loop=0.025 chars=674 | tesseract-syr loop=0.024 chars=391

  syriac-9f535f-p265: gemini-3-flash loop=0.031 chars=1062 | gemini-3.1-fla loop=0.031 chars=963 | kraken-sophro- loop=0.018 chars=764 | omnisyr loop=0.059 chars=199 | qoruyo-eastern loop=0.1 chars=111 | qoruyo-estrang loop=0.057 chars=210 | sophro-default loop=0.018 chars=764 | tesseract-syr loop=0.013 chars=893

  syriac-b899e7-p169: gemini-3-flash loop=0.011 chars=1483 | gemini-3.1-fla loop=0.011 chars=1396 | kraken-sophro- loop=0.013 chars=1073 | omnisyr loop=0.03 chars=467 | qoruyo-eastern loop=0.042 chars=296 | qoruyo-estrang loop=0.026 chars=581 | sophro-default loop=0.013 chars=1073 | tesseract-syr loop=0.049 chars=176

  syriac-b89aa5-p213: gemini-3-flash loop=0.02 chars=1915 | gemini-3.1-fla loop=0.031 chars=1042 | kraken-sophro- loop=0.012 chars=1199 | omnisyr loop=0.025 chars=555 | qoruyo-eastern loop=0.037 chars=247 | qoruyo-estrang loop=0.037 chars=276 | sophro-default loop=0.012 chars=1199 | tesseract-syr loop=0.0 chars=26

  syriac-cb80e3-p369: gemini-3-flash loop=0.028 chars=1291 | gemini-3.1-fla loop=0.749 chars=17330 | kraken-sophro- loop=0.025 chars=1273 | omnisyr loop=0.033 chars=375 | qoruyo-eastern loop=0.03 chars=430 | qoruyo-estrang loop=0.029 chars=464 | sophro-default loop=0.025 chars=1273 | tesseract-syr loop=0.136 chars=54

  syriac-cb88c5-p185: gemini-3-flash loop=0.035 chars=1558 | gemini-3.1-fla loop=0.02 chars=1525 | kraken-sophro- loop=0.025 chars=1385 | omnisyr loop=0.039 chars=461 | qoruyo-eastern loop=0.015 chars=1228 | qoruyo-estrang loop=0.016 chars=1198 | sophro-default loop=0.025 chars=1385 | tesseract-syr loop=0.01 chars=1396

  syriac-cb8a85-p221: gemini-3-flash loop=0.079 chars=408 | gemini-3.1-fla loop=0.024 chars=1290 | kraken-sophro- loop=0.021 chars=631 | omnisyr loop=0.038 chars=269 | qoruyo-eastern loop=0.081 chars=127 | qoruyo-estrang loop=0.037 chars=312 | sophro-default loop=0.021 chars=631 | tesseract-syr loop=0.057 chars=175

  syriac-cb9324-p377: gemini-3-flash loop=0.052 chars=2210 | gemini-3.1-fla loop=0.052 chars=2214 | kraken-sophro- loop=0.008 chars=1855 | omnisyr loop=0.048 chars=440 | qoruyo-eastern loop=0.051 chars=599 | qoruyo-estrang loop=0.014 chars=1262 | sophro-default loop=0.008 chars=1855 | tesseract-syr loop=0.019 chars=566

  syriac-dc867e-p63: gemini-3-flash loop=0.098 chars=18443 | gemini-3.1-fla loop=0.023 chars=2580 | kraken-sophro- loop=0.015 chars=1024 | omnisyr loop=0.018 chars=895 | qoruyo-eastern loop=0.032 chars=337 | qoruyo-estrang loop=0.019 chars=732 | sophro-default loop=0.015 chars=1024 | tesseract-syr loop=0.103 chars=100

  syriac-dc8750-p155: gemini-3-flash loop=0.009 chars=8855 | gemini-3.1-fla loop=0.03 chars=2258 | kraken-sophro- loop=0.01 chars=1657 | omnisyr loop=0.01 chars=1492 | qoruyo-eastern loop=0.018 chars=731 | qoruyo-estrang loop=0.012 chars=1310 | sophro-default loop=0.01 chars=1657 | tesseract-syr loop=0.009 chars=1184

  syriac-dc89ba-p137: gemini-3-flash loop=0.104 chars=791 | gemini-3.1-fla loop=0.487 chars=12007 | kraken-sophro- loop=0.018 chars=872 | omnisyr loop=0.021 chars=864 | qoruyo-eastern loop=0.032 chars=448 | qoruyo-estrang loop=0.02 chars=819 | sophro-default loop=0.018 chars=872 | tesseract-syr loop=0.079 chars=134

  syriac-dc8d25-p49: gemini-3-flash loop=0.419 chars=19860 | gemini-3.1-fla loop=0.176 chars=119 | kraken-sophro- loop=0.12 chars=129 | omnisyr loop=0.0 chars=25 | qoruyo-eastern loop=0.0 chars=35 | qoruyo-estrang loop=0.0 chars=76 | sophro-default loop=0.12 chars=129 | tesseract-syr loop=0.088 chars=130

  syriac-dc8d8f-p42: gemini-3-flash loop=0.261 chars=181 | gemini-3.1-fla loop=0.176 chars=119 | kraken-sophro- loop=0.115 chars=133 | omnisyr loop=0.0 chars=17 | qoruyo-eastern loop=0.0 chars=42 | qoruyo-estrang loop=0.0 chars=66 | sophro-default loop=0.115 chars=133 | tesseract-syr loop=0.107 chars=113

  syriac-dc8e20-p730: gemini-3-flash loop=0.008 chars=1940 | gemini-3.1-fla loop=0.024 chars=1901 | kraken-sophro- loop=0.012 chars=1209 | omnisyr loop=0.176 chars=51 | qoruyo-eastern loop=0.25 chars=41 | qoruyo-estrang loop=0.0 chars=64 | sophro-default loop=0.012 chars=1209 | tesseract-syr loop=0.13 chars=104

  syriac-dc9416-p448: gemini-3-flash loop=0.743 chars=16598 | gemini-3.1-fla loop=0.012 chars=4924 | kraken-sophro- loop=0.004 chars=3910 | omnisyr loop=0.006 chars=2581 | qoruyo-eastern loop=0.01 chars=1300 | qoruyo-estrang loop=0.007 chars=2170 | sophro-default loop=0.008 chars=3910 | tesseract-syr loop=0.011 chars=1245

  syriac-dc961e-p171: gemini-3-flash loop=0.229 chars=18475 | gemini-3.1-fla loop=0.049 chars=874 | kraken-sophro- loop=0.028 chars=1053 | omnisyr loop=0.016 chars=1129 | qoruyo-eastern loop=0.038 chars=336 | qoruyo-estrang loop=0.016 chars=1024 | sophro-default loop=0.028 chars=1053 | tesseract-syr loop=0.025 chars=541

## print-loop (n=8)
| engine | run | empty | loops | median loop score | median Dice vs served |
|---|---|---|---|---|---|
| gemini-3-flash-preview | 8 | 0 | 0 | 0.028 | 0.132 |
| gemini-3.1-flash-lite | 8 | 0 | 3 | 0.293 | 0.192 |
| omnisyr | 8 | 0 | 0 | 0.018 | 0.083 |
| qoruyo-eastern | 8 | 0 | 0 | 0.018 | 0.095 |
| qoruyo-estrangela | 8 | 0 | 0 | 0.018 | 0.09 |
| served-gemini | 8 | 0 | 4 | 0.441 | 1.0 |
| sophro-defaultseg | 8 | 0 | 0 | 0.018 | 0.062 |

  chronicon-p451-clean: gemini-3-flash loop=0.024 chars=2112 | gemini-3.1-fla loop=0.025 chars=1854 | omnisyr loop=0.012 chars=1999 | qoruyo-eastern loop=0.012 chars=1983 | qoruyo-estrang loop=0.012 chars=1860 | served-gemini loop=0.026 chars=1713 | sophro-default loop=0.012 chars=1379

  chronicon-p500-loop: gemini-3-flash loop=0.025 chars=1816 | gemini-3.1-fla loop=0.568 chars=11592 | omnisyr loop=0.012 chars=1966 | qoruyo-eastern loop=0.013 chars=1954 | qoruyo-estrang loop=0.013 chars=1858 | served-gemini loop=0.919 chars=13240 | sophro-default loop=0.013 chars=1346

  ethicon-p264-clean: gemini-3-flash loop=0.036 chars=1257 | gemini-3.1-fla loop=2.681 chars=11725 | omnisyr loop=0.034 chars=1300 | qoruyo-eastern loop=0.035 chars=1286 | qoruyo-estrang loop=0.018 chars=1195 | served-gemini loop=0.034 chars=1260 | sophro-default loop=0.037 chars=889

  ethicon-p571-loop: gemini-3-flash loop=0.075 chars=1295 | gemini-3.1-fla loop=0.065 chars=1073 | omnisyr loop=0.037 chars=1331 | qoruyo-eastern loop=0.037 chars=1321 | qoruyo-estrang loop=0.019 chars=1241 | served-gemini loop=0.74 chars=18804 | sophro-default loop=0.038 chars=927

  kalilah-p139-clean: gemini-3-flash loop=0.045 chars=1062 | gemini-3.1-fla loop=0.09 chars=1024 | omnisyr loop=0.032 chars=1020 | qoruyo-eastern loop=0.016 chars=996 | qoruyo-estrang loop=0.032 chars=1002 | served-gemini loop=0.141 chars=1012 | sophro-default loop=0.047 chars=995

  kalilah-p447-loop: gemini-3-flash loop=0.031 chars=1090 | gemini-3.1-fla loop=0.496 chars=18537 | omnisyr loop=0.018 chars=969 | qoruyo-eastern loop=0.019 chars=951 | qoruyo-estrang loop=0.019 chars=956 | served-gemini loop=0.996 chars=18520 | sophro-default loop=0.017 chars=1010

  liber-superiorum-p449-loop: gemini-3-flash loop=0.017 chars=1282 | gemini-3.1-fla loop=1.931 chars=1045 | omnisyr loop=0.018 chars=1278 | qoruyo-eastern loop=0.018 chars=1270 | qoruyo-estrang loop=0.018 chars=1165 | served-gemini loop=0.976 chars=12836 | sophro-default loop=0.018 chars=874

  liber-superiorum-p80-clean: gemini-3-flash loop=0.019 chars=1375 | gemini-3.1-fla loop=0.037 chars=1073 | omnisyr loop=0.018 chars=1294 | qoruyo-eastern loop=0.018 chars=1284 | qoruyo-estrang loop=0.019 chars=1209 | served-gemini loop=0.056 chars=1146 | sophro-default loop=0.019 chars=883
