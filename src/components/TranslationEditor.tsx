'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Settings,
  X,
  Eye,
  Pencil,
  Copy,
  Check,
  ZoomIn
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

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  promptText: string;
  onPromptChange: (text: string) => void;
}

function SettingsModal({ isOpen, onClose, title, promptText, onPromptChange }: SettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="w-full max-w-lg mx-4 rounded-xl shadow-2xl" style={{ background: 'var(--bg-white)' }}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={onClose} className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <label className="label block mb-2">AI Model</label>
            <select
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' }}
            >
              <option>Gemini 2.0 Flash</option>
            </select>
          </div>

          <div>
            <label className="label block mb-2">Prompt Template</label>
            <select
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' }}
            >
              <option>Standard {title.replace(' Settings', '')}</option>
              <option>Scholarly {title.replace(' Settings', '')}</option>
            </select>
          </div>

          <div>
            <label className="label block mb-2">
              Prompt Text <span style={{ color: 'var(--text-faint)', fontWeight: 'normal', textTransform: 'none' }}>(use {'{language}'} as placeholders)</span>
            </label>
            <textarea
              value={promptText}
              onChange={(e) => onPromptChange(e.target.value)}
              className="w-full h-40 px-3 py-2.5 rounded-lg text-sm font-mono resize-none"
              style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-cream)', color: 'var(--text-secondary)' }}
            />
          </div>

          <div className="flex justify-end">
            <button
              className="text-sm font-medium transition-opacity hover:opacity-70"
              style={{ color: 'var(--accent-rust)' }}
            >
              Save Changes
            </button>
          </div>

          <div className="pt-4" style={{ borderTop: '1px solid var(--border-light)' }}>
            <label className="label block mb-2">Create New Prompt</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="New prompt name..."
                className="flex-1 px-3 py-2.5 rounded-lg text-sm"
                style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' }}
              />
              <button
                className="px-4 py-2 text-sm font-medium transition-opacity hover:opacity-70"
                style={{ color: 'var(--text-muted)' }}
              >
                + Add
              </button>
            </div>
          </div>
        </div>

        <div className="p-5" style={{ borderTop: '1px solid var(--border-light)' }}>
          <button
            onClick={onClose}
            className="btn-primary w-full justify-center"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// Magnifier component for zooming into the source image
