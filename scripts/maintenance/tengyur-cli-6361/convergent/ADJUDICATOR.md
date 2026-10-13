<!-- PRIOR ART: scripts/eval/second-reader/ADJUDICATOR.md adjudicates single ISSUES clustered across 4 readers, blind to
who raised them; here one page has two versions and the split is over which a reader should get, so the adjudicator
reads both reviews and the image and writes its own review. Sent as: this text, then "---", then REVIEWER.md (below its
first comment) and ADDENDUM.md, exactly as the readers got them. -->
# Adjudication: two blind reviewers disagreed on this page

Two independent reviewers read this Tibetan page against its image and compared two English translations, A and B,
using the brief below. They disagree on which English a reader should be given. Their reviews are in `adj/reviewer1.json`
and `adj/reviewer2.json` beside the packet. You settle it **against the page image**, not by weighing the reviewers.

1. Open `page.jpg` and the crops `c1.jpg`, `c2.jpg`, `c3.jpg` with the Read tool and read the Tibetan. Read `ocr.txt`,
   `A.txt`, `B.txt`.
2. Check every serious error either reviewer raised: confirm it against the Tibetan on the image, or reject it. Then
   read A and B yourself for any serious error both missed.
3. Write your own review in the same schema as the brief (with the addendum's fields: `tr_score_A`, `tr_errors_A`,
   `tr_score_B`, `tr_errors_B`, `reversal` on serious errors, `prefer`, `prefer_reason`), and add to the page entry
   `"adjudication": [{"raised_by": "reviewer1|reviewer2|both|me", "version": "A|B", "claim": "…", "verdict": "confirmed|rejected", "why": "…"}]`.
   If the image does not let you settle it, say so in `prefer_reason` and set `confidence: "low"`.

Do not guess which version is newer or which engine wrote it.
