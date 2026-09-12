# Concept-alias judging rubric (page_terms curation, #4695)

You are standing in for a human lexicographer. Input: one JSON line per CONCEPT with
`seed_forms` (spellings the concept is already known under, with corpus counts and sample
evidence), `seed_glosses` (how translators glossed those forms), and `candidates` (other
terms that SHARE a gloss with the seed, each with surfaces, counts, up to 3 evidence rows —
book, page, gloss, and the translator's own words before the tag — and `renderings`).

For EVERY candidate, and for every seed form, emit a verdict:

- `variant` — the same word: transliteration, spelling, script, case, inflection, plural,
  diacritics (samādhi/samadhi/三昧; sefirot/sephiroth/ספירות). Search should expand
  silently.
- `equivalent` — a translator's rendering of the concept in another language (first
  matter for prima materia; remembrance for dhikr; intellectus for νοῦς). Search should
  expand but LABEL the hit, because another translator chose differently.
- `related` — genuinely adjacent but not the same concept (hesychasm ↔ hesychia; agent
  intellect ↔ intellect; Sephira ↔ sefirot as singular is a variant, but "Kether" is
  related). Not used for expansion; kept for the graph.
- `reject` — shares a gloss by accident: a person or place (Hesychius the lexicographer),
  a homograph (Ch'ing the dynasty for qi; "Chronicles" for dhikr via dhikr = mention;
  pneumatics the engineering), an OCR fragment, or a gloss that is itself wrong.

Rules (adversarial bar — the card-drain standard):
1. Read the evidence rows. A shared gloss is a CLAIM, not proof. If the evidence context
   shows a different sense, reject, whatever the counts say.
2. Names of people and places are ALWAYS reject, even when the name derives from the
   concept (Hesychius, Sophia as a person, Cyprian).
3. One wrong `variant` is worse than five missed ones: it makes a search for stillness
   return a lexicographer. When unsure between variant and equivalent, choose equivalent;
   when unsure between equivalent and related, choose related; when unsure whether the
   sense matches at all, reject.
4. Do not invent aliases that are not in the candidate list. You may DEMOTE a seed form
   (a seed regex may have pulled in a false friend — "buddhi" matched Buddhism; "arcana"
   matched Swedenborg): give it `reject` with the reason.
5. Each verdict carries a one-line `reason` citing what in the evidence decided it, and a
   `confidence` 0–1. Anything under 0.6 must be `related` or `reject`.

Output: for each concept, one JSON object
`{concept, verdicts: [{term_key, verdict, tier: "variant"|"equivalent"|"related"|"reject", confidence, reason}]}`
written to the output path you are given, one line per concept, valid JSON. Print only a
count summary. Do not write anything else anywhere.
