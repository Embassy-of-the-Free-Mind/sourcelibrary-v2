'use client';

// PRIOR ART: src/app/vision/VisionView.tsx — /vision?edit renders from a content.ts file, so its
// JSON maps straight back onto fields. This is the drop-in version for pages whose prose lives
// inline in JSX: add <PageEditMode /> to the page, open it with ?edit, and every block of text
// becomes editable. Copy JSON exports { original, edited } pairs plus comments; the session that
// receives it applies each pair to the source by finding the original text. Nothing is saved
// server-side; a draft survives a reload in this browser only (localStorage, best effort).

import { useEffect, useRef, useState } from 'react';

type Comment = { excerpt: string; text: string };
type Edit = { original: string; edited: string };
type Draft = { edits: Record<number, string>; comments: Comment[] };

const TEXT_TAGS = 'p, li, h1, h2, h3, h4, figcaption, dt, dd, td, th, blockquote, div, span';
const SKIP = 'nav, footer, header nav, [data-edit-toolbar], script, style, svg';
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

// Leaf-most blocks that carry their own text: an element with a non-empty direct text node,
// not inside another chosen element. Inline children (links, <strong>) stay part of their block.
function pickBlocks(root: Element): HTMLElement[] {
  const picked: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>(TEXT_TAGS).forEach((el) => {
    if (el.closest(SKIP)) return;
    if (picked.some((p) => p.contains(el))) return;
    const ownText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && norm(n.textContent || ''));
    if (ownText) picked.push(el);
  });
  return picked;
}

export default function PageEditMode() {
  const [on, setOn] = useState(false);
  const [changed, setChanged] = useState(0);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draftComment, setDraftComment] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const blocks = useRef<HTMLElement[]>([]);
  const originals = useRef<string[]>([]);
  const active = useRef<HTMLElement | null>(null);
  const key = typeof window === 'undefined' ? '' : `page-edit:${window.location.pathname}`;

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('edit')) return;
    setOn(true);
    const root = document.querySelector('main') ?? document.body;
    const els = pickBlocks(root);
    blocks.current = els;
    originals.current = els.map((el) => norm(el.innerText));

    let draft: Draft | null = null;
    try { draft = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* storage unavailable */ }

    const count = () => setChanged(els.filter((el, i) => norm(el.innerText) !== originals.current[i]).length);
    els.forEach((el, i) => {
      if (draft?.edits?.[i] !== undefined) el.innerText = draft.edits[i];
      el.contentEditable = 'true';
      el.spellcheck = true;
      el.classList.add('outline-dashed', 'outline-1', 'outline-amber-300', 'focus:outline-amber-600', 'rounded-sm');
      el.addEventListener('focus', () => { active.current = el; });
      el.addEventListener('input', count);
    });
    if (draft?.comments) setComments(draft.comments);
    count();
  }, [key]);

  const collect = (): Edit[] =>
    blocks.current
      .map((el, i) => ({ original: originals.current[i], edited: norm(el.innerText) }))
      .filter((e) => e.original !== e.edited);

  // Save the draft whenever something changes, so a reload or a stray click does not lose work.
  useEffect(() => {
    if (!on) return;
    const save = () => {
      const edits: Record<number, string> = {};
      blocks.current.forEach((el, i) => { if (norm(el.innerText) !== originals.current[i]) edits[i] = el.innerText; });
      try { localStorage.setItem(key, JSON.stringify({ edits, comments })); } catch { /* storage unavailable */ }
    };
    save();
    const t = setInterval(save, 3000);
    return () => clearInterval(t);
  }, [on, comments, changed, key]);

  if (!on) return null;

  const copy = async () => {
    const out = JSON.stringify({ page: window.location.pathname, edits: collect(), comments }, null, 2);
    try { await navigator.clipboard.writeText(out); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };
  const reset = () => {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
    window.location.reload();
  };
  const saveComment = () => {
    if (draftComment && draftComment.trim()) {
      const excerpt = norm(active.current?.innerText || '').slice(0, 80) || '(whole page)';
      setComments((c) => [...c, { excerpt, text: draftComment.trim() }]);
    }
    setDraftComment(null);
  };

  const btn = 'rounded-sm px-3 py-1.5 text-sm font-medium';
  return (
    <div data-edit-toolbar className="fixed inset-x-0 bottom-0 z-50 border-t border-stone-300 bg-white/95 backdrop-blur px-4 py-3 font-body shadow-lg">
      <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-2">
        <span className="text-sm text-stone-600 mr-auto">
          Edit mode: change any text, or click into a paragraph and add a comment. {changed} changed · {comments.length} comments.
        </span>
        {draftComment === null ? (
          <button type="button" className={`${btn} border border-stone-300 text-stone-800`} onMouseDown={(e) => e.preventDefault()} onClick={() => setDraftComment('')}>
            Add comment
          </button>
        ) : (
          <span className="flex gap-2 w-full md:w-auto">
            <input
              autoFocus
              className="flex-1 md:w-80 border border-stone-300 rounded-sm px-2 py-1 text-sm"
              placeholder={`On: ${norm(active.current?.innerText || 'the whole page').slice(0, 40)}…`}
              value={draftComment}
              onChange={(e) => setDraftComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveComment(); if (e.key === 'Escape') setDraftComment(null); }}
            />
            <button type="button" className={`${btn} bg-stone-800 text-white`} onClick={saveComment}>Save</button>
          </span>
        )}
        <button type="button" className={`${btn} bg-amber-700 text-white`} onClick={copy}>{copied ? 'Copied' : 'Copy JSON'}</button>
        <button type="button" className={`${btn} text-stone-500`} onClick={reset}>Reset</button>
      </div>
      {comments.length > 0 && (
        <ul className="max-w-5xl mx-auto mt-2 text-xs text-stone-600 space-y-0.5 max-h-24 overflow-y-auto">
          {comments.map((c, i) => (
            <li key={i}><span className="text-stone-400">“{c.excerpt.slice(0, 50)}…”</span> {c.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
