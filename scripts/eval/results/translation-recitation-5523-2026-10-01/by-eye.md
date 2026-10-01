# By-eye read: the 5 highest-overlap served pages (#5523)

Read by Claude (Opus 5.5), **text against text**: served English body vs the located passage of the
public-domain translation. No page image was read, so the label is `read-from-text`, not
`read-from-image`, and not a human reference. Quoted spans are the shared verbatim runs only.

| slug | work | run | share8 | label | why |
|---|---|---:|---:|---|---|
| rec-25a62a-p29 | Machiavelli, *Il Principe* (1819) vs Marriott 1908 | 11 | 0.050 | read-from-text: **translated, not recited** | Same passage (Cesare Borgia's four measures), but wording diverges throughout: served "satisfied and dazed" / "to waver with France" / "extinguishing all the bloodlines", Marriott "satisfied and dismayed" / "to temporize with France" / "exterminating the families". Shared run "the kingdom of Naples against the Spaniards who were besieging Gaeta" is a word-for-word rendering of "il regno di Napoli contro agli Spagnuoli che assediavano Gaeta". Against Ricci (1903) the same page shares a 15-word run: the served text is no closer to Marriott than to an independent translation. |
| rec-5e857c-p538 | Calvin, *Institutio* (1559) vs Allen 1813 | 16 | 0.046 | read-from-text: **translated, not recited** | Served English is modern ("hallucinate miserably", "strikes it from the memory of men"); Allen is 1813 diction. The 16-word run "redeemed by the death of Christ when he sees a new redemption in the Mass who" is a literal rendering of a Latin clause. The rest of the page does not track Allen. |
| rec-96231b-p199 | Herodotus I.181–182 (1884 Greek) vs Macaulay 1890 | 17 | 0.043 | read-from-text: **translated, not recited** | Served "breastplate", "sanctuary of Zeus-Belus", "resting place with seats", "have no intercourse with men"; Macaulay "cuirass", "temple of Zeus Belos", "stopping-place and seats", "abstain from commerce with men". The 17-word run "a woman sleeps in the temple of the Theban Zeus and both these women are said to" is the literal word order of the Greek. Longest run in the sample. |
| rec-bc882d-p759 | Vulgate, 2 Maccabees 2 (1804) vs Douay-Rheims | 16 | 0.040 | read-from-text: **translated, not recited** | Served text is modern English ("Jeremiah", "cave-like place", "the purification"); Douay reads "Jeremias", "Casleu", "scenopegia". Run "these things and the majesty of the Lord shall appear and there shall be a cloud" is the Vulgate's own word order ("ostendet Dominus haec, et apparebit maiestas Domini, et nubes erit"). The locator landed on chapter 1, one chapter early; the run is from the right verse. |
| rec-d582f3-p180 | Castiglione, *Cortegiano* (1528) vs Opdycke 1903 | 10 | 0.019 | read-from-text: **translated, not recited** | Same anecdote (Galeotto da Narni in Siena). Served "carry their packs on their backs", "in the land of thieves", "Bischizzi"; Opdycke "carry their wallets behind", "in a land of thieves", "playing on words". Shared run is literal narrative. |

**Verdict: 0 of 5 recited.** Every one is a faithful, literal translation of the right passage; the
shared runs are phrases a literal translation of that sentence is forced into. This is the expected
shape, given the human-vs-human baseline: two independent 19th/20th-century translations of the same
work share runs this long too, up to 21 words.
