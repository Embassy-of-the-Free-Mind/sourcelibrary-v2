'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import Logo from '@/components/layout/Logo';
import RevisionHistory from '@/components/reader/RevisionHistory';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
  Eye,
  Pencil,
  Copy,
  Check,
  Image as ImageIcon,
  FileText,
  Languages,
  MessageSquare,
  RotateCcw,
  Search,
  Info,
  Type
} from 'lucide-react';
import { useReaderPreferences } from '@/hooks/useReaderPreferences';
import NotesRenderer from '@/components/reader/NotesRenderer';
import ImageWithMagnifier from '@/components/ui/ImageWithMagnifier';
import PageMetadataPanel from '@/components/reader/PageMetadataPanel';
import HighlightedText from '@/components/search/HighlightedText';
import HighlightSelection from '@/components/annotations/HighlightSelection';
import ChapterDropdown from '@/components/reader/ChapterDropdown';
import ShareButton from '@/components/ui/ShareButton';
import CiteButton from '@/components/ui/CiteButton';
import { prompts as promptsApi, analytics, pages as pagesApi, processing as processingApi } from '@/lib/api-client';
import LikeButton from '@/components/ui/LikeButton';
import { getShortUrl } from '@/lib/shortlinks';
import type { Page, Book, Prompt, ContentSource } from '@/lib/types';
import { GEMINI_MODELS, DEFAULT_MODEL } from '@/lib/types';
import { AuthCheck } from '../auth/AuthCheck';
import TranslationFeedbackPrompt from '@/components/feedback/TranslationFeedbackPrompt';

// Languages that use non-Latin scripts and benefit from transliteration
const NON_LATIN_LANGUAGES = new Set([
  'greek', 'hebrew', 'arabic', 'persian', 'ottoman turkish',
  'syriac', 'chinese', 'japanese', 'korean', 'sanskrit',
  'armenian', 'georgian', 'ethiopic', 'coptic', 'tibetan',
  'russian', 'church slavonic'
]);

function hasNonLatinScript(language?: string): boolean {
  if (!language) return false;
  return NON_LATIN_LANGUAGES.has(language.toLowerCase());
}

// Helper to format edit source info
// EditSourceBadge removed — source info folded into RevisionHistory trigger

