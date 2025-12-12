'use client';

import { useMemo } from 'react';
import { Info } from 'lucide-react';

interface NotesRendererProps {
  text: string;
  className?: string;
}

interface ParsedSegment {
  type: 'text' | 'note' | 'page_number';
  content: string;
}

function parseTextWithNotes(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
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
    segments.push({
      type,
      content: match[2].trim()
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(lastIndex)
    });
  }

  return segments;
}

export default function NotesRenderer({ text, className = '' }: NotesRendererProps) {
  const segments = useMemo(() => parseTextWithNotes(text), [text]);

  return (
    <div className={`prose prose-stone max-w-none ${className}`}>
      {segments.map((segment, index) => {
        if (segment.type === 'note') {
          return (
            <span
              key={index}
              className="inline-flex items-start gap-1 bg-amber-50 border border-amber-200 rounded px-2 py-1 text-sm text-amber-800 my-1"
            >
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{segment.content}</span>
            </span>
          );
        }

        if (segment.type === 'page_number') {
          return (
            <span
              key={index}
              className="inline-block bg-stone-100 border border-stone-200 rounded px-2 py-0.5 text-xs font-mono text-stone-600 my-1"
            >
              Page {segment.content}
            </span>
          );
        }

        // Regular text - render with basic markdown support
        return (
          <span key={index} className="whitespace-pre-wrap">
            {segment.content}
          </span>
        );
      })}
    </div>
  );
}
