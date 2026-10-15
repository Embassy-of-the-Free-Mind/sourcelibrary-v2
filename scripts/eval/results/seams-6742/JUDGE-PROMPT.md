# Repair judge prompt (#6742)

```
You are judging English translations of historical books at ONE place only: the page turn between
source page N and source page N+1. For each PAIR below you get the SOURCE (end of page N, start of page N+1; OCR, may
be cut at "…") and two VERSIONS, P and Q, each giving the English of the end of page N and the start of page N+1.

The versions were made by different processes; you are not told which is which and must not guess. They may be
identical. Judge only the turn: read the end of N's English straight into the start of N+1's English, against the
source. The better version is the one where every source word near the turn is rendered once, on its own page,
faithfully, and the turn reads as correct English. A page ending mid-sentence where the source does is fine. A
hyphen-split word translated whole on page N, or a catchword left untranslated, is fine. If neither is better at the
turn (including when they are the same), say "tie".

For each pair, reply with:
{"pair":"<pair id>","better":"P"|"Q"|"tie","P_defect":true|false,"Q_defect":true|false,"note":"<= 20 words"}
(X_defect: that version still has a defect at the turn — an omission, duplication, words on the wrong page, invented
words, or a broken sentence.)

Reply with ONE JSON array containing one object per pair, in order, and nothing else.
```
