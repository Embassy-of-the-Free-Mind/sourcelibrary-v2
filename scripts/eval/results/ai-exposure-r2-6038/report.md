# ai-exposure-r2-6038 report

Union (gated): gemini-3.1-pro-preview, claude-opus, openai/gpt-5.6-sol. W = 416.

**PRIMARY P = 52.2% [47.4–56.9] (217/416) — RETRACTED**

| gate | gemini-3.1-pro-preview | claude-opus | openai/gpt-5.6-sol | claude-haiku |
|---|---|---|---|---|
| canonical_scorable_V2 | 85.7% [65.4–95] (18/21) | 90.5% [71.1–97.3] (19/21) | 85.7% [65.4–95] (18/21) | 66.7% [45.4–82.8] (14/21) |
| known_tier_V2 | 95.5% [78.2–99.2] (21/22) | 95.5% [78.2–99.2] (21/22) | 90.9% [72.2–97.5] (20/22) | 68.2% [47.3–83.6] (15/22) |
| obscure_tier_V2 | 88% [70–95.8] (22/25) | 84% [65.3–93.6] (21/25) | 80% [60.9–91.1] (20/25) | 28% [14.3–47.6] (7/25) |
| decoy_known_yes | 2.5% [0.4–12.9] (1/40) | 0% [0–8.8] (0/40) | 2.5% [0.4–12.9] (1/40) | 5% [1.4–16.5] (2/40) |
| decoy_known_yes_in_sample_packets | 2.5% [0.4–12.9] (1/40) | 2.5% [0.4–12.9] (1/40) | 2.5% [0.4–12.9] (1/40) | 10% [4–23.1] (4/40) |
| shuffled_null_match | 0% [0–1.7] (0/219) | 0% [0–1.5] (0/254) | 0.4% [0.1–2.4] (1/232) | 0% [0–4.3] (0/86) |
| sample_missing | 0% [0–0.8] (0/500) | 0% [0–0.8] (0/500) | 0% [0–0.8] (0/500) | 0% [0–0.8] (0/500) |
| passed | true | true | true | false |

| P on W by model | 62.5% [57.8–67] (260/416) | 56.7% [51.9–61.4] (236/416) | 63.9% [59.2–68.4] (266/416) | 90.6% [87.4–93.1] (377/416) |


