/**
 * PRIOR ART: src/lib/sanitize-translation-tags.ts — this is its scripts-side twin (.mjs scripts
 * cannot import TS), same arrangement as strip-markup-tags.mjs. Keep the two identical;
 * tests/unit/annotation-tag-repair.test.ts pins parity. scripts/maintenance/fix-unclosed-note-tags.mjs
 * carried a third inline copy; it now imports this one.
 *
 * Repairs the annotation-tag mistakes the model makes (#5644):
 * 1. Malformed closing tags: </note. or </note, → </note>
 * 2. Wrong closing tag: <note>...</term> → <note>...</note>
 * 3. Nested notes: <note>...<note>... → <note>...</note> <note>...
 * 4. Unclosed tags before <summary>/<keywords>/<meta>, a blank line, or end-of-text → auto-close
 *
 * Why it exists: the scripts-side sanitizeTranslationTags (translate-core.mjs) — the one every
 * script translation writer runs, the chained batch lane included — closed only line-level
 * margin/gloss/term tags and never repaired <note>. 79 pages of the Tibetan run (#4523) were
 * written with an unclosed or malformed <note>, so translated text sat inside a note and
 * vanished when a reader turned notes off. The app side (src/lib/ai.ts) had this repair all along.
 */

export const ANNOTATION_TAGS = ['note', 'margin', 'gloss', 'insert', 'unclear', 'term', 'image-desc'];

export function repairAnnotationTags(text) {
  let result = text;

  // 1. Fix malformed closing tags: </note. </note, </note; </note) → </note>
  //    Also handles </margin. etc.
  for (const tag of ANNOTATION_TAGS) {
    const malformed = new RegExp(`</${tag}([^>])`, 'gi');
    result = result.replace(malformed, (match, trailing) => {
      // If trailing char is a letter, this might be a different tag — skip
      if (/[a-z]/i.test(trailing)) return match;
      return `</${tag}>${trailing}`;
    });
  }

  // 2. Fix wrong closing tags: <note>content</term> → <note>content</note>
  //    When an opening tag is closed by a different annotation tag name.
  for (const openTag of ANNOTATION_TAGS) {
    for (const closeTag of ANNOTATION_TAGS) {
      if (openTag === closeTag) continue;
      // Match <openTag>content</closeTag> where content has no other tags
      const wrongClose = new RegExp(
        `(<${openTag}>)([^<]*?)(</${closeTag}>)`,
        'gi'
      );
      result = result.replace(wrongClose, `$1$2</${openTag}>`);
    }
  }

  // 3. Fix nested notes and unclosed tags using a stack-based approach
  result = fixUnclosedTags(result);

  return result;
}

function fixUnclosedTags(text) {
  // Build a list of all annotation tag positions
  const tagPattern = new RegExp(
    `<(/?)(?:${ANNOTATION_TAGS.join('|')})>`,
    'gi'
  );

  const tags = [];
  let m;
  while ((m = tagPattern.exec(text)) !== null) {
    tags.push({
      index: m.index,
      length: m[0].length,
      isClose: m[1] === '/',
      name: m[0].replace(/<\/?/g, '').replace(/>/, '').toLowerCase(),
    });
  }

  if (tags.length === 0) return text;

  // Track which opens are unmatched
  const insertions = [];

  // Process each tag type independently
  for (const tagName of ANNOTATION_TAGS) {
    const typeTags = tags.filter(t => t.name === tagName);
    const openStack = [];

    for (const tag of typeTags) {
      if (!tag.isClose) {
        // Opening tag — if there's already one open (nested), close the previous first
        if (openStack.length > 0 && tagName === 'note') {
          // Insert </note> just before this new <note>
          insertions.push({ index: tag.index, text: `</${tagName}>` });
          openStack.pop();
        }
        openStack.push(tag);
      } else {
        // Closing tag
        if (openStack.length > 0) {
          openStack.pop();
        }
        // Extra close with no open — leave it, NotesRenderer handles gracefully
      }
    }

    // Any remaining unclosed tags: close them
    for (const unclosed of openStack) {
      // Find the best insertion point: before next block-level element, <summary>, or end of text
      const afterTag = unclosed.index + unclosed.length;
      const remainder = text.substring(afterTag);

      // Look for natural break points
      const breakPoints = [
        remainder.search(/<summary>/i),
        remainder.search(/<keywords>/i),
        remainder.search(/<meta>/i),
        remainder.search(/\n\n/),
      ].filter(i => i >= 0);

      let insertAt;
      if (breakPoints.length > 0) {
        insertAt = afterTag + Math.min(...breakPoints);
      } else {
        // Close at end of text
        insertAt = text.length;
      }

      insertions.push({ index: insertAt, text: `</${tagName}>` });
    }
  }

  if (insertions.length === 0) return text;

  // Apply insertions from end to start so indices stay valid
  insertions.sort((a, b) => b.index - a.index);
  let result = text;
  for (const ins of insertions) {
    result = result.slice(0, ins.index) + ins.text + result.slice(ins.index);
  }

  return result;
}
