# Harmony by meaning (#7129)

PRIOR ART: scripts/analysis/experience-map/ (probes → match_semantic → UMAP) and scripts/eval/figure-reception/
(map.json for FigureMap and ThemeRiver). This directory joins the two for one concept.

1. `retrieve.mjs` — embed `probes.json` (gemini-embedding-2, metered) and query `match_semantic` globally and per
   language; writes hits.jsonl and report.json (per probe: hits, how many never name harmony, five best with /q links).
2. `semantic-map.py` — the top pages per probe, embedded locally with ollama nomic-embed-text, UMAP to 2-D.
3. `prep-map.py` — publish `public/data/maps/harmony-semantic/map.json` (+ semantic-report.json) in the
   figure-reception shape, read by the Semantic map and Theme river views of /explore/maps/harmony.

```
node --no-warnings --experimental-strip-types --env-file=/root/sourcelibrary/.env.production.local scripts/eval/harmony-semantic/retrieve.mjs --out $W
<venv>/bin/python scripts/eval/harmony-semantic/semantic-map.py $W      # needs umap-learn and ollama with nomic-embed-text
python3 scripts/eval/harmony-semantic/prep-map.py $W public/data/maps/harmony-semantic
```
Only translated pages have vectors, so untranslated books cannot be found this way.
