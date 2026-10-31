/// <reference lib="webworker" />
/**
 * The by-book bootstrap for the live read-surface page (#6740), off the main thread so the controls stay live.
 * Receives observations + the model kind, rebuilds the terms (functions cannot cross postMessage) and posts back the
 * resampled fits. A newer request supersedes an older one by its `id`.
 */
import { bootstrap, termsFor, type ModelKind, type Obs } from './rsm';

let latest = 0;
self.onmessage = (e: MessageEvent<{ id: number; obs: Obs[]; kind: ModelKind; B: number }>) => {
  const { id, obs, kind, B } = e.data;
  latest = id;
  const terms = termsFor(obs, kind);
  const res = bootstrap(obs, terms, B, (i) => { if (id === latest) (self as unknown as Worker).postMessage({ id, progress: i }); });
  if (id === latest) (self as unknown as Worker).postMessage({ id, fits: res.fits });
};
