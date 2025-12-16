'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface NotesRendererProps {
  text: string;
  className?: string;
}

interface ParsedSegment {
  type: 'text' | 'note' | 'page_number';
  content: string;
  noteIndex?: number;
}

interface ParseResult {
  segments: ParsedSegment[];
  footnotes: string[];
}

function parseTextWithNotes(text: string): ParseResult {
  const segments: ParsedSegment[] = [];
  const footnotes: string[] = [];
  const pattern = /\[\[(notes?|page\s*number):\s*(.*?)\]\]/gi;

  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, match.index)
      });
    }

    // Add the note/page number
    const type = match[1].toLowerCase().includes('page') ? 'page_number' : 'note';
    const content = match[2].trim();

    if (type === 'note') {
      footnotes.push(content);
      segments.push({
        type,
        content,
        noteIndex: footnotes.length
      });
    } else {
      segments.push({
        type,
        content
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(lastIndex)
    });
  }

  return { segments, footnotes };
}

export default function NotesRenderer({ text, className = '' }: NotesRendererProps) {
  const { segments, footnotes } = useMemo(() => parseTextWithNotes(text), [text]);

  if (!text) {
    return (
      <div className={`text-[var(--text-muted)] italic ${className}`}>
        No content yet...
      </div>
    );
  }

  return (
    <div className={`prose-manuscript ${className}`}>
      {/* Main text with superscript note references */}
      <div>
        {segments.map((segment, index) => {
          if (segment.type === 'note' && segment.noteIndex) {
            return (
              <sup
                key={index}
                className="text-amber-700 cursor-help font-medium ml-0.5"
                title={segment.content}
              >
                {segment.noteIndex}
              </sup>
            );
          }

          if (segment.type === 'page_number') {
            return (
              <span key={index} className="note-page-number">
                Page {segment.content}
              </span>
            );
          }

          // Regular text - render with markdown
          return (
            <ReactMarkdown
              key={index}
              remarkPlugins={[remarkGfm]}
              components={{
                // Customize rendering to be inline-friendly
                p: ({ children }) => <span className="whitespace-pre-wrap">{children}</span>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }) => <em className="italic">{children}</em>,
                h1: ({ children }) => <h1 className="text-2xl font-serif font-bold mt-4 mb-2">{children}</h1>,
                h2: ({ children }) => <h2 className="text-xl font-serif font-bold mt-3 mb-2">{children}</h2>,
                h3: ({ children }) => <h3 className="text-lg font-serif font-semibold mt-2 mb-1">{children}</h3>,
                ul: ({ children }) => <ul className="list-disc ml-5 my-2">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal ml-5 my-2">{children}</ol>,
                li: ({ children }) => <li className="my-0.5">{children}</li>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-amber-300 pl-3 my-2 italic text-stone-600">
                    {children}
                  </blockquote>
                ),
                code: ({ children }) => (
                  <code className="bg-stone-100 px-1 py-0.5 rounded text-sm font-mono">{children}</code>
                ),
                hr: () => <hr className="my-4 border-stone-200" />,
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
              }}
            >
              {segment.content}
            </ReactMarkdown>
          );
        })}
      </div>

      {/* Footnotes section */}
      {footnotes.length > 0 && (
        <div className="mt-6 pt-4 border-t border-stone-200">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">
            Notes
          </div>
          <ol className="list-none space-y-1.5 text-sm text-stone-600">
            {footnotes.map((note, index) => (
              <li key={index} className="flex gap-2">
                <span className="text-amber-700 font-medium flex-shrink-0">{index + 1}.</span>
                <span>{note}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
