#!/usr/bin/env python3
# Pass a mongodump archive (uncompressed) from stdin to stdout unchanged, and on the way write:
#   META:  {"db.coll": "<metadata EJSON>"} from the archive's prelude (each collection's options and indexes);
#   OPLOG: the archive's captured oplog (the `.oplog` namespace) as a plain .bson file of oplog entries.
# Usage: archive-tee.py META OPLOG < archive > archive
#
# Why (#346): `mongorestore --oplogReplay` on 9.0 stops at the first update of a document the fuzzy dump does
# not hold (it was deleted later in the dump window), and it refuses namespace filters. So the restore runs
# mongorestore WITHOUT --oplogReplay (filters allowed) on this stream and replays OPLOG itself with
# initial-sync rules (oplog-replay.mjs). One download of the archive serves both.
#
# Format (mongo-tools archive/): int32 magic 0x8199e26d; prelude = a header BSON document, one BSON document per
# collection {db, collection, metadata, size, type}, int32 terminator -1; then body blocks, each a namespace
# header {db, collection, EOF, CRC} followed by that namespace's BSON documents and an int32 terminator -1.
# PRIOR ART: none — looked in scripts/lib, scripts/maintenance (no BSON or archive reader); pymongo is not
# installed on the boxes, so this decodes only the BSON types the headers use.
import json, struct, sys

MAGIC = 0x8199E26D


def read_exact(f, n):
    b = f.read(n)
    if len(b) != n:
        sys.exit("archive ended inside the prelude")
    return b


def bson_doc(buf):
    """Decode one BSON document: strings, ints, bools, doubles, nested docs; other types are skipped."""
    out, i = {}, 4
    while buf[i] != 0:
        t = buf[i]
        j = buf.index(b"\x00", i + 1)
        key = buf[i + 1:j].decode()
        i = j + 1
        if t == 0x02:
            n = struct.unpack_from("<i", buf, i)[0]
            out[key] = buf[i + 4:i + 3 + n].decode()
            i += 4 + n
        elif t in (0x03, 0x04):
            n = struct.unpack_from("<i", buf, i)[0]
            out[key] = bson_doc(buf[i:i + n])
            i += n
        elif t == 0x08:
            out[key] = buf[i] == 1
            i += 1
        elif t == 0x10:
            out[key] = struct.unpack_from("<i", buf, i)[0]
            i += 4
        elif t in (0x12, 0x11, 0x09):
            out[key] = struct.unpack_from("<q", buf, i)[0]
            i += 8
        elif t == 0x01:
            out[key] = struct.unpack_from("<d", buf, i)[0]
            i += 8
        elif t == 0x0A:
            out[key] = None
        else:
            sys.exit(f"unexpected BSON type {t:#x} in the prelude (key {key})")
    return out


def main():
    meta_path, oplog_path = sys.argv[1], sys.argv[2]
    f, out = sys.stdin.buffer, sys.stdout.buffer

    def take(n):
        b = read_exact(f, n)
        out.write(b)
        return b

    if struct.unpack("<I", take(4))[0] != MAGIC:
        sys.exit("not a mongodump archive (bad magic)")
    first, meta = True, {}
    while True:  # prelude
        head = take(4)
        n = struct.unpack("<i", head)[0]
        if n == -1:
            break
        doc = bson_doc(head + take(n - 4))
        if first:
            first = False
        elif doc.get("collection"):
            meta[f'{doc["db"]}.{doc["collection"]}'] = doc.get("metadata", "")
    if not meta:
        sys.exit("prelude lists no collections")
    with open(meta_path, "w") as m:
        json.dump(meta, m)
    oplog_docs = 0
    with open(oplog_path, "wb") as op:
        while True:  # body: namespace header, documents, terminator
            head = f.read(4)
            if not head:
                break
            out.write(head)
            if len(head) != 4:
                sys.exit("archive ended inside a block header")
            n = struct.unpack("<i", head)[0]
            if n == -1:  # an empty block
                continue
            ns = bson_doc(head + take(n - 4))
            is_oplog = ns.get("db", "") == "" and ns.get("collection") == "oplog"
            while True:
                h = take(4)
                k = struct.unpack("<i", h)[0]
                if k == -1:
                    break
                body = take(k - 4)
                if is_oplog:
                    op.write(h)
                    op.write(body)
                    oplog_docs += 1
    print(f"archive-tee: {len(meta)} collections in the prelude, {oplog_docs} oplog entries", file=sys.stderr)


if __name__ == "__main__":
    main()
