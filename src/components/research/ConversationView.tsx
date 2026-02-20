'use client';

import { useState } from 'react';
import { research } from '@/lib/api-client/research';
import type { CuratorMessage } from '@/lib/api-client/types/research';

interface Props {
  sessionId: string;
  initialMessages: CuratorMessage[];
  totalMessages: number;
}

export default function ConversationView({ sessionId, initialMessages, totalMessages }: Props) {
  const [messages, setMessages] = useState<CuratorMessage[]>(initialMessages);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const hasMore = messages.length < totalMessages;

  const loadMore = async () => {
    setLoading(true);
    try {
      const nextPage = page + 1;
      const data = await research.get(sessionId, { page: nextPage, per_page: 50 });
      setMessages(prev => [...prev, ...data.messages]);
      setPage(nextPage);
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {messages.map((msg, i) => (
        <MessageBubble key={i} message={msg} />
      ))}

      {hasMore && (
        <div className="text-center py-4">
          <button
            onClick={loadMore}
            disabled={loading}
            className="px-4 py-2 text-sm border border-border-light rounded hover:bg-stone-50 disabled:opacity-50"
          >
            {loading ? 'Loading...' : `Load more (${totalMessages - messages.length} remaining)`}
          </button>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: CuratorMessage }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = message.text.length > 500;
  const displayText = isLong && !expanded ? message.text.slice(0, 500) + '...' : message.text;

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-stone-100 rounded-lg px-4 py-3">
          <div className="text-sm text-primary whitespace-pre-wrap">{displayText}</div>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-accent-rust mt-1"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-full bg-white border border-border-light rounded-lg px-4 py-3">
      <div className="text-sm text-primary whitespace-pre-wrap prose prose-sm max-w-none">
        {displayText}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-accent-rust mt-1"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
