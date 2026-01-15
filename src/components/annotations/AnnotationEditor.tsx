'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Loader2,
  Check,
  BookOpen,
  AlertCircle,
  HelpCircle,
  Quote,
  Languages,
  MessageCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { AnnotationType } from '@/lib/types';
import { annotations } from '@/lib/api-client';

interface AnnotationEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  bookId: string;
  pageId: string;
  pageNumber: number;
  selectedText: string;
  startOffset?: number;
  endOffset?: number;
  parentId?: string; // For replies
}

const ANNOTATION_TYPES: { value: AnnotationType; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'comment', label: 'Comment', icon: <MessageCircle className="w-4 h-4" />, description: 'Quick note or thought' },
  { value: 'context', label: 'Context', icon: <BookOpen className="w-4 h-4" />, description: 'Historical or cultural background' },
  { value: 'reference', label: 'Reference', icon: <Quote className="w-4 h-4" />, description: 'Source, citation, or cross-reference' },
  { value: 'correction', label: 'Correction', icon: <AlertCircle className="w-4 h-4" />, description: 'Error in OCR or translation' },
  { value: 'etymology', label: 'Etymology', icon: <Languages className="w-4 h-4" />, description: 'Word origin or meaning' },
  { value: 'question', label: 'Question', icon: <HelpCircle className="w-4 h-4" />, description: 'Ask for clarification' },
];

export default function AnnotationEditor({
  isOpen,
  onClose,
  onSave,
  bookId,
  pageId,
  pageNumber,
  selectedText,
  startOffset,
  endOffset,
  parentId,
}: AnnotationEditorProps) {
  const [type, setType] = useState<AnnotationType>('comment');
  const [content, setContent] = useState('');
  const [userName, setUserName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Load saved username from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('annotation_username');
    if (saved) setUserName(saved);
  }, []);

  // Reset when opening
  useEffect(() => {
    if (isOpen) {
      setType('comment');
      setContent('');
      setError(null);
      setShowAdvanced(false);
    }
  }, [isOpen]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const minLength = type === 'comment' ? 3 : 10;
    if (content.length < minLength) {
      setError(`Comment must be at least ${minLength} characters`);
      return;
    }

    if (!userName.trim()) {
      setError('Please enter your name');
      return;
    }

    setSaving(true);

    try {
      // Save username for future annotations
      localStorage.setItem('annotation_username', userName.trim());

      await annotations.create({
        book_id: bookId,
        page_id: pageId,
        page_number: pageNumber,
        anchor: {
          text: selectedText,
          start_offset: startOffset,
          end_offset: endOffset,
        },
        content: content.trim(),
        type,
        user_name: userName.trim(),
        parent_id: parentId,
      });

      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />

      {/* Modal - Compact by default */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="annotation-editor-title"
        className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 bg-stone-50">
          <h2 id="annotation-editor-title" className="font-medium text-stone-900">
            {parentId ? 'Reply' : 'Add Comment'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 hover:bg-stone-200 rounded transition-colors"
          >
            <X className="w-4 h-4 text-stone-600" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Selected text preview - compact */}
          <div className="bg-yellow-50 border-l-2 border-yellow-400 px-3 py-2 text-sm text-stone-600 italic">
            &ldquo;{selectedText.length > 100 ? selectedText.slice(0, 100) + '...' : selectedText}&rdquo;
          </div>

          {/* Name input - inline if not saved */}
          {!userName && (
            <div>
              <label htmlFor="annotation-username" className="sr-only">Your name</label>
              <input
                id="annotation-username"
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Your name"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              />
            </div>
          )}

          {/* Comment textarea */}
          <div>
            <label htmlFor="annotation-content" className="sr-only">Your comment</label>
            <textarea
              id="annotation-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your comment..."
              rows={3}
              autoFocus
              className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 resize-none"
            />
          </div>

          {/* Advanced options toggle */}
          {!parentId && (
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700"
            >
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showAdvanced ? 'Less options' : 'More options (annotation type)'}
            </button>
          )}

          {/* Advanced options */}
          {showAdvanced && !parentId && (
            <div className="space-y-4 pt-2 border-t border-stone-100">
              {/* Type selector */}
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-2">
                  Annotation type
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ANNOTATION_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setType(t.value)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                        type === t.value
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : 'bg-stone-100 text-stone-600 hover:bg-stone-200 border border-transparent'
                      }`}
                      title={t.description}
                    >
                      {t.icon}
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div role="alert" className="flex items-center gap-2 p-2 bg-red-50 text-red-700 rounded text-xs">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-stone-400">
              {userName && <span>Posting as {userName}</span>}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-stone-600 hover:text-stone-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || content.length < 3}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-3 h-3" />
                    Post
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
