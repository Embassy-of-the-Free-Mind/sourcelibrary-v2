'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Settings,
  X,
  Eye,
  Pencil,
  Copy,
  Check,
  ZoomIn,
  Scissors,
  ArrowLeftRight,
  Columns,
  BookOpen
} from 'lucide-react';
import NotesRenderer from './NotesRenderer';
import type { Page, Book, Prompt } from '@/lib/types';

interface TranslationEditorProps {
  book: Book;
  page: Page;
  pages: Page[];
  currentIndex: number;
  onNavigate: (pageId: string) => void;
  onSave: (data: { ocr?: string; translation?: string; summary?: string }) => Promise<void>;
  onPageSplit?: () => void; // Callback to refresh pages after split
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  promptType: 'ocr' | 'translation' | 'summary';
  selectedPromptId: string | null;
  onSelectPrompt: (prompt: Prompt) => void;
}

function SettingsModal({ isOpen, onClose, title, promptType, selectedPromptId, onSelectPrompt }: SettingsModalProps) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [newPromptName, setNewPromptName] = useState('');
  const [creating, setCreating] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch prompts when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchPrompts();
    }
  }, [isOpen, promptType]);

  // Update selected prompt when prompts load or selection changes
  useEffect(() => {
    if (prompts.length > 0) {
      const prompt = selectedPromptId
        ? prompts.find(p => p.id === selectedPromptId || p._id?.toString() === selectedPromptId)
        : prompts.find(p => p.is_default);
      if (prompt) {
        setSelectedPrompt(prompt);
        setEditedContent(prompt.content);
        setHasChanges(false);
      }
    }
  }, [prompts, selectedPromptId]);

  const fetchPrompts = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/prompts?type=${promptType}`);
      if (response.ok) {
        const data = await response.json();
        setPrompts(data);
      }
    } catch (error) {
      console.error('Failed to fetch prompts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPrompt = (promptId: string) => {
    const prompt = prompts.find(p => p.id === promptId || p._id?.toString() === promptId);
    if (prompt) {
      setSelectedPrompt(prompt);
      setEditedContent(prompt.content);
      setHasChanges(false);
      onSelectPrompt(prompt);
    }
  };

  const handleContentChange = (content: string) => {
    setEditedContent(content);
    setHasChanges(content !== selectedPrompt?.content);
  };

  const handleSaveChanges = async () => {
    if (!selectedPrompt || !hasChanges) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/prompts/${selectedPrompt.id || selectedPrompt._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editedContent }),
      });
      if (response.ok) {
        const updated = await response.json();
        setPrompts(prompts.map(p =>
          (p.id === updated.id || p._id?.toString() === updated.id) ? updated : p
        ));
        setSelectedPrompt(updated);
        setHasChanges(false);
        onSelectPrompt(updated);
      }
    } catch (error) {
      console.error('Failed to save prompt:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePrompt = async () => {
    if (!newPromptName.trim() || !editedContent.trim()) return;
    setCreating(true);
    try {
      const response = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newPromptName.trim(),
          type: promptType,
          content: editedContent,
        }),
      });
      if (response.ok) {
        const newPrompt = await response.json();
        setPrompts([...prompts, newPrompt]);
        setSelectedPrompt(newPrompt);
        setNewPromptName('');
        setHasChanges(false);
        onSelectPrompt(newPrompt);
      }
    } catch (error) {
      console.error('Failed to create prompt:', error);
    } finally {
      setCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="w-full max-w-lg mx-4 rounded-xl shadow-2xl" style={{ background: 'var(--bg-white)' }}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={onClose} className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <label className="label block mb-2">AI Model</label>
            <select
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' }}
            >
              <option>Gemini 2.0 Flash</option>
            </select>
          </div>

          <div>
            <label className="label block mb-2">Prompt Template</label>
            <select
              value={selectedPrompt?.id || selectedPrompt?._id?.toString() || ''}
              onChange={(e) => handleSelectPrompt(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' }}
            >
              {loading ? (
                <option>Loading...</option>
              ) : (
                prompts.map(p => (
                  <option key={p.id || p._id?.toString()} value={p.id || p._id?.toString()}>
                    {p.name}{p.is_default ? ' (Default)' : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="label block mb-2">
              Prompt Text <span style={{ color: 'var(--text-faint)', fontWeight: 'normal', textTransform: 'none' }}>(use {'{language}'} as placeholders)</span>
            </label>
            <textarea
              value={editedContent}
              onChange={(e) => handleContentChange(e.target.value)}
              className="w-full h-40 px-3 py-2.5 rounded-lg text-sm font-mono resize-none"
              style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-cream)', color: 'var(--text-secondary)' }}
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSaveChanges}
              disabled={!hasChanges || saving}
              className="text-sm font-medium transition-opacity hover:opacity-70 disabled:opacity-40"
              style={{ color: 'var(--accent-rust)' }}
            >
              {saving ? 'Saving...' : hasChanges ? 'Save Changes' : 'Saved'}
            </button>
          </div>

          <div className="pt-4" style={{ borderTop: '1px solid var(--border-light)' }}>
            <label className="label block mb-2">Create New Prompt</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="New prompt name..."
                value={newPromptName}
                onChange={(e) => setNewPromptName(e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-lg text-sm"
                style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' }}
              />
              <button
                onClick={handleCreatePrompt}
                disabled={!newPromptName.trim() || creating}
                className="px-4 py-2 text-sm font-medium transition-opacity hover:opacity-70 disabled:opacity-40"
                style={{ color: 'var(--text-muted)' }}
              >
                {creating ? '...' : '+ Add'}
              </button>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
              Creates a new prompt with the current text content
            </p>
          </div>
        </div>

        <div className="p-5" style={{ borderTop: '1px solid var(--border-light)' }}>
          <button
            onClick={onClose}
            className="btn-primary w-full justify-center"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// Magnifier component for zooming into the source image
function ImageWithMagnifier({ src, thumbnail, alt }: { src: string; thumbnail?: string; alt: string }) {
  const [showMagnifier, setShowMagnifier] = useState(false);
  const [magnifierPosition, setMagnifierPosition] = useState({ x: 0, y: 0 });
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [isLoaded, setIsLoaded] = useState(false);
  const [fullImageLoaded, setFullImageLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const magnifierSize = 200;
  const zoomLevel = 3;

  // Use thumbnail for display, full image for magnifier
  // If no thumbnail, use resize API to generate one on-the-fly
  const getResizedUrl = (url: string, width: number = 400) => {
    return `/api/image?url=${encodeURIComponent(url)}&w=${width}&q=70`;
  };
  const displaySrc = thumbnail || getResizedUrl(src, 400);
  const magnifierSrc = src;

  useEffect(() => {
    // Reset loaded state when src changes
    setIsLoaded(false);
    setFullImageLoaded(false);
  }, [src]);

  useEffect(() => {
    // Get actual rendered image dimensions
    const updateDimensions = () => {
      if (imgRef.current) {
        const rect = imgRef.current.getBoundingClientRect();
        setImageDimensions({ width: rect.width, height: rect.height });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [isLoaded]);

  // Preload full image for magnifier when thumbnail is used
  useEffect(() => {
    if (thumbnail && src !== thumbnail) {
      const img = new window.Image();
      img.onload = () => setFullImageLoaded(true);
      img.src = src;
    } else {
      setFullImageLoaded(true);
    }
  }, [src, thumbnail]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !imgRef.current || !fullImageLoaded) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const imgRect = imgRef.current.getBoundingClientRect();

    // Get cursor position relative to container
    const containerX = e.clientX - containerRect.left;
    const containerY = e.clientY - containerRect.top;

    // Get cursor position relative to the actual image
    const imgX = e.clientX - imgRect.left;
    const imgY = e.clientY - imgRect.top;

    // Check if cursor is over the actual image
    const isOverImage = imgX >= 0 && imgX <= imgRect.width && imgY >= 0 && imgY <= imgRect.height;

    if (isOverImage) {
      setCursorPosition({ x: containerX, y: containerY });

      // Calculate background position as percentage of image dimensions
      const xPercent = (imgX / imgRect.width) * 100;
      const yPercent = (imgY / imgRect.height) * 100;
      setMagnifierPosition({ x: xPercent, y: yPercent });
      setShowMagnifier(true);
    } else {
      setShowMagnifier(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setShowMagnifier(false)}
    >
      {/* Loading skeleton */}
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-stone-100 animate-pulse">
          <div className="text-stone-400 text-sm">Loading...</div>
        </div>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={displaySrc}
        alt={alt}
        loading="lazy"
        className={`w-full h-full object-contain cursor-crosshair transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => {
          setIsLoaded(true);
          if (imgRef.current) {
            const rect = imgRef.current.getBoundingClientRect();
            setImageDimensions({ width: rect.width, height: rect.height });
          }
        }}
      />

      {/* Magnifier lens - uses full resolution image */}
      {showMagnifier && fullImageLoaded && (
        <div
          className="absolute pointer-events-none rounded-full overflow-hidden"
          style={{
            width: magnifierSize,
            height: magnifierSize,
            left: cursorPosition.x - magnifierSize / 2,
            top: cursorPosition.y - magnifierSize / 2,
            border: '4px solid white',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            backgroundImage: `url(${magnifierSrc})`,
            backgroundSize: `${imageDimensions.width * zoomLevel}px ${imageDimensions.height * zoomLevel}px`,
            backgroundPosition: `${-magnifierPosition.x * imageDimensions.width * zoomLevel / 100 + magnifierSize / 2}px ${-magnifierPosition.y * imageDimensions.height * zoomLevel / 100 + magnifierSize / 2}px`,
            backgroundRepeat: 'no-repeat',
            backgroundColor: 'var(--bg-white)',
          }}
        />
      )}

      {/* Zoom hint */}
      {isLoaded && !showMagnifier && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded text-xs" style={{ background: 'rgba(0,0,0,0.6)', color: 'white' }}>
          <ZoomIn className="w-3 h-3" />
          {fullImageLoaded ? 'Hover to zoom' : 'Loading HD...'}
        </div>
      )}
    </div>
  );
}

