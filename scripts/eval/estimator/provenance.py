# PRIOR ART: scripts/eval/estimator/provenance.mjs — the JS module this mirrors for the Python build-table scripts;
# both read provenance-schema.json and provenance-legacy.json, so the rules cannot drift apart (#6740).
"""Estimator-row provenance for the Python builders (#6740). See provenance.mjs for the full contract.

  from provenance import label_legacy, validate_row, route_key

A row carries either a measured `provenance` block (estimator-provenance/1) or `provenance: "legacy-not-recorded"`
plus `provenance_stated`, the entry provenance-legacy.json holds for its source: what the experiment's own files
state. A source with no entry raises; nothing is defaulted.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = json.load(open(os.path.join(HERE, 'provenance-schema.json')))
SCHEMA, LEGACY, NOT_RECORDED, NA = SPEC['SCHEMA'], SPEC['LEGACY'], SPEC['NOT_RECORDED'], SPEC['NA']
_REGISTRY = None


class ProvenanceError(Exception):
    pass


def registry():
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = json.load(open(os.path.join(HERE, 'provenance-legacy.json')))
    return _REGISTRY


def legacy_stated(table, keys):
    """The registered statement for the first key that has one (most specific first); raises when none does."""
    t = registry().get(table)
    if t is None:
        raise ProvenanceError(f'provenance-legacy.json has no table {table}')
    keys = [keys] if isinstance(keys, str) else list(keys)
    for k in keys:
        if k is not None and k != '_match' and k in t:
            return t[k]
    raise ProvenanceError(f"provenance-legacy.json {table}: no entry for {' / '.join(map(str, keys))} "
                          "- read the experiment's files and add what they state")


def label_legacy(row, table, keys):
    """Return the row labelled legacy-not-recorded with its registered statement (validated)."""
    out = dict(row, provenance=LEGACY, provenance_stated=legacy_stated(table, keys))
    validate_row(out, f'{table}:{keys}')
    return out


def _val(v):
    return isinstance(v, str) and len(v) > 0


def _dist(v):
    return isinstance(v, dict) and isinstance(v.get('distinct'), int) and v['distinct'] > 1 and isinstance(v.get('top'), list) and v['top']


def route_key(p):
    if not isinstance(p, dict):
        raise ProvenanceError('route_key: needs a provenance block (a legacy row has no route key)')
    return f"{p['engine']} | {p['prompt_id']}@{p['prompt_version']} | {p['read_mode']}"


def validate_row(row, where='row'):
    """Raise ProvenanceError naming the row and the field; return {'legacy': bool, 'key': route key or None}."""
    def fail(m):
        raise ProvenanceError(f'{where}: {m}')
    if not isinstance(row, dict):
        fail('not an object')
    if 'provenance' not in row:
        fail('no `provenance` field (a legacy row says provenance: "legacy-not-recorded" plus provenance_stated)')
    p = row['provenance']
    if p == LEGACY:
        st = row.get('provenance_stated')
        if not isinstance(st, dict):
            fail('legacy row without provenance_stated')
        for k in SPEC['legacy_required']:
            if not _val(st.get(k)):
                fail(f'provenance_stated.{k} missing (say what the experiment file states, or that it states nothing)')
        if row.get('judge') and row['judge'] not in SPEC['mechanical_judges'] and not _val(st.get('judge')):
            fail(f"judged row (judge {row['judge']}) without provenance_stated.judge")
        return {'legacy': True, 'key': None}
    if not isinstance(p, dict):
        fail(f'provenance must be an object or "{LEGACY}"')
    if p.get('schema') != SCHEMA:
        fail(f'provenance.schema must be {SCHEMA}')
    for k in SPEC['key_fields']:
        if not _val(p.get(k)):
            fail(f'provenance.{k} missing or not a single value')
    for k in SPEC['covariate_fields']:
        if not (_val(p.get(k)) or _dist(p.get(k))):
            fail(f'provenance.{k} missing')
    if p['read_mode'] not in SPEC['read_modes']:
        fail(f"provenance.read_mode {p['read_mode']} not allowed")
    access = [v for v, _ in p['access']['top']] if _dist(p['access']) else [p['access']]
    for acc in access:
        if acc not in SPEC['access']:
            fail(f'provenance.access {acc} not allowed')
    if _val(p['access']) and p['access'] not in ('cli', NOT_RECORDED) and (p.get('cli_name') != NA or p.get('cli_version') != NA):
        fail(f'provenance.cli_* must be "{NA}" when access is {p["access"]}')
    ins = p.get('instrument')
    if not isinstance(ins, dict):
        fail('provenance.instrument missing (what measured this row)')
    if ins.get('class') not in SPEC['instruments']:
        fail(f"provenance.instrument.class {ins.get('class')} not allowed")
    if not _val(ins.get('model')) or not _val(ins.get('prompt_hash')):
        fail('provenance.instrument needs model and prompt_hash')
    if ins['class'] == 'model-judge' and NA in (ins['model'], ins['prompt_hash']):
        fail('a model-judge instrument names its judge model and judge prompt hash')
    return {'legacy': False, 'key': route_key(p)}
