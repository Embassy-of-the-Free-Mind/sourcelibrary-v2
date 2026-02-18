# OCR Hallucination Patterns

Documented 2026-02-18 from analysis of 68 pages with >100k chars OCR text in the Source Library database. These are examples of Gemini model failures during OCR processing.

## Scale

As of Feb 2026: 322,230 pages with OCR data.
- 2,546 pages >10k chars (0.8%)
- 428 pages >20k chars (0.13%)
- 97 pages >50k chars (0.03%)
- 68 pages >100k chars (0.02%)

Normal OCR page: 500-5,000 chars. Dense multi-column: up to ~15-20k chars.
P99 is 9,125 chars. Anything over ~25k is almost certainly a hallucination.

---

## Pattern 1: Space Flood

**Model:** `gemini-2.5-flash` (most common offender)
**Mechanism:** Model emits legitimate metadata/header, then fills output with spaces or dashes until maxOutputTokens is exhausted.
**Result:** 200k-1.7M chars of whitespace

### Example: Hypnerotomachie (1,762,136 chars)

Book: *Hypnerotomachie ou discours du songe de Poliphile*
Page 56 | Model: gemini-2.5-flash | Book ID: 69099eb5cf28baa1b4caeb37

```
[[meta: Image quality: Excellent. Layout: Two-column layout with a large illustration
(woodcut) interrupting the text flow in the left column. The text following the
illustration in the left column is an exact repetition of the entire text in the right
column, a common printing practice for text disrupted by visuals.]]
[[language: French]]

|

[... 1.76 million characters of spaces ...]
```

The model correctly identified the layout complexity (illustration interrupting two-column text) but then produced nothing — just 1.7M spaces.

### Example: De Revolutionibus (213,721 chars)

Book: *De Revolutionibus - German Translation with Commentary*
Page 370 | Model: gemini-2.5-flash | Source: batch_api | Book ID: 6953e46b77f38f6761bee386

```
<lang>de</lang>
<page-num>342</page-num>
in demselben befindet: — wird, gemäss der einfachen Neigung und der ersten
Schwankung um die gemeinsame Schnittlinie ihrer Bahn mit der Ebene der
Ekliptik, offenbar dann keine Breite stattfinden; aber die zweite Schwan-
kung, welche um einen querliegenden...

[... legitimate text for ~500 chars, then 213k chars of spaces ...]
```

Started with real OCR then transitioned to space flood.

---

## Pattern 2: Thinking Leak / Self-Talk Loop

**Model:** `gemini-3-flash-preview` (thinking model)
**Mechanism:** Model's internal reasoning ("thinking tokens") leaks into the output text. The model narrates its own decision-making process, then gets stuck in a metacognitive loop.
**Result:** 200k+ chars of the model talking to itself

### Example: Expositio in Apocalipsim (246,642 chars)

Book: *Expositio in Apocalipsim*
Page 8 | Model: gemini-3-flash-preview | Source: batch_api | Book ID: 697b079addee0ea10ea898dc

**Opening (leaked reasoning):**
```
    *   *Line 1:* "& spinas: vt nec bonis desit gratia dei ad salutē: nec impii abutant̄ amplius"
    *   *Line 2:* "dei patiētiā. Qui (suggerēte spū) pctā delinquētiū: durius increpabūt ac"
```

**Self-correction visible in output:**
```
(Self-correction on abbreviations: Transcribing exactly what is seen.
`v3` for videlicet is very common in 16th-century Latin printing).

*Let's check the date and location:*
"Apud Venetias in Lo- cello nostro isulari diui Christophori a pace"
-> This refers to the monastery of San Cristoforo della Pace in Venice.
```

**Degeneration (repeating for 200k+ chars):**
```
(Ready). Writing response. (Final Choice). Correct. (Ready). Writing
response. (Final Choice). Correct. (Ready). Writing response. (Final
Choice). Correct. (Ready). Writing response. (Final Choice). Correct.
[... repeated ~10,000+ times ...]
```

The model was analyzing a 16th-century Latin apocalypse commentary, got caught up in deciphering abbreviations, and entered an infinite loop of announcing it was ready to write while never actually writing.

---

## Pattern 3: Text Repetition Loop

**Model:** `gemini` (earliest model used), also seen in `gemini-2.5-flash`
**Mechanism:** Model transcribes real text, then gets stuck repeating a short passage infinitely. Often happens at semantically "sticky" phrases — lines with rhythmic or repetitive content.
**Result:** 200k+ chars with a 1-3 line phrase repeated thousands of times

### Example: Morgenröte im Aufgang / Böhme (242,352 chars)

Book: *Morgenröte im Aufgang, das ist: die Wurzel oder Mutter der Philosophiae*
Page 95 | Model: gemini | Book ID: 6867c580aadfee9e955eca92

**Legitimate opening:**
```
156 Morgenröte im Aufgang. Cap. 13.
129. Und davon ist die erste Gift entstanden, darinnen wir
arme Menschen nun in dieser Welt auch zu kauen haben,
und dadurch der bitter giftige Tod ins Fleisch kommen ist.
```

**Loop point (the same 2 lines repeated 2,157 times):**
```
Qualität in das Herze, in das fleischliche und geistliche
Leben kam die Bitterkeit, und durch die herbe, harte
Qualität in das Herze, in das fleischliche und geistliche
Leben kam die Bitterkeit, und durch die herbe, harte
[... 2,157 repetitions ...]
```

Jacob Böhme's passage about "Bitterkeit" (bitterness) entering the heart through "herbe, harte Qualität" (harsh, hard quality) was apparently semantically sticky enough to trap the model in an infinite loop. The rhythmic, incantatory quality of Böhme's mystical prose — already repetitive by design — may have contributed.

---

## Pattern 4: Af-beeldingen Variants

Book: *Af-beeldingen van sommighe in Godts-woort ervarene mannen*
Multiple pages (56, 57, 72) | Model: gemini-2.5-flash | Book ID: 690c3351e0787282ad5936fd

This Dutch book about religious figures had 3 pages go wrong. Page 57 (918k chars) shows a hybrid pattern: legitimate metadata and partial Dutch text, then a dash-flood (`---...`) filling the rest.

```
## HIERONYMVS

ken: onde ... [legitimate Dutch text for ~1000 chars]

---------------------------------------------------------------------------
[... 917k chars of dashes ...]
```

---

## Mitigation

1. **`maxOutputTokens: 16384`** — Caps output at ~57k chars worst case. Prevents 200k+ floods.
2. **`thinkingBudget: 0`** — Prevents thinking token consumption AND thinking leaks (Pattern 2).
3. **`temperature: 0.1`** — Reduces randomness that can trigger loops.
4. **Post-processing validation** — Flag pages where output length is >3x the image's expected text density. Not yet implemented.
5. **Repetition detection** — Could detect when >50% of output is repeated phrases. Not yet implemented.

## Models Affected

| Model | Space flood | Thinking leak | Text loop | Pages >100k |
|-------|------------|--------------|-----------|-------------|
| `gemini` (v1) | Rare | No | Common | ~5 |
| `gemini-2.5-flash` | Common | No | Some | ~30 |
| `gemini-3-flash-preview` | Rare | Yes (batch) | Rare | ~33 |

## Related

- GitHub issue #33: Snapshot enforcement before overwriting OCR data
- Handoff: `.claude/handoffs/2026-02-18-ocr-quality-audit.md` (Ficino data loss from thinking token overflow)
