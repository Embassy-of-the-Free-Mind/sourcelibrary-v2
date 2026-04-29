'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { tenantBookUrl } from '@/lib/slugify';

interface Topic {
  id: string;
  label: string;
  description: string;
}

interface QuestionBase {
  mode: 'vocab' | 'date' | 'author' | 'tradition';
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  bookDate?: string | number;
  bookLanguage?: string;
  pageNumber: number;
  slug?: string;
  options: string[];
  correctIndex: number;
}

interface VocabQuestion extends QuestionBase {
  mode: 'vocab';
  term: string;
  definition: string;
  originalContext?: string;
}

interface PassageQuestion extends QuestionBase {
  mode: 'date' | 'author' | 'tradition';
  passage: string;
  collection?: string;
}

type Question = VocabQuestion | PassageQuestion;

type QuizMode = 'mixed' | 'vocab' | 'date' | 'author' | 'tradition';
type QuizState = 'topics' | 'loading' | 'question' | 'answered' | 'complete';

const QUIZ_MODES: { id: QuizMode; label: string; description: string }[] = [
  { id: 'mixed', label: 'Mixed', description: 'A bit of everything — vocabulary, dates, authors, and traditions' },
  { id: 'vocab', label: 'Vocabulary', description: 'Technical terms from alchemical, Hermetic, and philosophical texts' },
  { id: 'date', label: 'Dating', description: 'When was this written? Place passages in their historical decade' },
  { id: 'author', label: 'Attribution', description: 'Who wrote this? Match passages to their authors' },
  { id: 'tradition', label: 'Tradition', description: 'Which tradition does this belong to? Identify the school of thought' },
];

const FALLBACK_TOPICS: Topic[] = [
  { id: 'alchemy', label: 'Alchemy', description: 'The art of transformation — prima materia, the philosopher\'s stone, and the Great Work' },
  { id: 'hermetica', label: 'Hermetica', description: 'The teachings of Hermes Trismegistus and the Hermetic tradition' },
  { id: 'kabbalah', label: 'Kabbalah', description: 'Jewish mystical tradition — the sefirot, the Tree of Life, and divine emanation' },
  { id: 'astrology', label: 'Astrology & Astronomy', description: 'Celestial influences, planetary spheres, and the music of the heavens' },
  { id: 'magic', label: 'Magic & Divination', description: 'Natural magic, ceremonial practice, and the hidden forces of nature' },
  { id: 'medicine', label: 'Medicine & Natural Philosophy', description: 'Humors, signatures, Paracelsian medicine, and the book of nature' },
  { id: 'philosophy', label: 'Philosophy', description: 'Neoplatonism, Aristotelian thought, Renaissance humanism' },
  { id: 'rosicrucianism', label: 'Rosicrucianism', description: 'The Rosicrucian manifestos and the invisible brotherhood' },
];

const MODE_PROMPTS: Record<string, string> = {
  vocab: 'What does this term mean?',
  date: 'When was this written?',
  author: 'Who wrote this?',
  tradition: 'What tradition is this from?',
};

