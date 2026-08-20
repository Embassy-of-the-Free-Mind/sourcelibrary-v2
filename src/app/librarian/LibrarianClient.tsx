'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tenantBookUrl } from '@/lib/slugify';
import { applyCitationFixes, applyImageRemovals } from '@/lib/embassy/citation-fixes';
// remarkBreaks removed — we use ensureParagraphBreaks() instead for proper spacing
import SiteHeader from '@/components/layout/SiteHeader';
import LibrarianMessageBody from './_components/MessageBody';

// ── Types ─────────────────────────────────────────────────────────────

// Minimal Web Speech API surface (not in the default TS DOM lib).
interface SpeechRecognitionResultEventLike {
  results: ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionResultEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

interface SourceCard {
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  bookSlug?: string;
  pageNumber?: number;
  snippet?: string;
  inCollection: boolean;
}

interface SearchStep {
  name: string;
  query: string;
  summary?: string;
  found?: number;
  status: 'searching' | 'done';
}

interface AssistantMessage {
  role: 'assistant';
  thinking?: string;
  steps: SearchStep[];
  content: string;
  sources: SourceCard[];
  choices?: { text: string; options: string[]; descriptions?: (string | undefined)[] };
  notebookCount?: number;
  notebookTopic?: string;
  // Set when the turn failed (timeout, network cut, upstream error). Enables
  // the one-click "Try again" button, which resends retryQuestion.
  error?: boolean;
  retryQuestion?: string;
}

interface NotebookFinding {
  key: string;
  quote: string;
  note: string;
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  bookSlug?: string;
  pageNumber: number;
}

interface UserMessage {
  role: 'user';
  content: string;
}

type Message = UserMessage | AssistantMessage;

interface ThreadPreview {
  id: string;
  title: string;
  creatorName: string;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string;
  preview: { question: string; answer: string };
}

interface FeaturedPassage {
  text: string;
  bookTitle: string;
  bookAuthor: string;
  bookYear: number | null;
  bookSlug: string;
  pageNumber: number;
  pageId?: string;
}

interface LibrarianClientProps {
  featuredPassage: FeaturedPassage | null;
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const TOOL_LABELS: Record<string, string> = {
  search: 'Searching the collection',
  search_collection: 'Searching the collection',
  search_semantic: 'Semantic search',
  search_wikipedia: 'Checking Wikipedia',
  search_images: 'Searching illustrations',
  search_artworks: 'Searching artworks',
  get_book_page: 'Reading a page',
  read_nearby_pages: 'Reading nearby pages',
  add_to_notebook: 'Saving to notebook',
  present_choices: 'Thinking...',
};

// ── Source Card Component ─────────────────────────────────────────────

function SourceCardRow({ sources, tenant }: { sources: SourceCard[]; tenant?: string }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-3 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {sources.map((s, i) => {
        const url = tenantBookUrl({ slug: s.bookSlug, id: s.bookId }, tenant) + (s.pageNumber ? `/page-number/${s.pageNumber}` : '');
        return (
          <Link
            key={`${s.bookId}-${s.pageNumber}-${i}`}
            href={url}
            className={`flex-shrink-0 w-[200px] rounded-lg border p-2.5 transition-colors ${s.inCollection
                ? 'border-[#e8e4dc] bg-white hover:border-[#c9a86c] hover:bg-[#faf8f4]'
                : 'border-dashed border-[#d4d0c8] bg-[#f9f7f3] opacity-60'
              }`}
          >
            <p className="text-[12px] font-body text-[#1a1612] font-medium leading-tight line-clamp-2">
              {s.bookTitle}
            </p>
            <p className="text-[10px] text-[#8a8480] font-body mt-0.5">
              {s.bookAuthor}
              {s.pageNumber ? ` · p. ${s.pageNumber}` : ''}
            </p>
            {s.snippet && (
              <p className="text-[10px] text-[#6b6560] font-body mt-1 line-clamp-2 italic leading-relaxed">
                {s.snippet}
              </p>
            )}
            {!s.inCollection && (
              <p className="text-[9px] text-[#b0a89c] font-sans mt-1">Not yet in collection</p>
            )}
          </Link>
        );
      })}
    </div>
  );
}

// ── Search Steps Component ────────────────────────────────────────────

function SearchSteps({ steps }: { steps: SearchStep[] }) {
  if (steps.length === 0) return null;
  const busy = steps.some(s => s.status === 'searching');
  return (
    <div role="status" aria-live="polite" aria-busy={busy} className="space-y-1 mb-2">
      {steps.map((step, i) => {
        const statusLabel =
          step.status === 'searching' ? 'in progress'
            : step.found && step.found > 0 ? 'found results'
            : 'no results';
        return (
        <div key={i} className="flex items-center gap-2 text-[12px] font-sans text-[#8a8480]">
          <span
            role="img"
            aria-label={statusLabel}
            className={`inline-block w-3.5 text-center ${step.status === 'done' ? (step.found && step.found > 0 ? 'text-[#6b8f5e]' : 'text-[#b0a89c]') : 'text-[#c9a86c]'}`}
          >
            {step.status === 'searching' ? (
              <span aria-hidden className="inline-block animate-pulse">...</span>
            ) : step.found && step.found > 0 ? (
              <span aria-hidden>&#x2713;</span>
            ) : (
              <span aria-hidden>&#x2717;</span>
            )}
          </span>
          <span>
            {TOOL_LABELS[step.name] || step.name}
            {step.query && <span className="text-[#b0a89c]"> &ldquo;{step.query.slice(0, 50)}{step.query.length > 50 ? '...' : ''}&rdquo;</span>}
            {step.status === 'done' && step.summary && (
              <span className="text-[#6b6560]"> &mdash; {step.summary}</span>
            )}
          </span>
        </div>
        );
      })}
    </div>
  );
}

// ── Research Notebook Panel ───────────────────────────────────────────
// Surfaces the findings the Librarian saved this session, so the notebook is
// something you can read and cite — not just a count badge that's opaque
// until export.

function NotebookPanel({
  findings,
  topic,
  threadId,
  onClose,
}: {
  findings: NotebookFinding[];
  topic?: string;
  threadId: string | null;
  onClose: () => void;
}) {
  return (
    <div className="border-t border-[#e8e4dc] bg-[#faf8f4]">
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2 text-[13px] font-sans text-[#6b8f5e]">
          <span aria-hidden>&#x1F4D3;</span>
          <span className="font-medium">Research notebook</span>
          <span className="text-[#8a8480]">
            {findings.length} finding{findings.length === 1 ? '' : 's'}{topic ? ` · ${topic}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {threadId && (
            <a
              href={`/api/embassy/threads/${threadId}/notebook`}
              download
              className="text-[11px] text-[#6b8f5e] hover:text-[#4a6b40] font-sans"
            >
              Export
            </a>
          )}
          <button onClick={onClose} className="text-[11px] text-[#8a8480] hover:text-[#6b6560] font-sans">
            Close
          </button>
        </div>
      </div>
      <div className="max-h-[40vh] overflow-y-auto px-4 pb-3 space-y-3">
        {findings.map((f) => {
          const url = `/book/${f.bookSlug || f.bookId}/page-number/${f.pageNumber}`;
          return (
            <div key={f.key} className="rounded-lg border border-[#e8e4dc] bg-white px-3 py-2.5">
              <blockquote className="border-l-2 border-[#c9a86c] pl-3 text-[13px] font-body italic text-[#444] leading-relaxed">
                {f.quote}
              </blockquote>
              {f.note && (
                <p className="mt-2 text-[12px] font-body text-[#6b6560] leading-relaxed">{f.note}</p>
              )}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-block text-[11px] font-sans text-[#9e4a3a] hover:underline"
              >
                {f.bookTitle} &mdash; {f.bookAuthor}, p.{f.pageNumber}
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────

const ALL_SUGGESTIONS = [
  // Alchemy & Hermetica
  'How did alchemists describe the philosopher\'s stone?',
  'What did alchemists believe about gold?',
  'Tell me about the Emerald Tablet',
  'Who was Hermes Trismegistus?',
  'What equipment did a working alchemist actually use?',
  'How did Arabic alchemy reach medieval Europe?',
  'What did alchemists mean by the marriage of the sun and moon?',
  // Renaissance philosophy & magic
  'Who was Marsilio Ficino?',
  'What do these texts say about the world soul?',
  'What did Agrippa write about planetary seals?',
  'What is the relationship between music and magic?',
  'What books explore resonance as magic?',
  'How did Giordano Bruno imagine infinite worlds?',
  'What was the art of memory?',
  'Was there any conception of artificial intelligence?',
  'Did anyone write about talking statues or artificial beings?',
  // Kabbalah & religious mysticism
  'What is the Kabbalah\'s tree of life?',
  'What did Christian scholars make of the Zohar?',
  'What did Jacob Boehme see in his visions?',
  'How did mystics describe union with the divine?',
  // Astrology & cosmology
  'What instruments did astrologers use?',
  'How did Renaissance scholars understand the cosmos?',
  'How were comets interpreted before modern astronomy?',
  'How did Kepler mix astrology with astronomy?',
  'What did people believe about the music of the spheres?',
  // Medicine & natural history
  'What did Paracelsus teach about medicine?',
  'How were dreams interpreted as medical symptoms?',
  'What remedies did early herbals prescribe?',
  'How did physicians explain the plague?',
  'What did anatomists discover before the microscope?',
  // Magic, witchcraft & demonology
  'How were demons understood in early modern Europe?',
  'What did witch-hunting manuals actually claim?',
  'How did scholars defend accused witches?',
  'What were angels thought to know?',
  // Dreams, divination & prophecy
  'Did any of these authors write about dreams?',
  'How did people tell fortunes before tarot cards?',
  'What prophecies circulated during the Reformation?',
  // Rosicrucians & secret societies
  'Who were the Rosicrucians?',
  'What ciphers and secret alphabets appear in these books?',
  'What did the Rosicrucian manifestos promise?',
  // Eastern traditions
  'What do Tibetan texts say about the nature of mind?',
  'What does Ayurvedic medicine say about the elements?',
  'How did Sanskrit astronomers calculate eclipses?',
  // Art, images & books themselves
  'What are the strangest illustrations in the collection?',
  'How were emblem books meant to be read?',
  'What did the first printed books look like?',
  'Which books here were never translated until now?',
];

function pickSuggestions(count: number, extras: string[] = []): string[] {
  const pool = [...ALL_SUGGESTIONS].sort(() => Math.random() - 0.5);
  const picks = [...extras, ...pool.filter(s => !extras.includes(s))].slice(0, count);
  // Second shuffle so real visitor questions don't always sit first.
  return picks.sort(() => Math.random() - 0.5);
}

// Filter for surfacing real visitor questions (from public threads, already
// shown verbatim in the Recent sidebar) as suggestion chips. Keeps genuine
// questions; drops imperative prompts ("write a 30 sec reel"), links, and
// anything too short or long to make a good chip.
const QUESTION_START_RE = /^(what|who|whose|how|why|did|do|does|was|were|is|are|which|where|when|can|could|tell me|show me|explain)\b/i;
function looksLikeGoodQuestion(q: string): boolean {
  const t = q.trim();
  return t.length >= 20 && t.length <= 80
    && !t.includes('\n')
    && !/https?:\/\//i.test(t)
    && QUESTION_START_RE.test(t);
}

export default function LibrarianClient({ featuredPassage }: LibrarianClientProps) {
  const { data: session, status } = useSession();
  const params = useParams<{ tenant: string }>();
  const tenant = params?.tenant;
  const [messages, setMessages] = useState<Message[]>([]);
  // Seed deterministically so SSR and the first client render agree (a random
  // initial set caused a hydration mismatch — React #418). Shuffle for variety
  // only after mount, where a state update is safe.
  const [suggestions, setSuggestions] = useState<string[]>(() => ALL_SUGGESTIONS.slice(0, 6));
  useEffect(() => { setSuggestions(pickSuggestions(6)); }, []);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadPreview[]>([]);
  const [myThreads, setMyThreads] = useState<ThreadPreview[]>([]);
  // A list has three states, not one. Collapsing them was the whole of #4070:
  // an in-flight or failed fetch left the array empty, and empty rendered as
  // "No conversations yet" — telling a reader with 112 conversations that they
  // had none. Never infer emptiness from an array that hasn't loaded.
  const [threadsState, setThreadsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [myThreadsState, setMyThreadsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reloadMine, setReloadMine] = useState(0);
  const [sidebarTab, setSidebarTab] = useState<'recent' | 'mine'>('recent');
  // Default to "My Conversations" once signed in
  useEffect(() => {
    if (status === 'authenticated') setSidebarTab('mine');
  }, [status]);
  // Listed by default. The toggle beneath the composer controls whether the
  // conversation appears in Recent — it never controls a name, because the
  // server strips those from every surface but the reader's own.
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  // Research notebook accumulated live across the thread (from notebook_update).
  const [notebookFindings, setNotebookFindings] = useState<NotebookFinding[]>([]);
  const [notebookTopic, setNotebookTopic] = useState<string | undefined>();
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [showThinking, setShowThinking] = useState(true);
  const [visibleThreads, setVisibleThreads] = useState(5);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatCardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Speech input (Web Speech API dictation) ─────────────────────────
  // Live transcription into the textarea; the user reviews/edits, then sends.
  // Chrome/Edge/Safari only — the mic button is hidden where unsupported.
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Text already in the box when dictation starts; transcripts append to it.
  const dictationBaseRef = useRef('');

  useEffect(() => {
    setSpeechSupported(Boolean(getSpeechRecognitionCtor()));
    return () => recognitionRef.current?.abort();
  }, []);

  const stopDictation = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const toggleDictation = useCallback(() => {
    if (listening) {
      stopDictation();
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    const current = inputRef.current?.value ?? '';
    dictationBaseRef.current = current ? current.replace(/\s+$/, '') + ' ' : '';
    rec.onresult = (e: SpeechRecognitionResultEventLike) => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      setInput(dictationBaseRef.current + transcript);
      // Mirror handleInputChange's auto-grow, since programmatic setState
      // doesn't fire the textarea's onChange.
      const el = inputRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.style.height = 'auto';
          el.style.height = Math.min(el.scrollHeight, 200) + 'px';
        });
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
    inputRef.current?.focus();
  }, [listening, stopDictation]);

  // Flip the listing toggle. If the conversation already exists it has to be
  // written through immediately: the old toggle only ever fed the create call,
  // so a reader who turned listing off mid-conversation changed nothing and
  // was never told.
  const setListed = useCallback((listed: boolean) => {
    setVisibility(listed ? 'public' : 'private');
    if (!threadId) return;
    fetch(`/api/embassy/threads/${threadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listed }),
    }).catch(() => { });
  }, [threadId]);

  // Fetch public threads
  useEffect(() => {
    let live = true;
    setThreadsState('loading');
    fetch('/api/embassy/threads?limit=50')
      .then(async r => {
        if (!r.ok) throw new Error(`threads ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (!live) return;
        setThreads(data.threads ?? []);
        setThreadsState('ready');
      })
      .catch(() => { if (live) setThreadsState('error'); });
    return () => { live = false; };
  }, []);

  // Blend up to two real visitor questions into the suggestion chips once
  // public threads arrive, so the chips reflect what people actually ask.
  useEffect(() => {
    const real = Array.from(new Set(
      threads.map(t => t.preview.question).filter(looksLikeGoodQuestion),
    ));
    if (real.length === 0) return;
    const extras = real.sort(() => Math.random() - 0.5).slice(0, 2);
    setSuggestions(pickSuggestions(6, extras));
  }, [threads]);

  // Fetch the reader's own threads once the session resolves. While NextAuth is
  // still deciding (`status === 'loading'`) this list is NOT empty — it is
  // unknown, so it stays in the loading state rather than claiming there is no
  // history.
  useEffect(() => {
    if (status !== 'authenticated') {
      if (status === 'unauthenticated') setMyThreadsState('ready');
      return;
    }
    let live = true;
    setMyThreadsState('loading');
    fetch('/api/embassy/threads?mine=true&limit=20')
      .then(async r => {
        if (!r.ok) throw new Error(`mine ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (!live) return;
        setMyThreads(data.threads ?? []);
        setMyThreadsState('ready');
      })
      .catch(() => { if (live) setMyThreadsState('error'); });
    return () => { live = false; };
  }, [status, reloadMine]);

  // Auto-scroll
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    if (isNearBottom) container.scrollTop = container.scrollHeight;
  }, [messages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  };

  // Update the last assistant message immutably
  const updateLastAssistant = useCallback((updater: (msg: AssistantMessage) => AssistantMessage) => {
    setMessages(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === 'assistant') {
        updated[updated.length - 1] = updater(last as AssistantMessage);
      }
      return updated;
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    if (listening) stopDictation();
    setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    setSending(true);
    if (inputRef.current) inputRef.current.style.height = 'auto';

    // Create empty assistant message
    const emptyAssistant: AssistantMessage = {
      role: 'assistant',
      steps: [],
      content: '',
      sources: [],
    };
    setMessages(prev => [...prev, emptyAssistant]);

    // On a touch device the input sits below the fold (hero + tall chat panel
    // push it down), so after submitting you'd be left staring at the text box
    // while the Librarian works above it — you had to scroll up to see anything
    // happening. Dismiss the keyboard and pull the conversation into view so the
    // search steps and response are visible as they stream in.
    if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) {
      inputRef.current?.blur();
      requestAnimationFrame(() => {
        chatCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch('/api/embassy/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          message: trimmed,
          history: messages.map(m => ({
            role: m.role,
            content: m.role === 'user' ? m.content : (m as AssistantMessage).content,
          })),
          visibility,
          stream: true,
        }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401 || res.status === 429 || err.code === 'SIGNIN_REQUIRED') {
          // Anonymous visitors get a few free questions; past that we ask them
          // to sign in (free) to continue.
          updateLastAssistant(m => ({
            ...m,
            content: 'You\'ve used your free questions for now. [Sign in](/auth/signin?callbackUrl=/librarian&reason=limit) (free) to keep talking with the Librarian — create an account or sign in with Google.',
          }));
        } else {
          updateLastAssistant(m => ({
            ...m,
            error: true,
            retryQuestion: trimmed,
            content: err.error || 'I’m sorry — something went wrong on my end. Try again?',
          }));
        }
        setSending(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));

              switch (event.type) {
                case 'threadId':
                  if (!threadId) {
                    setThreadId(event.threadId);
                    // Keep the conversation in the URL so browser Back (e.g.
                    // after following a source link) restores it instead of
                    // landing on an empty chat. replaceState avoids a Next.js
                    // navigation; the restore effect reads location directly.
                    window.history.replaceState(null, '', `${window.location.pathname}?thread=${event.threadId}`);
                  }
                  break;

                case 'thinking':
                  updateLastAssistant(m => ({
                    ...m,
                    thinking: (m.thinking || '') + (event.text || ''),
                  }));
                  break;

                case 'tool_call':
                  updateLastAssistant(m => ({
                    ...m,
                    steps: [...m.steps, {
                      name: event.name,
                      query: event.query || '',
                      status: 'searching' as const,
                    }],
                  }));
                  break;

                case 'tool_result':
                  updateLastAssistant(m => ({
                    ...m,
                    steps: m.steps.map((s, i) =>
                      i === m.steps.length - 1 && s.status === 'searching'
                        ? { ...s, status: 'done' as const, summary: event.summary, found: event.found }
                        : s
                    ),
                  }));
                  break;

                case 'choices':
                  updateLastAssistant(m => ({
                    ...m,
                    choices: { text: event.text, options: event.options, descriptions: event.descriptions },
                  }));
                  break;

                case 'chunk':
                  updateLastAssistant(m => ({
                    ...m,
                    content: m.content + (event.text || ''),
                  }));
                  break;

                case 'citation_fixes':
                  // Server-side citation check repaired broken book links after
                  // the text streamed — apply the same rewrites on-screen (the
                  // persisted message is repaired server-side).
                  updateLastAssistant(m => ({
                    ...m,
                    content: applyCitationFixes(m.content, event.fixes || []),
                  }));
                  break;

                case 'image_removals':
                  // The model embedded an image URL no tool returned; it would
                  // render as a broken thumbnail. Drop the embed on-screen too.
                  updateLastAssistant(m => ({
                    ...m,
                    content: applyImageRemovals(m.content, event.removeUrls || []),
                  }));
                  break;

                case 'sources':
                  updateLastAssistant(m => ({
                    ...m,
                    sources: (event.sources || []).map((s: Record<string, unknown>) => ({
                      bookId: s.book_id,
                      bookTitle: s.bookTitle,
                      bookAuthor: s.bookAuthor,
                      bookSlug: s.bookSlug,
                      pageNumber: s.pageNumber,
                      snippet: s.snippet,
                      inCollection: s.inCollection !== false,
                    })),
                  }));
                  break;

                case 'notebook_update':
                  updateLastAssistant(m => ({
                    ...m,
                    notebookCount: event.notebook?.findingCount,
                    notebookTopic: event.notebook?.topic || m.notebookTopic,
                  }));
                  if (event.notebook?.topic) setNotebookTopic(event.notebook.topic);
                  if (event.notebook?.finding) {
                    const f = event.notebook.finding;
                    const key = `${f.bookId}:${f.pageNumber}:${(f.quote || '').slice(0, 48)}`;
                    setNotebookFindings(prev =>
                      prev.some(p => p.key === key) ? prev : [...prev, { ...f, key }],
                    );
                  }
                  break;

                case 'error':
                  console.error('[Librarian error]', event.debug || event.message);
                  updateLastAssistant(m => ({
                    ...m,
                    error: true,
                    retryQuestion: trimmed,
                    content: event.message || 'I’m sorry — something went wrong on my end. Try again?',
                  }));
                  break;
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (err) {
      const e = err as Error;
      if (e.name !== 'AbortError') {
        console.error('[Librarian] request failed:', e.name, e.message, e);
        updateLastAssistant(m => {
          // If searching had already started, the stream was cut mid-research;
          // if nothing ever arrived, we never reached the library at all.
          const gotPartway = !!(m.content || m.thinking || m.steps.length > 0);
          const apology = gotPartway
            ? 'I’m sorry — I got distracted (my connection was interrupted mid-search). Try again?'
            : 'I’m sorry — I can’t reach the library right now. Try again in a moment?';
          return {
            ...m,
            error: true,
            retryQuestion: trimmed,
            content: m.content ? `${m.content}\n\n${apology}` : apology,
          };
        });
      }
    }

    abortRef.current = null;
    setSending(false);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
  };

  // Auto-fill from ?q= search param (e.g. from "Ask the Librarian" link)
  const initialQueryHandled = useRef(false);
  useEffect(() => {
    if (initialQueryHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q && !sending && messages.length === 0) {
      initialQueryHandled.current = true;
      pendingChoiceRef.current = q;
      setInput(q);
    }
  }, [sending, messages.length]);

  // Restore the conversation from ?thread=<id> on mount. The chat otherwise
  // lives only in component state, so a reader who follows a source link and
  // presses Back lands on an empty chat and has to re-ask from scratch (the
  // top complaint in real anonymous sessions — same question re-asked in
  // fresh threads minutes apart).
  const threadRestoreAttempted = useRef(false);
  useEffect(() => {
    if (threadRestoreAttempted.current) return;
    threadRestoreAttempted.current = true;
    const restoreId = new URLSearchParams(window.location.search).get('thread');
    if (!restoreId) return;
    fetch(`/api/embassy/threads/${restoreId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data?.messages?.length) return;
        const restored: Message[] = data.messages.map((m: { authorType: string; content: string; sources?: SourceCard[] }) =>
          m.authorType === 'human'
            ? { role: 'user' as const, content: m.content }
            : { role: 'assistant' as const, content: m.content, sources: m.sources || [], steps: [] },
        );
        // Don't clobber a conversation the user already started while the
        // fetch was in flight.
        setMessages(prev => (prev.length > 0 ? prev : restored));
        setThreadId(prev => prev ?? restoreId);
      })
      .catch(() => { });
  }, []);

  const pendingChoiceRef = useRef<string | null>(null);

  const handleChoiceClick = (choice: string) => {
    pendingChoiceRef.current = choice;
    setInput(choice);
  };

  // Resend the question from a failed turn. Drops the failed exchange from
  // the transcript first so the retry doesn't duplicate the question, then
  // reuses the choice-click auto-submit path.
  const handleRetry = (question: string) => {
    if (sending) return;
    setMessages(prev => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant' && (last as AssistantMessage).error) next.pop();
      if (next[next.length - 1]?.role === 'user') next.pop();
      return next;
    });
    pendingChoiceRef.current = question;
    setInput(question);
  };

  // Auto-submit when input is set from a choice click
  useEffect(() => {
    if (pendingChoiceRef.current && input === pendingChoiceRef.current && !sending) {
      pendingChoiceRef.current = null;
      const form = inputRef.current?.closest('form');
      if (form) form.requestSubmit();
    }
  }, [input, sending]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Copy/share actions on completed responses. copiedKey tracks which
  // button just fired so its label can flash a confirmation.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const flashCopied = (key: string) => {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 2000);
  };

  const handleCopyResponse = async (i: number, assistant: AssistantMessage) => {
    let text = assistant.content.trim();
    if (assistant.sources.length > 0) {
      const origin = window.location.origin;
      const lines = assistant.sources.map(s => {
        const path = tenantBookUrl({ slug: s.bookSlug, id: s.bookId }, tenant)
          + (s.pageNumber ? `/page-number/${s.pageNumber}` : '');
        return `- ${s.bookAuthor ? `${s.bookAuthor}, ` : ''}${s.bookTitle}${s.pageNumber ? `, p. ${s.pageNumber}` : ''} — ${origin}${path}`;
      });
      text += `\n\nSources:\n${lines.join('\n')}`;
    }
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(`copy-${i}`);
    } catch { /* clipboard unavailable */ }
  };

  const handleShareThread = async (i: number) => {
    if (!threadId) return;
    const url = `${window.location.origin}/librarian/thread/${threadId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'The Librarian — Source Library', url });
        return;
      } catch { return; /* user cancelled */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      flashCopied(`share-${i}`);
    } catch { /* clipboard unavailable */ }
  };

  const startNewThread = () => {
    setMessages([]);
    setThreadId(null);
    setNotebookFindings([]);
    setNotebookTopic(undefined);
    setNotebookOpen(false);
    // Fresh chips for a fresh conversation.
    const real = threads.map(t => t.preview.question).filter(looksLikeGoodQuestion);
    const extras = real.sort(() => Math.random() - 0.5).slice(0, 2);
    setSuggestions(pickSuggestions(6, extras));
    window.history.replaceState(null, '', window.location.pathname);
    inputRef.current?.focus();
  };

  const isSignedIn = status !== 'loading' && !!session?.user;

  return (
    <div className="min-h-screen bg-[#f5f0e8]">
      <SiteHeader variant="light" />
      {/* Hero */}
      <div className="relative bg-[#0e0c0a] overflow-hidden min-h-[200px] sm:min-h-[240px]">
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.sourcelibrary.org/artwork/reading-room-hero.png"
            alt="A grand monastic library with vaulted ceilings, galleries of books, and warm candlelight"
            className="absolute inset-0 w-full h-full object-cover opacity-80"
            loading="eager"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0e0c0a]/90" />

        <div className="relative max-w-[var(--container-wide)] mx-auto px-6 md:px-12 pt-10 sm:pt-12 pb-10 animate-fade-in-up">
          <h1 className="text-4xl sm:text-5xl md:text-6xl text-white font-display mb-3 drop-shadow-lg" style={{ fontWeight: 500 }}>
            The Librarian
          </h1>
          <p className="text-white/80 text-base sm:text-lg font-body leading-relaxed max-w-[480px] drop-shadow-sm">
            Your research agent for over 10,000 rare books. Ask a question, and the Librarian
            will search the collection, cross-reference sources, and build up findings you can export.
          </p>
        </div>
      </div>

      {/* Main content */}
      <div className="relative">
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://images.sourcelibrary.org/artwork/reading-room-hero.png" alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.06]" />
        </div>
        <div className="relative max-w-[var(--container-wide)] mx-auto px-6 md:px-12 py-8 md:py-12 animate-fade-in-up">
          <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">

            {/* Chat area */}
            <div className="flex-1 min-w-0">
              <div ref={chatCardRef} className="border border-[#e8e4dc] rounded-lg bg-white overflow-hidden shadow-sm scroll-mt-4">
                {/* Messages */}
                <div ref={chatContainerRef} className="min-h-[200px] max-h-[70vh] overflow-y-auto p-6 space-y-6">
                  {messages.length === 0 && (
                    <div className="text-center py-8">
                      <img src="/brand/png/icon-only--black-on-transparent--96h.png" alt="" className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p className="text-[#8a8480] text-sm font-body max-w-[400px] mx-auto leading-relaxed">
                        The Librarian searches the collection, Wikipedia, and semantic search
                        to find answers in over 10,000 rare books.
                      </p>
                      <p className="text-[#8a8480]/50 text-xs font-body mt-1.5">
                        Responses may contain errors &mdash; always verify against the source page.
                      </p>
                      <div className="flex flex-wrap justify-center gap-2 mt-5">
                        {suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            // Stable hook for e2e: the chip SET is redrawn twice
                            // after first paint (see pickSuggestions), so tests
                            // cannot locate a chip by its wording (#3358).
                            data-testid="suggestion-chip"
                            onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                            className="px-3 py-1.5 text-xs text-[#6b6560] border border-[#e8e4dc] rounded-full hover:bg-[#f5f0e8] hover:text-[#444] transition-colors font-sans"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {messages.map((msg, i) => {
                    if (msg.role === 'user') {
                      return (
                        <div key={i} className="flex gap-3 justify-end">
                          <div className="max-w-[85%] bg-[#1a1612] text-white rounded-2xl rounded-br-sm px-4 py-3">
                            <p className="text-[15px] font-body leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        </div>
                      );
                    }

                    const assistant = msg as AssistantMessage;
                    return (
                      <div key={i} className="flex gap-3">
                        <img
                          src="/brand/png/icon-only--black-on-transparent--96h.png"
                          alt="Librarian"
                          className="flex-shrink-0 w-10 h-10 rounded-full"
                        />
                        <div className="max-w-[85%] min-w-0">
                          {/* Thinking (collapsible) */}
                          {assistant.thinking && (
                            <div className="mb-2">
                              <button
                                onClick={() => setShowThinking(!showThinking)}
                                aria-expanded={showThinking}
                                className="text-[11px] text-[#b0a89c] hover:text-[#8a8480] font-sans transition-colors"
                              >
                                {showThinking ? 'Hide reasoning' : 'Show reasoning'}
                              </button>
                              {showThinking && (
                                <div className="mt-1 text-[13px] text-[#8a8480] font-body italic leading-relaxed bg-[#faf8f4] rounded px-3 py-2 border-l-2 border-[#e8e4dc]">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{assistant.thinking}</ReactMarkdown>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Search steps */}
                          <SearchSteps steps={assistant.steps} />

                          {/* Response text */}
                          {assistant.content && (
                            <LibrarianMessageBody content={assistant.content} variant="chat-bubble" />
                          )}

                          {/* One-click retry after a failed turn */}
                          {assistant.error && assistant.retryQuestion && !sending && (
                            <button
                              onClick={() => handleRetry(assistant.retryQuestion!)}
                              className="mt-2 px-3.5 py-1.5 text-[12px] font-sans text-[#9e4a3a] border border-[#e0d9cc] rounded-full hover:border-[#c9a86c] hover:bg-[#fdfcf9] transition-colors"
                            >
                              Try again
                            </button>
                          )}

                          {/* Research direction choices */}
                          {assistant.choices && (
                            <div className="mt-4 space-y-3">
                              {assistant.choices.options.map((opt, idx) => {
                                const desc = assistant.choices?.descriptions?.[idx];
                                return (
                                  <button
                                    key={opt}
                                    onClick={() => handleChoiceClick(opt)}
                                    className="w-full text-left group"
                                  >
                                    <div className="px-4 py-3.5 rounded-xl border border-[#e0d9cc] bg-white hover:border-[#c9a86c] hover:bg-[#fdfcf9] transition-all">
                                      {desc ? (
                                        <>
                                          <p className="text-[14px] font-body text-[#444] leading-relaxed mb-2.5">{desc}</p>
                                          <span className="inline-flex items-center gap-1.5 text-[13px] font-sans font-medium text-[#9e4a3a] group-hover:underline">
                                            {opt} <span className="text-[11px]">&rarr;</span>
                                          </span>
                                        </>
                                      ) : (
                                        <div className="flex items-center gap-3">
                                          <span className="flex-1 text-[14px] font-body text-[#1a1612] leading-snug">{opt}</span>
                                          <span className="flex-shrink-0 text-[12px] font-sans text-[#9e4a3a] opacity-0 group-hover:opacity-100 transition-opacity">
                                            Explore &rarr;
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* Source cards */}
                          <SourceCardRow sources={assistant.sources} tenant={tenant} />

                          {/* Copy / share actions (once the response has finished streaming) */}
                          {assistant.content && !assistant.error && !(sending && i === messages.length - 1) && (
                            <div className="mt-2 flex items-center gap-3">
                              <button
                                onClick={() => handleCopyResponse(i, assistant)}
                                className="text-[11px] text-[#8a8480] hover:text-[#6b6560] transition-colors font-sans"
                              >
                                {copiedKey === `copy-${i}` ? 'Copied ✓' : 'Copy response'}
                              </button>
                              {threadId && visibility === 'public' && (
                                <button
                                  onClick={() => handleShareThread(i)}
                                  className="text-[11px] text-[#8a8480] hover:text-[#6b6560] transition-colors font-sans"
                                >
                                  {copiedKey === `share-${i}` ? 'Link copied ✓' : 'Share'}
                                </button>
                              )}
                            </div>
                          )}

                          {/* Notebook indicator */}
                          {assistant.notebookCount && assistant.notebookCount > 0 && (
                            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#6b8f5e] font-sans">
                              <span>&#x1F4D3;</span>
                              <span>{assistant.notebookCount} finding{assistant.notebookCount > 1 ? 's' : ''} saved to research notebook</span>
                              {assistant.notebookTopic && <span className="text-[#8a8480]">&#x2014; {assistant.notebookTopic}</span>}
                            </div>
                          )}

                          {/* Loading state: no content yet and still sending */}
                          {!assistant.content && !assistant.thinking && assistant.steps.length === 0 && sending && i === messages.length - 1 && (
                            <div className="bg-[#f5f0e8] rounded-2xl rounded-bl-sm px-4 py-3">
                              <p className="text-[13px] text-[#8a8480] font-body italic animate-pulse">Thinking...</p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <div />
                </div>

                {/* Research notebook (collapsible) */}
                {notebookOpen && notebookFindings.length > 0 && (
                  <NotebookPanel
                    findings={notebookFindings}
                    topic={notebookTopic}
                    threadId={threadId}
                    onClose={() => setNotebookOpen(false)}
                  />
                )}

                {/* Input area */}
                <div className="border-t border-[#e8e4dc] p-4">
                  <form onSubmit={handleSubmit} className="flex gap-3 items-end">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask the Librarian..."
                      rows={1}
                      className="flex-1 resize-none border border-[#e8e4dc] rounded-lg px-4 py-2.5 text-[15px] font-body text-[#1a1612] placeholder-[#8a8480] focus:outline-none focus:border-[#c9a86c] transition-colors bg-transparent disabled:opacity-50"
                    />
                    {speechSupported && (
                      <button
                        type="button"
                        onClick={toggleDictation}
                        aria-label={listening ? 'Stop voice input' : 'Start voice input'}
                        aria-pressed={listening}
                        title={listening ? 'Stop voice input' : 'Speak your question'}
                        className={`flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-lg border transition-colors ${listening
                          ? 'border-[#9e4a3a] bg-[#9e4a3a] text-white animate-pulse'
                          : 'border-[#e8e4dc] text-[#8a8480] hover:text-[#1a1612] hover:border-[#c9a86c]'
                          }`}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <rect x="9" y="2" width="6" height="12" rx="3" />
                          <path d="M5 10a7 7 0 0 0 14 0" />
                          <line x1="12" y1="19" x2="12" y2="22" />
                        </svg>
                      </button>
                    )}
                    {sending ? (
                      <button
                        type="button"
                        onClick={handleStop}
                        className="flex-shrink-0 px-5 py-2.5 bg-[#9e4a3a] text-white rounded-lg text-sm font-sans hover:bg-[#8b3d30] transition-colors"
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!input.trim()}
                        className="flex-shrink-0 px-5 py-2.5 bg-[#1a1612] text-white rounded-lg text-sm font-sans hover:bg-[#2a2622] disabled:opacity-30 transition-colors"
                      >
                        Send
                      </button>
                    )}
                  </form>

                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-3">
                      {messages.length > 0 && (
                        <button onClick={startNewThread} className="text-[11px] text-[#8a8480] hover:text-[#6b6560] transition-colors font-sans">
                          New conversation
                        </button>
                      )}
                      {notebookFindings.length > 0 && (
                        <button
                          onClick={() => setNotebookOpen(o => !o)}
                          aria-expanded={notebookOpen}
                          className="text-[11px] text-[#6b8f5e] hover:text-[#4a6b40] transition-colors font-sans flex items-center gap-1"
                        >
                          <span aria-hidden>&#x1F4D3;</span>
                          <span>{notebookOpen ? 'Hide' : 'Research'} notebook ({notebookFindings.length})</span>
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setListed(visibility !== 'public')}
                        className="text-[11px] text-[#8a8480] hover:text-[#6b6560] transition-colors font-sans flex items-center gap-1"
                      >
                        <span>{visibility === 'public' ? 'Listed' : 'Not listed'}</span>
                        <span className="text-[9px]">
                          {visibility === 'public'
                            ? '(shown in Recent, never under your name)'
                            : isSignedIn ? '(only you)' : '(not shown to anyone else)'}
                        </span>
                      </button>
                      <span className="text-[9px] text-[#c0b8b0] font-mono">v5</span>
                    </div>
                  </div>

                  {!isSignedIn && status !== 'loading' && (
                    <p className="mt-2 text-[12px] text-[#8a8480] font-sans">
                      <Link href="/auth/signin?callbackUrl=/librarian" className="text-[#9e4a3a] hover:underline">
                        Sign in
                      </Link>
                      {' '}(free) to keep your conversations and come back to them later.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="lg:w-[300px] flex-shrink-0">
              <div className="lg:sticky lg:top-8">
                {/* Tab toggle */}
                <div className="flex gap-4 mb-4">
                  <button
                    onClick={() => { setSidebarTab('recent'); setVisibleThreads(5); }}
                    className={`text-[11px] tracking-[0.2em] uppercase font-sans transition-colors ${sidebarTab === 'recent' ? 'text-[#1a1612]' : 'text-[#b0a89c] hover:text-[#8a8480]'
                      }`}
                  >
                    Recent
                  </button>
                  {isSignedIn && (
                    <button
                      onClick={() => { setSidebarTab('mine'); setVisibleThreads(5); }}
                      className={`text-[11px] tracking-[0.2em] uppercase font-sans transition-colors ${sidebarTab === 'mine' ? 'text-[#1a1612]' : 'text-[#b0a89c] hover:text-[#8a8480]'
                        }`}
                    >
                      My Conversations
                    </button>
                  )}
                </div>

                {sidebarTab === 'recent' && (
                  <p className="text-[10px] text-[#b0a89c] font-sans mb-3 leading-relaxed">
                    What other readers are asking, shown without their names.
                  </p>
                )}

                {(() => {
                  const isMine = sidebarTab === 'mine';
                  const allThreads = isMine ? myThreads : threads;
                  const listState = isMine ? myThreadsState : threadsState;
                  // Session still resolving means "we don't know yet", not "none".
                  const loading = listState === 'loading' || (isMine && status === 'loading');

                  if (loading) {
                    return (
                      <div className="space-y-3" aria-busy="true">
                        {[0, 1, 2].map(i => (
                          <div key={i} className="py-3 border-b border-[#e8e4dc] animate-pulse">
                            <div className="h-3 bg-[#e8e4dc] rounded w-5/6 mb-2" />
                            <div className="h-3 bg-[#eee9e1] rounded w-full mb-1.5" />
                            <div className="h-3 bg-[#eee9e1] rounded w-2/3" />
                          </div>
                        ))}
                        <span className="sr-only">Loading conversations…</span>
                      </div>
                    );
                  }

                  if (listState === 'error') {
                    return (
                      <p className="text-[#8a8480] text-sm font-body">
                        Couldn&rsquo;t load {isMine ? 'your conversations' : 'recent conversations'}.{' '}
                        <button
                          onClick={() => { if (isMine) setReloadMine(n => n + 1); else window.location.reload(); }}
                          className="text-[#9e4a3a] hover:underline"
                        >
                          Try again
                        </button>
                        .
                      </p>
                    );
                  }

                  if (allThreads.length === 0) {
                    return (
                      <p className="text-[#8a8480] text-sm font-body">
                        {isMine
                          ? 'No conversations yet. Ask the Librarian something!'
                          : 'No conversations yet. Be the first to ask the Librarian something.'}
                      </p>
                    );
                  }
                  const displayThreads = allThreads.slice(0, visibleThreads);
                  const hasMore = allThreads.length > visibleThreads;
                  return (
                    <div className="space-y-0">
                      {displayThreads.map((thread) => (
                        <Link
                          key={thread.id}
                          href={`/librarian/thread/${thread.id}`}
                          className="block py-3 border-b border-[#e8e4dc] hover:bg-[#f5f0e8]/50 transition-colors -mx-2 px-2 rounded"
                        >
                          <p className="text-sm font-body text-[#1a1612] line-clamp-2 leading-snug mb-1">
                            {thread.preview.question}
                          </p>
                          <p className="text-[12px] text-[#8a8480] font-body line-clamp-2 leading-relaxed mb-1">
                            {thread.preview.answer}
                          </p>
                          <p className="text-[10px] text-[#8a8480] font-sans">
                            {thread.creatorName} &middot; {timeAgo(thread.lastMessageAt)}
                            {thread.messageCount > 2 && <span> &middot; {thread.messageCount} messages</span>}
                          </p>
                        </Link>
                      ))}
                      {hasMore && (
                        <button
                          onClick={() => setVisibleThreads(v => v + 10)}
                          className="block w-full py-2 mt-1 text-[11px] text-[#8a8480] hover:text-[#6b6560] transition-colors font-sans text-center"
                        >
                          Show more ({allThreads.length - visibleThreads} remaining)
                        </button>
                      )}
                    </div>
                  );
                })()}

                {featuredPassage && (
                  <div className="mt-8 pt-6 border-t border-[#e8e4dc]">
                    <p className="text-[11px] text-[#b0a89c] tracking-[0.15em] uppercase font-sans mb-2">
                      The Librarian is reading
                    </p>
                    <Link href={featuredPassage.pageId ? `/book/${featuredPassage.bookSlug}/page/${featuredPassage.pageId}` : `/book/${featuredPassage.bookSlug}`} className="block group">
                      <blockquote className="text-[#6b6560] text-[14px] font-body leading-relaxed italic border-l-2 border-[#c9a86c]/50 pl-3">
                        &ldquo;{featuredPassage.text}&rdquo;
                      </blockquote>
                      <p className="text-[#8a8480] text-xs font-body mt-2 group-hover:text-[#6b6560] transition-colors">
                        {featuredPassage.bookAuthor && <span>{featuredPassage.bookAuthor}, </span>}
                        <span className="italic">{featuredPassage.bookTitle}</span>
                        {featuredPassage.bookYear && <span> ({featuredPassage.bookYear})</span>}
                      </p>
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
