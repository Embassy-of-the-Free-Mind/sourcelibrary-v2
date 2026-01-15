import { useState, useRef, useCallback } from 'react';
import type { Page, Book, Prompt } from '@/lib/types';
import { processing as processingApi } from '@/lib/api-client';

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

  // Parallel batch OCR processing (10 at a time)
  const processBatchOCR = useCallback(async (pageIds: string[]) => {
    if (pageIds.length === 0) return;

    stopProcessingRef.current = false;
    setProcessing({
      active: true,
      type: 'ocr',
      currentPageId: null,
      currentIndex: 0,
      totalPages: pageIds.length,
      completed: [],
      failed: [],
      stopped: false
    });

    try {
      const batchPages = pageIds.map(pageId => {
        const page = pages.find(p => p.id === pageId);
        return {
          pageId,
          imageUrl: page?.photo || '',
          language: book?.language || 'Latin',
          customPrompt: prompts.ocr?.content
        };
      }).filter(p => p.imageUrl);

      const { results } = await processingApi.batchOcr({
        pages: batchPages,
        autoSave: true
      });

      const completed: string[] = [];
      const failed: string[] = [];

      for (const result of results) {
        if (result.success && result.ocr) {
          onPageUpdate(result.pageId, {
            ocr: {
              data: result.ocr,
              language: book?.language || 'unknown',
              model: 'gemini-3-flash-preview'
            }
          });
          completed.push(result.pageId);
        } else {
          failed.push(result.pageId);
        }
      }

      setProcessing(prev => ({
        ...prev,
        active: false,
        completed,
        failed,
        currentIndex: pageIds.length
      }));
    } catch (error) {
      console.error('Batch OCR error:', error);
      setProcessing(prev => ({
        ...prev,
        active: false,
        failed: pageIds
      }));
    }
  }, [pages, book, prompts, onPageUpdate]);

  // Sequential processing for translation/summary (needs context)
  const processPages = useCallback(async (
    type: 'ocr' | 'translation' | 'summary',
    pageIds: string[]
  ) => {
    if (pageIds.length === 0) return;

    // Use parallel batch for OCR
    if (type === 'ocr') {
      return processBatchOCR(pageIds);
    }

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

        const result = await processingApi.process({
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
        });

        // Update local page data
        const updates: Partial<Page> = {};
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
      } catch (error) {
        console.error(`Processing error for page ${pageId}:`, error);
        failed.push(pageId);
      }

      setProcessing(prev => ({
        ...prev,
        completed: [...completed],
        failed: [...failed]
      }));

      // Rate limiting delay for sequential processing
      if (i < pageIds.length - 1 && !stopProcessingRef.current) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    setProcessing(prev => ({
      ...prev,
      active: false,
      currentPageId: null
    }));
  }, [pages, book, prompts, onPageUpdate, processBatchOCR]);

  const stopProcessing = useCallback(() => {
    stopProcessingRef.current = true;
  }, []);

  return {
    processing,
    processPages,
    stopProcessing
  };
}
