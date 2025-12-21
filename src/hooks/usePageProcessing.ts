import { useState, useRef, useCallback } from 'react';
import type { Page, Book, Prompt } from '@/lib/types';

export interface ProcessingState {
  active: boolean;
  type: 'ocr' | 'translation' | 'summary' | null;
  currentPageId: string | null;
  currentIndex: number;
  totalPages: number;
  completed: string[];
  failed: string[];
  stopped: boolean;
}

interface UsePageProcessingOptions {
  pages: Page[];
  book: Book | null;
  prompts: { ocr: Prompt | null; translation: Prompt | null; summary: Prompt | null };
  onPageUpdate: (pageId: string, updates: Partial<Page>) => void;
}

export function usePageProcessing({
  pages,
  book,
  prompts,
  onPageUpdate
}: UsePageProcessingOptions) {
  const [processing, setProcessing] = useState<ProcessingState>({
    active: false,
    type: null,
    currentPageId: null,
    currentIndex: 0,
    totalPages: 0,
    completed: [],
    failed: [],
    stopped: false
  });

  const stopProcessingRef = useRef(false);

  const processPages = useCallback(async (
    type: 'ocr' | 'translation' | 'summary',
    pageIds: string[]
  ) => {
    if (pageIds.length === 0) return;

    stopProcessingRef.current = false;
    setProcessing({
      active: true,
      type,
      currentPageId: null,
      currentIndex: 0,
      totalPages: pageIds.length,
      completed: [],
      failed: [],
      stopped: false
    });

    const completed: string[] = [];
    const failed: string[] = [];

    for (let i = 0; i < pageIds.length; i++) {
      if (stopProcessingRef.current) {
        setProcessing(prev => ({ ...prev, stopped: true }));
        break;
      }

      const pageId = pageIds[i];
      const page = pages.find(p => p.id === pageId);
      if (!page) continue;

      setProcessing(prev => ({
        ...prev,
        currentPageId: pageId,
        currentIndex: i + 1
      }));

      try {
        // Get previous page for context
        const pageIndex = pages.findIndex(p => p.id === pageId);
        const previousPage = pageIndex > 0 ? pages[pageIndex - 1] : null;

        const response = await fetch('/api/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageId,
            action: type,
            imageUrl: page.photo,
            language: book?.language || 'Latin',
            targetLanguage: 'English',
            ocrText: type === 'translation' ? page.ocr?.data : undefined,
            translatedText: type === 'summary' ? page.translation?.data : undefined,
            previousPageId: previousPage?.id,
            customPrompts: {
              ocr: prompts.ocr?.content,
              translation: prompts.translation?.content,
              summary: prompts.summary?.content
            },
            autoSave: true
          })
        });

        if (response.ok) {
          const result = await response.json();
          // Update local page data
          const updates: Partial<Page> = {};
          if (result.ocr) {
            updates.ocr = {
              data: result.ocr,
              language: page.ocr?.language || book?.language || 'unknown',
              model: page.ocr?.model || 'gemini-2.0-flash'
            };
          }
          if (result.translation) {
            updates.translation = {
              data: result.translation,
              language: page.translation?.language || 'English',
              model: page.translation?.model || 'gemini-2.0-flash'
            };
          }
          if (result.summary) {
            updates.summary = {
              data: result.summary,
              model: page.summary?.model || 'gemini-2.0-flash'
            };
          }
          onPageUpdate(pageId, updates);
          completed.push(pageId);
        } else {
          failed.push(pageId);
        }
      } catch (error) {
        console.error(`Processing error for page ${pageId}:`, error);
        failed.push(pageId);
      }

      setProcessing(prev => ({
        ...prev,
        completed: [...completed],
        failed: [...failed]
      }));

      // Rate limiting delay
      if (i < pageIds.length - 1 && !stopProcessingRef.current) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    setProcessing(prev => ({
      ...prev,
      active: false,
      currentPageId: null
    }));
  }, [pages, book, prompts, onPageUpdate]);

  const stopProcessing = useCallback(() => {
    stopProcessingRef.current = true;
  }, []);

  return {
    processing,
    processPages,
    stopProcessing
  };
}
