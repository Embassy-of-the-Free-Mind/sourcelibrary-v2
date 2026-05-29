# Author normalization & reconciliation — method note

How catalog translation records were matched to USTC works by author, for the
Translation Gap census (2026-05-29). Written for reproducibility and as the
basis for a production-grade aligner. See also
`.claude/handoffs/2026-05-29-translation-gap-census.md` and
auto-memory `project_ustc_translation_census.md`.

## The problem
We need to decide whether a translation record (in `translation_catalogs`)
and a USTC work (in `ustc_distinct_works`) are by the **same author**. Naïve
exact-string surname matching fails badly on early-modern names:

- **Latinization / vernacular splits** — *Agrippa von Nettesheim* filed as
  `nettesheim` in one source, `agrippa` in another.
- **Pseudonyms & pseudo-attributions** — *Geber* ↔ *Jabir ibn Hayyan* ↔
  *pseudo-Geber*.
- **Particles & word order** — *de la*, *von*, *della*; surname-first vs
  given-first.
- **Diacritics & spelling drift** — *Böhme / Boehme / Behmen*.

The matcher therefore has two layers: (1) deterministic **string
normalization**, and (2) **authority reconciliation** that expands a surname
to its known variant forms.

## Layer 1 — string normalization
Single function applied to every name string on both sides:

```python
import unicodedata, re
def norm(s):
    if not s: return ""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()  # strip diacritics
    return re.sub(r"[^a-z0-9 ]", " ", s.lower())                                  # lowercase, punct→space
```

- `NFKD` + `encode('ascii','ignore')` folds `Böhme→Bohme`, `Khūnrath→Khunrath`.
- Punctuation→space avoids `geber,`/`geber.` mismatches.
- Source fields: catalog `author_surname` (already lowercased in
  `translation_catalogs`); USTC `ustc_distinct_works.author_surname`.

This alone (v1/v2 of the matcher) matches only when the two sources happen to
file the author under the *same* surname token. It misses every case in the
problem list above — e.g. under exact `geber`, USTC holds just **1** record.

## Layer 2 — authority reconciliation (the "VIAF" step)
Two Supabase tables supply variant name forms:

- **`entity_aliases`** (80,912 rows) — authority clusters keyed to
  VIAF/Wikidata/GND/CERL IDs. Each row carries `primary_name`, a `names[]`
  array, and a `surnames[]` array of every variant surname for that one
  identity.
- **`author_aliases`** (202 rows) — a small *curated* bridge of
  `ustc_form` ↔ `catalog_form` pairs (e.g. `ovid` ↔ `ovidius naso`).

Build surname→cluster and cluster→surnames indexes from `entity_aliases`:

```python
sur2cl, cl2sur = {}, {}
for e in entity_aliases:                       # e = {"id":..., "surnames":[...]}
    cid = e["id"]
    sset = {norm(s) for s in (e.get("surnames") or []) if len(norm(s)) >= 4}
    cl2sur[cid] = sset
    for s in sset:
        sur2cl.setdefault(s, set()).add(cid)
```

`len >= 4` is a crude noise filter: `surnames[]` in practice also contains
given-name fragments (e.g. `giuseppe`), which would over-link if treated as
surnames.

Curated bridge (last token used as a surname proxy):

```python
cat2ustc = {}
for r in author_aliases:
    cf, uf = norm(r["catalog_form"]), norm(r["ustc_form"])
    if cf and uf:
        cat2ustc.setdefault(cf.split()[-1], set()).add(uf.split()[-1])
```

Expand a catalog surname to all forms an equivalent USTC author might use:

```python
def expand(sn):
    out = {sn}
    cls = sur2cl.get(sn, set())
    if 0 < len(cls) <= 3:                # ambiguity guard
        for c in cls:
            out |= cl2sur[c]
    out |= cat2ustc.get(sn, set())       # curated overrides always applied
    return out
```

**Ambiguity guard** — a surname appearing in `>3` clusters is *not* expanded.
A common token (e.g. a frequent given-name fragment that slipped past the
`len>=4` filter) would otherwise pull in dozens of unrelated identities.
Trade-off: this also refuses to expand genuinely prolific surnames, so it
under-recalls on those.

Matching candidates for a catalog author = the union of USTC works filed under
**any** expanded surname (not just the literal one). A candidate pair is only
*accepted* if it also passes the title test (shared Latin incipit/bigram, or
high token-overlap) — author reconciliation widens recall; the title gate
holds precision.

## Results
- Catalog surnames `4,097` → expanded variant universe `9,606`.
- Distinct USTC Latin works linked: `1,286` (no reconciliation) → `1,513`
  (with reconciliation), +18%.
- Net effect on the Latin rate: ~2.24% → ~2.29% (small; see robustness table
  in the resource).

