'use client';

import { useState, useEffect, useCallback, ReactNode } from 'react';
import { Highlighter, X, Check, Loader2, Share2, Twitter, Link2, MessageCircle, MessageSquarePlus, Sparkles, BookOpen, Search } from 'lucide-react';
import AnnotationEditor from './AnnotationEditor';

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
  onAnnotationSaved?: () => void;
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
  onAnnotationSaved,
}: HighlightSelectionProps) {
  const [selectedText, setSelectedText] = useState('');
  const [showPopup, setShowPopup] = useState(false);
  const [popupPosition, setPopupPosition] = useState<PopupPosition>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAnnotationEditor, setShowAnnotationEditor] = useState(false);
  const [showExplainPanel, setShowExplainPanel] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [showLookupResults, setShowLookupResults] = useState(false);
  const [lookupResults, setLookupResults] = useState<Array<{ id: string; slug: string; title: string; summary: string }>>([]);
  const [searchingLookup, setSearchingLookup] = useState(false);

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
      // Get user name from localStorage (shared with annotations)
      const userName = localStorage.getItem('annotation_username') || undefined;

      const response = await fetch('/api/highlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          book_id: bookId,
          page_id: pageId,
          page_number: pageNumber,
          book_title: bookTitle,
          book_author: bookAuthor,
          text: selectedText,
          user_name: userName,
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

  // Explain selected text using AI
  const handleExplain = async () => {
    setShowPopup(false);
    setShowExplainPanel(true);
    setExplaining(true);
    setExplanation(null);

    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: selectedText,
          book_title: bookTitle,
          book_author: bookAuthor,
          page_number: pageNumber,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setExplanation(data.explanation);
      } else {
        setExplanation('Sorry, I couldn\'t explain this text. Please try again.');
      }
    } catch (err) {
      console.error('Explain error:', err);
      setExplanation('Sorry, something went wrong. Please try again.');
    } finally {
      setExplaining(false);
    }
  };

  // Look up selected text in encyclopedia
  const handleLookup = async () => {
    setShowPopup(false);
    setShowLookupResults(true);
    setSearchingLookup(true);
    setLookupResults([]);

    try {
      const res = await fetch(`/api/encyclopedia?q=${encodeURIComponent(selectedText)}&limit=5`);
      if (res.ok) {
        const data = await res.json();
        setLookupResults(data.entries || []);
      }
    } catch (err) {
      console.error('Lookup error:', err);
    } finally {
      setSearchingLookup(false);
    }
  };

  const closeExplainPanel = () => {
    setShowExplainPanel(false);
    setExplanation(null);
    window.getSelection()?.removeAllRanges();
  };

  const closeLookupPanel = () => {
    setShowLookupResults(false);
    setLookupResults([]);
    window.getSelection()?.removeAllRanges();
  };

  // Handle Escape key to close panels
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showExplainPanel) closeExplainPanel();
        if (showLookupResults) closeLookupPanel();
        if (showPopup) handleDismiss();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showExplainPanel, showLookupResults, showPopup]);

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
                  onClick={handleExplain}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-stone-800 transition-colors"
                  title="Explain this"
                >
                  <Sparkles className="w-4 h-4 text-purple-400" />
                </button>
                <button
                  onClick={handleLookup}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-stone-800 transition-colors border-l border-stone-700"
                  title="Look up"
                >
                  <Search className="w-4 h-4 text-green-400" />
                </button>
                <button
                  onClick={handleSaveHighlight}
                  disabled={saving}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-stone-800 transition-colors border-l border-stone-700 disabled:opacity-50"
                  title="Save highlight"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Highlighter className="w-4 h-4 text-yellow-400" />
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowAnnotationEditor(true);
                    setShowPopup(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-stone-800 transition-colors border-l border-stone-700"
                  title="Add comment"
                >
                  <MessageSquarePlus className="w-4 h-4 text-blue-400" />
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

      {/* Annotation Editor Modal */}
      <AnnotationEditor
        isOpen={showAnnotationEditor}
        onClose={() => {
          setShowAnnotationEditor(false);
          window.getSelection()?.removeAllRanges();
        }}
        onSave={() => {
          onAnnotationSaved?.();
          window.getSelection()?.removeAllRanges();
        }}
        bookId={bookId}
        pageId={pageId}
        pageNumber={pageNumber}
        selectedText={selectedText}
      />

      {/* Explain Panel */}
      {showExplainPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={closeExplainPanel} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="explain-panel-title"
            className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 bg-gradient-to-r from-purple-50 to-pink-50">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" aria-hidden="true" />
                <h2 id="explain-panel-title" className="font-medium text-stone-900">Explain</h2>
              </div>
              <button
                onClick={closeExplainPanel}
                aria-label="Close dialog"
                className="p-1 hover:bg-stone-200 rounded transition-colors"
              >
                <X className="w-4 h-4 text-stone-600" aria-hidden="true" />
              </button>
            </div>
            <div className="p-4">
              <div className="bg-yellow-50 border-l-2 border-yellow-400 px-3 py-2 text-sm text-stone-600 italic mb-4">
                &ldquo;{selectedText.length > 150 ? selectedText.slice(0, 150) + '...' : selectedText}&rdquo;
              </div>
              {explaining ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
                  <span className="ml-2 text-stone-600">Thinking...</span>
                </div>
              ) : explanation ? (
                <div className="prose prose-sm prose-stone max-w-none">
                  {explanation.split('\n\n').map((p, i) => (
                    <p key={i} className="text-stone-700 leading-relaxed">{p}</p>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100 bg-stone-50">
              <button
                onClick={() => {
                  setShowAnnotationEditor(true);
                  setShowExplainPanel(false);
                }}
                className="text-xs text-stone-600 hover:text-stone-900 flex items-center gap-1"
              >
                <MessageSquarePlus className="w-3 h-3" />
                Add your own note
              </button>
              <button
                onClick={closeExplainPanel}
                className="px-3 py-1.5 text-xs text-stone-600 hover:text-stone-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lookup Results Panel */}
      {showLookupResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={closeLookupPanel} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="lookup-panel-title"
            className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 bg-gradient-to-r from-green-50 to-emerald-50">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-green-600" aria-hidden="true" />
                <h2 id="lookup-panel-title" className="font-medium text-stone-900">Encyclopedia</h2>
              </div>
              <button
                onClick={closeLookupPanel}
                aria-label="Close dialog"
                className="p-1 hover:bg-stone-200 rounded transition-colors"
              >
                <X className="w-4 h-4 text-stone-600" aria-hidden="true" />
              </button>
            </div>
            <div className="p-4">
              <div className="bg-yellow-50 border-l-2 border-yellow-400 px-3 py-2 text-sm text-stone-600 italic mb-4">
                Looking up: &ldquo;{selectedText.length > 50 ? selectedText.slice(0, 50) + '...' : selectedText}&rdquo;
              </div>
              {searchingLookup ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-green-600" />
                  <span className="ml-2 text-stone-600">Searching...</span>
                </div>
              ) : lookupResults.length > 0 ? (
                <div className="space-y-3">
                  {lookupResults.map((entry) => (
                    <a
                      key={entry.id}
                      href={`/encyclopedia/${entry.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-3 bg-stone-50 hover:bg-stone-100 rounded-lg transition-colors"
                    >
                      <div className="font-medium text-stone-900">{entry.title}</div>
                      <div className="text-sm text-stone-600 mt-1 line-clamp-2">{entry.summary}</div>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <BookOpen className="w-10 h-10 text-stone-300 mx-auto mb-2" />
                  <p className="text-stone-500 text-sm">No encyclopedia entries found.</p>
                  <p className="text-stone-400 text-xs mt-1">Try a different selection or create an entry.</p>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100 bg-stone-50">
              <a
                href="/encyclopedia"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-green-600 hover:text-green-700 flex items-center gap-1"
              >
                <BookOpen className="w-3 h-3" />
                Browse encyclopedia
              </a>
              <button
                onClick={closeLookupPanel}
                className="px-3 py-1.5 text-xs text-stone-600 hover:text-stone-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
