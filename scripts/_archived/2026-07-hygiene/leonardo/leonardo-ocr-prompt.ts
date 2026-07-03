/**
 * Leonardo da Vinci Facsimile OCR Prompt
 *
 * Custom prompt for manuscript facsimiles with mirror writing, drawings,
 * and mixed facsimile/commentary formats. Replaces DEFAULT_PROMPTS.ocr
 * via the customPrompt parameter in queue-books.
 *
 * Categories handled:
 * 1. Manuscript facsimiles (mirror writing, Italian)
 * 2. Ravaisson-Mollien volumes (alternating facsimile plates + French commentary)
 * 3. Windsor Castle drawing series (primarily illustrations, French captions)
 */

export const LEONARDO_OCR_PROMPT = `Transcribe this page from a Leonardo da Vinci manuscript facsimile to Markdown.

**Context:** This is a scholarly digitization project transcribing Leonardo da Vinci's notebooks and manuscripts. Pages may contain:
- **Mirror writing** (Leonardo's reversed right-to-left Italian script) — read and transcribe as normal left-to-right text
- **Drawings** with sparse handwritten annotations — anatomical studies, mechanical designs, architectural sketches, botanical illustrations, geometric diagrams
- **Printed commentary** in French or Italian (in Ravaisson-Mollien and Beltrami editions, commentary pages alternate with facsimile plates)
- **Mixed content** — facsimile reproductions alongside printed transcriptions on the same page

{language_instruction}

**Leonardo's handwriting:**
- Written right-to-left in mirror script — mentally reverse the text to read normally
- Old Italian (Tuscan dialect, 15th-16th century): "chome" = come, "colla" = con la, "laragione" = la ragione
- Abbreviations common: tildes over vowels for missing nasals, truncated word endings
- Text often flows around drawings, written at angles, or squeezed into margins
- Numbers and some proper names may appear in normal (left-to-right) orientation
- If a word is unclear due to mirror script ambiguity, use <unclear>best guess</unclear>

**Page classification — determine FIRST:**
1. **Manuscript facsimile** — handwritten mirror text, drawings, Leonardo's hand → transcribe the Italian text, describe drawings
2. **Printed commentary** — typeset French/Italian text with transcription or analysis → transcribe normally as printed text
3. **Drawing plate** — primarily illustration with minimal or no text → describe the drawing(s) in detail, transcribe any visible annotations
4. **Blank/cover/title** — modern publication pages → transcribe title/publication info, mark as appropriate page-type

**Format:**
- # ## ### for headings (bigger text = bigger heading) — NEVER combine with centering syntax
- **bold**, *italic* for emphasis
- ->centered text<- for centered lines (NOT for headings)
- > blockquotes for quotes/prayers
- --- for dividers

**Tables:** Use markdown tables ONLY for actual tabular data with clear rows/columns.

**DO NOT use tables for:**
- Circular diagrams
- Charts or graphs
- Any visual layout that isn't truly tabular

**Metadata tags (hidden from readers):**
- <lang>X</lang> — the detected language of this page (REQUIRED — always identify the language: Italian, French, Latin, or the printed language)
- <page-type>X</page-type> — classify this page (REQUIRED). One of: title-page, frontispiece, dedication, preface, toc, index, errata, colophon, appendix, blank, illustration, diagram, map, text
- <page-num>N</page-num> — visible page/folio numbers (NOT in body text). Leonardo's manuscripts use folio numbers (e.g., "f. 24r", "f. 24v")
- <header>X</header> — running headers/chapter titles at top of page (NEVER duplicate as heading in body)
- <sig>X</sig> — printer's marks like A2, B1 (NOT in body text)
- <meta>X</meta> — hidden metadata (manuscript condition, image quality, page orientation notes)
- <warning>X</warning> — quality issues (faded ink, damaged, stained, blurry reproduction)
- <vocab>X</vocab> — key terms for indexing

**Inline annotations (visible to readers):**
- <margin>X</margin> — marginal notes, citations (place BEFORE the paragraph they annotate)
- <gloss>X</gloss> — interlinear annotations
- <insert>X</insert> — later additions (inline only, not around tables)
- <unclear>X</unclear> — illegible or ambiguous readings (especially common in mirror script)
- <note>X</note> — interpretive notes for readers (use to explain mirror text difficulties, identify drawing subjects)
- <term>X</term> — technical vocabulary

**For MANUSCRIPT FACSIMILE pages:**
1. Transcribe Leonardo's mirror writing as normal left-to-right Italian text
2. Preserve original spelling and word forms (do NOT modernize the Italian)
3. Mark paragraph breaks where Leonardo left clear spacing
4. For text written around drawings, transcribe in reading order (top-to-bottom, noting position relative to drawings)
5. If text is at an angle or in margins, use <margin> tags
6. Note any corrections, cross-outs, or insertions Leonardo made

**For DRAWING pages:**
1. If drawings dominate (>50% of page area), classify as page-type "illustration" or "diagram"
2. Transcribe ANY visible text annotations on or near drawings
3. Use <note> tags to briefly identify the drawing subject: <note>Anatomical study of the shoulder muscles</note>
4. Still use <detected-images> for the drawings (see below)

**For PRINTED COMMENTARY pages (Ravaisson-Mollien, Beltrami, etc.):**
1. Transcribe the printed text normally — it's standard typeset French or Italian
2. These pages often contain the editor's transcription of Leonardo's text plus commentary
3. Preserve the editor's formatting, footnote markers, plate references

**Critical rules:**
1. Preserve original spelling, capitalization, punctuation — for both Leonardo's Italian and printed commentary
2. Page numbers/headers/signatures go in metadata tags ONLY — NEVER duplicate as ## headings or body text
3. Decorative initials (drop caps): merge large ornamental first letters with the word they begin
4. IGNORE partial text at left/right edges (from facing page in spread)
5. Capture ALL text including margins and annotations
6. End with <vocab>key terms, names, concepts</vocab>

**If image has quality issues**, start with <warning>describe issue</warning>

**IMAGE DETECTION:** Leonardo's manuscripts are heavily illustrated. For ANY drawings, diagrams, sketches, anatomical studies, mechanical designs, or decorative elements, add at the END:

<detected-images>
[{"description": "Brief description", "type": "illustration|diagram|portrait|map|decorative", "bbox": {"x": 0.1, "y": 0.2, "width": 0.7, "height": 0.5}, "gallery_quality": 0.85, "museum_rationale": "Why museum-worthy or not", "museum_description": "2-3 sentence museum label describing the drawing", "metadata": {"subjects": ["anatomy", "mechanics"], "figures": ["human arm"], "technique": "pen and ink", "style": "Renaissance scientific illustration"}}]
</detected-images>

**Bounding box (0.0-1.0):** x=left edge, y=top edge. Measure PRECISELY to tightly enclose each illustration.

**Gallery quality for Leonardo drawings:**
- 0.9-1.0: Museum-worthy — finished anatomical studies, detailed mechanical designs, beautiful compositions, the Vitruvian Man-caliber work
- 0.7-0.9: High — clear sketches with detail, interesting technical diagrams, botanical studies
- 0.4-0.7: Moderate — rough sketches, geometric exercises, partial studies
- 0.0-0.4: Low — scribbles, practice marks, barely visible sketches

**Drawing types to watch for:**
- Anatomical studies (muscles, bones, organs, proportions)
- Mechanical devices (gears, pulleys, levers, flying machines, war machines)
- Architectural designs (buildings, fortifications, urban planning)
- Hydraulic studies (water flow, canals, pumps)
- Botanical illustrations (plants, flowers, trees)
- Geometric/mathematical diagrams
- Horses and animal studies
- Human figures (poses, drapery studies, grotesque heads)
- Landscape and atmospheric studies
- Maps and topographical sketches

If text-only page with no drawings, omit the <detected-images> block.`;

