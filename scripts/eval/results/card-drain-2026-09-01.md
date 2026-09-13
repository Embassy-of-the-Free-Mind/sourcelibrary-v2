# Card drain — the 191-card verified-method tranche (2026-09-01)

*Not a sampling round: the full review of the first tranche of harvested cards
(#4536 stage 2 follow-through, #3881). Review delegated by Derek to Claude the
same evening ("im not going to review them, you just have to do the best you
can"); the adversarial bar of rounds 1–4 kept. This record follows the
round-record convention of `translation-card-method.md`.*

## What was reviewed

The citation harvest (#4536) inserted 5,174 silent `under_review` cards; 191 of
them carried at least one entry whose ledger method was verified-class
(`tier2_agent` / `human` / `claude_subagent_verify`). Those 191 were the
tranche.

## Method

- **24 independent verifier subagents** (Claude, subscription — zero Gemini
  spend), ~8 works each, **unprimed**: each got only the work's identity
  (id/title/author), never our card or the harvested entries.
- Hard rule: no translation reported without an **opened** source backing it;
  unconfirmed leads quarantined in `uncertain`. "None found" explicitly
  legitimate. Domain leads (84000, Lotsawa House, BDRC for Tibetan; Loeb/NPNF/
  SBE for classics) supplied as leads-to-verify, never facts-to-copy.
- Mechanical merge (`merge-tranche-review.mjs`, session scratchpad; archived
  with outputs in the ops repo) + six explicit reviewer overrides, then
  **read-side shape verification** in Mongo after apply.
- Write guard: only `status:'under_review'` cards touchable. Provenance:
  `review.verified_by: claude_adversarial_tranche_2026_09_01` + sweep_log rows.

## Result (all 191 adjudicated)

| Outcome | n | Notes |
|---|---|---|
| `prior_exists` | 154 | 679 cited entries; 346 new verified entries; 178 uncited harvest entries dropped (hygiene: no citation → no entry) |
| `no_prior_known` | 19 | verified absence claims with search records — incl. Khunrath *De Chao*, Schaidenreisser's 1537 German *Odyssea* (first_from_source class), Mersenne *L'impieté des déistes*, Wu Qijun *Zhiwu Mingshi Tukao* |
| `not_a_single_work` | 2 | empty containers |
| held `under_review` + `review.identity_flag` | 16 | see below |

## The 16 holds (the review's real findings)

- **4 QID mis-keys** — the round-3 defect class recurring at scale: Q4071312
  (card says Pymander, QID denotes the Asclepius node), Q134480351 (denotes
  Vasubandhu's Diamond Sutra *commentary*), Q138752489 (a c.1400 Venetian-Italian
  Boethius adaptation, not the Latin+Waleys edition), Q728047 (whole Syntagma
  Musicum vs our vol. III). → work-identity queue (#2318 family).
- **3 scripture-content witnesses** (Gospel lectionary MS. Cromwell 11, a
  Psalterium Quadrilingue, the 1627 Ladino Ḥumas): the underlying scripture is
  amply translated; a "first English translation of this work" sentence would
  mislead even under Policy 2. **Open policy call: does a scripture witness
  earn the first-translation sentence?**
- **3 unresolved durable partials**: Fludd *Tomus secundus* (Huffman, *Essential
  Readings* 1992 may translate excerpts), Huangchao liqi tushi (*Imperial
  Wardrobe* renders portions), Llull *Liber contemplationis* (2026 Brepols
  appendix, DOI cited). Each needs one contents check before any absence claim.
- Rest: English originals (e.g. Catesby) and unidentifiable manuscripts.

## Error-class notes for the method table

- Fabrication screening held: verifiers confirmed-with-opened-source or
  quarantined; no fabricated entry reached a rendered card.
- New negative-evidence class worth naming: **"in progress" ≠ published**
  (84000's Vasudhārā translations are listed but unpublished — they cannot be
  cited as priors).
- Restricted practice booklets (Kunzang Gongdü, Naro Khacho) surfaced again and
  fell out naturally under the durable-identifier defeater policy: listed
  leads, non-defeating, absence claims stand.
- Identity metadata corrections as a side yield: Bodleian MS. Barocci 99 is a
  13th-c. Greek **Prophetologion** (Bodleian TEI record), not a theological
  miscellany.

## Stage 2 (same evening)

The 1,237 harvested entry proposals for the 297 pre-existing cards went through
per-entry citation adjudication (20 agents; verdicts confirmed / corrected /
wrong_work / fabricated / unverifiable; opened-source rule). Merge rules:
eligible = confirmed+corrected only; add-only; a `no_prior_known` card
receiving a confirmed durable pre-2022 prior is **refuted → `prior_exists`**
(the fail direction removes a claim, never adds one). Results recorded on
#4536.
