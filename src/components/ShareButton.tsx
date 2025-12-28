'use client';

import { useState } from 'react';
import { Share2, Twitter, Link2, Check, MessageCircle } from 'lucide-react';

interface ShareButtonProps {
  // What to share
  text?: string;           // Quote text
  title?: string;          // Book title
  author?: string;         // Book author
  year?: string;           // Publication year
  page?: number;           // Page number
  url?: string;            // URL to share (defaults to current page)
  doi?: string;            // DOI if available

  // Display options
  variant?: 'icon' | 'button' | 'menu';
  className?: string;
}

export default function ShareButton({
  text,
  title,
  author,
  year,
  page,
  url,
  doi,
  variant = 'icon',
  className = '',
}: ShareButtonProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  // Build the share URL
  const shareUrl = url || (typeof window !== 'undefined' ? window.location.href : '');

  // Build citation
  const citation = [
    author,
    title ? `"${title}"` : null,
    year ? `(${year})` : null,
    page ? `p. ${page}` : null,
  ].filter(Boolean).join(', ');

  // Build tweet text
  const buildTweetText = () => {
    const parts: string[] = [];

    if (text) {
      // Truncate quote if too long (Twitter limit is 280, leave room for URL)
      const maxQuoteLength = 200;
      const quote = text.length > maxQuoteLength
        ? text.substring(0, maxQuoteLength - 3) + '...'
        : text;
      parts.push(`"${quote}"`);
    }

    if (citation) {
      parts.push(`— ${citation}`);
    }

    return parts.join('\n\n');
  };

  const tweetText = buildTweetText();

  // Share handlers
  const shareToTwitter = () => {
    const twitterUrl = new URL('https://twitter.com/intent/tweet');
    twitterUrl.searchParams.set('text', tweetText);
    twitterUrl.searchParams.set('url', shareUrl);
    window.open(twitterUrl.toString(), '_blank', 'width=550,height=420');
    setShowMenu(false);
  };

  const shareToBluesky = () => {
    const bskyUrl = new URL('https://bsky.app/intent/compose');
    const fullText = text
      ? `"${text.substring(0, 250)}"\n\n— ${citation}\n\n${shareUrl}`
      : `${citation}\n\n${shareUrl}`;
    bskyUrl.searchParams.set('text', fullText);
    window.open(bskyUrl.toString(), '_blank', 'width=550,height=420');
    setShowMenu(false);
  };

  const copyLink = async () => {
    const textToCopy = text
      ? `"${text}"\n\n— ${citation}\n${doi ? `DOI: ${doi}\n` : ''}${shareUrl}`
      : shareUrl;

    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setShowMenu(false);
  };

  const copyQuote = async () => {
    if (!text) return;
    const quoteToCopy = `"${text}"\n\n— ${citation}${doi ? `\nDOI: ${doi}` : ''}`;
    await navigator.clipboard.writeText(quoteToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setShowMenu(false);
  };

  // Icon-only button
  if (variant === 'icon') {
    return (
      <div className="relative inline-block">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className={`p-2 text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors ${className}`}
          title="Share"
        >
          {copied ? <Check className="w-4 h-4 text-green-600" /> : <Share2 className="w-4 h-4" />}
        </button>

        {showMenu && (
          <>
            <div
              className="fixed inset-0 z-[9998]"
              onClick={() => setShowMenu(false)}
            />
            <div className="absolute right-0 top-full mt-1 z-[9999] bg-white rounded-lg shadow-lg border border-stone-200 py-1 min-w-[160px] text-stone-900">
              <button
                onClick={shareToTwitter}
                className="w-full px-3 py-2 text-left text-sm hover:bg-stone-50 flex items-center gap-2 text-stone-700"
              >
                <Twitter className="w-4 h-4" />
                Share on X
              </button>
              <button
                onClick={shareToBluesky}
                className="w-full px-3 py-2 text-left text-sm hover:bg-stone-50 flex items-center gap-2 text-stone-700"
              >
                <MessageCircle className="w-4 h-4" />
                Share on Bluesky
              </button>
              <hr className="my-1 border-stone-100" />
              {text && (
                <button
                  onClick={copyQuote}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-stone-50 flex items-center gap-2 text-stone-700"
                >
                  <Link2 className="w-4 h-4" />
                  Copy quote
                </button>
              )}
              <button
                onClick={copyLink}
                className="w-full px-3 py-2 text-left text-sm hover:bg-stone-50 flex items-center gap-2 text-stone-700"
              >
                <Link2 className="w-4 h-4" />
                Copy link
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // Full button
  return (
    <button
      onClick={shareToTwitter}
      className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors ${className}`}
    >
      <Share2 className="w-4 h-4" />
      Share
    </button>
  );
}

// Compact share for inline use (e.g., next to quotes)
export function QuoteShare({
  text,
  title,
  author,
  year,
  page,
  bookId,
  doi,
}: {
  text: string;
  title: string;
  author: string;
  year?: string;
  page?: number;
  bookId: string;
  doi?: string;
}) {
  const baseUrl = typeof window !== 'undefined'
    ? window.location.origin
    : 'https://sourcelibrary.org';

  const url = page
    ? `${baseUrl}/book/${bookId}/read#page-${page}`
    : `${baseUrl}/book/${bookId}`;

  return (
    <ShareButton
      text={text}
      title={title}
      author={author}
      year={year}
      page={page}
      url={url}
      doi={doi}
      variant="icon"
    />
  );
}

// Book share (no quote, just the book)
export function BookShare({
  title,
  author,
  year,
  bookId,
  doi,
  className = '',
}: {
  title: string;
  author: string;
  year?: string;
  bookId: string;
  doi?: string;
  className?: string;
}) {
  const baseUrl = typeof window !== 'undefined'
    ? window.location.origin
    : 'https://sourcelibrary.org';

  return (
    <ShareButton
      title={title}
      author={author}
      year={year}
      url={`${baseUrl}/book/${bookId}`}
      doi={doi}
      variant="icon"
      className={className}
    />
  );
}
