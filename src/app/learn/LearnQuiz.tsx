'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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

type QuizState = 'loading' | 'question' | 'answered' | 'complete';

export default function LearnQuiz() {
  const [questions, setQuestions] = useState<TermQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [state, setState] = useState<QuizState>('loading');
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fetchQuestions = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const res = await fetch('/api/learn?count=10');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      if (!data.terms?.length) {
        setError('No vocabulary terms found. Check back soon.');
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

  useEffect(() => {
    fetchQuestions();
    // Load persisted stats
    const saved = localStorage.getItem('sl-learn-stats');
    if (saved) {
      try {
        const stats = JSON.parse(saved);
        setTotalAnswered(stats.totalAnswered || 0);
        setBestStreak(stats.bestStreak || 0);
      } catch { /* ignore */ }
    }
  }, [fetchQuestions]);

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
    fetchQuestions();
  };

  const q = questions[currentIdx];

  if (error) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <p className="text-secondary mb-6">{error}</p>
        <button onClick={fetchQuestions} className="text-accent-rust hover:underline">
          Try again
        </button>
      </div>
    );
  }

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

  if (state === 'complete') {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
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
        <button
          onClick={handleNewRound}
          className="bg-[#1a1612] text-white px-8 py-3 rounded-lg font-medium hover:bg-[#2a1f17] transition-colors"
        >
          New round
        </button>
      </div>
    );
  }

  if (!q) return null;

  const isCorrect = selected === q.correctIndex;
  const bookHref = q.slug ? `/book/${q.slug}` : `/book/${q.bookId}`;

  return (
    <div className="max-w-2xl mx-auto py-8 md:py-12">
      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-8">
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

      {/* Context (shown before answering as a hint) */}
      {q.originalContext && (
        <div className="bg-white border border-border-light rounded-lg p-4 mb-8 text-sm text-secondary font-body leading-relaxed">
          <span className="text-muted text-xs uppercase tracking-wide block mb-1">Context</span>
          &ldquo;...{q.originalContext}...&rdquo;
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

      {/* Post-answer: source info + next */}
      {state === 'answered' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-warm rounded-lg p-4 border border-border-light">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-primary truncate">{q.bookTitle}</p>
              <p className="text-xs text-muted">
                {q.bookAuthor}{q.bookDate ? `, ${q.bookDate}` : ''}
                {q.bookLanguage ? ` · ${q.bookLanguage}` : ''}
                {' · '}p.{q.pageNumber}
              </p>
            </div>
            <Link
              href={`${bookHref}?page=${q.pageNumber}`}
              className="text-sm text-accent-rust hover:underline whitespace-nowrap"
            >
              Read in context
            </Link>
          </div>

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
