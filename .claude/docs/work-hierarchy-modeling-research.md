# Work hierarchy & aggregation — modeling research + novelty assessment

Background research for the work-layer model (the *Pimander*-is-both-a-work-and-
part-of-*Corpus-Hermeticum* problem, and the Ficino-1497-compilation problem).
The formalized model that came out of this lives in
`translation-works-architecture.md` §"Work hierarchy & aggregation". Two briefs:
(1) how the standards model whole/part vs aggregation; (2) whether our overall
approach is novel/publishable.

---

## Brief 1 — modeling whole/part among works

**The decisive lesson:** intrinsic whole/part among works and editorial
aggregation by a manifestation are **two different mechanisms**, and the recurring
failure mode every standard warns against is conflating them.

### FRBR / IFLA-LRM (2017): whole/part vs aggregates
- **Intrinsic work whole/part.** [LRM](https://www.ifla.org/files/assets/cataloguing/frbr-lrm/ifla-lrm-august-2017_rev201712.pdf)
  permits a generic part-of between two entities of the same type (work↔work). A
  poetry cycle and its poems, a trilogy and its novels, a concerto and its
  movements are *intrinsic* parts — conceived as belonging to the whole. This fits
  **Corpus Hermeticum → Poimandres**.
- **Aggregates — the crux.** LRM's key move: an
  [aggregate is a property of the **manifestation**](https://frbropencomments.wordpress.com/2016/03/15/5-5-modelling-of-aggregates/),
  not a whole/part among works — "a manifestation embodying multiple distinct
  expressions." Three [kinds](https://www.isko.org/cyclo/lrm): **collections** of
  expressions (anthologies, collected works, compilations — Ficino's volume),
  **augmentations** (base + commentary/illustrations/preface), **parallel**
  expressions (bilingual / multi-translation editions).
- **The aggregating work.** LRM treats the editorial selection-and-arrangement as
  *its own work* — "the glue." For a 12-essay Festschrift there are **13** works:
  the 12 essays + the editor's compilation-work. Crucially the
  [aggregating work does **not** include the works being aggregated](https://frbropencomments.wordpress.com/2016/03/15/5-5-modelling-of-aggregates/);
  components link at the *expression* level via the shortcut **LRM-R25
  "aggregated by"** ([defined](https://www.ifla.org/wp-content/uploads/2019/05/assets/cataloguing/frbrrg/AggregatesFinalReport.pdf)
  as a pair of "embodied in" relations sharing one aggregate manifestation).
  Co-membership implies **nothing** about how the works relate intellectually.

### Cataloging practice — analytical vs comprehensive (RDA/MARC)
A container-of-works is described by *scope*: **comprehensive** (whole as one
unit) vs **analytical** (a sub-part). Carriers: **505** formatted contents note,
**700/730** analytical added entries, **774 constituent-unit** ↔ reciprocal
**773 host-item** ([LoC 760-787](https://www.loc.gov/marc/bibliographic/bd760787.html)).
Post-2020 RDA retired the comprehensive/analytical labels and now splits the old
"container of" into **"expression manifested"** (analytic = editorial aggregation)
vs **"part"** (a legitimate whole/part) — [LC-PCC aggregates guidance](https://www.loc.gov/aba/rda/mgd/mg-aggregates.pdf).

### BIBFRAME / linked data
[BIBFRAME 2.0](https://www.loc.gov/bibframe/docs/bibframe2-model.html): **`bf:hasPart`
↔ `bf:partOf`** (subproperties of `bf:relatedWork` / `bf:relatedInstance`).
**`bf:hasPart` is NOT transitive** —
[corpus→treatise→chapter won't infer corpus→chapter](https://ital.corejournals.org/index.php/ital/article/download/17289/11937/36141)
without an explicit transitive super-property. BIBFRAME's **Hub** is a collocation
control point (work/expression collocation, not whole/part).

### Wikidata practice — and its sparseness
Intended tools: **`P527` has part(s) ↔ `P361` part of**. But real corpora are
under-decomposed: [Corpus Hermeticum (Q205612)](https://www.wikidata.org/wiki/Q205612)
has `part of → Hermetica` but does **not** list its treatises; *Poimandres* isn't
linked. [Plato's Republic (Q123397)](https://www.wikidata.org/wiki/Q123397) lists
only two P527 parts, not its ten books. **Lesson: assert the whole/part yourself;
use P527/P361 as the reconciliation anchor, don't expect the authority to have it.**

### Digital scholarly editions — CTS/DTS/TEI (most relevant to our DTS layer)
[CTS/CITE](https://wiki.digitalclassicist.org/Canonical_Text_Services) separates
**two orthogonal hierarchies**: a *containment hierarchy of works*
(`textgroup : work : version : exemplar`, in a CTS-URN) and a *citation hierarchy
within a work* (book→chapter→section→line, the passage reference).
[DTS](https://journals.openedition.org/jtei/4352) generalizes with three endpoints:
**Collection** (nested collections + readable works), **Navigation** (the citeable-
unit tree / `citationTree`), **Document** (passage text). The reusable principle:
**collection membership (a work belongs to a corpus) is modeled separately from a
work's internal citation tree** — a treatise is a citeable work-node that can be a
member of *multiple* collections (the dual identity of *Poimandres*).

### Recommended model + the named pitfalls
Two distinct, separately-named edges — never one polymorphic `part_of`:
1. **Intrinsic work whole/part** (`work_part_of`/`work_has_part`, with `order` +
   `dependent` flag). Only when the component was conceived as belonging to the
   whole. Mirror to Wikidata P361/P527.
2. **Editorial aggregation by a manifestation** (`manifestation_aggregates` /
   `aggregated_in`, linking a *book/edition* to the works it embodies). The volume
   is its own aggregating-work; it must **not** be the `work_part_of` parent.

Pitfalls the standards explicitly warn against:
- **Treating a compilation as a work** (the single most common error).
- **Demoting a treatise to "just a chapter"** (Poimandres has independent identity
  and transmission — a citeable work that is *also* part-of the corpus).
- **Assuming co-membership implies a work relationship** (LRM: it implies nothing).
- **Relying on `hasPart` transitivity** (BIBFRAME's is non-transitive).

---

## Brief 2 — is this novel / publishable?

**Bottom line:** the pieces are individually established-to-incremental; the
*integration* — LLM-assisted cross-lingual work identity + whole/part aggregate
decomposition + a work-level translation-gap measurement on a coherent historical
corpus — is a **genuinely novel, publishable methodological contribution**, *if*
the empirical figure is validated against ground truth and presented honestly
(currently self-published with ±50% and no comprehensive denominator).

- **A. FRBRization at scale — ESTABLISHED.** OCLC's
  [FRBR Work-Set Algorithm](https://www.oclc.org/research/activities/frbralgorithm.html)
  / [WorldCat Work records](https://www.oclc.org/research/areas/data-science/workrecs.html)
  already cluster editions/translations/languages into works at >500M scale (~2005).
  The LLM-verification + cross-language-as-first-class twist is a *modest* increment
  ([BookReconciler 2025](https://arxiv.org/pdf/2512.10165) confirms cross-language
  clustering is still a weak spot; [LLM entity matching](https://arxiv.org/pdf/2310.11244)
  is routine).
- **B. Translation-gap measurement — PARTIALLY-NOVEL (strongest claim).**
  Translation studies quantifies *contemporary flows*
  ([Heilbron's world-system](https://journals.sagepub.com/doi/10.1177/136843199002004002),
  Sapiro, [Index Translationum bibliometrics](https://www.nature.com/articles/s41599-024-04225-5))
  but **no peer-reviewed work measures the untranslated residue of a closed
  historical corpus.** Shuger's "90% never translated" is **anecdotal** — repeated
  in the [Oxford Handbook of Neo-Latin](https://academic.oup.com/edited-volume/28135/chapter/212324841)
  but never pinned to a number. *Caveat:* our ~2% is already self-published at
  secondrenaissance.ai with low confidence; a reviewer treats it as a hypothesis
  until the denominator (FRBRization recall) and translation-match recall are
  validated. **The novelty is the method for a defensible number, not the number.**
- **C. LLM bibliographic extraction — ESTABLISHED; aggregate decomposition w/ page
  anchors — PARTIALLY-NOVEL.** Metadata extraction is routine; **no direct prior
  art** found for automated, page-anchored aggregate whole/part population at scale.
- **D. The combination — GENUINELY-NOVEL.** No system chains cross-lingual
  LLM-FRBRization → aggregate decomposition → work-level coverage metric. That
  *pipeline* turns a humanities truism into a reproducible measurement.

**Publication strategy:** a **methods + dataset** paper, not "we found the gap."
Priority: (1) the pipeline/method, (2) the released work-graph dataset, (3) the
figure **with a ground-truth eval + honest error bars**. Never headline the bare
2%. Venues: [J. Open Humanities Data](https://openhumanitiesdata.metajnl.com/)
(data) + LaTeCH-CLfL / [DSH](https://academic.oup.com/dsh) (method),
[DHQ](https://www.digitalhumanities.org/dhq/), *Cataloging & Classification
Quarterly* / JCDL-TPDL (bibliographic framing), *Translation and Literature* /
the Heilbron-Sapiro community (empirical result).
