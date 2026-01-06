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
  Columns,
  BookOpen,
  Maximize2,
  Image as ImageIcon,
  FileText,
  Languages,
  MessageSquare,
  RotateCcw,
  Scissors,
  Sparkles,
  MessageCircle,
  Share2,
  Highlighter,
  StickyNote
} from 'lucide-react';
import NotesRenderer from './NotesRenderer';
import FullscreenImageViewer from './FullscreenImageViewer';
import ImageWithMagnifier from './ImageWithMagnifier';
import PageMetadataPanel from './PageMetadataPanel';
import PageAssistant from './PageAssistant';
import HighlightsPanel from './HighlightsPanel';
import AnnotationPanel from './AnnotationPanel';
import HighlightSelection from './HighlightSelection';
import { BookShare } from './ShareButton';
import { GoogleTranslate } from './GoogleTranslate';
import LikeButton from './LikeButton';
import { getShortUrl } from '@/lib/shortlinks';
import type { Page, Book, Prompt, ContentSource } from '@/lib/types';
import { GEMINI_MODELS, DEFAULT_MODEL } from '@/lib/types';

// Helper to format edit source info
function EditSourceBadge({ source, editedBy, editedAt }: {
  source?: ContentSource;
  editedBy?: string;
  editedAt?: Date | string;
}) {
  if (!source) return null;

  const isManual = source === 'manual';
  const dateStr = editedAt ? new Date(editedAt).toLocaleDateString() : '';

  if (isManual) {
    return (
      <span
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
        style={{ background: 'rgba(139, 154, 125, 0.15)', color: 'var(--accent-sage)' }}
        title={`Edited by ${editedBy || 'unknown'}${dateStr ? ` on ${dateStr}` : ''}`}
      >
        <Pencil className="w-2.5 h-2.5" />
        Edited{editedBy ? ` by ${editedBy}` : ''}
      </span>
    );
  }

  return (
    <span
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ background: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet)' }}
      title="AI-generated content"
    >
      AI
    </span>
  );
}

interface TranslationEditorProps {
  book: Book;
  page: Page;
  pages: Page[];
  currentIndex: number;
  onNavigate: (pageId: string) => void;
  onSave: (data: { ocr?: string; translation?: string; summary?: string }) => Promise<void>;
  onRefresh?: () => Promise<void>;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  promptType: 'ocr' | 'translation' | 'summary';
  selectedPromptId: string | null;
  onSelectPrompt: (prompt: Prompt) => void;
  selectedModel: string;
  onSelectModel: (model: string) => void;
}

