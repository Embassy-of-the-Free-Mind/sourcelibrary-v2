import { describe, it, expect } from 'vitest';
import { prepareNotesMarkdown } from '@/components/reader/NotesRenderer';

/**
 * The reader's "Notes" toggle hides the AI's own commentary (<note>,
 * <image-desc>). It must NOT hide page marks (<margin>, <gloss>, <insert>,
 * <unclear>) — those wrap text that is physically on the page, so deleting
 * them deletes transcription.
 *
 * Reported 2026-07-29 on Wubei Zhi vol. 93 (a Ming coastal-defence atlas):
 * the translation model wraps every cartouche label on a map in <insert> and
 * the running header in <margin>, so hitting Notes emptied the whole page.
 * The same shape made the description-only heuristic misfire — with the labels
 * counted as annotation rather than body text, the page read as pure AI
 * description, which unwrapped the one genuine <note> and left every real
 * label highlighted (the "half-highlighted" report).
 *
 * Both fixtures are the verbatim stored `pages.translation.data`.
 */

// pages/6992cf02f7519cdd65044c36 — page_type "map", labels only, no plain body text
const MAP_PAGE = `<margin>Occupation and Measurement, Coastal Defense Part 4</margin>

<note>A woodblock print map depicting a coastal region. The upper portion of the map is filled with stylized wave patterns representing the sea, containing several islands.</note>

<insert>Shahe Island</insert>
<insert>Shuang Island</insert>
<insert>Baishi Beacon Tower</insert>
<insert>Yangjiadian Inspection Magistrate's Office</insert>

<summary>This page illustrates the network of fortified stockades and signal towers protecting the coastline.</summary>
<keywords>Coastal Defense, Beacon Tower, Stockade</keywords>`;

// pages/6992cf02f7519cdd65044c39 — page_type "diagram", same shape plus a real heading
const DIAGRAM_PAGE = `<meta>Continuity with previous page: Continues the series of coastal defense maps.</meta>

# Treatise on Armament Technology, Volume 212: Coastal Defense IV
<note>A woodblock print map depicting a coastal defense landscape, with beacon towers (<term>feng hou</term> <gloss>beacon towers</gloss>) marked with flag-like symbols.</note>

<insert>East Island</insert>
<insert>Jian-dao <note>Scissors</note> Mountain</insert>
<insert>Mapu Stockade</insert>`;

