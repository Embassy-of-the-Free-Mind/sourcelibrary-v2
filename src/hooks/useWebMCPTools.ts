'use client';

import { useEffect, useRef } from 'react';
import { registerWebMCPTools, type WebMCPTool } from '@/lib/webmcp';

/**
 * Register WebMCP tools for the lifetime of the calling component.
 *
 * Tools are (re)registered only when `deps` change (e.g. the book id), but
 * each registered tool delegates `execute` to the latest `getTools()` result
 * at call time — so callbacks always see current component state (current
 * page number, etc.) without re-registering on every render, which would
 * churn the agent-visible tool list.
 */
export function useWebMCPTools(
  getTools: () => WebMCPTool[],
  deps: React.DependencyList = []
): void {
  const getToolsRef = useRef(getTools);
  getToolsRef.current = getTools;

  useEffect(() => {
    const registered = getToolsRef.current().map((tool) => ({
      ...tool,
      execute: (params: Record<string, unknown>) => {
        const live =
          getToolsRef.current().find((t) => t.name === tool.name) ?? tool;
        return live.execute(params);
      },
    }));
    return registerWebMCPTools(registered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
