# read-surface-6740 v1 — licences, per file

<!-- PRIOR ART: scripts/eval/dataset/quality-v1/LICENSES.md (the per-file split this follows). -->

| files | licence | why |
|---|---|---|
| `rows.jsonl.gz`, `calls.jsonl.gz`, `runs.json`, `panel.json`, `frame/`, `confirmation/`, the documents | **CC BY-SA 4.0**, Source Library / Embassy of the Free Mind | our ids, settings, scores, model readings and judge verdicts; the site's content licence |
| `references/cc-by-sa-4.0/` | **CC BY-SA 4.0**, Deutsches Textarchiv (BBAW) | DTA texts, licence per text in the DTA metadata (`licence_reference`) |
| `references/cc-by-sa-3.0-de/` | **CC BY-SA 3.0 DE**, Deutsches Textarchiv | as recorded in the DTA metadata of those texts |
| `references/cc-by-sa-2.0-de/` | **CC BY-SA 2.0 DE**, Deutsches Textarchiv | as above |
| `references/cc0-1.0/` | **CC0 1.0** | as above |
| `references/cc0-1.0-eebo-tcp/` | **CC0 1.0**, Text Creation Partnership | EEBO-TCP phase I and phase II texts are released to the public domain (CC0) by the TCP; `licence_reference` names the phase |
| `references/pointer_only/` | none included | a text whose licence is non-commercial or unclear: source id, page, letters and sha256 only; fetch it from the DTA under its terms |
| `references/cc-by-sa-camena/` | **CC BY-SA**, CAMENA (Universität Mannheim) | the CAMENA site states "Creative Commons Attribution / Share Alike" (linking 3.0); the GitHub republication used here, `nevenjovanovic/camena-neolatinlit` @ 771bb7f, carries 4.0 |

Checked 2026-10-31: the DTA's terms (https://www.deutschestextarchiv.de/doku/nutzungsbedingungen) say all full texts
are CC BY-SA 4.0 unless marked otherwise (since 16 June 2020; CC BY-NC 3.0 before), ask that reuse name the DTA as the
maker of the electronic text, and describe the texts as freely usable for non-commercial purposes; this dataset is a
non-commercial research release. CAMENA's page (http://mateo.uni-mannheim.de/camenahtdocs/camena.html) says its
machine-readable texts are available under Creative Commons Attribution / Share Alike.

The page images are not included. Each row names the image URL and its sha256; the scans are public-domain books held
by their libraries, under those libraries' own terms of use.

Attribution for the typed texts: Deutsches Textarchiv, Berlin-Brandenburgische Akademie der Wissenschaften,
https://www.deutschestextarchiv.de/ ; CAMENA — Lateinische Texte der Frühen Neuzeit, Universität Mannheim,
http://mateo.uni-mannheim.de/camenahtdocs/camena.html .