// Inline book search bar for the page reader footer
function BookSearchBar({ bookId }: { bookId: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ pageId: string; pageNumber: number; matches: Array<{ field: string; snippet: string }> }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setShowResults(false); return; }
    setShowResults(true);
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/books/${bookId}/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results || []);
        }
      } catch { /* ignore */ }
      finally { setIsSearching(false); }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, bookId]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className="relative max-w-md mx-auto w-full">
      <div className="flex items-center gap-1.5 px-2 py-1 rounded" style={{ background: 'rgba(0,0,0,0.05)' }}>
        {isSearching ? (
          <Loader2 className="w-3 h-3 animate-spin" style={{ color: 'var(--text-muted)' }} />
        ) : (
          <Search className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
        )}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim() && setShowResults(true)}
          placeholder="Search this book..."
          aria-label="Search within this book"
          className="bg-transparent outline-none text-xs w-full"
          style={{ color: 'var(--text-primary)' }}
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); setShowResults(false); }} aria-label="Clear search">
            <X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          </button>
        )}
      </div>
      {showResults && query.trim() && (
        <div
          className="absolute bottom-full left-0 right-0 mb-1 rounded-lg shadow-xl overflow-hidden z-50"
          style={{ background: 'var(--bg-white, #fff)', border: '1px solid var(--border-light)', maxHeight: '300px', overflowY: 'auto' }}
          role="listbox"
          aria-label="Search results"
        >
          {isSearching ? (
            <div className="p-3 text-center text-xs" role="status" style={{ color: 'var(--text-muted)' }}>Searching...</div>
          ) : results.length === 0 ? (
            <div className="p-3 text-center text-xs" role="status" style={{ color: 'var(--text-muted)' }}>No results for &quot;{query}&quot;</div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
              {results.slice(0, 10).map((r) => (
                <a
                  key={r.pageId}
                  href={`/book/${bookId}/page/${r.pageId}?highlight=${encodeURIComponent(query.trim())}`}
                  className="block px-3 py-2 hover:bg-stone-50 transition-colors"
                >
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Page {r.pageNumber}</span>
                  {r.matches?.[0] && (
                    <p
                      className="text-xs mt-0.5 line-clamp-1"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <HighlightedText text={r.matches[0].snippet} query={query} />
                    </p>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
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
      const data = await promptsApi.list({ type: promptType });
      setPrompts(data);
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
    if (!selectedPrompt || (!selectedPrompt.id && !selectedPrompt._id) || !hasChanges) return;
    setSaving(true);
    try {
      const promptId = selectedPrompt.id || selectedPrompt._id?.toString();
      if (!promptId) return;
      const updated = await promptsApi.update(promptId, {
        content: editedContent
      });
      setPrompts(prompts.map(p =>
        (p.id === updated.id || p._id?.toString() === updated.id) ? updated : p
      ));
      setSelectedPrompt(updated);
      setHasChanges(false);
      onSelectPrompt(updated);
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
      const newPrompt = await promptsApi.create({
        name: newPromptName.trim(),
        type: promptType,
        content: editedContent,
      });
      setPrompts([...prompts, newPrompt]);
      setSelectedPrompt(newPrompt);
      setNewPromptName('');
      setHasChanges(false);
      onSelectPrompt(newPrompt);
    } catch (error) {
      console.error('Failed to create prompt:', error);
    } finally {
      setCreating(false);
    }
  };

  if (!isOpen) return null;

  const modalId = `settings-modal-${promptType}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${modalId}-title`}
        className="w-full max-w-3xl mx-4 rounded-xl shadow-2xl max-h-[90vh] flex flex-col"
        style={{ background: 'var(--bg-white)' }}
      >
        <div className="flex items-center justify-between p-5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <h2 id={`${modalId}-title`} className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>{title}</h2>
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
  const { fontSize, lineHeight, increaseFontSize, decreaseFontSize, resetFontSize, isMinSize, isMaxSize, isDefaultSize } = useReaderPreferences();

  // Translation request (guest users)
  const [translationRequested, setTranslationRequested] = useState(false);

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
  // Use updated_at instead of .data — sibling pages come from the lightweight list
  // which excludes text fields but retains timestamps
  const hasDataOnSplit = !!(
    page.ocr?.data || page.ocr?.updated_at ||
    page.translation?.data || page.translation?.updated_at ||
    siblingPage?.ocr?.updated_at ||
    siblingPage?.translation?.updated_at
  );

  // Reset the split
  const handleResetSplit = async () => {
    setResettingSplit(true);
    try {
      await pagesApi.resetSplit(originalPageId);

      // Refresh the book data
      if (onRefresh) {
        await onRefresh();
      }

      // Navigate to the original (now unsplit) page or go back to book
      window.location.href = `/book/${book.id}/split`;
    } catch (error) {
      console.error('Reset split error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to reset split. Please try again.');
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

  // Panel visibility toggles for read mode (default: image + translation visible, OCR hidden)
  const [showImagePanel, setShowImagePanel] = useState(true);
  const [showNotes, setShowNotes] = useState(true); // Toggle for inline notes visibility
  const [showOcrPanel, setShowOcrPanel] = useState(false);
  const [showTranslationPanel, setShowTranslationPanel] = useState(true);
  const [showTransliterationPanel, setShowTransliterationPanel] = useState(false);
  const [transliterationText, setTransliterationText] = useState('');
  const [transliterationLoading, setTransliterationLoading] = useState(false);
  const [showPageMetadata, setShowPageMetadata] = useState(false); // Toggle for page metadata panel
  const [showFontControls, setShowFontControls] = useState(false);
  const fontControlsRef = useRef<HTMLDivElement>(null);

  // Highlights and Annotations panels

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

    // New path convention: pages/{bookId}/{0001}.jpg, -full.jpg, -thumb.jpg
    // If photo matches this pattern, derive other sizes by convention
    const newPathMatch = p.photo?.match(/^(https:\/\/images\.sourcelibrary\.org\/pages\/[^/]+\/\d{4,})(-full)?\.jpg$/);
    if (newPathMatch) {
      const base = newPathMatch[1];
      if (tier === 'full') return `${base}-full.jpg`;
      if (tier === 'thumbnail') return `${base}-thumb.jpg`;
      return `${base}.jpg`; // display — falls back to full if display not generated yet
    }

    // Legacy: pre-generated cropped photo (split pages) — use directly
    if (p.crop && p.cropped_photo) {
      return p.cropped_photo;
    }

    // Legacy: prefer archived photo, then original sources
    const baseUrl = p.archived_photo || p.photo_original || p.photo;
    if (!baseUrl) return '';

    // Cropping requires the image proxy for server-side crop
    if (p.crop?.xStart !== undefined && p.crop?.xEnd !== undefined) {
      return `/api/image?url=${encodeURIComponent(baseUrl)}&w=${width}&q=${quality}&cx=${p.crop.xStart}&cw=${p.crop.xEnd}`;
    }

    // Archived images: full quality direct from CDN, display/thumbnail via proxy for resize
    if (p.archived_photo) {
      if (tier === 'full') {
        return p.archived_photo;
      }
      return `/api/image?url=${encodeURIComponent(p.archived_photo)}&w=${width}&q=${quality}`;
    }

    // External sources: proxy for resize/optimization
    return `/api/image?url=${encodeURIComponent(baseUrl)}&w=${width}&q=${quality}`;
  };

  // URLs for current page at different quality tiers
  const pageFullUrl = getImageUrl(page, 'full');       // For magnifier (2400px, cropped if split)
  const pageDisplayUrl = getImageUrl(page, 'display'); // For main view (1200px)

  // CDLI tablet witnesses (for text-only ETCSL books)
  const witnessesWithPhotos = useMemo(
    () => (book.cdli_witnesses || []).filter(w => w.has_photo && w.photo_url),
    [book.cdli_witnesses]
  );
  const [currentWitnessIndex, setCurrentWitnessIndex] = useState(0);
  const currentWitness = witnessesWithPhotos[currentWitnessIndex];
  const hasWitnessPhotos = witnessesWithPhotos.length > 0;

  // Text-only books (e.g. ETCSL corpus): show OCR panel instead of empty image panel
  // Exception: if CDLI witnesses with photos exist, keep image panel on to show tablet photos
  const hasPageImage = !!pageDisplayUrl;
  const textOnlyInitialized = useRef(false);
  useEffect(() => {
    if (!hasPageImage && !textOnlyInitialized.current) {
      textOnlyInitialized.current = true;
      if (hasWitnessPhotos) {
        // Has tablet photos — show image panel + OCR + translation (three-panel)
        setShowImagePanel(true);
        setShowOcrPanel(true);
      } else {
        setShowImagePanel(false);
        setShowOcrPanel(true);
      }
    }
  }, [hasPageImage, hasWitnessPhotos]);

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

  // Font size keyboard shortcuts (Cmd+=/Cmd+-/Cmd+0)
  useEffect(() => {
    const handleFontKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        increaseFontSize();
      } else if (e.key === '-') {
        e.preventDefault();
        decreaseFontSize();
      } else if (e.key === '0') {
        e.preventDefault();
        resetFontSize();
      }
    };
    window.addEventListener('keydown', handleFontKey);
    return () => window.removeEventListener('keydown', handleFontKey);
  }, [increaseFontSize, decreaseFontSize, resetFontSize]);

  // Close font controls popover on click outside
  useEffect(() => {
    if (!showFontControls) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (fontControlsRef.current && !fontControlsRef.current.contains(e.target as Node)) {
        setShowFontControls(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFontControls]);

  // Transliteration: only show panel when page has transliteration data
  const isNonLatin = hasNonLatinScript(book.language);
  const hasTransliteration = !!(page.transliteration?.data || transliterationText);
  useEffect(() => {
    if (!showTransliterationPanel || !isNonLatin || !page.ocr?.data) return;
    // Check for cached transliteration first
    if (page.transliteration?.data) {
      setTransliterationText(page.transliteration.data);
      return;
    }
    let cancelled = false;
    setTransliterationLoading(true);
    pagesApi.transliterate(page.id)
      .then((res) => {
        if (!cancelled) setTransliterationText(res.transliteration || '');
      })
      .catch((err) => {
        if (!cancelled) toast.error(`Transliteration failed: ${err.message || 'Unknown error'}`);
      })
      .finally(() => {
        if (!cancelled) setTransliterationLoading(false);
      });
    return () => { cancelled = true; };
  }, [showTransliterationPanel, page.id, isNonLatin, page.ocr?.data, page.transliteration?.data]);

  // Reset transliteration text when page changes
  useEffect(() => {
    setTransliterationText(page.transliteration?.data || '');
  }, [page.id, page.transliteration?.data]);

  // Detect multi-column structure in OCR (either <column-break/> or ## Column N headers)
  const ocrHasMultiColumn = useMemo(() => {
    const ocr = page.ocr?.data || '';
    return ocr.includes('<column-break/>') || /^## Column \d+/m.test(ocr);
  }, [page.ocr?.data]);

  // Derive column count from OCR if page.columns is not set
  const effectiveColumns = useMemo(() => {
    if (page.columns) return page.columns;
    if (!ocrHasMultiColumn) return undefined;
    const ocr = page.ocr?.data || '';
    const matches = ocr.match(/^## Column \d+/gm);
    return matches ? matches.length : undefined;
  }, [page.columns, ocrHasMultiColumn, page.ocr?.data]);

  // Strip hallucinated <column-break/> from transliteration when OCR doesn't have multi-column
  const cleanTransliteration = useMemo(() => {
    if (!transliterationText) return '';
    if (ocrHasMultiColumn) return transliterationText;
    return transliterationText.replace(/<column-break\s*\/?>/g, '');
  }, [transliterationText, ocrHasMultiColumn]);

  // Track page view
  useEffect(() => {
    analytics.track(
      {
        event: 'page_read',
        book_id: book.id,
        page_id: page.id
      }
    ).catch(() => { }); // Fire and forget
  }, [book.id, page.id]);

  // Prefetch adjacent page images for faster navigation
  useEffect(() => {
    const getSmallImageUrl = (p: Page) => {
      if (p.thumbnail) return p.thumbnail;
      if (p.archived_photo) return `/api/image?url=${encodeURIComponent(p.archived_photo)}&w=150&q=60`;
      const baseUrl = p.photo_original || p.photo;
      return baseUrl ? `/api/image?url=${encodeURIComponent(baseUrl)}&w=150&q=60` : '';
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
    // Reset scroll on all content panels
    document.querySelectorAll('[data-reader-panel]').forEach(el => {
      el.scrollTop = 0;
    });
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

      const result = await processingApi.process({
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
      });

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
      toast.error('Processing failed. Please try again.');
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
        {/* Header - Two rows on mobile, one row on desktop */}
        <header className="px-3 sm:px-4 py-2 sm:py-3" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
          {/* Row 1: Back + Title ... Chapter Nav ... Page Navigator */}
          <div className="flex items-center justify-between gap-2 relative">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              <Logo mini />
              <span className="text-sm shrink-0" style={{ color: 'var(--text-muted)' }} aria-hidden="true">/</span>
              <a href={`/book/${book.id}`} className="min-w-0 hover:opacity-70 transition-opacity">
                <h1 className="text-sm sm:text-base font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {book.display_title || book.title}
                </h1>
              </a>
            </div>

            {/* Chapter Navigation */}
            {book.chapters && book.chapters.length > 0 && (
              <ChapterDropdown
                chapters={book.chapters}
                currentChapterIndex={
                  book.chapters.reduce((best, ch, i) =>
                    ch.pageNumber <= page.page_number ? i : best, -1)
                }
                onChapterSelect={(chapter) => {
                  const target = pages.find(p => p.id === chapter.pageId);
                  if (target) onNavigate(target.id);
                }}
              />
            )}

            {/* Page Navigation */}
            <div className="flex items-center gap-1 rounded-lg p-1 shrink-0" style={{ background: 'var(--bg-warm)' }}>
              <button
                onClick={() => previousPage && onNavigate(previousPage.id)}
                disabled={!previousPage}
                className="p-1.5 sm:p-2 rounded-md transition-all disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none"
                style={{ color: 'var(--accent-rust)' }}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <span className="px-1 sm:px-2 text-sm font-medium" style={{ color: 'var(--text-muted)' }} aria-label={`Page ${currentIndex + 1} of ${pages.length}`}>{currentIndex + 1}/{pages.length}</span>
              <button
                onClick={() => nextPage && onNavigate(nextPage.id)}
                disabled={!nextPage}
                className="p-1.5 sm:p-2 rounded-md transition-all disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none"
                style={{ color: 'var(--accent-rust)' }}
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Row 2: Panel toggles ... Mode toggle + Like */}
          <div className="flex items-center justify-between mt-2 sm:mt-3">
            {/* Panel visibility toggles */}
            <div className={`flex items-center gap-1 p-1 rounded-lg `} role="toolbar" aria-label="Panel visibility">
              <button
                onClick={() => setShowImagePanel(!showImagePanel)}
                className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none ${showImagePanel ? 'text-white' : ''}`}
                style={{
                  background: showImagePanel ? 'var(--accent-rust)' : 'transparent',
                  color: showImagePanel ? '#fff' : 'var(--text-muted)',
                }}
                aria-label={`${showImagePanel ? 'Hide' : 'Show'} source image`}
                aria-pressed={showImagePanel}
              >
                <ImageIcon className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">Image</span>
              </button>
              <button
                onClick={() => setShowOcrPanel(!showOcrPanel)}
                className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none ${showOcrPanel ? 'text-white' : ''}`}
                style={{
                  background: showOcrPanel ? 'var(--accent-rust)' : 'transparent',
                  color: showOcrPanel ? '#fff' : 'var(--text-muted)',
                }}
                aria-label={`${showOcrPanel ? 'Hide' : 'Show'} original text`}
                aria-pressed={showOcrPanel}
              >
                <FileText className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">OCR</span>
              </button>
              {hasTransliteration && (
                <button
                  onClick={() => setShowTransliterationPanel(!showTransliterationPanel)}
                  className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none ${showTransliterationPanel ? 'text-white' : ''}`}
                  style={{
                    background: showTransliterationPanel ? 'var(--accent-rust)' : 'transparent',
                    color: showTransliterationPanel ? '#fff' : 'var(--text-muted)',
                  }}
                  aria-label={`${showTransliterationPanel ? 'Hide' : 'Show'} romanized text`}
                  aria-pressed={showTransliterationPanel}
                >
                  <Type className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Romanized</span>
                </button>
              )}
              <button
                onClick={() => setShowTranslationPanel(!showTranslationPanel)}
                className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none ${showTranslationPanel ? 'text-white' : ''}`}
                style={{
                  background: showTranslationPanel ? 'var(--accent-rust)' : 'transparent',
                  color: showTranslationPanel ? '#fff' : 'var(--text-muted)',
                }}
                aria-label={`${showTranslationPanel ? 'Hide' : 'Show'} translation`}
                aria-pressed={showTranslationPanel}
              >
                <Languages className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">English</span>
              </button>
            </div>

            {/* Right side: Mode toggle + Like + extras on desktop */}
            <div className="flex items-center gap-1 sm:gap-2">
              {isSplitPage && (
                <button
                  onClick={() => setShowResetSplitConfirm(true)}
                  className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium hover:bg-red-50 transition-all"
                  style={{ color: 'var(--text-muted)' }}
                  title="Reset this split back to original two-page spread"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset Split
                </button>
              )}

              {/* Desktop extras: Font size */}
              <div className="hidden sm:flex items-center p-1 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
                <div className="relative" ref={fontControlsRef}>
                  <button
                    onClick={() => setShowFontControls(prev => !prev)}
                    className={`flex items-center gap-0.5 p-1.5 rounded-md text-xs font-medium transition-all hover:bg-stone-100 ${showFontControls ? 'bg-stone-200' : ''}`}
                    style={{ color: showFontControls ? 'var(--text-primary)' : 'var(--text-muted)' }}
                    aria-label="Font size"
                    title="Font size"
                  >
                    <span className="text-xs">A</span><span className="text-base font-semibold leading-none">A</span>
                  </button>
                  {showFontControls && (
                    <div className="absolute right-0 top-full mt-2 z-50 bg-white rounded-xl shadow-lg border p-4" style={{ borderColor: 'var(--border-light)', minWidth: '200px' }}>
                      <div className="text-[10px] uppercase tracking-widest text-center mb-3" style={{ color: 'var(--text-muted)' }}>Font Size</div>
                      <div className="flex items-center justify-between gap-4">
                        <button
                          onClick={decreaseFontSize}
                          disabled={isMinSize}
                          className="w-10 h-10 flex items-center justify-center rounded-lg text-base transition-colors bg-stone-100 hover:bg-stone-200 active:bg-stone-300 disabled:opacity-25 disabled:hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none"
                          style={{ color: 'var(--text-primary)' }}
                          title="Smaller (Cmd+-)"
                        >
                          A
                        </button>
                        <button
                          onClick={resetFontSize}
                          disabled={isDefaultSize}
                          className={`text-base tabular-nums font-semibold transition-colors ${isDefaultSize ? '' : 'hover:text-accent-rust cursor-pointer'}`}
                          style={{ color: 'var(--text-primary)' }}
                          title="Reset to default (Cmd+0)"
                        >
                          {fontSize}
                        </button>
                        <button
                          onClick={increaseFontSize}
                          disabled={isMaxSize}
                          className="w-10 h-10 flex items-center justify-center rounded-lg text-xl font-semibold transition-colors bg-stone-100 hover:bg-stone-200 active:bg-stone-300 disabled:opacity-25 disabled:hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none"
                          style={{ color: 'var(--text-primary)' }}
                          title="Larger (Cmd+=)"
                        >
                          A
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>


              {/* Mode Toggle - admin and inner circle */}
              <AuthCheck role="inner_circle">
                <div className="flex items-center rounded-lg p-0.5 sm:p-1" style={{ background: 'var(--bg-warm)' }}>
                  <button
                    onClick={() => setMode('read')}
                    className="flex items-center justify-center gap-1 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all"
                    style={{
                      background: 'var(--bg-white)',
                      color: 'var(--text-primary)',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                    }}
                  >
                    <Eye className="w-4 h-4" />
                    <span className="hidden sm:inline">Read</span>
                  </button>
                  <button
                    onClick={() => setMode('edit')}
                    className="flex items-center justify-center gap-1 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all"
                    style={{
                      background: 'transparent',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <Pencil className="w-4 h-4" />
                    <span className="hidden sm:inline">Edit</span>
                  </button>
                </div>
              </AuthCheck>

              {/* Like + Share + Cite */}
              <div className="flex items-center">
                <LikeButton
                  targetType="page"
                  targetId={page.id}
                  bookId={book.id}
                  size="sm"
                  showCount={true}
                />
                <ShareButton
                  title={book.display_title || book.title}
                  author={book.author}
                  year={book.published}
                  page={page.page_number}
                  url={`https://sourcelibrary.org/book/${(book as any).slug || book.id}?page=${page.page_number}`}
                  doi={book.doi}
                  className="!p-1.5 !text-stone-500 hover:!text-stone-700 hover:!bg-stone-100 !rounded-full"
                />
                <CiteButton
                  bookId={book.id}
                  title={book.title}
                  displayTitle={book.display_title}
                  author={book.author || 'Anonymous'}
                  year={book.published}
                  publisher={book.publisher}
                  placePublished={book.place_published}
                  language={book.language}
                  doi={book.doi}
                  pageNumber={page.page_number}
                  className="!p-1.5 !text-stone-500 hover:!text-stone-700 hover:!bg-stone-100 !rounded-full text-sm"
                />
              </div>
            </div>
          </div>
        </header>

        {/* Rashi script quality warning */}
        {(book as any).metadata?.scriptType?.toLowerCase().includes('rashi') && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-800 flex items-center gap-2">
            <span className="font-bold flex-shrink-0">⚠</span>
            <span><span className="font-medium">Rashi script</span> — current AI models struggle with this typeface. OCR and translation quality is low.</span>
          </div>
        )}

        {/* Panel layout - dynamic based on visibility */}
        {(() => {
          const visibleCount = [showImagePanel, showOcrPanel, showTranslationPanel, showTransliterationPanel && hasTransliteration].filter(Boolean).length;
          const panelWidth = visibleCount === 1 ? 'w-full' : visibleCount === 2 ? 'lg:w-1/2' : visibleCount === 3 ? 'lg:w-1/3' : 'lg:w-1/4';

          return (
            <div
              className="flex-1 flex flex-col lg:flex-row overflow-auto lg:overflow-hidden relative"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{
                transform: isSwiping ? `translateX(${swipeOffset}px)` : 'none',
                transition: isSwiping ? 'none' : 'transform 0.2s ease-out',
                '--reader-font-size': `${fontSize}px`,
                '--reader-line-height': lineHeight,
              } as React.CSSProperties}
            >
              {/* Source Image Panel */}
              {showImagePanel && (
                <div className={`w-full ${panelWidth} flex flex-col min-h-[50vh] shrink-0 lg:min-h-0 lg:shrink lg:flex-1`} style={{ background: 'var(--bg-warm)', borderRight: '1px solid var(--border-light)' }}>
                  <div className="px-4 py-2 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      {!pageDisplayUrl && hasWitnessPhotos ? 'Tablet Photo' : 'Source Image'}
                    </span>
                    {!pageDisplayUrl && hasWitnessPhotos && currentWitness && (
                      <a
                        href={currentWitness.cdli_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs hover:underline"
                        style={{ color: 'var(--accent-rust)' }}
                        title="View on CDLI"
                      >
                        CDLI
                      </a>
                    )}
                  </div>
                  <div className="flex-1 overflow-auto p-2 lg:p-4" data-reader-panel>
                    <div className="relative w-full rounded-lg overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', ...(page.display_brightness && page.display_brightness !== 1.0 ? { filter: `brightness(${page.display_brightness})` } : {}) }}>
                      {pageDisplayUrl ? (
                        <ImageWithMagnifier src={pageFullUrl} thumbnail={pageDisplayUrl} alt={`Page ${page.page_number}`} scrollable />
                      ) : hasWitnessPhotos && currentWitness ? (
                        <ImageWithMagnifier
                          src={currentWitness.photo_url!}
                          thumbnail={currentWitness.thumbnail_url || currentWitness.photo_url!}
                          alt={`Tablet ${currentWitness.designation}`}
                          scrollable
                        />
                      ) : (
                        <div className="w-full h-48 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
                          No image available
                        </div>
                      )}
                      {/* Floating page arrows on scan */}
                      {previousPage && (
                        <button
                          onClick={() => onNavigate(previousPage.id)}
                          className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 hover:bg-black/50 text-white/80 hover:text-white transition-all backdrop-blur-sm"
                          aria-label="Previous page"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                      )}
                      {nextPage && (
                        <button
                          onClick={() => onNavigate(nextPage.id)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 hover:bg-black/50 text-white/80 hover:text-white transition-all backdrop-blur-sm"
                          aria-label="Next page"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {/* CDLI Witness selector */}
                    {!pageDisplayUrl && hasWitnessPhotos && currentWitness && (
                      <div className="mt-2 px-1">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            onClick={() => setCurrentWitnessIndex(i => Math.max(0, i - 1))}
                            disabled={currentWitnessIndex === 0}
                            className="p-1 rounded disabled:opacity-30 transition-opacity"
                            style={{ color: 'var(--text-secondary)' }}
                            aria-label="Previous witness"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <div className="text-center min-w-0 flex-1">
                            <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                              {currentWitness.designation}
                            </div>
                            <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                              {[currentWitness.museum, currentWitness.period].filter(Boolean).join(' — ')}
                              {witnessesWithPhotos.length > 1 && (
                                <span className="ml-1">({currentWitnessIndex + 1}/{witnessesWithPhotos.length})</span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => setCurrentWitnessIndex(i => Math.min(witnessesWithPhotos.length - 1, i + 1))}
                            disabled={currentWitnessIndex === witnessesWithPhotos.length - 1}
                            className="p-1 rounded disabled:opacity-30 transition-opacity"
                            style={{ color: 'var(--text-secondary)' }}
                            aria-label="Next witness"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* OCR Panel */}
              {showOcrPanel && (
                <div className={`w-full ${panelWidth} flex flex-col min-h-[50vh] shrink-0 lg:min-h-0 lg:shrink lg:flex-1`} style={{ background: 'var(--bg-cream)', borderRight: '1px solid var(--border-light)' }}>
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
                      <RevisionHistory
                        pageId={page.id}
                        field="ocr"
                        currentSource={page.ocr?.source}
                        editedBy={page.ocr?.edited_by}
                        editedAt={page.ocr?.edited_at}
                        model={page.ocr?.model}
                      />
                    )}
                  </div>
                  <div className="flex-1 overflow-auto p-4 min-h-0" data-reader-panel>
                    {ocrText ? (
                      <div className="prose-manuscript leading-relaxed" style={{ color: 'var(--text-secondary)' }} lang={book.language === 'Latin' ? 'la' : book.language === 'German' ? 'de' : book.language === 'Arabic' ? 'ar' : book.language === 'Hebrew' ? 'he' : book.language === 'Greek' ? 'el' : book.language === 'French' ? 'fr' : book.language === 'Italian' ? 'it' : book.language === 'Dutch' ? 'nl' : undefined}>
                        <NotesRenderer key={`ocr-${showNotes}`} text={ocrText} showNotes={showNotes} showMetadata={false} language={book.language} columns={page.columns} pageType={page.page_type} />
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' }}>
                          <svg className="w-8 h-8" style={{ color: 'var(--accent-rust, #c45d3a)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
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

              {/* Transliteration Panel (non-Latin scripts only) */}
              {showTransliterationPanel && hasTransliteration && (
                <div className={`w-full ${panelWidth} flex flex-col min-h-[50vh] shrink-0 lg:min-h-0 lg:shrink lg:flex-1`} style={{ background: 'var(--bg-white)', borderLeft: '1px solid var(--border-light)' }}>
                  <div className="px-4 py-2 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                        Romanized {book.language || ''}
                      </span>
                      {transliterationText && (
                        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent-sage)' }}>
                          <Check className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                    {transliterationText && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(transliterationText);
                          toast.success('Copied transliteration');
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-stone-100"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Copy className="w-3 h-3" />
                        Copy
                      </button>
                    )}
                  </div>
                  <div className="flex-1 overflow-auto p-4 min-h-0" data-reader-panel>
                    {transliterationLoading ? (
                      <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: 'var(--accent-rust)' }} />
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Generating transliteration...</p>
                      </div>
                    ) : transliterationText ? (
                      <div className="prose-manuscript leading-relaxed" style={{ color: 'var(--text-secondary)' }} lang="und-Latn">
                        <NotesRenderer text={cleanTransliteration} showNotes={false} showMetadata={false} columns={effectiveColumns} />
                      </div>
                    ) : page.ocr?.data ? (
                      <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <Type className="w-8 h-8 mb-3" style={{ color: 'var(--text-faint)' }} />
                        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
                          Generate a Latin-script rendering of the {book.language || 'original'} text.
                        </p>
                        <button
                          onClick={() => {
                            setTransliterationLoading(true);
                            pagesApi.transliterate(page.id)
                              .then((res) => setTransliterationText(res.transliteration || ''))
                              .catch((err) => toast.error(`Transliteration failed: ${err.message || 'Unknown error'}`))
                              .finally(() => setTransliterationLoading(false));
                          }}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
                          style={{ background: 'var(--accent-rust)' }}
                        >
                          <Type className="w-4 h-4" />
                          Transliterate
                        </button>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
                          Complete OCR first to enable transliteration.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Translation Panel */}
              {showTranslationPanel && (
                <div className={`w-full ${panelWidth} flex flex-col min-h-[50vh] shrink-0 lg:min-h-0 lg:shrink lg:flex-1`} style={{ background: 'var(--bg-white)' }}>
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
                        <RevisionHistory
                          pageId={page.id}
                          field="translation"
                          currentSource={page.translation?.source}
                          editedBy={page.translation?.edited_by}
                          editedAt={page.translation?.edited_at}
                          model={page.translation?.model}
                        />
                      )}
                    </div>
                    {translationText && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setShowNotes(prev => !prev)}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${showNotes
                            ? 'bg-accent-gold/15 text-accent-gold-dark hover:bg-accent-gold/25'
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
                  <div className="flex-1 overflow-auto p-4 min-h-0" data-reader-panel>
                    {translationText ? (
                      <>
                      <HighlightSelection
                        bookId={book.id}
                        pageId={page.id}
                        pageNumber={page.page_number}
                        bookTitle={book.display_title || book.title}
                        bookAuthor={book.author}
                        bookYear={book.published}
                        doi={book.doi}
                      >
                        <NotesRenderer key={`trans-${showNotes}`} text={translationText} showNotes={showNotes} showMetadata={false} columns={page.columns} pageType={page.page_type} />
                      </HighlightSelection>
                      <TranslationFeedbackPrompt
                        bookId={book.id}
                        bookTitle={book.display_title || book.title}
                        pageNumber={page.page_number}
                        pageId={page.id}
                      />
                      </>
                    ) : (book.language === 'English' && ocrText) ? (
                      <HighlightSelection
                        bookId={book.id}
                        pageId={page.id}
                        pageNumber={page.page_number}
                        bookTitle={book.display_title || book.title}
                        bookAuthor={book.author}
                        bookYear={book.published}
                        doi={book.doi}
                      >
                        <NotesRenderer key={`ocr-en-${showNotes}`} text={ocrText} showNotes={showNotes} showMetadata={false} columns={page.columns} pageType={page.page_type} />
                      </HighlightSelection>
                    ) : ocrText && page.page_type === 'blank' ? (
                      <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
                          Blank page
                        </p>
                      </div>
                    ) : ocrText ? (
                      <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)' }}>
                          <svg className="w-8 h-8" style={{ color: 'var(--accent-sage, #6b8a63)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                          Ready to translate
                        </h3>
                        <p className="text-sm mb-4 max-w-xs" style={{ color: 'var(--text-muted)' }}>
                          OCR complete! Now translate the {book.language || 'text'} into English.
                        </p>
                        <AuthCheck fallback={
                          translationRequested ? (
                            <p className="text-sm font-medium" style={{ color: 'var(--accent-sage-dark)' }}>
                              Thanks! We&apos;ll prioritize this book.
                            </p>
                          ) : (
                            <button
                              onClick={async () => {
                                try {
                                  await fetch('/api/feedback', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      message: `Translation requested for "${book.display_title || book.title}" (${book.language || 'unknown language'}) — page ${page.page_number}`,
                                      page: `/book/${book.id}/page/${page.id}`,
                                    }),
                                  });
                                } catch { /* best effort */ }
                                setTranslationRequested(true);
                              }}
                              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90"
                              style={{ background: 'var(--bg-warm)', color: 'var(--text-secondary)' }}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                              </svg>
                              Request translation
                            </button>
                          )
                        }>
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
                        </AuthCheck>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--bg-warm, #f5f3f0)' }}>
                          <svg className="w-8 h-8" style={{ color: 'var(--text-faint, #c4c0b8)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                          Complete OCR first
                        </h3>
                        <p className="text-sm max-w-xs" style={{ color: 'var(--text-faint)' }}>
                          The original text needs to be transcribed before it can be translated.
                        </p>
                      </div>
                    )}
                  </div>

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

        {/* Footer: nav hint + search */}
        <div style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)' }}>
          <div className="px-4 py-1 flex items-center justify-center gap-4 text-xs flex-wrap">
            <span className="hidden lg:inline">Use ← → arrow keys to navigate</span>
            <span className="lg:hidden">Swipe left/right to navigate</span>
            <span>·</span>
            <span>Produced by <a href="https://sourcelibrary.org" className="hover:underline" style={{ color: 'var(--text-muted)' }}>SourceLibrary.org</a> in Amsterdam, 2026</span>
          </div>
          <div className="px-4 py-1.5" style={{ borderTop: '1px solid var(--border-light)' }}>
            <BookSearchBar bookId={book.id} />
          </div>
        </div>


        {/* Page Metadata Panel */}
        {showPageMetadata && (
          <PageMetadataPanel
            page={page}
            onClose={() => setShowPageMetadata(false)}
          />
        )}


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
                <h3 id="reset-split-title-read" className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
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
      {/* Header - Two rows on mobile, one row on desktop */}
      <header className="px-3 sm:px-6 py-2 sm:py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        {/* Row 1: Back, Title, Navigation */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
            <Logo mini />
            <span className="text-sm shrink-0" style={{ color: 'var(--text-muted)' }} aria-hidden="true">/</span>
            <a href={`/book/${book.id}`} className="min-w-0 hover:opacity-70 transition-opacity">
              <h1 className="text-base sm:text-xl font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {book.display_title || book.title}
              </h1>
            </a>
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-1 rounded-lg p-1 shrink-0" style={{ background: 'var(--bg-warm)' }}>
            <button
              onClick={() => previousPage && onNavigate(previousPage.id)}
              disabled={!previousPage}
              className="p-1.5 sm:p-2 rounded-md transition-all disabled:opacity-30"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-1 sm:px-2 text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{currentIndex + 1}/{pages.length}</span>
            <button
              onClick={() => nextPage && onNavigate(nextPage.id)}
              disabled={!nextPage}
              className="p-1.5 sm:p-2 rounded-md transition-all disabled:opacity-30"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Row 2: Panel toggles, Mode toggle, Like */}
        <div className="flex items-center justify-between mt-2 sm:mt-3">
          {/* Panel visibility toggles */}
          <div className={`flex items-center gap-1 p-1 rounded-lg `} style={{ background: 'var(--bg-warm)' }}>
            <button
              onClick={() => setShowImagePanel(!showImagePanel)}
              className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${showImagePanel ? 'text-white' : ''}`}
              style={{
                background: showImagePanel ? 'var(--accent-rust)' : 'transparent',
                color: showImagePanel ? '#fff' : 'var(--text-muted)',
              }}
              title="Toggle source image"
            >
              <ImageIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Image</span>
            </button>
            <button
              onClick={() => setShowOcrPanel(!showOcrPanel)}
              className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${showOcrPanel ? 'text-white' : ''}`}
              style={{
                background: showOcrPanel ? 'var(--accent-rust)' : 'transparent',
                color: showOcrPanel ? '#fff' : 'var(--text-muted)',
              }}
              title="Toggle OCR panel"
            >
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">OCR</span>
            </button>
            {hasTransliteration && (
              <button
                onClick={() => setShowTransliterationPanel(!showTransliterationPanel)}
                className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${showTransliterationPanel ? 'text-white' : ''}`}
                style={{
                  background: showTransliterationPanel ? 'var(--accent-rust)' : 'transparent',
                  color: showTransliterationPanel ? '#fff' : 'var(--text-muted)',
                }}
                title="Toggle romanized text"
              >
                <Type className="w-4 h-4" />
                <span className="hidden sm:inline">Romanized</span>
              </button>
            )}
            <button
              onClick={() => setShowTranslationPanel(!showTranslationPanel)}
              className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${showTranslationPanel ? 'text-white' : ''}`}
              style={{
                background: showTranslationPanel ? 'var(--accent-rust)' : 'transparent',
                color: showTranslationPanel ? '#fff' : 'var(--text-muted)',
              }}
              title="Toggle translation panel"
            >
              <Languages className="w-4 h-4" />
              <span className="hidden sm:inline">English</span>
            </button>
          </div>

          {/* Right side: Mode toggle + Like */}
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Mode Toggle - always visible */}
            <div className="flex items-center rounded-lg p-0.5 sm:p-1" style={{ background: 'var(--bg-warm)' }}>
              <button
                onClick={() => setMode('read')}
                className="flex items-center justify-center gap-1 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all"
                style={{
                  background: 'transparent',
                  color: 'var(--text-muted)',
                }}
              >
                <Eye className="w-4 h-4" />
                <span className="hidden sm:inline">Read</span>
              </button>
              <button
                onClick={() => setMode('edit')}
                className="flex items-center justify-center gap-1 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all"
                style={{
                  background: 'var(--bg-white)',
                  color: 'var(--text-primary)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                }}
              >
                <Pencil className="w-4 h-4" />
                <span className="hidden sm:inline">Edit</span>
              </button>
            </div>

            {/* Like Button */}
            <div className="p-1 rounded-lg hover:bg-stone-100 transition-all">
              <LikeButton
                targetType="page"
                targetId={page.id}
                bookId={book.id}
                size="sm"
                showCount={true}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Rashi script quality warning */}
      {(book as any).metadata?.scriptType?.toLowerCase().includes('rashi') && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-800 flex items-center gap-2">
          <span className="font-bold flex-shrink-0">⚠</span>
          <span><span className="font-medium">Rashi script</span> — current AI models struggle with this typeface. OCR and translation quality is low.</span>
        </div>
      )}

      {/* Main Content - Panels toggle visibility, stacked on mobile, columns on desktop */}
      {/* On mobile: panels have min-height and container scrolls. On desktop: panels share space */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-auto lg:overflow-hidden">
        {/* Source Image Panel */}
        {showImagePanel && (
          <div className="w-full min-h-[50vh] lg:min-h-0 lg:flex-1 flex flex-col shrink-0 lg:shrink" style={{ background: 'var(--bg-cream)', borderRight: '1px solid var(--border-light)' }}>
            <div className="px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2">
                <span className="label">Source</span>
                <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet)' }}>
                  {book.language || 'Latin'}
                </span>
              </div>
              <button
                onClick={() => setShowPageMetadata(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors hover:bg-stone-200"
                style={{ color: 'var(--text-muted)' }}
                title="View page metadata"
              >
                <Info className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Info</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4" data-reader-panel>
              <div className="relative w-full rounded-lg overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', ...(page.display_brightness && page.display_brightness !== 1.0 ? { filter: `brightness(${page.display_brightness})` } : {}) }}>
                {pageDisplayUrl ? (
                  <ImageWithMagnifier src={pageFullUrl} thumbnail={pageDisplayUrl} alt={`Page ${page.page_number}`} scrollable />
                ) : hasWitnessPhotos && currentWitness ? (
                  <ImageWithMagnifier
                    src={currentWitness.photo_url!}
                    thumbnail={currentWitness.thumbnail_url || currentWitness.photo_url!}
                    alt={`Tablet ${currentWitness.designation}`}
                    scrollable
                  />
                ) : (
                  <div className="w-full h-48 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
                    No image available
                  </div>
                )}
                {/* Floating page arrows on scan */}
                {previousPage && (
                  <button
                    onClick={() => onNavigate(previousPage.id)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 hover:bg-black/50 text-white/80 hover:text-white transition-all backdrop-blur-sm"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                )}
                {nextPage && (
                  <button
                    onClick={() => onNavigate(nextPage.id)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 hover:bg-black/50 text-white/80 hover:text-white transition-all backdrop-blur-sm"
                    aria-label="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
              {/* CDLI Witness selector (edit mode) */}
              {!pageDisplayUrl && hasWitnessPhotos && currentWitness && (
                <div className="mt-2 px-1">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => setCurrentWitnessIndex(i => Math.max(0, i - 1))}
                      disabled={currentWitnessIndex === 0}
                      className="p-1 rounded disabled:opacity-30 transition-opacity"
                      style={{ color: 'var(--text-secondary)' }}
                      aria-label="Previous witness"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <div className="text-center min-w-0 flex-1">
                      <a
                        href={currentWitness.cdli_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium truncate hover:underline"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {currentWitness.designation}
                      </a>
                      <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                        {[currentWitness.museum, currentWitness.period].filter(Boolean).join(' — ')}
                        {witnessesWithPhotos.length > 1 && (
                          <span className="ml-1">({currentWitnessIndex + 1}/{witnessesWithPhotos.length})</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setCurrentWitnessIndex(i => Math.min(witnessesWithPhotos.length - 1, i + 1))}
                      disabled={currentWitnessIndex === witnessesWithPhotos.length - 1}
                      className="p-1 rounded disabled:opacity-30 transition-opacity"
                      style={{ color: 'var(--text-secondary)' }}
                      aria-label="Next witness"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
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

            <div className="flex-1 overflow-auto p-3 sm:p-4" data-reader-panel>
              <textarea
                value={ocrText}
                onChange={(e) => setOcrText(e.target.value)}
                onBlur={handleSave}
                className="w-full h-full p-0 border-0 resize-none leading-relaxed focus:outline-none focus:ring-0"
                style={{ color: 'var(--text-secondary)', fontSize: `${fontSize}px`, lineHeight: String(lineHeight) }}
                placeholder="OCR text will appear here..."
              />
            </div>
          </div>
        )}

        {/* Transliteration Panel (non-Latin scripts only, read-only in edit mode) */}
        {showTransliterationPanel && hasTransliteration && (
          <div className="w-full min-h-[50vh] lg:min-h-0 lg:flex-1 flex flex-col shrink-0 lg:shrink" style={{ background: 'var(--bg-white)', borderLeft: '1px solid var(--border-light)' }}>
            <div className="px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Romanized {book.language || ''}</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>read-only</span>
            </div>
            <div className="flex-1 overflow-auto p-3 sm:p-4" data-reader-panel>
              {transliterationLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent-rust)' }} />
                </div>
              ) : transliterationText ? (
                <div className="prose-manuscript leading-relaxed" style={{ color: 'var(--text-secondary)', fontSize: `${fontSize}px`, lineHeight: String(lineHeight) }} lang="und-Latn">
                  <NotesRenderer text={cleanTransliteration} showNotes={false} showMetadata={false} columns={effectiveColumns} />
                </div>
              ) : (
                <p className="text-sm text-center mt-8" style={{ color: 'var(--text-muted)' }}>
                  Switch to read mode to generate transliteration.
                </p>
              )}
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

            <div className="flex-1 overflow-auto p-3 sm:p-4" data-reader-panel>
              <textarea
                value={translationText}
                onChange={(e) => setTranslationText(e.target.value)}
                onBlur={handleSave}
                className="w-full h-full p-0 border-0 resize-none leading-relaxed focus:outline-none focus:ring-0"
                style={{ color: 'var(--text-secondary)', fontSize: `${fontSize}px`, lineHeight: String(lineHeight) }}
                placeholder="Translation will appear here..."
              />
            </div>
          </div>
        )}

      </div>

      {/* Footer */}
      <div className="px-4 py-1.5 flex items-center justify-center gap-2 text-xs" style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)' }}>
        <a href="mailto:derek@sourcelibrary.org" className="hover:underline" style={{ color: 'var(--accent-rust)' }}>
          derek@sourcelibrary.org
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="how-it-works-title"
            className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: 'var(--bg-white)' }}
          >
            {/* Header */}
            <div className="px-6 py-5 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' }}>
              <h2 id="how-it-works-title" className="text-xl font-medium" style={{ color: 'var(--text-primary)' }}>
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
              <div className="space-y-4 font-body">
                <p className="text-base leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Our AI-powered translation uses <strong>Gemini 2.0 Flash</strong> to read and understand historical manuscripts. The process happens in two stages:
                </p>
                <ol className="space-y-3 text-base" style={{ color: 'var(--text-secondary)' }}>
                  <li className="flex gap-3">
                    <span className="font-bold" style={{ color: 'var(--accent-sage)' }}>1.</span>
                    <span><strong>Transcription</strong>: The AI reads the manuscript image and produces the original {book.language || 'text'}, preserving special characters and formatting.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-bold" style={{ color: 'var(--accent-rust)' }}>2.</span>
                    <span><strong>Translation</strong>: The transcribed text is translated into clear, readable English while maintaining the meaning and style of the original.</span>
                  </li>
                </ol>
              </div>

              {/* How to Help */}
              <div className="rounded-xl p-5" style={{ background: 'var(--bg-cream)', border: '1px solid var(--border-light)' }}>
                <h3 className="text-base font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
                  How You Can Help
                </h3>
                <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <li className="flex gap-2">
                    <span style={{ color: 'var(--accent-rust)' }}>•</span>
                    <span><strong>Review translations</strong>: Switch to Edit mode to correct any errors in the transcription or translation.</span>
                  </li>
                  <li className="flex gap-2">
                    <span style={{ color: 'var(--accent-rust)' }}>•</span>
                    <span><strong>Improve prompts</strong>: Use the Settings to refine the AI prompts for better results.</span>
                  </li>
                  <li className="flex gap-2">
                    <span style={{ color: 'var(--accent-rust)' }}>•</span>
                    <span><strong>Share knowledge</strong>: Your corrections help improve future translations.</span>
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
              <h3 id="reset-split-title" className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
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
