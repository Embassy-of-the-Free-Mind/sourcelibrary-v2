---
stage: image
measure: judged
languages: []
scripts: []
canons: []
n_books: 70954
n_pages: 75
verdict: "SigLIP2-so400m vectors of full archived page masters retrieve well enough to embed all of them. On the 100K pilot, top-5 is right by eye 35/75 (P@5 0.47 strict) and related 49/75 (0.65) over 15 queries. Misses are subjects the 100K sample does not contain, plus text pages that carry the query WORD. Blank pages, covers and colour cards do not dominate: 1 blank page, 1 colour card and 1 bookplate in 75, and 2 hubs in 700 top-10 slots. Reading R2 over the S3 API from worker processes lifts the run from 15.8 to 43.7 img/s (GPU busy 0.33 → 0.95–0.98), so 21.55M pages take about 5.7 GPU-days."
status: adopted
decision: "Full run queued on gex45 as 16 chunks of 1.5M rows (zz-siglip2-full-c000…c015), with no manifest filter. Live books run first (13.53M rows), then hidden (8.01M). About $7.76 of R2 Class B reads and no Worker requests. Serve-time filters (one hit per book, bookplate/blank near-duplicate suppression) go to the serving PR."
superseded_by: null
issue: [6871]
---
## 2026-10-26 · Do full-page SigLIP2 vectors retrieve well enough to embed ~21M pages, and can the fetch keep the card busy? (#6871 row 8; job siglip-full-6871-mv)
<!-- PRIOR ART: 2026-10-20 image-search eval (PR #7042, scripts/eval/image-search-6871: P@10 so400m 0.46 vs CLIP 0.21 on a 15K pool, Opus-judged); the 100K pilot (scripts/gpu/siglip2-6871, job siglip-slot-6871: 15.8 img/s, GPU busy 0.33). -->

**Spot check (by eye, pilot pages only).**
- **Queries.** The 60 frozen #7042 queries, plus 10 new real `search_images` queries (`mcp_tool_calls`, 2026-10-25/26) for the subjects the brief named (alembic, zodiac man, printer's device) and for recent traffic. The query set is `scripts/gpu/siglip2-6871/spot-queries.json`.
- **Search.** All 70 queries ran over the 99,978 pilot vectors and over the 236,686 gallery-crop vectors (`spotcheck.py`).
- **Judging.** I opened 15 queries' top 5 pilot pages myself, as contact sheets with the crop top 5 beside them for comparison.
- **Grades.** S = shows the subject; L = related (a lion that is not green, a zodiac figure that is not a zodiac man); ✗ = miss.

| qid | query | P@5 strict | P@5 lenient | top-5 (S/L/✗, by eye) | what came back |
|---|---|---|---|---|---|
| q01 | ouroboros | 1/5 | 1/5 | [S](https://images.sourcelibrary.org/archived/6a507c7680b7658fae263194/13.jpg) [✗](https://images.sourcelibrary.org/archived/69af0a0d724769085e857a0a/586.jpg) [✗](https://images.sourcelibrary.org/archived/69b638c11c1c21a373839ece/160.jpg) [✗](https://images.sourcelibrary.org/archived/6a267b856c1f37c9c4f321f5/71.jpg) [✗](https://images.sourcelibrary.org/archived/69bd9eaef6d63c919747befa/126.jpg) | #5 a plain snake; #2–3 circles |
| q07 | green lion | 0/5 | 2/5 | [✗](https://images.sourcelibrary.org/archived/6a87102131598d129803de7b/48.jpg) [L](https://images.sourcelibrary.org/archived/6a2679806c1f37c9c4f2bae6/2.jpg) [✗](https://images.sourcelibrary.org/archived/69ea5131e0662c881fb5c6a6/53.jpg) [✗](https://images.sourcelibrary.org/archived/69ea5131e0662c881fb5c6a6/14.jpg) [L](https://images.sourcelibrary.org/pages/69c8791d6c6f3cc53c8583f6/spa8gy-0029.jpg) | heraldic and Chinese beasts; no green lion in the pilot |
| q09 | monochord | 0/5 | 3/5 | [L](https://images.sourcelibrary.org/archived/6a3c767401fe4f593c1fb1d3/69.jpg) [L](https://images.sourcelibrary.org/archived/6a3c767401fe4f593c1fb1d3/25.jpg) [L](https://images.sourcelibrary.org/archived/6991e7a99d63c80e615599b5/8.jpg) [✗](https://images.sourcelibrary.org/archived/695573e7f63a757109172b1d/286.jpg) [✗](https://images.sourcelibrary.org/pages/6a196587bc198340eea93139/0001-full.jpg) | Chinese zithers, a harpsichord; #5 palm leaves beside a colour card |
| q15 | comet | 0/5 | 1/5 | [L](https://images.sourcelibrary.org/archived/69f33bcf876dd827cbc59588/39.jpg) [✗](https://images.sourcelibrary.org/archived/6a0b44501615109dc53b0fc8/292.jpg) [✗](https://images.sourcelibrary.org/archived/6a423b28c1f44d759e6cd158/5.jpg) [✗](https://images.sourcelibrary.org/archived/6a090c4a44b481aa5a37dd26/97.jpg) [✗](https://images.sourcelibrary.org/archived/69b6fabd3c7947b468d7709f/90.jpg) | #2–5 text pages about comets (the word, not the picture) |
| q16 | dragon | 5/5 | 5/5 | [S](https://images.sourcelibrary.org/archived/69b4c0926248be021e01f719/63.jpg) [S](https://images.sourcelibrary.org/archived/69ea5131e0662c881fb5c6a6/109.jpg) [S](https://images.sourcelibrary.org/archived/6992cacfd4d545ae73feeb33/9.jpg) [S](https://images.sourcelibrary.org/archived/6992ce60673ee1e40e320488/8.jpg) [S](https://images.sourcelibrary.org/archived/6992cacfd4d545ae73feeb33/7.jpg) | emblem + four Chinese dragons |
| q18 | kabbalah sefirot | 4/5 | 4/5 | [S](https://images.sourcelibrary.org/archived/6a4a59c19050f0b4342fdbcf/17.jpg) [S](https://images.sourcelibrary.org/archived/6a4a59c19050f0b4342fdbcf/5.jpg) [✗](https://images.sourcelibrary.org/pages/69b51e16cf111105c4296b94/0191.jpg) [S](https://images.sourcelibrary.org/archived/6a4a59c19050f0b4342fdbcf/24.jpg) [S](https://images.sourcelibrary.org/archived/6a4a59c19050f0b4342fdbcf/15.jpg) | #3 Agrippa's Venus kamea |
| q34 | astrological symbols zodiac | 5/5 | 5/5 | [S](https://images.sourcelibrary.org/archived/69b6483b18b87551bfc52cf9/27.jpg) [S](https://images.sourcelibrary.org/archived/6a2440620f0e4f405e63788c/16.jpg) [S](https://images.sourcelibrary.org/archived/69b63c6e1c1c21a373853044/146.jpg) [S](https://images.sourcelibrary.org/archived/69b6483b18b87551bfc52cf9/51.jpg) [S](https://images.sourcelibrary.org/archived/6a267f5d88f11913ee9c8fc5/31.jpg) | astrological tables full of glyphs |
| q49 | flying machine | 2/5 | 2/5 | [S](https://images.sourcelibrary.org/archived/6ab6e0e551fc56c101c4a31c/7.jpg) [✗](https://images.sourcelibrary.org/archived/6992cdbc43713c66ea6383f3/27.jpg) [S](https://images.sourcelibrary.org/archived/6ab6e10451fc56c101c4a34b/1.jpg) [✗](https://images.sourcelibrary.org/archived/6991e7a99d63c80e615599b5/7.jpg) [✗](https://images.sourcelibrary.org/archived/699388f30f04c37dcfa60530/143.jpg) | two aircraft patents; #2 a Chinese siege engine |
| n01 | zodiac man | 0/5 | 2/5 | [L](https://images.sourcelibrary.org/archived/69dbca641040d1d5e20abdd6/76.jpg) [✗](https://images.sourcelibrary.org/archived/69b654f518b87551bfccf8e7/71.jpg) [✗](https://images.sourcelibrary.org/pages/69b418ca2b0edf3eaa2dde61/sp69f6512edc67775b8c2b0ebb.jpg) [L](https://images.sourcelibrary.org/archived/69908aed285673ff8cb80c3b/77.jpg) [✗](https://images.sourcelibrary.org/archived/69b69092080b19f98fcdff83/104.jpg) | constellation and zodiac-sign figures, no melothesia man in the pilot |
| n02 | alchemist laboratory furnace alembic | 5/5 | 5/5 | [S](https://images.sourcelibrary.org/archived/6a410d8b1a801ceb22163b77/425.jpg) [S](https://images.sourcelibrary.org/archived/69b4d660853c26e0d156140f/255.jpg) [S](https://images.sourcelibrary.org/pages/69b419302b0edf3eaa2def66/sp69f65f595618ef4c4de704ba.jpg) [S](https://images.sourcelibrary.org/pages/69792cdef35c6bbfbfd252fb/0187-full.jpg) [S](https://images.sourcelibrary.org/archived/69b51d2cf23ccdcced306a10/164.jpg) | all distillation furnaces/alembics |
| n03 | printing press printer workshop engraving | 5/5 | 5/5 | [S](https://images.sourcelibrary.org/archived/6992007c768b426600239790/78.jpg) [S](https://images.sourcelibrary.org/archived/6a4da2317b4a0eb23602fe7f/2.jpg) [S](https://images.sourcelibrary.org/archived/6a5012cfd5eaab5ea9dc4a7b/9.jpg) [S](https://images.sourcelibrary.org/archived/699200cd7c226bdd25f9805f/30.jpg) [S](https://images.sourcelibrary.org/archived/6a46059e1a06298ffea7311c/1.jpg) | presses incl. two Badius devices |
| n04 | skeleton | 2/5 | 4/5 | [S](https://images.sourcelibrary.org/archived/6a4258dbdfbbb4d07aa57ac4/52.jpg) [L](https://images.sourcelibrary.org/archived/69b65e69b3f4fc0441521970/250.jpg) [L](https://images.sourcelibrary.org/archived/69b674efb3f4fc04415b4a61/262.jpg) [✗](https://images.sourcelibrary.org/archived/69bd9cc86120d54bd03710d8/43.jpg) [S](https://images.sourcelibrary.org/archived/6991eabc2f801130a473e2bc/167.jpg) | #2–3 écorchés, #5 a spine |
| n06 | eye of providence in a triangle with rays of light | 0/5 | 2/5 | [✗](https://images.sourcelibrary.org/archived/6a3533d7c8ce407afbe04fd6/33.jpg) [L](https://images.sourcelibrary.org/archived/69b3e5a57ab102a372212e8a/1.jpg) [✗](https://images.sourcelibrary.org/pages/69c884a06c6f3cc53c8599e5/sp69f6bc5368a5d791f806621c.jpg) [✗](https://images.sourcelibrary.org/archived/6953e32f77f38f6761bebc95/571.jpg) [L](https://images.sourcelibrary.org/archived/69b6a739080b19f98fd2cedc/2.jpg) | #1, #4 text pages about the triangle; #3 a bookplate |
| n08 | medieval herbal plant | 5/5 | 5/5 | [S](https://images.sourcelibrary.org/archived/6957ef6bcbe1dcad7b76beff/167.jpg) [S](https://images.sourcelibrary.org/archived/69b6321c1c1c21a37380d92e/186.jpg) [S](https://images.sourcelibrary.org/archived/69b3f788a107e55a0ee1dc6c/21.jpg) [S](https://images.sourcelibrary.org/archived/69dbca3d1040d1d5e20aa644/42.jpg) [S](https://images.sourcelibrary.org/archived/69906f654b3bd4d1fffd0abb/6.jpg) | printed and painted herbals |
| n09 | world map hemispheres engraving | 1/5 | 3/5 | [S](https://images.sourcelibrary.org/archived/69b525c66be6046083032278/6.jpg) [L](https://images.sourcelibrary.org/archived/69b4cd16d5b6c3815e1a3e61/8.jpg) [L](https://images.sourcelibrary.org/archived/69b6c48d8566c83814664da9/76.jpg) [✗](https://images.sourcelibrary.org/archived/69b525ba6be60460830311b3/124.jpg) [✗](https://images.sourcelibrary.org/archived/69b641f71c1c21a373889551/3.jpg) | #1 a double hemisphere; #3 a celestial one; #4 a BLANK page |

**Totals.** Strict P@5 = 35/75 = 0.47; lenient = 49/75 = 0.65.

**Where the misses come from.**
- **Subjects the sample lacks.** Strict misses concentrate in green lion, monochord, zodiac man and comet. For all four, the crop row shows the model finds the subject when it exists, so the 100K random sample (5 pages per book) most likely just has none. That is a recall limit of the pilot, not of the model.
- **Text pages.** SigLIP reads words: q15 comet returned four text pages about comets, and n06 two pages about the masonic triangle.

**Hubness.** 592 distinct pages fill 700 pilot top-10 slots, and only 2 pages appear in ≥ 5 queries:
- an ornamental Euclid title page;
- a pastedown with two bookplates. Bookplates repeat across every book of a provenance, so the full set will hold many near-copies of each.

The crop index has 695 distinct images in 700 slots and no hubs.

**Not done.** No filter at manifest time: blank pages and covers do not dominate, and the vectors are files, so a page can be dropped at serve time. The serving PR should:
- cap hits per book;
- suppress near-duplicate bookplates and blank pages, by vector similarity to a few exemplars or by #5122's page classes.

### Fetch fix (20K-page shard, gex45, 2026-10-26)
| | pilot (urllib, 24 threads in the GPU process, via images.sourcelibrary.org) | fix (`fetchlib.py`: 12 processes × 8 threads, keep-alive R2 S3 API) |
|---|---|---|
| end-to-end img/s | 15.8 | 44.4 / 43.1 (two 10K shards); chunk 000 shard 0: 45.9 |
| GPU busy | 0.33 | 0.95 / 0.98 |
| GPU-only img/s | 47.8 | 46.6 / 44.0 |
| vectors vs pilot path | — | same 512 pages: mean cosine 0.99999, min 0.9986 |

The card is now the limit. Batch 128 did not raise GPU-only throughput (44.4 img/s), so batch stays 64. VRAM peaks at 3.45 GB under the 0.6 cap.

### Manifest and cost (`build-full-manifest.mjs`, 2026-10-26 17:01Z)
- **Walked.** 335,016 books with pages, 30.59M pages. 21.55M have a usable archived master on images.sourcelibrary.org: 13.53M from 70,954 live books and 8.01M from hidden ones. 9.04M have no master, and 104 are on another host.
- **Cost.** Every row is one R2 GetObject (Class B, $0.36/M), $7.76 in total. There are no Worker requests, because the fetch bypasses the images.sourcelibrary.org Worker. R2 egress is free.
- **What the old path would have cost.** Through the Worker it would have been about $14: 21.55M Worker requests at $0.30/M plus the same reads.
- **Volume.** About 18 TB read at ~0.85 MB/page, which is inbound traffic to Hetzner. Vectors are 2.3 GB per 1M, about 50 GB in total.

### Chunk plan
- **Chunks.** 16 chunks of 1.5M rows (`chunk-009` holds 35K, the live tail). Each is about 9.5 h at 44 img/s, under a 12 h timeout and an 11.5 h between-shard deadline.
- **Queueing.** Tasks are named `zz-siglip2-full-cNNN`, so every digit-prefixed task sorts ahead of them. `siglip2-requeue.sh` (gex45 cron :02/:32) adds the next chunk only when nothing else is pending, keeps at most 2 embedding chunks pending or running, checks for ≥ 30 GB free on the root disk, and re-queues a deadline-stopped chunk as `-rK` (it resumes from its shard checkpoints).
- **ETA.** About 5.7 GPU-days, or around 2026-11-01 if no transcription task cuts in.
