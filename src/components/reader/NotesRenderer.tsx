'use client';

import React, { useMemo, useState, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { isRTLLanguage } from '@/lib/types';
import { NOTE_TAG_STYLES } from '@/lib/style-constants';

// Page types where the entire "translation" is AI-generated description (no original text)
const DESCRIPTION_ONLY_PAGE_TYPES = new Set(['blank', 'illustration', 'map', 'frontispiece', 'diagram']);

interface NotesRendererProps {
  text: string;
  className?: string;
  showMetadata?: boolean; // Default true - show metadata section
  showNotes?: boolean; // Default true - show inline notes (margin, gloss, etc.)
  language?: string; // Optional language for RTL detection
  columns?: number; // Number of text columns (from page.columns metadata). Used as fallback when no <column-break/> marker exists.
  pageType?: string; // Page type from OCR (frontispiece, illustration, etc.). When non-text type, all content is treated as notes.
}

/**
 * Get ISO 639-1 language code for lang attribute
 */
function getLanguageCode(language: string | undefined): string | undefined {
  if (!language) return undefined;
  const lower = language.toLowerCase();
  if (lower.includes('arabic')) return 'ar';
  if (lower.includes('hebrew')) return 'he';
  if (lower.includes('aramaic')) return 'arc';
  if (lower.includes('syriac')) return 'syr';
  if (lower.includes('persian') || lower.includes('farsi')) return 'fa';
  if (lower.includes('urdu')) return 'ur';
  return undefined;
}

interface ExtractedMetadata {
  language?: string;
  pageType?: string;        // <page-type> - title-page, frontispiece, text, etc.
  pageNumber?: string;
  folio?: string;
  signature?: string;       // [[signature: ...]] - printer's signature marks
  warning?: string;         // [[warning: ...]] - OCR quality issues
  meta: string[];           // [[meta: ...]] entries
  abbreviations: string[];  // [[abbrev: ...]] entries
  vocabulary: string[];     // [[vocabulary: ...]] - key terms from OCR
  summary?: string;         // [[summary: ...]] - page summary from translation
  keywords: string[];       // [[keywords: ...]] - English keywords for indexing
}

// Extract metadata entries and return cleaned text + metadata object
// Supports both old [[bracket:]] and new <xml> syntax
function extractMetadata(text: string): { cleanText: string; metadata: ExtractedMetadata } {
  const metadata: ExtractedMetadata = {
    meta: [],
    abbreviations: [],
    vocabulary: [],
    keywords: [],
  };

  let result = text;

  // Strip markdown code fence wrappers if present (AI sometimes wraps output)
  result = result.replace(/^```(?:markdown)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // Strip AI preamble phrases (e.g., "Here is the translation...")
  result = result.replace(/^(?:Here (?:is|are) (?:the |my )?(?:translation|transcription|OCR|summary|text)[^:]*:\s*\n*)/i, '');
  result = result.replace(/^(?:Below is (?:the |my )?(?:translation|transcription|OCR|summary)[^:]*:\s*\n*)/i, '');
  result = result.replace(/^(?:I have (?:translated|transcribed|completed)[^:]*:\s*\n*)/i, '');
  result = result.replace(/^(?:The following is[^:]*:\s*\n*)/i, '');

  // === XML syntax (new) ===
  // Extract language
  result = result.replace(/<(?:lang|language)>([\s\S]*?)<\/(?:lang|language)>/gi, (_, lang) => {
    metadata.language = lang.trim();
    return '';
  });

  // Extract page type
  result = result.replace(/<page-type>([\s\S]*?)<\/page-type>/gi, (_, type) => {
    metadata.pageType = type.trim().toLowerCase();
    return '';
  });

  // Extract page numbers
  result = result.replace(/<page-num>([\s\S]*?)<\/page-num>/gi, (_, num) => {
    metadata.pageNumber = num.trim();
    return '';
  });

  // Extract folio references
  result = result.replace(/<folio>([\s\S]*?)<\/folio>/gi, (_, folio) => {
    metadata.folio = folio.trim();
    return '';
  });

  // Extract signature marks
  result = result.replace(/<sig>([\s\S]*?)<\/sig>/gi, (_, sig) => {
    metadata.signature = sig.trim();
    return '';
  });

  // Extract warning (OCR quality issues)
  result = result.replace(/<warning>([\s\S]*?)<\/warning>/gi, (_, warning) => {
    metadata.warning = warning.trim();
    return '';
  });

  // Extract meta notes
  result = result.replace(/<meta>([\s\S]*?)<\/meta>/gi, (_, content) => {
    metadata.meta.push(content.trim());
    return '';
  });

  // Extract abbreviation expansions
  result = result.replace(/<abbrev>([\s\S]*?)<\/abbrev>/gi, (_, content) => {
    metadata.abbreviations.push(content.trim());
    return '';
  });

  // Extract vocabulary (key terms from OCR)
  result = result.replace(/<vocab>([\s\S]*?)<\/vocab>/gi, (_, content) => {
    const terms = content.split(',').map((t: string) => t.trim()).filter(Boolean);
    metadata.vocabulary.push(...terms);
    return '';
  });

  // Extract summary
  result = result.replace(/<summary>([\s\S]*?)<\/summary>/gi, (_, content) => {
    metadata.summary = content.trim().replace(/\s+/g, ' ');
    return '';
  });

  // Extract keywords
  result = result.replace(/<keywords>([\s\S]*?)<\/keywords>/gi, (_, content) => {
    const terms = content.split(',').map((t: string) => t.trim()).filter(Boolean);
    metadata.keywords.push(...terms);
    return '';
  });

  // Extract free-text vocabulary sections (AI sometimes generates these at the end of translations)
  // Pattern: "**Vocabulary used in this passage:**" or "**Key terms:**" followed by term definitions
  // Strip the heading and extract terms to metadata panel
  result = result.replace(/\n*\*{0,2}(?:Vocabulary(?:\s+used)?(?:\s+in\s+this\s+passage)?|Key\s+(?:vocabulary|terms|words))(?:\s+(?:used\s+)?(?:in|on|from)\s+this\s+page)?:?\*{0,2}\s*\n([\s\S]*?)(?=\n<summary>|\n<keywords>|\n<image-desc>|$)/gi, (_, content) => {
    // Extract term names from <term>word</term> tags in the vocabulary list
    const termMatches = content.match(/<term>(.*?)<\/term>/gi);
    if (termMatches) {
      const terms = termMatches.map((m: string) => m.replace(/<\/?term>/gi, '').trim()).filter(Boolean);
      metadata.vocabulary.push(...terms);
    }
    return '';
  });

  // Extract headers (running headers) - hidden from display
  result = result.replace(/<header>([\s\S]*?)<\/header>/gi, () => '');

  // Strip <detected-images> blocks (JSON bounding box data — not for display)
  result = result.replace(/<detected-images>[\s\S]*?<\/detected-images>/gi, '');

  // Strip <columns>N</columns> metadata tag (already extracted at save time into page.columns)
  result = result.replace(/<columns>\d+<\/columns>/gi, '');

  // === Bracket syntax (legacy, for backward compatibility) ===
  // Extract language (hidden from reader) - supports multiline
  result = result.replace(/\[\[language:\s*([\s\S]*?)\]\]/gi, (_, lang) => {
    if (!metadata.language) metadata.language = lang.trim();
    return '';
  });

  // Extract page numbers - supports multiline
  result = result.replace(/\[\[page\s*number:\s*([\s\S]*?)\]\]/gi, (_, num) => {
    if (!metadata.pageNumber) metadata.pageNumber = num.trim();
    return '';
  });

  // Extract folio references
  result = result.replace(/\[\[folio:\s*(.*?)\]\]/gi, (_, folio) => {
    if (!metadata.folio) metadata.folio = folio.trim();
    return '';
  });

  // Extract warning (OCR quality issues)
  result = result.replace(/\[\[warning:\s*(.*?)\]\]/gi, (_, warning) => {
    if (!metadata.warning) metadata.warning = warning.trim();
    return '';
  });

  // Extract signature marks (printer's signatures like A2, B1, etc.)
  result = result.replace(/\[\[signature:\s*(.*?)\]\]/gi, (_, sig) => {
    if (!metadata.signature) metadata.signature = sig.trim();
    return '';
  });

  // Extract meta notes (page descriptions, image quality, etc.)
  result = result.replace(/\[\[meta:\s*(.*?)\]\]/gi, (_, content) => {
    metadata.meta.push(content.trim());
    return '';
  });

  // Extract abbreviation expansions
  result = result.replace(/\[\[abbrev:\s*(.*?)\]\]/gi, (_, content) => {
    metadata.abbreviations.push(content.trim());
    return '';
  });

  // Extract vocabulary (key terms from OCR)
  result = result.replace(/\[\[vocabulary:\s*(.*?)\]\]/gi, (_, content) => {
    const terms = content.split(',').map((t: string) => t.trim()).filter(Boolean);
    metadata.vocabulary.push(...terms);
    return '';
  });

  // Extract summary (page summary from translation) - handles multiline
  result = result.replace(/\[\[summary:\s*([\s\S]*?)\]\]/gi, (_, content) => {
    if (!metadata.summary) metadata.summary = content.trim().replace(/\s+/g, ' ');
    return '';
  });

  // Also catch plain "Summary:" lines without brackets (legacy/non-compliant output)
  result = result.replace(/^Summary:\s*(.+?)(?=\n\n|\n\[\[|$)/gim, (_, content) => {
    if (!metadata.summary) {
      metadata.summary = content.trim().replace(/\s+/g, ' ');
    }
    return '';
  });

  // Extract keywords (English terms for indexing)
  result = result.replace(/\[\[keywords:\s*(.*?)\]\]/gi, (_, content) => {
    const terms = content.split(',').map((t: string) => t.trim()).filter(Boolean);
    metadata.keywords.push(...terms);
    return '';
  });

  // Extract headers (running headers) - hidden from display
  result = result.replace(/\[\[header:\s*(.*?)\]\]/gi, () => '');

  // Catch-all: remove any remaining bracket metadata tags
  result = result.replace(/\[\[(?:markup|language|page\s*number|page\s*type|folio|signature|warning|meta|abbrev|vocabulary|summary|keywords|header):\s*[\s\S]*?\]\]/gi, '');

  // Clean up extra whitespace from removed metadata
  result = result.replace(/^\s*\n/gm, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return { cleanText: result, metadata };
}

// Pre-process bracket note tags to XML tags before ReactMarkdown sees them
// Converts [[tag: content]] to <tag>content</tag> which rehype-raw handles
function preprocessBracketTags(text: string, showNotes: boolean): string {
  let result = text;

  // Always remove image descriptions (only shown in edit mode)
  result = result.replace(/\[\[image:\s*([\s\S]*?)\]\]/gi, '');

  if (!showNotes) {
    // Remove editorial notes when hidden, but keep terms
    result = result
      .replace(/\[\[(notes?):\s*[\s\S]*?\]\]/gi, '')
      .replace(/\[\[margin:\s*[\s\S]*?\]\]/gi, '')
      .replace(/\[\[gloss:\s*[\s\S]*?\]\]/gi, '')
      .replace(/\[\[insert:\s*[\s\S]*?\]\]/gi, '')
      .replace(/\[\[unclear:\s*[\s\S]*?\]\]/gi, '');
  } else {
    // Convert bracket tags to XML tags (handlers already exist for these)
    result = result.replace(/\[\[(notes?):\s*([\s\S]*?)\]\]/gi, '<note>$2</note>');
    result = result.replace(/\[\[margin:\s*([\s\S]*?)\]\]/gi, '<margin>$1</margin>');
    result = result.replace(/\[\[gloss:\s*([\s\S]*?)\]\]/gi, '<gloss>$1</gloss>');
    result = result.replace(/\[\[insert:\s*([\s\S]*?)\]\]/gi, '<insert>$1</insert>');
    result = result.replace(/\[\[unclear:\s*([\s\S]*?)\]\]/gi, '<unclear>$1</unclear>');
  }

  // Terms always shown
  result = result.replace(/\[\[term:\s*([\s\S]*?)\]\]/gi, '<term>$1</term>');

  return result;
}

// Convert markdown bold/italic to HTML tags.
// Used inside HTML block elements (divs, headings) where the markdown parser won't process inline syntax.
function inlineMarkdownToHtml(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
}

// Convert LaTeX-style superscript notation to HTML <sup> tags
// The OCR model produces $^{19}$ (verse numbers) and $^h$ (marginal note markers)
function preprocessLatexSuperscripts(text: string): string {
  return text
    .replace(/\$\^{([^}]*)}\$/g, '<sup>$1</sup>')    // $^{19}$ → <sup>19</sup>
    .replace(/\$\^([a-zA-Z0-9])\$/g, '<sup>$1</sup>') // $^h$ → <sup>h</sup>
    .replace(/\$\^{([^}]*)}/g, '<sup>$1</sup>')        // $^{19} (no closing $) → <sup>19</sup>
    .replace(/\$\\textbf{([^}]*)}\$/g, '<strong>$1</strong>') // $\textbf{...}$ → <strong>...</strong>
    .replace(/\$\\textit{([^}]*)}\$/g, '<em>$1</em>');  // $\textit{...}$ → <em>...</em>
}

// Convert markdown bold/italic inside XML annotation tags to HTML
// CommonMark treats content inside HTML block elements as raw — *italic* won't render
function preprocessAnnotationInlineMarkdown(text: string): string {
  return text.replace(
    /<(margin|note|gloss|insert|unclear)>([\s\S]*?)<\/\1>/gi,
    (_, tag, content) => `<${tag}>${inlineMarkdownToHtml(content)}</${tag}>`
  );
}

// Pre-process centering syntax (doesn't break tables)
function preprocessCentering(text: string): string {
  let result = text;

  // Handle centered headings: ->## text<- → <h2 class="text-center">text</h2>
  result = result.replace(/->\s*(#{1,6})\s*([\s\S]*?)\s*<-/g, (_, hashes, content) => {
    const level = hashes.length;
    const cleaned = inlineMarkdownToHtml(content.trim().replace(/\s*\n\s*/g, ' '));
    return `<h${level} class="text-center">${cleaned}</h${level}>`;
  });

  // Handle headings with centered content: ## ->text<- → <h2 class="text-center">text</h2>
  result = result.replace(/^(#{1,6})\s*->([\s\S]*?)<-\s*$/gm, (_, hashes, content) => {
    const level = hashes.length;
    const cleaned = inlineMarkdownToHtml(content.trim().replace(/\s*\n\s*/g, ' '));
    return `<h${level} class="text-center">${cleaned}</h${level}>`;
  });

  // Escape numbered paragraph markers (10. 11. etc) to prevent markdown list interpretation
  result = result.replace(/^(\d+)\. /gm, '$1\\. ');

  // Centered text: ->text<- or ::text:: (handles multiline)
  // Convert markdown bold/italic to HTML since content inside <div> blocks is not parsed as markdown.
  result = result.replace(/->([\s\S]*?)<-/g, (match, content) => {
    const cleaned = inlineMarkdownToHtml(content.trim().replace(/\s*\n\s*/g, '<br>'));
    return `<div class="text-center">${cleaned}</div>`;
  });
  result = result.replace(/::([\s\S]*?)::/g, (_, content) => {
    const cleaned = inlineMarkdownToHtml(content.trim().replace(/\s*\n\s*/g, '<br>'));
    return `<div class="text-center">${cleaned}</div>`;
  });

  return result;
}

// Process note tags in text string, returning React elements
// Terms are ALWAYS shown (vocabulary). Images are NEVER shown in read mode.
function processNoteTags(text: string, showNotes: boolean): ReactNode[] {
  // Always remove image descriptions in read mode (only shown in edit mode)
  let processed = text.replace(/\[\[image:\s*[\s\S]*?\]\]/gi, '');

  if (!showNotes) {
    // Remove editorial note tags when hidden, but KEEP terms
    processed = processed
      .replace(/\[\[(notes?):\s*[\s\S]*?\]\]/gi, '')
      .replace(/\[\[margin:\s*[\s\S]*?\]\]/gi, '')
      .replace(/\[\[gloss:\s*[\s\S]*?\]\]/gi, '')
      .replace(/\[\[insert:\s*[\s\S]*?\]\]/gi, '')
      .replace(/\[\[unclear:\s*[\s\S]*?\]\]/gi, '');
    // Process remaining text to render terms
    return processNoteTags(processed, true);
  }

  // Pattern to match all note types (image is handled separately above)
  const notePattern = /\[\[(notes?|term|margin|gloss|insert|unclear):\s*([\s\S]*?)\]\]/gi;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = notePattern.exec(processed)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(processed.slice(lastIndex, match.index));
    }

    const tagType = match[1].toLowerCase();
    const content = match[2].trim();

    // Create styled span based on tag type
    switch (tagType) {
      case 'note':
      case 'notes':
        parts.push(
          <span key={key++} className="bg-accent-gold/15 text-accent-gold-dark px-1.5 py-0.5 rounded mx-0.5" title="Editorial note">
            {content}
          </span>
        );
        break;
      case 'term':
        const termParts = content.split(/→|->/).map((s: string) => s.trim());
        parts.push(
          <span key={key++} className={`${NOTE_TAG_STYLES.term} px-1.5 py-0.5 rounded mx-0.5`} title="Technical term">
            <em>{termParts[0]}</em>{termParts.length > 1 ? ` (${termParts[1]})` : ''}
          </span>
        );
        break;
      case 'margin':
        parts.push(
          <span key={key++} className={`${NOTE_TAG_STYLES.margin} px-1.5 py-0.5 rounded mx-0.5`} title="Marginal note in original">
            {content}
          </span>
        );
        break;
      case 'gloss':
        parts.push(
          <span key={key++} className={`${NOTE_TAG_STYLES.gloss} px-1.5 py-0.5 rounded mx-0.5`} title="Gloss/annotation in original">
            {content}
          </span>
        );
        break;
      case 'insert':
        parts.push(
          <span key={key++} className={`${NOTE_TAG_STYLES.insert} px-1.5 py-0.5 rounded mx-0.5`} title="Later insertion">
            {content}
          </span>
        );
        break;
      case 'unclear':
        parts.push(
          <span key={key++} className="bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded mx-0.5 italic" title="Unclear in original">
            {content}?
          </span>
        );
        break;
      // Note: 'image' is stripped out before this function runs - only shown in edit mode
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < processed.length) {
    parts.push(processed.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [processed];
}

// Recursively process children to find and style note tags in text
function processChildren(children: ReactNode, showNotes: boolean): ReactNode {
  if (typeof children === 'string') {
    const processed = processNoteTags(children, showNotes);
    return processed.length === 1 && typeof processed[0] === 'string'
      ? processed[0]
      : <>{processed}</>;
  }

  if (Array.isArray(children)) {
    return children.map((child, i) => (
      <React.Fragment key={i}>{processChildren(child, showNotes)}</React.Fragment>
    ));
  }

  if (React.isValidElement(children)) {
    const element = children as React.ReactElement<{ children?: ReactNode }>;
    if (element.props.children) {
      return React.cloneElement(element, {
        ...element.props,
        children: processChildren(element.props.children, showNotes)
      });
    }
  }

  return children;
}

// Metadata panel component (collapsible)
function MetadataPanel({ metadata }: { metadata: ExtractedMetadata }) {
  const [isOpen, setIsOpen] = useState(false);

  const hasMetadata = metadata.language || metadata.pageType || metadata.pageNumber || metadata.folio ||
    metadata.signature || metadata.warning || metadata.meta.length > 0 || metadata.abbreviations.length > 0 ||
    metadata.vocabulary.length > 0 || metadata.summary || metadata.keywords.length > 0;

  if (!hasMetadata) return null;

  return (
    <div className="mb-4 border border-stone-200 rounded-lg overflow-hidden bg-stone-50/50">
      {/* Warning displayed prominently if present */}
      {metadata.warning && (
        <div className="px-3 py-2 bg-red-50 border-b border-red-200 text-sm text-red-800 flex items-start gap-2">
          <span className="text-status-error font-bold">⚠</span>
          <span><span className="font-medium">Quality Warning: </span>{metadata.warning}</span>
        </div>
      )}

      {/* Summary displayed prominently if present */}
      {metadata.summary && (
        <div className="px-3 py-2 bg-accent-gold/8 border-b border-accent-gold/20 text-sm text-accent-gold-dark">
          <span className="font-medium">Summary: </span>
          {metadata.summary}
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-medium text-stone-500 hover:bg-stone-100 transition-colors"
      >
        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Info className="w-3 h-3" />
        <span>Page Info</span>
        {metadata.language && (
          <span className="ml-auto px-1.5 py-0.5 bg-stone-200 rounded text-stone-600">
            {metadata.language}
          </span>
        )}
        {metadata.pageType && metadata.pageType !== 'text' && (
          <span className={`px-1.5 py-0.5 rounded ${NOTE_TAG_STYLES.pageType}`}>
            {metadata.pageType}
          </span>
        )}
        {(metadata.pageNumber || metadata.folio) && (
          <span className="px-1.5 py-0.5 bg-stone-200 rounded text-stone-600">
            {metadata.folio ? `f. ${metadata.folio}` : `p. ${metadata.pageNumber}`}
          </span>
        )}
        {metadata.signature && (
          <span className="px-1.5 py-0.5 bg-stone-200 rounded text-stone-600">
            sig. {metadata.signature}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="px-3 py-2 border-t border-stone-200 text-xs text-stone-600 space-y-2">
          {metadata.keywords.length > 0 && (
            <div>
              <span className="font-medium text-stone-500">Keywords: </span>
              <span className={NOTE_TAG_STYLES.keywords}>
                {metadata.keywords.join(', ')}
              </span>
            </div>
          )}
          {metadata.vocabulary.length > 0 && (
            <div>
              <span className="font-medium text-stone-500">Vocabulary: </span>
              <span className={`font-mono ${NOTE_TAG_STYLES.keywords}`}>
                {metadata.vocabulary.join(', ')}
              </span>
            </div>
          )}
          {metadata.meta.length > 0 && (
            <div>
              <span className="font-medium text-stone-500">Notes: </span>
              {metadata.meta.join(' • ')}
            </div>
          )}
          {metadata.abbreviations.length > 0 && (
            <div>
              <span className="font-medium text-stone-500">Abbreviations: </span>
              <span className="font-mono text-stone-700">
                {metadata.abbreviations.join(', ')}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Wrapper component that processes note tags in children
function NoteProcessor({ children, showNotes }: { children: ReactNode; showNotes: boolean }) {
  return <>{processChildren(children, showNotes)}</>;
}

// Shared markdown renderer used for both single-column and multi-column layouts
function ColumnMarkdown({ text, showNotes, withNotes }: {
  text: string;
  showNotes: boolean;
  withNotes: (Component: React.ComponentType<{ children?: ReactNode }>) => React.ComponentType<{ children?: ReactNode }>;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      rehypePlugins={[rehypeRaw]}
      allowedElements={[
        'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
        'em', 'strong', 'del', 'hr', 'br', 'a', 'img',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'span', 'div', 'sup',
        // XML annotation elements (new syntax)
        'note', 'margin', 'gloss', 'insert', 'unclear', 'term', 'image-desc'
      ]}
      unwrapDisallowed={true}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      components={{
        p: withNotes(({ children }: { children?: ReactNode }) => <p className="mb-4 last:mb-0 leading-relaxed text-[var(--text-secondary)]">{children}</p>),
        strong: ({ children }: { children?: ReactNode }) => <strong className="font-bold text-[var(--text-primary)]">{children}</strong>,
        em: ({ children }: { children?: ReactNode }) => <em className="italic">{children}</em>,
        img: ({ src, alt }: any) => (
          <img src={src} alt={alt || ''} className="max-w-full h-auto rounded my-4" />
        ),
        h1: withNotes(({ children }: any) => (
          <h1 className="text-2xl font-serif font-bold mt-6 mb-3 text-[var(--text-primary)]">{children}</h1>
        )),
        h2: withNotes(({ children }: any) => (
          <h2 className="text-xl font-serif font-bold mt-5 mb-2 text-[var(--text-primary)]">{children}</h2>
        )),
        h3: withNotes(({ children }: any) => (
          <h3 className="text-lg font-serif font-semibold mt-4 mb-2 text-[var(--text-primary)]">{children}</h3>
        )),
        h4: withNotes(({ children }: any) => (
          <h4 className="text-base font-serif font-semibold mt-3 mb-1 text-[var(--text-primary)]">{children}</h4>
        )),
        ul: ({ children }: any) => <ul className="list-disc ml-5 my-3 space-y-1">{children}</ul>,
        ol: ({ children, start }: any) => <ol className="list-decimal ml-5 my-3 space-y-1" start={start}>{children}</ol>,
        li: withNotes(({ children }: any) => <li className="leading-relaxed">{children}</li>),
        blockquote: withNotes(({ children }: any) => (
          <blockquote className={`border-l-3 ${NOTE_TAG_STYLES.blockquote} pl-4 my-4 italic text-stone-600 py-2 pr-2 rounded-r`}>
            {children}
          </blockquote>
        )),
        code: ({ children }: any) => <span>{children}</span>,
        pre: ({ children }: any) => <span>{children}</span>,
        hr: () => <hr className="my-6 border-stone-200" />,
        a: ({ href, children }: any) => (
          <a href={href} className="text-accent-rust underline hover:text-accent-gold-dark" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        table: ({ children }: any) => (
          <div className="overflow-x-auto my-4">
            <table className="min-w-full border-collapse border border-stone-200">{children}</table>
          </div>
        ),
        thead: ({ children }: any) => <thead className="bg-stone-100">{children}</thead>,
        tbody: ({ children }: any) => <tbody>{children}</tbody>,
        tr: ({ children }: any) => <tr className="border-b border-stone-200">{children}</tr>,
        th: withNotes(({ children }: any) => (
          <th className="px-3 py-2 text-left text-sm font-semibold text-stone-700 border border-stone-200">
            {children}
          </th>
        )),
        td: withNotes(({ children }: any) => (
          <td className="px-3 py-2 text-sm text-stone-600 border border-stone-200">{children}</td>
        )),
        div: ({ children, className: divClassName }: any) => {
          if (divClassName === 'text-center') {
            return <div className="text-center my-4">{children}</div>;
          }
          if (divClassName === 'image-description') {
            return (
              <div className="my-4 p-4 bg-accent-gold/8 border border-accent-gold/20 rounded-lg text-stone-600 italic">
                <span className="text-accent-rust font-medium not-italic">[Image: </span>
                {children}
                <span className="text-accent-rust font-medium not-italic">]</span>
              </div>
            );
          }
          return <div>{children}</div>;
        },
        span: ({ children, className: spanClassName }: any) => (
          <span className={spanClassName}>{children}</span>
        ),
        // XML annotation elements (TEI-aligned, new syntax)
        note: ({ children }: any) => showNotes ? (
          <span className="bg-accent-gold/15 text-accent-gold-dark px-1.5 py-0.5 rounded mx-0.5" title="Editorial note">
            {children}
          </span>
        ) : null,
        margin: ({ children }: any) => showNotes ? (
          <span className={`${NOTE_TAG_STYLES.margin} px-1.5 py-0.5 rounded mx-0.5`} title="Marginal note in original">
            {children}
          </span>
        ) : null,
        gloss: ({ children }: any) => showNotes ? (
          <span className={`${NOTE_TAG_STYLES.gloss} px-1.5 py-0.5 rounded mx-0.5`} title="Gloss/annotation in original">
            {children}
          </span>
        ) : null,
        insert: ({ children }: any) => showNotes ? (
          <span className={`${NOTE_TAG_STYLES.insert} px-1.5 py-0.5 rounded mx-0.5`} title="Later insertion">
            {children}
          </span>
        ) : null,
        unclear: ({ children }: any) => showNotes ? (
          <span className="bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded mx-0.5 italic" title="Unclear in original">
            {children}?
          </span>
        ) : null,
        term: ({ children }: any) => (
          <span className={`${NOTE_TAG_STYLES.term} px-1.5 py-0.5 rounded mx-0.5`} title="Technical term">
            <em>{children}</em>
          </span>
        ),
        'image-desc': ({ children }: any) => showNotes ? (
          <span className="bg-accent-gold/15 text-accent-gold-dark px-1.5 py-0.5 rounded mx-0.5 italic" title="Image description">
            {children}
          </span>
        ) : null,
      } as any}
    >
      {text}
    </ReactMarkdown>
  );
}

export default function NotesRenderer({ text, className = '', showMetadata = true, showNotes = true, language, columns, pageType }: NotesRendererProps) {
  const { cleanText, metadata } = useMemo(() => extractMetadata(text), [text]);

  // For non-text page types (frontispiece, illustration, etc.), all content is AI description
  const isDescriptionOnly = pageType ? DESCRIPTION_ONLY_PAGE_TYPES.has(pageType) : false;

  const withBracketTags = useMemo(() => preprocessBracketTags(cleanText, showNotes), [cleanText, showNotes]);
  const withLatex = useMemo(() => preprocessLatexSuperscripts(withBracketTags), [withBracketTags]);
  const withAnnotationMd = useMemo(() => preprocessAnnotationInlineMarkdown(withLatex), [withLatex]);
  const withCentering = useMemo(() => preprocessCentering(withAnnotationMd), [withAnnotationMd]);
  // Ensure blank lines around block-level HTML tags so markdown parser resumes inline processing.
  // Without this, text like "</div>\n**bold**" is treated as one HTML block and ** renders literally.
  // CommonMark spec: HTML blocks (type 6) end only at a blank line.
  const processedText = useMemo(() => {
    let t = withCentering;
    // After closing block-level tags: ensure blank line follows
    t = t.replace(/<\/(div|h[1-6]|margin|blockquote|table|ul|ol|li|p|pre|hr)>\s*\n(?!\n)/gi, '</$1>\n\n');
    // Before opening block-level tags: ensure blank line precedes (unless at start of text)
    t = t.replace(/([^\n])\n(<(?:div|h[1-6])\s)/gi, '$1\n\n$2');
    return t;
  }, [withCentering]);

  // Split on <column-break/> for multi-column rendering, with paragraph-midpoint fallback
  const columnSegments = useMemo(() => {
    // Primary: explicit <column-break/> marker
    const segments = processedText.split(/<column-break\s*\/?>/i).map(s => s.trim()).filter(Boolean);
    if (segments.length > 1) return segments;

    // Fallback: if page has columns metadata but no marker, split at paragraph midpoint
    if (columns && columns > 1) {
      const paragraphs = processedText.split(/\n\n+/);
      if (paragraphs.length >= 4) {
        const mid = Math.ceil(paragraphs.length / 2);
        return [
          paragraphs.slice(0, mid).join('\n\n'),
          paragraphs.slice(mid).join('\n\n'),
        ];
      }
    }

    return null;
  }, [processedText, columns]);

  // Determine text direction from language prop or extracted metadata
  const effectiveLanguage = language || metadata.language;
  const isRTL = isRTLLanguage(effectiveLanguage);
  const langCode = getLanguageCode(effectiveLanguage);

  if (!text) {
    return (
      <div className={`text-[var(--text-muted)] italic ${className}`}>
        No content yet...
      </div>
    );
  }

  // For non-text pages, all content is AI description — hide when notes are off
  if (isDescriptionOnly && !showNotes) {
    return (
      <div className={`text-[var(--text-muted)] italic text-sm ${className}`}>
        {(metadata.pageType || pageType || 'Image').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} page — toggle Notes to see description
      </div>
    );
  }

  // Create wrapper component for processing notes in text
  const withNotes = (Component: React.ComponentType<{ children?: ReactNode }>) => {
    return function NoteWrapper({ children, ...props }: { children?: ReactNode }) {
      return (
        <Component {...props}>
          <NoteProcessor showNotes={showNotes}>{children}</NoteProcessor>
        </Component>
      );
    };
  };

  // RTL-specific classes
  const rtlClasses = isRTL ? 'rtl' : '';
  const fontClass = langCode === 'ar' ? 'font-arabic' : langCode === 'he' || langCode === 'arc' ? 'font-hebrew' : '';

  return (
    <div
      className={`prose-manuscript ${rtlClasses} ${fontClass} ${className}`}
      dir={isRTL ? 'rtl' : 'ltr'}
      lang={langCode}
    >
      {/* Collapsible metadata panel - hidden when showMetadata is false */}
      {showMetadata ? <MetadataPanel metadata={metadata} /> : null}

      {/* Main text rendered as markdown */}
      {columnSegments ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0 border-stone-200 md:[&>*:first-child]:border-r md:[&>*:first-child]:pr-6">
          {columnSegments.map((segment, i) => (
            <div key={i}>
              <ColumnMarkdown text={segment} showNotes={showNotes} withNotes={withNotes} />
            </div>
          ))}
        </div>
      ) : (
        <ColumnMarkdown text={processedText} showNotes={showNotes} withNotes={withNotes} />
      )}
    </div>
  );
}