function SettingsModal({ isOpen, onClose, title, promptType, selectedPromptId, onSelectPrompt, selectedModel, onSelectModel }: SettingsModalProps) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [newPromptName, setNewPromptName] = useState('');
  const [creating, setCreating] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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

  const modalId = `settings-modal-${promptType}`;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${modalId}-title`}
        className="w-full max-w-3xl mx-4 rounded-xl shadow-2xl max-h-[90vh] flex flex-col"
        style={{ background: 'var(--bg-white)' }}
      >
        <div className="flex items-center justify-between p-5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <h2 id={`${modalId}-title`} className="text-lg font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-4 flex-1 overflow-auto">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="label block mb-2">AI Model</label>
              <select
                value={selectedModel}
                onChange={(e) => onSelectModel(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-sm"
                style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' }}
              >
                {GEMINI_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1">
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
          </div>

          <div className="flex-1 flex flex-col">
            <label className="label block mb-2">
              Prompt Text <span style={{ color: 'var(--text-faint)', fontWeight: 'normal', textTransform: 'none' }}>(use {'{language}'} as placeholders)</span>
            </label>
            <textarea
              value={editedContent}
              onChange={(e) => handleContentChange(e.target.value)}
              className="w-full min-h-[320px] px-3 py-2.5 rounded-lg text-sm font-mono resize-y"
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

export default function TranslationEditor({
  book,
  page,
  pages,
  currentIndex,
  onNavigate,
  onSave,
  onRefresh,
}: TranslationEditorProps) {
  const [ocrText, setOcrText] = useState(page.ocr?.data || '');
  const [translationText, setTranslationText] = useState(page.translation?.data || '');
  const [summaryText, setSummaryText] = useState(page.summary?.data || '');

  // Reset split state
  const [showResetSplitConfirm, setShowResetSplitConfirm] = useState(false);
  const [resettingSplit, setResettingSplit] = useState(false);

  // Check if this page is part of a split
  const isSplitPage = !!(page.crop || page.split_from);
  const originalPageId = page.split_from || page.id;
  const siblingPage = page.split_from
    ? pages.find(p => p.id === page.split_from) // This is the right half, find the left
    : pages.find(p => p.split_from === page.id); // This is the left half, find the right

  // Check if OCR/translation exists on either half (data loss warning)
  const hasDataOnSplit = !!(
    page.ocr?.data ||
    page.translation?.data ||
    siblingPage?.ocr?.data ||
    siblingPage?.translation?.data
  );

  // Reset the split
  const handleResetSplit = async () => {
    setResettingSplit(true);
    try {
      const res = await fetch(`/api/pages/${originalPageId}/reset`, { method: 'POST' });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Reset failed');
      }

      // Refresh the book data
      if (onRefresh) {
        await onRefresh();
      }

      // Navigate to the original (now unsplit) page or go back to book
      window.location.href = `/book/${book.id}/split`;
    } catch (error) {
      console.error('Reset split error:', error);
      alert(error instanceof Error ? error.message : 'Failed to reset split. Please try again.');
    } finally {
      setResettingSplit(false);
      setShowResetSplitConfirm(false);
    }
  };

  const [processing, setProcessing] = useState<'ocr' | 'translation' | 'summary' | 'all' | null>(null);
  const [mode, setMode] = useState<'read' | 'edit'>('read');

  const [showOcrSettings, setShowOcrSettings] = useState(false);
  const [showTranslationSettings, setShowTranslationSettings] = useState(false);

  const [selectedOcrPrompt, setSelectedOcrPrompt] = useState<Prompt | null>(null);
  const [selectedTranslationPrompt, setSelectedTranslationPrompt] = useState<Prompt | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);

  const [copiedTranslation, setCopiedTranslation] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  // Page Assistant state
  const [showAssistant, setShowAssistant] = useState(false);
  const [assistantMode, setAssistantMode] = useState<'explain' | 'ask'>('explain');

  // Panel visibility toggles for read mode (default: image + translation visible, OCR hidden)
  const [showImagePanel, setShowImagePanel] = useState(true);
  const [showNotes, setShowNotes] = useState(true); // Toggle for inline notes visibility
  const [showOcrPanel, setShowOcrPanel] = useState(false);
  const [showTranslationPanel, setShowTranslationPanel] = useState(true);
  const [showPageMetadata, setShowPageMetadata] = useState(false); // Toggle for page metadata panel

  // Highlights and Annotations panels
  const [showHighlights, setShowHighlights] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);

  // Swipe navigation state
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const previousPage = currentIndex > 0 ? pages[currentIndex - 1] : null;
  const nextPage = currentIndex < pages.length - 1 ? pages[currentIndex + 1] : null;

  // Build image URLs at different quality tiers
  // Tier 1: Thumbnail (150px) - for navigation, grid views
  // Tier 2: Display (1200px) - for main reading view
  // Tier 3: Full (2400px) - for magnifier, fullscreen
  const getImageUrl = (p: Page, tier: 'thumbnail' | 'display' | 'full' = 'display') => {
    const widths = { thumbnail: 150, display: 1200, full: 2400 };
    const qualities = { thumbnail: 60, display: 80, full: 90 };
    const width = widths[tier];
    const quality = qualities[tier];

    // Cast to access optional fields
    const pageData = p as unknown as Record<string, unknown>;
    const croppedPhoto = pageData.cropped_photo as string | undefined;
    const archivedPhoto = pageData.archived_photo as string | undefined;

    // If we have a pre-generated cropped photo (for split pages), use it directly
    if (p.crop && croppedPhoto) {
      return croppedPhoto;
    }

    // Prefer archived photo (Vercel Blob) for faster/reliable loading
    const baseUrl = archivedPhoto || p.photo_original || p.photo;
    if (!baseUrl) return '';

    // Build URL with crop parameters if available
    if (p.crop?.xStart !== undefined && p.crop?.xEnd !== undefined) {
      return `/api/image?url=${encodeURIComponent(baseUrl)}&w=${width}&q=${quality}&cx=${p.crop.xStart}&cw=${p.crop.xEnd}`;
    }

    // No crop - still go through image API for consistent sizing
    return `/api/image?url=${encodeURIComponent(baseUrl)}&w=${width}&q=${quality}`;
  };

  // URLs for current page at different quality tiers
  const pageFullUrl = getImageUrl(page, 'full');          // For magnifier (2400px, cropped if split)
  const pageDisplayUrl = getImageUrl(page, 'display');    // For main view (1200px)
  const pageThumbnailUrl = getImageUrl(page, 'thumbnail'); // For fast loading (400px)

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

  // Track page view
  useEffect(() => {
    fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'page_read',
        book_id: book.id,
        page_id: page.id
      }),
    }).catch(() => {}); // Fire and forget
  }, [book.id, page.id]);

  // Prefetch adjacent page images for faster navigation
  useEffect(() => {
    const getSmallImageUrl = (p: Page) => {
      if (p.thumbnail) return p.thumbnail;
      if (p.compressed_photo) return p.compressed_photo;
      // Use resize API for small version, prefer archived_photo
      const pageData = p as unknown as Record<string, unknown>;
      const baseUrl = (pageData.archived_photo as string) || p.photo;
      return `/api/image?url=${encodeURIComponent(baseUrl)}&w=150&q=60`;
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

  // Swipe navigation handlers (mobile only)
  const SWIPE_THRESHOLD = 50;
  const handleTouchStart = (e: React.TouchEvent) => {
    // Don't track if touching a scrollable area or interactive element
    const target = e.target as HTMLElement;
    if (target.closest('textarea, input, button, a, [data-no-swipe]')) return;

    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === 0) return;

    const deltaX = e.touches[0].clientX - touchStartX.current;
    const deltaY = e.touches[0].clientY - touchStartY.current;

    // Only track horizontal swipes (ignore vertical scrolling)
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      setIsSwiping(true);
      // Clamp the offset for visual feedback
      const maxOffset = 100;
      setSwipeOffset(Math.max(-maxOffset, Math.min(maxOffset, deltaX * 0.5)));
    }
  };

  const handleTouchEnd = () => {
    const deltaX = swipeOffset * 2; // Reverse the 0.5 multiplier

    if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
      if (deltaX > 0 && previousPage) {
        onNavigate(previousPage.id);
      } else if (deltaX < 0 && nextPage) {
        onNavigate(nextPage.id);
      }
    }

    // Reset swipe state
    touchStartX.current = 0;
    touchStartY.current = 0;
    setSwipeOffset(0);
    setIsSwiping(false);
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
          autoSave: true,
          model: selectedModel,
          promptInfo: {
            ocr: selectedOcrPrompt?.name,
            translation: selectedTranslationPrompt?.name
          }
        })
      });

      if (!response.ok) {
        throw new Error('Processing failed');
      }

      const result = await response.json();

      if (result.ocr) setOcrText(result.ocr);
      if (result.translation) setTranslationText(result.translation);
      if (result.summary) setSummaryText(result.summary);

      // Refresh parent data to sync page prop with new DB state
      // This prevents the useEffect from resetting state to stale prop values
      if (onRefresh) {
        await onRefresh();
      }
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

  // READ MODE - Always show 3 panels with step-by-step workflow
  if (mode === 'read') {
    // If both OCR and translation exist, show the completed reading view
    const isFullyTranslated = ocrText && translationText;

    return (
      <div className="h-screen flex flex-col" style={{ background: 'var(--bg-cream)' }}>
        {/* Compact Header */}
        <header className="px-4 py-2 flex items-center justify-between" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
          {/* Left: Back + Title */}
          <div className="flex items-center gap-3 min-w-0">
            <a href={`/book/${book.id}`} className="p-1.5 rounded-md hover:bg-stone-100 transition-colors flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
              <BookOpen className="w-5 h-5" />
            </a>
            <a href={`/book/${book.id}`} className="min-w-0 hover:opacity-70 transition-opacity">
              <h1 className="text-base font-medium truncate" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
                {book.display_title || book.title}
              </h1>
            </a>
          </div>

          {/* Center: Page Navigation */}
          <div className="flex items-center gap-0.5 sm:gap-1">
            <button
              onClick={() => previousPage && onNavigate(previousPage.id)}
              disabled={!previousPage}
              className="p-2.5 sm:p-2 rounded-lg hover:bg-stone-100 transition-all disabled:opacity-30 disabled:hover:bg-transparent min-w-[44px] min-h-[44px] flex items-center justify-center"
              style={{ color: 'var(--text-secondary)' }}
              title="Previous page (←)"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3">
              <span className="text-base sm:text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{currentIndex + 1}</span>
              <span className="text-xs sm:text-sm" style={{ color: 'var(--text-muted)' }}>of {pages.length}</span>
            </div>
            <button
              onClick={() => nextPage && onNavigate(nextPage.id)}
              disabled={!nextPage}
              className="p-2.5 sm:p-2 rounded-lg hover:bg-stone-100 transition-all disabled:opacity-30 disabled:hover:bg-transparent min-w-[44px] min-h-[44px] flex items-center justify-center"
              style={{ color: 'var(--text-secondary)' }}
              title="Next page (→)"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>

          {/* Right: Panel Toggles + Edit Button */}
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Panel visibility toggles - icon-only on mobile, with labels on larger screens */}
            <div className="flex items-center gap-0.5 p-1 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
              <button
                onClick={() => setShowImagePanel(!showImagePanel)}
                className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-2 sm:py-1.5 rounded-md text-xs font-medium transition-all min-w-[40px] sm:min-w-0 ${showImagePanel ? '' : 'opacity-50'}`}
                style={{
                  background: showImagePanel ? 'var(--bg-white)' : 'transparent',
                  color: showImagePanel ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: showImagePanel ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
                }}
                title="Toggle source image"
              >
                <ImageIcon className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">Image</span>
              </button>
              <button
                onClick={() => setShowOcrPanel(!showOcrPanel)}
                className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-2 sm:py-1.5 rounded-md text-xs font-medium transition-all min-w-[40px] sm:min-w-0 ${showOcrPanel ? '' : 'opacity-50'}`}
                style={{
                  background: showOcrPanel ? 'var(--bg-white)' : 'transparent',
                  color: showOcrPanel ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: showOcrPanel ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
                }}
                title="Toggle original text"
              >
                <FileText className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">OCR</span>
              </button>
              <button
                onClick={() => setShowTranslationPanel(!showTranslationPanel)}
                className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-2 sm:py-1.5 rounded-md text-xs font-medium transition-all min-w-[40px] sm:min-w-0 ${showTranslationPanel ? '' : 'opacity-50'}`}
                style={{
                  background: showTranslationPanel ? 'var(--bg-white)' : 'transparent',
                  color: showTranslationPanel ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: showTranslationPanel ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
                }}
                title="Toggle translation"
              >
                <Languages className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">English</span>
              </button>
            </div>

            {isSplitPage && (
              <button
                onClick={() => setShowResetSplitConfirm(true)}
                className="flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-md text-sm font-medium hover:bg-red-50 transition-all min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0"
                style={{ color: 'var(--text-muted)' }}
                title="Reset this split back to original two-page spread"
              >
                <RotateCcw className="w-4 h-4" />
                <span className="hidden sm:inline">Reset Split</span>
              </button>
            )}

            {/* Like, Share, Highlights, Annotations */}
            <div className="hidden sm:flex items-center gap-0.5 p-1 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
              <div className="p-1.5 rounded-md hover:bg-stone-100 transition-all">
                <LikeButton
                  targetType="page"
                  targetId={page.id}
                  size="sm"
                  showCount={true}
                />
              </div>
              <BookShare
                title={book.display_title || book.title}
                author={book.author}
                year={book.published}
                bookId={book.id}
                doi={book.doi}
                className="!p-1.5 !text-stone-500 hover:!text-stone-700 hover:!bg-stone-100"
              />
              <button
                onClick={() => setShowHighlights(true)}
                className="flex items-center gap-1.5 p-1.5 rounded-md text-xs font-medium transition-all hover:bg-stone-100"
                style={{ color: 'var(--text-muted)' }}
                title="View highlights"
              >
                <Highlighter className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowAnnotations(true)}
                className="flex items-center gap-1.5 p-1.5 rounded-md text-xs font-medium transition-all hover:bg-stone-100"
                style={{ color: 'var(--text-muted)' }}
                title="View annotations"
              >
                <StickyNote className="w-4 h-4" />
              </button>
            </div>

            {/* Google Translate */}
            <div className="hidden sm:block">
              <GoogleTranslate />
            </div>

            <button
              onClick={() => setMode('edit')}
              className="flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-md text-sm font-medium hover:bg-stone-100 transition-all min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0"
              style={{ color: 'var(--text-muted)' }}
            >
              <Pencil className="w-4 h-4" />
              <span className="hidden sm:inline">Edit</span>
            </button>
          </div>
        </header>

        {/* Panel layout - dynamic based on visibility */}
        {(() => {
          const visibleCount = [showImagePanel, showOcrPanel, showTranslationPanel].filter(Boolean).length;
          const panelWidth = visibleCount === 1 ? 'w-full' : visibleCount === 2 ? 'lg:w-1/2' : 'lg:w-1/3';

          return (
            <div
              className="flex-1 flex flex-col lg:flex-row overflow-hidden relative"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{
                transform: isSwiping ? `translateX(${swipeOffset}px)` : 'none',
                transition: isSwiping ? 'none' : 'transform 0.2s ease-out',
              }}
            >
              {/* Source Image Panel */}
              {showImagePanel && (
                <div className={`w-full ${panelWidth} flex flex-col h-48 lg:h-auto`} style={{ background: 'var(--bg-warm)', borderRight: '1px solid var(--border-light)' }}>
                  <div className="px-4 py-2 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Source Image</span>
                  </div>
                  <div className="flex-1 overflow-auto p-2 lg:p-4">
                    <div className="relative w-full rounded-lg overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                      {pageDisplayUrl ? (
                        <ImageWithMagnifier src={pageFullUrl} thumbnail={pageDisplayUrl} alt={`Page ${page.page_number}`} scrollable />
                      ) : (
                        <div className="w-full h-48 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
                          No image available
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* OCR Panel */}
              {showOcrPanel && (
                <div className={`w-full ${panelWidth} flex flex-col`} style={{ background: 'var(--bg-cream)', borderRight: '1px solid var(--border-light)' }}>
                  <div className="px-4 py-2 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                        {ocrText ? (book.language || 'Original') : 'Step 1: Transcribe'}
                      </span>
                      {ocrText && (
                        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent-sage)' }}>
                          <Check className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                    {ocrText && (
                      <EditSourceBadge
                        source={page.ocr?.source}
                        editedBy={page.ocr?.edited_by}
                        editedAt={page.ocr?.edited_at}
                      />
                    )}
                  </div>
                  <div className="flex-1 overflow-auto p-4 min-h-0">
                    {ocrText ? (
                      <div className="prose-manuscript text-sm leading-relaxed" style={{ fontFamily: 'Newsreader, Georgia, serif', color: 'var(--text-secondary)' }}>
                        <NotesRenderer key={`ocr-${showNotes}`} text={ocrText} showNotes={showNotes} showMetadata={false} language={book.language} />
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' }}>
                          <svg className="w-8 h-8" style={{ color: 'var(--accent-rust, #c45d3a)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-medium mb-2" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
                          Transcribe the {book.language || 'original text'}
                        </h3>
                        <p className="text-sm mb-4 max-w-xs" style={{ color: 'var(--text-muted)' }}>
                          AI will read the manuscript image and transcribe the original text. This may take a minute.
                        </p>
                        <button
                          onClick={() => handleProcess('ocr')}
                          disabled={processing !== null}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
                          style={{ background: 'var(--accent-rust, #c45d3a)' }}
                        >
                          {processing === 'ocr' ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Transcribing...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                              Start OCR
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Translation Panel */}
              {showTranslationPanel && (
                <div className={`w-full ${panelWidth} flex flex-col min-h-0 flex-1`} style={{ background: 'var(--bg-white)' }}>
                  <div className="px-4 py-2 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                        {translationText ? 'English' : 'Step 2: Translate'}
                      </span>
                      {translationText && (
                        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent-sage)' }}>
                          <Check className="w-3 h-3" />
                        </span>
                      )}
                      {translationText && (
                        <EditSourceBadge
                          source={page.translation?.source}
                          editedBy={page.translation?.edited_by}
                          editedAt={page.translation?.edited_at}
                        />
                      )}
                    </div>
                    {translationText && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setShowNotes(prev => !prev)}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                            showNotes
                              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                              : 'bg-stone-100 text-stone-400 hover:bg-stone-200'
                          }`}
                          title={showNotes ? "Hide notes and metadata" : "Show notes and metadata"}
                        >
                          <MessageSquare className="w-3 h-3" />
                          {showNotes ? 'Notes' : 'Notes Off'}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowPageMetadata(true);
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors bg-stone-100 hover:bg-stone-200"
                          style={{ color: 'var(--text-muted)' }}
                          title="View page metadata (models, timestamps, etc.)"
                        >
                          <FileText className="w-3 h-3" />
                          Info
                        </button>
                        <button
                          onClick={() => copyToClipboard(translationText)}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-stone-100"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {copiedTranslation ? <Check className="w-3 h-3" style={{ color: 'var(--accent-sage)' }} /> : <Copy className="w-3 h-3" />}
                          {copiedTranslation ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 overflow-auto p-4 min-h-0">
                    {translationText ? (
                      <HighlightSelection
                        bookId={book.id}
                        pageId={page.id}
                        pageNumber={page.page_number}
                        bookTitle={book.display_title || book.title}
                        bookAuthor={book.author}
                        bookYear={book.published}
                        doi={book.doi}
                      >
                        <NotesRenderer key={`trans-${showNotes}`} text={translationText} showNotes={showNotes} showMetadata={false} />
                      </HighlightSelection>
                    ) : ocrText ? (
                      <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)' }}>
                          <svg className="w-8 h-8" style={{ color: 'var(--accent-sage, #6b8a63)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-medium mb-2" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
                          Ready to translate
                        </h3>
                        <p className="text-sm mb-4 max-w-xs" style={{ color: 'var(--text-muted)' }}>
                          OCR complete! Now translate the {book.language || 'text'} into English.
                        </p>
                        <button
                          onClick={() => handleProcess('translation')}
                          disabled={processing !== null}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
                          style={{ background: 'var(--accent-sage, #6b8a63)' }}
                        >
                          {processing === 'translation' ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Translating...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                              Translate to English
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--bg-warm, #f5f3f0)' }}>
                          <svg className="w-8 h-8" style={{ color: 'var(--text-faint, #c4c0b8)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-medium mb-2" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-muted)' }}>
                          Complete OCR first
                        </h3>
                        <p className="text-sm max-w-xs" style={{ color: 'var(--text-faint)' }}>
                          The original text needs to be transcribed before it can be translated.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* AI Assistant action bar - only show when translation exists */}
                  {translationText && (
                    <div
                      className="px-4 py-2 flex items-center justify-center gap-2 flex-shrink-0"
                      style={{ borderTop: '1px solid var(--border-light)', background: 'var(--bg-cream)' }}
                    >
                      <button
                        onClick={() => {
                          setAssistantMode('explain');
                          setShowAssistant(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:bg-violet-50"
                        style={{ color: 'var(--accent-violet)' }}
                      >
                        <Sparkles className="w-4 h-4" />
                        Explain
                      </button>
                      <button
                        onClick={() => {
                          setAssistantMode('ask');
                          setShowAssistant(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:bg-violet-50"
                        style={{ color: 'var(--accent-violet)' }}
                      >
                        <MessageCircle className="w-4 h-4" />
                        Ask AI
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Empty state when no panels visible */}
              {visibleCount === 0 && (
                <div className="flex-1 flex items-center justify-center" style={{ background: 'var(--bg-cream)' }}>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select a panel to view</p>
                </div>
              )}
            </div>
          );
        })()}

        {/* Navigation hint + CC0 footer */}
        <div className="px-4 py-1.5 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-4 text-xs" style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)' }}>
          <span className="hidden lg:inline">Use ← → arrow keys to navigate</span>
          <span className="lg:hidden">Swipe left/right to navigate</span>
          <span className="hidden sm:inline">•</span>
          <span className="flex items-center gap-2">
            CC0 Public Domain
            <span className="hidden sm:inline">•</span>
            <a href="mailto:derek@ancientwisdomtrust.org" className="hover:underline" style={{ color: 'var(--accent-rust)' }}>
              derek@ancientwisdomtrust.org
            </a>
          </span>
        </div>

        {/* Page Assistant Modal */}
        <PageAssistant
          isOpen={showAssistant}
          onClose={() => setShowAssistant(false)}
          initialMode={assistantMode}
          page={page}
          book={book}
          onOpenAnnotations={() => setShowAnnotations(true)}
        />

        {/* Page Metadata Panel */}
        {showPageMetadata && (
          <PageMetadataPanel
            page={page}
            onClose={() => setShowPageMetadata(false)}
          />
        )}

        {/* Highlights Panel */}
        <HighlightsPanel
          bookId={book.id}
          isOpen={showHighlights}
          onClose={() => setShowHighlights(false)}
        />

        {/* Annotations Panel */}
        <AnnotationPanel
          bookId={book.id}
          pageId={page.id}
          pageNumber={page.page_number}
          bookTitle={book.display_title || book.title}
          bookAuthor={book.author}
          isOpen={showAnnotations}
          onClose={() => setShowAnnotations(false)}
        />

        {/* Reset Split Confirmation Modal (read mode) */}
        {showResetSplitConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="reset-split-title-read"
              className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' }}>
                  <RotateCcw className="w-5 h-5" style={{ color: 'var(--accent-rust, #c45d3a)' }} aria-hidden="true" />
                </div>
                <h3 id="reset-split-title-read" className="text-lg font-semibold" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
                  Reset Split?
                </h3>
              </div>

              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                This will merge this page back with its other half into a single two-page spread.
              </p>

              {hasDataOnSplit && (
                <div className="rounded-lg p-3 mb-4" style={{ background: 'rgb(254 243 199)', border: '1px solid rgb(251 191 36)' }}>
                  <p className="text-sm font-medium" style={{ color: 'rgb(146 64 14)' }}>
                    ⚠️ Warning: OCR or translation data exists
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'rgb(180 83 9)' }}>
                    Resetting will delete the right page and its OCR/translation. The left page data will remain but may not match the full image.
                  </p>
                </div>
              )}

              <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                You&apos;ll be taken to the Split page where you can re-split with a different position if needed.
              </p>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowResetSplitConfirm(false)}
                  disabled={resettingSplit}
                  className="px-4 py-2 text-sm font-medium rounded-lg transition-colors hover:bg-stone-100"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleResetSplit}
                  disabled={resettingSplit}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'rgb(220 38 38)' }}
                >
                  {resettingSplit ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4" />
                      Reset Split
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
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
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Page {currentIndex + 1} of {pages.length}
                {page.read_count ? <span className="ml-2 text-xs opacity-60">({page.read_count} views)</span> : null}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Panel visibility toggles - icon-only on mobile */}
            <div className="flex items-center gap-0.5 p-1 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
              <button
                onClick={() => setShowImagePanel(!showImagePanel)}
                className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-2 sm:py-1.5 rounded-md text-xs font-medium transition-all min-w-[40px] sm:min-w-0 ${showImagePanel ? '' : 'opacity-50'}`}
                style={{
                  background: showImagePanel ? 'var(--bg-white)' : 'transparent',
                  color: showImagePanel ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: showImagePanel ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
                }}
                title="Toggle source image"
              >
                <ImageIcon className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">Image</span>
              </button>
              <button
                onClick={() => setShowOcrPanel(!showOcrPanel)}
                className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-2 sm:py-1.5 rounded-md text-xs font-medium transition-all min-w-[40px] sm:min-w-0 ${showOcrPanel ? '' : 'opacity-50'}`}
                style={{
                  background: showOcrPanel ? 'var(--bg-white)' : 'transparent',
                  color: showOcrPanel ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: showOcrPanel ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
                }}
                title="Toggle OCR panel"
              >
                <FileText className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">OCR</span>
              </button>
              <button
                onClick={() => setShowTranslationPanel(!showTranslationPanel)}
                className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-2 sm:py-1.5 rounded-md text-xs font-medium transition-all min-w-[40px] sm:min-w-0 ${showTranslationPanel ? '' : 'opacity-50'}`}
                style={{
                  background: showTranslationPanel ? 'var(--bg-white)' : 'transparent',
                  color: showTranslationPanel ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: showTranslationPanel ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
                }}
                title="Toggle translation panel"
              >
                <Languages className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">English</span>
              </button>
            </div>

            {/* Mode Toggle */}
            <div className="hidden sm:flex items-center rounded-lg p-1" style={{ background: 'var(--bg-warm)' }}>
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

            {/* Like Button */}
            <div className="p-1.5 rounded-lg hover:bg-stone-100 transition-all">
              <LikeButton
                targetType="page"
                targetId={page.id}
                size="sm"
                showCount={true}
              />
            </div>

            {/* Info Button */}
            <button
              onClick={() => setShowPageMetadata(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:bg-stone-100"
              style={{ color: 'var(--text-muted)' }}
              title="View page metadata"
            >
              <FileText className="w-4 h-4" />
              Info
            </button>
          </div>
        </div>
      </header>

      {/* Main Content - Panels toggle visibility, stacked on mobile, columns on desktop */}
      {/* On mobile: panels have min-height and container scrolls. On desktop: panels share space */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-auto lg:overflow-hidden">
        {/* Source Image Panel */}
        {showImagePanel && (
          <div className="w-full min-h-[50vh] lg:min-h-0 lg:flex-1 flex flex-col shrink-0 lg:shrink" style={{ background: 'var(--bg-cream)', borderRight: '1px solid var(--border-light)' }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="label">Source</span>
              <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet)' }}>
                {book.language || 'Latin'}
              </span>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="relative w-full rounded-lg overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                {pageDisplayUrl ? (
                  <ImageWithMagnifier src={pageFullUrl} thumbnail={pageDisplayUrl} alt={`Page ${page.page_number}`} scrollable />
                ) : (
                  <div className="w-full h-48 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
                    No image available
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* OCR Panel */}
        {showOcrPanel && (
          <div className="w-full min-h-[50vh] lg:min-h-0 lg:flex-1 flex flex-col shrink-0 lg:shrink" style={{ background: 'var(--bg-white)', borderRight: '1px solid var(--border-light)' }}>
            <div className="px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  onClick={() => setShowOcrSettings(true)}
                  className="btn-secondary flex items-center justify-center gap-1.5 min-w-[40px] sm:min-w-0"
                  style={{ padding: '6px 10px' }}
                  title="Edit OCR Prompt"
                >
                  <Pencil className="w-4 h-4" />
                  <span className="hidden sm:inline">Edit Prompt</span>
                </button>
                <button
                  onClick={() => handleProcess('ocr')}
                  disabled={processing !== null}
                  className="btn-primary flex items-center justify-center gap-1.5 min-w-[40px] sm:min-w-0"
                  style={{ padding: '6px 12px' }}
                  title="Run OCR"
                >
                  {processing === 'ocr' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : null}
                  <span className="hidden sm:inline">Run</span> OCR
                </button>
              </div>
            </div>

            <div className="px-3 sm:px-4 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>OCR Text</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{ocrText.length} chars</span>
            </div>

            <div className="flex-1 overflow-auto p-3 sm:p-4">
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
        )}

        {/* Translation Panel */}
        {showTranslationPanel && (
          <div className="w-full min-h-[50vh] lg:min-h-0 lg:flex-1 flex flex-col shrink-0 lg:shrink" style={{ background: 'var(--bg-white)' }}>
            <div className="px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  onClick={() => setShowTranslationSettings(true)}
                  className="btn-secondary flex items-center justify-center gap-1.5 min-w-[40px] sm:min-w-0"
                  style={{ padding: '6px 10px' }}
                  title="Edit Translation Prompt"
                >
                  <Pencil className="w-4 h-4" />
                  <span className="hidden sm:inline">Edit Prompt</span>
                </button>
                <button
                  onClick={() => handleProcess('translation')}
                  disabled={processing !== null || !ocrText}
                  className="btn-primary flex items-center justify-center gap-1.5 min-w-[40px] sm:min-w-0"
                  style={{ padding: '6px 12px' }}
                  title="Translate"
                >
                  {processing === 'translation' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : null}
                  Translate
                </button>
              </div>
            </div>

            <div className="px-3 sm:px-4 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Translation</span>
              <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(139, 154, 125, 0.15)', color: 'var(--accent-sage)' }}>
                English
              </span>
            </div>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{translationText.length} chars</span>
          </div>

          <div className="flex-1 overflow-auto p-3 sm:p-4">
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
        )}
      </div>

      {/* CC0 Footer */}
      <div className="px-4 py-1.5 flex items-center justify-center gap-2 text-xs" style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)' }}>
        <span>CC0 Public Domain</span>
        <span>•</span>
        <a href="mailto:derek@ancientwisdomtrust.org" className="hover:underline" style={{ color: 'var(--accent-rust)' }}>
          derek@ancientwisdomtrust.org
        </a>
      </div>

      {/* Settings Modals */}
      <SettingsModal
        isOpen={showOcrSettings}
        onClose={() => setShowOcrSettings(false)}
        title="OCR Settings"
        promptType="ocr"
        selectedPromptId={selectedOcrPrompt?.id || selectedOcrPrompt?._id?.toString() || null}
        onSelectPrompt={setSelectedOcrPrompt}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
      />

      <SettingsModal
        isOpen={showTranslationSettings}
        onClose={() => setShowTranslationSettings(false)}
        title="Translation Settings"
        promptType="translation"
        selectedPromptId={selectedTranslationPrompt?.id || selectedTranslationPrompt?._id?.toString() || null}
        onSelectPrompt={setSelectedTranslationPrompt}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
      />

      {/* How It Works Modal */}
      {showHowItWorks && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="how-it-works-title"
            className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: 'var(--bg-white)' }}
          >
            {/* Header */}
            <div className="px-6 py-5 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' }}>
              <h2 id="how-it-works-title" className="text-xl font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
                How Translation Works
              </h2>
              <button onClick={() => setShowHowItWorks(false)} aria-label="Close dialog" className="p-1 rounded-full hover:bg-white/50 transition-colors" style={{ color: 'var(--text-secondary)' }}>
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Process Diagram */}
              <div className="flex items-center justify-between gap-2 py-4">
                {/* Step 1: Image */}
                <div className="flex flex-col items-center text-center flex-1">
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-2" style={{ background: 'var(--bg-warm)', border: '2px solid var(--border-medium)' }}>
                    <svg className="w-7 h-7" style={{ color: 'var(--accent-violet)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Manuscript</span>
                </div>

                <svg className="w-6 h-6 flex-shrink-0" style={{ color: 'var(--text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>

                {/* Step 2: OCR */}
                <div className="flex flex-col items-center text-center flex-1">
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-2" style={{ background: 'var(--bg-warm)', border: '2px solid var(--border-medium)' }}>
                    <svg className="w-7 h-7" style={{ color: 'var(--accent-sage)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Transcription</span>
                </div>

                <svg className="w-6 h-6 flex-shrink-0" style={{ color: 'var(--text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>

                {/* Step 3: Translation */}
                <div className="flex flex-col items-center text-center flex-1">
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-2" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', border: '2px solid var(--accent-rust)' }}>
                    <svg className="w-7 h-7" style={{ color: 'var(--accent-rust)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                    </svg>
                  </div>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Translation</span>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-4" style={{ fontFamily: 'Newsreader, Georgia, serif' }}>
                <p className="text-base leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Our AI-powered translation uses <strong>Gemini 2.0 Flash</strong> to read and understand historical manuscripts. The process happens in two stages:
                </p>
                <ol className="space-y-3 text-base" style={{ color: 'var(--text-secondary)' }}>
                  <li className="flex gap-3">
                    <span className="font-bold" style={{ color: 'var(--accent-sage)' }}>1.</span>
                    <span><strong>Transcription</strong> — The AI reads the manuscript image and produces the original {book.language || 'text'}, preserving special characters and formatting.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-bold" style={{ color: 'var(--accent-rust)' }}>2.</span>
                    <span><strong>Translation</strong> — The transcribed text is translated into clear, readable English while maintaining the meaning and style of the original.</span>
                  </li>
                </ol>
              </div>

              {/* How to Help */}
              <div className="rounded-xl p-5" style={{ background: 'var(--bg-cream)', border: '1px solid var(--border-light)' }}>
                <h3 className="text-base font-medium mb-3" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
                  How You Can Help
                </h3>
                <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <li className="flex gap-2">
                    <span style={{ color: 'var(--accent-rust)' }}>•</span>
                    <span><strong>Review translations</strong> — Switch to Edit mode to correct any errors in the transcription or translation.</span>
                  </li>
                  <li className="flex gap-2">
                    <span style={{ color: 'var(--accent-rust)' }}>•</span>
                    <span><strong>Improve prompts</strong> — Use the Settings to refine the AI prompts for better results.</span>
                  </li>
                  <li className="flex gap-2">
                    <span style={{ color: 'var(--accent-rust)' }}>•</span>
                    <span><strong>Share knowledge</strong> — Your corrections help improve future translations.</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4" style={{ borderTop: '1px solid var(--border-light)' }}>
              <button
                onClick={() => setShowHowItWorks(false)}
                className="w-full py-3 rounded-lg font-medium text-white transition-all hover:opacity-90"
                style={{ background: 'var(--accent-rust, #c45d3a)' }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Split Confirmation Modal */}
      {showResetSplitConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-split-title"
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' }}>
                <RotateCcw className="w-5 h-5" style={{ color: 'var(--accent-rust, #c45d3a)' }} aria-hidden="true" />
              </div>
              <h3 id="reset-split-title" className="text-lg font-semibold" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
                Reset Split?
              </h3>
            </div>

            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              This will merge this page back with its other half into a single two-page spread.
            </p>

            {hasDataOnSplit && (
              <div className="rounded-lg p-3 mb-4" style={{ background: 'rgb(254 243 199)', border: '1px solid rgb(251 191 36)' }}>
                <p className="text-sm font-medium" style={{ color: 'rgb(146 64 14)' }}>
                  ⚠️ Warning: OCR or translation data exists
                </p>
                <p className="text-xs mt-1" style={{ color: 'rgb(180 83 9)' }}>
                  Resetting will delete the right page and its OCR/translation. The left page data will remain but may not match the full image.
                </p>
              </div>
            )}

            <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
              You&apos;ll be taken to the Split page where you can re-split with a different position if needed.
            </p>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowResetSplitConfirm(false)}
                disabled={resettingSplit}
                className="px-4 py-2 text-sm font-medium rounded-lg transition-colors hover:bg-stone-100"
                style={{ color: 'var(--text-muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleResetSplit}
                disabled={resettingSplit}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: 'rgb(220 38 38)' }}
              >
                {resettingSplit ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    Reset Split
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page Metadata Panel */}
      {showPageMetadata && (
        <PageMetadataPanel
          page={page}
          onClose={() => setShowPageMetadata(false)}
        />
      )}
    </div>
  );
}
