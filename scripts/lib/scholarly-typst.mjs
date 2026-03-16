/**
 * Scholarly PDF generator using Typst.
 *
 * Generates a clean, typeset citation PDF with:
 *   - Serif typography with proper hyphenation
 *   - Footnotes from <note> tags (auto-numbered)
 *   - Marginal page references
 *   - Front matter (intro, methodology)
 *   - Index
 *   - Colophon
 *
 * Produces a .typ file, then compiles with `typst compile`.
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import crypto from 'crypto';

// ── Text processing ─────────────────────────────────────────────────

/**
 * Convert translation text to Typst markup.
 * - <note>...</note> → #footnote[...]
 * - <margin>...</margin> → #footnote[Marginal note: ...]
 * - Strip metadata tags
 * - Strip AI preambles
 * - Escape Typst special chars
 */
function translationToTypst(text) {
  if (!text) return '';

  let out = text;

  // Remove metadata-only tags entirely
  out = out.replace(
    /<(?:meta|page-type|columns|detected-images|lang|language|page-num|folio|sig|header|warning|abbrev|vocab|summary|keywords)>[\s\S]*?<\/(?:meta|page-type|columns|detected-images|lang|language|page-num|folio|sig|header|warning|abbrev|vocab|summary|keywords)>/gi,
    ''
  );

  // Remove AI preambles
  out = out.replace(/^(?:Okay,?\s*)?(?:Here(?:'s| is) (?:the|my) (?:translation|modernization|transcription)[\s\S]*?:\s*\n+)/i, '');

  // Helper: clean raw tag content for use in footnotes
  function cleanForFootnote(text) {
    let s = text.trim();
    s = s.replace(/<unclear>[\s\S]*?<\/unclear>/gi, '[?]');
    s = s.replace(/<term>([\s\S]*?)<\/term>/gi, '$1');
    s = s.replace(/<note>([\s\S]*?)<\/note>/gi, '($1)');
    s = s.replace(/<\/?[a-z][a-z0-9-]*\s*\/?>/gi, '');
    s = s.replace(/->([\s\S]*?)<-/g, '$1');
    s = s.replace(/\*\*(.+?)\*\*/g, '$1');
    s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');
    s = s.replace(/\n+/g, ' ');
    return s.trim();
  }

  // Extract margin notes FIRST (they may contain <note> tags)
  // Process margins before notes so inner <note> tags get flattened
  const footnotes = [];
  out = out.replace(/<margin>([\s\S]*?)<\/margin>/gi, (_, content) => {
    const clean = cleanForFootnote(content);
    if (!clean || clean.length < 3) return '';
    const id = `%%FN${footnotes.length}%%`;
    footnotes.push(`Marginal note: ${clean}`);
    return id;
  });

  // Extract <note>...</note> as footnotes
  out = out.replace(/<note>([\s\S]*?)<\/note>/gi, (_, content) => {
    const clean = cleanForFootnote(content);
    if (!clean) return '';
    const id = `%%FN${footnotes.length}%%`;
    footnotes.push(clean);
    return id;
  });

  // Convert <unclear>...</unclear>
  out = out.replace(/<unclear>([\s\S]*?)<\/unclear>/gi, '[?$1]');

  // Strip <term> tags (just keep content, no formatting)
  out = out.replace(/<term>([\s\S]*?)<\/term>/gi, '$1');

  // Remove <column-break/>
  out = out.replace(/<column-break\s*\/?>/gi, '\n\n');

  // Remove arrow tags (paired and unpaired)
  out = out.replace(/->([\s\S]*?)<-/g, '$1');
  out = out.replace(/->\s*/g, '');
  out = out.replace(/\s*<-/g, '');

  // Remove any remaining XML tags
  out = out.replace(/<\/?[a-z][a-z0-9-]*\s*\/?>/gi, '');

  // Strip all markdown formatting
  out = out.replace(/^#{1,6}\s+/gm, '');
  out = out.replace(/^\s*[-*]{3,}\s*$/gm, '');
  out = out.replace(/\*\*(.+?)\*\*/g, '$1');
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');
  out = out.replace(/^[_]{3,}.*$/gm, '');

  // Now escape Typst special chars (but not our %%FN%% placeholders)
  out = escapeTypst(out);

  // Convert footnote placeholders to Typst footnotes
  for (let i = 0; i < footnotes.length; i++) {
    const escaped = escapeTypst(footnotes[i]);
    out = out.replace(`%%FN${i}%%`, `#footnote[${escaped}]`);
  }

  // Remove markdown table rows (they don't render well — keep content)
  out = out.replace(/^\|.*\|$/gm, (line) => {
    // Extract cell content, skip separator rows
    if (/^[\s|:-]+$/.test(line)) return '';
    const cells = line.split('|').map(c => c.trim()).filter(c => c && !/^[-:]+$/.test(c));
    return cells.join(' — ');
  });

  // Clean up excessive blank lines
  out = out.replace(/\n{4,}/g, '\n\n\n');

  return out.trim();
}

function escapeTypst(text) {
  // Escape characters special in Typst content mode
  return text
    .replace(/\\/g, '\\\\')
    .replace(/#/g, '\\#')
    .replace(/\$/g, '\\$')
    .replace(/@/g, '\\@')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>')
    .replace(/~/g, '\\~')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*');
}

function markdownToTypst(md) {
  if (!md) return '';
  let out = md;

  // ## Heading → = Heading (Typst level 2 since we use = for title)
  out = out.replace(/^### (.+)$/gm, '=== $1');
  out = out.replace(/^## (.+)$/gm, '== $1');

  // **bold** → *bold*
  out = out.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // *italic* → _italic_ (but not inside bold)
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_');

  // - bullet → - bullet (same in Typst)
  // Typst uses - for bullets already

  // Escape special chars except the markup we just added
  // This is tricky — skip lines that start with = (headings) or - (bullets) or * (bold)
  // For now, just escape # @ $ < > ~
  out = out.replace(/(?<!\\)#(?!footnote)/g, '\\#');
  out = out.replace(/\$/g, '\\$');
  out = out.replace(/@/g, '\\@');
  out = out.replace(/(?<!\\)<(?![a-z])/g, '\\<');
  out = out.replace(/(?<![a-z])>(?!])/g, '\\>');

  return out;
}

// ── Page filtering ──────────────────────────────────────────────────

const SKIP_PAGE_TYPES = new Set(['blank', 'illustration', 'map', 'frontispiece', 'diagram']);

function isContentPage(page) {
  if (!page.translation?.data) return false;
  if (page.page_type && SKIP_PAGE_TYPES.has(page.page_type)) return false;
  const text = page.translation.data;
  // Skip physical descriptions of covers, spines, blank pages
  const isPhysicalDescription = /\b(blank\s+(page|sheet)|book\s+spine|front\s+cover|back\s+cover|binding\s+(is|shows|has)|no\s+text\s+(is\s+)?visible|devoid\s+of\s+(any\s+)?text|leather\s+sections|marbled\s+pattern)\b/i.test(text);
  if (isPhysicalDescription && text.length < 800) return false;
  // Skip corrupted/hallucinated pages (repetitive text)
  // Check for repeated n-grams (catches "the page of the title of the page...")
  const words = text.split(/\s+/);
  if (words.length > 30) {
    // Check bigram repetition
    const bigrams = {};
    for (let i = 0; i < words.length - 1; i++) {
      const bg = `${words[i]} ${words[i+1]}`.toLowerCase();
      bigrams[bg] = (bigrams[bg] || 0) + 1;
    }
    const maxBigram = Math.max(...Object.values(bigrams));
    if (maxBigram > 10 && maxBigram / (words.length / 2) > 0.15) return false;
  }
  return true;
}

// ── Typst document generator ────────────────────────────────────────

export function generateTypstSource(book, pages, options = {}) {
  const { introduction, methodology } = options;
  const bookTitle = book.display_title || book.title;
  const bookSlug = book.slug || book.id;
  const now = new Date().toISOString().split('T')[0];
  const translatedPages = pages.filter(isContentPage);

  const doc = [];

  // ── Document setup ──
  doc.push(`
#set document(
  title: "English Translation of ${bookTitle.replace(/"/g, '\\"')}",
  author: "${(book.author || 'Anonymous').replace(/"/g, '\\"')}",
)

#set page(
  paper: "a4",
  margin: (top: 2.5cm, bottom: 3cm, left: 2.5cm, right: 2.5cm),
  numbering: "i",
  number-align: center,
)

#set text(
  font: "New Computer Modern",
  size: 10pt,
  lang: "en",
  hyphenate: true,
)

#set par(
  justify: true,
  leading: 0.65em,
  first-line-indent: 1.5em,
)

#set heading(numbering: none)

#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  v(2em)
  text(size: 16pt, weight: "bold", it.body)
  v(1em)
}

#show heading.where(level: 2): it => {
  v(1.5em)
  text(size: 12pt, weight: "bold", it.body)
  v(0.5em)
}

#show heading.where(level: 3): it => {
  v(1em)
  text(size: 10.5pt, weight: "bold", it.body)
  v(0.3em)
}

#show footnote.entry: it => {
  set text(size: 8pt)
  it
}
`);

  // ── Title page ──
  doc.push(`
#page(numbering: none)[
  #v(5cm)
  #align(center)[
    #text(size: 22pt, weight: "bold")[${escapeTypst(bookTitle)}]

    ${book.title !== bookTitle ? `#v(0.5em)\n    #text(size: 12pt, style: "italic")[${escapeTypst(book.title)}]` : ''}

    #v(1.5em)
    #text(size: 14pt)[${escapeTypst(book.author || 'Anonymous')}]

    ${book.published ? `#v(0.3em)\n    #text(size: 12pt)[${escapeTypst(book.published)}]` : ''}

    #v(4cm)
    #text(size: 10pt)[Translated by Source Library]
    #v(0.3em)
    #text(size: 9pt, fill: rgb("#666"))[sourcelibrary.org/book/${bookSlug}]
    #v(0.3em)
    #text(size: 9pt, fill: rgb("#666"))[${now}]
  ]
]
`);

  // ── About this edition ──
  doc.push(`
= About This Edition

#set par(first-line-indent: 0pt)

#block(
  width: 100%,
  inset: 1em,
  stroke: 0.5pt + rgb("#999"),
  radius: 2pt,
)[
  *This PDF is a citable scholarly record.* It is deposited with Zenodo and assigned a DOI so that scholars can reference specific passages in academic publications. For the full reading experience --- with original page facsimiles displayed alongside the translation, searchable text, and interactive navigation --- visit #link("https://sourcelibrary.org/book/${bookSlug}")[sourcelibrary.org].
]

#v(1em)

#set par(first-line-indent: 1.5em)

This translation was produced using artificial intelligence by Source Library, a project of the Embassy of the Free Mind in Amsterdam. The original ${escapeTypst(book.language || 'source language')} text was transcribed from digitized page images using optical character recognition, then translated into English page by page using large language models.

This AI-assisted translation has *not* been reviewed by human editors or translators. It captures the meaning and structure of the original text but may not reflect every nuance a specialist human translator would convey. Readers are encouraged to consult the original language text, available alongside this translation at Source Library.

This work is licensed under Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).
`);

  // ── Introduction ──
  if (introduction) {
    doc.push(`\n= Introduction\n\n${markdownToTypst(introduction)}\n`);
  }

  // ── Methodology ──
  if (methodology) {
    doc.push(`\n= Methodology\n\n${markdownToTypst(methodology)}\n`);
  }

  // ── Translation ──
  doc.push(`
#set page(numbering: "1")
#counter(page).update(1)

= Translation
`);

  // Group by chapters if available
  const chapters = book.chapters || [];
  let chapterIdx = 0;

  for (const page of translatedPages) {
    // Chapter heading
    if (chapters.length > 0 && chapterIdx < chapters.length) {
      while (chapterIdx < chapters.length && chapters[chapterIdx].pageNumber <= page.page_number) {
        const ch = chapters[chapterIdx];
        if (ch.pageNumber === page.page_number || (chapterIdx === 0 && page.page_number <= ch.pageNumber)) {
          doc.push(`\n== ${escapeTypst(ch.titleEn || ch.title)}\n`);
        }
        chapterIdx++;
      }
    }

    // Page marker in margin
    doc.push(`#block(above: 0.8em, below: 0.3em)[#text(size: 7.5pt, fill: rgb("#999"), style: "italic")[p. ${page.page_number}]]`);

    // Translation text
    const typstText = translationToTypst(page.translation.data);
    if (typstText) {
      doc.push(typstText);
      doc.push('');
    }
  }

  // ── Index ──
  const index = book.index;
  if (index && (index.people?.length || index.places?.length || index.concepts?.length)) {
    doc.push('\n= Index\n');

    const renderSection = (title, entries) => {
      if (!entries?.length) return;
      doc.push(`== ${title}\n`);
      for (const entry of entries.slice(0, 80)) {
        const refs = entry.pages?.length ? ` _(pp. ${entry.pages.slice(0, 8).join(', ')})_` : '';
        doc.push(`${escapeTypst(entry.term)}${refs} \\`);
      }
      doc.push('');
    };

    renderSection('People', index.people);
    renderSection('Places', index.places);
    renderSection('Concepts', index.concepts);

    if (index.vocabulary?.length) {
      doc.push('== Glossary\n');
      for (const entry of index.vocabulary.slice(0, 80)) {
        const def = entry.definition ? ` --- ${escapeTypst(entry.definition)}` : '';
        doc.push(`*${escapeTypst(entry.term)}*${def} \\`);
      }
      doc.push('');
    }
  }

  // ── Colophon ──
  doc.push(`
= Colophon

#set par(first-line-indent: 0pt)

This digital edition of _${escapeTypst(bookTitle)}_ was produced by Source Library, a project of the Embassy of the Free Mind in Amsterdam.

#v(0.5em)
#table(
  columns: (auto, 1fr),
  stroke: none,
  row-gutter: 0.3em,
  [*Author:*], [${escapeTypst(book.author || 'Anonymous')}],
  [*Language:*], [${escapeTypst(book.language || 'Unknown')}],
  ${book.published ? `[*Published:*], [${escapeTypst(book.published)}],` : ''}
  ${book.place_published ? `[*Place:*], [${escapeTypst(book.place_published)}],` : ''}
  ${book.publisher ? `[*Publisher:*], [${escapeTypst(book.publisher)}],` : ''}
  ${book.ustc_id ? `[*USTC:*], [${escapeTypst(book.ustc_id)}],` : ''}
  [*Pages translated:*], [${translatedPages.length}],
  [*Generated:*], [${now}],
  [*License:*], [CC BY-SA 4.0],
)

#v(1em)
Source Library: #link("https://sourcelibrary.org/book/${bookSlug}")[sourcelibrary.org/book/${bookSlug}]
${book.ia_identifier ? `\\\nInternet Archive: #link("https://archive.org/details/${book.ia_identifier}")[archive.org/details/${book.ia_identifier}]` : ''}
`);

  return doc.join('\n');
}

// ── Compile ─────────────────────────────────────────────────────────

export async function generateScholarlyPdf(book, pages, options = {}) {
  const typstSource = generateTypstSource(book, pages, options);

  // Write to temp file
  const tmpDir = join(tmpdir(), `sourcelibrary-typst-${crypto.randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });
  const typFile = join(tmpDir, 'edition.typ');
  const pdfFile = join(tmpDir, 'edition.pdf');

  writeFileSync(typFile, typstSource, 'utf-8');

  try {
    execSync(`typst compile "${typFile}" "${pdfFile}"`, {
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const pdfBuffer = readFileSync(pdfFile);
    return pdfBuffer;
  } finally {
    // Cleanup
    try { unlinkSync(typFile); } catch {}
    try { unlinkSync(pdfFile); } catch {}
    try { unlinkSync(tmpDir); } catch {} // rmdir if empty
  }
}
