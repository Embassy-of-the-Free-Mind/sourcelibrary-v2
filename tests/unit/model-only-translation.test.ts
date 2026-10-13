import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  noContentMarkerType,
  isUngroundedTranslation,
  exportableTranslation,
} from '../../scripts/lib/model-only-translation.mjs';
import NotesRenderer from '@/components/reader/NotesRenderer';

/**
 * #5903 — model text shown in the English pane as if it were the book's. Every
 * string below is a stored `pages.*.data`, read from production on 2026-10-10.
 */

// 697a3055143dc97a39f2a22f p.69: a marbled endpaper. The transcription has no text;
// the "translation" is an essay on combed marbling.
const ENDPAPER_OCR = `<lang>None</lang>
<meta>Decorative marbled endpaper; no text present on this page.</meta>

<vocab>marbled paper, endpaper, bookbinding, combed pattern, nonpareil marbling</vocab>

<detected-images>
[{"description": "A full-page illustration of historical combed marbled paper. The pattern consists of vertical wavy bands and fine 'teeth' created by dragging a comb through pigments of blue, red, yellow, and black on a size base.", "type": "decorative", "bbox": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}, "gallery_quality": 0.85}]
</detected-images>`;

const ENDPAPER_TRANSLATION = `<meta>Continuing from the flyleaf containing modern bibliographic notations and library shelfmarks, this page consists of the book’s decorative interior lining.</meta>

->[Decorative Marbled Endpaper]<-

*This page contains no text. It is a full-page decorative illustration featuring a traditional combed marbled pattern.*

The pattern consists of vertical wavy bands and fine "teeth" created by dragging a comb through pigments of blue, red, yellow, and black on a <term>size</term> <note>A viscous, gelatinous solution (often made from carrageen moss) that allows pigments to float on the surface before they are transferred to paper.</note> base.

<note>This style is known as "combed" or <term>nonpareil marbling</term>. In the 17th and 18th centuries, such papers were used by bookbinders as <term>endpapers</term>—the sheets glued to the inside of the covers—to provide structural strength to the binding and to hide the raw edges of the leather or parchment.</note>

<summary>This page is a decorative marbled endpaper featuring a hand-crafted "combed" or "nonpareil" pattern in blue, red, yellow, and black.</summary>`;

// 685a9b1bcdbe778e22823a64 p.3
const BLANK_OCR = `<lang>Latin</lang>
<page-type>blank</page-type>
<warning>This image appears to be a blank page from the manuscript. No legible text or illustrations are present, only minor ink spots and scanning artifacts.</warning>

<vocab></vocab>`;
const BLANK_MARKER = '[Blank page — no translatable content]';

// An ordinary text page: real source, real translation.
const TEXT_OCR = 'Hermes Trismegistus dixit: Verum, sine mendacio, certum et verissimum: quod est inferius est sicut quod est superius.';
const TEXT_TRANSLATION = 'Hermes Trismegistus said: True, without falsehood, certain and most true: that which is below is like that which is above, and that which is above is like that which is below, to accomplish the miracles of the one thing. And as all things were from one, by the meditation of one, so all things were born from this one thing by adaptation.';

describe('noContentMarkerType', () => {
  it('reads the page type out of the pipeline marker', () => {
    expect(noContentMarkerType(BLANK_MARKER)).toBe('blank');
    expect(noContentMarkerType('[Illustration page — no translatable content]')).toBe('illustration');
    expect(noContentMarkerType('[Musical-score page — no translatable content]')).toBe('musical-score');
    expect(noContentMarkerType('  [Blank page — no translatable content]\n')).toBe('blank');
  });

  it('leaves other bracketed text alone — a refusal is not page information', () => {
    expect(noContentMarkerType('[This page could not be translated due to content recitation restrictions.]')).toBeNull();
    expect(noContentMarkerType('[Blank page]')).toBeNull();
    expect(noContentMarkerType(`${BLANK_MARKER}\n\nThe rest of the page.`)).toBeNull();
    expect(noContentMarkerType(TEXT_TRANSLATION)).toBeNull();
    expect(noContentMarkerType(undefined)).toBeNull();
  });
});