export default function TranslationEditor({
  book,
  page,
  pages,
  currentIndex,
  onNavigate,
  onSave,
  onPageSplit
}: TranslationEditorProps) {
  const [ocrText, setOcrText] = useState(page.ocr?.data || '');
  const [translationText, setTranslationText] = useState(page.translation?.data || '');
  const [summaryText, setSummaryText] = useState(page.summary?.data || '');

  const [processing, setProcessing] = useState<'ocr' | 'translation' | 'summary' | 'all' | null>(null);
  const [mode, setMode] = useState<'read' | 'edit'>('read');

  const [showOcrSettings, setShowOcrSettings] = useState(false);
  const [showTranslationSettings, setShowTranslationSettings] = useState(false);
  const [showSplitOptions, setShowSplitOptions] = useState(false);
  const [splitting, setSplitting] = useState(false);

  const [selectedOcrPrompt, setSelectedOcrPrompt] = useState<Prompt | null>(null);
  const [selectedTranslationPrompt, setSelectedTranslationPrompt] = useState<Prompt | null>(null);

  const [copiedTranslation, setCopiedTranslation] = useState(false);
  const [showOcrInRead, setShowOcrInRead] = useState(false);

  const previousPage = currentIndex > 0 ? pages[currentIndex - 1] : null;
  const nextPage = currentIndex < pages.length - 1 ? pages[currentIndex + 1] : null;

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft' && previousPage) {
        onNavigate(previousPage.id);
      } else if (e.key === 'ArrowRight' && nextPage) {
        onNavigate(nextPage.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previousPage, nextPage, onNavigate]);

  // Prefetch adjacent page images for faster navigation
  useEffect(() => {
    const getSmallImageUrl = (p: Page) => {
      if (p.thumbnail) return p.thumbnail;
      if (p.compressed_photo) return p.compressed_photo;
      // Use resize API for small version
      return `/api/image?url=${encodeURIComponent(p.photo)}&w=400&q=70`;
    };

    const prefetchImage = (url: string) => {
      const img = new window.Image();
      img.src = url;
    };

    // Prefetch small versions of adjacent pages
    if (previousPage) {
      prefetchImage(getSmallImageUrl(previousPage));
    }
    if (nextPage) {
      prefetchImage(getSmallImageUrl(nextPage));
    }
  }, [previousPage, nextPage]);

  const handleSplitPage = async (side: 'left' | 'right') => {
    if (splitting) return;
    setSplitting(true);
    try {
      const response = await fetch(`/api/pages/${page.id}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side })
      });

      if (!response.ok) {
        throw new Error('Split failed');
      }

      const result = await response.json();
      setShowSplitOptions(false);

      // Refresh the page data
      if (onPageSplit) {
        onPageSplit();
      } else {
        // Fallback: navigate to the new page
        window.location.reload();
      }
    } catch (error) {
      console.error('Split error:', error);
      alert('Failed to split page. Please try again.');
    } finally {
      setSplitting(false);
    }
  };

  // Update state when page changes
  useEffect(() => {
    setOcrText(page.ocr?.data || '');
    setTranslationText(page.translation?.data || '');
    setSummaryText(page.summary?.data || '');
  }, [page]);

  const handleProcess = async (action: 'ocr' | 'translation' | 'summary' | 'all') => {
    setProcessing(action);
    try {
      // Build custom prompts object if any are selected
      const customPrompts: { ocr?: string; translation?: string } = {};
      if (selectedOcrPrompt?.content) {
        customPrompts.ocr = selectedOcrPrompt.content;
      }
      if (selectedTranslationPrompt?.content) {
        customPrompts.translation = selectedTranslationPrompt.content;
      }

      const response = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId: page.id,
          action,
          imageUrl: page.photo,
          language: book.language || 'Latin',
          targetLanguage: 'English',
          ocrText: action === 'translation' ? ocrText : undefined,
          translatedText: action === 'summary' ? translationText : undefined,
          previousPageId: previousPage?.id,
          customPrompts: Object.keys(customPrompts).length > 0 ? customPrompts : undefined,
          autoSave: true
        })
      });

      if (!response.ok) {
        throw new Error('Processing failed');
      }

      const result = await response.json();

      if (result.ocr) setOcrText(result.ocr);
      if (result.translation) setTranslationText(result.translation);
      if (result.summary) setSummaryText(result.summary);
    } catch (error) {
      console.error('Processing error:', error);
      alert('Processing failed. Please try again.');
    } finally {
      setProcessing(null);
    }
  };

  const handleSave = async () => {
    try {
      await onSave({
        ocr: ocrText,
        translation: translationText,
        summary: summaryText
      });
    } catch (error) {
      console.error('Save error:', error);
    }
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedTranslation(true);
    setTimeout(() => setCopiedTranslation(false), 2000);
  };

  // READ MODE - Clean reading experience
  if (mode === 'read') {
    const columnWidth = showOcrInRead ? 'md:w-1/3' : 'md:w-1/2';

    return (
      <div className="h-screen flex flex-col" style={{ background: 'var(--bg-cream)' }}>
        {/* Compact Header */}
        <header className="px-4 py-2 flex items-center justify-between" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
          {/* Left: Back + Title */}
          <div className="flex items-center gap-3 min-w-0">
            <a href={`/book/${book.id}`} className="p-1.5 rounded-md hover:bg-stone-100 transition-colors flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
              <BookOpen className="w-5 h-5" />
            </a>
            <div className="min-w-0">
              <h1 className="text-base font-medium truncate" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
                {book.display_title || book.title}
              </h1>
            </div>
          </div>

          {/* Center: Page Navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => previousPage && onNavigate(previousPage.id)}
              disabled={!previousPage}
              className="p-2 rounded-lg hover:bg-stone-100 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
              style={{ color: 'var(--text-secondary)' }}
              title="Previous page (←)"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <div className="flex items-center gap-2 px-3">
              <span className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{currentIndex + 1}</span>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>of {pages.length}</span>
            </div>
            <button
              onClick={() => nextPage && onNavigate(nextPage.id)}
              disabled={!nextPage}
              className="p-2 rounded-lg hover:bg-stone-100 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
              style={{ color: 'var(--text-secondary)' }}
              title="Next page (→)"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>

          {/* Right: View Options + Edit */}
          <div className="flex items-center gap-2">
            {/* Show OCR Toggle */}
            {ocrText && (
              <button
                onClick={() => setShowOcrInRead(!showOcrInRead)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${showOcrInRead ? 'bg-amber-100 text-amber-700' : 'hover:bg-stone-100'}`}
                style={{ color: showOcrInRead ? undefined : 'var(--text-muted)' }}
                title="Show original text"
              >
                <Columns className="w-4 h-4" />
                <span className="hidden sm:inline">{book.language || 'Original'}</span>
              </button>
            )}
            {/* Edit Button */}
            <button
              onClick={() => setMode('edit')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-stone-100 transition-all"
              style={{ color: 'var(--text-muted)' }}
            >
              <Pencil className="w-4 h-4" />
              <span className="hidden sm:inline">Edit</span>
            </button>
          </div>
        </header>

        {/* Reading layout */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Source Image */}
          <div className={`w-full ${columnWidth} flex flex-col`} style={{ background: 'var(--bg-warm)', borderRight: '1px solid var(--border-light)' }}>
            <div className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Image</span>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <div className="relative w-full h-full rounded-lg overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                {page.photo ? (
                  <ImageWithMagnifier src={page.photo} thumbnail={page.thumbnail || page.compressed_photo} alt={`Page ${page.page_number}`} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
                    No image available
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* OCR Text (optional middle column) */}
          {showOcrInRead && ocrText && (
            <div className={`w-full ${columnWidth} flex flex-col`} style={{ background: 'var(--bg-cream)', borderRight: '1px solid var(--border-light)' }}>
              <div className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{book.language || 'Original'}</span>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <div className="prose-manuscript text-sm leading-relaxed" style={{ fontFamily: 'Newsreader, Georgia, serif', color: 'var(--text-secondary)' }}>
                  <NotesRenderer text={ocrText} />
                </div>
              </div>
            </div>
          )}

          {/* Translation */}
          <div className={`w-full ${columnWidth} flex flex-col`} style={{ background: 'var(--bg-white)' }}>
            <div className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>English</span>
              {translationText && (
                <button
                  onClick={() => copyToClipboard(translationText)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-stone-100"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {copiedTranslation ? <Check className="w-3 h-3" style={{ color: 'var(--accent-sage)' }} /> : <Copy className="w-3 h-3" />}
                  {copiedTranslation ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-auto p-4">
              {translationText ? (
                <NotesRenderer text={translationText} />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center px-6">
                  <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                    <svg className="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium mb-2" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
                    Translate this page?
                  </h3>
                  <p className="text-sm mb-5 max-w-xs" style={{ color: 'var(--text-muted)' }}>
                    AI will transcribe and translate to English.
                  </p>
                  <button
                    onClick={() => handleProcess('all')}
                    disabled={processing !== null}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'var(--accent-rust, #c45d3a)' }}
                  >
                    {processing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {processing === 'ocr' ? 'Transcribing...' : 'Translating...'}
                      </>
                    ) : (
                      'Start Translation'
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Keyboard hint */}
        <div className="px-4 py-1.5 text-center text-xs hidden md:block" style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)' }}>
          Use ← → arrow keys to navigate pages
        </div>
      </div>
    );
  }

  // EDIT MODE - Full editing interface
  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--bg-warm)' }}>
      {/* Header */}
      <header className="px-6 py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href={`/book/${book.id}`} className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </a>
            <div>
              <h1 className="text-xl font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
                {book.display_title || book.title}
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Page {currentIndex + 1} of {pages.length}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Mode Toggle */}
            <div className="flex items-center rounded-lg p-1" style={{ background: 'var(--bg-warm)' }}>
              <button
                onClick={() => setMode('read')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all"
                style={{
                  background: 'transparent',
                  color: 'var(--text-muted)',
                }}
              >
                <Eye className="w-4 h-4" />
                Read
              </button>
              <button
                onClick={() => setMode('edit')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all"
                style={{
                  background: 'var(--bg-white)',
                  color: 'var(--text-primary)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                }}
              >
                <Pencil className="w-4 h-4" />
                Edit
              </button>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'var(--bg-warm)' }}>
              <button
                onClick={() => previousPage && onNavigate(previousPage.id)}
                disabled={!previousPage}
                className="p-2 rounded-md transition-all disabled:opacity-30"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{currentIndex + 1} / {pages.length}</span>
              <button
                onClick={() => nextPage && onNavigate(nextPage.id)}
                disabled={!nextPage}
                className="p-2 rounded-md transition-all disabled:opacity-30"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - Three Columns (stacked on mobile) */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Source Image Panel */}
        <div className="w-full md:w-1/3 flex flex-col" style={{ background: 'var(--bg-cream)', borderRight: '1px solid var(--border-light)' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2">
              <span className="label">Source</span>
              <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet)' }}>
                {book.language || 'Latin'}
              </span>
            </div>
            <div className="relative">
              <button
                onClick={() => setShowSplitOptions(!showSplitOptions)}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all hover:bg-stone-100"
                style={{ color: 'var(--text-muted)' }}
                title="Split two-page spread"
              >
                <Scissors className="w-3.5 h-3.5" />
                Split
              </button>
              {showSplitOptions && (
                <div
                  className="absolute right-0 top-full mt-1 z-50 rounded-lg shadow-lg py-2 min-w-[180px]"
                  style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}
                >
                  <div className="px-3 py-1.5 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    Split into two pages:
                  </div>
                  <button
                    onClick={() => handleSplitPage('left')}
                    disabled={splitting}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-stone-50 flex items-center gap-2 disabled:opacity-50"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {splitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />}
                    Keep left → Add right
                  </button>
                  <button
                    onClick={() => handleSplitPage('right')}
                    disabled={splitting}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-stone-50 flex items-center gap-2 disabled:opacity-50"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {splitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />}
                    Keep right → Add left
                  </button>
                  <div className="border-t my-1" style={{ borderColor: 'var(--border-light)' }} />
                  <button
                    onClick={() => setShowSplitOptions(false)}
                    className="w-full px-3 py-1.5 text-left text-xs hover:bg-stone-50"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-hidden p-4">
            <div className="relative w-full h-full rounded-lg overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              {page.photo ? (
                <ImageWithMagnifier src={page.photo} thumbnail={page.thumbnail || page.compressed_photo} alt={`Page ${page.page_number}`} />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
                  No image available
                </div>
              )}
            </div>
          </div>
        </div>

        {/* OCR Panel */}
        <div className="w-full md:w-1/3 flex flex-col" style={{ background: 'var(--bg-white)', borderRight: '1px solid var(--border-light)' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowOcrSettings(true)}
                className="btn-secondary"
                style={{ padding: '6px 12px' }}
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
              <button
                onClick={() => handleProcess('ocr')}
                disabled={processing !== null}
                className="btn-primary"
                style={{ padding: '6px 16px' }}
              >
                {processing === 'ocr' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Run OCR
              </button>
            </div>
          </div>

          <div className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>OCR Text</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{ocrText.length} chars</span>
          </div>

          <div className="flex-1 overflow-auto p-4">
            <textarea
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              onBlur={handleSave}
              className="w-full h-full p-0 border-0 resize-none leading-relaxed focus:outline-none focus:ring-0"
              style={{ fontFamily: 'Newsreader, Georgia, serif', color: 'var(--text-secondary)', fontSize: '16px', lineHeight: '1.75' }}
              placeholder="OCR text will appear here..."
            />
          </div>
        </div>

        {/* Translation Panel */}
        <div className="w-full md:w-1/3 flex flex-col" style={{ background: 'var(--bg-white)' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowTranslationSettings(true)}
                className="btn-secondary"
                style={{ padding: '6px 12px' }}
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
              <button
                onClick={() => handleProcess('translation')}
                disabled={processing !== null || !ocrText}
                className="btn-primary"
                style={{ padding: '6px 16px' }}
              >
                {processing === 'translation' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Translate
              </button>
            </div>
          </div>

          <div className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Translation</span>
              <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(139, 154, 125, 0.15)', color: 'var(--accent-sage)' }}>
                English
              </span>
            </div>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{translationText.length} chars</span>
          </div>

          <div className="flex-1 overflow-auto p-4">
            <textarea
              value={translationText}
              onChange={(e) => setTranslationText(e.target.value)}
              onBlur={handleSave}
              className="w-full h-full p-0 border-0 resize-none leading-relaxed focus:outline-none focus:ring-0"
              style={{ fontFamily: 'Newsreader, Georgia, serif', color: 'var(--text-secondary)', fontSize: '16px', lineHeight: '1.75' }}
              placeholder="Translation will appear here..."
            />
          </div>
        </div>
      </div>

      {/* Settings Modals */}
      <SettingsModal
        isOpen={showOcrSettings}
        onClose={() => setShowOcrSettings(false)}
        title="OCR Settings"
        promptType="ocr"
        selectedPromptId={selectedOcrPrompt?.id || selectedOcrPrompt?._id?.toString() || null}
        onSelectPrompt={setSelectedOcrPrompt}
      />

      <SettingsModal
        isOpen={showTranslationSettings}
        onClose={() => setShowTranslationSettings(false)}
        title="Translation Settings"
        promptType="translation"
        selectedPromptId={selectedTranslationPrompt?.id || selectedTranslationPrompt?._id?.toString() || null}
        onSelectPrompt={setSelectedTranslationPrompt}
      />
    </div>
  );
}
