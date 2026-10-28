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

Rule: allow `view_file` / `read_file` (agy ≥ 1.4.6) on a path inside the call's own workspace (the one-image directory the runner made);
deny every other tool call, and say why. It never approves a command, a write or a network call (#6345). An
install writes <workspace>/.agents/hooks.json pointing here (install_gate in scripts/eval/run-cli-arm.py).

stdin: agy's PreToolUse payload {toolCall: {name, args}, ...}; stdout: {decision, reason}.
env: AGY_GATE_ROOT (the workspace; required), AGY_GATE_LOG (optional jsonl of every call and decision), AGY_GATE_TASK
(ocr | translate: which denial reason; default ocr).
"""
import json, os, sys

# The reason must not claim the model has seen the image: in one dev read (#6523 R2) a model that was told so wrote a
# different page of the same edition from memory. It names the one tool that works instead.
REASON = ('That tool is disabled here. The only tool available is view_file on the attached page image in this '
          'directory. Open it with view_file if you have not yet, then write the transcription of what the image shows '
          'directly in your reply, following the instructions exactly.')
# AGY_GATE_TASK=translate (scripts/lib/agy-cli.mjs installToolGate, used by scripts/batch/cli-translate.mjs): the text
# is in the prompt and the workspace is empty, so the reason says no tool is needed at all.
REASONS = {
    'ocr': REASON,
    'translate': ('That tool is disabled here, and no tool or file is needed: the text to translate is in the prompt. '
                  'Write the translation directly in your reply, following the instructions exactly.'),
    # AGY_GATE_TASK=geometry (scripts/maintenance/split-spreads-agy.mjs, #7454): where a spread's fold is, no text.
    'geometry': ('That tool is disabled here. The only tool available is view_file (or read_file) on the image in this '
                 'directory. Open it if you have not yet, then answer directly in your reply, following the '
                 'instructions exactly. Do not transcribe any text.'),
}


def decide(call, root, task='ocr'):
    name = (call or {}).get('name', '')
    args = (call or {}).get('args') or {}
    # agy 1.4.6 (self-updated 2026-10-23 07:16Z) opens the image with `read_file {Path}`, not `view_file`. Denied, the
    # model never saw the page and wrote an invented one that every chatter guard passed (#4763, #5924). Same rule:
    # a path inside the workspace, read only.
    if name in ('view_file', 'read_file') and root:
        p = os.path.realpath(str(args.get('AbsolutePath') or args.get('Path') or ''))
        if p.startswith(os.path.realpath(root) + os.sep):
            return {'decision': 'allow'}
    return {'decision': 'deny', 'reason': REASONS.get(task, REASON)}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        payload = {}
    out = decide(payload.get('toolCall'), os.environ.get('AGY_GATE_ROOT'), os.environ.get('AGY_GATE_TASK') or 'ocr')
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
