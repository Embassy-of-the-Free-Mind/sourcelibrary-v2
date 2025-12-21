import { useState, useEffect } from 'react';
import type { Prompt } from '@/lib/types';

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
        const [ocrRes, transRes, sumRes] = await Promise.all([
          fetch('/api/prompts?type=ocr'),
          fetch('/api/prompts?type=translation'),
          fetch('/api/prompts?type=summary')
        ]);

        if (ocrRes.ok) {
          const ocrPrompts = await ocrRes.json();
          setPrompts(prev => ({
            ...prev,
            ocr: ocrPrompts.find((p: Prompt) => p.is_default) || ocrPrompts[0] || null
          }));
        }
        if (transRes.ok) {
          const transPrompts = await transRes.json();
          setPrompts(prev => ({
            ...prev,
            translation: transPrompts.find((p: Prompt) => p.is_default) || transPrompts[0] || null
          }));
        }
        if (sumRes.ok) {
          const sumPrompts = await sumRes.json();
          setPrompts(prev => ({
            ...prev,
            summary: sumPrompts.find((p: Prompt) => p.is_default) || sumPrompts[0] || null
          }));
        }
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