## Known limitations (and why the gain was modest)
1. **Surname-only.** Given names and life-dates from `entity_aliases` were not
   used to disambiguate; collisions are possible (held in check only by the
   title gate).
2. **`surnames[]` mixes given names and surnames** — `len>=4` + the ambiguity
   guard are blunt instruments, not real role tagging.
3. **`author_aliases` is tiny (202)** and its last-token surname proxy is
   fragile for multi-part names.
4. **No transliteration / fuzzy / phonetic matching** — the Arabic↔Latin
   *Jabir→Geber* leap isn't bridged; `geber` stayed unexpanded (its cluster
   either omits `geber` as a surname or is too ambiguous), so pseudo-Geber's
   *Summa* still missed in validation.
5. Most of the residual gap is **structural, not author-matching**: a large
   share of catalog translations are of works outside USTC's Latin scope
   (classical Greek/Roman, post-1700, vernacular, manuscript), which no name
   reconciliation can recover.

## Recommended production approach
- **Reconcile on cluster ID, not surnames.** Tag both catalog authors and
  USTC authors with their `entity_aliases` cluster ID up front (the
  `viaf-author-linking.mjs` pipeline already resolves authors to authority
  IDs), then match on shared cluster ID — eliminating surname games entirely.
- Use **full name + birth/death years** from the authority record to
  disambiguate same-surname different-person cases; drop the ≤3-cluster guard.
- Add a **phonetic/edit-distance surname fallback** (Double Metaphone +
  Levenshtein) gated by a corroborating title-incipit match.
- For authors with **no authority cluster**, call the VIAF/Wikidata
  reconciliation API live and cache results.
- Keep the **tiered completeness score** on the resulting link, not a boolean.

## Addendum — stem-then-authority (2026-05-29, applied to the ILP catalog)

Implemented as `scripts/lib/author-reconcile.mjs`. Validating against the Index
Librorum Prohibitorum surfaced one finding that changes Layer 2 materially:

**Authority records enumerate vernacular/standard variants but NOT every Latin
grammatical inflection.** The Giovanni Pico cluster (VIAF 34491108) lists
`pico, pic, picco, mirandula, mirandola, mirandole, mirandulensis…` — but *not*
`picus`. So Layer 2 as originally written (exact surname → cluster) still misses
the Index form "Picus, Ioannes", and an exact `picus` lookup mis-pulls *Andreas
Picus* and *Ranuccio Pico* instead. The authority table is built from how
libraries file names, not from how a 16th-c. Latin index inflects them.

**Fix: a morphological layer BEFORE the authority lookup.** Stem each token to
fold Latin endings (`-us/-i/-o/-um/-ae/-ensis…`), so `picus → pic` meets the
cluster's enumerated `pic`. Stemming is applied to *both* the query and the
cluster surnames; match on shared stem.

**Surname-vs-given-name separation, done by document frequency instead of
`len>=4`.** `surnames[]` mixes real surnames with given-name fragments
(`ioannes`, `john`, `giovanni`). Rather than a length heuristic, compute each
stem's document-frequency across all 80,912 clusters: a stem in thousands of
clusters is a given name / generic word, a real surname stem is rare. Gate both
candidate-matching and expansion on **distinctive** stems (df ≤ 30). Measured:
`pic`=10, `mirandol`=12, `mirandul`=3 (kept) vs `john`=1312, `ioann`=610,
`giovann`=1870 (dropped). This is what stopped the first cut from "recalling"
John Calvin and Chrysostom for Pico.

**Common-surname rescue.** A surname that is *itself* a common token (Desiderius
**Erasmus**) would be blocked by the distinctiveness gate and recall nothing —
the old ambiguity-guard's blind spot. Fallback: for a non-distinctive surname
stem, still admit candidate clusters, but only those that ALSO match the query's
given name. "Erasmus, Desiderius" → resolves correctly; the literal surname is
always unioned back into the search terms so catalog-native forms aren't lost.

**Disambiguation = given-name overlap (dominant) + life-date plausibility**
(can't be banned before birth). "Picus, **Ioannes**" → Giovanni Pico; "Picus,
**Andreas**" → Andreas Picus; no cross-contamination.

Validated recall (literal-surname SL search → reconciled): Pico 0→40, Bruno
2→34, Machiavelli 0→5, Erasmus 40→40 (+Dutch forms), Andreas Picus 0→0 (decoy
correctly refused). Reconciliation widens recall; the title gate + Gemini
same-person verifier in the backfill scripts still hold precision (they must —
surname clusters can't separate Giovanni Pico from his nephew Gianfrancesco, or
from Jean Pic the Carthusian, all "Ioannes Picus").

Run it: `node scripts/lib/author-reconcile.mjs "Picus, Ioannes" 1632`.
