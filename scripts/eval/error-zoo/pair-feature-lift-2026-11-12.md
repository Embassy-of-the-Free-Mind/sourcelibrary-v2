# Do the OCR↔English checks lift the predictor? (#8632)

1908 weekly-audit label rows (1340 random served), 1499 books; audit-only model, GroupKFold(5) by book; 8 pair features added to 194 existing.

| target | base (random) | AUC random, existing | AUC random, + pair | difference [95% book bootstrap] | AUC audit, existing | AUC audit, + pair |
|---|---|---|---|---|---|---|
| any serious | 31.4% | 0.751 | 0.754 | +0.003 [-0.005, +0.012] | 0.724 | 0.725 |
| serious OCR-stage or wrong leaf | 18.3% | 0.830 | 0.827 | -0.003 [-0.010, +0.004] | 0.814 | 0.813 |
| serious translation-stage (English-critical) | 28.6% | 0.750 | 0.755 | +0.005 [-0.004, +0.014] | 0.722 | 0.730 |
| T10 page | 4.4% | 0.733 | 0.787 | +0.054 [+0.023, +0.088] | 0.708 | 0.767 |
| O7 page | 3.2% | 0.752 | 0.764 | +0.012 [-0.012, +0.040] | 0.768 | 0.784 |
| T8 page | 5.5% | 0.620 | 0.629 | +0.009 [-0.010, +0.029] | 0.658 | 0.671 |
