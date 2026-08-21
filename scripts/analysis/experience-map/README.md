# Experience map — probe-based phenomenology over the corpus

Built 2026-07-20/21. Live site: **https://experience-atlas.vercel.app**

Retrieves passages describing conscious experience "from the inside" across the
translated corpus, classifies them, and projects them. Four public surfaces:
the working paper (`/`), the Atlas (`/atlas`), a Visuddhimagga comparison
(`/compare`), a subtle-body reconstruction (`/bodies`), and a response to the
PEACE framework (`/peace`).

**Bulk data lives in `scripts/output/experience-map/` — which is gitignored.**
Only the pipeline is tracked here. Regenerating the data costs ~$3 in
`gemini-3.1-flash-lite` calls, plus a few cents of embedding — which is BILLED,
not free-tier (see `.claude/docs/embeddings.md`).

## Pipeline

    probes/     probe sets. Each dimension is several FIRST-PERSON REPORT
                SENTENCES, not topic labels — retrieval matches passages and we
                want experiential register, not vocabulary.
                  probes.json       v1, 20 dims from MEQ30 / 5D-ASC / Hood
                  probes-v2.json    36 dims (+16 the modern scales lack)
                  probes-jhana.json 26 Visuddhimagga stages, extracted from the
                                    manual itself (see build/extract-jhana-*)
                  probes-body.json  10 subtle-body systems + a control

    retrieve/   embed probes, query match_semantic, stratify by language.
                retrieve-v4.mjs is current. baseline-sample.mjs draws the random
                corpus sample that gives every rate a denominator.

    classify/   register / experiential / features / trigger / aftermath /
                attributed agent, with a HARD verbatim quote gate.

    build/      extraction, quote embedding, UMAP projection, figures, and
                build-deploy.py which assembles the Vercel site.

    templates/  page bodies. build-deploy.py injects figures + data.

## Non-obvious things that cost time

- **`scripts/output/` is gitignored.** Anything written there is invisible to git
  and to other sessions. That is fine for 30MB of JSONL; it is not fine for code.
- **Quote integrity is a hard gate, not a metric.** ~3% of model-extracted
  quotations are silently altered from the source. `classify-*.mjs` normalises
  whitespace/case and *discards* any quote that is not a substring of its page.
  Never report the rate and keep the quotes.
- **Retrieval must be stratified by language.** Global similarity search returns a
  popularity contest: v1 was 22% English (corpus share 6.5%) and 2.8% Tibetan
  (corpus share 14.5%). Equal probe budget per language fixes it — but the result
  is then neither proportional nor random, and must be labelled as such.
- **`match_semantic` year filtering is CORRECT.** An earlier claim here that
  year-only filters under-return was wrong: the HNSW and seq-scan paths return
  identical rows (tested across four eras). Do not "fix" it.
- **Concurrency above ~6 gets `fetch failed`** from both Gemini and Supabase.
  Every long job retries with backoff and aborts loudly if the failure rate
  passes 50% — an early run burned all 9,936 queries in seconds because errors
  were swallowed and nothing backed off.
- **Python-generated inline JS: use typographic apostrophes.** A `\'` inside a
  `"""..."""` block reaches the page as a bare `'` and terminates the JS string,
  killing the whole script silently. `build-deploy.py` parse-checks its output.
- **Source Library's accent palette fails as a chart palette.** sage and
  gold-dark fall below the chroma floor and sit 3.9 ΔE apart under deuteranopia.
  The pages use SL identity for type/ground and a validated categorical palette
  for marks.

## Status

One blocker before any of this is citable: **classification has no second rater**,
so there is no inter-rater agreement figure. (References were verified 2026-07-21 —
see below.)

## Citation status (2026-07-21)

All references on the paper page were verified against the published literature.
Two were wrong as first drafted:

- **Lindahl et al. 2017** is "A **mixed-methods** study of meditation-related
  challenges in Western Buddhists," *PLoS ONE* 12(5) e0176239 — not "a qualitative
  study."
- **Ñāṇamoli's Visuddhimagga** was first published 1956 by R. Ananda Semage,
  Colombo. Buddhist Publication Society (Kandy) only from 1975; standard modern
  citation is the 4th ed., BPS 2010.

**Catalogue discrepancy worth fixing:** our record for the Ṣaṭcakranirūpaṇa
(book `6991d46921124c9ad6944323`) is dated **1526**. The scholarly standard is
**1577** — it is ch. 6 of Pūrṇānanda's *Śrītattvacintāmaṇi*, Śaka 1499. The 1526
figure circulates in popular sources. Worth correcting in the catalogue.
