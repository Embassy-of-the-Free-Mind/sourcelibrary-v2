'use client';

import { useState } from 'react';
import { X, Save, Loader2, Search, ExternalLink, Languages } from 'lucide-react';

interface BookEditModalProps {
  book: {
    id: string;
    title?: string;
    display_title?: string;
    author?: string;
    language?: string;
    published?: string;
    place_published?: string;
    publisher?: string;
    ustc_id?: string;
  };
  onClose: () => void;
  onSave: () => void;
}

interface SearchResult {
  id: string;
  title: string;
  englishTitle?: string;
  author?: string;
  language?: string;
  year?: string;
  place?: string;
  source?: string;
  workType?: string;
  subjectTags?: string[];
}

export default function BookEditModal({ book, onClose, onSave }: BookEditModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [title, setTitle] = useState(book.title || '');
  const [displayTitle, setDisplayTitle] = useState(book.display_title || '');
  const [author, setAuthor] = useState(book.author || '');
  const [language, setLanguage] = useState(book.language || '');
  const [published, setPublished] = useState(book.published || '');
  const [placePublished, setPlacePublished] = useState(book.place_published || '');
  const [publisher, setPublisher] = useState(book.publisher || '');
  const [ustcId, setUstcId] = useState(book.ustc_id || '');

  // Catalog search (EFM, IA, USTC)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Title translation
  const [translating, setTranslating] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/books/${book.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          display_title: displayTitle || undefined,
          author: author || undefined,
          language: language || undefined,
          published: published || undefined,
          place_published: placePublished || undefined,
          publisher: publisher || undefined,
          ustc_id: ustcId || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const searchCatalog = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);

    try {
      const res = await fetch(`/api/ustc/search?q=${encodeURIComponent(searchQuery)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
      }
    } catch {
      // Silently fail - search is optional
    } finally {
      setSearching(false);
    }
  };

  const applySearchResult = (result: SearchResult) => {
    // Extract USTC ID if it's a USTC result
    if (result.id.startsWith('USTC-')) {
      setUstcId(result.id.replace('USTC-', ''));
    }
    if (result.title) setTitle(result.title);
    // Use pre-translated English title if available
    if (result.englishTitle) setDisplayTitle(result.englishTitle);
    if (result.author) setAuthor(result.author);
    if (result.language) setLanguage(result.language);
    if (result.year) setPublished(result.year);
    if (result.place) setPlacePublished(result.place);
    setSearchResults([]);
    setSearchQuery('');
  };

  const translateTitle = async () => {
    if (!title.trim()) return;
    setTranslating(true);
    setError(null);

    try {
      // Detect source language from the language field or default to Latin
      const sourceLanguage = language?.toLowerCase().includes('latin') ? 'Latin'
        : language?.toLowerCase().includes('german') ? 'German'
        : language?.toLowerCase().includes('french') ? 'French'
        : language?.toLowerCase().includes('italian') ? 'Italian'
        : language || 'Latin';

      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: title,
          sourceLanguage,
          targetLanguage: 'English',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.translation) {
          setDisplayTitle(data.translation);
        }
      } else {
        const data = await res.json();
        setError(data.error || 'Translation failed');
      }
    } catch {
      setError('Translation failed');
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-stone-200">
          <h2 className="text-lg font-semibold text-stone-900">Edit Book Metadata</h2>
          <button onClick={onClose} className="p-1 hover:bg-stone-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Catalog Search (EFM, IA, USTC) */}
        <div className="p-4 bg-amber-50 border-b border-amber-100">
          <label className="block text-sm font-medium text-amber-900 mb-2">
            Search Catalogs (EFM, Internet Archive, USTC)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchCatalog()}
              placeholder="Search by title, author, or USTC ID..."
              className="flex-1 px-3 py-2 border border-amber-200 rounded-lg text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <button
              onClick={searchCatalog}
              disabled={searching}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center gap-2"
            >
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Search
            </button>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
              {searchResults.map((result, idx) => (
                <button
                  key={`${result.id}-${idx}`}
                  onClick={() => applySearchResult(result)}
                  className="w-full text-left p-3 bg-white rounded-lg border border-amber-200 hover:border-amber-400 transition-colors"
                >
                  <div className="font-medium text-stone-900 text-sm">{result.title}</div>
                  {result.englishTitle && (
                    <div className="text-sm text-blue-700 mt-0.5 italic">{result.englishTitle}</div>
                  )}
                  <div className="text-xs text-stone-500 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                    {result.author && <span>{result.author}</span>}
                    {result.place && <span>{result.place}</span>}
                    {result.year && <span>{result.year}</span>}
                    {result.language && <span className="text-stone-400">({result.language})</span>}
                    {result.workType && <span className="bg-stone-100 px-1 rounded">{result.workType}</span>}
                    {result.source && (
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        result.source === 'EFM' ? 'bg-purple-100 text-purple-700' :
                        result.source === 'IA' ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {result.source}
                      </span>
                    )}
                  </div>
                  {result.subjectTags && result.subjectTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {result.subjectTags.slice(0, 4).map((tag, i) => (
                        <span key={i} className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">{tag}</span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Form */}
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-stone-700 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Display Title <span className="text-stone-400 font-normal">(optional, English translation)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={displayTitle}
                  onChange={(e) => setDisplayTitle(e.target.value)}
                  placeholder={title}
                  className="flex-1 px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button
                  type="button"
                  onClick={translateTitle}
                  disabled={translating || !title.trim()}
                  className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 text-sm whitespace-nowrap"
                  title="Translate title to English"
                >
                  {translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
                  Translate
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Author</label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Language</label>
              <input
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="e.g., Latin, German, English"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Year Published</label>
              <input
                type="text"
                value={published}
                onChange={(e) => setPublished(e.target.value)}
                placeholder="e.g., 1548"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Place Published</label>
              <input
                type="text"
                value={placePublished}
                onChange={(e) => setPlacePublished(e.target.value)}
                placeholder="e.g., Venice"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Publisher/Printer</label>
              <input
                type="text"
                value={publisher}
                onChange={(e) => setPublisher(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                USTC ID
                {ustcId && (
                  <a
                    href={`https://www.ustc.ac.uk/editions/${ustcId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-amber-600 hover:text-amber-700"
                  >
                    <ExternalLink className="w-3 h-3 inline" />
                  </a>
                )}
              </label>
              <input
                type="text"
                value={ustcId}
                onChange={(e) => setUstcId(e.target.value)}
                placeholder="e.g., 2029384"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-stone-200 bg-stone-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-stone-700 hover:bg-stone-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