export default function LearnQuiz() {
  const params = useParams<{ tenant: string }>();
  const tenant = params?.tenant;
  const [topics, setTopics] = useState<Topic[]>(FALLBACK_TOPICS);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<QuizMode>('mixed');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [state, setState] = useState<QuizState>('topics');
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('sl-learn-stats');
    if (saved) {
      try {
        const stats = JSON.parse(saved);
        setTotalAnswered(stats.totalAnswered || 0);
        setBestStreak(stats.bestStreak || 0);
      } catch { /* ignore */ }
    }
    fetch('/api/learn?topics=true')
      .then(r => r.json())
      .then(data => { if (data.topics?.length) setTopics(data.topics); })
      .catch(() => { /* use fallback */ });
  }, []);

  const fetchQuestions = useCallback(async (topic?: string, mode: QuizMode = 'mixed') => {
    setState('loading');
    setError(null);
    try {
      const params = new URLSearchParams({ count: '10', mode });
      if (topic) params.set('topic', topic);
      const res = await fetch(`/api/learn?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      if (!data.questions?.length) {
        setError('No questions found for this combination. Try another topic or mode.');
        return;
      }
      setQuestions(data.questions);
      setCurrentIdx(0);
      setSelected(null);
      setState('question');
    } catch {
      setError('Could not load questions. Please try again.');
    }
  }, []);

  const handleStart = (topicId: string | null, mode: QuizMode) => {
    setActiveTopic(topicId);
    setActiveMode(mode);
    setScore(0);
    setStreak(0);
    fetchQuestions(topicId || undefined, mode);
  };

  const handleSelect = (idx: number) => {
    if (state !== 'question') return;
    setSelected(idx);
    setState('answered');
    const correct = idx === questions[currentIdx].correctIndex;
    const newTotal = totalAnswered + 1;
    setTotalAnswered(newTotal);
    if (correct) {
      setScore(s => s + 1);
      const newStreak = streak + 1;
      setStreak(newStreak);
      const newBest = Math.max(newStreak, bestStreak);
      setBestStreak(newBest);
      localStorage.setItem('sl-learn-stats', JSON.stringify({ totalAnswered: newTotal, bestStreak: newBest }));
    } else {
      setStreak(0);
      localStorage.setItem('sl-learn-stats', JSON.stringify({ totalAnswered: newTotal, bestStreak }));
    }
  };

  const handleNext = () => {
    if (currentIdx + 1 >= questions.length) {
      setState('complete');
    } else {
      setCurrentIdx(i => i + 1);
      setSelected(null);
      setState('question');
    }
  };

  const handleNewRound = () => {
    setScore(0);
    setStreak(0);
    fetchQuestions(activeTopic || undefined, activeMode);
  };

  const handleBackToTopics = () => {
    setState('topics');
    setActiveTopic(null);
    setQuestions([]);
    setScore(0);
    setStreak(0);
    setError(null);
  };

  // ── Topic + mode selection screen ──
  if (state === 'topics') {
    return (
      <div className="max-w-2xl mx-auto py-8 md:py-12">
        <p className="text-secondary font-body text-lg mb-8 leading-relaxed">
          Test your knowledge of historical texts from the Western esoteric tradition.
          Choose a quiz type, then pick a topic or dive into everything.
        </p>

        {totalAnswered > 0 && (
          <div className="flex items-center gap-6 text-sm text-muted mb-8">
            <span>{totalAnswered} questions answered</span>
            <span>Best streak: {bestStreak}</span>
          </div>
        )}

        {/* Quiz mode selector */}
        <h2 className="font-serif text-2xl text-primary mb-4">Quiz Type</h2>
        <div className="grid gap-2 mb-10">
          {QUIZ_MODES.map(m => (
            <button
              key={m.id}
              onClick={() => setActiveMode(m.id)}
              className={`text-left p-4 rounded-lg border transition-colors ${
                activeMode === m.id
                  ? 'border-accent-rust bg-accent-rust/[0.04]'
                  : 'border-border-light bg-white hover:border-accent-rust/40'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${activeMode === m.id ? 'bg-accent-rust' : 'bg-stone-300'}`} />
                <h3 className="font-medium text-primary">{m.label}</h3>
              </div>
              <p className="text-sm text-muted ml-5">{m.description}</p>
            </button>
          ))}
        </div>

        {/* Topic selector */}
        <h2 className="font-serif text-2xl text-primary mb-4">Topic</h2>
        <div className="grid gap-2">
          <button
            onClick={() => handleStart(null, activeMode)}
            className="text-left p-4 rounded-lg border border-border-light bg-white hover:border-accent-rust/40 hover:bg-accent-rust/[0.02] transition-colors"
          >
            <h3 className="font-serif text-lg text-primary">All Topics</h3>
            <p className="text-sm text-muted">A mix from across the entire collection</p>
          </button>
          {topics.map(topic => (
            <button
              key={topic.id}
              onClick={() => handleStart(topic.id, activeMode)}
              className="text-left p-4 rounded-lg border border-border-light bg-white hover:border-accent-rust/40 hover:bg-accent-rust/[0.02] transition-colors"
            >
              <h3 className="font-serif text-lg text-primary">{topic.label}</h3>
              <p className="text-sm text-muted">{topic.description}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <p className="text-secondary mb-6">{error}</p>
        <div className="flex items-center justify-center gap-4">
          <button onClick={handleBackToTopics} className="text-muted hover:text-primary transition-colors">
            Back
          </button>
          <button onClick={() => fetchQuestions(activeTopic || undefined, activeMode)} className="text-accent-rust hover:underline">
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ── Loading state ──
  if (state === 'loading') {
    return (
      <div className="max-w-xl mx-auto py-16">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-stone-200 rounded w-2/3" />
          <div className="h-4 bg-stone-200 rounded w-full" />
          <div className="space-y-3 mt-8">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-14 bg-stone-200 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Round complete ──
  if (state === 'complete') {
    const topicLabel = activeTopic ? topics.find(t => t.id === activeTopic)?.label : 'All Topics';
    const modeLabel = QUIZ_MODES.find(m => m.id === activeMode)?.label || 'Mixed';
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <p className="text-sm text-muted uppercase tracking-wide mb-2">{modeLabel} · {topicLabel}</p>
        <h2 className="font-serif text-3xl text-primary mb-4">Round Complete</h2>
        <div className="text-6xl font-serif text-accent-rust mb-2">{score}/{questions.length}</div>
        <p className="text-secondary mb-8">
          {score === questions.length
            ? 'Perfect score.'
            : score >= questions.length * 0.7
              ? 'Well done.'
              : 'Keep studying.'}
        </p>
        <div className="flex items-center justify-center gap-6 text-sm text-muted mb-10">
          <span>Total answered: {totalAnswered}</span>
          <span>Best streak: {bestStreak}</span>
        </div>
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={handleBackToTopics}
            className="px-6 py-3 rounded-lg border border-border-light text-primary hover:bg-stone-50 transition-colors"
          >
            Change topic
          </button>
          <button
            onClick={handleNewRound}
            className="bg-[#1a1612] text-white px-8 py-3 rounded-lg font-medium hover:bg-[#2a1f17] transition-colors"
          >
            Play again
          </button>
        </div>
      </div>
    );
  }

  // ── Quiz question ──
  const q = questions[currentIdx];
  if (!q) return null;

  const bookHref = tenantBookUrl({ slug: q.slug, id: q.bookId }, tenant);
  const isCorrect = selected === q.correctIndex;
  const topicLabel = activeTopic ? topics.find(t => t.id === activeTopic)?.label : 'All Topics';
  const isVocab = q.mode === 'vocab';

  return (
    <div className="max-w-2xl mx-auto py-8 md:py-12">
      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={handleBackToTopics}
          className="text-xs text-muted hover:text-primary transition-colors"
          title="Back to topics"
        >
          {topicLabel}
        </button>
        <div className="flex-1 h-1.5 bg-stone-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-rust transition-all duration-300 rounded-full"
            style={{ width: `${((currentIdx + (state === 'answered' ? 1 : 0)) / questions.length) * 100}%` }}
          />
        </div>
        <span className="text-sm text-muted tabular-nums">
          {currentIdx + 1}/{questions.length}
        </span>
        {streak > 1 && (
          <span className="text-sm text-accent-rust font-medium">{streak} streak</span>
        )}
      </div>

      {/* Prompt */}
      <p className="text-sm text-muted uppercase tracking-wide mb-2">
        {MODE_PROMPTS[q.mode]}
      </p>

      {/* Vocab: show term prominently */}
      {isVocab && (
        <h2 className="font-serif text-3xl md:text-4xl text-primary italic mb-8">
          {(q as VocabQuestion).term}
        </h2>
      )}

      {/* Passage (for non-vocab, or as context for vocab) */}
      {isVocab ? (
        (q as VocabQuestion).originalContext ? (
          <div className="bg-white border border-border-light rounded-lg p-4 mb-8">
            <div className="text-sm text-secondary font-body leading-relaxed">
              &ldquo;...{(q as VocabQuestion).originalContext}...&rdquo;
            </div>
            <div className="mt-2 pt-2 border-t border-border-light flex items-center justify-between">
              <span className="text-xs text-muted truncate mr-2">
                {q.bookAuthor}, <em>{q.bookTitle}</em>{q.bookDate ? ` (${q.bookDate})` : ''}, p.{q.pageNumber}
              </span>
              <Link href={`${bookHref}?page=${q.pageNumber}`} className="text-xs text-accent-rust hover:underline whitespace-nowrap">
                Read
              </Link>
            </div>
          </div>
        ) : null
      ) : (
        <div className="bg-white border border-border-light rounded-lg p-5 mb-8">
          <div className="text-[15px] text-secondary font-body leading-relaxed">
            &ldquo;{(q as PassageQuestion).passage}&rdquo;
          </div>
          <div className="mt-3 pt-3 border-t border-border-light flex items-center justify-between">
            <span className="text-xs text-muted truncate mr-2">
              {/* For author mode, don't show the author — that's the answer */}
              {q.mode === 'author' ? (
                <><em>{q.bookTitle}</em>, p.{q.pageNumber}</>
              ) : q.mode === 'date' ? (
                // For date mode, don't show the date
                <>{q.bookAuthor}, <em>{q.bookTitle}</em>, p.{q.pageNumber}</>
              ) : (
                // For tradition mode, show author + title but not collection
                <>{q.bookAuthor}, <em>{q.bookTitle}</em>{q.bookDate ? ` (${q.bookDate})` : ''}, p.{q.pageNumber}</>
              )}
            </span>
            <Link href={`${bookHref}?page=${q.pageNumber}`} className="text-xs text-accent-rust hover:underline whitespace-nowrap">
              Read
            </Link>
          </div>
        </div>
      )}

      {/* Options */}
      <div className="space-y-3 mb-8">
        {q.options.map((option, idx) => {
          let style = 'bg-white border-border-light hover:border-accent-rust/40 hover:bg-accent-rust/[0.02] cursor-pointer';
          if (state === 'answered') {
            if (idx === q.correctIndex) {
              style = 'bg-emerald-50 border-emerald-300 text-emerald-900';
            } else if (idx === selected && !isCorrect) {
              style = 'bg-red-50 border-red-300 text-red-900';
            } else {
              style = 'bg-stone-50 border-stone-200 text-muted';
            }
          }
          return (
            <button
              key={idx}
              onClick={() => handleSelect(idx)}
              disabled={state === 'answered'}
              className={`w-full text-left p-4 rounded-lg border transition-colors ${style}`}
            >
              <span className="font-body text-[15px] leading-relaxed">{option}</span>
            </button>
          );
        })}
      </div>

      {/* Post-answer: reveal + next */}
      {state === 'answered' && (
        <div className="space-y-4">
          {/* For non-vocab modes, reveal the full source after answering */}
          {!isVocab && (
            <div className="flex items-start gap-3 bg-warm rounded-lg p-4 border border-border-light">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-primary truncate">{q.bookTitle}</p>
                <p className="text-xs text-muted">
                  {q.bookAuthor}{q.bookDate ? `, ${q.bookDate}` : ''}
                  {q.bookLanguage ? ` · ${q.bookLanguage}` : ''}
                </p>
              </div>
              <Link
                href={`${bookHref}?page=${q.pageNumber}`}
                className="text-sm text-accent-rust hover:underline whitespace-nowrap"
              >
                Read in context
              </Link>
            </div>
          )}

          <button
            onClick={handleNext}
            className="w-full bg-[#1a1612] text-white py-3 rounded-lg font-medium hover:bg-[#2a1f17] transition-colors"
          >
            {currentIdx + 1 >= questions.length ? 'See results' : 'Next'}
          </button>
        </div>
      )}
    </div>
  );
}
