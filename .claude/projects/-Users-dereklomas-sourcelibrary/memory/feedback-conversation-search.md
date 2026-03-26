---
name: Fix conversation search — correct JSONL parsing
description: User messages in session JSONL are at msg.message.content, NOT msg.data.message.message.content. The historian MCP is unreliable for finding user messages.
type: feedback
---

When searching conversation history in `.claude/projects/*/[session-id].jsonl`:

**Correct structure for user messages:**
```python
msg = json.loads(line)
if msg.get("type") == "user":
    content = msg.get("message", {}).get("content", "")
    # content is either a string or a list of {type: "text", text: "..."} / {type: "tool_result", ...}
```

**WRONG (what was used before):**
```python
msg.get("data", {}).get("message", {}).get("message", {}).get("content", "")
```

**Why:** Derek asked to search for "csv" in yesterday's conversations. The wrong path returned 0 results and I incorrectly told him he never said it. He had said "make a csv of all the failed efm books" — the messages were there, just not being parsed.

**How to apply:** When searching conversation history, always use `msg["message"]["content"]` for user messages where `msg["type"] == "user"`. The `msg["data"]["message"]["message"]` path is for a different message type (progress/subagent).
