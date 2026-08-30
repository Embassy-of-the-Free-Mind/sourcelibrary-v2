import { describe, it, expect } from 'vitest';
import { prepareNotesMarkdown } from '@/components/reader/NotesRenderer';

/**
 * #4069 — "The notes arent rendered with highlights", reported on
 * /book/6a0b363e1615109dc53aee64/page/6a0b363e1615109dc53aee71 (page_type
 * "diagram"). The whole translation on such a page is the AI's description of
 * the plate, and unwrapDescriptionNotes() strips the <note> tags so it renders
 * uniformly — which also stripped every visual mark, leaving AI prose reading
 * exactly like the book's own transcribed text.
 *
 * The fix keeps the unwrap (no half-highlighting) and moves the mark to the
 * frame: NotesRenderer wraps a description-only body in AiDescriptionFrame.
 * That frame is JSX and these tests run in `node`, so what is pinned here is
 * the flag that gates it plus the unwrap it compensates for. #2791's guard —
 * pages carrying real transcription must NOT take this path — is pinned too.
 */

// pages/6a0b363e1615109dc53aee71 — verbatim stored `pages.translation.data`
const DIAGRAM_PAGE = `<note>A large, complex astronomical or cosmological diagram consisting of concentric circular paths. On the left side of the diagram is a vertical column containing several rectangular vignettes with human figures engaged in various activities, possibly representing the Labors of the Months or mythological scenes.

Moving inward, a thin circular band features miniature depictions of the signs of the zodiac and various constellations; recognizable figures include a scorpion (Scorpio), a crab (Cancer), a centaur with a bow (Sagittarius), and various animals.

The image is a fine-lined print, likely an engraving or woodcut from an early modern scientific or astronomical treatise.</note>

<summary>This page contains an astronomical/cosmological diagram illustrating celestial spheres and zodiacal signs.</summary>
<keywords>zodiac, celestial spheres, sun, moon, astrology, astronomy, engraving</keywords>`;

describe('description-only pages are marked as AI description (#4069)', () => {
  it('flags the reported diagram page as description-only, so the frame renders', () => {
    const { isDescriptionOnly } = prepareNotesMarkdown(DIAGRAM_PAGE, { showNotes: true, pageType: 'diagram' });
    expect(isDescriptionOnly).toBe(true);
  });

  it('leaves the description with no inline highlight of its own — the frame must carry it', () => {
    const { processedText } = prepareNotesMarkdown(DIAGRAM_PAGE, { showNotes: true, pageType: 'diagram' });
    // The description survives...
    expect(processedText).toContain('concentric circular paths');
    expect(processedText).toContain('signs of the zodiac');
    // ...unwrapped, in every paragraph (normalizeAnnotationSpans splits the
    // multi-paragraph note, so a leftover chip would highlight only part of it).
    expect(processedText).not.toMatch(/<\/?(note|image-desc)[\s>]/i);
  });

  it('does not take the frame path when the page carries real transcription (#2791)', () => {
    // A title page: genuine transcribed title/imprint alongside an image note.
    const TITLE_PAGE = `->## LE IMAGINI DE GLI DEI DEGLI ANTICHI<-

->Di Vincenzo Cartari, In Venetia, Appresso Francesco Marcolini, 1571<-

<note>An engraved title page within an architectural frame flanked by two allegorical figures.</note>`;
    const { isDescriptionOnly, processedText } = prepareNotesMarkdown(TITLE_PAGE, { showNotes: true, pageType: 'frontispiece' });
    expect(isDescriptionOnly).toBe(false);
    // ...and here the note keeps its own inline highlight chip, because there is
    // book text next to it that must stay distinguishable from the AI's prose.
    expect(processedText).toMatch(/<note>[\s\S]*architectural frame[\s\S]*<\/note>/i);
  });
});
