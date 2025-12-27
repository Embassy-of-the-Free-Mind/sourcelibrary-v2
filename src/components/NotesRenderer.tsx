'use client';

import { useMemo, useState } from 'react';
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

  // Extract language (hidden from reader)
  result = result.replace(/\[\[language:\s*(.*?)\]\]/gi, (match, lang) => {
    metadata.language = lang.trim();
    return '';
  });

  // Extract page numbers
  result = result.replace(/\[\[page\s*number:\s*(.*?)\]\]/gi, (match, num) => {
    metadata.pageNumber = num.trim();
    return '';
  });

  // Extract folio references
  result = result.replace(/\[\[folio:\s*(.*?)\]\]/gi, (match, folio) => {
    metadata.folio = folio.trim();
    return '';
  });

  // Extract warning (OCR quality issues)
  result = result.replace(/\[\[warning:\s*(.*?)\]\]/gi, (match, warning) => {
    metadata.warning = warning.trim();
    return '';
  });

  // Extract signature marks (printer's signatures like A2, B1, etc.)
  result = result.replace(/\[\[signature:\s*(.*?)\]\]/gi, (match, sig) => {
    metadata.signature = sig.trim();
    return '';
  });

  // Extract meta notes (page descriptions, image quality, etc.)
  result = result.replace(/\[\[meta:\s*(.*?)\]\]/gi, (match, content) => {
    metadata.meta.push(content.trim());
    return '';
  });

  // Extract abbreviation expansions
  result = result.replace(/\[\[abbrev:\s*(.*?)\]\]/gi, (match, content) => {
    metadata.abbreviations.push(content.trim());
    return '';
  });

  // Extract vocabulary (key terms from OCR)
  result = result.replace(/\[\[vocabulary:\s*(.*?)\]\]/gi, (match, content) => {
    const terms = content.split(',').map((t: string) => t.trim()).filter(Boolean);
    metadata.vocabulary.push(...terms);
    return '';
  });

  // Extract summary (page summary from translation) - handles multiline
  result = result.replace(/\[\[summary:\s*([\s\S]*?)\]\]/gi, (match, content) => {
    metadata.summary = content.trim().replace(/\s+/g, ' '); // Normalize whitespace
    return '';
  });

  // Also catch plain "Summary:" lines without brackets (legacy/non-compliant output)
  result = result.replace(/^Summary:\s*(.+?)(?=\n\n|\n\[\[|$)/gim, (match, content) => {
    if (!metadata.summary) {
      metadata.summary = content.trim().replace(/\s+/g, ' ');
    }
    return '';
  });

  // Extract keywords (English terms for indexing)
  result = result.replace(/\[\[keywords:\s*(.*?)\]\]/gi, (match, content) => {
    const terms = content.split(',').map((t: string) => t.trim()).filter(Boolean);
    metadata.keywords.push(...terms);
    return '';
  });

  // Extract headers (running headers) - hidden from display
  result = result.replace(/\[\[header:\s*(.*?)\]\]/gi, () => '');

  // Catch-all: remove any remaining [[tag: ...]] patterns (handles multiline)
  // This ensures no metadata tags slip through to the reader
  result = result.replace(/\[\[(?:markup|language|page\s*number|folio|signature|warning|meta|abbrev|vocabulary|summary|keywords|header):\s*[\s\S]*?\]\]/gi, '');

  // Final aggressive cleanup: remove ANY remaining [[something: ...]] patterns
  // This catches any malformed or unexpected tags
  result = result.replace(/\[\[[a-z_-]+:\s*[\s\S]*?\]\]/gi, '');

  // Clean up extra whitespace from removed metadata
  result = result.replace(/^\s*\n/gm, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return { cleanText: result, metadata };
}

// Convert inline markup to styled HTML spans (or plain text if showNotes is false)
function processInlineMarkup(text: string, showNotes: boolean = true): string {
  let result = text;

  // Handle centered headings: ->## text<- → <h2 class="text-center">text</h2>
  // Must be done before generic centering to preserve heading semantics
  result = result.replace(/->\s*(#{1,6})\s*([\s\S]*?)\s*<-/g, (match, hashes, content) => {
    const level = hashes.length;
    const cleaned = content.trim().replace(/\s*\n\s*/g, ' ');
    return `<h${level} class="text-center">${cleaned}</h${level}>`;
  });

  // Handle headings with centered content: ## ->text<- → <h2 class="text-center">text</h2>
  result = result.replace(/^(#{1,6})\s*->([\s\S]*?)<-\s*$/gm, (match, hashes, content) => {
    const level = hashes.length;
    const cleaned = content.trim().replace(/\s*\n\s*/g, ' ');
    return `<h${level} class="text-center">${cleaned}</h${level}>`;
  });

  // Centered text: ->text<- or ::text:: (handles multiline)
  result = result.replace(/->([\s\S]*?)<-/g, (match, content) => {
    // Clean up whitespace and join lines
    const cleaned = content.trim().replace(/\s*\n\s*/g, '<br>');
    return `<div class="text-center">${cleaned}</div>`;
  });
  result = result.replace(/::([\s\S]*?)::/g, (match, content) => {
    const cleaned = content.trim().replace(/\s*\n\s*/g, '<br>');
    return `<div class="text-center">${cleaned}</div>`;
  });

  if (showNotes) {
    // Editorial notes (amber) - interpretive choices, context for reader
    // Use [\s\S]*? to match across newlines
    result = result.replace(/\[\[(notes?):\s*([\s\S]*?)\]\]/gi, (match, type, content) => {
      return `<span class="inline-note">${content.trim()}</span>`;
    });

    // Technical terms with optional gloss: [[term: word]] or [[term: word → meaning]]
    result = result.replace(/\[\[term:\s*([\s\S]*?)\]\]/gi, (match, content) => {
      const parts = content.split(/→|->/).map((s: string) => s.trim());
      if (parts.length > 1) {
        return `<span class="term-note"><em>${parts[0]}</em> (${parts[1]})</span>`;
      }
      return `<span class="term-note"><em>${parts[0]}</em></span>`;
    });

    // Marginalia - text in margins of original manuscript (teal)
    result = result.replace(/\[\[margin:\s*([\s\S]*?)\]\]/gi, (match, content) => {
      return `<span class="margin-note">${content.trim()}</span>`;
    });

    // Gloss - interlinear annotations in original (purple)
    result = result.replace(/\[\[gloss:\s*([\s\S]*?)\]\]/gi, (match, content) => {
      return `<span class="gloss-note">${content.trim()}</span>`;
    });

    // Insertion - later additions to the text (green)
    result = result.replace(/\[\[insert:\s*([\s\S]*?)\]\]/gi, (match, content) => {
      return `<span class="insert-note">${content.trim()}</span>`;
    });

    // Uncertain/illegible text (gray with ?)
    result = result.replace(/\[\[unclear:\s*([\s\S]*?)\]\]/gi, (match, content) => {
      return `<span class="unclear-text">${content.trim()}</span>`;
    });

    // Image descriptions (block display)
    result = result.replace(/\[\[image:\s*([\s\S]*?)\]\]/gi, (match, content) => {
      return `<div class="image-description">${content.trim()}</div>`;
    });
  } else {
    // When notes are hidden, completely remove all note content
    result = result.replace(/\[\[(notes?):\s*([\s\S]*?)\]\]/gi, '');
    result = result.replace(/\[\[term:\s*([\s\S]*?)\]\]/gi, '');
    result = result.replace(/\[\[margin:\s*([\s\S]*?)\]\]/gi, '');
    result = result.replace(/\[\[gloss:\s*([\s\S]*?)\]\]/gi, '');
    result = result.replace(/\[\[insert:\s*([\s\S]*?)\]\]/gi, '');
    result = result.replace(/\[\[unclear:\s*([\s\S]*?)\]\]/gi, '');
    result = result.replace(/\[\[image:\s*([\s\S]*?)\]\]/gi, '');
  }

  return result;
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

export default function NotesRenderer({ text, className = '', showMetadata = true, showNotes = true }: NotesRendererProps) {
  const { cleanText, metadata } = useMemo(() => extractMetadata(text), [text]);
  const processedText = useMemo(() => processInlineMarkup(cleanText, showNotes), [cleanText, showNotes]);

  if (!text) {
    return (
      <div className={`text-[var(--text-muted)] italic ${className}`}>
        No content yet...
      </div>
    );
  }

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
          'span', 'div'
        ]}
        unwrapDisallowed={true}
        components={{
          p: ({ children }) => <p className="mb-4 last:mb-0 leading-relaxed text-[var(--text-secondary)]">{children}</p>,
          strong: ({ children }) => <strong className="font-bold text-[var(--text-primary)]">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          img: ({ src, alt }) => (
            <img src={src} alt={alt || ''} className="max-w-full h-auto rounded my-4" />
          ),
          h1: ({ children }) => (
            <h1 className="text-2xl font-serif font-bold mt-6 mb-3 text-[var(--text-primary)]">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-serif font-bold mt-5 mb-2 text-[var(--text-primary)]">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-serif font-semibold mt-4 mb-2 text-[var(--text-primary)]">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-base font-serif font-semibold mt-3 mb-1 text-[var(--text-primary)]">{children}</h4>
          ),
          ul: ({ children }) => <ul className="list-disc ml-5 my-3 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal ml-5 my-3 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-amber-300 pl-4 my-4 italic text-stone-600 bg-amber-50/30 py-2 pr-2 rounded-r">
              {children}
            </blockquote>
          ),
          code: ({ children }) => <span>{children}</span>,
          pre: ({ children }) => <span>{children}</span>,
          hr: () => <hr className="my-6 border-stone-200" />,
          a: ({ href, children }) => (
            <a href={href} className="text-amber-700 underline hover:text-amber-800" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-4">
              <table className="min-w-full border-collapse border border-stone-200">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-stone-100">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-stone-200">{children}</tr>,
          th: ({ children }) => (
            <th className="px-3 py-2 text-left text-sm font-semibold text-stone-700 border border-stone-200">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-sm text-stone-600 border border-stone-200">{children}</td>
          ),
          div: ({ children, className }) => {
            if (className === 'text-center') {
              return <div className="text-center my-4">{children}</div>;
            }
            if (className === 'image-description') {
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
          span: ({ children, className }) => {
            // Editorial notes (amber)
            if (className === 'inline-note') {
              return (
                <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Editorial note">
                  {children}
                </span>
              );
            }
            // Technical terms (indigo)
            if (className === 'term-note') {
              return (
                <span className="bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Technical term">
                  {children}
                </span>
              );
            }
            // Marginalia (teal)
            if (className === 'margin-note') {
              return (
                <span className="bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded text-sm mx-0.5 border-l-2 border-teal-400" title="Marginal note in original">
                  {children}
                </span>
              );
            }
            // Gloss (purple)
            if (className === 'gloss-note') {
              return (
                <span className="bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Gloss/annotation in original">
                  {children}
                </span>
              );
            }
            // Insertions (green)
            if (className === 'insert-note') {
              return (
                <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Later insertion">
                  {children}
                </span>
              );
            }
            // Unclear text (gray)
            if (className === 'unclear-text') {
              return (
                <span className="bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded text-sm mx-0.5 italic" title="Unclear in original">
                  {children}?
                </span>
              );
            }
            return <span>{children}</span>;
          },
        }}
      >
        {processedText}
      </ReactMarkdown>
    </div>
  );
}
