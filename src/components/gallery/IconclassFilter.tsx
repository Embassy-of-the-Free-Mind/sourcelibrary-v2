'use client';

import { useState } from 'react';

/**
 * Iconclass top-level categories for gallery filtering.
 * Only includes categories likely to appear in Source Library content.
 */
const ICONCLASS_CATEGORIES = [
  { code: '1', label: 'Religion & Magic', icon: '✦' },
  { code: '2', label: 'Nature', icon: '❧' },
  { code: '3', label: 'Human Figure', icon: '☉' },
  { code: '4', label: 'Society', icon: '⚙' },
  { code: '5', label: 'Ideas & Concepts', icon: '◈' },
  { code: '7', label: 'Bible', icon: '✝' },
  { code: '9', label: 'Classical Myth', icon: '⚡' },
] as const;

/**
 * Curated sub-categories for the most relevant Iconclass branches.
 * These appear when a top-level category is selected.
 */
const SUB_CATEGORIES: Record<string, Array<{ code: string; label: string }>> = {
  '1': [
    { code: '11H', label: 'Saints' },
    { code: '12', label: 'Non-Christian' },
    { code: '14', label: 'Astrology & Prophecy' },
  ],
  '2': [
    { code: '21', label: 'Elements' },
    { code: '25F', label: 'Animals' },
    { code: '25FF', label: 'Fabulous Creatures' },
    { code: '25G', label: 'Plants & Trees' },
  ],
  '3': [
    { code: '31A', label: 'Nude Figure' },
    { code: '31A1', label: 'Proportions' },
  ],
  '4': [
    { code: '48C', label: 'Emblems & Allegories' },
    { code: '49C', label: 'Chemistry' },
    { code: '49E39', label: 'Alchemy' },
  ],
  '7': [
    { code: '71', label: 'Old Testament' },
    { code: '73', label: 'New Testament' },
  ],
  '9': [
    { code: '92', label: 'Classical Gods' },
    { code: '95', label: 'Greek History' },
    { code: '97', label: 'Metamorphoses' },
  ],
};

interface IconclassFilterProps {
  value: string;
  onChange: (code: string) => void;
  compact?: boolean;
}

export default function IconclassFilter({ value, onChange, compact = false }: IconclassFilterProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const activeTopLevel = value ? ICONCLASS_CATEGORIES.find(c => value.startsWith(c.code)) : null;

  if (compact) {
    return (
      <div>
        <label className="block text-xs font-medium text-stone-500 mb-2">
          <a href="https://iconclass.org" target="_blank" rel="noopener noreferrer" className="hover:text-stone-700">
            Iconclass
          </a>
          {' '}Subject
        </label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2 py-1 text-sm border border-stone-300 rounded"
        >
          <option value="">All subjects</option>
          {ICONCLASS_CATEGORIES.map((cat) => (
            <optgroup key={cat.code} label={`${cat.label}`}>
              <option value={cat.code}>{cat.label} (all)</option>
              {(SUB_CATEGORIES[cat.code] || []).map((sub) => (
                <option key={sub.code} value={sub.code}>
                  {sub.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-stone-500 mb-2">Iconclass Subject</label>
      <div className="flex flex-wrap gap-1">
        {ICONCLASS_CATEGORIES.map((cat) => {
          const isActive = value.startsWith(cat.code);
          const hasSubActive = isActive && value !== cat.code;

          return (
            <div key={cat.code} className="relative">
              <button
                onClick={() => {
                  if (isActive && !hasSubActive) {
                    onChange('');
                    setExpanded(null);
                  } else {
                    onChange(cat.code);
                    setExpanded(expanded === cat.code ? null : cat.code);
                  }
                }}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  isActive
                    ? 'bg-stone-800 text-white border-stone-800'
                    : 'bg-white text-stone-600 border-stone-300 hover:border-stone-400'
                }`}
                title={`Iconclass ${cat.code}: ${cat.label}`}
              >
                {cat.label}
              </button>

              {/* Sub-categories dropdown */}
              {expanded === cat.code && SUB_CATEGORIES[cat.code] && (
                <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-stone-200 rounded-lg shadow-lg p-1.5 min-w-[160px]">
                  <button
                    onClick={() => { onChange(cat.code); setExpanded(null); }}
                    className={`w-full text-left px-2 py-1 text-xs rounded hover:bg-stone-50 ${
                      value === cat.code ? 'font-semibold' : ''
                    }`}
                  >
                    All {cat.label}
                  </button>
                  {SUB_CATEGORIES[cat.code].map((sub) => (
                    <button
                      key={sub.code}
                      onClick={() => { onChange(sub.code); setExpanded(null); }}
                      className={`w-full text-left px-2 py-1 text-xs rounded hover:bg-stone-50 ${
                        value === sub.code ? 'font-semibold' : ''
                      }`}
                    >
                      <span className="text-stone-400 font-mono mr-1">{sub.code}</span>
                      {sub.label}
                    </button>
                  ))}
                  <div className="border-t border-stone-100 mt-1 pt-1">
                    <a
                      href={`https://iconclass.org/${cat.code}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-2 py-1 text-[10px] text-stone-400 hover:text-stone-600"
                    >
                      Browse full tree on iconclass.org
                    </a>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {value && (
          <button
            onClick={() => { onChange(''); setExpanded(null); }}
            className="px-2 py-1 text-xs text-stone-400 hover:text-stone-600"
          >
            Clear
          </button>
        )}
      </div>

      {/* Show active code as linked badge */}
      {value && (
        <div className="flex items-center gap-2 mt-1.5">
          <a
            href={`https://iconclass.org/${encodeURIComponent(value)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-stone-500 hover:text-stone-700"
          >
            {value}
          </a>
          {activeTopLevel && value !== activeTopLevel.code && (
            <span className="text-xs text-stone-400">
              in {activeTopLevel.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
