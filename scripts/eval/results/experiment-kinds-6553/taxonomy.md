KINDS (pick exactly one primary kind per write-up; the kind is WHAT SORT OF QUESTION and WHAT THE ANSWER CHANGES, not the topic):

route-choice: compares engines, models, lanes, or operating settings of a lane (input crops/preprocessing, pages per call, thinking, correction vs re-read, two-model strategies) to decide WHICH ROUTE handles a cell of pages (OCR, translation, or metadata extraction). Feeds: route.
prompt-test: tests a prompt version or an instruction edit against the live prompt, same model. Feeds: prompt.
detector-calibration: builds, scores or tunes a detector, screen, gate, classifier or threshold that flags/withholds/routes pages (fabrication detector, blank-page gate, seam detector, illegible gate, language classifier). Feeds: detector/threshold.
judge-validity: checks whether a judge, metric, instrument, scoring rule or sampling proxy measures what it claims (judge agreement, self-preference, CER normalisation, noise floor). Feeds: judge rule (eval-design / harness).
reference-build: builds or measures a ground-truth / reference set (typed editions, human transcriptions, gold sets) or measures the reference's own error. Feeds: reference resolution used by later evals.
quality-audit: samples LIVE served text/books to estimate a defect rate or quality level of what readers get now (spot checks, shelf reviews, stale translations). Feeds: published figure and/or a repair worklist.
census: counts or inventories the corpus or a backlog without judging quality (how many pages of X, coverage, sizing a lane, field coverage). Feeds: priorities/plan.
repair-log: records applying a fix or sweep across stored data (counts written, gates, undo). The change already happened. Feeds: data repair.
pipeline-diagnosis: investigates why a pipeline, worker, cron, sync, quota, or infra behaves wrongly or how it really behaves (a bug, a drift, an incident, a mechanism finding). Feeds: code fix / invariant or guard.
cost-throughput: measures cost, quota use, latency or throughput of a route or worker (agy per-call quota, $ per page, pages/hour). Feeds: router cost rows / spend controls.
search-retrieval: tests search, embeddings, vector index settings, ranking or recall. Feeds: product surface (search).
product-test: tests a reader-facing or agent-facing surface: the reader, Librarian/MCP agent answers, UI, readers' behaviour, page copy, analytics of a feature. Feeds: product surface.
capability-probe: exploratory "can a model/tool do X at all" on a new task or hard item (music notation, one manuscript, a new engine's first look) with no route decision yet. Feeds: nothing yet / a proposal.
plan-prereg: a design, preregistration or plan with no results yet, or a meta note about the experiment process itself. Feeds: nothing (a later run).
retraction: corrects or withdraws an earlier entry's number, label or conclusion. Feeds: the earlier entry's status.

FEEDS (what the result should change; pick one): route | detector-threshold | prompt | judge-rule | reference | published-figure | invariant-guard | product-surface | data-repair | code-fix | plan | nothing
