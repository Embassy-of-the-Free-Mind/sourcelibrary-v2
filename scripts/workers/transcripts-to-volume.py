#!/usr/bin/env python3
# PRIOR ART: /root/bin/move-transcripts-6223.py on main (Derek 2026-11-07, run by hand twice: 10,082 folders idle
#   14+ days moved to $VOL/claude-projects-archive with a link left). This is that routine made safe to run every
#   hour under live sessions: a 12 h idle test that also reads open files from /proc, a per-file manifest check
#   instead of totals, and an atomic swap of folder and link. disk-steward.sh's step 3 (cold archive to R2) is for
#   folders nothing will open again; a transcript folder is opened by `claude --continue`, so it is moved, not archived.
#
# Move idle Claude Code transcript folders (<home>/projects/<folder>) off a small root disk onto the job disk,
# leaving a symlink in place, so `claude --continue`, claude-job.sh's context check and conversation search still
# find them where they were (#367). Called by disk-steward.sh (step 1g); safe to run by hand.
#   transcripts-to-volume.py --dest /mnt/HC_Volume_105839809/claude-projects /root/.claude/projects ...      # dry run
#   transcripts-to-volume.py --dest ... --apply /root/.claude/projects
# A folder moves only when ALL of: it is a real folder (a link is already moved: a second run is a no-op); nothing in
# it was written for --idle-hours (default 12); no process has a file open in it or works inside it; its destination
# does not exist. The move: copy to <dest>/.moving-<name>, compare a manifest (every entry's path, type, size, mtime
# and link target) of the copy with the original's, read before and after the copy (unchanged = nothing wrote during
# it); rename the copy into place; then swap the original and a new link in ONE renameat2(RENAME_EXCHANGE), so there
# is no moment when the path is missing and a new session could make a fresh folder there. Only when the swapped-out
# original still matches the manifest and holds no open file is it removed. Any failure keeps the original where it
# was (the swap is undone) and says why. Transcripts are never deleted, only moved.
# Layout: <dest>/<home without its dot>/<folder>, e.g. /mnt/HC_Volume_105839809/claude-projects/claude/-root-sourcelibrary.
# claude-job.sh start makes a job's own folder in the same place before its session starts.
import argparse, ctypes, os, shutil, subprocess, sys, time

AT_FDCWD = -100
RENAME_EXCHANGE = 2
_libc = ctypes.CDLL(None, use_errno=True)


def exchange(a, b):
    """Atomically swap two paths on one filesystem (Linux renameat2)."""
    if _libc.renameat2(AT_FDCWD, os.fsencode(a), AT_FDCWD, os.fsencode(b), RENAME_EXCHANGE) != 0:
        e = ctypes.get_errno()
        raise OSError(e, f'renameat2 exchange {a} <-> {b}: {os.strerror(e)}')


def manifest(root):
    """(entries, bytes, newest mtime, signature): one row per entry below root, path-relative."""
    rows, total, newest = [], 0, os.lstat(root).st_mtime
    for d, ds, fs in os.walk(root):
        for n in ds + fs:
            p = os.path.join(d, n); st = os.lstat(p); rel = os.path.relpath(p, root)
            newest = max(newest, st.st_mtime)
            if os.path.islink(p): rows.append((rel, 'l', os.readlink(p)))
            elif n in fs: rows.append((rel, 'f', st.st_size, st.st_mtime_ns)); total += st.st_size
            else: rows.append((rel, 'd'))
    rows.sort()
    return len(rows), total, newest, rows


def open_paths(listfile=None):
    """Every open file and working directory on the box: from the steward's list, or read from /proc."""
    if listfile:
        with open(listfile, errors='replace') as f: return {l.rstrip('\n') for l in f}
    out = set()
    for pid in os.listdir('/proc'):
        if not pid.isdigit(): continue
        for sub in ('cwd',):
            try: out.add(os.readlink(f'/proc/{pid}/{sub}'))
            except OSError: pass
        try: fds = os.listdir(f'/proc/{pid}/fd')
        except OSError: continue
        for fd in fds:
            try: out.add(os.readlink(f'/proc/{pid}/fd/{fd}'))
            except OSError: pass
    return out


def held(path, opened):
    return any(p == path or p.startswith(path + '/') for p in opened)


def gb(b): return f'{b / 1e9:.2f} GB'


