# Islamic Scientific & Graeco-Arabic Sources — Curation & Import Reference

Compiled 2026-08-31. Every access pattern marked VERIFIED was exercised by a
live fetch on that date. Sibling of `chinese-iiif-sources.md` and
`sanskrit-sources.md`; same conventions.

## Why this corpus, in one paragraph

Latin Europe received Aristotle, Galen, Ptolemy and Euclid **through Arabic**.
We already hold the Greek end and the Latin end of that chain; the Arabic middle
is what makes the two legible as one story rather than two collections. It is
also where a number of Greek works survive **at all** — see "Novel Greek" below.

## Sources, by whether they can actually be imported

| # | Repository | Reachable? | Holdings | Access | Ease |
|---|---|---|---|---|:---:|
| 1 | **Gallica (BnF)** | **VERIFIED 200** | **arabe 10,439 · persan 2,107 · turc 1,972** manuscripts | SRU enumeration + IIIF manifests; `/api/import/gallica` works server-side (verified: `btv1b10545065q`, 345 pages) | 4 |
| 2 | **Leiden Digital Collections** | VERIFIED 200 | already supplies our Arabic 87 · Malay 25 · Javanese · Sundanese · Balinese | IIIF | 4 |
| 3 | **Chester Beatty** (`viewer.cbl.ie`) | VERIFIED 200 | major Islamic/Persian/Mughal collection | viewer up; manifest pattern not yet worked out | 3 |
| 4 | **Digital Bodleian** | VERIFIED 200 | small Islamic slice (Arabic 8, Hebrew 13 held) | IIIF, content-negotiated JSON search | 3 |
| 5 | **ISMI** (Max Planck) | VERIFIED 200 | Islamic Scientific Manuscripts Initiative | **catalogue, not scans** — lookup value only | 2 |
| — | **Qatar Digital Library** | **403** | BL India Office + Arabic scientific MSS | bot-gated to us; a browser UA did not clear it | 1 |
| — | **Princeton Islamic MSS** | **403** | Garrett collection | bot-gated | 1 |
| — | **HathiTrust** | **403** | — | bot-gated | 1 |
| — | **Süleymaniye / yazmalar.gov.tr** | connection failure | the largest Ottoman MS library | unreachable from our network | 1 |
| — | **Khuda Bakhsh (Patna)**, **Rampur Raza** | connection failure | major Indo-Persian collections | unreachable | 1 |

Internet Archive, for comparison: Arabic-language texts 752,036 (mostly modern,
not worth sweeping), Persian 48,075, Ottoman Turkish 6,629. The useful IA slices
are narrow and specific: **zij (astronomical tables) 1,856**, Arabic medicine
464, Mughal/Persian India 355, Arabic alchemy 42.

## Gallica: three traps, each hit in practice

1. **A bare client 403s.** SRU refuses a request without a browser `User-Agent`.
   Without one, every query fails and the channel reads as empty. This is
   probably why it stayed unopened.
2. **`cc…` arks are finding aids with NO manifest.** Only `btv1b…` arks are
   digitised objects. (Already in `sanskrit-sources.md`; now enforced in code.)
3. **Free-text matching is not subject matching.** `gallica all "arabe"`
   returns any record whose *description* mentions Arabic — the first hit was a
   **Hebrew prayer book**. Scope every query with `dc.language`.

**And it throttles hard.** 429 after a handful of rapid calls: an enumeration
pass lost 15 of 24 queries, and an import at 6s spacing still lost ~27%. Treat
delay as load-bearing; lowering it converts books into 429s rather than
finishing sooner. Re-running is safe — held/duplicate is handled.

## Two namesake/noise classes to filter, both real

- **Dr Leclerc's papers** (18 hits): matches on his *Histoire de la médecine
  arabe*. A 19th-century historian's notes, not a source.
- **al-Jawharī "al-Fārābī"** (6 hits): the *lexicographer*, a different man from
  the philosopher al-Fārābī. Exactly the collision `author-identity.md` warns
  about — uniqueness of a name match is not validity.

## Novel Greek: what survives only, or best, in Arabic

This is the acquisition target with the highest scholarly value, because the
Arabic witness is not a copy of something we already have — it is sometimes the
**only** witness.

**Lost or fragmentary in Greek, extant in Arabic:**
- **Diophantus, *Arithmetica* IV–VII** — Greek lost; Arabic only
- **Menelaus, *Spherics*** — Greek lost; Arabic only
- **Apollonius, *Conics* V–VII** — Greek lost; Arabic only
- **Galen's commentary on Hippocrates' *Book of Sevens*** — survives essentially
  only in Arabic. **HELD** (2 copies, 129pp + 128pp).
- **Galen on Hippocrates' *Epidemics* II & VI** — substantially Arabic-only.
- Hero of Alexandria, Philo of Byzantium — mechanics, partly Arabic-only

**Greek-transmission works confirmed present in Gallica and imported or queued:**
- **Ptolemy, *Almagest*** in Arabic — 4 copies (1380 ×2, 15th c. ×2), 169–345 canvases
- **Ptolemy, *Karpos* (Centiloquium) with al-Ṭūsī's commentary**, 1273–74
- **al-Ṭūsī, *Taḥrīr uṣūl Uqlīdis*** (1298) — his recension of Euclid, the
  version the Islamic world actually read
- **al-Mutawassiṭāt** (1322–23) — Ṭūsī's fifteen "intermediate" treatises: the
  curriculum read *between* Euclid and Ptolemy, bound as one volume
- **Dioscorides, *De Materia Medica*** (1219) in the recension revised by
  **Ḥunayn ibn Isḥāq**, plus 12th-c fragments
- **Hippocrates, *Aphorisms*** in Ḥunayn's translation; Ibn al-Nafīs's
  commentary (1482)
- **Avicenna, *Canon*** (1412) — and Book III in **Hebrew characters** with
  Hebrew commentaries, i.e. the onward transmission
- **The *Theologia* attributed to Aristotle "revu par Porphyre de Tyr"** — this
  is the paraphrase of **Plotinus, *Enneads* IV–VI**, not Aristotle at all
- **Organon + Porphyry's *Isagoge*, dated 1027**
- Proclus (2 MSS) — the *Book of Causes* tradition is Proclus' *Elements of
  Theology* travelling under Aristotle's name

**Not yet searched — the throttle ate these queries.** Worth a slow re-run:
gnomologies and doxographies, which quote authors we have otherwise lost —
Ḥunayn's own *Nawādir al-falāsifa*, Mubashshir ibn Fātik's *Mukhtār al-ḥikam*
(the source behind the medieval *Dicts and Sayings of the Philosophers*),
al-Sijistānī's *Ṣiwān al-ḥikma*; plus Philoponus, Olympiodorus, the Arabic
Hermetica, and the *Rasāʾil Ikhwān al-Ṣafāʾ*.

## Tooling

- `scripts/import/gallica-islamic-science-enumerate.mjs` — SRU enumeration,
  handles all three traps, labels the noise classes. Enumerate-only.
- `scripts/import/gallica-islamic-wave.mjs` — the importer. Orders
  Greek-transmission first so an interrupted run still lands the best material;
  re-asserts `language` and sets `original_language: Greek` where a Greek author
  is named.

**Keep `language` and `original_language` apart here.** The manuscript is
Arabic; the *work* may be Greek. Filing the Almagest as an Arabic composition
would be wrong and would break the work-graph link to our Greek and Latin
copies — see `.claude/docs/invariants/language-fields.md`.