describe('isUngroundedTranslation', () => {
  it('flags the marbled endpaper', () => {
    expect(isUngroundedTranslation({ ocr: { data: ENDPAPER_OCR }, translation: { data: ENDPAPER_TRANSLATION } })).toBe(true);
  });

  it('does not flag a text page, a marker, or a page with no transcription', () => {
    expect(isUngroundedTranslation({ ocr: { data: TEXT_OCR }, translation: { data: TEXT_TRANSLATION } })).toBe(false);
    expect(isUngroundedTranslation({ ocr: { data: BLANK_OCR }, translation: { data: BLANK_MARKER } })).toBe(false);
    expect(isUngroundedTranslation({ translation: { data: ENDPAPER_TRANSLATION } })).toBe(false);
  });

  it('counts a page mark as source text — 69dbc7cd1040d1d5e20941e6 p.397 is a full page in one <margin>', () => {
    const ocr = `<page-type>text</page-type>\n\n<margin>\nremissione indicaueritis duabus videlicet clauibus. scz potestatis\net discretionis. Cauere igitur debet quilibet christianus ne propter opa\n</margin>`;
    expect(isUngroundedTranslation({ ocr: { data: ocr }, translation: { data: TEXT_TRANSLATION } })).toBe(false);
  });

  it('does not count a nested note as text — 69c727966a0f3d112faf6ed0 p.159, an engraving with a real caption', () => {
    const ocr = `<page-type>illustration</page-type>\n<header>1. Th. p. 108.</header>\n\n<image-desc size="large">An engraving depicting two registers of Egyptian-style figures.</image-desc>\n\n->*Die Dauer der Ruhe*<-\n->*des Horus.*<-`;
    const tr = `1st Part page 108.\n\n<note>An engraving depicting two registers of Egyptian-style figures. The top register shows a sphinx-like creature with a human head and lion body, standing over three canopic jars. The bottom register shows a jackal-headed figure <note>Anubis</note> leaning over a reclining human figure on a lion-shaped bier, with four canopic jars beneath it and a standing human figure with a tall headdress gesturing with one hand.</note>\n\n->*The Duration of the Rest*<-\n->*of Horus.*<-`;
    expect(isUngroundedTranslation({ ocr: { data: ocr }, translation: { data: tr } })).toBe(false);
  });

  it('weights a dense script — 29 characters of a Chinese colophon are a page of text (6a3c64a4af3c49b59c5ca6fa p.103)', () => {
    const ocr = '<language>Chinese</language>\n\n總校官庶吉士臣張能照\n校對官檢討臣王坦修\n謄錄監生臣王錫壽';
    const tr = "General Editor, Shu chi shih member of the Hanlin Academy, Your Servant, Chang Neng chao. Proofreader, Chien t'ao Editor/Examiner, Your Servant, Wang T'an hsiu. Copyist, Student of the Imperial Academy, Your Servant, Wang Hsi shou.";
    expect(isUngroundedTranslation({ ocr: { data: ocr }, translation: { data: tr } })).toBe(false);
    // …while a failed Japanese OCR — six characters, then blank space — still is (69d5ad8f4dc55b8478de0eac p.6)
    expect(isUngroundedTranslation({ ocr: { data: '<language>Japanese</language>\n<page-num>4</page-num>\n\n(日) 初に別款' + '\u3000'.repeat(400) }, translation: { data: tr } })).toBe(true);
  });

  it('does not flag a short caption under a short source', () => {
    expect(isUngroundedTranslation({ ocr: { data: '<page-type>title-page</page-type>\nLIBER PRIMVS' }, translation: { data: 'FIRST BOOK' } })).toBe(false);
  });
});

describe('exportableTranslation', () => {
  it('drops the marker and the ungrounded description, keeps the book', () => {
    expect(exportableTranslation({ ocr: { data: BLANK_OCR }, translation: { data: BLANK_MARKER } })).toBe('');
    expect(exportableTranslation({ ocr: { data: ENDPAPER_OCR }, translation: { data: ENDPAPER_TRANSLATION } })).toBe('');
    expect(exportableTranslation({ ocr: { data: TEXT_OCR }, translation: { data: TEXT_TRANSLATION } })).toBe(TEXT_TRANSLATION);
  });
});

describe('NotesRenderer with ungrounded', () => {
  it('frames the description under its own heading, not as the book', () => {
    const html = renderToStaticMarkup(React.createElement(NotesRenderer, { text: ENDPAPER_TRANSLATION, showMetadata: false, showNotes: true, ungrounded: true }));
    expect(html).toContain('Little or no text was transcribed on this page · written by the model');
    expect(html).toContain('combed marbled pattern');
  });

  it('hides it with Notes off, like any description', () => {
    const html = renderToStaticMarkup(React.createElement(NotesRenderer, { text: ENDPAPER_TRANSLATION, showMetadata: false, showNotes: false, ungrounded: true }));
    expect(html).toContain('Little or no text was transcribed on this page. Turn Notes on');
    expect(html).not.toContain('combed marbled pattern');
  });

  it('leaves an ordinary page as it was', () => {
    const html = renderToStaticMarkup(React.createElement(NotesRenderer, { text: TEXT_TRANSLATION, showMetadata: false, showNotes: true }));
    expect(html).not.toContain('written by the model');
    expect(html).toContain('Hermes Trismegistus said');
  });
});

describe('NoTextPageLine', () => {
  it('prints the marker as page information, never as a translator chip', async () => {
    const { NoTextPageLine } = await import('@/components/reader-v2/PaneEmptyState');
    const blank = renderToStaticMarkup(React.createElement(NoTextPageLine, { pageType: noContentMarkerType(BLANK_MARKER)! }));
    expect(blank).toContain('Blank page.');
    expect(blank).not.toContain('no translatable content');
    const plate = renderToStaticMarkup(React.createElement(NoTextPageLine, { pageType: 'illustration' }));
    expect(plate).toContain('Illustration page. No text to translate.');
  });
});
