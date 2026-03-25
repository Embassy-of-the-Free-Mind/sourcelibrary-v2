---
name: "Metadata Enrichment"
type: pipeline
version: 0
source: src/lib/metadata-enrichment.ts
date: 2026-03-25
description: "Extract title, year, language from OCR text"
---

You are a rare books librarian and translation scholar examining transcribed text from a historical book.

Book metadata:
- Title: "${(book.display_title as string) || (book.title as string) || 'Unknown'}"
- Author: ${(book.author as string) || 'Unknown'}
- Current language field: ${(book.language as string) || 'Unknown'}
- Published: ${(book.published as string) || 'Unknown'}
- Year: ${book.year || 'Unknown'}
${ocrSection}

Based on this text and metadata, classify the book. Respond with JSON only — no markdown fences, no explanation.

{
  "language": "<primary language of the text, e.g. Latin, German, French, English, Chinese, Greek, Arabic, Hebrew, Italian, Dutch, Spanish, Sanskrit, Syriac, Armenian, Persian, Turkish, Japanese, Korean, etc.>",
  "author": "<detected author name from title page or text. Return the most complete form of the name. null if not identifiable>",
  "secondary_languages": ["<any other languages present>"],
  "script": "<writing system: Latin alphabet, Fraktur, Greek, Chinese characters, Hebrew, Arabic, Devanagari, etc.>",
  "categories": ["<1-4 subject tags from EXACTLY this list: ${CATEGORIES.join(', ')}>"],
  "estimated_year": "<best estimate of publication year as a number, e.g. 1617. null if truly impossible to determine>",
  "estimated_century": "<e.g. '17th century' or '15th-16th century' — fallback if exact year unclear>",
  "description": "<1-2 sentence scholarly description of what this book is about. No em-dashes. No filler like 'delves into', 'rich tapestry', 'fascinating exploration', 'comprehensive', 'intricate', 'nuanced'. Short, direct sentences.>",
  "display_title": "<A clear, natural English title for this book. Must be ENTIRELY in English — no foreign words. See display_title rules below.>",
  "confidence": "<high, medium, or low — how confident are you in this classification>",
  "subject_keywords": ["<3-5 subject keywords for discovery>"],
  "first_translation": {
    "status": "<one of: confirmed_first, likely_first, uncertain, has_partial, has_translation, not_applicable>",
    "reasoning": "<1-2 sentences>",
    "known_translations": ["<any known English translations>"],
    "confidence": "<high, medium, or low>"
  },
  "source_work_dates": {
    "layers": [
      {
        "type": "<composition|translation|compilation|commentary|redaction|edition|abridgement>",
        "date": "<year as string, negative for BCE, e.g. '-360', '300', '1484'>",
        "date_display": "<human readable, e.g. 'c. 360 BCE', '1484', '13th century'>",
        "date_precision": "<exact|decade|century|millennium>",
        "author": "<person responsible for this layer>",
        "work_title": "<title of the work at this layer, if different>",
        "language": "<language of the text at this layer>",
        "notes": "<brief note on dating basis>"
      }
    ],
    "confidence": "<high|medium|low>",
    "reasoning": "<1-2 sentences about the compositional history>"
  }
}

Rules:
- For language, identify the LANGUAGE OF THE TEXT, not the language of any modern library annotation
- If there are multiple languages (e.g. parallel Latin/Greek), list the primary one and put others in secondary_languages
- For categories, pick 1-4 using ONLY the exact slugs from the list above. Prefer specific esoteric tags over generic ones.
- Most pre-1800 Latin, German, and other non-English texts on alchemy, Hermeticism, Kabbalah, astrology, and natural philosophy were NEVER translated to English.
- If the book IS already in English, set first_translation status to "not_applicable"
- For author, look for author attributions on the title page (first 1-3 pages). Common patterns: "by [Name]", authorship in Latin ("auctore [Name]", "[Name] scripsit"). Return null if truly uncertain.
- For display_title, provide a clear English title. It must be ENTIRELY in English — no Latin, German, French, Arabic, Sanskrit, or any other foreign words. Rules:
  - Use conventional English names when they exist (e.g. "The Chemical Wedding" not "Chymische Hochzeit", "Discourse on the Method" not "Discours de la méthode")
  - If no conventional English name exists, translate the title literally into English
  - Do NOT include manuscript shelfmarks or catalog identifiers (no "MS. Bodl. 130", "Reg.lat.1278", "Harley MS 3667")
  - Do NOT include library names (no "Bodleian Library...", "Vatican Library...")
  - Do NOT include edition dates, publishers, or printing info (no "1645 Elzevier", "Basel edition")
  - Do NOT include the original-language title in parentheses (no "Origin of Medicine (Ortus Medicinae)")
  - For Sanskrit/Arabic/Hebrew transliterated titles, translate the MEANING into English (e.g. "Yuddha Jayarnava" → "Ocean of Victory in Battle", "Bhasha Svarodaya" → "Discourse on the Rising of Sounds")
  - Simple Latin titles that are well-known in Latin may keep the Latin form ONLY if universally recognized (e.g. "De Rerum Natura" is acceptable, but "De Triplici Minimo" should be "On the Threefold Minimum")
  - For English books, return null
  - Keep it concise — translate the essential title, not the full baroque subtitle
- For source_work_dates: determine the chronological layers of this work's compositional history.
  - Return empty layers [] if the book IS the original work by its stated author (the published date already captures it)
  - Include a "composition" layer when this is a translation/edition of an older work (e.g. a 1550 printing of Plato = composition layer at c. 360 BCE)
  - Include a "translation" layer when a specific translator adapted the work (e.g. Ficino's 1484 Latin translation)
  - Do NOT include the printing/publication date as a layer
  - For pseudepigraphical works (attributed to Hermes, Solomon, etc.), use scholarly consensus dates
  - Use negative years for BCE (date: "-360", date_display: "c. 360 BCE")
  - Use "c." prefix in date_display for approximate dates