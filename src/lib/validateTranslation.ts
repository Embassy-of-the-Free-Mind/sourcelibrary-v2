/**
 * Validation for translation/OCR text formatting
 * Detects issues like unclosed brackets, unknown tags, etc.
 */

export interface ValidationIssue {
  type: 'unclosed_open' | 'unclosed_close' | 'unknown_tag' | 'empty_tag' | 'nested_bracket' | 'unbalanced_center';
  message: string;
  position: number;
  length: number;
  context: string;
  suggestedFix?: {
    type: 'insert' | 'delete' | 'replace';
    position: number;
    text?: string;
    length?: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

// Known valid tag types
const VALID_TAGS = new Set([
  'margin', 'note', 'notes', 'gloss', 'insert', 'unclear', 'term', 'image',
  'meta', 'language', 'page number', 'header', 'signature', 'vocabulary',
  'summary', 'keywords', 'warning', 'folio', 'abbrev', 'markup'
]);

/**
 * Extract context around a position in text
 */
function getContext(text: string, position: number, length: number = 0): string {
  const contextRadius = 30;
  const start = Math.max(0, position - contextRadius);
  const end = Math.min(text.length, position + length + contextRadius);

  let context = '';
  if (start > 0) context += '...';
  context += text.slice(start, end);
  if (end < text.length) context += '...';

  return context;
}

/**
 * Validate translation/OCR text for formatting issues
 */
export function validateTranslation(text: string): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!text) {
    return { valid: true, issues: [] };
  }

  // Track bracket positions for matching
  const openBrackets: number[] = [];
  let i = 0;

  while (i < text.length) {
    // Check for opening brackets [[
    if (text[i] === '[' && text[i + 1] === '[') {
      // Check for nested brackets (already inside a tag)
      if (openBrackets.length > 0) {
        issues.push({
          type: 'nested_bracket',
          message: 'Nested brackets detected - brackets inside another tag',
          position: i,
          length: 2,
          context: getContext(text, i, 2),
          suggestedFix: {
            type: 'delete',
            position: i,
            length: 2
          }
        });
      }
      openBrackets.push(i);
      i += 2;
      continue;
    }

    // Check for closing brackets ]]
    if (text[i] === ']' && text[i + 1] === ']') {
      if (openBrackets.length === 0) {
        // Closing without opening
        issues.push({
          type: 'unclosed_close',
          message: 'Closing ]] without matching opening [[',
          position: i,
          length: 2,
          context: getContext(text, i, 2),
          suggestedFix: {
            type: 'delete',
            position: i,
            length: 2
          }
        });
      } else {
        const openPos = openBrackets.pop()!;
        const tagContent = text.slice(openPos + 2, i);

        // Check for valid tag format: [[type: content]]
        const colonIndex = tagContent.indexOf(':');
        if (colonIndex > 0) {
          const tagType = tagContent.slice(0, colonIndex).trim().toLowerCase();
          const tagValue = tagContent.slice(colonIndex + 1).trim();

          // Check if tag type is known
          if (!VALID_TAGS.has(tagType)) {
            issues.push({
              type: 'unknown_tag',
              message: `Unknown tag type: "${tagType}"`,
              position: openPos,
              length: i + 2 - openPos,
              context: getContext(text, openPos, i + 2 - openPos)
              // No automatic fix for unknown tags - might be intentional
            });
          }

          // Check for empty tag content
          if (!tagValue) {
            issues.push({
              type: 'empty_tag',
              message: `Empty tag content for [[${tagType}:]]`,
              position: openPos,
              length: i + 2 - openPos,
              context: getContext(text, openPos, i + 2 - openPos),
              suggestedFix: {
                type: 'delete',
                position: openPos,
                length: i + 2 - openPos
              }
            });
          }
        }
      }
      i += 2;
      continue;
    }

    i++;
  }

  // Check for unclosed opening brackets
  for (const openPos of openBrackets) {
    // Try to find where the content ends (next paragraph or end of text)
    const afterOpen = text.slice(openPos + 2);
    const nextParagraph = afterOpen.indexOf('\n\n');
    const suggestedInsertPos = nextParagraph > 0
      ? openPos + 2 + nextParagraph
      : text.length;

    issues.push({
      type: 'unclosed_open',
      message: 'Opening [[ without matching closing ]]',
      position: openPos,
      length: 2,
      context: getContext(text, openPos, Math.min(50, text.length - openPos)),
      suggestedFix: {
        type: 'insert',
        position: suggestedInsertPos,
        text: ']]'
      }
    });
  }

  // Check for unbalanced centering markers
  const centerOpenRegex = /->/g;
  const centerCloseRegex = /<-/g;

  const openMatches = [...text.matchAll(centerOpenRegex)];
  const closeMatches = [...text.matchAll(centerCloseRegex)];

  // Simple check: count should match
  if (openMatches.length !== closeMatches.length) {
    // Find unmatched markers
    let openIdx = 0;
    let closeIdx = 0;

    while (openIdx < openMatches.length || closeIdx < closeMatches.length) {
      const openPos = openIdx < openMatches.length ? openMatches[openIdx].index! : Infinity;
      const closePos = closeIdx < closeMatches.length ? closeMatches[closeIdx].index! : Infinity;

      if (closePos < openPos && closeIdx < closeMatches.length) {
        // Close before open - orphan close
        issues.push({
          type: 'unbalanced_center',
          message: 'Closing <- without matching opening ->',
          position: closePos,
          length: 2,
          context: getContext(text, closePos, 2),
          suggestedFix: {
            type: 'delete',
            position: closePos,
            length: 2
          }
        });
        closeIdx++;
      } else if (openIdx < openMatches.length) {
        // Check if there's a matching close after this open
        const nextClose = closeMatches.find(m => m.index! > openPos);
        if (!nextClose || (openIdx + 1 < openMatches.length && openMatches[openIdx + 1].index! < nextClose.index!)) {
          // No matching close, or another open before the close
          issues.push({
            type: 'unbalanced_center',
            message: 'Opening -> without matching closing <-',
            position: openPos,
            length: 2,
            context: getContext(text, openPos, 2),
            suggestedFix: {
              type: 'delete',
              position: openPos,
              length: 2
            }
          });
        }
        openIdx++;
        if (nextClose) closeIdx++;
      } else {
        break;
      }
    }
  }

  // Sort issues by position
  issues.sort((a, b) => a.position - b.position);

  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Apply a suggested fix to text
 */
export function applyFix(
  text: string,
  fix: { type: 'insert' | 'delete' | 'replace'; position: number; text?: string; length?: number }
): string {
  switch (fix.type) {
    case 'insert':
      return text.slice(0, fix.position) + (fix.text || '') + text.slice(fix.position);
    case 'delete':
      return text.slice(0, fix.position) + text.slice(fix.position + (fix.length || 0));
    case 'replace':
      return text.slice(0, fix.position) + (fix.text || '') + text.slice(fix.position + (fix.length || 0));
    default:
      return text;
  }
}