```json
{
 "primary": {
  "definition": "share of W (identifiable title, scorable catalogue author; random 500) with no author match by any union model",
  "W": 416,
  "union": [
   "gemini-3.1-pro-preview",
   "claude-opus",
   "openai/gpt-5.6-sol"
  ],
  "P": {
   "k": 217,
   "n": 416,
   "pct": 52.2,
   "ci95": [
    47.4,
    56.9
   ]
  },
  "numerator_with_unjudgeable_answer": 0,
  "P_excluding_unjudgeable": {
   "k": 217,
   "n": 416,
   "pct": 52.2,
   "ci95": [
    47.4,
    56.9
   ]
  },
  "verdict": "RETRACTED",
  "V1_known_yes_and_match": {
   "k": 244,
   "n": 416,
   "pct": 58.7,
   "ci95": [
    53.9,
    63.3
   ]
  },
  "V2_excluding_guesses": {
   "k": 250,
   "n": 416,
   "pct": 60.1,
   "ci95": [
    55.3,
    64.7
   ]
  },
  "per_model": {
   "gemini-3.1-pro-preview": {
    "k": 260,
    "n": 416,
    "pct": 62.5,
    "ci95": [
     57.8,
     67
    ]
   },
   "claude-opus": {
    "k": 236,
    "n": 416,
    "pct": 56.7,
    "ci95": [
     51.9,
     61.4
    ]
   },
   "openai/gpt-5.6-sol": {
    "k": 266,
    "n": 416,
    "pct": 63.9,
    "ci95": [
     59.2,
     68.4
    ]
   },
   "claude-haiku": {
    "k": 377,
    "n": 416,
    "pct": 90.6,
    "ci95": [
     87.4,
     93.1
    ]
   }
  },
  "union_pro_opus_gpt": {
   "k": 217,
   "n": 416,
   "pct": 52.2,
   "ci95": [
    47.4,
    56.9
   ]
  },
  "union_all_four": {
   "k": 216,
   "n": 416,
   "pct": 51.9,
   "ci95": [
    47.1,
    56.7
   ]
  },
  "pro_rep2_alone": {
   "k": 262,
   "n": 416,
   "pct": 63,
   "ci95": [
    58.2,
    67.5
   ]
  },
  "union_with_pro_rep2": {
   "k": 216,
   "n": 416,
   "pct": 51.9,
   "ci95": [
    47.1,
    56.7
   ]
  },
  "visible": {
   "k": 114,
   "n": 236,
   "pct": 48.3,
   "ci95": [
    42,
    54.7
   ]
  },
  "hidden": {
   "k": 103,
   "n": 180,
   "pct": 57.2,
   "ci95": [
    49.9,
    64.2
   ]
  },
  "author_in_title_masked": {
   "k": 70,
   "n": 123,
   "pct": 56.9,
   "ci95": [
    48.1,
    65.3
   ]
  },
  "author_not_in_title": {
   "k": 147,
   "n": 293,
   "pct": 50.2,
   "ci95": [
    44.5,
    55.9
   ]
  },
  "P_adjusted_for_defensible_bluffs": {
   "pct": 48.7,
   "moved": 14.4,
   "note": "secondary; by-eye labels in eye-bluffs.jsonl"
  },
  "post_hoc_name_variant_bound": {
   "note": "POST HOC. P_lower_bound: every mismatched author in the numerator counted as right. P_corrected: by-eye labels for every non-\"yes\" mismatch plus the bluff adjustment above.",
   "numerator_works_with_a_mismatch": 67,
   "P_lower_bound": 36.1,
   "non_yes_mismatch_works_read": 42,
   "non_yes_mismatch_defensible": 4,
   "P_corrected": {
    "pct": 47.7,
    "ci95": [
     43.1,
     52.6
    ],
    "k": 198.6,
    "n": 416
   }
  }
 },
 "unrestricted": {
  "all500_upper_bound": {
   "k": 301,
   "n": 500,
   "pct": 60.2,
   "ci95": [
    55.8,
    64.4
   ]
  },
  "scorable_any_title": {
   "k": 217,
   "n": 416,
   "pct": 52.2,
   "ci95": [
    47.4,
    56.9
   ]
  },
  "identifiable_any_author_upper_bound": {
   "k": 291,
   "n": 490,
   "pct": 59.4,
   "ci95": [
    55,
    63.6
   ]
  },
  "not_scorable_by_reason": {
   "institution, not a person": 11,
   "no catalogue author": 65,
   "editor/translator only": 8
  },
  "not_scorable_known_yes_any_model": {
   "k": 43,
   "n": 84,
   "pct": 51.2,
   "ci95": [
    40.7,
    61.6
   ]
  }
 },
 "units": {
  "note": "volumes = books in the work with pages; pages = sum of pages_count over them; tokens ≈ pages × chars per OCR page of the sampled edition's first ≤15 OCR'd pages ÷ 4 (median 933 chars/page where missing)",
  "works": {
   "pct": 52.2,
   "ci95": [
    47.4,
    56.9
   ]
  },
  "volumes": {
   "pct": 38.6,
   "ci95": [
    30.2,
    48.2
   ]
  },
  "pages": {
   "pct": 35.3,
   "ci95": [
    27.4,
    43.9
   ]
  },
  "tokens": {
   "pct": 47.4,
   "ci95": [
    33.8,
    60.5
   ]
  },
  "totals_in_W": {
   "volumes": 625,
   "pages": 168858,
   "tokens": 44579915
  }
 }
}
```
