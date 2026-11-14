# Collections revamp: go-live plan

For Laura (owner) and Derek (reviews every pull request). Written 13 November 2026 from what was agreed in the prototype sessions. Nothing here is live, and nothing merges without Laura's yes.

## The idea

**Before:** everything was a "collection", whatever it really was: a field (Alchemy), a place (East Asia), a period (Early Modern Medicine), a kind of picture (Portraits) or someone's chosen set (Music of the Spheres). Each answered one question someone thought of in advance; any other combination had no page.

**After:** each question gets its own way in, named after a standard, and they combine on the same works:

| Way in | Answers | Named after |
|---|---|---|
| Subject | What is it about? | FAST and Wikidata |
| Time | When was it written, and when was this copy made? | Plain centuries |
| Place | Where does it come from, and where was it printed? | Wikidata; Getty place names and FAST in the catalogue round |
| Language | What language is this copy in? | ISO 639 |
| Type | What kind of writing, written on what, or what kind of picture? | Library of Congress genre terms and Getty |

So "Alchemy, written in the 1600s, in Latin" is a combination of filters, not a page someone had to make. Old groupings that were really a period or a place (Early Modern Medicine, East Asia) become filters; ones that were a kind of picture (Maps, Portraits) become types. Collections go back to what only a person can do: choose, order, annotate and sign a set, as Source Library, Symcyto, Futures Atlas, Derek Lomas or any reader.

## 1. Where things stand

The prototype runs locally at /revamp on a saved copy of public data. It has no database connection.

Every one of the site's 617 groupings (351 collections and 266 gallery sets) has been sorted:

| Now | Groupings |
|---|---|
| Subjects (merged into 261 subjects) | 434 |
| Collections | 158 |
| Types of pictures | 5 |
| Libraries | 9 |
| Kept hidden, still reachable by link | 2 |
| Retired | 9 |
| Waiting for the Place filter | 6 |

The rule behind the sorting: a grouping becomes a subject only if it matches a standard subject (FAST or Wikidata), and a type only if it matches a standard type (Getty AAT or Library of Congress genre terms). Everything else is a collection. Every one of the 261 subjects is linked to a standard.

## 2. Pages and what each needs

- **Subjects index and subject page.** Needs the subject list in the database (names, two levels, FAST and Wikidata links, one picture each) and subject tags on books and pictures. The subject page shows sub-subjects as picture boxes, then tabs: Works, Images, Collections, About.
- **Collections index and collection page.** Uses existing collections, plus a maker (Source Library or a reader) and an optional "Historic library" label. How a collection lists its works (A chapters, B like a subject, C contents rail) is still to be decided.
- **Centuries.** Needs the date each work was written. Many books lack it.
- **Languages.** Needs one clean language name per book. The catalogue holds many spellings of the same language.
- **Types of pictures.** What it shows, how it was made, where it sits in the book. Needs all three answers on every picture.
- **Types of texts.** What kind of writing, and what it is written on (form). Form is not recorded yet.
- **Places (planned).** Where a text comes from, as a way in, with where the copy was printed as a filter. Needs place recorded. Six region-only groupings wait for it.
- **Standards page.** Lists every subject, type and era against its standard. Built from the same tables, so no extra data.
- **Featured schedule.** One small table saying which collection is featured and when. It drives the homepage, Library and Gallery.
- **Shared search, filter and sort controls.** Already one shared set of styles (search-kit/controls), used by /library and /gallery too.

## 3. Data changes

- **One subject list** stored in the database, with FAST and Wikidata links. It replaces the scattered tags as the source of subjects.
- **New fields on books:** subjects, kind of writing, form, place, and a clean date written.
- **New fields on pictures:** what it shows, how it was made, where it sits.
- **One official summary record per book.** Today the book page reads three fields in turn (index.bookSummary, reading_summary, summary). Replace them with one record: short and long text, model, date, source, approved or not. The pipeline uses the old `summary` field to mark its summary step done, so the migration has to update that check first, or the step will re-run on every book.
- **Old tags stay untouched** as history. Other parts of the site still read them. New information goes in new fields beside them.

## 4. The catalogue round

One combined pass, in this order.

1. **Count first.** Measure what is missing per field before spending anything.
2. **Summaries first.** 26,595 live books have transcribed text but no summary. About $53, or about $27 as a batch, at assumed prices for the cheap model. Verify current prices before approving. Summaries make the later steps cheaper and more accurate. Books with no transcribed text (21,026) get only the simple fields for now. Summaries follow the summary rules: describe the book, concise, a dash of intrigue, no AI clichés, facts only from the book's text or its catalogue record. They are saved as `summary_candidate` and promoted with the existing script, which keeps the old values and can be undone.
3. **Translate old tags into the new fields.** A plain lookup, free. Most subjects come from here.
4. **Classify, one batch per field.** Each field is decided from the evidence that answers it, ranked: the holding library's catalogue record and the book's own title page beat the summary. Every answer stores its evidence. Where good evidence and the model disagree, the item goes to review.
5. **Pictures get all three answers,** and the vague labels (print, religious, illustration, unknown) are sorted out.
6. **Split the close matches:** Poetry, Drama and Fiction apart; Recipes out of Handbook or manual.
7. **Add missing types:** title page, initial letter, printer's mark.
8. **Record place** and form for every text.
9. **Check samples.** About 200 per field, roughly 1,800 in all: 6 to 10 hours of someone's time.
10. **Apply.** Results go to a holding table first, never straight into the catalogue, because automated jobs act on what is in the catalogue. A field goes live only after its sample is approved.

How it runs: on the Hetzner server, through Gemini Batch mode (half price, answers within 24 hours). Never through the website's own functions, which are billed per request. Small trial batches of about 500 items per field come first.

Total model spend: about $100 to $150, up to about $300 if prices are higher than assumed (unverified).

## 5. After the round

- **New books** get subjects and types from the lists automatically, and counts update.
- **New subjects are semi-automatic.** When new books point to a FAST heading with no subject yet, it becomes a proposed subject. It goes public only once it holds a minimum number of items (10 suggested, kept as a setting) and someone has checked the name.
- **Publish the standard terms** in each book and picture page's hidden data (schema.org genre, linking the Library of Congress, Getty and Wikidata entries), so search engines and other libraries read them exactly.

## 6. Order of pull requests

Small, one concern each. Every PR says what is in scope and what is deliberately left out. Derek reviews each one; nothing merges without Laura's yes.

1. Shared control styles and the new filter tags (already used by /library and /gallery).
2. The subject list table, with its standard links.
3. Subject pages.
4. Collections index and collection page.
5. Centuries, Languages, Types of pictures, Types of texts.
6. Featured schedule.
7. The single summary record, with the pipeline check updated.
8. Catalogue round scripts, with the holding table.
9. Places.

## 7. Open decisions for Laura

- How a collection lists its works: A, B or C.
- The first featured collection, and how often it changes.
- Comments on collections: yes or no.
- The navigation menu.
- Sign-off on the summary rules.
- The minimum before a new subject goes public (10 suggested).