def move_one(src, dst, before, opened_now):
    """Returns None when moved, else why it was not (the original is in place in every such case)."""
    parent = os.path.dirname(dst); name = os.path.basename(dst)
    tmp = os.path.join(parent, '.moving-' + name)
    os.makedirs(parent, exist_ok=True)
    shutil.rmtree(tmp, ignore_errors=True)
    r = subprocess.run(['cp', '-a', '--', src, tmp], capture_output=True, text=True)
    if r.returncode != 0:
        shutil.rmtree(tmp, ignore_errors=True); return f'copy failed: {r.stderr.strip()[:200]}'
    copy = manifest(tmp); again = manifest(src)
    if again[3] != before[3]:
        shutil.rmtree(tmp, ignore_errors=True); return 'written during the copy'
    if copy[3] != before[3]:
        shutil.rmtree(tmp, ignore_errors=True)
        return f'copy differs: {copy[0]} entries / {copy[1]} bytes, original {before[0]} / {before[1]}'
    if held(src, opened_now()):
        shutil.rmtree(tmp, ignore_errors=True); return 'a file was opened during the copy'
    if os.path.lexists(dst):
        shutil.rmtree(tmp, ignore_errors=True); return 'destination appeared during the copy'
    os.rename(tmp, dst)
    link = os.path.join(os.path.dirname(src), f'.{os.path.basename(src)}.link-{os.getpid()}')
    os.symlink(dst, link)
    try:
        exchange(link, src)          # src is now the link; `link` names the original folder
    except OSError as e:
        os.unlink(link); shutil.rmtree(dst, ignore_errors=True); return str(e)
    hold = link
    after = manifest(hold)
    if after[3] == before[3] and not held(hold, opened_now()):
        shutil.rmtree(hold)
        return None
    # Something wrote to or opened the original in the last moment: put it back, keep the copy only if untouched.
    dst_now = manifest(dst)
    exchange(hold, src)              # src is the original folder again; `hold` is the link
    os.unlink(hold)
    if dst_now[3] == before[3]: shutil.rmtree(dst, ignore_errors=True); return 'written or opened during the swap; put back'
    return f'written during the swap; put back, and {dst} kept as well (it was written through the link)'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('projects', nargs='+', help='<claude home>/projects folders')
    ap.add_argument('--dest', required=True)
    ap.add_argument('--idle-hours', type=float, default=12)
    ap.add_argument('--open-list', help="file of open paths (disk-steward.sh's list); default: read /proc")
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--verbose', action='store_true', help='one line per folder kept, not only the large ones')
    a = ap.parse_args()
    dest = os.path.abspath(a.dest)
    cutoff = time.time() - a.idle_hours * 3600
    opened = open_paths(a.open_list)
    opened_now = lambda: open_paths()   # re-read at each check that follows a copy: the steward's list is an hour old
    moved = moved_b = 0; kept = {}; kept_b = 0; failed = 0
    verb = 'moved' if a.apply else 'would move'
    for proj in a.projects:
        proj = os.path.abspath(proj)
        if not os.path.isdir(proj): continue
        home = os.path.basename(os.path.dirname(proj)).lstrip('.') or 'home'
        if os.path.realpath(dest).startswith(os.path.realpath(proj) + '/'):
            print(f'  transcripts: {dest} is inside {proj}; refused'); return 2
        for e in sorted(os.scandir(proj), key=lambda x: x.name):
            if e.name.startswith('.') or e.is_symlink() or not e.is_dir(follow_symlinks=False): continue
            src = e.path; dst = os.path.join(dest, home, e.name)
            try: m = manifest(src)
            except OSError as ex: kept['unreadable'] = kept.get('unreadable', 0) + 1; print(f'  keep {src}: unreadable ({ex})'); continue
            why = None; k = None
            if m[2] > cutoff: why, k = f'written {(time.time() - m[2]) / 3600:.1f} h ago', 'written recently'
            elif held(src, opened): why, k = 'a file in it is open', 'open'
            elif os.path.lexists(dst): why, k = f'{dst} exists', 'destination exists'
            if why is None and a.apply:
                try: why = move_one(src, dst, m, opened_now)
                except Exception as ex: why = f'failed: {ex}'
                if why: failed += 1; print(f'  FAILED {src}: {why}; original kept', flush=True); kept_b += m[1]; continue
            if why:
                kept[k] = kept.get(k, 0) + 1; kept_b += m[1]
                if a.verbose or m[1] >= 256e6: print(f'  keep {src} ({gb(m[1])}): {why}')
                continue
            moved += 1; moved_b += m[1]
            if a.verbose or m[1] >= 50e6: print(f'  {verb} {src} ({gb(m[1])}, {m[0]} entries) -> {dst}', flush=True)
    ks = ', '.join(f'{v} {k}' for k, v in sorted(kept.items())) or 'none'
    print(f'  transcripts: {verb} {moved} folders ({gb(moved_b)}) to {dest}; kept {sum(kept.values()) + failed} ({gb(kept_b)}: {ks}{f", {failed} failed" if failed else ""})')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
