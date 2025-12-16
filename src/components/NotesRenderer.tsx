'use client';

import { useMemo } from 'react';

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

          // Regular text
          return (
            <span key={index} className="whitespace-pre-wrap">
              {segment.content}
            </span>
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
