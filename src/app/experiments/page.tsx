'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  FlaskConical,
  Plus,
  Play,
  Trash2,
  BarChart3,
  Clock,
  DollarSign,
  FileText,
  ArrowLeft,
} from 'lucide-react';

interface Experiment {
  id: string;
  name: string;
  description: string;
  book_id: string;
  method: string;
  settings: {
    model: string;
    batch_size?: number;
    use_context?: boolean;
  };
  status: string;
  created_at: string;
  completed_at: string | null;
  results_count: number;
  total_cost: number;
  total_tokens: number;
}

interface Book {
  id: string;
  title: string;
}

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedBook, setSelectedBook] = useState('');

  // New experiment form
  const [newExperiment, setNewExperiment] = useState({
    name: '',
    description: '',
    book_id: '',
    method: 'single_ocr',
    model: 'gemini-2.0-flash',
    use_context: true,
  });

  useEffect(() => {
    fetchExperiments();
    fetchBooks();
  }, []);

  const fetchExperiments = async () => {
    try {
      const res = await fetch('/api/experiments');
      if (res.ok) {
        const data = await res.json();
        setExperiments(data.experiments);
      }
    } catch (error) {
      console.error('Error fetching experiments:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchBooks = async () => {
    try {
      const res = await fetch('/api/books');
      if (res.ok) {
        const data = await res.json();
        setBooks(data.books || []);
      }
    } catch (error) {
      console.error('Error fetching books:', error);
    }
  };

  const createExperiment = async () => {
    if (!newExperiment.name || !newExperiment.book_id) return;

    try {
      const res = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newExperiment.name,
          description: newExperiment.description,
          book_id: newExperiment.book_id,
          method: newExperiment.method,
          settings: {
            model: newExperiment.model,
            use_context: newExperiment.use_context,
          },
        }),
      });

      if (res.ok) {
        setShowNewForm(false);
        setNewExperiment({
          name: '',
          description: '',
          book_id: '',
          method: 'single_ocr',
          model: 'gemini-2.0-flash',
          use_context: true,
        });
        fetchExperiments();
      }
    } catch (error) {
      console.error('Error creating experiment:', error);
    }
  };

  const deleteExperiment = async (id: string) => {
    if (!confirm('Delete this experiment and all its results?')) return;

    try {
      await fetch(`/api/experiments/${id}`, { method: 'DELETE' });
      fetchExperiments();
    } catch (error) {
      console.error('Error deleting experiment:', error);
    }
  };

  const methodLabels: Record<string, string> = {
    single_ocr: 'Single-page OCR',
    batch_ocr: 'Batch OCR (5 pages)',
    single_translate: 'Single-page Translation',
    batch_translate: 'Batch Translation (5 pages)',
    combined: 'Combined OCR + Translation',
  };

  const statusColors: Record<string, string> = {
    pending: 'bg-stone-100 text-stone-600',
    running: 'bg-amber-100 text-amber-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };

  const filteredExperiments = selectedBook
    ? experiments.filter(e => e.book_id === selectedBook)
    : experiments;

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-stone-900 flex items-center gap-2">
                <FlaskConical className="w-6 h-6 text-purple-600" />
                A/B Experiments
              </h1>
              <p className="text-stone-500 text-sm">
                Compare different processing methods and settings
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowNewForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            <Plus className="w-4 h-4" />
            New Experiment
          </button>
        </div>

        {/* New Experiment Form */}
        {showNewForm && (
          <div className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-stone-900 mb-4">Create Experiment</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Name</label>
                <input
                  type="text"
                  value={newExperiment.name}
                  onChange={e => setNewExperiment(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Gemini 3 Flash vs 2.0 Flash OCR"
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Book</label>
                <select
                  value={newExperiment.book_id}
                  onChange={e => setNewExperiment(prev => ({ ...prev, book_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg"
                >
                  <option value="">Select a book...</option>
                  {books.map(book => (
                    <option key={book.id} value={book.id}>
                      {book.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Method</label>
                <select
                  value={newExperiment.method}
                  onChange={e => setNewExperiment(prev => ({ ...prev, method: e.target.value }))}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg"
                >
                  <option value="single_ocr">Single-page OCR</option>
                  <option value="batch_ocr">Batch OCR (5 pages)</option>
                  <option value="single_translate">Single-page Translation</option>
                  <option value="batch_translate">Batch Translation (5 pages)</option>
                  <option value="combined">Combined OCR + Translation</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Model</label>
                <select
                  value={newExperiment.model}
                  onChange={e => setNewExperiment(prev => ({ ...prev, model: e.target.value }))}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg"
                >
                  <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={newExperiment.description}
                  onChange={e =>
                    setNewExperiment(prev => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="What are you testing?"
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg"
                />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="use_context"
                  checked={newExperiment.use_context}
                  onChange={e =>
                    setNewExperiment(prev => ({ ...prev, use_context: e.target.checked }))
                  }
                  className="rounded"
                />
                <label htmlFor="use_context" className="text-sm text-stone-700">
                  Use previous page context for continuity
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowNewForm(false)}
                className="px-4 py-2 text-stone-600 hover:bg-stone-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={createExperiment}
                disabled={!newExperiment.name || !newExperiment.book_id}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                Create Experiment
              </button>
            </div>
          </div>
        )}

        {/* Filter by book */}
        <div className="flex items-center gap-4 mb-6">
          <label className="text-sm text-stone-600">Filter by book:</label>
          <select
            value={selectedBook}
            onChange={e => setSelectedBook(e.target.value)}
            className="px-3 py-1.5 border border-stone-300 rounded-lg text-sm"
          >
            <option value="">All books</option>
            {books.map(book => (
              <option key={book.id} value={book.id}>
                {book.title}
              </option>
            ))}
          </select>

          {filteredExperiments.length >= 2 && (
            <Link
              href={`/experiments/compare?a=${filteredExperiments[0]?.id}&b=${filteredExperiments[1]?.id}`}
              className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              <BarChart3 className="w-4 h-4" />
              Compare
            </Link>
          )}
        </div>

        {/* Experiments list */}
        {loading ? (
          <div className="text-center py-12 text-stone-500">Loading...</div>
        ) : filteredExperiments.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-stone-200">
            <FlaskConical className="w-12 h-12 text-stone-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-stone-600">No experiments yet</h3>
            <p className="text-stone-400 text-sm mt-1">
              Create an experiment to start comparing methods
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredExperiments.map(exp => (
              <div
                key={exp.id}
                className="bg-white rounded-xl border border-stone-200 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-semibold text-stone-900">{exp.name}</h3>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[exp.status] || statusColors.pending}`}
                      >
                        {exp.status}
                      </span>
                    </div>
                    {exp.description && (
                      <p className="text-sm text-stone-500 mb-2">{exp.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-stone-400">
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        {methodLabels[exp.method] || exp.method}
                      </span>
                      <span>{exp.settings.model}</span>
                      {exp.results_count > 0 && (
                        <span className="flex items-center gap-1">
                          <BarChart3 className="w-3 h-3" />
                          {exp.results_count} pages
                        </span>
                      )}
                      {exp.total_cost > 0 && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="w-3 h-3" />$
                          {exp.total_cost.toFixed(4)}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(exp.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {exp.status === 'pending' && (
                      <Link
                        href={`/experiments/${exp.id}/run`}
                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg"
                        title="Run experiment"
                      >
                        <Play className="w-4 h-4" />
                      </Link>
                    )}
                    {exp.status === 'completed' && (
                      <Link
                        href={`/experiments/${exp.id}`}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="View results"
                      >
                        <BarChart3 className="w-4 h-4" />
                      </Link>
                    )}
                    <button
                      onClick={() => deleteExperiment(exp.id)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
