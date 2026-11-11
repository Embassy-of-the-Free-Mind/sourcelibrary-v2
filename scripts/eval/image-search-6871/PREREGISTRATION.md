# Preregistration — CLIP-B/32 vs SigLIP2 for text→image search over page images (#6871, Derek 2026-10-20 item 3)

Written 2026-10-20 before any arm ran on the pool. PRIOR ART: `2026-09-29-does-a-stronger-image-matcher-dinov2-small-siglip2-beat-3193.md`
(SigLIP2 beat CLIP image→image for /identify, 59 vs 49 top-1; text→image never measured) and
`2026-10-18-gex45-capability-card-6871.md` (CLIP over all ~20.7M archived page images ≈ 1.6 GPU-days, SigLIP2-so400m ≈ 8).

## Decision it changes

Which model, if any, embeds the ~20M page images: CLIP-B/32 (the model behind `clip_embeddings`, ≈ 1.6 GPU-days),
SigLIP2-base (≈ 1.6) or SigLIP2-so400m (≈ 8).

## Queries (`queries.json`, frozen before the run)

- **Source:** 60 real `search_images` queries from `mcp_tool_calls` (827 distinct).
- **Candidates:** 1–6 words, ≤ 50 characters, Latin script.
- **Order:** queries asked from ≥ 2 distinct IPs first, then a seeded (6871) shuffle of the rest.
- **Walk:** in that order, rejecting:
  - (a) a named edition, deck, book or artist;
  - (b) a non-visual subject;
  - (c) a near-duplicate, meaning the same subject or a head noun already taken twice.
- 56 rejects are listed with their reasons.

## Pool (`build-pool.mjs`, seed 6871)

15,000 page images of visible books:
- 5,000 pages that carry an extracted illustration (`gallery_images`, one row per page);
- 10,000 random pages, one per book where possible.

The pool is our archived page image at a long side ≤ 768 px, fed to each model through its own processor (CLIP:
shortest side 224 and centre crop; SigLIP2: resize to 224 / 384). The random stratum is what most of the 20M images look
like; the illustrated stratum makes sure each query has something to find.

## Arms (`embed.py`, GPU, fp16)

- `clip` = openai/clip-vit-base-patch32;
- `siglip2-base` = google/siglip2-base-patch16-224;
- `siglip2-so400m` = google/siglip2-so400m-patch14-384.

The query text is the raw lower-cased query. Cosine similarity; each arm's top 10 per query is kept.

## Relevance (blind, after the run)

- **Pooling:** for each query, the union of the three arms' top 10 (≤ 30 images), shuffled by hash. No arm label, rank or
  score is shown.
- **Judges:** Opus subagents judge contact sheets of numbered thumbnails. **2** = the image clearly shows the query's
  subject; **1** = it shows it partly, small, or a closely related depiction; **0** = not relevant (a text page, another
  subject).
- **Instrument check:** a second judge independently re-judges 10 random queries; grade agreement (0 vs ≥ 1) is reported.

## Metrics and rule (fixed now)

- **Metrics:** P@10 (share of the top 10 graded ≥ 1) and nDCG@10 (graded), per query. Paired bootstrap over queries,
  10,000 resamples, seed 6871.
- **An arm BEATS CLIP** if its mean P@10 exceeds CLIP's by **≥ 0.10** and the 95 % CI of the paired difference lies above 0.
- **Choice:** the cheapest arm that beats CLIP. so400m is chosen over base only if so400m − base ≥ **0.05** with the CI above 0.
- **No arm beats CLIP** → any page-image embed uses CLIP-B/32, and SigLIP2 is not adopted for search.

Reported, not deciding:
- the share of relevant hits from the random stratum, i.e. pages with no extraction, which is what a full-page embed
  would add;
- images/s per arm on the card.

`measure: accuracy` (judged against the image). n = 60 queries: this detects a 0.10 P@10 difference, not 0.02. Whether to
embed the 20M pages at all also needs a product decision (where page hits are shown), which this does not make.