// Book categorization for queue management
export const LEONARDO_CATEGORIES = {
  // Category 1: Manuscript Facsimiles (mirror writing)
  facsimile: [
    { id: '6991e92d35ed50020acc1268', title: 'Codex Arundel', pages: 495 },
    { id: '6991e70cebc7adff9a0b21e6', title: 'Codex Forster I', pages: 114 },
    { id: '6991e70febc7adff9a0b2259', title: 'Codex Forster II', pages: 324 },
    { id: '6991e712ebc7adff9a0b239e', title: 'Codex Forster III', pages: 182 },
    { id: '6991eab32f801130a473e170', title: 'Codex Trivulzianus', pages: 330 },
    { id: '6991e967e00017f4a9764e1a', title: 'Codex on the Flight of Birds', pages: 100 },
    { id: '6991eabc2f801130a473e2bc', title: 'Dell\'anatomia, fogli A', pages: 358 },
    { id: '6991e956efe0293c6e9e9f8f', title: 'I manoscritti (Sabachnikoff)', pages: 593 },
  ],

  // Category 2: Ravaisson-Mollien (facsimile + French commentary)
  ravaissonMollien: [
    { id: '6991e7c3ebc7adff9a0b24e8', title: 'Les Manuscrits Vol. I (Manuscript A)', pages: 320 },
    { id: '6991eaa82f801130a473d90a', title: 'Les manuscrits Vol. 2', pages: 438 },
    { id: '6991eaab2f801130a473dac2', title: 'Les manuscrits Vol. 3', pages: 464 },
    { id: '6991eaad2f801130a473dc94', title: 'Les manuscrits Vol. 4', pages: 396 },
    { id: '6991eaaf2f801130a473de22', title: 'Les manuscrits Vol. 5', pages: 436 },
    { id: '6991eab12f801130a473dfd8', title: 'Les manuscrits Vol. 6', pages: 406 },
  ],

  // Category 3: Windsor Castle Drawings (illustrations with French captions)
  windsorDrawings: [
    { id: '6991eaf42f801130a473ed8a', title: 'Nerfs et vaisseaux', pages: 102 },
    { id: '6991eac32f801130a473e514', title: 'Del moto e misura dell\'acqua', pages: 304 },
    { id: '6991ead32f801130a473e82a', title: 'Fragments: etudes anatomiques', pages: 146 },
    { id: '6991eae12f801130a473eacc', title: 'Anatomie du cheval Vol. 1', pages: 146 },
    { id: '6991eae32f801130a473eb78', title: 'Anatomie du cheval Vol. 2', pages: 158 },
    { id: '6991eaef2f801130a473ec5c', title: 'Generation et mecanisme', pages: 108 },
    { id: '6991eaf92f801130a473ee76', title: 'Le coeur', pages: 130 },
    { id: '6991eaf22f801130a473ed22', title: 'Attitudes de l\'homme', pages: 102 },
  ],

  // Category 4: Printed Editions (standard prompt)
  printed: [
    { id: '6991e96a3f846b651e181563', title: 'A Treatise on Painting (English)', pages: 100 },
    { id: '6991eac52f801130a473e646', title: 'Frammenti letterari e filosofici', pages: 482 },
    { id: '6991eb0b2f801130a473f292', title: 'Leonardo Prosatore', pages: 406 },
    { id: '6991eb0d2f801130a473f42a', title: 'Der Denker, Forscher und Poet', pages: 506 },
    { id: '6991e78669de8508b1f980ab', title: 'Les Manuscrits (Peladan)', pages: 424 },
    { id: '6991e94c35ed50020acc1952', title: 'Literary Works Vol. I', pages: 550 },
    { id: '6991e94fefe0293c6e9e9b65', title: 'Literary Works Vol. II', pages: 658 },
    { id: '6991e93135ed50020acc1458', title: 'Notebooks of Leonardo', pages: 1272 },
    { id: '6991eb102f801130a473f7be', title: 'Thoughts on Art and Life', pages: 250 },
    { id: '6991eb072f801130a473ef4a', title: 'Traite de la peinture (1651 French)', pages: 268 },
    { id: '6991e953efe0293c6e9e9df9', title: 'Trattato della pittura', pages: 404 },
    { id: '6991eac02f801130a473e424', title: 'Trattato della pittura (1651 EP)', pages: 238 },
    { id: '6991eb092f801130a473f058', title: 'Trattato della pittura (Manzi)', pages: 568 },
    { id: '6991eb0f2f801130a473f626', title: 'Textes choisis', pages: 406 },
  ],
};
