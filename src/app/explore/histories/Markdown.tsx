import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Server-rendered essay markdown. Site links go through next/link; a claim
// marker ([1] → /explore/histories/<c>/claims/<domain>#id) is set small and raised.
export default function Markdown({ md }: { md: string }) {
  return (
    <div className="prose-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => <h2 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>{children}</h2>,
          h3: ({ children }) => <h3 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>{children}</h3>,
          h4: ({ children }) => <h4 className="font-serif text-lg mt-6 mb-2" style={{ color: 'var(--text-primary)' }}>{children}</h4>,
          ul: ({ children }) => <ul className="list-disc pl-6">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-6">{children}</ol>,
          blockquote: ({ children }) => <blockquote className="border-l-2 pl-4 italic" style={{ borderColor: 'var(--border-light)' }}>{children}</blockquote>,
          table: ({ children }) => <div className="overflow-x-auto my-6"><table className="w-full text-sm">{children}</table></div>,
          th: ({ children }) => <th className="text-left align-top p-2" style={{ borderBottom: '1px solid var(--border-light)' }}>{children}</th>,
          td: ({ children }) => <td className="align-top p-2" style={{ borderBottom: '1px solid var(--border-light)' }}>{children}</td>,
          a: ({ href: raw = '', title, children }) => {
            // the essays cite pages as bare https://sourcelibrary.org/q/… URLs: link them relative, and show "page"
            // instead of the address (the tenant rule: never an absolute sourcelibrary.org link)
            const href = raw.replace(/^https?:\/\/(?:www\.)?sourcelibrary\.org(?=\/)/, '');
            if (href !== raw && typeof children === 'string' && children === raw) {
              return <Link href={href} title={title} className="text-sm">(page)</Link>;
            }
            const claim = /^\/explore\/histories\/[^/]+\/claims\//.test(href);
            if (href.startsWith('/')) {
              return <Link href={href} title={title} className={claim ? 'text-xs align-super no-underline' : undefined}>{children}</Link>;
            }
            return <a href={href} title={title} rel="noopener noreferrer">{children}</a>;
          },
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}
