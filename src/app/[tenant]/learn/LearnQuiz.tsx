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

interface TermQuestion {
  term: string;
  definition: string;
  originalContext?: string;
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  bookDate?: string;
  bookLanguage?: string;
  pageNumber: number;
  slug?: string;
  options: string[];
  correctIndex: number;
}

type QuizState = 'topics' | 'loading' | 'question' | 'answered' | 'complete';

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

export default function LearnQuiz() {
  const params = useParams<{ tenant: string }>();
  const tenant = params?.tenant;
  const [topics, setTopics] = useState<Topic[]>(FALLBACK_TOPICS);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [questions, setQuestions] = useState<TermQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [state, setState] = useState<QuizState>('topics');
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Load persisted stats on mount
  useEffect(() => {
    const saved = localStorage.getItem('sl-learn-stats');
    if (saved) {
      try {
        const stats = JSON.parse(saved);
        setTotalAnswered(stats.totalAnswered || 0);
        setBestStreak(stats.bestStreak || 0);
      } catch { /* ignore */ }
    }
    // Fetch topics from API (fallback already set)
    fetch('/api/learn?topics=true')
      .then(r => r.json())
      .then(data => { if (data.topics?.length) setTopics(data.topics); })
      .catch(() => { /* use fallback */ });
  }, []);

  const fetchQuestions = useCallback(async (topic?: string) => {
    setState('loading');
    setError(null);
    try {
      const params = new URLSearchParams({ count: '10' });
      if (topic) params.set('topic', topic);
      const res = await fetch(`/api/learn?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      if (!data.terms?.length) {
        setError('No vocabulary terms found for this topic yet. Try another.');
        return;
      }
      setQuestions(data.terms);
      setCurrentIdx(0);
      setSelected(null);
      setState('question');
    } catch {
      setError('Could not load questions. Please try again.');
    }
  }, []);

  const handleTopicSelect = (topicId: string | null) => {
    setActiveTopic(topicId);
    setScore(0);
    setStreak(0);
    fetchQuestions(topicId || undefined);
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
      if (newStreak > bestStreak) setBestStreak(newStreak);
      localStorage.setItem('sl-learn-stats', JSON.stringify({
        totalAnswered: newTotal,
        bestStreak: Math.max(newStreak, bestStreak),
      }));
    } else {
      setStreak(0);
      localStorage.setItem('sl-learn-stats', JSON.stringify({
        totalAnswered: newTotal,
        bestStreak,
      }));
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
    fetchQuestions(activeTopic || undefined);
  };

  const handleBackToTopics = () => {
    setState('topics');
    setActiveTopic(null);
    setQuestions([]);
    setScore(0);
    setStreak(0);
    setError(null);
  };

  // ── Topic selection screen ──
  if (state === 'topics') {
    return (
      <div className="max-w-2xl mx-auto py-8 md:py-12">
        <p className="text-secondary font-body text-lg mb-8 leading-relaxed">
          Test your knowledge of historical terminology drawn from primary sources
          in the Western esoteric tradition. Choose a topic or dive into everything.
        </p>

        {totalAnswered > 0 && (
          <div className="flex items-center gap-6 text-sm text-muted mb-8">
            <span>{totalAnswered} terms studied</span>
            <span>Best streak: {bestStreak}</span>
          </div>
        )}

        <div className="grid gap-3">
          {/* "All topics" option */}
          <button
            onClick={() => handleTopicSelect(null)}
            className="text-left p-5 rounded-lg border border-border-light bg-white hover:border-accent-rust/40 hover:bg-accent-rust/[0.02] transition-colors"
          >
            <h3 className="font-serif text-xl text-primary mb-1">All Topics</h3>
            <p className="text-sm text-muted">A mix of vocabulary from across the entire collection</p>
          </button>

          {topics.map(topic => (
            <button
              key={topic.id}
              onClick={() => handleTopicSelect(topic.id)}
              className="text-left p-5 rounded-lg border border-border-light bg-white hover:border-accent-rust/40 hover:bg-accent-rust/[0.02] transition-colors"
            >
              <h3 className="font-serif text-xl text-primary mb-1">{topic.label}</h3>
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
            Back to topics
          </button>
          <button onClick={() => fetchQuestions(activeTopic || undefined)} className="text-accent-rust hover:underline">
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
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <p className="text-sm text-muted uppercase tracking-wide mb-2">{topicLabel}</p>
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

      {/* Term */}
      <div className="mb-8">
        <p className="text-sm text-muted uppercase tracking-wide mb-2">
          What does this term mean?
        </p>
        <h2 className="font-serif text-3xl md:text-4xl text-primary italic">
          {q.term}
        </h2>
      </div>

      {/* Context with source attribution */}
      {q.originalContext && (
        <div className="bg-white border border-border-light rounded-lg p-4 mb-8">
          <div className="text-sm text-secondary font-body leading-relaxed">
            &ldquo;...{q.originalContext}...&rdquo;
          </div>
          <div className="mt-2 pt-2 border-t border-border-light flex items-center justify-between">
            <span className="text-xs text-muted truncate mr-2">
              {q.bookAuthor}, <em>{q.bookTitle}</em>{q.bookDate ? ` (${q.bookDate})` : ''}, p.{q.pageNumber}
            </span>
            <Link
              href={`${bookHref}?page=${q.pageNumber}`}
              className="text-xs text-accent-rust hover:underline whitespace-nowrap"
            >
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

      {/* Post-answer: next button */}
      {state === 'answered' && (
        <button
          onClick={handleNext}
          className="w-full bg-[#1a1612] text-white py-3 rounded-lg font-medium hover:bg-[#2a1f17] transition-colors"
        >
          {currentIdx + 1 >= questions.length ? 'See results' : 'Next'}
        </button>
      )}
    </div>
  );
}
