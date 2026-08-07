'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Trash2, Plus, MessageSquare } from 'lucide-react';
import {
  BOARD_COLUMNS,
  LIST_META,
  STATUS_META,
  TASK_LISTS,
  positionBetween,
  type TaskList,
  type TaskStatus,
} from '@/lib/bph-task-status';
import type { BphTask } from '@/lib/bph-tasks';

/**
 * The BPH task board.
 *
 * Kanban columns over `bph_feedback_tasks`, filtered by audience list so a
 * librarian can see what is waiting on the library rather than a mixed pile.
 *
 * Dragging uses the browser's own drag-and-drop rather than a drag library.
 * That keeps a new dependency out of a Next 16 build for a single screen, and
 * the arrow buttons on every card do the same job for keyboard and touch,
 * which a drag-only board would not.
 *
 * Ordering is fractional (see positionBetween): a move writes one row instead
 * of renumbering the column.
 */

const COL_CLASS =
  'flex-1 min-w-[240px] rounded-lg border border-border-light bg-warm/40 p-3 flex flex-col gap-2';

interface Props {
  tenant: string;
  initialTasks: BphTask[];
  /** Where catalogue routes live on this host (see catalogBasePath). */
  basePath: string;
}

export default function BphTaskBoard({ tenant, initialTasks, basePath }: Props) {
  const router = useRouter();
  const [tasks, setTasks] = useState<BphTask[]>(initialTasks);
  const [list, setList] = useState<TaskList>('librarian');
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [, startTransition] = useTransition();

  const visible = useMemo(() => tasks.filter((t) => t.list === list), [tasks, list]);

  const byColumn = useMemo(() => {
    const map = new Map<TaskStatus, BphTask[]>();
    for (const status of BOARD_COLUMNS) map.set(status, []);
    for (const t of visible) {
      if (map.has(t.status)) map.get(t.status)!.push(t);
    }
    for (const [, arr] of map) arr.sort((a, b) => a.position - b.position);
    return map;
  }, [visible]);

  async function patch(id: string, body: Record<string, unknown>, optimistic: Partial<BphTask>) {
    const before = tasks;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...optimistic } : t)));
    setError(null);
    try {
      const res = await fetch(`/api/${tenant}/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setTasks(before); // put it back where it was rather than lie about the move
        setError(json.error || `Could not save (${res.status})`);
      }
    } catch (e) {
      setTasks(before);
      setError((e as Error).message || 'Could not save');
    }
  }

  function moveTo(task: BphTask, status: TaskStatus) {
    const column = byColumn.get(status) || [];
    const last = column.length ? column[column.length - 1].position : null;
    const position = positionBetween(last, null);
    patch(task.id, { status, position }, { status, position });
  }

  function shiftBy(task: BphTask, delta: number) {
    const idx = BOARD_COLUMNS.indexOf(task.status);
    const next = BOARD_COLUMNS[idx + delta];
    if (next) moveTo(task, next);
  }

  async function remove(task: BphTask) {
    const before = tasks;
    setTasks((ts) => ts.filter((t) => t.id !== task.id));
    const res = await fetch(`/api/${tenant}/tasks/${encodeURIComponent(task.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      setTasks(before);
      setError('Could not remove that card');
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/${tenant}/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, list }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Could not add that');
      } else if (json.task) {
        setTasks((ts) => [json.task as BphTask, ...ts]);
        setNewTitle('');
        startTransition(() => router.refresh());
      }
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {TASK_LISTS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setList(key)}
            aria-pressed={list === key}
            className={
              'px-3 py-1.5 text-sm border transition-colors ' +
              (list === key
                ? 'border-border-light bg-warm text-primary'
                : 'border-border-light text-secondary hover:bg-warm hover:text-primary')
            }
          >
            {LIST_META[key].label}
            <span className="ml-1.5 text-xs text-muted">
              {tasks.filter((t) => t.list === key).length}
            </span>
          </button>
        ))}
        <span className="text-xs text-muted ml-1">{LIST_META[list].blurb}</span>
      </div>

      <form onSubmit={add} className="flex gap-2 mb-5">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder={`Add something to “${LIST_META[list].label}”…`}
          className="flex-1 text-sm border border-border-light px-3 py-2 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
        />
        <button
          type="submit"
          disabled={adding || !newTitle.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-border-light text-secondary hover:bg-warm hover:text-primary transition-colors disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </form>

      {error && (
        <div className="mb-4 p-3 border border-accent-rust/40 bg-accent-rust/5 text-sm text-secondary">
          {error}
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {BOARD_COLUMNS.map((status) => {
          const column = byColumn.get(status) || [];
          return (
            <section
              key={status}
              className={COL_CLASS}
              onDragOver={(e) => {
                if (dragging) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const task = tasks.find((t) => t.id === dragging);
                setDragging(null);
                if (task && task.status !== status) moveTo(task, status);
              }}
            >
              <header className="px-1">
                <h3 className="text-sm text-primary font-medium">
                  {STATUS_META[status].label}
                  <span className="ml-1.5 text-xs text-muted">{column.length}</span>
                </h3>
                <p className="text-[0.6875rem] text-muted">{STATUS_META[status].blurb}</p>
              </header>

              {column.length === 0 && (
                <p className="text-xs text-muted px-1 py-4 text-center">Nothing here.</p>
              )}

              {column.map((task) => {
                const idx = BOARD_COLUMNS.indexOf(task.status);
                return (
                  <article
                    key={task.id}
                    draggable
                    onDragStart={() => setDragging(task.id)}
                    onDragEnd={() => setDragging(null)}
                    className={
                      'border border-border-light bg-white p-2.5 cursor-grab active:cursor-grabbing ' +
                      (dragging === task.id ? 'opacity-50' : '')
                    }
                  >
                    <p className="text-sm text-primary break-words">{task.title}</p>
                    {task.body && (
                      <p className="mt-1 text-xs text-muted break-words line-clamp-3">{task.body}</p>
                    )}

                    <div className="mt-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => shiftBy(task, -1)}
                        disabled={idx <= 0}
                        aria-label={`Move “${task.title}” left`}
                        className="p-1 text-muted hover:text-primary disabled:opacity-30"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => shiftBy(task, 1)}
                        disabled={idx >= BOARD_COLUMNS.length - 1}
                        aria-label={`Move “${task.title}” right`}
                        className="p-1 text-muted hover:text-primary disabled:opacity-30"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>

                      {task.feedback_id && (
                        <a
                          href={`${basePath}/inbox?tab=feedback`}
                          title="Came from feedback"
                          className="p-1 text-muted hover:text-accent-rust"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={() => remove(task)}
                        aria-label={`Remove “${task.title}”`}
                        className="ml-auto p-1 text-muted hover:text-accent-rust"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
