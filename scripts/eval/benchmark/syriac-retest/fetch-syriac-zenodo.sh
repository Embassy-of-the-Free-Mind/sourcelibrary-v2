#!/bin/bash
# PRIOR ART: none — scripts/eval has no Zenodo fetcher; models and GT sets for the Syriac retest (#4746).
# Fetch the Beth Mardutho Kraken models (CC BY 4.0), the experimental printed model (Apache-2.0) and the two
# published Syriac ground-truth sets (HTR Winter School 2024/2025) from Zenodo onto Hetzner. Retries, resumable.
set -u
D=/root/ocr-bench/syriac-retest; mkdir -p $D/models $D/gt; cd $D
get() { # record key
  local rec=$1 key=$2 out=$3
  for i in 1 2 3 4 5; do
    curl -sfL --retry 3 --max-time 1800 -C - -o "$out" "https://zenodo.org/records/$rec/files/$key?download=1" && { echo "ok $out $(stat -c %s "$out")"; return 0; }
    echo "retry $i $out"; sleep 30
  done; echo "FAILED $out"
}
get 17406703 SyrEstr_02_34.mlmodel models/qoruyo-estrangela.mlmodel
get 17406690 SyrEastSyr_01_18.mlmodel models/qoruyo-eastern.mlmodel
get 8425684 omnisyr_best.mlmodel models/omnisyr.mlmodel
get 17406773 syr_41transcribathon_docs_d_3.mlmodel models/sophro-mhiro.mlmodel
get 17406717 syr_1col_182pp_99_segmonto.mlmodel models/sophro-seg-1col.mlmodel
get 18157525 page.zip gt/jerusalem36-page.zip
get 18157525 images.zip gt/jerusalem36-images.zip
get 14714089 page.zip gt/onb-syr1-page.zip
get 14714089 images.zip gt/onb-syr1-images.zip
echo FETCH-DONE
