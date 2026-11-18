#!/usr/bin/env python3
"""Clean the public copy of the code just before public-mirror.sh commits it.

Usage: mirror-scrub.py <public-tree> <private box.sh> <env file>

1. Box addresses become documentation addresses (203.0.113.x), everywhere in the tree.
2. Personal login addresses become account@example.com in operations files. src/ and tests/ are
   left alone: their addresses are published contacts or test fixtures.
3. If the value of a live secret is still in the tree, exit 3 so that nothing is published.
   Output names the setting and the file, never the value.

Any failure stops the mirror: a copy that could not be checked is not published.
"""
import os
import re
import sys
from urllib.parse import unquote

SECRET_KEY = re.compile(r'(PASSWORD|PASSWD|SECRET|TOKEN|PRIVATE|_KEY$|_URI$|_DB_URL$|DATABASE_URL)')
OPS_PATH = re.compile(r'^(scripts|infrastructure|docs|\.github)/|^[^/]+\.md$')
PERSONAL = re.compile(r'[A-Za-z0-9._%+-]+@(?:gmail\.com|playpowerlabs\.com)')


def read_env(path):
    out = {}
    with open(path, encoding='utf8') as f:
        for line in f:
            m = re.match(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$', line.rstrip('\n'))
            if m:
                out[m.group(1)] = m.group(2).strip().strip('"\'')
    return out


def secret_values(env):
    found = {}
    for key, value in env.items():
        if not SECRET_KEY.search(key) or len(value) < 8:
            continue
        found[value] = key
        if '://' in value and '@' in value:
            cred = value.split('://', 1)[1].rsplit('@', 1)[0]
            if ':' in cred:
                password = cred.split(':', 1)[1]
                for form in (password, unquote(password)):
                    if len(form) >= 8:
                        found[form] = f'{key} (password)'
    return found


def main():
    tree, box_file, env_file = sys.argv[1:4]
    with open(box_file, encoding='utf8') as f:
        ips = sorted(set(re.findall(r'\b[a-z0-9]+=((?:\d{1,3}\.){3}\d{1,3})\b', f.read())))
    if not ips:
        sys.exit(f'mirror-scrub: no box addresses found in {box_file}')
    swap = {ip: f'203.0.113.{i + 1}' for i, ip in enumerate(ips)}
    box_ip = re.compile(r'(?<![\d.])(' + '|'.join(re.escape(ip) for ip in ips) + r')(?![\d.])')
    secrets = secret_values(read_env(env_file))
    if not secrets:
        sys.exit(f'mirror-scrub: no secrets read from {env_file}')

    changed, leaks = 0, []
    for folder, dirs, names in os.walk(tree):
        dirs[:] = [d for d in dirs if d != '.git']
        for name in names:
            path = os.path.join(folder, name)
            if os.path.islink(path):
                continue
            rel = os.path.relpath(path, tree)
            with open(path, 'rb') as f:
                raw = f.read()
            for value, key in secrets.items():
                if value.encode() in raw:
                    leaks.append((key, rel))
            if b'\0' in raw:
                continue
            try:
                text = raw.decode('utf8')
            except UnicodeDecodeError:
                continue
            new = box_ip.sub(lambda m: swap[m.group(1)], text)
            if OPS_PATH.search(rel):
                new = PERSONAL.sub('account@example.com', new)
            if new != text:
                with open(path, 'w', encoding='utf8', newline='') as f:
                    f.write(new)
                changed += 1

    print(f'mirror-scrub: cleaned {changed} file(s)')
    if leaks:
        for key, rel in sorted(set(leaks)):
            print(f'mirror-scrub: LIVE SECRET {key} in {rel}', file=sys.stderr)
        sys.exit(3)


if __name__ == '__main__':
    main()
