#!/usr/bin/env python3
# PRIOR ART: scripts/eval/lib/paired-stats.mjs — the same statistics in JS (wins/losses/ties, median Δ, bootstrap CI,
# two-sided sign test). The #5250 scorers run in Python next to the Python aligners (kanjur_align.py, the Syriac
# line-CER scorer), so this is a port, kept deliberately small; the rule it applies is the one posted on #5250.
"""Paired comparison of two arms on the SAME pages, and the A/A noise-floor rule.

Rule (#5250, posted before any arm was read): the noise floor is the 90th percentile of |Δ| over the A/A pages
(same arm read twice). An arm COUNTS only if (a) its paired median Δ against the baseline is larger in magnitude
than that floor and (b) the two-sided sign test over untied pages gives p < 0.05.
"""
import math
import random
import statistics as st


def sign_test(k, n):
    if n == 0:
        return None
    k = min(k, n - k)
    p = sum(math.comb(n, i) for i in range(0, k + 1)) / 2 ** n
    return round(min(1.0, 2 * p), 4)


def bootstrap_ci(d, iters=4000, seed=5250):
    if not d:
        return None
    rng = random.Random(seed)
    meds = sorted(st.median(rng.choices(d, k=len(d))) for _ in range(iters))
    return [round(meds[int(0.025 * iters)], 4), round(meds[int(0.975 * iters)], 4)]


def paired(base, arm, higher_is_better=True, tie_eps=1e-9):
    """base, arm: {page_key: value}. Uses only pages present (non-None) in both."""
    keys = sorted(k for k in base if k in arm and base[k] is not None and arm[k] is not None)
    d = [(arm[k] - base[k]) * (1 if higher_is_better else -1) for k in keys]
    wins = sum(1 for x in d if x > tie_eps)
    losses = sum(1 for x in d if x < -tie_eps)
    return {"n": len(keys), "wins": wins, "losses": losses, "ties": len(keys) - wins - losses,
            "median_delta": round(st.median(d), 4) if d else None, "mean_delta": round(st.mean(d), 4) if d else None,
            "ci95": bootstrap_ci(d), "sign_p": sign_test(wins, wins + losses)}


def noise_floor(a, b):
    keys = sorted(k for k in a if k in b and a[k] is not None and b[k] is not None)
    ad = sorted(abs(a[k] - b[k]) for k in keys)
    if not ad:
        return None
    return {"n": len(ad), "median_abs": round(st.median(ad), 4), "p90_abs": round(ad[min(len(ad) - 1, int(0.9 * len(ad)))], 4),
            "max_abs": round(ad[-1], 4), "identical": sum(1 for x in ad if x == 0)}


def counts(cmp, floor):
    if cmp["median_delta"] is None or floor is None or cmp["sign_p"] is None:
        return False
    return abs(cmp["median_delta"]) > floor["p90_abs"] and cmp["sign_p"] < 0.05
