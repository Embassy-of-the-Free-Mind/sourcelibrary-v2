'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * Design variants for review. Each <Variant id="join" options={{ a, b, c }} />
 * renders option `a` by default. A small picker (bottom left) switches them
 * live; it only appears in development or with ?variants in the URL, so a
 * deploy shows option `a` and nothing else. Choices persist in the URL
 * (?v-join=b) so a link reproduces what you were looking at.
 */

type Registry = Record<string, string[]>;
const Ctx = createContext<{ pick: Record<string, string>; register: (id: string, keys: string[]) => void } | null>(null);

export function VariantProvider({ children }: { children: ReactNode }) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const [reg, setReg] = useState<Registry>({});
  const [show, setShow] = useState(false);

  // Reads the URL once after mount (it isn't available during server render).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    /* eslint-disable react-hooks/set-state-in-effect */
    setShow(process.env.NODE_ENV !== 'production' || q.has('variants'));
    const p: Record<string, string> = {};
    q.forEach((v, k) => {
      if (k.startsWith('v-')) p[k.slice(2)] = v;
    });
    setPick(p);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const choose = (id: string, key: string) => {
    setPick((p) => ({ ...p, [id]: key }));
    const u = new URL(window.location.href);
    u.searchParams.set(`v-${id}`, key);
    window.history.replaceState(null, '', u);
  };

  const register = (id: string, keys: string[]) =>
    setReg((r) => (r[id] && r[id].join() === keys.join() ? r : { ...r, [id]: keys }));

  return (
    <Ctx.Provider value={{ pick, register }}>
      {children}
      {show && Object.keys(reg).length > 0 && (
        <div className="fixed left-3 bottom-16 z-[60] bg-white/95 backdrop-blur border border-black/10 shadow-lg p-3 text-[13px] text-stone-800 space-y-2">
          {Object.entries(reg).map(([id, keys]) => (
            <div key={id} className="flex items-center gap-2">
              <button
                type="button"
                className="w-20 text-left text-stone-500 hover:text-stone-900 cursor-pointer"
                onClick={() => document.getElementById(`variant-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                {id}
              </button>
              {keys.map((k) => {
                const on = (pick[id] ?? keys[0]) === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => choose(id, k)}
                    className={`w-7 h-7 border cursor-pointer ${on ? 'bg-stone-900 text-white border-stone-900' : 'border-black/15 hover:border-black/40'}`}
                  >
                    {k.toUpperCase()}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function Variant({ id, options }: { id: string; options: Record<string, ReactNode> }) {
  const ctx = useContext(Ctx);
  const keys = Object.keys(options);
  useEffect(() => {
    ctx?.register(id, keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, keys.join()]);
  const k = ctx?.pick[id] && options[ctx.pick[id]] !== undefined ? ctx.pick[id] : keys[0];
  return (
    <div id={`variant-${id}`}>
      {options[k]}
    </div>
  );
}
