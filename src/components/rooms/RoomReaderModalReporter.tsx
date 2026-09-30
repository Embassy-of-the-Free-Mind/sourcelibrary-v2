'use client';

import { useEffect } from 'react';

/**
 * Tells the host page that the reader inside a reading room has opened or
 * closed, so the host script (public/rooms/embed.js) can lift the frame to
 * fill the window while a book is being read and drop it back after.
 *
 * Message names and the `source: "source-library"` tag match the Source
 * Bridge component embeds (embassy-sourcelibrary-ds.vercel.app), so one host
 * script serves rooms and their components alike. Mounted from the layout of
 * the reader segment, so it stays mounted across page turns and unmounts only
 * when the reader is left. `pagehide` covers a full navigation out of the
 * frame, where React never unmounts.
 */
export default function RoomReaderModalReporter() {
  useEffect(() => {
    if (window.self === window.top) return;
    const post = (type: 'modal-open' | 'modal-close') => {
      window.parent.postMessage({ source: 'source-library', type }, '*');
    };
    const onHide = () => post('modal-close');
    post('modal-open');
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      post('modal-close');
    };
  }, []);
  return null;
}
