# Routing eval — hidden-flash-5795 (#5795)

measure: by eye (label check, blinded A/B adjudication) plus engine-to-engine agreement and a catastrophic count; not accuracy.

| group | pages (with text) | label yes / text [Wilson 95 %] | catastrophic lite / flash | rate difference [95 %] | by eye: wins / losses | invented by candidate | **hidden-flash-5795-registered** | **margin-v1** |
|---|---:|---|---|---|---|---|---|---|
| fas | 30 (27) | 25 / 27 [0.766, 0.979] | 0 / 1 | 0.033 [0, 0.1] | 9 / 0 | 0 | a ✓ b ✗ c ✓ → **stay on lite** | a ✓ b ✓ c ✓ → **route to flash** |
| san | 30 (30) | 22 / 30 [0.556, 0.858] | 7 / 3 | -0.133 [-0.267, -0.033] | 5 / 0 | 0 | a ✗ b ✓ c ✓ → **relabel (#4884)** | a ✗ b ✓ c ✓ → **relabel (#4884)** |
| pli | 26 (26) | 18 / 26 [0.5, 0.835] | 8 / 5 | -0.115 [-0.308, 0.077] | 0 / 1 | 1 | a ✗ b ✓ c ✗ → **relabel (#4884)** | a ✗ b ✓ c ✗ → **relabel (#4884)** |
| ara | 30 (30) | 23 / 30 [0.591, 0.882] | 3 / 3 | 0 [0, 0] | 4 / 0 | 1 | a ✗ b ✓ c ✗ → **relabel (#4884)** | a ✗ b ✓ c ✗ → **relabel (#4884)** |
| gez | 1 (1) | 1 / 1 [0.207, 1] | 0 / 0 | 0 [0, 0] | 1 / 0 | 0 | a ✓ b ✓ c ✓ → **undecided: n too small** | a ✓ b ✓ c ✓ → **undecided: n too small** |

## Negative control

A candidate inferior by construction: it fails every page the baseline fails, plus a further 20 % of the pages (at least 2). A rule must refuse it; one that does not has no power at this n.

| group | hidden-flash-5795-registered | margin-v1 |
|---|---|---|
| fas | 7 failures against 0 → refused ✓ | 7 failures against 0 → refused ✓ |
| san | 13 failures against 7 → refused ✓ | 13 failures against 7 → refused ✓ |
| pli | 16 failures against 8 → refused ✓ | 16 failures against 8 → refused ✓ |
| ara | 9 failures against 3 → refused ✓ | 9 failures against 3 → refused ✓ |
| gez | not applied (n too small) | not applied (n too small) |

## How much margin each group needs

The upper 95 % bound of (candidate rate − baseline rate), paired by page, seeded bootstrap. The margin check passes for any margin at or above it.

| rule | group | n | upper bound | margin in the rule | discordant pages (candidate only / baseline only) |
|---|---|---:|---:|---:|---|
| margin-v1 | fas | 30 | 0.1 | 0.1 | 1 / 0 |
| margin-v1 | san | 30 | -0.033 | 0.1 | 0 / 4 |
| margin-v1 | pli | 26 | 0.077 | 0.1 | 2 / 5 |
| margin-v1 | ara | 30 | 0 | 0.1 | 0 / 0 |
| margin-v1 | gez | 1 | 0 | 0.1 | 0 / 0 |
