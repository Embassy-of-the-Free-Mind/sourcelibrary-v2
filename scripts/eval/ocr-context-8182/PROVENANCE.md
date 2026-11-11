# Step 1 · What were the small OCR engines trained on, and which of our scored frames could overlap? (#8182)

PRIOR ART: none for training provenance — looked in `.claude/docs/ocr-memorization-paper.md` (frontier models only),
`scripts/eval/INDEX.md`, `scripts/eval/experiments/*6560*`, `*6561*`, `*4523*`, `*5660*`, `*4746*` (they name the
engines and revisions, never their training data). Read 2026-11-04 from the sources linked; every claim below is
quoted or paraphrased from a named source, or marked **not stated**. Nothing is inferred from performance.

## Served revisions (checked against the box)

| engine | served revision | how checked |
|---|---|---|
| Yigdzin 1 | `BDRC/tibetan-ocr` @ `50506eb6d8ed8738df86b448f6f6cdc688de29ea` | `scripts/gpu/yigdzin-vllm/setup-venv.sh` `REV=`; the only snapshot in gex45's HF cache |
| PaddleOCR-VL | `PaddlePaddle/PaddleOCR-VL-1.6` (HF main `c5630aba…`) | `/root/pz/box.json` on gex45: `weights_sha256 85a479d5…` = the LFS oid of `model.safetensors` on HF main |
| Kraken (Syriac) | `omnisyr` (Zenodo 8425684, 27,679 live pages), `sophro-mhiro` (Zenodo 17406773, 11,247) | `scripts/eval/estimator/ocr/results/route-census-6740/prov/reads-prov.jsonl` |

## Yigdzin 1 (BDRC/tibetan-ocr) — https://huggingface.co/BDRC/tibetan-ocr (model card at 50506eb6)

- **Architecture: uses a language decoder.** "PaddleOCR-VL-1.6 (vision encoder + depth-upscaled decoder)", "~360M
  26-layer decoder", "SOLAR-style depth-upscale 18L→26L". Autoregressive: the card decodes with `model.generate`.
  Base model `PaddlePaddle/PaddleOCR-VL-1.6`, so the decoder starts from ERNIE-4.5-0.3B (see Paddle below).
- **Tokenizer:** "Tibetan unicode-stack tokenizer, vocab 3,560 (pruned + **BoCorpus-warmed**)". What "warmed" means
  (text-only training of the embeddings or more) is **not stated**.
- **Training data:** "Curated mix (`bec_mixed_elie_v8`), assembled from BDRC alignment collections +
  **BoCorpus-rendered synthetic pages**". Released components:
  - real: ALL-BDRC-alignments (79,572 pages, ACIP *Sungbum*: 119 collected-works sets, woodblock uchen),
    Palri Parkhang (11,133, "largely Nyingma collected works and *gter ma* cycles"), Berkeley (8,866, dbu-med),
    MonlamAI transcriptions (3,072) and handwritten (11,755 synthetic), **Stok (806 pages of "Tibetan Kangyur
    manuscripts (uchen)", Stog Palace Kangyur `MW22083`)**, TibSchol (gated; contents **not stated** to us);
  - synthetic: "Tibetan OCR synthetic v5" (`BDRC/tibetan-ocr-synthetic`; the dataset page is not public to us).
- **BoCorpus** (https://huggingface.co/datasets/openpecha/BoCorpus): "Bon Kangyur: 151 texts · **Derge Kangyur: 103
  texts** · **Derge Tengyur: 213 texts** · DharmaEbook 98 · Pagen 1 · Tsadra Collection 266 · Drigung *bang mdzod*
  136 · Rinchen Terdzo 71"; 603 M characters. (103 and 213 are the volume counts of the Derge Kangyur and Tengyur.)
  **Which BoCorpus collections were rendered into synthetic pages, and how many pages each: not stated.** Whether
  BoCorpus's Derge Kangyur is the same e-text as OpenPecha P000001 (our reference): **not stated**.
- Held out: only BDRC's own benchmark pages ("images_exclude_from_train.csv"). Nothing of ours is named.

## PaddleOCR-VL-1.6 — model card https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6 and reports arXiv 2510.14528 (v1.0), 2601.21957 (v1.5), 2606.03264 (v1.6)

- **Architecture: uses a language decoder.** "a NaViT-style dynamic resolution visual encoder with the
  **ERNIE-4.5-0.3B language model**" (2510.14528 abstract; unchanged in 1.5 and 1.6). ERNIE-4.5-0.3B's pretraining mix
  is not itemised in any source read here: whether it contains CBETA, Siku or Kanripo text is **not stated**.
- **Data sources (2510.14528 §3.1):** "open-source dataset, synthesizing dataset, **network accessible dataset**, and
  in-house dataset"; network data "an extensive corpus of publicly accessible data harvested from the Internet";
  labels from "automatic labeling by general large models". Text data "includes diverse scenes including … Ancient
  books" (App. A.1). 1.5: "finer-grained optimizations for rare characters, **ancient Chinese texts**". 1.6 (§3.3,
  CPT): "systematically supplements long-tail data such as **ancient books**, rare characters", "newly retrieved samples
  … including ancient books". **Which ancient books, from where, and whether CBETA, the Siku Quanshu (Wenyuange
  facsimile or e-text) or Kanripo are among them: not stated.**
