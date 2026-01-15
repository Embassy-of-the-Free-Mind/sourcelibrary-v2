// Parse <note>...</note> from text (for extraction, not for hiding)
export function parseNotes(text: string): { content: string; notes: string[] } {
  // Support both old [[notes:...]] and new <note>...</note> syntax
  const bracketPattern = /\[\[notes?:\s*(.*?)\]\]/gi;
  const xmlPattern = /<note>([\s\S]*?)<\/note>/gi;
  const notes: string[] = [];

  let content = text.replace(bracketPattern, (match, noteContent) => {
    notes.push(noteContent.trim());
    return ''; // Remove from main content
  });

  content = content.replace(xmlPattern, (match, noteContent) => {
    notes.push(noteContent.trim());
    return ''; // Remove from main content
  });

  return { content: content.trim(), notes };
}

// Extract page number from <page-num>N</page-num> or [[page number: ####]]
export function extractPageNumber(text: string): number | null {
  // Try new XML syntax first
  const xmlMatch = text.match(/<page-num>(\d+)<\/page-num>/i);
  if (xmlMatch) return parseInt(xmlMatch[1], 10);

  // Fall back to old bracket syntax for backward compatibility
  const bracketMatch = text.match(/\[\[page\s*number:\s*(\d+)\]\]/i);
  return bracketMatch ? parseInt(bracketMatch[1], 10) : null;
}