#!/usr/bin/env python3
# PRIOR ART: scripts/lib/cli-chatter.mjs (classifies a CLI reply AFTER the turn; it cannot stop the turn ending on a
# denied tool) and the #6331 nudge in scripts/eval/run-cli-arm.py / scripts/batch/cli-ocr.mjs (a second turn after the
# first ended empty). Nothing gated the agent's tool calls DURING the turn; agy's PreToolUse hook (hooks.json) can.
"""
agy-tool-gate.py: the PreToolUse hook for a headless OCR call through `agy -p` (#6523).

The CLI is an agent. Asked to transcribe an attached page it opens the image with `view_file`, then often asks for a
shell (python, to crop the image). In plan mode headless `agy` auto-denies that request and ENDS the turn with an
empty reply (the 470/867 "nudged" reads of #6293). Given a hook that denies the call WITH A REASON, the model gets the
reason back as the tool result and goes on in the same turn to write the transcription.

Rule: allow `view_file` on a path inside the call's own workspace (the one-image directory the runner made);
deny every other tool call, and say why. It never approves a command, a write or a network call (#6345). An
install writes <workspace>/.agents/hooks.json pointing here (install_gate in scripts/eval/run-cli-arm.py).

stdin: agy's PreToolUse payload {toolCall: {name, args}, ...}; stdout: {decision, reason}.
env: AGY_GATE_ROOT (the workspace; required), AGY_GATE_LOG (optional jsonl of every call and decision).
"""
import json, os, sys

REASON = ('Tools are disabled here. The page image is already attached and you have seen it: write the '
          'transcription directly in your reply, following the instructions exactly.')


def decide(call, root):
    name = (call or {}).get('name', '')
    args = (call or {}).get('args') or {}
    if name == 'view_file' and root:
        p = os.path.realpath(str(args.get('AbsolutePath') or ''))
        if p.startswith(os.path.realpath(root) + os.sep):
            return {'decision': 'allow'}
    return {'decision': 'deny', 'reason': REASON}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        payload = {}
    out = decide(payload.get('toolCall'), os.environ.get('AGY_GATE_ROOT'))
    log = os.environ.get('AGY_GATE_LOG')
    if log:
        try:
            with open(log, 'a') as f:
                f.write(json.dumps({'tool': (payload.get('toolCall') or {}).get('name'), 'decision': out['decision']}) + '\n')
        except OSError:
            pass
    print(json.dumps(out))


if __name__ == '__main__':
    main()
