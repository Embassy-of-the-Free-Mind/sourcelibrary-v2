'use client';

import { useState, useEffect, useCallback, ReactNode } from 'react';
import { Highlighter, X, Check, Loader2 } from 'lucide-react';

interface HighlightSelectionProps {
  bookId: string;
  pageId: string;
  pageNumber: number;
  bookTitle: string;
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
  children,
  onHighlightSaved,
}: HighlightSelectionProps) {
  const [selectedText, setSelectedText] = useState('');
  const [showPopup, setShowPopup] = useState(false);
  const [popupPosition, setPopupPosition] = useState<PopupPosition>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
    window.getSelection()?.removeAllRanges();
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
            ) : (
              <>
                <button
                  onClick={handleSaveHighlight}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 hover:bg-stone-800 transition-colors disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Highlighter className="w-4 h-4 text-yellow-400" />
                  )}
                  <span className="text-sm font-medium">Save</span>
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
