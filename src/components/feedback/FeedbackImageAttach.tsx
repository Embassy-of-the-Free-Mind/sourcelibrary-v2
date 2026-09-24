'use client';

/**
 * The attachment strip under a feedback textarea: thumbnails of what is
 * attached (with upload state and a remove control), and an "Add image"
 * button. Pasting and dropping are wired on the textarea by the caller via
 * the hook's handlers; this component only shows the result and offers the
 * picker for readers who don't paste.
 */

import { useRef } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { MAX_FEEDBACK_IMAGES } from '@/lib/feedback-limits';
import type { useFeedbackImages } from './useFeedbackImages';

export interface FeedbackImageStrings {
  attach: string;
  attachHint: string;
  attachLimit: string;
  attachFailed: string;
  removeImage: string;
}

export function FeedbackImageAttach({
  attachments,
  strings,
  disabled,
}: {
  attachments: ReturnType<typeof useFeedbackImages>;
  strings: FeedbackImageStrings;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { images, error, addFiles, remove } = attachments;
  const full = images.length >= MAX_FEEDBACK_IMAGES;

  return (
    <div className="mt-2">
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2 mb-2" aria-live="polite">
          {images.map(img => (
            <li
              key={img.id}
              className="relative w-16 h-16 rounded overflow-hidden border"
              style={{ borderColor: img.status === 'error' ? 'var(--status-error, #b91c1c)' : 'var(--border-medium, #d6d3d1)', background: 'var(--bg-cream, #f5f5f4)' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
              <img
                src={img.preview}
                alt=""
                className="w-full h-full object-cover"
                style={{ opacity: img.status === 'ready' ? 1 : 0.5 }}
              />
              {img.status === 'uploading' && (
                <span className="absolute inset-0 flex items-center justify-center" style={{ color: 'var(--text-primary, #292524)' }}>
                  <Loader2 size={16} className="animate-spin" />
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(img.id)}
                aria-label={strings.removeImage}
                title={strings.removeImage}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-white"
                style={{ background: 'rgba(0,0,0,0.6)' }}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || full}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-default"
          style={{ borderColor: 'var(--border-medium, #d6d3d1)', color: 'var(--text-secondary, #57534e)', background: 'var(--bg-white, #fff)' }}
        >
          <ImagePlus size={13} />
          {strings.attach}
        </button>
        <span className="text-[11px]" style={{ color: 'var(--text-faint, #a8a29e)' }}>
          {full ? strings.attachLimit : strings.attachHint}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {error === 'failed' && (
        <p className="text-xs mt-1" style={{ color: 'var(--status-error, #b91c1c)' }} role="alert">
          {strings.attachFailed}
        </p>
      )}
    </div>
  );
}
