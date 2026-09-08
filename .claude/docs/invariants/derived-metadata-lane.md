# A poisoned read corrupts three lanes, not one

PRIOR ART: `.claude/docs/invariants/paired-artifacts.md` — covers lanes 1–2 of the same incident
(image-vs-OCR pairing, #3362/#3186/#3368) and is the right doc when you are *writing* a paired writer.
It stops at the text. This one covers the lane after it — metadata DERIVED from that text — which no
invariant addressed and which survived both of #3362's repairs by six months.

**Read this when:** repairing any incident where a job read the wrong bytes — wrong image, wrong page,
wrong book — or when you are about to declare such a repair finished. Also when writing anything that
derives a stored field from page text.

## The rule

**A poisoned read corrupts three lanes: the IMAGE, the TEXT read from it, and everything DERIVED from
that text. Repairing two leaves the third making false public claims — and the standing detector for
lane 1 will return PASS while it does.**

Re-OCR is not the end of a repair. Enumerate the derived artifacts and clear them so their phases
re-derive: `display_title`, `year`, `summary`, `reading_summary`, `chapters`, `index`, `quality_score`,
`ai_metadata`, the `book_indexes` collection, and embeddings.

**Clearing is required, not tidiness.** Phase satisfaction is by OUTPUT: in
`pipeline-orchestrator.mjs`, `STATUS_OUTPUT_CLAIMS` defines `summary_indexed` as `!!b.summary` and
`chapters_complete` as a non-empty `chapters` array. A stale artifact reads as "this phase is done", so
the phase never runs again and the false summary outlives the repair indefinitely.

## The tell

You have repaired the images, re-run the OCR, confirmed the text is right — and the book page still
describes a different book. Or: your key-scope audit passes on a book you can see is wrong.

## What happened (2026-09-07)

Lanes 1 and 2 are in `paired-artifacts.md` and #3391. This is what they left behind.

Between the image repair (2026-06-01) and the text repair, the enrichment pass ran on the poisoned OCR
and wrote metadata from it. Nobody looked. Six months later, twelve **visible** books were still
serving the consequences: Aldrovandi's *Musaeum Metallicum* (1648) and *Ornithologiae*, Fabricius's
*Opera Chirurgica*, Clavius's *Gnomonices*, Averroes' *Colliget*, al-Battani, Ulugh Beg, al-Farghani,
and three Libavius volumes. Each carried `ai_metadata` asserting author **"Benedictus de Spinoza"**,
`estimated_year: 1803`, and a fluent description explaining the volume was the 1803 Jena edition of
Spinoza's collected works. Each had a summary about "the provincial city of Malinov", chapters titled
`Сорока-воровка`, and a `quality_score` scored on the wrong book. The stored page text was Alexander
Herzen in Russian; the scans underneath were the correct Latin folios all along.

`get_quote` on page 51 of the Aldrovandi returned, under CC-BY-SA:

> Ulisse Aldrovandi, *The Remaining Works of Benedict de Spinoza*, trans. Source Library (2026), 51.

over a page of Herzen's *Патриархальные нравы города Малинова*.

**`scripts/audit/r2-key-book-scope.mjs --full` returned PASS on all twelve.** It guards the key lane,
and the key lane had been fixed in June. A green detector for lane 1 says nothing about lanes 2–3.

They were found because a human noticed the word "Spinoza" in an unrelated search — not by any
instrument.

## The lane-3 detector

`scripts/audit/derived-metadata-scope.mjs`. Signal A gates on the poisoning shape — *agreement among
derived fields, disagreement among real ones*: one AI-derived `display_title` spanning 3+ books whose
own titles are mutually unrelated **and** whose own authors never agree with the derived author.
Legitimate duplicate holdings (22 copies of the *Consolation of Philosophy*) share a derived title too,
but their real titles or authors agree. Signal B (AI year far from edition year) is advisory: a work
composed c.200 CE in a 1950 edition trips it legitimately.

## Corollaries

**A detector built after a repair has no positive controls left** — the repair destroyed them. Keep the
repair's backups and replay them. `--positive-control` replays a pre-repair `unpoison-enrich` backup
and asserts the audit fires, resolving each book's real author from the live document so the
corroboration branch is exercised. Writing that control revealed the branch had been silently skipped
on `undefined` and never tested. **A clean run without a passing positive control is not evidence of
absence.**

**Order matters in the repair.** Re-archive must complete for a book *before* its re-OCR, or the OCR
re-reads the shared key and writes fresh corruption over good revision history.

**A reset book that reads "25 pages OCR'd" is the pipeline working, not a failure.** The batch chunk is
25 pages, so a freshly reset book climbs off zero within minutes. A verification written as
`ocr === 0` reports a correctly-repairing book as broken.

Session record, with the remaining traps: `.claude/handoffs/2026-09-08-poisoned-derivation-repair.md`.
