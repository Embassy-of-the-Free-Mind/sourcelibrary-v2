# The Aldine imprint in the author field — 23 bylines corrected (2026-08-18)

Snapshot, not doctrine. Applied by `scripts/maintenance/apply-aldine-byline-correction-3894.mjs`.
Method and benchmark: PR #3982 / `.claude/handoffs/2026-08-17-titlepage-attribution-pilot.md`.

## The defect

**85 books** (67 visible) carry the single string
`Manuzio, Aldo, 1449 or 50-1515 & Torresanus, Andreas, de Asula` in `books.author`.
That is not a byline; it is the Aldine press partnership. #3894 measured 41 books for
"Manuzio, Aldo" alone — this one compound string carries twice that again.

`author-identity.md` states why it is not cosmetic: a printer-as-author error **costs a
work-graph edge**, because the book mints a singleton local `work_id` under the printer
instead of joining the cluster its siblings are in. Seven Ciceros filed under a press
collocate with nothing.

## Why the standing detector could not find them

`title-page-attribution.mjs` reads `books.title` — a transcription of the title page —
and flags 22 books corpus-wide, 9 from this string. It cannot do better: of the **603**
books in its printer-dynasty scope, **346 come back NO_NAME**, meaning the title STRING is
silent. The scanned front matter is not. Its regex proposals on this set were also the
negative result the pilot already recorded — "Porta del gran Turco" (the Sublime Porte, a
place) and "Eschine contra di Tesifonte" (an oration's title) were offered as authors.

## The funnel

| stage | n |
|---|---|
| visible books under the imprint string | 67 |
| reader named an author | 61 |
| reader said the page names nobody | 6 |
| SELF_NAMED — a Manuzio really wrote it, catalogue is right | 1 |
| held by deterministic screens | 34 |
| reached the adversarial refuter | 26 |
| refuted | 3 |
| **written** | **23** |

## Written (23)

| author | book |
|---|---|
| Aristoteles | [5: Aristotelous Ta Ethika megala, kai ethika eydem. Kai et](https://sourcelibrary.org/book/6a097473f14f992996681366) |
| Baldassare Castiglione | [Il libro del cortegiano del conte Baldesar Castiglione.](https://sourcelibrary.org/book/6a0859d149638a50931c857b) |
| Baldassare Castiglione | [Il libro del cortegiano del conte Baldesar Castiglione.](https://sourcelibrary.org/book/6a085a9949638a50931c9c45) |
| Daniel Barbarus | [Exquisitae in Porphirium commentationes Danielis Barbari p](https://sourcelibrary.org/book/6a08599c49638a50931c8204) |
| Dante Alighieri | [Le terze rime di Dante.](https://sourcelibrary.org/book/6a085a5049638a50931c8f5b) |
| Francesco Patrizi | [Il sacro regno de'l gran Patritio, de'l vero reggimento, e](https://sourcelibrary.org/book/6a06d3219a48d51399962e21) |
| Francesco Petrarca | [Il Petrarca.](https://sourcelibrary.org/book/6a06d1b49a48d5139996012a) |
| Giovanni Battista Giraldi Cinzio | [Orbecche tragedia di m. Giouanbattista Giraldi Cinthio da ](https://sourcelibrary.org/book/6a06d74e9a48d51399966cfc) |
| Ioannes Baptista Folengius | [Commentaria in primam d. Ioannis epistolam, Io. Baptista F](https://sourcelibrary.org/book/6a06cd0dc749b698e5b2a892) |
| Marcus Antonius Flaminius | [M. Antonii Flaminii In librum Psalmorum breuis explanatio ](https://sourcelibrary.org/book/6a08598b49638a50931c7dde) |
| Marcus Tullius Cicero | [Le epistole famigliari di Cicerone, tradotte secondo i uer](https://sourcelibrary.org/book/6a06ccc8c749b698e5b29c34) |
| Marcus Tullius Cicero | [M. Tullii Ciceronis Epistolae ad Atticum, ad M. Brutum, ad](https://sourcelibrary.org/book/6a06d1129a48d5139995e33a) |
| Marcus Tullius Cicero | [M. Tullii Ciceronis Orationum pars 2. Corrigente Paulo Man](https://sourcelibrary.org/book/6a06d1d99a48d51399960a48) |
| Marcus Tullius Cicero | [3]: De claris oratoribus, Ciceronis liber, qui inscribitur](https://sourcelibrary.org/book/6a06f1604dcc6d5d8f0363f9) |
| Marcus Tullius Cicero | [Le epistole famigliari di Cicerone, tradotte secondo i uer](https://sourcelibrary.org/book/6a0852a949638a50931bb199) |
| Marcus Tullius Cicero | [M. Tullii Ciceronis Epistolae ad Atticum, ad M. Brutum, ad](https://sourcelibrary.org/book/6a0853c249638a50931bda8e) |
| Marcus Tullius Cicero | [M. Tullii Ciceronis Orationum pars 1. Corrigente Paulo Man](https://sourcelibrary.org/book/6a085aba49638a50931c9f7e) |
| Natalis Comes | [Natalis Comitum Veneti De venatione, libri 4. Hieronymi Ru](https://sourcelibrary.org/book/6a06d3849a48d5139996348c) |
| Niccolò Machiavelli | [Libro dell'arte della guerra di Nicolo' Machiauelli cittad](https://sourcelibrary.org/book/6a06d39b9a48d5139996355a) |
| Niccolò Machiavelli | [Libro dell'arte della guerra di Nicolo Machiauelli cittadi](https://sourcelibrary.org/book/6a08550049638a50931c1056) |
| Petrus Aurelius Sanutus Venetus | [Recens Lutheranarum assertionum oppugnatio, per magistrum ](https://sourcelibrary.org/book/6a085a6249638a50931c93c1) |
| Publius Papinius Statius | [Statii Syluarum libri 5. Achilleidos libri 12. Thebaidos l](https://sourcelibrary.org/book/6a085a5a49638a50931c915c) |
| Publius Terentius Afer | [Terentii comoediae, multo, quam antea, diligentius emendat](https://sourcelibrary.org/book/6a06f5b34dcc6d5d8f038348) |

Two readers returned `Niccolo` and `Niccolò` for two copies of the same work. Writing both
would mint two author strings for one man and fragment exactly the collocation this repair
restores, so the script normalises.

## Refuted (3) — all "not one author's book"

- **Aeschines** — *Due orationi, l'vna di Eschine contra di Tesifonte, l'altra * · The title page announces two orations by two different hands, Aeschines against Ctesiphon and Demosthenes in his own defence, so Aeschines wrote only half the volume and cannot stand as its byline. The only other named agent is the anonymous 'gentilhuomo firen
- **Baldassare Castiglione** — *Stanze pastorali, del conte Baldesar Castiglione, et del sig* · The title page names three hands — the Stanze pastorali jointly composed by Castiglione and Cesare Gonzaga (the dedication says plainly "d'ambidue loro composte", "gli autori d'esse"), plus a separate set of Rime by Anton Giacomo Corso, who also signs the dedi
- **Bonus Ferrariensis** — *Pretiosa margarita nouella de thesauro, ac pretiosissimo phi* · The title announces a compiled volume - the Pretiosa margarita plus collectanea drawn from Arnald, Raymond, Rhazes, Albertus and Michael Scot, assembled and issued by Janus Lacinius Calaber, whose address to the reader on p. 14 merely reports encountering 'ill

## Held for a human (34)

In `aldine-byline-verdicts-2026-08-18.json` under `flagged[]`, with reasons. 16 are
Sammelband/composite volumes and 16 carry a role conflict — both classes where the right
main entry is a cataloguing decision, not a rule.

## Ladder effect

These books were **T2 UNLINKED before and after** — they had a string and no `author_id`,
and they still do. The byline is now a person instead of a press, which is what a reader
and a search see; the work-graph edge is recovered only when they link.

## Revert

`node --env-file=.env.production.local scripts/maintenance/apply-aldine-byline-correction-3894.mjs --revert --apply`

## Not done

- 18 non-visible books under the same string.
- The other 9 printer-dynasty strings in the same class (Estienne, Koberger, and the
  remaining Manuzio variants) — 79 books total in the earlier census.
- The 346 NO_NAME books in printer-dynasty scope. This run is the evidence that reading
  the pages finds what the title string cannot; that set is the obvious next sweep.