describe('Notes toggle preserves transcribed page marks', () => {
  it('keeps map labels when notes are off (map page)', () => {
    const { processedText } = prepareNotesMarkdown(MAP_PAGE, { showNotes: false, pageType: 'map' });

    for (const label of ['Shahe Island', 'Shuang Island', 'Baishi Beacon Tower', "Yangjiadian Inspection Magistrate's Office"]) {
      expect(processedText, `"${label}" is transcribed from the page and must survive the Notes toggle`).toContain(label);
    }
    // The running header is a page mark too
    expect(processedText).toContain('Occupation and Measurement, Coastal Defense Part 4');
    // ...and no highlight chips remain
    expect(processedText).not.toMatch(/<(insert|margin|gloss|unclear)[\s>]/i);
  });

  it('keeps map labels when notes are off (diagram page with a heading)', () => {
    const { processedText } = prepareNotesMarkdown(DIAGRAM_PAGE, { showNotes: false, pageType: 'diagram' });

    for (const label of ['East Island', 'Mapu Stockade']) {
      expect(processedText).toContain(label);
    }
    expect(processedText).toContain('Treatise on Armament Technology');
  });

  it('drops the AI description when notes are off', () => {
    for (const [text, pageType] of [[MAP_PAGE, 'map'], [DIAGRAM_PAGE, 'diagram']] as const) {
      const { processedText } = prepareNotesMarkdown(text, { showNotes: false, pageType });
      expect(processedText).not.toContain('woodblock print map depicting');
    }
  });

  it('does not blank the page: notes off still leaves real text', () => {
    const { processedText, isDescriptionOnly } = prepareNotesMarkdown(MAP_PAGE, { showNotes: false, pageType: 'map' });
    // A page whose labels are all transcription is not "description only",
    // so the reader must not fall through to the "toggle Notes" placeholder.
    expect(isDescriptionOnly).toBe(false);
    expect(processedText.replace(/[\s#*]/g, '').length).toBeGreaterThan(60);
  });

  it('keeps the AI note highlighted when notes are on (no half-highlighting)', () => {
    const { processedText, isDescriptionOnly } = prepareNotesMarkdown(MAP_PAGE, { showNotes: true, pageType: 'map' });
    expect(isDescriptionOnly).toBe(false);
    // The description stays wrapped — it is the AI's, not the book's
    expect(processedText).toMatch(/<note>[\s\S]*woodblock print map[\s\S]*<\/note>/i);
    // ...and so do the labels, consistently
    expect(processedText).toMatch(/<insert>Shahe Island<\/insert>/i);
  });

  it('still treats a page with only AI description as description-only', () => {
    const descriptionOnly = `<image-desc>An engraved frontispiece showing an armillary sphere flanked by two allegorical figures.</image-desc>`;
    const { isDescriptionOnly } = prepareNotesMarkdown(descriptionOnly, { showNotes: false, pageType: 'frontispiece' });
    expect(isDescriptionOnly).toBe(true);
  });

  it('keeps inline term+note translation words when notes are off (#3811)', () => {
    // pages/6949af986ef4a68b726b8008 (Ten Books on Architecture, 1522) — the
    // pre-fix stored translation, verbatim. The old pair-drop deleted the term
    // content mid-sentence, rendering "how a ** is produced in the body".
    const VITRUVIUS_PAGE = `<meta>This page continues the discussion of the "perfect" proportions of the human body.</meta>

### BOOK THREE

46

No less than how a **<term>scheme of roundness</term> <note>original: "schema rotundationis"</note> is produced in the body, so too a <term>square arrangement</term> <note>original: "quadrata designatio"</note> is found within it. For if a measurement is taken from the soles of the feet to the very top of the head, the width will be found to be the same as the height.**

**<term>scheme of roundness</term> <note>original: "schema rotundationis"</note>, <term>square arrangement</term> <note>original: "quadrata designatio"</note>, width, height, Vitruvius**

<summary>This page concludes the description of the Vitruvian Man.</summary>
<keywords>Vitruvian Man, geometry, proportion</keywords>`;

    const { processedText } = prepareNotesMarkdown(VITRUVIUS_PAGE, { showNotes: false });
    // The inline terms are the translation itself — they must survive
    expect(processedText).toContain('how a **scheme of roundness');
    expect(processedText).toContain('so too a square arrangement');
    // ...while the notes (the AI's "original:" glosses) are gone
    expect(processedText).not.toContain('schema rotundationis');
    // The trailing vocab line has stray words, so it is not a pure glossary
    // line; its pairs unwrap rather than leaving comma-holes (", ,")
    expect(processedText).not.toMatch(/,\s*,/);
  });

  it('still drops a whole trailing glossary line when notes are off', () => {
    const prose = `The dog delivered a sharp bite to the intruder.

<term>bite</term> <note>original: "morsus."</note>`;
    const { processedText } = prepareNotesMarkdown(prose, { showNotes: false });
    expect(processedText).toContain('sharp bite to the intruder');
    // The dangling glossary entry (term + its now-hidden definition) is removed
    expect(processedText).not.toContain('morsus');
    expect(processedText.trim().endsWith('intruder.')).toBe(true);
  });

  it('drops a term\'s AI gloss but keeps the transcribed term', () => {
    const { processedText } = prepareNotesMarkdown(DIAGRAM_PAGE, { showNotes: false, pageType: 'diagram' });
    // The <note> that contained this pair is gone entirely here; assert the rule
    // directly on running prose so the term/gloss handling is exercised.
    const prose = `The signal posts (<term>feng hou</term> <gloss>beacon towers</gloss>) line the shore.`;
    const { processedText: prosed } = prepareNotesMarkdown(prose, { showNotes: false });
    expect(prosed).toContain('feng hou');
    expect(prosed).not.toContain('beacon towers');
    expect(prosed).toContain('The signal posts (feng hou) line the shore.');
    expect(processedText).toBeTruthy();
  });
});
