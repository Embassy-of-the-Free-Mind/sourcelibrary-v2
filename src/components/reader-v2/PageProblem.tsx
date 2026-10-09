'use client';

/**
 * Two small things a reader of a translation needs from a page they cannot
 * check themselves (#5274 follow-up):
 *
 *  - `ReadCautionNote` — one quiet line above the English when the OCR itself
 *    said the page was hard to read (`pageReadCaution`). It is a property of
 *    the text, like `UnreliableTranscriptionNotice`, so it is not dismissible;
 *    and it is deliberately quieter than that notice, because it describes a
 *    page, not a whole script we cannot read. Good pages render nothing.
 *
 *  - `PageProblemReport` — "Report a problem with this page", under the
 *    English. One tap opens it in place (no modal, no navigation, the page stays
 *    in view); choosing a class is optional; sending needs no typing. It posts
 *    to /api/feedback with a structured `page_report`, which files a triage
 *    item and changes nothing on the page — reader reports are untrusted input.
 *    Choosing "The English is wrong here" (`translation_error`, #6120) adds three
 *    fields — the passage as it reads, the correction, the original words — and
 *    fills the first from the reader's text selection when there is one.
 *
 * Both are client-only and fetch nothing during render: the reader is an ISR
 * route, and the only network call here happens on the reader's click.
 */

import { useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { getReaderStrings } from '@/lib/reader-strings';
import { pageReadCaution, transcriptionReliability } from '@/lib/transcription-reliability';
import { PAGE_REPORT_KINDS, MAX_CORRECTION_FIELD, type PageReportKind } from '@/lib/page-report';
import { MAX_FEEDBACK_MESSAGE } from '@/lib/feedback-limits';
import type { Book, Page } from '@/lib/types';

export function ReadCautionNote({ page, book }: { page: Page; book: Book }) {
  const t = getReaderStrings(useLocale()).readCaution;
  // A "we cannot read this script" notice already covers the page; a second,
  // page-level line under it reads as boilerplate. A specialist-engine
  // `caution` is about the engine in general, so this page's own signal still shows.
  if (transcriptionReliability(book, page)?.level === 'unreliable') return null;
  if (!page.translation?.data || page.gated) return null;
  const caution = pageReadCaution(page);
  if (!caution) return null;
  return (
    <p
      className="mb-4 font-sans text-[12.5px] leading-snug pl-2.5 border-l-2"
      style={{ color: 'var(--text-secondary)', borderColor: 'rgba(158,74,58,0.45)' }}
      data-read-caution={caution.reason}
    >
      {caution.reason === 'unclear' ? t.unclear(caution.share) : t.damage}
    </p>
  );
}

const CHIP =
  'inline-flex items-center h-8 px-2.5 border font-sans text-[12.5px] lg:text-[12px] transition-colors';

export function PageProblemReport({ page, book }: { page: Page; book: Book }) {
  const t = getReaderStrings(useLocale()).pageReport;
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PageReportKind | null>(null);
  const [comment, setComment] = useState('');
  const [passage, setPassage] = useState('');
  const [correction, setCorrection] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  if (page.gated) return null;

  // What the reader had selected, if anything: usually the passage they mean.
  const selected = () =>
    typeof window === 'undefined' ? '' : (window.getSelection()?.toString() || '').trim().slice(0, MAX_CORRECTION_FIELD);

  function choose(k: PageReportKind | null) {
    setKind(k);
    if (k === 'translation_error' && !passage) setPassage(selected());
  }

  async function send() {
    if (state === 'sending') return;
    setState('sending');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: comment.trim().slice(0, MAX_FEEDBACK_MESSAGE - 200 - 3 * MAX_CORRECTION_FIELD),
          page: typeof window !== 'undefined' ? window.location.href : undefined,
          page_report: {
            book_id: book.id,
            page_id: page.id,
            page_number: page.page_number,
            kind,
            ...(kind === 'translation_error'
              ? { correction: { passage, correction, source_text: sourceText } }
              : {}),
          },
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState('sent');
    } catch {
      // Only claim it reached us when it did.
      setState('failed');
    }
  }

  const wrap = 'mt-10 pt-3 border-t font-sans';
  const wrapStyle = { borderColor: 'var(--border-light, rgba(0,0,0,0.08))' };

  if (state === 'sent') {
    return (
      <div className={wrap} style={wrapStyle}>
        <p className="text-[12.5px] flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }} role="status">
          <Check size={14} style={{ color: 'var(--accent-sage-dark)' }} />
          {t.thanks}
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <div className={wrap} style={wrapStyle}>
        <button
          type="button"
          onClick={() => { setPassage(selected()); setOpen(true); }}
          className="text-[12px] underline underline-offset-2 decoration-dotted hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
        >
          {t.open}
        </button>
      </div>
    );
  }

  return (
    <div className={wrap} style={wrapStyle} data-no-page-swipe="">
      <fieldset>
        <legend className="text-[12.5px] pb-2" style={{ color: 'var(--text-secondary)' }}>{t.prompt}</legend>
        <div className="flex flex-wrap gap-1.5">
          {PAGE_REPORT_KINDS.map(k => {
            const on = kind === k;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => choose(on ? null : k)}
                className={CHIP}
                style={on
                  ? { background: 'var(--text-primary)', color: 'var(--bg-cream)', borderColor: 'var(--text-primary)' }
                  : { background: 'transparent', color: 'var(--text-primary)', borderColor: 'var(--border-medium)' }}
              >
                {t.kinds[k]}
              </button>
            );
          })}
        </div>
      </fieldset>
      {kind === 'translation_error' && (
        <div className="mt-2.5 space-y-2">
          {([
            [t.passageLabel, passage, setPassage, 3],
            [t.correctionLabel, correction, setCorrection, 3],
            [t.sourceLabel, sourceText, setSourceText, 2],
          ] as const).map(([label, value, set, rows]) => (
            <label key={label} className="block">
              <span className="block text-[12px] pb-1" style={{ color: 'var(--text-secondary)' }}>{label}</span>
              <textarea
                value={value}
                onChange={e => set(e.target.value)}
                rows={rows}
                maxLength={MAX_CORRECTION_FIELD}
                className="w-full border px-2.5 py-1.5 text-[16px] lg:text-[13px] leading-snug outline-none focus:border-[var(--text-muted)] resize-y"
                style={{ borderColor: 'var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' }}
              />
            </label>
          ))}
        </div>
      )}
      <label className="block mt-2.5">
        <span className="sr-only">{t.commentPlaceholder}</span>
        <input
          type="text"
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder={t.commentPlaceholder}
          maxLength={2000}
          className="w-full border px-2.5 py-1.5 text-[16px] lg:text-[13px] outline-none focus:border-[var(--text-muted)]"
          style={{ borderColor: 'var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' }}
        />
      </label>
      <div className="flex items-center gap-3 pt-2.5">
        <button
          type="button"
          onClick={send}
          disabled={state === 'sending'}
          className="inline-flex items-center gap-2 h-8 px-3 border text-[12.5px] transition-opacity hover:opacity-85 disabled:opacity-45"
          style={{ background: 'var(--text-primary)', color: 'var(--bg-cream)', borderColor: 'var(--text-primary)' }}
        >
          {state === 'sending' && <Loader2 size={13} className="animate-spin" />}
          {state === 'sending' ? t.sending : t.send}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false); setKind(null); setComment(''); setState('idle');
            setPassage(''); setCorrection(''); setSourceText('');
          }}
          className="text-[12.5px] hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
        >
          {t.cancel}
        </button>
      </div>
      {state === 'failed' && (
        <p className="text-[12.5px] pt-2" style={{ color: 'var(--status-error)' }} role="alert">{t.failed}</p>
      )}
    </div>
  );
}
