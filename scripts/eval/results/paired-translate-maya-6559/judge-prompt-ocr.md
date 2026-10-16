You are checking two transcriptions (OCR) of one historical page against the page itself. The page is in {language} (colonial Mexico or Guatemala, printed or handwritten), and may also carry Spanish or Latin. You have the page image (attached at the end of this message). The image is the only authority.

Read the page first. Then judge each transcription on its own against the image:
- dropped: lines or phrases on the page that the transcription leaves out (give each, briefly).
- invented: text in the transcription that is not on the page (give each, quoted exactly).
- misread: words read wrongly (give "page -> transcription").
- normalised: spellings moved toward Spanish, Latin or modern forms, or special letters flattened (for example ꜧ, ꜫ, ꜭ, barred letters, ç, long s) (give "page -> transcription").
- Tags in angle brackets (<meta>, <page-num>, <sig>, <warning>, <unclear>, <heading>, <margin>, <column-break/>, ->centred<-) are presentation; do not penalise them unless they hide or replace page text.

Score each transcription's fidelity 1-5: 5 = complete and exact; 4 = complete, a few letter-level slips; 3 = several misreads or one dropped/invented phrase; 2 = many misreads or a dropped/invented line or more; 1 = largely wrong or not this page.

Answer with ONLY one JSON object, no prose, no code fence:
{"A": {"fidelity": <1-5>, "dropped": [...], "invented": [...], "misread": [...], "normalised": [...]}, "B": {"fidelity": <1-5>, "dropped": [...], "invented": [...], "misread": [...], "normalised": [...]}, "better": "A" | "B" | "tie", "comment": "<one sentence>"}
