---
name: IIIF Union Catalog Vision
description: import_candidates as a queryable union catalog of all digitized pre-modern texts across European IIIF libraries — like USTC but built on actual digitizations
type: project
---

The `import_candidates` MongoDB collection is not just a staging table for imports — it's becoming a **union catalog of every digitized pre-modern text accessible via IIIF** across European research libraries.

**Why:** No single catalog tells you "what pre-modern books have actually been digitized and are freely available online." USTC tracks bibliographic records (what exists), not digitizations (what's accessible). Biblissima aggregates some manifests but not all. Each library has its own catalog. Source Library's crawlers unify all of these into one queryable collection with normalized metadata.

**What it contains per record:**
- title, author, language (normalized), date (parsed to year range)
- IIIF manifest URL (direct link to the digitization)
- source library + origin library (aggregators vs. holding institutions)
- page count (when available from manifest)
- status: discovered / imported / skipped / failed

**Queryable dimensions:**
- By date range (pre-1500 manuscripts, 16th-century prints, etc.)
- By language (Latin, Greek, Arabic, German, etc.)
- By holding library (Vatican, BSB, BnF, Bodleian, etc.)
- By source crawler (e-rara, Gallica, BSB, Biblissima, Berlin)
- Cross-source dedup (same book digitized by multiple institutions)

**Sources crawled or planned:**
- e-rara.ch (160K complete), Gallica/BnF (260K), BSB Munich (443K VD16/17/18), Biblissima Wikibase (~155K), Berlin SBB (238K), plus Bodleian, Heidelberg, POLONA, e-codices, HAB, Laurenziana, Vatican (directly), Austrian National Library, and others.

**How to apply:** When discussing the import_candidates collection, treat it as a permanent research asset, not throwaway staging data. It should be maintained, indexed, and eventually exposed via API. Think of it as Source Library's contribution to the digital humanities: a free, queryable answer to "what has been digitized?"

Manuscripts are explicitly in scope — Biblissima and BSB `cerl` sets are predominantly manuscripts. The catalog covers all eras, not just Renaissance.
