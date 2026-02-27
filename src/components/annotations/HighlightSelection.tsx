'use client';

import { useState, useEffect, useCallback, ReactNode } from 'react';
import { X, Check, Share2, Twitter, Link2, MessageCircle } from 'lucide-react';
import { getShortUrl } from '@/lib/shortlinks';

interface HighlightSelectionProps {
  bookId: string;
  pageId: string;
  pageNumber: number;
  bookTitle: string;
  bookAuthor?: string;
  bookYear?: string;
  doi?: string;
  children: ReactNode;
}

interface PopupPosition {
  x: number;
  y: number;
}

export default function HighlightSelection({
  bookId,
  pageId,
  pageNumber,
  bookTitle,
  bookAuthor,
  bookYear,
  doi,
  children,
}: HighlightSelectionProps) {
  const [selectedText, setSelectedText] = useState('');
  const [showPopup, setShowPopup] = useState(false);
  const [popupPosition, setPopupPosition] = useState<PopupPosition>({ x: 0, y: 0 });
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSelection = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || '';

    if (text.length >= 3) {
      setSelectedText(text);

      // Get selection position for popup
      const range = selection?.getRangeAt(0);
      if (range) {
        const rect = range.getBoundingClientRect();
        setPopupPosition({
          x: rect.left + rect.width / 2,
          y: rect.top - 10,
        });
        setShowPopup(true);
      }
    } else {
      setShowPopup(false);
      setSelectedText('');
    }
  }, []);

  const handleDismiss = () => {
    setShowPopup(false);
    setShowShareMenu(false);
    window.getSelection()?.removeAllRanges();
  };

  // Build citation for sharing
  const citation = [
    bookAuthor,
    bookTitle ? `"${bookTitle}"` : null,
    bookYear ? `(${bookYear})` : null,
    `p. ${pageNumber}`,
  ].filter(Boolean).join(', ');

  const shareUrl = getShortUrl(bookId, pageNumber, pageId);

  const buildTweetText = () => {
    const maxQuoteLength = 200;
    const quote = selectedText.length > maxQuoteLength
      ? selectedText.substring(0, maxQuoteLength - 3) + '...'
      : selectedText;
    return `"${quote}"\n\n— ${citation}`;
  };

  const shareToTwitter = () => {
    const twitterUrl = new URL('https://twitter.com/intent/tweet');
    twitterUrl.searchParams.set('text', buildTweetText());
    twitterUrl.searchParams.set('url', shareUrl);
    window.open(twitterUrl.toString(), '_blank', 'width=550,height=420');
    handleDismiss();
  };

  const shareToBluesky = () => {
    const bskyUrl = new URL('https://bsky.app/intent/compose');
    const fullText = `"${selectedText.substring(0, 250)}"\n\n— ${citation}\n\n${shareUrl}`;
    bskyUrl.searchParams.set('text', fullText);
    window.open(bskyUrl.toString(), '_blank', 'width=550,height=420');
    handleDismiss();
  };

  const copyQuote = async () => {
    const quoteToCopy = `"${selectedText}"\n\n— ${citation}${doi ? `\nDOI: ${doi}` : ''}\n${shareUrl}`;
    await navigator.clipboard.writeText(quoteToCopy);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      handleDismiss();
    }, 1500);
  };

  // Handle Escape key to close panels
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showPopup) handleDismiss();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showPopup]);

  useEffect(() => {
    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('touchend', handleSelection);

    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('touchend', handleSelection);
    };
  }, [handleSelection]);

  // Close popup on scroll
  useEffect(() => {
    const handleScroll = () => {
      if (showPopup) {
        setShowPopup(false);
      }
    };

    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [showPopup]);

  return (
    <div className="relative">
      {children}

      {/* Selection Popup */}
      {showPopup && (
        <div
          className="fixed z-50 transform -translate-x-1/2 -translate-y-full"
          style={{
            left: `${popupPosition.x}px`,
            top: `${popupPosition.y}px`,
          }}
        >
          <div className="bg-stone-900 text-white rounded-lg shadow-xl flex items-center overflow-hidden">
            {copied ? (
              <div className="flex items-center gap-2 px-4 py-2 text-green-400">
                <Check className="w-4 h-4" />
                <span className="text-sm">Copied!</span>
              </div>
            ) : showShareMenu ? (
              <>
                <button
                  onClick={shareToTwitter}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-stone-800 transition-colors"
                  title="Share on X"
                >
                  <Twitter className="w-4 h-4 text-sky-400" />
                </button>
                <button
                  onClick={shareToBluesky}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-stone-800 transition-colors border-l border-stone-700"
                  title="Share on Bluesky"
                >
                  <MessageCircle className="w-4 h-4 text-blue-400" />
                </button>
                <button
                  onClick={copyQuote}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-stone-800 transition-colors border-l border-stone-700"
                  title="Copy quote"
                >
                  <Link2 className="w-4 h-4 text-stone-400" />
                </button>
                <button
                  onClick={() => setShowShareMenu(false)}
                  className="px-3 py-2 hover:bg-stone-800 transition-colors border-l border-stone-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowShareMenu(true)}
                className="flex items-center gap-2 px-3 py-2 hover:bg-stone-800 transition-colors"
                title="Share quote"
              >
                <Share2 className="w-4 h-4 text-accent-gold" />
                <span className="text-sm">Share</span>
              </button>
            )}
          </div>
          {/* Arrow */}
          <div className="absolute left-1/2 -translate-x-1/2 top-full">
            <div className="border-8 border-transparent border-t-stone-900" />
          </div>
        </div>
      )}

    </div>
  );
}
