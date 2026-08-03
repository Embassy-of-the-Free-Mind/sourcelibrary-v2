'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Shared chrome for any field holding authored prose.
 *
 * Every place in the app where someone writes prose for a reader — a collection
 * intro, a museum description, a newsletter — had grown its own bare
 * <textarea>: no word count, no way to see it as the reader will, no signal
 * that there were unsaved changes. Six surfaces, six slightly different
 * behaviours, none of them wrong enough to fix on its own.
 *
 * This supplies the chrome and leaves the control and the save button to the
 * caller, which is what lets it drop into forms that already work. It is
 * deliberately NOT a rich-text editor: outside the newsletter, every one of
 * these fields stores PLAIN TEXT that React renders (collection intros are
 * `split('\n\n')` into paragraphs). Formatting marks typed into them would
 * reach the reader as literal angle brackets, so `format="html"` exists only
 * for the newsletter, and only to make the word count skip tags.
 *
 * Autosave is opt-in via `onSave`. Surfaces with an explicit Save button keep
 * it — silently converting a deliberate save into an automatic one changes
 * what a half-finished edit means, which is not a decision this component
 * should make on a caller's behalf.
 */

const WORD_RE = /\S+/g;

export function toPlainText(value: string, format: 'plain' | 'html'): string {
  if (format !== 'html') return value;
  return value
    // Drop comments first: an editorial note in a body file is not the letter.
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countParagraphs(value: string, format: 'plain' | 'html'): number {
  if (format === 'html') return (value.match(/<p[\s>]/gi) || []).length;
  return value.split(/\n{2,}/).filter((p) => p.trim()).length;
}

export default function ProseField({
  label,
  help,
  value,
  onChange,
  savedValue,
  onSave,
  autosaveMs = 1500,
  format = 'plain',
  renderPreview,
  children,
  rows = 4,
  inputClassName = '',
  placeholder,
  id,
}: {
  label?: string;
  help?: string;
  value: string;
  onChange: (next: string) => void;
  /** Last persisted value. Supply it to get an unsaved-changes indicator. */
  savedValue?: string;
  /** Supply to enable autosave. Omit on forms that have their own Save button. */
  onSave?: (value: string) => Promise<void> | void;
  autosaveMs?: number;
  format?: 'plain' | 'html';
  /** Render the value as the reader will see it. Omit to hide the preview toggle. */
  renderPreview?: (value: string) => React.ReactNode;
  /** A custom control (e.g. the newsletter editor). Falls back to a textarea. */
  children?: React.ReactNode;
  rows?: number;
  inputClassName?: string;
  placeholder?: string;
  id?: string;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string | null>(savedValue ?? null);

  const stats = useMemo(() => {
    const plain = toPlainText(value, format);
    return {
      words: (plain.match(WORD_RE) || []).length,
      paras: countParagraphs(value, format),
    };
  }, [value, format]);

  const dirty = savedValue !== undefined && value !== savedValue;

  const flush = useCallback(
    async (next: string) => {
      if (!onSave) return;
      setStatus('saving');
      try {
        await onSave(next);
        lastSaved.current = next;
        setStatus('saved');
      } catch {
        // Leave the text alone and say so — a failed autosave that silently
        // reverts is how people lose work without noticing.
        setStatus('error');
      }
    },
    [onSave],
  );

  useEffect(() => {
    if (!onSave) return;
    if (value === lastSaved.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(value), autosaveMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, onSave, autosaveMs, flush]);

  const statusText =
    status === 'saving'
      ? 'Saving…'
      : status === 'error'
        ? 'Not saved — try again'
        : status === 'saved'
          ? 'Saved'
          : dirty
            ? 'Unsaved changes'
            : '';

  const preview = renderPreview ?? (format === 'plain' ? defaultPlainPreview : undefined);

  return (
    <div>
      {(label || preview) && (
        <div className="flex items-baseline justify-between gap-3 mb-1">
          {label ? (
            <label htmlFor={id} className="block text-xs font-medium opacity-70">
              {label}
            </label>
          ) : (
            <span />
          )}
          {preview && (
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="text-xs underline underline-offset-2 opacity-60 hover:opacity-100 transition-opacity"
            >
              {showPreview ? 'Edit' : 'Preview as reader'}
            </button>
          )}
        </div>
      )}

      {showPreview && preview ? (
        <div className="px-3 py-2 rounded-lg border border-current/15 opacity-90">
          {preview(value)}
        </div>
      ) : children ? (
        children
      ) : (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className={inputClassName}
        />
      )}

      <div className="flex items-baseline justify-between gap-3 mt-1 text-xs opacity-55">
        <span>{help}</span>
        <span className="whitespace-nowrap tabular-nums">
          {statusText && <span className="mr-2">{statusText}</span>}
          {stats.words} {stats.words === 1 ? 'word' : 'words'}
          {stats.paras > 1 && ` · ${stats.paras} paras`}
        </span>
      </div>
    </div>
  );
}

/**
 * Mirrors how plain-text prose is actually rendered to readers across the site:
 * blank-line-separated blocks become paragraphs. Keep this in step with the
 * consumers (collection pages do `.split('\n\n')`) — if they diverge, the
 * preview stops being a preview.
 */
function defaultPlainPreview(value: string): React.ReactNode {
  const paras = value.split(/\n{2,}/).filter((p) => p.trim());
  if (!paras.length) return <p className="italic opacity-50">Nothing to preview yet.</p>;
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {paras.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}
