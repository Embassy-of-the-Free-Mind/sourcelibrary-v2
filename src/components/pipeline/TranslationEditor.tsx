'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { useStableSession } from '@/hooks/useStableSession';
import { useBrowserTranslation } from '@/hooks/useBrowserTranslation';
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
  Type,
  BookOpen,
  Save,
  AlertCircle,
  Crosshair,
} from 'lucide-react';
import { useReaderPreferences, type ReaderTheme } from '@/hooks/useReaderPreferences';
import NotesRenderer from '@/components/reader/NotesRenderer';
import TraceAlignment, { type TraceStatus } from '@/components/reader/TraceAlignment';
import LexiconTapLayer from '@/components/reader/LexiconTapLayer';
import AiBadge from '@/components/ui/AiBadge';
import { MANUSCRIPT_OCR_FLAG } from '@/lib/marcianus-overlay.shared';
import { usePairedEdition } from '@/hooks/usePairedEdition';
import ImageWithMagnifier from '@/components/ui/ImageWithMagnifier';
import PageDeepZoomButton from '@/components/reader/PageDeepZoomButton';
import PageMetadataPanel from '@/components/reader/PageMetadataPanel';
import HighlightedText from '@/components/search/HighlightedText';
import HighlightSelection from '@/components/annotations/HighlightSelection';
import ChapterDropdown from '@/components/reader/ChapterDropdown';
import ShareButton from '@/components/ui/ShareButton';
import CiteButton from '@/components/ui/CiteButton';
import { prompts as promptsApi, analytics, pages as pagesApi, processing as processingApi } from '@/lib/api-client';
import LikeButton from '@/components/ui/LikeButton';
import { getShortUrl } from '@/lib/shortlinks';
import { getPageDisplayUrl, getPageThumbUrl, isUsableImageUrl } from '@/lib/utils';
import type { Page, Book, Prompt, ContentSource } from '@/lib/types';
import { GEMINI_MODELS, DEFAULT_MODEL } from '@/lib/types';
import { AuthCheck } from '../auth/AuthCheck';
import TranslationFeedbackPrompt from '@/components/feedback/TranslationFeedbackPrompt';
import { useIsEmbedded } from '@/hooks/useEmbedContext';
import { shouldShowTranslationRequestCta } from '@/lib/translation-request-cta';

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
function BookSearchBar({ bookId, tenantPrefix }: { bookId: string; tenantPrefix?: string }) {
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) {
              e.preventDefault();
              window.location.href = `${tenantPrefix || ''}/book/${bookId}/search?q=${encodeURIComponent(query.trim())}`;
            }
          }}
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
                  href={`${tenantPrefix || ''}/book/${bookId}/page/${r.pageId}?highlight=${encodeURIComponent(query.trim())}`}
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
  onNavigate: (pageId: string, opts?: { toTop?: boolean }) => void;
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
  const params = useParams<{ tenant: string }>();
  const pathname = usePathname();
  const { data: sessionData } = useStableSession();
  const sessionEmail = (sessionData?.user as { email?: string } | undefined)?.email || null;
  const isEmbedded = useIsEmbedded();
  // A browser translator (Chrome/Edge built-in, Google Translate widget) replaces
  // every text node with its own <font> wrappers, which makes React's text updates
  // land on nodes that are no longer in the document — turn a page and the words
  // stay on the previous one. When one is active we remount the panels on each
  // page instead of reconciling them (see the key on the panels container below);
  // untranslated readers keep the cheaper in-place update.
  const browserTranslated = useBrowserTranslation();
  // On tenant subdomains (bph.sourcelibrary.org), the proxy adds the tenant prefix,
  // so links should use /book/... not /bph/book/...
  const isOnTenantSubdomain = typeof window !== 'undefined' && /^[a-z]+\.sourcelibrary\.org$/.test(window.location.hostname);
  const isOnEmbedRoute = pathname?.startsWith('/embed/');
  const tenantPrefix = isOnTenantSubdomain ? '' : (params?.tenant ? `${isOnEmbedRoute ? '/embed' : ''}/${params.tenant}` : '');
  const bookSlugOrId = book.slug || book.id;
  const bookMetadata = book as Book & { metadata?: { scriptType?: string } };
  const hasRashiScript = !!bookMetadata.metadata?.scriptType?.toLowerCase().includes('rashi');
  const [ocrText, setOcrText] = useState(page.ocr?.data || '');
  const [translationText, setTranslationText] = useState(page.translation?.data || '');
  // Label for the translation panel/toggle. Reflects the language actually being
  // shown (the reader's EN/ES toggle overlays page.translation with translation_es
  // and sets language:'Spanish'), so the UI never says "English" over Spanish text.
  // On English-language books both panels would otherwise be labeled "English" —
  // the OCR panel holds the diplomatic transcription (long ſ and all) and the
  // "translation" is the modernization, so label them Original Text / Modernized.
  const isEnglishBook = (book.language || '').toLowerCase() === 'english';
  const translationLang = (page.translation?.language || '').toLowerCase();
  const translationLangLabel = (translationLang.startsWith('es') || translationLang.includes('span'))
    ? 'Español'
    : isEnglishBook ? 'Modernized' : 'English';
  const [summaryText, setSummaryText] = useState(page.summary?.data || '');
  // Save state for the inline page editor. The previous design auto-saved on
  // blur with no UI feedback — editors (Paul Dijstelberge, May 2026) reported
  // edits "disappearing" because silent save failures were invisible. We now
  // track dirty state explicitly, show a Save button, and toast on error.
  type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const lastSavedRef = useRef({
    ocr: page.ocr?.data || '',
    translation: page.translation?.data || '',
    summary: page.summary?.data || '',
  });
  const { fontSize, lineHeight, increaseFontSize, decreaseFontSize, resetFontSize, isMinSize, isMaxSize, isDefaultSize, theme, setTheme } = useReaderPreferences();

  // Modernized text toggle
  const [modernizedMode, setModernizedMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sl_reader_mode') === 'modern';
  });
  const [modernizedText, setModernizedText] = useState<string | null>(page.modernized?.data || null);

  // Navigation hint: shown for the reader's first few page views ever, then retired
  const [showNavHint, setShowNavHint] = useState(false);
  useEffect(() => {
    const NAV_HINT_KEY = 'sl_nav_hint_views';
    const NAV_HINT_MAX_VIEWS = 5;
    const views = Number(localStorage.getItem(NAV_HINT_KEY) || '0');
    if (views < NAV_HINT_MAX_VIEWS) {
      setShowNavHint(true);
      localStorage.setItem(NAV_HINT_KEY, String(views + 1));
    } else {
      setShowNavHint(false);
    }
  }, [page.id]);

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
      window.location.href = `${tenantPrefix}/book/${book.id}/split`;
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

  // English-source books, MODERN print (>=1820, the MinerU lane): the OCR is already
  // readable English, so it IS the reading view and the redundant English→English
  // translation panel/toggle stays hidden (#2561). ARCHAIC English (pre-1820: long ſ,
  // obsolete spelling) is the tradeoff #2561 flagged for a conscious call — there the
  // modernization in translation.data is the readable text, so those books read like
  // translated books: modernized panel by default, transcription toggleable as
  // "Original Text". Unknown year falls to the modern-print behavior.
  const bookYear = parseInt(String(book.published ?? ''), 10);
  const englishOcrIsReadingView = isEnglishBook && !(bookYear < 1820);

  // Panel visibility toggles for read mode (default: image + translation visible, OCR hidden;
  // for modern-print English books, image + OCR visible, translation hidden)
  const [showImagePanel, setShowImagePanel] = useState(true);
  const [showNotes, setShowNotes] = useState(true); // Toggle for inline notes visibility
  const [showOcrPanel, setShowOcrPanel] = useState(englishOcrIsReadingView);
  const [showTranslationPanel, setShowTranslationPanel] = useState(!englishOcrIsReadingView);
  const [showTransliterationPanel, setShowTransliterationPanel] = useState(false);
  const [showGermanSourcePanel, setShowGermanSourcePanel] = useState(false);
  const [transliterationText, setTransliterationText] = useState('');
  const [transliterationLoading, setTransliterationLoading] = useState(false);
  const [showPageMetadata, setShowPageMetadata] = useState(false); // Toggle for page metadata panel
  const [showFontControls, setShowFontControls] = useState(false);
  // Full book doc for the edition-info section of the metadata panel. The reader
  // route only ships a slim book projection, so the bibliographic fields are
  // fetched on demand — once per book, the first time the panel opens.
  const [editionBook, setEditionBook] = useState<Book | null>(null);
  const [editionError, setEditionError] = useState(false);
  const editionFetchStartedRef = useRef(false);
  useEffect(() => {
    if (!showPageMetadata || editionFetchStartedRef.current) return;
    editionFetchStartedRef.current = true;
    fetch(`/api/books/${book.id}?pageLimit=1`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        const { pages: _pages, ...fullBook } = data;
        setEditionBook(fullBook as Book);
      })
      .catch(() => setEditionError(true));
  }, [showPageMetadata, book.id]);
  const fontControlsRef = useRef<HTMLDivElement>(null);

  // Highlights and Annotations panels

  // Swipe navigation state
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);
  // Explicit "a swipe is in progress" flag. Using a dedicated boolean (rather
  // than testing touchStartX === 0) means a touch that genuinely begins at the
  // extreme left edge (clientX === 0) is no longer mistaken for "no swipe".
  const swipeActive = useRef<boolean>(false);
  // Axis lock: a touch is classified ONCE as horizontal (page-turn candidate)
  // or vertical (scroll) after its first few px of movement, and keeps that
  // identity for the rest of the gesture. A scroll that drifts sideways can
  // never become a page turn.
  const swipeAxis = useRef<'h' | 'v' | null>(null);
  // Real finger position at the latest touchmove — the flip decision at
  // lift-off reads this, never a stale mid-gesture offset.
  const lastTouchX = useRef<number>(0);
  // Recent (x, timestamp) samples within ~100ms, for flick velocity.
  const velocitySamples = useRef<Array<{ x: number; t: number }>>([]);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  // Jump-to-page: the counter ("18/864") doubles as an editable input
  const [isEditingPage, setIsEditingPage] = useState(false);

  // Paired critical edition (Marcianus 299 ↔ Berthelot). When an aligned folio is
  // showing, Berthelot's Greek + English fill the normal Original/Translation
  // columns as the reading text of record, and the manuscript's own AI OCR is
  // demoted to a collapsible flagged aid inside those columns — same 3-part view,
  // no separate band. See .claude/docs/edition-facsimile-pairing.md.
  const paired = usePairedEdition(book.id, page.id, page.page_number);
  const [pageInputValue, setPageInputValue] = useState('');

  // Trace mode (#3091): click a phrase in the translation, see the aligned
  // span highlighted in the original-language OCR (and vice versa). Only
  // meaningful when a genuine cross-language pair is on screen — hidden for
  // English books, the Spanish edition view, modernized mode, paired critical
  // editions, and edit mode (offsets are computed against the canonical
  // English translation + OCR).
  const [traceMode, setTraceMode] = useState(false);
  const [traceStatus, setTraceStatus] = useState<TraceStatus>('idle');
  const isSpanishView = translationLang.startsWith('es') || translationLang.includes('span');
  const traceEligible = !paired && !isEnglishBook && !isSpanishView && !modernizedMode
    && mode === 'read' && !!ocrText && !!translationText && showTranslationPanel;

  useEffect(() => {
    if (!traceMode) return;
    if (traceStatus === 'unavailable') {
      toast.info("Tracing isn't available for this page.");
    } else if (traceStatus === 'rate_limited') {
      toast.info('Tracing limit reached — sign in (free) to keep going.');
    }
  }, [traceStatus, traceMode]);

  const previousPage = currentIndex > 0 ? pages[currentIndex - 1] : null;
  const nextPage = currentIndex < pages.length - 1 ? pages[currentIndex + 1] : null;
  // Real hrefs on prev/next so crawlers can walk the page chain (#2266);
  // onClick preventDefault keeps SPA navigation exactly as before.
  const pageHref = (p: { id: string }) => `${tenantPrefix}/book/${bookSlugOrId}/page/${p.id}`;

  const commitJumpToPage = () => {
    const n = parseInt(pageInputValue, 10);
    setIsEditingPage(false);
    if (Number.isNaN(n)) return;
    const clamped = Math.min(Math.max(n, 1), pages.length);
    const target = pages[clamped - 1];
    if (target && target.id !== page.id) onNavigate(target.id);
  };

  // Build image URLs at different quality tiers
  // Tier 1: Thumbnail (150px) - for navigation, grid views
  // Tier 2: Display (1200px) - for main reading view
  // Tier 3: Full (2400px) - for magnifier, fullscreen
  const getImageUrl = (p: Page, tier: 'thumbnail' | 'display' | 'full' = 'display') => {
    if (tier === 'thumbnail') return getPageThumbUrl(p) || '';
    if (tier === 'display') return getPageDisplayUrl(p) || '';

    // Full tier: for magnifier/fullscreen — want the highest resolution
    // split_from_spread pages have a pre-cropped half at archived_photo. The legacy
    // `crop` coordinates on these pages are relative to the original spread — applying
    // them to archived_photo would double-crop (quarter-width tall-and-narrow image).
    if (p.split_from_spread && isUsableImageUrl(p.archived_photo)) {
      return p.archived_photo!;
    }
    // Legacy split pages without pre-cropped variants: server-side crop of the original
    if (p.crop?.xStart !== undefined && p.crop?.xEnd !== undefined) {
      const baseUrl = p.archived_photo || p.photo_original || p.photo;
      if (!baseUrl) return '';
      return `/api/image?url=${encodeURIComponent(baseUrl)}&w=2400&q=90&cx=${p.crop.xStart}&cw=${p.crop.xEnd}`;
    }

    // New path convention: derive full-res URL (handles sp-prefixed split pages too)
    const newPathMatch = p.photo?.match(/^(https:\/\/images\.sourcelibrary\.org\/pages\/[^/]+\/(?:sp[a-z0-9]+-?)?\d{4,})(-full)?\.jpg$/);
    if (newPathMatch) return `${newPathMatch[1]}-full.jpg`;

    // Archived photo — serve directly from CDN
    if (isUsableImageUrl(p.archived_photo)) {
      // If the source is IIIF and was archived at low res (e.g. /full/1000,/),
      // try requesting a higher-res version for the magnifier
      const iiifMatch = (p.photo_original || p.photo || '').match(/^(https?:\/\/.+\/iiif\/2\/.+)\/full\/\d+,\/(\d+)\/default\.jpg$/);
      if (iiifMatch) {
        return `${iiifMatch[1]}/full/3000,/${iiifMatch[2]}/default.jpg`;
      }
      return p.archived_photo!;
    }

    // External sources: proxy
    const baseUrl = p.photo_original || p.photo;
    return baseUrl ? `/api/image?url=${encodeURIComponent(baseUrl)}&w=2400&q=90` : '';
  };

  // URLs for current page at different quality tiers
  const pageProxyUrl = getImageUrl(page, 'full');       // 2400px proxy (cropped if split)
  const pageThumbUrl = getImageUrl(page, 'thumbnail');  // small, fast first paint
  const pageDisplayUrl = getImageUrl(page, 'display');  // marked display variant — the RESTING image
  // Native-res: the original archived image — best available quality
  const pageNativeUrl = (page.split_from_spread || page.crop)
    ? pageProxyUrl // split pages: cropped image IS the full res
    : (isUsableImageUrl(page.archived_photo) ? page.archived_photo! : pageProxyUrl);
  // The display variant carries the provenance mark, so it's what we SHOW at rest;
  // the pristine native original is reserved for the magnifier's deep zoom and the
  // download link (it is never marked). See issue #2651.
  const pageFullUrl = pageNativeUrl || pageProxyUrl;

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
  const hasGermanSource = !!page.translation?.german_source;
  const shouldShowRequestTranslation = shouldShowTranslationRequestCta({
    ocrText,
    translationText,
    translationData: page.translation?.data,
    translationUpdatedAt: page.translation?.updated_at,
    modernizedText,
    bookPagesTranslated: book.pages_translated,
    bookPagesCount: book.pages_count,
  });
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
    const getSmallImageUrl = (p: Page) => getPageThumbUrl(p) || '';

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

  // Swipe navigation handlers (mobile only).
  //
  // Gesture identity is decided once per touch (axis lock, see swipeAxis), and
  // the flip decision at lift-off is distance-OR-flick over the finger's REAL
  // final position. The previous version re-derived the delta from the last
  // touchmove that happened to look horizontal, so a scroll whose opening arc
  // drifted sideways kept that stale offset and turned the page at lift-off —
  // the "flips when I don't want it to" bug.
  const AXIS_LOCK_SLOP = 10; // px of movement before the gesture is classified
  const AXIS_LOCK_BIAS = 1.5; // horizontal must dominate by this ratio; ties scroll
  const FLICK_VELOCITY = 0.4; // px/ms over the trailing ~100ms of movement
  const FLICK_MIN_DISTANCE = 40; // px — even a fast flick needs real displacement
  const VELOCITY_WINDOW_MS = 100;

  const resetSwipe = () => {
    swipeActive.current = false;
    swipeAxis.current = null;
    velocitySamples.current = [];
    setSwipeOffset(0);
    setIsSwiping(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    // Two fingers = pinch (the scan zooms in place), never a page swipe. Also
    // cancels a swipe already in progress when the second finger lands, so a
    // pinch whose first finger drifted sideways can't turn the page.
    if (e.touches.length > 1) {
      resetSwipe();
      return;
    }

    // Don't track if touching a scrollable area or interactive element
    const target = e.target as HTMLElement;
    if (target.closest('textarea, input, button, a, [data-no-swipe]')) return;

    // Don't start a swipe while the user is extending a text selection — the
    // drag handle a finger uses to grow a highlight reads as a swipe otherwise.
    if (typeof window !== 'undefined' && window.getSelection()?.toString().length) return;

    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    lastTouchX.current = e.touches[0].clientX;
    velocitySamples.current = [{ x: e.touches[0].clientX, t: e.timeStamp }];
    swipeAxis.current = null;
    swipeActive.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length > 1) {
      resetSwipe();
      return;
    }
    if (!swipeActive.current) return;

    const x = e.touches[0].clientX;
    const deltaX = x - touchStartX.current;
    const deltaY = e.touches[0].clientY - touchStartY.current;

    lastTouchX.current = x;
    const samples = velocitySamples.current;
    samples.push({ x, t: e.timeStamp });
    while (samples.length > 1 && samples[0].t < e.timeStamp - VELOCITY_WINDOW_MS) {
      samples.shift();
    }

    if (swipeAxis.current === null) {
      if (Math.hypot(deltaX, deltaY) < AXIS_LOCK_SLOP) return;
      if (Math.abs(deltaX) > Math.abs(deltaY) * AXIS_LOCK_BIAS) {
        swipeAxis.current = 'h';
      } else {
        // Locked as a scroll: this touch can never become a page turn.
        swipeAxis.current = 'v';
        swipeActive.current = false;
        return;
      }
    }

    setIsSwiping(true);
    // Clamp the offset for visual feedback
    const maxOffset = 100;
    setSwipeOffset(Math.max(-maxOffset, Math.min(maxOffset, deltaX * 0.5)));
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const wasHorizontalSwipe = swipeActive.current && swipeAxis.current === 'h';
    // If a selection is active at lift-off, the gesture was a highlight, not
    // a swipe — bail before navigation but still reset transient state.
    const hasSelection =
      typeof window !== 'undefined' && !!window.getSelection()?.toString().length;

    if (wasHorizontalSwipe && !hasSelection) {
      const deltaX = lastTouchX.current - touchStartX.current;

      // Commit: dragged far enough that the intent is unambiguous.
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 400;
      const commitDistance = Math.max(80, viewportWidth * 0.3);
      const isCommit = Math.abs(deltaX) >= commitDistance;

      // Flick: fast trailing velocity in the same direction as the drag. A
      // drag that pauses before lift-off has stale samples — treat as v=0.
      const samples = velocitySamples.current;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const stale = !last || e.timeStamp - last.t > VELOCITY_WINDOW_MS;
      const velocity =
        !stale && samples.length > 1 && last.t > first.t
          ? (last.x - first.x) / (last.t - first.t)
          : 0;
      const isFlick =
        Math.abs(deltaX) >= FLICK_MIN_DISTANCE &&
        Math.abs(velocity) >= FLICK_VELOCITY &&
        Math.sign(velocity) === Math.sign(deltaX);

      if (isCommit || isFlick) {
        // A swipe always lands at the top of the new page. The section-preserving
        // scroll (keep the reader in the OCR/translation panel across a flip) is
        // for button/keyboard nav; on a swipe it read as "lands mid-page" (#3085).
        if (deltaX > 0 && previousPage) {
          onNavigate(previousPage.id, { toTop: true });
        } else if (deltaX < 0 && nextPage) {
          onNavigate(nextPage.id, { toTop: true });
        }
      }
    }

    // Reset swipe state; a half-swipe snaps back via the container transition.
    resetSwipe();
  };

  // Update state when page changes
  useEffect(() => {
    const ocr = page.ocr?.data || '';
    const translation = page.translation?.data || '';
    const summary = page.summary?.data || '';
    setOcrText(ocr);
    setTranslationText(translation);
    setSummaryText(summary);
    setModernizedText(page.modernized?.data || null);
    lastSavedRef.current = { ocr, translation, summary };
    setSaveStatus('idle');
    // Reset each content panel's internal scroll (desktop: panels scroll independently).
    document.querySelectorAll('[data-reader-panel]').forEach(el => {
      el.scrollTop = 0;
    });
    // On mobile the stacked panels share one outer scroller, and PageEditorClient
    // positions it so the reader stays in the panel they were reading across a
    // flip — don't reset it to the top here or the two fight. Desktop keeps the
    // top-reset (panels are side-by-side, overflow hidden).
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      document.querySelector('[data-reader-panels-container]')?.scrollTo(0, 0);
    }
  }, [page]);

  // Toggle modernized mode and persist to localStorage
  const toggleModernizedMode = () => {
    const next = !modernizedMode;
    setModernizedMode(next);
    localStorage.setItem('sl_reader_mode', next ? 'modern' : 'scholarly');
  };


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

  const isDirty =
    ocrText !== lastSavedRef.current.ocr ||
    translationText !== lastSavedRef.current.translation ||
    summaryText !== lastSavedRef.current.summary;

  const handleSave = async () => {
    if (!isDirty) return;
    // Clicking the Save button blurs the textarea first — guard against the
    // resulting double-save (blur → save, then click → save) clobbering the
    // in-flight request.
    if (saveStatus === 'saving') return;
    setSaveStatus('saving');
    try {
      await onSave({
        ocr: ocrText,
        translation: translationText,
        summary: summaryText,
      });
      lastSavedRef.current = {
        ocr: ocrText,
        translation: translationText,
        summary: summaryText,
      };
      setSaveStatus('saved');
    } catch (error) {
      console.error('Save error:', error);
      setSaveStatus('error');
      const msg = error instanceof Error ? error.message : 'Save failed';
      toast.error(`Could not save your edit: ${msg}`);
    }
  };

  // After a successful save, fade the "Saved" badge back to idle so the
  // header doesn't stay green forever.
  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const t = setTimeout(() => {
      setSaveStatus((s) => (s === 'saved' ? 'idle' : s));
    }, 2500);
    return () => clearTimeout(t);
  }, [saveStatus]);

  const renderSaveControls = () => (
    <div className="flex items-center gap-2">
      {saveStatus === 'saving' && (
        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          <Loader2 className="w-3 h-3 animate-spin" /> Saving…
        </span>
      )}
      {saveStatus === 'saved' && (
        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent-sage)' }}>
          <Check className="w-3 h-3" /> Saved
        </span>
      )}
      {saveStatus === 'error' && (
        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent-rust)' }}>
          <AlertCircle className="w-3 h-3" /> Save failed
        </span>
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={!isDirty || saveStatus === 'saving'}
        className="btn-primary flex items-center justify-center gap-1.5"
        style={{ padding: '4px 10px', fontSize: '12px' }}
        title={isDirty ? 'Save your changes' : 'No unsaved changes'}
      >
        <Save className="w-3.5 h-3.5" />
        <span>{isDirty ? 'Save' : 'Saved'}</span>
      </button>
    </div>
  );

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
      <div className="h-screen flex flex-col" data-reader-theme={theme} style={{ background: 'var(--bg-cream)' }}>
        {/* Tap-a-word dictionary on the original-text pane. Gate on the
            language of the EDITION whose text fills that pane (book.language
            is the edition language — the OCR pane always shows edition text),
            not on the work's source language. Latin only for now (#3823). */}
        <LexiconTapLayer
          targetSelector='[data-reader-section="ocr"] [data-reader-panel]'
          enabled={(book.language === 'Latin' || book.language === 'Greek') && !paired}
          lang={book.language === 'Greek' ? 'grc' : 'la'}
        />
        {/* Header - Two rows on mobile, one row on desktop */}
        <header className="px-3 sm:px-4 py-2 sm:py-3" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
          {/* Row 1: Back + Title ... Chapter Nav ... Page Navigator */}
          <div className="flex items-center justify-between gap-2 relative">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              {/* Hide Source Library branding in embed mode */}
              {!isEmbedded && <Logo mini />}
              {!isEmbedded && <span className="text-sm shrink-0" style={{ color: 'var(--text-muted)' }} aria-hidden="true">/</span>}
              <a href={`${tenantPrefix}/book/${bookSlugOrId}`} className="min-w-0 hover:opacity-70 transition-opacity">
                <h1 className="text-sm sm:text-base font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {book.display_title || book.title}
                </h1>
                {(book.author || book.published) && (
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    {book.author}{book.author && book.published ? ' · ' : ''}{book.published}
                  </p>
                )}
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
              {previousPage ? (
                <a
                  href={pageHref(previousPage)}
                  onClick={(e) => { e.preventDefault(); onNavigate(previousPage.id); }}
                  className="p-1.5 sm:p-2 rounded-md transition-all focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none"
                  style={{ color: 'var(--text-secondary)' }}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </a>
              ) : (
                <span
                  className="p-1.5 sm:p-2 rounded-md opacity-30"
                  style={{ color: 'var(--text-secondary)' }}
                  aria-hidden="true"
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </span>
              )}
              <div className="flex items-center px-1 sm:px-2">
                {isEditingPage ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); commitJumpToPage(); }}
                    className="flex items-center gap-1"
                  >
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={pages.length}
                      autoFocus
                      value={pageInputValue}
                      onChange={(e) => setPageInputValue(e.target.value)}
                      onBlur={commitJumpToPage}
                      onKeyDown={(e) => { if (e.key === 'Escape') setIsEditingPage(false); }}
                      className="w-12 text-sm font-medium text-center bg-transparent border-b focus:outline-none"
                      style={{ color: 'var(--text-primary)', borderColor: 'var(--accent-rust)' }}
                      aria-label={`Jump to page (1 to ${pages.length})`}
                    />
                    <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>/{pages.length}</span>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setPageInputValue(String(currentIndex + 1)); setIsEditingPage(true); }}
                    className="text-sm font-medium rounded px-1 hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label={`Page ${currentIndex + 1} of ${pages.length}. Click to jump to a page`}
                    title="Jump to page"
                  >
                    {currentIndex + 1}/{pages.length}
                  </button>
                )}
              </div>
              {nextPage ? (
                <a
                  href={pageHref(nextPage)}
                  onClick={(e) => { e.preventDefault(); onNavigate(nextPage.id); }}
                  className="p-1.5 sm:p-2 rounded-md transition-all focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none"
                  style={{ color: 'var(--text-secondary)' }}
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </a>
              ) : (
                <span
                  className="p-1.5 sm:p-2 rounded-md opacity-30"
                  style={{ color: 'var(--text-secondary)' }}
                  aria-hidden="true"
                >
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </span>
              )}
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
              {hasGermanSource && (
                <button
                  onClick={() => setShowGermanSourcePanel(!showGermanSourcePanel)}
                  className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none ${showGermanSourcePanel ? 'text-white' : ''}`}
                  style={{
                    background: showGermanSourcePanel ? 'var(--accent-rust)' : 'transparent',
                    color: showGermanSourcePanel ? '#fff' : 'var(--text-muted)',
                  }}
                  aria-label={`${showGermanSourcePanel ? 'Hide' : 'Show'} German scholarly translation`}
                  aria-pressed={showGermanSourcePanel}
                >
                  <BookOpen className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Deutsch</span>
                </button>
              )}
              {!englishOcrIsReadingView && (
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
                  <span className="hidden sm:inline">{translationLangLabel}</span>
                </button>
              )}
            </div>

            {/* Right side: Mode toggle + Like + extras on desktop */}
            <div className="flex items-center gap-1 sm:gap-2">
              {/* Reading settings: font size + theme */}
              <div className="flex items-center p-1 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
                <div className="relative" ref={fontControlsRef}>
                  <button
                    onClick={() => setShowFontControls(prev => !prev)}
                    className={`flex items-center gap-0.5 p-1.5 rounded-md text-xs font-medium transition-all hover:bg-stone-100 ${showFontControls ? 'bg-stone-200' : ''}`}
                    style={{ color: showFontControls ? 'var(--text-primary)' : 'var(--text-muted)' }}
                    aria-label="Reading settings"
                    title="Reading settings"
                  >
                    <span className="text-xs">A</span><span className="text-base font-semibold leading-none">A</span>
                  </button>
                  {showFontControls && (
                    <div className="absolute right-0 top-full mt-2 z-50 bg-white rounded-xl shadow-lg border p-4" style={{ borderColor: 'var(--border-light)', minWidth: '220px' }}>
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
                      <div className="text-[10px] uppercase tracking-widest text-center mt-4 mb-3" style={{ color: 'var(--text-muted)' }}>Theme</div>
                      <div className="flex items-center justify-between gap-2">
                        {([
                          ['paper', 'Paper', '#fdfcf9', '#1a1612'],
                          ['sepia', 'Sepia', '#f6eeda', '#1a1612'],
                          ['night', 'Night', '#1a1612', '#ece7df'],
                        ] as [ReaderTheme, string, string, string][]).map(([key, label, bg, fg]) => (
                          <button
                            key={key}
                            onClick={() => setTheme(key)}
                            className="flex-1 flex flex-col items-center gap-1 py-2 rounded-lg border-2 transition-all focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none"
                            style={{
                              background: bg,
                              color: fg,
                              borderColor: theme === key ? 'var(--accent-rust)' : 'var(--border-light)',
                            }}
                            aria-pressed={theme === key}
                            title={`${label} theme`}
                          >
                            <span className="text-sm font-serif leading-none">Aa</span>
                            <span className="text-[10px]">{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>


              {/* Mode Toggle - admin and inner circle */}
              <AuthCheck role="inner_circle" fallback={<div className="w-[68px] sm:w-[140px]" />}>
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
                  key={page.id}
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
                  url={isEmbedded
                    ? (() => {
                      try {
                        const hostUrl = document.referrer ? new URL(document.referrer) : null;
                        const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
                        const hostPathParam = params.get('host_path');
                        const hostPath = hostPathParam || (typeof window !== 'undefined' ? sessionStorage.getItem('sl_embed_host_path') : null) || '';

                        if (hostPathParam) {
                          if (typeof window !== 'undefined') {
                            sessionStorage.setItem('sl_embed_host_path', hostPathParam);
                          }
                        }

                        if (hostUrl) {
                          if (hostPath && hostUrl.pathname === '/') {
                            hostUrl.pathname = hostPath.startsWith('/') ? hostPath : `/${hostPath}`;
                          }
                          hostUrl.searchParams.set('book', bookSlugOrId);
                          hostUrl.searchParams.set('page', page.id);
                          return hostUrl.toString();
                        }
                      } catch {
                        // fall through to iframe URL fallback
                      }
                      const origin = typeof window !== 'undefined' ? window.location.origin : '';
                      return `${origin}${tenantPrefix}/book/${bookSlugOrId}/${typeof page.page_number === 'number' ? `page-number/${page.page_number}` : `page/${page.id}`}`;
                    })()
                    : (() => {
                      const origin = typeof window !== 'undefined' ? window.location.origin : '';
                      return `${origin}${tenantPrefix}/book/${bookSlugOrId}/${typeof page.page_number === 'number' ? `page-number/${page.page_number}` : `page/${page.id}`}`;
                    })()}
                  doi={book.doi}
                  className="!p-1.5 !text-stone-500 hover:!text-stone-700 hover:!bg-stone-100 !rounded-full"
                />
                <CiteButton
                  bookId={bookSlugOrId}
                  title={book.title}
                  displayTitle={book.display_title}
                  author={book.author || 'Anonymous'}
                  year={book.published}
                  publisher={book.publisher}
                  placePublished={book.place_published}
                  format={book.format}
                  ustcId={book.ustc_id}
                  language={book.language}
                  doi={book.doi}
                  pageNumber={page.page_number}
                  tenantSlug={params?.tenant || undefined}
                  className="!p-1.5 !text-stone-500 hover:!text-stone-700 hover:!bg-stone-100 !rounded-full text-sm"
                />
              </div>
            </div>
          </div>
        </header>

        {/* Rashi script quality warning */}
        {hasRashiScript && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-800 flex items-center gap-2">
            <span className="font-bold flex-shrink-0">⚠</span>
            <span><span className="font-medium">Rashi script</span> — current AI models struggle with this typeface. OCR and translation quality is low.</span>
          </div>
        )}

        {/* Paired critical edition (Marcianus 299 ↔ Berthelot): one slim, non-
            disruptive line. Berthelot's text fills the Original/Translation
            columns below; the manuscript's own OCR is demoted inside them. */}
        {paired && (
          <div className="px-4 py-2 bg-accent-gold/10 border-b border-accent-gold/20 text-xs flex items-center gap-2" style={{ color: 'var(--accent-gold-dark)' }}>
            <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
            <span>
              <span className="font-medium">Reading text from the critical edition</span> — Berthelot &amp; Ruelle 1887–88, folio {paired.folio}. The manuscript&rsquo;s own AI transcription is unverified; verify any quotation against the edition or the facsimile.
            </span>
          </div>
        )}

        {/* Panel layout - dynamic based on visibility */}
        {(() => {
          const visibleCount = [showImagePanel, showOcrPanel, showTranslationPanel, showTransliterationPanel && hasTransliteration, showGermanSourcePanel && hasGermanSource].filter(Boolean).length;
          const panelWidth = visibleCount === 1 ? 'w-full' : visibleCount === 2 ? 'lg:w-1/2' : visibleCount === 3 ? 'lg:w-1/3' : 'lg:w-1/4';

          return (
            <div
              // Remount the panels per page while a browser translator is active,
              // so each page builds fresh text nodes for it to translate instead
              // of React trying to patch nodes the translator has already
              // replaced. Undefined (no remount) otherwise — panel toggles, font
              // size and trace mode live in this component's state, above the
              // key, so they survive either way.
              key={browserTranslated ? `translated-${page.id}` : undefined}
              className="flex-1 flex flex-col lg:flex-row overflow-auto lg:overflow-hidden relative"
              data-reader-panels-container
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={resetSwipe}
              style={{
                transform: isSwiping ? `translateX(${swipeOffset}px)` : 'none',
                transition: isSwiping ? 'none' : 'transform 0.2s ease-out',
                // Tell the browser we own horizontal gestures but it still drives
                // vertical scrolling — stops swipe and panel-scroll from fighting.
                touchAction: 'pan-y',
                '--reader-font-size': `${fontSize}px`,
                '--reader-line-height': lineHeight,
              } as React.CSSProperties}
            >
              {/* Source Image Panel */}
              {showImagePanel && (
                <div data-reader-section="image" className={`w-full ${panelWidth} flex flex-col min-h-[50vh] shrink-0 lg:min-h-0 lg:shrink lg:flex-1 relative`} style={{ background: 'var(--bg-warm)', borderRight: '1px solid var(--border-light)' }}>
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
                        <ImageWithMagnifier src={pageDisplayUrl} thumbnail={pageThumbUrl} highResSrc={pageFullUrl} alt={`Page ${page.page_number}`} scrollable inlineZoomable />
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
                      {page.deepzoom && (
                        <PageDeepZoomButton manifest={page.deepzoom} title={`${book.title} — page ${page.page_number}`} />
                      )}
                    </div>
                    {/* Image metadata + download */}
                    {pageDisplayUrl && (page.image_width || page.archived_photo) && (
                      <div className="mt-2 px-1 flex items-center justify-between text-xs" style={{ color: 'var(--text-faint)' }}>
                        <span className="inline-flex items-center gap-1">
                          {page.image_width && page.image_height
                            ? `${page.image_width.toLocaleString()} × ${page.image_height.toLocaleString()} px`
                            : ''}
                          {book.image_source?.provider_name && (
                            <>
                              <span aria-hidden="true">·</span>
                              {book.image_source.source_url ? (
                                <a
                                  href={book.image_source.source_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:underline"
                                  title={`View at ${book.image_source.provider_name}`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {book.image_source.provider_name}
                                </a>
                              ) : (
                                <span>{book.image_source.provider_name}</span>
                              )}
                            </>
                          )}
                        </span>
                        {pageNativeUrl && (
                          <a
                            href={pageNativeUrl}
                            download={`${book.slug || book.id}-page-${page.page_number}.jpg`}
                            className="inline-flex items-center gap-1 hover:underline"
                            style={{ color: 'var(--text-muted)' }}
                            title="Download full resolution"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download
                          </a>
                        )}
                      </div>
                    )}
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
                  {/* Floating page arrows on image panel edges */}
                  {previousPage && (
                    <a
                      href={pageHref(previousPage)}
                      onClick={(e) => { e.preventDefault(); onNavigate(previousPage.id); }}
                      className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/30 hover:bg-black/50 text-white/80 hover:text-white transition-all backdrop-blur-sm"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </a>
                  )}
                  {nextPage && (
                    <a
                      href={pageHref(nextPage)}
                      onClick={(e) => { e.preventDefault(); onNavigate(nextPage.id); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/30 hover:bg-black/50 text-white/80 hover:text-white transition-all backdrop-blur-sm"
                      aria-label="Next page"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </a>
                  )}
                </div>
              )}

              {/* OCR Panel */}
              {showOcrPanel && (
                <div id="reader-text" data-reader-section="ocr" className={`w-full ${panelWidth} flex flex-col min-h-[50vh] shrink-0 lg:min-h-0 lg:shrink lg:flex-1`} style={{ background: 'var(--bg-cream)', borderRight: '1px solid var(--border-light)' }}>
                  <div className="px-4 py-2 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                        {paired ? 'Greek · Berthelot' : ocrText ? (isEnglishBook ? 'Original Text' : (book.language || 'Original')) : 'Step 1: Transcribe'}
                      </span>
                      {paired ? (
                        paired.badges.map((b) => (
                          <span key={b.label} className={`px-1.5 py-0.5 rounded text-[11px] cursor-help ${b.className}`} title={b.tooltip}>
                            {b.label}
                          </span>
                        ))
                      ) : ocrText ? (
                        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent-sage)' }}>
                          <Check className="w-3 h-3" />
                        </span>
                      ) : null}
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
                    {paired ? (
                      <>
                        <div className="prose-manuscript leading-relaxed" style={{ color: 'var(--text-secondary)' }} lang="el">
                          <NotesRenderer text={paired.transcription} showNotes={showNotes} showMetadata={false} language="Ancient Greek" />
                        </div>
                        {ocrText && (
                          <details className="mt-6 pt-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
                            <summary className="cursor-pointer select-none inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }} title={MANUSCRIPT_OCR_FLAG.tooltip}>
                              <AiBadge title={MANUSCRIPT_OCR_FLAG.tooltip} />
                              {MANUSCRIPT_OCR_FLAG.label}
                            </summary>
                            <div className="prose-manuscript leading-relaxed mt-3" style={{ color: 'var(--text-muted)' }} lang="el">
                              <NotesRenderer text={ocrText} showNotes={showNotes} showMetadata={false} language={book.language} columns={page.columns} pageType={page.page_type} />
                            </div>
                          </details>
                        )}
                      </>
                    ) : ocrText ? (
                      <div className="prose-manuscript leading-relaxed" style={{ color: 'var(--text-secondary)' }} lang={book.language === 'Latin' ? 'la' : book.language === 'German' ? 'de' : book.language === 'Arabic' ? 'ar' : book.language === 'Hebrew' ? 'he' : book.language === 'Greek' ? 'el' : book.language === 'French' ? 'fr' : book.language === 'Italian' ? 'it' : book.language === 'Dutch' ? 'nl' : undefined}>
                        <NotesRenderer text={ocrText} showNotes={showNotes} showMetadata={false} language={book.language} columns={page.columns} pageType={page.page_type} />
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

              {/* Transliteration Panel (non-Latin scripts only). data-reader-section
                  opts it into trace mode: clicking a phrase in any pane lights the
                  romanized span too (TraceAlignment). */}
              {showTransliterationPanel && hasTransliteration && (
                <div data-reader-section="transliteration" className={`w-full ${panelWidth} flex flex-col min-h-[50vh] shrink-0 lg:min-h-0 lg:shrink lg:flex-1`} style={{ background: 'var(--bg-white)', borderLeft: '1px solid var(--border-light)' }}>
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

              {/* German Source Panel (ORAEC Egyptian texts) */}
              {showGermanSourcePanel && hasGermanSource && (
                <div className={`w-full ${panelWidth} flex flex-col min-h-[50vh] shrink-0 lg:min-h-0 lg:shrink lg:flex-1`} style={{ background: 'var(--bg-white)', borderRight: '1px solid var(--border-light)' }}>
                  <div className="px-4 py-2 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      Deutsch <span className="normal-case font-normal">(ORAEC)</span>
                    </span>
                    <button
                      onClick={() => copyToClipboard(page.translation?.german_source || '')}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-stone-100"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Copy className="w-3 h-3" />
                      Copy
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto p-4 min-h-0" data-reader-panel>
                    <div className="prose prose-sm max-w-none whitespace-pre-wrap" style={{ color: 'var(--text-primary)', fontSize: 'var(--reader-font-size, 15px)', lineHeight: 'var(--reader-line-height, 1.8)' }}>
                      {page.translation?.german_source}
                    </div>
                  </div>
                </div>
              )}

              {/* Translation Panel — suppressed for modern-print English books (OCR is the reading view) */}
              {showTranslationPanel && !englishOcrIsReadingView && (
                <div id={showOcrPanel ? undefined : 'reader-text'} data-reader-section="translation" className={`w-full ${panelWidth} flex flex-col min-h-[50vh] shrink-0 lg:min-h-0 lg:shrink lg:flex-1`} style={{ background: 'var(--bg-white)' }}>
                  <div className="px-4 py-2 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                        {/* Was 'Step 2: Translate' when the panel was empty — pipeline
                            stage numbering shown to readers. The label describes what
                            the panel holds, so it should not change based on whether
                            the work has been done yet. translationLangLabel resolves
                            without a translation present (falls back to English /
                            Modernized). */}
                        {paired ? 'English · Berthelot' : translationLangLabel}
                      </span>
                      {!paired && translationText && (
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
                      {/* Scholarly / Modern toggle pill — only show when modernized text exists */}
                      {translationText && modernizedText && (
                        <button
                          onClick={toggleModernizedMode}
                          className="flex items-center rounded-full text-[10px] font-medium overflow-hidden border"
                          style={{ borderColor: 'var(--border-light)' }}
                          title={modernizedMode ? 'Switch to scholarly translation' : 'Switch to modern prose'}
                        >
                          <span
                            className="px-2 py-0.5 transition-colors"
                            style={{
                              background: !modernizedMode ? 'var(--accent-sage)' : 'transparent',
                              color: !modernizedMode ? '#fff' : 'var(--text-muted)',
                            }}
                          >
                            Scholarly
                          </span>
                          <span
                            className="px-2 py-0.5 transition-colors"
                            style={{
                              background: modernizedMode ? 'var(--accent-sage)' : 'transparent',
                              color: modernizedMode ? '#fff' : 'var(--text-muted)',
                            }}
                          >
                            Modern
                          </span>
                        </button>
                      )}
                    </div>
                    {translationText && (
                      <div className="flex items-center gap-2">
                        {traceEligible && (
                          <button
                            onClick={() => {
                              const next = !traceMode;
                              setTraceMode(next);
                              // Tracing needs both panes on screen.
                              if (next && !showOcrPanel) setShowOcrPanel(true);
                            }}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${traceMode
                              ? 'bg-accent-gold/15 text-accent-gold-dark hover:bg-accent-gold/25'
                              : 'bg-stone-100 text-stone-400 hover:bg-stone-200'
                              }`}
                            title={traceMode
                              ? 'Turn off tracing'
                              : `Trace: click any phrase to see it in the ${book.language || 'original'}`}
                          >
                            <Crosshair className={`w-3 h-3 ${traceMode && traceStatus === 'loading' ? 'animate-pulse' : ''}`} />
                            Trace
                          </button>
                        )}
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
                          onClick={() => copyToClipboard(modernizedMode && modernizedText ? modernizedText : translationText)}
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
                    {paired ? (
                      <>
                        <div className="prose-manuscript leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                          <NotesRenderer text={paired.translation} showNotes={showNotes} showMetadata={false} />
                        </div>
                        {translationText && (
                          <details className="mt-6 pt-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
                            <summary className="cursor-pointer select-none inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }} title={MANUSCRIPT_OCR_FLAG.tooltip}>
                              <AiBadge title={MANUSCRIPT_OCR_FLAG.tooltip} />
                              {MANUSCRIPT_OCR_FLAG.label}
                            </summary>
                            <div className="prose-manuscript leading-relaxed mt-3" style={{ color: 'var(--text-muted)' }}>
                              <NotesRenderer text={translationText} showNotes={showNotes} showMetadata={false} columns={page.columns} pageType={page.page_type} />
                            </div>
                          </details>
                        )}
                      </>
                    ) : translationText && modernizedMode && modernizedText ? (
                      /* Modernized text view — use NotesRenderer for full markdown support */
                      (() => {
                        // Convert <section-intro> tags to <note> tags so NotesRenderer styles them as green editorial notes
                        const processedText = modernizedText
                          .replace(/<section-intro>([\s\S]*?)<\/section-intro>/g, '\n\n<note>$1</note>\n\n');
                        return <NotesRenderer text={processedText} showNotes={true} showMetadata={false} columns={page.columns} pageType={page.page_type} />;
                      })()
                    ) : translationText ? (
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
                          <NotesRenderer text={translationText} showNotes={showNotes} showMetadata={false} columns={page.columns} pageType={page.page_type} />
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
                        <NotesRenderer text={ocrText} showNotes={showNotes} showMetadata={false} columns={page.columns} pageType={page.page_type} />
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
                        {/* Editor+ → translate. Logged-in reader → request (tied to
                            their account, so we can notify them). Logged-out → sign in
                            first: translation requests now require login (#2835 follow-up)
                            so every request is identifiable, not an anonymous click. */}
                        <AuthCheck role="inner_circle" fallback={
                          <AuthCheck fallback={
                            shouldShowRequestTranslation ? (
                              <a
                                href={`/auth/signin?callbackUrl=${encodeURIComponent(pathname || `/book/${book.id}/page/${page.id}`)}&reason=translation-request`}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90"
                                style={{ background: 'var(--bg-warm)', color: 'var(--text-secondary)' }}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                </svg>
                                Sign in to request a translation
                              </a>
                            ) : null
                          }>
                            {translationRequested ? (
                              <p className="text-sm font-medium" style={{ color: 'var(--accent-sage-dark)' }}>
                                {sessionEmail
                                  ? "Thanks! We'll email you when this page is translated."
                                  : "Thanks! We'll prioritize this book."}
                              </p>
                            ) : shouldShowRequestTranslation ? (
                              <button
                                onClick={async () => {
                                  try {
                                    await fetch('/api/feedback', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        message: `Translation requested for "${book.display_title || book.title}" (${book.language || 'unknown language'}) — page ${page.page_number}`,
                                        page: `/book/${book.id}/page/${page.id}`,
                                        email: sessionEmail && sessionEmail.includes('@') ? sessionEmail : null,
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
                            ) : null}
                          </AuthCheck>
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
                      /* Untranscribed page. 704 visible books have no OCR at
                         all, so this is a public-facing state, not an operator
                         one — it used to show a PADLOCK and "Complete OCR
                         first" to every reader, which reads as paywalled
                         content in a free library and as pipeline jargon
                         besides. Editors keep the operational wording; readers
                         are told plainly what they have and what they don't. */
                      <AuthCheck
                        role="inner_circle"
                        fallback={
                          <div className="h-full flex flex-col items-center justify-center text-center px-4">
                            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--bg-warm, #f5f3f0)' }}>
                              <svg className="w-8 h-8" style={{ color: 'var(--text-faint, #c4c0b8)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a2 2 0 012-2h8l6 6v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 3v6h6" />
                              </svg>
                            </div>
                            <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                              Not transcribed yet
                            </h3>
                            <p className="text-sm max-w-xs" style={{ color: 'var(--text-faint)' }}>
                              The scan is here and free to read, but this page has no transcription
                              yet, so there is nothing to translate from.
                            </p>
                          </div>
                        }
                      >
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
                      </AuthCheck>
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

        {/* Footer: like + nav hint + search */}
        <div style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)' }}>
          <div className="px-4 pt-2 pb-1 flex items-center justify-center gap-3 flex-wrap text-xs">
            <LikeButton
              key={`footer-${page.id}`}
              targetType="page"
              targetId={page.id}
              bookId={book.id}
              size="sm"
              showCount={true}
              label="Like this page"
            />
          </div>
          {showNavHint && (
            <div className="px-4 py-1 flex items-center justify-center gap-4 text-xs flex-wrap">
              <span className="hidden lg:inline">Use ← → arrow keys to navigate</span>
              <span className="lg:hidden">Swipe left/right to navigate</span>
            </div>
          )}
          <div className="px-4 py-1.5" style={{ borderTop: '1px solid var(--border-light)' }}>
            <BookSearchBar bookId={book.id} tenantPrefix={tenantPrefix} />
          </div>
        </div>


        {/* Page Metadata Panel */}
        {showPageMetadata && (
          <PageMetadataPanel
            page={page}
            onClose={() => setShowPageMetadata(false)}
            editionBook={editionBook}
            editionError={editionError}
            bookHref={`${tenantPrefix}/book/${book.id}`}
            isEmbedded={isEmbedded}
          />
        )}

        {/* Trace mode: OCR↔translation span highlighting (#3091) */}
        <TraceAlignment
          bookId={book.id}
          pageId={page.id}
          active={traceMode && traceEligible}
          onStatusChange={setTraceStatus}
        />
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
            {/* Hide Source Library branding in embed mode */}
            {!isEmbedded && <Logo mini />}
            {!isEmbedded && <span className="text-sm shrink-0" style={{ color: 'var(--text-muted)' }} aria-hidden="true">/</span>}
            <a href={`${tenantPrefix}/book/${book.id}`} className="min-w-0 hover:opacity-70 transition-opacity">
              <h1 className="text-base sm:text-xl font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {book.display_title || book.title}
              </h1>
              {(book.author || book.published) && (
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                  {book.author}{book.author && book.published ? ' · ' : ''}{book.published}
                </p>
              )}
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
            <div className="flex flex-col items-center px-1 sm:px-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{currentIndex + 1}/{pages.length}</span>
              {page.page_number != null && (
                <span className="text-[10px] leading-tight" style={{ color: 'var(--text-muted)' }}>p. {page.page_number}</span>
              )}
            </div>
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
            {hasGermanSource && (
              <button
                onClick={() => setShowGermanSourcePanel(!showGermanSourcePanel)}
                className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${showGermanSourcePanel ? 'text-white' : ''}`}
                style={{
                  background: showGermanSourcePanel ? 'var(--accent-rust)' : 'transparent',
                  color: showGermanSourcePanel ? '#fff' : 'var(--text-muted)',
                }}
                title="Toggle German scholarly translation"
              >
                <BookOpen className="w-4 h-4" />
                <span className="hidden sm:inline">Deutsch</span>
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
              <span className="hidden sm:inline">{translationLangLabel}</span>
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
                key={`mobile-${page.id}`}
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
      {hasRashiScript && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-800 flex items-center gap-2">
          <span className="font-bold flex-shrink-0">⚠</span>
          <span><span className="font-medium">Rashi script</span> — current AI models struggle with this typeface. OCR and translation quality is low.</span>
        </div>
      )}

      {/* Main Content - Panels toggle visibility, stacked on mobile, columns on desktop */}
      {/* On mobile: panels have min-height and container scrolls. On desktop: panels share space */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-auto lg:overflow-hidden" data-reader-panels-container>
        {/* Source Image Panel */}
        {showImagePanel && (
          <div className="w-full min-h-[50vh] lg:min-h-0 lg:flex-1 flex flex-col shrink-0 lg:shrink relative" style={{ background: 'var(--bg-cream)', borderRight: '1px solid var(--border-light)' }}>
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
                {page.deepzoom && (
                  <PageDeepZoomButton manifest={page.deepzoom} title={`${book.title} — page ${page.page_number}`} />
                )}
                {pageDisplayUrl ? (
                  <ImageWithMagnifier src={pageDisplayUrl} thumbnail={pageThumbUrl} highResSrc={pageFullUrl} alt={`Page ${page.page_number}`} scrollable inlineZoomable />
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
            {/* Floating page arrows on image panel edges */}
            {previousPage && (
              <button
                onClick={() => onNavigate(previousPage.id)}
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/30 hover:bg-black/50 text-white/80 hover:text-white transition-all backdrop-blur-sm"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {nextPage && (
              <button
                onClick={() => onNavigate(nextPage.id)}
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/30 hover:bg-black/50 text-white/80 hover:text-white transition-all backdrop-blur-sm"
                aria-label="Next page"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
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

            <div className="px-3 sm:px-4 py-2 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>OCR Text</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{ocrText.length} chars</span>
              </div>
              {renderSaveControls()}
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

        {/* German Source Panel (edit mode, read-only) */}
        {showGermanSourcePanel && hasGermanSource && (
          <div className="w-full min-h-[50vh] lg:min-h-0 lg:flex-1 flex flex-col shrink-0 lg:shrink" style={{ background: 'var(--bg-white)', borderLeft: '1px solid var(--border-light)' }}>
            <div className="px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Deutsch (ORAEC)</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>read-only</span>
            </div>
            <div className="flex-1 overflow-auto p-3 sm:p-4" data-reader-panel>
              <div className="prose-manuscript leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)', fontSize: `${fontSize}px`, lineHeight: String(lineHeight) }} lang="de">
                {page.translation?.german_source}
              </div>
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

            <div className="px-3 sm:px-4 py-2 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Translation</span>
                <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(139, 154, 125, 0.15)', color: 'var(--accent-sage)' }}>
                  English
                </span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{translationText.length} chars</span>
              </div>
              {renderSaveControls()}
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

      {/* Page Metadata Panel */}
      {showPageMetadata && (
        <PageMetadataPanel
          page={page}
          onClose={() => setShowPageMetadata(false)}
          editionBook={editionBook}
          editionError={editionError}
          bookHref={`${tenantPrefix}/book/${book.id}`}
          isEmbedded={isEmbedded}
        />
      )}

    </div>
  );
}
