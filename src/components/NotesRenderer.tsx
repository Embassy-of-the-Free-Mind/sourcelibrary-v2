'use client';

import React, { useMemo, useState, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';

interface NotesRendererProps {
  text: string;
  className?: string;
  showMetadata?: boolean; // Default true - show metadata section
  showNotes?: boolean; // Default true - show inline notes (margin, gloss, etc.)
}

interface ExtractedMetadata {
  language?: string;
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
  result = result.replace(/<lang>([\s\S]*?)<\/lang>/gi, (_, lang) => {
    metadata.language = lang.trim();
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

  // Extract headers (running headers) - hidden from display
  result = result.replace(/<header>([\s\S]*?)<\/header>/gi, () => '');

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
  result = result.replace(/\[\[(?:markup|language|page\s*number|folio|signature|warning|meta|abbrev|vocabulary|summary|keywords|header):\s*[\s\S]*?\]\]/gi, '');

  // Clean up extra whitespace from removed metadata
  result = result.replace(/^\s*\n/gm, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return { cleanText: result, metadata };
}

// Pre-process ONLY centering syntax (doesn't break tables)
// Note tags are handled separately after markdown parsing
function preprocessCentering(text: string): string {
  let result = text;

  // Handle centered headings: ->## text<- → <h2 class="text-center">text</h2>
  result = result.replace(/->\s*(#{1,6})\s*([\s\S]*?)\s*<-/g, (_, hashes, content) => {
    const level = hashes.length;
    const cleaned = content.trim().replace(/\s*\n\s*/g, ' ');
    return `<h${level} class="text-center">${cleaned}</h${level}>`;
  });

  // Handle headings with centered content: ## ->text<- → <h2 class="text-center">text</h2>
  result = result.replace(/^(#{1,6})\s*->([\s\S]*?)<-\s*$/gm, (_, hashes, content) => {
    const level = hashes.length;
    const cleaned = content.trim().replace(/\s*\n\s*/g, ' ');
    return `<h${level} class="text-center">${cleaned}</h${level}>`;
  });

  // Escape numbered paragraph markers (10. 11. etc) to prevent markdown list interpretation
  result = result.replace(/^(\d+)\. /gm, '$1\\. ');

  // Centered text: ->text<- or ::text:: (handles multiline)
  // Only process if NOT inside a table (no | on same line)
  result = result.replace(/->([\s\S]*?)<-/g, (match, content) => {
    const cleaned = content.trim().replace(/\s*\n\s*/g, '<br>');
    return `<div class="text-center">${cleaned}</div>`;
  });
  result = result.replace(/::([\s\S]*?)::/g, (_, content) => {
    const cleaned = content.trim().replace(/\s*\n\s*/g, '<br>');
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
          <span key={key++} className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Editorial note">
            {content}
          </span>
        );
        break;
      case 'term':
        const termParts = content.split(/→|->/).map((s: string) => s.trim());
        parts.push(
          <span key={key++} className="bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Technical term">
            <em>{termParts[0]}</em>{termParts.length > 1 ? ` (${termParts[1]})` : ''}
          </span>
        );
        break;
      case 'margin':
        parts.push(
          <span key={key++} className="bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded text-sm mx-0.5 border-l-2 border-teal-400" title="Marginal note in original">
            {content}
          </span>
        );
        break;
      case 'gloss':
        parts.push(
          <span key={key++} className="bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Gloss/annotation in original">
            {content}
          </span>
        );
        break;
      case 'insert':
        parts.push(
          <span key={key++} className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Later insertion">
            {content}
          </span>
        );
        break;
      case 'unclear':
        parts.push(
          <span key={key++} className="bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded text-sm mx-0.5 italic" title="Unclear in original">
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

  const hasMetadata = metadata.language || metadata.pageNumber || metadata.folio ||
    metadata.signature || metadata.warning || metadata.meta.length > 0 || metadata.abbreviations.length > 0 ||
    metadata.vocabulary.length > 0 || metadata.summary || metadata.keywords.length > 0;

  if (!hasMetadata) return null;

  return (
    <div className="mb-4 border border-stone-200 rounded-lg overflow-hidden bg-stone-50/50">
      {/* Warning displayed prominently if present */}
      {metadata.warning && (
        <div className="px-3 py-2 bg-red-50 border-b border-red-200 text-sm text-red-800 flex items-start gap-2">
          <span className="text-red-500 font-bold">⚠</span>
          <span><span className="font-medium">Quality Warning: </span>{metadata.warning}</span>
        </div>
      )}

      {/* Summary displayed prominently if present */}
      {metadata.summary && (
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-900">
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
              <span className="text-indigo-700">
                {metadata.keywords.join(', ')}
              </span>
            </div>
          )}
          {metadata.vocabulary.length > 0 && (
            <div>
              <span className="font-medium text-stone-500">Vocabulary: </span>
              <span className="font-mono text-purple-700">
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

export default function NotesRenderer({ text, className = '', showMetadata = true, showNotes = true }: NotesRendererProps) {
  const { cleanText, metadata } = useMemo(() => extractMetadata(text), [text]);
  const processedText = useMemo(() => preprocessCentering(cleanText), [cleanText]);

  if (!text) {
    return (
      <div className={`text-[var(--text-muted)] italic ${className}`}>
        No content yet...
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

  return (
    <div className={`prose-manuscript ${className}`}>
      {/* Collapsible metadata panel - hidden when showMetadata is false */}
      {showMetadata ? <MetadataPanel metadata={metadata} /> : null}

      {/* Main text rendered as markdown */}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeRaw]}
        allowedElements={[
          'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
          'em', 'strong', 'del', 'hr', 'br', 'a', 'img',
          'table', 'thead', 'tbody', 'tr', 'th', 'td',
          'span', 'div',
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
            <blockquote className="border-l-3 border-amber-300 pl-4 my-4 italic text-stone-600 bg-amber-50/30 py-2 pr-2 rounded-r">
              {children}
            </blockquote>
          )),
          code: ({ children }: any) => <span>{children}</span>,
          pre: ({ children }: any) => <span>{children}</span>,
          hr: () => <hr className="my-6 border-stone-200" />,
          a: ({ href, children }: any) => (
            <a href={href} className="text-amber-700 underline hover:text-amber-800" target="_blank" rel="noopener noreferrer">
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
                <div className="my-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-stone-600 italic">
                  <span className="text-amber-700 font-medium not-italic">[Image: </span>
                  {children}
                  <span className="text-amber-700 font-medium not-italic">]</span>
                </div>
              );
            }
            return <div>{children}</div>;
          },
          span: ({ children, className: spanClassName }: any) => {
            // These are from rehypeRaw processing our pre-processed HTML
            if (spanClassName === 'inline-note') {
              return (
                <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Editorial note">
                  {children}
                </span>
              );
            }
            return <span>{children}</span>;
          },
          // XML annotation elements (TEI-aligned, new syntax)
          // These are handled natively by rehype-raw - no custom parsing needed!
          note: ({ children }: any) => showNotes ? (
            <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Editorial note">
              {children}
            </span>
          ) : null,
          margin: ({ children }: any) => showNotes ? (
            <span className="bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded text-sm mx-0.5 border-l-2 border-teal-400" title="Marginal note in original">
              {children}
            </span>
          ) : null,
          gloss: ({ children }: any) => showNotes ? (
            <span className="bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Gloss/annotation in original">
              {children}
            </span>
          ) : null,
          insert: ({ children }: any) => showNotes ? (
            <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Later insertion">
              {children}
            </span>
          ) : null,
          unclear: ({ children }: any) => showNotes ? (
            <span className="bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded text-sm mx-0.5 italic" title="Unclear in original">
              {children}?
            </span>
          ) : null,
          // Terms are ALWAYS shown (they're vocabulary, not editorial notes)
          term: ({ children }: any) => (
            <span className="bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Technical term">
              <em>{children}</em>
            </span>
          ),
          // Image descriptions are NEVER shown in read mode (only in edit mode)
          'image-desc': () => null,
        } as any}
      >
        {processedText}
      </ReactMarkdown>
    </div>
  );
}
