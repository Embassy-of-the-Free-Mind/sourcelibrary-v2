#!/usr/bin/env node
// PRIOR ART: scripts/eval/lane-judge-sampler.mjs claudeMeter (climits, else the login's own usage endpoint; imported).
// This box's climits entry for its login can be an error row (2026-11-04: derek@playpowerlabs invalid_grant), so the
// endpoint fallback is what reads it. Prints one JSON line: { source, email, weekly, session, weekly_reset, … }.
import * as limits from '../../lib/model-limits.mjs';
import { claudeMeter } from '../../eval/lane-judge-sampler.mjs';
console.log(JSON.stringify(await claudeMeter(limits)));
