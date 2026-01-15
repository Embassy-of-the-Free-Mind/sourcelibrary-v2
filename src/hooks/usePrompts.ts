import { useState, useEffect } from 'react';
import type { Prompt } from '@/lib/types';
import { prompts as promptsApi } from '@/lib/api-client';

interface PromptsState {
  ocr: Prompt | null;
  translation: Prompt | null;
  summary: Prompt | null;
}

export function usePrompts() {
  const [prompts, setPrompts] = useState<PromptsState>({
    ocr: null,
    translation: null,
    summary: null
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPrompts = async () => {
      try {
        const [ocrData, transData, sumData] = await Promise.all([
          promptsApi.list({ type: 'ocr' }),
          promptsApi.list({ type: 'translation' }),
          promptsApi.list({ type: 'summary' })
        ]);

        const ocrPrompts = ocrData || [];
        const transPrompts = transData || [];
        const sumPrompts = sumData || [];

        setPrompts({
          ocr: ocrPrompts.find((p: Prompt) => p.is_default) || ocrPrompts[0] || null,
          translation: transPrompts.find((p: Prompt) => p.is_default) || transPrompts[0] || null,
          summary: sumPrompts.find((p: Prompt) => p.is_default) || sumPrompts[0] || null
        });
      } catch (error) {
        console.error('Error fetching prompts:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPrompts();
  }, []);

  const updatePrompt = (type: keyof PromptsState, content: string) => {
    setPrompts(prev => ({
      ...prev,
      [type]: prev[type] ? { ...prev[type], content } : null
    }));
  };

  return { prompts, setPrompts, updatePrompt, loading };
}
