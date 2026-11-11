---
stage: pipeline
measure: [judged]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "search_concept similarity measures topic, not stance. On 7 claim/contradiction pairs the top-1 scores differed by 0.027 on average (max 0.061), and the contradiction scored higher in 4 of 7. Passages that deny the query ranked in the top 3 at 0.74 or more. Five off-topic controls scored 0.55–0.65 at top-1, inside the old 'worth reading' band."
status: adopted
decision: "MCP tool text (search_concept, search_within_book, the search_concept tip) now says the score measures topic, not stance, and calls 0.55–0.70 weak (#8504)"
feeds: surface
landed: "src/app/api/mcp/route.ts"
supersedes: []
superseded_by: null
issue: [8504]
---
## 2026-11-11 · Can search_concept's similarity tell a claim from its contradiction? (#8504)

PRIOR ART: #3699 (search_within_book's normalised score), whose bands the search_concept text reused without a measurement. #8466 item 3 is where a member reported this.

**Who it is for.** Callers of the MCP `search_concept` tool. They read the tool text "0.70+ strong match (quote with confidence)" and may cite a high-scoring passage as *support* for a claim.

### Design
- 7 topics, each with a claim (`thesis`) and its contradiction (`opposite`): mortality of the soul, eternity of the world, transmutation, astral determinism, heliocentrism, demonic vs natural magic, vacuum. 5 off-topic controls: banana bread, smartphone battery, cloud-software earnings, basketball free throws, wifi router password.
- Run against the production `/api/mcp` `search_concept` endpoint, `diversity: "off"`, `limit: 5`. The query set, script and top-5 results are in `scripts/eval/results/search-concept-stance-8504/`.
- To label stance, I (the job's Claude, not a blind judge) read the top 3 hits for the three minority-stance queries: soul dies, earth moves, vacuum exists. That is 9 passages.

### Result
| topic | top-1 thesis | top-1 opposite | Δ |
|---|---|---|---|
| soul | 0.767 | 0.770 | 0.003 |
| eternity | 0.778 | 0.818 | 0.040 |
| transmutation | 0.807 | 0.824 | 0.017 |
| astrology | 0.791 | 0.817 | 0.026 |
| heliocentrism | 0.752 | 0.814 | 0.061 |
| magic | 0.792 | 0.783 | 0.010 |
| vacuum | 0.777 | 0.746 | 0.031 |

- On-topic top-1 range: 0.746–0.824. Off-topic top-1 range: 0.550–0.650. The gap between them is real, but the 0.55–0.70 band holds unrelated queries.
- Stance, from the 9 passages read:
  - "the soul dies with the body": none of the 3 hits asserts it. Hit 3 (Matthew: "fear not them which kill the body, but are not able to kill the soul") denies it at 0.754. One passage appears for both queries, scoring 0.759 against the claim and 0.770 against its denial.
  - "the earth moves around the sun": hit 1 asserts it. Hit 2 (*Cosmographia elementaris*, the sun moving "around the earth") denies it at 0.748.
  - "a vacuum can exist in nature": hits 2 and 3 (Schott, "Nature's co-effort to prevent a vacuum", "an experiment proving that a vacuum does not exist") deny it at 0.739–0.743.
- The two queries in a pair mostly return different passages (0–2 of 5 shared). Ranking does carry some lexical signal. The *score*, though, cannot say which way a passage argues.

### Not done
- No per-query baseline is reported in the response (the issue's second option). The off-topic band could feed one, but that would be a code change. It is left for a separate PR if callers need it.
- The `absent` threshold in search_within_book (top score < 0.55 and no lexical hit) is unchanged. Within one book the top scores are lower than corpus-wide, so these corpus-wide controls do not calibrate it.

*Replicated?* No. n=7 pairs, one run, and one non-blind labeller.
