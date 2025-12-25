'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

interface UseSearchHighlightOptions {
  // Container ref to search within
  containerRef?: React.RefObject<HTMLElement | null>;
  // Delay before searching (to wait for content to render)
  delay?: number;
  // CSS class for highlights
  highlightClass?: string;
}

/**
 * Hook to highlight search terms on a page and scroll to the first match.
 * Reads the `highlight` query parameter from the URL.
 */
export function useSearchHighlight(options: UseSearchHighlightOptions = {}) {
  const { delay = 500, highlightClass = 'search-highlight' } = options;
  const searchParams = useSearchParams();
  const highlightQuery = searchParams.get('highlight');
  const hasHighlighted = useRef(false);

  // Clear existing highlights
  const clearHighlights = useCallback(() => {
    const highlights = document.querySelectorAll(`.${highlightClass}`);
    highlights.forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        parent.normalize();
      }
    });
  }, [highlightClass]);

  // Highlight text within a container
  const highlightText = useCallback((container: HTMLElement, searchText: string) => {
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null
    );

    const textNodes: Text[] = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    const searchLower = searchText.toLowerCase();
    const words = searchLower.split(/\s+/).filter(w => w.length > 0);
    let firstMatch: HTMLElement | null = null;

    for (const textNode of textNodes) {
      const text = textNode.textContent || '';
      const textLower = text.toLowerCase();

      // Check if any word matches
      for (const word of words) {
        const index = textLower.indexOf(word);
        if (index !== -1) {
          // Create a range for the match
          const range = document.createRange();
          range.setStart(textNode, index);
          range.setEnd(textNode, index + word.length);

          // Create a highlight span
          const mark = document.createElement('mark');
          mark.className = highlightClass;
          mark.style.backgroundColor = '#fef08a'; // amber-200
          mark.style.padding = '0 2px';
          mark.style.borderRadius = '2px';
          mark.style.boxShadow = '0 0 0 1px rgba(251, 191, 36, 0.3)'; // subtle glow

          try {
            range.surroundContents(mark);
            if (!firstMatch) {
              firstMatch = mark;
            }
          } catch {
            // Range may cross element boundaries, skip this match
          }

          break; // Only highlight first occurrence per text node
        }
      }
    }

    return firstMatch;
  }, [highlightClass]);

  // Main effect to perform highlighting
  useEffect(() => {
    if (!highlightQuery || hasHighlighted.current) return;

    const timer = setTimeout(() => {
      // Clear any existing highlights first
      clearHighlights();

      // Find the container to search in
      const container = options.containerRef?.current || document.body;

      // Highlight the text
      const firstMatch = highlightText(container, highlightQuery);

      // Scroll to the first match
      if (firstMatch) {
        firstMatch.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });

        // Add a pulse animation to draw attention
        firstMatch.style.animation = 'pulse 1s ease-in-out 2';
      }

      hasHighlighted.current = true;
    }, delay);

    return () => clearTimeout(timer);
  }, [highlightQuery, delay, options.containerRef, clearHighlights, highlightText]);

  // Clear highlights when URL changes (navigating away)
  useEffect(() => {
    return () => {
      clearHighlights();
      hasHighlighted.current = false;
    };
  }, [clearHighlights]);

  return {
    highlightQuery,
    clearHighlights
  };
}
