'use client';

/**
 * Edit-and-comment overlay for a static page (#5583). Mounted through
 * EditOverlayGate, which loads this file only when the URL carries ?edit.
 *
 * It walks the target element's DOM, makes every prose block (headings,
 * paragraphs, list items, captions, table cells) contentEditable, and records
 * each change against the block's original text. Nothing is sent anywhere:
 * work autosaves to localStorage, and the reviewer exports one JSON —
 *   { page, commit, exported_at, edits: [{ id, section, original, edited }],
 *     comments: [{ id, section, excerpt, text }] }
 * where `id` is `<section>.<index in section>.<hash of original>`. Applying it
 * to the page source is the edit-on-page skill (.claude/skills/edit-on-page).
 *
 * The page's own content is a server render; React never re-renders those
 * nodes on the client, so editing them in place is safe.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Edit = { section: string; original: string; edited: string };
type Comment = { id: string; section: string; excerpt: string; text: string };
type Block = { id: string; section: string; el: HTMLElement; html: string; original: string };
type Export = {
  page: string;
  commit: string | null;
  exported_at: string;
  edits: ({ id: string } & Edit)[];
  comments: Comment[];
};

const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,figcaption,td,th,dt,dd';
// A block holding any of these is a figure or a control, not prose: leave it alone.
const NOT_PROSE = 'svg,img,canvas,video,iframe,input,textarea,select,button';

/** FNV-1a, base 36: a short stable fingerprint of a block's original text. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The block's text as the reviewer sees it: footnote markers dropped, typed line breaks kept. */
function blockText(el: Node): string {
  const walk = (node: Node): string => {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue ?? '';
      else if (n instanceof Element) {
        if (n.hasAttribute('data-edit-skip')) return;
        if (n.tagName === 'BR') out += '\n';
        else if (n.tagName === 'DIV' || n.tagName === 'P') out += '\n' + walk(n);
        else out += walk(n);
      }
    });
    return out;
  };
  return walk(el)
    .replace(/[ \t\r ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sectionKey(sec: Element | null, i: number): string {
  if (!sec) return 'top';
  if (sec.id) return sec.id.replace(/^s(\d+)$/, '$1');
  const heading = sec.querySelector('h1,h2,h3,h4');
  const slug = (heading?.textContent ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `section-${i}`;
}

function collectBlocks(root: HTMLElement): Block[] {
  const sections = Array.from(root.querySelectorAll('section'));
  const counters = new Map<string, number>();
  const out: Block[] = [];
  root.querySelectorAll<HTMLElement>(BLOCKS).forEach((el) => {
    if (el.closest('svg') || el.querySelector(BLOCKS) || el.querySelector(NOT_PROSE)) return;
    // Footnote markers stay put and out of the text.
    el.querySelectorAll('sup').forEach((s) => {
      s.setAttribute('data-edit-skip', '');
      s.setAttribute('contenteditable', 'false');
    });
    const original = blockText(el);
    if (!original) return;
    const sec = el.closest('section');
    const section = sectionKey(sec, sec ? sections.indexOf(sec) : -1);
    const idx = counters.get(section) ?? 0;
    counters.set(section, idx + 1);
    out.push({ id: `${section}.${idx}.${hash(original)}`, section, el, html: el.innerHTML, original });
  });
  return out;
}

const btn = 'px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-sm whitespace-nowrap';
const btnPrimary = 'px-3 py-1.5 rounded bg-accent-rust hover:bg-accent-rust/90 text-sm font-semibold whitespace-nowrap';

export default function EditOverlay({
  target,
  commit,
  email,
}: {
  target: string;
  commit?: string;
  email: string;
}) {
  const blocksRef = useRef<Map<string, Block>>(new Map());
  const rootRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef<{ id: string; selection: string } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const [ready, setReady] = useState(false);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [comments, setComments] = useState<Comment[]>([]);
  const [saved, setSaved] = useState<'yes' | 'no' | null>(null);
  const [panel, setPanel] = useState<null | 'paste' | { comment: number | 'new' }>(null);
  const [commentTarget, setCommentTarget] = useState<{ id: string; excerpt: string } | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [copied, setCopied] = useState(false);
  const [markers, setMarkers] = useState<{ i: number; top: number; left: number }[]>([]);

  const storageKey = useRef('');

  /** Put the DOM back to the server render, then lay `next` over it. Returns the edits re-keyed to blocks found. */
  const applyEdits = useCallback((next: Record<string, Edit>) => {
    const blocks = blocksRef.current;
    blocks.forEach((b) => {
      if (b.el.innerHTML !== b.html) b.el.innerHTML = b.html;
    });
    const placed: Record<string, Edit> = {};
    for (const [id, e] of Object.entries(next)) {
      let b = blocks.get(id);
      // The page may have changed since the JSON was made: fall back to the original text.
      if (!b) b = Array.from(blocks.values()).find((x) => x.original === e.original);
      if (b) {
        b.el.innerText = e.edited;
        placed[b.id] = { ...e, section: b.section };
      } else {
        placed[id] = e; // kept and exported, never dropped
      }
    }
    return placed;
  }, []);

  // ── Activate: mark blocks editable, wire listeners, restore saved work ──
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(target);
    if (!root) return;
    rootRef.current = root;
    const blocks = collectBlocks(root);
    blocksRef.current = new Map(blocks.map((b) => [b.id, b]));
    for (const b of blocks) {
      b.el.setAttribute('data-edit-id', b.id);
      b.el.setAttribute('contenteditable', 'true');
      b.el.setAttribute('spellcheck', 'true');
    }

    const blockOf = (n: Node | null) =>
      (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>('[data-edit-id]') ?? null;

    const onInput = (e: Event) => {
      const el = blockOf(e.target as Node);
      const b = el && blocksRef.current.get(el.dataset.editId!);
      if (!b) return;
      const text = blockText(b.el);
      setEdits((prev) => {
        const next = { ...prev };
        if (text === b.original) delete next[b.id];
        else next[b.id] = { section: b.section, original: b.original, edited: text };
        return next;
      });
    };
    // Links inside an editable block must not navigate (Next's <Link> would).
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest('a') && blockOf(t)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Paste as plain text so foreign markup never enters the page.
    const onPaste = (e: ClipboardEvent) => {
      if (!blockOf(e.target as Node)) return;
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
    };
    // Remember the last block (and selection) the reviewer was in, so pressing
    // a toolbar button does not lose it.
    const onSelection = () => {
      const sel = document.getSelection();
      const el = blockOf(sel?.anchorNode ?? null);
      if (!el) return;
      activeRef.current = { id: el.dataset.editId!, selection: sel?.toString().trim() ?? '' };
    };

    root.addEventListener('input', onInput);
    root.addEventListener('click', onClick, true);
    root.addEventListener('paste', onPaste);
    document.addEventListener('selectionchange', onSelection);

    storageKey.current = `edit-overlay:v1:${window.location.pathname}`;
    try {
      const raw = window.localStorage.getItem(storageKey.current);
      if (raw) {
        const s = JSON.parse(raw) as { edits?: Record<string, Edit>; comments?: Comment[] };
        setEdits(applyEdits(s.edits ?? {}));
        setComments(Array.isArray(s.comments) ? s.comments : []);
      }
    } catch {
      /* unreadable storage: start clean, the toolbar will say whether saving works */
    }
    setReady(true);

    return () => {
      root.removeEventListener('input', onInput);
      root.removeEventListener('click', onClick, true);
      root.removeEventListener('paste', onPaste);
      document.removeEventListener('selectionchange', onSelection);
      for (const b of blocks) {
        b.el.removeAttribute('data-edit-id');
        b.el.removeAttribute('contenteditable');
        b.el.removeAttribute('spellcheck');
      }
    };
  }, [target, applyEdits]);

  // ── Autosave ──
  useEffect(() => {
    if (!ready) return;
    try {
      if (Object.keys(edits).length || comments.length) {
        window.localStorage.setItem(storageKey.current, JSON.stringify({ edits, comments }));
      } else {
        window.localStorage.removeItem(storageKey.current);
      }
      setSaved('yes');
    } catch {
      setSaved('no');
    }
  }, [edits, comments, ready]);

  // ── Keep the page clear of the fixed toolbar ──
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const prev = document.body.style.paddingBottom;
    const ro = new ResizeObserver(() => {
      document.body.style.paddingBottom = `${el.offsetHeight + 16}px`;
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.body.style.paddingBottom = prev;
    };
  }, [ready]);

  // ── Margin markers: one per comment, beside its block ──
  const layoutMarkers = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const perBlock = new Map<string, number>();
    const out: { i: number; top: number; left: number }[] = [];
    comments.forEach((c, i) => {
      const b = blocksRef.current.get(c.id);
      if (!b) return;
      const n = perBlock.get(c.id) ?? 0;
      perBlock.set(c.id, n + 1);
      const br = b.el.getBoundingClientRect();
      let left = r.right + 12 + n * 26;
      if (left + 24 > width) left = r.right - 28 - n * 26;
      out.push({ i, top: br.top + window.scrollY, left: left + window.scrollX });
    });
    setMarkers(out);
  }, [comments]);

  useLayoutEffect(() => {
    layoutMarkers();
  }, [layoutMarkers, edits]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => layoutMarkers());
    ro.observe(root);
    window.addEventListener('resize', layoutMarkers);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', layoutMarkers);
    };
  }, [layoutMarkers, ready]);

  // Blocks with a comment get a gold outline.
  useEffect(() => {
    const ids = new Set(comments.map((c) => c.id));
    blocksRef.current.forEach((b) => {
      if (ids.has(b.id)) b.el.setAttribute('data-edit-commented', '');
      else b.el.removeAttribute('data-edit-commented');
    });
  }, [comments, ready]);

  // ── Actions ──
  const buildExport = (): Export => ({
    page: window.location.pathname,
    commit: commit || null,
    exported_at: new Date().toISOString(),
    edits: Object.entries(edits).map(([id, e]) => ({ id, ...e })),
    comments,
  });

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildExport(), null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const doDownload = () => {
    const data = buildExport();
    const slug = data.page.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'page';
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}-edits-${data.exported_at.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const doLoad = () => {
    try {
      const data = JSON.parse(pasteText) as Partial<Export>;
      if (!data || typeof data !== 'object' || !Array.isArray(data.edits) || !Array.isArray(data.comments)) {
        throw new Error('That JSON has no edits/comments lists. Paste the whole file this page exported.');
      }
      if (data.page && data.page !== window.location.pathname) {
        throw new Error(`That JSON is for ${data.page}, not this page.`);
      }
      const next: Record<string, Edit> = {};
      for (const e of data.edits) {
        if (e && typeof e.id === 'string' && typeof e.edited === 'string') {
          next[e.id] = { section: String(e.section ?? ''), original: String(e.original ?? ''), edited: e.edited };
        }
      }
      setEdits(applyEdits(next));
      setComments(data.comments.filter((c) => c && typeof c.id === 'string' && typeof c.text === 'string'));
      setPanel(null);
      setPasteText('');
      setPasteError('');
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : 'Invalid JSON.');
    }
  };

  const doReset = () => {
    const n = Object.keys(edits).length + comments.length;
    if (n && !window.confirm(`Discard ${Object.keys(edits).length} edits and ${comments.length} comments and return to the published text?`)) return;
    applyEdits({});
    setEdits({});
    setComments([]);
    setPanel(null);
  };

  const openNewComment = () => {
    const a = activeRef.current;
    const b = a && blocksRef.current.get(a.id);
    if (b) {
      const text = blockText(b.el);
      setCommentTarget({ id: b.id, excerpt: (a.selection || text).slice(0, 200) });
    } else {
      setCommentTarget(null);
    }
    setCommentDraft('');
    setPanel({ comment: 'new' });
  };

  const openComment = (i: number) => {
    const c = comments[i];
    setCommentTarget({ id: c.id, excerpt: c.excerpt });
    setCommentDraft(c.text);
    setPanel({ comment: i });
  };

  const saveComment = () => {
    const text = commentDraft.trim();
    if (!commentTarget || !text || !panel || panel === 'paste') return;
    const b = blocksRef.current.get(commentTarget.id);
    if (panel.comment === 'new') {
      setComments((cs) => [...cs, { id: commentTarget.id, section: b?.section ?? '', excerpt: commentTarget.excerpt, text }]);
    } else {
      const i = panel.comment;
      setComments((cs) => cs.map((c, j) => (j === i ? { ...c, text } : c)));
    }
    setPanel(null);
    setCommentDraft('');
  };

  const deleteComment = (i: number) => {
    setComments((cs) => cs.filter((_, j) => j !== i));
    setPanel(null);
  };

  if (!ready) return null;

  const nEdits = Object.keys(edits).length;
  const unplaced = Object.keys(edits).filter((id) => !blocksRef.current.has(id)).length;
  const commentPanel = panel && panel !== 'paste' ? panel : null;

  return createPortal(
    <>
      <style>{`
        [data-edit-id] { outline: none; border-radius: 2px; cursor: text; transition: background-color .15s; }
        [data-edit-id]:hover { background-color: color-mix(in srgb, var(--accent-gold) 12%, transparent); }
        [data-edit-id]:focus { background-color: color-mix(in srgb, var(--accent-gold) 8%, white); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-rust) 40%, transparent); }
        [data-edit-commented] { box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-gold) 80%, transparent); }
      `}</style>

      {markers.map((m) => (
        <button
          key={m.i}
          onClick={() => openComment(m.i)}
          title={comments[m.i]?.text}
          aria-label={`Comment ${m.i + 1}`}
          style={{ position: 'absolute', top: m.top, left: m.left, zIndex: 40 }}
          className="w-6 h-6 rounded-full bg-accent-gold text-[#2a1f17] text-xs font-semibold shadow hover:bg-accent-rust hover:text-white"
        >
          {m.i + 1}
        </button>
      ))}

      <div
        ref={toolbarRef}
        className="fixed bottom-0 inset-x-0 z-50 bg-[#2a1f17] text-white border-t border-white/10 shadow-[0_-4px_20px_rgba(0,0,0,0.25)]"
      >
        {panel === 'paste' && (
          <div className="max-w-[var(--container-wide)] mx-auto px-6 py-4 border-b border-white/10">
            <label className="block text-xs uppercase tracking-widest text-white/60 mb-2">
              Paste a JSON this page exported, to pick up where it left off
            </label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              autoFocus
              className="w-full rounded bg-black/30 border border-white/15 p-3 font-mono text-xs text-white/90 focus:outline-none focus:ring-2 focus:ring-accent-rust/50"
              placeholder='{ "page": "...", "edits": [ ... ], "comments": [ ... ] }'
            />
            {pasteError && <p className="text-red-300 text-sm mt-2">{pasteError}</p>}
            <div className="flex gap-3 mt-3">
              <button onClick={doLoad} className={btnPrimary}>
                Load
              </button>
              <button
                onClick={() => {
                  setPanel(null);
                  setPasteError('');
                }}
                className={btn}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {commentPanel && (
          <div className="max-w-[var(--container-wide)] mx-auto px-6 py-4 border-b border-white/10">
            <label className="block text-xs uppercase tracking-widest text-white/60 mb-2">
              {commentTarget ? (
                <>
                  {commentPanel.comment === 'new' ? 'Comment on' : `Comment ${(commentPanel.comment as number) + 1} on`}{' '}
                  <span className="text-white/90 normal-case tracking-normal">
                    “{commentTarget.excerpt.length > 120 ? `${commentTarget.excerpt.slice(0, 120)}…` : commentTarget.excerpt}”
                  </span>
                </>
              ) : (
                'Click into a paragraph or select some text first, then press Add comment'
              )}
            </label>
            {commentTarget && (
              <>
                <textarea
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  rows={3}
                  autoFocus
                  className="w-full rounded bg-black/30 border border-white/15 p-3 text-sm text-white/90 focus:outline-none focus:ring-2 focus:ring-accent-rust/50"
                  placeholder="Your comment"
                />
                <div className="flex gap-3 mt-3">
                  <button onClick={saveComment} disabled={!commentDraft.trim()} className={`${btnPrimary} disabled:opacity-40`}>
                    Save comment
                  </button>
                  <button onClick={() => setPanel(null)} className={btn}>
                    Cancel
                  </button>
                  {commentPanel.comment !== 'new' && (
                    <button onClick={() => deleteComment(commentPanel.comment as number)} className={`${btn} ml-auto`}>
                      Delete comment
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div className="max-w-[var(--container-wide)] mx-auto px-6 py-3 flex items-center gap-x-4 gap-y-2 flex-wrap">
          <div className="text-sm leading-snug">
            <div>
              <span className="font-semibold">Edit mode</span>
              <span className="text-white/70">
                {' '}· {nEdits} {nEdits === 1 ? 'edit' : 'edits'} · {comments.length} {comments.length === 1 ? 'comment' : 'comments'} ·{' '}
                {saved === 'no' ? (
                  <span className="text-red-300">Not saved in this browser: download the JSON before leaving</span>
                ) : (
                  'Saved in this browser'
                )}
                {unplaced > 0 && <span className="text-red-300"> · {unplaced} not found on this page (kept in the JSON)</span>}
              </span>
            </div>
            <div className="text-white/60 select-text">
              Click any text to change it. Email the JSON to <span className="text-white select-all">{email}</span>
            </div>
          </div>
          <div className="flex-1" />
          <button onClick={openNewComment} className={btn}>
            Add comment
          </button>
          <button onClick={doCopy} className={btnPrimary}>
            {copied ? 'Copied ✓' : 'Copy JSON'}
          </button>
          <button onClick={doDownload} className={btnPrimary}>
            Download JSON
          </button>
          <button onClick={() => setPanel((p) => (p === 'paste' ? null : 'paste'))} className={btn}>
            Paste JSON
          </button>
          <button onClick={doReset} className={btn}>
            Reset
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
