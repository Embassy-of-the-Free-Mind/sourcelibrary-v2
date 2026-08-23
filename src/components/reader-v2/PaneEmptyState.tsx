'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { AuthCheck } from '@/components/auth/AuthCheck';
import { useStableSession } from '@/hooks/useStableSession';
import { shouldShowTranslationRequestCta } from '@/lib/translation-request-cta';
import { useLocale } from '@/lib/i18n';
import { getReaderStrings } from '@/lib/reader-strings';
import type { Book, Page } from '@/lib/types';
import { CapsLabel } from './ReaderV2Bits';

// Restores the distinct empty states the old TranslationEditor pane had
// (src/components/pipeline/TranslationEditor.tsx, ~L2104-2239) that the v2
// redesign collapsed into one flat italic line for every role and every
// reason. See that file's comments for the incident history behind the
// wording choices reproduced here (#2835, #3653-adjacent — 704 visible
// books have no OCR at all, so "not transcribed" is a public-facing state,
// not an operator one).

const actionButtonClass =
  'inline-flex items-center gap-2 h-9 px-3 border font-sans text-[12.5px] transition-opacity hover:opacity-85 disabled:opacity-50';
const actionButtonStyle: React.CSSProperties = {
  background: 'var(--text-primary)',
  color: 'var(--bg-cream)',
  borderColor: 'var(--text-primary)',
};

function EmptyPane({
  label,
  body,
  children,
}: {
  label: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="font-sans text-[13px] max-w-xs" style={{ color: 'var(--text-secondary)' }}>
      <CapsLabel className="block mb-1.5" style={{ color: 'var(--text-muted)' }}>
        {label}
      </CapsLabel>
      <p className="mb-3" style={{ color: 'var(--text-faint)' }}>
        {body}
      </p>
      {children}
    </div>
  );
}

/**
 * Empty-state content for one reader pane (OCR or translation) when that
 * pane has no text. Renders in place of ReaderProse's plain italic line.
 *
 * `kind: 'ocr'` — this page has no transcription yet.
 * `kind: 'translation'` — this page has no translation yet (which may be
 * because there's nothing to translate from, if OCR is also missing —
 * handled below by falling through to the same states as `kind: 'ocr'`).
 */
export function PaneEmptyState({ page, book, kind }: { page: Page; book: Book; kind: 'ocr' | 'translation' }) {
  const { data: sessionData } = useStableSession();
  const pathname = usePathname();
  const t = getReaderStrings(useLocale()).paneEmpty;
  const [requested, setRequested] = useState(false);
  const [sending, setSending] = useState(false);

  const sessionEmail = (sessionData?.user as { email?: string } | undefined)?.email || null;
  const ocrText = page.ocr?.data || '';

  // No transcription at all — public readers get plain, non-paywall-sounding
  // wording; editors (inner_circle+) get the operator wording, since they're
  // the ones who can act on it.
  if (kind === 'ocr' || !ocrText) {
    return (
      <AuthCheck
        role="inner_circle"
        fallback={
          <EmptyPane
            label={t.notTranscribed}
            body={t.notTranscribedBody}
          />
        }
      >
        <EmptyPane
          label="Complete OCR first"
          body="The original text needs to be transcribed before it can be translated."
        />
      </AuthCheck>
    );
  }

  // Blank pages: nothing to translate, and nothing to request either.
  if (page.page_type === 'blank') {
    return (
      <p className="font-sans text-[13px] italic" style={{ color: 'var(--text-faint)' }}>
        {t.blankPage}
      </p>
    );
  }

  // OCR done, translation missing. shouldShowTranslationRequestCta owns
  // whether asking for a translation makes sense right now (book already
  // ~fully translated, etc.) — honour it rather than re-deriving it here.
  const showCta = shouldShowTranslationRequestCta({
    ocrText,
    translationText: page.translation?.data,
    translationData: page.translation?.data,
    translationUpdatedAt: page.translation?.updated_at,
    modernizedText: page.modernized?.data,
    bookPagesTranslated: book.pages_translated,
    bookPagesCount: book.pages_count,
  });

  const requestTranslation = async () => {
    if (sending || requested) return; // one request per pane mount — no spamming the queue
    setSending(true);
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Translation requested for "${book.display_title || book.title}" (${book.language || 'unknown language'}) — page ${page.page_number}`,
          page: `/book/${book.id}/page/${page.id}`,
          email: sessionEmail && sessionEmail.includes('@') ? sessionEmail : null,
        }),
      });
    } catch {
      /* best effort, matches old reader's behaviour */
    }
    setSending(false);
    setRequested(true);
  };

  const headerBody = t.readyToTranslateBody;

  return (
    <AuthCheck
      role="inner_circle"
      fallback={
        <AuthCheck
          fallback={
            <EmptyPane label={t.readyToTranslate} body={headerBody}>
              {showCta ? (
                <a
                  href={`/auth/signin?callbackUrl=${encodeURIComponent(pathname || `/book/${book.id}/page/${page.id}`)}&reason=translation-request`}
                  className={actionButtonClass}
                  style={actionButtonStyle}
                >
                  {t.signInToRequest}
                </a>
              ) : null}
            </EmptyPane>
          }
        >
          <EmptyPane
            label={requested ? t.requested : t.readyToTranslate}
            body={
              requested
                ? sessionEmail
                  ? t.thanksWillEmail
                  : t.thanksWillPrioritise
                : headerBody
            }
          >
            {!requested && showCta ? (
              <button onClick={requestTranslation} disabled={sending} className={actionButtonClass} style={actionButtonStyle}>
                {sending ? t.sending : t.requestTranslation}
              </button>
            ) : null}
          </EmptyPane>
        </AuthCheck>
      }
    >
      {/*
        Editors: no live "Translate" button here. That action needs the
        mutation/processing plumbing (`handleProcess`, its status state,
        refresh-on-completion) that lives in TranslationEditor, which we
        cannot verify from a standalone new file without touching it. Point
        at the existing, working pipeline page instead of a dead end.

        English throughout, like the rest of the editor tooling — this branch
        renders for inner_circle and above only (.claude/docs/i18n.md).
      */}
      <EmptyPane
        label="Ready to translate"
        body="OCR is complete for this page. It has not been translated into English yet."
      >
        <a href={`/book/${book.id}/pipeline`} className={actionButtonClass} style={actionButtonStyle}>
          Open pipeline
        </a>
      </EmptyPane>
    </AuthCheck>
  );
}

export default PaneEmptyState;
