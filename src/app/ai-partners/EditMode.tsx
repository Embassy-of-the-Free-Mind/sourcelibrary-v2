'use client';

// /ai-partners?edit — Derek edits the copy in place and leaves comments, then copies the
// changes as JSON for a session to apply to content.ts. Nothing is saved server-side; a
// draft is kept in this browser's localStorage until Reset. Without ?edit this renders nothing.
// PRIOR ART: the retired /vision edit mode (#5252) — same idea, but this page is one HTML string,
// so edits are diffed per block (paragraph, heading, list item, cell) instead of per field.

import { useEffect, useRef, useState } from 'react';

type Comment = { id: number; excerpt: string; section: string; text: string };
type Change = { key: string; section: string; before: string | null; after: string | null };

const STORE = 'ai-partners-edit-v1';
const BLOCKS = 'h1,h2,h3,p,li,td,th,figcaption,dt,dd,a.primary';

// Blocks of the HTML string only. React sections rendered between the HTML parts
// (page.tsx, data-island) are not copy in content.ts, so they are never diffed.
function blocks(el: HTMLElement): Element[] {
  return Array.from(el.querySelectorAll(BLOCKS)).filter((b) => !b.closest('[data-island]'));
}

function root(): HTMLElement | null {
  return document.querySelector('main.ai-partners');
}

function sectionOf(el: Element | null): string {
  const s = el?.closest('section, nav');
  if (!s) return '';
  const h = s.querySelector('h1, h2');
  return (h?.textContent || s.id || '').trim().slice(0, 80);
}

// Inner HTML of a block with comment highlights unwrapped and nested block keys removed,
// so neither a comment nor a key on an inner block reads as an edit.
function cleanHTML(el: Element): string {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('mark.ap-c').forEach((m) => m.replaceWith(...Array.from(m.childNodes)));
  c.querySelectorAll('[data-k]').forEach((n) => n.removeAttribute('data-k'));
  return c.innerHTML.replace(/\s+/g, ' ').trim();
}

function load(): { html?: string; comments?: Comment[] } {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}');
  } catch {
    return {};
  }
}

function save(html: string, comments: Comment[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ html, comments }));
  } catch {
    /* private window: the draft simply is not kept */
  }
}

