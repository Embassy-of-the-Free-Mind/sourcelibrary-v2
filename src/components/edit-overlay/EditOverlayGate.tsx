'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

// The overlay is only fetched when the URL carries ?edit. Readers get this
// gate alone: it renders nothing and reads the query on the client, so the
// page stays static (no searchParams on the server, no ISR bail-out).
const EditOverlay = dynamic(() => import('./EditOverlay'), { ssr: false });

export default function EditOverlayGate({
  target = 'article',
  commit,
  email = 'derek@sourcelibrary.org',
}: {
  /** CSS selector for the element whose prose blocks become editable. */
  target?: string;
  /** Build sha, recorded in the export so edits can be applied to the right revision. */
  commit?: string;
  /** Where the toolbar tells the reviewer to send the JSON. */
  email?: string;
}) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(new URLSearchParams(window.location.search).has('edit'));
  }, []);
  return on ? <EditOverlay target={target} commit={commit} email={email} /> : null;
}
