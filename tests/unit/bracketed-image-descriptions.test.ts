import { describe, it, expect } from 'vitest';
import { prepareNotesMarkdown, looksLikeImageDescription } from '@/components/reader/NotesRenderer';

/**
 * #4298: older translations describe a plate as a bare bracketed paragraph,
 * not an <image-desc>. The short ones were muted as interpolations (#4385),
 * but a description past the 240-char interpolation cap rendered as the
 * author's own text and the notes toggle could not hide it.
 *
 * Fixture: the reported page's translation.data verbatim (Fludd, Utriusque
 * cosmi historia, page 6952dac977f38f6761bc6df9, gemini-2.5-flash, 2026-01-02).
 */
const FLUDD_PAGE = '47\n\n[Ornate woodcut headpiece with floral and foliate motifs and a central mask]\n\nFIRST TREATISE.\nOF THE SECOND SECTION.\nPART III.\n\nConcerning the science of the memorative soul, which\nis commonly called the art of memory.\n\nTHE ART OF MEMORY.\n\n[Engraving of a man\'s head in profile. Inside the forehead is an eye labeled "Oculus Imaginationis." Lines extend from this eye to five small rectangular scenes on the right: a tower by the sea, an angel with a child, an obelisk, a ship, and a celestial scene with a figure on a cross.]\n\nTRA-';

describe('bracketed image descriptions (#4298)', () => {
  it('tags both descriptions on the reported page with notes on', () => {
    const { processedText } = prepareNotesMarkdown(FLUDD_PAGE, { showNotes: true });
    expect(processedText).toContain('<image-desc>Ornate woodcut headpiece');
    expect(processedText).toContain('<image-desc>Engraving of a man\'s head');
    expect(processedText).not.toContain('[Engraving');
    expect(processedText).toContain('THE ART OF MEMORY.');
  });

  it('hides both descriptions with notes off and keeps the author\'s text', () => {
    const { processedText } = prepareNotesMarkdown(FLUDD_PAGE, { showNotes: false });
    expect(processedText).not.toContain('Oculus Imaginationis');
    expect(processedText).not.toContain('woodcut headpiece');
    expect(processedText).toContain('Concerning the science of the memorative soul');
    expect(processedText).toContain('TRA-');
  });

  it.each([
    'Ornate woodcut headpiece with floral and foliate motifs and a central mask',
    'Engraving of a man\'s head in profile.',
    'A large engraving shows a massive, scaly dragon with bat wings',
    'Diagram: A vertical altitudinal section of the route',
    'Decorative initial',
    'Full-page woodcut illustration of the Tree of Life',
    'Image: a printer\'s device with an anchor',
    // Shapes from an 80K-page production sample (2026-10-12).
    'Image: Engraving of Stonehenge',
    'Illustration 36: A line drawing of the Taj Mahal.',
    'Image Description: A circular diagram composed of solid black dots',
    'Illustration omitted: Scene at a well in the Eastern Desert.',
    'Plate III and VI. The top section (III) displays a king-post truss bridge',
    'A small decorative floral ornament centered on the page.',
  ])('recognises %s', inner => {
    expect(looksLikeImageDescription(inner)).toBe(true);
  });

  it.each([
    // Real whole-paragraph brackets from a 17K-page sample that are NOT pictures.
    'Blank page',
    'Column Break',
    'Figure 3',
    'Page 201',
    'Translation of page 131',
    'Sigils of the Dragon\'s Head',
    'In that case, he shall not be received nor promoted to higher orders.',
    'The text continues, addressing the authority of the Roman Pontiff.',
    'Therefore the figure of the Sun is round.',
    'This page could not be translated due to content safety restrictions.',
  ])('leaves %s alone', inner => {
    expect(looksLikeImageDescription(inner)).toBe(false);
  });

  it('only retags whole paragraphs, never a bracket inside a sentence', () => {
    const src = 'He drew it [engraving of a lion] on the wall.';
    const { processedText } = prepareNotesMarkdown(src, { showNotes: true });
    expect(processedText).not.toContain('<image-desc>');
    expect(processedText).toContain('<interp>[engraving of a lion]</interp>');
  });
});