function ImageWithMagnifier({ src, alt }: { src: string; alt: string }) {
  const [showMagnifier, setShowMagnifier] = useState(false);
  const [magnifierPosition, setMagnifierPosition] = useState({ x: 0, y: 0 });
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const imageRef = useRef<HTMLDivElement>(null);

  const magnifierSize = 180;
  const zoomLevel = 2.5;

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageRef.current) return;

    const rect = imageRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Position as percentage for background-position
    const xPercent = (x / rect.width) * 100;
    const yPercent = (y / rect.height) * 100;

    setCursorPosition({ x, y });
    setMagnifierPosition({ x: xPercent, y: yPercent });
  };

  return (
    <div
      ref={imageRef}
      className="relative w-full h-full cursor-crosshair"
      onMouseEnter={() => setShowMagnifier(true)}
      onMouseLeave={() => setShowMagnifier(false)}
      onMouseMove={handleMouseMove}
    >
      <Image
        src={src}
        alt={alt}
        fill
        className="object-contain"
        sizes="50vw"
      />

      {/* Magnifier lens */}
      {showMagnifier && (
        <div
          className="absolute pointer-events-none rounded-full shadow-lg"
          style={{
            width: magnifierSize,
            height: magnifierSize,
            left: cursorPosition.x - magnifierSize / 2,
            top: cursorPosition.y - magnifierSize / 2,
            border: '3px solid var(--border-medium)',
            backgroundImage: `url(${src})`,
            backgroundSize: `${zoomLevel * 100}%`,
            backgroundPosition: `${magnifierPosition.x}% ${magnifierPosition.y}%`,
            backgroundRepeat: 'no-repeat',
            backgroundColor: 'var(--bg-white)',
          }}
        />
      )}

      {/* Zoom hint */}
      {!showMagnifier && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded text-xs" style={{ background: 'rgba(0,0,0,0.5)', color: 'white' }}>
          <ZoomIn className="w-3 h-3" />
          Hover to zoom
        </div>
      )}
    </div>
  );
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
  const [mode, setMode] = useState<'read' | 'edit'>('read');

  const [showOcrSettings, setShowOcrSettings] = useState(false);
  const [showTranslationSettings, setShowTranslationSettings] = useState(false);

  const [ocrPrompt, setOcrPrompt] = useState('OCR the page in {language}. Return only the transcribed text.');
  const [translationPrompt, setTranslationPrompt] = useState('Translate the following {language} text to English. Preserve formatting and add [[notes]] for uncertainties.');

  const [copiedTranslation, setCopiedTranslation] = useState(false);

  const previousPage = currentIndex > 0 ? pages[currentIndex - 1] : null;
  const nextPage = currentIndex < pages.length - 1 ? pages[currentIndex + 1] : null;

  // Update state when page changes
  useEffect(() => {
    setOcrText(page.ocr?.data || '');
    setTranslationText(page.translation?.data || '');
    setSummaryText(page.summary?.data || '');
  }, [page]);

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
    } catch (error) {
      console.error('Processing error:', error);
      alert('Processing failed. Please try again.');
    } finally {
      setProcessing(null);
    }
  };

  const handleSave = async () => {
    try {
      await onSave({
        ocr: ocrText,
        translation: translationText,
        summary: summaryText
      });
    } catch (error) {
      console.error('Save error:', error);
    }
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedTranslation(true);
    setTimeout(() => setCopiedTranslation(false), 2000);
  };

  // READ MODE - Clean reading experience
  if (mode === 'read') {
    return (
      <div className="h-screen flex flex-col" style={{ background: 'var(--bg-cream)' }}>
        {/* Minimal Header */}
        <header className="px-6 py-4 flex items-center justify-between" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-4">
            <a href={`/book/${book.id}`} className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </a>
            <div>
              <h1 className="text-xl font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
                {book.display_title || book.title}
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Page {currentIndex + 1} of {pages.length}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Mode Toggle */}
            <div className="flex items-center rounded-lg p-1" style={{ background: 'var(--bg-warm)' }}>
              <button
                onClick={() => setMode('read')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all"
                style={{
                  background: 'var(--bg-white)',
                  color: 'var(--text-primary)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                }}
              >
                <Eye className="w-4 h-4" />
                Read
              </button>
              <button
                onClick={() => setMode('edit')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all"
                style={{
                  background: 'transparent',
                  color: 'var(--text-muted)',
                }}
              >
                <Pencil className="w-4 h-4" />
                Edit
              </button>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'var(--bg-warm)' }}>
              <button
                onClick={() => previousPage && onNavigate(previousPage.id)}
                disabled={!previousPage}
                className="p-2 rounded-md transition-all disabled:opacity-30"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{currentIndex + 1} / {pages.length}</span>
              <button
                onClick={() => nextPage && onNavigate(nextPage.id)}
                disabled={!nextPage}
                className="p-2 rounded-md transition-all disabled:opacity-30"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Two-column reading layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Source Image with Magnifier */}
          <div className="w-1/2 flex flex-col" style={{ background: 'var(--bg-warm)', borderRight: '1px solid var(--border-light)' }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="label">Original</span>
              <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet)' }}>
                {book.language || 'Latin'}
              </span>
            </div>
            <div className="flex-1 overflow-hidden p-6">
              <div className="relative w-full h-full rounded-lg overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                {page.photo ? (
                  <ImageWithMagnifier src={page.photo} alt={`Page ${page.page_number}`} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
                    No image available
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Translation */}
          <div className="w-1/2 flex flex-col" style={{ background: 'var(--bg-white)' }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2">
                <span className="label">Translation</span>
                <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(139, 154, 125, 0.15)', color: 'var(--accent-sage)' }}>
                  English
                </span>
              </div>
              <button
                onClick={() => copyToClipboard(translationText)}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors hover:opacity-70"
                style={{ color: 'var(--text-muted)' }}
              >
                {copiedTranslation ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--accent-sage)' }} /> : <Copy className="w-3.5 h-3.5" />}
                {copiedTranslation ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {translationText ? (
                <NotesRenderer text={translationText} />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center" style={{ color: 'var(--text-muted)' }}>
                  <p className="text-lg mb-2" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif' }}>No translation yet</p>
                  <p className="text-sm">Switch to Edit mode to run OCR and translation.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // EDIT MODE - Full editing interface
  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--bg-warm)' }}>
      {/* Header */}
      <header className="px-6 py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href={`/book/${book.id}`} className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </a>
            <div>
              <h1 className="text-xl font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
                {book.display_title || book.title}
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Page {currentIndex + 1} of {pages.length}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Mode Toggle */}
            <div className="flex items-center rounded-lg p-1" style={{ background: 'var(--bg-warm)' }}>
              <button
                onClick={() => setMode('read')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all"
                style={{
                  background: 'transparent',
                  color: 'var(--text-muted)',
                }}
              >
                <Eye className="w-4 h-4" />
                Read
              </button>
              <button
                onClick={() => setMode('edit')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all"
                style={{
                  background: 'var(--bg-white)',
                  color: 'var(--text-primary)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                }}
              >
                <Pencil className="w-4 h-4" />
                Edit
              </button>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'var(--bg-warm)' }}>
              <button
                onClick={() => previousPage && onNavigate(previousPage.id)}
                disabled={!previousPage}
                className="p-2 rounded-md transition-all disabled:opacity-30"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{currentIndex + 1} / {pages.length}</span>
              <button
                onClick={() => nextPage && onNavigate(nextPage.id)}
                disabled={!nextPage}
                className="p-2 rounded-md transition-all disabled:opacity-30"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - Three Columns */}
      <div className="flex-1 flex overflow-hidden">
        {/* Source Image Panel */}
        <div className="w-1/3 flex flex-col" style={{ background: 'var(--bg-cream)', borderRight: '1px solid var(--border-light)' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <span className="label">Source</span>
            <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet)' }}>
              {book.language || 'Latin'}
            </span>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <div className="relative aspect-[3/4] rounded-lg overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              {page.photo ? (
                <Image
                  src={page.photo}
                  alt={`Page ${page.page_number}`}
                  fill
                  className="object-contain"
                  sizes="33vw"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
                  No image available
                </div>
              )}
            </div>
          </div>
        </div>

        {/* OCR Panel */}
        <div className="w-1/3 flex flex-col" style={{ background: 'var(--bg-white)', borderRight: '1px solid var(--border-light)' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowOcrSettings(true)}
                className="btn-secondary"
                style={{ padding: '6px 12px' }}
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
              <button
                onClick={() => handleProcess('ocr')}
                disabled={processing !== null}
                className="btn-primary"
                style={{ padding: '6px 16px' }}
              >
                {processing === 'ocr' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Run OCR
              </button>
            </div>
          </div>

          <div className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>OCR Text</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{ocrText.length} chars</span>
          </div>

          <div className="flex-1 overflow-auto p-4">
            <textarea
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              onBlur={handleSave}
              className="w-full h-full p-0 border-0 resize-none leading-relaxed focus:outline-none focus:ring-0"
              style={{ fontFamily: 'Newsreader, Georgia, serif', color: 'var(--text-secondary)', fontSize: '16px', lineHeight: '1.75' }}
              placeholder="OCR text will appear here..."
            />
          </div>
        </div>

        {/* Translation Panel */}
        <div className="w-1/3 flex flex-col" style={{ background: 'var(--bg-white)' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowTranslationSettings(true)}
                className="btn-secondary"
                style={{ padding: '6px 12px' }}
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
              <button
                onClick={() => handleProcess('translation')}
                disabled={processing !== null || !ocrText}
                className="btn-primary"
                style={{ padding: '6px 16px' }}
              >
                {processing === 'translation' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Translate
              </button>
            </div>
          </div>

          <div className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Translation</span>
              <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(139, 154, 125, 0.15)', color: 'var(--accent-sage)' }}>
                English
              </span>
            </div>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{translationText.length} chars</span>
          </div>

          <div className="flex-1 overflow-auto p-4">
            <textarea
              value={translationText}
              onChange={(e) => setTranslationText(e.target.value)}
              onBlur={handleSave}
              className="w-full h-full p-0 border-0 resize-none leading-relaxed focus:outline-none focus:ring-0"
              style={{ fontFamily: 'Newsreader, Georgia, serif', color: 'var(--text-secondary)', fontSize: '16px', lineHeight: '1.75' }}
              placeholder="Translation will appear here..."
            />
          </div>
        </div>
      </div>

      {/* Settings Modals */}
      <SettingsModal
        isOpen={showOcrSettings}
        onClose={() => setShowOcrSettings(false)}
        title="OCR Settings"
        promptText={ocrPrompt}
        onPromptChange={setOcrPrompt}
      />

      <SettingsModal
        isOpen={showTranslationSettings}
        onClose={() => setShowTranslationSettings(false)}
        title="Translation Settings"
        promptText={translationPrompt}
        onPromptChange={setTranslationPrompt}
      />
    </div>
  );
}
