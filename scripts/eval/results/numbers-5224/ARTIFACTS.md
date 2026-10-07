# Where the crops, sheets and page texts are

The page texts (`texts/`, 4,806 files), the blind number crops (`crops/`, 1,360 JPEGs) and the 8-up adjudication sheets (`sheets/`, 178 JPEGs) are about 96 MB. They were moved out of the public repo on 2026-09-30, when PR #5380 was split, and they now live in R2 as one tarball:

- URL: https://images.sourcelibrary.org/eval-artifacts/numbers-5224/numbers-5224-artifacts-2026-09-30.tar.gz
- R2 key: `eval-artifacts/numbers-5224/numbers-5224-artifacts-2026-09-30.tar.gz`
- Size: 79,358,906 bytes; 6,344 files
- sha256: `3220a425d2bcfb16419d68e69296b82b75145aa7321e8adb25ea157cfd210cfd`

To restore them in place, so every stage and every path in the `*.jsonl` indexes resolves again, run this from the repo root:

    curl -sL https://images.sourcelibrary.org/eval-artifacts/numbers-5224/numbers-5224-artifacts-2026-09-30.tar.gz | tar -xz -C scripts/eval/results/numbers-5224

The standing regression test does not need them. `numbers-5224.mjs --stage=regress --texts=<dir>` scores against `scripts/eval/benchmark/numbers-en-5224.json`, which stays in git. The directories are gitignored here so that a re-run cannot commit them again.
