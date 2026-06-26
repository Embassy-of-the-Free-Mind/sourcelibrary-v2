# Independent First-Translation Validator — Runbook

**Purpose.** Produce *non-circular* ground-truth labels for whether a book has a **prior published English translation**, to (a) seed/score the FT eval (`ft-eval.mjs`) and (b) become the template for a Gemini-automated validator. Run this in a **separate Claude Code window** doing careful, human-like research.

**The claim is graded + target-language-specific + a bounded negative.** Not a boolean. Each verdict is one of:
- `translation_found` — a prior complete English translation of *this work* exists → the book is NOT a first.
- `first_complete` — only partial/excerpt English translations exist before us.
- `first_modern` — only a pre-1900 English translation exists.
- `first_from_source` — English exists from a *different* source language, not from this one.
- `confirmed_first` — no prior English translation of any kind found.
- `needs_human` — work-identity/edition ambiguity the agent can't resolve.

A "first" verdict is an **absence claim**, only as strong as the documented search behind it (see §3).

---

## 1. Independence is the whole point

This validator must **NOT** call the production engine (`src/lib/verify-first-translation.ts`) or reuse its 7 APIs as the primary method — otherwise we grade the pipeline against a clone of itself. Requirements:
- **Adversarial stance:** the goal is to *prove a prior English translation EXISTS*. Bias toward finding; only conclude "first" when an honest hunt fails.
- **Different / broader surfaces** than the production engine: WorldCat (UI/search), HathiTrust, Google Books, OpenLibrary, archive.org, plus scholarly bibliographies, series indexes (Loeb/Penguin/Oxford/Sacred Books of the East/ANF-NPNF), and targeted web search.
- **Evidence required for every verdict** (see §4). No bare assertions.

---

## 2. Per-book procedure

1. **Pin the work + edition + target language.** Distinguish the *work* from *this edition*. A translation INTO another language (e.g. Seneca's Italian *Pistole*) is NOT an English translation of the Latin. A translation of the *source from its original tongue* (English Plato from the Greek) is NOT a translation of *this* Latin edition (Ficino's). Flag containers (Opera Omnia / multi-vol *Tomus*) — claim at constituent-work level or mark `needs_human`.
2. **Internal-match check FIRST (cheap, sharp).** Does `translation_catalogs` already hold a prior English translation for this author/work? (We have Loeb + classics already.) If yes and it resolves → `translation_found`. This isolates "we already had the answer and didn't match it" from genuine recall gaps.
3. **Adversarial external hunt.** Query each source in §1, varying terms (Latin title, English title guesses, author variants, series). Record *every* query and its result (§3).
4. **Synthesize** the verdict (§ taxonomy) with reasoning that names the decisive evidence (or the decisive absence).

---

## 3. The attempt log = evidence of absence (REQUIRED, append-only)

Every run appends one `attempt` record. Never overwrite. The negative claim's credibility *is* this accumulated log.

```json
{
  "attempt_id": "uuid",
  "at": "2026-06-19T..Z",
  "agent": "claude-code-manual" | "gemini-auto-v1",
  "stance": "adversarial",
  "target_language": "English",
  "sources_searched": [
    { "source": "worldcat", "query": "Kircher Arithmologia English", "n_results": 0, "top": [] },
    { "source": "hathitrust", "query": "...", "n_results": 3, "top": [{ "title": "...", "url": "...", "why_rejected": "Latin reprint, not a translation" }] },
    { "source": "google_books", "query": "...", "n_results": 0, "top": [] },
    { "source": "internal:translation_catalogs", "query": "author=Kircher", "n_results": 0, "top": [] }
  ],
  "found": [
    { "english_title": "...", "translator": "...", "pub_year": "...", "completeness": "complete|partial|excerpts", "url": "...", "source": "..." }
  ],
  "verdict": "confirmed_first",
  "reasoning": "1-3 sentences naming the decisive evidence or the decisive absence",
  "bounded_negative": "No prior English translation found in [worldcat, hathitrust, google_books, openlibrary, archive.org] as of 2026-06-19."
}
```

- `found` non-empty → a positive (high precision). `found` empty → the *attempt log* carries the weight; the `bounded_negative` string enumerates exactly what was searched, as of when.
- **Independence metadata matters:** weight coverage by *distinct* sources, not attempt count — three correlated misses on the same index ≈ one. (Future `coverage_score` reads this.)
- This is the same shape as the eventual **public provenance widget** ("first translation, established by searching … on [date], none found") and a superset of the production `translation_verification.search_evidence`.

---

## 4. Output → benchmark

For each book emit `{ book_id, work_id?, author, title, language, label: <verdict>, found[], attempts[], ground_truth_source: "independent-validator (silver), human-audited?" }` and append to `scripts/eval/ft-benchmark.json` (`cases[]`). **Do not** set `ground_truth_source` to the production verdict or the default placeholder — that's the circularity guard `ft-eval.mjs` keys on.

**Silver, not gold.** Label honestly as LLM-annotated, evidence-backed. A human **sample-audits ≥20%** + every marquee/first claim; track agreement. Disagreements → `needs_human`.

---

## 5. First batch (balanced ~80-case seed)

- **Known firsts (negatives for the search):** Arithmologia, Kabbala denudata, Picinelli *Mundus Symbolicus*, Masen *Speculum imaginum*, Theatrum chemicum.
- **Known-translated (positives):** the false-firsts surfaced this session — Caesar, Virgil, Plato/Ficino, Galen, Josephus, Augustine, Erasmus, Seneca, Pliny, Andersen.
- **Live-conflict set:** the 33 clean conflicts (canonical authors + scripture MSS + misfiled art) as positives; a sample of the ~92 ambiguous (work-identity/edition failure modes) as hard cases.

Aim: both classes represented, hard cases (containers, section-translation-under-a-different-title like Fludd → *Temple of Music*, vernacular-vs-Latin) deliberately included.

---

## 6. Path to Gemini automation

The manual window proves the *procedure*. Once its labels agree with the human sample-audit on a batch, encode the **same procedure + attempt-log schema** as a Gemini validator and run at scale. The attempt log makes every automated negative auditable the same way the manual one is — that's what lets us trust automation without re-introducing the single-pass-oracle problem.
```