export default function EditMode() {
  const [on, setOn] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState<{ excerpt: string; section: string } | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const original = useRef<Map<string, { html: string; section: string }>>(new Map());
  const pendingRange = useRef<Range | null>(null);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('edit')) return;
    const el = root();
    if (!el) return;
    // Key every block on the pristine page, before any saved draft is restored.
    blocks(el).forEach((b, i) => {
      b.setAttribute('data-k', String(i));
      original.current.set(String(i), { html: cleanHTML(b), section: sectionOf(b) });
    });
    const saved = load();
    if (saved.html) el.innerHTML = saved.html;
    if (saved.comments) setComments(saved.comments);
    el.contentEditable = 'true';
    el.spellcheck = true;
    // Links must not navigate while editing.
    const stop = (e: MouseEvent) => {
      if ((e.target as Element).closest('a')) e.preventDefault();
    };
    el.addEventListener('click', stop);
    setOn(true);
    return () => el.removeEventListener('click', stop);
  }, []);

  useEffect(() => {
    if (!on) return;
    const el = root();
    if (!el) return;
    const onInput = () => save(el.innerHTML, comments);
    el.addEventListener('input', onInput);
    save(el.innerHTML, comments);
    return () => el.removeEventListener('input', onInput);
  }, [on, comments]);

  if (!on) return null;

  function startComment() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setStatus('Select some text first, then Add comment.');
      return;
    }
    const range = sel.getRangeAt(0);
    const start = range.startContainer.parentElement;
    if (!start || !root()?.contains(start)) {
      setStatus('Select text on the page.');
      return;
    }
    pendingRange.current = range.cloneRange();
    setDraft({ excerpt: sel.toString().trim().slice(0, 200), section: sectionOf(start) });
    setNote('');
    setStatus('');
  }

  function saveComment() {
    if (!draft || !note.trim()) return;
    const id = Date.now();
    const r = pendingRange.current;
    if (r) {
      try {
        const m = document.createElement('mark');
        m.className = 'ap-c';
        m.dataset.c = String(id);
        m.title = note.trim();
        r.surroundContents(m);
      } catch {
        /* selection spans blocks: keep the comment, skip the highlight */
      }
    }
    setComments((cs) => [...cs, { id, ...draft, text: note.trim() }]);
    setDraft(null);
    pendingRange.current = null;
  }

  function removeComment(id: number) {
    root()
      ?.querySelectorAll(`mark.ap-c[data-c="${id}"]`)
      .forEach((m) => m.replaceWith(...Array.from(m.childNodes)));
    setComments((cs) => cs.filter((c) => c.id !== id));
  }

  function changes(): Change[] {
    const el = root();
    if (!el) return [];
    const out: Change[] = [];
    const seen = new Set<string>();
    blocks(el).forEach((b) => {
      const k = b.getAttribute('data-k');
      const after = cleanHTML(b);
      if (k && !seen.has(k)) {
        seen.add(k);
        const o = original.current.get(k);
        if (o && o.html !== after) out.push({ key: k, section: o.section, before: o.html, after });
      } else if (after) {
        // A block typed by pressing Enter copies its neighbour's key, or has none.
        out.push({ key: `new after ${k ?? '?'}`, section: sectionOf(b), before: null, after });
      }
    });
    original.current.forEach((o, k) => {
      if (!seen.has(k)) out.push({ key: k, section: o.section, before: o.html, after: null });
    });
    return out;
  }

  async function copy() {
    const payload = {
      page: 'ai-partners',
      at: new Date().toISOString(),
      changes: changes(),
      comments: comments.map(({ excerpt, section, text }) => ({ section, excerpt, text })),
    };
    const json = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setStatus(`Copied: ${payload.changes.length} edits, ${payload.comments.length} comments. Paste into Claude.`);
    } catch {
      setStatus('Clipboard blocked: the JSON is in the console.');
      console.log(json);
    }
  }

  function reset() {
    try {
      localStorage.removeItem(STORE);
    } catch {
      /* nothing kept */
    }
    window.location.reload();
  }

  return (
    <aside className="ap-edit" contentEditable={false}>
      <style>{`
        .ap-edit{position:fixed;right:16px;bottom:16px;z-index:1000;width:min(340px,calc(100vw - 32px));
          max-height:70vh;overflow:auto;background:#fffdf8;color:#1d1a16;border:1px solid #c9bfae;
          border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.18);font:14px/1.4 system-ui,sans-serif;padding:12px}
        .ap-edit b{display:block;margin-bottom:6px}
        .ap-edit button{font:inherit;margin:0 6px 6px 0;padding:5px 10px;border:1px solid #8a7d68;border-radius:5px;background:#f3ede2;cursor:pointer}
        .ap-edit button.go{background:#1d1a16;color:#fffdf8}
        .ap-edit textarea{width:100%;min-height:70px;font:inherit;margin:6px 0}
        .ap-edit ol{padding-left:18px;margin:8px 0 0}
        .ap-edit li{margin-bottom:6px}
        .ap-edit q{color:#6b604f}
        .ap-edit .s{color:#6b604f;font-size:13px;margin-top:4px}
        main.ai-partners[contenteditable=true]{outline:2px dashed #c9a24a;outline-offset:-2px}
        mark.ap-c{background:#ffe58a;color:inherit}
      `}</style>
      <b>Editing this page</b>
      <div>
        <button onMouseDown={(e) => e.preventDefault()} onClick={startComment}>Add comment</button>
        <button className="go" onClick={copy}>Copy changes</button>
        <button onClick={reset}>Reset</button>
      </div>
      {draft && (
        <div>
          <q>{draft.excerpt}</q>
          <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Comment" />
          <button className="go" onClick={saveComment}>Save</button>
          <button onClick={() => setDraft(null)}>Cancel</button>
        </div>
      )}
      {status && <div className="s">{status}</div>}
      {comments.length > 0 && (
        <ol>
          {comments.map((c) => (
            <li key={c.id}>
              <q>{c.excerpt.slice(0, 60)}</q> {c.text}{' '}
              <button onClick={() => removeComment(c.id)}>×</button>
            </li>
          ))}
        </ol>
      )}
      <div className="s">Type straight onto the page. Your draft is kept in this browser until Reset.</div>
    </aside>
  );
}
