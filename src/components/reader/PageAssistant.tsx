'use client';

import { useState, useEffect, useRef } from 'react';
import { Sparkles, MessageCircle, X, Loader2, Send, ArrowLeft, Settings, Info, RotateCcw, ChevronRight, BookOpen, MessageSquarePlus } from 'lucide-react';
import type { Page, Book } from '@/lib/types';
import { utils, pages } from '@/lib/api-client';

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
  onOpenAnnotations?: () => void;
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

// AI Personas for Ask mode
interface AskPersona {
  id: string;
  name: string;
  icon: string;
  description: string;
  systemPrompt: string;
  authorSearchTerms?: string[]; // Search terms to find their works in Source Library
}

const ASK_PERSONAS: AskPersona[] = [
  {
    id: 'ficino',
    name: 'Marsilio Ficino',
    icon: '✨',
    description: 'Neoplatonist, translator of Plato & Hermes',
    systemPrompt: `You are Marsilio Ficino (1433-1499), the Florentine philosopher who translated Plato and the Hermetic texts for Cosimo de' Medici. You see all wisdom as flowing from a single divine source—Plato, Hermes Trismegistus, and Christ speak the same truths in different tongues. Interpret this text through the lens of divine love, the world-soul, and the ascent of the mind toward the One. Speak warmly and philosophically, as if writing to a fellow seeker in your Platonic Academy.

When relevant, cite your own writings from the Source Library to support your interpretations.`,
    authorSearchTerms: ['Ficino', 'Marsilio'],
  },
  {
    id: 'agrippa',
    name: 'Cornelius Agrippa',
    icon: '🔮',
    description: 'Occult philosopher, magus, skeptic',
    systemPrompt: `You are Heinrich Cornelius Agrippa (1486-1535), author of "Three Books of Occult Philosophy." You have studied the magical traditions deeply—Kabbalah, astrology, natural magic—but you also wrote "On the Vanity of the Sciences" questioning all human knowledge. Interpret this text through your understanding of the three worlds (elemental, celestial, intellectual) and the hidden correspondences between them. Be learned but also hint at the dangers and limitations of such knowledge.

When relevant, cite your own writings from the Source Library to support your interpretations.`,
    authorSearchTerms: ['Agrippa', 'Cornelius Agrippa'],
  },
  {
    id: 'paracelsus',
    name: 'Paracelsus',
    icon: '⚗️',
    description: 'Alchemist, physician, revolutionary',
    systemPrompt: `You are Theophrastus Paracelsus (1493-1541), the wandering physician who burned Avicenna's books and declared that experience trumps ancient authority. You see alchemy as medicine for body and soul—the tria prima of salt, sulfur, and mercury govern all things. Interpret this text through your understanding of the vital forces in nature. Be bold, iconoclastic, and practical. Speak as one who has learned from miners, peasants, and the book of nature itself.

When relevant, cite your own writings from the Source Library to support your interpretations.`,
    authorSearchTerms: ['Paracelsus', 'Theophrastus'],
  },
  {
    id: 'comenius',
    name: 'Jan Comenius',
    icon: '📚',
    description: 'Pansophist, educator, reformer',
    systemPrompt: `You are Jan Amos Comenius (1592-1670), the "teacher of nations" who dreamed of universal education and pansophia—wisdom that unites all knowledge for the betterment of humanity. You fled persecution but never lost faith that learning could heal the world's divisions. Interpret this text through your vision of interconnected knowledge. Ask how these ideas might be taught to all people, how they connect to other disciplines, and what practical wisdom they offer for human flourishing.

When relevant, cite your own writings from the Source Library to support your interpretations.`,
    authorSearchTerms: ['Comenius', 'Komensky'],
  },
];

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
  onOpenAnnotations,
}: PageAssistantProps) {
  const [mode, setMode] = useState<'explain' | 'ask'>(initialMode);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainItems, setExplainItems] = useState<ExplainItem[]>([]);
  const [selectedTerm, setSelectedTerm] = useState<string | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<AskPersona | null>(null);
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
      setSelectedPersona(null);
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

      const data = await utils.explain({
        text: truncatedText,
        book_title: book.display_title || book.title,
        book_author: book.author,
        page_number: page.page_number,
        mode: 'analyze',
      });

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

      // Use book_context mode for "Context from the book" option
      const isBookContext = term === 'book context';

      const data = await utils.explain({
        text: truncatedText,
        book_title: book.display_title || book.title,
        book_author: book.author,
        page_number: page.page_number,
        book_id: isBookContext ? book.id : undefined,
        mode: isBookContext ? 'book_context' : 'explain_term',
        term: isBookContext ? undefined : term,
        customPrompt: explainPrompt !== DEFAULT_EXPLAIN_PROMPT ? explainPrompt : undefined,
      });

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

      const data = await utils.explain({
        text: truncatedText,
        book_title: book.display_title || book.title,
        book_author: book.author,
        page_number: page.page_number,
        mode: 'full' as any,
        customPrompt: explainPrompt !== DEFAULT_EXPLAIN_PROMPT ? explainPrompt : undefined,
      });

      setExplanation(data.explanation);
    } catch (err) {
      console.error('Explain error:', err);
      setError('Failed to explain. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleAsk = async () => {
    if (!input.trim() || !selectedPersona) return;

    const question = input.trim();
    setInput('');

    const newMessages: Message[] = [...messages, { role: 'user', content: question }];
    setMessages(newMessages);
    setLoading(true);
    setError(null);

    try {
      // Build prompt with persona's system prompt
      const personaPrompt = `${selectedPersona.systemPrompt}

A reader is studying page {page_number} from {book_context}.

Here is the text from this page:
---
{page_text}
---

{author_sources}

{conversation_history}The reader asks: "{question}"

Respond in character, keeping your answers focused and conversational (2-3 paragraphs max unless more detail is needed). If you cite your own works, include the citation in parentheses.`;

      const data = await pages.ask(page.id, {
        question,
        history: messages,
        pageText: getPageText(),
        bookTitle: book.display_title || book.title,
        bookAuthor: book.author,
        pageNumber: page.page_number,
        customPrompt: askPrompt !== DEFAULT_ASK_PROMPT ? askPrompt : personaPrompt,
        authorSearchTerms: selectedPersona.authorSearchTerms,
        personaName: selectedPersona.name,
      });

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
            {(mode === 'ask' && (messages.length > 0 || selectedPersona)) || selectedTerm ? (
              <button
                onClick={() => {
                  if (selectedTerm) {
                    goBackToItems();
                  } else if (messages.length > 0) {
                    // Clear messages but keep persona
                    setMessages([]);
                  } else if (selectedPersona) {
                    // Go back to persona selection
                    setSelectedPersona(null);
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
            ) : selectedPersona ? (
              <span className="text-lg">{selectedPersona.icon}</span>
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
                : selectedPersona
                  ? selectedPersona.name
                  : 'Choose your guide'}
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
                    { label: 'Historical context', icon: '📜', query: 'the historical context and background' },
                    { label: 'Context from the book', icon: '📖', query: 'book context' },
                    { label: 'Explain difficult terms', icon: 'Aa', query: 'difficult terms and archaic language' },
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

                  {/* Comment on this page - opens annotation editor */}
                  {onOpenAnnotations && (
                    <button
                      onClick={() => {
                        onClose();
                        onOpenAnnotations();
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all hover:bg-amber-50"
                      style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
                    >
                      <span
                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: 'rgba(180, 83, 9, 0.1)', color: 'var(--accent-rust)' }}
                      >
                        <MessageSquarePlus className="w-4 h-4" />
                      </span>
                      <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                        Comment on this page
                      </span>
                    </button>
                  )}

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
              {/* Persona selection - show if no persona selected */}
              {!selectedPersona && !loading && (
                <div className="space-y-3">
                  <p className="text-sm text-center mb-4" style={{ color: 'var(--text-muted)' }}>
                    Choose your guide
                  </p>
                  {ASK_PERSONAS.map((persona) => (
                    <button
                      key={persona.id}
                      onClick={() => setSelectedPersona(persona)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all hover:bg-violet-50"
                      style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
                    >
                      <span
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0"
                        style={{ background: 'rgba(124, 93, 181, 0.1)' }}
                      >
                        {persona.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                          {persona.name}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {persona.description}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Chat interface - show after persona selected */}
              {selectedPersona && messages.length === 0 && !loading && (
                <div className="text-center py-4">
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <span className="text-2xl">{selectedPersona.icon}</span>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      {selectedPersona.name}
                    </span>
                  </div>
                  <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                    {selectedPersona.description}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {['What is this about?', 'What should I notice?', 'Is this credible?'].map((q) => (
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
                    className={`rounded-2xl px-4 py-2.5 ${msg.role === 'user' ? 'rounded-br-md' : 'rounded-bl-md'
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
          ) : selectedPersona ? (
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
          ) : (
            <button
              onClick={onClose}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors hover:bg-stone-200"
              style={{ color: 'var(--text-muted)' }}
            >
              Close
            </button>
          )}
        </div>

        {/* Settings overlay */}
        {showSettings && renderSettings()}
      </div>
    </div>
  );
}
