'use client';

import { useState, useEffect, useRef } from 'react';
import { Sparkles, MessageCircle, X, Loader2, Send, ArrowLeft } from 'lucide-react';
import type { Page, Book } from '@/lib/types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface PageAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode: 'explain' | 'ask';
  page: Page;
  book: Book;
}

export default function PageAssistant({
  isOpen,
  onClose,
  initialMode,
  page,
  book,
}: PageAssistantProps) {
  const [mode, setMode] = useState<'explain' | 'ask'>(initialMode);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setExplanation(null);
      setMessages([]);
      setInput('');
      setError(null);

      // Auto-explain if in explain mode
      if (initialMode === 'explain') {
        handleExplain();
      }
    }
  }, [isOpen, initialMode]);

  // Focus input when switching to ask mode
  useEffect(() => {
    if (mode === 'ask' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [mode]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const getPageText = () => {
    // Use translation if available, fall back to OCR
    return page.translation?.data || page.ocr?.data || '';
  };

  const handleExplain = async () => {
    const text = getPageText();
    if (!text) {
      setError('No text available on this page');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // For long pages, use first ~3000 chars (API will handle it)
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
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to get explanation');
      }

      const data = await res.json();
      setExplanation(data.explanation);
    } catch (err) {
      console.error('Explain error:', err);
      setError('Failed to explain this page. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleAsk = async () => {
    if (!input.trim()) return;

    const question = input.trim();
    setInput('');

    // Add user message
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
      // Remove the user message on error
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
    // If we have an explanation, add it as context
    if (explanation) {
      setMessages([
        { role: 'assistant', content: explanation }
      ]);
    }
  };

  if (!isOpen) return null;

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
            {mode === 'ask' && messages.length > 0 && (
              <button
                onClick={() => {
                  setMode('explain');
                  setMessages([]);
                }}
                className="p-1.5 -ml-1 rounded-lg hover:bg-white/50 transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
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
              {mode === 'explain' ? 'Explain This Page' : 'Ask About This Page'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/50 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
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
            // Explain mode content
            <>
              {loading && (
                <div className="flex flex-col items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: 'var(--accent-violet)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Reading the page...</p>
                </div>
              )}

              {error && (
                <div className="text-center py-8">
                  <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>{error}</p>
                  <button
                    onClick={handleExplain}
                    className="text-sm font-medium hover:underline"
                    style={{ color: 'var(--accent-violet)' }}
                  >
                    Try again
                  </button>
                </div>
              )}

              {explanation && !loading && (
                <div
                  className="prose prose-sm max-w-none leading-relaxed"
                  style={{ fontFamily: 'Newsreader, Georgia, serif', color: 'var(--text-secondary)' }}
                >
                  {explanation.split('\n').map((paragraph, i) => (
                    <p key={i} className="mb-3">{paragraph}</p>
                  ))}
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
                      msg.role === 'user'
                        ? 'rounded-br-md'
                        : 'rounded-bl-md'
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
      </div>
    </div>
  );
}
