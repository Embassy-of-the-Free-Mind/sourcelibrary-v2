export interface TextSegment {
  text: string;
  highlight: boolean;
}

/**
 * Normalize text for matching: NFD decompose, strip diacritics, lowercase.
 * Does NOT trim — preserving position alignment with the character mapping.
 */
function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Split text into segments based on query matches.
 * Uses diacritic-aware matching so "durer" highlights "Dürer".
 * Returns segments suitable for rendering with React (no HTML injection).
 */
export function splitByMatches(text: string, query: string): TextSegment[] {
  if (!text || !query || query.trim().length === 0) {
    return [{ text, highlight: false }];
  }

  const words = query.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) {
    return [{ text, highlight: false }];
  }

  // Use non-trimming normalize to keep position alignment with the mapping
  const normalizedText = normalizeForMatch(text);

  // Build a boolean mask of which character positions match
  const mask = new Array(text.length).fill(false);

  for (const word of words) {
    const normalizedWord = normalizeForMatch(word).trim();
    if (normalizedWord.length === 0) continue;

    // Map normalized positions back to original positions.
    const nfd = text.normalize('NFD');
    const nfdToOriginal: number[] = [];

    // Map NFD positions to original string positions
    let origIdx = 0;
    let nfdIdx = 0;
    while (origIdx < text.length) {
      const origChar = text[origIdx];
      const nfdSlice = origChar.normalize('NFD');
      for (let j = 0; j < nfdSlice.length; j++) {
        nfdToOriginal[nfdIdx + j] = origIdx;
      }
      nfdIdx += nfdSlice.length;
      origIdx++;
    }

    // Build mapping from normalized (stripped) positions to original positions
    const normalizedToOriginal: number[] = [];
    for (let i = 0; i < nfd.length; i++) {
      const code = nfd.charCodeAt(i);
      // Skip combining diacritical marks (U+0300 to U+036F)
      if (code >= 0x0300 && code <= 0x036F) continue;
      normalizedToOriginal.push(nfdToOriginal[i]);
    }

    // Find all occurrences of normalizedWord in normalizedText
    let searchFrom = 0;
    while (searchFrom <= normalizedText.length - normalizedWord.length) {
      const pos = normalizedText.indexOf(normalizedWord, searchFrom);
      if (pos === -1) break;

      // Mark the corresponding original positions
      for (let i = pos; i < pos + normalizedWord.length; i++) {
        if (i < normalizedToOriginal.length) {
          const origPos = normalizedToOriginal[i];
          if (origPos !== undefined && origPos < text.length) {
            mask[origPos] = true;
          }
        }
      }

      searchFrom = pos + 1;
    }
  }

  // Convert mask to segments
  const segments: TextSegment[] = [];
  let currentHighlight = mask[0] || false;
  let currentStart = 0;

  for (let i = 1; i <= text.length; i++) {
    const isHighlight = i < text.length ? mask[i] : !currentHighlight; // Force flush at end
    if (isHighlight !== currentHighlight || i === text.length) {
      segments.push({
        text: text.slice(currentStart, i),
        highlight: currentHighlight,
      });
      currentStart = i;
      currentHighlight = isHighlight;
    }
  }

  return segments;
}
