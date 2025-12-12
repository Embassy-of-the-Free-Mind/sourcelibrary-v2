'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Loader2,
  Wand2,
  Save,
  ChevronLeft,
  ChevronRight,
  FileText,
  Languages,
  Sparkles,
  Settings
} from 'lucide-react';
import NotesRenderer from './NotesRenderer';
import type { Page, Book } from '@/lib/types';

interface TranslationEditorProps {
  book: Book;
  page: Page;
  pages: Page[];
  currentIndex: number;
  onNavigate: (pageId: string) => void;
  onSave: (data: { ocr?: string; translation?: string; summary?: string }) => Promise<void>;
}

export default function TranslationEditor({
  book,
  page,
  pages,
  currentIndex,
  onNavigate,
  onSave
}: TranslationEditorProps) {
  const [ocrText, setOcrText] = useState(page.ocr?.data || '');
  const [translationText, setTranslationText] = useState(page.translation?.data || '');
  const [summaryText, setSummaryText] = useState(page.summary?.data || '');

  const [processing, setProcessing] = useState<'ocr' | 'translation' | 'summary' | 'all' | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'ocr' | 'translation' | 'summary'>('ocr');
  const [showPromptSettings, setShowPromptSettings] = useState(false);

  const previousPage = currentIndex > 0 ? pages[currentIndex - 1] : null;
  const nextPage = currentIndex < pages.length - 1 ? pages[currentIndex + 1] : null;

  const handleProcess = async (action: 'ocr' | 'translation' | 'summary' | 'all') => {
    setProcessing(action);
    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId: page.id,
          action,
          imageUrl: page.photo,
          language: book.language || 'Latin',
          targetLanguage: 'English',
          ocrText: action === 'translation' ? ocrText : undefined,
          translatedText: action === 'summary' ? translationText : undefined,
          previousPageId: previousPage?.id,
          autoSave: true
        })
      });

      if (!response.ok) {
        throw new Error('Processing failed');
      }

      const result = await response.json();

      if (result.ocr) setOcrText(result.ocr);
      if (result.translation) setTranslationText(result.translation);
      if (result.summary) setSummaryText(result.summary);

      // Switch to appropriate tab
      if (action === 'ocr') setActiveTab('ocr');
      else if (action === 'translation') setActiveTab('translation');
      else if (action === 'summary') setActiveTab('summary');
    } catch (error) {
      console.error('Processing error:', error);
      alert('Processing failed. Please try again.');
    } finally {
      setProcessing(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        ocr: ocrText,
        translation: translationText,
        summary: summaryText
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href={`/book/${book.id}`} className="text-stone-500 hover:text-stone-700">
              ← Back to book
            </a>
            <div>
              <h1 className="font-serif font-semibold text-stone-900">{book.title}</h1>
              <p className="text-sm text-stone-500">Page {page.page_number} of {pages.length}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Navigation */}
            <button
              onClick={() => previousPage && onNavigate(previousPage.id)}
              disabled={!previousPage}
              className="p-2 rounded hover:bg-stone-100 disabled:opacity-30"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => nextPage && onNavigate(nextPage.id)}
              disabled={!nextPage}
              className="p-2 rounded hover:bg-stone-100 disabled:opacity-30"
            >
              <ChevronRight className="w-5 h-5" />
            </button>

            {/* Process All */}
            <button
              onClick={() => handleProcess('all')}
              disabled={processing !== null}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
            >
              {processing === 'all' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Process All
            </button>

            {/* Save */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-stone-900 text-white rounded-lg hover:bg-stone-800 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Image Panel */}
        <div className="w-1/3 border-r border-stone-200 bg-stone-100 overflow-auto">
          <div className="p-4">
            <div className="relative aspect-[3/4] bg-white rounded-lg overflow-hidden shadow-sm">
              {page.photo ? (
                <Image
                  src={page.photo}
                  alt={`Page ${page.page_number}`}
                  fill
                  className="object-contain"
                  sizes="33vw"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-stone-400">
                  No image
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Editor Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-stone-200 bg-white">
            <button
              onClick={() => setActiveTab('ocr')}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'ocr'
                  ? 'border-amber-600 text-amber-700'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <FileText className="w-4 h-4" />
              OCR Text
            </button>
            <button
              onClick={() => setActiveTab('translation')}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'translation'
                  ? 'border-amber-600 text-amber-700'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <Languages className="w-4 h-4" />
              Translation
            </button>
            <button
              onClick={() => setActiveTab('summary')}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'summary'
                  ? 'border-amber-600 text-amber-700'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              Summary
            </button>

            <div className="flex-1" />

            <button
              onClick={() => setShowPromptSettings(!showPromptSettings)}
              className="flex items-center gap-2 px-4 py-3 text-stone-500 hover:text-stone-700"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 flex overflow-hidden">
            {/* Editor */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 border-b border-stone-200 bg-white flex items-center justify-between">
                <span className="text-sm text-stone-500">
                  {activeTab === 'ocr' && `Source: ${book.language || 'Latin'}`}
                  {activeTab === 'translation' && 'Target: English'}
                  {activeTab === 'summary' && 'Plain-language summary'}
                </span>
                <button
                  onClick={() => handleProcess(activeTab)}
                  disabled={processing !== null}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-amber-100 text-amber-700 rounded hover:bg-amber-200 disabled:opacity-50"
                >
                  {processing === activeTab ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Wand2 className="w-4 h-4" />
                  )}
                  {activeTab === 'ocr' && 'Run OCR'}
                  {activeTab === 'translation' && 'Translate'}
                  {activeTab === 'summary' && 'Generate'}
                </button>
              </div>

              <div className="flex-1 overflow-auto p-4">
                {activeTab === 'ocr' && (
                  <textarea
                    value={ocrText}
                    onChange={(e) => setOcrText(e.target.value)}
                    className="w-full h-full p-4 border border-stone-200 rounded-lg resize-none font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="OCR text will appear here..."
                  />
                )}
                {activeTab === 'translation' && (
                  <textarea
                    value={translationText}
                    onChange={(e) => setTranslationText(e.target.value)}
                    className="w-full h-full p-4 border border-stone-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="Translation will appear here..."
                  />
                )}
                {activeTab === 'summary' && (
                  <textarea
                    value={summaryText}
                    onChange={(e) => setSummaryText(e.target.value)}
                    className="w-full h-full p-4 border border-stone-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="Summary will appear here..."
                  />
                )}
              </div>
            </div>

            {/* Preview Panel */}
            <div className="w-1/2 border-l border-stone-200 bg-white overflow-auto">
              <div className="p-4 border-b border-stone-200">
                <span className="text-sm font-medium text-stone-700">Preview with Notes</span>
              </div>
              <div className="p-4">
                <NotesRenderer
                  text={
                    activeTab === 'ocr'
                      ? ocrText
                      : activeTab === 'translation'
                      ? translationText
                      : summaryText
                  }
                  className="text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
