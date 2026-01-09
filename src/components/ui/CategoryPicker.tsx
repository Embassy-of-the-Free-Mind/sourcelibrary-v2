'use client';

import { useState, useEffect, useCallback } from 'react';
import { Tag, X, Plus, Loader2, Check } from 'lucide-react';
import { categories as categoriesApi, books } from '@/lib/api-client';

interface Category {
  id: string;
  name: string;
  icon: string;
}

interface CategoryPickerProps {
  bookId: string;
  currentCategories: string[];
  onUpdate?: (categories: string[]) => void;
}

export default function CategoryPicker({ bookId, currentCategories, onUpdate }: CategoryPickerProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<string[]>(currentCategories || []);
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && categories.length === 0) {
      fetchCategories();
    }
  }, [isOpen]);

  useEffect(() => {
    setSelected(currentCategories || []);
  }, [currentCategories]);

  // Handle Escape key to close
  const handleClose = useCallback(() => setIsOpen(false), []);
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const data = await categoriesApi.list();
      setCategories(data.categories);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (categoryId: string) => {
    setSelected(prev =>
      prev.includes(categoryId)
        ? prev.filter(c => c !== categoryId)
        : [...prev, categoryId]
    );
  };

  const saveCategories = async () => {
    setSaving(true);
    try {
      await books.update(bookId, { categories: selected });
      onUpdate?.(selected);
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to save categories:', error);
    } finally {
      setSaving(false);
    }
  };

  const getCategoryName = (id: string) => {
    return categories.find(c => c.id === id)?.name || id;
  };

  const getCategoryIcon = (id: string) => {
    return categories.find(c => c.id === id)?.icon || '📚';
  };

  return (
    <div className="relative">
      {/* Current categories display */}
      <div className="flex flex-wrap items-center gap-2">
        {selected.length > 0 ? (
          selected.map(catId => (
            <span
              key={catId}
              className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium"
            >
              <span>{getCategoryIcon(catId)}</span>
              {getCategoryName(catId)}
            </span>
          ))
        ) : (
          <span className="text-stone-400 text-sm">No categories</span>
        )}
        <button
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-1 text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-full text-xs transition-colors"
        >
          <Tag className="w-3 h-3" />
          Edit
        </button>
      </div>

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={handleClose} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-picker-title"
            className="relative bg-white rounded-xl shadow-xl max-w-md w-full max-h-[80vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
              <h3 id="category-picker-title" className="font-semibold text-stone-900">Edit Categories</h3>
              <button
                onClick={handleClose}
                aria-label="Close dialog"
                className="p-1 hover:bg-stone-100 rounded transition-colors"
              >
                <X className="w-5 h-5 text-stone-500" aria-hidden="true" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-amber-600" />
                </div>
              ) : (
                <div className="space-y-2">
                  {categories.map(category => {
                    const isSelected = selected.includes(category.id);
                    return (
                      <button
                        key={category.id}
                        onClick={() => toggleCategory(category.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                          isSelected
                            ? 'bg-amber-100 text-amber-900'
                            : 'hover:bg-stone-100 text-stone-700'
                        }`}
                      >
                        <span className="text-lg">{category.icon}</span>
                        <span className="flex-1 font-medium">{category.name}</span>
                        {isSelected && (
                          <Check className="w-5 h-5 text-amber-600" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-stone-200 bg-stone-50">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-stone-600 hover:text-stone-800 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveCategories}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
