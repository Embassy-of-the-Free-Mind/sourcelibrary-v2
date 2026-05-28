'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ensureParagraphBreaks, linkifySourceUrls } from '@/lib/markdown-prep';

// ── Shared Librarian message body ─────────────────────────────────────
// Single source of truth for assistant-message typography across:
//   /librarian (live chat)            — variant="chat-bubble"
//   /librarian/thread/[id] (persisted) — variant="thread"
//   /[tenant]/reading-room and equivalents
//
// Why this exists: the live-chat and thread-page renderers were using two
// different markdown styling systems (inline component overrides vs
// Tailwind Typography prose-*: modifiers). The prose-*: modifiers were not
// winning the cascade against the prose plugin's defaults, so paragraphs
// collapsed (margin: 0) and h2/h3 rendered at body size. This component
// owns the typography in one place. See PR conventions in CLAUDE.md.
// ──────────────────────────────────────────────────────────────────────

export type MessageBodyVariant = 'chat-bubble' | 'thread';

interface LibrarianMessageBodyProps {
  content: string;
  variant?: MessageBodyVariant;
}

export default function LibrarianMessageBody({ content, variant = 'thread' }: LibrarianMessageBodyProps) {
  const wrapperClass =
    variant === 'chat-bubble'
      ? 'bg-[#f5f0e8] text-[#1a1612] rounded-2xl rounded-bl-sm px-4 py-3'
      : '';

  return (
    <div className={wrapperClass}>
      <div className="max-w-none font-body text-[15px] text-[#1a1612]" style={{ lineHeight: 1.7 }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => (
              <p className="my-4 first:mt-0 last:mb-0">{children}</p>
            ),
            h2: ({ children }) => (
              <h2 className="font-serif text-[22px] mt-8 mb-3 text-[#1a1612] leading-tight" style={{ fontWeight: 400 }}>{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="font-serif text-[18px] mt-6 mb-2 text-[#1a1612] leading-snug" style={{ fontWeight: 500 }}>{children}</h3>
            ),
            h4: ({ children }) => (
              <h4 className="font-serif text-[16px] mt-5 mb-2 text-[#1a1612] leading-snug" style={{ fontWeight: 500 }}>{children}</h4>
            ),
            a: ({ href, children }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#9e4a3a] font-medium underline underline-offset-2 decoration-[#9e4a3a]/80 hover:decoration-[#9e4a3a]"
              >{children}</a>
            ),
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 border-[#c9a86c] pl-4 my-5 italic text-[#444]">{children}</blockquote>
            ),
            ul: ({ children }) => (
              <ul className="my-4 ml-5 list-disc space-y-1">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="my-4 ml-5 list-decimal space-y-1">{children}</ol>
            ),
            li: ({ children }) => (
              <li className="leading-[1.7]">{children}</li>
            ),
            hr: () => <hr className="my-6 border-[#e8e4dc]" />,
            strong: ({ children }) => (
              <strong className="font-semibold text-[#1a1612]">{children}</strong>
            ),
            table: ({ children }) => (
              <div className="my-5 overflow-x-auto">
                <table className="border-collapse text-[14px] w-full">{children}</table>
              </div>
            ),
            thead: ({ children }) => <thead>{children}</thead>,
            tbody: ({ children }) => <tbody>{children}</tbody>,
            tr: ({ children }) => <tr>{children}</tr>,
            th: ({ children }) => (
              <th className="border-b-2 border-[#1a1612] px-3 py-2 text-left font-serif align-bottom text-[#1a1612]" style={{ fontWeight: 500 }}>{children}</th>
            ),
            td: ({ children }) => (
              <td className="border-b border-[#e8e4dc] px-3 py-2 align-top">{children}</td>
            ),
            img: ({ src, alt }) => (
              <a href={src as string} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src as string}
                  alt={(alt as string) || ''}
                  className="rounded-lg shadow-md max-h-[400px] w-auto cursor-pointer hover:shadow-lg transition-shadow my-5"
                  loading="lazy"
                  onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    const wrapper = img.closest('a') as HTMLAnchorElement | null;
                    if (wrapper) wrapper.style.display = 'none';
                    else img.style.display = 'none';
                  }}
                />
              </a>
            ),
          }}
        >{ensureParagraphBreaks(linkifySourceUrls(content))}</ReactMarkdown>
      </div>
    </div>
  );
}
