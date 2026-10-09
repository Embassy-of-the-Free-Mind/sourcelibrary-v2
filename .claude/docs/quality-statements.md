<!-- PRIOR ART: .claude/docs/collection-intro-writing-rules.md (how to write collection prose; says nothing about quality claims); .claude/docs/eval-design.md (how to MEASURE quality; not how to say it to readers); featured-work-description skill (sells the book, never the platform). None sets the voice for telling a reader how good a text is. -->

# Quality statements: how we tell readers how good a text is

**Read this when** you write anything a reader or partner sees that says how reliable a transcription or translation is. That covers a draft label or reader note, `/research/*-quality` pages, a collection or shelf description that mentions quality, a partner report (for example to Eternity), a shelf-overview verdict that will be shown outside, or a Librarian answer about quality.

**Why.** Derek, 2026-10-07, on the Derge Tengyur disclosure (#6120): "factual and direct, not too harsh, recognizing value when it is there, but warning about measured or observed shortcomings." The first draft read as a verdict against the work ("wrong technical terms", "misleading notes", "the weakest section"). The second overcorrected into euphemism ("a readable first draft", "worth checking", "most rewards a check"). Both fail the reader, who is deciding in about a minute whether to trust a page.

## The voice
- **Direct.** Say what was measured or seen, in plain words. "About 38 statements per 100 pages are reversed or attributed to the wrong speaker", not "some passages may benefit from review".
- **Not harsh.** Describe the errors, not the work. Leave out verdict adjectives such as weakest, poor, unreliable, garbled or hazard, unless the measure is literally a ranking. If it is, say the ranking: "the highest error rates of any section".
- **Not sugarcoated.** No reassurance words such as readable, rewards, pays off, closer look or worth checking standing in for an error count. No "may contain errors" when we know which errors and how often.
- **Value where it was measured.** State the positive finding with the same standing as the negative one, for example "75% of pages need only light edits" or "the transcription matches every leaf sampled". Never state a positive that was not measured.

## The shape (in this order; drop what does not apply)
1. **What it is:** the source, the edition, how the text was produced (e-text, OCR engine, machine translation).
2. **What was measured, by whom, when, and on how much:** n, random or hand-picked, AI reviewers or people, the date. Say "AI reviewers" whenever they were AI.
3. **The positive result**, as a number.
4. **The shortcomings**, as numbers or counted observations, with the commonest kinds named in neutral nouns ("mistranslated technical terms", "misattributed speakers", "omitted phrases").
5. **What has not been checked yet**, for example no scholar review or too few pages for a section figure.
6. **How to report or correct.**

## Rules that are not about tone
- Numbers come from a generated data file or a cited result, never typed by hand (the Tengyur pattern: `src/data/tengyur-section-quality.json`, built by `scripts/eval/tengyur-characterize/build-disclosure.mjs`).
- Quote a rate only with its n and source, and give an interval when n is small. A reference-judged rate covers only the referenced texts (see eval-design.md).
- Below the minimum n, say "too few pages reviewed" and give the wider figure instead. Never let a small sample read as a clean bill.
- A partner sees the same statement the public sees. Do not soften a figure for a funder.

## Example (Tengyur reader note, PR #6128)
> Of 19 random Pramāṇa pages checked against the Tibetan by AI reviewers (4 Oct 2026), 39% needed only light edits, 55% substantial revision and 5% a specialist. Measured errors: about 74 statements per 100 pages are reversed or attributed to the wrong speaker, including opponents' objections given as the author's view. Also common: mistranslated technical terms.
