# Work-identity casebook — the patterns that make "first translation" hard

*A field guide for the recurring question: "I'm looking at this record — is it the original, a translation, a piece of a work, a bag of works…? and does a 'first English translation' claim even apply?" The architecture lives elsewhere (see Cross-refs); THIS doc is worked examples you can pattern-match against. Born from the #2876 spot-check, where ~44% of a random badge sample was structurally mis-posed, not factually wrong.*

> **The one rule everything else serves:** *"first English translation" is a predicate on a **work**, asserted about a **manifestation** (an edition we hold). It is only well-posed once you have pinned (a) which work this is, and (b) what role this manifestation plays for that work (source / earlier translation / the translation being claimed). Get those two wrong and the badge is meaningless no matter how good the search was.*

The two layers the badge sits on:
- **Work identity** — one `work_id` per work; editions cluster under it (`books.work_id`; see [work-identity-coverage.md](./work-identity-coverage.md)).
- **Text role** — `text_role ∈ {original, period-translation, modern-translation}` + `original_language` (the *source* language, not the edition's).

When both are right, `is_first_translation` is computable. When either is wrong, you get the failure modes below.

---

## Flagship worked example — Iamblichus, *De mysteriis* (one work, every hard pattern at once)

The work: Iamblichus, *De mysteriis Aegyptiorum* (*On the Mysteries of the Egyptians*), **Greek**, ~3rd–4th c. Canonical id: **Wikidata Q3359785**. In our holdings, this ONE work appears as:

| What we hold | Correct role | What's actually stored | Verdict |
|---|---|---|---|
| Greek text (ed. Thomas Gale; ed. Florentine) | `original`, orig Greek | ✓ mostly right | source — badge N/A |
| **Ficino's Latin** (Aldine 1497; 1570; Lyon) | **`period-translation`, orig Greek** | ✗ tagged `original`, orig **Latin** | NOT an English first; it's a Renaissance *Latin* translation |
| Thomas Taylor's **English** (1821) | `modern-translation`, orig Greek | ✓ right | the **prior English** → makes later English `not_first` |
| "Pymander. Asclepius. De mysteriis… In Platonicum Alcibiadem" | container (Ficino omnibus) | given a single work_id | `not_applicable` at container level |
| "Synesius De somniis, Iamblichus, Proclus… **Ficino interprete**" | container (author-list) | **badged `is_first_translation:true`** | false badge — author-list Sammelband |

Three defects this one cluster exposes, each a general pattern:

1. **Work fragmentation.** The same work wears **≥5 work_ids** here — `Q3359785`, `iamblichus-de-mysteriis`, `corpus-hermeticum`, `local:n:…pymander…`, and `local:a:marsilio-ficino:1497-voluptate` (the *De Voluptate* id — simply wrong). With one work split five ways, "do we hold the original / is this the first English" is unanswerable. (Cross-ref: the omnibus-contamination note in work-identity-coverage.md §"Spot-check audit".)
2. **Period-translation tagged as original.** Ficino's Latin *De mysteriis* is a translation *from the Greek*, but it's stored `text_role:original, original_language:Latin`. Corpus-wide this is systemic: **`period-translation` is used 19× vs `original` 47,139×** — the great majority of Renaissance Latin translations (Ficino, Trebatius, Argyropoulos…) are mislabeled originals. Ad fontes: the *real* source is Greek (cf. [feedback go-to-original-sources]).
3. **Author-list containers evade the container detector.** `ft-structural-triage.mjs` catches "Opera Omnia / Collected Works" titles but not "A, B, C … *interprete* X" lists — yet those are exactly the same multi-work-binding pattern. **Detector gap to close.**

Once those are fixed (one work-node, Ficino editions = period-translations, containers decomposed), the badge resolves cleanly: **Taylor 1821 is the first English; everything Greek/Latin is source-or-period; the modern retranslations are `not_first`; the omnibuses are `not_applicable`.** None of that is a research question — it's all work-identity + role.

---

## The pattern catalogue

Each entry: **the tell** (how to recognize it), **the correct call** (role / work_id / badge), and a **real example** from our corpus.

### 1. Original (the source text)
- **Tell:** the text in its composition language; no translator; title in the source tongue.
- **Call:** `text_role:original`; `original_language` = its own language. Badge N/A — "first translation" is a claim about translations *of* it, not about it.
- **Example:** *Iamblichi De Mysteriis Aegyptiorum liber* (Greek).

### 2. Period translation (pre-modern, esp. Renaissance Latin)
- **Tell:** a named pre-1800 translator into Latin/vernacular (Ficino, Trebatius, Argyropoulos, Bruni); "…interprete X"; an early printed Latin edition of a Greek/Arabic/Hebrew work.
- **Call:** `text_role:period-translation`; `original_language` = the *source* (e.g. Greek), NOT Latin. It is itself a translation, so it does **not** carry an "English first" badge; it's evidence the work entered Latin, not English. (If we ever badge "first English translation of *Ficino's Latin recension*" that's a `first_from_source` claim — rare, and must be explicit.)
- **Example:** *Iamblichus, De Mysteriis* (Ficino edition 1570) — currently mis-tagged `original`.
- **Why it matters:** mislabeling these as originals both inflates the "we hold the original" count and corrupts the source-language rule.

### 3. Modern translation (the thing we usually badge)
- **Tell:** a 19th–21st c. translator into English; `original_language` ≠ English.
- **Call:** `text_role:modern-translation`. This is where `is_first_translation` lives — TRUE only if no earlier English translation of the *same work* exists.
- **Example:** *Iamblichus on the Mysteries…* (Thomas Taylor, 1821) — a **prior** that makes later English editions `not_first`.

### 4. Container / Sammelband (several distinct works bound together)
- **Tell:** title lists multiple works/authors ("Pymander. Asclepius. De mysteriis…"; "Synesius… Iamblichus… Proclus… *interprete* Ficino"); "Opera Omnia", "Opuscula", "Add: [other author]".
- **Call:** `not_applicable` at the container level; the claim belongs to each **constituent** work (model with `contained_works[]` / `work_part_of`, per [work-hierarchy-modeling-research.md](./work-hierarchy-modeling-research.md)). Never badge the binding.
- **Examples:** the two De mysteriis omnibuses above; *De eucharistia… (Pseudo-)… Add: Nicolaus de Lyra*.
- **Detector note:** triage catches "Opera Omnia"-form; **author-list and "Add:" forms are the open gap.**

### 5. Volume of a multi-volume work (a real work at the wrong granularity)
- **Tell:** "Vol. II", "Tomus", "Band 3", "(六)", "卷五十八", "第N冊".
- **Call:** **WORK-RESOLVE, never demote.** The work is the whole set; cluster the volumes under one `work_id` and badge the *work*. Demoting the volume would erase a genuine first.
- **Examples:** Kircher *Musurgia Universalis* Vol. I / Vol. II; *武備志(五十八)* (Wubei Zhi vol. 58); *三才圖會(六)* (Sancai Tuhui vol. 6).

### 6. Recension / different-source-language version
- **Tell:** same work, but reached English (or could) via a *different* source than the usual one — a Hebrew-from-Latin Aristotle, a Syriac-from-Greek gospel.
- **Call:** `first_from_source` — an English of *this recension's source* is a legitimate first even when the work is otherwise ubiquitous in English. Don't let the famous Greek-based English defeat it; don't over-claim it as "the first English Metaphysics" either.
- **Example:** Aristotle, *Metaphysics* in Baruch ibn Ya'ish's **Hebrew** (rendered from the Latin), MS Leiden Or. 4771 — unpublished/untranslated; an English of it would be first *from that source*.

### 7. Commentary / exposition / derivative (a distinct later work *about* a work)
- **Tell:** "Commentary on…", "Exposition of…", an author writing *about* an earlier master.
- **Call:** its own work with its own identity. "First English of the commentary" is independent of "the underlying classic in English." Don't let the famous source's English translations defeat the commentary's first-claim.
- **Example:** Fullana, *La sabiduría universal del Raymundo Lullio* (1712) — a Spanish exposition of Llull; Llull's *own* works being in English does not make Fullana's translated.

### 8. Pseudonymous / misattributed authorship
- **Tell:** "(Pseudo-)", a famous name on an obscure tract, a namesake collision (Michael Alberti ≠ L.B. Alberti).
- **Call:** resolve the *real* author before any prior-match (a same-name prior is a false defeat); often co-occurs with the container pattern.
- **Example:** *De eucharistia… (Pseudo-)…*.

### 9. Miscellany / liturgical compilation (no single work to translate)
- **Tell:** `thor bu` ("scattered/miscellaneous"), `gsung 'bum`/`bka' 'bum` (collected works), `chos spyod`/`zhal 'don` (daily-liturgy compilations), monastery/collection authorship, "Miscellaneous floating pages".
- **Call:** `not_applicable` at the collection level (contents vary by edition); the constituent texts are the units. **WORK-RESOLVE, not a blind demote** — many constituents are genuinely untranslated.
- **Example:** *Thor bu Thugs rje chen mo mun sel sgron me'i skor* (a `thor bu` around a Pema Lingpa terma cycle).

### 10. Artwork / image-only (genuinely nothing to translate)
- **Tell:** map, engraving, plate album, atlas, "…cælavit / sculpsit", an engraver as "author"; `content_type:'artwork'`. *Veto:* an illustrated **text** (a treatise *with* plates) is NOT this — it's a real work.
- **Call:** `not_applicable`. The only class that is a clean demote with no work-resolution needed.
- **Example:** *Namurcum comitatus / Petrus Kaerius cælavit* (a map).

---

## Decision shortcut

```
Is there running source-language text to translate?
 ├─ no  → artwork/image  → not_applicable (demote)                 [#10]
 └─ yes → Is it ONE work?
     ├─ no, several bound → container/Sammelband → not_applicable; resolve constituents   [#4,#8]
     ├─ no, a slice of one → volume/part → WORK-RESOLVE, badge the whole work             [#5]
     ├─ no, a varying bag → miscellany/liturgy → not_applicable at collection; constituents are units [#9]
     └─ yes, one work → What ROLE is this manifestation?
         ├─ source text            → original → badge N/A                                  [#1]
         ├─ pre-modern translation → period-translation → not an English first             [#2]
         ├─ modern English transl. → modern-translation → is_first_translation? (search)   [#3]
         ├─ via a different source → first_from_source                                     [#6]
         └─ a work ABOUT the work  → its own identity; judge on its own                    [#7]
```

Only the **bottom branch (#3)** is the question the verifier/Tier-2 should spend research on. Everything above it is settled by **work-identity + text-role**, free, before any web search — which is why those two layers are the highest-leverage fix (and why blanket-demoting #5/#9 destroys genuine firsts).

---

## Open defects this casebook names (for the work-identity backlog)
- **Period-translation under-tagging** — 19 vs 47,139 `original`; Renaissance Latin translations systematically mislabeled (#2 above). A targeted re-tag (named pre-1800 translator + source≠Latin) is a clean, measurable pass.
- **Work fragmentation** — one work across multiple `work_id`s (De mysteriis ≥5; Gītā; Poimandres↔Corpus Hermeticum). Keystone fix = the work-hierarchy / `contained_works[]` layer (#2567 / #2318 / #2453).
- **Container detector gap** — `ft-structural-triage.mjs` misses author-list ("…interprete X") and "Add:" Sammelbände (#4). Extend the patterns.

## Cross-refs
- [first-translation-system.md](./first-translation-system.md) — the badge mechanics + §14 eval harness (#2876).
- [work-identity-coverage.md](./work-identity-coverage.md) — clustering state, the fit rule, the omnibus-contamination audit.
- [translation-works-architecture.md](./translation-works-architecture.md) — how work / translation / holdings / first-translation stack.
- [work-hierarchy-modeling-research.md](./work-hierarchy-modeling-research.md) — FRBR whole/part vs aggregates; the `contained_works[]` model.
