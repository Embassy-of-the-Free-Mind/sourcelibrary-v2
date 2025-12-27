'use client';

import { useState, useEffect, useRef } from 'react';
import { Sparkles, MessageCircle, X, Loader2, Send, ArrowLeft, Settings, Info, RotateCcw, ChevronRight, BookOpen } from 'lucide-react';
import type { Page, Book } from '@/lib/types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ExplainItem {
  term: string;
  type: 'word' | 'reference' | 'concept' | 'metaphor' | 'context';
  preview: string;
}

interface PageAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode: 'explain' | 'ask';
  page: Page;
  book: Book;
}

// Default prompts
const DEFAULT_EXPLAIN_PROMPT = `You are a helpful guide explaining historical texts to modern readers.

A reader is studying a passage {context} and wants to understand a specific term or concept.

The passage:
---
{text}
---

The reader wants to understand: "{term}"

Explain this clearly in 2-3 short paragraphs:
1. What it literally means
2. Why it matters in this context
3. Any interesting background (if relevant)

Be warm and conversational, like a knowledgeable friend. Don't be condescending.`;

const DEFAULT_ASK_PROMPT = `You are a helpful guide explaining historical texts to modern readers.

A reader is studying page {page_number} from {book_context}.

Here is the text from this page:
---
{page_text}
---

{conversation_history}The reader now asks: "{question}"

Please answer their question helpfully:
- Be concise but thorough
- Reference specific parts of the text when relevant
- Explain any archaic terms or concepts
- If the answer isn't in the text, say so honestly
- Keep a warm, conversational tone

Answer:`;

const STORAGE_KEY_EXPLAIN = 'pageAssistant_explainPrompt';
const STORAGE_KEY_ASK = 'pageAssistant_askPrompt';

// Type icons/colors
const TYPE_STYLES: Record<string, { icon: string; color: string }> = {
  word: { icon: 'Aa', color: 'var(--accent-rust)' },
  reference: { icon: '@', color: 'var(--accent-sage)' },
  concept: { icon: '💡', color: 'var(--accent-violet)' },
  metaphor: { icon: '~', color: '#d97706' },
  context: { icon: '📜', color: '#6b7280' },
};

