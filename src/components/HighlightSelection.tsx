'use client';

import { useState, useEffect, useCallback, ReactNode } from 'react';
import { Highlighter, X, Check, Loader2, Share2, Twitter, Link2, MessageCircle } from 'lucide-react';

interface HighlightSelectionProps {
  bookId: string;
  pageId: string;
  pageNumber: number;
  bookTitle: string;
  bookAuthor?: string;
  bookYear?: string;
  doi?: string;
  children: ReactNode;
  onHighlightSaved?: () => void;
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
  onHighlightSaved,
}: HighlightSelectionProps) {
  const [selectedText, setSelectedText] = useState('');
  const [showPopup, setShowPopup] = useState(false);
  const [popupPosition, setPopupPosition] = useState<PopupPosition>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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
        setSaved(false);
      }
    } else {
      setShowPopup(false);
      setSelectedText('');
    }
  }, []);

  const handleSaveHighlight = async () => {
    if (!selectedText || saving) return;

    setSaving(true);

    try {
      const response = await fetch('/api/highlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          book_id: bookId,
          page_id: pageId,
          page_number: pageNumber,
          book_title: bookTitle,
          text: selectedText,
        }),
      });

      if (response.ok) {
        setSaved(true);
        onHighlightSaved?.();

        // Clear selection after a moment
        setTimeout(() => {
          window.getSelection()?.removeAllRanges();
          setShowPopup(false);
          setSaved(false);
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to save highlight:', error);
    } finally {
      setSaving(false);
    }
  };

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

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/book/${bookId}/read#page-${pageNumber}`
    : `https://sourcelibrary-v2.vercel.app/book/${bookId}/read#page-${pageNumber}`;

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
            {saved ? (
              <div className="flex items-center gap-2 px-4 py-2 text-green-400">
                <Check className="w-4 h-4" />
                <span className="text-sm">Saved!</span>
              </div>
            ) : copied ? (
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
              <>
                <button
                  onClick={handleSaveHighlight}
                  disabled={saving}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-stone-800 transition-colors disabled:opacity-50"
                  title="Save highlight"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Highlighter className="w-4 h-4 text-yellow-400" />
                  )}
                </button>
                <button
                  onClick={() => setShowShareMenu(true)}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-stone-800 transition-colors border-l border-stone-700"
                  title="Share quote"
                >
                  <Share2 className="w-4 h-4 text-amber-400" />
                </button>
                <button
                  onClick={handleDismiss}
                  className="px-3 py-2 hover:bg-stone-800 transition-colors border-l border-stone-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </>
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
