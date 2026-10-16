---
stage: metadata
measure: judged
languages: [bo]
scripts: [Tibt]
canons: [derge-kangyur, derge-tengyur]
n_books: 2341
n_pages: null
verdict: "Tibetan WORK dates can be sourced for 479 of 2,341 books (BDRC work authors 234, colophon- or title-named authors matched to a BDRC person 159, colophon years 53, one BDRC AuthoredEvent) and given canonical Indian windows for 546 more. A model reading a colophon is a good reader of WHO and WHAT WORDS but not of the arithmetic: in the first full pass it supplied a rab byung cycle number for 20 of the 33 composition years it gave one for, where the quoted words state none, and misread one element-animal pair; on 5 colophons opened by eye the OCR was right every time, the model's interpretation wrong 3 times (author of a reply vs its questioner, a translation colophon called a copy, an appended prayer's author taken for the volume's)."
status: adopted
decision: "Tibetan work dates written by tibetan-work-dates.mjs (run tibetan-work-dates-2026-10-16, 1,454 books): the model reads, the code converts the cycle year and checks the cycle, element, animal and CE year against the quoted words; a named author needs the model's dates AND exactly one BDRC person whose dates meet them. #6721."
superseded_by: null
issue: [6721]
---
## 2026-10-16 · Can Tibetan work dates come from the colophon and BDRC rather than a model?

**Why.** After the lean run (#6721, 2026-10-15) 2,331 of 2,341 Tibetan books carried a bare catalogue-only model
estimate of the WORK, typically "c. 1600–1900" (1,030 windows wider than 300 years). Derek: "we are looking for dates
of the works, not the editions … the tibetan are all at 1700."

**Design.** Sonnet (`claude -p`, subscription) read each book's catalogue record, opening leaves and last three
pages (`date-books.mjs --lean tibetan`, 10 a call, 241 calls) and returned only readings: the author named (Tibetan,
Wylie, English), the exact words naming them, their dates as it knows them, Kangyur/Tengyur status with Indian and
translation windows, the exact words stating a year, cycle/element/animal/age, and its own window. The code then:
BDRC work record (scan W… → instance MW… → work WA…: AuthoredEvent, main author/tertön/commentator → person dates);
a named author matched through Wikidata's 19,419 BDRC-linked people (labels in Tibetan script and English) to a BDRC
person whose dates meet the model's; the colophon year converted by `rabjungYears()`; a person window wider than a
century refused.

**Result.** Work basis before → after: model_knowledge 2,331 → 1,894; author_lifespan 10 → 393; colophon 0 → 53;
catalogue 0 → 1. Window width >300 years: 1,030 → 428; exact: 13 → 71. Unchanged: 887 (no source, and the new model
window was not narrower than the stored one: a second guess is not better for being second).

**What did not work.** Taking a single name-index hit when the model did not recognise the person ("Sonam Senge" → the
one who died 1253) — now refused (`unrecognised_name`, 235 books). The model's own cycle numbers. 153 named authors have
no BDRC match by exact name; 1,529 books name no author at all (mostly EAP ritual manuscripts from Bhutan).