export default function PageAssistant({
  isOpen,
  onClose,
  initialMode,
  page,
  book,
}: PageAssistantProps) {
  const [mode, setMode] = useState<'explain' | 'ask'>(initialMode);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainItems, setExplainItems] = useState<ExplainItem[]>([]);
  const [selectedTerm, setSelectedTerm] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState<'explain' | 'ask' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Prompt state
  const [explainPrompt, setExplainPrompt] = useState(DEFAULT_EXPLAIN_PROMPT);
  const [askPrompt, setAskPrompt] = useState(DEFAULT_ASK_PROMPT);

  // Load prompts from localStorage on mount
  useEffect(() => {
    const savedExplain = localStorage.getItem(STORAGE_KEY_EXPLAIN);
    const savedAsk = localStorage.getItem(STORAGE_KEY_ASK);
    if (savedExplain) setExplainPrompt(savedExplain);
    if (savedAsk) setAskPrompt(savedAsk);
  }, []);

  // Save prompts to localStorage when they change
  const saveExplainPrompt = (prompt: string) => {
    setExplainPrompt(prompt);
    localStorage.setItem(STORAGE_KEY_EXPLAIN, prompt);
  };

  const saveAskPrompt = (prompt: string) => {
    setAskPrompt(prompt);
    localStorage.setItem(STORAGE_KEY_ASK, prompt);
  };

  const resetToDefaults = () => {
    setExplainPrompt(DEFAULT_EXPLAIN_PROMPT);
    setAskPrompt(DEFAULT_ASK_PROMPT);
    localStorage.removeItem(STORAGE_KEY_EXPLAIN);
    localStorage.removeItem(STORAGE_KEY_ASK);
  };

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setShowSettings(false);
      setExplanation(null);
      setExplainItems([]);
      setSelectedTerm(null);
      setMessages([]);
      setInput('');
      setError(null);
      setShowInfo(null);
      // No auto-analyze - let user choose what to explain
    }
  }, [isOpen, initialMode]);

  // Focus input when switching to ask mode
  useEffect(() => {
    if (mode === 'ask' && inputRef.current && !showSettings) {
      inputRef.current.focus();
    }
  }, [mode, showSettings]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSettings) {
          setShowSettings(false);
        } else if (showInfo) {
          setShowInfo(null);
        } else if (selectedTerm) {
          setSelectedTerm(null);
          setExplanation(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, showSettings, showInfo, selectedTerm]);

  const getPageText = () => {
    return page.translation?.data || page.ocr?.data || '';
  };

  // Step 1: Analyze text to find confusing elements
  const handleAnalyze = async () => {
    const text = getPageText();
    if (!text) {
      setError('No text available on this page');
      return;
    }

    setLoading(true);
    setError(null);
    setExplainItems([]);

    try {
      const truncatedText = text.length > 3000
        ? text.slice(0, 3000) + '...'
        : text;

      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: truncatedText,
          book_title: book.display_title || book.title,
          book_author: book.author,
          page_number: page.page_number,
          mode: 'analyze',
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to analyze page');
      }

      const data = await res.json();

      if (data.items && Array.isArray(data.items)) {
        setExplainItems(data.items);
      } else if (data.explanation) {
        // Fallback: API returned a full explanation instead
        setExplanation(data.explanation);
      }
    } catch (err) {
      console.error('Analyze error:', err);
      setError('Failed to analyze this page. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Explain a specific term
  const handleExplainTerm = async (term: string) => {
    const text = getPageText();
    setSelectedTerm(term);
    setLoading(true);
    setError(null);
    setExplanation(null);

    try {
      const truncatedText = text.length > 3000
        ? text.slice(0, 3000) + '...'
        : text;

      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: truncatedText,
          book_title: book.display_title || book.title,
          book_author: book.author,
          page_number: page.page_number,
          mode: 'explain_term',
          term,
          customPrompt: explainPrompt !== DEFAULT_EXPLAIN_PROMPT ? explainPrompt : undefined,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to explain term');
      }

      const data = await res.json();
      setExplanation(data.explanation);
    } catch (err) {
      console.error('Explain error:', err);
      setError('Failed to explain. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Full page explanation
  const handleExplainAll = async () => {
    const text = getPageText();
    setSelectedTerm('full page');
    setLoading(true);
    setError(null);
    setExplanation(null);

    try {
      const truncatedText = text.length > 3000
        ? text.slice(0, 3000) + '...'
        : text;

      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: truncatedText,
          book_title: book.display_title || book.title,
          book_author: book.author,
          page_number: page.page_number,
          mode: 'full',
          customPrompt: explainPrompt !== DEFAULT_EXPLAIN_PROMPT ? explainPrompt : undefined,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to explain');
      }

      const data = await res.json();
      setExplanation(data.explanation);
    } catch (err) {
      console.error('Explain error:', err);
      setError('Failed to explain. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleAsk = async () => {
    if (!input.trim()) return;

    const question = input.trim();
    setInput('');

    const newMessages: Message[] = [...messages, { role: 'user', content: question }];
    setMessages(newMessages);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/pages/${page.id}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          history: messages,
          pageText: getPageText(),
          bookTitle: book.display_title || book.title,
          bookAuthor: book.author,
          pageNumber: page.page_number,
          customPrompt: askPrompt !== DEFAULT_ASK_PROMPT ? askPrompt : undefined,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to get answer');
      }

      const data = await res.json();
      setMessages([...newMessages, { role: 'assistant', content: data.answer }]);
    } catch (err) {
      console.error('Ask error:', err);
      setError('Failed to get an answer. Please try again.');
      setMessages(messages);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  const switchToAsk = () => {
    setMode('ask');
    if (explanation) {
      setMessages([{ role: 'assistant', content: explanation }]);
    }
  };

  const goBackToItems = () => {
    setSelectedTerm(null);
    setExplanation(null);
  };

  if (!isOpen) return null;

  // Info modal content
  const renderInfoModal = () => {
    if (!showInfo) return null;

    const isExplain = showInfo === 'explain';
    const title = isExplain ? 'Explain Prompt' : 'Ask Prompt';
    const description = isExplain
      ? 'This prompt is sent to Gemini 3 Flash when you select a term to explain. It tells the AI how to explain that specific concept.'
      : 'This prompt is sent to Gemini 3 Flash when you ask a question. It provides context about the page and guides how the AI should respond.';

    const variables = isExplain
      ? [
          { name: '{context}', desc: 'Book title, author, and page number' },
          { name: '{text}', desc: 'The page text being explained' },
          { name: '{term}', desc: 'The specific term/concept to explain' },
        ]
      : [
          { name: '{page_number}', desc: 'Current page number' },
          { name: '{book_context}', desc: 'Book title and author' },
          { name: '{page_text}', desc: 'Full text of the current page' },
          { name: '{conversation_history}', desc: 'Previous Q&A in this session' },
          { name: '{question}', desc: 'Your current question' },
        ];

    return (
      <div className="absolute inset-0 bg-white z-10 flex flex-col">
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <h3 className="font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
            {title}
          </h3>
          <button
            onClick={() => setShowInfo(null)}
            className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{description}</p>

          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
              Available Variables
            </h4>
            <div className="space-y-2">
              {variables.map((v) => (
                <div key={v.name} className="flex gap-2 text-sm">
                  <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--bg-warm)', color: 'var(--accent-violet)' }}>
                    {v.name}
                  </code>
                  <span style={{ color: 'var(--text-secondary)' }}>{v.desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2" style={{ borderTop: '1px solid var(--border-light)' }}>
            <h4 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
              Tips
            </h4>
            <ul className="text-sm space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>- Keep instructions clear and specific</li>
              <li>- Include the variable placeholders where needed</li>
              <li>- Test changes by selecting a term to explain</li>
              <li>- Use "Reset to Defaults" if things break</li>
            </ul>
          </div>
        </div>
        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-light)' }}>
          <button
            onClick={() => setShowInfo(null)}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-white"
            style={{ background: 'var(--accent-violet)' }}
          >
            Got it
          </button>
        </div>
      </div>
    );
  };

  // Settings view
  const renderSettings = () => (
    <div className="absolute inset-0 bg-white z-10 flex flex-col">
      <div
        className="px-4 py-3 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-light)' }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(false)}
            className="p-1.5 -ml-1 rounded-lg hover:bg-stone-100 transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Settings className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
          <h2
            className="font-medium"
            style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}
          >
            Prompt Settings
          </h2>
        </div>
        <button
          onClick={resetToDefaults}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium hover:bg-stone-100 transition-colors"
          style={{ color: 'var(--text-muted)' }}
          title="Reset both prompts to defaults"
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Explain Prompt */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Explain Term Prompt
            </label>
            <button
              onClick={() => setShowInfo('explain')}
              className="p-1 rounded hover:bg-stone-100 transition-colors"
              style={{ color: 'var(--accent-violet)' }}
              title="Learn about this prompt"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
          <textarea
            value={explainPrompt}
            onChange={(e) => saveExplainPrompt(e.target.value)}
            className="w-full h-40 px-3 py-2 rounded-lg text-sm font-mono resize-none"
            style={{
              background: 'var(--bg-cream)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-secondary)',
            }}
            placeholder="Enter custom explain prompt..."
          />
          {explainPrompt !== DEFAULT_EXPLAIN_PROMPT && (
            <p className="text-xs mt-1" style={{ color: 'var(--accent-violet)' }}>
              Custom prompt active
            </p>
          )}
        </div>

        {/* Ask Prompt */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Ask Prompt
            </label>
            <button
              onClick={() => setShowInfo('ask')}
              className="p-1 rounded hover:bg-stone-100 transition-colors"
              style={{ color: 'var(--accent-violet)' }}
              title="Learn about this prompt"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
          <textarea
            value={askPrompt}
            onChange={(e) => saveAskPrompt(e.target.value)}
            className="w-full h-48 px-3 py-2 rounded-lg text-sm font-mono resize-none"
            style={{
              background: 'var(--bg-cream)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-secondary)',
            }}
            placeholder="Enter custom ask prompt..."
          />
          {askPrompt !== DEFAULT_ASK_PROMPT && (
            <p className="text-xs mt-1" style={{ color: 'var(--accent-violet)' }}>
              Custom prompt active
            </p>
          )}
        </div>

        {/* Model info */}
        <div className="pt-2" style={{ borderTop: '1px solid var(--border-light)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Using <strong>Gemini 3 Flash</strong> · Prompts saved locally
          </p>
        </div>
      </div>

      <div
        className="px-4 py-3 flex-shrink-0"
        style={{ borderTop: '1px solid var(--border-light)', background: 'var(--bg-cream)' }}
      >
        <button
          onClick={() => setShowSettings(false)}
          className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
          style={{ background: 'var(--accent-violet)' }}
        >
          Done
        </button>
      </div>

      {renderInfoModal()}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full sm:max-w-lg max-h-[85vh] sm:max-h-[80vh] bg-white
                   rounded-t-2xl sm:rounded-xl shadow-2xl overflow-hidden flex flex-col
                   animate-in slide-in-from-bottom sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-title"
      >
        {/* Header */}
        <div
          className="px-4 py-3 flex items-center justify-between flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(124, 93, 181, 0.1) 0%, rgba(167, 139, 250, 0.1) 100%)',
            borderBottom: '1px solid var(--border-light)'
          }}
        >
          <div className="flex items-center gap-2">
            {(mode === 'ask' && messages.length > 0) || selectedTerm ? (
              <button
                onClick={() => {
                  if (selectedTerm) {
                    goBackToItems();
                  } else {
                    setMode('explain');
                    setMessages([]);
                  }
                }}
                className="p-1.5 -ml-1 rounded-lg hover:bg-white/50 transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : null}
            {mode === 'explain' ? (
              <Sparkles className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
            ) : (
              <MessageCircle className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
            )}
            <h2
              id="assistant-title"
              className="font-medium"
              style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}
            >
              {mode === 'explain'
                ? selectedTerm
                  ? `Explaining: ${selectedTerm}`
                  : 'What would you like explained?'
                : 'Ask About This Page'}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSettings(true)}
              className="p-1.5 rounded-lg hover:bg-white/50 transition-colors"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Settings"
              title="Customize prompts"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/50 transition-colors"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Page context */}
        <div
          className="px-4 py-2 text-xs flex-shrink-0"
          style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}
        >
          <span style={{ fontFamily: 'Cormorant Garamond, Georgia, serif' }}>
            {book.display_title || book.title}
          </span>
          <span className="mx-2">·</span>
          <span>Page {page.page_number}</span>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-auto p-4 min-h-[200px]">
          {mode === 'explain' ? (
            <>
              {/* Loading state */}
              {loading && (
                <div className="flex flex-col items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: 'var(--accent-violet)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {selectedTerm ? 'Explaining...' : 'Analyzing the page...'}
                  </p>
                </div>
              )}

              {/* Error state */}
              {error && !loading && (
                <div className="text-center py-8">
                  <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>{error}</p>
                  <button
                    onClick={selectedTerm ? () => handleExplainTerm(selectedTerm) : handleAnalyze}
                    className="text-sm font-medium hover:underline"
                    style={{ color: 'var(--accent-violet)' }}
                  >
                    Try again
                  </button>
                </div>
              )}

              {/* Explanation view */}
              {selectedTerm && explanation && !loading && (
                <div
                  className="prose prose-sm max-w-none leading-relaxed"
                  style={{ fontFamily: 'Newsreader, Georgia, serif', color: 'var(--text-secondary)' }}
                >
                  {explanation.split('\n').map((paragraph, i) => (
                    <p key={i} className="mb-3">{paragraph}</p>
                  ))}
                </div>
              )}

              {/* Items list view */}
              {!selectedTerm && !loading && !error && explainItems.length > 0 && (
                <div className="space-y-2">
                  {explainItems.map((item, i) => {
                    const style = TYPE_STYLES[item.type] || TYPE_STYLES.concept;
                    return (
                      <button
                        key={i}
                        onClick={() => handleExplainTerm(item.term)}
                        className="w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all hover:bg-violet-50 group"
                        style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
                      >
                        <span
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-medium flex-shrink-0"
                          style={{ background: `${style.color}15`, color: style.color }}
                        >
                          {style.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                            {item.term}
                          </p>
                          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                            {item.preview}
                          </p>
                        </div>
                        <ChevronRight
                          className="w-4 h-4 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ color: 'var(--accent-violet)' }}
                        />
                      </button>
                    );
                  })}

                  {/* Explain All option */}
                  <button
                    onClick={handleExplainAll}
                    className="w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all hover:bg-stone-100 group mt-4"
                    style={{ border: '1px dashed var(--border-medium)' }}
                  >
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)' }}
                    >
                      <BookOpen className="w-4 h-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Explain the whole page
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Get a general overview instead
                      </p>
                    </div>
                  </button>
                </div>
              )}

              {/* Quick options - show immediately */}
              {!selectedTerm && !loading && !error && explainItems.length === 0 && !explanation && (
                <div className="space-y-3">
                  <p className="text-sm text-center mb-4" style={{ color: 'var(--text-muted)' }}>
                    What would you like explained?
                  </p>

                  {/* Quick explain options */}
                  {[
                    { label: 'Summarize this page', icon: '📝', query: 'full page' },
                    { label: 'Explain difficult terms', icon: 'Aa', query: 'difficult terms and archaic language' },
                    { label: 'Historical context', icon: '📜', query: 'the historical context and background' },
                    { label: 'Key concepts', icon: '💡', query: 'the key concepts and ideas' },
                  ].map((option) => (
                    <button
                      key={option.query}
                      onClick={() => handleExplainTerm(option.query)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all hover:bg-violet-50"
                      style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
                    >
                      <span
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                        style={{ background: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet)' }}
                      >
                        {option.icon}
                      </span>
                      <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                        {option.label}
                      </span>
                    </button>
                  ))}

                  {/* Custom input */}
                  <div className="pt-3 mt-3" style={{ borderTop: '1px solid var(--border-light)' }}>
                    <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                      Or type what you want explained:
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && input.trim()) {
                            handleExplainTerm(input.trim());
                          }
                        }}
                        placeholder="e.g., 'the philosopher's stone'"
                        className="flex-1 px-3 py-2 rounded-lg text-sm"
                        style={{
                          background: 'var(--bg-white)',
                          border: '1px solid var(--border-medium)',
                          color: 'var(--text-primary)'
                        }}
                      />
                      <button
                        onClick={() => input.trim() && handleExplainTerm(input.trim())}
                        disabled={!input.trim()}
                        className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                        style={{ background: 'var(--accent-violet)' }}
                      >
                        Go
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            // Ask mode content
            <div className="space-y-4">
              {messages.length === 0 && !loading && (
                <div className="text-center py-4">
                  <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
                    Ask anything about this page
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 mt-4">
                    {['What is this about?', 'Who is mentioned here?', 'Explain the main idea'].map((q) => (
                      <button
                        key={q}
                        onClick={() => {
                          setInput(q);
                          inputRef.current?.focus();
                        }}
                        className="px-3 py-1.5 text-xs rounded-full transition-colors hover:bg-violet-100"
                        style={{
                          background: 'var(--bg-warm)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-light)'
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`${msg.role === 'user' ? 'ml-8' : 'mr-8'}`}
                >
                  <div
                    className={`rounded-2xl px-4 py-2.5 ${
                      msg.role === 'user' ? 'rounded-br-md' : 'rounded-bl-md'
                    }`}
                    style={{
                      background: msg.role === 'user' ? 'var(--accent-violet)' : 'var(--bg-warm)',
                      color: msg.role === 'user' ? 'white' : 'var(--text-secondary)',
                    }}
                  >
                    <p
                      className="text-sm leading-relaxed"
                      style={{ fontFamily: msg.role === 'assistant' ? 'Newsreader, Georgia, serif' : 'inherit' }}
                    >
                      {msg.content}
                    </p>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="mr-8">
                  <div
                    className="rounded-2xl rounded-bl-md px-4 py-3 inline-flex items-center gap-2"
                    style={{ background: 'var(--bg-warm)' }}
                  >
                    <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-violet)' }} />
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Thinking...</span>
                  </div>
                </div>
              )}

              {error && (
                <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>{error}</p>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div
          className="px-4 py-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--border-light)', background: 'var(--bg-cream)' }}
        >
          {mode === 'explain' ? (
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors hover:bg-stone-200"
                style={{ color: 'var(--text-muted)' }}
              >
                Close
              </button>
              <button
                onClick={switchToAsk}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--accent-violet)' }}
              >
                <MessageCircle className="w-4 h-4" />
                Ask More
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question..."
                disabled={loading}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
                style={{
                  background: 'var(--bg-white)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-primary)'
                }}
              />
              <button
                onClick={handleAsk}
                disabled={loading || !input.trim()}
                className="p-2.5 rounded-lg text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--accent-violet)' }}
                aria-label="Send"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        {/* Settings overlay */}
        {showSettings && renderSettings()}
      </div>
    </div>
  );
}
