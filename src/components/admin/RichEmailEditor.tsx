'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bold, Italic, Link2, Heading, Pilcrow, Code2, Eye } from 'lucide-react';

/**
 * Edit a newsletter body as formatted text instead of as raw HTML.
 *
 * The admin composer stored the body in a plain <textarea>, so writing a letter
 * meant reading angle brackets. This renders the same HTML in a contentEditable
 * pane styled like the email itself (cream ground, Georgia, 520px column), and
 * keeps a raw-HTML mode alongside it — you need that mode to paste a letter in
 * from the repo, and to fix anything the rich pane cannot express.
 *
 * `value` stays the single source of truth in both modes, so Save Draft,
 * Preview and Send are unchanged: they still receive body HTML.
 *
 * Two things here are load-bearing and easy to "simplify" into bugs:
 *
 *   1. innerHTML is written ONLY when `value` changed somewhere other than this
 *      editor (loading a draft, or an edit made in HTML mode). Writing it on
 *      every render puts the caret back at the top of the document on every
 *      keystroke, which makes the editor unusable in a way that looks like a
 *      browser bug. `lastEmitted` is what distinguishes our own output from a
 *      genuine external change.
 *   2. Paste inserts PLAIN TEXT in rich mode. Pasting from Word, Docs or a
 *      browser carries a payload of <span class=...> and font tags that survive
 *      into the sent email and render differently in every client. Anyone who
 *      genuinely wants to paste markup switches to HTML mode, which is explicit.
 */
export default function RichEmailEditor({
  value,
  onChange,
  minHeight = 420,
  idPrefix = 'email',
}: {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
  idPrefix?: string;
}) {
  const [mode, setMode] = useState<'rich' | 'html'>('rich');
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    if (mode !== 'rich') return;
    const el = ref.current;
    if (!el || value === lastEmitted.current) return;
    el.innerHTML = value;
    lastEmitted.current = value;
  }, [value, mode]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    lastEmitted.current = el.innerHTML;
    onChange(el.innerHTML);
  }, [onChange]);

  // execCommand is deprecated but is still the only cross-browser way to apply
  // formatting to a selection inside contentEditable. The alternative is a full
  // document model, which is not worth it for an internal composer.
  const exec = useCallback(
    (command: string, arg?: string) => {
      ref.current?.focus();
      document.execCommand(command, false, arg);
      emit();
    },
    [emit],
  );

  const insertLink = useCallback(() => {
    const url = window.prompt('Link URL');
    if (!url) return;
    exec('createLink', url);
  }, [exec]);

  // The letter's section headings are styled <p> rather than <h2>: mail clients
  // apply their own margins to real headings, and the shell's type scale is set
  // inline. Match what the body files already use.
  const insertHeading = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString() || 'Section heading';
    exec(
      'insertHTML',
      `<p style="margin: 0 0 24px; font-size: 20px; font-family: Georgia, serif;">${text}</p>`,
    );
  }, [exec]);

  const insertParagraph = useCallback(() => {
    exec('insertHTML', '<p style="margin: 0 0 20px;">New paragraph</p>');
  }, [exec]);

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;
      const html = text
        .split(/\n{2,}/)
        .map((para) => {
          const escaped = para
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br />');
          return `<p style="margin: 0 0 20px;">${escaped}</p>`;
        })
        .join('');
      exec('insertHTML', html);
    },
    [exec],
  );

  const btn =
    'p-1.5 rounded text-stone-300 hover:bg-stone-700 hover:text-white transition-colors';

  return (
    <div className="rounded border border-stone-700 overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1.5 bg-stone-800 border-b border-stone-700">
        {mode === 'rich' && (
          <>
            <button type="button" onClick={() => exec('bold')} className={btn} title="Bold" aria-label="Bold">
              <Bold className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => exec('italic')} className={btn} title="Italic" aria-label="Italic">
              <Italic className="w-4 h-4" />
            </button>
            <button type="button" onClick={insertLink} className={btn} title="Link" aria-label="Insert link">
              <Link2 className="w-4 h-4" />
            </button>
            <span className="w-px h-4 bg-stone-700 mx-1" />
            <button type="button" onClick={insertHeading} className={btn} title="Section heading" aria-label="Insert section heading">
              <Heading className="w-4 h-4" />
            </button>
            <button type="button" onClick={insertParagraph} className={btn} title="Paragraph" aria-label="Insert paragraph">
              <Pilcrow className="w-4 h-4" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setMode(mode === 'rich' ? 'html' : 'rich')}
          className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded text-xs text-stone-300 hover:bg-stone-700 hover:text-white transition-colors"
        >
          {mode === 'rich' ? <Code2 className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {mode === 'rich' ? 'Edit HTML' : 'Edit formatted'}
        </button>
      </div>

      {mode === 'rich' ? (
        <div
          id={`${idPrefix}-rich`}
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          onPaste={onPaste}
          role="textbox"
          aria-multiline="true"
          aria-label="Email body"
          className="px-6 py-5 overflow-y-auto focus:outline-none focus:ring-1 focus:ring-accent-gold"
          style={{
            minHeight,
            maxHeight: 640,
            background: '#fdfcf9',
            color: '#1a1612',
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontSize: 15,
            lineHeight: 1.7,
          }}
        />
      ) : (
        <textarea
          id={`${idPrefix}-html`}
          value={value}
          onChange={(e) => {
            lastEmitted.current = null;
            onChange(e.target.value);
          }}
          placeholder="<p>Your email content...</p>"
          aria-label="Email body HTML"
          className="w-full bg-stone-800 px-3 py-2 text-sm font-mono text-stone-200 focus:outline-none"
          style={{ minHeight, maxHeight: 640 }}
        />
      )}
    </div>
  );
}
