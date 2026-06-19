'use client';

import { createElement, useRef, useState } from 'react';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import type { VisionContent } from './content';

// ── markdown-lite: **bold**, *italic*, [label](url) ──
function formatInline(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const label = m[1];
      const url = m[2];
      nodes.push(
        url.startsWith('/') ? (
          <Link key={key++} href={url} className="text-accent-rust hover:underline">
            {label}
          </Link>
        ) : (
          <a
            key={key++}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-rust hover:underline"
          >
            {label}
          </a>
        )
      );
    } else if (m[3] !== undefined) {
      nodes.push(
        <strong key={key++} className="text-primary">
          {m[3]}
        </strong>
      );
    } else if (m[4] !== undefined) {
      nodes.push(<em key={key++}>{m[4]}</em>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const HERO_GRADIENT =
  'linear-gradient(to top, rgba(26,22,18,0.94) 0%, rgba(26,22,18,0.75) 35%, rgba(26,22,18,0.35) 65%, rgba(26,22,18,0.15) 100%)';

function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

function setByPath(obj: unknown, path: string, value: string) {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

export default function VisionView({
  content: initial,
  editable,
}: {
  content: VisionContent;
  editable: boolean;
}) {
  const [content, setContent] = useState<VisionContent>(initial);
  const [version, setVersion] = useState(0);
  const draftRef = useRef<VisionContent>(clone(initial));
  const [copied, setCopied] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');

  const editClass = editable
    ? ' outline-none rounded-sm transition-colors cursor-text hover:bg-accent-gold/10 focus:bg-white focus:ring-2 focus:ring-accent-rust/40'
    : '';
  const editClassDark = editable
    ? ' outline-none rounded-sm transition-colors cursor-text hover:bg-white/10 focus:ring-2 focus:ring-white/60'
    : '';

  // Render one text node — read-only (formatted) or editable (raw, contentEditable).
  // Called as a function (NOT <F/>) so it returns host elements directly; a
  // version-based key lets a JSON paste remount fields while leaving in-progress
  // typing untouched on unrelated re-renders.
  const F = ({
    path,
    value,
    as = 'span',
    className = '',
    lang,
    dark = false,
  }: {
    path: string;
    value: string;
    as?: string;
    className?: string;
    lang?: string;
    dark?: boolean;
  }) => {
    if (!editable) {
      return createElement(as, { key: path, className, lang }, formatInline(value));
    }
    return createElement(
      as,
      {
        key: `${version}:${path}`,
        className: className + (dark ? editClassDark : editClass),
        lang,
        contentEditable: true,
        suppressContentEditableWarning: true,
        'data-path': path,
        onInput: (e: React.FormEvent<HTMLElement>) =>
          setByPath(draftRef.current, path, e.currentTarget.innerText),
      },
      value
    );
  };

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(draftRef.current, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const doLoad = () => {
    try {
      const parsed = JSON.parse(pasteText) as VisionContent;
      if (!parsed || typeof parsed !== 'object' || !parsed.hero || !parsed.plan) {
        throw new Error('That JSON does not look like vision content (missing hero/plan).');
      }
      setContent(parsed);
      draftRef.current = clone(parsed);
      setVersion((v) => v + 1);
      setShowPaste(false);
      setPasteText('');
      setPasteError('');
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : 'Invalid JSON.');
    }
  };

  const doReset = () => {
    setContent(initial);
    draftRef.current = clone(initial);
    setVersion((v) => v + 1);
  };

  return (
    <div className={`min-h-screen bg-cream${editable ? ' pb-28' : ''}`}>
      <SiteHeader variant="light" />

      {editable && (
        <div className="bg-accent-rust text-white text-sm text-center px-4 py-2">
          Edit mode — change any text below, then <strong>Copy JSON</strong> and send it to Derek.
          Nothing is saved automatically.
        </div>
      )}

      {/* ── Hero ── */}
      <div className="relative overflow-hidden text-white pt-16 pb-10 md:pt-24 md:pb-14 min-h-[260px] md:min-h-[340px] flex flex-col justify-end">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={content.hero.image}
          alt={content.hero.imageAlt}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0" style={{ background: HERO_GRADIENT }} />
        <div className="relative w-full max-w-[var(--container-wide)] mx-auto px-6 md:px-12">
          {F({
            as: 'h1',
            path: 'hero.title',
            value: content.hero.title,
            dark: true,
            className:
              'font-serif text-4xl md:text-5xl tracking-tight mb-4 drop-shadow-[0_2px_12px_rgba(0,0,0,0.4)]',
          })}
          {F({
            as: 'p',
            path: 'hero.subtitle',
            value: content.hero.subtitle,
            dark: true,
            className:
              'text-lg md:text-xl text-stone-300 max-w-2xl font-body leading-relaxed drop-shadow-[0_1px_6px_rgba(0,0,0,0.3)]',
          })}
        </div>
      </div>

      <main className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 py-12">
        {/* ── The letter ── */}
        <article className="font-body text-[1.0625rem] md:text-lg text-secondary leading-[1.8] max-w-[68ch]">
          {F({ as: 'p', path: 'dateline', value: content.dateline, className: 'font-serif italic text-muted mb-8' })}
          {F({ as: 'p', path: 'salutation', value: content.salutation, className: 'mb-6' })}

          <p className="mb-6">
            {F({
              as: 'span',
              path: 'lead',
              value: content.lead,
              className: 'font-serif text-primary text-xl md:text-2xl leading-snug',
            })}
          </p>

          {content.bodyBeforeQuote.map((p, i) =>
            F({ as: 'p', path: `bodyBeforeQuote.${i}`, value: p, className: 'mb-6' })
          )}

          {/* Pico pull-quote */}
          <figure className="my-12 pl-8 border-l-2 border-accent-rust">
            {F({
              as: 'blockquote',
              path: 'quote.en',
              value: content.quote.en,
              className: 'font-serif text-2xl md:text-[1.75rem] text-primary leading-snug',
            })}
            {F({
              as: 'p',
              path: 'quote.la',
              value: content.quote.la,
              lang: 'la',
              className: 'font-serif italic text-lg md:text-xl text-muted leading-snug mt-3',
            })}
            <figcaption className="mt-4 text-sm tracking-wide uppercase text-muted">
              {editable ? (
                <span>
                  {F({ as: 'span', path: 'quote.source', value: content.quote.source })} &mdash;{' '}
                  {F({ as: 'span', path: 'quote.linkLabel', value: content.quote.linkLabel })}
                </span>
              ) : (
                <a
                  href={content.quote.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent-rust underline"
                >
                  {formatInline(content.quote.source)} &mdash; {content.quote.linkLabel}
                </a>
              )}
            </figcaption>
          </figure>

          {content.bodyBeforeImage1.map((p, i) =>
            F({ as: 'p', path: `bodyBeforeImage1.${i}`, value: p, className: 'mb-6' })
          )}

          {/* Image 1 */}
          <figure className="my-12 -mx-2 md:-mx-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={content.image1.src}
              alt={content.image1.alt}
              className="w-full h-auto rounded-lg border border-primary/10 shadow-sm"
              loading="lazy"
            />
            {F({
              as: 'figcaption',
              path: 'image1.caption',
              value: content.image1.caption,
              className: 'mt-3 text-sm text-muted italic text-center block',
            })}
          </figure>

          {content.bodyAfterImage1.map((p, i) =>
            F({ as: 'p', path: `bodyAfterImage1.${i}`, value: p, className: 'mb-6' })
          )}

          {F({
            as: 'h2',
            path: 'buildHeading',
            value: content.buildHeading,
            className: 'font-serif text-2xl md:text-3xl text-primary leading-snug mb-5 mt-12',
          })}

          {content.bodyBuild.map((p, i) => F({ as: 'p', path: `bodyBuild.${i}`, value: p, className: 'mb-6' }))}

          {/* Image 2 */}
          <figure className="my-12 -mx-2 md:-mx-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={content.image2.src}
              alt={content.image2.alt}
              className="w-full h-auto rounded-lg border border-primary/10 shadow-sm"
              loading="lazy"
            />
            {F({
              as: 'figcaption',
              path: 'image2.caption',
              value: content.image2.caption,
              className: 'mt-3 text-sm text-muted italic text-center block',
            })}
          </figure>

          {content.bodyConvener.map((p, i) =>
            F({ as: 'p', path: `bodyConvener.${i}`, value: p, className: 'mb-6' })
          )}

          {F({ as: 'p', path: 'signoff', value: content.signoff, className: 'mb-4' })}

          {/* Signature */}
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={content.signature.photo}
              alt={content.signature.name}
              width={72}
              height={72}
              className="w-[72px] h-[72px] rounded-full object-cover border border-primary/15 shadow-sm shrink-0"
            />
            <div>
              {F({
                as: 'div',
                path: 'signature.name',
                value: content.signature.name,
                className: 'text-primary font-serif text-lg font-semibold leading-tight',
              })}
              {F({
                as: 'div',
                path: 'signature.role',
                value: content.signature.role,
                className: 'text-muted text-sm tracking-wide mt-1',
              })}
              {editable ? (
                F({
                  as: 'div',
                  path: 'signature.email',
                  value: content.signature.email,
                  className: 'text-accent-rust text-sm',
                })
              ) : (
                <a href={`mailto:${content.signature.email}`} className="text-accent-rust hover:underline text-sm">
                  {content.signature.email}
                </a>
              )}
            </div>
          </div>
        </article>

        {/* ── The plan ── */}
        <section className="mt-24 max-w-[68ch]">
          {F({
            as: 'h2',
            path: 'plan.heading',
            value: content.plan.heading,
            className: 'font-serif text-2xl md:text-3xl text-primary leading-snug mb-3',
          })}
          {F({ as: 'p', path: 'plan.intro', value: content.plan.intro, className: 'text-secondary leading-relaxed mb-8' })}

          <dl className="divide-y divide-primary/10 border-y border-primary/10">
            {content.plan.items.map((item, i) => (
              <div
                key={`${version}:item:${i}`}
                className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-1 sm:gap-8 py-4 items-baseline"
              >
                {F({
                  as: 'dt',
                  path: `plan.items.${i}.work`,
                  value: item.work,
                  className: 'text-secondary leading-relaxed',
                })}
                {F({
                  as: 'dd',
                  path: `plan.items.${i}.resource`,
                  value: item.resource,
                  className: 'font-serif text-primary text-lg sm:text-right whitespace-nowrap',
                })}
              </div>
            ))}
          </dl>

          {F({
            as: 'p',
            path: 'plan.footnote',
            value: content.plan.footnote,
            className: 'text-muted text-sm leading-relaxed mt-6',
          })}
        </section>

        {/* ── CTA ── */}
        <section className="mt-20 max-w-[68ch] border-t border-primary/10 pt-12">
          {F({
            as: 'h2',
            path: 'cta.heading',
            value: content.cta.heading,
            className: 'font-serif text-2xl md:text-3xl text-primary leading-snug mb-4',
          })}
          {F({ as: 'p', path: 'cta.body', value: content.cta.body, className: 'text-secondary leading-relaxed mb-8' })}
          <div className="flex flex-col sm:flex-row gap-4">
            {editable ? (
              <>
                {F({
                  as: 'span',
                  path: 'cta.primaryLabel',
                  value: content.cta.primaryLabel,
                  className:
                    'inline-block bg-accent-rust text-white py-3 px-8 rounded-full text-base font-medium text-center',
                })}
                {F({
                  as: 'span',
                  path: 'cta.secondaryLabel',
                  value: content.cta.secondaryLabel,
                  className:
                    'inline-block bg-white border border-primary/20 text-primary py-3 px-8 rounded-full text-base font-medium text-center',
                })}
              </>
            ) : (
              <>
                <a
                  href={content.cta.primaryHref}
                  className="inline-block bg-accent-rust text-white py-3 px-8 rounded-full hover:bg-accent-rust/90 transition-colors text-base font-medium text-center"
                >
                  {content.cta.primaryLabel}
                </a>
                <Link
                  href={content.cta.secondaryHref}
                  className="inline-block bg-white border border-primary/20 text-primary py-3 px-8 rounded-full hover:border-accent-rust hover:text-accent-rust transition-colors text-base font-medium text-center"
                >
                  {content.cta.secondaryLabel}
                </Link>
              </>
            )}
          </div>
          {F({ as: 'p', path: 'cta.footer', value: content.cta.footer, className: 'mt-6 text-sm text-muted' })}
        </section>
      </main>

      {/* ── Edit toolbar ── */}
      {editable && (
        <div className="fixed bottom-0 inset-x-0 z-50 bg-[#2a1f17] text-white border-t border-white/10 shadow-[0_-4px_20px_rgba(0,0,0,0.25)]">
          {showPaste && (
            <div className="max-w-[var(--container-wide)] mx-auto px-6 py-4">
              <label className="block text-xs uppercase tracking-widest text-white/60 mb-2">
                Paste someone&rsquo;s JSON to preview their edits
              </label>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={6}
                className="w-full rounded bg-black/30 border border-white/15 p-3 font-mono text-xs text-white/90 focus:outline-none focus:ring-2 focus:ring-accent-rust/50"
                placeholder='{ "hero": { ... }, ... }'
              />
              {pasteError && <p className="text-red-300 text-sm mt-2">{pasteError}</p>}
              <div className="flex gap-3 mt-3">
                <button
                  onClick={doLoad}
                  className="px-4 py-2 rounded bg-accent-rust hover:bg-accent-rust/90 text-sm font-medium"
                >
                  Load &amp; preview
                </button>
                <button
                  onClick={() => {
                    setShowPaste(false);
                    setPasteError('');
                  }}
                  className="px-4 py-2 rounded bg-white/10 hover:bg-white/20 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="max-w-[var(--container-wide)] mx-auto px-6 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-sm text-white/70">
              Editing locally — copy the JSON and send it to Derek.
            </span>
            <div className="flex-1" />
            <button
              onClick={doCopy}
              className="px-4 py-2 rounded bg-accent-rust hover:bg-accent-rust/90 text-sm font-semibold"
            >
              {copied ? 'Copied ✓' : 'Copy JSON'}
            </button>
            <button
              onClick={() => setShowPaste((s) => !s)}
              className="px-4 py-2 rounded bg-white/10 hover:bg-white/20 text-sm"
            >
              Paste JSON
            </button>
            <button onClick={doReset} className="px-4 py-2 rounded bg-white/10 hover:bg-white/20 text-sm">
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