- Recognition is region/element-level after PP-DocLayout layout detection (the card's pipeline), not line-level.

## Kraken (served Syriac models; brief third column)

- **No autoregressive text decoder.** Kraken's recognizer is a per-line network decoded with CTC
  (`kraken/lib/ctc_decoder.py`: "Decoders for softmax outputs of CTC trained networks"), no external language model.
  The network still sees the whole line image, so within-line context is not excluded by architecture; the layer
  spec of the two served models was **not read** here.
- `sophro-mhiro` (Zenodo 17406773): "3,466 lines · 100 images · **mostly Biblical texts** · 38 manuscripts".
  `omnisyr` (Zenodo 8425684): "experimental generalized model for printed syriac text"; training data **not stated**.

## Which scored frames could overlap

| frame we quote | engine | could the TEXT be in training? | could the IMAGES be? |
|---|---|---|---|
| BL Kangyur manuscripts vs Derge e-text (P000001), 0.945–0.962 (#4523, #6560) | Yigdzin | **Yes, stated:** BoCorpus has the Derge Kangyur and the synthetic pages are BoCorpus-rendered (which subset: not stated). Also 806 Stok Kangyur pages (a different Kangyur edition, same texts) | not stated (BL scans are not in any listed component) |
| Derge Kangyur woodblock volumes we hold (#5660 canary) | Yigdzin | as above | BDRC holds Derge scans; whether any were trained on: not stated |
| **Derge Tengyur** (the default control group) | Yigdzin | **Yes, stated: BoCorpus has the Derge Tengyur too.** So Kangyur vs Tengyur is NOT an inside/outside contrast for Yigdzin's text exposure | not stated |
| CBETA-fitted pages (#6101, #8146), Kanripo-screened Siku pages (#6561 lane screen) | PaddleOCR-VL | **not stated** (only "ancient books" from undisclosed web and in-house sources, and an LM whose pretraining mix is not itemised) | not stated |
| Syriac print/MS vs published editions (#4746, #6295) | Kraken | sophro-mhiro: "mostly Biblical texts" (the Peshitta-class books we score) | the listed MS repositories, not our scans |

**What this settles by itself.** The decision rule's second trigger ("Step 1 confirms overlap between training data
and a scored frame") is met for **Yigdzin and the Derge Kangyur text**, at the level the card states: the Derge
Kangyur is in BoCorpus, BoCorpus renders the synthetic pages, and the tokenizer is BoCorpus-warmed. The card does not
say the Kangyur was rendered, so this is "stated source corpus contains it", not "trained on these pages". For
PaddleOCR-VL nothing is stated either way. Because BoCorpus holds the Tengyur as well, the Step 2 Tibetan contrast
needs a third group whose text is outside BoCorpus and the listed real sets; that is decided in the pre-registration.
