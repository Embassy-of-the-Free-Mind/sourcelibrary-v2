/**
 * WebMCP (Web Model Context Protocol) adapter.
 *
 * WebMCP is a draft W3C standard (webmachinelearning/webmcp) that lets a page
 * register typed tools that in-browser AI agents (Gemini in Chrome, ChatGPT
 * Desktop, Brave Leo, Edge/Copilot) can discover and call. Chrome ships it in
 * an origin trial (149–156); the API host has moved between revisions
 * (`window.agent` → `navigator.modelContext` → `document.modelContext`), so we
 * feature-detect both current hosts and treat the whole thing as progressive
 * enhancement: no API, no-op.
 *
 * Registered tools run in the page with the user's own session, so existing
 * auth/rate limits apply unchanged. v1 policy (issue #4594): read-only tools
 * only — no writes without requestUserInteraction(), which is not yet stable.
 */

export interface WebMCPToolResult {
  content: Array<{ type: 'text'; text: string }>;
}

export interface WebMCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (
    params: Record<string, unknown>
  ) => WebMCPToolResult | Promise<WebMCPToolResult>;
}

interface ModelContext {
  registerTool?: (
    tool: WebMCPTool,
    options?: { signal?: AbortSignal }
  ) => Promise<void> | void;
  unregisterTool?: (name: string) => void;
  provideContext?: (context: { tools: WebMCPTool[] }) => void;
}

/** Wrap plain text in the MCP result shape agents expect. */
export function textResult(text: string): WebMCPToolResult {
  return { content: [{ type: 'text', text }] };
}

function getModelContext(): ModelContext | null {
  if (typeof document === 'undefined') return null;
  const doc = document as Document & { modelContext?: ModelContext };
  const nav = navigator as Navigator & { modelContext?: ModelContext };
  return doc.modelContext ?? nav.modelContext ?? null;
}

/** True when the current browser exposes a WebMCP registration surface. */
export function isWebMCPAvailable(): boolean {
  return getModelContext() !== null;
}

/**
 * Register a set of tools; returns a cleanup function that unregisters them.
 * Safe to call unconditionally — silently no-ops when WebMCP is unavailable.
 */
export function registerWebMCPTools(tools: WebMCPTool[]): () => void {
  const ctx = getModelContext();
  if (!ctx) return () => {};

  if (typeof ctx.registerTool === 'function') {
    const controller = new AbortController();
    for (const tool of tools) {
      try {
        void ctx.registerTool(tool, { signal: controller.signal });
      } catch {
        // An experimental API rejecting one tool must never break the page.
      }
    }
    return () => {
      controller.abort();
      // Older revisions ignore the abort signal but expose unregisterTool.
      if (typeof ctx.unregisterTool === 'function') {
        for (const tool of tools) {
          try {
            ctx.unregisterTool(tool.name);
          } catch {
            /* already gone */
          }
        }
      }
    };
  }

  if (typeof ctx.provideContext === 'function') {
    // provideContext replaces the full tool set; clearing on cleanup keeps
    // stale page-scoped tools from outliving their page.
    try {
      ctx.provideContext({ tools });
    } catch {
      return () => {};
    }
    return () => {
      try {
        ctx.provideContext?.({ tools: [] });
      } catch {
        /* best effort */
      }
    };
  }

  return () => {};
}
