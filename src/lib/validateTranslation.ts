/**
 * Validation for translation/OCR text formatting
 * Detects issues like unclosed brackets, unknown tags, etc.
 */

export interface ValidationIssue {
  type: 'unclosed_open' | 'unclosed_close' | 'unknown_tag' | 'empty_tag' | 'nested_bracket' | 'unbalanced_center' | 'unclosed_xml' | 'unknown_xml_tag' | 'empty_xml_tag';
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

// Known valid tag types (bracket syntax)
const VALID_TAGS = new Set([
  'margin', 'note', 'notes', 'gloss', 'insert', 'unclear', 'term', 'image',
  'meta', 'language', 'page number', 'header', 'signature', 'vocabulary',
  'summary', 'keywords', 'warning', 'folio', 'abbrev', 'markup'
]);

// Known valid XML tag types (new syntax)
const VALID_XML_TAGS = new Set([
  // Display annotations
  'note', 'margin', 'gloss', 'insert', 'unclear', 'term', 'image-desc',
  // Metadata tags
  'lang', 'page-num', 'folio', 'sig', 'header', 'meta', 'warning',
  'abbrev', 'vocab', 'summary', 'keywords'
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

  // === XML Tag Validation ===
  // Find all XML-style opening and closing tags
  const xmlOpenPattern = /<([a-z][a-z0-9-]*)>/gi;
  const xmlClosePattern = /<\/([a-z][a-z0-9-]*)>/gi;

  const openTags: { tag: string; position: number }[] = [];
  const closeTags: { tag: string; position: number }[] = [];

  let xmlMatch;
  while ((xmlMatch = xmlOpenPattern.exec(text)) !== null) {
    const tag = xmlMatch[1].toLowerCase();
    openTags.push({ tag, position: xmlMatch.index });
  }

  while ((xmlMatch = xmlClosePattern.exec(text)) !== null) {
    const tag = xmlMatch[1].toLowerCase();
    closeTags.push({ tag, position: xmlMatch.index });
  }

  // Check for unknown XML tags
  for (const { tag, position } of openTags) {
    if (!VALID_XML_TAGS.has(tag)) {
      issues.push({
        type: 'unknown_xml_tag',
        message: `Unknown XML tag: <${tag}>`,
        position,
        length: tag.length + 2,
        context: getContext(text, position, tag.length + 2)
      });
    }
  }

  // Check for unclosed XML tags (simple stack-based matching)
  const tagStack: { tag: string; position: number }[] = [];
  const allTags = [
    ...openTags.map(t => ({ ...t, type: 'open' as const })),
    ...closeTags.map(t => ({ ...t, type: 'close' as const }))
  ].sort((a, b) => a.position - b.position);

  for (const tagInfo of allTags) {
    if (tagInfo.type === 'open') {
      tagStack.push({ tag: tagInfo.tag, position: tagInfo.position });
    } else {
      // Close tag - find matching open
      const matchIdx = tagStack.findIndex(t => t.tag === tagInfo.tag);
      if (matchIdx === -1) {
        // Closing tag without matching opening
        issues.push({
          type: 'unclosed_xml',
          message: `Closing </${tagInfo.tag}> without matching opening <${tagInfo.tag}>`,
          position: tagInfo.position,
          length: tagInfo.tag.length + 3,
          context: getContext(text, tagInfo.position, tagInfo.tag.length + 3),
          suggestedFix: {
            type: 'delete',
            position: tagInfo.position,
            length: tagInfo.tag.length + 3
          }
        });
      } else {
        // Check for empty content (opening tag immediately followed by closing)
        const openPos = tagStack[matchIdx].position;
        const openEnd = openPos + tagInfo.tag.length + 2;
        const content = text.slice(openEnd, tagInfo.position).trim();
        if (!content) {
          issues.push({
            type: 'empty_xml_tag',
            message: `Empty XML tag: <${tagInfo.tag}></${tagInfo.tag}>`,
            position: openPos,
            length: tagInfo.position + tagInfo.tag.length + 3 - openPos,
            context: getContext(text, openPos, tagInfo.position + tagInfo.tag.length + 3 - openPos),
            suggestedFix: {
              type: 'delete',
              position: openPos,
              length: tagInfo.position + tagInfo.tag.length + 3 - openPos
            }
          });
        }
        // Remove from stack (and any unclosed tags between)
        tagStack.splice(matchIdx, 1);
      }
    }
  }

  // Report any unclosed opening tags
  for (const { tag, position } of tagStack) {
    issues.push({
      type: 'unclosed_xml',
      message: `Opening <${tag}> without matching closing </${tag}>`,
      position,
      length: tag.length + 2,
      context: getContext(text, position, 50),
      suggestedFix: {
        type: 'insert',
        position: text.length,
        text: `</${tag}>`
      }
    });
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

/**
 * Clean up empty tags from text
 * Removes patterns like [[unclear:]], [[note: ]], [[margin:]], <note></note>, etc.
 * Returns the cleaned text and count of removed tags
 */
export function cleanupEmptyTags(text: string): { cleaned: string; removedCount: number } {
  if (!text) {
    return { cleaned: text, removedCount: 0 };
  }

  let removedCount = 0;

  // Match [[tagname:]] or [[tagname: ]] (empty or whitespace-only content)
  // The regex matches: [[ + word characters + : + optional whitespace + ]]
  const emptyBracketPattern = /\[\[\w+:\s*\]\]/g;

  let cleaned = text.replace(emptyBracketPattern, () => {
    removedCount++;
    return '';
  });

  // Match <tagname></tagname> or <tagname> </tagname> (empty or whitespace-only content)
  const emptyXmlPattern = /<([a-z][a-z0-9-]*)>\s*<\/\1>/gi;

  cleaned = cleaned.replace(emptyXmlPattern, () => {
    removedCount++;
    return '';
  });

  // Clean up any double spaces or trailing spaces left behind
  const finalCleaned = cleaned
    .replace(/  +/g, ' ')  // Collapse multiple spaces
    .replace(/ +\n/g, '\n')  // Remove trailing spaces before newlines
    .replace(/\n +/g, '\n');  // Remove leading spaces after newlines (but preserve indentation in code blocks)

  return { cleaned: finalCleaned, removedCount };
}
