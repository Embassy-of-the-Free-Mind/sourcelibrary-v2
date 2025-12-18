'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface NotesRendererProps {
  text: string;
  className?: string;
}

// Convert special markup to styled HTML spans
function processNotesForMarkdown(text: string): string {
  let result = text;

  // Centered text: ->text<- or ::text::
  result = result.replace(/->(.*?)<-/g, '<div class="text-center">$1</div>');
  result = result.replace(/::(.*?)::/g, '<div class="text-center">$1</div>');

  // AI/editorial notes (amber) - our analysis
  result = result.replace(/\[\[(notes?):\s*(.*?)\]\]/gi, (match, type, content) => {
    return `<span class="inline-note">${content.trim()}</span>`;
  });

  // Marginalia - text in margins of original manuscript (teal)
  result = result.replace(/\[\[margin:\s*(.*?)\]\]/gi, (match, content) => {
    return `<span class="margin-note">${content.trim()}</span>`;
  });

  // Gloss - interlinear annotations in original (purple)
  result = result.replace(/\[\[gloss:\s*(.*?)\]\]/gi, (match, content) => {
    return `<span class="gloss-note">${content.trim()}</span>`;
  });

  // Insertion - later additions to the text (green)
  result = result.replace(/\[\[insert:\s*(.*?)\]\]/gi, (match, content) => {
    return `<span class="insert-note">${content.trim()}</span>`;
  });

  // Uncertain/illegible text (gray with ?)
  result = result.replace(/\[\[unclear:\s*(.*?)\]\]/gi, (match, content) => {
    return `<span class="unclear-text">${content.trim()}</span>`;
  });

  // Page number markers
  result = result.replace(/\[\[page\s*number:\s*(.*?)\]\]/gi, (match, pageNum) => {
    return `<span class="page-marker">Page ${pageNum.trim()}</span>`;
  });

  return result;
}

export default function NotesRenderer({ text, className = '' }: NotesRendererProps) {
  const processedText = useMemo(() => processNotesForMarkdown(text), [text]);

  if (!text) {
    return (
      <div className={`text-[var(--text-muted)] italic ${className}`}>
        No content yet...
      </div>
    );
  }

  return (
    <div className={`prose-manuscript ${className}`}>
      {/* Main text rendered as single markdown block */}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
          code: ({ children }) => (
            <code className="bg-stone-100 px-1.5 py-0.5 rounded text-sm font-mono text-stone-700">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="bg-stone-100 p-3 rounded-lg overflow-x-auto my-3 text-sm">{children}</pre>
          ),
          hr: () => <hr className="my-6 border-stone-200" />,
          a: ({ href, children }) => (
            <a href={href} className="text-amber-700 underline hover:text-amber-800" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          // Table support
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
          // Centered text
          div: ({ children, className }) => {
            if (className === 'text-center') {
              return <div className="text-center my-4">{children}</div>;
            }
            return <div>{children}</div>;
          },
          // Custom elements for notes, callouts, and markers
          span: ({ children, className }) => {
            // AI/editorial notes (amber)
            if (className === 'inline-note') {
              return (
                <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Editorial note">
                  {children}
                </span>
              );
            }
            // Marginalia from original manuscript (teal)
            if (className === 'margin-note') {
              return (
                <span className="bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded text-sm mx-0.5 border-l-2 border-teal-400" title="Marginal note in original">
                  {children}
                </span>
              );
            }
            // Gloss/interlinear annotations (purple)
            if (className === 'gloss-note') {
              return (
                <span className="bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Gloss/annotation in original">
                  {children}
                </span>
              );
            }
            // Later insertions (green)
            if (className === 'insert-note') {
              return (
                <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded text-sm mx-0.5" title="Later insertion">
                  {children}
                </span>
              );
            }
            // Unclear/illegible text (gray)
            if (className === 'unclear-text') {
              return (
                <span className="bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded text-sm mx-0.5 italic" title="Unclear in original">
                  {children}?
                </span>
              );
            }
            // Page markers
            if (className === 'page-marker') {
              return (
                <span className="inline-block bg-stone-100 text-stone-500 text-xs px-2 py-0.5 rounded font-medium my-1">
                  {children}
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
