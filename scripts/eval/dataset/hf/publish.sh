#!/bin/bash
# Publish the OCR-Eval dataset to Hugging Face as sourcelibrary/reading-or-reciting.
#
# Prereqs (one-time, interactive — Derek):
#   1. huggingface.co account; create the org "sourcelibrary" (Settings → Organizations → New).
#   2. Access token with WRITE scope for that org (Settings → Access Tokens).
#   3. `hf auth login` and paste the token.
#
# Then: ./scripts/eval/dataset/hf/publish.sh [version-dir]   (default v0.3)
#
# Layout on HF: latest version's files at the repo root (feeds the dataset viewer
# via the card's `configs`), original per-version README preserved as
# RELEASE_NOTES_<version>.md. Re-running for a new version overwrites root files;
# HF keeps full git history, so old versions stay addressable by revision.
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:-v0.3}"
REPO=sourcelibrary/reading-or-reciting
SRC="../$VERSION"

[ -d "$SRC" ] || { echo "No such version dir: $SRC"; exit 1; }
hf auth whoami >/dev/null 2>&1 || { echo "Not logged in — run: hf auth login"; exit 1; }

hf repo create "$REPO" --repo-type dataset 2>/dev/null || true

hf upload "$REPO" README.md README.md --repo-type dataset --commit-message "dataset card"
for f in pages.jsonl references.jsonl runs.jsonl checksums.txt; do
  hf upload "$REPO" "$SRC/$f" "$f" --repo-type dataset --commit-message "$VERSION: $f"
done
hf upload "$REPO" "$SRC/README.md" "RELEASE_NOTES_$VERSION.md" --repo-type dataset \
  --commit-message "$VERSION release notes"

echo
echo "Published $VERSION → https://huggingface.co/datasets/$REPO"
echo "Verify the dataset viewer renders all three configs, then tag the revision:"
echo "  hf repo tag create $REPO $VERSION --repo-type dataset"
