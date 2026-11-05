---
id: plate-reread-check
version: 1
stage: [ocr]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [8042]
status: active
---
<!-- PRIOR ART: judged-pages.md (the route judge's frozen prompt and fidelity scale, from lane_judge_verdicts) and
lane-spot-check.md (a running lane's random draw, the Siku rubric; its file says another rubric is a new method). This
read is neither: named plate pages, a rubric written for labels on a map, blind, with planted controls. -->
## plate-reread-check v1 — did a re-read of a named map or plate page say what is printed on it?

**What it is for.** A map or plate page whose Flash read was held for a person to look at (#8042) gets an Opus re-read.
This answers "may this read be written?" for those pages. It says nothing about the book or the corpus.

**Sampling.** None: `frame.selection` is `picked`. The pages are the ones named on the issue.

**Reader and input.** One blind `claude -p --model opus` agent per 3 pages, the page image and the read, no route or
model name. Limit 3: agents given 9 pages lost images from their context and said so; those pages were judged again. 6
planted controls (6 of 6 caught) went through the same agents and are not recorded here. Reader in the row:
`{kind: model, model, image_opened: true}`.

**Serious.** A page is serious if the judge's verdict is `wrong`: text the judge could not find on the image.
`minor-gaps` (printed text left out, nothing invented) is `minor`, `read-matches-image` is `clean`.

**Qualitative record.** Every page has a `page_notes` entry with the judge's sentence, then any change made by hand after
the judge. `text_provenance` hashes the text the judge read. A page changed by hand afterwards is `changed_since_check`:
the verdict is about the earlier text, and the corrected text was not judged again.

**Verdict.** `verdict_source: rule`: `fix` for a serious page, `caveat` for `minor-gaps`, else `show`.

**Readers.** v1 rows do not warn readers and give no "checked" line (`reader_warning: false`). The pages were picked for
being hard, and some text was changed after the judge, so a line on the book page would overstate what was read.

**Known blind spots.** One reader, one read per page. Very small map labels are at the limit of what the image shows
the judge. The English is not judged. A label the judge calls modernised can be a fair reading of a worn letter.

**Rows written by** the #8042 job, through `recordPageVerdicts()`, one row per book. Evidence: the job's
`final-verdicts.json`, archived with its scratch folder, and the row itself.

**Versions.** v1 — 2026-11-05 (#8042).
