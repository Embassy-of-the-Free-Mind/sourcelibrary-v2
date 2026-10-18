'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  CHECK_SIZE,
  LOCAL_KEY,
  RUNGS,
  RUNG_LABEL,
  asksVerdict,
  checkDue,
  cropUrl,
  emptyState,
  gradeAnswer,
  heldOut,
  nextItem,
  parseState,
  recordAttempt,
  rungProgress,
  showSenses,
  startingRung,
  studyCardFor,
  type LocalState,
  type MayaItem,
  type Rung,
  type StudyCard,
  type Verdict,
} from '@/lib/learn-maya';

type Phase = 'try' | 'reveal';

const ORDINAL = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

export default function MayaLearn() {
  const { data: session, status: authStatus } = useSession();
  const signedIn = !!session?.user;
  const [items, setItems] = useState<MayaItem[] | null>(null);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [local, setLocal] = useState<LocalState>(emptyState);
  const [hydrated, setHydrated] = useState(false);
  const [rung, setRung] = useState<Rung>('numeral');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('try');
  const [tryAnswer, setTryAnswer] = useState('');
  const [correct, setCorrect] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [correction, setCorrection] = useState('');
  const [checking, setChecking] = useState<{ index: number; answers: { item_id: string; answer: string; correct: boolean }[] } | null>(null);
  const [checkDone, setCheckDone] = useState<{ score: number; total: number } | null>(null);

  // Load the bank and this device's progress together, then open on the
  // held-out check if it is due, else on the learner's rung.
  useEffect(() => {
    const state = parseState(window.localStorage.getItem(LOCAL_KEY));
    fetch('/api/learn/maya/items')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        const all = d.items as (MayaItem | StudyCard)[];
        const bank = all.filter((i): i is MayaItem => i.rung !== 'study');
        setItems(bank);
        setCards(all.filter((i): i is StudyCard => i.rung === 'study'));
        setLocal(state);
        setHydrated(true);
        if (checkDue(state) && heldOut(bank).length === CHECK_SIZE) {
          setChecking({ index: 0, answers: [] });
          return;
        }
        const r = startingRung(bank, state);
        setRung(r);
        setCurrentId(nextItem(bank, state, r)?._id ?? null);
      })
      .catch(() => setLoadError(true));
  }, []);

  const save = useCallback((s: LocalState) => {
    setLocal(s);
    try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(s)); } catch { /* private mode: progress lasts the visit */ }
  }, []);

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i._id, i])), [items]);
  const checkItems = useMemo(() => (items ? heldOut(items) : []), [items]);

  const item = currentId ? byId.get(currentId) ?? null : null;
  const card = item && phase === 'try' ? studyCardFor(item, cards, local.studied) : null;

  // While the learner reads a reveal, fetch the next item's picture (and its card's) so it is there on tap.
  useEffect(() => {
    if (phase !== 'reveal' || !items || !item) return;
    const n = nextItem(items, local, rung, item._id);
    const urls = [n?.image ? cropUrl(n.image) : null, ...(n ? studyCardFor(n, cards, local.studied)?.figures.map((f) => f.crop_url) ?? [] : [])];
    for (const u of urls) if (u) new Image().src = u;
  }, [phase, items, item, local, rung, cards]);

  const goTo = (r: Rung, state = local, skip?: string) => {
    window.scrollTo(0, 0);
    setRung(r);
    setCurrentId(items ? nextItem(items, state, r, skip)?._id ?? null : null);
    setPhase('try');
    setTryAnswer('');
    setDisputing(false);
    setCorrection('');
  };

  const submitTry = (answer: string) => {
    if (!item) return;
    const ok = gradeAnswer(item, answer);
    setTryAnswer(answer);
    setCorrect(ok);
    setPhase('reveal');
    save(recordAttempt(local, item._id, ok));
  };

  /** verdict null: a gold item, answered but not judged. */
  const judge = (verdict: Verdict | null) => {
    if (!item) return;
    if (signedIn) {
      fetch('/api/learn/maya/judgements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: item._id, answer: tryAnswer, correct, verdict,
          correction: verdict === 'disagree' && correction.trim() ? correction.trim() : null,
          items_seen: local.seq,
        }),
        keepalive: true,
      }).catch(() => { /* a lost judgement is not worth interrupting the learner for */ });
    }
    if (checkDue(local) && checkItems.length === CHECK_SIZE) {
      setCurrentId(null);
      setChecking({ index: 0, answers: [] });
      return;
    }
    goTo(rung, local, item._id);
  };

  const answerCheck = (answer: string) => {
    if (!checking) return;
    const ci = checkItems[checking.index];
    const answers = [...checking.answers, { item_id: ci._id, answer, correct: gradeAnswer(ci, answer) }];
    if (checking.index + 1 < checkItems.length) {
      setChecking({ index: checking.index + 1, answers });
      setTryAnswer('');
      window.scrollTo(0, 0);
      return;
    }
    const score = answers.filter((a) => a.correct).length;
    const next: LocalState = { ...local, checks: [...local.checks, { at: local.seq, score, total: answers.length, date: new Date().toISOString().slice(0, 10) }] };
    save(next);
    if (signedIn) {
      fetch('/api/learn/maya/judgements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'check', score, total: answers.length, answers, items_seen: local.seq }),
        keepalive: true,
      }).catch(() => {});
    }
    setChecking(null);
    setCheckDone({ score, total: answers.length });
  };

  const skipCheck = () => {
    save({ ...local, checkSkippedAt: local.seq });
    setChecking(null);
    goTo(items ? startingRung(items, local) : 'numeral');
  };

  if (loadError) {
    return <p className="max-w-md mx-auto px-5 py-16 text-secondary">The items did not load. Reload the page to try again.</p>;
  }
  if (!items || !hydrated) {
    return (
      <div className="max-w-md mx-auto px-5 py-8 animate-pulse">
        <div className="h-8 bg-stone-200 rounded w-2/3 mb-6" />
        <div className="h-64 bg-stone-200 rounded-lg mb-6" />
        <div className="grid grid-cols-5 gap-2">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="h-12 bg-stone-200 rounded" />)}</div>
      </div>
    );
  }

  // ── Held-out check ──
  if (checking) {
    const ci = checkItems[checking.index];
    const first = local.checks.length === 0;
    return (
      <div className="max-w-md mx-auto px-5 pt-5 pb-16">
        <div className="flex items-baseline justify-between mb-4">
          <h1 className="font-serif text-xl text-primary">{first ? 'Where you start' : 'Check'}</h1>
          <span className="text-sm text-muted">{checking.index + 1} / {checkItems.length}</span>
        </div>
        {checking.index === 0 && (
          <p className="text-sm text-secondary mb-4">
            {first && <>Learn to read Maya numbers, day signs and Yucatec words from the Dresden Codex and the colonial dictionaries. </>}
            Ten items, no answers shown. {first ? 'Guess freely: these ten are your baseline.' : 'The same ten as before, so the score shows what you can now read.'}
          </p>
        )}
        <Material item={ci} />
        <TryControls key={ci._id} item={ci} onSubmit={answerCheck} value={tryAnswer} setValue={setTryAnswer} />
        {checking.index === 0 && (
          <button onClick={skipCheck} className="mt-6 text-sm text-muted underline underline-offset-2">Skip the check for now</button>
        )}
      </div>
    );
  }

  if (checkDone) {
    return (
      <div className="max-w-md mx-auto px-5 py-12 text-center">
        <p className="text-sm text-muted uppercase tracking-wide mb-2">Your check</p>
        <div className="font-serif text-6xl text-accent-rust mb-6">{checkDone.score}<span className="text-3xl text-muted">/{checkDone.total}</span></div>
        <CheckHistory checks={local.checks} />
        <button
          onClick={() => { setCheckDone(null); goTo(startingRung(items, local)); }}
          className="mt-8 w-full bg-[#1a1612] text-white py-4 rounded-lg font-medium"
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-5 pt-4 pb-16">
      <nav className="flex gap-1 mb-4 -mx-1" aria-label="Rungs">
        {RUNGS.map((r) => {
          const p = rungProgress(items, local, r);
          return (
            <button
              key={r}
              onClick={() => goTo(r)}
              className={`flex-1 px-2 py-2 rounded-md text-sm text-left border ${r === rung ? 'border-accent-rust bg-white text-primary' : 'border-transparent text-muted'}`}
            >
              <span className="block font-medium">{RUNG_LABEL[r]}</span>
              <span className="block text-xs">{p.seen}/{p.total}</span>
            </button>
          );
        })}
      </nav>

      {!item ? (
        <div className="py-12 text-center">
          <p className="font-serif text-2xl text-primary mb-3">You have been through every {RUNG_LABEL[rung].toLowerCase().replace(/s$/, '')} here.</p>
          <p className="text-secondary mb-6">Missed items have come back until you got them three times running.</p>
          {RUNGS.filter((r) => r !== rung).map((r) => (
            <button key={r} onClick={() => goTo(r)} className="block w-full mb-2 py-3 rounded-lg border border-border-light bg-white">{RUNG_LABEL[r]}</button>
          ))}
        </div>
      ) : (
        <>
          {card ? (
            <StudyCardView key={card._id} card={card} onDone={() => save({ ...local, studied: [...local.studied, card._id] })} />
          ) : (
          <>
          <Material item={item} />
          {phase === 'try' ? (
            <TryControls key={item._id} item={item} onSubmit={submitTry} value={tryAnswer} setValue={setTryAnswer} />
          ) : (
            <>
              <Reveal item={item} answer={tryAnswer} correct={correct} byId={byId} />
              {!asksVerdict(item) ? (
                <button onClick={() => judge(null)} className="mt-6 w-full py-4 rounded-lg bg-[#1a1612] text-white font-medium">Next</button>
              ) : (
              <section className="mt-6 border-t border-border-light pt-4">
                <h2 className="text-sm font-medium text-primary mb-3">Is the AI reading right?</h2>
                {!disputing ? (
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => judge('agree')} className="py-3 rounded-lg bg-[#1a1612] text-white font-medium">Agree</button>
                    <button onClick={() => setDisputing(true)} className="py-3 rounded-lg border border-accent-rust text-accent-rust font-medium bg-white">Disagree</button>
                    <button onClick={() => judge('unsure')} className="py-3 rounded-lg border border-border-light text-secondary bg-white">Not sure</button>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm text-secondary mb-2" htmlFor="maya-correction">What should it be? (optional)</label>
                    <textarea
                      id="maya-correction"
                      value={correction}
                      onChange={(e) => setCorrection(e.target.value.slice(0, 500))}
                      rows={2}
                      className="w-full rounded-lg border border-border-light p-3 text-base bg-white"
                    />
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <button onClick={() => judge('disagree')} className="py-3 rounded-lg bg-accent-rust text-white font-medium">Send disagreement</button>
                      <button onClick={() => setDisputing(false)} className="py-3 rounded-lg border border-border-light bg-white text-secondary">Back</button>
                    </div>
                  </div>
                )}
                {authStatus === 'unauthenticated' && (
                  <p className="text-xs text-muted mt-3">
                    Your answers stay on this device. <Link href="/auth/signin?callbackUrl=/learn/maya" className="underline underline-offset-2">Sign in</Link> to send your verdicts to the expert queue.
                  </p>
                )}
              </section>
              )}
            </>
          )}
          </>
          )}
          {local.checks.length > 0 && (
            <p className="text-xs text-muted mt-8">
              Checks: {local.checks.map((c) => `${c.score}/${c.total}`).join(' → ')} · next after {Math.max(0, 50 - (local.seq - Math.max(local.checks[local.checks.length - 1].at, local.checkSkippedAt ?? -1)))} more items
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Material({ item }: { item: MayaItem }) {
  if (item.image) {
    return (
      <figure className="mb-4">
        <div className="rounded-lg bg-[#efe6d6] flex items-center justify-center min-h-[38vh]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={item._id}
            src={cropUrl(item.image)}
            alt={`${item.rung === 'numeral' ? 'Bar-and-dot number' : 'Day sign'} from the Dresden Codex, page ${item.image.codex_page}`}
            className="max-h-[42vh] w-full object-contain rounded-lg"
          />
        </div>
        <figcaption className="text-xs text-muted mt-1">Dresden Codex, page {item.image.codex_page}{item.rung === 'numeral' ? `, ${item.image.color}` : ''}</figcaption>
      </figure>
    );
  }
  if (item.word) {
    const { form, source } = item.word;
    const line = source.line.replace(/^\|\s*|\s*\|$/g, '');
    const parts = line.split(new RegExp(`(\\b${form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b)`, 'i'));
    return (
      <figure className="mb-4">
        <p className="font-serif text-5xl text-primary text-center py-8">{form}</p>
        <blockquote className="font-serif text-lg text-secondary border-l-2 border-accent-rust pl-3">
          {parts.map((p, i) => (p.toLowerCase() === form.toLowerCase() ? <mark key={i} className="bg-accent-rust/15 text-primary px-0.5">{p}</mark> : <span key={i}>{p}</span>))}
        </blockquote>
        <figcaption className="text-xs text-muted mt-1">
          <a href={source.url} className="underline underline-offset-2">{source.title}, p. {source.page_number}</a>
        </figcaption>
      </figure>
    );
  }
  return null;
}

function TryControls({ item, onSubmit, value, setValue }: { item: MayaItem; onSubmit: (a: string) => void; value: string; setValue: (v: string) => void }) {
  if (item.prompt.kind === 'count') {
    return (
      <div>
        <p className="text-sm text-primary mb-2">{item.prompt.text}</p>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 20 }, (_, n) => (
            <button key={n} onClick={() => onSubmit(String(n))} className="h-12 rounded-lg border border-border-light bg-white text-lg font-medium text-primary active:bg-stone-100">
              {n}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (item.prompt.kind === 'pick') {
    return (
      <div>
        <p className="text-sm text-primary mb-2">{item.prompt.text}</p>
        <div className="grid grid-cols-2 gap-2">
          {(item.prompt.options ?? []).map((o) => (
            <button key={o} onClick={() => onSubmit(o)} className="h-14 rounded-lg border border-border-light bg-white font-serif text-lg text-primary active:bg-stone-100">
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}>
      <label className="block text-sm text-primary mb-2" htmlFor="maya-gloss">{item.prompt.text}</label>
      <input
        id="maya-gloss"
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 200))}
        autoComplete="off"
        autoCapitalize="none"
        placeholder="In English, a word or two"
        className="w-full rounded-lg border border-border-light p-3 text-base bg-white"
      />
      <div className="grid grid-cols-2 gap-2 mt-2">
        <button type="submit" disabled={!value.trim()} className="py-3 rounded-lg bg-[#1a1612] text-white font-medium disabled:opacity-40">Check</button>
        <button type="button" onClick={() => onSubmit('')} className="py-3 rounded-lg border border-border-light bg-white text-secondary">Show me</button>
      </div>
    </form>
  );
}

function Reveal({ item, answer, correct, byId }: { item: MayaItem; answer: string; correct: boolean; byId: Map<string, MayaItem> }) {
  const linkedWord = item.links.word_id ? byId.get(item.links.word_id) : undefined;
  const linkedCrops = [...(item.links.numeral_ids ?? []), ...(item.links.day_sign_ids ?? [])].map((id) => byId.get(id)).filter((x): x is MayaItem => !!x && !!x.image);
  return (
    <section aria-live="polite">
      <p className={`font-serif text-2xl mb-1 ${correct ? 'text-primary' : 'text-accent-rust'}`}>
        {correct ? 'Yes. ' : answer ? 'Not quite. ' : ''}
        {item.rung === 'numeral' && <>It is {item.answer.value}.</>}
        {item.rung === 'day-sign' && <>It is {item.answer.sign}.</>}
        {item.rung === 'word' && <>{item.word?.form} means “{item.answer.short}”.</>}
      </p>
      {item.rung === 'day-sign' && (
        <p className="text-secondary">The {ORDINAL(item.answer.position ?? 0)} of the twenty day signs, here with the coefficient {item.answer.coefficient}.</p>
      )}
      {item.teach && <p className="text-primary mt-1">{item.teach}</p>}
      {item.note && <p className="text-secondary mt-2">{item.note}</p>}

      {item.rung === 'word' ? (
        <div className="mt-4 space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">{item.evidence.find((e) => e.kind === 'dictionary')?.label}</p>
            <p className="font-serif text-lg text-primary"><Italics text={showSenses(item.answer.gloss_es ?? '')} /></p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">AI reading</p>
            <p className="text-primary"><Italics text={showSenses(item.ai.reading)} /></p>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">AI reading</p>
            <p className="font-serif text-2xl text-primary">{item.ai.reading}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Förstemann, 1906</p>
            <p className="font-serif text-2xl text-primary">{item.rung === 'numeral' ? item.answer.value : item.answer.sign}</p>
          </div>
        </div>
      )}

      {(linkedWord || linkedCrops.length > 0) && (
        <div className="mt-4 rounded-lg bg-white border border-border-light p-3">
          {linkedWord?.word && (
            <p className="text-secondary">
              In Yucatec: <span className="font-serif text-xl text-primary">{linkedWord.word.headword}</span>
              {linkedWord.answer.short ? <span className="text-muted">, “{linkedWord.answer.short}”</span> : null}
            </p>
          )}
          {linkedCrops.length > 0 && (
            <>
              <p className="text-xs text-muted mb-2">The same on the Dresden Codex:</p>
              <div className="flex gap-2">
                {linkedCrops.slice(0, 3).map((c) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={c._id} src={cropUrl(c.image!)} alt={`Dresden Codex, page ${c.image!.codex_page}`} className="h-16 w-auto rounded bg-[#efe6d6]" />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <ul className="mt-4 text-sm space-y-1">
        {item.evidence.map((e) => (
          <li key={e.url}>
            <a href={e.url} className="text-accent-rust underline underline-offset-2">{e.label}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StudyCardView({ card, onDone }: { card: StudyCard; onDone: () => void }) {
  const codex = card.figures.filter((f) => f.kind !== 'history');
  const history = card.figures.filter((f) => f.kind === 'history');
  return (
    <section className="mb-4">
      <p className="text-xs uppercase tracking-wide text-muted mb-1">Before you start</p>
      <h2 className="font-serif text-3xl text-primary mb-3">{card.title}</h2>
      <div className={`grid gap-2 ${codex.length > 2 ? 'grid-cols-3' : codex.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {codex.map((f) => (
          <figure key={f.crop_url}>
            <div className="rounded-lg bg-[#efe6d6] flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.crop_url} alt={f.label} className={`${codex.length > 1 ? 'max-h-[18vh]' : 'max-h-[34vh]'} w-full object-contain rounded-lg`} />
            </div>
            <figcaption className="text-xs text-muted mt-1"><a href={f.url} className="underline underline-offset-2">{f.label}</a></figcaption>
          </figure>
        ))}
      </div>
      <p className="text-lg text-primary mt-4">{card.text}</p>
      {history.map((f) => (
        <aside key={f.crop_url} className="mt-4 flex gap-3 items-center rounded-lg border border-border-light bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={f.crop_url} alt="" className="h-20 w-auto shrink-0" />
          <p className="text-sm text-secondary"><a href={f.url} className="underline underline-offset-2">{f.label}</a>.</p>
        </aside>
      ))}
      <button onClick={onDone} className="mt-6 w-full py-4 rounded-lg bg-[#1a1612] text-white font-medium">Now try one</button>
    </section>
  );
}

/** Dictionary page text marks italics as *word*; show them as italics, not asterisks. */
function Italics({ text }: { text: string }) {
  return <>{text.split(/(\*[^*]+\*)/).map((p, i) => (/^\*[^*]+\*$/.test(p) ? <em key={i}>{p.slice(1, -1)}</em> : <span key={i}>{p}</span>))}</>;
}

function CheckHistory({ checks }: { checks: LocalState['checks'] }) {
  if (checks.length < 2) return <p className="text-secondary">Your next check comes after 50 items.</p>;
  return (
    <ol className="text-left text-secondary space-y-1">
      {checks.map((c, i) => (
        <li key={i} className="flex justify-between border-b border-border-light py-1">
          <span>{c.date} · after {c.at} items</span>
          <span className="font-medium text-primary">{c.score}/{c.total}</span>
        </li>
      ))}
    </ol>
  );
}
