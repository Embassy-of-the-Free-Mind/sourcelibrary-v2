/**
 * Iconclass top-level divisions and curated sub-categories.
 * Shared between the subject browser and gallery filter.
 */

export interface IconclassCategory {
  code: string;
  label: string;
  icon: string;
}

export interface IconclassSubCategory {
  code: string;
  label: string;
}

export const ICONCLASS_DIVISIONS: IconclassCategory[] = [
  { code: '0', label: 'Abstract Art', icon: '◇' },
  { code: '1', label: 'Religion & Magic', icon: '✦' },
  { code: '2', label: 'Nature', icon: '❧' },
  { code: '3', label: 'Human Figure', icon: '☉' },
  { code: '4', label: 'Society & Culture', icon: '⚙' },
  { code: '5', label: 'Ideas & Concepts', icon: '◈' },
  { code: '6', label: 'History', icon: '⏳' },
  { code: '7', label: 'Bible', icon: '✝' },
  { code: '8', label: 'Literature', icon: '📜' },
  { code: '9', label: 'Classical Mythology', icon: '⚡' },
];

export const ICONCLASS_SUB_CATEGORIES: Record<string, IconclassSubCategory[]> = {
  '1': [
    { code: '11H', label: 'Saints' },
    { code: '12', label: 'Non-Christian Religions' },
    { code: '14', label: 'Astrology & Prophecy' },
  ],
  '2': [
    { code: '21', label: 'Elements' },
    { code: '22', label: 'Natural Phenomena' },
    { code: '25F', label: 'Animals' },
    { code: '25FF', label: 'Fabulous Creatures' },
    { code: '25G', label: 'Plants & Trees' },
  ],
  '3': [
    { code: '31A', label: 'Nude Figure' },
    { code: '31A1', label: 'Proportions' },
  ],
  '4': [
    { code: '41', label: 'Domestic Life' },
    { code: '44', label: 'Government' },
    { code: '48A98', label: 'Writing & Calligraphy' },
    { code: '48C', label: 'Emblems & Allegories' },
    { code: '49C', label: 'Chemistry' },
    { code: '49E39', label: 'Alchemy' },
    { code: '49E393', label: 'Alchemical Equipment' },
  ],
  '5': [
    { code: '52', label: 'Knowledge & Learning' },
    { code: '53', label: 'Astrology in Practice' },
  ],
  '7': [
    { code: '71', label: 'Old Testament' },
    { code: '73', label: 'New Testament' },
  ],
  '9': [
    { code: '92', label: 'Classical Gods' },
    { code: '95', label: 'Greek History' },
    { code: '97', label: 'Metamorphoses (Ovid)' },
  ],
};

/** Get the label for a code from our curated lists, or null if unknown. */
export function getIconclassLabel(code: string): string | null {
  const div = ICONCLASS_DIVISIONS.find(d => d.code === code);
  if (div) return div.label;
  for (const subs of Object.values(ICONCLASS_SUB_CATEGORIES)) {
    const sub = subs.find(s => s.code === code);
    if (sub) return sub.label;
  }
  return null;
}

/** Get the parent code for a given code. Returns null for top-level. */
export function getParentCode(code: string): string | null {
  if (code.length <= 1) return null;
  // Try progressively shorter prefixes against our known categories
  for (let i = code.length - 1; i >= 1; i--) {
    const prefix = code.slice(0, i);
    if (ICONCLASS_DIVISIONS.some(d => d.code === prefix)) return prefix;
    for (const subs of Object.values(ICONCLASS_SUB_CATEGORIES)) {
      if (subs.some(s => s.code === prefix)) return prefix;
    }
  }
  // Default: first character is the top-level division
  return code[0];
}

/** Build breadcrumb path from a code. */
export function buildIconclassPath(code: string): Array<{ code: string; label: string }> {
  const path: Array<{ code: string; label: string }> = [];
  // Always start with the top-level division
  const divCode = code[0];
  const div = ICONCLASS_DIVISIONS.find(d => d.code === divCode);
  if (div) path.push({ code: div.code, label: div.label });

  // Add intermediate levels if they exist in our curated list
  if (code.length > 1) {
    for (const sub of ICONCLASS_SUB_CATEGORIES[divCode] || []) {
      if (code.startsWith(sub.code) && sub.code !== code) {
        path.push({ code: sub.code, label: sub.label });
      }
    }
  }

  return path;
}
