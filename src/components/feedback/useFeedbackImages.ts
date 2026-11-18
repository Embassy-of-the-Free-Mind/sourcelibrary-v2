'use client';

/**
 * Attach pictures to a feedback message — picked, pasted, or dropped.
 *
 * Each file uploads immediately to /api/feedback/upload and the returned URL
 * is what the message finally carries (`images[]` on POST /api/feedback). The
 * reader sees a thumbnail from the moment they attach it, an upload state on
 * it, and can remove it before sending.
 *
 * Shared by the site-wide FeedbackWidget and the reader's FeedbackPanel so
 * the two never drift in what they accept or how they shrink a phone photo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_FEEDBACK_IMAGES, MAX_FEEDBACK_IMAGE_BYTES } from '@/lib/feedback-limits';
import { shrinkImage } from '@/lib/shrink-image';

export interface AttachedImage {
  id: string;
  /** Local object URL for the thumbnail, valid while attached. */
  preview: string;
  /** Public URL once the upload has landed. */
  url: string | null;
  status: 'uploading' | 'ready' | 'error';
}

/** Longest edge for the client-side shrink; the server caps again at 2000. */
const SHRINK_EDGE = 2400;

async function upload(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', await shrinkImage(file, { maxBytes: MAX_FEEDBACK_IMAGE_BYTES, maxEdge: SHRINK_EDGE }));
  const res = await fetch('/api/feedback/upload', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.url !== 'string') {
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return data.url;
}

export function useFeedbackImages() {
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [error, setError] = useState<'limit' | 'failed' | null>(null);
  // Mirror of `images` for the event handlers below, so `addFiles` can count
  // what is already attached without being re-created on every change.
  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; }, [images]);

  // Object URLs are per-document memory until revoked.
  useEffect(() => () => { imagesRef.current.forEach(i => URL.revokeObjectURL(i.preview)); }, []);

  const addFiles = useCallback((incoming: Iterable<File>) => {
    const files = Array.from(incoming).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    const room = MAX_FEEDBACK_IMAGES - imagesRef.current.length;
    if (room <= 0) { setError('limit'); return; }
    const accepted = files.slice(0, room);
    setError(accepted.length < files.length ? 'limit' : null);

    const fresh: AttachedImage[] = accepted.map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      preview: URL.createObjectURL(f),
      url: null,
      status: 'uploading',
    }));
    setImages(prev => [...prev, ...fresh]);

    fresh.forEach((entry, i) => {
      upload(accepted[i])
        .then(url => setImages(prev => prev.map(img => img.id === entry.id ? { ...img, url, status: 'ready' } : img)))
        .catch(() => {
          setError('failed');
          setImages(prev => prev.map(img => img.id === entry.id ? { ...img, status: 'error' } : img));
        });
    });
  }, []);

  const remove = useCallback((id: string) => {
    setImages(prev => {
      const gone = prev.find(i => i.id === id);
      if (gone) URL.revokeObjectURL(gone.preview);
      return prev.filter(i => i.id !== id);
    });
    setError(null);
  }, []);

  const reset = useCallback(() => {
    imagesRef.current.forEach(i => URL.revokeObjectURL(i.preview));
    setImages([]);
    setError(null);
  }, []);

  /** Attach to the textarea: a pasted screenshot becomes an attachment, text pastes as usual. */
  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  }, [addFiles]);

  const onDrop = useCallback((e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  }, [addFiles]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault();
  }, []);

  return {
    images,
    error,
    uploading: images.some(i => i.status === 'uploading'),
    /** What to send: only uploads that landed. */
    urls: images.filter(i => i.status === 'ready' && i.url).map(i => i.url as string),
    addFiles,
    remove,
    reset,
    onPaste,
    onDrop,
    onDragOver,
  };
}
